import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';

export interface RhizomeNode {
  id: string;
  label: string;
  type: string;
}

interface Point3 {
  x: number;
  y: number;
  z: number;
  tone: number;
  weight: number;
  glyph: string;
}

interface ScreenPoint {
  x: number;
  y: number;
  z: number;
  scale: number;
  point: Point3;
}

interface NodeTarget {
  id: string;
  x: number;
  y: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Procedural, dependency-free rhizome; labels and selection always use real input nodes. */
@Component({
  selector: 'app-rhizome',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<canvas #surface aria-hidden="true"></canvas>',
  styles: `
    :host { display: block; width: 100%; height: 100%; min-height: 310px; position: relative; }
    canvas { display: block; width: 100%; height: 100%; min-height: 310px; touch-action: pan-y; }
  `,
})
export class RhizomeComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() nodes: RhizomeNode[] = [];
  @Input() activeId: string | null = null;
  @Input() zoom = 1;
  @Input() paused = false;
  @Output() nodeSelect = new EventEmitter<string>();
  @ViewChild('surface', { static: true }) private surface!: ElementRef<HTMLCanvasElement>;

  private ctx: CanvasRenderingContext2D | null = null;
  private points: Point3[] = [];
  private edges: [number, number][] = [];
  private tips: Point3[] = [];
  private targets: NodeTarget[] = [];
  private width = 0;
  private height = 0;
  private frame = 0;
  private lastFrame = 0;
  private rotation = -0.28;
  private tilt = -0.16;
  private elapsed = 0;
  private reducedMotion = false;
  private destroyed = false;
  private hovering: string | null = null;
  private pointer: { x: number; y: number; moved: boolean; id: number } | null = null;
  private observer?: ResizeObserver;
  private cleanups: (() => void)[] = [];
  private readonly colors = ['214,250,135', '125,224,204', '237,247,229'];

  constructor(private readonly zone: NgZone) {}

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') return;
    this.ctx = this.surface.nativeElement.getContext('2d');
    if (!this.ctx) return;
    this.makeGeometry();
    this.zone.runOutsideAngular(() => {
      const media = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = media.matches;
      const motionChange = () => {
        this.reducedMotion = media.matches;
        this.lastFrame = 0;
        this.requestFrame();
      };
      media.addEventListener('change', motionChange);
      this.cleanups.push(() => media.removeEventListener('change', motionChange));
      const visibilityChange = () => {
        if (document.hidden) {
          cancelAnimationFrame(this.frame);
          this.frame = 0;
        } else {
          this.lastFrame = 0;
          this.requestFrame();
        }
      };
      document.addEventListener('visibilitychange', visibilityChange);
      this.cleanups.push(() => document.removeEventListener('visibilitychange', visibilityChange));
      this.bindPointer();
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.surface.nativeElement);
      this.resize();
    });
  }

  ngOnChanges(): void {
    this.lastFrame = 0;
    this.zone.runOutsideAngular(() => this.requestFrame());
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.cleanups.forEach((cleanup) => cleanup());
  }

  private resize(): void {
    const canvas = this.surface.nativeElement;
    const bounds = canvas.getBoundingClientRect();
    this.width = bounds.width;
    this.height = bounds.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(this.width * ratio);
    canvas.height = Math.round(this.height * ratio);
    this.ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.requestFrame();
  }

  private requestFrame(): void {
    if (!this.ctx || this.destroyed || this.frame || document.hidden || !this.width || !this.height) return;
    this.frame = requestAnimationFrame((time) => this.draw(time));
  }

  private draw(time: number): void {
    this.frame = 0;
    const context = this.ctx;
    if (!context || this.destroyed) return;
    const animate = !this.paused && !this.reducedMotion;
    if (animate && this.lastFrame && time - this.lastFrame < 32) {
      this.requestFrame();
      return;
    }
    const delta = this.lastFrame ? Math.min(time - this.lastFrame, 64) / 1000 : 0;
    this.lastFrame = time;
    if (animate && !this.pointer) {
      this.rotation += delta * 0.026;
      this.elapsed += delta;
    }
    context.clearRect(0, 0, this.width, this.height);
    this.drawAtmosphere(context);
    const projected = this.points.map((point) => this.project(point));
    this.drawFilaments(context, projected);
    this.drawParticles(context, projected);
    this.drawNodes(context);
    if (animate) this.requestFrame();
  }

  private drawAtmosphere(context: CanvasRenderingContext2D): void {
    const cx = this.width * 0.5;
    const cy = this.height * 0.49;
    const size = Math.min(this.width * 0.49, this.height * 0.68);
    const glow = context.createRadialGradient(cx, cy, size * 0.1, cx, cy, size);
    glow.addColorStop(0, 'rgba(139,186,83,0.065)');
    glow.addColorStop(0.55, 'rgba(105,151,72,0.024)');
    glow.addColorStop(1, 'rgba(105,151,72,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, this.width, this.height);

    // Quiet instrument marks frame the living structure without making it a chart.
    context.lineWidth = 0.6;
    context.strokeStyle = 'rgba(199,222,179,0.15)';
    const margin = 22;
    for (const [x, y, sx, sy] of [
      [margin, margin, 1, 1],
      [this.width - margin, margin, -1, 1],
      [margin, this.height - margin, 1, -1],
      [this.width - margin, this.height - margin, -1, -1],
    ]) {
      context.beginPath();
      context.moveTo(x + sx * 12, y);
      context.lineTo(x, y);
      context.lineTo(x, y + sy * 12);
      context.stroke();
    }
    context.font = '9px "IBM Plex Mono", "Courier New", monospace';
    context.fillStyle = 'rgba(193,216,180,0.3)';
    context.fillText('R H I Z O M E  /  LIVE STRUCTURE', margin + 20, margin + 3);
    context.textAlign = 'right';
    context.fillText('X  /  Y  /  Z', this.width - margin - 20, this.height - margin + 3);
    context.textAlign = 'left';
  }

  private project(point: Point3): ScreenPoint {
    const c = Math.cos(this.rotation);
    const s = Math.sin(this.rotation);
    const ct = Math.cos(this.tilt);
    const st = Math.sin(this.tilt);
    const x = point.x * c + point.z * s;
    const z0 = -point.x * s + point.z * c;
    const y = point.y * ct - z0 * st;
    const z = point.y * st + z0 * ct;
    const perspective = 3.8 / (3.8 + z);
    const zoom = Number.isFinite(this.zoom) ? Math.max(0.55, Math.min(1.9, this.zoom)) : 1;
    const size = Math.min(this.width * 0.35, this.height * 0.46) * zoom;
    return {
      x: this.width * 0.5 + x * size * perspective,
      y: this.height * 0.5 + y * size * perspective,
      z,
      scale: perspective,
      point,
    };
  }

  private drawFilaments(context: CanvasRenderingContext2D, points: ScreenPoint[]): void {
    context.lineWidth = 0.55;
    for (const [from, to] of this.edges) {
      const a = points[from];
      const b = points[to];
      const depth = Math.max(0.08, Math.min(1, 0.65 - (a.z + b.z) * 0.23));
      context.strokeStyle = `rgba(${this.colors[a.point.tone]},${0.075 + depth * 0.17})`;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
  }

  private drawParticles(context: CanvasRenderingContext2D, points: ScreenPoint[]): void {
    points.sort((a, b) => b.z - a.z);
    context.textBaseline = 'middle';
    context.font = '8px "IBM Plex Mono", "Courier New", monospace';
    const sparse = this.width < 500;
    for (let i = 0; i < points.length; i++) {
      if (sparse && i % 2) continue;
      const p = points[i];
      const depth = Math.max(0.12, Math.min(1, 0.68 - p.z * 0.44));
      const breathing = 0.92 + 0.08 * Math.sin(this.elapsed * 0.7 + p.point.y * 3);
      const alpha = (0.2 + depth * 0.74) * breathing;
      context.fillStyle = `rgba(${this.colors[p.point.tone]},${alpha})`;
      if (p.point.glyph && p.z < 0.38) {
        context.fillText(p.point.glyph, p.x - 2, p.y);
      } else {
        const size = (0.65 + p.point.weight * 1.05) * p.scale;
        context.fillRect(p.x, p.y, size, size);
      }
      if (p.point.weight > 0.97 && p.z < -0.3) {
        context.fillStyle = `rgba(${this.colors[p.point.tone]},0.07)`;
        context.beginPath();
        context.arc(p.x, p.y, 4.5 * p.scale, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.textBaseline = 'alphabetic';
  }

  private drawNodes(context: CanvasRenderingContext2D): void {
    this.targets = [];
    const maxNodes = this.width < 480 ? 7 : this.width < 700 ? 8 : 10;
    const visible = this.nodes.slice(0, maxNodes);
    const active = this.nodes.find((node) => node.id === this.activeId);
    if (active && !visible.some((node) => node.id === active.id)) visible[visible.length - 1] = active;
    const sideCount = Math.ceil(visible.length / 2);
    const narrow = this.width < 500;
    context.font = `${narrow ? 10 : 11}px "Cascadia Code", "Courier New", monospace`;
    visible.forEach((node, i) => {
      const right = i >= sideCount;
      const order = right ? i - sideCount : i;
      const count = right ? visible.length - sideCount : sideCount;
      const y = this.height * 0.2 + ((order + 0.5) / Math.max(count, 1)) * this.height * 0.62;
      const anchor = this.project(this.tips[(i * 3) % this.tips.length]);
      const isActive = node.id === this.activeId || node.id === this.hovering;
      const maxWidth = Math.min(narrow ? 102 : 150, this.width * 0.27);
      let label = node.label || node.id;
      while (label.length > 3 && context.measureText(label).width > maxWidth) label = label.slice(0, -2) + '…';
      const labelWidth = context.measureText(label).width;
      const x = right ? this.width - (narrow ? 25 : 34) - labelWidth : narrow ? 25 : 34;
      const lineX = right ? x - 10 : x + labelWidth + 10;
      const lineY = y - 3;

      context.lineWidth = isActive ? 0.9 : 0.6;
      context.strokeStyle = isActive ? 'rgba(214,250,135,0.72)' : 'rgba(185,214,161,0.2)';
      context.beginPath();
      context.moveTo(anchor.x, anchor.y);
      context.bezierCurveTo(anchor.x + (right ? 25 : -25), anchor.y, lineX + (right ? -24 : 24), lineY, lineX, lineY);
      context.stroke();

      context.fillStyle = isActive ? '#d6fa87' : '#9da994';
      context.fillText(label, x, y);
      context.fillStyle = isActive ? '#e1ffb2' : '#bfdc9d';
      context.beginPath();
      context.arc(anchor.x, anchor.y, isActive ? 3 : 2, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = isActive ? 'rgba(214,250,135,0.58)' : 'rgba(214,250,135,0.23)';
      context.beginPath();
      context.arc(anchor.x, anchor.y, isActive ? 8 : 5.5, 0, Math.PI * 2);
      context.stroke();
      if (isActive) {
        context.fillStyle = 'rgba(214,250,135,0.08)';
        context.fillRect(x - 6, y - 13, labelWidth + 12, 20);
      }
      this.targets.push({
        id: node.id, x: anchor.x, y: anchor.y,
        left: x - 8, top: y - 17, width: labelWidth + 16, height: 28,
      });
    });
  }

  private bindPointer(): void {
    const canvas = this.surface.nativeElement;
    const local = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const hit = (x: number, y: number) => this.targets.find((target) =>
      (x >= target.left && x <= target.left + target.width && y >= target.top && y <= target.top + target.height) ||
      Math.hypot(x - target.x, y - target.y) < 14,
    );
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const position = local(event);
      this.pointer = { ...position, moved: false, id: event.pointerId };
      if (event.pointerType === 'mouse') canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      const position = local(event);
      if (this.pointer?.id === event.pointerId && event.pointerType === 'mouse') {
        const dx = position.x - this.pointer.x;
        const dy = position.y - this.pointer.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.pointer.moved = true;
        if (this.pointer.moved) {
          this.rotation += dx * 0.005;
          this.tilt = Math.max(-0.65, Math.min(0.65, this.tilt + dy * 0.003));
          this.pointer.x = position.x;
          this.pointer.y = position.y;
          canvas.style.cursor = 'grabbing';
          this.requestFrame();
        }
      } else {
        const next = hit(position.x, position.y)?.id ?? null;
        canvas.style.cursor = next ? 'pointer' : 'grab';
        if (next !== this.hovering) {
          this.hovering = next;
          this.requestFrame();
        }
      }
    };
    const up = (event: PointerEvent) => {
      if (this.pointer?.id !== event.pointerId) return;
      const position = local(event);
      const selected = !this.pointer.moved ? hit(position.x, position.y) : undefined;
      this.pointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = selected ? 'pointer' : 'grab';
      if (selected) this.zone.run(() => this.nodeSelect.emit(selected.id));
      this.requestFrame();
    };
    const leave = () => {
      this.hovering = null;
      this.requestFrame();
    };
    const cancel = () => {
      this.pointer = null;
      canvas.style.cursor = 'grab';
      this.requestFrame();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('lostpointercapture', cancel);
    canvas.addEventListener('pointerleave', leave);
    this.cleanups.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('lostpointercapture', cancel);
      canvas.removeEventListener('pointerleave', leave);
    });
  }

  private makeGeometry(): void {
    let seed = 12731;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const add = (x: number, y: number, z: number, tone = 0) => {
      const weight = random();
      const glyphs = ['+', ':', '·', '∴', '0', '/', '∘', '1'];
      this.points.push({ x, y, z, tone, weight, glyph: weight > 0.945 ? glyphs[Math.floor(random() * glyphs.length)] : '' });
      return this.points.length - 1;
    };

    // A warped tubular manifold gives the artwork a continuous organic surface.
    // Its ring topology is visible through the fine longitude/latitude filaments.
    const rings = 76;
    const sides = 14;
    for (let i = 0; i < rings; i++) {
      const u = (i / rings) * Math.PI * 2;
      const major = 0.56 + 0.09 * Math.sin(3 * u + 0.5) + 0.035 * Math.cos(7 * u);
      const tube = 0.2 + 0.055 * Math.sin(5 * u) + 0.03 * Math.cos(9 * u);
      for (let j = 0; j < sides; j++) {
        const v = (j / sides) * Math.PI * 2 + Math.sin(u * 3) * 0.42;
        const grain = 1 + (random() - 0.5) * 0.14;
        const radius = major + tube * Math.cos(v) * grain;
        const x = radius * Math.cos(u) * 1.16;
        const y = radius * Math.sin(u) * 0.96 + 0.075 * Math.sin(u * 3);
        const z = tube * Math.sin(v) * grain + 0.18 * Math.sin(u * 2 + 0.8);
        const index = add(x, y, z, i > 49 && i < 61 ? 1 : random() > 0.92 ? 2 : 0);
        if (j) this.edges.push([index - 1, index]);
        if (i && j % 2 === 0) this.edges.push([index - sides, index]);
        if (j === sides - 1) this.edges.push([index, index - sides + 1]);
      }
    }
    for (let j = 0; j < sides; j += 2) this.edges.push([(rings - 1) * sides + j, j]);

    // Asymmetric tapering roots sprout from the manifold, then split and curl.
    // They are coherent tubes, rather than independent random graph edges.
    for (let root = 0; root < 14; root++) {
      const angle = root * 2.399963 + 0.3;
      const length = 0.34 + random() * 0.34;
      const startRadius = 0.54 + Math.sin(angle * 3) * 0.07;
      const twist = (random() - 0.5) * 1.3;
      const rootStart = this.points.length;
      const steps = 19;
      const rootSides = 5;
      for (let step = 0; step < steps; step++) {
        const t = step / (steps - 1);
        const curve = angle + Math.sin(t * 2.8) * twist;
        const radius = startRadius + t * length;
        const cx = Math.cos(curve) * radius * 1.15;
        const cy = Math.sin(curve) * radius * 0.95;
        const cz = Math.sin(angle * 2 + 0.8) * 0.15 + Math.sin(t * Math.PI * 1.3 + angle) * 0.22;
        const girth = (0.075 + 0.015 * Math.sin(t * 12)) * Math.pow(1 - t, 1.3) + 0.004;
        for (let side = 0; side < rootSides; side++) {
          const theta = (side / rootSides) * Math.PI * 2 + t * 4;
          const index = add(
            cx + Math.cos(theta) * Math.cos(curve) * girth,
            cy + Math.cos(theta) * Math.sin(curve) * girth,
            cz + Math.sin(theta) * girth,
            root === 3 || root === 8 ? 1 : root === 11 ? 2 : 0,
          );
          if (step) this.edges.push([index - rootSides, index]);
          if (side && step % 2 === 0) this.edges.push([index - 1, index]);
        }
        if (step === steps - 1) this.tips.push({ x: cx, y: cy, z: cz, tone: 0, weight: 1, glyph: '' });
      }
      // A few hairline offshoots add the fine, branching silhouette of a root.
      for (let branch = 0; branch < 2; branch++) {
        const at = rootStart + (8 + branch * 4) * rootSides;
        const source = this.points[at];
        let previous = at;
        for (let step = 1; step <= 9; step++) {
          const t = step / 9;
          const bend = angle + (branch ? 1 : -1) * 0.7;
          const index = add(source.x + Math.cos(bend + t * 0.8) * t * 0.22,
            source.y + Math.sin(bend + t * 0.8) * t * 0.22,
            source.z + Math.sin(t * 2.2) * 0.07, root === 3 ? 1 : 0);
          this.edges.push([previous, index]);
          previous = index;
        }
      }
    }

    // An inner double helix ties the open central cavity back to the outer roots.
    for (let strand = 0; strand < 2; strand++) {
      let previous = -1;
      for (let step = 0; step < 76; step++) {
        const t = step / 75;
        const angle = t * Math.PI * 5.6 + strand * Math.PI;
        const envelope = Math.sin(t * Math.PI);
        const index = add(Math.cos(angle) * 0.17 * envelope, (t - 0.5) * 0.95,
          Math.sin(angle) * 0.2 * envelope, strand === 0 ? 1 : 2);
        if (previous >= 0) this.edges.push([previous, index]);
        previous = index;
      }
    }
  }
}
