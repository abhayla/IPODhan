"""ONE interpreter from offer-document grids to the financial fields, with copies validation (OD-173 steps 3, 3b, 4).

read(stmt_doc, sec_doc, page_text_by_idx) -> {'fields': {name: {values, source, copies, tier} | {missed}},
                                              'single': {name: {value, fy, source} | {missed}}, 'notes', 'basis'}
  stmt_doc = statement_grid.read_statement_grids(...), sec_doc = statement_grid.read_section_grids(...).
Money values are in CRORE (converted from each table's own unit); per-share and percent values as printed.

Step 4 (copies): every printed copy of a field / period across the located sections is collected; copies that agree
within their printed rounding give the value; a single copy stands only if its own table's identities hold where they
can be checked; any disagreement refuses the field (F-248); a table that prints the field but cannot be read must not
print a number no read copy accounts for (the unread-table guard, using the same label dictionary).
Ported from the proven spike (claude-doc/rebuild/interpret_spike.py) without behaviour change.
"""
import re

import statement_grid as G
import financial_labels as L


def basis_of(page_text):
    head = '\n'.join((page_text or '').split('\n')[:8]).lower()
    if 'consolidated' in head:
        return 'consolidated'
    if 'standalone' in head:
        return 'standalone'
    return 'unstated'


def pkey(period):
    if period['kind'] == 'fy':
        return 'FY%d' % period['year']
    return 'S%d-%02d' % (period['year'], period['month'])


def usable_grids(doc, page_texts):
    """Every resolved grid, classified by its row labels (the printed title is only a fallback)."""
    out, notes = [], []
    for key, st in doc['statements'].items():
        title_kind = st.get('title_kind') if not key.startswith('untitled') else None
        for g in st.get('grids', []):
            if 'refused' in g:
                continue
            kind, hits = L.classify(g['rows'])
            if kind is None:
                if title_kind and all(v == 0 for k, v in hits.items() if k != title_kind):
                    kind = title_kind  # continuation page: no signature of any other statement
                else:
                    notes.append('p%s (%s) not classified, hits %s: grid not used' % (g['page'], key, hits))
                    continue
            if title_kind and kind != title_kind:
                notes.append('p%s titled %s but labels say %s (hits %s): read as %s' % (g['page'], title_kind, kind,
                                                                                          hits, kind))
            elif key.startswith('untitled'):
                notes.append('p%s (%s) classified by labels as %s (hits %s)' % (g['page'], key, kind, hits))
            out.append(dict(grid=g, kind=kind, basis=basis_of(page_texts.get(g['page'])), page=g['page']))
    # D13: consolidated wins inside each statement kind
    for kind in ('pl', 'bs', 'cf'):
        bases = {x['basis'] for x in out if x['kind'] == kind}
        if 'consolidated' in bases and 'standalone' in bases:
            notes.append('%s: consolidated and standalone grids both present -> standalone dropped (D13)' % kind)
            out = [x for x in out if not (x['kind'] == kind and x['basis'] == 'standalone')]
    return out, notes


def candidate_rows(grids, spec):
    """Accepted rows for a field, best tier only: [(row, grid_entry, label)]; plus refusal notes."""
    tiers = spec['accept']
    found = [[] for _ in tiers]
    refused = []
    for ge in grids:
        if ge['kind'] != spec['kind']:
            continue
        ctx = []
        for row in ge['grid']['rows']:
            has_val = any(c is not None for c in row['cells'])
            has_dash = spec.get('dash_is_zero') and any(re.fullmatch(r'\s*(?:-|nil|\u2013)\s*', (r or ''), re.I)
                                                        for r in row.get('raw', []))
            if not has_val and not has_dash:
                ctx = (ctx + [L.raw_lower(row['label'])])[-3:]
                continue
            lab_raw, lab = L.raw_lower(row['label']), L.norm(row['label'])
            context = ' '.join(ctx)
            ctx = []
            tier = next((i for i, pats in enumerate(tiers) if any(re.fullmatch(p, lab) for p in pats)), None)
            if tier is None:
                continue
            if re.search(spec['refuse'], lab_raw):
                refused.append('p%s "%s": refusal pattern' % (ge['page'], row['label'][:70]))
                continue
            cr = spec.get('context_refuse')
            if cr and (re.search(cr, lab_raw) or re.search(cr, context)):
                refused.append('p%s "%s" under "%s": context refusal' % (ge['page'], row['label'][:50], context[:60]))
                continue
            if row.get('bad_cells'):
                refused.append('p%s "%s": grid flagged cells %s, row not trusted' % (ge['page'], row['label'][:60],
                                                                                    row['bad_cells']))
                continue
            found[tier].append((row, ge, row['label']))
    for i, f in enumerate(found):
        if f:
            return f, i, refused
    return [], None, refused


def series(cands, spec):
    """Merge accepted rows by period; any disagreement -> refusal (never pick one of two printed values)."""
    vals, src = {}, {}
    for row, ge, lab in cands:
        g = ge['grid']
        unit = g.get('unit')
        if spec['value'] == 'money' and unit not in L.TO_CRORE:
            return None, None, 'unit "%s" on p%s not convertible' % (unit, g['page'])
        mult = L.TO_CRORE[unit] if spec['value'] == 'money' else 1.0
        for col, v, raw in zip(g['columns'], row['cells'], row.get('raw') or [None] * len(row['cells'])):
            if not col.get('period'):
                continue
            if v is None and spec.get('dash_is_zero') and re.fullmatch(r'\s*(?:-|nil|\u2013)\s*', raw or '', re.I):
                v = 0.0  # D10
            if v is None:
                continue
            k = pkey(col['period'])
            cv = round(v * mult, 6)
            if k in vals and abs(vals[k] - cv) > 1e-6:
                return None, None, 'rows disagree for %s: %s (p%s "%s") vs %s (p%s "%s")' % (
                    k, vals[k], src[k][0], src[k][1][:50], cv, g['page'], lab[:50])
            vals[k] = cv
            src[k] = (g['page'], lab)
    return vals, src, None


def latest_fy(grids, kind):
    ys = [c['period']['year'] for ge in grids if ge['kind'] == kind for c in ge['grid']['columns']
          if c.get('period') and c['period']['kind'] == 'fy']
    return max(ys) if ys else None


def interpret(doc, sec_doc, pt):
    """Statement fields from the statement grids (step 3), each checked against every other copy (step 4)."""
    grids, notes = usable_grids(doc, pt)
    out = {'notes': notes, 'fields': {}, 'basis': {}}
    for ge in grids:
        out['basis'].setdefault(ge['kind'], set()).add('%s p%s' % (ge['basis'], ge['page']))
    out['basis'] = {k: sorted(v) for k, v in out['basis'].items()}
    for name, spec in L.FIELDS.items():
        cands, tier, refused = candidate_rows(grids, spec)
        rec = {'refusals_seen': refused}
        if not cands:
            rec['missed'] = 'no accepted row on a %s grid' % spec['kind']
            out['fields'][name] = rec
            continue
        vals, src, err = series(cands, spec)
        if err:
            rec['missed'] = 'REFUSED: ' + err
            out['fields'][name] = rec
            continue
        rec.update(values=vals, tier=tier, source={k: 'p%s "%s"' % (v[0], v[1][:80]) for k, v in src.items()})
        out['fields'][name] = rec
    # tier-1 total income ("Total revenue") must satisfy revenue + other income = it
    ti = out['fields'].get('total_income', {})
    if ti.get('tier') == 1:
        oth_spec = dict(kind='pl', value='money', accept=[[r'other income']], refuse=r'comprehensive')
        oc, _, _ = candidate_rows(grids, oth_spec)
        ov, _, _ = series(oc, oth_spec) if oc else ({}, None, None)
        rv = out['fields']['revenue'].get('values') or {}
        bad = [k for k, v in ti['values'].items() if k in rv and k in (ov or {}) and abs(rv[k] + ov[k] - v) > 0.0011]
        checked = [k for k in ti['values'] if k in rv and k in (ov or {})]
        if bad or not checked:
            out['fields']['total_income'] = {'missed': 'REFUSED: "Total revenue" row fails or cannot run revenue + '
                                             'other income identity (bad %s)' % bad, 'refusals_seen': []}
        else:
            ti['identity'] = 'revenue + other income = total revenue in %s' % checked
    validate_statement_fields(out, grids, sec_doc)  # step 4
    # single-value fields: latest FULL fiscal year of that statement (D11), no fall-back to an older year
    single = {}
    for name, field, kind in (('net_worth', 'net_worth', 'bs'), ('reserves_and_surplus', 'reserves_and_surplus', 'bs'),
                              ('total_assets', 'total_assets', 'bs'), ('total_borrowing', 'total_borrowing', 'bs'),
                              ('eps', 'eps_basic', 'pl'), ('pre_ipo_eps', 'eps_basic', 'pl')):
        y = latest_fy(grids, kind)
        v = (out['fields'][field].get('values') or {}).get('FY%s' % y) if y else None
        if v is None:
            single[name] = {'missed': 'latest full FY%s: %s' % (y, out['fields'][field].get('missed') or 'cell empty')}
            continue
        if name in ('eps', 'pre_ipo_eps'):  # D8 sign check against PAT of the same year
            pat = (out['fields']['profit'].get('values') or {}).get('FY%s' % y)
            if pat is None:
                single[name] = {'missed': 'REFUSED: PAT FY%s not read, D8 sign check impossible' % y}
                continue
            if v != 0 and (v > 0) != (pat > 0):
                single[name] = {'missed': 'REFUSED: EPS %s sign differs from PAT %s (D8)' % (v, pat)}
                continue
        single[name] = {'value': v, 'fy': y, 'source': out['fields'][field]['source'].get('FY%s' % y)}
    out['single'] = single
    for k, why in L.NOT_ON_STATEMENTS.items():
        out['fields'][k] = {'missed': 'not a statement row: ' + why}
    return out


# ================================================================ step 3b
DASH_RAW = re.compile(r'\s*(?:-|nil|–|—)\s*', re.I)


def decimals(raw, v):
    m = re.search(r'\.(\d+)', raw or '')
    if m:
        return len(m.group(1))
    if raw and re.search(r'\d', raw):
        return 0
    t = repr(float(v))
    return 0 if t.endswith('.0') else len(t.split('.')[1])


def copy_of(per, v, raw, mult, where, grid, ci, row):
    """One printed copy: value in crore (money) or as printed, half its printed rounding in the same scale."""
    return dict(per=per, val=round(v * mult, 6), half=0.5 * 10 ** -decimals(raw, v) * mult, printed=v,
                shown=raw or repr(v), where=where, grid=grid, ci=ci, row=row)


PRO_FORMA = re.compile(r'\bpro[\s-]?forma\b', re.I)


def not_an_amount(spec, raw):
    """A printed cell the unread-table guard must not count as a copy: a '(1)' footnote marker, or a percent cell
    for a money / per-share field (the same refusal the reader applies to a percent row)."""
    raw = (raw or '').strip()
    return bool(re.fullmatch(r'\(\d{1,2}\)', raw)) or (GUARD_USES_DICTIONARY and spec['value'] in ('money', 'per_share')
                                                       and '%' in raw)


def guard_label(spec, label):
    """Does the unread-table guard count this row as a printed copy of the field?"""
    if GUARD_USES_DICTIONARY:
        return L.accept_label(spec, label) == (0, None)
    return (any(re.fullmatch(p, L.norm3(label)[0]) for p in spec['accept'][0])  # step-3b guard (mutation only)
            and not re.search(spec['refuse'], L.raw_lower(label)))


def rows_3b(d, spec, name, doc_basis, other_copies=()):
    """Accepted copies per tier from the section grids `d`; plus refusal notes and unread-table clashes.

    other_copies: copies read elsewhere (the statements) that an unreadable table may legitimately repeat."""
    tiers = [[] for _ in spec['accept']]
    notes, unread, prev_pf, pf_printed = [], [], {}, []
    for pg in d['pages']:
        if pg['section'] not in spec['sections']:
            continue
        for g in pg['grids']:
            basis = g.get('basis') or pg.get('page_basis')
            # pro forma tables print a different measure; a table with no title of its own (header only a unit line)
            # continues the previous table of the section and inherits its pro forma status
            untitled = not re.sub(r'[\s()₹]|million|lakhs?|crores?|rs\.?|inr', '', (g.get('header_text') or ''),
                                  flags=re.I)
            own_pf = bool(PRO_FORMA.search(' '.join([g.get('context') or '', g.get('header_text') or ''] +
                                                    [c['header'] for c in g.get('columns', [])])))
            inherited_pf = untitled and prev_pf.get(pg['section'], False)
            prev_pf[pg['section']] = own_pf or inherited_pf
            # an unreadable table that names pro forma may mix restated and pro forma columns: it is NOT skipped, the
            # guard below checks its numbers (a number read from a pro forma table counts as accounted for)
            if inherited_pf or (own_pf and 'refused' not in g):
                hit = [r for r in g.get('rows', []) if L.accept_label(spec, r['label']) == (0, None)]
                if hit and 'refused' not in g:
                    pf_printed.extend(c for r in hit for c in r['cells'] if c is not None)
                if hit:
                    notes.append('p%s %s table is pro forma financial information, not a copy of the restated value'
                                 % (pg['page'], pg['section']))
                continue
            if 'refused' in g:
                # a table that prints this field but could not be read: the field cannot be checked against it
                peer = re.search(PEER, ' '.join([g.get('context') or '', g.get('header_text', '')] +
                                                [c['header'] for c in g.get('columns', [])]), re.I)
                if peer or (doc_basis == 'consolidated' and basis == 'standalone'):
                    continue
                labs = [r for r in g.get('rows', []) if guard_label(spec, r['label'])]
                # (the step-3b RoNW header fallbacks, here and in the rows-orientation read below, were written with
                # backspace bytes where \b was meant and never ran; they stay off: switched on, Acevector p168's NAV
                # "Amount" column is read as RoNW)
                nums = [c for r in labs for c, raw in zip(r['cells'], r.get('raw') or [None] * len(r['cells']))
                        if c is not None and not not_an_amount(spec, raw)]
                if nums:
                    unit = G.unit_of([labs[0]['label']]) or g.get('unit')
                    unread.append(('p%s %s "%s"' % (pg['page'], pg['section'], labs[0]['label'][:40]), nums,
                                   L.TO_CRORE.get(unit) if spec['value'] == 'money' else 1.0))
                continue
            if doc_basis == 'consolidated' and basis == 'standalone':
                if any(L.accept_label(spec, r['label'])[0] is not None for r in g['rows']):
                    notes.append('p%s %s table is standalone, document is consolidated: dropped (D13)'
                                 % (pg['page'], pg['section']))
                continue
            if g['orientation'] == 'rows':
                if spec['value'] != 'percent':
                    continue
                pat = '|'.join(p for pats in spec['accept'] for p in pats)
                heads = [L.norm3(c['header'])[0] for c in g['columns']]
                col = [k for k, h in enumerate(heads) if h and re.fullmatch(pat, h)]
                if len(col) != 1:
                    continue
                k = col[0]
                for r in g['rows']:
                    lp = r.get('label_period')
                    if lp and r['cells'][k] is not None and not r.get('stray'):
                        per = pkey({'year': lp[0], 'month': lp[1], 'kind': lp[3]})
                        raw = (r.get('raw') or [None] * len(r['cells']))[k]
                        tiers[0].append(copy_of(per, r['cells'][k], raw, 1.0, 'p%s %s "%s" [%s]' % (
                            pg['page'], pg['section'], r['label'][:50], g['columns'][k]['header'][:20] or 'RoNW col'),
                            g, k, r))
                continue
            row_basis = None
            for r in g['rows']:
                if all(c is None for c in r['cells']):
                    hb = re.search(r'\b(standalone|consolidated)\b', r['label'], re.I)
                    row_basis = hb.group(1).lower() if hb else row_basis  # a basis sub-heading inside the table
                tier, why = L.accept_label(spec, r['label'])
                if tier is None:
                    continue
                if doc_basis == 'consolidated' and row_basis == 'standalone':
                    notes.append('p%s %s "%s" sits under a standalone sub-heading: dropped (D13)'
                                 % (pg['page'], pg['section'], r['label'][:50]))
                    continue
                where = 'p%s %s "%s"' % (pg['page'], pg['section'], r['label'][:60])
                if why:
                    notes.append('%s: %s' % (where, why))
                    continue
                if r.get('bad_cells') or r.get('stray'):
                    notes.append(where + ': cells not trusted (bad %s, stray %s)' % (r.get('bad_cells'), r.get('stray')))
                    continue
                mult = 1.0
                if spec['value'] == 'money':
                    unit = G.unit_of([r['label']]) or g.get('unit')
                    if unit not in L.TO_CRORE:
                        notes.append(where + ': no unit stated for this table (%s), value not read' % unit)
                        continue
                    mult = L.TO_CRORE[unit]
                for ci, (col, v, raw) in enumerate(zip(g['columns'], r['cells'], r['raw'])):
                    if not col.get('period'):
                        continue
                    if v is None and spec.get('dash_is_zero') and DASH_RAW.fullmatch(raw or ''):
                        v = 0.0  # D10
                    if v is None:
                        continue
                    tiers[tier].append(copy_of(pkey(col['period']), v, raw, mult, where, g, ci, r))
    # an unreadable table that prints this field: every number it prints for the field must be one of the copies read
    # elsewhere (same printed number, or the same amount after unit conversion), else the field cannot be checked
    allc = [c for t in tiers for c in t] + list(other_copies)

    def seen(n, mult):
        return any(abs(n - c['printed']) < 0.005 for c in allc) or any(abs(n - x) < 0.005 for x in pf_printed) or (
            mult is not None and any(abs(n * mult - c['val']) <= c['half'] + 0.005 * mult for c in allc))
    clash = [(w, [n for n in nums if not seen(n, mult)]) for w, nums, mult in unread]
    return tiers, notes, [('%s prints %s' % (w, bad[:4])) for w, bad in clash if bad]


PEER = r'\b(?:limited|ltd|our company|peers?|industry)\b'
QUALIFIED = re.compile(r'(?:operating|adjusted|normali[sz]ed|core|/|\bto)\s*$', re.I)


def plain_ebitda_printed(g, pt):
    """OD-172 fallback guard: True when any page of the summary / OFI / basis sections says plain 'EBITDA'."""
    for pg in g['pages']:
        if pg['section'] in ('sod', 'ofi', 'bop'):
            for m in re.finditer(r'\b(?:ebitda|ebidta)\b(?!\s*(?:margin|/|to\b|growth))', pt.get(pg['page'], ''), re.I):
                if not QUALIFIED.search(pt[pg['page']][max(0, m.start() - 14):m.start()]):
                    return True
    return False


# ================================================================ step 4: every printed copy, agreement, decision
# Mutation switches (mutate4.py): CHECK_COPIES=False -> statement fields are read from the statements only (step 3/3b);
# GUARD_USES_DICTIONARY=False -> the unread-table guard uses its own narrower label test (step 3b).
CHECK_COPIES = True
GUARD_USES_DICTIONARY = True
ALL_SECTIONS = ('sod', 'ofi', 'bop', 'cap', 'restated')
VALIDATED = ('revenue', 'total_income', 'profit', 'eps_basic', 'eps_diluted', 'reserves_and_surplus', 'total_assets',
             'op_cash_flow')


def statement_copies(grids, spec):
    """Every accepted statement row (best tier), one copy per period column."""
    cands, tier, _ = candidate_rows(grids, spec)
    out = []
    for row, ge, lab in cands:
        g = ge['grid']
        mult = L.TO_CRORE.get(g.get('unit'), None) if spec['value'] == 'money' else 1.0
        if mult is None:
            continue
        raws = row.get('raw') or [None] * len(row['cells'])
        for ci, (col, v, raw) in enumerate(zip(g['columns'], row['cells'], raws)):
            if not col.get('period'):
                continue
            if v is None and spec.get('dash_is_zero') and DASH_RAW.fullmatch(raw or ''):
                v = 0.0
            if v is None:
                continue
            out.append(copy_of(pkey(col['period']), v, raw, mult, 'statement p%s "%s"' % (g['page'], lab[:60]),
                               g, ci, row))
    return out, tier


def _cell(grid, ci, pats):
    """(value, half rounding) of the one row at column ci whose label is one of pats; None if absent or ambiguous."""
    got = set()
    for r in grid.get('rows', []):
        if ci >= len(r['cells']) or r['cells'][ci] is None or r.get('bad_cells'):
            continue
        if any(re.fullmatch(p, L.norm3(r['label'])[0]) for p in pats):
            raw = (r.get('raw') or [None] * len(r['cells']))[ci]
            got.add((r['cells'][ci], 0.5 * 10 ** -decimals(raw, r['cells'][ci])))
    return got.pop() if len(got) == 1 else None


PBT = [r'(?:restated )?(?:net )?(?:profit|loss|profit / loss|profit / \(loss\)|\(loss\) / profit|profit\s*\(loss\))'
       r' before tax(?:es|ation)?(?: for the (?:year|period))?']
TOTAL_TAX = [r'(?:total )?(?:income )?tax expenses?(?: / \(credit\))?', r'total tax(?: / \(credit\))?']
NONCURRENT_BORROWINGS = [r'(?:total )?non-current borrowings?', r'(?:total )?long[- ]term borrowings?']
CURRENT_BORROWINGS = [r'(?:total )?current borrowings?', r'(?:total )?short[- ]term borrowings?']


def identity(name, c):
    """True / False when a printed identity of the copy's own table checks the value; None when not checkable."""
    g, ci, v, h = c['grid'], c['ci'], c['printed'], 0.5 * 10 ** -decimals(c['shown'], c['printed'])
    rev = [r'(?:total )?(?:net )?revenue from operations?']
    if name == 'revenue':
        ti, oi = _cell(g, ci, [r'total income']), _cell(g, ci, [r'other income'])
        if ti and oi:
            return abs(v + oi[0] - ti[0]) <= h + oi[1] + ti[1] + 1e-9
    elif name == 'total_income':
        rv, oi = _cell(g, ci, rev), _cell(g, ci, [r'other income'])
        if rv and oi:
            return abs(rv[0] + oi[0] - v) <= h + rv[1] + oi[1] + 1e-9
    elif name == 'profit':
        ti = _cell(g, ci, [r'total income'])
        if ti and not v <= ti[0] + h + ti[1]:
            return False
        # PAT = profit before tax - total tax, only on a P&L with no share of associates / discontinued operations
        # line between the two (those enter PAT after tax and would fail a correct value)
        pbt, tax = _cell(g, ci, PBT), _cell(g, ci, TOTAL_TAX)
        if pbt and tax and not any(re.search(r'share of|discontinued|minority|non-controlling', L.raw_lower(r['label']))
                                   for r in g.get('rows', []) if any(c is not None for c in r['cells'])):
            return abs(pbt[0] - tax[0] - v) <= h + pbt[1] + tax[1] + 1e-9
        if ti:
            return True
    elif name == 'total_borrowing':
        # the capitalisation / summary table's printed total = its printed non-current + current borrowings
        nc, cur = _cell(g, ci, NONCURRENT_BORROWINGS), _cell(g, ci, CURRENT_BORROWINGS)
        if nc and cur:
            return abs(nc[0] + cur[0] - v) <= h + nc[1] + cur[1] + 1e-9
    elif name == 'total_assets':
        tel = _cell(g, ci, [r'total equity and liabilities', r'total liabilities and equity'])
        if tel:
            return abs(v - tel[0]) <= h + tel[1] + 1e-9
    elif name == 'reserves_and_surplus':
        sc = _cell(g, ci, [r'(?:equity )?share capital'])
        inst = _cell(g, ci, [r'instruments? .*equity.*'])
        if inst:
            sc = (sc[0] + inst[0], sc[1] + inst[1]) if sc else None
        te = _cell(g, ci, [r'(?:total )?equity attributable to .*(?:owners|holders).*'])
        if te is None and not any(re.search(r'non-controlling|minority', L.raw_lower(r['label']))
                                  for r in g.get('rows', [])):
            te = _cell(g, ci, [r'total equity'])
        if sc and te:
            return abs(sc[0] + v - te[0]) <= h + sc[1] + te[1] + 1e-9
    return None


def decide(copies, name):
    """-> (values, sources, error, per-period copy count). Copies of a period agree when they are equal within their
    printed rounding (after unit conversion); a period printed once is kept only if its table's identities hold where
    they can be checked; any disagreement or failed identity refuses the field (F-248), listing the copies."""
    by = {}
    for c in copies:
        by.setdefault(c['per'], []).append(c)
    vals, src, count = {}, {}, {}
    for per in sorted(by):
        cs = by[per]
        for i, a in enumerate(cs):
            for b in cs[i + 1:]:
                if abs(a['val'] - b['val']) > a['half'] + b['half'] + 1e-9:
                    return None, None, 'printed copies disagree for %s: %s' % (per, '; '.join(
                        '%s = %s' % (c['where'], c['shown']) for c in cs[:8])), count
        best = min(cs, key=lambda c: c['half'])
        if len(cs) == 1:
            ok = identity(name, best)
            if ok is False:
                return None, None, 'single printed copy for %s fails its table identity: %s = %s' % (
                    per, best['where'], best['shown']), count
        vals[per], src[per], count[per] = best['val'], best['where'], len(cs)
    return vals, src, None, count


def validate_statement_fields(out, grids, sec_doc):
    """Step 4 for the statement fields: the statements read the value, every other located section's copy checks it."""
    doc_basis = 'consolidated' if any(ge['basis'] == 'consolidated' for ge in grids) else 'unstated'
    out['_stmt_copies'] = {}
    for name, spec in L.FIELDS.items():
        rec = out['fields'][name]
        stmt, tier = statement_copies(grids, spec)
        if not rec.get('values'):
            continue
        out['_stmt_copies'][name] = stmt
        if name not in VALIDATED:
            continue
        sec, unread, notes = [], [], []
        if CHECK_COPIES:
            tiers, notes, unread = rows_3b(sec_doc, dict(spec, sections=ALL_SECTIONS), name, doc_basis, stmt)
            sec = tiers[rec.get('tier') or 0] if len(tiers) > (rec.get('tier') or 0) else []
        # only the periods the statement reading kept (step 3 already refused disagreeing statement rows)
        vals, src, err, count = decide(stmt + sec, name)
        if not err and unread:
            err = 'unread table(s) also print it: ' + '; '.join(unread[:3])
        if err:
            out['fields'][name] = {'missed': 'REFUSED: ' + err, 'refusals_seen': rec.get('refusals_seen', []) + notes}
            continue
        rec['values'] = {k: vals[k] for k in rec['values']}
        rec['source'] = {k: src[k] for k in rec['values']}
        rec['copies'] = {k: count[k] for k in rec['values']}


def interpret3b(out, sec_doc, pt):
    """The fields printed outside the three statements (EBITDA, net worth, borrowings, RoNW, rent), step 4 applied."""
    doc_basis = 'consolidated' if any('consolidated' in b for v in out['basis'].values() for b in v) else 'unstated'
    fy_all = [int(k[2:]) for f in out['fields'].values() for k in (f.get('values') or {}) if k.startswith('FY')]
    latest = max(fy_all) if fy_all else None
    fy_years = set(fy_all)
    out['step3b'] = {'doc_basis': doc_basis, 'latest_fy': latest}
    for name, spec in L.FIELDS_3B.items():
        stmt = out.get('_stmt_copies', {}).get(name, [])  # set only when the statements read the field
        tiers, notes, unread = rows_3b(sec_doc, spec, name, doc_basis, stmt)
        if name == 'ebitda' and not tiers[0] and tiers[1] and plain_ebitda_printed(sec_doc, pt):
            notes.append('OD-172: only a qualified EBITDA was read, but the document prints a plain EBITDA: refused')
            tiers[1] = []
        obs = next((t for t in tiers if t), []) + stmt
        # A section table's fiscal year that the restated statements themselves did not read is not a year of this
        # document's restated financials (a peer's year, a quarter mislabelled as a year): its copies are dropped.
        stray = sorted({c['per'] for c in obs if c['per'].startswith('FY') and int(c['per'][2:]) not in fy_years})
        if stray:
            notes.append('copies for %s dropped: not a fiscal year the restated statements read (%s)'
                         % (stray, sorted(fy_years)))
            obs = [c for c in obs if c['per'] not in stray]
        rec = {'refusals_seen': notes, 'tier': next((i for i, t in enumerate(tiers) if t), None)}
        vals, src, err, count = decide(obs, name) if obs else ({}, {}, None, {})
        if not err and vals:
            rec['copies'] = count
        vals = vals or {}
        if unread and vals:
            err = 'unread table(s) also print it: ' + '; '.join(unread[:3])
        if err:
            rec['missed'] = 'REFUSED: ' + err
        elif not vals:
            rec['missed'] = 'no accepted row in sections %s' % (spec['sections'],)
        else:
            rec.update(values=vals, source=src)
        out['fields'][name] = rec
        if spec['mode'] == 'latest' or name == 'net_worth':
            v = (rec.get('values') or {}).get('FY%s' % latest) if latest else None
            if v is None:
                out['single'][name] = {'missed': 'latest full FY%s: %s' % (latest, rec.get('missed') or 'not printed')}
            else:
                out['single'][name] = {'value': v, 'fy': latest, 'source': src['FY%s' % latest]}
    out.pop('_stmt_copies', None)
    return out


def read(stmt_doc, sec_doc, pt):
    """stmt_doc / sec_doc: statement_grid outputs; pt: {pdf index: page text}. -> interpreted fields (see module doc)."""
    return interpret3b(interpret(stmt_doc, sec_doc, pt), sec_doc, pt)
