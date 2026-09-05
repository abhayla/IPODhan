"""W-170: three real NSE Emerge anchor letters downloaded from
nsearchives.nseindia.com and run through `anchor_report_text.py` (or, for
Qualiance, its OCR full-page-rebuild path - see `ocr_full_page_rows`).

The PDFs are never committed (`.scratch/` in .gitignore); the extracted TEXT
these tests assert against IS committed, at
`scraper/tests/fixtures/sme/*-anchor-report-text.json` /
`*-anchor-report-ocr-text.json` - each file is the literal stdout `pages` this
script produced when run against the real download.

Oracle numbers (hand-read from each letter's own printed prose / Total row,
never re-derived from code under test):

  Shanti Inorganics  - 5 anchor investors, allocation price ₹83 per share
                       (letter's own prose: "at ₹83 per share"),
                       16,19,200 equity shares, Rs 13,43,93,600 total.
  Ashutosh Fibre     - 5 anchor investors, bid price ₹92 per share (printed
                       in its own Bid-Price column, all 5 rows),
                       17,43,600 equity shares, Rs 16,04,11,200 total.
  Qualiance          - 6 anchor investors, allocation price ₹127 per share
                       (letter's own prose: "Investor allocation price of
                       ₹127 per Equity Share"), 10,09,000 equity shares,
                       Rs 12,81,43,000 total (same oracle as the W-132
                       hand-transcribed fixture, `qualiance-anchor-letter-
                       text.txt`, since this is the same letter).
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from anchor_report_text import ocr_full_page_rows, page_needs_ocr  # noqa: E402

FIXTURES = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "tests", "fixtures", "sme"
)


def _load(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as f:
        return json.load(f)["pages"]


def _investor_row_lines(pages):
    """The `# <serial> | ...` lines that carry an actual serial number -

    excludes preamble/boilerplate lines the sidecar also renders as `# |...`
    with a blank serial.
    """
    out = []
    for page in pages:
        for line in page.split("\n"):
            if re.match(r"^#\s*\d+\s*\|", line):
                out.append(line)
    return out


def test_shanti_inorganics_extraction_has_5_investor_rows_and_states_the_price():
    pages = _load("shanti-inorganics-anchor-report-text.json")
    rows = _investor_row_lines(pages)
    assert len(rows) == 5
    text = "\n".join(pages)
    # The letter states the price only in prose ("at ₹83 per share") - the
    # W-170 root cause is that the OLD parser could not derive 83 from the
    # rows' amount-only cells at all; the extraction step itself must still
    # carry that prose sentence through untouched.
    assert "83 per share" in text
    assert "16,19,200" in text  # the letter's own Total row, shares
    assert "13,43,93,600" in text  # the letter's own Total row, amount


def test_ashutosh_fibre_extraction_has_5_investor_rows_and_the_bid_price_column():
    pages = _load("ashutosh-fibre-anchor-report-text.json")
    rows = _investor_row_lines(pages)
    assert len(rows) == 5
    # Every row prints its own Bid Price cell as "92" (unlike Shanti, where
    # the price is prose-only) - the W-170 bug was that the OLD parser's
    # `k >= 3` floor could never land on this 2-digit prefix.
    for row in rows:
        cells = [c.strip() for c in row.split("|")]
        assert "92" in cells, f"row missing the printed bid price 92: {row!r}"
    text = "\n".join(pages)
    assert "17,43,600" in text  # Total row, shares
    assert "16,04,11,200" in text  # Total row, amount
    # W-170's second bug: the Total row's own NAME cell is blank in this
    # scan - confirm the extraction step really does leave it blank (the fix
    # lives in the TS parser's `looksLikeTotalRow`, not here).
    total_lines = [
        ln
        for ln in "\n".join(pages).split("\n")
        if "17,43,600" in ln and "100.00%" in ln
    ]
    assert total_lines, "could not find the Total row in the extracted text"
    assert total_lines[0].split("|")[1].strip() == ""


def test_qualiance_ocr_rebuild_has_6_investor_rows_and_states_the_price():
    """The OCR full-page rebuild (no text layer at all - see
    `anchor_report_text.ocr_full_page_rows`) recovers all 6 investor rows and
    the letter's own prose price statement.

    KNOWN RESIDUAL GAP (stated, not silently accepted): this specific OCR
    capture misreads row 5's percent cell as blank, which the TS parser's
    `readRow` needs to anchor a row at all - so `parseAnchorReport` still
    returns ok:false on this exact fixture (see the vitest file
    anchor-report-parser-w170.test.ts, "STILL NOT FULLY PARSED"). The
    EXTRACTION step recovers the full table; the parser's handling of a row
    that has an amount but no legible percent is not fixed by this change.
    """
    pages = _load("qualiance-anchor-report-ocr-text.json")
    rows = _investor_row_lines(pages)
    assert len(rows) == 6
    text = "\n".join(pages)
    assert "127" in text  # bid price, stated in prose and in every row
    assert "10,09,000" in text or "1 0,09,000" in text  # total shares (OCR spacing)


def test_page_needs_ocr_fires_for_a_genuinely_empty_text_layer():
    """W-170 trigger 3: `rows is None` because pdfplumber found ZERO words at
    all (a scan with no text layer whatsoever), not because a prose/boilerplate
    page simply has no table.
    """
    assert page_needs_ocr(None, words=[]) is True
    # A real prose page (some words, no table) must NOT be sent through the
    # full-page OCR rebuild - there is a text layer, it is just not a table.
    assert page_needs_ocr(None, words=[{"text": "Dear", "x0": 10.0, "top": 10.0}]) is False
    # Callers that don't pass `words` at all (the existing OCR-gate tests)
    # keep the old behaviour exactly.
    assert page_needs_ocr(None) is False


def _ocr_word(text, x0, top, width=None):
    if width is None:
        width = max(10.0, 6.0 * len(text))
    return {"text": text, "score": 0.95, "box": [x0, top, x0 + width, top + 12.0]}


def test_ocr_full_page_rows_rebuilds_a_table_from_ocr_boxes_alone():
    """No pdfplumber row geometry to supplement - the OCR boxes ARE the only
    geometry, so `ocr_full_page_rows` must band and split them itself (the
    same pipeline `column_bands`/`page_rows` run on a real text layer).
    """
    # column_bands needs >= MIN_NUMERIC_ROWS (5) rows in a band before it will
    # treat it as a real table column rather than incidental prose digits -
    # five synthetic rows clears that floor.
    rows_data = [
        (1, "ALPHA FUND", "1,00,000", "50.00%", "1,00,00,000", 100.0),
        (2, "BETA FUND", "1,00,000", "50.00%", "1,00,00,000", 115.0),
        (3, "GAMMA FUND", "1,00,000", "50.00%", "1,00,00,000", 130.0),
        (4, "DELTA FUND", "1,00,000", "50.00%", "1,00,00,000", 145.0),
        (5, "EPSILON FUND", "1,00,000", "50.00%", "1,00,00,000", 160.0),
    ]
    lines = []
    for serial, name, shares, pct, amount, top in rows_data:
        words = [
            _ocr_word(f"{serial}.", 40.0, top),
            _ocr_word(name, 70.0, top),
            _ocr_word(shares, 260.0, top),
            _ocr_word(pct, 340.0, top),
            _ocr_word(amount, 400.0, top),
        ]
        lines.append({"box": [[0, top], [1, top], [1, top], [0, top]], "text": " ".join(w["text"] for w in words), "score": 0.95, "words": words})

    rows = ocr_full_page_rows(lines)
    assert rows is not None
    assert rows["names"] == [r[1] for r in rows_data]
    assert len(rows["centres"]) == len(rows_data)


def test_ocr_full_page_rows_returns_none_when_there_is_nothing_to_band():
    assert ocr_full_page_rows([]) is None
    assert ocr_full_page_rows([{"words": []}]) is None
