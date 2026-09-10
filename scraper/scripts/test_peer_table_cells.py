"""Item 8a — the CELL fixtures, and the three extraction modes they encode.

The text fixtures (committed earlier) are what the section LOCATOR is tested on.
These are what the column MAPPER will be tested on, and they exist because the
text layer cannot support header mapping at all: a header block arrives as one
or two words per line with nothing marking where one column header ends and the
next begins.

**Four issuers produced THREE extraction modes.** No single path covers them,
and that is the fact the mapper has to be built around rather than discover:

1. UPRIGHT, detected as a table — Karamtara, PRASOLCHEM. `extract_tables()`
   returns column-aligned cells.
2. ROTATED 90 degrees — Kanohar. What `extract_tables()` calls a row is a
   printed COLUMN, and each word's characters are stored reversed. One rotation
   seen twice, not two defects. `page.rotation` is 0 and there is no `/Rotate`
   entry, so no metadata reveals it; the content is the only signal.
3. TEXT-ONLY, no table detected at all — Glasswall. Neither the default
   (line-based) nor the text-based table strategy finds its peer table; it
   exists only in the text layer. **Deliberately absent from these fixtures**,
   because capturing an empty table as if it were the peer table is exactly the
   kind of fixture that makes a parser look correct while measuring nothing.

The negative fixture is the point of the exercise: Kanohar prints a SECOND
peer-shaped table listing the same companies with numeric columns, so without a
case demanding the parser reject it, "found a table" and "found the RIGHT table"
are the same question and only the first is being asked.
"""

import json
import os

import pytest

FIXTURES = os.path.join(
    os.path.dirname(__file__), "..", "tests", "fixtures", "peer-tables"
)


def load(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        return json.load(handle)


def flatten(payload):
    """Fixtures come in two shapes: upright ones carry `tables` (a list of
    tables of rows of cells), rotated ones carry `rows` (a list of token
    lists). Joined here so a content assertion does not depend on which."""
    if "tables" in payload:
        return "\n".join(" ".join(row) for table in payload["tables"] for row in table)
    return "\n".join(" ".join(row) for row in payload["rows"])


UPRIGHT = [
    # (fixture, table index of the peer table, peers that must be present)
    ("karamtara-peer-cells.json", 1, ["Inox Wind", "Waaree", "Emmvee"]),
    ("prasolchem-peer-cells.json", 1, ["Aarti", "Atul", "Privi"]),
]


@pytest.mark.parametrize("name,index,peers", UPRIGHT)
def test_upright_fixture_holds_its_peer_table(name, index, peers):
    payload = load(name)
    assert payload["orientation"] == "upright"
    text = flatten(payload)
    missing = [p for p in peers if p not in text]
    assert not missing, "%s is missing peer rows: %s" % (name, missing)


@pytest.mark.parametrize("name,index,peers", UPRIGHT)
def test_the_peer_table_is_not_at_a_fixed_index(name, index, peers):
    """Karamtara's peer table is table 1 of 2; PRASOLCHEM's is 1 of 11. The
    mapper must choose by header row, never by position — this asserts the
    fixtures still contain more than one table so a positional shortcut cannot
    quietly start working."""
    payload = load(name)
    assert payload["tableCount"] > 1


def test_prasolchem_reports_more_columns_than_it_has():
    """About half of PRASOLCHEM's 20 reported columns are empty filler produced
    by whitespace gutters. A mapper that trusts the column count will mis-align;
    real columns are the ones with a non-empty reconstructed header."""
    tables = load("prasolchem-peer-cells.json")["tables"]
    peer = tables[1]
    assert len(peer[0]) >= 18
    empties = sum(1 for cell in peer[0] if cell.strip() == "")
    assert empties >= 5, "expected substantial empty filler in the header row"


def test_the_rotated_fixture_recovered_every_peer():
    """Kanohar, via the rotation recipe. Every figure here was cross-checked
    against the pypdf text layer read independently — that cross-check with a
    second library is what makes this a capture rather than a plausible-looking
    output."""
    payload = load("kanohar-peer-cells.json")
    assert payload["orientation"] == "rotated"
    text = flatten(payload)
    for peer in ["Hitachi", "Bharat Heavy", "Schneider", "CG Power", "GE Vernova"]:
        assert peer in text, "rotated recovery lost %s" % peer


def test_the_rotated_fixture_keeps_the_divider_and_the_issuer_row():
    """The issuer's own row sits ABOVE the `Listed peers` divider and is not a
    peer. Losing the divider would make the issuer indistinguishable from its
    own comparators."""
    text = flatten(load("kanohar-peer-cells.json"))
    assert "Listed peers" in text
    assert "Kanohar Electricals" in text


def test_the_rotated_numbers_survived_intact():
    """A spot check with real figures, so a recipe that produced readable
    gibberish would fail here rather than pass on the strength of the names."""
    text = flatten(load("kanohar-peer-cells.json"))
    for value in ["81,477.10", "35,360.00", "159.55", "1,161.56"]:
        assert value in text, "lost %s from the Hitachi row" % value


def test_company_names_are_truncated_and_that_is_known():
    """A documented LIMITATION, asserted so it cannot be mistaken for a defect
    later, and so that fixing it is a visible change rather than a silent one.
    The fixed x bucket splits the name column, so `Bharat Heavy Electricals
    Limited` arrives as `Bharat Heavy`. Every NUMERIC column is complete."""
    text = flatten(load("kanohar-peer-cells.json"))
    assert "Bharat Heavy" in text
    assert "Bharat Heavy Electricals Limited" not in text


def test_the_negative_fixture_is_the_other_table():
    """Guards the discrimination case: an empty or wrong capture would satisfy
    "is not the peer table" by containing nothing at all."""
    text = flatten(load("kanohar-kpi-cells-NEGATIVE.json"))
    assert "Hitachi" in text, "the negative fixture must be a real, populated table"


def test_glasswall_has_no_cell_fixture_on_purpose():
    """Glasswall's peer table is not detected as a table by EITHER pdfplumber
    strategy — it exists only in the text layer. No cell fixture is committed
    for it, because capturing an empty table as though it were the peer table is
    how a parser comes to look correct while measuring nothing.

    This test exists so that absence is deliberate and documented rather than an
    oversight someone later 'fixes' by committing an empty capture.
    """
    assert not os.path.exists(os.path.join(FIXTURES, "glasswall-peer-cells.json"))
    # The text fixture for the same issuer IS present, and is what covers it.
    assert os.path.exists(os.path.join(FIXTURES, "glasswall-peer-table.txt"))
