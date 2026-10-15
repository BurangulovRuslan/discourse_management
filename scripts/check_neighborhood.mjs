/** Independent graph coverage and screen-space invariants for reading callouts. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'frontend/.angular/neighborhood-check');await mkdir(directory,{recursive:true});
const source=await readFile(path.join(root,'frontend/src/app/neighborhood-layout.ts'),'utf8');
await writeFile(path.join(directory,'neighborhood-layout.mjs'),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {getNeighborhoodLayout}=await import(new URL('../frontend/.angular/neighborhood-check/neighborhood-layout.mjs',import.meta.url));
const data=JSON.parse(await readFile(path.join(root,'site/explorer-data.json'),'utf8'));
const ids=new Set(data.nodes.map(node=>node.id));
const identity=()=>createHash('sha256').update(JSON.stringify([data.nodes,data.edges])).digest('hex');
const before=identity();let pagesChecked=0,rectanglesChecked=0;
const reserves=viewport=>viewport.width<760?{left:12,right:12,top:40,bottom:220}:{left:24,right:320,top:40,bottom:90};
const adjacent=id=>new Set(data.edges.flatMap(edge=>edge.source===id?[edge.target]:edge.target===id?[edge.source]:[]).filter(other=>other!==id));

function geometry(layout,viewport,reserve){
  const unique=new Set();
  for(const card of layout.cards){
    assert(ids.has(card.id),'A reading card must be a real graph node');assert(!unique.has(card.id),'A node cannot appear twice on the same page');unique.add(card.id);
    assert([card.x,card.y,card.w,card.h].every(Number.isFinite)&&card.w>0&&card.h>0,'Card rectangles must be finite and visible');
    assert(card.x-card.w/2>=reserve.left-1e-6&&card.x+card.w/2<=viewport.width-reserve.right+1e-6,`Card ${card.id} exceeds horizontal safe area at ${viewport.width}x${viewport.height}`);
    assert(card.y-card.h/2>=reserve.top-1e-6&&card.y+card.h/2<=viewport.height-reserve.bottom+1e-6,`Card ${card.id} overlaps reserved HUD/vertical safe area at ${viewport.width}x${viewport.height}`);
    rectanglesChecked++;
  }
  for(let a=0;a<layout.cards.length;a++)for(let b=a+1;b<layout.cards.length;b++){
    const one=layout.cards[a],two=layout.cards[b];
    assert(Math.abs(one.x-two.x)>=(one.w+two.w)/2-1e-6||Math.abs(one.y-two.y)>=(one.h+two.h)/2-1e-6,`Reading cards overlap at ${viewport.width}x${viewport.height}: ${one.id} / ${two.id}`);
  }
}
function allPages(id,viewport,expectedSize){
  const reserve=reserves(viewport),expected=adjacent(id),first=getNeighborhoodLayout(data.nodes,data.edges,id,0,viewport,reserve);
  assert.equal(first.total,expected.size,'Total must count unique neighbors rather than parallel edges');
  if(expectedSize)assert.equal(first.pageSize,expectedSize,'The normal reading viewport must retain its promised page capacity');
  assert(first.pageSize>=1&&first.totalPages>=1);
  const seen=new Set(),pageSizes=[];
  for(let page=0;page<first.totalPages;page++){
    const result=getNeighborhoodLayout(data.nodes,data.edges,id,page,viewport,reserve);pagesChecked++;
    assert.equal(result.page,page);assert.equal(result.totalPages,first.totalPages);
    assert.equal(result.cards.filter(card=>card.selected).length,1,'Selected cover remains visible on every page');
    assert.equal(result.cards.find(card=>card.selected).id,id);
    const pageIds=result.cards.filter(card=>!card.selected).map(card=>card.id);
    assert.deepEqual(result.neighborIds,pageIds,'Published page IDs agree with the visible cards');
    assert(pageIds.length>0&&pageIds.length<=result.pageSize,'Every nonempty adjacency page has bounded cards');
    for(const other of pageIds){assert(expected.has(other),'Every visible neighbor has a real incoming or outgoing edge');assert(!seen.has(other),'Pagination cannot repeat a neighbor');seen.add(other);}
    pageSizes.push(pageIds.length);geometry(result,viewport,reserve);
  }
  assert.deepEqual([...seen].sort(),[...expected].sort(),'All pages together cover every real neighbor without loss');
  assert.equal(getNeighborhoodLayout(data.nodes,data.edges,id,-5,viewport,reserve).page,0,'Clamp negative page');
  assert.equal(getNeighborhoodLayout(data.nodes,data.edges,id,1e6,viewport,reserve).page,first.totalPages-1,'Clamp past the last page');
  return pageSizes;
}

assert.equal(adjacent('Q9089ec3bd4').size,9,'Known nine-neighbor analytical node');
assert.equal(adjacent('B045').size,611,'Known high-degree book');
assert.equal(data.edges.filter(edge=>edge.source==='B045'||edge.target==='B045').length,613,'Parallel book edges are deliberately retained');
assert.deepEqual(allPages('Q9089ec3bd4',{width:1440,height:900},8),[8,1]);
assert.deepEqual(allPages('Q9089ec3bd4',{width:390,height:844},4),[4,4,1]);
allPages('B045',{width:1440,height:900},8);allPages('B045',{width:390,height:844},4);
// A compact HUD still leaves a valid screen-space reading area in short viewports.
for(const viewport of [{width:320,height:568},{width:360,height:640},{width:760,height:600},{width:844,height:390},{width:1024,height:600}])allPages('Q9089ec3bd4',viewport);
assert.equal(identity(),before,'Reading layout must not mutate the real 3D graph or its edges');
console.log(JSON.stringify({passed:true,nodes:data.nodes.length,edges:data.edges.length,pages_checked:pagesChecked,rectangles_checked:rectanglesChecked,examples:{Q9089ec3bd4:{neighbors:9,desktop_pages:[8,1]},B045:{unique_neighbors:611,edges:613}},checks:['complete adjacency pagination','unique real node IDs','directed and parallel edges','safe reading bounds','no card overlaps','HUD reservation','page clamping','graph immutability']},null,2));
