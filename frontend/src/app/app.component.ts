import { Component, computed, signal, HostListener, ElementRef, ViewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { IconComponent } from './icon.component';
import { RhizomeComponent } from './rhizome.component';

interface Book { id: string; title: string; year: number | null; dateNote?: string; counts: Record<string,number>; connections: string[]; }
interface AtlasNode { id: string; type: string; label: string; description: string; books: string[]; refIds: number[]; }
interface Reference { book: string; locator: string; excerpt: string; url: string; nodeIds?: string[]; author?: string; note?: string; }
interface Atlas { version: string; stats: Record<string,number>; books: Book[]; nodes: AtlasNode[]; edges: {source:string;target:string;analytical:boolean}[]; references: Reference[]; }
type View = 'map' | 'books' | 'saved';

@Component({
  selector: 'app-root', standalone: true, imports: [IconComponent, RhizomeComponent, DecimalPipe],
  templateUrl: './app.component.html'
})
export class AppComponent {
  readonly data = signal<Atlas | null>(null);
  readonly loadError = signal(false);
  readonly view = signal<View>('map');
  readonly selectedId = signal<string | null>(null);
  readonly filter = signal('all');
  readonly zoom = signal(1);
  readonly paused = signal(false);
  readonly menuOpen = signal(false);
  readonly searchOpen = signal(false);
  readonly aboutOpen = signal(false);
  readonly query = signal('');
  readonly libraryQuery = signal('');
  readonly period = signal('all');
  readonly fullReferences = signal<Reference[]>([]);
  readonly searchLoading = signal(false);
  readonly searchError = signal(false);
  readonly searchLoaded = signal(false);
  readonly saved = signal<string[]>(this.readSaved());
  readonly types: Record<string,string> = {book:'Книга',theme:'Тематическая линия',construct:'Понятие',thinker:'Автор',experiment:'Исследовательский эпизод',code:'Тематический код',proposition:'Тезис',chain_step:'Звено аргумента',trajectory_stage:'Стадия понятия',work:'Работа',citation:'Библиографическая запись'};
  readonly filters = [{id:'all',label:'Обзор'},{id:'theme',label:'Темы'},{id:'construct',label:'Понятия'},{id:'thinker',label:'Авторы'},{id:'book',label:'Книги'}];
  readonly titles: Record<View,string> = {map:'Карта смыслов',books:'Библиотека',saved:'Сохранённое'};
  readonly nodes = computed(() => this.data()?.nodes ?? []);
  readonly nodeMap = computed(() => new Map(this.nodes().map(n=>[n.id,n])));
  readonly books = computed(() => this.data()?.books ?? []);
  readonly bookMap = computed(() => new Map(this.books().map(b=>[b.id,b])));
  readonly selected = computed(() => this.nodeMap().get(this.selectedId() ?? '') ?? null);
  readonly themes = computed(() => this.nodes().filter(n=>n.type==='theme'));
  readonly entryPoints = computed(() => {
    const themes = this.themes();
    const chosen: AtlasNode[] = [];
    for (const term of ['мышлен','человек','социал','действ']) {
      const found = themes.find(n=>this.normalize(n.label).includes(term) && !chosen.includes(n));
      if (found) chosen.push(found);
    }
    return [...chosen,...themes.filter(n=>!chosen.includes(n))].slice(0,4);
  });
  readonly graphNodes = computed(() => {
    const type = this.filter();
    let candidates = type==='all' ? this.themes() : this.nodes().filter(n=>n.type===type);
    if (!candidates.length) candidates=this.nodes().filter(n=>n.type==='book');
    const chosen=candidates.filter((_,i)=> i % Math.max(1,Math.floor(candidates.length / 9))===0).slice(0,9);
    const active=this.selected();
    return active && !chosen.some(n=>n.id===active.id) ? [active,...chosen.slice(0,8)] : chosen;
  });
  readonly selectedRefs = computed(() => {
    const node=this.selected(); if (!node) return [];
    const local=(node.refIds ?? []).map(i=>this.data()?.references[i]).filter((r):r is Reference=>!!r);
    const extra=this.fullReferences().filter(r=>r.nodeIds?.includes(node.id));
    return [...new Map([...local,...extra].map(r=>[r.book+'|'+r.locator+'|'+r.excerpt+'|'+r.author,r])).values()].slice(0,6);
  });
  readonly related = computed(() => {
    const id=this.selectedId(); if (!id) return [];
    const ids=new Set((this.data()?.edges ?? []).filter(e=>e.source===id || e.target===id).flatMap(e=>[e.source,e.target]));
    ids.delete(id);
    return [...ids].map(i=>this.nodeMap().get(i)).filter((n):n is AtlasNode=>!!n).sort((a,b)=>Number(b.type==='theme')-Number(a.type==='theme')).slice(0,6);
  });
  readonly filteredBooks = computed(() => {
    const query=this.normalize(this.libraryQuery());
    return this.books().filter(b=>(!query || this.normalize(b.title).includes(query)) && (this.period()==='all' || (this.period()==='recent' ? (b.year??0)>=2022 : (b.year??2026)<2022)));
  });
  readonly savedNodes = computed(() => this.saved().map(id=>this.nodeMap().get(id)).filter((n):n is AtlasNode=>!!n));
  readonly searchNodes = computed(() => {
    const q=this.normalize(this.query().trim()); if(q.length<2) return [];
    return this.nodes().filter(n=>this.normalize(n.label+' '+n.description).includes(q)).sort((a,b)=>Number(this.normalize(b.label).includes(q))-Number(this.normalize(a.label).includes(q))).slice(0,18);
  });
  readonly searchRefs = computed(() => {
    const q=this.normalize(this.query().trim()); if(q.length<2) return [];
    return this.fullReferences().filter(r=>this.normalize(r.excerpt).includes(q)).slice(0,16);
  });
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;
  private searchReturnFocus: HTMLElement | null = null;
  private aboutReturnFocus: HTMLElement | null = null;

  constructor() { void this.load(); }

  async load() {
    this.loadError.set(false);
    try {
      const response=await fetch('explorer-data.json');
      if(!response.ok) throw new Error('data');
      this.data.set(await response.json());
      this.applyHash();
    } catch { this.loadError.set(true); }
  }
  normalize(value:string) { return value.toLocaleLowerCase('ru').replaceAll('ё','е'); }
  readSaved():string[] { try {const value=JSON.parse(localStorage.getItem('atlas-saved') || '[]');return Array.isArray(value) ? value.filter(x=>typeof x==='string') : [];} catch {return [];} }
  navigate(view:View) { this.view.set(view);this.menuOpen.set(false);this.selectedId.set(null);history.replaceState(null,'',location.pathname+location.search); }
  select(id:string) {
    if(!this.nodeMap().has(id)) return;
    this.selectedId.set(id);this.view.set('map');this.menuOpen.set(false);this.closeSearch();
    history.replaceState(null,'','#'+(this.nodeMap().get(id)?.type==='book'?'book=':'node=')+encodeURIComponent(id));
    setTimeout(()=>{const title=document.getElementById('selected-title');title?.focus({preventScroll:true});title?.scrollIntoView({block:'nearest'});});
  }
  selectBook(book:Book) { this.select(book.id); }
  @HostListener('window:hashchange') applyHash() {
    const match=location.hash.match(/^#(?:book|node)=(.+)$/);
    if(match) { try { const id=decodeURIComponent(match[1]);if(this.nodeMap().has(id)){this.selectedId.set(id);this.view.set('map');} } catch { /* Ignore malformed shared addresses. */ } }
  }
  toggleSave(id:string) {
    this.saved.update(ids=>ids.includes(id)?ids.filter(i=>i!==id):[...ids,id]);
    try {localStorage.setItem('atlas-saved',JSON.stringify(this.saved()));} catch { /* Session state still works without storage. */ }
  }
  setFilter(type:string) { this.filter.set(type); }
  toggleMenu() {this.menuOpen.update(v=>!v);}
  togglePause() {this.paused.update(v=>!v);}
  changeZoom(delta:number) {this.zoom.update(z=>Math.min(1.5,Math.max(.65,z+delta)));}
  resetMap() {this.zoom.set(1);this.filter.set('all');this.selectedId.set(null);history.replaceState(null,'',location.pathname+location.search);}
  closeSelection() {this.selectedId.set(null);history.replaceState(null,'',location.pathname+location.search);}
  async openSearch(query='') {
    if(this.aboutOpen()) this.closeAbout();
    if(!this.searchOpen()) this.searchReturnFocus=document.activeElement as HTMLElement;
    this.searchOpen.set(true);this.query.set(query);this.menuOpen.set(false);
    setTimeout(()=>this.searchInput?.nativeElement.focus());
    await this.loadSearch();
  }
  closeSearch() {if(this.searchOpen()){this.searchOpen.set(false);this.searchReturnFocus?.focus();}}
  async loadSearch() {
    if(this.searchLoaded() || this.searchLoading()) return;
    this.searchLoading.set(true);this.searchError.set(false);
    try {
      const response=await fetch('explorer-search.json');if(!response.ok) throw new Error('search');
      const data=await response.json();this.fullReferences.set(data.references);this.searchLoaded.set(true);
    } catch { this.searchError.set(true); } finally {this.searchLoading.set(false);}
  }
  openAbout() {this.closeSearch();this.aboutReturnFocus=document.activeElement as HTMLElement;this.aboutOpen.set(true);this.menuOpen.set(false);setTimeout(()=>document.getElementById('about-close')?.focus());}
  closeAbout() {if(!this.aboutOpen()) return;this.aboutOpen.set(false);this.aboutReturnFocus?.focus();}
  @HostListener('document:keydown',['$event']) keydown(event:KeyboardEvent) {
    if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k'){event.preventDefault();void this.openSearch();}
    if(event.key==='Escape'){if(this.searchOpen())this.closeSearch();else if(this.aboutOpen())this.closeAbout();this.menuOpen.set(false);}
    if(event.key==='Tab' && (this.searchOpen() || this.aboutOpen())){
      const dialog=document.getElementById(this.searchOpen()?'search-dialog':'about-dialog');
      const focusable=dialog?.querySelectorAll<HTMLElement>('button,a[href],input,select,[tabindex="0"]');
      if(focusable?.length){const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}}
    }
  }
  bookTitle(id:string) {return this.bookMap().get(id)?.title ?? id;}
  bookCount(node:AtlasNode) {return node.books?.length ?? 0;}
  bookNumber(book:Book) {return Number(book.id.replace(/\D/g,''));}
  countFor(book:Book) {return book.counts?.['total'] ?? 0;}
  plural(value:number, forms:[string,string,string]) {const n=Math.abs(value)%100,k=n%10;return n>10 && n<20?forms[2]:k===1?forms[0]:k>=2 && k<=4?forms[1]:forms[2];}
  bookLabel(value:number) {return this.plural(value,['книга','книги','книг']);}
  connectionLabel(value:number) {return this.plural(value,['связь','связи','связей']);}
}
