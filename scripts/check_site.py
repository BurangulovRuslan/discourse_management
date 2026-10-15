"""Verify relative links, anchors, private paths, graph consistency and packing."""
from html.parser import HTMLParser
from collections import Counter
import json
import math
import os
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
from inline_data import unpack_inline
from build_explorer_data import (ID_TOKEN, export_dossier, export_reference, reference_key,
                                 search_references, topology_signature, without_references)


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.links = set(), []
        self.collisions = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            if attrs['id'] in self.ids:
                self.collisions.append(attrs['id'])
            self.ids.add(attrs['id'])
        if tag in ('a', 'link') and attrs.get('href'):
            self.links.append(attrs['href'])
        if tag in ('script', 'img') and attrs.get('src'):
            self.links.append(attrs['src'])


def check(project):
    site = project/'site'
    errors, pages = [], {}
    for path in sorted(site.rglob('*.html')):
        page = Page()
        page.feed(path.read_text(encoding='utf-8'))
        pages[path.resolve()] = page
        errors.extend(f'Duplicate anchor: {path.name}#{anchor}' for anchor in page.collisions)
    checked_links = 0
    for path, page in pages.items():
        for link in page.links:
            url = urlsplit(link)
            if url.scheme in ('http','https','mailto'):
                continue
            if url.scheme or link.startswith('/'):
                errors.append(f'Nonrelative local link: {path.name}: {link}')
                continue
            target = (path.parent/unquote(url.path)).resolve() if url.path else path
            if not target.is_relative_to(site.resolve()) or not target.is_file():
                errors.append(f'Missing target: {path.name}: {link}')
                continue
            if url.fragment and not any(url.fragment.startswith(k) for k in ('book=','compare=','books')) and target in pages and unquote(url.fragment) not in pages[target].ids:
                errors.append(f'Missing anchor: {path.name}: {link}')
            checked_links += 1
    # Audit the entire distributable, including scripts and analytical exports.
    private_paths, originals = [], []
    audit_files = []
    for directory, dirs, filenames in os.walk(project):
        # Dependencies and compiler caches are neither source snapshots nor
        # distributed content. Walking node_modules also makes audits needlessly
        # expensive and flags third-party documentation as project material.
        dirs[:] = [name for name in dirs if name not in
                   ('.git', 'frontend', 'node_modules', '__pycache__', '.angular')]
        audit_files.extend(Path(directory) / name for name in filenames)
    for path in audit_files:
        if path.suffix.lower() in ('.md','.markdown') and path.relative_to(project).as_posix()!='README.md':
            errors.append('Only the project README may be included as Markdown: '+str(path.relative_to(project)))
        if path.suffix.lower() in ('.pdf','.fb2','.doc','.docx','.rtf','.epub'):
            originals.append(str(path.relative_to(project)))
        if path.suffix in ('.html','.json','.graphml','.js','.css','.md','.yml'):
            value=path.read_text(encoding='utf-8-sig')
            if re.search(r'file://|(?<![A-Za-z0-9.])[A-Za-z]:[\\/]',value):
                private_paths.append(str(path.relative_to(project)))
    if private_paths:
        errors.append('Private machine paths: '+str(private_paths))
    if originals:
        errors.append('Book files in package: '+str(originals))
    data=json.loads((site/'atlas-data.json').read_text(encoding='utf-8'))
    raw=(site/'legacy.html').read_text(encoding='utf-8')
    if data.get('publication_mode')=='public' and 'data-tab="sources"' in raw:
        errors.append('Corpus/method navigation must be absent from the public build')
    embedded=json.loads(re.search(r'<script id="atlas-data" type="application/json">(.*?)</script>',raw,re.S)[1])
    if unpack_inline(embedded)!=data:
        errors.append('Legacy inline data differs from JSON export')
    if '<app-root' not in (site/'index.html').read_text(encoding='utf-8'):
        errors.append('The Angular main interface has not been built')
    if 'href="index.html"' not in raw:
        errors.append('Legacy must provide a return link to the main interface')
    ns={'g':'http://graphml.graphdrawing.org/xmlns'}
    graph=ET.parse(site/'kurpatov.graphml')
    graph_counts=(len(graph.findall('.//g:node',ns)),len(graph.findall('.//g:edge',ns)))
    if graph_counts!=(len(data['nodes']),len(data['edges'])):
        errors.append('GraphML topology differs')
    ids={n['id'] for n in data['nodes']}
    if len(ids)!=len(data['nodes']) or any(e['source'] not in ids or e['target'] not in ids for e in data['edges']):
        errors.append('Invalid graph identifiers')
    if len(data['books'])!=50 or len(data.get('book_navigation',{}).get('profiles',[]))!=50:
        errors.append('Incomplete book navigation')
    for profile in data['book_navigation']['profiles']:
        for category, rows in profile['evidence'].items():
            for nid,refs in rows.items():
                if nid not in ids or not refs or any(r['book']!=profile['id'] for r in refs):
                    errors.append('Invalid book-scoped reference')
    explorer=json.loads((site/'explorer-data.json').read_text(encoding='utf-8'))
    search=json.loads((site/'explorer-search.json').read_text(encoding='utf-8'))
    dossiers=json.loads((site/'explorer-dossiers.json').read_text(encoding='utf-8'))
    book_ids={book['id'] for book in data['books']}
    explorer_ids={node['id'] for node in explorer['nodes']}
    if explorer_ids!=ids or len(explorer['nodes'])!=len(data['nodes']):
        errors.append('Explorer node topology differs')
    if {book['id'] for book in explorer['books']}!=book_ids:
        errors.append('Explorer book coverage differs')
    expected_edges=[{key: edge[key] for key in ('source','target','analytical')} for edge in data['edges']]
    if explorer['edges']!=expected_edges:
        errors.append('Explorer edge topology or evidence mode differs')
    original_nodes={node['id']:node for node in data['nodes']}
    expected_degree=Counter()
    for edge in data['edges']:
        expected_degree[edge['source']]+=1
        expected_degree[edge['target']]+=1
    for node in explorer['nodes']:
        if node['label']!=original_nodes[node['id']]['label'] or node['type']!=original_nodes[node['id']]['type']:
            errors.append('Explorer changed an analytical node label or type')
        if not set(node['books']).issubset(book_ids) or any(not isinstance(index,int) or index<0 or index>=len(explorer['references']) for index in node['refIds']):
            errors.append('Explorer has invalid book or quotation identifiers')
        if not all(isinstance(node.get(axis),(int,float)) and math.isfinite(node[axis]) for axis in ('x','y')):
            errors.append('Explorer must have finite map coordinates for every analytical node')
        if node.get('degree')!=expected_degree[node['id']]:
            errors.append('Explorer node degree differs from the real graph')
    layout=explorer.get('layout',{})
    if (layout.get('algorithm')!='ForceAtlas2' or layout.get('topology')!=topology_signature(explorer['nodes'],explorer['edges']) or
        layout.get('nodes')!=len(data['nodes']) or layout.get('edges')!=len(data['edges'])):
        errors.append('Explorer layout does not cover the complete analytical topology')
    if len({(node.get('x'),node.get('y')) for node in explorer['nodes']})!=len(explorer['nodes']):
        errors.append('Explorer map has coincident node coordinates')
    if set(dossiers['nodes'])!=ids:
        errors.append('Explorer dossiers do not cover every analytical node')
    original_books_by_id={book['id']:book for book in data['books']}
    original_labels={node['id']:node['label'] for node in data['nodes']}
    for node in data['nodes']:
        if dossiers['nodes'].get(node['id'])!=export_dossier(node, original_books_by_id.get(node['id']), original_labels):
            errors.append('Explorer dossier changed or truncated original semantic fields')
    for dossier in dossiers['nodes'].values():
        displayed=[dossier['description'],*(section['text'] for section in dossier['sections'])]
        if any(token in ids for text in displayed for token in ID_TOKEN.findall(text)):
            errors.append('Explorer dossier displays a raw graph identifier instead of its real label')
        if any(re.search(r'(?m)^(book|locator|lines|id|subtype|url|note|title|author_copyright_year|signed_to_press_year|source_year|reference_role|composition_start|composition_end):',text) for text in displayed):
            errors.append('Explorer dossier displays an untranslated structural field')
    if dossiers['edges']!=[without_references(edge) for edge in data['edges']]:
        errors.append('Explorer dossiers changed relationship labels or analytical boundaries')
    expected_search=search_references(data)
    expected_keys=set(expected_search)

    def exported_key(ref):
        return reference_key({**ref,'source_context_author':ref.get('author','')})

    search_keys={exported_key(ref) for ref in search['references']}
    if search_keys!=expected_keys or len(search['references'])!=len(expected_keys):
        errors.append('Explorer search does not exactly cover Legacy quotations')
    for node in explorer['nodes']:
        for index in node['refIds']:
            if not isinstance(index,int) or index<0 or index>=len(explorer['references']):
                continue
            row=expected_search.get(exported_key(explorer['references'][index]))
            if not row or node['id'] not in row['nodeIds']:
                errors.append('Explorer assigned a quotation to an unrelated node')
    profiles={profile['id']:profile for profile in data['book_navigation']['profiles']}
    original_books={book['id']:book for book in data['books']}
    for book in explorer['books']:
        if book['id'] not in profiles:
            continue
        profile=profiles[book['id']]
        connections={node_id for group in profile['connections'].values() for node_id in group}
        if set(book['connections'])!=connections or book['counts']!=profile['counts'] or book['title']!=original_books[book['id']]['title'] or book['year']!=original_books[book['id']]['edition_year']:
            errors.append('Explorer changed a book profile')
    if explorer['stats']!={**data['stats'],'searchQuotes':len(expected_search)}:
        errors.append('Explorer statistics differ from the analytical snapshot')
    for ref in search['references']:
        key=exported_key(ref)
        if key not in expected_search:
            continue
        if set(ref['nodeIds'])!=expected_search[key]['nodeIds']:
            errors.append('Explorer search changed quotation attribution')
    for ref in [*explorer['references'],*search['references']]:
        key=exported_key(ref)
        if key not in expected_keys:
            errors.append('Explorer introduced an unsupported quotation')
            continue
        original=export_reference(expected_search[key]['ref'])
        if any(ref.get(field)!=original.get(field) for field in ('book','locator','excerpt','url','author','note')):
            errors.append('Explorer changed quotation wording or source context')
        url=urlsplit(ref['url'])
        target=(site/url.path).resolve()
        if target not in pages or url.fragment not in pages[target].ids:
            errors.append('Explorer quotation source link is missing')
        checked_links+=1
    if (site/'explorer-data.json').stat().st_size>3_500_000:
        errors.append('Explorer initial data exceeds the 3.5 MB budget')
    result={'passed':not errors,'html_pages':len(pages),'relative_links_checked':checked_links,'public_paths_clean':not private_paths,'original_books_absent':not originals,'inline_roundtrip':not any('inline' in e.lower() for e in errors),'graphml_counts':graph_counts,'book_profiles':len(data['book_navigation']['profiles']),'explorer_nodes':len(explorer['nodes']),'explorer_edges':len(explorer['edges']),'dossiers':len(dossiers['nodes']),'layout_algorithm':layout.get('algorithm'),'search_quotes':len(search['references']),'errors':errors}
    (project/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))
    if errors:
        raise SystemExit(1)


if __name__=='__main__':
    check(Path(__file__).resolve().parents[1])
