"""OD-173 section 2: the promoters' holdings and costs from the located Capital Structure section.

One code path, the same as the financial rebuild (offer_doc_financials.py):
  1. locate   - the printed contents page gives the "Summary of the offer document" and "Capital
                Structure" sections (section_locator.py); only their pages that talk about promoters
                and shareholding / cost of acquisition are read;
  2. rows     - every table on those pages is read from word positions (statement_grid.grid_words),
                once, into label + value cells;
  3. labels   - ONE dictionary of table kinds (holding table, cost held, one-year cost) and cell tokens
                (Nil, [placeholder], ranges);
  4. validate - a value is saved only for a row whose name matches a promoter the cover declares
                (two printed copies of the cover statement must agree), and only when
                >= 2 independent printed copies agree, or one copy passes a check of its own:
                  shares held  : the holding table's promoter rows add up to its "Total" row;
                  cost held    : the copy's own shares cell equals the validated holding;
                  one-year cost: OD-175's four checks (one-year heading, rupees per share, declared
                                 promoter name, shares acquired <= shares held).
Fail closed: anything else is null with a reason. A nil cost is null (`bonus_nil`, spec row 111),
never 0.
"""
import re

import section_locator as sl
import statement_grid as sg

SECTION_TITLES = {
    'sod': sl.OTHER['sod'],
    'capstr': re.compile(r'^\s*' + sl.SEC_PREFIX + r'capital\s+structure\s*$', re.I),
}
PAGE_KEYS = re.compile(r'promoter|selling\s+shareholder', re.I)
PAGE_KEYS2 = re.compile(r'cost\s+of\s+acquisition|shareholding|average\s+price|transacted', re.I)

# ---------- the one label dictionary: table kinds by caption ----------
KIND_RULES = [  # (kind, the caption must match, the caption must NOT match)
    ('range', re.compile(r'transacted', re.I), None),
    ('waca_1y', re.compile(r'(?:average\s+(?:cost|price)).*?(?:last\s+)?(?:one|1)\s+year', re.I | re.S),
     re.compile(r'eighteen|18\s+months|three\s+years|3\s+years|transacted', re.I)),
    ('waca_held', re.compile(r'average\s+cost\s+of\s+(?:acquisition|subscription)', re.I),
     re.compile(r'one\s+year|1\s+year|eighteen|18\s+months|three\s+years|transacted|build[\s-]*up', re.I)),
    ('hold', re.compile(r'shareholding', re.I),
     re.compile(r'build[\s-]*up|lock[\s-]*in|pledg|encumb|cost\s+of\s+acquisition|top\s+(?:ten|10)|pattern|'
                r'major\s+shareholders|prior\s+to|years?\s+prior', re.I)),
]
GROUP_HEAD = re.compile(r'^(?:[a-z]\)\s*|[A-Z]\.\s*)?(?:promoters?|promoter\s+group|selling\s+shareholders?|investor|'
                        r'other|public|total|sub[\s-]*total)\b', re.I)
NIL = re.compile(r'^(?:nil|na|n\.a\.?|not\s*applicable|negligible|-|–|—)$', re.I)
MARK = re.compile(r'[*#^$+@]+$')
PLACEHOLDER = re.compile(r'^\[?●\]?$')
RANGE1 = re.compile(r'^(?P<a>[\d,.]+|nil|na)\s*(?:-|–|—|to)\s*(?P<b>[\d,.]+|nil|na)$', re.I)
CORP = re.compile(r'\b(?:private|pvt|limited|ltd|pte|llp|inc|plc|the)\b\.?', re.I)
FOOTER = re.compile(r'^(?:page\s*\|?\s*)?\d{1,4}(?:\s*\|\s*page)?$', re.I)
RUPEE = re.compile(r'₹|\brs\.?\b|\binr\b|rupees', re.I)
PER_SHARE = re.compile(r'\bper\b.{0,60}?\b(?:shares?|specified\s+securit)', re.I | re.S)
ONE_YEAR = re.compile(r'\b(?:one|1)\s+year\b', re.I)
NO_PROMOTER = re.compile(r'no\s+identifiable\s+promoters?|does\s+not\s+have\s+(?:any\s+)?(?:an\s+)?identifiable\s+promoter',
                         re.I)
WACA_COL = re.compile(r'cost|price', re.I)
NOT_WACA_COL = re.compile(r'number|(?:^|\s)no\.|%|percentage', re.I)
COVER = re.compile(r'(?:THE\s+)?PROMOTERS?\s+OF\s+(?:OUR|THE)\s+COMPANY\s*(?:ARE|IS|:)?\s*:?\s*(?P<n>.+)$|'
                   r'^OUR\s+PROMOTERS?\s*:\s*(?P<m>.+)$')
COVER_PAGES = 4
NO_PROMOTER_SCAN = 40


# ---------- names ----------
def compact(name):
    s = re.sub(r'\([^)]*\)?', ' ', name)        # parentheticals, also an unclosed one ("(also the Promoter Selling")
    s = re.sub(r'^\s*(?:\d{1,2}[.)]|[a-z]\)|[ivx]+[.)])\s*', '', s, flags=re.I)
    s = MARK.sub('', s.strip())
    return re.sub(r'[^a-z]', '', s.lower())


def compact_core(name):
    return compact(CORP.sub(' ', name))


def match_promoter(label, declared):
    """-> the declared promoter this row label names, or None (fail closed: one near-complete name only)."""
    lab, lab_core = compact(label), compact_core(label)
    if len(lab_core) < 5:
        return None
    hits = []
    for d in declared:
        dc, dcore = compact(d), compact_core(d)
        if lab == dc or lab_core == dcore:
            hits.append(d)
        elif dcore.startswith(lab_core) and len(lab_core) >= 0.8 * len(dcore):
            hits.append(d)     # a wrapped / cut row label: "Starfish (also the ..." -> Starfish I Pte. Ltd.
    hits = list(dict.fromkeys(hits))
    return hits[0] if len(hits) == 1 else None


def _title(n):
    return ' '.join(w if len(w) <= 1 else w[0] + w[1:].lower() for w in n.split())


def _cover_names(text):
    lines = [ln.strip() for ln in (text or '').split('\n')]
    for i, ln in enumerate(lines):
        m = COVER.search(ln)
        if not m:
            continue
        s = (m.group('n') or m.group('m') or '').strip()
        nxt = lines[i + 1] if i + 1 < len(lines) else ''
        continues = bool(re.search(r'(?:,|\bAND)\s*$', s))    # the list itself says it goes on
        if s and not s.endswith(('.', ')')) and nxt and nxt == nxt.upper() and ':' not in nxt \
                and (continues or len(nxt) < 60) \
                and not re.match(r'(?:DETAILS|CONTACT|COMPANY|REGISTERED|CORPORATE|OUR|THE)\b', nxt):
            s = s + ' ' + nxt                       # the list wraps onto the next capitalised line
        parts = re.split(r'\s*,\s*|\s+AND\s+|\s*&\s*', s)
        out = []
        for p in (p.strip(' .') for p in parts):
            if not p:
                continue
            mm = re.search(re.escape(p) + r'\.?', s)   # keep a "PTE. LTD." final dot
            out.append(_title((mm.group(0) if mm else p).strip()))
        return out
    return None


def declared_promoters(page_texts):
    """(names, source, page) from the cover statement "OUR PROMOTERS: A, B AND C".

    Every printed copy on the first pages must agree (a wrapped copy that is a prefix of the full one
    is the same copy); otherwise (None, reason, page)."""
    by = dict(page_texts)
    copies = [(i, c) for i, c in ((i, _cover_names(by.get(i, ''))) for i in range(COVER_PAGES)) if c]
    if not copies:
        head = ' '.join(by.get(i, '') or '' for i in range(NO_PROMOTER_SCAN))
        return None, ('no_identifiable_promoter' if NO_PROMOTER.search(head) else 'no_cover_declaration'), None
    keys = [tuple(compact(n) for n in c) for _i, c in copies]
    if len(set(keys)) == 1:
        return copies[0][1], 'cover', copies[0][0]
    page, best = max(copies, key=lambda ic: sum(len(x) for x in ic[1]))
    bk = tuple(compact(n) for n in best)
    if all(len(k) == len(bk) and all(b.startswith(x) for b, x in zip(bk, k)) for k in keys):
        return best, 'cover_wrapped_copy', page
    return None, 'cover_copies_disagree', copies[0][0]


# ---------- sections ----------
def sections(page_texts):
    by = dict(page_texts)
    loc = sl.locate(page_texts)
    off = loc['offset']
    entries = [e for n in loc['toc_pages'] for e in sl.toc_entries(by.get(n, ''))]
    starts = sorted({p for _, p in entries})
    out = {}
    for title_, printed in entries:
        for key, rx in SECTION_TITLES.items():
            if rx.match(title_) and off is not None and key not in out:
                nxt = [p for p in starts if p > printed]
                idx, end = printed + off, (nxt[0] + off if nxt else printed + off + 1)
                top = ' '.join((by.get(idx, '') or '').split('\n')[:10]).lower()
                words = [w for w in re.findall(r'[a-z]+', sl.norm_title(title_)) if len(w) > 3]
                out[key] = dict(idx=idx, end=end, verified=bool(words) and all(w[:7] in top for w in words))
    return out


def planned_pages(page_texts):
    """[(section, pdf page)] the reader requests word boxes for."""
    by = dict(page_texts)
    want = []
    for key, s in sorted(sections(page_texts).items(), key=lambda kv: kv[0] != 'sod'):
        if not s['verified']:
            continue
        for i in range(s['idx'], s['end']):
            t = by.get(i, '') or ''
            if PAGE_KEYS.search(t) and PAGE_KEYS2.search(t):
                want.append((key, i))
    return want


# ---------- rows from word positions ----------
def tail_cells(ws):
    """the value cells at the right end of a word line: numbers, Nil/NA, [placeholder], ranges."""
    toks = [w['text'] for w in ws]
    i = len(toks)
    cells = []
    while i > 0:
        t = MARK.sub('', toks[i - 1])
        t2 = MARK.sub('', ' '.join(toks[i - 2:i])) if i >= 2 else ''
        if t2.lower() == 'not applicable':
            cells.insert(0, 'NIL'); i -= 2; continue
        if PLACEHOLDER.match(t):
            cells.insert(0, '[●]'); i -= 1; continue
        if NIL.match(t) or RANGE1.match(t) or (sg.is_numeric_word(t) and not sg.DATE_TOKEN.match(t)) or t.lower() == 'to':
            cells.insert(0, t); i -= 1; continue
        break
    out, j = [], 0
    while j < len(cells):                      # "a - b" / "a to b" is one range cell
        if j + 2 < len(cells) and cells[j + 1] in ('-', '–', '—', 'to') and cells[j] != '[●]':
            out.append(cells[j] + '-' + cells[j + 2]); j += 3
        else:
            out.append(cells[j]); j += 1
    return ws[:i], out


def num(cell):
    """(value, state): state ok / nil / placeholder / missing / bad. A nil is the string 'NIL', never 0."""
    if cell is None:
        return None, 'missing'
    if cell == 'NIL' or NIL.match(cell):
        return 'NIL', 'nil'
    if cell == '[●]':
        return None, 'placeholder'
    v, st = sg.parse_cell(cell)
    return (v, 'ok') if st == 'ok' else (None, 'bad')


def page_lines(page_words):
    words = (page_words or {}).get('words') or []
    out = []
    for ln in sg.lines_of(words) if words else []:
        ws = sg.merge_numeric(ln['w'])
        text = ' '.join(w['text'] for w in ws)
        if sl.PAGE_NO.fullmatch(text.strip()) or FOOTER.match(text.strip()):
            continue
        lab_ws, cells = tail_cells(ws)
        label = ' '.join(w['text'] for w in lab_ws)
        out.append(dict(text=text, label=label, cells=cells if label else [], words=ws,
                        cx1=([w['x1'] for w in ws[len(lab_ws):]] if len(ws) - len(lab_ws) == len(cells) else None),
                        lab_x1=(lab_ws[-1]['x1'] if lab_ws else 0.0), data=bool(cells) and bool(label)))
    return out


def kind_of(ctx):
    for kind, must, mustnot in KIND_RULES:
        if must.search(ctx) and not (mustnot and mustnot.search(ctx)):
            return kind
    return None


def segments(lines_by_page):
    """caption text + the data rows under it -> tables. Prose after the rows ends a table. At a page
    break the new page's leading text decides: a repeated header (no caption in it) continues the open
    table; a caption starts a new one."""
    segs, ctx, cur, ctxw = [], [], None, []
    for pg, lines in lines_by_page:
        lead, leadw, in_lead = [], [], cur is not None
        for ln in lines:
            if in_lead and not ln['data']:
                lead.append(ln['text'].strip()); leadw.append(ln['words'])
                continue
            if in_lead:
                in_lead = False
                if not (kind_of(' '.join(lead)) is None and len(lead) <= 12):
                    cur, ctx, ctxw = None, lead[-16:], leadw[-16:]
            if ln['data']:
                if cur is None:
                    cur = dict(ctx=' '.join(ctx), rows=[], page=pg, hdr=[list(l) for l in ctxw[-8:]])
                    segs.append(cur)
                cur['rows'].append(dict(label=ln['label'], ext=ln['label'], cells=ln['cells'], page=pg,
                                        cx1=ln['cx1'], lab_x1=ln['lab_x1']))
                continue
            t = ln['text'].strip()
            footnote = bool(re.match(r'^(?:[*#^$+@]|\(\d+\)|\d\s|notes?:)', t, re.I))
            if cur is not None and not footnote and len(t) < 70:
                if GROUP_HEAD.match(t):
                    cur['rows'].append(dict(label=t, ext=t, cells=[], page=pg, head=True))
                elif cur['rows'] and not cur['rows'][-1].get('head'):
                    cur['rows'][-1]['ext'] += ' ' + t          # a wrapped row label
                continue
            if cur is not None:
                cur, ctx, ctxw = None, [], []
            ctx = (ctx + [t])[-16:]; ctxw = (ctxw + [ln['words']])[-16:]
        if in_lead:                                        # a page with no data rows ends the open table
            cur, ctx, ctxw = None, lead[-16:], leadw[-16:]
    for s in segs:
        s['kind'] = kind_of(s['ctx'])
    return segs


def column_header(seg, idx):
    """the header words standing over value column `idx` (negative index into the row cells)."""
    los, his = [], []
    for r in seg['rows']:
        cx = r.get('cx1')
        if not r['cells'] or not cx or len(cx) < -idx:
            continue
        k = len(cx) + idx
        los.append(cx[k - 1] if k >= 1 else r['lab_x1'])
        his.append(cx[k] if idx != -1 else 1e9)
    if not los:
        return ''
    lo, hi = max(los), (min(his) + 25 if idx != -1 else 1e9)
    lines = seg.get('hdr', [])
    width = max((w['x1'] for l in lines for w in l), default=1.0)
    out = []
    for l in lines:                 # header cells = word chunks split by wide gaps; prose spans the page
        chunks, cur = [], []
        for w in sorted(l, key=lambda w: w['x0']):
            if cur and w['x0'] - cur[-1]['x1'] > 6:
                chunks.append(cur); cur = []
            cur.append(w)
        if cur:
            chunks.append(cur)
        for c in chunks:
            x0, x1 = c[0]['x0'], c[-1]['x1']
            if lo + 1 < (x0 + x1) / 2 <= hi and (x1 - x0) < 0.45 * width:
                out.append(' '.join(w['text'] for w in c))
    return ' '.join(out)


# ---------- copies ----------
def matched_rows(seg, declared):
    out = []
    for i, r in enumerate(seg['rows']):
        if r.get('head') or not r['cells']:
            continue
        who = match_promoter(r['ext'], declared) or match_promoter(r['label'], declared)
        if who:
            out.append((i, who, r))
    return out


def cost_table_refusal(seg):
    """None when the cost table's columns read as (shares, rupees per share), else the reason."""
    hdr, hsh = column_header(seg, -1), column_header(seg, -2)
    if not WACA_COL.search(hdr) or NOT_WACA_COL.search(hdr):
        return 'waca_column_unresolved'
    if not re.search(r'shares', hsh, re.I) or WACA_COL.search(hsh):
        return 'shares_column_unresolved'
    if not RUPEE.search(seg['ctx']):
        return 'unit_unresolved'
    return None


def holding_identity(rows, matched, log, page):
    """The promoter rows of a holding table add up to the first Total row after them (shares and %),
    with no other data row in between -> {pct, shares, page}; else None."""
    first, last = matched[0][0], matched[-1][0]
    names = {i for i, _, _ in matched}
    for j in range(first, len(rows)):
        r = rows[j]
        if j in names or r.get('head') and not re.match(r'(?i)^total', r['label']):
            continue
        if re.match(r'(?i)^(?:sub[\s-]*)?total\b', r['label']) and r['cells']:
            if j < last:
                return None
            tot_sh, s1 = num(r['cells'][0])
            tot_pc, s2 = num(r['cells'][1]) if len(r['cells']) > 1 else (None, 'missing')
            if s1 != 'ok' or s2 != 'ok':
                log.append('p%s hold: total row unparsable %s' % (page, r['cells']))
                return None
            shs, pcs = [], []
            for _i, who, rr in matched:
                a, sa = num(rr['cells'][0])
                b, sb = num(rr['cells'][1]) if len(rr['cells']) > 1 else (None, 'missing')
                if sa != 'ok':
                    log.append('p%s hold: %s shares unparsable' % (page, who))
                    return None
                shs.append(a); pcs.append(b if sb == 'ok' else 0.0)
            ok_sh = abs(sum(shs) - tot_sh) < 0.5
            ok_pc = abs(sum(pcs) - tot_pc) <= 0.011 * max(1, len(pcs)) and tot_pc <= 100
            if ok_sh and ok_pc:
                return dict(pct=tot_pc, shares=tot_sh, page=r['page'], who=sorted({w for _, w, _ in matched}))
            log.append('p%s hold: identity fails sum_sh=%s tot=%s sum_pc=%s tot=%s'
                       % (page, sum(shs), tot_sh, round(sum(pcs), 2), tot_pc))
            return None
        if r['cells']:
            log.append("p%s hold: non-promoter row '%s' before the total" % (page, r['label'][:30]))
            return None
    return None


def collect(segs, declared):
    copies = {'shares': {}, 'waca': {}, 'waca_1y': {}}
    holding, log = [], []
    for s in segs:
        k = s['kind']
        if k in (None, 'range'):
            continue          # rows 161-165 are offer_doc_tables.read_acquisition_ranges' (OD-174 there)
        matched = matched_rows(s, declared)
        if not matched:
            continue
        if k in ('waca_held', 'waca_1y'):
            why = cost_table_refusal(s)
            if why:
                log.append('p%s %s: refused %s' % (s['page'], k, why))
                for _i, who, _r in matched:
                    copies[k if k == 'waca_1y' else 'waca'].setdefault(who, []).append(
                        dict(v=None, page=s['page'], why=why))
                continue
            for _i, who, r in matched:
                if len(r['cells']) < 2:
                    log.append('p%s %s %s: refused cells<2 %s' % (r['page'], k, who, r['cells']))
                    continue
                sh, st1 = num(r['cells'][-2])
                wa, st2 = num(r['cells'][-1])
                if 'bad' in (st1, st2) or 'placeholder' in (st1, st2):
                    log.append('p%s %s %s: refused unparsable %s' % (r['page'], k, who, r['cells']))
                    continue
                if k == 'waca_held':
                    copies['shares'].setdefault(who, []).append(dict(v=sh, page=r['page'], src='waca_held'))
                    copies['waca'].setdefault(who, []).append(dict(v=wa, page=r['page'], shares=sh))
                else:
                    copies['waca_1y'].setdefault(who, []).append(
                        dict(v=wa, page=r['page'], acquired=sh, ctx=s['ctx'], hdr=column_header(s, -1)))
        elif k == 'hold':
            hp = holding_identity(s['rows'], matched, log, s['page'])
            if hp is not None:
                holding.append(hp)
            for _i, who, r in matched:
                sh, st = num(r['cells'][0])
                if st == 'ok':   # an unproven column only ever CONFIRMS another copy; never vetoes or stands alone
                    copies['shares'].setdefault(who, []).append(
                        dict(v=sh, page=r['page'], src='hold' if hp else 'hold_unproven'))
    return copies, holding, log


def _same(a, b):
    return a == b or (isinstance(a, float) and isinstance(b, float) and abs(a - b) < 1e-9)


def decide(cands, confirm=None):
    """(value, reason): >= 2 printed copies on distinct pages agree and none disagree, or one copy that
    `confirm` accepts; else (None, reason)."""
    proven = [c for c in cands if c.get('src') != 'hold_unproven']
    if not proven:
        return None, 'not_in_capital_structure_tables'
    base = [c['v'] for c in proven if c['v'] is not None]
    extra = [c for c in cands if c.get('src') == 'hold_unproven' and base and _same(c['v'], base[0])]
    cands = proven + extra
    vals = [c['v'] for c in cands if c['v'] is not None]
    if not vals:
        return None, next((c['why'] for c in cands if c.get('why')), 'not_in_capital_structure_tables')
    if any(not _same(v, vals[0]) for v in vals):
        return None, 'copies_disagree: %s' % vals
    pages = {c['page'] for c in cands if c['v'] is not None}
    if len(pages) >= 2:
        return vals[0], 'printed_copies_agree'
    if confirm is not None:
        ok, why = confirm([c for c in cands if c['v'] is not None])
        if ok:
            return vals[0], why
        return None, why
    return None, 'single_copy_unconfirmed'


def one_year_checks(copy, who, held):
    """OD-175: a single printed one-year cost is saved only when (1) its heading states a one-year
    period, (2) the unit is rupees per share, (3) the row names a declared promoter (the caller matched
    it), (4) the shares acquired in that year do not exceed the shares held now. -> (ok, reason)."""
    if not ONE_YEAR.search(copy.get('ctx') or ''):
        return False, 'one_year_heading_not_printed'
    if not (RUPEE.search(copy.get('ctx') or '') and PER_SHARE.search(copy.get('ctx') or '')):
        return False, 'unit_not_rupees_per_share'
    if not who:
        return False, 'row_not_a_declared_promoter'
    acq = copy.get('acquired')
    if held is None:
        return False, 'shares_held_not_validated'
    if acq == 'NIL':
        acq = 0.0
    if not isinstance(acq, float) or acq > held:
        return False, 'shares_acquired_exceed_shares_held: %s > %s' % (acq, held)
    return True, 'od175_one_year_single_copy'


def _nil_to_null(value, why):
    if value == 'NIL':
        return None, 'bonus_nil'
    return value, why


def read_promoter_tables(page_texts, grid_words_for_page, declared):
    """The promoters' holdings and costs.

    -> {"rows": [{name, is_promoter_group, shares_held, waca, waca_last_year, reasons}],
        "holding": {pct, shares, page} | None, "holding_why", "pages", "log"}"""
    out = dict(rows=[], holding=None, holding_why=None, pages=[], log=[])
    if not declared:
        out['holding_why'] = 'no_declared_promoter'
        return out
    want = planned_pages(page_texts)
    out['pages'] = [i for _k, i in want]
    if not want:
        out['holding_why'] = 'capital_structure_section_not_located'
        for n in declared:
            out['rows'].append(dict(name=n, is_promoter_group=False, shares_held=None, waca=None, waca_last_year=None,
                                    reasons=dict.fromkeys(('shares_held', 'waca', 'waca_last_year'),
                                                          'capital_structure_section_not_located')))
        return out
    words = {}
    for _k, i in want:
        words[i] = grid_words_for_page(i) if grid_words_for_page else None
    segs = []
    for key in ('sod', 'capstr'):
        idxs = [i for k, i in want if k == key]
        run = []
        for i in idxs:                        # a table never continues across a skipped page
            if run and i != run[-1] + 1:
                segs += segments([(j, page_lines(words[j])) for j in run]); run = []
            run.append(i)
        if run:
            segs += segments([(j, page_lines(words[j])) for j in run])
    copies, holding, log = collect(segs, declared)
    out['log'] = log
    held = {}
    for who in declared:
        def conf_sh(c):
            return (any(x.get('src') == 'hold' for x in c) and bool(holding)), 'holding_table_total_identity'
        v, why = decide(copies['shares'].get(who, []), conf_sh)
        if isinstance(v, float):
            held[who] = (v, why)
        elif v is not None:
            held[who] = (None, 'shares_held_not_a_number')
        else:
            held[who] = (None, why)
    for who in declared:
        sh = held[who][0]

        def conf_w(c, sh=sh):  # one copy whose own shares cell equals the validated holding
            ok = sh is not None and all(x.get('shares') is not None and _same(x['shares'], sh) for x in c)
            return ok, ('own_shares_cell_equals_validated_holding' if ok else 'single_copy_shares_cell_unvalidated')
        wv, wwhy = _nil_to_null(*decide(copies['waca'].get(who, []), conf_w))

        def conf_1(c, who=who, sh=sh):
            if len(c) != 1:
                return False, 'single_copy_expected'
            return one_year_checks(c[0], who, sh)
        yv, ywhy = _nil_to_null(*decide(copies['waca_1y'].get(who, []), conf_1))
        out['rows'].append(dict(name=who, is_promoter_group=False, shares_held=sh, waca=wv, waca_last_year=yv,
                                reasons=dict(shares_held=held[who][1], waca=wwhy, waca_last_year=ywhy)))
    pcts = {h['pct'] for h in holding}
    if len(pcts) == 1:
        out['holding'] = holding[0]
        out['holding_why'] = 'promoter_rows_sum_to_total_row'
    elif len(pcts) > 1:
        out['holding_why'] = 'copies_disagree: %s' % sorted(pcts)
    else:
        out['holding_why'] = 'no_promoter_total_row_with_identity'
    return out
