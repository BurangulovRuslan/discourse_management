/** Dependency-free cover printing shared by the map textures and the article plate. */
export interface CoverArtNode { id: string; label: string; type: string; degree: number; }
export interface CoverArtNeighbor { id: string; x: number; y: number; degree: number; }
export interface CoverArtOptions {
  width?: number;
  height?: number;
  serial?: number;
  neighbors?: CoverArtNeighbor[];
  origin?: { x: number; y: number };
  detail?: 'full' | 'thumbnail';
}
export interface CoverArtTheme { paper: string; ink: string; accent: string; rule: string; }

const MONO = '"Cascadia Code", "SFMono-Regular", Consolas, monospace';
const SANS = '"Arial Narrow", "Roboto Condensed", Arial, sans-serif';
const THEMES: CoverArtTheme[] = [
  { paper: '#090d10', ink: '#e4e8e3', accent: '#b8ced0', rule: '#4c5c60' },
  { paper: '#101413', ink: '#e5e7d8', accent: '#c7d66f', rule: '#526052' },
  { paper: '#0c1016', ink: '#e5e9e9', accent: '#a0c7d4', rule: '#4a5965' },
  { paper: '#171714', ink: '#eeeadb', accent: '#d1bd7c', rule: '#665e44' },
  { paper: '#090b0d', ink: '#d8dcd8', accent: '#bec3bb', rule: '#424b4d' },
  { paper: '#111718', ink: '#e6eeea', accent: '#a6cfd0', rule: '#456367' },
  { paper: '#e0e3d9', ink: '#172222', accent: '#4b645b', rule: '#9da9a1' },
  { paper: '#0e1112', ink: '#e2e5de', accent: '#ccce8c', rule: '#5b6254' },
];

export function coverHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export function getCoverTheme(node: Pick<CoverArtNode, 'id' | 'type'>): CoverArtTheme {
  return THEMES[coverHash(`${node.id}|${node.type}`) % THEMES.length];
}

const TYPE_LABELS: Record<string, string> = {
  book: 'Книга', theme: 'Тема', construct: 'Понятие', thinker: 'Автор', experiment: 'Исследовательский эпизод',
  code: 'Тематический код', proposition: 'Тезис', chain_step: 'Звено аргумента', trajectory_stage: 'Стадия понятия',
  work: 'Работа', citation: 'Библиографическая запись', concept: 'Концепт', author: 'Автор',
};

interface Box { x: number; y: number; w: number; h: number; }
interface TitleLayout { lines: string[]; size: number; lineHeight: number; }

/** Wrap full words first, reducing the type size before splitting an exceptional token. */
function titleLayout(ctx: CanvasRenderingContext2D, title: string, width: number, maxHeight: number): TitleLayout {
  const words = title.replace(/\s+/g, ' ').trim().toLocaleUpperCase('ru').split(' ');
  let last: TitleLayout = { lines: words, size: 6, lineHeight: 6.25 };
  for (const size of [27, 24, 21, 18, 16, 14, 12, 10, 9, 8, 7, 6]) {
    ctx.font = `600 ${size}px ${SANS}`;
    if (size > 6 && words.some(word => ctx.measureText(word).width > width)) continue;
    const lines: string[] = [];
    let line = '';
    for (let word of words) {
      while (ctx.measureText(word).width > width) {
        let cut = 1;
        while (cut < word.length && ctx.measureText(word.slice(0, cut + 1)).width <= width) cut++;
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= width) line = candidate;
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    last = { lines, size, lineHeight: size * 1.01 };
    if (lines.length * last.lineHeight <= maxHeight) return last;
  }
  return last;
}

function pluralConnections(value: number): string {
  const n = Math.abs(value) % 100, tail = n % 10;
  return n > 10 && n < 20 ? 'СВЯЗЕЙ' : tail === 1 ? 'СВЯЗЬ' : tail >= 2 && tail <= 4 ? 'СВЯЗИ' : 'СВЯЗЕЙ';
}

/**
 * Procedural ASCII is an artwork, never a fabricated graph. Its fingerprint uses
 * the actual node and neighbor identities. Family 5 alone prints actual one-hop
 * relationships; the other families are clearly labelled as an ASCII object.
 */
function asciiObject(
  ctx: CanvasRenderingContext2D, node: CoverArtNode, box: Box, theme: CoverArtTheme,
  seed: number, family: number, options: CoverArtOptions,
): void {
  const detail = options.detail !== 'thumbnail' && (options.width ?? 168) >= 40;
  const cellW = detail ? 2.8 : 3.6;
  const cellH = detail ? 3.6 : 4.5;
  const cols = detail ? Math.max(16, Math.floor(box.w / cellW)) : 12;
  const rows = detail ? Math.max(12, Math.floor(box.h / cellH)) : 10;
  const stepX = box.w / cols, stepY = box.h / rows;
  const depth = new Float32Array(cols * rows).fill(-Infinity);
  const light = new Float32Array(cols * rows);
  const phase = (seed % 10007) / 10007 * Math.PI * 2;
  const a = -.54 + ((seed >>> 7) % 100) / 100 * .64;
  const b = -.54 + ((seed >>> 14) % 100) / 100 * 1.08;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const radius = Math.min(box.w * .48, box.h * .47);
  const plot = (x: number, y: number, z: number, luminosity = .7) => {
    const ry = y * ca - z * sa, rz = y * sa + z * ca;
    const rx = x * cb + rz * sb, zz = -x * sb + rz * cb;
    const px = Math.floor((box.w / 2 + rx * radius) / stepX);
    const py = Math.floor((box.h / 2 + ry * radius) / stepY);
    if (px < 0 || px >= cols || py < 0 || py >= rows) return;
    const index = py * cols + px;
    if (zz > depth[index]) {
      depth[index] = zz;
      light[index] = Math.max(.1, Math.min(1, luminosity * .68 + (zz + 1) * .22));
    }
  };
  const sampleU = detail ? 112 : 32, sampleV = detail ? 48 : 14;
  const complexity = Math.min(1, Math.log2(1 + Math.max(0, node.degree)) / 10);

  if (family === 5 && options.neighbors?.length && options.origin) {
    const neighbors = options.neighbors;
    const origin = options.origin;
    const range = Math.max(1, ...neighbors.map(n => Math.hypot(n.x - origin.x, n.y - origin.y)));
    // These paths are exclusively actual source-to-neighbor relationships.
    for (const neighbor of neighbors) {
      const x = (neighbor.x - origin.x) / range * .95;
      const y = (neighbor.y - origin.y) / range * .95;
      const distance = Math.hypot(x * radius, y * radius);
      const samples = detail ? Math.max(2, Math.ceil(distance / 1.3)) : 6;
      for (let step = 0; step <= samples; step++) plot(x * step / samples, y * step / samples, 0, .48);
      plot(x, y, .1, 1);
      plot(x + .012, y, .1, 1);
    }
    plot(0, 0, .5, 1);
  } else {
    // Six distinct surface families, each with deterministic data-derived variation.
    const shape = family === 5 ? 1 : family;
    for (let ui = 0; ui < sampleU; ui++) {
      const u = ui / (sampleU - 1) * Math.PI * 2;
      for (let vi = 0; vi < sampleV; vi++) {
        const v = vi / (sampleV - 1) * Math.PI * 2;
        let x = 0, y = 0, z = 0;
        if (shape === 0) {
          // A ridged torus, cut from a continuous ASCII surface.
          const r = .22 + .035 * Math.sin(u * (3 + seed % 4) + phase);
          const ring = .61 + r * Math.cos(v);
          x = ring * Math.cos(u); y = ring * Math.sin(u); z = r * Math.sin(v);
        } else if (shape === 1) {
          const latitude = v / 2 - Math.PI / 2;
          const r = .7 + .14 * Math.sin(u * (3 + seed % 3) + phase) * Math.cos(latitude * 4)
            + .06 * Math.cos(u * 7 - latitude * 5 + phase);
          x = r * Math.cos(latitude) * Math.cos(u);
          y = r * Math.cos(latitude) * Math.sin(u);
          z = r * Math.sin(latitude) * (1 + complexity * .3);
        } else if (shape === 2) {
          // A double ribbon has more open space than the shell and torus families.
          const t = u * 2.5 - Math.PI * 2.5;
          const tube = .055 + .025 * Math.cos(v + phase);
          const ring = .42 + tube * Math.cos(v);
          x = ring * Math.cos(t); z = ring * Math.sin(t);
          y = t / (Math.PI * 2.5) * .86 + tube * Math.sin(v);
        } else if (shape === 3) {
          const px = u / Math.PI - 1, py = v / Math.PI - 1;
          x = px * .85;
          y = py * .76;
          z = Math.sin(px * (4 + seed % 4) + phase) * Math.cos(py * 4) * .23
            + .1 * Math.sin(py * 9 + phase);
        } else {
          // A widening logarithmic shell produces an asymmetric, sculptural spiral.
          const t = u * 2.2;
          const r = .06 + .047 * t;
          const tube = .035 + .009 * t;
          x = (r + tube * Math.cos(v)) * Math.cos(t + phase);
          y = (r + tube * Math.cos(v)) * Math.sin(t + phase);
          z = tube * Math.sin(v) + t * .025 - .18;
        }
        plot(x, y, z, .45 + .36 * Math.cos(u - .8) * Math.sin(v + .5));
      }
    }
  }

  ctx.save();
  ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  ctx.font = `${Math.max(3.5, stepY * 1.23)}px ${MONO}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const glyphs = ['.', ':', '+', 'x', '#', '@'];
  // Four luminance passes preserve the character texture and metallic highlights.
  for (let row = 0; row < rows; row++) {
    for (let tone = 0; tone < 4; tone++) {
      ctx.fillStyle = tone === 3 ? theme.accent : theme.ink;
      ctx.globalAlpha = [.3, .53, .78, .98][tone];
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        if (!Number.isFinite(depth[index])) continue;
        const value = light[index];
        if (Math.min(3, Math.floor(value * 4)) !== tone) continue;
        const salt = (Math.imul(col + 11, 73856093) ^ Math.imul(row + 3, 19349663) ^ seed) >>> 0;
        const glyph = glyphs[Math.min(5, Math.floor(value * 5.2) + (salt % 11 === 0 ? 1 : 0))];
        ctx.fillText(glyph, box.x + (col + .5) * stepX, box.y + (row + .5) * stepY);
      }
    }
  }
  ctx.restore();
}

/** Paint one complete cover, in CSS pixels; callers control canvas backing resolution. */
export function paintCover(ctx: CanvasRenderingContext2D, node: CoverArtNode, options: CoverArtOptions = {}): void {
  const width = Math.max(1, options.width ?? 168), height = Math.max(1, options.height ?? 224);
  const unit = Math.min(width / 168, height / 224);
  const w = width / unit, h = height / unit;
  const tiny = options.detail === 'thumbnail' || width < 40;
  const neighbors = options.neighbors ?? [];
  const fingerprint = neighbors.map(n => n.id).sort().join('|');
  const seed = coverHash(`${node.id}|${node.type}|${fingerprint}`);
  const family = seed % 6;
  const theme = getCoverTheme(node);
  const pad = 11;
  ctx.save();
  ctx.scale(unit, unit);
  if (tiny) {
    // Far atlas tiles are quiet silhouettes. Type belongs exclusively to the
    // nearby readable texture; subpixel lettering would turn into noisy bars.
    const accent = theme.accent.match(/\w\w/g)!.map(channel => parseInt(channel, 16));
    const background = [16, 21, 26];
    const subdued = `rgb(${accent.map((channel, index) => Math.round(background[index] * .64 + channel * .36)).join(',')})`;
    const silhouette: CoverArtTheme = { paper: '#10151a', ink: '#72838a', accent: subdued, rule: '#29373e' };
    ctx.fillStyle = silhouette.paper; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = silhouette.rule; ctx.lineWidth = .7; ctx.strokeRect(.5, .5, w - 1, h - 1);
    asciiObject(ctx, node, { x: 7, y: 7, w: w - 14, h: h - 14 }, silhouette, seed, family, options);
    ctx.restore();
    return;
  }
  ctx.fillStyle = theme.paper; ctx.fillRect(0, 0, w, h);

  // Quiet archive microfilm grain, with a deterministic seed for every real node.
  ctx.fillStyle = theme.ink;
  ctx.globalAlpha = .065;
  for (let i = 0; i < (tiny ? 30 : 500); i++) {
    const a = (Math.imul(i + 1, 1597334677) ^ seed) >>> 0;
    const b = (Math.imul(i + 5, 3812015801) ^ (seed >>> 3)) >>> 0;
    ctx.fillRect(a % Math.ceil(w * 10) / 10, b % Math.ceil(h * 10) / 10, .35, .35);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.rule; ctx.lineWidth = .5;
  ctx.strokeRect(.5, .5, w - 1, h - 1);
  ctx.beginPath(); ctx.moveTo(pad, 22); ctx.lineTo(w - pad, 22); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = theme.ink; ctx.font = `5.4px ${MONO}`;
  ctx.fillText('АТЛАС / СВЯЗАННОЕ ИЗДАНИЕ', pad, 10);
  ctx.textAlign = 'right';
  ctx.fillText(options.serial === undefined ? node.id : `№ ${String(options.serial).padStart(4, '0')}`, w - pad, 10);
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.accent; ctx.font = `5.5px ${MONO}`;
  ctx.fillText((TYPE_LABELS[node.type] ?? node.type).toLocaleUpperCase('ru'), pad, 28);

  // At atlas size the type is subpixel. Avoid thousands of font measurements;
  // the nearby full-resolution texture supplies the complete, readable layout.
  const title = tiny
    ? { lines: [node.label.replace(/\s+/g, ' ').trim().toLocaleUpperCase('ru')], size: 21, lineHeight: 22 }
    : titleLayout(ctx, node.label, w - pad * 2, h * .29);
  const titleY = 40;
  ctx.fillStyle = theme.ink;
  ctx.font = `600 ${title.size}px ${SANS}`;
  for (let index = 0; index < title.lines.length; index++) {
    if (tiny) ctx.fillText(title.lines[index], pad - .5, titleY + index * title.lineHeight, w - pad * 2);
    else ctx.fillText(title.lines[index], pad - .5, titleY + index * title.lineHeight);
  }
  const artY = Math.max(73, titleY + title.lines.length * title.lineHeight + 7);
  const artBottom = h - 29;
  const art: Box = { x: pad - 4, y: artY, w: w - pad * 2 + 8, h: Math.max(18, artBottom - artY) };
  asciiObject(ctx, node, art, theme, seed, family, options);

  // Short registration ticks are typographic furniture, never extra graph connections.
  ctx.strokeStyle = theme.rule; ctx.lineWidth = .5;
  for (const x of [pad, w - pad]) {
    ctx.beginPath(); ctx.moveTo(x - 2, artY + 3); ctx.lineTo(x + 2, artY + 3);
    ctx.moveTo(x, artY + 1); ctx.lineTo(x, artY + 5); ctx.stroke();
  }
  ctx.fillStyle = theme.accent; ctx.font = `4.6px ${MONO}`;
  ctx.save(); ctx.translate(w - 5, artY + 5); ctx.rotate(Math.PI / 2);
  ctx.fillText(family === 5 && neighbors.length ? 'ASCII / СВЯЗИ УЗЛА' : 'ASCII / ОБЪЕКТ', 0, 0);
  ctx.restore();
  ctx.strokeStyle = theme.rule;
  ctx.beginPath(); ctx.moveTo(pad, h - 23); ctx.lineTo(w - pad, h - 23); ctx.stroke();
  ctx.fillStyle = theme.accent; ctx.font = `5px ${MONO}`;
  ctx.fillText(node.id, pad, h - 15);
  ctx.textAlign = 'right'; ctx.fillStyle = theme.ink;
  ctx.fillText(`${node.degree} ${pluralConnections(node.degree)}`, w - pad, h - 15);
  ctx.restore();
}

export const renderNodeCover = paintCover;
