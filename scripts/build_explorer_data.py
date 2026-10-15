"""Export a compact, verifiable Angular view of the analytical snapshot.

The lightweight graph contains representative quotations. The lazily loaded
search export retains every quotation indexed by the original atlas search.
Neither export creates citations or changes their wording.
"""
from collections import defaultdict
import hashlib
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


def topology_signature(nodes, edges):
    """Identical cross-language identity for the precomputed map coordinates."""
    rows = [node['id'] for node in nodes]
    rows.extend(f"{edge['source']}|{edge['target']}|{int(edge['analytical'])}" for edge in edges)
    return hashlib.sha256('\n'.join(rows).encode('utf-8')).hexdigest()


SECTION_LABELS = {
    'definition': 'Определение', 'design': 'Устройство исследования',
    'author_use': 'Как используется в тексте', 'caution': 'Границы вывода',
    'boundary': 'Границы интерпретации', 'interpretation_boundary': 'Границы интерпретации',
    'meaning': 'Содержание этапа', 'development': 'Развитие темы',
    'include': 'Что включено в понятие', 'exclude': 'Что исключено',
    'roles': 'Роль в корпусе', 'role': 'Роль в тексте',
    'role_contexts': 'Контексты использования', 'variants': 'Варианты и эпизоды',
    'scope_review_note': 'Примечание к разметке', 'evidence_status': 'Статус свидетельства',
    'connection_status': 'Статус связи', 'identity_verification': 'Проверка атрибуции',
    'attribution_status': 'Статус атрибуции', 'raw_citation': 'Библиографическая запись',
    'raw_variants': 'Варианты библиографической записи', 'doi': 'DOI',
    'ocr_policy': 'Примечание к распознаванию', 'merge_note': 'Примечание к объединению',
    'source_title_note': 'Название в источнике', 'source_context_authors': 'Авторство фрагментов',
    'speaker': 'Голос и авторство', 'source_role': 'Роль источника',
    'constructs': 'Связанные конструкты', 'concepts': 'Понятия', 'thinkers': 'Авторы',
    'authors': 'Авторы', 'author': 'Автор', 'aliases': 'Другие имена',
    'source_name_variants': 'Варианты имени в источнике', 'work': 'Работа', 'works': 'Работы',
    'subtypes': 'Подтипы', 'source_line_parts': 'Строки источника',
    'temporal_relation_to_previous': 'Связь с предыдущим этапом',
    'time_basis': 'Основание датировки', 'year': 'Год издания',
    'edition_year_range': 'Период изданий', 'explanation': 'Пояснение',
    'kind': 'Тип свидетельства', 'label': 'Название', 'date_note': 'Датировка издания',
    'edition_year': 'Год издания', 'embedded_texts': 'Тексты внутри издания',
    'external_checks': 'Внешние проверки', 'source_formats': 'Форматы источников',
    'source_region': 'Область источника', 'ocr_entry_marker': 'Метка в распознанном тексте',
    'experiment_label': 'Исследуемый эпизод', 'kind': 'Тип свидетельства',
    'merge_mode': 'Правило объединения', 'status': 'Состояние разметки',
    'contained_in': 'Входит в издание', 'step_number': 'Номер этапа',
    'book': 'Книга', 'locator': 'Адрес в источнике', 'lines': 'Текст записи',
    'title': 'Название', 'url': 'Ссылка', 'note': 'Примечание',
    'source_year': 'Год исходного текста', 'range': 'Страницы',
    'author_copyright_year': 'Год авторского права',
    'signed_to_press_year': 'Год подписания в печать',
    'from': 'От', 'to': 'До', 'composition_start': 'Начало создания',
    'composition_end': 'Окончание создания', 'reference_role': 'Роль отсылки',
}
SECTION_ORDER = [
    'definition', 'meaning', 'design', 'author_use', 'development', 'interpretation_boundary',
    'boundary', 'caution', 'include', 'exclude', 'roles', 'role_contexts', 'variants',
    'raw_citation', 'raw_variants', 'source_line_parts', 'doi', 'authors', 'author',
    'source_context_authors', 'speaker', 'source_role', 'evidence_status', 'scope_review_note',
    'attribution_status', 'identity_verification', 'connection_status', 'source_title_note',
    'aliases', 'source_name_variants', 'constructs', 'concepts', 'thinkers', 'work', 'works',
    'subtypes', 'merge_note', 'ocr_policy', 'time_basis', 'temporal_relation_to_previous',
    'year', 'edition_year_range', 'embedded_texts',
    'external_checks', 'source_formats', 'source_region', 'ocr_entry_marker',
    'experiment_label', 'kind', 'merge_mode', 'status', 'contained_in', 'step_number',
]
REFERENCE_FIELDS = {'references', 'cited_at', 'development_references'}
INTERNAL_FIELDS = {'source_key', 'local_id', 'key', 'analysis_file', 'id', 'note_id', 'subtype'}
# The seven research kinds use the same terms as the Legacy interface.
ENUM_LABELS = {
    'empirical': 'Эмпирический опыт', 'observational': 'Наблюдательное исследование',
    'review': 'Обзор / исследовательская программа', 'thought': 'Мысленный эксперимент',
    'exercise': 'Упражнение', 'case': 'Клинический / иллюстративный случай',
    'demonstration': 'Демонстрация / иллюзия',
    'source': 'Источник', 'author_claim': 'Авторский тезис', 'analogy': 'Аналогия',
    'mechanism': 'Объяснение механизма', 'application': 'Применение',
    'book': 'Книга', 'literary_work': 'Литературное произведение',
    'article': 'Статья', 'book_or_essay': 'Книга или эссе',
    'literary_tale': 'Литературная сказка', 'theory': 'Теоретическая работа',
    'author_self_reference': 'Отсылка автора к собственной работе',
    'essay': 'Эссе', 'philosophical_work': 'Философская работа',
    'computer_program': 'Компьютерная программа', 'scientific_book': 'Научная книга',
    'novel': 'Роман', 'literary_collection': 'Литературный сборник',
    'collection': 'Сборник', 'philosophical_book': 'Философская книга',
    'psychotherapy_book': 'Книга о психотерапии', 'fable_allusion': 'Отсылка к басне',
    'fable': 'Басня', 'literary_allusion': 'Литературная отсылка',
    'economic_treatise': 'Экономический трактат',
    'historical_financial_case': 'Исторический финансовый случай',
    'popular_science_book': 'Научно-популярная книга', 'dialogue': 'Диалог',
    'play': 'Пьеса', 'foreword': 'Предисловие', 'postface': 'Послесловие',
    'philosophical_fragment': 'Философский фрагмент',
    'psychoanalytic_work': 'Психоаналитическая работа',
    'research_program': 'Исследовательская программа',
    'filename_edition_unverified': 'Год из имени файла; издание не проверено',
    'printed_edition': 'Дата печатного издания',
    'publisher_copyright': 'Дата авторского права издательства',
    'fb2_title_metadata': 'Дата из метаданных заглавия FB2',
    'fb2_publish_metadata': 'Дата из издательских метаданных FB2',
    'conflicting_print_dates': 'Противоречащие друг другу даты в издании',
    'composition_range': 'Период создания текста',
    'guest_postface': 'Приглашённый автор послесловия',
    'identified_narrative': 'Идентифицированный сюжет', 'same_narrative': 'Повтор одного сюжета',
    'paradigm_family': 'Семейство исследовательских парадигм', 'research_family': 'Семейство исследований',
    'author_context; thematic clustering is analyst_inference': 'Авторский контекст; тематическая группировка выполнена аналитиком',
    'author_explicit': 'Явная формулировка автора',
    'author_argument_reconstructed': 'Реконструкция авторского аргумента',
    'analyst_reconstruction_of_explicit_argument': 'Аналитическая реконструкция явно выраженного аргумента',
    'analyst_comparison': 'Аналитическое сопоставление',
    'analyst_comparison_with_explicit_definitions': 'Аналитическое сопоставление явных определений',
    'guest_interpretation': 'Интерпретация приглашённого автора',
    'analyst_reconstruction_of_explicit_parallel_arguments': 'Аналитическая реконструкция параллельных авторских аргументов',
    'habitus_quote_conflicting_with_printed_reference': 'Цитата о габитусе расходится с печатной отсылкой',
    'conflicting_main_text_and_bibliography': 'Основной текст расходится с библиографией',
    'analytical_code_for_author_explicit_construct': 'Аналитический код явно названного автором конструкта',
    'bibliography': 'Библиография', 'footnote': 'Сноска',
    'named_reference; polemic': 'Именная отсылка; полемика',
    'same_edition_year_order_not_established': 'Один год издания; последовательность не установлена',
}
ENUM_FIELDS = {'kind', 'source_role', 'merge_mode', 'connection_status', 'status',
               'source_region', 'attribution_status', 'temporal_relation_to_previous',
               'reference_role'}
ID_TOKEN = re.compile(r'\b[A-Za-z][A-Za-z0-9]+\b')


def named_references(text, labels):
    return ID_TOKEN.sub(lambda match: labels.get(match[0], match[0]), text) if labels else text


def without_references(value):
    """Keep the original semantic snapshot without duplicating all quotations."""
    if isinstance(value, dict):
        return {key: without_references(row) for key, row in value.items()
                if key not in REFERENCE_FIELDS}
    if isinstance(value, list):
        return [without_references(row) for row in value]
    return value


def semantic_text(value, labels=None, field=None):
    """Readable paragraphs from real fields; no invented summaries or captions."""
    if value is None or value == '' or value == [] or value == {}:
        return ''
    if isinstance(value, bool):
        return 'Да' if value else 'Нет'
    if isinstance(value, str):
        if field in ENUM_FIELDS:
            value = ENUM_LABELS.get(value, value)
            # Future untranslated classifications remain in exact metadata.
            if re.fullmatch(r'[a-z][a-z_ ;]+', value):
                return ''
        return named_references(value, labels)
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return '\n\n'.join(part for row in value if (part := semantic_text(row, labels, field)))
    lines = []
    for key, row in value.items():
        if key in INTERNAL_FIELDS:
            continue
        caption = SECTION_LABELS.get(key) or (labels or {}).get(key)
        if caption and (part := semantic_text(row, labels, key)):
            lines.append(f'{caption}: {part}')
    return '\n'.join(lines)


def export_dossier(node, book=None, labels=None):
    metadata = without_references({key: value for key, value in node.items()
                                   if key not in ('id', 'type', 'label')})
    description = named_references(str(node.get('description') or node.get('definition') or node.get('design') or ''), labels)
    sections = []
    displayed = {description}
    for key in SECTION_ORDER:
        # Detailed classifier codes are available in metadata and Legacy.
        if key == 'subtypes':
            continue
        text = semantic_text(metadata.get(key), labels, key)
        if text and text not in displayed:
            displayed.add(text)
            sections.append({'label': SECTION_LABELS[key], 'text': text})
    # A single role is often identical to the description or one of the roles.
    role = semantic_text(metadata.get('role'), labels, 'role')
    if role and role not in displayed and role not in (metadata.get('roles') or []):
        sections.append({'label': SECTION_LABELS['role'], 'text': role})
    if book:
        sections.insert(0, {'label': 'Датировка издания', 'text': book['date_note']})
    return {'description': description, 'sections': sections, 'metadata': metadata}


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
    degree = defaultdict(int)
    for edge in data['edges']:
        degree[edge['source']] += 1
        degree[edge['target']] += 1
    for node in data['nodes']:
        description = str(node.get('description') or node.get('definition') or
                          node.get('design') or '')
        if len(description) > 180:
            description = description[:177].rstrip() + '…'
        nodes.append({'id': node['id'], 'type': node['type'], 'label': node['label'],
                      'description': description, 'books': sorted(node_books[node['id']]),
                      'refIds': sorted(node_ref_ids[node['id']])[:3],
                      'degree': degree[node['id']]})
    # Full relationship labels remain in the unchanged analytical JSON and
    # Legacy. Keeping graph endpoints and evidence mode avoids repeating long
    # strings on every edge in the first download.
    edges = [{key: edge[key] for key in ('source', 'target', 'analytical')}
             for edge in data['edges']]
    stats = {**data['stats'], 'searchQuotes': len(rows)}
    payload = {'version': data['version'], 'stats': stats, 'books': books,
               'nodes': nodes, 'edges': edges, 'references': list(selected.values())}
    previous_path = site / 'explorer-data.json'
    if previous_path.exists():
        previous = json.loads(previous_path.read_text(encoding='utf-8'))
        if previous.get('layout', {}).get('topology') == topology_signature(nodes, edges):
            positions = {node['id']: node for node in previous['nodes']}
            for node in nodes:
                node.update({axis: positions[node['id']][axis] for axis in ('x', 'y')})
            payload['layout'] = previous['layout']
    search = {'version': data['version'], 'references': [
        {**export_reference(row['ref']), 'nodeIds': sorted(row['nodeIds'])}
        for row in rows.values()]}
    (site / 'explorer-data.json').write_text(encoded(payload), encoding='utf-8')
    (site / 'explorer-search.json').write_text(encoded(search), encoding='utf-8')
    original_books = {book['id']: book for book in data['books']}
    labels = {node['id']: node['label'] for node in data['nodes']}
    dossiers = {'version': data['version'], 'nodes': {
        node['id']: export_dossier(node, original_books.get(node['id']), labels) for node in data['nodes']},
        'edges': [without_references(edge) for edge in data['edges']]}
    (site / 'explorer-dossiers.json').write_text(encoded(dossiers), encoding='utf-8')
    return {'books': len(books), 'nodes': len(nodes), 'edges': len(edges),
            'representative_quotes': len(selected), 'search_quotes': len(rows),
            'graph_bytes': (site / 'explorer-data.json').stat().st_size,
            'dossier_bytes': (site / 'explorer-dossiers.json').stat().st_size,
            'search_bytes': (site / 'explorer-search.json').stat().st_size}


if __name__ == '__main__':
    print(encoded(build_explorer_data(Path(__file__).resolve().parents[1])))
