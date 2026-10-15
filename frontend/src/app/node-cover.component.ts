import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, Input, NgZone,
  OnChanges, OnDestroy, ViewChild,
} from '@angular/core';
import { getCoverTheme, paintCover } from './cover-art';

export interface NodeCoverNode {
  id: string; label: string; type: string; degree: number; x: number; y: number;
}
export interface NodeCoverEdge { source: string; target: string; analytical: boolean; }

/** A generative ASCII cover with a separately labelled, factual ego-network inset. */
@Component({
  selector: 'app-node-cover', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<canvas #surface aria-hidden="true"></canvas>',
  styles: `
    :host { display:block; position:relative; width:100%; height:100%; min-height:300px; overflow:hidden; background:#090d10; }
    canvas { display:block; width:100%; height:100%; min-height:300px; }
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

  constructor(private readonly zone: NgZone) {}

  ngOnChanges(): void { this.buildEgo(); this.draw(); }

  ngAfterViewInit(): void {
    this.ctx = this.surface.nativeElement.getContext('2d');
    this.zone.runOutsideAngular(() => {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.surface.nativeElement);
      this.resize();
    });
  }

  ngOnDestroy(): void { this.observer?.disconnect(); }

  private buildEgo(): void {
    if (!this.node) { this.egoNodes = []; this.egoEdges = []; return; }
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
    canvas.width = Math.round(this.width * ratio); canvas.height = Math.round(this.height * ratio);
    this.ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    const { width, height } = this;
    if (!ctx || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#090d10'; ctx.fillRect(0, 0, width, height);
    if (!this.node) return;
    paintCover(ctx, this.node, {
      width, height, serial: this.nodes.findIndex(node => node.id === this.node?.id) + 1,
      neighbors: this.egoNodes.filter(node => node.id !== this.node?.id), origin: this.node, detail: 'full',
    });
    this.drawTopologyInset(ctx, width, height);
  }

  private drawTopologyInset(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.node || !this.egoNodes.length) return;
    const theme = getCoverTheme(this.node);
    const insetW = Math.max(112, Math.min(160, width * .3));
    const insetH = Math.min(88, height * .2);
    const left = width - insetW - 20, top = height - insetH - 52;
    const valid = this.egoNodes.filter(node => Number.isFinite(node.x) && Number.isFinite(node.y));
    if (!valid.length) return;
    const minX = Math.min(...valid.map(node => node.x)), maxX = Math.max(...valid.map(node => node.x));
    const minY = Math.min(...valid.map(node => node.y)), maxY = Math.max(...valid.map(node => node.y));
    const scale = Math.min((insetW - 22) / Math.max(1, maxX - minX), (insetH - 31) / Math.max(1, maxY - minY));
    const points = new Map(valid.map(node => [node.id, {
      x: left + insetW / 2 + (node.x - (minX + maxX) / 2) * scale,
      y: top + (insetH + 17) / 2 + (node.y - (minY + maxY) / 2) * scale,
    }]));
    ctx.save();
    ctx.fillStyle = theme.paper; ctx.globalAlpha = .96; ctx.fillRect(left, top, insetW, insetH);
    ctx.globalAlpha = 1; ctx.strokeStyle = theme.rule; ctx.lineWidth = .6;
    ctx.strokeRect(left + .5, top + .5, insetW - 1, insetH - 1);
    ctx.fillStyle = theme.accent; ctx.font = '6px "Cascadia Code", Consolas, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('ЛОКАЛЬНЫЕ СВЯЗИ', left + 8, top + 7);
    for (const edge of this.egoEdges) {
      const a = points.get(edge.source), b = points.get(edge.target);
      if (!a || !b) continue;
      ctx.globalAlpha = .4;
      ctx.setLineDash(edge.analytical ? [1.5, 2] : []);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    for (const node of valid) {
      const point = points.get(node.id)!;
      ctx.fillStyle = node.id === this.node.id ? theme.ink : theme.accent;
      ctx.beginPath(); ctx.arc(point.x, point.y, node.id === this.node.id ? 2.2 : 1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}
