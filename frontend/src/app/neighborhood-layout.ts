/** Reading callouts only. Actual graph positions are never modified by this layout. */
export const NEIGHBORHOOD_PAGE_SIZE = 8;
export const NEIGHBORHOOD_MOBILE_PAGE_SIZE = 4;
export interface NeighborhoodCard { id:string; selected:boolean; x:number; y:number; w:number; h:number; }
export interface NeighborhoodLayout {
  id:string; page:number; pageSize:number; total:number; totalPages:number;
  neighborIds:string[]; cards:NeighborhoodCard[];
}
export interface NeighborhoodViewport { width:number; height:number; }
export interface NeighborhoodReserve { left?:number; right?:number; top?:number; bottom?:number; }

export function getNeighborhoodLayout(
  nodes:ReadonlyArray<{id:string;degree:number}>,
  edges:ReadonlyArray<{source:string;target:string}>,
  selectedId:string,page:number,viewport:NeighborhoodViewport,reserved:NeighborhoodReserve={},
):NeighborhoodLayout {
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const ids=new Set<string>();
  for(const edge of edges){
    if(edge.source===selectedId&&edge.target!==selectedId&&byId.has(edge.target))ids.add(edge.target);
    if(edge.target===selectedId&&edge.source!==selectedId&&byId.has(edge.source))ids.add(edge.source);
  }
  const neighbors=[...ids].sort((a,b)=>byId.get(b)!.degree-byId.get(a)!.degree||a.localeCompare(b,'en'));
  const mobile=viewport.width<=760;
  const left=reserved.left??(mobile?12:24),right=viewport.width-(reserved.right??(mobile?12:320));
  const top=reserved.top??40,bottom=viewport.height-(reserved.bottom??(mobile?220:90));
  const width=Math.max(1,right-left),height=Math.max(1,bottom-top),cx=(left+right)/2,cy=(top+bottom)/2;
  const selectedH=Math.min(mobile?160:220,height-8),selectedW=selectedH*.75;
  const desktopNeighborH=Math.min(190,(height-24)/3,(height-selectedH-24)/2,(width-selectedW-32)/1.5);
  let pageSize=mobile?NEIGHBORHOOD_MOBILE_PAGE_SIZE:NEIGHBORHOOD_PAGE_SIZE;
  if(!mobile&&desktopNeighborH<140)pageSize=4;
  if(pageSize===4&&(width<selectedW+210+24||height<292))pageSize=2;
  if(pageSize===2&&height<selectedH+160)pageSize=1;
  const totalPages=Math.max(1,Math.ceil(neighbors.length/pageSize));
  const currentPage=Math.max(0,Math.min(totalPages-1,Number.isFinite(page)?Math.floor(page):0));
  const neighborIds=neighbors.slice(currentPage*pageSize,(currentPage+1)*pageSize);
  const cards:NeighborhoodCard[]=[];
  const put=(id:string,x:number,y:number,h:number,selected=false)=>cards.push({id,x,y,w:h*.75,h,selected});
  if(!byId.has(selectedId))return{id:selectedId,page:0,pageSize,total:0,totalPages:1,neighborIds:[],cards:[]};
  if(pageSize===8){
    const h=Math.max(140,desktopNeighborH),w=h*.75;
    put(selectedId,cx,cy,selectedH,true);
    const xs=[left+w/2,cx,right-w/2],ys=[top+h/2,cy,bottom-h/2];
    const slots=[[0,0],[1,0],[2,0],[2,1],[2,2],[1,2],[0,2],[0,1]];
    neighborIds.forEach((id,i)=>put(id,xs[slots[i][0]],ys[slots[i][1]],h));
  }else if(pageSize===4){
    const h=Math.min(160,Math.max(140,(width-selectedW-24)/1.5)),w=h*.75;
    put(selectedId,cx,cy,selectedH,true);
    const slots=[[left+w/2,top+h/2],[right-w/2,top+h/2],[right-w/2,bottom-h/2],[left+w/2,bottom-h/2]];
    neighborIds.forEach((id,i)=>put(id,slots[i][0],slots[i][1],h));
  }else if(pageSize===2){
    put(selectedId,cx,top+selectedH/2,selectedH,true);
    const h=140,w=h*.75,slots=[[left+w/2,bottom-h/2],[right-w/2,bottom-h/2]];
    neighborIds.forEach((id,i)=>put(id,slots[i][0],slots[i][1],h));
  }else{
    put(selectedId,left+selectedW/2,cy,selectedH,true);
    if(neighborIds[0])put(neighborIds[0],right-52.5,cy,140);
  }
  return{id:selectedId,page:currentPage,pageSize,total:neighbors.length,totalPages,neighborIds,cards};
}
