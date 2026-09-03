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


def _cell_groups(words, centres):
    """Split one column into cells, attaching each to its nearest row centre."""
    cells = [[] for _ in centres]
    for group in _clusters(words, lambda w: w["top"], ROW_GAP_PT):
        c = _centre(group)
        idx = min(range(len(centres)), key=lambda i: abs(centres[i] - c))
        if abs(centres[idx] - c) <= ROW_ATTACH_PT:
            cells[idx].extend(group)
    return cells


def _cells(words, centres, numeric):
    cells = _cell_groups(words, centres)
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


def page_rows(words, bands):
    """Split one page into its table rows. None when the page is not a table.

    Returns
        {"preamble": str,          # everything printed above the table
         "centres": [float],       # the y centre of each row, in points
         "serials": [str],         # serial cell, per row
         "names":   [str],         # name cell from the TEXT LAYER, per row
         "columns": [[str]],       # the numeric columns, each a list per row
         "name_band": (lo, hi)}    # the name column's x range, in points
    """
    if not words:
        return None
    if len(bands) < 3:
        return None

    serial_band, value_bands = bands[0][0], [b for b, _ in bands[1:]]
    # The row spine is the column with a cell on the most rows - in practice the
    # share count, which is present on every investor row and (unlike the name)
    # never wraps onto a second line. Spining on a wrapping column splits one
    # investor across two output lines, which is how round 1 lost rows.
    spine_band = max(bands[1:], key=lambda item: item[1])[0]
    spine = _clusters(_in_band(words, spine_band), lambda w: w["top"], ROW_GAP_PT)
    if not spine:
        return None
    centres = [_centre(g) for g in spine]

    name_lo, name_hi = serial_band[1] + BAND_PAD_PT, value_bands[0][0] - BAND_PAD_PT
    name_words = [w for w in words if name_lo <= w["x0"] < name_hi]
    name_groups = _cell_groups(name_words, centres)
    top_of_table = min(w["top"] for g in spine for w in g)
    preamble = [w for w in words if w["top"] < top_of_table - ROW_GAP_PT]
    return {
        "preamble": _plain(preamble) if preamble else "",
        "centres": centres,
        "serials": _cells(_in_band(words, serial_band), centres, numeric=True),
        "names": [_cell_text(g) for g in name_groups],
        "name_groups": name_groups,
        "columns": [_cells(_in_band(words, b), centres, numeric=True) for b in value_bands],
        "name_band": (name_lo, name_hi),
    }


def render_rows(rows):
    """The `# serial | name | value | ...` page text the TS parser consumes."""
    lines = []
    if rows["preamble"]:
        lines.append(rows["preamble"])
    for i in range(len(rows["centres"])):
        head = rows["serials"][i].split(" ")[0] if rows["serials"][i] else ""
        m = SERIAL_RE.match(head)
        lines.append("# " + " | ".join(
            [m.group(1) if m else "", rows["names"][i]] + [c[i] for c in rows["columns"]]))
    return NL.join(lines)


def page_text(words, bands):
    if not words:
        return ""
    rows = page_rows(words, bands)
    return render_rows(rows) if rows else _plain(words)


# --------------------------------------------------------------------------- #
# W-89 — the scanned-report path
#
# Some of these letters carry a DAMAGED machine-OCR text layer rather than a
# clean one: the glyphs themselves are wrong (M -> "N4", I -> "]", W -> "I\4",
# % -> "o/o"), so no amount of positional work recovers the investor NAMES.
# The numeric columns survive that damage well enough to reconcile (the
# published totals check out), and only the name column is unreadable.
#
# So: keep every number from the text layer, and read the names again from the
# pixels — render the page, OCR it with word boxes, and attach each OCR word to
# the text-layer row whose y centre it sits on.
# --------------------------------------------------------------------------- #
NAME_QUALITY_FLOOR = 0.3
OCR_DPI = 300

# Words a run of OCR letter-shrapnel is allowed to be re-joined into. Anything
# outside this list is NOT invented: "M OTI LA OS WA" stays as it is and the
# row stays flagged, because "MOTILAL OSWAL" is a guess, not a read.
JOIN_DICTIONARY = (
    "OPPORTUNITIES", "SECURITIES", "MAURITIUS", "MARKETS", "PRIVATE", "CAPITAL",
    "LIMITED", "MUTUAL", "GLOBAL", "SERIES", "EQUITY", "TRUST", "INDIA", "FUND",
    "PVT", "LTD",
)
MAX_JOIN_FRAGMENT = 3

_NAME_ALLOWED_RE = re.compile(r"[^A-Za-z0-9 .,&()'/-]")
_DIGIT_IN_WORD_RE = re.compile(r"[A-Za-z]\d|\d[A-Za-z]")
_SHORT_TOKEN_RE = re.compile(r"^[A-Za-z]{1,2}$")
_REAL_WORD_RE = re.compile(r"^[A-Za-z]{3,}$")
_DANGLING_SERIES_RE = re.compile(r"\b(SERIES|ACCOUNT)\s*$", re.IGNORECASE)

# Short tokens (<=2 letters) legitimately appearing in real entity names --
# country/currency/legal-form abbreviations. A short token in this list does
# not count toward the "run of OCR-shrapnel tokens" signal below.
SHORT_TOKEN_ALLOWLIST = {
    "OF", "&", "AND", "CO", "LTD", "PTE", "PLC", "LP", "LLC", "LLP", "SA", "AG", "NV", "BV", "SE",
    "AB", "AS", "OY", "KK", "DE", "LA", "LE", "DU", "ON", "IN", "TO", "BY", "UK", "US", "UAE", "ODI",
    "FPI", "FII", "MF", "IT", "II", "III", "IV", "VI", "PE", "VC", "HK", "SG", "CH",
}

# The minimum consecutive run of non-allow-listed 1-2 letter tokens that reads
# as OCR shrapnel rather than a real short-form name (W-89b: a run of 4 single
# letters was the old bar; word-fragment shrapnel is often 1-2 letters, not
# always exactly 1, so the run is measured on token length <= 2).
SHRAPNEL_RUN_THRESHOLD = 4


def is_low_confidence_name(name):
    """Python port of `isLowConfidenceName` in src/services/anchor-persister.ts.

    Kept deliberately identical so the extractor's own judgement of "this name
    did not read" is the same judgement the persister's publication gate makes.
    A name is low-confidence when OCR left it with characters no registered
    investor name contains, too short to be a real entity name, or shaped like
    word-fragment shrapnel (W-89b): a run of short OCR-split tokens, a lone
    "0"/"1" standing in for a misread "O"/"I" between two words, too few real
    words to be an entity name, or a dangling "SERIES"/"ACCOUNT" fragment with
    no identifier after it.
    """
    n = (name or "").strip()
    if len(n) < 4:
        return True
    if _NAME_ALLOWED_RE.search(n):
        return True
    if _DIGIT_IN_WORD_RE.search(n):
        return True

    tokens = n.split()

    # A run of short (<=2 letter) tokens is OCR letter/word shrapnel
    # ("M OTI LA FI NV E ST LI M ITE D", "GI RI K M"), not a real name --
    # unless most of the run is legitimate short-form abbreviations.
    short_run = []
    for t in tokens + [""]:
        if _SHORT_TOKEN_RE.match(t):
            short_run.append(t)
        else:
            non_allowed = [s for s in short_run if s.upper() not in SHORT_TOKEN_ALLOWLIST]
            if len(non_allowed) >= SHRAPNEL_RUN_THRESHOLD:
                return True
            short_run = []

    # A lone "0" or "1" standing between two word tokens is a misread "O"/"I"
    # ("CTI 0 N" for "CONVICTION", "AS 0 KA" for "ASOKA") -- real names never
    # isolate a single digit between two letter-only tokens.
    for i in range(1, len(tokens) - 1):
        if (
            tokens[i] in ("0", "1")
            and tokens[i - 1].isalpha()
            and tokens[i - 1].isascii()
            and tokens[i + 1].isalpha()
            and tokens[i + 1].isascii()
        ):
            return True

    # Fewer than 2 real (3+ letter) words means the string is a fragment, not
    # an entity name ("SERIES 1", "ACCOU NT" -- a word split by OCR into two
    # pieces, one too short to count).
    real_words = sum(1 for t in tokens if _REAL_WORD_RE.match(re.sub(r"[^A-Za-z]", "", t)))
    if real_words < 2:
        return True

    # A name that trails off in a bare "SERIES"/"ACCOUNT" with no identifier
    # after it is an incomplete OCR read of a series/account-linked investor.
    if _DANGLING_SERIES_RE.search(n):
        return True

    letters = sum(1 for c in n if c.isalpha())
    return letters / float(len(n)) < 0.6


def low_confidence_share(names):
    """Share of rows whose name is unreadable (blank rows count as unreadable)."""
    if not names:
        return 0.0
    bad = sum(1 for n in names if is_low_confidence_name(n))
    return bad / float(len(names))


def _segment(blob):
    """Split `blob` into dictionary words, or None when it does not split.

    Word-break DP, not greedy: greedy longest-match fails on the overlaps this
    dictionary has ("SECURITIESERIES"-style tails).
    """
    n = len(blob)
    best = [None] * (n + 1)
    best[0] = []
    for i in range(1, n + 1):
        for word in JOIN_DICTIONARY:
            j = i - len(word)
            if j >= 0 and best[j] is not None and blob[j:i] == word:
                best[i] = best[j] + [word]
                break
    return best[n]


def join_letter_runs(text):
    """Re-join OCR letter shrapnel, but only into words we can name.

    "F U N D" -> "FUND" and "L I M I T E D" -> "LIMITED", because those are in
    the dictionary. "M OTI LA OS WA" is left alone: joining it to "MOTILAL
    OSWAL" would be inventing three characters the OCR never read.
    """
    tokens = (text or "").split()
    out, run = [], []

    def flush():
        if not run:
            return
        if len(run) > 1:
            parts = _segment("".join(run))
            if parts:
                out.extend(parts)
                return
        out.extend(run)

    for token in tokens:
        if token.isalpha() and token.isupper() and len(token) <= MAX_JOIN_FRAGMENT:
            run.append(token)
            continue
        flush()
        del run[:]
        out.append(token)
    flush()
    return " ".join(out)


def _overlap(a0, a1, b0, b1):
    return max(0.0, min(a1, b1) - max(a0, b0))


def _row_tolerance(centres):
    gaps = [b - a for a, b in zip(centres[:-1], centres[1:]) if b - a > 0]
    median_gap = sorted(gaps)[len(gaps) // 2] if gaps else 2 * ROW_ATTACH_PT
    return max(ROW_ATTACH_PT, 0.5 * median_gap)


def _nearest_row(top, x0, text, centres, name_band):
    """Row index for an OCR word that overlapped no text-layer name word."""
    lo, hi = name_band
    if not (lo <= x0 < hi):
        return None
    # A serial that the OCR drew slightly wider than the printed column would
    # otherwise be adopted as the first word of the name ("1. NOMURA ...").
    if SERIAL_RE.match(text):
        return None
    idx = min(range(len(centres)), key=lambda i: abs(centres[i] - top))
    return idx if abs(centres[idx] - top) <= _row_tolerance(centres) else None


def ocr_name_cells(ocr_lines, name_groups, centres=None, name_band=None):
    """Attach OCR words to rows by OVERLAP with the text layer's own name words.

    `ocr_lines` is `ocr_pages.ocr_pdf_page_boxes(...)["lines"]` — boxes already
    converted to PDF points, the same frame pdfplumber reports.

    Why overlap and not "nearest row centre": the damage in these text layers is
    in the GLYPHS, never in the geometry, so the text layer already knows where
    every name word sits and which row it belongs to. Matching against those
    boxes is self-correcting — it cannot pull a serial number into a name (a
    serial is not a name word) and it cannot drop a wrapped second line onto the
    row above (the measured failure of centre-matching: row 8 swallowed row 9's
    "MAYBANK SECURITIES PTE LTD"). An OCR word overlapping no name word is
    dropped, UNLESS the fallback below can place it.

    The fallback (`centres` + `name_band` given): a row whose name the text layer
    lost entirely has no boxes to overlap, and without it that row's OCR name
    lands on the row below — DEEPA row 4, "TATA INDIA CONSUMER FUND". Such a word
    is attached to the nearest row centre, guarded by the same `x0` name-column
    test the text layer applies, so it still cannot pull in a serial or a number.
    """
    cells = [[] for _ in name_groups]
    placed = [(i, w) for i, group in enumerate(name_groups) for w in group]
    for line in ocr_lines:
        for word in line.get("words", []):
            x0, top, x1, bottom = word["box"]
            best_idx, best_area = None, 0.0
            for i, w in placed:
                area = (_overlap(x0, x1, w["x0"], w["x1"])
                        * _overlap(top, bottom, w["top"], w["bottom"]))
                if area > best_area:
                    best_idx, best_area = i, area
            if best_idx is None and centres and name_band:
                best_idx = _nearest_row(top, x0, word["text"], centres, name_band)
            if best_idx is not None:
                cells[best_idx].append((top, x0, word["text"]))
    out = []
    for cell in cells:
        # Same rule as the text layer: sub-lines top to bottom, words within a
        # sub-line left to right.
        lines_of_cell, current = [], []
        for top, x0, text in sorted(cell):
            if current and top - current[0][0] > ROW_GAP_PT:
                lines_of_cell.append(current)
                current = []
            current.append((top, x0, text))
        if current:
            lines_of_cell.append(current)
        out.append(" ".join(
            " ".join(t for _top, _x, t in sorted(ln, key=lambda it: it[1]))
            for ln in lines_of_cell))
    return out


def apply_ocr_names(rows, ocr_lines):
    """Replace a page's unreadable name column with the OCR read of it.

    Per row, the text-layer name is kept when the OCR read of that row is itself
    unreadable and the text-layer one is not — the OCR route exists to recover
    names, never to downgrade one that already reads.
    """
    ocr_names = ocr_name_cells(
        ocr_lines, rows["name_groups"], rows["centres"], rows["name_band"])
    names = []
    for i, existing in enumerate(rows["names"]):
        candidate = join_letter_runs(ocr_names[i]) if i < len(ocr_names) else ""
        # Only INVESTOR rows (the ones carrying a serial) are re-read. The
        # table's own "Total" line and its column headings read fine from the
        # text layer, and the OCR degrades them: it read "Total" as "Tota",
        # which the parser then took for a 16th investor and refused the whole
        # letter.
        if not SERIAL_RE.match((rows["serials"][i] or "").split(" ")[0]):
            names.append(existing)
        elif not candidate:
            names.append(existing)
        elif is_low_confidence_name(candidate) and not is_low_confidence_name(existing):
            names.append(existing)
        else:
            names.append(candidate)
    rows = dict(rows)
    rows["names"] = names
    return rows


def extract(path, ocr=True):
    with pdfplumber.open(path) as pdf:
        pages_words = [
            p.extract_words(y_tolerance=1, x_tolerance=1.5) for p in pdf.pages
        ]
    bands = column_bands(pages_words)
    pages = [page_rows(w, bands) for w in pages_words]

    scanned = [
        i for i, rows in enumerate(pages)
        if rows and low_confidence_share(rows["names"]) > NAME_QUALITY_FLOOR
    ]
    if ocr and scanned:
        import ocr_pages  # local: the OCR stack is only needed on damaged scans

        if ocr_pages.backend_available():
            for page in ocr_pages.ocr_pdf_page_boxes(path, scanned, dpi=OCR_DPI):
                pages[page["page"]] = apply_ocr_names(pages[page["page"]], page["lines"])

    return [
        render_rows(rows) if rows else (_plain(w) if w else "")
        for rows, w in zip(pages, pages_words)
    ]


def main():
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not argv:
        print(json.dumps({"error": "usage: anchor_report_text.py <pdf-path> [--no-ocr]"}))
        return 1
    try:
        pages = extract(argv[0], ocr="--no-ocr" not in sys.argv[1:])
    except Exception as exc:  # noqa: BLE001 - the caller only needs the reason
        print(json.dumps({"error": "%s: %s" % (type(exc).__name__, exc)}))
        return 1
    print(json.dumps({"pages": pages}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
