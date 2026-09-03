"""Positional page-text extraction for exchange anchor-allocation letters (W-39).

WHY THIS EXISTS. An ANCHOR_ALLOCATION_REPORT is a scan of a signed letter. Its
embedded text layer carries the glyphs but no reading order, so `pdf-parse`'s
plain text interleaves the table: one investor's share count lands inside the
next investor's amount, and digits go missing from the row they belong to. Only
per-word coordinates can put the table back together, which is what pdfplumber
gives us and pdf-parse does not.

Three properties of these scans drive the design:

  * The page is skewed, so one y-band does NOT hold a row together across the
    full width - the serial number sits several points above the amount on the
    same line. Rows are rebuilt PER COLUMN, then matched by nearest row centre.
  * Column geometry is a property of the FILING, not of a page. Deriving bands
    per page let a stray numeric in the letterhead shift every column's meaning
    on page 1 while page 2 came out fine (round 1). Bands are therefore computed
    once over every page and then applied to each.
  * Within a cell the x order IS the digit order even when the scan has
    staggered the glyphs onto two baselines, so numeric cells are emitted in
    pure x order.

Output is a single JSON line on stdout (the extract_financials_pdf.py sidecar
convention):

    {"pages": ["# <serial> | <name> | <shares> | <pct> | <price> | <amount>", ...]}

Nothing here interprets the numbers. Character damage ("777.00" for "177.00",
"2 B2 486" for "2,82,486") is the TypeScript parser's problem.
"""

import json
import re
import sys

import pdfplumber

COL_GAP_PT = 15.0
ROW_GAP_PT = 7.0
BAND_PAD_PT = 4.0
ROW_ATTACH_PT = 11.0
MIN_NUMERIC_ROWS = 5
MIN_NUMERIC_SHARE = 0.6
SERIAL_RE = re.compile(r"^(\d{1,2})[.,)]?$")
NL = chr(10)


def _has_digit(text):
    return any(c.isdigit() for c in text)


def _clusters(items, key, gap):
    out = []
    for it in sorted(items, key=key):
        if out and key(it) - key(out[-1][-1]) <= gap:
            out[-1].append(it)
        else:
            out.append([it])
    return out


def _centre(group):
    return sum(w["top"] for w in group) / len(group)


def _in_band(words, band):
    lo, hi = band
    return [w for w in words if lo - BAND_PAD_PT <= w["x0"] <= hi + BAND_PAD_PT]


def _plain(words):
    """Free text (the letter body): y-bands, then left to right."""
    rows = _clusters(words, lambda w: w["top"], ROW_GAP_PT)
    return NL.join(
        " ".join(w["text"] for w in sorted(r, key=lambda w: w["x0"])) for r in rows
    )


def column_bands(pages_words):
    """The filing's column x-ranges, learned from every page at once.

    Only numeric cells are used: the name cell is prose whose words sit at every
    x, so clustering over all words smears the columns together. A band survives
    when it is numeric-dominant (that rejects the name column) and runs the
    height of a table on at least one page (that rejects the letterhead, a date,
    a phone number).
    """
    xs = [w["x0"] for words in pages_words for w in words if _has_digit(w["text"])]
    if not xs:
        return []
    bands = [(c[0], c[-1]) for c in _clusters(xs, lambda x: x, COL_GAP_PT)]

    scored = []
    for band in bands:
        numeric_rows = 0
        for words in pages_words:
            for row in _clusters(_in_band(words, band), lambda w: w["top"], ROW_GAP_PT):
                digits = sum(1 for w in row if _has_digit(w["text"]))
                if digits / len(row) >= MIN_NUMERIC_SHARE:
                    numeric_rows += 1
        if numeric_rows >= MIN_NUMERIC_ROWS:
            scored.append((band, numeric_rows))
    if not scored:
        return []
    # A table column carries a cell on nearly every row of the table. Prose that
    # happens to hold a few digits (an address, a date, a phone number) clears
    # the floor above but never comes close to that, so it is dropped here -
    # otherwise it would shift every column one place to the right.
    best = max(n for _, n in scored)
    return [(b, n) for b, n in scored if n >= max(MIN_NUMERIC_ROWS, 0.5 * best)]


def _cells(words, centres, numeric):
    """Split one column into cells and attach each to its nearest row centre."""
    cells = [[] for _ in centres]
    for group in _clusters(words, lambda w: w["top"], ROW_GAP_PT):
        c = _centre(group)
        idx = min(range(len(centres)), key=lambda i: abs(centres[i] - c))
        if abs(centres[idx] - c) <= ROW_ATTACH_PT:
            cells[idx].extend(group)
    if numeric:
        return [" ".join(w["text"] for w in sorted(c, key=lambda w: w["x0"])) for c in cells]
    return [_cell_text(c) for c in cells]


def _cell_text(words):
    """Reading order inside a wrapping NAME cell (W-81).

    A name cell holds one or two printed lines. The scan is skewed, so the words
    of ONE line do not share a `top`: across the ~150pt name column the baseline
    drifts several points. Sorting the cell by `(top, x0)` therefore interleaves
    the lines and scrambles the words - "MOTILAL OSWAL FINVEST / LIMITED" came
    out as "OSWAL OT] LAL FINVEST N4 LI I\4ITE D". Cluster the cell into its own
    sub-lines first (same y-gap rule as everywhere else), then read each
    sub-line left to right, top line first.
    """
    if not words:
        return ""
    lines = _clusters(words, lambda w: w["top"], ROW_GAP_PT)
    return " ".join(
        " ".join(w["text"] for w in sorted(line, key=lambda w: w["x0"]))
        for line in lines
    )


def page_text(words, bands):
    if not words:
        return ""
    if len(bands) < 3:
        return _plain(words)

    serial_band, value_bands = bands[0][0], [b for b, _ in bands[1:]]
    # The row spine is the column with a cell on the most rows - in practice the
    # share count, which is present on every investor row and (unlike the name)
    # never wraps onto a second line. Spining on a wrapping column splits one
    # investor across two output lines, which is how round 1 lost rows.
    spine_band = max(bands[1:], key=lambda item: item[1])[0]
    spine = _clusters(_in_band(words, spine_band), lambda w: w["top"], ROW_GAP_PT)
    if not spine:
        return _plain(words)
    centres = [_centre(g) for g in spine]

    name_lo, name_hi = serial_band[1] + BAND_PAD_PT, value_bands[0][0] - BAND_PAD_PT
    name_words = [w for w in words if name_lo <= w["x0"] < name_hi]
    serials = _cells(_in_band(words, serial_band), centres, numeric=True)
    names = _cells(name_words, centres, numeric=False)
    columns = [_cells(_in_band(words, b), centres, numeric=True) for b in value_bands]

    lines = []
    top_of_table = min(w["top"] for g in spine for w in g)
    preamble = [w for w in words if w["top"] < top_of_table - ROW_GAP_PT]
    if preamble:
        lines.append(_plain(preamble))
    for i in range(len(centres)):
        head = serials[i].split(" ")[0] if serials[i] else ""
        m = SERIAL_RE.match(head)
        lines.append(
            "# " + " | ".join([m.group(1) if m else "", names[i]] + [c[i] for c in columns])
        )
    return NL.join(lines)


def extract(path):
    with pdfplumber.open(path) as pdf:
        pages_words = [
            p.extract_words(y_tolerance=1, x_tolerance=1.5) for p in pdf.pages
        ]
    bands = column_bands(pages_words)
    return [page_text(w, bands) for w in pages_words]


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: anchor_report_text.py <pdf-path>"}))
        return 1
    try:
        pages = extract(sys.argv[1])
    except Exception as exc:  # noqa: BLE001 - the caller only needs the reason
        print(json.dumps({"error": "%s: %s" % (type(exc).__name__, exc)}))
        return 1
    print(json.dumps({"pages": pages}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
