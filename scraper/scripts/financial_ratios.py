"""Read the issuer's OWN financial-ratio note, and derive only what nobody prints.

Item 8b slice 2.

WHY THIS READS RATHER THAN CALCULATES, which is the opposite of what the build
card assumed. Companies Act Schedule III makes every issuer disclose a table of
ratios with its numerator, its denominator and its value. Two of the three
numbers this item wants are in that table, stated by the company and signed off
by its auditors. Recomputing them from the statements would replace an audited
figure with my arithmetic.

That is not a stylistic preference. It was measured on Karamtara, which prints
inventory turnover of 4.09 and 3.57:

    cost of material / average inventory      4.074 / 3.491
    plus the inventory change                 3.989 / 3.492
    over closing stock                        4.501 / 3.080

Nothing reproduces the printed figure, and the gap is not constant - the
numerator needed is 99.85 higher in one year and 481.54 higher in the next. The
company's "cost of goods sold" folds in something from Other expenses that the
statement never discloses separately. Any formula shipped here would publish a
number that disagrees with the one printed four pages away in the same document.

QUICK RATIO IS THE EXCEPTION and is derived, because nobody prints it: it is not
one of the Schedule III ratios. Confirmed by scanning both prospectuses end to
end - 590 pages of Prasol and 529 of Karamtara - not by assuming. It is pure
balance-sheet arithmetic with no judgement in it, and slice 1 already extracts
both inputs, so it ships DERIVED and labelled as such.
"""

import re

# The note's own heading. The number varies by issuer (Prasol's is note 49), so
# the digits are optional rather than matched.
#
# #771: issuers title the same Schedule III note several ways. Measured on real
# prospectuses: "49 Financial Ratios" (Prasol), "60 Key Financial Ratios"
# (A-One Steels), "47 Ratio Analysis" (German Green Steel) and "Restated
# Consolidated Statement of Ratios" (Green Asia Impex). The last is matched as
# the exact phrase so the accounting-ratios statement ("Statement of Earnings
# Per Share and Other Statutory Ratios") is not swept in.
#
# #771 round 3: Studds titles it "Analytical Ratios" and Water Infra "RATIOS
# ANALYSIS"; both were reported ratio_note_not_in_document while printing it.
_NOTE_HEADING = re.compile(
    r"\bfinancial\s+ratios\b|\bratios?\s+analysis\b|\bstatement\s+of\s+ratios\b"
    r"|\banalytical\s+ratios\b|\bkey\s+ratios\b",
    re.I,
)

# A row: <sr> <name> <numerator words> <denominator words> <value> <value> <variance%>
#
# The two values are captured as ONE span so the split-digit repair below can be
# applied to that span alone. Anchoring on the trailing variance percentage is
# what makes the span unambiguous - the reason column that follows is free prose
# of any length, so parsing from the end of the line is not reliable.
#
# #771 widened this from the one layout it was built on (Prasol) to the ones
# measured on real prospectuses, without loosening what makes a line a ROW:
#   - the serial is a digit ("1"), a letter ("a)", "(a)"), or absent (Green
#     Asia prints the label on its own line and the values on an unnumbered
#     "Current Ratio 1.16 1.13 1.08 2.66% 3.80%" line);
#   - two OR MORE period values (German Green Steel prints three), still
#     anchored on the first variance percentage after them, which may be
#     parenthesised ("(8.10%)") or glued to the reason ("5.67%Less than 25%").
# Values stay newest period first, so values[0] is still the one persisted.
#
# #771 review round 1: a label followed by a QUALIFIER ("Current Ratio
# excluding inventory") is a different ratio under a similar name - an
# acid-test ratio - and not a row of THIS ratio. The negative lookahead refuses
# it rather than publishing it as the current ratio.
_QUALIFIER = (
    r"(?!\s*\(?\s*(?:excluding|excl\b|ex\b|ex-|without|net\s+of|adjusted|"
    r"less\b|after\b|before\b))"
)
_ROW = re.compile(
    r"^\s*(?:\d+\s+|\(?[a-z]\)\s*)?(?P<name>Current\s+Ratio|Inventory\s+turnover\s+Ratio)\b"
    + _QUALIFIER +
    r"(?P<mid>.*?)"
    r"(?P<vals>(?:\s+-?\d[\d,]*\s*\.\s*\d+|\s+-?\d[\d,]*\.\d+){2,})"
    r"\s+(?P<var>\(?-?[\d.]+\s*%)",
    re.I,
)

# pdfplumber returns this note's figures with a space inside the number: "1 .54"
# for 1.54, "5 .59" for 5.59.
#
# `extract_financials_pdf._normalize_numbers` does NOT repair these, and that is
# deliberate on its part: its split-digit repair fires only when a line carries
# at least TWO such tokens, which is the guard that stopped 13,970.10 being read
# as 3,970.10 (W-33). These rows carry one, because the second value is already
# intact. Loosening that global rule to catch them would reintroduce exactly the
# false repairs it exists to prevent.
#
# So the repair happens HERE, inside the already-identified value span, where a
# lone digit followed by ".NN" cannot be anything else.
_SPLIT_DIGIT = re.compile(r"(?<![\d.])(\d)\s+\.(\d)")
_WHOLE_NUMBER = re.compile(r"^-?\d[\d,]*\.\d+$")
# One variance column: "15.09%", "-6.38%", "(2.65)%", "(8.10%)", or glued to
# the reason that follows ("5.67%Less than 25%") - only the leading token.
_VARIANCE = re.compile(r"\s*\(?-?\d[\d.,]*\s*\)?\s*%\)?")

_KEYS = {"current ratio": "current_ratio", "inventory turnover ratio": "inventory_turnover"}


def find_ratio_note_pages(page_texts):
    """Every page carrying the issuer's ratio note, in order.

    The note spans pages when an issuer discloses more than one comparison
    period - Prasol's runs across two - and THE CONTINUATION PAGE DOES NOT
    REPEAT THE HEADING. Measured: page 441 carries "49 Financial Ratios" and
    two comparison tables; page 442 carries a third table with no heading at
    all. A heading-only locator finds 441, silently drops 442, and loses the
    oldest year without any error.

    So a page also counts when it carries the note's ROWS and directly follows
    a page that counted. Ordering matters here: a stray "Current Ratio" row
    somewhere else in the document is not picked up, because it has no
    heading-bearing page in front of it.
    """
    by_index = dict(page_texts)
    pages = []
    for index in sorted(by_index):
        text = by_index[index] or ""
        heading = bool(_NOTE_HEADING.search(text)) or _schedule_iii_page(text)
        continues = bool(pages) and index - 1 == pages[-1] and _has_ratio_row(text)
        if heading or continues:
            pages.append(index)
    return pages


def _has_ratio_row(text):
    return any(_ROW.match(" ".join(line.split())) for line in (text or "").split("\n"))


# --------------------------------------------------------------------------- #
# #771 round 3: the column is chosen by its PERIOD HEADING, never by position.
#
# Rounds 1-2 took the ratio by position (`run[-periods:]`, newest first, one
# variance column per period after the first). The independent review of
# 2026-09-27 measured that assumption wrong on five layouts: four years with one
# variance column, amounts printed before the ratios, a difference column before
# the %, a stub period with variances only for the full years, and oldest-first
# order. Each published a wrong period's ratio as the current one.
#
# The spec (data-sourcing-pull-model.md row 82) says a fiscal year is "read from
# the statement header, never assumed". So a value is written only when the
# row's period headings are READ from the lines above it, their count equals the
# row's value count, and one of them is the latest restated statement period -
# the period (and, where both are stated, the basis) of the stored net worth and
# EPS. Anything else writes nothing and names why.

_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
_MON = r"(?P<mon>jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
# Full period headings, each resolving to one period-end date.
_PERIOD_RXS = [
    # 30/09/2024, 31-03-2024, 31.03.2024 (day first, Indian order)
    re.compile(r"(?<![\d/.-])(?P<d>\d{1,2})[/.-](?P<m>\d{1,2})[/.-](?P<y>20\d{2})(?![\d/.-])"),
    # 31-Mar-26 (a two-digit year only when hyphen-joined), 31 March 2026,
    # 31st March, 2026, 31-Mar 2025, 31- Mar-24
    re.compile(r"(?<![\d/.-])(?P<d>\d{1,2})(?:st|nd|rd|th)?[\s-]*" + _MON +
               r"(?:-(?P<y2>\d{2})(?![\d-])|[\s,-]*(?P<y>20\d{2})(?!\d))", re.I),
    # March 31, 2026
    re.compile(r"\b" + _MON + r"\s+(?P<d>\d{1,2})(?:st|nd|rd|th)?,?\s*(?P<y>20\d{2})(?!\d)", re.I),
    # FY 25-26, FY 2025-26, Fiscal 2025-26 (the year it ENDS in, at 31 March)
    re.compile(r"\b(?:FY|Fiscal)\s*[:\-]?\s*(?P<fs>\d{2,4})\s*[-/]\s*(?P<fe>\d{2})(?!\d)", re.I),
    # FY 2026, FY2026, Fiscal 2026
    re.compile(r"\b(?:FY|Fiscal)\s*(?P<y>20\d{2})(?!\s*[-/]\s*\d)(?!\d)", re.I),
    # #771 r3 review MINOR (Indian FY convention: the year ENDS 31 March):
    # FY25, FY'25 -> 31-Mar-2025
    re.compile(r"\bFY\s*'?(?P<y2>\d{2})(?![\d/-])", re.I),
    # 2024-25 with no prefix -> 31-Mar-2025 (the end year must be start + 1)
    re.compile(r"(?<![\d/.-])(?P<fs>20\d{2})\s*-\s*(?P<fe>\d{2})(?![\d/.-])"),
    # Mar-25, Mar'25, March 2025, Sep-24 -> that month's last day. A two-digit
    # year only when joined by '-' or an apostrophe ("Mar 25" could be 25 March:
    # ambiguous, refused); a four-digit one after a space.
    re.compile(r"\b" + _MON + r"(?:[-'](?P<y2>\d{2})(?![\d,/-])|\s+(?P<y>20\d{2})(?!\d))", re.I),
]
# A day+month whose year is printed on a later line (a wrapped or vertical cell).
_STRANDED_RXS = [
    re.compile(r"(?<![\d/.-])(?P<d>\d{1,2})(?:st|nd|rd|th)?[\s-]*" + _MON +
               r"-?(?=\s|,|$)(?![\s,-]*20\d{2})", re.I),
    re.compile(r"\b" + _MON + r"\s+(?P<d>\d{1,2})(?:st|nd|rd|th)?,?(?=\s|$)(?!\s*20\d{2})", re.I),
]
_BARE_YEAR = re.compile(r"(?<![\d/.,-])(20\d{2})(?![\d/-])")
_MONTH_YEAR = re.compile(
    r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+20\d{2}\b", re.I)
_TWO_DIGIT_YEARS_LINE = re.compile(r"^\s*\d{2}(?:\s+\d{2})+\s*$")
_BASIS_LABEL = re.compile(r"\((standalone|consolidat)", re.I)
_PAGE_BASIS = re.compile(r"restated\s+(consolidated|standalone)", re.I)
_DECIMAL = re.compile(r"^-?\d[\d,]*\.\d+$")
_PERCENT_TOKEN = re.compile(r"\d\s*\)?\s*%")

# Every Schedule III ratio name. A page printing most of them IS the ratio note
# even when its heading sits on another page or was never printed (Modern
# Diagnostic's page F-29 carries all eleven rows and no heading).
_SCHEDULE_III_NAMES = [
    r"current\s+ratio", r"debt[\s-]*equity", r"debt\s+service\s+coverage",
    r"return\s+on\s+equity", r"inventory\s+turnover", r"trade\s+receivables?\s+turnover",
    r"trade\s+payables?\s+turnover", r"net\s+capital\s+turnover", r"net\s+profit\s+ratio",
    r"return\s+on\s+capital\s+employed", r"return\s+on\s+investment",
]
_SCHEDULE_III_MIN = 6

# Outside these the read is refused: a current ratio above 50 is a mis-read, not
# a company. Inventory turnover is bounded only by its numeric(5,2) column.
_RANGES = {"current_ratio": (0.0, 50.0), "inventory_turnover": (0.0, 999.99)}

# The label alone; the values are found by `row_values`, the period by the header.
_ROW_LABEL = re.compile(
    r"^\s*(?:\d+\s*|\(?[a-z][.)]\s*)?(?P<name>Current\s+Ratio|Inventory\s+turnover\s+Ratio)\b"
    + _QUALIFIER,
    re.I,
)


# F-219 (#1420): a row whose LABEL wraps around its value line. German Green's
# note 47 prints, on three lines:
#     Inventory Turnover account of stagnant revenue
#     5 Total Revenue from Customers Traded Inventories 5.63 6.02 8.85 -6.41% (31.97)%
#     Ratio and increase holding level of
# The label's head sits on the line above the serial-and-values line and its
# last word on the line below; `_ROW_LABEL` sees "Inventory Turnover" with no
# "Ratio" and the row was reported as ratio_row_not_in_note although printed.
#
# The join is bounded: the head is at the START of a line, the tail at the START
# of the line right after the values, the values on the head line itself or on
# the ONE line between them. That middle line must not carry a label of its own
# (it would then be another ratio's row), so a head and a tail of the same
# ratio's name two rows apart are never stitched across a third row.
_WRAP_NAMES = {"current_ratio": ["current", "ratio"],
               "inventory_turnover": ["inventory", "turnover", "ratio"]}
_SERIAL = r"^\s*(?:\d+\s*|\(?[a-z][.)]\s*)?"
_ANY_LABEL_START = re.compile(
    _SERIAL + r"(?:" + "|".join(_SCHEDULE_III_NAMES) + r")\b", re.I)


def _words_rx(words):
    return r"\s+".join(re.escape(w) for w in words)


def wrapped_row(lines, at, key):
    """(values_line_index, values) when `lines[at]` opens a wrapped label of
    ratio `key` that `_ROW_LABEL` cannot see, else None."""
    words = _WRAP_NAMES[key]
    line = lines[at]
    for split in range(1, len(words)):
        head = re.match(_SERIAL + _words_rx(words[:split]) + r"\b(?!\s+" +
                        re.escape(words[split]) + r"\b)", line, re.I)
        if not head:
            continue
        tail_rx = re.compile(r"^\s*" + _words_rx(words[split:]) + r"\b" + _QUALIFIER, re.I)
        # Values on the head line itself, tail on the next line.
        own = row_values(line, head.end())
        if own and at + 1 < len(lines) and tail_rx.match(lines[at + 1]):
            return at, own
        # Values on the one line between head and tail.
        if own or at + 2 >= len(lines) or not tail_rx.match(lines[at + 2]):
            continue
        middle = lines[at + 1]
        if _ROW_LABEL.match(middle) or _ANY_LABEL_START.match(middle):
            continue
        values = row_values(middle, 0)
        if values:
            return at + 1, values
    return None


# A statement period ends on a month's last day. '25 March 2025' read out of
# "2024-25 March 2025" is a caption fragment, not a period heading.
_MONTH_END = {1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31}


def _month_end(date):
    year, month, day = date
    if not 1 <= month <= 12:
        return False
    leap = month == 2 and day == 29 and year % 4 == 0
    return day == _MONTH_END[month] or leap


def _schedule_iii_page(text):
    return sum(1 for rx in _SCHEDULE_III_NAMES if re.search(rx, text or "", re.I)) >= _SCHEDULE_III_MIN


def period_tokens(line):
    """Every full period heading in `line`, in reading order: [(date, label)],
    date = (year, month, day)."""
    found, dated_days = [], []
    for rx in _PERIOD_RXS:
        for m in rx.finditer(line):
            g = m.groupdict()
            try:
                if g.get("fs") is not None:
                    fs = g["fs"]
                    start = int(fs) if len(fs) == 4 else 2000 + int(fs)
                    end = (start - start % 100) + int(g["fe"])
                    if end < start:
                        end += 100
                    if end != start + 1:
                        continue
                    date = (end, 3, 31)
                elif g.get("d") is None:
                    year = int(g["y"]) if g.get("y") else 2000 + int(g["y2"])
                    if g.get("mon"):
                        month = _MONTHS[g["mon"][:3].lower()]
                        leap = month == 2 and year % 4 == 0
                        date = (year, month, 29 if leap else _MONTH_END[month])
                    else:
                        date = (year, 3, 31)
                else:
                    month = int(g["m"]) if g.get("m") else _MONTHS[g["mon"][:3].lower()]
                    year = int(g["y"]) if g.get("y") else 2000 + int(g["y2"])
                    date = (year, month, int(g["d"]))
                    if not _month_end(date):
                        # A dated day ('25 March 2025') is a date, not a
                        # period: no shorter reading of it may stand either.
                        dated_days.append((m.start(), m.end()))
                        continue
            except (TypeError, ValueError, KeyError):
                continue
            found.append((m.start(), m.end(), date, m.group(0).strip()))
    found.sort(key=lambda f: (f[0], -f[1]))
    kept, last_end = [], -1
    for start, end, date, label in found:
        if start < last_end or any(s < end and start < e for s, e in dated_days):
            continue
        kept.append((date, label))
        last_end = end
    return kept


def _stranded_periods(lines):
    """A header whose day+month and year sit on different lines ('March 31,' x3
    over '2026' and '2025 2024'; '31-Mar-' x3 over '25 24 22'). Pairs the
    stranded day+months with the bare years that FOLLOW them, in order."""
    stranded, years = [], []
    for line in lines:
        hits = []
        for rx in _STRANDED_RXS:
            for m in rx.finditer(line):
                hits.append((m.start(), (_MONTHS[m.group("mon")[:3].lower()], int(m.group("d")))))
        hits = [(pos, h) for pos, h in hits if h[1] == _MONTH_END[h[0]] or (h[0] == 2 and h[1] == 29)]
        if hits:
            hits.sort()
            seen = set()
            for pos, h in hits:
                if pos not in seen:
                    stranded.append(h)
                    seen.add(pos)
            continue
        if not stranded:
            continue
        if _TWO_DIGIT_YEARS_LINE.match(line):
            years.extend(2000 + int(t) for t in line.split())
            continue
        years.extend(int(y) for y in _BARE_YEAR.findall(_MONTH_YEAR.sub(" ", line)))
    if not stranded or len(years) < len(stranded):
        return []
    return [((years[i], month, day), "%d-%02d-%02d" % (years[i], month, day))
            for i, (month, day) in enumerate(stranded)]


def _monotonic(dates):
    return (all(a > b for a, b in zip(dates, dates[1:]))
            or all(a < b for a, b in zip(dates, dates[1:])))


def row_values(line, label_end):
    """The ratio values of one row: the run of decimal numbers ending right
    before the first percentage (the variance columns), or the first run when
    the row prints no percentage. Split digits ('1 .54') are repaired first.
    An amount printed in front of the ratios stays IN the run - the count check
    against the headings then refuses the row rather than guessing."""
    rest = _SPLIT_DIGIT.sub(r"\1.\2", line[label_end:])
    runs, current = [], []
    for token in rest.split():
        if _PERCENT_TOKEN.search(token):
            return [float(t.replace(",", "")) for t in current]
        if _DECIMAL.match(token):
            current.append(token)
            continue
        if current:
            runs.append(current)
            current = []
    if current:
        runs.append(current)
    return [float(t.replace(",", "")) for t in runs[0]] if runs else []


def _is_same_ratio_row(line, key):
    """Another data row of the SAME ratio: the row of the table above. Its
    header belongs to that table, so the search for this row's header stops."""
    match = _ROW_LABEL.match(line)
    return bool(match and _KEYS[" ".join(match.group("name").split()).lower()] == key
                and row_values(line, match.end("name")))


def read_row_headings(lines, row_at, count, key):
    """(headings, header_index, reason) for the row at `lines[row_at]` holding
    `count` values. Nearest single header line first, then a wrapped/stranded
    header. The headings must be exactly `count`, and in time order."""
    top = 0
    for i in range(row_at - 1, -1, -1):
        if _is_same_ratio_row(lines[i], key):
            top = i + 1
            break
    any_tokens = False
    for i in range(row_at - 1, top - 1, -1):
        toks = period_tokens(lines[i])
        any_tokens = any_tokens or bool(toks)
        if len(toks) == count and _monotonic([d for d, _l in toks]):
            return toks, i, None
    stranded = _stranded_periods(lines[top:row_at])
    if len(stranded) == count and _monotonic([d for d, _l in stranded]):
        return stranded, top, None
    if any_tokens or stranded:
        return None, None, "ratio_heading_count_differs_from_value_count"
    return None, None, "ratio_period_headings_unreadable"


def _column_bases(lines, header_at, row_at, count, page_text):
    labels = []
    for line in lines[header_at:row_at]:
        labels.extend(m.group(1).lower() for m in _BASIS_LABEL.finditer(line))
    if len(labels) == count:
        return ["standalone" if lab.startswith("standalone") else "consolidated" for lab in labels]
    return [statement_basis(page_text)] * count


def statement_basis(text):
    """'consolidated' / 'standalone' as a statement page states it, else None."""
    m = _PAGE_BASIS.search(text or "")
    return m.group(1).lower() if m else None


def fmt_period(date):
    return "%04d-%02d-%02d" % tuple(date)


def current_ratio_line_pages(page_texts):
    """Pages carrying a 'Current Ratio' line with two or more decimals - the
    evidence that a note-not-in-document claim is wrong."""
    out = []
    for index, text in page_texts:
        for raw in (text or "").split("\n"):
            line = _SPLIT_DIGIT.sub(r"\1.\2", " ".join(raw.split()))
            if re.search(r"current\s+ratio", line, re.I) and \
                    len(re.findall(r"(?<![\d.])\d[\d,]*\.\d+", line)) >= 2:
                out.append(index)
                break
    return out


# #1420 / F-219: the reasons for which a value WAS read for the latest period
# and a rule then rejected it - REFUSED in the envelope, carrying the value.
# Every other null reason is a reader MISS (no note, no row, no readable or
# matching period heading): nothing was identified as the latest period's value.
REFUSAL_REASONS = frozenset([
    "ratio_value_out_of_range",
    "ratio_basis_differs_from_statement",
    "ratio_rows_disagree_for_latest_period",
])

_REFUSAL_ORDER = ["ratio_period_headings_unreadable", "ratio_heading_count_differs_from_value_count",
                  "ratio_latest_period_not_in_headings"]


def read_ratio(page_texts, key, latest_period, stored_basis=None):
    """The one value of ratio `key` for the latest restated statement period.

    `latest_period` is the (year, month, day) the stored net worth / EPS belong
    to; `stored_basis` their basis when the statement states it. Returns a dict:
    on success ``value``, ``page``, ``period``, ``period_label``, ``basis`` and
    ``headings``; otherwise ``value`` None and a named ``reason``.
    """
    pages = find_ratio_note_pages(page_texts)
    if not pages:
        return {"value": None, "reason": "ratio_note_not_in_document",
                "current_ratio_line_pages": current_ratio_line_pages(page_texts)}
    if latest_period is None:
        return {"value": None, "reason": "ratio_statement_period_unknown"}
    latest = tuple(latest_period)
    by_index = dict(page_texts)
    reads, refusals = [], []
    for index in pages:
        text = by_index.get(index) or ""
        lines = [" ".join(raw.split()) for raw in text.split("\n")]
        for at, line in enumerate(lines):
            match = _ROW_LABEL.match(line)
            if match:
                if _KEYS[" ".join(match.group("name").split()).lower()] != key:
                    continue
                values = row_values(line, match.end("name"))
            else:
                wrapped = wrapped_row(lines, at, key)
                if wrapped is None:
                    continue
                at, values = wrapped
            if not values:
                continue
            headings, header_at, reason = read_row_headings(lines, at, len(values), key)
            if headings is None:
                refusals.append(reason)
                continue
            dates = [d for d, _l in headings]
            if latest not in dates:
                refusals.append("ratio_latest_period_not_in_headings")
                continue
            col = dates.index(latest)
            bases = _column_bases(lines, header_at, at, len(values), text)
            reads.append({"value": values[col], "page": index, "period": fmt_period(latest),
                          "period_label": headings[col][1], "basis": bases[col],
                          "headings": [h[1] for h in headings]})
    if not reads:
        reason = next((r for r in _REFUSAL_ORDER if r in refusals), "ratio_row_not_in_note")
        return {"value": None, "reason": reason}
    if len({r["value"] for r in reads}) > 1:
        return {"value": None, "reason": "ratio_rows_disagree_for_latest_period",
                "refused_values": sorted({r["value"] for r in reads})}
    read = dict(reads[0])
    low, high = _RANGES.get(key, (0.0, 999.99))
    if not low <= read["value"] <= high:
        return {"value": None, "reason": "ratio_value_out_of_range", "read": read}
    if stored_basis and read["basis"] and read["basis"] != stored_basis:
        return {"value": None, "reason": "ratio_basis_differs_from_statement", "read": read}
    return read


def derive_quick_ratio(current_assets, inventories, current_liabilities):
    """(current assets - inventories) / current liabilities, or None.

    DERIVED, not read, because no issuer prints it - it is not a Schedule III
    ratio. Returns None rather than a number whenever an input is missing or the
    denominator is zero: a quick ratio computed from a guess is worse than an
    absent one, because it looks like the others.
    """
    try:
        ca, inv, cl = float(current_assets), float(inventories), float(current_liabilities)
    except (TypeError, ValueError):
        return None
    if cl == 0:
        return None
    return round((ca - inv) / cl, 2)
