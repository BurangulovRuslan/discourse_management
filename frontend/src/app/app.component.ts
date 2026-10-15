import { Component, computed, signal, HostListener, ElementRef, ViewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { IconComponent } from './icon.component';
import { NetworkComponent } from './network.component';
import { NodeCoverComponent } from './node-cover.component';
import { ArchiveSearch, SearchHit } from './archive-search';

interface Book { id:string; title:string; year:number|null; counts:Record<string,number>; connections:string[]; }
interface AtlasNode { id:string; type:string; label:string; description:string; books:string[]; refIds:number[]; x:number; y:number; z:number; degree:number; }
interface Edge { source:string; target:string; analytical:boolean; }
interface Reference { book:string; locator:string; excerpt:string; paragraphs?:string[]; url:string; nodeIds?:string[]; author?:string; note?:string; }
interface Atlas { version:string; stats:Record<string,number>; books:Book[]; nodes:AtlasNode[]; edges:Edge[]; references:Reference[]; }
interface Dossier { description:string; descriptionParagraphs?:string[]; sections:{label:string;text:string;paragraphs?:string[]}[]; }
interface Dossiers { nodes:Record<string,Dossier>; edges:(Edge & {relation?:string})[]; }
type IndexMode='all'|'books'|'quotes'|'saved';

@Component({selector:'app-root',standalone:true,imports:[IconComponent,NetworkComponent,NodeCoverComponent,DecimalPipe],templateUrl:'./app.component.html'})
export class AppComponent {
  readonly data=signal<Atlas|null>(null);
  readonly loadError=signal(false);
  readonly selectedId=signal<string|null>(null);
  readonly focusId=signal<string|null>(null);
  readonly neighborhoodPage=signal(0);
  readonly neighborhoodPageSize=signal(8);
  readonly zoomAction=signal<{kind:'in'|'out'|'fit';seq:number}|null>(null);
  readonly indexOpen=signal(false);
  readonly indexMode=signal<IndexMode>('all');
  readonly aboutOpen=signal(false);
  readonly journalOpen=signal(false);
  readonly query=signal('');
  readonly visibleLimit=signal(40);
  readonly quoteResultLimit=signal(20);
  readonly quoteLimit=signal(4);
  readonly connectionLimit=signal(12);
  readonly searchRefs=signal<Reference[]>([]);
  readonly searchLoaded=signal(false);
  readonly searchLoading=signal(false);
  readonly searchError=signal(false);
  readonly searchRevision=signal(0);
  readonly contextSearchLoading=signal(false);
  private readonly archiveSearch=new ArchiveSearch<AtlasNode,Reference>();
  readonly dossiers=signal<Dossiers|null>(null);
  readonly dossierLoading=signal(false);
  readonly dossierError=signal(false);
  readonly shareState=signal('');
  readonly shareFallback=signal('');
  readonly motionEnabled=signal(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  readonly saved=signal<string[]>(this.readSaved());
  readonly types:Record<string,string>={book:'Книга',theme:'Тема',construct:'Понятие',thinker:'Автор',experiment:'Исследовательский эпизод',code:'Тематический код',proposition:'Тезис',chain_step:'Звено аргумента',trajectory_stage:'Стадия понятия',work:'Работа',citation:'Библиографическая запись'};
  readonly nodes=computed(()=>this.data()?.nodes??[]);
  readonly edges=computed(()=>this.data()?.edges??[]);
  readonly nodeMap=computed(()=>new Map(this.nodes().map(n=>[n.id,n])));
  readonly bookMap=computed(()=>new Map((this.data()?.books??[]).map(b=>[b.id,b])));
  readonly selected=computed(()=>this.nodeMap().get(this.selectedId()??'')??null);
  readonly selectedBook=computed(()=>this.bookMap().get(this.selectedId()??''));
  readonly dossier=computed(()=>this.dossiers()?.nodes[this.selectedId()??'']??null);
  readonly articleIntro=computed(()=>this.dossier()?.description||this.selected()?.description||'');
  readonly articleParagraphs=computed(()=>this.paragraphs(this.articleIntro(),this.dossier()?.descriptionParagraphs));
  readonly articleSections=computed(()=>(this.dossier()?.sections??[]).filter(s=>s.text&&s.text!==this.articleIntro()));
  readonly featured=computed(()=>this.nodes().find(n=>n.type==='theme'&&this.normalize(n.label).includes('системное мышление'))??this.nodes().find(n=>n.type==='theme'));
  readonly quoteIndex=computed(()=>{
    const index=new Map<string,Reference[]>();
    for(const ref of this.searchRefs())for(const id of ref.nodeIds??[]){if(!index.has(id))index.set(id,[]);index.get(id)!.push(ref);}return index;
  });
  readonly selectedRefs=computed(()=>{
    const node=this.selected();if(!node)return [];
    const refs=this.searchLoaded()?this.quoteIndex().get(node.id)??[]:(node.refIds??[]).map(i=>this.data()?.references[i]).filter((r):r is Reference=>!!r);
    return [...new Map(refs.map(ref=>[this.refKey(ref),ref])).values()];
  });
  readonly related=computed(()=>{
    const id=this.selectedId();if(!id)return [];
    const groups=new Map<string,{node:AtlasNode;analytical:boolean;literal:boolean;relations:Set<string>}>();
    for(const edge of this.dossiers()?.edges??this.edges()){
      if(edge.source!==id&&edge.target!==id)continue;
      const other=this.nodeMap().get(edge.source===id?edge.target:edge.source);if(!other)continue;
      if(!groups.has(other.id))groups.set(other.id,{node:other,analytical:false,literal:false,relations:new Set()});
      const group=groups.get(other.id)!;if(edge.analytical)group.analytical=true;else group.literal=true;
      if('relation' in edge&&edge.relation)group.relations.add((edge.source===id?'→ ':'← ')+String(edge.relation));
    }
    return [...groups.values()].map(g=>({node:g.node,relation:[...g.relations].join(' · '),analytical:g.analytical&&!g.literal,evidence:g.analytical&&g.literal?'Текстовые и аналитические связи':g.analytical?'Аналитическая связь':'Текстовая отсылка'})).sort((a,b)=>b.node.degree-a.node.degree||a.node.id.localeCompare(b.node.id,'en'));
  });
  readonly neighborhoodPages=computed(()=>Math.max(1,Math.ceil(this.related().length/this.neighborhoodPageSize())));
  readonly neighborFirst=computed(()=>this.related().length?this.neighborhoodPage()*this.neighborhoodPageSize()+1:0);
  readonly neighborLast=computed(()=>Math.min(this.related().length,(this.neighborhoodPage()+1)*this.neighborhoodPageSize()));
  readonly sourceBooks=computed(()=>(this.selected()?.books??[]).map(id=>this.bookMap().get(id)).filter((b):b is Book=>!!b));
  readonly nodeHits=computed(()=>{
    this.searchRevision();const q=this.query().trim(),mode=this.indexMode();
    if(mode==='quotes')return [];
    if(q)return this.archiveSearch.searchNodes(q,{types:mode==='books'?['book']:undefined,ids:mode==='saved'?this.saved():undefined});
    return this.nodes().filter(n=>(mode!=='books'||n.type==='book')&&(mode!=='saved'||this.saved().includes(n.id))).sort((a,b)=>b.degree-a.degree).map(item=>({item,id:item.id,score:0,snippet:'',matchedTerms:[],matchKind:'exact',explanation:'',parts:[]} as SearchHit<AtlasNode>));
  });
  readonly indexedNodes=computed(()=>this.nodeHits().map(hit=>hit.item));
  readonly quoteHits=computed(()=>{this.searchRevision();const q=this.query().trim();return q.length<2||!['all','quotes'].includes(this.indexMode())?[]:this.archiveSearch.searchQuotes(q,{limit:this.quoteResultLimit()+1});});
  readonly searchInterpretation=computed(()=>this.archiveSearch.interpretation(this.query()));
  readonly dialogOpen=computed(()=>this.indexOpen()||this.aboutOpen()||this.journalOpen());
  @ViewChild('indexInput') indexInput?:ElementRef<HTMLInputElement>;
  @ViewChild(NetworkComponent) network?:NetworkComponent;
  private returnFocus:HTMLElement|null=null;
  private actionSequence=0;
  private sharedTimer?:ReturnType<typeof setTimeout>;
  constructor(){void this.load();}
  normalize(value:string){return value.toLocaleLowerCase('ru').replaceAll('ё','е');}
  readSaved():string[]{try{const v=JSON.parse(localStorage.getItem('atlas-saved')||'[]');return Array.isArray(v)?v.filter(id=>typeof id==='string'):[];}catch{return [];}}
  async load(){this.loadError.set(false);try{const r=await fetch('explorer-data.json');if(!r.ok)throw new Error();const data:Atlas=await r.json();this.archiveSearch.addNodes(data.nodes,data.books);this.searchRevision.update(v=>v+1);this.data.set(data);this.applyHash();}catch{this.loadError.set(true);}}
  async loadSearch(){
    if(this.searchLoaded()||this.searchLoading())return;this.searchLoading.set(true);this.searchError.set(false);
    try{const refs=await this.archiveSearch.loadQuotes();this.searchRefs.set(refs);this.searchRevision.update(v=>v+1);this.searchLoaded.set(true);}catch{this.searchError.set(true);}finally{this.searchLoading.set(false);}
  }
  async loadDossiers(){
    if(this.dossiers()||this.dossierLoading())return;this.dossierLoading.set(true);this.dossierError.set(false);
    try{const r=await fetch('explorer-dossiers.json');if(!r.ok)throw new Error();const dossiers:Dossiers=await r.json();this.dossiers.set(dossiers);this.contextSearchLoading.set(true);try{await this.archiveSearch.addDossiers(dossiers);this.searchRevision.update(v=>v+1);}finally{this.contextSearchLoading.set(false);}}catch{this.dossierError.set(true);}finally{this.dossierLoading.set(false);}
  }
  openIndex(mode:IndexMode='all'){this.captureFocus();this.leaveArticleAddress();this.aboutOpen.set(false);this.journalOpen.set(false);this.indexMode.set(mode);this.query.set('');this.visibleLimit.set(40);this.indexOpen.set(true);setTimeout(()=>this.indexInput?.nativeElement.focus());void this.loadSearch();void this.loadDossiers();}
  changeIndex(mode:IndexMode){this.indexMode.set(mode);this.visibleLimit.set(40);}
  updateQuery(value:string){this.query.set(value);this.visibleLimit.set(40);this.quoteResultLimit.set(20);}
  more(kind:'nodes'|'quotes'|'connections'|'quoteResults'){if(kind==='nodes')this.visibleLimit.update(v=>v+40);else if(kind==='quotes')this.quoteLimit.update(v=>v+8);else if(kind==='quoteResults')this.quoteResultLimit.update(v=>v+20);else this.connectionLimit.update(v=>v+12);}
  openAbout(){this.captureFocus();this.leaveArticleAddress();this.indexOpen.set(false);this.journalOpen.set(false);this.aboutOpen.set(true);setTimeout(()=>document.getElementById('about-close')?.focus());}
  select(id:string,push=true){
    if(!this.nodeMap().has(id))return;
    const changed=this.selectedId()!==id;
    this.selectedId.set(id);this.indexOpen.set(false);this.aboutOpen.set(false);this.journalOpen.set(false);
    if(changed)this.neighborhoodPage.set(0);
    if(this.focusId()!==id)this.focusId.set(id);else if(push)this.network?.focusNeighborhood(id,this.neighborhoodPage());
    this.setNodeAddress(id,false,push);this.focusMap();
  }
  openJournal(id=this.selectedId(),push=true){
    if(!id||!this.nodeMap().has(id))return;this.captureFocus();
    if(this.selectedId()!==id){this.selectedId.set(id);this.focusId.set(id);this.neighborhoodPage.set(0);}
    this.indexOpen.set(false);this.aboutOpen.set(false);this.journalOpen.set(true);this.quoteLimit.set(4);this.connectionLimit.set(12);this.shareState.set('');this.shareFallback.set('');
    this.setNodeAddress(id,true,push);void this.loadDossiers();void this.loadSearch();
    setTimeout(()=>{document.getElementById('journal-scroll')?.scrollTo({top:0});document.getElementById('journal-title')?.focus({preventScroll:true});});
  }
  private setNodeAddress(id:string,article:boolean,push:boolean){
    if(!push)return;const hash='#node='+encodeURIComponent(id)+(article?'&view=article':'');
    if(location.hash!==hash){
      const current=new URLSearchParams(location.hash.slice(1));
      if(article&&(current.get('node')??current.get('book'))===id)history.replaceState(null,'',hash);
      else history.pushState(null,'',hash);
    }
  }
  private leaveArticleAddress(){if(this.journalOpen()&&this.selectedId())history.replaceState(null,'','#node='+encodeURIComponent(this.selectedId()!));}
  showOnMap(){this.journalOpen.set(false);this.indexOpen.set(false);const id=this.selectedId();if(id){history.replaceState(null,'','#node='+encodeURIComponent(id));this.network?.focusNeighborhood(id,this.neighborhoodPage());}this.focusMap();}
  neighborhoodChanged(view:{id:string;page:number;pageSize:number}){if(view.id!==this.selectedId())return;this.neighborhoodPageSize.set(view.pageSize);this.neighborhoodPage.set(view.page);}
  turnNeighborhood(direction:number){this.neighborhoodPage.update(page=>Math.max(0,Math.min(this.neighborhoodPages()-1,page+direction)));}
  clearSelection(){this.selectedId.set(null);this.focusId.set(null);this.neighborhoodPage.set(0);history.replaceState(null,'',location.pathname+location.search);this.focusMap();}
  startReading(){this.clearSelection();this.network?.readMap();}
  paragraphs(text:string,blocks?:string[]){return blocks?.length?blocks:text?[text]:[];}
  mapAction(kind:'in'|'out'|'fit'){this.zoomAction.set({kind,seq:++this.actionSequence});if(kind==='fit')this.clearSelection();}
  closeDialog(){this.leaveArticleAddress();this.indexOpen.set(false);this.aboutOpen.set(false);this.journalOpen.set(false);setTimeout(()=>{if(this.returnFocus?.isConnected&&this.returnFocus!==document.body&&this.returnFocus!==document.documentElement)this.returnFocus.focus();else this.focusMap();});}
  captureFocus(){if(!this.dialogOpen())this.returnFocus=document.activeElement as HTMLElement;}
  focusMap(){setTimeout(()=>document.querySelector<HTMLElement>('app-network')?.focus());}
  toggleSave(id:string){this.saved.update(ids=>ids.includes(id)?ids.filter(v=>v!==id):[...ids,id]);try{localStorage.setItem('atlas-saved',JSON.stringify(this.saved()));}catch{/* Collection remains available for this session. */}}
  async copyLink(){const url=location.origin+location.pathname+'#node='+encodeURIComponent(this.selectedId()??'')+'&view=article';try{await navigator.clipboard.writeText(url);this.shareState.set('Ссылка скопирована');clearTimeout(this.sharedTimer);this.sharedTimer=setTimeout(()=>this.shareState.set(''),3000);}catch{this.shareFallback.set(url);}}
  scrollArticle(id:string){document.getElementById(id)?.scrollIntoView({block:'start'});}
  @HostListener('window:hashchange') @HostListener('window:popstate') applyHash(){
    const address=new URLSearchParams(location.hash.slice(1)),id=address.get('node')??address.get('book')??'';
    if(this.nodeMap().has(id)){if(address.get('view')==='article')this.openJournal(id,false);else this.select(id,false);}
    else{const hadFocus=this.journalOpen()||!!this.selectedId();this.selectedId.set(null);this.focusId.set(null);this.journalOpen.set(false);this.neighborhoodPage.set(0);if(hadFocus)this.focusMap();}
  }
  @HostListener('document:keydown',['$event']) keydown(event:KeyboardEvent){
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();this.openIndex();}
    if(event.key==='Escape'){if(this.dialogOpen()){event.preventDefault();this.closeDialog();}else if(this.selectedId()){event.preventDefault();this.clearSelection();}}
    if(event.key==='0'&&!this.dialogOpen()&&(event.target as HTMLElement)?.tagName==='APP-NETWORK')this.clearSelection();
    if(event.key==='Tab'&&this.dialogOpen()){
      const id=this.indexOpen()?'index-dialog':this.aboutOpen()?'about-dialog':'journal-dialog';
      const items=document.getElementById(id)?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]');
      if(items?.length){const first=items[0],last=items[items.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement?.id==='journal-title')){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
    }
  }
  refKey(r:Reference){return r.book+'|'+r.locator+'|'+r.excerpt+'|'+(r.author??'');}
  bookTitle(id:string){return this.bookMap().get(id)?.title??id;}
  serial(n:AtlasNode){return String(this.nodes().findIndex(v=>v.id===n.id)+1).padStart(4,'0');}
  plural(value:number,f:[string,string,string]){const n=Math.abs(value)%100,k=n%10;return n>10&&n<20?f[2]:k===1?f[0]:k>=2&&k<=4?f[1]:f[2];}
  bookLabel(v:number){return this.plural(v,['книга','книги','книг']);}
  connectionLabel(v:number){return this.plural(v,['связь','связи','связей']);}
}
