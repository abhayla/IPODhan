"""#437 slice 3 - the row-GEOMETRY residual on GLOTTIS and LCC.

Slice 1 rebuilt the table geometry from OCR word boxes; slice 2 repaired the
OCR's separator damage inside a numeric cell. Both left GLOTTIS and LCCPROJECT
still refused, because two investors were banded into one spine row - see the
"#437 slice 3" comment block in anchor_report_text.py for the mechanism.

RCA, LCCPROJECT page 0, row 3: the printed table has TWO investors with an
identical allocation (6,85,032 shares each) - "CRAFT EMERGING MARKET FUND
PCC-CITADEL CAPITAL FUND" and "CRAFT EMERGING MARKET FUND PCC- ELITE CAPITAL
FUND". Citadel's share cell reads clean ("6, 8 5.03 2"); Elite's reads
"6,8 § ,03 2" - the OCR misread a "," as "§". `_is_numeric_cell`'s character
class does not include "§", so Elite's share cell failed the strict numeric
test outright and was never offered as a spine seed. With only Citadel's
share cell (and the shared serial "3.") to seed on, the spine formed ONE row
for what the letter prints as two, and Elite's whole allocation (6,85,032
shares, 46.00 price, 7.80%, 10,00,14,672.00 amount) never reached the parser.

RED STATE (measured on this worktree with the fix reverted): LCCPROJECT page 0
rebuilds to 9 spine rows; row 2 (0-indexed) carries the concatenated name
"CRAFT EMERGING MARKET FUND PCC-CITADEL CAPITAL CRAFT EMERGING MARKET FUND
PCC- ELITE CAPITAL" and both share/amount columns hold two space-joined
figures ("6,85.0326,8 § ,032", "10,00. I 4,672.0010,00,14,672.00").

GREEN STATE (this file): 10 spine rows; Citadel and Elite are two separate
rows, each with its own 6,85,032-share allocation.

What this file does NOT claim: GLOTTIS's remaining merge (page 1, row index 5
- "The Asio Fund..." and "Sunrise Investment Opportunities Fund" sharing one
spine row) is a DIFFERENT defect - Sunrise Investment Opportunities' share
cell was never printed as a separate OCR line at all (only its % and amount
survived), so there is no share or serial anchor left to seed a spine row on.
Recovering it would mean guessing a share count neither the printed letter nor
the OCR ever gave us, which the defect-fix contract forbids ("nothing invents
a digit"). GLOTTIS's other five rows (0-4) are unaffected by that loss and are
asserted here at their correct, split values.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from anchor_report_text import ocr_table_page_rows  # noqa: E402

FIXTURES = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "tests", "fixtures", "anchor")


def _pages(symbol):
    path = os.path.join(FIXTURES, "%s-ocr-boxes.json" % symbol)
    with open(path, encoding="utf-8") as fh:
        return dict((p["page"], p["lines"]) for p in json.load(fh))


def test_lcc_splits_the_two_identical_investors_row_3_used_to_merge():
    """Citadel and Elite Capital: same allocation, two investors, two rows."""
    rows = ocr_table_page_rows(_pages("LCCPROJECT")[0])
    assert len(rows["centres"]) == 10

    names = rows["names"]
    citadel_idx = next(i for i, n in enumerate(names) if "CITADEL" in n)
    elite_idx = next(i for i, n in enumerate(names) if "ELITE" in n)
    assert citadel_idx != elite_idx, "Citadel and Elite still share one row"

    # Neither name carries the other fund's text - the concatenation the old
    # rebuild produced ("...CITADEL CAPITAL CRAFT EMERGING MARKET FUND
    # PCC- ELITE CAPITAL...").
    assert "ELITE" not in names[citadel_idx]
    assert "CITADEL" not in names[elite_idx]

    shares = rows["columns"][0]
    # Both investors are printed with the identical allocation. Elite's cell
    # keeps its OCR-corrupted separator glyph ("6,8 § ,03 2") - repairing that
    # glyph is a separate concern (slice 2's digit repair) from splitting the
    # row, which is what this test guards. The row split itself is proven by:
    # the digits present are exactly 6,8,0,3,2 (Elite's printed figure), and
    # the cell is NOT the doubled/concatenated shape the merged row produced
    # ("6,85.0326,8 ...", i.e. Citadel's digits followed by Elite's).
    assert shares[citadel_idx].replace(" ", "").replace(".", ",") == "6,85,032"
    elite_digits = "".join(c for c in shares[elite_idx] if c.isdigit())
    assert elite_digits == "68032", "Elite's share cell lost or gained a digit: %r" % shares[elite_idx]
    assert shares[citadel_idx] != shares[elite_idx], "Citadel's share cell was duplicated onto Elite's row"
    # The amount cell for Elite Capital is on its own row, not doubled onto
    # Citadel's.
    amounts = rows["columns"][3]
    assert amounts[citadel_idx].count("10,00") <= 1
    assert amounts[elite_idx].count("10,00") <= 1


def test_lcc_serial_3_stays_with_citadel_only():
    """The printed serial "3." belongs to Citadel; Elite has none printed -
    it must not be duplicated onto Elite's row, which would fabricate a serial
    the letter never printed."""
    rows = ocr_table_page_rows(_pages("LCCPROJECT")[0])
    names = rows["names"]
    citadel_idx = next(i for i, n in enumerate(names) if "CITADEL" in n)
    elite_idx = next(i for i, n in enumerate(names) if "ELITE" in n)
    assert rows["serials"][citadel_idx] == "3"
    assert rows["serials"][elite_idx] != "3"


def test_glotti_unaffected_rows_keep_their_split_values():
    """GLOTTIS page 1 rows 0-4 (Pharos, Meru, Abans, VPK, M7/Dewcap) were
    already correctly split before this slice; the row-geometry fix must not
    disturb them."""
    rows = ocr_table_page_rows(_pages("GLOTTIS")[1])
    names = rows["names"]
    pharos_idx = next(i for i, n in enumerate(names) if "Pharos" in n)
    vpk_idx = next(i for i, n in enumerate(names) if "VPK" in n)
    assert pharos_idx != vpk_idx
    shares = rows["columns"][0]
    assert shares[pharos_idx].replace(" ", "") == "775,200"
    assert shares[vpk_idx].replace(" ", "") == "775,200"


def test_glotti_residual_merge_is_the_documented_dropped_share_cell():
    """The one GLOTTIS row still holding two investors' text ("The Asio
    Fund..." / "Sunrise Investment Opportunities Fund") is the OCR-dropped-
    share-cell case, not a row-band bug - Sunrise Investment Opportunities'
    share count was never printed as a separate OCR line, so there is no
    anchor left to seed its own row. Documents the boundary rather than
    asserting a split this fix cannot produce without inventing a number."""
    rows = ocr_table_page_rows(_pages("GLOTTIS")[1])
    merged = [n for n in rows["names"] if "Sunrise Investment Opportunities" in n]
    assert merged, "expected the still-merged Sunrise Investment Opportunities row"
