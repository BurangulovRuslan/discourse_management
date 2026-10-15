/** A one-shot 3D relaxation at focus time. Targets are world coordinates, never HUD positions. */
export const NEIGHBORHOOD_PAGE_SIZE=8;
export const NEIGHBORHOOD_MOBILE_PAGE_SIZE=4;
export interface SpatialVector {x:number;y:number;z:number;}
export interface SpatialTarget extends SpatialVector {id:string;selected:boolean;}
export interface NeighborhoodViewport {width:number;height:number;}
export interface NeighborhoodReserve {left?:number;right?:number;top?:number;bottom?:number;}
export interface SpatialNeighborhood {
  id:string;page:number;pageSize:number;total:number;totalPages:number;neighborIds:string[];
  targets:SpatialTarget[];bounds:{center:SpatialVector;radius:number};viewDirection:SpatialVector;
  entryCamera:{position:SpatialVector;target:SpatialVector;up:SpatialVector;fov:number};
}
interface Node extends SpatialVector {id:string;degree:number;}
interface Particle {id:string;selected:boolean;x:number;y:number;d:number;homeX:number;homeY:number;homeD:number;}
const W=168,H=224,FOV=42,GAP=12;
const dot=(a:SpatialVector,b:SpatialVector)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a:SpatialVector,b:SpatialVector):SpatialVector=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const norm=(a:SpatialVector):SpatialVector=>{const n=Math.hypot(a.x,a.y,a.z);return n>1e-8?{x:a.x/n,y:a.y/n,z:a.z/n}:{x:0,y:0,z:1};};
const clamp=(value:number,low:number,high:number)=>Math.max(low,Math.min(high,value));
function seed(key:string):number{let value=2166136261;for(let i=0;i<key.length;i++){value^=key.charCodeAt(i);value=Math.imul(value,16777619);}return(value>>>0)/4294967296;}

export function getSpatialNeighborhood(
  nodes:ReadonlyArray<{id:string;degree:number;x:number;y:number;z?:number}>,
  edges:ReadonlyArray<{source:string;target:string}>,selectedId:string,page:number,
  viewport:NeighborhoodViewport,cameraDirection:SpatialVector={x:.4,y:.24,z:1},reserved:NeighborhoodReserve={},
):SpatialNeighborhood {
  const byId=new Map(nodes.map(node=>[node.id,{...node,z:node.z??0} as Node]));
  const selected=byId.get(selectedId),anchor:SpatialVector=selected??{x:0,y:0,z:0};
  const adjacency=new Set<string>();
  for(const edge of edges){if(edge.source===selectedId&&edge.target!==selectedId&&byId.has(edge.target))adjacency.add(edge.target);if(edge.target===selectedId&&edge.source!==selectedId&&byId.has(edge.source))adjacency.add(edge.source);}
  const neighbors=[...adjacency].sort((a,b)=>byId.get(b)!.degree-byId.get(a)!.degree||a.localeCompare(b,'en'));
  const mobile=viewport.width<=760,left=reserved.left??(mobile?12:24),right=viewport.width-(reserved.right??(mobile?12:320));
  const top=reserved.top??40,bottom=viewport.height-(reserved.bottom??(mobile?220:90)),width=Math.max(1,right-left),height=Math.max(1,bottom-top);
  let pageSize=mobile?4:8;
  if(!mobile&&(width<650||height<500))pageSize=4;
  if(width<360||height<360)pageSize=2;
  if(width<310||height<290)pageSize=1;
  const totalPages=Math.max(1,Math.ceil(neighbors.length/pageSize)),currentPage=clamp(Number.isFinite(page)?Math.floor(page):0,0,totalPages-1);
  const neighborIds=neighbors.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  const view=norm(cameraDirection),rightAxis=norm(cross(Math.abs(view.y)>.96?{x:0,y:0,z:1}:{x:0,y:1,z:0},view)),up=norm(cross(view,rightAxis));
  const focal=viewport.height/(2*Math.tan(FOV*Math.PI/360));
  const cssHeight=Math.min(mobile?140:178,Math.max(100,height/(pageSize>=4?3.5:2.2)));
  const distance=focal*H/cssHeight;
  // Framing leaves the HUD free; only the camera aim is offset, never the selected node.
  const cx=pageSize<=2?left+width*.29:(left+right)/2,cy=(top+bottom)/2;
  const offsetX=(viewport.width/2-cx)*distance/focal,offsetY=(cy-viewport.height/2)*distance/focal;
  const world=(x:number,y:number,d:number):SpatialVector=>({
    x:anchor.x+rightAxis.x*x+up.x*y+view.x*d,
    y:anchor.y+rightAxis.y*x+up.y*y+view.y*d,
    z:anchor.z+rightAxis.z*x+up.z*y+view.z*d,
  });
  const entryTarget=world(offsetX,offsetY,0),entryPosition={x:entryTarget.x+view.x*distance,y:entryTarget.y+view.y*distance,z:entryTarget.z+view.z*distance};
  const particleLocal=(p:Particle):SpatialVector=>{const scale=(distance-p.d)/focal;return{x:offsetX+(p.x-viewport.width/2)*scale,y:offsetY-(p.y-viewport.height/2)*scale,z:p.d};};
  const relative=neighborIds.map(id=>{const node=byId.get(id)!;return{id,delta:{x:node.x-anchor.x,y:node.y-anchor.y,z:node.z-anchor.z}};});
  const maximum=Math.max(1,...relative.map(row=>Math.hypot(row.delta.x,row.delta.y,row.delta.z)));
  const particles:Particle[]=selected?[{id:selectedId,selected:true,x:cx,y:cy,d:0,homeX:cx,homeY:cy,homeD:0}]:[];
  for(const row of relative){
    const dx=dot(row.delta,rightAxis),dy=-dot(row.delta,up),r=Math.hypot(dx,dy);
    const angle=(r>1e-6?Math.atan2(dy,dx):seed(row.id+'angle')*Math.PI*2)+(seed(row.id+'jitter')-.5)*.28;
    const radius=Math.min(width,height,mobile?560:720)*(.18+.27*Math.sqrt(Math.hypot(row.delta.x,row.delta.y,row.delta.z)/maximum))*(.86+seed(row.id+'radius')*.28);
    const x=cx+Math.cos(angle)*radius,y=cy+Math.sin(angle)*radius;
    const depthLimit=mobile?.115:.23;
    let d=distance*clamp(dot(row.delta,view)/maximum*(mobile?.075:.14)+(seed(row.id+'depth')-.5)*(mobile?.075:.20),-depthLimit,depthLimit);
    if(Math.abs(d)<distance*.025)d=(seed(row.id+'sign')>.5?1:-1)*distance*.025;
    particles.push({id:row.id,selected:false,x,y,d,homeX:x,homeY:y,homeD:d});
  }
  const size=(p:Particle)=>({w:W*focal/(distance-p.d),h:H*focal/(distance-p.d)});
  // World-space repulsion preserves depth. Entry-view rectangle repulsion is
  // applied once in this frozen view basis to make the initial reading legible.
  for(let iteration=0;iteration<460;iteration++){
    const force=particles.map(p=>({x:(p.homeX-p.x)*(.025+seed(p.id+'spring')*.01),y:(p.homeY-p.y)*(.025+seed(p.id+'spring')*.01),d:(p.homeD-p.d)*.035}));
    const local=particles.map(particleLocal);
    for(let a=0;a<particles.length;a++)for(let b=a+1;b<particles.length;b++){
      const one=particles[a],two=particles[b],oa=local[a],ob=local[b];
      const wx=ob.x-oa.x,wy=ob.y-oa.y,wz=ob.z-oa.z,worldLength=Math.max(1,Math.hypot(wx,wy,wz));
      const repulsion=1.2*(1-iteration/600)/(1+worldLength*worldLength/(H*H));
      const px=wx/worldLength*repulsion*focal/distance,py=-wy/worldLength*repulsion*focal/distance,pd=wz/worldLength*repulsion*.16;
      if(!one.selected){force[a].x-=px;force[a].y-=py;force[a].d-=pd;}
      if(!two.selected){force[b].x+=px;force[b].y+=py;force[b].d+=pd;}
      const sa=size(one),sb=size(two);let dx=two.x-one.x,dy=two.y-one.y;
      const needX=(sa.w+sb.w)/2+GAP,needY=(sa.h+sb.h)/2+GAP;
      if(Math.abs(dx)<needX&&Math.abs(dy)<needY){
        if(Math.hypot(dx,dy)<.1){const angle=seed(one.id+two.id)*Math.PI*2;dx=Math.cos(angle);dy=Math.sin(angle);}
        const grow=Math.min(needX/Math.max(.1,Math.abs(dx)),needY/Math.max(.1,Math.abs(dy)))-1;
        const factor=(one.selected||two.selected?1:.5)*.72;
        if(!one.selected){force[a].x-=dx*grow*factor;force[a].y-=dy*grow*factor;}
        if(!two.selected){force[b].x+=dx*grow*factor;force[b].y+=dy*grow*factor;}
      }
    }
    for(let i=1;i<particles.length;i++){
      const p=particles[i];p.x+=clamp(force[i].x,-22,22);p.y+=clamp(force[i].y,-22,22);p.d=clamp(p.d+force[i].d,-distance*.25,distance*.25);
      const dimensions=size(p);p.x=clamp(p.x,left+dimensions.w/2+5,right-dimensions.w/2-5);p.y=clamp(p.y,top+dimensions.h/2+5,bottom-dimensions.h/2-5);
    }
  }
  // Escape occasional force minima at a viewport boundary. Search continuously
  // around the settled position, without rows, slots, or an equal-radius ring.
  const overlaps=(one:Particle,two:Particle)=>{const a=size(one),b=size(two);return Math.abs(one.x-two.x)<(a.w+b.w)/2+5&&Math.abs(one.y-two.y)<(a.h+b.h)/2+5;};
  const goldenAngle=Math.PI*(3-Math.sqrt(5));
  for(let pass=0;pass<3;pass++)for(let i=1;i<particles.length;i++){
    const particle=particles[i];if(!particles.some((other,index)=>index!==i&&overlaps(particle,other)))continue;
    const originX=particle.x,originY=particle.y,dimensions=size(particle),phase=seed(particle.id+'escape')*Math.PI*2;
    let found=false;
    for(let attempt=1;attempt<=5000;attempt++){
      const radius=Math.sqrt(attempt)*8,angle=phase+attempt*goldenAngle;
      particle.x=originX+Math.cos(angle)*radius;particle.y=originY+Math.sin(angle)*radius;
      if(particle.x-dimensions.w/2<left+4||particle.x+dimensions.w/2>right-4||particle.y-dimensions.h/2<top+4||particle.y+dimensions.h/2>bottom-4)continue;
      if(!particles.some((other,index)=>index!==i&&overlaps(particle,other))){found=true;break;}
    }
    if(!found){particle.x=originX;particle.y=originY;}
  }
  const targets=particles.map(p=>{const local=particleLocal(p),position=p.selected?anchor:world(local.x,local.y,local.z);return{id:p.id,x:position.x,y:position.y,z:position.z,selected:p.selected};});
  const center=targets.length?targets.reduce((sum,p)=>({x:sum.x+p.x/targets.length,y:sum.y+p.y/targets.length,z:sum.z+p.z/targets.length}),{x:0,y:0,z:0}):anchor;
  const radius=Math.max(H,...targets.map(p=>Math.hypot(p.x-center.x,p.y-center.y,p.z-center.z)+H*.65));
  return{id:selectedId,page:currentPage,pageSize,total:neighbors.length,totalPages,neighborIds,targets,bounds:{center,radius},viewDirection:view,entryCamera:{position:entryPosition,target:entryTarget,up,fov:FOV}};
}
