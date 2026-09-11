"""Item 8a — reading the peer rows, checked against the document's own summary.

The strongest test here is not one I invented. Each prospectus prints a P/E
summary naming which company has the HIGHEST and which the LOWEST price/earnings
"of the peer set provided below". So the document itself says two companies that
must appear in the parsed peer set. A parser that drops rows fails that check
without anyone having to hand-write the expected list.

That oracle immediately paid for itself: it showed PRASOLCHEM has SEVEN listed
peers, not the five recorded on the build card. The five came from an earlier
page dump I had truncated at 3,500 characters. Yasho and Excel - the very two
the summary names as highest and lowest - were in the part I never read.
"""

import io
import json
import os
import re

import pytest

from peer_table_rows import parse_peer_table

FIXTURES = os.path.join(
    os.path.dirname(__file__), "..", "tests", "fixtures", "peer-tables"
)


def cells(name, index):
    with io.open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        return json.load(handle)["tables"][index]


def text(name):
    with io.open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        return handle.read()


KARAMTARA = ("karamtara-peer-cells.json", 1)
PRASOLCHEM = ("prasolchem-peer-cells.json", 1)


def test_karamtara_yields_its_issuer_and_eight_peers():
    result = parse_peer_table(cells(*KARAMTARA))
    assert result["issuer"]["name"].startswith("Karamtara")
    assert len(result["peers"]) == 8


def test_prasolchem_yields_its_issuer_and_seven_peers():
    """SEVEN, not the five the card recorded. See the module docstring: the
    earlier count came from a truncated dump."""
    result = parse_peer_table(cells(*PRASOLCHEM))
    assert result["issuer"]["name"].startswith("Prasol")
    assert len(result["peers"]) == 7


def test_the_issuer_is_never_one_of_its_own_peers():
    """The issuer prints its own figures ABOVE the divider. Counting it as a
    comparator puts a company in its own peer set and skews every average
    computed from it."""
    for fixture in (KARAMTARA, PRASOLCHEM):
        result = parse_peer_table(cells(*fixture))
        issuer_name = result["issuer"]["name"]
        assert all(p["name"] != issuer_name for p in result["peers"])


def _first_two_words(name):
    return " ".join(re.sub(r"[^A-Za-z ]", " ", name).split()[:2]).lower()


@pytest.mark.parametrize(
    "cell_fixture,index,text_fixture",
    [
        ("karamtara-peer-cells.json", 1, "karamtara-peer-table.txt"),
        ("prasolchem-peer-cells.json", 1, "prasolchem-peer-table.txt"),
    ],
)
def test_the_documents_own_summary_names_companies_we_parsed(
    cell_fixture, index, text_fixture
):
    """The document's own P/E summary is the oracle.

    It names the highest and lowest P/E "of the peer set provided below", so
    both must appear among the parsed peers. This catches a dropped row without
    anyone hand-writing the expected list - and it is the check that found the
    card's peer count wrong.

    Matched on the first TWO WORDS rather than the full name, because the
    documents are internally inconsistent: Karamtara's summary calls a peer
    `KP Green Energy Limited` while its own table calls the same company
    `KP Green Engineering Limited`. The real company is KP Green Engineering.
    An exact-match oracle would fail on a correct parse, and a test that fails on
    correct output is a test that gets deleted.
    """
    parsed = parse_peer_table(cells(cell_fixture, index))
    peers = {_first_two_words(p["name"]) for p in parsed["peers"]}

    summary = re.findall(
        r"^\s*(?:Highest|Lowest)\s+[\d.,]+\s+(.+?)\s*$",
        text(text_fixture),
        re.M,
    )
    named = [_first_two_words(re.sub(r"\s+[\d.,]+\s*$", "", n)) for n in summary]
    named = [n for n in named if n]
    assert named, "the fixture no longer carries a Highest/Lowest summary"

    missing = [n for n in named if n not in peers]
    assert not missing, "summary names companies missing from the parsed peers: %s" % missing


def test_every_peer_carries_real_values_not_just_a_name():
    """A row with a name and nothing else is a continuation fragment, not a
    company. Emitting it would put an all-null peer into the table."""
    for fixture in (KARAMTARA, PRASOLCHEM):
        result = parse_peer_table(cells(*fixture))
        for peer in result["peers"]:
            values = [v for k, v in peer.items() if k != "name" and v is not None]
            assert len(values) >= 2, "%s has no real values" % peer["name"]


def test_pending_placeholders_come_back_as_absent():
    """Karamtara's own closing price and P/E are `NA#` until the Offer Price is
    fixed. They must be None, not the string 'NA#', and their absence must not
    disqualify the row."""
    issuer = parse_peer_table(cells(*KARAMTARA))["issuer"]
    assert issuer["closing_price"] is None
    assert issuer["pe"] is None
    # ...while the values that ARE printed survive.
    assert issuer["revenue_from_operations"] == "43,119.76"
    assert issuer["face_value"] == "10.00"


def test_values_are_returned_as_printed():
    """Conversion is the persister's job. Doing it here buries a formatting
    decision - Indian digit grouping, percent signs, currency marks - inside a
    parser, where it cannot be seen or changed."""
    peers = parse_peer_table(cells(*KARAMTARA))["peers"]
    waaree = next(p for p in peers if p["name"].startswith("Waaree"))
    assert waaree["revenue_from_operations"] == "265,367.70"
    assert waaree["ronw_pct"] in ("32.48 %", "32.48%")


def test_a_single_peer_table_is_valid():
    """Glasswall lists exactly ONE peer, which is why its summary reads Highest
    16.54 / Lowest 16.54 / Average 16.54. A parser requiring two or more rejects
    a valid table."""
    table = [
        ["Name of Company", "Face Value", "Revenue from operations", "P/E"],
        ["Glass Wall Systems", "2.00", "4,569.71", "N.A."],
        ["Listed Peers", "", "", ""],
        ["Innovator Facade Systems Limited", "10.00", "2,275.15", "16.54"],
    ]
    result = parse_peer_table(table)
    assert len(result["peers"]) == 1
    assert result["peers"][0]["name"].startswith("Innovator")


def test_a_table_with_no_divider_yields_no_peers_rather_than_guessing():
    """Without the divider there is no way to tell the issuer from its
    comparators. Returning the rows as peers would silently include the issuer;
    returning none is the honest answer."""
    table = [
        ["Name of Company", "Face Value", "Revenue from operations", "P/E"],
        ["Some Company Limited", "2.00", "4,569.71", "12.00"],
        ["Another Company Limited", "10.00", "2,275.15", "16.54"],
    ]
    result = parse_peer_table(table)
    assert result["peers"] == []
    assert result["issuer"]["name"] == "Some Company Limited"


def test_a_name_only_fragment_is_not_emitted_as_a_peer():
    """PDF tables leave continuation lines inside the row range: a wrapped
    company name, a note, a stray label. Each carries a name-ish first cell and
    nothing after it.

    This case is synthetic because neither committed fixture happens to contain
    such a row — which mutation testing exposed: removing the minimum-value
    filter changed no result, so the filter read as a guard while never being
    reached. A rule that is never exercised is indistinguishable from one that
    does not work.
    """
    table = [
        ["Name of Company", "Face Value", "Revenue from operations", "P/E"],
        ["Issuer Limited", "2.00", "4,569.71", "12.00"],
        ["Listed Peers", "", "", ""],
        ["Real Peer Limited", "10.00", "2,275.15", "16.54"],
        ["Continuation Of A Wrapped Name", "", "", ""],
        ["Another Fragment", "", "", "8.00"],
    ]
    result = parse_peer_table(table)
    names = [p["name"] for p in result["peers"]]
    assert names == ["Real Peer Limited"], names

@pytest.mark.parametrize(
    "fixture",
    [
        # Karamtara's headers are single-level, so this passes today - which is
        # what makes the check meaningful rather than a blanket "known broken".
        KARAMTARA,
        pytest.param(
            PRASOLCHEM,
            marks=pytest.mark.xfail(
                strict=True,
                reason="#596 two-level headers map a child column by its LABEL's "
                       "index; PRASOLCHEM's Basic/Diluted labels sit one column "
                       "right of their data",
            ),
        ),
    ],
)
def test_no_mapped_column_is_empty_for_EVERY_peer(fixture):
    """A column that mapped but is blank in every row was mapped to the wrong place.

    This is the CLASS, not one bad field. If the mapper claims a column exists
    and not one of the peers has a value in it, the index is pointing at the
    wrong column - there is no honest reading in which a prospectus prints a
    header and then leaves it blank for every single company.

    The instance that exposed it: PRASOLCHEM's EPS header is two-level - a
    parent `EPS as on March 31, 2026` spanning several columns with `Basic` and
    `Diluted` underneath. pdfplumber centres each child LABEL inside its
    sub-span while the numbers sit left-aligned, so the label lands one column
    to the RIGHT of its own data:

        header row 3:   [8]='Basic'   [11]='Diluted'
        every data row: [7]=60.19     [10]=60.19

    `map_columns` assigns the child by the label's index, so `eps_basic` -> 8
    and `eps_diluted` -> 11, both empty in every body row. All seven peers carry
    a null EPS, and `filing-persister` reads exactly those two keys - so the
    database gets nulls for a number the table prints plainly.

    Nothing caught it, because `test_every_peer_carries_real_values_not_just_a_name`
    only demands two non-null values and revenue, NAV and P/E already supply
    them. A row can lose half its columns and still look healthy.

    `strict=True` so whoever fixes the mapper is FORCED to delete this marker.
    An xfail that quietly starts passing is how a known defect becomes a
    forgotten one.
    """
    parsed = parse_peer_table(cells(*fixture))
    peers = parsed["peers"]
    dead = []
    for column in parsed["columns"]:
        if column == "name":
            continue
        if all(p.get(column) is None for p in peers):
            dead.append(column)
    assert not dead, "mapped but empty for all %d peers: %s" % (len(peers), dead)
