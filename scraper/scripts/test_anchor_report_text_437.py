"""#437 - the image-scan anchor-letter table rebuild, on five REAL NSE letters.

Every fixture here is the real `ocr_pages.ocr_pdf_page_boxes(..., dpi=300)`
output of an anchor letter downloaded from nsearchives.nseindia.com (the URLs
are in `scraper/tests/fixtures/anchor/README.md`). Each of the five is a pure
image scan: pdfplumber reports ZERO native words on every page, which is the
defining property of the class this fixes.

Red state before the fix (measured, `ocr_full_page_rows` as W-170 left it):

    letter        pages  native words  cover pages          table pages
    LCCPROJECT      2    0, 0          20 invented rows     None
    JSIPL           1    0             14 invented rows     (same page)
    LUMINO          5    0 x5          34 invented rows     None on 2 of 4
    HEROMOTORS      4    0 x4          32 invented rows     None on 3 of 4
    GLOTTIS         2    0, 0          None                 None

The invented rows were prose fragments ("(East),", "of", "the allocation")
banded out of the letterhead's phone numbers and PIN codes; the TypeScript
parser rejected them and reported "only 0 investor rows could be read from the
anchor report" - the 18 production / 16 staging documents of issue #437.
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from anchor_report_text import (  # noqa: E402
    ocr_table_page_rows,
    render_rows,
)

FIXTURES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "tests", "fixtures", "anchor")

# Per letter: the pages that carry a printed investor table, the pages that
# carry none (cover letter, signature page, closing prose), and how many
# investor rows the table pages must yield. The row counts were read off the
# OCR lines by hand - see the module docstring for the source URLs.
LETTERS = {
    "LCCPROJECT": {"table": {0: 9, 1: 1}, "cover": []},
    "JSIPL": {"table": {0: 5}, "cover": []},
    "LUMINO": {"table": {0: 10, 1: 19, 2: 23, 3: 6}, "cover": [4]},
    "HEROMOTORS": {"table": {0: 14, 1: 10, 2: 13}, "cover": [3]},
    "GLOTTIS": {"table": {1: 6}, "cover": [0]},
}


def _pages(symbol):
    path = os.path.join(FIXTURES, "%s-ocr-boxes.json" % symbol)
    with open(path, encoding="utf-8") as fh:
        return dict((p["page"], p["lines"]) for p in json.load(fh))


@pytest.mark.parametrize("symbol", sorted(LETTERS))
def test_every_table_page_rebuilds_its_investor_rows(symbol):
    """The half of #437 that returned None on the real table page."""
    pages = _pages(symbol)
    for page, expected in LETTERS[symbol]["table"].items():
        rows = ocr_table_page_rows(pages[page])
        assert rows is not None, "%s page %d rebuilt to None" % (symbol, page)
        assert len(rows["centres"]) == expected, (
            "%s page %d: %d rows, expected %d"
            % (symbol, page, len(rows["centres"]), expected))


@pytest.mark.parametrize("symbol", sorted(LETTERS))
def test_a_page_with_no_printed_table_yields_no_rows(symbol):
    """The half of #437 that invented rows out of the letterhead.

    The positive control for the header gate: a cover letter, a signature page
    or a page of closing prose has no table header, so it must rebuild to None
    - never to a row whose "name" is a fragment of an address.
    """
    pages = _pages(symbol)
    for page in LETTERS[symbol]["cover"]:
        assert ocr_table_page_rows(pages[page]) is None, (
            "%s page %d invented rows from a page with no table" % (symbol, page))


@pytest.mark.parametrize("symbol", sorted(LETTERS))
def test_no_rebuilt_name_is_a_prose_fragment(symbol):
    """Guards the specific damage #437 was reported for.

    Before the fix the "names" were "(East),", "of", "the allocation", "Price"
    - lower-case prose fragments and column labels. A rebuilt investor name is
    an entity name: it carries a word of three or more letters.
    """
    banned = {"of", "the", "price", "no.", "in the", "to", "and"}
    pages = _pages(symbol)
    for page in LETTERS[symbol]["table"]:
        rows = ocr_table_page_rows(pages[page])
        for name in rows["names"]:
            assert name.strip().lower() not in banned, (
                "%s page %d rebuilt a prose fragment as a name: %r"
                % (symbol, page, name))


def test_lcc_carries_its_printed_preamble_total():
    """The TS parser reconciles against the letter's own published total, so
    a page that prints one must pass it through (LCC: 87,76,869 shares)."""
    rows = ocr_table_page_rows(_pages("LCCPROJECT")[0])
    assert "87,76,869" in rows["preamble"]


def test_lumino_carries_its_printed_preamble_total():
    rows = ocr_table_page_rows(_pages("LUMINO")[0])
    assert "25,243,901" in rows["preamble"]


def test_lcc_reads_the_life_insurance_row_it_prints():
    """LCC's second page is a one-investor sub-table - the "only 1 investor
    rows" shape of the class. It must rebuild, with the printed figures."""
    rows = ocr_table_page_rows(_pages("LCCPROJECT")[1])
    assert len(rows["centres"]) == 1
    rendered = render_rows(rows)
    # The OCR prints this as "1 4.99,92,224" - a space dropped INSIDE the
    # digit run. Since #437 slice 2 the sidecar closes that space before the
    # cell leaves python, so the rendered figure carries all nine digits in
    # one run and `parseAmount` reads 14,99,92,224 from it.
    assert "14.99,92,224" in rendered or "14,99,92,224" in rendered


def test_the_percent_column_is_marked_as_a_percentage():
    """These scans print the "%" glyph in the column HEADER only; the data
    cells read as bare "18.10". The TS parser locates a row BY its percent
    cell, so an unmarked column means zero rows out of a correctly rebuilt
    table - which is how the letters still read zero after the geometry was
    already right."""
    rows = ocr_table_page_rows(_pages("GLOTTIS")[1])
    rendered = render_rows(rows)
    assert "%" in rendered


def test_a_page_with_no_lines_rebuilds_to_none():
    assert ocr_table_page_rows([]) is None
    assert ocr_table_page_rows([{"text": "", "box": [[0, 0]], "words": []}]) is None
