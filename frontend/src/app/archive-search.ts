import MiniSearch, { type Query, type SearchResult } from 'minisearch';

/** Local lexical retrieval. No model, remote query service, or generated text. */
export interface SearchNode { id:string; type:string; label:string; description?:string; degree?:number; books?:readonly string[]; }
export interface SearchQuote { book:string; locator:string; excerpt:string; paragraphs?:readonly string[]; url:string; nodeIds?:readonly string[]; author?:string; note?:string; }
export interface SearchBook { id:string; title:string; }
export interface SearchHit<T> {
  id:string; item:T; score:number; snippet:string;
  matchedTerms:string[]; matchKind:'exact'|'morphology'|'typo'|'related';
  explanation:string; parts:{text:string;match:boolean}[];
}
export interface SearchFilters { limit?:number; types?:readonly string[]; ids?:readonly string[]; }
export interface SearchInterpretation {
  tokens:string[];
  expandedTerms:{from:string;to:string;kind:'synonym'|'related'}[];
  summary:string;
}
interface PreparedDocument {
  rawWords:Set<string>; stems:Set<string>; forms:Map<string,string[]>;
  body:string; bodyFirst:Map<string,number>; normalizedLabel:string; normalizedBody:string;
  labelStems:Set<string>; labelWordCount:number;
}
interface IndexDocument { id:string; label:string; body:string; context:string; identifier:string; prepared:PreparedDocument; }
interface DossierText { description?:string; sections?:readonly {label:string;text:string}[]; }
interface Expansion { terms:readonly string[]; kind:'synonym'|'related'; }
interface Candidate { result:SearchResult; score:number; related:boolean; }

const TYPE_NAMES:Record<string,string>={book:'книга',theme:'тема',construct:'понятие',thinker:'автор',experiment:'исследование',code:'тематический код',proposition:'тезис',chain_step:'аргумент',trajectory_stage:'этап',work:'работа',citation:'библиография'};
// Related concepts are explicitly identified as such, never presented as equivalence.
const EXPANSIONS:readonly Expansion[]=[
  {terms:['искусственный интеллект','ии','ai'],kind:'synonym'},
  {terms:['восприятие','перцепция'],kind:'synonym'},
  {terms:['когнитивный','познавательный'],kind:'synonym'},
  {terms:['социальный','общественный'],kind:'synonym'},
  {terms:['обучение','научение'],kind:'synonym'},
  {terms:['мотивация','побуждение'],kind:'synonym'},
  {terms:['дсм','дефолт система мозга'],kind:'synonym'},
  {terms:['привычка','стереотип','паттерн'],kind:'related'},
  {terms:['мышление','рассуждение','интеллект'],kind:'related'},
  {terms:['внимание','осознанность','концентрация'],kind:'related'},
  {terms:['страх','тревога','тревожность'],kind:'related'},
  {terms:['память','запоминание'],kind:'related'},
  {terms:['эмоция','чувство'],kind:'related'},
  {terms:['самооценка','образ себя'],kind:'related'},
];
const STOP_WORDS=new Set('а без бы был была были было быть в вам вас весь во вот все всего всех вы где да даже для до его ее если есть еще же за здесь и из или им их к как какая какие какой когда кто ли либо мне может мы на над надо наш не него нее нет ни но ну о об однако он она они оно от очень по под при про с сам со так также такой там те тем то того тоже только том ты у уже уж чего чем что чтобы эта эти это этот я почему зачем который которые которого работать работает работают'.split(' '));
const WORD=/[\p{L}\p{N}]+/gu;
const VOWEL=/[аеиоуыэюя]/;
const normalize=(text:string)=>text.toLowerCase().replaceAll('ё','е').normalize('NFC');
const tokens=(text:string)=>normalize(text).match(WORD)??[];
const yieldToBrowser=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
function queryTopic(query:string):{text:string;framed:boolean}{
  const normalized=normalize(query.trim());
  const text=normalized
    .replace(/^как\s+(?:устроен(?:а|о|ы)?|работа(?:ет|ют)|действу(?:ет|ют)|возника(?:ет|ют)|формиру(?:ется|ются)|проявля(?:ется|ются))\s+/u,'')
    .replace(/^как\s+(?:справиться|бороться|совладать)\s+со?\s+/u,'')
    .replace(/^как\s+(?:избавиться|отделаться)\s+от\s+/u,'')
    .replace(/^(?:что\s+такое|расскажи(?:те)?(?:\s+мне)?\s+(?:о|об)|объясни(?:те)?(?:\s+мне)?)\s+/u,'');
  return {text,framed:text!==normalized};
}
const suffixes=(text:string)=>text.split(' ').sort((a,b)=>b.length-a.length);
const PERFECTIVE=suffixes('ив ивши ившись ыв ывши ывшись');
const PERFECTIVE_AY=suffixes('в вши вшись');
const ADJECTIVE=suffixes('ее ие ые ое ими ыми ей ий ый ой ем им ым ом его ого ему ому их ых ую юю ая яя ою ею');
const PARTICIPLE=suffixes('ивш ывш ующ');
const PARTICIPLE_AY=suffixes('ем нн вш ющ щ');
const VERB=suffixes('ила ыла ена ейте уйте ите или ыли ей уй ил ыл им ым ен ило ыло ено ят ует уют ит ыт ены ить ыть ишь ую ю');
const VERB_AY=suffixes('ла на ете йте ли й л ем н ло но ет ют ны ть ешь нно');
const NOUN=suffixes('а ев ов ие ье е иями ями ами еи ии и ией ей ой ий й иям ям ием ем ам ом о у ах иях ях ы ь ию ью ю ия ья я');

function region(word:string,start=0):number {
  for(let i=start;i<word.length-1;i++)if(VOWEL.test(word[i])&&!VOWEL.test(word[i+1]))return i+2;
  return word.length;
}
function strip(word:string,endings:readonly string[],start:number,afterAY=false):string|null {
  for(const ending of endings){
    const at=word.length-ending.length;
    if(at>=start&&word.endsWith(ending)&&(!afterAY||(at>start&&/[ая]/.test(word[at-1]))))return word.slice(0,at);
  }
  return null;
}
/** Russian Snowball suffix algorithm; stem is an index key, never display text.
 * Algorithm: https://snowballstem.org/algorithms/russian/stemmer.html
 */
export function stemRussian(input:string):string {
  let word=normalize(input);
  if(!/^[а-я]+$/.test(word))return word;
  const first=word.search(VOWEL);if(first<0)return word;
  const rv=first+1,r2=region(word,region(word));
  const perfective=strip(word,PERFECTIVE,rv)??strip(word,PERFECTIVE_AY,rv,true);
  if(perfective!==null)word=perfective;
  else{
    word=strip(word,['ся','сь'],rv)??word;
    const adjective=strip(word,ADJECTIVE,rv);
    if(adjective!==null)word=strip(adjective,PARTICIPLE,rv)??strip(adjective,PARTICIPLE_AY,rv,true)??adjective;
    else word=strip(word,VERB,rv)??strip(word,VERB_AY,rv,true)??strip(word,NOUN,rv)??word;
  }
  word=strip(word,['и'],rv)??word;
  word=strip(word,['ость','ост'],r2)??word;
  if(word.endsWith('нн')&&word.length-1>=rv)word=word.slice(0,-1);
  else{
    const superlative=strip(word,['ейше','ейш'],rv);
    if(superlative!==null)word=superlative.endsWith('нн')?superlative.slice(0,-1):superlative;
    else word=strip(word,['ь'],rv)??word;
  }
  return word;
}

export class ArchiveSearch<N extends SearchNode=SearchNode,Q extends SearchQuote=SearchQuote> {
  private nodeIndex=this.createIndex();
  private quoteIndex=this.createIndex();
  private nodeItems=new Map<string,N>();
  private quoteItems=new Map<string,Q>();
  private nodeDocuments=new Map<string,IndexDocument>();
  private quoteDocuments=new Map<string,IndexDocument>();
  private books=new Map<string,string>();
  private stems=new Map<string,string>();
  private quotePromise:Promise<Q[]>|null=null;
  private quoteReady=false;
  private quoteLoading=false;
  private quoteGeneration=0;
  private nodeGeneration=0;

  private stem=(value:string):string=>{
    const word=normalize(value),known=this.stems.get(word);
    if(known!==undefined)return known;
    const result=stemRussian(word);this.stems.set(word,result);return result;
  };
  private processTerm=(term:string):string|null=>{
    const word=normalize(term);
    return word.length<2||STOP_WORDS.has(word)?null:this.stem(word);
  };
  private createIndex():MiniSearch<IndexDocument>{
    return new MiniSearch<IndexDocument>({fields:['label','body','context','identifier'],tokenize:tokens,processTerm:term=>this.processTerm(term),searchOptions:{boost:{label:5,body:1,context:.55,identifier:8},weights:{fuzzy:.42,prefix:.65},maxFuzzy:2}});
  }
  private prepare(document:Omit<IndexDocument,'prepared'>):IndexDocument{
    const rawWords=new Set<string>(),stems=new Set<string>(),forms=new Map<string,string[]>();
    const source=[document.label,document.body,document.context,document.identifier].join(' ');
    for(const match of source.matchAll(WORD)){
      const word=normalize(match[0]),stem=this.stem(word);rawWords.add(word);stems.add(stem);
      if(!forms.has(stem))forms.set(stem,[]);
      const variants=forms.get(stem)!;if(variants.length<8&&!variants.includes(match[0]))variants.push(match[0]);
    }
    const body=document.body.replace(/\s+/g,' ').trim(),bodyFirst=new Map<string,number>();
    for(const match of body.matchAll(WORD)){const stem=this.stem(match[0]);if(!bodyFirst.has(stem))bodyFirst.set(stem,match.index!);}
    const labelWords=tokens(document.label).filter(word=>!STOP_WORDS.has(word));
    return {...document,prepared:{rawWords,stems,forms,body,bodyFirst,normalizedLabel:normalize(document.label),normalizedBody:normalize(document.body),labelStems:new Set(labelWords.map(this.stem)),labelWordCount:labelWords.length}};
  }
  private nodeDocument(node:N):IndexDocument {
    return this.prepare({id:node.id,label:node.label,body:node.description??'',context:[TYPE_NAMES[node.type]??'',...(node.books??[]).map(id=>this.books.get(id)??'')].join(' '),identifier:node.id});
  }
  addNodes(nodes:readonly N[],books:readonly SearchBook[]=[]):void {
    this.nodeGeneration++;this.books=new Map(books.map(book=>[book.id,book.title]));
    this.nodeItems=new Map(nodes.map(node=>[node.id,node]));
    this.nodeDocuments=new Map(nodes.map(node=>[node.id,this.nodeDocument(node)]));
    this.nodeIndex=this.createIndex();this.nodeIndex.addAll([...this.nodeDocuments.values()]);
  }
  /** Upgrade descriptions after dossiers are already requested by the reader. */
  async addDossiers(dossiers:{nodes:Record<string,DossierText>}):Promise<void>{
    const generation=++this.nodeGeneration,documents=new Map(this.nodeDocuments);
    let batch=0;
    for(const [id,dossier] of Object.entries(dossiers.nodes)){
      const existing=documents.get(id);if(existing)documents.set(id,this.prepare({...existing,body:[dossier.description??existing.body,...(dossier.sections??[]).map(section=>section.text)].join('\n\n')}));
      if(++batch%75===0)await yieldToBrowser();
    }
    const index=this.createIndex();await index.addAllAsync([...documents.values()],{chunkSize:100});
    if(generation===this.nodeGeneration){this.nodeDocuments=documents;this.nodeIndex=index;}
  }
  static quoteKey(ref:SearchQuote):string{return [ref.book,ref.locator,ref.excerpt,ref.author??''].join('|');}
  async addQuotes(references:readonly Q[]):Promise<void>{
    const generation=++this.quoteGeneration;this.quoteLoading=true;
    const items=new Map(references.map(ref=>[ArchiveSearch.quoteKey(ref),ref]));
    const documents=new Map<string,IndexDocument>();let batch=0;
    for(const [id,ref] of items){
      documents.set(id,this.prepare({id,label:'',body:ref.paragraphs?.length?ref.paragraphs.join('\n\n'):ref.excerpt,context:[this.books.get(ref.book)??'',ref.author??''].join(' '),identifier:''}));
      if(++batch%75===0)await yieldToBrowser();
    }
    const index=this.createIndex();
    try{await index.addAllAsync([...documents.values()],{chunkSize:75});
      if(generation===this.quoteGeneration){this.quoteItems=items;this.quoteDocuments=documents;this.quoteIndex=index;this.quoteReady=true;}
    }finally{if(generation===this.quoteGeneration)this.quoteLoading=false;}
  }
  loadQuotes(url='explorer-search.json',fetcher:typeof fetch=globalThis.fetch):Promise<Q[]>{
    if(this.quoteReady)return Promise.resolve([...this.quoteItems.values()]);
    if(this.quotePromise)return this.quotePromise;
    this.quoteLoading=true;
    this.quotePromise=(async()=>{
      const response=await fetcher(url);if(!response.ok)throw new Error(`Не удалось открыть индекс цитат (${response.status})`);
      const payload=await response.json() as {references:Q[]};
      if(!Array.isArray(payload.references))throw new Error('В индексе цитат отсутствуют фрагменты');
      await this.addQuotes(payload.references);return [...this.quoteItems.values()];
    })().finally(()=>{this.quotePromise=null;this.quoteLoading=false;});
    return this.quotePromise;
  }
  stats(){return {nodes:this.nodeItems.size,quotes:this.quoteItems.size,quotesReady:this.quoteReady,quotesLoading:this.quoteLoading,engine:'MiniSearch',mode:'local-lexical' as const};}
  interpretation(query:string):SearchInterpretation{
    const topic=queryTopic(query),words=tokens(topic.text).filter(word=>word.length>1&&!STOP_WORDS.has(word)).slice(0,16);
    const stems=words.map(this.stem),expandedTerms:SearchInterpretation['expandedTerms']=[];
    for(const group of EXPANSIONS){
      const matched=group.terms.find(term=>{
        const termStems=tokens(term).filter(word=>!STOP_WORDS.has(word)).map(this.stem);
        return termStems.length>0&&termStems.every(stem=>stems.includes(stem));
      });
      if(matched)for(const term of group.terms)if(term!==matched)expandedTerms.push({from:matched,to:term,kind:group.kind});
    }
    const topicNote=topic.framed?`Ищем материалы по теме «${words.join(' ')}». `:'';
    const related=[...new Set(expandedTerms.map(expansion=>expansion.to))].slice(0,4);
    return {tokens:words.slice(0,16),expandedTerms:expandedTerms.slice(0,12),summary:topicNote+(related.length?`Также ищем: ${related.map(term=>`«${term}»`).join(', ')}. Это расширения из словаря близких понятий.`:'Учитываем формы слов и небольшие опечатки.')};
  }
  searchNodes(query:string,filters:SearchFilters={}):SearchHit<N>[] {
    const ids=filters.ids?new Set(filters.ids):null,types=filters.types?new Set(filters.types):null;
    return this.search(query,this.nodeIndex,this.nodeItems,this.nodeDocuments,filters.limit,item=>(!ids||ids.has(item.id))&&(!types||types.has(item.type)));
  }
  searchQuotes(query:string,filters:Pick<SearchFilters,'limit'>={}):SearchHit<Q>[] {
    return this.search(query,this.quoteIndex,this.quoteItems,this.quoteDocuments,filters.limit);
  }
  private queryOptions(wordCount:number){return {combineWith:'AND' as const,prefix:(term:string,index:number)=>index===wordCount-1&&term.length>=3,fuzzy:(term:string)=>/^\d+$/.test(term)||term.length<4?false:term.length>=8?2:1};}
  private search<T>(query:string,index:MiniSearch<IndexDocument>,items:Map<string,T>,documents:Map<string,IndexDocument>,limit=Infinity,filter?:(item:T)=>boolean):SearchHit<T>[] {
    const interpretation=this.interpretation(query),words=interpretation.tokens;
    if(!words.length||normalize(query.trim()).length<2)return [];
    const candidates=new Map<string,Candidate>(),add=(result:SearchResult,multiplier:number,related:boolean)=>{
      const id=String(result.id),item=items.get(id);if(!item||(filter&&!filter(item)))return;
      const score=result.score*multiplier,current=candidates.get(id);
      // Expansion must never replace the evidence for a direct lexical hit.
      if(current&&!current.related&&related)return;
      if(current?.related&&!related){candidates.set(id,{result,score,related:false});return;}
      if(!current||score>current.score)candidates.set(id,{result,score,related});
      else if(!related)current.related=false;
    };
    for(const result of index.search(words.join(' '),this.queryOptions(words.length)))add(result,1,false);
    if(interpretation.expandedTerms.length){
      const groups:Query[]=words.map(word=>{
        const stem=this.stem(word),expansions=interpretation.expandedTerms.filter(expansion=>tokens(expansion.from).map(this.stem).includes(stem));
        return {combineWith:'OR',queries:[word,...expansions.map(expansion=>({combineWith:'AND' as const,queries:[expansion.to],boostTerm:()=>expansion.kind==='synonym'?.55:.32,fuzzy:false,prefix:false}))]};
      });
      for(const result of index.search({combineWith:'AND',queries:groups},this.queryOptions(words.length)))add(result,.55,true);
    }
    const normalizedQuery=normalize(words.join(' ')),queryStems=new Set(words.map(this.stem));
    const ranked=[...candidates].map(([id,candidate])=>{
      const document=documents.get(id)!,prepared=document.prepared;
      const exact=words.every(word=>prepared.rawWords.has(word)),morphology=[...queryStems].every(stem=>prepared.stems.has(stem));
      const phrase=prepared.normalizedLabel.includes(normalizedQuery)||prepared.normalizedBody.includes(normalizedQuery);
      const kind:SearchHit<T>['matchKind']=candidate.related&&!morphology?'related':exact?'exact':morphology?'morphology':'typo';
      const labelExact=prepared.normalizedLabel===normalizedQuery;
      const labelMorphology=prepared.labelWordCount===words.length&&prepared.labelStems.size===queryStems.size&&[...queryStems].every(stem=>prepared.labelStems.has(stem));
      const score=candidate.score*(exact?2.4:morphology?1.55:kind==='related'?.65:1)*(phrase?1.5:1)*(labelExact?2.1:labelMorphology?1.6:1);
      return {id,candidate,document,kind,score};
    }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id,'ru'));
    return ranked.slice(0,Math.max(0,limit)).map(row=>{
      const matchedStems=new Set(row.candidate.result.terms),matchedWords=[...new Set([...matchedStems].flatMap(stem=>row.document.prepared.forms.get(stem)??[]))].slice(0,8);
      const snippet=this.snippet(row.document,matchedStems),explanation=this.explanation(row.kind,words,matchedWords,interpretation);
      return {id:row.id,item:items.get(row.id)!,score:Math.round(row.score*1000)/1000,snippet:snippet.text,parts:snippet.parts,matchedTerms:matchedWords,matchKind:row.kind,explanation};
    });
  }
  private explanation(kind:SearchHit<unknown>['matchKind'],query:string[],matched:string[],interpretation:SearchInterpretation):string{
    const shown=matched.slice(0,3).map(word=>`«${word}»`).join(', ');
    if(kind==='related'){
      const expansion=interpretation.expandedTerms.find(value=>tokens(value.to).some(word=>matched.some(term=>this.stem(term)===this.stem(word))));
      return expansion?`${expansion.kind==='synonym'?'Синоним':'Близкое понятие'}: «${expansion.from}» → «${expansion.to}»`:`Близкое понятие: ${shown}`;
    }
    if(kind==='typo')return `Похожее написание или начало слова: ${shown||query.join(' ')}`;
    if(kind==='morphology')return `Совпали формы слов: ${shown}`;
    return `Точное совпадение: ${shown}`;
  }
  private snippet(document:IndexDocument,matched:Set<string>):{text:string;parts:{text:string;match:boolean}[]} {
    const body=document.prepared.body,label=document.label;
    const bodyPositions=[...matched].flatMap(stem=>{const at=document.prepared.bodyFirst.get(stem);return at===undefined?[]:[at];});
    const bodyHasMatch=bodyPositions.length>0;
    const source=bodyHasMatch?body:label||body||document.context;
    const first=bodyHasMatch?Math.min(...bodyPositions):[...source.matchAll(WORD)].find(match=>matched.has(this.stem(match[0])))?.index??0;
    let start=Math.max(0,first-65),end=Math.min(source.length,start+235);
    if(start>0){const boundary=source.indexOf(' ',start);if(boundary>=0&&boundary<first)start=boundary+1;}
    if(end<source.length){const boundary=source.lastIndexOf(' ',end);if(boundary>first)end=boundary;}
    const text=(start?'…':'')+source.slice(start,end)+(end<source.length?'…':''),parts:{text:string;match:boolean}[]=[];
    let cursor=0;
    for(const match of text.matchAll(WORD)){
      const at=match.index!;if(at>cursor)parts.push({text:text.slice(cursor,at),match:false});
      parts.push({text:match[0],match:matched.has(this.stem(match[0]))});cursor=at+match[0].length;
    }
    if(cursor<text.length)parts.push({text:text.slice(cursor),match:false});
    return {text,parts};
  }
}
