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
_NOTE_HEADING = re.compile(r"\bfinancial\s+ratios\b", re.I)

# A row: <sr> <name> <numerator words> <denominator words> <value> <value> <variance%>
#
# The two values are captured as ONE span so the split-digit repair below can be
# applied to that span alone. Anchoring on the trailing variance percentage is
# what makes the span unambiguous - the reason column that follows is free prose
# of any length, so parsing from the end of the line is not reliable.
_ROW = re.compile(
    r"^\s*\d+\s+(?P<name>Current\s+Ratio|Inventory\s+turnover\s+Ratio)\b"
    r"(?P<mid>.*?)"
    r"(?P<vals>(?:\s+-?\d[\d,]*\s*\.\s*\d+|\s+-?\d[\d,]*\.\d+){2})"
    r"\s+(?P<var>-?[\d.]+\s*%)",
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
_NUMBER = re.compile(r"-?\d[\d,]*\.\d+")

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


def _values(span):
    return [float(n.replace(",", "")) for n in _NUMBER.findall(_SPLIT_DIGIT.sub(r"\1.\2", span))]


def read_printed_ratios(page_texts):
    """Return ``{"current_ratio": [...], "inventory_turnover": [...]}`` as printed.

    Values are returned in the order the note prints them, newest period first,
    and as floats rather than strings because a ratio has no unit or grouping to
    preserve - unlike the peer table, where digit grouping and percent signs are
    the persister's business.
    """
    out = {}
    for index in find_ratio_note_pages(page_texts):
        text = next((t for i, t in page_texts if i == index), "") or ""
        for line in text.split("\n"):
            match = _ROW.match(" ".join(line.split()))
            if not match:
                continue
            key = _KEYS[" ".join(match.group("name").split()).lower()]
            values = _values(match.group("vals"))
            if len(values) == 2:
                out.setdefault(key, []).extend(values)
    return out


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
