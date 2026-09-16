"""#437 slice 2 - the OCR-split numeric cell, on the same five REAL letters.

Slice 1 rebuilt the table GEOMETRY from the OCR word boxes: the right rows,
with the right names, on the right pages. The numbers inside those rows were
still as the scanner read them, and a 300-dpi scan damages a printed figure in
two separator-level ways that no consumer downstream can undo:

  1. Whitespace THROUGH the digit run - "6, 8 5.03 2" for the printed
     6,85,032, "1 1 62,800" for 11,62,800, "1 4.99,92,224" for 14,99,92,224.
  2. A cell printed ONCE but read TWICE, where the investor name beside it
     wrapped onto a second sub-line and the sidecar merged both - "9. 17 9.17"
     for a single 9.17.

Shape 2 is the one that refuses whole letters. A doubled cell is not a
percentage by any test, so `readRow` in the TypeScript parser cannot find the
row's percent cell, drops the row from the candidate list, and the shrunken
candidate total then makes every OTHER row's printed percentage look inflated.
That is the

    row "LC Pharos Multi Strategy Fund VCC ..." prints 18.10% but holds
    22.16% of the anchor portion

refusal on GLOTTIS, and the same mechanism on LCCPROJECT and LUMINO.

RED STATE, measured on this worktree before the fix (the repair reverted,
everything else identical):

    GLOTTIS  page 1 row 6 percent cell = "9. 17 9.17"  -> parsePercent null
    GLOTTIS  candidate share total     = 3,498,476     (row 6 excluded)
    GLOTTIS  parseAnchorReport         = REFUSED, "holds 22.16%"

GREEN STATE (this file's assertions): the percent cell reads "9.17%", row 6
joins the candidates, and the candidate total rises to 3,891,117.

What this file does NOT claim: it does not claim the five letters now parse.
Two independent defects remain in the GEOMETRY, not in the digits - two
investors banded into one row (GLOTTIS loses ~392,638 shares; LCC's row 3
merges two investors and keeps a corrupted glyph between their digits), which
is why LCC, LUMINO, GLOTTIS, JSIPL and HEROMOTORS are still refused. Those are
slice 3. Nothing here invents a digit to paper over them.
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from anchor_report_text import (  # noqa: E402
    collapse_digit_spaces,
    ocr_table_page_rows,
    render_rows,
    repair_numeric_cell,
)

FIXTURES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "tests", "fixtures", "anchor")


def _pages(symbol):
    path = os.path.join(FIXTURES, "%s-ocr-boxes.json" % symbol)
    with open(path, encoding="utf-8") as fh:
        return dict((p["page"], p["lines"]) for p in json.load(fh))


# --------------------------------------------------------------------------- #
# The repair itself, on strings taken verbatim off the five fixtures.
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("scanned,repaired", [
    # Whitespace inside the digit run (shape 1).
    ("6, 8 5.03 2", "6,85.032"),
    ("1 1 62,800", "1162,800"),
    ("1 4.99,92,224", "14.99,92,224"),
    ("3 92,63 8", "392,638"),
    ("2 9 ,99, 99 .3 40. 00", "29,99,99.340.00"),
    ("1 3 .40. 1 04", "13.40.104"),
    # A cell printed once, read twice (shape 2).
    ("9. 17 9.17", "9.17"),
    ("7.80 7.80", "7.80"),
    ("50,650,302 50,650,302", "50,650,302"),
    # Left exactly as read: no digits to repair, or nothing doubled.
    ("", ""),
    ("Total", "Total"),
    ("18.10%", "18.10%"),
])
def test_the_repair_closes_only_separator_damage(scanned, repaired):
    assert repair_numeric_cell(scanned) == repaired


def test_no_digit_is_ever_invented_or_dropped():
    """The repair repositions separators. It never touches a digit.

    This is the guard that keeps the repair a READ rather than a guess: for
    every numeric cell on every table page of all five letters, the digits of
    the repaired cell are the digits the scanner actually printed - or, for a
    doubled cell, exactly half of them.
    """
    for symbol in ("LCCPROJECT", "JSIPL", "LUMINO", "HEROMOTORS", "GLOTTIS"):
        pages = _pages(symbol)
        for page, lines in pages.items():
            rows = ocr_table_page_rows(lines)
            if rows is None:
                continue
            for column in rows["columns"]:
                for cell in column:
                    scanned = "".join(c for c in cell if c.isdigit())
                    fixed = "".join(
                        c for c in repair_numeric_cell(cell) if c.isdigit())
                    assert fixed == scanned or scanned == fixed + fixed, (
                        "%s page %s: repair changed the digits of %r to %r"
                        % (symbol, page, cell, repair_numeric_cell(cell)))


def test_a_space_between_a_digit_and_a_letter_is_kept():
    """Letterhead shrapnel stays visible rather than welded onto the number.

    HEROMOTORS page 0 ends its last amount cell with "...880.00 HMC
    HEROMOTORSCOMPANY". Collapsing that space would produce a single
    number-like token carrying the company name into the numeric parse.
    """
    assert collapse_digit_spaces("10.00.28.880.00 HMC") == "10.00.28.880.00 HMC"


def test_a_cell_holding_two_DIFFERENT_figures_is_left_refused():
    """Two investors banded into one row is a geometry defect, not a digit one.

    Picking one of two printed share counts would be a guess, so the repair
    must leave such a cell as it is and let the row stay refused downstream.
    """
    assert (repair_numeric_cell("5,00,02,287 3,26,39,000")
            == "5,00,02,287 3,26,39,000")


# --------------------------------------------------------------------------- #
# The mechanism, end to end on the real fixtures: a doubled percent cell is
# what cost GLOTTIS its sixth row and therefore the whole letter.
# --------------------------------------------------------------------------- #

def test_glottis_sixth_row_recovers_its_percent_cell():
    """RED before the fix: this cell read "9. 17 9.17" and parsed to nothing."""
    rows = ocr_table_page_rows(_pages("GLOTTIS")[1])
    percents = rows["columns"][1]
    assert percents[5] == "9.17%", (
        "GLOTTIS row 6 percent cell is %r, not the single printed 9.17 percent"
        % percents[5])


def test_glottis_candidate_share_total_includes_every_row():
    """The denominator the percentage check divides by.

    RED: 3,498,476 - row 6 dropped for its unreadable percent cell, which made
    every kept row's printed percentage look inflated.
    GREEN: 3,891,117 - all six rebuilt rows counted.
    """
    rows = ocr_table_page_rows(_pages("GLOTTIS")[1])
    shares = [int("".join(c for c in cell if c.isdigit()))
              for cell in rows["columns"][0]]
    assert sum(shares) == 3891117, "candidate share total is %d" % sum(shares)


def test_lcc_third_row_recovers_its_percent_cell():
    """LCC row 3 read "7.80 7.80" - the same doubling, the same lost row."""
    rows = ocr_table_page_rows(_pages("LCCPROJECT")[0])
    assert rows["columns"][1][2] == "7.80%"


@pytest.mark.parametrize("symbol,page", [
    ("LCCPROJECT", 0), ("JSIPL", 0), ("LUMINO", 1),
    ("HEROMOTORS", 0), ("GLOTTIS", 1),
])
def test_no_rendered_row_carries_a_space_inside_a_digit_run(symbol, page):
    """The property the repair establishes for the TypeScript side.

    Between the pipes of a rendered row, a digit is never separated from the
    next digit or separator by a space. Letters may still follow a number
    (letterhead shrapnel) - that is the case the repair deliberately leaves.
    """
    rows = ocr_table_page_rows(_pages(symbol)[page])
    for line in render_rows(rows).split("\n"):
        if not line.startswith("# "):
            continue
        for cell in line.split("|")[2:]:
            compact = cell.strip()
            for i in range(1, len(compact) - 1):
                if compact[i] != " ":
                    continue
                if compact[i - 1].isdigit() and compact[i + 1] in "0123456789.,":
                    raise AssertionError(
                        "%s page %d rendered a split digit run: %r"
                        % (symbol, page, compact))
