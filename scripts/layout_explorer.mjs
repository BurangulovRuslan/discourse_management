/** Build one deterministic, topological 3D layout of the entire actual corpus. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(project, 'frontend/package.json'));
const { forceSimulation, forceLink, forceManyBody, forceCollide, forceCenter, forceX, forceY, forceZ } =
  await import(pathToFileURL(require.resolve('d3-force-3d')).href);
const target = path.join(project, 'site/explorer-data.json');
const data = JSON.parse(await readFile(target, 'utf8'));
const identity = [...data.nodes.map(node => node.id), ...data.edges.map(edge => `${edge.source}|${edge.target}|${Number(edge.analytical)}`)].join('\n');
const topology = createHash('sha256').update(identity).digest('hex');
const revision = 'd3-force-3d-3.0.6-organic-v1';
if (!process.argv.includes('--force') && data.layout?.topology === topology && data.layout?.revision === revision
    && data.layout?.dimensions === 3 && data.nodes.every(n => ['x', 'y', 'z'].every(axis => Number.isFinite(n[axis])))) {
  console.log(`3D graph layout unchanged: ${data.nodes.length} nodes, ${data.edges.length} real edges.`);
  process.exit(0);
}

const degree = new Map(data.nodes.map(n => [n.id, 0]));
for (const edge of data.edges) {
  if (!degree.has(edge.source) || !degree.has(edge.target)) throw new Error('Graph edge references a missing actual node');
  degree.set(edge.source, degree.get(edge.source) + 1); degree.set(edge.target, degree.get(edge.target) + 1);
}
const nodes = data.nodes.map(node => {
  const bytes = createHash('sha256').update(`atlas-3d:${node.id}`).digest();
  const azimuth = bytes.readUInt32LE(0) / 0x100000000 * Math.PI * 2;
  const elevation = bytes.readUInt32LE(4) / 0x100000000 * 2 - 1;
  const radius = Math.cbrt((bytes.readUInt32LE(8) + .5) / 0x100000000) * 900;
  const ring = Math.sqrt(1 - elevation * elevation) * radius;
  return { id: node.id, degree: degree.get(node.id), x: Math.cos(azimuth) * ring, y: elevation * radius, z: Math.sin(azimuth) * ring };
});
const links = data.edges.map(edge => ({ source: edge.source, target: edge.target, analytical: edge.analytical }));
let seed = 0x5eeda71a;
const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 0x100000000);
const iterations = 720;
const simulation = forceSimulation(nodes, 3).stop().randomSource(random)
  .alphaDecay(1 - Math.pow(.001, 1 / iterations)).velocityDecay(.38)
  .force('links', forceLink(links).id(n => n.id).distance(230)
    .strength(edge => .26 / Math.sqrt(Math.max(1, Math.min(edge.source.degree, edge.target.degree)))))
  .force('charge', forceManyBody().strength(n => -320 * (1 + Math.log1p(n.degree) * .12)).theta(.9).distanceMax(4000))
  .force('collision', forceCollide().radius(n => 82 + Math.sqrt(n.degree) * .6).strength(.7).iterations(2))
  .force('center', forceCenter(0, 0, 0))
  .force('x', forceX(0).strength(.0014)).force('y', forceY(0).strength(.0014)).force('z', forceZ(0).strength(.0014));
const started = performance.now();
console.log(`Computing one 3D force simulation: ${nodes.length} nodes, ${links.length} real edges, ${iterations} iterations…`);
for (let i = 0; i < iterations; i++) {
  simulation.tick();
  if ((i + 1) % 120 === 0) console.log(`3D layout ${i + 1}/${iterations}; ${((performance.now() - started) / 1000).toFixed(1)}s`);
}
simulation.stop();
const lengths = links.map(e => Math.hypot(e.source.x - e.target.x, e.source.y - e.target.y, e.source.z - e.target.z)).filter(v => v > 0).sort((a, b) => a - b);
const scale = 460 / (lengths[Math.floor(lengths.length / 2)] || 460);
const rounded = value => Math.round(value * 100) / 100;
const byId = new Map(nodes.map(n => [n.id, n]));
for (const node of data.nodes) {
  const position = byId.get(node.id);
  for (const axis of ['x', 'y', 'z']) {
    node[axis] = rounded(position[axis] * scale);
    if (!Number.isFinite(node[axis])) throw new Error(`Invalid 3D coordinate: ${node.id}`);
  }
  node.degree = position.degree;
}
data.layout = {
  algorithm: 'D3Force3D', dimensions: 3, revision, topology, iterations,
  nodes: nodes.length, edges: links.length,
  settings: { linkDistance: 230, medianEdgeLength: 460, collisionRadius: 82, charge: -320, seed: 'atlas-3d' },
  bounds: Object.fromEntries(['x', 'y', 'z'].flatMap(axis => [
    [`min${axis.toUpperCase()}`, Math.min(...data.nodes.map(n => n[axis]))],
    [`max${axis.toUpperCase()}`, Math.max(...data.nodes.map(n => n[axis]))],
  ])),
};
await writeFile(target, JSON.stringify(data), 'utf8');
console.log(`3D layout saved in ${((performance.now() - started) / 1000).toFixed(1)}s. Bounds ${JSON.stringify(data.layout.bounds)}`);
