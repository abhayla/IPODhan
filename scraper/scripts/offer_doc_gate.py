"""Offer-document answer-key gate (OD-173): the real reader, cache mode, scored against the committed answer keys.

usage: python scraper/scripts/offer_doc_gate.py [--update-baseline] [--code-dir DIR] [--cache DIR]

Runs extract_filing.run over every cached document that has an answer key (page texts + word boxes + grid words are
served from the cache, no PDF is opened), scores each keyed value as right / wrong / missed, and FAILS when
  - a value in a GATE family is wrong (wrong must be 0, never stored as a baseline), or
  - the number of right ("found") values of any section / key set / family is below the committed baseline, or
  - a family reported as "known" (KEEP-TODAY or PARKED, F-249) has a wrong cell the baseline does not list.
Exit codes: 0 pass, 1 gate failed, 2 NOT RUN (reason printed as "NOT RUN: <reason>"; never a silent pass).

Cache: env OFFER_DOC_CACHE or D:/Abhay/Ventures/IPODhan-doc-cache/reader-cache (one <slug>-<TYPE>.cache.json per
document: page_texts, tables, words, grid_words, ocr_confidence, ocr_render, slug, type, segment, source_doc).
A page the reader asks for that the cache does not hold is a cache miss: NOT RUN (rebuild the cache), because the
reader would then be scored on input it never had.
"""
import argparse
import json
import os
import re
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.normpath(os.path.join(HERE, '..', 'tests', 'fixtures', 'offer-doc-truth'))
BASELINE = os.path.join(FIXTURES, 'baseline.json')
DEFAULT_CACHE = 'D:/Abhay/Ventures/IPODhan-doc-cache/reader-cache'

EXIT_PASS, EXIT_FAIL, EXIT_NOT_RUN = 0, 1, 2


class NotRun(Exception):
    pass


# --------------------------------------------------------------------------- sections, key sets, families
# section -> (key-set folders, document types scored). Folder names are the committed fixture folders.
SECTIONS = {
    'financial': (['keys', 'nse', 'keys-holdout', 'keys-holdout2'], None),
    'promoters': (['keys-cap'], {'drhp'}),
    'general-information': (['keys', 'nse', 'keys-gi-holdout', 'keys-gi-holdout2', 'keys-gi-holdout3',
                             'keys-gi-holdout4'], {'drhp'}),
}

# Families the plan marks KEEP-TODAY or PARKED (OD-173, section 3 decision), or whose new reader is not built yet
# (PENDING-BUILD): scored and reported under "known, F-249", their wrong values are not gate failures, a NEW wrong
# cell is, and their found counts may not drop.
KNOWN_FAMILIES = {
    'general-information': {
        'registrar.name': 'KEEP-TODAY', 'registrar.sebi_reg_no': 'KEEP-TODAY',
        'registrar.contact_person': 'KEEP-TODAY', 'registrar.link': 'KEEP-TODAY',
        'co.compliance_officer': 'KEEP-TODAY', 'co.compliance_officer_phone': 'KEEP-TODAY',
        'co.compliance_officer_email': 'KEEP-TODAY', 'company.company_phone': 'KEEP-TODAY',
        'company.company_email': 'KEEP-TODAY', 'company.company_website': 'KEEP-TODAY',
        'company.company_address': 'PARKED', 'registrar.phone': 'PARKED', 'registrar.email': 'PARKED',
        # NEW-READER families (plan section 3 decision): the product build is not in extract_filing yet, so today's
        # reader is scored. Delete these lines when the build lands: from then on wrong must be 0 for them.
        'lead_managers': 'PENDING-BUILD', 'brlm.sebi_reg_no': 'PENDING-BUILD', 'brlm.contact_person': 'PENDING-BUILD',
        'brlm.phone': 'PENDING-BUILD', 'brlm.email': 'PENDING-BUILD', 'brlm.grievance_email': 'PENDING-BUILD',
        'registrar.grievance_email': 'PENDING-BUILD',
    },
}

KEY_FILE = re.compile(r'^(?P<slug>.+)-(?P<type>drhp|rhp|prospectus)-truth\.json$')


def load_key(path):
    with open(path, encoding='utf8') as fh:
        return {e['key']: e for e in json.load(fh)}


def cell(family, cid, verdict, key=None, got=None):
    return {'family': family, 'cell': cid, 'verdict': verdict, 'key': key, 'got': got}


# --------------------------------------------------------------------------- financial scorer
ROW_UNIT = {'MILLION': 0.1, 'MILLIONS': 0.1, 'LAKH': 0.01, 'LAKHS': 0.01, 'CRORE': 1.0, 'CRORES': 1.0}
DOC_UNIT = {'millions': 0.1, 'million': 0.1, 'lakhs': 0.01, 'lakh': 0.01, 'crores': 1.0, 'crore': 1.0}
PER_SHARE = {'eps', 'pre_ipo_eps', 'eps_basic', 'eps_diluted', 'ronw', 'dscr'}
FIN_FAMILY = {'revenue': 'revenue', 'total_income': 'total_income', 'profit': 'profit (PAT)', 'pat': 'profit (PAT)',
              'ebitda': 'ebitda', 'net_worth': 'net_worth', 'eps': 'eps', 'pre_ipo_eps': 'eps', 'eps_basic': 'eps',
              'eps_diluted': 'eps', 'reserves_and_surplus': 'reserves', 'total_assets': 'total_assets',
              'total_borrowing': 'total_borrowing', 'ronw': 'ronw', 'op_cash_flow': 'op_cash_flow',
              'rent_expense': 'rent_expense', 'dscr': 'dscr'}
FD_SERIES = ('revenue', 'total_income', 'profit', 'ebitda')
FD_SINGLE = ('net_worth', 'eps', 'pre_ipo_eps', 'reserves_and_surplus', 'total_assets', 'total_borrowing', 'ronw')
FS_FIELDS = ('revenue', 'total_income', 'ebitda', 'pat', 'net_worth', 'eps_basic', 'eps_diluted', 'op_cash_flow',
             'rent_expense', 'dscr')
BY_FY = {'revenue': 'revenue_by_fy', 'total_income': 'total_income_by_fy', 'profit': 'pat_by_fy', 'pat': 'pat_by_fy',
         'ebitda': 'ebitda_by_fy', 'net_worth': 'net_worth_by_fy', 'eps_basic': 'eps_basic_by_fy',
         'eps_diluted': 'eps_diluted_by_fy', 'op_cash_flow': 'op_cash_flow_by_fy', 'rent_expense': 'rent_by_fy',
         'reserves_and_surplus': 'reserves_by_fy', 'total_assets': 'total_assets_by_fy', 'ronw': 'ronw_by_fy',
         'eps': 'eps_basic_by_fy', 'pre_ipo_eps': 'eps_basic_by_fy'}


def financial_expected(key):
    """{(table, field, period): value in crore (per-share and ratios raw), or None when the key says not printed}.
    Part-year (stub) periods are not scored: they are dropped by design (D11)."""
    out = {}
    for k, e in key.items():
        m = re.match(r'financial_data\.(%s)_fy(\d{4})$' % '|'.join(FD_SERIES), k)
        if m:
            out[('fd', m.group(1), 'FY' + m.group(2))] = e['value'] if e['printed'] else None
            continue
        m = re.match(r'financial_data\.(%s)$' % '|'.join(FD_SINGLE), k)
        if m:
            out[('fd', m.group(1), 'latest')] = e['value'] if e['printed'] else None
            continue
        if k == 'financial_statements.revenue':  # the financial_statements keys all carry the same rows
            for row in e['rows'] or []:
                per = row.get('period') or 'FY%d' % row['fiscal_year']
                if not per.startswith('FY'):
                    continue
                mult = ROW_UNIT[row['unit'].upper()]
                for f in FS_FIELDS:
                    v = row.get(f)
                    out[('fs', f, per)] = None if v is None else (v if f in PER_SHARE else round(v * mult, 6))
    return out


def financial_got(fields, unit):
    """What the real reader saved, in the same units as the key: {(table, field, period): value}."""
    mult = DOC_UNIT.get(unit)
    out = {}

    def by_fy(name):
        v = (fields.get(name) or {}).get('value')
        return {int(k): x for k, x in v.items() if x is not None} if isinstance(v, dict) else {}

    def conv(f, v):
        return v if f in PER_SHARE else (round(v * mult, 6) if mult else None)
    for f in FD_SERIES:
        for y, v in by_fy(BY_FY[f]).items():
            out[('fd', f, 'FY%d' % y)] = conv(f, v)
    for f in FD_SINGLE:
        if f == 'total_borrowing':
            v = (fields.get('total_borrowing') or {}).get('value')
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                out[('fd', f, 'latest')] = conv(f, v)
            continue
        s = by_fy(BY_FY[f])
        if s:
            out[('fd', f, 'latest')] = conv(f, s[max(s)])
    for f in FS_FIELDS:
        for y, v in by_fy(BY_FY.get(f, '')).items():  # dscr has no reader output: always missed, never wrong
            out[('fs', f, 'FY%d' % y)] = conv(f, v)
    return out


def score_financial(key, out):
    unit = out.get('unit')
    unit = unit.get('value') if isinstance(unit, dict) else unit
    exp = financial_expected(key)
    got = financial_got(out['fields'], unit)
    cells = []
    for k, ev in sorted(exp.items()):
        table, field, per = k
        fam, cid, gv = FIN_FAMILY[field], '%s.%s.%s' % (table, field, per), got.get(k)
        if ev is None:
            if gv is not None:
                cells.append(cell(fam, cid, 'unkeyed', None, gv))
        elif gv is None:
            cells.append(cell(fam, cid, 'missed', ev))
        elif abs(ev - gv) <= 0.01 + 1e-9 * abs(ev):
            cells.append(cell(fam, cid, 'correct', ev, gv))
        else:
            cells.append(cell(fam, cid, 'wrong', ev, gv))
    return cells


# --------------------------------------------------------------------------- promoter scorer
PROMOTER_FAM = {'promoters.name': 'name', 'promoters.is_promoter_group': 'is_group', 'promoters.shares_held': 'shares',
                'ipo_details.promoter_shares_held': 'shares(ipo_details)',
                'financial_data.promoter_holding_pre_issue': 'holding_pct', 'promoters.waca': 'waca',
                'promoters.waca_last_year': 'waca_1y', 'promoter_acquisition_ranges': 'ranges'}


def _canon(n):
    n = re.sub(r'\b(?:md|mohd)\b\.?', 'mohammed', n.lower())
    return re.sub(r'[^a-z]', '', n)


def _num_eq(v, k):
    if v == 'NIL':
        return k in (0, 0.0, None)
    if isinstance(v, bool) or isinstance(k, bool):
        return v == k
    try:
        return abs(float(v) - float(k)) < 1e-6
    except (TypeError, ValueError):
        return False


def _promoter_cells(fam, keyrec, got):
    """yield (cell id, key value or 'NOT_PRINTED', got value or None)"""
    printed = keyrec['printed']
    if fam == 'ranges':
        rows = {r['period']: r for r in (keyrec.get('rows') or [])} if printed else {}
        got = got or {}
        for p in sorted(set(rows) | set(got)):
            for part in ('waca', 'price_low', 'price_high'):
                yield '%s.%s' % (p, part), (rows[p][part] if p in rows else 'NOT_PRINTED'), (got.get(p) or {}).get(part)
        return
    if fam == 'name':
        kn = {_canon(x) for x in (keyrec['value'] or [])} if printed else set()
        gn = {_canon(x) for x in (got or [])}
        for n in sorted(kn | gn):
            yield n, (True if n in kn else 'NOT_PRINTED'), (True if n in gn else None)
        return
    if fam == 'holding_pct':
        yield 'pct', (keyrec['value'] if printed else 'NOT_PRINTED'), got
        return
    kd = {_canon(k): v for k, v in (keyrec['value'] or {}).items()} if printed else {}
    gd = {_canon(k): v for k, v in (got or {}).items()}
    for n in sorted(set(kd) | set(gd)):
        yield n, (kd[n] if n in kd else 'NOT_PRINTED'), gd.get(n)


def promoter_got(fields):
    out = {}
    pn = fields.get('promoter_names') or {}
    if pn.get('state') == 'VALUE':
        out['promoters.name'] = pn['value']
    pr = fields.get('promoter_rows') or {}
    if pr.get('state') == 'VALUE':
        rows = pr['value']
        out['promoters.is_promoter_group'] = {x['name']: x['is_promoter_group'] for x in rows}
        for k, f in (('shares_held', 'promoters.shares_held'), ('waca', 'promoters.waca'),
                     ('waca_last_year', 'promoters.waca_last_year')):
            v = {x['name']: x[k] for x in rows if x[k] is not None}
            if v:
                out[f] = v
        if 'promoters.shares_held' in out:
            out['ipo_details.promoter_shares_held'] = out['promoters.shares_held']
    hp = fields.get('promoter_holding_pre_pct') or {}
    if hp.get('state') == 'VALUE':
        out['financial_data.promoter_holding_pre_issue'] = hp['value']
    rr = {}
    for p, sfx in (('1Y', '1y'), ('18M', '18m'), ('3Y', '3y')):
        w = fields.get('waca_last_%s' % sfx) or {}
        g = fields.get('acquisition_price_range_%s' % sfx) or {}
        row = {}
        if w.get('state') == 'VALUE':
            row['waca'] = w['value']
        if g.get('state') == 'VALUE' and isinstance(g.get('value'), dict):
            row['price_low'], row['price_high'] = g['value'].get('low'), g['value'].get('high')
        if row:
            rr[p] = row
    if rr:
        out['promoter_acquisition_ranges'] = rr
    out['_agg'] = (fields.get('promoter_shares_held') or {}).get('value')
    return out


def score_promoters(key, out):
    got = promoter_got(out['fields'])
    cells = []
    for field, fam in PROMOTER_FAM.items():
        rec = key[field if field in key else field + '.period']
        for cid, kv, gv in _promoter_cells(fam, rec, got.get(field)):
            has_key = kv not in ('NOT_PRINTED', None)
            if gv is None:
                if has_key:
                    cells.append(cell(fam, '%s.%s' % (field, cid), 'missed', kv))
            elif kv == 'NOT_PRINTED':
                cells.append(cell(fam, '%s.%s' % (field, cid), 'wrong', None, gv))
            elif _num_eq(gv, kv):
                if has_key:
                    cells.append(cell(fam, '%s.%s' % (field, cid), 'correct', kv, gv))
            else:
                cells.append(cell(fam, '%s.%s' % (field, cid), 'wrong', kv, gv))
    agg = got.get('_agg')
    kv = key['ipo_details.promoter_shares_held']
    if agg is not None and kv['printed'] and kv['value']:  # the saved total must equal the sum of the keyed holders
        ok = abs(agg - sum(kv['value'].values())) < 0.5
        cells.append(cell('shares_aggregate', 'promoter_shares_held.total', 'correct' if ok else 'wrong',
                          sum(kv['value'].values()), agg))
    return cells


# --------------------------------------------------------------------------- general-information scorer
CORP_WORDS = re.compile(r'\b(?:private|pvt|limited|ltd|llp|inc|plc|the|company|co)\b\.?', re.I)
HONORIFIC = re.compile(r'^(?:mr|mrs|ms|smt|shri|dr|prof|ca)\.?\s+', re.I)


def name_key(n):
    n = re.sub(r'\([^)]*\)?', ' ', n or '')
    n = CORP_WORDS.sub(' ', n.lower())
    return re.sub(r'[^a-z0-9]', '', n)


def phone_numbers(v):
    out = []
    for part in re.split(r'/|,|;|\bor\b|\band\b', v or ''):
        dg = re.sub(r'\D', '', part)
        if not dg:
            continue
        if dg.startswith('91') and len(dg) >= 12:
            dg = dg[2:]
        out.append(dg.lstrip('0'))
    return out


def same_value(kind, a, b):
    if kind == 'name':
        return name_key(a) == name_key(b)
    if kind == 'person':
        def n(s):
            return re.sub(r'\s*/\s*', '/', HONORIFIC.sub('', s.strip())).lower().replace('.', '').replace(' ', '')
        return n(a) == n(b)
    if kind == 'phone':
        return phone_numbers(a)[:1] == phone_numbers(b)[:1]
    if kind == 'sebi':  # "MB/INM000011336" and "INM000011336" are one registration number
        def f(s):
            return (re.findall(r'IN[MR]\d{9}', s.replace(' ', '')) or [s])[0]
        return f(a) == f(b)
    if kind == 'email':
        return a.strip().lower().rstrip('.') == b.strip().lower().rstrip('.')
    if kind == 'url':
        def u(s):
            return re.sub(r'^(?:https?://)?(?:www\.)?', '', s.strip().lower()).rstrip('/')
        return u(a) == u(b)
    if kind == 'addr':
        return re.sub(r'[^a-z0-9]', '', a.lower()) == re.sub(r'[^a-z0-9]', '', b.lower())
    return a == b


def gi_expected(k):
    rows = k['ipo_intermediaries.name'].get('rows') or []
    brlm = [r for r in rows if r['role'] == 'BRLM']
    reg = next((r for r in rows if r['role'] == 'REGISTRAR'), {})
    regrow = (k['registrars.name'].get('rows') or [{}])[0]
    e = {'lead_managers': ('list', k['ipos.lead_managers']['value'])}
    for r in brlm:
        for fld, kind in (('sebi_reg_no', 'sebi'), ('contact_person', 'person'), ('phone', 'phone'),
                          ('email', 'email'), ('grievance_email', 'email')):
            e['brlm.%s|%s' % (fld, r['name'])] = (kind, r.get(fld))
    for fld, kind, val in (('name', 'name', reg.get('name')), ('sebi_reg_no', 'sebi', reg.get('sebi_reg_no')),
                           ('contact_person', 'person', reg.get('contact_person')), ('phone', 'phone', reg.get('phone')),
                           ('email', 'email', regrow.get('email')),
                           ('grievance_email', 'email', reg.get('grievance_email')),
                           ('link', 'url', k['ipo_details.registrar_link']['value'])):
        e['registrar.%s' % fld] = (kind, val)
    for fld, kind in (('compliance_officer', 'person'), ('compliance_officer_phone', 'phone'),
                      ('compliance_officer_email', 'email'), ('company_address', 'addr'), ('company_phone', 'phone'),
                      ('company_email', 'email')):
        who = 'co' if fld.startswith('comp') and 'officer' in fld else 'company'
        e['%s.%s' % (who, fld)] = (kind, k['ipo_details.%s' % fld]['value'])
    e['company.company_website'] = ('url', k['ipos.company_website']['value'])
    return e


def gi_got(fields):
    def v(n):
        return (fields.get(n) or {}).get('value')
    g = {'lead_managers': v('lead_managers')}
    for firm, em in (v('brlm_grievance_emails') or {}).items():
        g['brlm.grievance_email|%s' % firm] = em
    g['_brlm_regs'] = v('brlm_sebi_regs') or []
    for a, b in (('name', 'registrar_name'), ('sebi_reg_no', 'registrar_sebi_reg'),
                 ('contact_person', 'registrar_contact_person'), ('phone', 'registrar_phone'),
                 ('email', 'registrar_email')):
        g['registrar.%s' % a] = v(b)
    g['registrar.link'] = v('registrar_website')
    for fld in ('compliance_officer', 'compliance_officer_phone', 'compliance_officer_email'):
        g['co.%s' % fld] = v(fld)
    for fld in ('company_address', 'company_phone', 'company_email', 'company_website'):
        g['company.%s' % fld] = v(fld)
    return g


def score_general(key, out):
    e, got = gi_expected(key), gi_got(out['fields'])
    cells, used = [], set()
    for k, (kind, want) in e.items():
        fam = k.split('|')[0]
        if '|' in k:  # a BRLM row: match the saved row by firm name
            firm = k.split('|')[1]
            gk = next((x for x in got if x.startswith(fam + '|') and name_key(x.split('|')[1]) == name_key(firm)), None)
            have = got.get(gk) if gk else None
            if gk:
                used.add(gk)
            if fam == 'brlm.sebi_reg_no' and have is None and got.get('_brlm_regs'):
                have = want if want in got['_brlm_regs'] else None
        else:
            have = got.get(k)
            used.add(k)
        if want in (None, [], ''):
            if have:
                cells.append(cell(fam, k, 'unkeyed', None, have))
            continue
        if have in (None, [], ''):
            cells.append(cell(fam, k, 'missed', want))
        elif (kind == 'list' and {name_key(x) for x in have} == {name_key(x) for x in want}) or \
                (kind != 'list' and same_value(kind, str(have), str(want))):
            cells.append(cell(fam, k, 'correct', want, have))
        else:
            cells.append(cell(fam, k, 'wrong', want, have))
    for gk, have in got.items():  # saved rows for firms the key does not list as BRLM
        if '|' in gk and gk not in used and have:
            cells.append(cell(gk.split('|')[0], gk + ' (extra firm)', 'wrong', None, have))
    keyed_regs = {w for k2, (kd, w) in e.items() if k2.startswith('brlm.sebi_reg_no|')}
    for r in got.get('_brlm_regs') or []:
        if r not in keyed_regs:
            cells.append(cell('brlm.sebi_reg_no', 'extra reg %s' % r, 'wrong', None, r))
    return cells


SCORERS = {'financial': score_financial, 'promoters': score_promoters, 'general-information': score_general}


# --------------------------------------------------------------------------- cache + reader
def cache_dir(arg):
    return arg or os.environ.get('OFFER_DOC_CACHE') or DEFAULT_CACHE


def list_cache(cdir):
    if not os.path.isdir(cdir):
        raise NotRun('cache folder absent: %s (set OFFER_DOC_CACHE or copy the reader cache there)' % cdir)
    files = sorted(f for f in os.listdir(cdir) if f.endswith('.cache.json'))
    if not files:
        raise NotRun('cache folder holds no *.cache.json files: %s' % cdir)
    return {f[:-len('.cache.json')]: os.path.join(cdir, f) for f in files}


def discover_keys():
    """{(section, set, doc name '<slug>-<TYPE>'): key path} for every committed truth file of every section."""
    found = {}
    for section, (sets, types) in SECTIONS.items():
        for s in sets:
            folder = os.path.join(FIXTURES, s)
            if not os.path.isdir(folder):
                raise NotRun('answer-key folder missing: %s' % folder)
            for fname in sorted(os.listdir(folder)):
                m = KEY_FILE.match(fname)
                if not m or (types is not None and m.group('type') not in types):
                    continue
                found[(section, s, '%s-%s' % (m.group('slug'), m.group('type').upper()))] = os.path.join(folder, fname)
    return found


def run_reader(code_dir, cache_path):
    sys.path.insert(0, code_dir)
    try:
        import extract_filing as ef
    except Exception as exc:  # noqa: BLE001 - any import failure means the gate cannot run
        raise NotRun('reader import failed from %s: %s: %s' % (code_dir, type(exc).__name__, exc))
    with open(cache_path, encoding='utf8') as fh:
        c = json.load(fh)
    misses = []

    def provider(kind, store):
        def prov(i):
            if str(i) in store:
                return store[str(i)]
            misses.append('%s:%s' % (kind, i))
            return None if kind == 'grid' else []
        return prov
    out = ef.run(page_texts=[(i, t) for i, t in c['page_texts']], doc_type=c['type'], source_doc=c['source_doc'],
                 segment='SME' if c['segment'] == 'SME' else 'MAINBOARD',
                 ocr_confidence={int(k): v for k, v in c['ocr_confidence'].items()} or None,
                 ocr_render={int(k): tuple(v) for k, v in c['ocr_render'].items()} or None,
                 tables_for_page=provider('tables', c['tables']), words_for_page=provider('words', c['words']),
                 grid_words_for_page=provider('grid', c.get('grid_words', {})))
    out = json.loads(json.dumps(ef._strip_nul_bytes(out), default=str))
    return out, misses


# --------------------------------------------------------------------------- scoring + gate
def family_status(section, family):
    return KNOWN_FAMILIES.get(section, {}).get(family)


def evaluate(code_dir, cdir):
    keys = discover_keys()
    available = list_cache(cdir)
    docs_needed = sorted({d for (_, _, d) in keys if d in available})
    if os.path.isfile(BASELINE):
        with open(BASELINE, encoding='utf8') as fh:
            absent = [d for d in json.load(fh)['docs'] if d not in available]
        if absent:
            raise NotRun('documents the baseline was built on are missing from the cache %s: %s' % (cdir, ', '.join(absent)))
    outputs, missed_cache = {}, {}
    t0 = time.time()
    for d in docs_needed:
        out, misses = run_reader(code_dir, available[d])
        outputs[d] = out
        if misses:
            missed_cache[d] = sorted(set(misses))[:5]
    if missed_cache:
        raise NotRun('cache misses (the reader asked for pages the cache does not hold; rebuild the cache): %s' %
                     '; '.join('%s %s' % (d, m) for d, m in sorted(missed_cache.items())))
    results = []  # one dict per scored cell, tagged with section / set / doc
    skipped = defaultdict(list)
    for (section, kset, doc), path in sorted(keys.items()):
        if doc not in outputs:
            skipped[section].append('%s/%s' % (kset, doc))
            continue
        for c in SCORERS[section](load_key(path), outputs[doc]):
            c.update(section=section, set=kset, doc=doc)
            results.append(c)
    return results, docs_needed, dict(skipped), time.time() - t0


def tally(results):
    """{section: {set: {family: {'correct','wrong','missed','unkeyed'}}}}"""
    t = {}
    for c in results:
        fam = t.setdefault(c['section'], {}).setdefault(c['set'], {}).setdefault(
            c['family'], {'correct': 0, 'wrong': 0, 'missed': 0, 'unkeyed': 0})
        fam[c['verdict']] += 1
    return t


def build_baseline(results, docs):
    t = tally(results)
    found = {s: {k: {f: v['correct'] for f, v in sorted(fams.items())} for k, fams in sorted(sets.items())}
             for s, sets in sorted(t.items())}
    known_wrong = sorted('%s|%s|%s|%s' % (c['section'], c['set'], c['doc'], c['cell']) for c in results
                         if c['verdict'] == 'wrong' and family_status(c['section'], c['family']))
    return {'note': 'Generated by offer_doc_gate.py --update-baseline. found = right values per section / key set / '
                    'family; wrong in a gate family is never stored (must be 0). known_wrong = cells of KEEP-TODAY '
                    'or PARKED families that are wrong today (F-249); a NEW wrong cell there fails the gate.',
            'docs': docs, 'found': found, 'known_wrong': known_wrong}


def check(results, docs, baseline):
    problems = []
    for c in results:
        if c['verdict'] == 'wrong' and not family_status(c['section'], c['family']):
            problems.append('WRONG %s/%s %s %s: key %r, reader saved %r' %
                            (c['section'], c['set'], c['doc'], c['cell'], c['key'], c['got']))
    if baseline is None:
        problems.append('no baseline.json: run with --update-baseline once the gate families have 0 wrong')
        return problems
    t = tally(results)
    for section, sets in baseline['found'].items():
        for kset, fams in sets.items():
            for fam, want in fams.items():
                have = t.get(section, {}).get(kset, {}).get(fam, {}).get('correct', 0)
                if have < want:
                    problems.append('FOUND DROPPED %s/%s %s: %d right, baseline %d' % (section, kset, fam, have, want))
    allowed = set(baseline.get('known_wrong', []))
    for c in results:
        if c['verdict'] == 'wrong' and family_status(c['section'], c['family']):
            ident = '%s|%s|%s|%s' % (c['section'], c['set'], c['doc'], c['cell'])
            if ident not in allowed:
                problems.append('NEW WRONG in a known family (%s) %s: key %r, reader saved %r' %
                                (family_status(c['section'], c['family']), ident, c['key'], c['got']))
    return problems


def report(results, docs, skipped, seconds, baseline):
    t = tally(results)
    print('offer-document gate: %d documents read from cache in %.0fs' % (len(docs), seconds))
    for section in SECTIONS:
        print('\n== %s' % section)
        gate_tot, known_tot = defaultdict(int), defaultdict(int)
        for kset, fams in sorted(t.get(section, {}).items()):
            print('  key set %s' % kset)
            for fam, v in sorted(fams.items()):
                st = family_status(section, fam)
                base = (baseline or {}).get('found', {}).get(section, {}).get(kset, {}).get(fam)
                print('    %-26s right %4d  wrong %3d  missed %4d  unkeyed %3d  baseline-right %s%s' % (
                    fam, v['correct'], v['wrong'], v['missed'], v['unkeyed'], '-' if base is None else base,
                    '  [known, F-249: %s]' % st if st else ''))
                tgt = known_tot if st else gate_tot
                for k in ('correct', 'wrong', 'missed'):
                    tgt[k] += v[k]
        print('  GATE families total   right %d  wrong %d  missed %d' % (gate_tot['correct'], gate_tot['wrong'],
                                                                         gate_tot['missed']))
        if known_tot:
            print('  KNOWN, F-249 (not gate failures) right %d  wrong %d  missed %d' % (
                known_tot['correct'], known_tot['wrong'], known_tot['missed']))
        if skipped.get(section):
            print('  no cache document for: %s' % ', '.join(skipped[section]))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--update-baseline', action='store_true', help='rewrite baseline.json (refused if a gate family has a wrong value)')
    ap.add_argument('--code-dir', default=HERE, help='folder holding extract_filing.py (default: this folder)')
    ap.add_argument('--cache', default=None, help='cache folder (default: env OFFER_DOC_CACHE or %s)' % DEFAULT_CACHE)
    args = ap.parse_args(argv)
    try:
        results, docs, skipped, seconds = evaluate(os.path.abspath(args.code_dir), cache_dir(args.cache))
    except NotRun as exc:
        print('NOT RUN: %s' % exc)
        return EXIT_NOT_RUN
    baseline = None
    if os.path.isfile(BASELINE):
        with open(BASELINE, encoding='utf8') as fh:
            baseline = json.load(fh)
    report(results, docs, skipped, seconds, baseline)
    if args.update_baseline:
        wrong = [c for c in results if c['verdict'] == 'wrong' and not family_status(c['section'], c['family'])]
        if wrong:
            print('\nREFUSED to write the baseline: %d wrong value(s) in gate families:' % len(wrong))
            for c in wrong:
                print('  WRONG %s/%s %s %s: key %r, reader saved %r' % (c['section'], c['set'], c['doc'], c['cell'],
                                                                         c['key'], c['got']))
            return EXIT_FAIL
        with open(BASELINE, 'w', encoding='utf8', newline='\n') as fh:
            json.dump(build_baseline(results, docs), fh, indent=1, sort_keys=True)
            fh.write('\n')
        print('\nbaseline written: %s' % BASELINE)
        return EXIT_PASS
    problems = check(results, docs, baseline)
    if problems:
        print('\nGATE FAILED (%d):' % len(problems))
        for p in problems:
            print('  ' + p)
        return EXIT_FAIL
    print('\nGATE PASSED: 0 wrong in gate families; found at or above the baseline in every section / key set / family')
    return EXIT_PASS


if __name__ == '__main__':
    sys.exit(main())
