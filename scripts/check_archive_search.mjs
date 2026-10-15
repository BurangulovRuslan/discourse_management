/** Verify retrieval behavior independently against fixtures and the real corpus. */
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from '../frontend/node_modules/typescript/lib/typescript.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=await readFile(path.join(root,'frontend/src/app/archive-search.ts'),'utf8');
const directory=path.join(root,'frontend/.angular/archive-search-check');
await mkdir(directory,{recursive:true});
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const modulePath=path.join(directory,'archive-search.mjs');await writeFile(modulePath,compiled);
const {ArchiveSearch,stemRussian}=await import(new URL('../frontend/.angular/archive-search-check/archive-search.mjs',import.meta.url));

// These stems come from the published Russian Snowball vocabulary/algorithm.
for(const [word,stem] of Object.entries({вагонами:'вагон',важнейшими:'важн',важностью:'важност',падениями:'паден',бегавшая:'бега',мышление:'мышлен',мышления:'мышлен',мышлением:'мышлен'}))assert.equal(stemRussian(word),stem,word);
const nodes=[
  {id:'n1',type:'theme',label:'Системное мышление',description:'Мышление позволяет сопоставлять факты и видеть целую систему.',degree:1},
  {id:'n2',type:'construct',label:'Привычка',description:'Усвоенное повторяемое поведение.',degree:1},
  {id:'n3',type:'construct',label:'Динамический стереотип',description:'Последовательность закреплённых реакций.',degree:100},
  {id:'n4',type:'construct',label:'Восприятие',description:'Как человек различает объекты окружающего мира.',degree:1},
  {id:'n5',type:'book',label:'Красная таблетка',description:'Книга о человеческом поведении.',degree:1},
];
const engine=new ArchiveSearch();engine.addNodes(nodes,[{id:'B001',title:'Исследования памяти'}]);
assert.equal(engine.searchNodes('системным мышлением')[0]?.item.id,'n1','Russian inflection');
assert.equal(engine.searchNodes('систмное мышлние')[0]?.item.id,'n1','Two genuine misspellings');
assert.equal(engine.searchNodes('как устроено мышление')[0]?.item.id,'n1','An explicit question frame is not treated as a misspelling');
assert.deepEqual(engine.interpretation('как справиться с тревогой').tokens,['тревогой'],'Search the stated topic without pretending to answer the question');
assert.deepEqual(engine.interpretation('как справиться со страхом').tokens,['страхом'],'Support the natural Russian preposition form');
assert.equal(engine.searchNodes('перцепция')[0]?.item.id,'n4','Controlled synonym');
assert.equal(engine.searchNodes('перцепция')[0]?.matchKind,'related');
assert.equal(engine.searchNodes('привычка')[0]?.item.id,'n2','Literal result outranks related concept');
assert(engine.searchNodes('привычки').some(hit=>hit.item.id==='n3'&&hit.matchKind==='related'),'Related concept is honestly labeled');
assert.equal(engine.searchNodes('мышление',{types:['book']}).length,0,'Type filter');
assert.equal(engine.searchNodes('мышление',{ids:[]}).length,0,'Empty saved collection');
assert.equal(engine.searchNodes('мышление',{ids:['n1']})[0]?.item.id,'n1','ID filter');
assert.equal(engine.searchNodes('ыжщэщыжщэ').length,0,'No fabricated result');
await engine.addDossiers({nodes:{n5:{description:'Книга о поведении.',sections:[{label:'Контекст',text:'Эпистемология рассматривает основания знания.'}]}}});
assert.equal(engine.searchNodes('эпистемологией')[0]?.item.id,'n5','Lazy full dossier upgrade');
const quotes=[{book:'B001',locator:'§0001',excerpt:'Память изменяется при запоминании нового опыта.\n\nЭто слова автора: «А & Б».',author:'Точный автор',url:'sources/B001.html#_0001',nodeIds:['n1']}];
const original=JSON.stringify(quotes);await engine.addQuotes(quotes);
const quote=engine.searchQuotes('запоминанием')[0];assert(quote,'Quote inflection');
assert.equal(quote.item,quotes[0],'Return the original evidence object');
assert.equal(JSON.stringify(quotes),original,'Do not alter quotation wording or attribution');
assert.equal(quote.parts.map(part=>part.text).join(''),quote.snippet,'Safe highlight fragments are complete');
assert(quote.parts.some(part=>part.match),'Highlight matches actual source words');
assert(Number.isFinite(quote.score)&&quote.explanation,'Rank and explanation');

let fetched=0;const loading=new ArchiveSearch();loading.addNodes(nodes);
const fetcher=async()=>{fetched++;return {ok:true,json:async()=>({references:quotes})};};
const first=loading.loadQuotes('fixture.json',fetcher),second=loading.loadQuotes('fixture.json',fetcher);
assert.equal(first,second,'Coalesce parallel lazy loads');assert.equal((await first)[0],quotes[0]);assert.equal(fetched,1);

const data=JSON.parse(await readFile(path.join(root,'site/explorer-data.json'),'utf8'));
const corpus=JSON.parse(await readFile(path.join(root,'site/explorer-search.json'),'utf8'));
const full=new ArchiveSearch();const started=performance.now();full.addNodes(data.nodes,data.books);
let yielded=0;const timer=setInterval(()=>yielded++,0);
try{await full.addQuotes(corpus.references);}finally{clearInterval(timer);}
assert.equal(full.stats().nodes,4698);assert.equal(full.stats().quotes,5370);assert(yielded>1,'Quote indexing yields to rendering between batches');
assert(full.searchNodes('системным мышлением').some(hit=>/мышл/i.test(hit.item.label)),'Real corpus inflection');
assert(full.searchNodes('мышлние').some(hit=>/мышл/i.test(hit.item.label)),'Real corpus typo');
assert(full.searchQuotes('динамическим стереотипом',{limit:20}).length>0,'Real quotations across forms');
assert(full.searchNodes('перцепция').length>0,'Real corpus semantic expansion');
assert(full.searchNodes('как устроено мышление',{limit:5}).some(hit=>/мышление/i.test(hit.item.label)),'The UI placeholder has useful real results');
const anxiety=full.searchNodes('как справиться с тревогой',{limit:5});
assert(anxiety.length>0&&anxiety.every(hit=>/тревог|тревож|страх/i.test(hit.item.label)),'Natural-language question retrieves its actual topic');
assert(anxiety.every(hit=>!hit.explanation.includes('правила')),'Do not invent a typo explanation for a discarded question verb');
const fear=full.searchNodes('страх',{limit:1})[0];
assert(fear&&fear.matchKind==='exact'&&!fear.matchedTerms.some(term=>/тревог/i.test(term)),'Related terms cannot masquerade as exact evidence');
assert.equal(full.searchQuotes('мышление',{limit:3}).length,3,'Quote limit');
const fullDossiers=JSON.parse(await readFile(path.join(root,'site/explorer-dossiers.json'),'utf8'));
await full.addDossiers(fullDossiers);
const retrieval=[];
for(const query of ['мышление','тревога','как устроено мышление','как справиться с тревогой']){
  const queryStarted=performance.now(),hits=full.searchNodes(query);
  assert(hits.length>0,'Complete-dossier retrieval');
  retrieval.push({query,hits:hits.length,milliseconds:Math.round(performance.now()-queryStarted)});
}
assert.equal(full.searchNodes('мышление')[0]?.item.label.toLowerCase(),'мышление','Exact concept title has priority');
console.log(JSON.stringify({passed:true,nodes:full.stats().nodes,quotes:full.stats().quotes,indexing_ms:Math.round(performance.now()-started),async_yields:yielded,retrieval,checks:['Russian stems','inflections','typos','controlled expansion','literal ranking','question topics','honest evidence','filters','full dossiers','raw quotation identity','safe snippets','lazy load','batch yielding','real corpus']},null,2));
