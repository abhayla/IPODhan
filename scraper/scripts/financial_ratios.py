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
_NOTE_HEADING = re.compile(
    r"\bfinancial\s+ratios\b|\bratio\s+analysis\b|\bstatement\s+of\s+ratios\b", re.I
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
        heading = bool(_NOTE_HEADING.search(text))
        continues = bool(pages) and index - 1 == pages[-1] and _has_ratio_row(text)
        if heading or continues:
            pages.append(index)
    return pages


def _has_ratio_row(text):
    return any(_ROW.match(" ".join(line.split())) for line in (text or "").split("\n"))


def _row_values(line, match):
    """The ratio columns of one matched row, newest period first.

    #771 review round 1. The row's regex span is NOT the ratio columns: an
    issuer that prints its numerator and denominator AMOUNTS ("Current Assets
    1,234.56 Current Liabilities 987.65 1.25 1.10 13.6%") puts a number right
    in front of the ratios, and the lazy `mid` hands it to `vals`. So the
    columns are rebuilt from the structure Schedule III fixes instead:

      - the ratios are the TRAILING run of decimal numbers before the first
        variance column (the numbers after the last non-numeric word);
      - a note prints one variance column per consecutive pair of periods, so
        N variance columns mean N + 1 period values. The run is cut to its
        LAST N + 1 numbers; anything in front of them is an amount.

    Measured on the four real layouts: Prasol and A-One Steels print one
    variance and two periods; German Green Steel and Green Asia Impex print two
    variances and three periods.
    """
    before = _SPLIT_DIGIT.sub(r"\1.\2", line[match.end("name"):match.start("var")])
    run = []
    for token in reversed(before.split()):
        if not _WHOLE_NUMBER.match(token):
            break
        run.append(float(token.replace(",", "")))
    run.reverse()
    variances = 0
    at = match.start("var")
    while True:
        found = _VARIANCE.match(line, at)
        if not found or found.end() == at:
            break
        variances += 1
        at = found.end()
    periods = variances + 1
    return run[-periods:] if len(run) > periods else run


def read_printed_ratio_rows(page_texts):
    """``{"current_ratio": [(values, page), ...], ...}``: each matched row with
    the page it was READ from. #771: `ratio_page` names that page, not the
    first page of the note - on all four real prospectuses the first page was
    boilerplate, not the row."""
    out = {}
    for index in find_ratio_note_pages(page_texts):
        text = next((t for i, t in page_texts if i == index), "") or ""
        for raw in text.split("\n"):
            line = " ".join(raw.split())
            match = _ROW.match(line)
            if not match:
                continue
            key = _KEYS[" ".join(match.group("name").split()).lower()]
            values = _row_values(line, match)
            if len(values) >= 2:
                out.setdefault(key, []).append((values, index))
    return out


def read_printed_ratios(page_texts):
    """Return ``{"current_ratio": [...], "inventory_turnover": [...]}`` as printed.

    Values are returned in the order the note prints them, newest period first,
    and as floats rather than strings because a ratio has no unit or grouping to
    preserve - unlike the peer table, where digit grouping and percent signs are
    the persister's business.
    """
    return {key: [v for values, _page in rows for v in values]
            for key, rows in read_printed_ratio_rows(page_texts).items()}


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
