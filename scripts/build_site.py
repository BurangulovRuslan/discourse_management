"""Build the standalone Pages site from its sanitized analytical snapshot."""
from collections import defaultdict
import hashlib
import html
import json
from pathlib import Path
import re

from inline_data import pack_inline, unpack_inline


def source_slug(locator):
    return re.sub(r'[^a-zA-Z0-9_-]', '_', locator)


def collect_references(data):
    refs = {}

    def visit(value):
        if isinstance(value, dict):
            if 'book' in value and 'locator' in value:
                key = json.dumps(value, ensure_ascii=False, sort_keys=True)
                refs[key] = value
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    visit(data)
    return list(refs.values())


def render_sources(data, site):
    per_book = defaultdict(lambda: defaultdict(list))
    for ref in collect_references(data):
        per_book[ref['book']][ref['locator']].append(ref)
    # The reading report also contains hand-selected addresses outside node refs.
    # Preserve their anchors without publishing the full source page.
    report=(site/'analytical-report.html').read_text(encoding='utf-8')
    for bid,anchor in re.findall(r'href="sources/(B\d+)\.html#([^"]+)"',report):
        existing={source_slug(loc) for loc in per_book[bid]}
        if anchor not in existing:
            locator='PDF p.'+anchor[6:] if anchor.startswith('PDF_p_') else anchor
            per_book[bid][locator].append({'book':bid,'locator':locator})
    source_dir = site / 'sources'
    source_dir.mkdir(exist_ok=True)
    for book in data['books']:
        title, bid = html.escape(book['title']), book['id']
        parts = [f'''<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title} · цитатные опоры</title><style>body{{max-width:940px;margin:36px auto;padding:0 24px;font:17px/1.65 system-ui;color:#172e30;background:#f6f5f0}}h1{{line-height:1.25}}a{{color:#176b64}}section{{border-top:1px solid #cbd3ce;padding:18px 0;scroll-margin-top:24px}}section:target{{background:#e6eee7}}blockquote{{margin:12px 0;padding-left:16px;border-left:2px solid #cbd3ce}}small{{color:#57696b}}p,blockquote{{overflow-wrap:anywhere}}@media(max-width:520px){{body{{padding:0 18px}}}}@media print{{body{{background:white}}}}</style></head><body><a href="../index.html#book={bid}">← Книга на графе</a><h1>{title}</h1><p>{html.escape(book.get('date_note',''))}</p><p>Краткие цитатные опоры аналитического атласа. Адрес относится к странице или абзацу локального издания. Здесь показаны только фрагменты, использованные в разметке.</p>''']
        def loc_order(item):
            value = item[0]
            match = re.search(r'(\d+)$', value)
            return (value[:match.start()] if match else value, int(match[1]) if match else 0)
        for locator, rows in sorted(per_book[bid].items(), key=loc_order):
            parts.append(f'<section id="{source_slug(locator)}"><h2>{html.escape(bid+" · "+locator)}</h2>')
            displayed = set()
            for ref in rows:
                excerpt = ref.get('excerpt', '')
                voice = ref.get('source_context_author', '')
                note = ref.get('source_context_note', '')
                key = (excerpt, voice, note)
                if key in displayed:
                    continue
                displayed.add(key)
                if voice:
                    parts.append('<p><small>Автор фрагмента: '+html.escape(voice)+'</small></p>')
                if note:
                    parts.append('<p><small>'+html.escape(note)+'</small></p>')
                if excerpt:
                    parts.append('<blockquote>'+html.escape(excerpt)+'</blockquote>')
                else:
                    parts.append('<p><small>Адрес внесён в разметку без отдельной цитаты.</small></p>')
            parts.append('</section>')
        parts.append('</body></html>')
        (source_dir / f'{bid}.html').write_text('\n'.join(parts), encoding='utf-8')


def build(project):
    site, src = project / 'site', project / 'src'
    data = json.loads((site / 'atlas-data.json').read_text(encoding='utf-8'))
    template = (src / 'atlas.template.html').read_text(encoding='utf-8')
    if data.get('publication_mode') == 'public':
        template, removed = re.subn(r'<button\b[^>]*\bdata-tab="sources"[^>]*>.*?</button>\s*', '', template, count=1, flags=re.S)
        if removed != 1:
            raise ValueError('Public build must remove the corpus/method navigation entry')
    for placeholder, filename in [('__ATLAS_EXPANSION_JS__','atlas-expansion.js'),('__ATLAS_BOOK_GRAPH_JS__','atlas-book-graph.js'),('__ATLAS_BOOKS_JS__','atlas-books.js'),('__ATLAS_BOOKS_CSS__','atlas-books.css'),('__ATLAS_RUNTIME_V5_JS__','atlas-runtime-v5.js'),('__ATLAS_SEARCH_V5_JS__','atlas-search-v5.js'),('__ATLAS_UI_V5_CSS__','atlas-ui-v5.css')]:
        template = template.replace(placeholder, (src / filename).read_text(encoding='utf-8'))
    payload = pack_inline(data)
    if unpack_inline(json.loads(payload)) != data:
        raise ValueError('Inline transport changed analytical data')
    (site / 'index.html').write_text(template.replace('__ATLAS_DATA__', payload), encoding='utf-8')
    (site / 'atlas.html').write_text('''<!doctype html><html lang="ru"><meta charset="utf-8"><title>Атлас</title><script>location.replace('index.html'+location.search+location.hash)</script><a href="index.html">Открыть атлас</a></html>''', encoding='utf-8')
    (site / '.nojekyll').write_text('', encoding='utf-8')
    render_sources(data, site)
    files = [{'path': str(p.relative_to(site)).replace('\\','/'), 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(site.rglob('*')) if p.is_file() and p.name != 'build-manifest.json']
    manifest = {'version':data['version'], 'entry':'index.html', 'publication_mode':data['publication_mode'], 'stats':data['stats'], 'file_count':len(files), 'bytes':sum(f['bytes'] for f in files), 'files':files}
    (site / 'build-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'entry':'site/index.html','files':len(files),'site_bytes':manifest['bytes'],'inline_bytes':len(payload.encode('utf-8'))},ensure_ascii=False))


if __name__ == '__main__':
    build(Path(__file__).resolve().parents[1])
