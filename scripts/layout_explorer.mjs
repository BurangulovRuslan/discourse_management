/**
 * Build the actual graph's deterministic, single-plane ForceAtlas2 layout.
 * Only build-time dependencies are used; browsers download ready coordinates.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(project, 'frontend/package.json'));
const { MultiDirectedGraph } = require('graphology');
const forceAtlas2 = require('graphology-layout-forceatlas2');
const target = path.join(project, 'site/explorer-data.json');
const data = JSON.parse(await readFile(target, 'utf8'));
const identity = [
  ...data.nodes.map(node => node.id),
  ...data.edges.map(edge => `${edge.source}|${edge.target}|${Number(edge.analytical)}`),
].join('\n');
const topology = createHash('sha256').update(identity).digest('hex');
const iterations = 1000;
const settings = {
  ...forceAtlas2.inferSettings(data.nodes.length),
  barnesHutOptimize: true,
  barnesHutTheta: 0.5,
  linLogMode: true,
  gravity: 0.05,
  scalingRatio: 12,
  slowDown: 8,
};
const revision = 'forceatlas2-0.10.1-cover-packing-v2';
// A cover has a real footprint in the map. Leave enough breathing room for
// connection lines and the small, shared motion field used in the browser.
const cover = { width: 168, height: 224, gapX: 80, gapY: 80 };
const spacingX = cover.width + cover.gapX + 0.5;
const spacingY = cover.height + cover.gapY + 0.5;
if (!process.argv.includes('--force') && data.layout?.topology === topology &&
    data.layout?.revision === revision && data.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))) {
  console.log(`Graph layout unchanged: ${data.nodes.length} nodes, ${data.edges.length} real edges.`);
  process.exit(0);
}

const graph = new MultiDirectedGraph({ allowSelfLoops: true });
const seedPosition = id => {
  const bytes = createHash('sha256').update(`atlas-layout-v1:${id}`).digest();
  const angle = bytes.readUInt32LE(0) / 0x100000000 * Math.PI * 2;
  const radius = Math.sqrt((bytes.readUInt32LE(4) + 0.5) / 0x100000000) * 150;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
};
for (const node of data.nodes) graph.addNode(node.id, seedPosition(node.id));
for (let index = 0; index < data.edges.length; index++) {
  const edge = data.edges[index];
  graph.addDirectedEdgeWithKey(String(index), edge.source, edge.target, { weight: 1 });
}
console.log(`Computing ForceAtlas2 on ${graph.order} nodes and ${graph.size} real edges (${iterations} iterations)…`);
const started = performance.now();
const positions = forceAtlas2(graph, { iterations, settings });
const xs = Object.values(positions).map(position => position.x);
const ys = Object.values(positions).map(position => position.y);
if ([...xs, ...ys].some(value => !Number.isFinite(value))) throw new Error('Layout produced invalid coordinates');
const minX = Math.min(...xs), maxX = Math.max(...xs);
const minY = Math.min(...ys), maxY = Math.max(...ys);
const extent = 36000;
const scale = extent / Math.max(maxX - minX, maxY - minY);
const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
const rounded = value => Math.round(value * 100) / 100;
const desired = new Map();
for (const node of data.nodes) {
  const position = positions[node.id];
  desired.set(node.id, { x: extent / 2 + (position.x - centerX) * scale,
    y: extent / 2 + (position.y - centerY) * scale });
  node.degree = graph.degree(node.id);
}

// Keep the topology's organic distribution, then move each cover to the
// nearest free position along a deterministic, continuous golden-angle spiral.
// The result is a single plane, not a grid or separate layers by node type.
const buckets = new Map();
const key = (x, y) => `${x},${y}`;
const cell = (x, y) => [Math.floor(x / spacingX), Math.floor(y / spacingY)];
const occupied = (x, y) => {
  const [cx, cy] = cell(x, y);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const other of buckets.get(key(cx + dx, cy + dy)) ?? []) {
      if (Math.abs(x - other.x) < spacingX && Math.abs(y - other.y) < spacingY) return true;
    }
  }
  return false;
};
let displaced = 0, maxDisplacement = 0;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
for (const node of [...data.nodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id, 'en'))) {
  const origin = desired.get(node.id);
  let x = origin.x, y = origin.y, attempt = 0;
  const phase = createHash('sha256').update(`cover-packing:${node.id}`).digest().readUInt32LE(0) / 0x100000000 * Math.PI * 2;
  while (occupied(x, y)) {
    attempt++;
    if (attempt > 100000) throw new Error(`No free cover position for ${node.id}`);
    const radius = Math.sqrt(attempt) * 32;
    const angle = phase + attempt * goldenAngle;
    x = origin.x + Math.cos(angle) * radius;
    y = origin.y + Math.sin(angle) * radius;
  }
  node.x = rounded(x); node.y = rounded(y);
  if (attempt) displaced++;
  maxDisplacement = Math.max(maxDisplacement, Math.hypot(x - origin.x, y - origin.y));
  const [cx, cy] = cell(node.x, node.y), bucketKey = key(cx, cy);
  if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
  buckets.get(bucketKey).push(node);
}
data.layout = {
  algorithm: 'ForceAtlas2', revision, topology, iterations,
  nodes: graph.order, edges: graph.size,
  packing: { method: 'continuous-golden-angle', ...cover, displaced, maxDisplacement: rounded(maxDisplacement) },
  bounds: {
    minX: Math.min(...data.nodes.map(node => node.x)),
    maxX: Math.max(...data.nodes.map(node => node.x)),
    minY: Math.min(...data.nodes.map(node => node.y)),
    maxY: Math.max(...data.nodes.map(node => node.y)),
  },
};
await writeFile(target, JSON.stringify(data), 'utf8');
console.log(`Layout saved in ${((performance.now() - started) / 1000).toFixed(1)}s; bounds ${JSON.stringify(data.layout.bounds)}.`);
