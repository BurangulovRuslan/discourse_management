"""Export a compact, verifiable Angular view of the analytical snapshot.

The lightweight graph contains representative quotations. The lazily loaded
search export retains every quotation indexed by the original atlas search.
Neither export creates citations or changes their wording.
"""
from collections import defaultdict
import json
from pathlib import Path
import re


def source_slug(locator):
    return re.sub(r'[^a-zA-Z0-9_-]', '_', locator)


def reference_key(ref):
    # Keep distinct source voices, matching the Legacy corpus-search index.
    return (ref['book'], ref['locator'], ref.get('excerpt', ''),
            ref.get('source_context_author', ''))


def node_references(node):
    refs = [*node.get('references', []), *node.get('cited_at', [])]
    for group in ('role_contexts', 'variants'):
        refs.extend(ref for row in node.get(group, [])
                    for ref in row.get('references', []))
    return [ref for ref in refs if isinstance(ref, dict)]


def search_references(data):
    """Use the same admitted witnesses and attribution as Legacy search."""
    books = {book['id'] for book in data['books']}
    rows = {}

    def add(ref, node_ids):
        if not ref.get('excerpt') or ref.get('book') not in books:
            return
        key = reference_key(ref)
        row = rows.setdefault(key, {'ref': ref, 'nodeIds': set()})
        row['nodeIds'].update(node_ids)

    for node in data['nodes']:
        for ref in node_references(node):
            add(ref, [node['id']])
    for edge in data['edges']:
        for ref in edge.get('references', []):
            add(ref, [edge['source'], edge['target']])
    return rows


def export_reference(ref):
    result = {'book': ref['book'], 'locator': ref['locator'],
              'excerpt': ref.get('excerpt', ''),
              'url': f"sources/{ref['book']}.html#{source_slug(ref['locator'])}"}
    if ref.get('source_context_author'):
        result['author'] = ref['source_context_author']
    if ref.get('source_context_note'):
        result['note'] = ref['source_context_note']
    return result


def encoded(data):
    return json.dumps(data, ensure_ascii=False, separators=(',', ':'))


def build_explorer_data(project, data=None):
    site = project / 'site'
    if data is None:
        data = json.loads((site / 'atlas-data.json').read_text(encoding='utf-8'))
    rows = search_references(data)
    profiles = {profile['id']: profile for profile in data['book_navigation']['profiles']}
    node_books = defaultdict(set)
    books = []
    for book in data['books']:
        profile = profiles[book['id']]
        connections = sorted({node_id for group in profile['connections'].values()
                              for node_id in group})
        for node_id in connections:
            node_books[node_id].add(book['id'])
        node_books[book['id']].add(book['id'])
        books.append({'id': book['id'], 'title': book['title'],
                      'year': book.get('edition_year'), 'dateNote': book['date_note'],
                      'counts': profile['counts'], 'connections': connections})
    for row in rows.values():
        for node_id in row['nodeIds']:
            node_books[node_id].add(row['ref']['book'])

    selected = {}

    def select(key):
        if key in rows:
            selected.setdefault(key, export_reference(rows[key]['ref']))

    # Every book and thematic line gets an initial evidence sample; the rest of
    # the budget favors quotations shared by several cards rather than repeats.
    by_book = defaultdict(list)
    for key in rows:
        by_book[key[0]].append(key)
    for keys in by_book.values():
        for key in keys[:3]:
            select(key)
    for node in data['nodes']:
        if node['type'] == 'theme':
            for ref in node_references(node)[:4]:
                select(reference_key(ref))
    budget = 470_000
    used = sum(len(encoded(ref).encode('utf-8')) for ref in selected.values())
    popular = sorted(rows, key=lambda key: (-len(rows[key]['nodeIds']), key))
    for key in popular:
        if key in selected:
            continue
        value = export_reference(rows[key]['ref'])
        size = len(encoded(value).encode('utf-8'))
        if used + size > budget:
            continue
        selected[key] = value
        used += size
    reference_ids = {key: index for index, key in enumerate(selected)}
    node_ref_ids = defaultdict(list)
    for key, index in reference_ids.items():
        for node_id in rows[key]['nodeIds']:
            node_ref_ids[node_id].append(index)
    nodes = []
    for node in data['nodes']:
        description = str(node.get('description') or node.get('definition') or
                          node.get('design') or '')
        if len(description) > 180:
            description = description[:177].rstrip() + '…'
        nodes.append({'id': node['id'], 'type': node['type'], 'label': node['label'],
                      'description': description, 'books': sorted(node_books[node['id']]),
                      'refIds': sorted(node_ref_ids[node['id']])[:3]})
    # Full relationship labels remain in the unchanged analytical JSON and
    # Legacy. Keeping graph endpoints and evidence mode avoids repeating long
    # strings on every edge in the first download.
    edges = [{key: edge[key] for key in ('source', 'target', 'analytical')}
             for edge in data['edges']]
    stats = {**data['stats'], 'searchQuotes': len(rows)}
    payload = {'version': data['version'], 'stats': stats, 'books': books,
               'nodes': nodes, 'edges': edges, 'references': list(selected.values())}
    search = {'version': data['version'], 'references': [
        {**export_reference(row['ref']), 'nodeIds': sorted(row['nodeIds'])}
        for row in rows.values()]}
    (site / 'explorer-data.json').write_text(encoded(payload), encoding='utf-8')
    (site / 'explorer-search.json').write_text(encoded(search), encoding='utf-8')
    return {'books': len(books), 'nodes': len(nodes), 'edges': len(edges),
            'representative_quotes': len(selected), 'search_quotes': len(rows),
            'graph_bytes': (site / 'explorer-data.json').stat().st_size,
            'search_bytes': (site / 'explorer-search.json').stat().st_size}


if __name__ == '__main__':
    print(encoded(build_explorer_data(Path(__file__).resolve().parents[1])))
