"""Section map of an offer document from its printed contents page (OD-173 rebuild step 1).

SEBI fixes the structure of a DRHP / RHP: the TABLE OF CONTENTS lists the mandated sections with their printed page
numbers. The printed-to-PDF page offset is the majority of (pdf index - printed page number) over every page that
prints its number. A section is VERIFIED when the located PDF page opens with that section's title. PDF bookmarks are
not used (13 of 24 measured documents have none).

locate(page_texts) -> {
  toc_pages, entries, offset, offset_votes,
  sections: [{title, printed, idx, verified}]   the restated financial information entries,
  verified: any restated section verified,
  other: {key: {title, printed, idx, end, verified}}  sod / bop / ofi / cap / restated, pdf range [idx, end)
}
Ported from the proven spike (claude-doc/rebuild/locate_spike.py) without behaviour change.
"""
import collections
import re

TOC_HEAD = re.compile(r'table\s+of\s+contents?|^\s*contents\s*$', re.I | re.M)
LEADER = r'[.…·]{3,}[.…·\s]*'
ENTRY = re.compile(r'^(?P<title>[A-Za-z][^\n]*?)\s*' + LEADER + r'(?P<page>\d{1,4})\s*$', re.M)
ENDS_WITH_PAGE = re.compile(r'\d{1,4}\s*$')
SECTION_START = re.compile(r'^\s*SECTION\b', re.I)
SEC_PREFIX = r'(?:section\s+[ivx]+\s*[-–—:一]?\s*)?'
FIN = re.compile(r'restated\s+(?:\w+\s+){0,2}financial\s+(?:information|statements?)'
                 r'|^\s*' + SEC_PREFIX + r'financial\s+(?:information|statements)\s*$', re.I)
# the other mandated sections that print EBITDA / net worth / RoNW / borrowings (generic titles only)
OTHER = {
    'ofi': re.compile(r'^\s*' + SEC_PREFIX + r'other\s+financial\s+information\s*$', re.I),
    'bop': re.compile(r'^\s*' + SEC_PREFIX + r'basis\s+(?:for|of)\s+(?:the\s+)?(?:offer|issue)\s+price\s*$', re.I),
    'cap': re.compile(r'^\s*' + SEC_PREFIX + r'capitali[sz]ation\s+statement\s*$', re.I),
    'sod': re.compile(r'^\s*' + SEC_PREFIX + r'(?:summary\s+of\s+(?:the\s+)?offer\s+document|offer\s+document\s+summary)\s*$',
                      re.I),
}
PAGE_NO = re.compile(r'(?:page\s*)?(\d{1,4})(?:\s*\|\s*page)?', re.I)
TOC_SCAN_PAGES = 20
RESTATED_FALLBACK_SPAN = 150


def printed_number(text):
    lines = [ln.strip() for ln in (text or '').split('\n') if ln.strip()]
    for ln in lines[-3:] + lines[:2]:
        m = PAGE_NO.fullmatch(ln)
        if m:
            return int(m.group(1))
    return None


def toc_entries(text):
    """(title, printed page) of every contents line; a title wrapped onto the next line is joined first."""
    joined = []
    for ln in text.split('\n'):
        if joined and not ENDS_WITH_PAGE.search(joined[-1]) and not SECTION_START.match(ln) \
                and re.search(r'[.…]{3,}', ln):
            joined[-1] = joined[-1].rstrip() + ' ' + ln.strip()
        else:
            joined.append(ln)
    return [(m.group('title').strip(), int(m.group('page'))) for m in ENTRY.finditer('\n'.join(joined))]


def norm_title(s):
    s = re.sub(r'[.…·]+', ' ', s)
    s = re.sub(r'^\s*' + SEC_PREFIX, '', s, flags=re.I)
    return re.sub(r'\s+', ' ', s).strip().lower()


def page_offset(pages):
    offs = collections.Counter()
    for n, t in pages:
        pn = printed_number(t)
        if pn:
            offs[n - pn] += 1
    return offs.most_common(1)[0] if offs else (None, 0)


def locate(page_texts):
    pages = [(n, t or '') for n, t in page_texts if (t or '').strip()]
    by_idx = dict(pages)
    toc = [(n, t) for n, t in pages[:TOC_SCAN_PAGES] if TOC_HEAD.search(t)]
    entries = [e for _, t in toc for e in toc_entries(t)]
    offset, votes = page_offset(pages)
    row = dict(toc_pages=[n for n, _ in toc], entries=len(entries), offset=offset, offset_votes=votes, sections=[])
    for title, printed in (e for e in entries if FIN.search(e[0])):
        idx = printed + offset if offset is not None else None
        top = ' '.join(by_idx.get(idx, '').split('\n')[:8]).lower()
        words = [w for w in re.findall(r'[a-z]+', norm_title(title)) if len(w) > 3][:4]
        ok = bool(words) and all(w in top for w in words)
        row['sections'].append(dict(title=title[:70], printed=printed, idx=idx, verified=ok))
    row['verified'] = any(s['verified'] for s in row['sections'])
    # every located section runs to the next contents entry (pdf index range [idx, end))
    starts = sorted({p for _, p in entries})
    row['other'] = {}
    for title, printed in entries:
        for key, rx in OTHER.items():
            if rx.match(title) and offset is not None and key not in row['other']:
                nxt = [p for p in starts if p > printed]
                idx, end = printed + offset, (nxt[0] + offset if nxt else printed + offset + 1)
                top = ' '.join(by_idx.get(idx, '').split('\n')[:10]).lower()
                words = [w for w in re.findall(r'[a-z]+', norm_title(title)) if len(w) > 3]
                row['other'][key] = dict(title=title[:70], printed=printed, idx=idx, end=end,
                                         verified=bool(words) and all(w[:7] in top for w in words))
    fin_ok = [s for s in row['sections'] if s['verified'] and 'SUMMARY' not in s['title'].upper()]
    if fin_ok:  # the restated section itself (its notes print rent), up to the next contents entry
        st = max(s['printed'] for s in fin_ok)
        nxt = [p for p in starts if p > st]
        row['other']['restated'] = dict(title='restated', printed=st, idx=st + offset,
                                        end=(nxt[0] + offset if nxt else st + offset + RESTATED_FALLBACK_SPAN),
                                        verified=True)
    return row


def restated_start(row):
    """PDF index of the restated financial information section (the last verified non-summary entry), or None."""
    secs = [s for s in row['sections'] if s['verified'] and 'SUMMARY' not in s['title'].upper()]
    return max(s['idx'] for s in secs) if secs else None
