import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef,
  EventEmitter, HostBinding, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild,
} from '@angular/core';

export interface NetworkNode { id: string; type: string; label: string; x: number; y: number; degree: number; }
export interface NetworkEdge { source: string; target: string; analytical: boolean; }
interface Camera { x: number; y: number; scale: number; }
interface Position { x: number; y: number; }
interface ProjectedNode extends Position { node: NetworkNode; index: number; w: number; h: number; heat: number; }
interface ResolvedEdge { source: number; target: number; analytical: boolean; }
interface PointerState extends Position { startX: number; startY: number; moved: boolean; }
interface AccessibleCover { id: string; label: string; x: number; y: number; w: number; h: number; }
interface CoverTheme { paper: string; ink: string; accent: string; rule: string; }

const COVER_WIDTH = 168;
const COVER_HEIGHT = 224;
const THEMES: CoverTheme[] = [
  { paper: '#171612', ink: '#eee0c7', accent: '#bd8057', rule: '#7c5d45' },
  { paper: '#c9b79a', ink: '#221c15', accent: '#5c3b27', rule: '#75634d' },
  { paper: '#50372a', ink: '#ebd5b8', accent: '#d19e70', rule: '#967151' },
  { paper: '#111211', ink: '#d1bfa5', accent: '#9e7253', rule: '#6d6455' },
  { paper: '#dfceb2', ink: '#30251c', accent: '#8d4f31', rule: '#aa8f6f' },
  { paper: '#29231c', ink: '#e0c8a9', accent: '#b98761', rule: '#806449' },
];

/** Every supplied graph node is a magazine cover in the same continuous graph plane. */
@Component({
  selector: 'app-network', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    tabindex: '0', role: 'region',
    'aria-label': 'Карта журналов. Перемещайте карту, открывайте обложки. Стрелки — перемещение, плюс и минус — масштаб, ноль — вся сеть. Tab — видимые обложки. Поиск всех материалов: Ctrl K.',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    <canvas #surface aria-hidden="true"></canvas>
    <div class="accessible-covers" aria-label="Материалы в видимой области">
      @for (cover of accessibleCovers; track cover.id) {
        <button class="cover-keyboard-target" [style.left.px]="cover.x" [style.top.px]="cover.y"
          [style.width.px]="cover.w" [style.height.px]="cover.h"
          [attr.aria-label]="cover.label" (focus)="focusCover(cover.id)" (blur)="blurCover()"
          (click)="selectNode(cover.id)"></button>
      }
    </div>
    <span class="network-status" aria-live="polite">{{ status }}</span>
  `,
  styles: `
    :host { display: block; position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden; background: #0e0e0d; outline: none; }
    :host:focus-visible { box-shadow: inset 0 0 0 1px #b07c58; }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: grab; }
    canvas:active { cursor: grabbing; }
    .accessible-covers { position: absolute; inset: 0; pointer-events: none; }
    .cover-keyboard-target { position: absolute; display: block; padding: 0; border: 0; border-radius: 0; opacity: 0; background: transparent; pointer-events: none; }
    .cover-keyboard-target:focus-visible { opacity: 1; outline: 2px solid #efc69c; outline-offset: 5px; box-shadow: 0 0 24px #efc69c33; }
    .network-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  `,
})
export class NetworkComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() nodes: NetworkNode[] = [];
  @Input() edges: NetworkEdge[] = [];
  @Input() activeId: string | null = null;
  @Input() focusId: string | null = null;
  @Input() motionPaused = false;
  @Input() zoomAction: { kind: 'in' | 'out' | 'fit'; seq: number } | null = null;
  @Output() nodeSelect = new EventEmitter<string>();
  @Output() viewportChange = new EventEmitter<{ zoom: number }>();
  @HostBinding('attr.data-node-count') get nodeCount(): number { return this.nodes.length; }
  @HostBinding('attr.data-edge-count') get edgeCount(): number { return this.edges.length; }
  @HostBinding('attr.data-cover-count') get coverCount(): number { return this.nodes.length; }
  @HostBinding('attr.data-visible-cover-count') visibleCoverCount = 0;
  @HostBinding('attr.data-camera-scale') cameraScale = 1;
  @HostBinding('attr.data-motion') motionState = 'running';
  @ViewChild('surface', { static: true }) private surface!: ElementRef<HTMLCanvasElement>;
  accessibleCovers: AccessibleCover[] = [];
  status = '';

  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private cleanup: (() => void)[] = [];
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private lastFrameTime = 0;
  private motionTime = 0;
  private lastDomUpdate = 0;
  private initialized = false;
  private started = false;
  private destroyed = false;
  private reducedMotion = false;
  private camera: Camera = { x: 0, y: 0, scale: .9 };
  private targetCamera: Camera = { x: 0, y: 0, scale: .9 };
  private fittedCamera: Camera = { x: 0, y: 0, scale: .04 };
  private orderedNodes: NetworkNode[] = [];
  private nodeById = new Map<string, NetworkNode>();
  private nodeIndex = new Map<string, number>();
  private resolvedEdges: ResolvedEdge[] = [];
  private adjacency = new Map<string, Set<string>>();
  private projected: ProjectedNode[] = [];
  private visible: ProjectedNode[] = [];
  private hoveredId: string | null = null;
  private keyboardId: string | null = null;
  private hoverHeat = new Map<string, number>();
  private pointers = new Map<number, PointerState>();
  private pinchDistance = 0;
  private lastPinchMid: Position | null = null;
  private lastZoom = -1;
  private textures = new Map<string, HTMLCanvasElement>();
  private titleLayouts = new Map<string, { lines: string[]; size: number; lineHeight: number }>();

  constructor(private readonly zone: NgZone, private readonly cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    const canvas = this.surface.nativeElement;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.initialized = true;
    this.rebuildGraph();
    this.zone.runOutsideAngular(() => {
      this.listen(canvas, 'wheel', e => this.onWheel(e as WheelEvent), { passive: false });
      this.listen(canvas, 'pointerdown', e => this.onPointerDown(e as PointerEvent));
      this.listen(canvas, 'pointermove', e => this.onPointerMove(e as PointerEvent));
      this.listen(canvas, 'pointerup', e => this.onPointerUp(e as PointerEvent));
      this.listen(canvas, 'pointercancel', e => this.onPointerCancel(e as PointerEvent));
      this.listen(canvas, 'pointerleave', () => { if (!this.pointers.size) this.setHovered(null); });
      this.listen(document, 'visibilitychange', () => {
        this.lastFrameTime = 0;
        this.updateMotionState();
        if (!document.hidden) this.requestDraw();
      });
      const media = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = media.matches;
      const changed = () => { this.reducedMotion = media.matches; this.updateMotionState(); this.requestDraw(); };
      media.addEventListener('change', changed);
      this.cleanup.push(() => media.removeEventListener('change', changed));
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.updateMotionState();
      this.resize();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized) return;
    if (changes['nodes'] || changes['edges']) this.rebuildGraph();
    if (changes['focusId'] && this.focusId) this.focusNode(this.focusId);
    if (changes['zoomAction'] && this.zoomAction) {
      if (this.zoomAction.kind === 'fit') this.fit(true);
      else this.zoomAt(this.width / 2, this.height / 2, this.zoomAction.kind === 'in' ? 1.35 : 1 / 1.35);
    }
    if (changes['motionPaused']) { this.lastFrameTime = 0; this.updateMotionState(); }
    this.requestDraw();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.cleanup.forEach(fn => fn());
    cancelAnimationFrame(this.frame);
    this.textures.clear();
  }

  typeLabel(type: string): string {
    const labels: Record<string, string> = {
      book: 'Книга', theme: 'Тема', construct: 'Понятие', thinker: 'Автор', experiment: 'Эпизод',
      code: 'Тематический код', proposition: 'Тезис', chain_step: 'Аргумент', trajectory_stage: 'Стадия понятия',
      work: 'Работа', citation: 'Библиография', concept: 'Концепт', author: 'Автор', idea: 'Идея', quote: 'Цитата',
    };
    return labels[type] ?? type;
  }

  private connectionCount(value: number): string {
    const n = Math.abs(value) % 100, last = n % 10;
    const label = n > 10 && n < 20 ? 'связей' : last === 1 ? 'связь' : last >= 2 && last <= 4 ? 'связи' : 'связей';
    return `${value} ${label}`;
  }

  selectNode(id: string): void { this.zone.run(() => this.nodeSelect.emit(id)); }
  focusCover(id: string): void { this.keyboardId = id; this.setHovered(id); }
  blurCover(): void { this.keyboardId = null; this.setHovered(null); }

  onKeydown(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    const distance = (event.shiftKey ? 210 : 90) / this.targetCamera.scale;
    const pans: Record<string, Position> = {
      ArrowLeft: { x: -distance, y: 0 }, ArrowRight: { x: distance, y: 0 },
      ArrowUp: { x: 0, y: -distance }, ArrowDown: { x: 0, y: distance },
    };
    if (pans[event.key]) {
      event.preventDefault();
      this.targetCamera.x += pans[event.key].x;
      this.targetCamera.y += pans[event.key].y;
      this.setHovered(null);
      this.requestDraw();
    } else if (['+', '=', '-', '_', '0', 'Enter', 'Escape'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') this.fit(true);
      else if (event.key === 'Enter') {
        const id = this.keyboardId ?? this.hoveredId ?? this.activeId ?? this.nearestCenter()?.id;
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
    this.textures.clear();
    this.titleLayouts.clear();
    for (const edge of this.edges) {
      const source = this.nodeIndex.get(edge.source), target = this.nodeIndex.get(edge.target);
      if (source === undefined || target === undefined) continue;
      this.resolvedEdges.push({ source, target, analytical: edge.analytical });
      if (!this.adjacency.has(edge.source)) this.adjacency.set(edge.source, new Set());
      if (!this.adjacency.has(edge.target)) this.adjacency.set(edge.target, new Set());
      this.adjacency.get(edge.source)!.add(edge.target);
      this.adjacency.get(edge.target)!.add(edge.source);
    }
    if (this.hoveredId && !this.nodeById.has(this.hoveredId)) this.setHovered(null);
    this.updateFitCamera();
    if (!this.started) this.startReadingView();
    this.requestDraw();
  }

  private resize(): void {
    const rect = this.surface.nativeElement.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const wasAtFit = this.started && Math.abs(this.targetCamera.scale / this.fittedCamera.scale - 1) < .02;
    this.width = rect.width; this.height = rect.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.surface.nativeElement.width = Math.round(this.width * this.dpr);
    this.surface.nativeElement.height = Math.round(this.height * this.dpr);
    this.updateFitCamera();
    if (!this.started) this.startReadingView();
    else if (wasAtFit) this.fit(false);
    this.requestDraw();
  }

  /** Return to a dense, central reading neighborhood, independently of article selection. */
  readMap(): void {
    this.startReadingView(true, false);
    this.setHovered(null);
    this.status = 'Центральная область карты. Открывайте обложки и переходите по связям.';
  }

  private startReadingView(animate = false, useFocus = true): void {
    if (!this.nodes.length || !this.width || !this.height) return;
    const preferred = useFocus && this.focusId ? this.nodeById.get(this.focusId) : null;
    const centerX = this.fittedCamera.x, centerY = this.fittedCamera.y;
    // Choose a real, connected editorial entry point near the corpus center.
    const anchor = preferred ?? [...this.orderedNodes].filter(n => n.type === 'theme' || n.type === 'construct')
      .sort((a, b) => Math.hypot(a.x - centerX, a.y - centerY) - Math.hypot(b.x - centerX, b.y - centerY))[0] ?? this.orderedNodes[0];
    const scale = Math.max(.64, Math.min(.95, this.height / 790, this.width / 1200));
    this.started = true;
    this.moveCamera({ x: anchor.x - this.width * .035 / scale, y: anchor.y, scale }, animate);
  }

  private updateFitCamera(): void {
    if (!this.nodes.length || !this.width || !this.height) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const node of this.nodes) {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
      minX = Math.min(minX, node.x - COVER_WIDTH / 2 - 6); maxX = Math.max(maxX, node.x + COVER_WIDTH / 2 + 6);
      minY = Math.min(minY, node.y - COVER_HEIGHT / 2 - 6); maxY = Math.max(maxY, node.y + COVER_HEIGHT / 2 + 6);
    }
    if (!Number.isFinite(minX)) return;
    const padX = Math.min(70, this.width * .05), padY = Math.min(55, this.height * .07);
    this.fittedCamera = {
      x: (minX + maxX) / 2, y: (minY + maxY) / 2,
      scale: Math.min((this.width - padX * 2) / Math.max(1, maxX - minX), (this.height - padY * 2) / Math.max(1, maxY - minY)),
    };
  }

  private fit(animate: boolean): void {
    if (!this.nodes.length || !this.width || !this.height) return;
    this.updateFitCamera();
    this.moveCamera({ ...this.fittedCamera }, animate);
    this.setHovered(null);
  }

  focusNode(id: string): void {
    const node = this.nodeById.get(id);
    if (!node || !this.width || !this.height) return;
    const scale = Math.max(.95, Math.min(1.3, this.height / 570));
    this.moveCamera({ x: node.x, y: node.y, scale }, true);
    this.status = `${node.label}. ${this.connectionCount(node.degree)}. Нажмите Enter, чтобы открыть материал.`;
    this.setHovered(null);
  }

  private moveCamera(target: Camera, animate: boolean): void {
    this.targetCamera = { ...target };
    if (!animate || this.reducedMotion) this.camera = { ...target };
    this.emitViewport(); this.requestDraw();
  }

  private zoomAt(x: number, y: number, factor: number): void {
    const previousScale = this.targetCamera.scale;
    const nextScale = Math.min(2.4, Math.max(this.fittedCamera.scale * .4, previousScale * factor));
    this.targetCamera.x += (x - this.width / 2) * (1 / previousScale - 1 / nextScale);
    this.targetCamera.y += (y - this.height / 2) * (1 / previousScale - 1 / nextScale);
    this.targetCamera.scale = nextScale;
    if (this.reducedMotion || this.pointers.size > 1) this.camera = { ...this.targetCamera };
    this.setHovered(null); this.requestDraw();
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
    this.zoomAt(pos.x, pos.y, Math.exp(-Math.max(-160, Math.min(160, delta)) * .0019));
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const pos = this.pointerPosition(event);
    (this.surface.nativeElement.parentElement as HTMLElement)?.focus({ preventScroll: true });
    this.surface.nativeElement.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { ...pos, startX: pos.x, startY: pos.y, moved: false });
    if (this.pointers.size > 1) { for (const pointer of this.pointers.values()) pointer.moved = true; this.beginPinch(); }
  }

  private beginPinch(): void {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    this.lastPinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private onPointerMove(event: PointerEvent): void {
    const pos = this.pointerPosition(event), pointer = this.pointers.get(event.pointerId);
    if (!pointer) { if (!this.keyboardId) this.setHovered(this.hitTest(pos.x, pos.y)?.id ?? null); return; }
    const previous = { x: pointer.x, y: pointer.y };
    pointer.x = pos.x; pointer.y = pos.y;
    if (Math.hypot(pos.x - pointer.startX, pos.y - pointer.startY) > 4) pointer.moved = true;
    if (this.pointers.size > 1) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y), middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.pinchDistance > 0) this.zoomAt(middle.x, middle.y, distance / this.pinchDistance);
      if (this.lastPinchMid) {
        this.targetCamera.x -= (middle.x - this.lastPinchMid.x) / this.targetCamera.scale;
        this.targetCamera.y -= (middle.y - this.lastPinchMid.y) / this.targetCamera.scale;
        this.camera = { ...this.targetCamera };
      }
      this.pinchDistance = distance; this.lastPinchMid = middle;
    } else if (pointer.moved) {
      this.targetCamera.x -= (pos.x - previous.x) / this.targetCamera.scale;
      this.targetCamera.y -= (pos.y - previous.y) / this.targetCamera.scale;
      // Follow the pointer directly while dragging; the release retains a small soft tail.
      this.camera.x += (this.targetCamera.x - this.camera.x) * .78;
      this.camera.y += (this.targetCamera.y - this.camera.y) * .78;
    }
    if (pointer.moved || this.pointers.size > 1) { this.setHovered(null); this.requestDraw(); }
  }

  private onPointerUp(event: PointerEvent): void {
    const pointer = this.pointers.get(event.pointerId), pos = this.pointerPosition(event);
    this.pointers.delete(event.pointerId);
    if (this.surface.nativeElement.hasPointerCapture(event.pointerId)) this.surface.nativeElement.releasePointerCapture(event.pointerId);
    if (pointer && !pointer.moved && !this.pointers.size) { const node = this.hitTest(pos.x, pos.y); if (node) this.selectNode(node.id); }
    if (this.pointers.size < 2) { this.pinchDistance = 0; this.lastPinchMid = null; }
    if (event.pointerType === 'mouse') this.setHovered(this.hitTest(pos.x, pos.y)?.id ?? null);
    this.requestDraw();
  }

  private onPointerCancel(event: PointerEvent): void { this.pointers.delete(event.pointerId); this.pinchDistance = 0; this.lastPinchMid = null; }
  private setHovered(id: string | null): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    if (id && !this.hoverHeat.has(id)) this.hoverHeat.set(id, 0);
    this.surface.nativeElement.style.cursor = id ? 'pointer' : 'grab';
    this.requestDraw();
  }

  private hitTest(x: number, y: number): NetworkNode | null {
    // Rectangles, rather than decorative point targets: every visible cover is clickable.
    for (let i = this.visible.length - 1; i >= 0; i--) {
      const p = this.visible[i];
      if (Math.abs(x - p.x) <= Math.max(3, p.w / 2) && Math.abs(y - p.y) <= Math.max(4, p.h / 2)) return p.node;
    }
    return null;
  }

  private nearestCenter(): NetworkNode | null {
    let candidate: NetworkNode | null = null, distance = Infinity;
    for (const p of this.visible) {
      const next = Math.hypot(p.x - this.width / 2, p.y - this.height / 2);
      if (next < distance) { distance = next; candidate = p.node; }
    }
    return candidate;
  }

  private updateMotionState(): void {
    this.motionState = this.reducedMotion ? 'reduced' : document.hidden ? 'hidden' : this.motionPaused ? 'paused' : 'running';
    this.zone.run(() => this.cdr.markForCheck());
  }

  private requestDraw(): void {
    if (!this.initialized || this.destroyed || this.frame || document.hidden) return;
    this.zone.runOutsideAngular(() => { this.frame = requestAnimationFrame(now => { this.frame = 0; this.draw(now); }); });
  }

  private draw(now: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.width || !this.height || document.hidden) return;
    const dt = this.lastFrameTime ? Math.min(50, now - this.lastFrameTime) : 16;
    this.lastFrameTime = now;
    const ambient = !this.reducedMotion && !this.motionPaused;
    if (ambient) this.motionTime += dt;
    const ease = this.reducedMotion ? 1 : 1 - Math.exp(-dt / 105);
    const cameraMoving = Math.abs(this.camera.x - this.targetCamera.x) * this.camera.scale > .015
      || Math.abs(this.camera.y - this.targetCamera.y) * this.camera.scale > .015 || Math.abs(Math.log(this.camera.scale / this.targetCamera.scale)) > .00015;
    if (cameraMoving) {
      this.camera.x += (this.targetCamera.x - this.camera.x) * ease;
      this.camera.y += (this.targetCamera.y - this.camera.y) * ease;
      this.camera.scale = Math.exp(Math.log(this.camera.scale) + (Math.log(this.targetCamera.scale) - Math.log(this.camera.scale)) * ease);
      this.emitViewport();
    } else this.camera = { ...this.targetCamera };
    let hoverMoving = false;
    for (const [id, heat] of this.hoverHeat) {
      const target = id === this.hoveredId ? 1 : 0;
      const next = this.reducedMotion ? target : heat + (target - heat) * (1 - Math.exp(-dt / 150));
      if (Math.abs(next - target) > .005) hoverMoving = true;
      if (next < .005 && target === 0) this.hoverHeat.delete(id); else this.hoverHeat.set(id, next);
    }
    const width = this.width, height = this.height, scale = this.camera.scale, time = this.motionTime * .00034;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0e0e0d'; ctx.fillRect(0, 0, width, height);
    this.projected = this.nodes.map((node, index) => {
      // A coherent, bounded wave moves existing centers; the original layout and topology remain unchanged.
      const dx = this.reducedMotion ? 0 : Math.sin(node.y * .0019 + time) * 7 + Math.sin(node.x * .0011 + time * .71) * 2.5;
      const dy = this.reducedMotion ? 0 : Math.cos(node.x * .0017 + time * .88) * 6.5 + Math.sin(node.y * .0013 + time * .64) * 2.5;
      const heat = this.hoverHeat.get(node.id) ?? 0, grow = 1 + heat * .025;
      return { node, index, x: (node.x + dx - this.camera.x) * scale + width / 2,
        y: (node.y + dy - this.camera.y) * scale + height / 2, w: COVER_WIDTH * scale * grow, h: COVER_HEIGHT * scale * grow, heat };
    });
    this.visible = this.projected.filter(p => p.x + p.w / 2 >= -3 && p.y + p.h / 2 >= -3 && p.x - p.w / 2 <= width + 3 && p.y - p.h / 2 <= height + 3);
    const highlighted = this.hoveredId ?? this.activeId, neighbors = highlighted ? this.adjacency.get(highlighted) : null;
    for (const analytical of [false, true]) {
      ctx.strokeStyle = scale > .3
        ? analytical ? 'rgba(180,132,92,.065)' : 'rgba(180,132,92,.11)'
        : analytical ? 'rgba(180,132,92,.16)' : 'rgba(180,132,92,.27)';
      ctx.lineWidth = scale < .16 ? .45 : .7;
      ctx.setLineDash(analytical ? [3.5, 4.5] : []);
      ctx.beginPath();
      for (const edge of this.resolvedEdges) {
        if (edge.analytical !== analytical) continue;
        const a = this.projected[edge.source], b = this.projected[edge.target];
        if (this.edgeOffscreen(a, b)) continue;
        this.edgePath(ctx, a, b);
      }
      ctx.stroke();
    }
    if (highlighted) {
      for (const analytical of [false, true]) {
        ctx.strokeStyle = analytical ? 'rgba(243,205,160,.66)' : 'rgba(243,205,160,.9)';
        ctx.lineWidth = analytical ? 1 : 1.3; ctx.setLineDash(analytical ? [4, 4] : []); ctx.beginPath();
        for (const edge of this.resolvedEdges) {
          if (edge.analytical !== analytical) continue;
          const a = this.projected[edge.source], b = this.projected[edge.target];
          if (a.node.id !== highlighted && b.node.id !== highlighted || this.edgeOffscreen(a, b)) continue;
          this.edgePath(ctx, a, b);
        }
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    for (const p of this.visible) if (p.node.id !== this.hoveredId) this.drawCover(ctx, p, p.node.id === this.activeId, !!neighbors?.has(p.node.id));
    const hover = this.hoveredId ? this.projected[this.nodeIndex.get(this.hoveredId) ?? -1] : null;
    if (hover && this.visible.includes(hover)) this.drawCover(ctx, hover, true, false);
    if (now - this.lastDomUpdate > 220 || !ambient && !cameraMoving && !hoverMoving) this.updateAccessibleCovers(now);
    if (ambient || cameraMoving || hoverMoving) this.requestDraw();
  }

  private edgeOffscreen(a: Position, b: Position): boolean {
    return (a.x < -100 && b.x < -100) || (a.y < -120 && b.y < -120)
      || (a.x > this.width + 100 && b.x > this.width + 100) || (a.y > this.height + 120 && b.y > this.height + 120);
  }

  private edgePath(ctx: CanvasRenderingContext2D, a: ProjectedNode, b: ProjectedNode): void {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (!dx && !dy) return;
    const from = Math.min(a.w / 2 / Math.max(.001, Math.abs(dx)), a.h / 2 / Math.max(.001, Math.abs(dy)));
    const to = Math.min(b.w / 2 / Math.max(.001, Math.abs(dx)), b.h / 2 / Math.max(.001, Math.abs(dy)));
    if (from + to >= 1) return;
    ctx.moveTo(a.x + dx * from, a.y + dy * from); ctx.lineTo(b.x - dx * to, b.y - dy * to);
  }

  private drawCover(ctx: CanvasRenderingContext2D, p: ProjectedNode, selected: boolean, neighbor: boolean): void {
    const theme = THEMES[this.hash(p.node.id) % THEMES.length], left = p.x - p.w / 2, top = p.y - p.h / 2;
    if (p.w < 37) {
      ctx.fillStyle = theme.paper; ctx.fillRect(left, top, Math.max(1, p.w), Math.max(1, p.h));
      ctx.strokeStyle = selected ? '#efc69c' : neighbor ? '#d9b087' : theme.rule; ctx.lineWidth = selected ? 1.3 : .5;
      ctx.strokeRect(left, top, Math.max(1, p.w), Math.max(1, p.h));
      if (p.w > 5) {
        ctx.fillStyle = theme.ink; ctx.globalAlpha = .65;
        ctx.fillRect(left + p.w * .1, top + p.h * .22, p.w * .73, Math.max(.6, p.h * .035));
        ctx.fillRect(left + p.w * .1, top + p.h * .29, p.w * .55, Math.max(.5, p.h * .025));
        ctx.globalAlpha = 1;
      }
      return;
    }
    if (p.heat > .01) { ctx.shadowColor = '#d89b5d44'; ctx.shadowBlur = p.heat * 18; }
    if (p.w < 86 || this.visible.length > 96) {
      // The intermediate overview can contain hundreds of magazines. Render simple
      // native typography there instead of allocating and evicting textures every frame.
      ctx.save(); ctx.translate(left, top); ctx.scale(p.w / COVER_WIDTH, p.h / COVER_HEIGHT);
      ctx.fillStyle = theme.paper; ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
      ctx.strokeStyle = theme.rule; ctx.lineWidth = .75; ctx.strokeRect(.5, .5, COVER_WIDTH - 1, COVER_HEIGHT - 1);
      ctx.fillStyle = theme.accent; ctx.textBaseline = 'top'; ctx.font = `7px 'Courier New', monospace`;
      ctx.fillText(this.typeLabel(p.node.type).toLocaleUpperCase('ru'), 12, 15);
      const layout = this.getTitleLayout(ctx, p.node);
      ctx.fillStyle = theme.ink; ctx.font = `${layout.size}px Georgia, 'Times New Roman', serif`;
      for (let i = 0; i < layout.lines.length; i++) ctx.fillText(layout.lines[i], 12, 47 + i * layout.lineHeight);
      const artTop = Math.max(120, 51 + layout.lines.length * layout.lineHeight);
      if (p.w > 59 && artTop < 194 && this.visible.length < 200) this.drawActualTopology(ctx, p.node, { x: 12, y: artTop, w: 144, h: 194 - artTop }, theme);
      ctx.fillStyle = theme.accent; ctx.font = `7px 'Courier New', monospace`;
      ctx.fillText(`№ ${String(p.index + 1).padStart(4, '0')} / ${p.node.degree}`, 12, 210);
      ctx.restore();
    } else {
      const texture = this.coverTexture(p.node, p.index);
      ctx.drawImage(texture, left, top, p.w, p.h);
    }
    ctx.shadowBlur = 0;
    if (selected || neighbor || p.heat > .01) {
      ctx.strokeStyle = selected ? '#f3cca3' : neighbor ? '#ca9e72' : `rgba(235,194,148,${p.heat})`;
      ctx.lineWidth = selected ? 1.5 : .9; ctx.strokeRect(left - 2, top - 2, p.w + 4, p.h + 4);
      if (selected) { ctx.fillStyle = '#efc69c'; ctx.fillRect(left, top - 4, Math.min(28, p.w), 2); }
    }
  }

  private coverTexture(node: NetworkNode, index: number): HTMLCanvasElement {
    const cached = this.textures.get(node.id);
    if (cached) { this.textures.delete(node.id); this.textures.set(node.id, cached); return cached; }
    const canvas = document.createElement('canvas'); canvas.width = COVER_WIDTH * 2; canvas.height = COVER_HEIGHT * 2;
    const ctx = canvas.getContext('2d')!; ctx.scale(2, 2);
    const theme = THEMES[this.hash(node.id) % THEMES.length], pad = 12;
    ctx.fillStyle = theme.paper; ctx.fillRect(0, 0, COVER_WIDTH, COVER_HEIGHT);
    ctx.strokeStyle = theme.rule; ctx.lineWidth = .65; ctx.strokeRect(.5, .5, COVER_WIDTH - 1, COVER_HEIGHT - 1);
    ctx.fillStyle = theme.ink; ctx.textBaseline = 'top';
    ctx.font = `5.7px 'IBM Plex Mono', 'Courier New', monospace`;
    ctx.fillText('АТЛАС / СВЯЗАННОЕ ИЗДАНИЕ', pad, 10);
    ctx.textAlign = 'right'; ctx.fillText(String(index + 1).padStart(4, '0'), COVER_WIDTH - pad, 10); ctx.textAlign = 'left';
    ctx.strokeStyle = theme.rule; ctx.beginPath(); ctx.moveTo(pad, 22); ctx.lineTo(COVER_WIDTH - pad, 22); ctx.stroke();
    ctx.fillStyle = theme.accent; ctx.font = `6.5px 'IBM Plex Mono', 'Courier New', monospace`;
    ctx.fillText(this.typeLabel(node.type).toLocaleUpperCase('ru'), pad, 31);
    const layout = this.getTitleLayout(ctx, node);
    ctx.fillStyle = theme.ink; ctx.font = `${layout.size}px Georgia, 'Times New Roman', serif`;
    for (let i = 0; i < layout.lines.length; i++) ctx.fillText(layout.lines[i], pad, 47 + i * layout.lineHeight);
    const artTop = Math.max(118, 51 + layout.lines.length * layout.lineHeight);
    if (artTop < 194) this.drawActualTopology(ctx, node, { x: pad, y: artTop, w: COVER_WIDTH - pad * 2, h: 194 - artTop }, theme);
    ctx.strokeStyle = theme.rule; ctx.beginPath(); ctx.moveTo(pad, 202); ctx.lineTo(COVER_WIDTH - pad, 202); ctx.stroke();
    ctx.fillStyle = theme.ink; ctx.font = `6.5px 'IBM Plex Mono', 'Courier New', monospace`;
    ctx.fillText(this.connectionCount(node.degree).toLocaleUpperCase('ru'), pad, 210); ctx.textAlign = 'right'; ctx.fillText('ЧИТАТЬ ↗', COVER_WIDTH - pad, 210);
    this.textures.set(node.id, canvas);
    // Full-resolution textures are limited to the immediate reading neighborhood.
    if (this.textures.size > 96) this.textures.delete(this.textures.keys().next().value!);
    return canvas;
  }

  private titleLayout(ctx: CanvasRenderingContext2D, title: string, width: number): { lines: string[]; size: number; lineHeight: number } {
    const text = title.replace(/\s+/g, ' ').trim();
    for (const size of [21, 19, 17, 15, 13, 11, 9, 7]) {
      ctx.font = `${size}px Georgia, 'Times New Roman', serif`;
      // Prefer a smaller coherent word over a larger title with arbitrary glyph breaks.
      // The smallest size remains a last-resort fallback for unusually long tokens.
      if (size > 7 && text.split(' ').some(word => ctx.measureText(word).width > width)) continue;
      const lines: string[] = []; let line = '';
      for (let word of text.split(' ')) {
        // Long single tokens are split by measured glyphs instead of overflowing the frame.
        while (ctx.measureText(word).width > width) {
          let cut = 1;
          while (cut < word.length && ctx.measureText(word.slice(0, cut + 1)).width <= width) cut++;
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, cut)); word = word.slice(cut);
        }
        if (ctx.measureText(line ? `${line} ${word}` : word).width <= width) line = line ? `${line} ${word}` : word;
        else { lines.push(line); line = word; }
      }
      if (line) lines.push(line);
      const lineHeight = size * 1.06;
      if (lines.length * lineHeight <= 143 || size === 7) return { lines, size, lineHeight };
    }
    return { lines: [text], size: 7, lineHeight: 8 };
  }

  private getTitleLayout(ctx: CanvasRenderingContext2D, node: NetworkNode): { lines: string[]; size: number; lineHeight: number } {
    let layout = this.titleLayouts.get(node.id);
    if (!layout) { layout = this.titleLayout(ctx, node.label, COVER_WIDTH - 24); this.titleLayouts.set(node.id, layout); }
    return layout;
  }

  private drawActualTopology(ctx: CanvasRenderingContext2D, node: NetworkNode, box: { x: number; y: number; w: number; h: number }, theme: CoverTheme): void {
    const neighbors = [...this.adjacency.get(node.id) ?? []].map(id => this.nodeById.get(id)!).filter(Boolean)
      .sort((a, b) => b.degree - a.degree).slice(0, 18);
    if (!neighbors.length) return;
    const maxX = Math.max(1, ...neighbors.map(n => Math.abs(n.x - node.x))), maxY = Math.max(1, ...neighbors.map(n => Math.abs(n.y - node.y)));
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    ctx.strokeStyle = theme.accent; ctx.lineWidth = .65; ctx.globalAlpha = .8; ctx.beginPath();
    for (const neighbor of neighbors) {
      const x = cx + (neighbor.x - node.x) / maxX * (box.w / 2 - 9), y = cy + (neighbor.y - node.y) / maxY * (box.h / 2 - 4);
      ctx.moveTo(cx, cy); ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.fillStyle = theme.accent;
    for (const neighbor of neighbors) {
      const x = cx + (neighbor.x - node.x) / maxX * (box.w / 2 - 9), y = cy + (neighbor.y - node.y) / maxY * (box.h / 2 - 4);
      ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = theme.ink; ctx.lineWidth = .8; ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  private updateAccessibleCovers(now: number): void {
    this.lastDomUpdate = now;
    const eligible = this.visible.filter(p => p.w > 40 && p.x > 0 && p.x < this.width && p.y > 0 && p.y < this.height)
      .sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 48);
    const next = eligible.map(p => ({ id: p.node.id, label: `${this.typeLabel(p.node.type)}. ${p.node.label}. ${this.connectionCount(p.node.degree)}. Открыть материал.`, x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h }));
    this.zone.run(() => {
      this.accessibleCovers = next; this.visibleCoverCount = this.visible.length;
      this.cameraScale = Math.round(this.camera.scale * 10000) / 10000;
      this.cdr.markForCheck();
    });
  }

  private hash(value: string): number {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) { result ^= value.charCodeAt(i); result = Math.imul(result, 16777619); }
    return result >>> 0;
  }
}
