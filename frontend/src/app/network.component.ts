import {
  AfterViewInit,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostBinding,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

export interface NetworkNode {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  degree: number;
}

export interface NetworkEdge {
  source: string;
  target: string;
  analytical: boolean;
}

interface Camera { x: number; y: number; scale: number; }
interface Position { x: number; y: number; }
interface ProjectedNode extends Position { node: NetworkNode; radius: number; }
interface ResolvedEdge { source: number; target: number; analytical: boolean; }
interface LabelRect { x: number; y: number; w: number; h: number; }
interface PointerState extends Position { startX: number; startY: number; moved: boolean; }

/** One canvas, one actual graph. Camera detail never removes nodes or edges. */
@Component({
  selector: 'app-network',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    tabindex: '0',
    role: 'region',
    'aria-label': 'Интерактивная карта связей. Стрелки перемещают карту; плюс и минус меняют масштаб; ноль показывает всю карту.',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    <canvas #surface aria-hidden="true"></canvas>
    @if (preview; as item) {
      <button class="node-preview" [style.left.px]="previewX" [style.top.px]="previewY"
        (click)="selectNode(item.id)" (pointerleave)="dismissPreview()" [attr.aria-label]="'Открыть: ' + item.label">
        <span class="preview-meta"><span>{{ typeLabel(item.type) }}</span><span>№ {{ previewIndex }}</span></span>
        <strong>{{ item.label }}</strong>
        <span class="preview-footer"><span>{{ item.degree }} связей</span><span>Открыть досье ↗</span></span>
      </button>
    }
    <span class="network-status" aria-live="polite">{{ status }}</span>
  `,
  styles: `
    :host { display: block; position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden; background: #0e0e0d; outline: none; }
    :host:focus-visible { box-shadow: inset 0 0 0 2px #b07c58; }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
    canvas:active { cursor: grabbing; }
    .node-preview { position: absolute; z-index: 4; width: 256px; max-width: calc(100% - 24px); padding: 15px 16px 12px; border: 1px solid #b07c58; background: #181512; color: #e9d6bd; text-align: left; cursor: pointer; box-shadow: 4px 4px 0 #5f3b29; font: inherit; }
    .node-preview::before { content: ''; position: absolute; top: -1px; left: -1px; width: 38px; height: 3px; background: #efc69c; }
    .preview-meta, .preview-footer { display: flex; justify-content: space-between; gap: 10px; font-family: 'IBM Plex Mono', 'Courier New', monospace; font-size: 9px; letter-spacing: .05em; line-height: 1.5; }
    .preview-meta { text-transform: uppercase; }
    .node-preview strong { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; margin: 18px 0 21px; font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: 400; line-height: 1.08; overflow-wrap: anywhere; }
    .preview-footer { border-top: 1px solid #5d4938; padding-top: 9px; }
    .preview-footer span:last-child { color: #efc69c; }
    .network-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @media (prefers-reduced-motion: reduce) { .node-preview { scroll-behavior: auto; } }
  `,
})
export class NetworkComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() nodes: NetworkNode[] = [];
  @Input() edges: NetworkEdge[] = [];
  @Input() activeId: string | null = null;
  @Input() focusId: string | null = null;
  @Input() zoomAction: { kind: 'in' | 'out' | 'fit'; seq: number } | null = null;
  @Output() nodeSelect = new EventEmitter<string>();
  @Output() viewportChange = new EventEmitter<{ zoom: number }>();
  @HostBinding('attr.data-node-count') get nodeCount(): number { return this.nodes.length; }
  @HostBinding('attr.data-edge-count') get edgeCount(): number { return this.edges.length; }
  @ViewChild('surface', { static: true }) private surface!: ElementRef<HTMLCanvasElement>;

  preview: NetworkNode | null = null;
  previewX = 0;
  previewY = 0;
  previewIndex = '';
  status = '';

  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private cleanup: (() => void)[] = [];
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private animationFrame = 0;
  private initialized = false;
  private fitted = false;
  private destroyed = false;
  private camera: Camera = { x: 0, y: 0, scale: 1 };
  private fittedCamera: Camera = { x: 0, y: 0, scale: 1 };
  private orderedNodes: NetworkNode[] = [];
  private nodeById = new Map<string, NetworkNode>();
  private nodeIndex = new Map<string, number>();
  private resolvedEdges: ResolvedEdge[] = [];
  private adjacency = new Map<string, Set<string>>();
  private projected: ProjectedNode[] = [];
  private hitGrid = new Map<string, number[]>();
  private labelHits: { node: NetworkNode; rect: LabelRect }[] = [];
  private hoveredId: string | null = null;
  private pointers = new Map<number, PointerState>();
  private pinchDistance = 0;
  private lastPinchMid: Position | null = null;
  private lastZoom = -1;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly zone: NgZone, private readonly cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    const canvas = this.surface.nativeElement;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.initialized = true;
    this.rebuildGraph();
    this.zone.runOutsideAngular(() => {
      this.listen(canvas, 'wheel', event => this.onWheel(event as WheelEvent), { passive: false });
      this.listen(canvas, 'pointerdown', event => this.onPointerDown(event as PointerEvent));
      this.listen(canvas, 'pointermove', event => this.onPointerMove(event as PointerEvent));
      this.listen(canvas, 'pointerup', event => this.onPointerUp(event as PointerEvent));
      this.listen(canvas, 'pointercancel', event => this.onPointerCancel(event as PointerEvent));
      this.listen(canvas, 'pointerleave', event => {
        if ((event as PointerEvent).relatedTarget instanceof Element && ((event as PointerEvent).relatedTarget as Element).closest('.node-preview')) return;
        if (!this.pointers.size) this.setHovered(null);
      });
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.resize();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized) return;
    if (changes['nodes'] || changes['edges']) {
      this.rebuildGraph();
      if (!this.fitted) this.fit(false);
    }
    if (changes['focusId'] && this.focusId) this.focusNode(this.focusId);
    if (changes['zoomAction'] && this.zoomAction) {
      if (this.zoomAction.kind === 'fit') this.fit(true);
      else this.zoomAt(this.width / 2, this.height / 2, this.zoomAction.kind === 'in' ? 1.35 : 1 / 1.35);
    }
    this.requestDraw();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.cleanup.forEach(fn => fn());
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.animationFrame);
    if (this.previewTimer) clearTimeout(this.previewTimer);
  }

  typeLabel(type: string): string {
    const labels: Record<string, string> = {
      book: 'Книга', theme: 'Тема', construct: 'Понятие', thinker: 'Автор',
      experiment: 'Исследовательский эпизод', code: 'Тематический код',
      proposition: 'Тезис', chain_step: 'Звено аргумента', trajectory_stage: 'Стадия понятия',
      work: 'Работа', citation: 'Библиографическая запись', concept: 'Концепт',
      author: 'Автор', idea: 'Идея', quote: 'Цитата', section: 'Раздел',
      fragment: 'Фрагмент', chapter: 'Глава',
    };
    return labels[type] ?? type;
  }

  selectNode(id: string): void {
    this.zone.run(() => this.nodeSelect.emit(id));
  }

  dismissPreview(): void { this.setHovered(null); }

  onKeydown(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    const distance = (event.shiftKey ? 160 : 65) / this.camera.scale;
    const pans: Record<string, Position> = {
      ArrowLeft: { x: -distance, y: 0 }, ArrowRight: { x: distance, y: 0 },
      ArrowUp: { x: 0, y: -distance }, ArrowDown: { x: 0, y: distance },
    };
    if (pans[event.key]) {
      event.preventDefault();
      this.stopAnimation();
      this.camera.x += pans[event.key].x;
      this.camera.y += pans[event.key].y;
      this.setHovered(null);
      this.requestDraw();
    } else if (['+', '=', '-', '_', '0', 'Enter', 'Escape'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') this.fit(true);
      else if (event.key === 'Enter') {
        const id = this.hoveredId ?? this.activeId ?? this.focusId ?? this.nearestCenter()?.id;
        if (id) this.selectNode(id);
      } else if (event.key === 'Escape') this.setHovered(null);
      else this.zoomAt(this.width / 2, this.height / 2, ['+', '='].includes(event.key) ? 1.3 : 1 / 1.3);
    }
  }

  private listen(target: EventTarget, name: string, fn: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(name, fn, options);
    this.cleanup.push(() => target.removeEventListener(name, fn, options));
  }

  private rebuildGraph(): void {
    this.nodeById = new Map(this.nodes.map(node => [node.id, node]));
    this.nodeIndex = new Map(this.nodes.map((node, index) => [node.id, index]));
    this.orderedNodes = [...this.nodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
    this.resolvedEdges = [];
    this.adjacency.clear();
    for (const edge of this.edges) {
      const source = this.nodeIndex.get(edge.source);
      const target = this.nodeIndex.get(edge.target);
      if (source === undefined || target === undefined) continue;
      this.resolvedEdges.push({ source, target, analytical: edge.analytical });
      if (!this.adjacency.has(edge.source)) this.adjacency.set(edge.source, new Set());
      if (!this.adjacency.has(edge.target)) this.adjacency.set(edge.target, new Set());
      this.adjacency.get(edge.source)!.add(edge.target);
      this.adjacency.get(edge.target)!.add(edge.source);
    }
    if (this.hoveredId && !this.nodeById.has(this.hoveredId)) this.setHovered(null);
    this.updateFitCamera();
    this.requestDraw();
  }

  private resize(): void {
    const rect = this.surface.nativeElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const wasAtFit = Math.abs(this.camera.scale / this.fittedCamera.scale - 1) < .02;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.surface.nativeElement.width = Math.round(this.width * this.dpr);
    this.surface.nativeElement.height = Math.round(this.height * this.dpr);
    this.updateFitCamera();
    if (!this.fitted || wasAtFit) this.fit(false);
    this.requestDraw();
  }

  private updateFitCamera(): void {
    if (!this.nodes.length || !this.width || !this.height) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const node of this.nodes) {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
      minX = Math.min(minX, node.x); maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y); maxY = Math.max(maxY, node.y);
    }
    if (!Number.isFinite(minX)) return;
    const paddingX = Math.min(96, this.width * .08);
    const paddingY = Math.min(64, this.height * .1);
    this.fittedCamera = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      scale: Math.min((this.width - paddingX * 2) / Math.max(1, maxX - minX), (this.height - paddingY * 2) / Math.max(1, maxY - minY)),
    };
  }

  private fit(animate: boolean): void {
    if (!this.nodes.length || !this.width || !this.height) return;
    this.updateFitCamera();
    this.fitted = true;
    this.moveCamera({ ...this.fittedCamera }, animate);
    this.setHovered(null);
  }

  focusNode(id: string): void {
    const node = this.nodeById.get(id);
    if (!node || !this.width || !this.height) return;
    this.moveCamera({ x: node.x, y: node.y, scale: Math.max(this.camera.scale, this.fittedCamera.scale * 4.4) }, true);
    this.setHovered(null);
    this.status = `${node.label}. ${node.degree} связей.`;
  }

  private stopAnimation(): void {
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }

  private moveCamera(target: Camera, animate: boolean): void {
    this.stopAnimation();
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera = target;
      this.emitViewport();
      this.requestDraw();
      return;
    }
    const from = { ...this.camera };
    const start = performance.now();
    this.zone.runOutsideAngular(() => {
      const step = (now: number) => {
        if (this.destroyed) return;
        const t = Math.min(1, (now - start) / 440);
        const ease = 1 - Math.pow(1 - t, 3);
        this.camera = {
          x: from.x + (target.x - from.x) * ease,
          y: from.y + (target.y - from.y) * ease,
          scale: Math.exp(Math.log(from.scale) + (Math.log(target.scale) - Math.log(from.scale)) * ease),
        };
        this.emitViewport();
        this.requestDraw();
        this.animationFrame = t < 1 ? requestAnimationFrame(step) : 0;
      };
      this.animationFrame = requestAnimationFrame(step);
    });
  }

  private zoomAt(x: number, y: number, factor: number): void {
    this.stopAnimation();
    const previousScale = this.camera.scale;
    const nextScale = Math.min(this.fittedCamera.scale * 40, Math.max(this.fittedCamera.scale * .4, previousScale * factor));
    this.camera.x += (x - this.width / 2) * (1 / previousScale - 1 / nextScale);
    this.camera.y += (y - this.height / 2) * (1 / previousScale - 1 / nextScale);
    this.camera.scale = nextScale;
    this.emitViewport();
    this.setHovered(null);
    this.requestDraw();
  }

  private emitViewport(): void {
    const zoom = Math.round(this.camera.scale / this.fittedCamera.scale * 100) / 100;
    if (zoom === this.lastZoom) return;
    this.lastZoom = zoom;
    this.zone.run(() => this.viewportChange.emit({ zoom }));
  }

  private pointerPosition(event: PointerEvent | WheelEvent): Position {
    const rect = this.surface.nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const pos = this.pointerPosition(event);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
    this.zoomAt(pos.x, pos.y, Math.exp(-Math.max(-150, Math.min(150, delta)) * .0016));
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const pos = this.pointerPosition(event);
    this.stopAnimation();
    (this.surface.nativeElement.parentElement as HTMLElement)?.focus({ preventScroll: true });
    this.surface.nativeElement.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { ...pos, startX: pos.x, startY: pos.y, moved: false });
    if (this.pointers.size > 1) {
      for (const pointer of this.pointers.values()) pointer.moved = true;
      this.beginPinch();
    }
    this.clearPreview();
  }

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    this.lastPinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private onPointerMove(event: PointerEvent): void {
    const pos = this.pointerPosition(event);
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) {
      this.setHovered(this.hitTest(pos.x, pos.y)?.id ?? null);
      return;
    }
    const previous = { x: pointer.x, y: pointer.y };
    pointer.x = pos.x;
    pointer.y = pos.y;
    if (Math.hypot(pos.x - pointer.startX, pos.y - pointer.startY) > 4) pointer.moved = true;
    if (this.pointers.size > 1) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.pinchDistance > 0) this.zoomAt(middle.x, middle.y, distance / this.pinchDistance);
      if (this.lastPinchMid) {
        this.camera.x -= (middle.x - this.lastPinchMid.x) / this.camera.scale;
        this.camera.y -= (middle.y - this.lastPinchMid.y) / this.camera.scale;
      }
      this.pinchDistance = distance;
      this.lastPinchMid = middle;
    } else if (pointer.moved) {
      this.camera.x -= (pos.x - previous.x) / this.camera.scale;
      this.camera.y -= (pos.y - previous.y) / this.camera.scale;
    }
    if (pointer.moved || this.pointers.size > 1) {
      this.setHovered(null);
      this.requestDraw();
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId);
    const pos = this.pointerPosition(event);
    this.pointers.delete(event.pointerId);
    if (this.surface.nativeElement.hasPointerCapture(event.pointerId)) this.surface.nativeElement.releasePointerCapture(event.pointerId);
    if (pointer && !pointer.moved && !this.pointers.size) {
      const node = this.hitTest(pos.x, pos.y);
      if (node) this.selectNode(node.id);
    }
    if (this.pointers.size < 2) { this.pinchDistance = 0; this.lastPinchMid = null; }
    if (event.pointerType === 'mouse') this.setHovered(this.hitTest(pos.x, pos.y)?.id ?? null);
  }

  private onPointerCancel(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    this.pinchDistance = 0;
    this.lastPinchMid = null;
  }

  private setHovered(id: string | null): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.surface.nativeElement.style.cursor = id ? 'pointer' : 'grab';
    this.clearPreview();
    if (id) {
      this.previewTimer = setTimeout(() => {
        const node = this.nodeById.get(id);
        const index = this.nodeIndex.get(id);
        const point = index === undefined ? null : this.projected[index];
        if (!node || !point || this.hoveredId !== id) return;
        this.zone.run(() => {
          this.preview = node;
          this.previewIndex = String((index ?? 0) + 1).padStart(4, '0');
          this.previewX = Math.max(12, Math.min(this.width - 276, point.x + 20));
          this.previewY = Math.max(12, Math.min(this.height - 200, point.y - 88));
          this.cdr.markForCheck();
        });
      }, 160);
    }
    this.requestDraw();
  }

  private clearPreview(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
    if (this.preview) this.zone.run(() => { this.preview = null; this.cdr.markForCheck(); });
  }

  private hitTest(x: number, y: number): NetworkNode | null {
    for (let i = this.labelHits.length - 1; i >= 0; i--) {
      const hit = this.labelHits[i];
      if (x >= hit.rect.x && x <= hit.rect.x + hit.rect.w && y >= hit.rect.y && y <= hit.rect.y + hit.rect.h) return hit.node;
    }
    const gx = Math.floor(x / 28), gy = Math.floor(y / 28);
    let closest: NetworkNode | null = null;
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const index of this.hitGrid.get(`${gx + dx}:${gy + dy}`) ?? []) {
        const point = this.projected[index];
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < Math.max(7, point.radius + 4) && distance < best) { best = distance; closest = point.node; }
      }
    }
    return closest;
  }

  private nearestCenter(): NetworkNode | null {
    let candidate: NetworkNode | null = null;
    let distance = Infinity;
    for (const point of this.projected) {
      const next = Math.hypot(point.x - this.width / 2, point.y - this.height / 2);
      if (next < distance) { distance = next; candidate = point.node; }
    }
    return candidate;
  }

  private requestDraw(): void {
    if (!this.initialized || this.destroyed || this.frame) return;
    this.zone.runOutsideAngular(() => {
      this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
    });
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx || !this.width || !this.height) return;
    const width = this.width, height = this.height;
    const zoom = this.camera.scale / this.fittedCamera.scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0e0e0d';
    ctx.fillRect(0, 0, width, height);
    this.projected = this.nodes.map(node => ({
      node,
      x: (node.x - this.camera.x) * this.camera.scale + width / 2,
      y: (node.y - this.camera.y) * this.camera.scale + height / 2,
      radius: Math.min(4.1, .85 + Math.sqrt(Math.max(0, node.degree)) * .1 + Math.max(0, Math.log2(zoom)) * .22),
    }));
    this.hitGrid.clear();
    for (let i = 0; i < this.projected.length; i++) {
      const point = this.projected[i];
      if (!this.inView(point, 20)) continue;
      const key = `${Math.floor(point.x / 28)}:${Math.floor(point.y / 28)}`;
      if (!this.hitGrid.has(key)) this.hitGrid.set(key, []);
      this.hitGrid.get(key)!.push(i);
    }
    const highlighted = this.hoveredId ?? this.activeId;
    const neighbors = highlighted ? this.adjacency.get(highlighted) : null;

    // All actual edges remain present. Analytical evidence is dashed at every camera scale.
    // Two batched paths preserve the distinction without one draw call per edge.
    for (const analytical of [false, true]) {
      ctx.strokeStyle = highlighted ? 'rgba(176,124,88,.17)' : 'rgba(176,124,88,.24)';
      ctx.lineWidth = zoom > 2 ? .65 : .5;
      ctx.setLineDash(analytical ? [2.5, 3] : []);
      ctx.beginPath();
      for (const edge of this.resolvedEdges) {
        if (edge.analytical !== analytical) continue;
        const a = this.projected[edge.source], b = this.projected[edge.target];
        if (this.edgeOffscreen(a, b)) continue;
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (highlighted) {
      for (const analytical of [false, true]) {
        ctx.strokeStyle = analytical ? 'rgba(239,198,156,.72)' : 'rgba(239,198,156,.9)';
        ctx.lineWidth = analytical ? .9 : 1.15;
        ctx.setLineDash(analytical ? [3, 3] : []);
        ctx.beginPath();
        for (const edge of this.resolvedEdges) {
          if (edge.analytical !== analytical) continue;
          const a = this.projected[edge.source], b = this.projected[edge.target];
          if (a.node.id !== highlighted && b.node.id !== highlighted) continue;
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    ctx.fillStyle = '#d8c7ab';
    ctx.beginPath();
    for (const point of this.projected) {
      if (!this.inView(point, 5)) continue;
      ctx.moveTo(point.x + point.radius, point.y);
      ctx.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
    }
    ctx.fill();
    if (neighbors) {
      ctx.fillStyle = '#f0dfc7';
      ctx.beginPath();
      for (const point of this.projected) {
        if (!neighbors.has(point.node.id) || !this.inView(point, 8)) continue;
        const radius = point.radius + .9;
        ctx.moveTo(point.x + radius, point.y); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    if (highlighted) {
      const index = this.nodeIndex.get(highlighted);
      const point = index === undefined ? null : this.projected[index];
      if (point) {
        ctx.fillStyle = '#efc69c'; ctx.strokeStyle = '#100f0d'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(point.x, point.y, point.radius + 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#100f0d'; ctx.beginPath(); ctx.arc(point.x, point.y, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    this.drawLabels(ctx, zoom, highlighted, neighbors);
  }

  private inView(point: Position, margin: number): boolean {
    return Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= -margin && point.y >= -margin && point.x <= this.width + margin && point.y <= this.height + margin;
  }

  private edgeOffscreen(a: Position, b: Position): boolean {
    return (a.x < 0 && b.x < 0) || (a.y < 0 && b.y < 0) || (a.x > this.width && b.x > this.width) || (a.y > this.height && b.y > this.height);
  }

  private drawLabels(ctx: CanvasRenderingContext2D, zoom: number, highlighted: string | null, neighbors: Set<string> | undefined | null): void {
    this.labelHits = [];
    const areaLimit = Math.max(5, Math.floor(this.width * this.height / 14500));
    const limit = Math.min(areaLimit, Math.round(18 + Math.max(0, Math.log2(zoom)) * 23));
    const fontSize = zoom > 2.3 ? 12 : 11;
    ctx.font = `${fontSize}px 'IBM Plex Mono', 'Courier New', monospace`;
    ctx.textBaseline = 'middle';
    const ids = new Set<string>();
    const candidates: NetworkNode[] = [];
    const add = (node: NetworkNode | undefined) => { if (node && !ids.has(node.id)) { ids.add(node.id); candidates.push(node); } };
    if (highlighted) add(this.nodeById.get(highlighted));
    if (zoom > 1.8 && neighbors) for (const node of this.orderedNodes) if (neighbors.has(node.id)) add(node);
    for (const node of this.orderedNodes) add(node);
    const occupied: LabelRect[] = [];
    for (const node of candidates) {
      if (this.labelHits.length >= limit) break;
      const index = this.nodeIndex.get(node.id);
      const point = index === undefined ? null : this.projected[index];
      if (!point || !this.inView(point, -12)) continue;
      const selected = node.id === highlighted;
      const text = this.truncate(node.label, zoom > 2 ? 38 : 27);
      const textWidth = ctx.measureText(text).width;
      const rect: LabelRect = { x: point.x + point.radius + 5, y: point.y - 9, w: textWidth + 9, h: 18 };
      if (rect.x + rect.w > this.width - 12) rect.x = point.x - point.radius - rect.w - 5;
      if (rect.x < 10 || rect.x + rect.w > this.width - 8) continue;
      if (!selected && occupied.some(other => rect.x < other.x + other.w + 8 && rect.x + rect.w + 8 > other.x && rect.y < other.y + other.h + 6 && rect.y + rect.h + 6 > other.y)) continue;
      occupied.push(rect);
      ctx.fillStyle = selected ? '#efc69c' : 'rgba(14,14,13,.92)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.fillStyle = selected ? '#100f0d' : neighbors?.has(node.id) ? '#efc69c' : '#d8c7ab';
      ctx.fillText(text, rect.x + 4, point.y + .5);
      this.labelHits.push({ node, rect });
    }
  }

  private truncate(text: string, length: number): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length <= length ? normalized : `${normalized.slice(0, length - 1)}…`;
  }
}
