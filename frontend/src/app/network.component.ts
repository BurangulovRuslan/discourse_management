import {
  AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, EventEmitter,
  HostBinding, Input, NgZone, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild,
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { paintCover } from './cover-art';
import { getNeighborhoodLayout, NeighborhoodCard, NeighborhoodLayout } from './neighborhood-layout';
export { NEIGHBORHOOD_PAGE_SIZE, NEIGHBORHOOD_MOBILE_PAGE_SIZE } from './neighborhood-layout';

export interface NetworkNode { id: string; type: string; label: string; x: number; y: number; z?: number; degree: number; }
export interface NetworkEdge { source: string; target: string; analytical: boolean; }
interface ActualCurve { source: number; target: number; a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; d: THREE.Vector3; analytical: boolean; length: number; }
interface ProjectedNode { index: number; id: string; x: number; y: number; w: number; h: number; depth: number; }
interface AccessibleCover { id: string; label: string; x: number; y: number; w: number; h: number; }
interface DetailCover { sprite: THREE.Sprite; texture: THREE.CanvasTexture; material: THREE.SpriteMaterial; node: NetworkNode; }
interface CameraFlight { fromEye: THREE.Vector3; toEye: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; started: number; duration: number; }

const COVER_W = 168, COVER_H = 224, ATLAS_SIZE = 2048, TILE_W = 24, TILE_H = 32, DETAIL_BUDGET = 24, CURVE_STEPS = 10;
// The same field is evaluated by graph vertices, spline vertices, particles and CPU hit targets.
const WAVE_GLSL = `
  vec3 flowing(vec3 p) {
    return p + vec3(sin(p.y*.0019+uTime*.34)*7.0+sin(p.x*.0011+uTime*.2414)*2.5,
      cos(p.x*.0017+uTime*.2992)*6.5+sin(p.y*.0013+uTime*.2176)*2.5,
      sin(p.x*.0013+p.y*.0011+uTime*.265)*8.0) * uMotion;
  }
`;
const CARD_VERTEX = `
  uniform float uTime; uniform float uMotion; uniform float uHeight;
  attribute vec3 aCenter; attribute vec2 aTile; attribute float aHeat; attribute float aVisible;
  varying vec2 vUv; varying float vHeat; varying float vSize; varying float vDepth; varying float vVisible;
  ${WAVE_GLSL}
  void main() {
    vec4 center = modelViewMatrix * vec4(flowing(aCenter),1.0);
    float size = 224.0 * projectionMatrix[1][1] * uHeight*.5 / max(1.0,-center.z);
    float cap = min(1.0,276.0/max(1.0,size));
    center.xy += position.xy * cap * (1.0 + .022 * min(aHeat,1.0));
    // Reject distant paper in the vertex stage, avoiding thousands of large
    // transparent/discarded quads on the GPU; every node still has its point.
    gl_Position = aVisible<.5 || size<74.0 ? vec4(2.0,2.0,2.0,1.0) : projectionMatrix * center;
    vUv = aTile + uv * vec2(22.0/2048.0,30.0/2048.0);
    vHeat=aHeat; vSize=min(276.0,size); vDepth=-center.z; vVisible=aVisible;
  }
`;
const CARD_FRAGMENT = `
  uniform sampler2D uAtlas; uniform float uFog;
  varying vec2 vUv; varying float vHeat; varying float vSize; varying float vDepth; varying float vVisible;
  void main() {
    // The overview is a neural point-and-spline cloud. Opaque paper is reserved
    // for the explicitly decluttered, readable foreground neighborhood.
    if(vSize<74.0 || vVisible<.5) discard;
    vec4 paper=texture2D(uAtlas,vUv);
    float light = mix(.26,1.0,smoothstep(12.0,110.0,vSize));
    float fog = max(.18,exp(-vDepth/uFog));
    gl_FragColor = vec4(paper.rgb*light*fog,paper.a);
    #include <colorspace_fragment>
  }
`;
const LINE_VERTEX = `
  uniform float uTime; uniform float uMotion;
  attribute float aKind; attribute float aDistance;
  varying float vKind; varying float vDistance; varying float vDepth;
  ${WAVE_GLSL}
  void main(){vec4 p=modelViewMatrix*vec4(flowing(position),1.0);gl_Position=projectionMatrix*p;vKind=aKind;vDistance=aDistance;vDepth=-p.z;}
`;
const LINE_FRAGMENT = `
  uniform vec3 uColor; uniform float uOpacity; uniform float uFog;
  varying float vKind; varying float vDistance; varying float vDepth;
  void main(){if(vKind>.5 && mod(vDistance,36.0)>20.0) discard;
    gl_FragColor=vec4(uColor,uOpacity*max(.15,exp(-vDepth/uFog)));
    #include <colorspace_fragment>
  }
`;
const POINT_VERTEX = `
  uniform float uTime; uniform float uMotion; uniform float uDpr;
  attribute float aDegree; attribute float aHeat;
  varying float vHeat; varying float vDepth;
  ${WAVE_GLSL}
  void main(){vec4 p=modelViewMatrix*vec4(flowing(position),1.0);gl_Position=projectionMatrix*p;
    gl_PointSize=uDpr*(1.65+min(3.5,log(1.0+aDegree)*.52)+aHeat*1.5);vHeat=aHeat;vDepth=-p.z;}
`;
const POINT_FRAGMENT = `
  uniform float uFog;
  varying float vHeat; varying float vDepth;
  void main(){float r=length(gl_PointCoord-vec2(.5));if(r>.5)discard;
    vec3 color=mix(vec3(.34,.42,.47),vec3(1.0,.79,.36),min(1.0,vHeat));
    gl_FragColor=vec4(color,pow(1.0-r*2.0,1.4)*max(.15,exp(-vDepth/uFog))*(.55+vHeat*.3));
    #include <colorspace_fragment>
  }
`;
const PARTICLE_VERTEX = `
  uniform float uTime; uniform float uMotion; uniform float uDpr; uniform float uSize;
  attribute vec3 aStart; attribute vec3 aC1; attribute vec3 aC2; attribute vec3 aEnd;
  attribute float aPhase; attribute float aSpeed;
  ${WAVE_GLSL}
  void main(){float t=fract(aPhase+uTime*.038*aSpeed);float s=1.0-t;
    vec3 p=s*s*s*aStart+3.0*s*s*t*aC1+3.0*s*t*t*aC2+t*t*t*aEnd;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(flowing(p),1.0);gl_PointSize=uDpr*uSize;}
`;
const PARTICLE_FRAGMENT = `
  uniform float uOpacity;
  void main(){float r=length(gl_PointCoord-vec2(.5));if(r>.5)discard;
    gl_FragColor=vec4(vec3(1.0,.77,.27),pow(1.0-r*2.0,1.1)*uOpacity);
    #include <colorspace_fragment>
  }
`;

@Component({
  selector: 'app-network', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    tabindex: '0', role: 'region',
    'aria-label': 'Трёхмерная ризома. Мышь вращает, правая кнопка или Shift перемещает, колесо приближает. Стрелки перемещают, A D W S вращают, плюс и минус меняют масштаб, ноль показывает всю сеть. Tab — видимые обложки, Enter — выбрать узел и перейти к связям. Поиск всех материалов: Ctrl K.',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    <canvas #surface aria-hidden="true"></canvas>
    <div class="accessible-covers" aria-label="Материалы в видимой области">
      @for(cover of accessibleCovers;track cover.id){
        <button class="cover-keyboard-target" [style.left.px]="cover.x" [style.top.px]="cover.y"
          [style.width.px]="cover.w" [style.height.px]="cover.h" [attr.aria-label]="cover.label"
          (focus)="focusCover(cover.id)" (blur)="blurCover()" (click)="selectNode(cover.id)"></button>
      }
    </div>
    @if(renderError){<div class="render-error" role="status"><strong>Для 3D-карты нужен WebGL.</strong><span>Все материалы доступны через указатель и поиск.</span></div>}
    <span class="network-status" aria-live="polite">{{status}}</span>
  `,
  styles: `
    :host{display:block;position:relative;width:100%;height:100%;min-height:0;overflow:hidden;background:#090c10;outline:none}
    :host:focus-visible{box-shadow:inset 0 0 0 1px #c4a36c}
    canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}canvas:active{cursor:grabbing}
    .accessible-covers{position:absolute;inset:0;pointer-events:none}
    .cover-keyboard-target{position:absolute;display:block;padding:0;border:0;border-radius:0;opacity:0;background:transparent;pointer-events:none}
    .cover-keyboard-target:focus-visible{opacity:1;outline:2px solid #e9c36d;outline-offset:5px;box-shadow:0 0 24px #e7c77733}
    .network-status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    .render-error{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:18px;text-align:center;padding:25px;color:#d2c6b2;font:13px Georgia,serif}.render-error strong{font-size:25px;font-weight:400}
  `,
})
export class NetworkComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() nodes: NetworkNode[] = [];
  @Input() edges: NetworkEdge[] = [];
  @Input() activeId: string | null = null;
  @Input() focusId: string | null = null;
  @Input() motionPaused = false;
  @Input() neighborhoodPage = 0;
  @Input() zoomAction: {kind:'in'|'out'|'fit';seq:number}|null = null;
  @Output() nodeSelect = new EventEmitter<string>();
  @Output() viewportChange = new EventEmitter<{zoom:number}>();
  @Output() neighborhoodChange = new EventEmitter<Omit<NeighborhoodLayout,'cards'>>();
  @HostBinding('attr.data-node-count') get nodeCount(){return this.nodes.length;}
  @HostBinding('attr.data-edge-count') get edgeCount(){return this.edges.length;}
  @HostBinding('attr.data-cover-count') get coverCount(){return this.nodes.length;}
  @HostBinding('attr.data-dimensions') readonly dimensions=3;
  @HostBinding('attr.data-renderer') rendererState='initializing';
  @HostBinding('attr.data-visible-cover-count') visibleCoverCount=0;
  @HostBinding('attr.data-detail-cover-count') detailCoverCount=0;
  @HostBinding('attr.data-camera-scale') cameraScale=1;
  @HostBinding('attr.data-camera-distance') cameraDistance=0;
  @HostBinding('attr.data-motion') motionState='running';
  @HostBinding('attr.data-atlas-ready') atlasReady=false;
  @HostBinding('attr.data-neighborhood-id') get neighborhoodId(){return this.neighborhood?.id??null;}
  @HostBinding('attr.data-neighborhood-page') get neighborhoodCurrentPage(){return this.neighborhood?.page??null;}
  @HostBinding('attr.data-neighborhood-page-size') get neighborhoodPageSize(){return this.neighborhood?.pageSize??null;}
  @HostBinding('attr.data-neighborhood-total') get neighborhoodTotal(){return this.neighborhood?.total??null;}
  @HostBinding('attr.data-neighborhood-neighbor-ids') get neighborhoodIds(){return this.neighborhood?JSON.stringify(this.neighborhood.neighborIds):null;}
  @ViewChild('surface',{static:true}) private surface!:ElementRef<HTMLCanvasElement>;
  accessibleCovers:AccessibleCover[]=[];
  status=''; renderError=false;

  private renderer:THREE.WebGLRenderer|null=null;
  private scene=new THREE.Scene();
  private camera=new THREE.PerspectiveCamera(42,1,1,100000);
  private controls:OrbitControls|null=null;
  private graph=new THREE.Group();
  private width=0;private height=0;private dpr=1;
  private frame=0;private lastFrame=0;private elapsed=0;private lastProjection=0;private lastDom=0;
  private initialized=false;private started=false;private destroyed=false;private reduced=false;
  private resizeObserver:ResizeObserver|null=null;private cleanup:(()=>void)[]=[];
  private timeUniform={value:0};private motionUniform={value:1};
  private nodeMap=new Map<string,NetworkNode>();private indices=new Map<string,number>();
  private adjacency=new Map<string,Set<string>>();private positions:THREE.Vector3[]=[];
  private curves:ActualCurve[]=[];private projected:ProjectedNode[]=[];private foreground:ProjectedNode[]=[];
  private nodeHeat:THREE.InstancedBufferAttribute|null=null;private cardVisibility:THREE.InstancedBufferAttribute|null=null;
  private pointHeat:THREE.BufferAttribute|null=null;
  private highlight:THREE.LineSegments|null=null;private activeParticles:THREE.Points|null=null;
  private baseLines:THREE.LineSegments|null=null;
  private sourceFrame:THREE.Sprite|null=null;private sourceFrameTexture:THREE.CanvasTexture|null=null;
  private details=new Map<string,DetailCover>();private hoveredId:string|null=null;private keyboardId:string|null=null;
  private textureCache=new Map<string,THREE.CanvasTexture>();private pendingDetails:ProjectedNode[]=[];
  private highlightId:string|null=null;private atlas:THREE.CanvasTexture|null=null;private atlasTimer:ReturnType<typeof setTimeout>|null=null;
  private atlasGeneration=0;private center=new THREE.Vector3();private radius=2000;private fitDistance=6000;
  private flight:CameraFlight|null=null;private controlsMoving=false;private lastControlChange=0;
  private pointerStart:{x:number;y:number;id:number}|null=null;private pointerMoved=false;
  private pointerIds=new Set<number>();private multiPointer=false;
  private lastZoom=-1;private temp=new THREE.Vector3();private viewTemp=new THREE.Vector3();private ndc=new THREE.Vector3();
  private inverseView=new THREE.Matrix4();private right=new THREE.Vector3();private up=new THREE.Vector3();
  private neighborhood:NeighborhoodLayout|null=null;
  private neighborhoodTethers:THREE.LineSegments|null=null;
  private overlayTargets=new Map<string,{position:THREE.Vector3;scale:THREE.Vector3}>();
  private forward=new THREE.Vector3();
  private highlightSignature='';
  private calloutFrom=new Map<string,NeighborhoodCard>();private calloutTransitionStart=0;

  constructor(private zone:NgZone,private cdr:ChangeDetectorRef){}

  ngAfterViewInit():void{
    const canvas=this.surface.nativeElement;
    try{
      this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
      this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.setClearColor(0x090c10,1);
      this.rendererState='webgl';
    }catch{
      this.renderError=true;this.rendererState='unavailable';this.cdr.markForCheck();return;
    }
    this.scene.background=new THREE.Color(0x090c10);this.scene.add(this.graph);
    this.camera.position.set(1500,900,2600);
    this.controls=new OrbitControls(this.camera,canvas);
    this.controls.enableDamping=true;this.controls.dampingFactor=.09;this.controls.rotateSpeed=.55;
    this.controls.panSpeed=.72;this.controls.zoomSpeed=.75;this.controls.zoomToCursor=true;
    this.controls.minDistance=200;this.controls.maxDistance=50000;this.controls.autoRotateSpeed=.14;
    this.controls.addEventListener('start',()=>{this.flight=null;this.controlsMoving=true;this.requestDraw();});
    this.controls.addEventListener('end',()=>{this.controlsMoving=false;this.lastControlChange=performance.now();this.requestDraw();});
    this.controls.addEventListener('change',()=>{this.lastControlChange=performance.now();this.requestDraw();});
    this.initialized=true;
    this.zone.runOutsideAngular(()=>{
      const media=window.matchMedia('(prefers-reduced-motion: reduce)');this.reduced=media.matches;
      const changed=()=>{this.reduced=media.matches;if(this.controls)this.controls.enableDamping=!this.reduced;this.updateMotion();this.requestDraw();};
      media.addEventListener('change',changed);this.cleanup.push(()=>media.removeEventListener('change',changed));
      this.listen(canvas,'pointerdown',e=>this.onPointerDown(e as PointerEvent));
      this.listen(canvas,'pointermove',e=>this.onPointerMove(e as PointerEvent));
      this.listen(canvas,'pointerup',e=>this.onPointerUp(e as PointerEvent));
      this.listen(canvas,'pointerleave',()=>{if(!this.controlsMoving&&!this.keyboardId)this.setHovered(null);});
      this.listen(canvas,'pointercancel',e=>{this.pointerIds.delete((e as PointerEvent).pointerId);this.pointerStart=null;this.pointerMoved=true;if(!this.pointerIds.size)this.multiPointer=false;});
      this.listen(canvas,'webglcontextlost',e=>{e.preventDefault();this.rendererState='lost';this.renderError=true;this.cdr.markForCheck();});
      this.listen(canvas,'webglcontextrestored',()=>{this.rendererState='webgl';this.renderError=false;this.cdr.markForCheck();this.requestDraw();});
      this.listen(document,'visibilitychange',()=>{this.lastFrame=0;this.updateMotion();if(!document.hidden)this.requestDraw();});
      this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);
      this.rebuildGraph();this.resize();this.updateMotion();
    });
  }

  ngOnChanges(changes:SimpleChanges):void{
    if(!this.initialized)return;
    if(changes['nodes']||changes['edges'])this.rebuildGraph();
    if(changes['activeId']){
      if(!this.activeId&&this.neighborhood)this.clearNeighborhood();
      this.updateHighlight();
    }
    if(changes['focusId']&&this.focusId)this.focusNode(this.focusId);
    else if(changes['neighborhoodPage']&&this.neighborhood)this.setNeighborhood(this.neighborhood.id,this.neighborhoodPage,false);
    if(changes['zoomAction']&&this.zoomAction){
      if(this.zoomAction.kind==='fit')this.fit();else this.zoom(this.zoomAction.kind==='in'?1/1.35:1.35);
    }
    if(changes['motionPaused']){this.lastFrame=0;this.updateMotion();}
    this.requestDraw();
  }

  ngOnDestroy():void{
    this.destroyed=true;cancelAnimationFrame(this.frame);this.resizeObserver?.disconnect();
    this.cleanup.forEach(fn=>fn());this.controls?.dispose();this.atlasGeneration++;
    if(this.atlasTimer)clearTimeout(this.atlasTimer);this.disposeGraph();this.renderer?.dispose();
  }

  selectNode(id:string):void{this.zone.run(()=>this.nodeSelect.emit(id));}
  focusCover(id:string):void{this.keyboardId=id;this.setHovered(id);}
  blurCover():void{this.keyboardId=null;this.setHovered(null);}
  typeLabel(type:string):string{
    const labels:Record<string,string>={book:'Книга',theme:'Тема',construct:'Понятие',thinker:'Автор',experiment:'Эпизод',code:'Код',proposition:'Тезис',chain_step:'Аргумент',trajectory_stage:'Стадия понятия',work:'Работа',citation:'Библиография'};
    return labels[type]??type;
  }

  /** A genuine 3D neighborhood; the article selection does not choose the entry point. */
  readMap():void{
    this.clearNeighborhood();
    const anchor=this.readingAnchor();if(anchor!==undefined)this.flyTo(this.positions[anchor],this.readingDistance());
    this.setHovered(null);this.status='Область чтения. Вращайте пространство и выбирайте обложки, чтобы перейти к связям.';
  }

  focusNode(id:string):void{
    this.focusNeighborhood(id,this.neighborhoodPage);
  }

  focusNeighborhood(id:string,page=0):void{
    this.setNeighborhood(id,page,true);
  }

  private setNeighborhood(id:string,page:number,fly:boolean):void{
    const index=this.indices.get(id);if(index===undefined||!this.controls||!this.width||!this.height)return;
    this.calloutFrom=new Map(this.foreground.map(p=>[p.id,{id:p.id,selected:p.id===this.neighborhood?.id,x:p.x,y:p.y,w:p.w,h:p.h}]));
    this.calloutTransitionStart=performance.now();
    this.neighborhood=getNeighborhoodLayout(this.nodes,this.edges,id,page,{width:this.width,height:this.height});
    this.hoveredId=null;this.keyboardId=null;this.lastProjection=0;this.highlightSignature='';
    this.buildNeighborhoodTethers();this.updateHighlight(id);
    if(fly){
      this.camera.updateMatrixWorld();
      const selected=this.neighborhood.cards[0],focal=this.height/(2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)));
      const distance=Math.max(500,focal*COVER_H/Math.max(140,selected.h));
      this.right.setFromMatrixColumn(this.camera.matrixWorld,0);this.up.setFromMatrixColumn(this.camera.matrixWorld,1);
      const framing=this.positions[index].clone().addScaledVector(this.right,-(selected.x-this.width/2)*distance/focal)
        .addScaledVector(this.up,-(this.height/2-selected.y)*distance/focal);
      this.flyTo(framing,distance,980);
    }
    const {cards,...state}=this.neighborhood;
    this.zone.run(()=>{this.neighborhoodChange.emit(state);this.cdr.markForCheck();});
    const node=this.nodes[index];this.status=`${node.label}. Связанных материалов: ${state.total}. Выносные обложки привязаны к реальным узлам тонкими линиями.`;
    this.requestDraw();
  }

  private clearNeighborhood():void{
    this.neighborhood=null;this.overlayTargets.clear();this.calloutFrom.clear();this.highlightSignature='';
    if(this.neighborhoodTethers){this.graph.remove(this.neighborhoodTethers);this.neighborhoodTethers.geometry.dispose();(this.neighborhoodTethers.material as THREE.Material).dispose();this.neighborhoodTethers=null;}
    this.lastProjection=0;
  }

  private buildNeighborhoodTethers():void{
    if(this.neighborhoodTethers){this.graph.remove(this.neighborhoodTethers);this.neighborhoodTethers.geometry.dispose();(this.neighborhoodTethers.material as THREE.Material).dispose();}
    if(!this.neighborhood){this.neighborhoodTethers=null;return;}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(this.neighborhood.cards.length*6),3));
    const material=new THREE.LineDashedMaterial({color:0xa2b4bd,transparent:true,opacity:.28,dashSize:10,gapSize:9,depthTest:false,depthWrite:false});
    this.neighborhoodTethers=new THREE.LineSegments(geometry,material);this.neighborhoodTethers.frustumCulled=false;this.neighborhoodTethers.renderOrder=2;this.graph.add(this.neighborhoodTethers);
  }

  onKeydown(event:KeyboardEvent):void{
    if(event.target!==event.currentTarget||!this.controls)return;
    const key=event.key.toLowerCase();
    if(['arrowleft','arrowright','arrowup','arrowdown','a','d','w','s','+','=','-','_','0','enter','escape'].includes(key))event.preventDefault();else return;
    if(key==='0')this.fit();
    else if(key==='enter'){const id=this.keyboardId??this.hoveredId??this.activeId??this.foreground[0]?.id;if(id)this.selectNode(id);}
    else if(key==='escape')this.setHovered(null);
    else if(['+','=','-','_'].includes(key))this.zoom(['+','='].includes(key)?1/1.3:1.3);
    else if(['a','d','w','s'].includes(key)){
      this.flight=null;const offset=this.camera.position.clone().sub(this.controls.target);
      const axis=['a','d'].includes(key)?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion);
      offset.applyAxisAngle(axis,(key==='a'||key==='w'?1:-1)*.065);this.camera.position.copy(this.controls.target).add(offset);this.controls.update();
    }else{
      this.flight=null;const amount=this.camera.position.distanceTo(this.controls.target)*(event.shiftKey?.17:.065);
      this.right.setFromMatrixColumn(this.camera.matrixWorld,0);this.up.setFromMatrixColumn(this.camera.matrixWorld,1);
      const delta=key==='arrowleft'?this.right.multiplyScalar(-amount):key==='arrowright'?this.right.multiplyScalar(amount):key==='arrowup'?this.up.multiplyScalar(amount):this.up.multiplyScalar(-amount);
      this.camera.position.add(delta);this.controls.target.add(delta);this.controls.update();
    }
    this.requestDraw();
  }

  private listen(target:EventTarget,name:string,fn:EventListener):void{target.addEventListener(name,fn);this.cleanup.push(()=>target.removeEventListener(name,fn));}
  private updateMotion():void{
    this.motionState=this.reduced?'reduced':document.hidden?'hidden':this.motionPaused?'paused':'running';
    if(this.controls)this.controls.enableDamping=!this.reduced;
    this.motionUniform.value=this.reduced?0:1;
    this.zone.run(()=>this.cdr.markForCheck());
  }

  private rebuildGraph():void{
    this.disposeGraph();this.graph=new THREE.Group();this.scene.add(this.graph);
    this.nodeMap=new Map(this.nodes.map(n=>[n.id,n]));this.indices=new Map(this.nodes.map((n,i)=>[n.id,i]));
    this.adjacency.clear();this.positions=this.nodes.map(n=>new THREE.Vector3(n.x,n.y,n.z??0));
    const bounds=new THREE.Box3().setFromPoints(this.positions);bounds.getCenter(this.center);
    this.radius=Math.max(600,...this.positions.map(position=>position.distanceTo(this.center)));
    const halfFov=THREE.MathUtils.degToRad(this.camera.fov/2);this.fitDistance=this.radius/Math.sin(halfFov)*1.12;
    this.camera.far=Math.max(100000,this.fitDistance*12);this.camera.updateProjectionMatrix();
    if(this.controls)this.controls.maxDistance=this.fitDistance*3;
    for(const edge of this.edges){
      if(!this.indices.has(edge.source)||!this.indices.has(edge.target))continue;
      if(!this.adjacency.has(edge.source))this.adjacency.set(edge.source,new Set());
      if(!this.adjacency.has(edge.target))this.adjacency.set(edge.target,new Set());
      this.adjacency.get(edge.source)!.add(edge.target);this.adjacency.get(edge.target)!.add(edge.source);
    }
    this.buildCurves();this.buildAtlas();this.buildNodeMesh();this.buildSourceFrame();
    this.baseLines=this.createLines(this.curves,false);this.graph.add(this.baseLines);
    const ambientCurves=this.curves.filter((_,i)=>i%37===0);this.graph.add(this.createParticles(ambientCurves,false));
    if(this.neighborhood)this.setNeighborhood(this.neighborhood.id,this.neighborhood.page,false);else this.updateHighlight();
    if(!this.started&&this.width&&this.height)this.startView();
    this.lastProjection=0;this.requestDraw();
  }

  private disposeGraph():void{
    this.atlasGeneration++;if(this.atlasTimer)clearTimeout(this.atlasTimer);this.atlasTimer=null;
    this.details.clear();this.pendingDetails=[];
    for(const texture of this.textureCache.values())texture.dispose();this.textureCache.clear();
    this.graph.traverse(object=>{
      const renderable=object as THREE.Mesh;
      if(!(object instanceof THREE.Sprite))renderable.geometry?.dispose();
      if(renderable.material){for(const mat of Array.isArray(renderable.material)?renderable.material:[renderable.material])mat.dispose();}
    });
    this.scene.remove(this.graph);this.atlas?.dispose();this.atlas=null;this.sourceFrameTexture?.dispose();this.sourceFrameTexture=null;this.sourceFrame=null;
    this.highlight=null;this.baseLines=null;this.activeParticles=null;this.highlightId=null;this.highlightSignature='';this.neighborhoodTethers=null;
  }

  private buildCurves():void{
    const directions=this.nodes.map(node=>{
      const source=this.positions[this.indices.get(node.id)!],sum=new THREE.Vector3();let count=0;
      for(const id of this.adjacency.get(node.id)??[]){sum.add(this.positions[this.indices.get(id)!]);count++;}
      return count?sum.multiplyScalar(1/count).sub(source).normalize():new THREE.Vector3(0,1,0);
    });
    this.curves=[];
    for(const edge of this.edges){
      const source=this.indices.get(edge.source),target=this.indices.get(edge.target);if(source===undefined||target===undefined)continue;
      const a=this.positions[source].clone(),d=this.positions[target].clone(),direction=d.clone().sub(a),length=direction.length();
      if(length<.001)continue;direction.normalize();
      const curl=new THREE.Vector3(Math.sin(source*.71+target),Math.cos(target*.43+source),Math.sin(target*.19-source)).cross(direction).normalize().multiplyScalar(Math.min(length*.13,180));
      const b=a.clone().add(direction.clone().multiplyScalar(length*.22)).add(directions[source].clone().multiplyScalar(length*.14)).add(curl);
      const c=d.clone().addScaledVector(direction,-length*.22).add(directions[target].clone().multiplyScalar(length*.14)).add(curl);
      this.curves.push({source,target,a,b,c,d,length,analytical:edge.analytical});
    }
  }

  private buildAtlas():void{
    const canvas=document.createElement('canvas');canvas.width=ATLAS_SIZE;canvas.height=ATLAS_SIZE;
    const ctx=canvas.getContext('2d')!;ctx.fillStyle='#171a1b';ctx.fillRect(0,0,ATLAS_SIZE,ATLAS_SIZE);
    const columns=Math.floor(ATLAS_SIZE/TILE_W);
    for(let i=0;i<this.nodes.length;i++){
      const x=i%columns*TILE_W,y=Math.floor(i/columns)*TILE_H;ctx.fillStyle=i%5===0?'#b3a995':'#232629';ctx.fillRect(x+1,y+1,TILE_W-2,TILE_H-2);
    }
    this.atlas=new THREE.CanvasTexture(canvas);this.atlas.colorSpace=THREE.SRGBColorSpace;this.atlas.anisotropy=Math.min(4,this.renderer?.capabilities.getMaxAnisotropy()??1);
    this.atlasReady=false;const generation=++this.atlasGeneration;let cursor=0;
    const chunk=()=>{
      if(this.destroyed||generation!==this.atlasGeneration)return;
      const end=Math.min(cursor+80,this.nodes.length);
      for(;cursor<end;cursor++){
        const x=cursor%columns*TILE_W+1,y=Math.floor(cursor/columns)*TILE_H+1;
        ctx.save();ctx.beginPath();ctx.rect(x,y,TILE_W-2,TILE_H-2);ctx.clip();ctx.translate(x,y);
        const node=this.nodes[cursor],neighbors=[...this.adjacency.get(node.id)??[]].map(id=>this.nodeMap.get(id)!);
        paintCover(ctx,node,{width:TILE_W-2,height:TILE_H-2,serial:cursor+1,neighbors,origin:node,detail:'thumbnail'});ctx.restore();
      }
      if(cursor%400===0||cursor===this.nodes.length){if(this.atlas)this.atlas.needsUpdate=true;this.requestDraw();}
      if(cursor<this.nodes.length)this.atlasTimer=setTimeout(chunk,0);
      else{this.atlasReady=true;this.zone.run(()=>this.cdr.markForCheck());}
    };
    this.atlasTimer=setTimeout(chunk,0);
  }

  private commonUniforms(){return{uTime:this.timeUniform,uMotion:this.motionUniform,uFog:{value:this.radius*4+2200}};}

  private buildNodeMesh():void{
    const base=new THREE.PlaneGeometry(COVER_W,COVER_H);const geometry=new THREE.InstancedBufferGeometry();
    geometry.index=base.index;geometry.setAttribute('position',base.getAttribute('position'));geometry.setAttribute('uv',base.getAttribute('uv'));
    geometry.instanceCount=this.nodes.length;
    const centers=new Float32Array(this.nodes.length*3),tiles=new Float32Array(this.nodes.length*2),degrees=new Float32Array(this.nodes.length),columns=Math.floor(ATLAS_SIZE/TILE_W);
    for(let i=0;i<this.nodes.length;i++){
      this.positions[i].toArray(centers,i*3);degrees[i]=this.nodes[i].degree;
      tiles[i*2]=(i%columns*TILE_W+1)/ATLAS_SIZE;tiles[i*2+1]=1-(Math.floor(i/columns)*TILE_H+TILE_H-1)/ATLAS_SIZE;
    }
    geometry.setAttribute('aCenter',new THREE.InstancedBufferAttribute(centers,3));geometry.setAttribute('aTile',new THREE.InstancedBufferAttribute(tiles,2));
    this.nodeHeat=new THREE.InstancedBufferAttribute(new Float32Array(this.nodes.length),1);geometry.setAttribute('aHeat',this.nodeHeat);
    this.cardVisibility=new THREE.InstancedBufferAttribute(new Float32Array(this.nodes.length),1);geometry.setAttribute('aVisible',this.cardVisibility);
    const material=new THREE.ShaderMaterial({vertexShader:CARD_VERTEX,fragmentShader:CARD_FRAGMENT,uniforms:{...this.commonUniforms(),uAtlas:{value:this.atlas},uHeight:{value:this.height}},side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=1;this.graph.add(mesh);
    const pointsGeometry=new THREE.BufferGeometry();pointsGeometry.setAttribute('position',new THREE.BufferAttribute(centers,3));
    pointsGeometry.setAttribute('aDegree',new THREE.BufferAttribute(degrees,1));this.pointHeat=new THREE.BufferAttribute(new Float32Array(this.nodes.length),1);pointsGeometry.setAttribute('aHeat',this.pointHeat);
    const pointsMaterial=new THREE.ShaderMaterial({vertexShader:POINT_VERTEX,fragmentShader:POINT_FRAGMENT,uniforms:{...this.commonUniforms(),uDpr:{value:this.dpr}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
    const points=new THREE.Points(pointsGeometry,pointsMaterial);points.frustumCulled=false;this.graph.add(points);
  }

  private curvePoint(curve:ActualCurve,t:number,out:THREE.Vector3):THREE.Vector3{
    const s=1-t;return out.set(0,0,0).addScaledVector(curve.a,s*s*s).addScaledVector(curve.b,3*s*s*t).addScaledVector(curve.c,3*s*t*t).addScaledVector(curve.d,t*t*t);
  }

  private createLines(curves:ActualCurve[],active:boolean):THREE.LineSegments{
    const count=curves.length*CURVE_STEPS*2,positions=new Float32Array(count*3),kinds=new Float32Array(count),distances=new Float32Array(count);
    let vertex=0;const a=new THREE.Vector3(),b=new THREE.Vector3();
    for(const curve of curves){
      let distance=0;this.curvePoint(curve,0,a);
      for(let step=0;step<CURVE_STEPS;step++){
        this.curvePoint(curve,(step+1)/CURVE_STEPS,b);const nextDistance=distance+a.distanceTo(b);
        a.toArray(positions,vertex*3);kinds[vertex]=Number(curve.analytical);distances[vertex++]=distance;
        b.toArray(positions,vertex*3);kinds[vertex]=Number(curve.analytical);distances[vertex++]=nextDistance;
        a.copy(b);distance=nextDistance;
      }
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('aKind',new THREE.BufferAttribute(kinds,1));geometry.setAttribute('aDistance',new THREE.BufferAttribute(distances,1));
    const material=new THREE.ShaderMaterial({vertexShader:LINE_VERTEX,fragmentShader:LINE_FRAGMENT,
      uniforms:{...this.commonUniforms(),uColor:{value:new THREE.Color(active?'#efd38b':'#6b808f')},uOpacity:{value:active?.85:.032}},
      transparent:true,depthWrite:false,blending:active?THREE.AdditiveBlending:THREE.NormalBlending});
    const lines=new THREE.LineSegments(geometry,material);lines.frustumCulled=false;return lines;
  }

  private createParticles(curves:ActualCurve[],active:boolean):THREE.Points{
    const repeats=active?2:1,count=curves.length*repeats,arrays=Array.from({length:4},()=>new Float32Array(count*3));
    const phase=new Float32Array(count),speed=new Float32Array(count);let i=0;
    for(const curve of curves)for(let copy=0;copy<repeats;copy++){
      curve.a.toArray(arrays[0],i*3);curve.b.toArray(arrays[1],i*3);curve.c.toArray(arrays[2],i*3);curve.d.toArray(arrays[3],i*3);
      phase[i]=(curve.source*.618033+curve.target*.41421+copy*.5)%1;speed[i]=Math.min(2,Math.max(.3,900/curve.length));i++;
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3));
    for(let k=0;k<4;k++)geometry.setAttribute(['aStart','aC1','aC2','aEnd'][k],new THREE.BufferAttribute(arrays[k],3));
    geometry.setAttribute('aPhase',new THREE.BufferAttribute(phase,1));geometry.setAttribute('aSpeed',new THREE.BufferAttribute(speed,1));
    const material=new THREE.ShaderMaterial({vertexShader:PARTICLE_VERTEX,fragmentShader:PARTICLE_FRAGMENT,
      uniforms:{...this.commonUniforms(),uDpr:{value:this.dpr},uSize:{value:active?4.3:2.2},uOpacity:{value:active?.95:.38}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
    const particles=new THREE.Points(geometry,material);particles.frustumCulled=false;return particles;
  }

  private updateHighlight(forceId?:string):void{
    const pageIds=new Set(this.neighborhood?.neighborIds??[]);
    const contextId=this.neighborhood?.id;
    const hoverSource=this.hoveredId&&this.hoveredId!==contextId&&!pageIds.has(this.hoveredId)?this.hoveredId:null;
    const id=forceId??hoverSource??contextId??this.hoveredId??this.activeId;
    const signature=`${id??''}|${contextId??''}|${this.neighborhood?.page??0}|${this.hoveredId??''}`;
    if(this.highlightSignature===signature)return;this.highlightSignature=signature;
    this.highlightId=id;
    this.updateBaseOpacity();
    for(const object of [this.highlight,this.activeParticles])if(object){this.graph.remove(object);object.geometry.dispose();(object.material as THREE.Material).dispose();}
    this.highlight=null;this.activeParticles=null;
    if(this.nodeHeat&&this.pointHeat){
      (this.nodeHeat.array as Float32Array).fill(0);(this.pointHeat.array as Float32Array).fill(0);
      if(id){
        for(const neighbor of this.adjacency.get(id)??[]){
          if(id===contextId&&!pageIds.has(neighbor))continue;
          const i=this.indices.get(neighbor)!;this.nodeHeat.setX(i,1);this.pointHeat.setX(i,1);
        }
        const index=this.indices.get(id);if(index!==undefined){this.nodeHeat.setX(index,2);this.pointHeat.setX(index,2);}
        if(this.hoveredId){const hover=this.indices.get(this.hoveredId);if(hover!==undefined){this.nodeHeat.setX(hover,2);this.pointHeat.setX(hover,2);}}
      }
      this.nodeHeat.needsUpdate=true;this.pointHeat.needsUpdate=true;
    }
    const index=id?this.indices.get(id):undefined;
    if(index!==undefined){const curves=this.curves.filter(c=>{
        if(c.source!==index&&c.target!==index)return false;
        return id!==contextId||pageIds.has(this.nodes[c.source===index?c.target:c.source].id);
      });
      this.highlight=this.createLines(curves,true);this.activeParticles=this.createParticles(curves,true);this.graph.add(this.highlight,this.activeParticles);}
    this.lastProjection=0;this.requestDraw();
  }

  private resize():void{
    const rect=this.surface.nativeElement.getBoundingClientRect();if(rect.width<1||rect.height<1||!this.renderer)return;
    this.width=rect.width;this.height=rect.height;this.dpr=Math.min(window.devicePixelRatio||1,2);
    this.renderer.setPixelRatio(this.dpr);this.renderer.setSize(this.width,this.height,false);
    this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();
    this.graph.traverse(object=>{const material=(object as THREE.Mesh).material as THREE.ShaderMaterial|undefined;
      if(material?.uniforms?.['uHeight'])material.uniforms['uHeight'].value=this.height;
      if(material?.uniforms?.['uDpr'])material.uniforms['uDpr'].value=this.dpr;});
    if(!this.started&&this.nodes.length)this.startView();
    else if(this.neighborhood)this.setNeighborhood(this.neighborhood.id,this.neighborhood.page,false);
    this.lastProjection=0;this.requestDraw();
  }

  private readingAnchor():number|undefined{
    const candidates=this.nodes.map((n,i)=>({n,i})).filter(({n})=>n.type==='theme'||n.type==='construct');
    candidates.sort((a,b)=>this.positions[a.i].distanceToSquared(this.center)-this.positions[b.i].distanceToSquared(this.center));
    return candidates[0]?.i??(this.nodes.length?0:undefined);
  }
  private readingDistance():number{return Math.max(900,this.height/(2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)))*COVER_H/172);}
  private startView():void{
    if(!this.controls)return;this.started=true;
    const index=this.focusId?this.indices.get(this.focusId):this.readingAnchor();
    const target=index===undefined?this.center:this.positions[index];
    this.controls.target.copy(target);this.camera.position.copy(target).add(new THREE.Vector3(.52,.3,1).normalize().multiplyScalar(this.readingDistance()));
    this.controls.update();this.lastProjection=0;
    if(this.focusId)this.setNeighborhood(this.focusId,this.neighborhoodPage,true);
  }
  private flyTo(target:THREE.Vector3,distance:number,duration=780):void{
    if(!this.controls)return;
    const direction=this.camera.position.clone().sub(this.controls.target).normalize();if(direction.lengthSq()<.1)direction.set(.5,.3,1).normalize();
    const toEye=target.clone().addScaledVector(direction,distance);
    if(this.reduced){this.controls.target.copy(target);this.camera.position.copy(toEye);this.controls.update();this.flight=null;}
    else this.flight={fromEye:this.camera.position.clone(),toEye,fromTarget:this.controls.target.clone(),toTarget:target.clone(),started:performance.now(),duration};
    this.requestDraw();
  }
  private fit():void{
    this.clearNeighborhood();
    const aspect=Math.max(.35,Math.min(1,this.camera.aspect));this.flyTo(this.center,this.fitDistance/aspect);
    this.setHovered(null);this.status='Вся сеть. 4698 реальных узлов в едином трёхмерном пространстве.';
  }
  private zoom(factor:number):void{
    if(!this.controls)return;const distance=THREE.MathUtils.clamp(this.camera.position.distanceTo(this.controls.target)*factor,220,this.fitDistance*3);
    this.flyTo(this.controls.target,distance);
  }

  private flowing(position:THREE.Vector3,out:THREE.Vector3):THREE.Vector3{
    const t=this.elapsed,m=this.motionUniform.value;return out.set(
      position.x+(Math.sin(position.y*.0019+t*.34)*7+Math.sin(position.x*.0011+t*.2414)*2.5)*m,
      position.y+(Math.cos(position.x*.0017+t*.2992)*6.5+Math.sin(position.y*.0013+t*.2176)*2.5)*m,
      position.z+Math.sin(position.x*.0013+position.y*.0011+t*.265)*8*m);
  }

  private updateProjection(now:number):void{
    if(!this.controls||!this.width||!this.height)return;
    this.camera.updateMatrixWorld();this.inverseView.copy(this.camera.matrixWorldInverse);
    const focal=this.height/(2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)));
    this.projected=[];
    for(let i=0;i<this.nodes.length;i++){
      this.flowing(this.positions[i],this.temp);this.viewTemp.copy(this.temp).applyMatrix4(this.inverseView);const depth=-this.viewTemp.z;if(depth<5)continue;
      this.ndc.copy(this.temp).project(this.camera);if(this.ndc.z>1||this.ndc.z< -1)continue;
      const x=(this.ndc.x*.5+.5)*this.width,y=(-this.ndc.y*.5+.5)*this.height,h=Math.min(276,COVER_H*focal/depth),w=h*COVER_W/COVER_H;
      if(x+w/2<0||y+h/2<0||x-w/2>this.width||y-h/2>this.height)continue;
      this.projected.push({index:i,id:this.nodes[i].id,x,y,w,h,depth});
    }
    this.projected.sort((a,b)=>a.depth-b.depth);
    const priority=this.hoveredId??this.activeId,chosen:ProjectedNode[]=[];
    const candidates=(this.neighborhood?[]:this.projected).filter(p=>p.h>=74&&p.x>24&&p.x<this.width-24&&p.y>22&&p.y<this.height-25)
      .sort((a,b)=>Number(b.id===priority)-Number(a.id===priority)
        ||(Math.abs(a.h-174)-(this.details.has(a.id)?16:0))-(Math.abs(b.h-174)-(this.details.has(b.id)?16:0)));
    for(const p of candidates){
      if(chosen.length>=DETAIL_BUDGET)break;
      if(p.id!==priority&&chosen.some(q=>Math.abs(p.x-q.x)<(p.w+q.w)/2+12&&Math.abs(p.y-q.y)<(p.h+q.h)/2+12))continue;
      chosen.push(p);
    }
    if(this.neighborhood){
      const depth=this.camera.position.distanceTo(this.controls.target);
      for(const card of this.renderedNeighborhoodCards(now))chosen.push({index:this.indices.get(card.id)!,id:card.id,x:card.x,y:card.y,w:card.w,h:card.h,depth});
    }
    this.foreground=chosen;
    if(this.cardVisibility){(this.cardVisibility.array as Float32Array).fill(0);if(!this.neighborhood)for(const p of chosen)this.cardVisibility.setX(p.index,1);this.cardVisibility.needsUpdate=true;}
    this.syncDetails(chosen);this.lastProjection=now;
    if(now-this.lastDom>200){
      const covers=chosen.slice().sort((a,b)=>a.y-b.y||a.x-b.x).map(p=>({id:p.id,label:`${this.typeLabel(this.nodes[p.index].type)}. ${this.nodes[p.index].label}. Связей: ${this.nodes[p.index].degree}. Выбрать узел на карте.`,x:p.x-p.w/2,y:p.y-p.h/2,w:p.w,h:p.h}));
      this.lastDom=now;const distance=this.camera.position.distanceTo(this.controls.target),zoom=this.fitDistance/distance;
      this.zone.run(()=>{this.accessibleCovers=covers;this.visibleCoverCount=this.projected.length;this.detailCoverCount=chosen.length;this.cameraDistance=Math.round(distance);this.cameraScale=Math.round(focal/distance*10000)/10000;
        if(Math.abs(zoom-this.lastZoom)>.01){this.lastZoom=zoom;this.viewportChange.emit({zoom:Math.round(zoom*100)/100});}this.cdr.markForCheck();});
    }
  }

  private syncDetails(chosen:ProjectedNode[]):void{
    const wanted=new Set(chosen.map(p=>p.id));
    for(const [id,detail]of this.details)if(!wanted.has(id)){this.graph.remove(detail.sprite);detail.material.dispose();this.details.delete(id);}
    this.pendingDetails=[];
    for(const p of chosen)if(!this.details.has(p.id)){
      const cached=this.textureCache.get(p.id);
      if(cached){this.textureCache.delete(p.id);this.textureCache.set(p.id,cached);this.attachDetail(p,cached);}
      else this.pendingDetails.push(p);
    }
  }

  /** Camera-facing reading callouts, each tethered to its unchanged actual 3D node. */
  private renderedNeighborhoodCards(now:number):NeighborhoodCard[]{
    if(!this.neighborhood)return[];
    const t=this.reduced?1:Math.min(1,Math.max(0,(now-this.calloutTransitionStart)/480)),ease=1-Math.pow(1-t,3);
    return this.neighborhood.cards.map(target=>{
      const from=this.calloutFrom.get(target.id);if(!from||t===1)return target;
      return{...target,x:from.x+(target.x-from.x)*ease,y:from.y+(target.y-from.y)*ease,
        w:from.w+(target.w-from.w)*ease,h:from.h+(target.h-from.h)*ease};
    });
  }

  private updateNeighborhoodTargets(now:number):void{
    this.overlayTargets.clear();if(!this.neighborhood||!this.controls)return;
    this.camera.updateMatrixWorld();this.right.setFromMatrixColumn(this.camera.matrixWorld,0);this.up.setFromMatrixColumn(this.camera.matrixWorld,1);
    this.camera.getWorldDirection(this.forward);
    const depth=Math.min(this.camera.position.distanceTo(this.controls.target),Math.max(900,this.radius*.75));
    const focal=this.height/(2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)));
    const positions=this.neighborhoodTethers?.geometry.getAttribute('position') as THREE.BufferAttribute|undefined;
    const cards=this.renderedNeighborhoodCards(now);
    for(let i=0;i<cards.length;i++){
      const card=cards[i];
      const position=this.camera.position.clone().addScaledVector(this.forward,depth)
        .addScaledVector(this.right,(card.x-this.width/2)*depth/focal).addScaledVector(this.up,(this.height/2-card.y)*depth/focal);
      this.overlayTargets.set(card.id,{position,scale:new THREE.Vector3(card.w*depth/focal,card.h*depth/focal,1)});
      if(positions){position.toArray(positions.array as Float32Array,i*6);this.flowing(this.positions[this.indices.get(card.id)!],this.temp).toArray(positions.array as Float32Array,i*6+3);}
    }
    if(positions){positions.needsUpdate=true;this.neighborhoodTethers!.computeLineDistances();}
  }

  private attachDetail(p:ProjectedNode,texture:THREE.CanvasTexture):void{
    // This is the decluttered foreground: paper must never fail a coplanar depth
    // test against its low-resolution atlas placeholder (CPU/GPU wave rounding).
    const node=this.nodes[p.index],material=new THREE.SpriteMaterial({map:texture,transparent:true,opacity:0,depthWrite:false,depthTest:false,toneMapped:false});
    const sprite=new THREE.Sprite(material);sprite.renderOrder=3;sprite.frustumCulled=false;
    this.details.set(p.id,{sprite,texture,material,node});this.graph.add(sprite);
  }

  private buildSourceFrame():void{
    const width=COVER_W+12,height=COVER_H+12,canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2;
    const ctx=canvas.getContext('2d')!;ctx.scale(2,2);ctx.strokeStyle='#eed797';ctx.lineWidth=1.1;ctx.strokeRect(2,2,width-4,height-4);
    ctx.strokeStyle='#ffe5a0';ctx.lineWidth=2.6;
    for(const [x,y,sx,sy]of [[2,2,1,1],[width-2,2,-1,1],[2,height-2,1,-1],[width-2,height-2,-1,-1]]){
      ctx.beginPath();ctx.moveTo(x,y+sy*10);ctx.lineTo(x,y);ctx.lineTo(x+sx*10,y);ctx.stroke();
    }
    this.sourceFrameTexture=new THREE.CanvasTexture(canvas);this.sourceFrameTexture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.SpriteMaterial({map:this.sourceFrameTexture,transparent:true,opacity:0,depthWrite:false,depthTest:false,toneMapped:false});
    this.sourceFrame=new THREE.Sprite(material);this.sourceFrame.renderOrder=5;this.sourceFrame.frustumCulled=false;this.graph.add(this.sourceFrame);
  }

  private buildOneDetail():void{
    const p=this.pendingDetails.shift();if(!p||this.details.has(p.id)||!this.foreground.some(q=>q.id===p.id))return;
    const node=this.nodes[p.index],canvas=document.createElement('canvas');canvas.width=COVER_W*2;canvas.height=COVER_H*2;
    const ctx=canvas.getContext('2d')!;ctx.scale(2,2);
    const neighbors=[...this.adjacency.get(node.id)??[]].map(id=>this.nodeMap.get(id)!);
    paintCover(ctx,node,{width:COVER_W,height:COVER_H,serial:p.index+1,neighbors,origin:node,detail:'full'});
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(4,this.renderer?.capabilities.getMaxAnisotropy()??1);
    this.textureCache.set(p.id,texture);this.attachDetail(p,texture);
    // 24 live covers + eight recent neighbors: a hard, bounded GPU texture budget.
    for(const [id,oldTexture]of this.textureCache){if(this.textureCache.size<=DETAIL_BUDGET+8)break;if(!this.details.has(id)){oldTexture.dispose();this.textureCache.delete(id);}}
  }

  private hitTest(x:number,y:number):string|null{
    if(performance.now()-this.lastProjection>40)this.updateProjection(performance.now());
    // Foreground covers have explicit rectangles; remaining actual nodes remain point targets.
    const coverHits=this.foreground.filter(p=>Math.abs(x-p.x)<=p.w/2&&Math.abs(y-p.y)<=p.h/2).sort((a,b)=>a.depth-b.depth);
    if(coverHits.length)return coverHits[0].id;
    let closest:string|null=null,best=64;
    for(const p of this.projected){const distance=(x-p.x)**2+(y-p.y)**2;if(distance<best){best=distance;closest=p.id;}}
    return closest;
  }
  private pointerPosition(event:PointerEvent):{x:number;y:number}{const r=this.surface.nativeElement.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top};}
  private onPointerDown(event:PointerEvent):void{
    this.pointerIds.add(event.pointerId);if(this.pointerIds.size>1){this.multiPointer=true;this.pointerMoved=true;}
    if(event.button!==0)return;const p=this.pointerPosition(event);this.pointerStart={...p,id:event.pointerId};this.pointerMoved=false;
    if(this.multiPointer)this.pointerMoved=true;
    (this.surface.nativeElement.parentElement as HTMLElement)?.focus({preventScroll:true});
  }
  private onPointerMove(event:PointerEvent):void{
    const p=this.pointerPosition(event);
    if(this.pointerStart&&Math.hypot(p.x-this.pointerStart.x,p.y-this.pointerStart.y)>5){this.pointerMoved=true;this.setHovered(null);}
    if(!event.buttons&&!this.keyboardId)this.setHovered(this.hitTest(p.x,p.y));
  }
  private onPointerUp(event:PointerEvent):void{
    if(this.pointerStart?.id===event.pointerId&&!this.pointerMoved&&!this.multiPointer){const p=this.pointerPosition(event),id=this.hitTest(p.x,p.y);if(id)this.selectNode(id);}
    this.pointerIds.delete(event.pointerId);if(!this.pointerIds.size)this.multiPointer=false;
    this.pointerStart=null;
  }
  private setHovered(id:string|null):void{
    if(this.hoveredId===id)return;this.hoveredId=id;this.surface.nativeElement.style.cursor=id?'pointer':'grab';this.updateHighlight();
  }

  private requestDraw():void{
    if(!this.initialized||this.destroyed||this.frame||document.hidden||this.rendererState==='lost')return;
    this.zone.runOutsideAngular(()=>{this.frame=requestAnimationFrame(now=>{this.frame=0;this.draw(now);});});
  }

  private updateBaseOpacity():void{
    if(!this.baseLines||!this.controls)return;
    const distance=this.camera.position.distanceTo(this.controls.target);
    const overview=THREE.MathUtils.smoothstep(distance,this.radius*1.25,this.radius*2.5);
    // A selected neighborhood keeps the rest of the actual neural tissue visible.
    // Incidental hover in free exploration can still quiet the background further.
    (this.baseLines.material as THREE.ShaderMaterial).uniforms['uOpacity'].value=this.neighborhood
      ? .048+overview*.007 : (.032+overview*.048)/(this.highlightId?3:1);
  }

  private draw(now:number):void{
    if(!this.renderer||!this.controls||!this.width||!this.height||document.hidden)return;
    const dt=this.lastFrame?Math.min(60,now-this.lastFrame)/1000:1/60;this.lastFrame=now;
    const ambient=!this.motionPaused&&!this.reduced;
    if(ambient)this.elapsed+=dt;this.timeUniform.value=this.elapsed;
    if(this.flight){
      const f=this.flight,t=Math.min(1,(now-f.started)/f.duration),ease=t*t*(3-2*t);
      this.camera.position.lerpVectors(f.fromEye,f.toEye,ease);this.controls.target.lerpVectors(f.fromTarget,f.toTarget,ease);
      if(t>=1)this.flight=null;
    }
    this.controls.autoRotate=ambient&&!this.flight&&!this.neighborhood&&this.camera.position.distanceTo(this.controls.target)>this.radius*1.2;
    this.controls.update(dt);
    this.updateBaseOpacity();
    const calloutsMoving=!!this.neighborhood&&!this.reduced&&now-this.calloutTransitionStart<480;
    if(now-this.lastProjection>90||this.flight||this.controlsMoving||calloutsMoving)this.updateProjection(now);
    this.updateNeighborhoodTargets(now);
    this.buildOneDetail();
    const focal=this.height/(2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)));
    for(const [id,detail]of this.details){
      const overlay=this.overlayTargets.get(id),grow=id===this.hoveredId?1.022:1;
      if(overlay){detail.sprite.position.copy(overlay.position);detail.sprite.scale.copy(overlay.scale).multiplyScalar(grow);}
      else{
        const index=this.indices.get(id)!;this.flowing(this.positions[index],detail.sprite.position);
        this.viewTemp.copy(detail.sprite.position).applyMatrix4(this.camera.matrixWorldInverse);const depth=-this.viewTemp.z;
        const cap=Math.min(1,276/(COVER_H*focal/Math.max(1,depth)));
        detail.sprite.scale.set(COVER_W*cap*grow,COVER_H*cap*grow,1);
      }
      detail.material.opacity=this.reduced?1:Math.min(1,detail.material.opacity+dt*4);
      detail.material.color.set(id===this.hoveredId||id===this.activeId?0xffffff:0xdddfe0);
    }
    let frameMoving=false;
    if(this.sourceFrame){
      const id=this.hoveredId??this.activeId,detail=id?this.details.get(id):null;
      const target=detail?1:0,material=this.sourceFrame.material as THREE.SpriteMaterial;
      material.opacity+= (target-material.opacity)*(this.reduced?1:1-Math.exp(-dt/ .11));
      frameMoving=Math.abs(target-material.opacity)>.005;
      if(detail){this.sourceFrame.position.copy(detail.sprite.position);this.sourceFrame.scale.set(detail.sprite.scale.x*(COVER_W+12)/COVER_W,detail.sprite.scale.y*(COVER_H+12)/COVER_H,1);}
      this.sourceFrame.visible=material.opacity>.005;
    }
    this.renderer.render(this.scene,this.camera);
    const damping=now-this.lastControlChange<900;
    if(ambient||this.flight||this.controlsMoving||damping||frameMoving||calloutsMoving||this.pendingDetails.length||[...this.details.values()].some(d=>d.material.opacity<1))this.requestDraw();
  }
}
