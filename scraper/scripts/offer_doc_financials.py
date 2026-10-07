"""The offer-document financial reader (OD-173 rebuild): one code path for every DRHP / RHP / prospectus.

  1. section_locator: the section map from the printed contents page (restated financial information, Offer Document
     Summary, Basis for Offer Price, Other Financial Information, Capitalisation Statement).
  2. statement_grid: the restated statements and the other sections' tables -> grids from word positions.
  3. financial_labels: ONE label dictionary with refusals (OD-172 plain EBITDA, D8-D11, D13).
  4. financial_copies: every printed copy of a field collected; agreement + identities decide; else refused (F-248).

read_financials(page_texts, grid_words_for_page, unreadable_pages) -> {
    'fields': {name: {'values': {'FY2025': v, ...}, 'source': {...}, 'copies': {...}} | {'missed': reason}},
    'single': {name: {'value', 'fy', 'source'} | {'missed'}},
    'fiscal_years': [2026, 2025, ...]  (descending; the full fiscal years the statement fields were read for),
    'locator': {...}, 'notes': [...]}
Money values are in crore; the caller converts them to the document's unit.
"""
import re

import financial_copies
import section_locator
import statement_grid

STATEMENT_FIELDS = ('revenue', 'total_income', 'profit', 'eps_basic', 'eps_diluted', 'total_assets',
                    'reserves_and_surplus', 'op_cash_flow')
TO_CRORE = financial_copies.L.TO_CRORE


def dense_pages(page_texts):
    by = {int(i): t or '' for i, t in page_texts}
    return [(i, by.get(i, '')) for i in range(max(by) + 1)] if by else []


def read_financials(page_texts, grid_words_for_page, unreadable_pages=()):
    pages = dense_pages(page_texts)
    unreadable = set(unreadable_pages or ())
    loc = section_locator.locate(pages)
    start = section_locator.restated_start(loc)
    stmt = {'statements': {}}
    if start is not None:
        stmt = statement_grid.read_statement_grids(pages, start, grid_words_for_page, unreadable)
    sec = statement_grid.read_section_grids(pages, loc['other'], grid_words_for_page, unreadable)
    out = financial_copies.read(stmt, sec, dict(pages))
    years = {int(k[2:]) for f in STATEMENT_FIELDS for k in (out['fields'].get(f, {}).get('values') or {})
             if k.startswith('FY')}
    out['fiscal_years'] = sorted(years, reverse=True)
    if start is None:
        why = ('section_locator: no contents page found in the first %d pages' % section_locator.TOC_SCAN_PAGES
               if not loc['toc_pages'] else
               'section_locator: the contents page lists no restated financial information section whose page '
               'opens with its title (offset %s)' % loc['offset'])
        for f in STATEMENT_FIELDS:
            rec = out['fields'].get(f)
            if rec is not None and not rec.get('values'):
                rec['missed'] = why
    out['locator'] = {'offset': loc['offset'], 'offset_votes': loc['offset_votes'], 'restated_start': start,
                      'sections': {k: (v['idx'], v['end'], v['verified']) for k, v in loc['other'].items()}}
    out['section_problems'] = sec.get('problems', [])
    return out


def fy_series(rec, value_kind, doc_unit):
    """{'2025': value in the document unit} from an interpreted field (fiscal-year periods only, D11)."""
    vals = rec.get('values') or {}
    out = {}
    for k, v in vals.items():
        if not k.startswith('FY'):
            continue
        out[k[2:]] = to_doc_unit(v, value_kind, doc_unit)
    return out


def to_doc_unit(v, value_kind, doc_unit):
    if value_kind != 'money':
        return v
    return round(v / TO_CRORE[unit_key(doc_unit)], 6)


def unit_key(doc_unit):
    """'millions' / 'lakhs' / 'crores' (extract_filing._find_unit) -> financial_labels.TO_CRORE key."""
    u = (doc_unit or '').lower()
    return 'lakh' if u.startswith(('lakh', 'lac')) else 'crore' if u.startswith('cror') else 'million'


PAGE_IN_SOURCE = re.compile(r'\bp(\d+)\b')


def source_page(rec, period=None):
    """PDF page index of the copy a value was taken from (the latest fiscal year's by default)."""
    src = rec.get('source') or {}
    if period is None:
        fys = sorted(k for k in src if k.startswith('FY'))
        period = fys[-1] if fys else None
    m = PAGE_IN_SOURCE.search(str(src.get(period) or ''))
    return int(m.group(1)) if m else None
