// Embedded inside the atlas IIFE. Primary corpus books are distinct from named works.
(()=>{
 const gallery=document.getElementById('books'),comparison=document.getElementById('compare');
 if(!gallery||!comparison)return;
 const navigation=data.book_navigation;
 if(!navigation?.profiles?.length){
  gallery.innerHTML='<h2>Книги корпуса</h2><p>Данные книжной навигации ещё не включены в эту сборку.</p>';
  comparison.innerHTML='<h2>Сравнение книг</h2><p>Данные сравнения ещё не включены в эту сборку.</p>';
  return;
 }
 const categories=[['code','Подробные коды'],['experiment','Исследовательские эпизоды'],['thinker','Названные фигуры'],['work','Названные работы'],['citation','Библиографические записи'],['construct','Конструкции и понятия'],['proposition','Реконструированные тезисы']];
 const otherCategories=[['theme','Тематические линии'],['chain_step','Звенья цепочек'],['trajectory_stage','Стадии понятий']];
 const profiles=navigation.profiles.filter(p=>books.has(p.id));
 const profileById=new Map(profiles.map(p=>[p.id,p]));
 const pairKey=(a,b)=>[a,b].sort().join('|');
 const pairById=new Map((navigation.pairs||[]).map(p=>[pairKey(p.a,p.b),p]));
 const normal=s=>String(s??'').toLocaleLowerCase('ru').replaceAll('ё','е').trim();
 const yearOf=p=>{const y=Number(p.year);return Number.isInteger(y)&&y>=1800&&y<=2200?y:null};
 const unique=xs=>[...new Set(xs||[])];
 const nodeIds=(p,t)=>unique(p?.connections?.[t]).filter(id=>byId.has(id));
 const sourceRefs=(rs,b)=>{const out=new Map();for(const r of scopedReferences(rs||[]))if(r?.book===b&&r.locator)out.set(JSON.stringify([r.book,r.locator,r.excerpt,r.source_context_author,r.source_context_note]),r);return [...out.values()]};
 // Keep differing quotations/voices at one locator, unlike the global locator-only index.
 const bookReferences=rs=>(rs||[]).map(r=>`<div class="ref">${linkRef(r)}${r.source_context_author?`<div class="small">Автор фрагмента: ${esc(r.source_context_author)}</div>`:''}${r.source_context_note?`<p class="small">${esc(r.source_context_note)}</p>`:''}${r.excerpt?`<blockquote>${esc(r.excerpt)}</blockquote>`:''}</div>`).join('');
 function caveats(a,b,id){return(navigation.semantic_caveats||[]).filter(c=>(c.book===a||c.book===b)&&(c.node===id||c.entity===id||c.node_id===id||c.entity_id===id)).map(c=>`<p class="caution"><b>${esc(c.book)}${c.locator?' · '+esc(c.locator):''}:</b> ${esc(c.text)}</p>`).join('')}
 const validPair=()=>{const a=document.getElementById('compare-a').value,b=document.getElementById('compare-b').value;return a&&b&&a!==b&&profileById.has(a)&&profileById.has(b)?{a,b,pair:pairById.get(pairKey(a,b))}:null};
 const common=(a,b,t)=>{
  const pair=pairById.get(pairKey(a,b));
  if(Array.isArray(pair?.shared?.[t]))return unique(pair.shared[t]).filter(id=>byId.has(id)&&evidence(profileById.get(a),t,id).length&&evidence(profileById.get(b),t,id).length);
  const right=new Set(nodeIds(profileById.get(b),t));
  return nodeIds(profileById.get(a),t).filter(id=>right.has(id)&&evidence(profileById.get(a),t,id).length&&evidence(profileById.get(b),t,id).length);
 };
 function evidence(p,t,id){
  const scoped=p?.evidence?.[t]?.[id];
  const rs=Array.isArray(scoped)?scoped:scoped?.references||scoped?.refs;
  // Supplied navigation evidence is authoritative. The node fallback remains book-scoped.
  if(rs)return sourceRefs(rs,p.id);
  const n=byId.get(id);
  return sourceRefs([...(n?.references||[]),...(t==='citation'?n?.cited_at||[]:[])],p.id);
 }
 const genericRoles={code:'Аналитическая разметка фрагментов этой книги.',experiment:'Пересказ исследовательского эпизода; его книжное применение показано ниже.',thinker:'Документированная отсылка к фигуре. Само упоминание не означает принятие её позиции.',work:'Названное произведение или источник; роль зависит от конкретного фрагмента.',citation:'Библиографическая отсылка; наличие записи не означает согласие с её выводами.',construct:'Понятие связано с размеченными фрагментами этой книги.',proposition:'Аналитически реконструированный тезис, опирающийся на фрагменты этой книги.'};
 function roles(p,t,id){
  const n=byId.get(id),scoped=p?.evidence?.[t]?.[id];
  const saved=Array.isArray(scoped)?[]:scoped?.roles||[];
  const local=(n?.role_contexts||[]).filter(c=>sourceRefs(c.references,p.id).length).map(c=>c.role);
  return unique([...saved,...local].filter(x=>typeof x==='string'&&x.trim()));
 }
 function variants(p,id){
  const v=p.experiment_variants?.[id];
  const rows=Array.isArray(v)?v.map(x=>typeof x==='number'?byId.get(id)?.variants?.[x]:x).filter(Boolean):(byId.get(id)?.variants||[]);
  return rows.map(x=>({...x,references:sourceRefs(x.references,p.id)})).filter(x=>x.references.length);
 }
 const graphBook=id=>{if(typeof openBook==='function')openBook(id);else{tab('graph');select(id)}};
 const graphPair=(a,b,t,id)=>{if(typeof openBookCompare==='function'){const period=document.getElementById('period').value,voice=document.getElementById('source-voice').value;openBookCompare(a,b,t);document.getElementById('period').value=period;document.getElementById('source-voice').value=voice;rebuild();if(id)select(id)}else if(id){tab('graph');select(id)}};
 const bookLabel=p=>`${p.id} · ${p.title}${yearOf(p)?' · '+yearOf(p):''}`;
 const dateLabel=p=>yearOf(p)?`${yearOf(p)}${yearOf(p)<2010?' · ранний слой':''}`:'Датировка требует оговорки';
 function countMarkup(p){
  return [...categories,...otherCategories].map(([t,l])=>`<div><dt>${esc(l)}</dt><dd>${nodeIds(p,t).length}</dd></div>`).join('')+`<div><dt>Цепочки</dt><dd>${unique(p.chain_ids).length}</dd></div><div><dt>Траектории понятий</dt><dd>${unique(p.trajectory_ids).length}</dd></div>`;
 }
 gallery.innerHTML=`<div class="book-ui"><div class="kind">Первичный корпус · ${profiles.length} книг</div><h2>Начать с книги</h2><p class="lead">Откройте книгу, чтобы увидеть её отсылки, исследовательские эпизоды и подробную разметку. Две книги можно сопоставить по общим сущностям и проверить источники каждой стороны.</p><p class="notice">Годы относятся к доступным изданиям и авторским датам; это не даты появления идей. Числа показывают объём разметки, а повторяемость материала не создаёт независимых доказательств.</p><div class="book-controls"><label>Найти книгу<input id="book-search" type="search" placeholder="Название или номер B003"></label><label>Период<select id="book-period"><option value="all">Все периоды</option><option value="recent">С 2022 года</option><option value="middle">2010–2021</option><option value="early">До 2010 года</option><option value="undated">Без однозначного года</option></select></label><label>Порядок<select id="book-sort"><option value="corpus">По номеру в корпусе</option><option value="newest">От поздних к ранним</option><option value="oldest">От ранних к поздним</option><option value="title">По названию</option></select></label><button type="button" id="book-reset">Сбросить фильтры</button></div><p id="book-count" class="small" role="status" aria-live="polite"></p><div id="book-gallery" class="book-gallery"></div></div>`;
 const options='<option value="">Выберите книгу</option>'+profiles.map(p=>`<option value="${esc(p.id)}">${esc(bookLabel(p))}</option>`).join('');
  comparison.innerHTML=`<div class="book-ui"><div class="kind">Общие сущности · раздельные основания</div><h2>Сопоставить две книги</h2><p class="notice">Общая карточка позволяет сравнить применение одной сущности. Она не устанавливает одинаковую аргументацию, влияние между книгами или совпадение лабораторных протоколов.</p><div class="book-compare-controls"><label>Первая книга<select id="compare-a">${options}</select></label><label>Вторая книга<select id="compare-b">${options}</select></label><button type="button" id="book-swap" disabled>Поменять местами</button><label>Общая категория<select id="book-compare-category">${categories.map(([t,l])=>`<option value="${t}">${esc(l)}</option>`).join('')}</select></label></div><div class="book-compare-actions"><button type="button" id="book-compare-graph" disabled>Открыть сравнение на графе</button><a id="book-compare-link" hidden>Ссылка на это сравнение</a></div><div id="book-pair-notes"></div><p id="book-common-count" role="status" aria-live="polite"></p><label class="book-common-search" hidden id="book-common-search-label">Найти среди общих сущностей<input id="book-common-search" type="search" placeholder="Имя, понятие или название"></label><div id="book-common-body"></div></div>`;
 function renderGallery(){
  const q=normal(document.getElementById('book-search').value),period=document.getElementById('book-period').value,sort=document.getElementById('book-sort').value;
  let list=profiles.filter(p=>{
   const y=yearOf(p);const dateOK=period==='all'||period==='recent'&&y>=2022||period==='middle'&&y>=2010&&y<2022||period==='early'&&y&&y<2010||period==='undated'&&!y;
   return dateOK&&normal([p.id,p.title,p.date_note].join(' ')).includes(q);
  });
  if(sort==='title')list.sort((a,b)=>a.title.localeCompare(b.title,'ru'));
  if(sort==='newest')list.sort((a,b)=>(yearOf(b)||0)-(yearOf(a)||0)||a.id.localeCompare(b.id));
  if(sort==='oldest')list.sort((a,b)=>(yearOf(a)||9999)-(yearOf(b)||9999)||a.id.localeCompare(b.id));
  document.getElementById('book-count').textContent=`${list.length} из ${profiles.length} книг корпуса.`;
  const body=document.getElementById('book-gallery');
  body.innerHTML=list.length?list.map(p=>`<article class="book-card"><div class="book-card-meta"><span>${esc(p.id)}</span><span>${esc(dateLabel(p))}</span></div><h3>${esc(p.title)}</h3><p class="book-date-note">${esc(p.date_note||'Уточнение датировки см. в источниках корпуса.')}</p><div class="book-card-actions"><button type="button" data-book="${esc(p.id)}" aria-label="Связи книги на графе: ${esc(p.title)}">Связи книги на графе</button><button type="button" data-book-pick="${esc(p.id)}" aria-label="Добавить в сравнение: ${esc(p.title)}">Добавить в сравнение</button><a href="sources/${esc(p.id)}.html" target="_blank" rel="noopener">${data.publication_mode==='public'?'Цитатные опоры':'Текст с адресами'}<span class="sr-only"> · ${esc(p.title)} · в новой вкладке</span></a></div><details><summary>Состав разметки (${nodeIds(p,'code').length} кодов · ${nodeIds(p,'experiment').length} эпизодов · ${nodeIds(p,'thinker').length} фигур)</summary><dl class="book-counts">${countMarkup(p)}</dl></details></article>`).join(''):'<p class="book-empty">По этим фильтрам книги не найдены.</p>';
  body.querySelectorAll('[data-book]').forEach(b=>b.addEventListener('click',()=>graphBook(b.dataset.book)));
  body.querySelectorAll('[data-book-pick]').forEach(b=>b.addEventListener('click',()=>{
   const a=document.getElementById('compare-a'),right=document.getElementById('compare-b');
   const id=b.dataset.bookPick;
   if(!a.value||a.value===id)a.value=id;else right.value=id;
   document.getElementById('book-common-search').value='';renderComparison();tab('compare');
   (!right.value?right:a).focus();
  }));
 }
 function side(p,t,id){
  const n=byId.get(id),rs=evidence(p,t,id),localRoles=roles(p,t,id),vs=t==='experiment'?variants(p,id):[],citation=p.citation_contexts?.[id];
  const variantHTML=vs.map(v=>{
   const vrs=sourceRefs(v.references,p.id);return `<div class="book-variant"><h5>${esc(v.label||'Вариант пересказа')}</h5>${v.kind?`<p class="small">${esc(kinds[v.kind]||v.kind)}${v.subtype?' · '+esc(v.subtype):''}</p>`:''}${v.design?`<p><b>Процедура:</b> ${esc(v.design)}</p>`:''}${v.author_use?`<p><b>Применение в книге:</b> ${esc(v.author_use)}</p>`:''}${v.caution?`<p class="small">${esc(v.caution)}</p>`:''}${vrs.length?bookReferences(vrs):''}</div>`;
  }).join('');
  const citationHTML=t==='citation'&&citation?`${citation.boundary?`<p class="small">${esc(citation.boundary)}</p>`:''}<details><summary>Библиографическая запись в этой книге (${sourceRefs(citation.bibliography,p.id).length})</summary>${bookReferences(sourceRefs(citation.bibliography,p.id))}</details><details><summary>Фрагменты, отсылающие к записи (${sourceRefs(citation.cited_at,p.id).length})</summary>${sourceRefs(citation.cited_at,p.id).length?bookReferences(sourceRefs(citation.cited_at,p.id)):'<p class="small">Отдельный фрагмент со сноской не сохранён.</p>'}</details>`:'';
  return `<section class="book-evidence-side" aria-label="${esc(p.title)}"><h4>${esc(p.id)} · ${esc(p.title)}</h4>${localRoles.length?localRoles.map(r=>`<p class="book-role">${esc(r)}</p>`).join(''):`<p class="book-role">${esc(genericRoles[t])}</p>`}${t==='experiment'&&vs.length?`<details><summary>Пересказ и применение в этой книге (${vs.length})</summary>${variantHTML}</details>`:''}${citationHTML||`<details><summary>Текстовые основания этой книги (${rs.length})</summary>${rs.length?bookReferences(rs):'<p class="small">Для этой связи отдельный адрес не сохранён. Проверьте карточку и источниковую разметку.</p>'}</details>`}</section>`;
 }
 function renderComparison(){
  document.getElementById('book-compare-period').value=document.getElementById('period').value;
  document.getElementById('book-compare-voice').value=document.getElementById('source-voice').value;
  const a=document.getElementById('compare-a').value,b=document.getElementById('compare-b').value,t=document.getElementById('book-compare-category').value,pair=validPair();
  const body=document.getElementById('book-common-body'),count=document.getElementById('book-common-count'),notes=document.getElementById('book-pair-notes'),link=document.getElementById('book-compare-link');
  document.getElementById('book-swap').disabled=!a||!b;
  document.getElementById('book-compare-graph').disabled=!pair;
  document.getElementById('book-common-search-label').hidden=!pair;
  link.hidden=!pair;
  for(const o of document.getElementById('book-compare-category').options){const label=categories.find(x=>x[0]===o.value)[1];o.textContent=pair?`${label} (${common(a,b,o.value).length})`:label}
  if(!pair){count.textContent=a&&b&&a===b?'Выбрана одна и та же книга. Укажите две разные книги для сравнения.':'Выберите две книги корпуса.';body.innerHTML='';notes.innerHTML='';return}
  link.href=`#compare=${encodeURIComponent(a)},${encodeURIComponent(b)}&type=${encodeURIComponent(t)}`;
  for(const [id,key] of [['period','period'],['source-voice','voice']]){const value=document.getElementById(id).value;if(value!=='all')link.href+='&'+key+'='+encodeURIComponent(value)}
  const pa=profileById.get(a),pb=profileById.get(b),ids=common(a,b,t),q=normal(document.getElementById('book-common-search').value);
  const list=ids.map(id=>byId.get(id)).filter(n=>normal([n.label,n.description,n.definition,n.author,n.id].join(' ')).includes(q)).sort((x,y)=>x.label.localeCompare(y.label,'ru'));
  count.textContent=`${categories.find(x=>x[0]===t)[1]} · общие карточки по текущим фильтрам: ${ids.length}${q?' · по поиску '+list.length:''}.`;
  notes.innerHTML=`<p class="book-pair-heading"><b>${esc(pa.title)}</b><span aria-hidden="true"> ↔ </span><b>${esc(pb.title)}</b></p><p class="small">${esc(pa.id)}: ${esc(pa.date_note||dateLabel(pa))}<br>${esc(pb.id)}: ${esc(pb.date_note||dateLabel(pb))}</p>${pair.pair?.interpretation_boundary?`<p class="caution">${esc(pair.pair.interpretation_boundary)}</p>`:''}${pair.pair?.edition_notes?.length?`<details><summary>Редакции и повторы в этой паре</summary>${pair.pair.edition_notes.map(x=>`<p>${esc(x.text)}</p>${references((x.references||[]).filter(r=>r.book===a||r.book===b))}`).join('')}</details>`:''}${t==='experiment'?'<p class="caution">Некоторые карточки объединяют семейство опытов или разные пересказы. Сопоставляйте процедуры и авторское применение в двух колонках; общая карточка не гарантирует один протокол.</p>':''}`;
  body.innerHTML=list.length?list.map(n=>`<article class="book-common-card"><div class="kind">${esc(types[n.type]||n.type)}${n.type==='experiment'&&n.kind?' · '+esc(kinds[n.kind]||n.kind):''}</div><h3><button type="button" data-book-common="${esc(n.id)}">${esc(n.label)}</button></h3>${caveats(a,b,n.id)}${n.type==='experiment'&&n.merge_note?`<p class="small">${esc(n.merge_note)}</p>`:''}${['code','construct','proposition'].includes(t)&&n.description?`<p>${esc(n.description)}</p>`:''}${n.type==='work'&&n.author?`<p class="small">Автор названной работы: ${esc(n.author)}</p>`:''}${n.type==='citation'&&n.raw_citation?`<p class="small">${esc(n.raw_citation)}</p>`:''}<div class="book-evidence-grid">${side(pa,t,n.id)}${side(pb,t,n.id)}</div></article>`).join(''):`<p class="book-empty">${ids.length?'По поиску общие карточки не найдены.':'В этой категории общие карточки не размечены. Это не доказывает отсутствие содержательного сходства книг.'}</p>`;
  body.querySelectorAll('[data-book-common]').forEach(button=>button.addEventListener('click',()=>graphPair(a,b,t,button.dataset.bookCommon)));
 }
 document.querySelector('#compare .book-compare-controls').insertAdjacentHTML('beforeend',`<label>Период источников<select id="book-compare-period">${document.getElementById('period').innerHTML}</select></label><label>Голос источника<select id="book-compare-voice">${document.getElementById('source-voice').innerHTML}</select></label>`);
 document.querySelector('#compare .book-compare-controls').insertAdjacentHTML('afterend','<p class="small">Период и голос источника применяются к обеим книгам и синхронизированы с графом. Пара без адресов с одной из сторон не показывается как подтверждённое пересечение.</p>');
 for(const [local,graph] of [['book-compare-period','period'],['book-compare-voice','source-voice']])document.getElementById(local).addEventListener('change',()=>{document.getElementById(graph).value=document.getElementById(local).value;renderComparison()});
 document.getElementById('book-search').addEventListener('input',debounceAtlas(renderGallery,110));
 ['book-period','book-sort'].forEach(id=>document.getElementById(id).addEventListener('change',renderGallery));
 document.getElementById('book-reset').addEventListener('click',()=>{document.getElementById('book-search').value='';document.getElementById('book-period').value='all';document.getElementById('book-sort').value='corpus';renderGallery()});
 ['compare-a','compare-b','book-compare-category'].forEach(id=>document.getElementById(id).addEventListener('change',()=>{document.getElementById('book-common-search').value='';renderComparison()}));
 document.getElementById('book-common-search').addEventListener('input',debounceAtlas(renderComparison,110));
 document.getElementById('book-swap').addEventListener('click',()=>{const a=document.getElementById('compare-a'),b=document.getElementById('compare-b'),previous=a.value;a.value=b.value;b.value=previous;renderComparison()});
 document.getElementById('book-compare-graph').addEventListener('click',()=>{const pair=validPair();if(pair)graphPair(pair.a,pair.b,document.getElementById('book-compare-category').value)});
 function setComparison(a,b,t='code'){
  document.getElementById('compare-a').value=profileById.has(a)?a:'';
  document.getElementById('compare-b').value=profileById.has(b)?b:'';
  document.getElementById('book-compare-category').value=categories.some(x=>x[0]===t)?t:'code';
  document.getElementById('book-common-search').value='';renderComparison();
 }
 // Root can synchronize controls when following a comparison fragment URL.
 window.atlasBookNavigation={setComparison,refresh:()=>{renderGallery();renderComparison()},showBooks:renderGallery,refreshComparison:renderComparison};
 window.__atlasBooksQA={profileIds:profiles.map(p=>p.id),common:(a,b,t)=>common(a,b,t),setComparison,evidence:(b,t,id)=>evidence(profileById.get(b),t,id),variants:(b,id)=>variants(profileById.get(b),id)};
})();
