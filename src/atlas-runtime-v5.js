// Presentation caches never mutate the analytical graph or its source addresses.
const renderedSections=new Set(['graph']),pendingInputs=new Set(),searchTextCache=new Map();
let graphFrame=0;
function draw(){if(graphFrame)return;graphFrame=requestAnimationFrame(()=>{graphFrame=0;renderGraphFrame()})}
function debounceAtlas(fn,delay=110){let timer;return function(...args){clearTimeout(timer);pendingInputs.delete(timer);timer=setTimeout(()=>{pendingInputs.delete(timer);fn.apply(this,args)},delay);pendingInputs.add(timer)}}
function normalizeSearch(value){return String(value||'').normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё','е')}
function nodeSearchText(n){if(!searchTextCache.has(n.id))searchTextCache.set(n.id,normalizeSearch([n.label,n.description,n.aliases?.join(' '),n.author,n.roles?.join(' '),n.raw_citation,n.definition,n.design,n.author_use].filter(Boolean).join(' ')));return searchTextCache.get(n.id)}
function ensureSection(id){if(id==='sources'&&data.publication_mode==='public')return;if(renderedSections.has(id))return;switch(id){case'books':window.atlasBookNavigation?.showBooks();break;case'compare':break;case'authors':authorIndex();break;case'coding':codebook();break;case'arguments':argumentsIndex();break;case'catalogue':catalogue();break;case'chronology':renderChronology();break;case'synthesis':renderSynthesis();renderDiscourseExtras();break;case'sources':renderSources();renderMethodExtras();break;case'evolution':renderEvolution();break}renderedSections.add(id)}
function updateViewContext(){
 const mode=document.getElementById('graph-mode').value,ids=contextBookIds();
 const modeName=document.getElementById('graph-mode').selectedOptions[0]?.textContent;
 const context=mode==='chains'?chainMap.get(document.getElementById('chain-select').value)?.label:mode==='evolution'?trajectoryMap.get(document.getElementById('trajectory-select').value)?.label:null;
 document.getElementById('view-context').textContent=ids.length?ids.map(id=>books.get(id).title).join(' ↔ '):mode==='books'?'Все 50 книг Курпатова':context?`${modeName} · ${context}`:modeName;
 let active=0;for(const id of ['period','domain','source-voice'])if(document.getElementById(id).value!=='all')active++;if(document.getElementById('evidence-filter').value!=='all')active++;if(document.getElementById('node-search').value.trim())active++;if(focus)active++;
 document.getElementById('filter-state').textContent=active?`Фильтров: ${active}`:'';
}
function resetAll(){
 pendingInputs.forEach(clearTimeout);pendingInputs.clear();
 document.querySelectorAll('input[type="search"]').forEach(el=>el.value='');
 document.querySelectorAll('select').forEach(el=>el.selectedIndex=0);
 document.getElementById('graph-mode').value='books';document.getElementById('book-select').value='all';document.getElementById('book-category').value='overview';
 document.getElementById('compare-a').value='B003';document.getElementById('compare-b').value='B004';document.getElementById('book-compare-category').value='code';comparedBooks={a:'B003',b:'B004',category:'code'};
 selected=null;hovered=null;focus=false;bookNavigationNotice='';document.getElementById('focus').setAttribute('aria-pressed','false');
 document.querySelector('.graph-layout').classList.remove('expanded');document.getElementById('expand-map').setAttribute('aria-pressed','false');document.getElementById('tip').hidden=true;
 document.getElementById('advanced-filters').open=false;document.getElementById('share-output').hidden=true;document.getElementById('share-status').textContent='';
 renderedSections.clear();renderedSections.add('graph');clearCorpusSearch();tab('graph');document.querySelector('.nav').scrollLeft=0;showDetails(null);resize();saveGraphLink();updateViewContext();
}
document.getElementById('reset-all').addEventListener('click',resetAll);
