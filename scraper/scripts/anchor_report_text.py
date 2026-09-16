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
import os
import re
import sys

# Round 4: import (and thereby pin BLAS/OMP thread env vars) BEFORE pdfplumber
# and, later at runtime, before the OCR route's lazy numpy/cv2 imports inside
# `ocr_pages` — see memory_guard.py's module-level `_pin_blas_thread_env()`.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import memory_guard  # noqa: E402
import box_lock  # noqa: E402 — light, safe to import first (W-178c round 2)
from json_safe import strip_nul_bytes  # noqa: E402

import pdfplumber  # noqa: E402

# W-178c round 2: this sidecar's own wait, independent of extract_filing.py's
# EXTRACTOR_LOCK_WAIT_S — the node caller's sidecar timeout is 120s
# (anchor-investors-scraper.ts), so the lock wait must leave enough of that
# budget for the actual page-text extraction that follows.
DEFAULT_ANCHOR_LOCK_WAIT_S = 20


def _anchor_lock_wait_s():
    raw = os.environ.get("ANCHOR_LOCK_WAIT_S")
    if raw is None:
        return DEFAULT_ANCHOR_LOCK_WAIT_S
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_ANCHOR_LOCK_WAIT_S
    return value if value >= 0 else DEFAULT_ANCHOR_LOCK_WAIT_S

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


def has_name_shaped_word(name):
    """True when the cell holds something that could be part of an entity name.

    A run of two or more letters. Deliberately weaker than
    `is_low_confidence_name`: this asks "did the text layer give us ANY name
    material at all?", not "is this name good enough to publish".
    """
    return bool(re.search(r"[A-Za-z]{2,}", name or ""))


def page_needs_ocr(rows, words=None):
    """Should this page be re-read by OCR?

    Three triggers:

      1. Original: more than `NAME_QUALITY_FLOOR` of the rows carry a name the
         publication gate would reject — the historical "the scan's text layer
         is damaged" case.
      2. W-139 (Lumino, MAINBOARD): the page HAS table rows but not one of them
         yields a name-shaped word — every name cell is blank or pure
         punctuation/digits. `low_confidence_share` returns 0.0 for an empty
         name list, so a page like this scored PERFECTLY and never reached OCR;
         the letter then parsed to nothing and the document sat at PENDING
         forever. A page with no name material at all is the strongest possible
         signal that the text layer failed.
      3. W-170 (Qualiance, NSE Emerge): the page has NO text layer at all - not
         damaged glyphs, not blank cells, zero words. `page_rows` returns None
         for it (there is nothing to band into rows), which used to read as "no
         table here" and skip OCR entirely - the letter then parsed to nothing
         and the document sat at PENDING forever, same failure mode as #2 for a
         different reason. `words` (the page's raw `extract_words()` output,
         passed by the caller) distinguishes this from every other `rows is
         None` page: a boilerplate/prose page with no table still has words: a
         page whose PDF content stream is an image and nothing else has none.

    Trigger 3 needs `words` explicitly because `rows is None` alone is
    ambiguous (see the docstring note below); triggers 1-2 are decided from
    `rows` alone and ignore `words` (kept optional for callers that don't have
    it, e.g. the unit tests in test_anchor_report_text_ocr_gate.py).

    A page with no table rows AND some words (prose, a signature block, a page
    whose columns didn't band into a table) is NOT flagged here:
    `apply_ocr_names` needs the text layer's row geometry to place the OCR
    read, so a page with no rows and no words to rebuild from has nothing to
    attach a name-only OCR pass to. `extract()` instead rebuilds trigger-3
    pages' full row geometry from the OCR word boxes themselves (see
    `ocr_full_page_rows`) rather than routing them through `apply_ocr_names`.
    """
    if not rows:
        return words is not None and len(words) == 0
    names = rows["names"]
    if low_confidence_share(names) > NAME_QUALITY_FLOOR:
        return True
    return bool(names) and not any(has_name_shaped_word(n) for n in names)


def ocr_full_page_rows(ocr_lines):
    """Rebuild a page's ENTIRE row geometry from OCR word boxes (W-170, #437).

    `apply_ocr_names` repairs only the name column, because it needs the text
    layer's row centres and name-band geometry to place OCR words. A page with
    a genuinely empty text layer (Qualiance, LCC, JSIPL, LUMINO, HEROMOTORS:
    0 pdfplumber words, one full-page image per page) has no such geometry to
    reuse - there is no "row 4" to attach an OCR name to until the table itself
    is rebuilt.

    W-170 rebuilt it by feeding the OCR boxes back through `column_bands` /
    `page_rows`, the pdfplumber text-layer pipeline. #437 measured that on five
    real NSE letters and found it wrong in both directions - None on the real
    table page, invented rows on the cover page - so the rebuild is now the
    header-anchored `ocr_table_page_rows` below. This name is kept as the
    module's entry point for "rebuild a page with no text layer"; only the
    implementation behind it changed.
    """
    return ocr_table_page_rows(ocr_lines)


# --------------------------------------------------------------------------- #
# #437 - the image-scan table rebuild
#
# `ocr_full_page_rows` above (W-170) reused `column_bands`/`page_rows`, which
# were written for a pdfplumber TEXT layer. On a pure image scan that reuse
# fails in both directions, measured on five real NSE letters:
#
#   * On the real TABLE page it returns None (LCC page 2, HEROMOTORS pages
#     2-4): OCR emits one box per printed CELL, not per word, so a numeric
#     column is a handful of wide boxes whose x0 values never cluster into
#     >=3 bands each carrying >=5 numeric rows.
#   * On the COVER page it hallucinates rows (LCC 20, JSIPL 14, LUMINO 34):
#     the letterhead phone numbers, PIN codes and dates are digits at many x
#     positions, which DO band, so prose fragments came out as investor names
#     and the TS parser then refused the whole letter at zero investor rows.
#
# The rebuild below is geometric and HEADER-ANCHORED instead. A page yields
# rows only when its OCR lines carry the printed table header vocabulary, and
# the columns are the header own cells - never a clustering of whatever digits
# happen to sit on the page. That makes a cover page structurally incapable of
# producing a row, which is the half of the bug that mattered most, and it
# reads the table page the old code could not see at all.
# --------------------------------------------------------------------------- #

# Header cell vocabulary, as (role, patterns). A header block is recognised
# when at least MIN_HEADER_ROLES distinct roles match AND the shares role is
# among them. Patterns match the OCR text with ALL whitespace removed, because
# the OCR splits printed words at random (S ha res / Total anmount / No of Equ
# ity / % ofAnchor) - space-insensitive matching is the only rule that survived
# that damage on all five letters.
HEADER_ROLES = (
    ("serial", (r"^s\.?no\.?$", r"^sr\.?$", r"^sr\.?no\.?$", r"^s\.?$", r"^no\.?$")),
    ("name", (r"nameofthe?anchorinvestors?", r"nameofanchorinvestors?",
              r"nameofthe", r"nameofanchor")),
    ("shares", (r"no\.?ofequityshares?", r"equitysharesallocated",
                r"no\.?ofequity", r"sharesallocated", r"equityshares",
                r"^shares$", r"^sharesallocated$")),
    ("percent", (r"%ofanchor", r"asa%of", r"allocatedasa", r"anchorinvestorportion",
                 r"%oftheanchor", r"^%of$")),
    ("price", (r"bidprice", r"allocationprice", r"anchorinvestorallocation",
               r"perequityshare", r"rs?\.?perequity", r"^bid$")),
    ("amount", (r"totala[nm]{1,2}ount", r"amountallocated", r"^totalamount$",
                r"allocatedin")),
)
MIN_HEADER_ROLES = 3
# How far below the topmost header line the header block can still run. These
# printed headers wrap into 3-6 OCR lines, and the first data row follows
# within a line or two of the last of them.
HEADER_BLOCK_PT = 72.0
# Largest y gap between two consecutive header-label lines that still keeps
# them in one header block. LCC's header prints "Total Amount" 22.8pt above
# "S. No." while its first investor row is 46pt below the last label line, so
# the threshold sits between the two.
HEADER_GAP_PT = 30.0
# A data cell centre must land within this of a column anchor to be assigned
# to it. Deliberately wider than a printed half-column: the OCR box for a
# 12-character amount is drawn wider than the header cell above it.
COLUMN_ATTACH_PT = 46.0
# Lines closer than this in y belong to the same table row band.
OCR_ROW_GAP_PT = 9.0
# Widest an OCR line may be and still be a header CELL. A header block window
# can overlap the preamble sentence above the table ("...have finalized
# allocation of 40,28,400, to Anchor Investors at..."), which is 400+ points
# wide; its centre invented a phantom column that swallowed the name column
# (JSIPL, where every share count and name came out blank).
MAX_HEADER_CELL_PT = 130.0
# Widest a DATA line may be and still be a table cell. Below the table every
# letter prints full-width closing prose, and those lines were voting for the
# name column - which on JSIPL moved `name_idx` onto the share column.
MAX_DATA_CELL_PT = 210.0
# Fewest long-integer cells a column must carry to be taken for the share
# column. Two is the real floor: LCC's Life Insurance sub-table prints ONE
# investor row, and a letter with a single anchor investor is a real case
# (#437's "only 1 investor rows" class), so the spine must form at 1 - but a
# stray pair of digits in a footer must not. The table-header gate above
# already guarantees this is a real table, so 1 is safe here.
MIN_SPINE_CELLS = 1
# A percent cell the scan printed without its "%". The OCR scatters spaces
# THROUGH the digits of these letters ("1 3 .35" for 13.35, "2 6.69" for
# 26.69), so the test is applied to the cell with its spaces removed: at most
# two integer digits, one decimal separator, at most two decimals, and no
# thousands grouping. Kept tight on purpose - a share count or an amount must
# never be re-labelled as a percentage.
_PLAIN_PERCENT_RE = re.compile(r"^[0-9]{1,3}[.,][0-9]{1,2}$|^[0-9]{1,2}$")


def _looks_like_bare_percent(text):
    compact = re.sub(r"\s+", "", text or "")
    if not _PLAIN_PERCENT_RE.match(compact):
        return False
    try:
        value = float(compact.replace(",", "."))
    except ValueError:
        return False
    return 0.0 < value <= 100.0

TOTAL_RE = re.compile(r"^(grand\s*)?tota[lI1]?s?\.?$", re.IGNORECASE)
_NUMERIC_CELL_RE = re.compile(r"^[\d\s.,%()/R-]+$", re.IGNORECASE)
_PREAMBLE_TOTAL_RE = re.compile(
    r"allocation\s+of\s+([0-9][0-9,\s.]{4,}?)\s*,?\s*(?:Equity\s+Shares|to\s+Anchor)",
    re.IGNORECASE)


def _squash(text):
    return re.sub(r"\s+", "", (text or "")).lower()


def _line_geometry(line):
    """(x0, top, x1, bottom) of an OCR line box (a 4-point polygon)."""
    xs = [p[0] for p in line["box"]]
    ys = [p[1] for p in line["box"]]
    return min(xs), min(ys), max(xs), max(ys)


def _header_block(lines):
    """The lines forming the printed table header, plus its top y - or None.

    The header is a BLOCK, so roles are collected over a y window rather than
    demanded of a single line: "No. of Equity" and "S ha res" are two OCR
    lines of one printed cell.
    """
    def roles_of(line):
        squashed = _squash(line["text"])
        return set(role for role, patterns in HEADER_ROLES
                   if any(re.search(p, squashed) for p in patterns))

    # Every line that reads as part of a column label, in page order. A printed
    # header cell wraps into several such lines ("No. of Equity" / "S ha res"),
    # and different cells of one header sit at the SAME y, so the header is
    # found as the longest run of these lines with no long unlabelled gap -
    # never as a fixed y window, which on a tight table swallowed the first
    # four investor rows.
    # Only SHORT lines can be column labels. Full-width prose above the table
    # ("Re: Initial public offering of equity shares...", "...at the Anchor
    # Investor Allocation Price of 146/- per Equity Share") matches the same
    # vocabulary and would otherwise join the header run and drag its top
    # 120pt up into the letter body.
    labelled = [(ln, _line_geometry(ln)[1], roles_of(ln)) for ln in lines
                if _line_geometry(ln)[2] - _line_geometry(ln)[0] <= MAX_HEADER_CELL_PT]
    labelled = [item for item in labelled if item[2]]
    if not labelled:
        return None
    labelled.sort(key=lambda item: item[1])

    best = None
    run = []
    for item in labelled + [(None, float("inf"), set())]:
        if run and item[1] - run[-1][1] > HEADER_GAP_PT:
            top = run[0][1]
            roles = set().union(*[r for _ln, _t, r in run])
            # The shares role is the spine of every one of these tables; a run
            # without it is prose that happened to hold "Bid Price".
            if "shares" in roles and len(roles) >= MIN_HEADER_ROLES:
                block = [ln for ln, _t, _r in run]
                # Bring in the unlabelled cells sitting inside the run's own
                # y span - "Portion", "(Rs.)", "Allocated" are header cells
                # whose text carries no role word of its own.
                lo = run[0][1] - 1.0
                hi = run[-1][1] + 1.0
                ids = set(id(ln) for ln in block)
                block += [ln for ln in lines
                          if id(ln) not in ids and lo <= _line_geometry(ln)[1] <= hi]
                score = (len(roles), -top)
                if best is None or score > best[0]:
                    best = (score, block, top)
            run = []
        if item[0] is not None:
            run.append(item)
    return (best[1], best[2]) if best else None


def _column_anchors(header_block):
    """x centre of each header cell, left to right, merged where they overlap.

    The header own cells are the columns. A cover page has no header, so it
    never reaches here - the structural fix for the hallucinated rows.
    """
    # Header cells only: short AND non-numeric. The header window is generous
    # (these printed headers wrap 3-6 OCR lines deep and the first data row can
    # follow immediately), so it can reach over the first investor rows; their
    # numeric cells must not be mistaken for column labels.
    cells = [ln for ln in header_block
             if _line_geometry(ln)[2] - _line_geometry(ln)[0] <= MAX_HEADER_CELL_PT
             and not _is_numeric_cell((ln["text"] or "").strip())]
    centres = sorted(0.5 * (_line_geometry(ln)[0] + _line_geometry(ln)[2])
                     for ln in cells)
    merged = []
    for c in centres:
        if merged and c - merged[-1][-1] <= COLUMN_ATTACH_PT:
            merged[-1].append(c)
        else:
            merged.append([c])
    return [sum(g) / len(g) for g in merged]


def _preamble_total(lines, header_top):
    """The letter own printed total-shares figure, from its preamble.

    The TS parser reconciles the summed investor rows against this, so a page
    printing it must pass it through or the reconciliation has no input.
    """
    for ln in lines:
        if _line_geometry(ln)[1] >= header_top:
            continue
        m = _PREAMBLE_TOTAL_RE.search(ln["text"])
        if m:
            return re.sub(r"\s+", "", m.group(1)).strip(".,")
    return None


def _row_bands(data_lines):
    """Cluster data lines into row bands by y centre."""
    entries = []
    for ln in data_lines:
        x0, top, x1, bottom = _line_geometry(ln)
        entries.append({"text": (ln["text"] or "").strip(), "x0": x0, "x1": x1,
                        "centre": 0.5 * (top + bottom)})
    entries.sort(key=lambda e: e["centre"])
    bands = []
    for e in entries:
        if bands and e["centre"] - bands[-1][-1]["centre"] <= OCR_ROW_GAP_PT:
            bands[-1].append(e)
        else:
            bands.append([e])
    return bands


def _assign_column(entry, anchors):
    centre = 0.5 * (entry["x0"] + entry["x1"])
    idx = min(range(len(anchors)), key=lambda i: abs(anchors[i] - centre))
    return idx if abs(anchors[idx] - centre) <= COLUMN_ATTACH_PT else None


def _is_numeric_cell(text):
    return bool(text) and bool(_NUMERIC_CELL_RE.match(text)) and any(
        c.isdigit() for c in text)


# A row is anchored on its SHARES cell, never on a y band of everything.
#
# Measured on all five letters: the numeric cells of one investor sit on (or
# within a point or two of) the printed row's first baseline, while the NAME
# wraps two or three lines further down, well past any y-gap threshold. Banding
# by y alone therefore either splits one investor across two rows (JSIPL, where
# two investors' numerics landed in one band) or attaches a wrapped name to the
# row below it (LCC). So: find the share-column cells first - they are the
# spine, one per investor - and assign every other cell, numeric or name, to
# the spine row whose own y span it falls in. That is how the printed table
# reads, and it is stable against both the skew and the OCR line splitting.
#
# A cell belongs to the spine row it is NEAREST to, except that it may never be
# pulled UP past the midpoint between two spine cells - a wrapped name always
# belongs to the row it sits below, never to the one below it.


def _column_cells(bands, anchors, idx):
    out = []
    for band in bands:
        for e in band:
            if _assign_column(e, anchors) == idx:
                out.append(e)
    return sorted(out, key=lambda e: e["centre"])


def _share_column(bands, anchors, name_idx):
    """The column index whose cells are share counts (the row spine).

    In the printed order of every one of these letters the share count is the
    FIRST long-integer column right of the name: name | shares | % | price |
    amount. The amount column also carries long integers - and more of them,
    since a share cell is more often broken by the OCR - so picking "the most
    long-integer cells" chose the AMOUNT column on LCC and merged pairs of
    investors into one row. Leftmost-that-qualifies is the rule the printed
    layout actually guarantees, and it holds on GLOTTIS too, which prints no
    price column at all.
    """
    for idx in range(len(anchors)):
        if idx <= name_idx:
            continue
        score = 0
        for e in _column_cells(bands, anchors, idx):
            digits = re.sub(r"[^0-9]", "", e["text"])
            if _is_numeric_cell(e["text"]) and len(digits) >= 4 and "%" not in e["text"]:
                score += 1
        if score >= MIN_SPINE_CELLS:
            return idx
    return None


def ocr_table_page_rows(ocr_lines):
    """Rebuild one scanned page table from its OCR line boxes (#437).

    Returns the shape `page_rows` returns, so `render_rows` and the TypeScript
    parser downstream are unchanged - or None when the page carries no printed
    table header (a cover letter, a signature page, an annexure of prose).
    """
    lines = [ln for ln in ocr_lines if (ln.get("text") or "").strip()]
    if not lines:
        return None
    found = _header_block(lines)
    if not found:
        return None
    header, header_top = found
    anchors = _column_anchors(header)
    if len(anchors) < 3:
        return None
    # The header ENDS at its last non-numeric cell line. Anything numeric
    # inside the window is already an investor row (a five-line header and a
    # first row 15pt below it both fit in HEADER_BLOCK_PT), and treating it as
    # header dropped the first four rows of a five-row table.
    header_cells = [ln for ln in header
                    if not _is_numeric_cell((ln["text"] or "").strip())]
    header_bottom = max(_line_geometry(ln)[3] for ln in header_cells)

    header_ids = set(id(ln) for ln in header_cells)
    data = [ln for ln in lines
            if _line_geometry(ln)[1] > header_bottom - OCR_ROW_GAP_PT
            and id(ln) not in header_ids
            and _line_geometry(ln)[2] - _line_geometry(ln)[0] <= MAX_DATA_CELL_PT]
    bands = _row_bands(data)

    # Where the table ENDS: its own Total line. Everything below that is the
    # letter's closing prose; it is excluded from every measurement that
    # follows, because on LCC's Life Insurance sub-table that prose out-voted
    # the real name column and the whole page then rebuilt to nothing.
    table_end = None
    for band in bands:
        if any(TOTAL_RE.match(e["text"]) for e in band):
            table_end = min(e["centre"] for e in band)
            break
    if table_end is not None:
        bands = [b for b in bands if min(e["centre"] for e in b) < table_end + 1.0]

    # Which anchor is the NAME column: the one alphabetic cells actually land
    # on. Found by measurement rather than by position, because SME letters
    # sometimes omit the serial column and shift every index left.
    alpha_hits = {}
    for band in bands:
        for e in band:
            if _is_numeric_cell(e["text"]) or TOTAL_RE.match(e["text"]):
                continue
            idx = _assign_column(e, anchors)
            if idx is not None:
                alpha_hits[idx] = alpha_hits.get(idx, 0) + 1
    if not alpha_hits:
        return None
    name_idx = max(alpha_hits, key=lambda k: alpha_hits[k])

    share_idx = _share_column(bands, anchors, name_idx)
    if share_idx is None:
        return None
    serial_idx = name_idx - 1 if name_idx > 0 else None
    # The PERCENT column: the printed table always places it immediately right
    # of the share count, and the TS parser finds a row by locating its percent
    # cell (`readRow`). On these scans the printed "%" sits in the HEADER only
    # -- the data cells read as bare "18.10" / "2.41" -- so without marking the
    # column here `parsePercent` returns null for every cell and the parser
    # reads zero rows out of a table it was handed correctly. Confirmed on all
    # five letters: LCC, JSIPL, LUMINO, HEROMOTORS and GLOTTIS all print the
    # percent glyph once, in the column label.
    percent_idx = share_idx + 1 if share_idx + 1 < len(anchors) else None

    # The spine: one entry per printed investor row, in page order. The table
    # ends at its own Total line - everything below that is the letter's
    # closing prose and must never become an investor row.
    #
    # Seeded from the share column AND the printed serial column, merged by y.
    # Neither alone is complete on a real scan: the OCR drops or mangles the
    # occasional share cell (LCC, where 3 of 11 share cells came back as one
    # run-together box and three investors merged into one row), and plenty of
    # letters print no serial at all (LUMINO's continuation pages, GLOTTIS's
    # first rows). Taking the union recovers a row whenever EITHER anchor of
    # it survived the scan, which is what "fix the class" means here.
    spine = []
    seeds = list(_column_cells(bands, anchors, share_idx))
    if serial_idx is not None:
        seeds += [e for e in _column_cells(bands, anchors, serial_idx)
                  if SERIAL_RE.match(e["text"].strip())]
    for e in sorted(seeds, key=lambda e: e["centre"]):
        digits = re.sub(r"[^0-9]", "", e["text"])
        is_share = (_is_numeric_cell(e["text"]) and len(digits) >= 4
                    and "%" not in e["text"])
        is_serial = bool(SERIAL_RE.match(e["text"].strip()))
        if not (is_share or is_serial):
            continue
        # One printed row yields at most one spine entry: its serial and its
        # share count sit on the same baseline, so the second is a duplicate.
        if spine and e["centre"] - spine[-1]["centre"] <= OCR_ROW_GAP_PT:
            continue
        spine.append(e)
    if table_end is not None:
        spine = [e for e in spine if e["centre"] < table_end - 1.0]
    if not spine:
        return None

    def nearest_row(entry):
        """Index of the spine row this cell belongs to (nearest spine centre).

        Nearest, not last-above: a numeric cell of one investor is printed on
        the same baseline as its share count but the OCR may place it a point
        or two either side (JSIPL lost every share count to the row above when
        this was last-above), while a wrapped name line sits well below its own
        share cell and still nearer to it than to the next row.
        """
        # Never above the first spine cell: everything printed there is the
        # header's own wrapped text ("Price R per Equity Sh a re", "Portion"),
        # which nearest-centre would otherwise hand to investor row 1.
        if entry["centre"] < spine[0]["centre"] - ROW_ATTACH_PT:
            return None
        return min(range(len(spine)),
                   key=lambda i: abs(spine[i]["centre"] - entry["centre"]))

    rows = [{"serial": [], "name_parts": [], "cells": {}, "centre": s["centre"]}
            for s in spine]
    for band in bands:
        if table_end is not None and min(e["centre"] for e in band) >= table_end - 1.0:
            continue
        for e in band:
            idx = _assign_column(e, anchors)
            if idx is None:
                continue
            i = nearest_row(e)
            if i is None:
                continue
            if idx == name_idx:
                if not _is_numeric_cell(e["text"]):
                    rows[i]["name_parts"].append((e["centre"], e["x0"], e["text"]))
                continue
            if serial_idx is not None and idx <= serial_idx:
                rows[i]["serial"].append(e["text"])
                continue
            rows[i]["cells"].setdefault(idx, []).append((e["centre"], e["x0"], e["text"]))

    value_cols = sorted(set(idx for r in rows for idx in r["cells"]))
    total = _preamble_total(lines, header_top)
    preamble = ("Out of the total allocation of %s Equity Shares to the Anchor Investors"
                % total) if total else ""

    def joined(parts):
        return " ".join(t for _c, _x, t in sorted(parts, key=lambda p: (p[0], p[1])))

    def column_text(row, idx):
        text = joined(row["cells"].get(idx, []))
        # Restore the percent glyph the scan printed only in the header, so
        # the cell reads as a percentage downstream. Never invented: the
        # column is the one the printed layout puts right of the share count,
        # and a cell that is not a plain number is left exactly as read.
        if idx == percent_idx and _looks_like_bare_percent(text):
            return re.sub(r"\s+", "", text) + "%"
        return text

    return {
        "preamble": preamble,
        "centres": [r["centre"] for r in rows],
        "serials": [re.sub(r"[^0-9]", "", " ".join(r["serial"]))[:2] for r in rows],
        "names": [join_letter_runs(joined(r["name_parts"])) for r in rows],
        "name_groups": [[] for _ in rows],
        "columns": [[column_text(r, idx) for r in rows] for idx in value_cols],
        "name_band": (0.0, 0.0),
    }


def extract(path, ocr=True):
    pages_words = []
    with pdfplumber.open(path) as pdf:
        # W-137 sibling: release each page's pdfplumber cache as we go rather
        # than holding the whole document's char/object cache alive at once
        # (same shape as extract_filing.py's prospectus OOM).
        for p in pdf.pages:
            pages_words.append(p.extract_words(y_tolerance=1, x_tolerance=1.5))
            p.close()
    bands = column_bands(pages_words)
    pages = [page_rows(w, bands) for w in pages_words]

    scanned = [
        i for i, rows in enumerate(pages) if page_needs_ocr(rows, pages_words[i])
    ]
    if ocr and scanned:
        import ocr_pages  # local: the OCR stack is only needed on damaged scans

        if ocr_pages.backend_available():
            for page in ocr_pages.ocr_pdf_page_boxes(path, scanned, dpi=OCR_DPI):
                idx = page["page"]
                if pages[idx] is not None:
                    pages[idx] = apply_ocr_names(pages[idx], page["lines"])
                else:
                    # W-170 / #437: no text layer at all - rebuild the row
                    # geometry from the OCR boxes themselves rather than
                    # supplementing a name column with no row geometry to
                    # attach to. `ocr_full_page_rows` is header-anchored since
                    # #437, so a cover page returns None here (and falls
                    # through to plain OCR text) instead of inventing rows out
                    # of the letterhead's phone numbers.
                    pages[idx] = ocr_full_page_rows(page["lines"])

    return [
        render_rows(rows) if rows else (_plain(w) if w else "")
        for rows, w in zip(pages, pages_words)
    ]


def main():
    # MINOR-3: robust to `python -m` / package-relative invocation, same as
    # ocr_pages.py — see that file's comment for why.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import memory_guard
    memory_guard.install_memory_ceiling()

    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not argv:
        print(json.dumps({"error": "usage: anchor_report_text.py <pdf-path> [--no-ocr]"}))
        return 1

    # W-178c round 2: acquire the box lock BEFORE any PDF work.
    if not box_lock.acquire(box_lock.resolve_lock_path(), _anchor_lock_wait_s()):
        print("extractor busy: box lock held (W-178c)", file=sys.stderr)
        sys.exit(75)

    try:
        pages = extract(argv[0], ocr="--no-ocr" not in sys.argv[1:])
    except Exception as exc:  # noqa: BLE001 - the caller only needs the reason
        # MAJOR-4 (W-137 round 2): this sidecar is spawned by
        # anchor-investors-scraper.ts with NO RLIMIT_AS guard at all until
        # now. `anchor_report_text.ts`'s `extractPageTexts` reads
        # `JSON.parse(res.stdout...)` and checks `parsed.error` — it never
        # inspects `res.status` — so the JSON shape is the real contract;
        # exit 3 (matching `memory_guard.EXIT_MEMORY_CEILING`) is set for a
        # memory-ceiling hit so a human/log can tell it apart from an
        # ordinary parse failure, without changing what the TS side reads.
        if memory_guard.is_memory_exhaustion(exc):
            print(memory_guard.memory_ceiling_error_json(memory_guard.max_rss_mb()))
            return memory_guard.EXIT_MEMORY_CEILING
        print(json.dumps({"error": "%s: %s" % (type(exc).__name__, exc)}))
        return 1
    print(json.dumps(strip_nul_bytes({"pages": pages})))
    return 0


if __name__ == "__main__":
    sys.exit(main())
