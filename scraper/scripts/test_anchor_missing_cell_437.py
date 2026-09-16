"""#437 slice 4 - the row with NO printed share cell at all (LCC row 7, "RGSL
INVESTMENT FUND"), plus the two new SME fixtures MADHURKNIT and SUMAX.

Slices 1-3 rebuilt the table GEOMETRY and repaired glyph-level digit damage on
five real image-scan letters (LCCPROJECT, GLOTTIS, JSIPL, LUMINO,
HEROMOTORS). All five still refuse today, for residuals slice 3 explicitly
scoped OUT ("What this file does NOT claim" in test_anchor_row_geometry_437.py):
a row whose OCR left the SHARE cell completely blank (not a corrupted digit -
an EMPTY one), where the letter's own preamble states the whole allocation's
total.

Measured on LCCPROJECT page 0, row 7 (RGSL Investment Fund): the rebuilt
table's share column is `''` for this row - `_is_numeric_cell`, and even the
looser `_looks_like_grouped_number` slice 3 added, both correctly refuse to
call an empty string a share count (nothing to repair a glyph on). `readRow`
in the TypeScript parser therefore never turns this row into a candidate at
all - unlike a row whose AMOUNT cell fails reconciliation later (counted as a
`rowError` and subtracted from the percentage-check denominator), a
missing-SHARE row is invisible from the very first pass and its shares are
silently absent from `totalSharesInPortion` - inflating every OTHER row's
"holds X%" past its printed percentage. That is the

    row "ASTORNE CAPITAL VCC 1" prints 23.40% but holds 44.70% of the anchor
    portion

refusal on LCCPROJECT and the

    row "LC Pharos Multi Strategy Fund..." prints 18.10% but holds 19.92% of
    the anchor portion

refusal on GLOTTIS this file's fix does NOT reach (see below).

THE FIX (this slice): the letter's OWN preamble sentence ("Out of the total
allocation of 87,76,869 Equity Shares to the Anchor Investors...") is an
independent statement of the whole portion. When EXACTLY ONE investor row is
missing its share cell and every other row's is readable, the missing row's
shares are DERIVED as `preambleTotal - sum(every other row's shares)` -
`parsePreambleTotalShares` and the derivation itself live in
`anchor-report-parser.ts` (`emptyShareRows` / `sharesOnly` /
`derivedFromTotal`), not here; this Python side only had to stop dropping the
preamble sentence for a page that never rebuilds a table at all (see below).

A SECOND, INDEPENDENT bug this slice found and fixed while building this test:
`extract()`'s fallback for a scanned page with NO rebuildable table (a cover
letter, GLOTTIS page 0, which carries the preamble sentence and nothing
else) rendered to `_plain(pages_words[i])` - the PDFPLUMBER text layer, which
is EMPTY for a pure image scan, not the OCR's own read of that page. The
preamble sentence the OCR actually read never reached `fullText` at all.
Fixed by `_plain_ocr_lines` + the `ocr_plain_text` fallback in `extract()`.

WHAT THIS FIX DOES NOT REACH (measured, not guessed at):

  * GLOTTIS's remaining refusal ("18.10% vs 19.92%") is the row-MERGE defect
    slice 3 already documented and explicitly declined to fix (Sunrise
    Investment Opportunities' whole row merged into "The Asio Fund..."'s -
    no share OR serial anchor survived for it at all, so there is nothing to
    derive from and nothing this slice's Class covers).
  * LCCPROJECT's remaining refusal, AFTER this fix recovers RGSL's shares, is
    a DIFFERENT and previously undocumented residual: two rows (EDELWEISS,
    one NECTA BLOOM row) are missing their PERCENT cell, not their share
    cell - `readRow` needs a percent cell to anchor its backward scan, so
    those rows are invisible to it the same way a missing-share row is, but
    deriving a missing PERCENT is a different problem (this slice's Class is
    a missing SHARE cell) and is left unfixed. Measured: LCCPROJECT refuses
    with "ASTORNE CAPITAL VCC 1 prints 23.40% but holds 26.61%" after this
    fix (down from 44.70% before it) - proof the derivation recovered RGSL's
    shares without proof the WHOLE letter now publishes, which it does not.
  * JSIPL, LUMINO, HEROMOTORS each have their OWN, different residuals
    (LUMINO alone has several rows with BOTH cells blank, so
    `emptyShareRows.length !== 1` and the derivation correctly declines to
    guess). None of the five real image-scan fixtures reconciles end to end
    today - reported honestly here rather than claimed.

SME FIXTURES (MADHURKNIT, SUMAX): both letters are genuine NSE Anchor
Allocation Reports for SME issues, and both have a REAL PDFPLUMBER TEXT
LAYER (233/173 and 239/172 extract_words() respectively) - they are NOT
image scans, so the OCR-box JSON fixture format this slice's OTHER five
fixtures use does not really apply; `MADHURKNIT-ocr-boxes.json` and
`SUMAX-ocr-boxes.json` here are pdfplumber WORD boxes reshaped into the same
line-box JSON shape, kept for format consistency, but `ocr_table_page_rows`
(the OCR pipeline this slice's fix lives in) correctly returns None for
every page of both - it is header-anchored on the OCR's own line geometry,
which these pages never went through.

The SME layout DOES differ in one respect worth recording: SUMAX's letter
prints its percent column with NO "%" glyph anywhere, not even in the
header cell (compare "13.88" to LCCPROJECT's "7.80%") - `parsePercent`
requires a literal "%" (or an OCR-confusable stand-in), so the TypeScript
parser reads 0 candidate rows from either SME letter today. Both are a
DIFFERENT, undocumented defect on the PDFPLUMBER TEXT-LAYER extraction path
(`page_rows` in this file), not on the OCR path slice 1-4 touch, and neither
letter reconciles end to end - stated honestly rather than claimed. SUMAX row
6 (IMAP INDIA CAPITAL) is ALSO missing its share cell in the printed letter
itself ("|  |  | 101 |" - both share and percent columns blank), which is
this slice's Class, but recovering it needs the percent-glyph fix first
(no percent cell to anchor on) - out of reach without exceeding this slice's
budget, and NOT claimed fixed.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from anchor_report_text import (  # noqa: E402
    _plain_ocr_lines,
    ocr_table_page_rows,
    rebuilt_rows_missing_a_share_cell,
    render_rows,
)

FIXTURES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "tests", "fixtures", "anchor")


def _pages(symbol):
    path = os.path.join(FIXTURES, "%s-ocr-boxes.json" % symbol)
    with open(path, encoding="utf-8") as fh:
        return dict((p["page"], p["lines"]) for p in json.load(fh))


def test_lcc_row_7_share_cell_is_empty_not_corrupted():
    """RGSL Investment Fund's share cell rebuilds to the empty string - not a
    garbled digit run slice 2/3's repairs could touch."""
    rows = ocr_table_page_rows(_pages("LCCPROJECT")[0])
    rgsl_idx = next(i for i, n in enumerate(rows["names"]) if "RGSL" in n)
    assert rows["columns"][0][rgsl_idx] == ""


def test_rebuilt_rows_missing_a_share_cell_detects_lcc_row_7():
    rows = ocr_table_page_rows(_pages("LCCPROJECT")[0])
    assert rebuilt_rows_missing_a_share_cell(rows) is True


def test_rebuilt_rows_missing_a_share_cell_is_false_when_every_cell_reads():
    rows = ocr_table_page_rows(_pages("GLOTTIS")[1])
    # Page 1's own rows (per slice 3) each keep a share cell of their own -
    # the merged-row loss there is a name-column defect, not an empty share
    # cell on a real spine row.
    assert all(cell.strip() != "" for cell in rows["columns"][0])
    assert rebuilt_rows_missing_a_share_cell(rows) is False


def test_rebuilt_rows_missing_a_share_cell_handles_none_and_empty():
    assert rebuilt_rows_missing_a_share_cell(None) is False
    assert rebuilt_rows_missing_a_share_cell({"columns": []}) is False


def test_lcc_preamble_total_survives_render_rows():
    """The derivation in the TS parser needs this sentence in `fullText` -
    prove the Python side still emits it on the page that carries it."""
    rows = ocr_table_page_rows(_pages("LCCPROJECT")[0])
    rendered = render_rows(rows)
    assert "Out of the total allocation of 87,76,869 Equity Shares" in rendered


def test_glotti_page_0_cover_letter_preamble_survives_the_ocr_fallback():
    """GLOTTIS's preamble ("allocation of 4,283,755 Equity Shares...") is
    printed on page 0, a cover letter with NO investor table at all -
    `ocr_table_page_rows` correctly returns None for it. Before this slice's
    fix, `extract()`'s fallback for such a page was the PDFPLUMBER text
    layer (`_plain(pages_words[i])`), which is EMPTY for a pure image scan -
    the sentence the OCR itself read never reached `fullText`. This proves
    the OCR's own plain-text rendering (`_plain_ocr_lines`, what `extract()`
    now falls through to) still carries it."""
    page0_lines = _pages("GLOTTIS")[0]
    assert ocr_table_page_rows(page0_lines) is None
    plain = _plain_ocr_lines(page0_lines)
    assert "allocation of 4,283,755 Equity Shares" in plain


def test_plain_ocr_lines_empty_input_is_empty_string():
    assert _plain_ocr_lines([]) == ""
    assert _plain_ocr_lines([{"text": "", "box": [[0, 0], [0, 0], [0, 0], [0, 0]]}]) == ""


def test_sme_fixtures_have_a_real_text_layer_not_an_image_scan():
    """MADHURKNIT and SUMAX are genuine NSE anchor letters with a real
    PDFPLUMBER text layer - `ocr_table_page_rows` (this slice's OCR-only
    fix) correctly does not rebuild anything for either, on every page."""
    for symbol in ("MADHURKNIT", "SUMAX"):
        pages = _pages(symbol)
        assert len(pages) == 2, "%s: expected 2 pages" % symbol
        for page_no, lines in pages.items():
            assert ocr_table_page_rows(lines) is None, (
                "%s page %d: expected None (text-layer letter, not an OCR "
                "table rebuild) - got a rebuilt table" % (symbol, page_no))
