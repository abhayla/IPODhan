"""Page furniture (running heads, running footers, page numbers) of an offer document, found by REPETITION across
pages + POSITION at the page edge (OD-173 rebuild, the core proven 2026-10-07 on 24 DRHPs / 12,732 pages). No phrase
list, no per-document rule. Ported from the proven spike (claude-doc/rebuild-furniture/furniture.py, run_corpus.py,
clean_words.py) without behaviour change.

Peeling from the top (or bottom) edge of a page, a line is furniture while every line between it and the edge is
furniture too (at most DEPTH lines per edge) and it is one of:
  * counter line - the line holds a number (or a short roman numeral) and, on >= MIN_COUNTER pages at that edge,
                   the number moves with the page index at ONE constant offset (page numbers: "85 | P a g e",
                   "Page 3 of 410", "F-8", "xii", "12 Jio Platforms Limited").
  * running head - the identical line (case / spacing / letter-spacing collapsed) sits at that edge on
                   >= MIN_TEXT pages, ALSO on a neighbouring page (+-2) of this one, AND the text is the document's own:
                   printed on its cover pages (issuer name, "formerly known as", CIN) or a title in its own contents
                   page (section running head). Repeated edge text that is neither (table headers on continuation
                   pages, unit lines, statement headings, signature dates) is content and is KEPT.
A line that appears once is never furniture (both rules need repetition).
Word-box path: the same, plus the line must lie in the top / bottom BAND of the page by its y position.

model_for(page_texts) learns the model from the whole document's page texts; clean_grid_page(model, page, idx)
removes the furniture words from one statement_grid.grid_words() page.
"""
import re
from collections import Counter, defaultdict

import section_locator
import statement_grid

DEPTH = 3
MIN_COUNTER = 5
COUNTER_SHARE = 0.6
MIN_TEXT = 5
NEIGHBOUR = 2
BAND = 0.15
MIN_HEAD_LEN = 8

SPACED = re.compile(r'(?<![A-Za-z0-9])(?:[A-Za-z0-9] ){2,}[A-Za-z0-9](?![A-Za-z0-9])')
ROMAN = re.compile(r'^(?=[ivxlc]+$)c{0,3}(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$')


def collapse(s):
    """'85 | P a g e' -> '85 | Page'; spacing and case are not compared."""
    s = SPACED.sub(lambda m: m.group(0).replace(' ', ''), s or '')
    return re.sub(r'\s+', ' ', s).strip()


def roman_val(t):
    vals = dict(i=1, v=5, x=10, l=50, c=100)
    n = 0
    for a, b in zip(t, t[1:] + ' '):
        n += -vals[a] if b != ' ' and vals[b] > vals[a] else vals[a]
    return n


def norm(s):
    s = collapse(s).lower()
    return re.sub(r'\s*([|/:\-–])\s*', r' \1 ', s).strip()


def key_and_numbers(line):
    s = norm(line)
    toks = s.split()
    if 1 < len(toks) <= 3 and all(t.isdigit() for t in toks):   # a page number split by the text layer: "26 0"
        toks = [''.join(toks)]
    nums, out = [], []
    for t in toks:
        core = t.strip('.,()[]')
        if re.fullmatch(r'\d+', core):
            nums.append(int(core))
            out.append('#')
        elif len(toks) <= 4 and core and ROMAN.match(core):
            nums.append(roman_val(core))
            out.append('#r')
        else:
            out.append(re.sub(r'\d+', '#', t))
    return ' '.join(out), nums, ' '.join(toks)


def squash(s):
    return re.sub(r'[^a-z0-9]', '', norm(s))


def edge_lines(lines, edge):
    return lines[:DEPTH] if edge == 'top' else lines[::-1][:DEPTH]


class Model:
    def __init__(self):
        self.counter = {'top': set(), 'bottom': set()}
        self.text_pages = {'top': {}, 'bottom': {}}   # running-head text -> set(page idx where it sits at that edge)
        self.evidence = []
        self.kept_repeats = []                        # repeated edge text NOT accepted (content), for the report
        self.offsets = {}                             # counter key -> (number position, page-index offsets seen >= 2x)

    def stray_counter(self, line, idx):
        """a page-number line the text layer placed mid-page (chart pages): a lettered counter key ('# | page') whose
        number is exactly this page's expected number. Bare-number keys never qualify (a table cell can be '201')."""
        k, nums, _ = key_and_numbers(line)
        if k not in self.offsets or not re.search(r'[a-z]', k.replace('#r', '')):
            return False
        pos, offs = self.offsets[k]
        return len(nums) > pos and nums[pos] - idx in offs

    def is_furniture(self, edge, line, idx=None):
        k, _, ex = key_and_numbers(line)
        if k in self.counter[edge]:
            return 'counter'
        pages = self.text_pages[edge].get(ex)
        if pages and (idx is None or any(idx + d in pages for d in range(-NEIGHBOUR, NEIGHBOUR + 1) if d)):
            return 'head'
        return None


def learn(pages, own_text):
    """pages: [(idx, [line, ...])]; own_text(ex) -> True when the text is the document's own (cover / contents)."""
    m = Model()
    for edge in ('top', 'bottom'):
        open_pages = {i: edge_lines(ls, edge) for i, ls in pages if ls}
        for rank in range(DEPTH):
            occ = defaultdict(list)
            exact = defaultdict(set)
            for i, ls in open_pages.items():
                if rank < len(ls):
                    k, nums, ex = key_and_numbers(ls[rank])
                    occ[k].append((i, nums))
                    exact[ex].add(i)
            for k, rows in occ.items():
                if '#' not in k or len(rows) < MIN_COUNTER:
                    continue
                best, where = 0, None
                for pos in range(max(len(n) for _, n in rows)):
                    offs = Counter(n[pos] - i for i, n in rows if len(n) > pos)
                    if offs and offs.most_common(1)[0][1] > best:
                        best = offs.most_common(1)[0][1]
                        where = (pos, {o for o, c in offs.items() if c >= 2})
                if best >= MIN_COUNTER and best >= COUNTER_SHARE * len(rows):
                    m.counter[edge].add(k)
                    m.offsets[k] = where
                    m.evidence.append(dict(edge=edge, kind='counter', rank=rank, key=k, pages=len(rows), tracking=best))
            for ex, pgs in exact.items():
                if len(pgs) < MIN_TEXT or len(squash(ex)) < MIN_HEAD_LEN:
                    continue
                if own_text(ex):
                    m.text_pages[edge].setdefault(ex, set()).update(pgs)
                    m.evidence.append(dict(edge=edge, kind='head', rank=rank, key=ex, pages=len(pgs)))
                else:
                    m.kept_repeats.append(dict(edge=edge, rank=rank, text=ex, pages=len(pgs)))
            nxt = {}
            for i, ls in open_pages.items():
                if rank < len(ls) and m.is_furniture(edge, ls[rank], i):
                    nxt[i] = ls
            open_pages = nxt
            if not open_pages:
                break
    return m


def strip_lines(m, lines, idx):
    lo, hi, removed = 0, len(lines), []
    while lo < hi and lo < DEPTH:
        why = m.is_furniture('top', lines[lo], idx)
        if not why:
            break
        removed.append(('top', why, lines[lo]))
        lo += 1
    while hi > lo and len(lines) - hi < DEPTH:
        why = m.is_furniture('bottom', lines[hi - 1], idx)
        if not why:
            break
        removed.append(('bottom', why, lines[hi - 1]))
        hi -= 1
    kept = []
    for ln in lines[lo:hi]:
        if m.stray_counter(ln, idx):
            removed.append(('mid', 'counter', ln))
        else:
            kept.append(ln)
    return kept, removed


def page_lines(text):
    return [ln.strip() for ln in (text or '').split('\n') if ln.strip()]


def strip_word_lines(m, wlines, height, idx):
    """word-box path: wlines from statement_grid.lines_of(words), top to bottom ({'text','w':[...]})."""
    lo, hi, removed = 0, len(wlines), []
    while lo < hi and lo < DEPTH and max(w['bottom'] for w in wlines[lo]['w']) <= BAND * height:
        why = m.is_furniture('top', wlines[lo]['text'], idx)
        if not why:
            break
        removed.append(('top', why, wlines[lo]))
        lo += 1
    while (hi > lo and len(wlines) - hi < DEPTH
           and min(w['top'] for w in wlines[hi - 1]['w']) >= (1 - BAND) * height):
        why = m.is_furniture('bottom', wlines[hi - 1]['text'], idx)
        if not why:
            break
        removed.append(('bottom', why, wlines[hi - 1]))
        hi -= 1
    return wlines[lo:hi], removed


def own_text_fn(page_texts):
    """the document's own text: a whole LINE of its first 3 non-empty pages (cover) + the titles in its own contents
    page. A document without a readable contents page simply has no section heads."""
    cover = [t or '' for _, t in page_texts if (t or '').strip()][:3]
    cover_lines = {squash(ln) for t in cover for ln in page_lines(t)}
    titles = set()
    try:
        loc = section_locator.locate(page_texts)
        by = dict(page_texts)
        for n in loc.get('toc_pages') or []:
            titles |= {squash(t) for t, _ in section_locator.toc_entries(by[n])}
    except Exception:  # noqa: BLE001 - an unreadable contents page gives no section heads, never a stop
        titles = set()
    return lambda ex: squash(ex) in cover_lines or squash(ex) in titles


def model_for(page_texts):
    """the furniture model of one document, learned from all of its page texts [(idx, text)]."""
    page_texts = [(i, t or '') for i, t in page_texts]
    return learn([(i, page_lines(t)) for i, t in page_texts], own_text_fn(page_texts))


def page_height(page):
    """a grid_words page's height: A4 / Letter by its width, never shorter than its lowest word."""
    w = page['width']
    h = w * 2 ** 0.5 if abs(w - 595.3) < 3 else 792.0 if abs(w - 612) < 3 else w * 2 ** 0.5
    return max([h] + [x['bottom'] for x in page['words']])


def clean_grid_page(m, page, idx):
    """-> (the page with its furniture words removed, number of furniture lines removed). `page` is a
    statement_grid.grid_words() dict; it is not modified."""
    _, rem = strip_word_lines(m, statement_grid.lines_of(page['words']), page_height(page), idx)
    gone = {id(w) for _, _, ln in rem for w in ln['w']}
    return dict(page, words=[w for w in page['words'] if id(w) not in gone]), len(rem)
