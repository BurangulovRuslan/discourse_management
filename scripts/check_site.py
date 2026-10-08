"""Verify relative links, anchors, private paths, graph consistency and packing."""
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET
from inline_data import unpack_inline


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
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])


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
    for path in project.rglob('*'):
        if not path.is_file() or '.git' in path.parts:
            continue
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
    raw=(site/'index.html').read_text(encoding='utf-8')
    if data.get('publication_mode')=='public' and 'data-tab="sources"' in raw:
        errors.append('Corpus/method navigation must be absent from the public build')
    embedded=json.loads(re.search(r'<script id="atlas-data" type="application/json">(.*?)</script>',raw,re.S)[1])
    if unpack_inline(embedded)!=data:
        errors.append('Inline data differs from JSON export')
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
    result={'passed':not errors,'html_pages':len(pages),'relative_links_checked':checked_links,'public_paths_clean':not private_paths,'original_books_absent':not originals,'inline_roundtrip':not any('Inline' in e for e in errors),'graphml_counts':graph_counts,'book_profiles':len(data['book_navigation']['profiles']),'errors':errors}
    (project/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))
    if errors:
        raise SystemExit(1)


if __name__=='__main__':
    check(Path(__file__).resolve().parents[1])
