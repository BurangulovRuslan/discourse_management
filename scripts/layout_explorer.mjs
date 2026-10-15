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
const revision = 'forceatlas2-0.10.1-all-edges-v1';
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
const scale = 3000 / Math.max(maxX - minX, maxY - minY);
const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
const rounded = value => Math.round(value * 100) / 100;
for (const node of data.nodes) {
  const position = positions[node.id];
  node.x = rounded(1500 + (position.x - centerX) * scale);
  node.y = rounded(1500 + (position.y - centerY) * scale);
  node.degree = graph.degree(node.id);
}
data.layout = {
  algorithm: 'ForceAtlas2', revision, topology, iterations,
  nodes: graph.order, edges: graph.size,
  bounds: {
    minX: Math.min(...data.nodes.map(node => node.x)),
    maxX: Math.max(...data.nodes.map(node => node.x)),
    minY: Math.min(...data.nodes.map(node => node.y)),
    maxY: Math.max(...data.nodes.map(node => node.y)),
  },
};
await writeFile(target, JSON.stringify(data), 'utf8');
console.log(`Layout saved in ${((performance.now() - started) / 1000).toFixed(1)}s; bounds ${JSON.stringify(data.layout.bounds)}.`);
