import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  ViewChild,
} from '@angular/core';

export interface NodeCoverNode {
  id: string;
  label: string;
  type: string;
  degree: number;
  x: number;
  y: number;
}

export interface NodeCoverEdge {
  source: string;
  target: string;
  analytical: boolean;
}

interface CoverPoint {
  node: NodeCoverNode;
  x: number;
  y: number;
}

/** An editorial plate of the selected node's actual induced, one-hop network. */
@Component({
  selector: 'app-node-cover',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<canvas #surface aria-hidden="true"></canvas>',
  styles: `
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 300px;
      overflow: hidden;
      background: #0b0b0a;
    }
    canvas { display: block; width: 100%; height: 100%; min-height: 300px; }
  `,
})
export class NodeCoverComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() node: NodeCoverNode | null = null;
  @Input() nodes: NodeCoverNode[] = [];
  @Input() edges: NodeCoverEdge[] = [];
  @ViewChild('surface', { static: true }) private surface!: ElementRef<HTMLCanvasElement>;

  private ctx: CanvasRenderingContext2D | null = null;
  private observer?: ResizeObserver;
  private width = 0;
  private height = 0;
  private egoNodes: NodeCoverNode[] = [];
  private egoEdges: NodeCoverEdge[] = [];
  private readonly ink = '#e4deca';
  private readonly copper = '#b98c6d';
  private readonly mono = '"IBM Plex Mono", "Cascadia Code", "Courier New", monospace';

  constructor(private readonly zone: NgZone) {}

  ngOnChanges(): void {
    this.buildEgo();
    this.draw();
  }

  ngAfterViewInit(): void {
    this.ctx = this.surface.nativeElement.getContext('2d');
    this.zone.runOutsideAngular(() => {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.surface.nativeElement);
      this.resize();
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private buildEgo(): void {
    if (!this.node) {
      this.egoNodes = [];
      this.egoEdges = [];
      return;
    }
    const ids = new Set([this.node.id]);
    for (const edge of this.edges) {
      if (edge.source === this.node.id) ids.add(edge.target);
      if (edge.target === this.node.id) ids.add(edge.source);
    }
    const lookup = new Map(this.nodes.map(node => [node.id, node]));
    lookup.set(this.node.id, this.node);
    this.egoNodes = [...ids].map(id => lookup.get(id)).filter((node): node is NodeCoverNode => !!node);
    const available = new Set(this.egoNodes.map(node => node.id));
    this.egoEdges = this.edges.filter(edge => available.has(edge.source) && available.has(edge.target));
  }

  private resize(): void {
    const canvas = this.surface.nativeElement;
    const bounds = canvas.getBoundingClientRect();
    this.width = bounds.width;
    this.height = Math.max(300, bounds.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(this.width * ratio);
    canvas.height = Math.round(this.height * ratio);
    this.ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const { width: w, height: h } = this;
    if (!ctx || !w || !h) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0b0a';
    ctx.fillRect(0, 0, w, h);
    this.printTexture(ctx, w, h);
    if (!this.node) return;

    const margin = Math.max(22, Math.min(w, h) * 0.058);
    this.typePlate(ctx, w, h, margin);
    const points = this.project(w, h, margin);
    const lookup = new Map(points.map(point => [point.node.id, point]));
    const active = lookup.get(this.node.id);

    // Registration marks and the broken circle are printing furniture, never graph edges.
    this.registration(ctx, margin, margin, 6);
    this.registration(ctx, w - margin, margin, 6);
    this.registration(ctx, margin, h - margin, 6);
    this.registration(ctx, w - margin, h - margin, 6);
    if (active) this.registrationDisc(ctx, active, w, h);

    const spread = this.egoEdges.length;
    for (let index = 0; index < spread; index++) {
      const edge = this.egoEdges[index];
      const start = lookup.get(edge.source);
      const end = lookup.get(edge.target);
      if (!start || !end) continue;
      const primary = edge.source === this.node.id || edge.target === this.node.id;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy) || 1;
      const bend = Math.min(46, length * 0.16) * ((this.hash(edge.source + edge.target) % 2) ? 1 : -1);
      const mx = (start.x + end.x) / 2 - dy / length * bend;
      const my = (start.y + end.y) / 2 + dx / length * bend;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      if (edge.source === edge.target) {
        ctx.bezierCurveTo(start.x + 28, start.y - 28, start.x - 28, start.y - 28, start.x, start.y);
      } else {
        ctx.quadraticCurveTo(mx, my, end.x, end.y);
      }
      ctx.strokeStyle = primary ? 'rgba(197,153,118,.66)' : 'rgba(163,131,105,.25)';
      ctx.lineWidth = primary ? (spread > 100 ? 0.65 : 0.9) : 0.5;
      ctx.setLineDash(edge.analytical ? [2, 3] : []);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const point of points) this.nodeMark(ctx, point, point.node.id === this.node.id);
    this.labels(ctx, points, w, h, margin);
    this.colophon(ctx, w, h, margin);
  }

  /** A uniform projection preserves the real layout's relative geometry. */
  private project(w: number, h: number, margin: number): CoverPoint[] {
    if (!this.egoNodes.length) return [];
    const valid = this.egoNodes.filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
    if (!valid.length) return [];
    const xs = valid.map(node => node.x);
    const ys = valid.map(node => node.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const areaW = Math.max(1, w - margin * 3.1);
    const areaH = Math.max(1, h * 0.66);
    const scale = Math.min(spanX ? areaW / spanX : Infinity, spanY ? areaH / spanY : Infinity);
    const safeScale = Number.isFinite(scale) ? scale : 1;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    return valid.map(node => ({
      node,
      x: w * 0.51 + (node.x - centerX) * safeScale,
      y: h * 0.51 + (node.y - centerY) * safeScale,
    }));
  }

  private typePlate(ctx: CanvasRenderingContext2D, w: number, h: number, margin: number): void {
    const words = (this.node?.label || '').toLocaleUpperCase('ru').replace(/[«»"“”]/g, '').split(/\s+/);
    const lines: string[] = [];
    for (const word of words) {
      const last = lines[lines.length - 1];
      if (last && last.length + word.length < 15) lines[lines.length - 1] += ` ${word}`;
      else lines.push(word);
    }
    const displayed = lines.slice(0, 3);
    const longest = Math.max(...displayed.map(line => line.length), 5);
    const fontSize = Math.min(w * 0.21, h * 0.19, (w - margin * 1.5) / (longest * 0.57));
    ctx.save();
    ctx.fillStyle = '#24221d';
    ctx.font = `500 ${fontSize}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    ctx.textBaseline = 'top';
    displayed.forEach((line, index) => ctx.fillText(line, margin * 0.75, h * 0.16 + index * fontSize * 0.94));
    ctx.font = `9px ${this.mono}`;
    ctx.fillStyle = '#958b79';
    ctx.fillText('ATLAS / RESEARCH PLATE', margin, margin + 4);
    ctx.textAlign = 'right';
    ctx.fillStyle = this.copper;
    ctx.fillText(this.serial(this.node?.id || ''), w - margin, margin + 4);
    ctx.restore();
  }

  private registrationDisc(ctx: CanvasRenderingContext2D, active: CoverPoint, w: number, h: number): void {
    const radius = Math.min(w, h) * 0.27;
    ctx.save();
    ctx.strokeStyle = 'rgba(193,163,128,.14)';
    ctx.lineWidth = 0.6;
    ctx.setLineDash([1, 5]);
    ctx.beginPath();
    ctx.arc(active.x, active.y, radius, -0.25, Math.PI * 1.48);
    ctx.stroke();
    ctx.setLineDash([]);
    // Tiny radial ticks differ visibly from the solid, connected relationship paths.
    for (let index = 0; index < 72; index++) {
      const angle = index / 72 * Math.PI * 2;
      const inner = radius + 5;
      const outer = inner + (index % 6 === 0 ? 6 : 2);
      ctx.beginPath();
      ctx.moveTo(active.x + Math.cos(angle) * inner, active.y + Math.sin(angle) * inner);
      ctx.lineTo(active.x + Math.cos(angle) * outer, active.y + Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
  }

  private nodeMark(ctx: CanvasRenderingContext2D, point: CoverPoint, active: boolean): void {
    const radius = active ? 10 : Math.min(5.2, 1.8 + Math.log2(Math.max(1, point.node.degree)) * 0.45);
    ctx.save();
    if (active) {
      ctx.strokeStyle = this.copper;
      ctx.lineWidth = 0.7;
      ctx.strokeRect(point.x - 13, point.y - 13, 26, 26);
      ctx.fillStyle = '#0b0b0a';
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = active ? this.ink : this.copper;
    ctx.beginPath();
    ctx.arc(point.x, point.y, active ? 3 : Math.max(1, radius * 0.44), 0, Math.PI * 2);
    ctx.fill();
    // Stipple stays inside each real node's footprint; it never creates extra graph vertices.
    const count = active ? 34 : 13;
    for (let index = 0; index < count; index++) {
      const angle = index * 2.399963;
      const r = radius * Math.sqrt((index + 1) / count);
      ctx.fillRect(point.x + Math.cos(angle) * r, point.y + Math.sin(angle) * r, 0.6, 0.6);
    }
    ctx.restore();
  }

  private labels(ctx: CanvasRenderingContext2D, points: CoverPoint[], w: number, h: number, margin: number): void {
    const chosen = [...points].sort((a, b) => Number(b.node.id === this.node?.id) - Number(a.node.id === this.node?.id) || b.node.degree - a.node.degree).slice(0, 9);
    const occupied: { x: number; y: number; width: number }[] = [];
    ctx.save();
    ctx.font = `8px ${this.mono}`;
    ctx.textBaseline = 'middle';
    for (const point of chosen) {
      const isActive = point.node.id === this.node?.id;
      const value = point.node.label.length > 33 ? `${point.node.label.slice(0, 31)}…` : point.node.label;
      const textWidth = ctx.measureText(value).width;
      const x = Math.max(margin, Math.min(w - margin - textWidth, point.x + (isActive ? 19 : 9)));
      const y = Math.max(margin + 33, Math.min(h - margin - 35, point.y + (isActive ? 23 : -10)));
      if (!isActive && occupied.some(box => Math.abs(box.y - y) < 14 && x < box.x + box.width + 8 && x + textWidth + 8 > box.x)) continue;
      occupied.push({ x, y, width: textWidth });
      ctx.fillStyle = 'rgba(11,11,10,.88)';
      ctx.fillRect(x - 3, y - 7, textWidth + 6, 14);
      ctx.fillStyle = isActive ? this.ink : '#b6aa93';
      ctx.fillText(value, x, y);
    }
    ctx.restore();
  }

  private colophon(ctx: CanvasRenderingContext2D, w: number, h: number, margin: number): void {
    ctx.save();
    ctx.strokeStyle = '#4a4033';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(margin, h - margin - 26);
    ctx.lineTo(w - margin, h - margin - 26);
    ctx.stroke();
    ctx.font = `8px ${this.mono}`;
    ctx.fillStyle = this.copper;
    ctx.textBaseline = 'middle';
    ctx.fillText('ЭГО-СЕТЬ / 01', margin, h - margin - 9);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#a59a86';
    ctx.fillText(`${Math.max(0, this.egoNodes.length - 1)} СОСЕДЕЙ · ${this.egoEdges.length} СВЯЗЕЙ`, w - margin, h - margin - 9);
    ctx.restore();
  }

  private printTexture(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = 'rgba(210,190,151,.045)';
    // A regular paper raster, deliberately unlike the round graph vertex marks.
    for (let y = 2; y < h; y += 5) {
      for (let x = 2; x < w; x += 5) {
        if (((x * 17 + y * 31) % 13) < 5) ctx.fillRect(x, y, 0.45, 0.45);
      }
    }
  }

  private registration(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    ctx.save();
    ctx.strokeStyle = '#75664f';
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
    ctx.restore();
  }

  private serial(id: string): string {
    return `№ ${String(this.nodes.findIndex(node => node.id === id) + 1).padStart(4, '0')}`;
  }

  private hash(value: string): number {
    let result = 2166136261;
    for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
    return result >>> 0;
  }
}
