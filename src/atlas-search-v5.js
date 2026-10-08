// Search recorded witnesses, never infer a new citation or import rejected refs.
let corpusSearchIndex=null,corpusSearchState=null,corpusPageSize=24;const nodeSearchWords=new Map();
function searchTerms(q){return(normalizeSearch(q).match(/[\p{L}\p{N}]+/gu)||[]).map(word=>{if(/^[а-я]+$/u.test(word)&&word.length>=5){const stem=word.replace(/(?:иями|ями|ами|ого|ему|ому|ие|ые|ой|ый|ий|ая|яя|ое|ее|ов|ев|ам|ям|ах|ях|ую|юю|ью|ья|а|я|ы|и|ь|й|у|ю|е)$/u,'');if(stem.length>=4)return foldSearchWord(stem)}return foldSearchWord(word)})}
function foldSearchWord(word){return word.replace(/^любв/u,'любов').replace(/^любов(?:ь|и|ью|ей|ям|ях|ями)$/u,'любовь')}
function lexicalWord(word){return foldSearchWord(normalizeSearch(word))}
function matchesNormalizedWord(w,t){return t==='любов'||t==='любовь'?/^любов(?:ь|н)/u.test(w):w.startsWith(t)}
function matchesWord(word,term){return matchesNormalizedWord(lexicalWord(word),lexicalWord(term))}
function searchWords(text){return(normalizeSearch(text).match(/[\p{L}\p{N}]+/gu)||[]).map(foldSearchWord)}
function wordsMatch(words,terms){return terms.every(t=>words.some(w=>matchesNormalizedWord(w,t)))}
function queryMatches(text,terms){return wordsMatch(searchWords(text),terms)}
function highlighted(text,terms){return String(text||'').split(/([\p{L}\p{N}]+)/u).map(part=>terms.some(t=>matchesNormalizedWord(lexicalWord(part),t))?'<mark class="search-highlight">'+esc(part)+'</mark>':esc(part)).join('')}
function ensureCorpusIndex(){
 if(corpusSearchIndex)return corpusSearchIndex;const map=new Map(),objects=new WeakMap();
 function add(r,ids){if(!r.excerpt||!books.has(r.book))return;let row=objects.get(r);if(!row){const key=JSON.stringify([r.book,r.locator,r.excerpt,r.source_context_author||'']);row=map.get(key);if(!row){row={ref:r,ids:new Set(),text:normalizeSearch(r.excerpt),words:searchWords(r.excerpt)};map.set(key,row)}objects.set(r,row)}ids.forEach(id=>row.ids.add(id))}
 for(const n of nodes){const rs=[...(n.references||[]),...(n.cited_at||[]),...(n.role_contexts||[]).flatMap(c=>c.references||[]),...(n.variants||[]).flatMap(v=>v.references||[])];rs.forEach(r=>add(r,[n.id]))}
 for(const e of edges)(e.references||[]).forEach(r=>add(r,[e.source,e.target]));
 corpusSearchIndex=[...map.values()];return corpusSearchIndex;
}
function clearCorpusSearch(){corpusSearchState=null;document.getElementById('corpus-results').hidden=true;document.getElementById('corpus-results').scrollTop=0;document.getElementById('corpus-result-body').replaceChildren();document.getElementById('corpus-result-status').textContent='';document.getElementById('corpus-more').hidden=true}
function runCorpusSearch(){
 const query=document.getElementById('corpus-query').value.trim(),terms=searchTerms(query);if(!terms.length){clearCorpusSearch();return}
 const quotes=ensureCorpusIndex().filter(row=>wordsMatch(row.words,terms));
 const matches=nodes.filter(n=>{if(!nodeSearchWords.has(n.id))nodeSearchWords.set(n.id,searchWords(nodeSearchText(n)));return wordsMatch(nodeSearchWords.get(n.id),terms)}).sort((a,b)=>{const score=n=>queryMatches(n.label,terms)?100:n.type==='book'?60:30;return score(b)-score(a)||a.label.localeCompare(b.label,'ru')});
 quotes.sort((a,b)=>Number(b.text.includes(normalizeSearch(query)))-Number(a.text.includes(normalizeSearch(query)))||(books.get(b.ref.book).edition_year||0)-(books.get(a.ref.book).edition_year||0)||a.ref.book.localeCompare(b.ref.book)||a.ref.locator.localeCompare(b.ref.locator,'ru',{numeric:true}));
 corpusSearchState={query,terms,quotes,matches,limit:corpusPageSize};renderCorpusResults();document.getElementById('corpus-results').scrollTop=0;
}
function renderCorpusResults(){
 const state=corpusSearchState;if(!state)return;const {query,terms,quotes,matches,limit}=state,panel=document.getElementById('corpus-results');panel.hidden=false;
 document.getElementById('corpus-result-status').textContent=`«${query}»: ${quotes.length} цитатных фрагментов · ${matches.length} карточек. Поиск по размеченным опорам всех книг; фильтры графа его не ограничивают.`;
 let html='';
 if(quotes.length)html+='<h3>Прямые адреса в книгах</h3>'+quotes.slice(0,limit).map(row=>{const r=row.ref,related=[...row.ids].map(id=>byId.get(id)).filter(n=>n.type!=='book').slice(0,3);return `<article class="corpus-result"><div class="result-meta">${esc(books.get(r.book).edition_year||'Дата уточняется')}${r.source_context_author?' · '+esc(r.source_context_author):''}</div>${linkRef(r)}<blockquote>${highlighted(r.excerpt,terms)}</blockquote><div class="chips"><button data-search-book="${r.book}">Открыть книгу на графе</button>${related.map(n=>`<button data-search-node="${n.id}">${esc(n.label)}</button>`).join('')}</div></article>`}).join('');
 if(matches.length)html+='<div class="search-node-results"><h3>Книги и понятия</h3><div class="chips">'+matches.slice(0,Math.max(12,Math.ceil(limit/2))).map(n=>`<button data-search-node="${n.id}"><span class="small">${esc(types[n.type])}</span> · ${highlighted(n.label,terms)}</button>`).join('')+'</div></div>';
 if(!quotes.length&&!matches.length)html='<p>В размеченных цитатах и карточках совпадений нет. Попробуйте более короткую форму слова или другое понятие. '+(data.publication_mode==='public'?'Страницы источников содержат размеченные цитатные опоры.':'Полный текст каждой книги доступен в локальном разделе «Корпус и метод».')+'</p>';
 document.getElementById('corpus-result-body').innerHTML=html;
 document.querySelectorAll('[data-search-node]').forEach(b=>b.addEventListener('click',()=>{panel.hidden=true;openAtlasNode(b.dataset.searchNode);document.getElementById('graph').scrollIntoView({block:'start'})}));
 document.querySelectorAll('[data-search-book]').forEach(b=>b.addEventListener('click',()=>{panel.hidden=true;openBook(b.dataset.searchBook,'all');document.getElementById('graph').scrollIntoView({block:'start'})}));
 const more=document.getElementById('corpus-more');more.hidden=limit>=quotes.length&&Math.max(12,Math.ceil(limit/2))>=matches.length;more.textContent=`Показать ещё · сейчас ${Math.min(limit,quotes.length)} из ${quotes.length} фрагментов`;
}
document.getElementById('corpus-query').addEventListener('input',debounceAtlas(runCorpusSearch,130));
document.getElementById('corpus-query').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();runCorpusSearch()}else if(e.key==='Escape'){document.getElementById('corpus-query').value='';clearCorpusSearch()}});
document.getElementById('corpus-more').addEventListener('click',()=>{if(corpusSearchState){corpusSearchState.limit+=corpusPageSize;renderCorpusResults()}});
window.__atlasSearchQA={search:runCorpusSearch,index:ensureCorpusIndex,getState:()=>corpusSearchState,clear:clearCorpusSearch};
