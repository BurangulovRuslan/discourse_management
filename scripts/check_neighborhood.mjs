/** Verify real topology, world-space depth, perspective reading and pagination. */
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
const {getSpatialNeighborhood}=await import(new URL('../frontend/.angular/neighborhood-check/neighborhood-layout.mjs',import.meta.url));
const data=JSON.parse(await readFile(path.join(root,'site/explorer-data.json'),'utf8'));
const byId=new Map(data.nodes.map(node=>[node.id,node])),ids=new Set(byId.keys());
const identity=()=>createHash('sha256').update(JSON.stringify([data.nodes,data.edges])).digest('hex');
const before=identity(),direction={x:.46,y:.27,z:1};let pagesChecked=0,targetsChecked=0;
const minus=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const length=v=>Math.hypot(v.x,v.y,v.z);
const unit=v=>{const n=length(v);return{x:v.x/n,y:v.y/n,z:v.z/n};};
const reserves=viewport=>viewport.width<=760?{left:12,right:12,top:40,bottom:220}:{left:24,right:320,top:40,bottom:90};
const adjacent=id=>new Set(data.edges.flatMap(edge=>edge.source===id?[edge.target]:edge.target===id?[edge.source]:[]).filter(other=>other!==id));
// Independent pinhole camera; the helper returns no projected rectangles.
function project(target,camera,viewport){
  const outward=unit(minus(camera.position,camera.target)),right=unit(cross(camera.up,outward)),up=cross(outward,right);
  const relative=minus(target,camera.position),depth=-dot(relative,outward),focal=viewport.height/(2*Math.tan(camera.fov*Math.PI/360));
  assert(depth>0,'The world target must be in front of the entry camera');
  return{id:target.id,x:viewport.width/2+dot(relative,right)*focal/depth,y:viewport.height/2-dot(relative,up)*focal/depth,w:168*focal/depth,h:224*focal/depth,depth};
}
function readingGeometry(result,viewport,reserve){
  const cards=result.targets.map(target=>project(target,result.entryCamera,viewport));
  for(const card of cards){
    assert(card.x-card.w/2>=reserve.left-.01&&card.x+card.w/2<=viewport.width-reserve.right+.01,`World cover ${card.id} exceeds horizontal entry bounds (${viewport.width}x${viewport.height})`);
    assert(card.y-card.h/2>=reserve.top-.01&&card.y+card.h/2<=viewport.height-reserve.bottom+.01,`World cover ${card.id} intersects the entry HUD (${viewport.width}x${viewport.height})`);
  }
  for(let a=0;a<cards.length;a++)for(let b=a+1;b<cards.length;b++){
    const one=cards[a],two=cards[b];
    assert(Math.abs(one.x-two.x)>=(one.w+two.w)/2-.05||Math.abs(one.y-two.y)>=(one.h+two.h)/2-.05,`Entry-view covers overlap (${viewport.width}x${viewport.height}, ${result.id}, page ${result.page}): ${one.id} / ${two.id}`);
  }
  if(result.targets.length>=4){
    const anchor=result.targets[0],vectors=result.targets.slice(1).map(target=>minus(target,anchor));let volume=0;
    for(let a=0;a<vectors.length;a++)for(let b=a+1;b<vectors.length;b++)for(let c=b+1;c<vectors.length;c++)volume=Math.max(volume,Math.abs(dot(vectors[a],cross(vectors[b],vectors[c]))));
    assert(volume>100,'The neighborhood must have genuine 3D volume, not a camera plane');
    assert(Math.max(...cards.map(card=>card.depth))-Math.min(...cards.map(card=>card.depth))>30,'Distinct world depths must remain visible to perspective');
  }
  if(cards.length>=7){
    assert(new Set(cards.map(card=>Math.round(card.x*10))).size>=5&&new Set(cards.map(card=>Math.round(card.y*10))).size>=5,'A focused neighborhood cannot collapse into three screen rows or columns');
  }
}
function allPages(id,viewport,expectedSize,entryDirection=direction){
  const reserve=reserves(viewport),expected=adjacent(id),first=getSpatialNeighborhood(data.nodes,data.edges,id,0,viewport,entryDirection,reserve);
  assert.equal(first.total,expected.size,'Count unique neighbors rather than parallel edges');if(expectedSize)assert.equal(first.pageSize,expectedSize);
  const seen=new Set(),counts=[];
  for(let page=0;page<first.totalPages;page++){
    const result=getSpatialNeighborhood(data.nodes,data.edges,id,page,viewport,entryDirection,reserve);pagesChecked++;
    assert.equal(result.page,page);assert.equal(result.totalPages,first.totalPages);
    const selected=result.targets.filter(target=>target.selected);assert.equal(selected.length,1);assert.equal(selected[0].id,id);
    for(const axis of ['x','y','z'])assert.equal(selected[0][axis],byId.get(id)[axis]??0,'The selected raw anchor must not move');
    const pageIds=result.targets.filter(target=>!target.selected).map(target=>target.id);assert.deepEqual(result.neighborIds,pageIds);
    assert(pageIds.length>0&&pageIds.length<=result.pageSize);assert.equal(new Set(result.targets.map(target=>target.id)).size,result.targets.length);
    for(const target of result.targets){assert(ids.has(target.id));assert([target.x,target.y,target.z].every(Number.isFinite));targetsChecked++;}
    for(const other of pageIds){assert(expected.has(other),'Only actual incoming/outgoing neighbors can move');assert(!seen.has(other),'No repeated neighbors across pages');seen.add(other);}
    readingGeometry(result,viewport,reserve);counts.push(pageIds.length);
  }
  assert.deepEqual([...seen].sort(),[...expected].sort(),'Every real neighbor is covered once');
  assert.equal(getSpatialNeighborhood(data.nodes,data.edges,id,-5,viewport,entryDirection,reserve).page,0);
  assert.equal(getSpatialNeighborhood(data.nodes,data.edges,id,1e6,viewport,entryDirection,reserve).page,first.totalPages-1);
  assert.deepEqual(getSpatialNeighborhood(data.nodes,data.edges,id,0,viewport,entryDirection,reserve).targets,first.targets,'Returning to a page restores the same deterministic world targets');
  return counts;
}
assert.equal(adjacent('Q9089ec3bd4').size,9);assert.equal(adjacent('B045').size,611);
assert.equal(data.edges.filter(edge=>edge.source==='B045'||edge.target==='B045').length,613);
assert.equal(adjacent('C22307874c').size,13);
assert.deepEqual(allPages('Q9089ec3bd4',{width:1440,height:900},8),[8,1]);
assert.deepEqual(allPages('Q9089ec3bd4',{width:390,height:844},4),[4,4,1]);
allPages('B045',{width:1440,height:900},8);allPages('B045',{width:390,height:844},4);
allPages('C22307874c',{width:1440,height:900},8);
for(const viewport of [{width:320,height:568},{width:844,height:390}])allPages('Q9089ec3bd4',viewport);
const graphCenter={};for(const axis of ['x','y','z'])graphCenter[axis]=(Math.min(...data.nodes.map(node=>node[axis]??0))+Math.max(...data.nodes.map(node=>node[axis]??0)))/2;
for(const id of ['Q9089ec3bd4','B045','C22307874c'])allPages(id,{width:1440,height:900},8,minus(byId.get(id),graphCenter));
const leaf=data.nodes.find(node=>adjacent(node.id).size===1);assert(leaf);allPages(leaf.id,{width:390,height:844});
const roomyViewport={width:1738,height:1148},roomyReserve=reserves(roomyViewport);
const roomy=getSpatialNeighborhood(data.nodes,data.edges,'C22307874c',0,roomyViewport,minus(byId.get('C22307874c'),graphCenter));
readingGeometry(roomy,roomyViewport,roomyReserve);
const roomyCards=roomy.targets.map(target=>project(target,roomy.entryCamera,roomyViewport));
const footprintWidth=Math.max(...roomyCards.map(card=>card.x+card.w/2))-Math.min(...roomyCards.map(card=>card.x-card.w/2));
const footprintHeight=Math.max(...roomyCards.map(card=>card.y+card.h/2))-Math.min(...roomyCards.map(card=>card.y-card.h/2));
assert(footprintWidth<(roomyViewport.width-roomyReserve.left-roomyReserve.right)*.9&&footprintHeight<(roomyViewport.height-roomyReserve.top-roomyReserve.bottom)*.9,'A roomy entry view must contain a compact cluster, not a frame pinned to the viewport boundary');
const viewport={width:1440,height:900},cluster=getSpatialNeighborhood(data.nodes,data.edges,'Q9089ec3bd4',0,viewport,direction),saved=JSON.stringify(cluster.targets);
const delta=minus(cluster.entryCamera.position,cluster.entryCamera.target),angle=.43;
const orbit={...cluster.entryCamera,position:{x:cluster.entryCamera.target.x+delta.x*Math.cos(angle)+delta.z*Math.sin(angle),y:cluster.entryCamera.position.y,z:cluster.entryCamera.target.z-delta.x*Math.sin(angle)+delta.z*Math.cos(angle)}};
const entry=cluster.targets.map(target=>project(target,cluster.entryCamera,viewport)),turned=cluster.targets.map(target=>project(target,orbit,viewport));
assert(turned.some((card,index)=>Math.hypot(card.x-entry[index].x,card.y-entry[index].y)>10),'A camera orbit must produce parallax rather than fixed HUD cards');
assert.equal(JSON.stringify(cluster.targets),saved,'Orbit projection cannot change stored world targets');
const altered=structuredClone(data.nodes),changed=altered.find(node=>node.id===cluster.neighborIds[0]),anchor=byId.get(cluster.id);
for(const axis of ['x','y','z'])changed[axis]=2*(anchor[axis]??0)-(changed[axis]??0);
assert.notDeepEqual(getSpatialNeighborhood(altered,data.edges,cluster.id,0,viewport,direction).targets,cluster.targets,'Real input directions must influence the spatial fingerprint');
assert.equal(identity(),before,'Focus and release can always return to unchanged real graph coordinates');
console.log(JSON.stringify({passed:true,nodes:data.nodes.length,edges:data.edges.length,pages_checked:pagesChecked,world_targets_checked:targetsChecked,examples:{Q9089ec3bd4:{neighbors:9,pages:[8,1]},B045:{neighbors:611,edges:613},C22307874c:{neighbors:13}},checks:['actual adjacency coverage','unique paginated neighbors','selected raw anchor','finite world positions','3D volume and distinct depths','independent perspective reading bounds','HUD reservation','entry nonoverlap','orbit parallax with fixed XYZ','deterministic page return','actual geometry fingerprint','graph immutability']},null,2));
