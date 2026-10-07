"""Offer-document tables -> grids (rows x columns) from PDF word positions (OD-173 rebuild steps 2 and 3b).

Input is never a PDF object: a page is {'width': float, 'words': [{text, x0, x1, top, bottom}]} as returned by
grid_words(pdfplumber_page) (x_tolerance=1.5, y_tolerance=2), so the same code runs on a live PDF and on a cache.
Ported from the proven spike (claude-doc/rebuild/grid_spike.py) without behaviour change.

Statements (read_statement_grids), one generic method for every document:
  1. statement pages: first page in the located restated section whose top lines name the statement
     (assets and liabilities / balance sheet, profit and loss, cash flows), plus continuation pages
     until a signature block or the next statement heading.
  2. columns: clusters of the right edges of numeric cells across the data rows (never header text).
  3. header: words between the title and the first data row, assigned to columns by x-position;
     each column must resolve to exactly one period end, else the grid is REFUSED with a reason.
  4. rows: label = words left of the first column; cells = one parsed value per column.
  5. unit: the statement's own "in million / lakhs / crore" line.
Other mandated sections (read_section_grids): every keyword page of a located section is split into tables
(segments); each table resolves its period columns (or period-per-row orientation) or is refused with a reason.
"""
import re

WORD_KEYS = ('text', 'x0', 'x1', 'top', 'bottom')


def grid_words(page):
    """The one word extraction the grids are built from (a pdfplumber page -> plain dict)."""
    words = page.extract_words(x_tolerance=1.5, y_tolerance=2, keep_blank_chars=False)
    return {'width': float(page.width), 'words': [{k: w[k] for k in WORD_KEYS} for w in words]}

# ---------- statement headings ----------
PREFIX = r'^(?:\d{1,2}\s+)?(?:annexure\s*[-–:：]?\s*[ivx\d]*\s*[a-z]?\s*\d*\s*[-–:：]?\s*)?'
KIND = [
    ('bs', r'(?:statements?\s+of\s+(?:restated\s+)?(?:consolidated\s+)?assets\s*(?:and|&)\s*liabilit\w*|balance\s+sheet)'),
    ('pl', r'(?:statements?\s+of\s+(?:restated\s+)?(?:consolidated\s+)?profits?\s*(?:and|&)\s*loss(?:es)?'
           r'|profit\s+and\s+loss\s+(?:account|statement))'),
    ('cf', r'(?:statements?\s+of\s+(?:restated\s+)?(?:consolidated\s+)?cash\s*flows?|cash\s*flow\s+statements?)'),
]
QUAL = r'(?:restated\s+)?(?:(?:consolidated|standalone|combined)\s+)?(?:summary\s+)?'
HEADINGS = [(k, re.compile(PREFIX + QUAL + p + r'\b(?P<tail>.*)$', re.I)) for k, p in KIND]
PROSE = re.compile(r'\b(?:recogni[sz]\w*|comprises?|included|charged|are|is|when|refer|reported|examined|'
                   r'forming\s+part|notes?\s+to)\b', re.I)
SIGNATURE = re.compile(r'as\s+per\s+our\s+(?:examination\s+)?report|for\s+and\s+on\s+behalf\s+of|'
                       r'firm\s+registration\s+(?:no|number)|membership\s+(?:no|number)', re.I)


def heading_kind(line):
    s = line.strip()
    if len(s) > 160 or not s or s[0].islower():
        return None
    for kind, rx in HEADINGS:
        m = rx.match(s)
        if m and not PROSE.search(m.group('tail')):
            return kind
    return None


def page_heading(text, nlines=8):
    for ln in (text or '').split('\n')[:nlines]:
        k = heading_kind(ln)
        if k:
            return k, ln.strip()
    return None, None


# ---------- numbers ----------
NUM_TOKEN = re.compile(r'^[(\[]?[-–—]?[\d,.]*\d[\d,.]*[)\]]?$')
DASH = re.compile(r'^(?:[-–—]+|nil|none)$', re.I)
VALID = re.compile(r'^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3}|\d+)(?:\.\d+)?$|^\.\d+$')


DATE_TOKEN = re.compile(r'^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$')


def is_numeric_word(t):
    if DATE_TOKEN.match(t):
        return False
    return bool(NUM_TOKEN.match(t)) or bool(DASH.match(t))


def parse_cell(raw):
    """-> (value or None, status). status: ok / empty / bad."""
    s = raw.replace(' ', '')
    if not s:
        return None, 'empty'
    if DASH.match(s):
        return None, 'empty'
    neg = False
    if s[0] in '([' and s[-1] in ')]':
        neg, s = True, s[1:-1]
    if s[:1] in '-–—':
        neg, s = True, s[1:]
    if not VALID.match(s):
        return None, 'bad'
    v = float(s.replace(',', ''))
    return (-v if neg else v), 'ok'


# ---------- periods ----------
MONTHS = {m: i + 1 for i, m in enumerate(
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}
MON = r'(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
YEAR = r'((?:19|20)\d{2})'
P_MDY = re.compile(MON + r'\.?\s*(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*' + YEAR, re.I)
P_DMY = re.compile(r'(\d{1,2})(?:st|nd|rd|th)?\s*[-.\s]?\s*' + MON + r'\.?\s*,?\s*[-\s]?' + YEAR, re.I)
P_NUM = re.compile(r'\b(\d{1,2})[./-](\d{1,2})[./-]' + YEAR + r'\b')
P_MON_YY = re.compile(r'\b' + MON + r"[-'’\s]\s*(\d{2})\b", re.I)
P_FISCAL = re.compile(r'\b(?:fiscal|financial\s+year|fy)\s*[-\s]?\s*((?:20)?\d{2})\b', re.I)
# A part of a fiscal year printed in front of its FY / Fiscal token: 'Q1 FY26', "Q1'FY26", 'H1 FY 2024', '9M FY24',
# 'Nine months ended Fiscal 2024', 'six months Fiscal 2025', 'Q4 Fiscal 2026' (real headers in the 24 documents).
# Such a column is a STUB of that fiscal year, never the fiscal year itself.
P_FY_PART = re.compile(r"(?:\b(?P<q>q[1-4])|\b(?P<h>h[12])|\b(?P<m>[369])\s*m(?:onths?)?|"
                       r"\b(?P<w>three|six|nine)\s+months?(?:\s+(?:period\s+)?ended)?|"
                       r"\b(?P<u>quarter|half[\s-]+year|ytd|year[\s-]+to[\s-]+date)(?:\s+ended)?)"
                       r"\s*(?:of\s+)?[-'’]?\s*$", re.I)
# end month of the part, relative to the fiscal year that ends March 31 of year Y: (month, years before Y)
FY_PART_END = {'q1': (6, 1), 'q2': (9, 1), 'q3': (12, 1), 'q4': (3, 0), 'h1': (9, 1), 'h2': (3, 0),
               '3': (6, 1), '6': (9, 1), '9': (12, 1), 'three': (6, 1), 'six': (9, 1), 'nine': (12, 1)}


def fiscal_period(text, m):
    """(year, month, day, kind) of a P_FISCAL match: the full fiscal year, or the stub a Q/H/nM/'n months' prefix makes
    of it. A part whose end month the prefix does not say ('quarter', 'half year', YTD) is a stub with month 0."""
    y = int(m.group(1))
    y = y if y > 100 else 2000 + y
    part = P_FY_PART.search(text[max(0, m.start() - 40):m.start()])
    if not part:
        return y, 3, 31, 'fy'
    key = (part.group('q') or part.group('h') or part.group('m') or part.group('w') or '').lower()
    if key not in FY_PART_END:
        return y, 0, None, 'stub'
    mo, back = FY_PART_END[key]
    return y - back, mo, None, 'stub'


def periods_in(text):
    """Every period end printed in a header text, as (year, month, day|None, kind). kind fy|stub."""
    found, spans = [], []

    def add(m, y, mo, d, kind=None):
        if any(a < m.end() and m.start() < b for a, b in spans):
            return
        spans.append((m.start(), m.end()))
        found.append((m.start(), (y, mo, d, kind or ('fy' if mo == 3 else 'stub'))))

    for m in P_MDY.finditer(text):
        add(m, int(m.group(3)), MONTHS[m.group(1)[:3].lower()], int(m.group(2)))
    for m in P_DMY.finditer(text):
        add(m, int(m.group(3)), MONTHS[m.group(2)[:3].lower()], int(m.group(1)))
    for m in P_NUM.finditer(text):
        mo = int(m.group(2))
        if 1 <= mo <= 12:
            add(m, int(m.group(3)), mo, int(m.group(1)))
    for m in P_MON_YY.finditer(text):
        add(m, 2000 + int(m.group(2)), MONTHS[m.group(1)[:3].lower()], None)
    for m in P_FISCAL.finditer(text):
        add(m, *fiscal_period(text, m))
    return [p for _, p in sorted(found)]


UNIT =re.compile(r'(?:in|amounts?|amount|rs\.?|₹|inr|`)\s*[^\n]{0,25}?\b(millions?|mn|lakhs?|lacs?|crores?|cr)\b', re.I)


AMOUNT = re.compile(r'\d[\d,]*\.\d+|\b\d{1,3}(?:,\d{2,3})+\b')


def is_unit_declaration(text):
    """'(Rs in million)', '(₹ in lakhs, except per share data)' - a unit line that states no amount itself."""
    return bool(UNIT.search(text)) and not AMOUNT.search(text)


def unit_of(lines_text):
    for t in lines_text:
        m = UNIT.search(t)
        if m:
            u = m.group(1).lower()
            return 'million' if u.startswith('m') else 'lakh' if u.startswith('la') else 'crore'
    return None


# ---------- geometry ----------
def lines_of(words, tol=3.0):
    rows = []
    for w in sorted(words, key=lambda w: ((w['top'] + w['bottom']) / 2, w['x0'])):
        c = (w['top'] + w['bottom']) / 2
        if rows and abs(rows[-1]['c'] - c) <= tol:
            rows[-1]['w'].append(w)
            rows[-1]['c'] = sum((x['top'] + x['bottom']) / 2 for x in rows[-1]['w']) / len(rows[-1]['w'])
        else:
            rows.append({'c': c, 'w': [w]})
    for r in rows:
        r['w'].sort(key=lambda w: w['x0'])
        r['text'] = ' '.join(w['text'] for w in r['w'])
    return rows


def merge_numeric(ws, gap=4.5):
    """Join numeric fragments printed with a tiny gap ('2 ,954.19', '7 84.10') into one token."""
    out = []
    for w in ws:
        if out and is_numeric_word(w['text']) and is_numeric_word(out[-1]['text']) \
                and w['x0'] - out[-1]['x1'] < gap and not DASH.match(w['text']) and not DASH.match(out[-1]['text']):
            p = out[-1]
            out[-1] = dict(p, text=p['text'] + w['text'], x1=w['x1'])
        else:
            out.append(dict(w))
    return out


def numeric_tail(ws):
    """Numeric tokens at the right of a line (the value cells), left-to-right."""
    tail = []
    for w in reversed(ws):
        if is_numeric_word(w['text']):
            tail.append(w)
        else:
            break
    return list(reversed(tail))


def cluster(xs, tol):
    xs = sorted(xs)
    groups = []
    for x in xs:
        if groups and x - groups[-1][-1] <= tol:
            groups[-1].append(x)
        else:
            groups.append([x])
    return groups


NOTE_HDR = re.compile(r'^(?:notes?|note\s*no\.?|sch(?:edule)?\.?|annexure)$', re.I)


def build_grid(words, page_width, title_kind, inherit=None):
    """-> dict(grid) or dict(refused=reason). inherit = previous page's grid columns+periods (continuation)."""
    if not words:
        return {'refused': 'no extractable words (image page)'}
    if sum('(cid:' in w['text'] for w in words) > 0.2 * len(words):
        return {'refused': 'text layer is unmapped glyphs (cid), unreadable without OCR'}
    lines = lines_of(words)
    for ln in lines:
        ln['m'] = merge_numeric(ln['w'])
        ln['nums'] = numeric_tail(ln['m'])
    # title line index
    t_idx = -1
    for i, ln in enumerate(lines[:10]):
        if heading_kind(ln['text']) == title_kind:
            t_idx = i
            break
    # candidate data rows: >= 2 numeric tail tokens with at least one decimal/comma value
    data = [i for i, ln in enumerate(lines) if i > t_idx and len(ln['nums']) >= 2
            and sum(parse_cell(w['text'])[1] == 'ok' and bool(re.search(r'\d[.,]\d', w['text'])) for w in ln['nums']) >= 1]
    if len(data) < 3:
        return {'refused': 'fewer than 3 numeric data rows'}
    # columns from right edges of the value tokens
    rights = [w['x1'] for i in data for w in lines[i]['nums']]
    groups = [g for g in cluster(rights, 10) if len(g) >= max(3, 0.25 * len(data))]
    cols = []
    for g in groups:
        x1 = sum(g) / len(g)
        members = [w for i in data for w in lines[i]['nums'] if abs(w['x1'] - x1) <= 10]
        cols.append({'x1': x1, 'x0': min(w['x0'] for w in members), 'n': len(members),
                     'values': [w['text'] for w in members]})
    if len(cols) < 2:
        return {'refused': 'fewer than 2 value columns found'}
    # cell boundaries: midpoints between neighbouring columns
    bounds = []
    for k, c in enumerate(cols):
        left = (cols[k - 1]['x1'] + c['x0']) / 2 if k else c['x0'] - 0.6 * (c['x1'] - c['x0']) - 6
        right = (c['x1'] + cols[k + 1]['x0']) / 2 if k + 1 < len(cols) else page_width
        bounds.append((left, right))
    first_data = data[0]
    text_left = min(w['x0'] for i in data for w in lines[i]['w'])
    header_lines = lines[t_idx + 1:first_data]
    # header phrases -> columns
    col_text = [[] for _ in cols]
    note_cols = set()
    for ln in header_lines:
        phrases = []
        for w in ln['w']:
            if phrases and w['x0'] - phrases[-1][-1]['x1'] < 3.5:
                phrases[-1].append(w)
            else:
                phrases.append([w])
        for ph in phrases:
            x0, x1 = ph[0]['x0'], ph[-1]['x1']
            touched = [k for k, (a, b) in enumerate(bounds) if min(x1, b) - max(x0, a) > 4]
            if x0 <= text_left + 15 and touched and x1 > bounds[0][0] + 0.5 * (bounds[0][1] - bounds[0][0]):
                continue  # prose line starting at the page's text margin and running across the columns
            if len(touched) >= 3:
                continue  # one phrase spanning 3+ columns is a subtitle, not a column header
            if not touched:
                continue
            ov = {k: min(x1, bounds[k][1]) - max(x0, bounds[k][0]) for k in touched}
            width = max(x1 - x0, 1)
            if len(touched) == 2 and min(ov.values()) > 0.3 * width:
                # a phrase really straddling two cells: split it word by word
                for w in ph:
                    cx = (w['x0'] + w['x1']) / 2
                    for k, (a, b) in enumerate(bounds):
                        if a <= cx < b:
                            col_text[k].append(w['text'])
            else:
                # headers are often offset from right-aligned values: the phrase goes to its main cell
                col_text[max(ov, key=ov.get)].extend(w['text'] for w in ph)
    for k, ts in enumerate(col_text):
        txt = ' '.join(ts)
        if ts and NOTE_HDR.match(ts[0]) and not periods_in(txt):
            note_cols.add(k)
    # a note column also shows as small integers without decimals in every row
    for k, c in enumerate(cols):
        if k not in note_cols and all(re.fullmatch(r'\d{1,2}[a-z]?', v, re.I) for v in c['values']):
            note_cols.add(k)
    keep = [k for k in range(len(cols)) if k not in note_cols]
    periods, reasons = [], []
    for k in keep:
        ps = periods_in(' '.join(col_text[k]))
        ps = list(dict.fromkeys(ps))
        if len(ps) != 1:
            reasons.append('column %d header %r -> %d periods' % (k, ' '.join(col_text[k])[:60], len(ps)))
        periods.append(ps[0] if len(ps) == 1 else None)
    inherited = False
    if reasons and inherit and not any(periods_in(' '.join(t)) for t in col_text):
        # continuation page without its own header: inherit only when the geometry matches column for column
        px = inherit['x1s']
        cx = [cols[k]['x1'] for k in keep]
        if len(px) == len(cx) and all(abs(a - b) <= 8 for a, b in zip(px, cx)):
            periods, reasons, inherited = list(inherit['periods']), [], True
        else:
            reasons.append('continuation page: column geometry differs from previous page (%s vs %s)'
                           % ([round(x) for x in cx], [round(x) for x in px]))
    if not reasons:
        ends = [(p[0], p[1], p[2]) for p in periods]
        if len(set(ends)) != len(ends):
            reasons.append('repeated period end %s' % ends)
        fys = [p[0] for p in periods if p[3] == 'fy']
        if len(set(fys)) != len(fys):
            reasons.append('repeated fiscal year %s' % fys)
    unit = unit_of([ln['text'] for ln in lines[:first_data + 1] if is_unit_declaration(ln['text'])] +
                   [' '.join(t) for t in col_text])
    # rows
    rows = []
    for i, ln in enumerate(lines):
        if i < first_data:
            continue
        label_edge = bounds[0][0]
        label = ' '.join(w['text'] for w in ln['m'] if (w['x0'] + w['x1']) / 2 < label_edge)
        cells = [None] * len(keep)
        raw = [''] * len(keep)
        for w in ln['nums']:
            cx = (w['x0'] + w['x1']) / 2
            for j, k in enumerate(keep):
                a, b = bounds[k]
                if a <= cx < b:
                    raw[j] += w['text']
        status = []
        for j in range(len(keep)):
            v, st = parse_cell(raw[j])
            cells[j] = v
            status.append(st)
        has_val = any(r for r in raw)
        if SIGNATURE.search(ln['text']):
            break
        if not label and not has_val:
            continue
        rows.append({'y': round(ln['c'], 1), 'label': label.strip(), 'cells': cells, 'raw': raw,
                     'bad': [j for j, s in enumerate(status) if s == 'bad']})
    # pair a value-only line with an adjacent label-only line (labels printed a line off the numbers)
    merged = []
    i = 0
    while i < len(rows):
        r = rows[i]
        has_val = any(r['raw'])
        if not r['label'] and has_val:
            nb = [x for x in (merged[-1] if merged else None, rows[i + 1] if i + 1 < len(rows) else None)
                  if x is not None and x['label'] and not any(x['raw']) and abs(x['y'] - r['y']) <= 12]
            if nb:
                tgt = min(nb, key=lambda x: abs(x['y'] - r['y']))
                tgt.update(cells=r['cells'], raw=r['raw'], bad=r['bad'])
                if tgt is not (merged[-1] if merged else None):
                    merged.append(tgt)
                    i += 2
                    continue
                i += 1
                continue
        merged.append(r)
        i += 1
    out = {'columns': [{'x0': round(cols[k]['x0'], 1), 'x1': round(cols[k]['x1'], 1),
                        'header': ' '.join(col_text[k]),
                        'period': None if periods[j] is None else
                        {'year': periods[j][0], 'month': periods[j][1], 'day': periods[j][2], 'kind': periods[j][3]}}
                       for j, k in enumerate(keep)],
           'dropped_note_columns': sorted(note_cols), 'unit': unit, 'header_inherited': inherited,
           'rows': [{'label': r['label'], 'cells': r['cells'], 'raw': r['raw'], 'bad_cells': r['bad']} for r in merged]}
    if reasons:
        out['refused'] = '; '.join(reasons)
    return out


def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())[:80]


def numeric_line_count(txt):
    return sum(1 for l in (txt or '').split('\n') if len(re.findall(r'\d[\d,]*[.,]\d+', l)) >= 2)


def statement_pages(page_texts, start, span=100):
    """Statement pages inside the section: -> {key: (title_kind, [pages])}.
    The set titled 'consolidated' is preferred when the section prints both standalone and consolidated sets.
    A page that repeats an already-used title right after a statement closed with its signature block is a new
    statement whose printed title is unreliable: it is kept as 'untitled-N' (classified by labels in step 3)."""
    n_end = min(len(page_texts), start + span)
    heads = []
    for i in range(start, n_end):
        kind, line = page_heading(page_texts[i][1])
        if kind and numeric_line_count(page_texts[i][1]) >= 3:
            qual = 'consolidated' if re.search(r'consolidated', line, re.I) else \
                'standalone' if re.search(r'standalone', line, re.I) else ''
            heads.append((i, kind, qual))
    if any(q == 'consolidated' for _, _, q in heads):
        heads = [h for h in heads if h[2] == 'consolidated']
    found, used, last_end, n_untitled = {}, set(), None, 0
    for i, kind, _ in heads:
        if i in used:
            continue
        key = kind
        if kind in {v[0] for v in found.values()}:
            if last_end is not None and i == last_end + 1 and SIGNATURE.search(page_texts[last_end][1] or ''):
                n_untitled += 1
                key = 'untitled-%d' % n_untitled
            else:
                continue
        pages = [i]
        j = i
        while j + 1 < n_end:
            if SIGNATURE.search(page_texts[j][1] or ''):
                break
            k2, _ = page_heading(page_texts[j + 1][1])
            if k2 and k2 != kind:
                break
            if numeric_line_count(page_texts[j + 1][1]) < 3:
                break
            pages.append(j + 1)
            j += 1
        found[key] = (kind, pages)
        used.update(pages)
        last_end = j
    return found


def _page_words(words_for, idx, unreadable):
    """-> (page dict, None) or (None, refusal reason). An OCR page has no word positions of its own."""
    if idx in unreadable:
        return None, 'OCR page: no PDF text layer, word positions unavailable'
    pw = words_for(idx)
    if not pw:
        return None, 'no word boxes for page %d' % idx
    return pw, None


def read_statement_grids(page_texts, start, words_for, unreadable=()):
    """Grids of the restated P&L / balance sheet / cash flow pages of the section starting at pdf index `start`.

    page_texts: dense [(idx, text)] in page order; words_for(idx) -> {'width', 'words'}; unreadable: OCR page set.
    -> {'section_start_idx', 'statements': {key: {pages, grids, title_kind} | {pages: [], refused}}}"""
    res = {'section_start_idx': start, 'statements': {}}
    sp = statement_pages(page_texts, start)
    for kind in ('bs', 'pl', 'cf'):
        if kind not in sp:
            res['statements'][kind] = {'pages': [], 'refused': 'no statement heading found in section'}
    for key, (kind, pages) in sp.items():
        st = {'pages': pages, 'grids': [], 'title_kind': kind}
        inherit = None
        for idx in pages:
            pw, why = _page_words(words_for, idx, unreadable)
            if why:
                st['grids'].append({'page': idx, 'refused': why})
                continue
            g = build_grid(pw['words'], pw['width'], kind, inherit)
            g['page'] = idx
            st['grids'].append(g)
            if 'refused' not in g:
                inherit = {'x1s': [c['x1'] for c in g['columns']],
                           'periods': [(c['period']['year'], c['period']['month'], c['period']['day'],
                                        c['period']['kind']) for c in g['columns']]}
        res['statements'][key] = st
    return res


# ---------- step 3b: tables inside the other mandated sections (many small tables per page) ----------
VAL3 = re.compile(r'^[(\[]?[-–—]?[\d,.]*\d[\d,.]*%?[)\]]?%?[*#^]*$')
NA3 = re.compile(r'^(?:n\.?a\.?|\[[●•]\]|[●•]|not|applicable|nil|-|–|—)$', re.I)
LABEL_PERIOD = re.compile(r'^(?:as\s+(?:at|on|of)\s+)?(?:' + MON + r'\.?\s*\d{1,2}(?:st|nd|rd|th)?\s*,?\s*' + YEAR +
                          r'|\d{1,2}(?:st|nd|rd|th)?\s*[-.\s]?\s*' + MON + r'\.?\s*,?\s*[-\s]?' + YEAR +
                          r'|(?:fiscal|financial\s+year|fy)\s*[-\s]?\s*(?:20)?\d{2})\b[*#^]*', re.I)
SPAN_MD = re.compile(MON + r'\.?\s*(\d{1,2})(?:st|nd|rd|th)?\s*,?(?!\s*(?:19|20)\d{2})', re.I)
SPAN_FY = re.compile(r'\b(?:fiscal|financial\s+year|fy)\b', re.I)
BARE_YEAR = re.compile(r'(?<![\d,.])((?:19|20)\d{2})(?![\d,.])')
BASIS = re.compile(r'\b(consolidated|standalone)\b', re.I)


def is_val3(t):
    return not DATE_TOKEN.match(t) and (bool(VAL3.match(t)) or bool(NA3.match(t)))


def parse3(raw):
    s = raw.replace(' ', '').rstrip('*#^')
    if not s or re.fullmatch(r'(?:n\.?a\.?|notapplicable|\[[●•]\]|[●•]|nil|[-–—])+', s, re.I):
        return None, 'empty'
    return parse_cell(s.replace('%', ''))


def split_label_period(ws):
    """'March 31, 2024 4.42 3' -> (words of the period label, the rest)."""
    text = ' '.join(w['text'] for w in ws)
    m = LABEL_PERIOD.match(text)
    if not m:
        return [], ws
    n, used = 0, 0
    for w in ws:
        if n >= m.end():
            break
        n += len(w['text']) + 1
        used += 1
    return ws[:used], ws[used:]


def max_gap(ws):
    return max([b['x0'] - a['x1'] for a, b in zip(ws, ws[1:])] or [0])


def section_lines(words, page_width):
    if not words:
        return None, 'no extractable words (image page)'
    if sum('(cid:' in w['text'] for w in words) > 0.2 * len(words):
        return None, 'text layer is unmapped glyphs (cid)'
    lines = lines_of(words)
    for ln in lines:
        ln['m'] = merge_numeric(ln['w'])
        lp, rest = split_label_period(ln['m'])
        ln['label_period'] = periods3(' '.join(w['text'] for w in lp)) if lp else []
        ln['label_year'] = None
        if not lp and len(rest) >= 2 and BARE_YEAR.fullmatch(rest[0]['text'].rstrip('*^#')):
            ln['label_year'], rest = int(rest[0]['text'].rstrip('*^#')), rest[1:]  # '2025 38.85 3' under 'Fiscal'
        tail = []
        for w in reversed(rest):
            if is_val3(w['text']):
                tail.append(w)
            else:
                break
        ln['nums'] = list(reversed(tail))
        # bare years ('2024 2023 2022', '... Fiscal 2022') are header words, never values
        # a day '31' or a weight '3' alone does not make a value line: a value carries , . % or 3+ digits
        ln['data'] = any(parse3(w['text'])[1] == 'ok' and not BARE_YEAR.fullmatch(w['text'].strip('*,'))
                         and re.search(r'[.,%]|\d{3}', w['text']) for w in ln['nums'])
        ln['hdr'] = not ln['data'] and bool(periods3(ln['text']) or BARE_YEAR.search(ln['text'])
                                           or re.search(r'\bparticulars\b', ln['text'], re.I))
        width = ln['w'][-1]['x1'] - ln['w'][0]['x0']
        ln['prose'] = not ln['data'] and width > 0.5 * page_width and max_gap(ln['w']) < 12 and \
            len(ln['text']) > 50 and len(periods3(ln['text'])) < 2  # 'year ended March 31, 2026 year ended ...' is a header
    return lines, None


def segments(lines):
    """Split a page's lines into tables: [(context_lines, header_lines, row_lines)]."""
    segs, ctx, hdr, rows = [], [], [], []

    def close():
        if rows:
            segs.append((list(ctx), list(hdr), list(rows)))
    for i, ln in enumerate(lines):
        if ln['prose']:
            close()
            ctx = ([] if rows else ctx) + [ln]
            ctx, hdr, rows = ctx[-6:], [], []
        elif ln['data']:
            rows.append(ln)
        elif not rows and ln['nums'] and not ln['hdr'] and ln['m'][0] not in ln['nums'] and \
                all(re.fullmatch(r'[-–—]|nil', w['text'], re.I) for w in ln['nums']):
            rows.append(ln)  # 'Total borrowings (C) = (A)+(B)  -' : a labelled row whose only cells are dashes
        elif not rows:
            hdr.append(ln)
        else:
            nxt = next((j for j in range(i, len(lines)) if lines[j]['data'] or lines[j]['prose']), len(lines))
            if any(lines[j]['hdr'] for j in range(i, nxt)) and nxt < len(lines) and lines[nxt]['data']:
                close()
                ctx, hdr, rows = [], [ln], []
            else:
                rows.append(ln)
    close()
    return segs


P_MON_YY3 = re.compile(r'\b' + MON + r"[-'’]\s*(\d{2})\b", re.I)
UNIT_PHRASE = re.compile(r'\b(?:millions?|lakhs?|lacs?|crores?|otherwise|unless|except|stated|mentioned)\b', re.I)


def periods3(text):
    """periods_in without 'March 31' read as March 2031: a month-year short form needs a - or ' separator."""
    found, spans = [], []

    def add(m, y, mo, d, kind=None):
        if any(a < m.end() and m.start() < b for a, b in spans):
            return
        spans.append((m.start(), m.end()))
        found.append((m.start(), (y, mo, d, kind or ('fy' if mo == 3 else 'stub'))))
    for m in P_MDY.finditer(text):
        add(m, int(m.group(3)), MONTHS[m.group(1)[:3].lower()], int(m.group(2)))
    for m in P_DMY.finditer(text):
        add(m, int(m.group(3)), MONTHS[m.group(2)[:3].lower()], int(m.group(1)))
    for m in P_NUM.finditer(text):
        if 1 <= int(m.group(2)) <= 12:
            add(m, int(m.group(3)), int(m.group(2)), int(m.group(1)))
    for m in P_MON_YY3.finditer(text):
        add(m, 2000 + int(m.group(2)), MONTHS[m.group(1)[:3].lower()], None)
    for m in P_FISCAL.finditer(text):
        add(m, *fiscal_period(text, m))
    return [p for _, p in sorted(found)]


def fy_span_is_part(header_txt):
    """True when a bare 'Fiscal' / 'FY' header word is itself a part of a year ('Nine months ended Fiscal')."""
    return any(P_FY_PART.search(header_txt[max(0, m.start() - 40):m.start()]) for m in SPAN_FY.finditer(header_txt))


def resolve_period(col_txt, header_txt):
    ps = list(dict.fromkeys(periods3(col_txt)))
    if len(ps) == 1:
        return ps[0]
    if ps:
        return None
    ys = BARE_YEAR.findall(col_txt)
    if len(ys) != 1:
        return None
    y = int(ys[0])
    mds = {(m.group(1)[:3].lower(), int(m.group(2))) for m in SPAN_MD.finditer(header_txt)}
    if len(mds) > 1:
        return None  # two group dates ('As of June 30,' / 'As of March 31,'): only group_periods may assign them
    md = SPAN_MD.search(header_txt)
    if md:
        mo = MONTHS[md.group(1)[:3].lower()]
        return (y, mo, int(md.group(2)), 'fy' if mo == 3 else 'stub')
    if SPAN_FY.search(header_txt) and not fy_span_is_part(header_txt):
        return (y, 3, 31, 'fy')
    return None


def group_periods(hdr, col_texts):
    """Two-level header: 'As of June 30,' over some columns and 'As of March 31,' over others, one bare year per
    column. The columns are split where the year sequence restarts (2026 2025 | 2026 2025 2024); the split must give
    exactly as many groups as there are group phrases (left to right), else nothing is resolved."""
    years, own = [], []
    for t in col_texts:
        txt = ' '.join(t)
        ps = list(dict.fromkeys(periods3(txt)))
        ys = BARE_YEAR.findall(txt)
        if len(ps) == 1:
            years.append(ps[0][0])
            own.append(ps[0])
        elif not ps and len(ys) == 1:
            years.append(int(ys[0]))
            own.append(None)
        else:
            return None
    groups = [[0]]
    for k in range(1, len(years)):
        if years[k] >= years[k - 1]:
            groups.append([])
        groups[-1].append(k)
    phrases = []
    for ln in hdr:
        cur = []
        for w in ln['w'] + [None]:
            if w is not None and cur and w['x0'] - cur[-1]['x1'] < 6:
                cur.append(w)
                continue
            if cur:
                t = ' '.join(x['text'] for x in cur)
                m = SPAN_MD.search(t)
                if m and not BARE_YEAR.search(t):
                    phrases.append((cur[0]['x0'], MONTHS[m.group(1)[:3].lower()], int(m.group(2))))
            cur = [w] if w is not None else []
    phrases.sort()
    if len(phrases) < 2 or len(phrases) != len(groups):
        return None
    out = [None] * len(years)
    for (x0, mo, d), g in zip(phrases, groups):
        for k in g:
            if own[k] and (own[k][1], own[k][2]) != (mo, d):
                return None  # a column's own printed date contradicts its group
            out[k] = (years[k], mo, d, 'fy' if mo == 3 else 'stub')
    return out


def grid_of_segment(hdr, rows, width):
    data = [ln for ln in rows if ln['data']]
    rights = [w['x1'] for ln in data for w in ln['nums']]
    groups = [g for g in cluster(rights, 10) if len(g) >= max(1, 0.3 * len(data))]
    cols = []
    for g in groups:
        x1 = sum(g) / len(g)
        mem = [w for ln in data for w in ln['nums'] if abs(w['x1'] - x1) <= 10]
        cols.append({'x1': x1, 'x0': min(w['x0'] for w in mem)})
    if not cols:
        return {'refused': 'no value columns'}
    bounds = []
    for k, c in enumerate(cols):
        left = (cols[k - 1]['x1'] + c['x0']) / 2 if k else c['x0'] - 0.6 * (c['x1'] - c['x0']) - 6
        right = (c['x1'] + cols[k + 1]['x0']) / 2 if k + 1 < len(cols) else width
        bounds.append((left, right))
    text_left = min(w['x0'] for ln in data for w in ln['w'])
    col_text = [[] for _ in cols]
    for ln in hdr:
        phrases = []
        for w in ln['w']:
            if phrases and w['x0'] - phrases[-1][-1]['x1'] < 3.5:
                phrases[-1].append(w)
            else:
                phrases.append([w])
        for ph in phrases:
            x0, x1 = ph[0]['x0'], ph[-1]['x1']
            touched = [k for k, (a, b) in enumerate(bounds) if min(x1, b) - max(x0, a) > 4]
            if not touched or len(touched) >= 3:
                continue
            if x0 <= text_left + 15 and x1 > bounds[0][0] + 0.5 * (bounds[0][1] - bounds[0][0]):
                continue
            if UNIT_PHRASE.search(' '.join(w['text'] for w in ph)) and not periods3(' '.join(w['text'] for w in ph)):
                continue  # '(₹ in million, except as otherwise stated)' printed over the value columns
            ov = {k: min(x1, bounds[k][1]) - max(x0, bounds[k][0]) for k in touched}
            if len(touched) == 2 and min(ov.values()) > 0.3 * max(x1 - x0, 1):
                for w in ph:
                    cx = (w['x0'] + w['x1']) / 2
                    for k, (a, b) in enumerate(bounds):
                        if a <= cx < b:
                            col_text[k].append(w['text'])
            else:
                col_text[max(ov, key=ov.get)].extend(w['text'] for w in ph)
    header_txt = ' '.join(ln['text'] for ln in hdr)
    out_rows = []
    for ln in rows:
        ids = {id(w) for w in ln['nums']}
        label = ' '.join(w['text'] for w in ln['m'] if (w['x0'] + w['x1']) / 2 < bounds[0][0] and id(w) not in ids)
        raw = [''] * len(cols)
        stray = False
        for w in ln['nums']:
            cx = (w['x0'] + w['x1']) / 2
            hit = [k for k, (a, b) in enumerate(bounds) if a <= cx < b]
            if hit:
                raw[hit[0]] += w['text']
            elif parse3(w['text'])[1] == 'ok' and not re.fullmatch(r'\(?\d{1,2}\)?\*?', w['text']):
                stray = True  # a value-like token outside every column (a footnote '(1)' is not one)
        cells, bad = [], []
        for k in range(len(cols)):
            v, st = parse3(raw[k])
            cells.append(v)
            if st == 'bad':
                bad.append(k)
        lper = list(ln['label_period'][0]) if len(ln['label_period']) == 1 else None
        if lper is None and ln.get('label_year') and SPAN_FY.search(header_txt) and \
                not fy_span_is_part(header_txt):
            lper = [ln['label_year'], 3, 31, 'fy']
            label = (str(ln['label_year']) + ' ' + label).strip()
        if out_rows and label[:1].islower() and out_rows[-1]['label'] and \
                all(c is None for c in out_rows[-1]['cells']) and not any(out_rows[-1]['raw']):
            label = out_rows.pop()['label'] + ' ' + label  # a label wrapped over two lines
        out_rows.append({'label': label.strip(), 'cells': cells, 'raw': raw, 'bad_cells': bad, 'stray': stray,
                         'label_period': lper})
    live = [k for k in range(len(cols)) if any(r['cells'][k] is not None or
                                               re.fullmatch(r'[-–—]|nil', r['raw'][k] or '', re.I) for r in out_rows)]
    periods = [resolve_period(' '.join(col_text[k]), header_txt) for k in live]
    if live and not all(periods):
        periods = group_periods(hdr, [col_text[k] for k in live]) or periods
    g = {'columns': [{'header': ' '.join(col_text[k]), 'x1': round(cols[k]['x1'], 1),
                      'period': None if p is None else {'year': p[0], 'month': p[1], 'day': p[2], 'kind': p[3]}}
                     for k, p in zip(live, periods)],
         'rows': [dict(r, cells=[r['cells'][k] for k in live], raw=[r['raw'][k] for k in live],
                       bad_cells=[live.index(k) for k in r['bad_cells'] if k in live]) for r in out_rows],
         'header_text': header_txt[:200]}
    ends = [tuple(p[:3]) for p in periods if p]
    if live and all(periods) and len(set(ends)) == len(ends):
        g['orientation'] = 'columns'
        return g
    lab_ps = [tuple(r['label_period']) for r in out_rows if r['label_period']]
    if len(lab_ps) >= 2 and len(set(lab_ps)) == len(lab_ps) and not any(periods):
        g['orientation'] = 'rows'
        return g
    g['refused'] = 'columns %s do not resolve to distinct periods and rows are not period-labelled' % (
        [c['header'][:40] for c in g['columns']])
    return g


def unit_basis(lines, upto, hdr_lines, ctx_lines=()):
    """Unit and basis for a table: its own header lines first; then a context line or the nearest line above, each
    only when it is a unit DECLARATION (a prose line stating an amount in crore is not the table's unit)."""
    own = [ln['text'] for ln in list(ctx_lines) + list(hdr_lines)]
    unit, src = unit_of([ln['text'] for ln in hdr_lines]), 'table'
    if not unit:
        unit = unit_of([ln['text'] for ln in ctx_lines if is_unit_declaration(ln['text'])])
    if not unit:
        src = None
        for ln in reversed(lines[:upto]):
            unit = unit_of([ln['text']]) if is_unit_declaration(ln['text']) else None
            if unit:
                src = 'line above: ' + ln['text'][:60]
                break
    basis = None
    for t in reversed([ln['text'] for ln in lines[:upto]] + own):
        b = {m.lower() for m in BASIS.findall(t)}
        if len(b) == 1:
            basis = b.pop()
            break
    return unit, src, basis


def section_grids(words, page_width):
    lines, err = section_lines(words, page_width)
    if err:
        return [{'refused': err}]
    out = []
    for ctx, hdr, rows in segments(lines):
        g = grid_of_segment(hdr, rows, page_width)
        start = lines.index(hdr[0]) if hdr else lines.index(rows[0])
        g['unit'], g['unit_src'], g['basis'] = unit_basis(lines, start, hdr, ctx)
        g['context'] = ' '.join(ln['text'] for ln in lines[max(0, start - 4):start])[-300:]
        out.append(g)
    return out


def carry_over(prev, cur):
    """A table continued from the previous page: the first table of a page without its own unit / basis takes them
    from the previous page's last table when both print the same periods in the same order."""
    if not prev or not cur or 'refused' in cur[0] or 'refused' in prev[-1]:
        return
    a, b = prev[-1], cur[0]
    pa = [tuple((c.get('period') or {}).values()) for c in a.get('columns', [])]
    pb = [tuple((c.get('period') or {}).values()) for c in b.get('columns', [])]
    if pa and pa == pb:
        for k in ('unit', 'basis'):
            if not b.get(k) and a.get(k):
                b[k] = a[k]
                b[k + '_carried'] = 'from previous page'
        b['context'] = (a.get('context') or '') + ' ' + (b.get('context') or '')


SEC_KEYWORDS = re.compile(r'net\s*worth|ebitda|ebidta|borrowing|total\s+debt|\bronw\b', re.I)
RENT_LINE = re.compile(r'^\s*(?:[ivx]+\)|\(?[a-z]\)|\d+\.?)?\s*rent(?:al)?\b', re.I | re.M)


MAX_SECTION_PAGES = 60


def section_plan(page_texts, other, max_pages=MAX_SECTION_PAGES):
    """(section key, pdf index) of every page of a verified located section that names a field this reader takes
    from that section (net worth / EBITDA / borrowings / RoNW; rent lines in the restated notes)."""
    plan = []
    for key, sec in other.items():
        if not sec.get('verified'):
            continue
        rx = RENT_LINE if key == 'restated' else SEC_KEYWORDS
        for i in range(sec['idx'], min(sec['end'], len(page_texts))):
            if rx.search(page_texts[i][1] or ''):
                plan.append((key, i))
    problems = []
    if len(plan) > max_pages:
        problems.append('%d candidate pages, capped at %d' % (len(plan), max_pages))
        plan = plan[:max_pages]
    return plan, problems


def read_section_grids(page_texts, other, words_for, unreadable=()):
    """Tables of the other located sections. -> {'pages': [{section, page, page_basis, grids}], 'problems'}."""
    plan, problems = section_plan(page_texts, other)
    res = {'pages': [], 'problems': problems}
    for key, idx in plan:
        pw, why = _page_words(words_for, idx, unreadable)
        if why:
            res['pages'].append({'section': key, 'page': idx, 'grids': [], 'refused': why})
            continue
        top = '\n'.join((page_texts[idx][1] or '').split('\n')[:8])
        grids = section_grids(pw['words'], pw['width'])
        last = res['pages'][-1] if res['pages'] else None
        if last and last['page'] == idx - 1 and last['section'] == key:
            carry_over(last['grids'], grids)
        res['pages'].append({'section': key, 'page': idx, 'page_basis':
                             'consolidated' if re.search('consolidated', top, re.I) else
                             'standalone' if re.search('standalone', top, re.I) else None,
                             'grids': grids})
    return res
