"""Losslessly intern repeated source-reference dictionaries for standalone HTML.

The downloadable JSON remains ordinary JSON. Only the inline transport has a
reference table; the browser restores the original data before rendering.
"""
import json


def pack_inline(data):
    pool, index = [], {}

    def visit(value):
        if isinstance(value, dict):
            if 'book' in value and 'locator' in value:
                key = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
                if key not in index:
                    index[key] = len(pool)
                    pool.append(value)
                return {'$atlas_ref': index[key]}
            return {k: visit(v) for k, v in value.items()}
        if isinstance(value, list):
            return [visit(v) for v in value]
        return value

    payload = visit(data)
    payload['_atlas_reference_pool'] = pool
    return json.dumps(payload, ensure_ascii=False, separators=(',', ':')).replace('</', r'<\/')


def unpack_inline(payload):
    pool = payload['_atlas_reference_pool']

    def visit(value):
        if isinstance(value, dict):
            if set(value) == {'$atlas_ref'}:
                return pool[value['$atlas_ref']]
            return {k: visit(v) for k, v in value.items() if k != '_atlas_reference_pool'}
        if isinstance(value, list):
            return [visit(v) for v in value]
        return value

    return visit(payload)
