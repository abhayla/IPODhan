"""Item 8a — mapping peer-table columns by HEADER NAME, on two real issuers.

The point of the whole item in one assertion: the same ten fields live at
DIFFERENT column indices in the two documents. Karamtara puts revenue 5th,
PRASOLCHEM puts market capitalisation nowhere at all and adds total income. A
parser reading a fixed row by position stores one issuer's revenue as another's
face value — no crash, no warning, a wrong number reported as success.
"""

import io
import json
import os

import pytest

from peer_table_columns import (
    detect_header_row_count,
    is_divider_row,
    is_placeholder,
    map_columns,
    reconstruct_headers,
)

FIXTURES = os.path.join(
    os.path.dirname(__file__), "..", "tests", "fixtures", "peer-tables"
)

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))


def peer_table(name, index):
    with io.open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        return json.load(handle)["tables"][index]


def mapping_for(name, index):
    table = peer_table(name, index)
    return map_columns(reconstruct_headers(table, detect_header_row_count(table)))


KARAMTARA = ("karamtara-peer-cells.json", 1)
PRASOLCHEM = ("prasolchem-peer-cells.json", 1)


def test_karamtara_maps_every_column_it_prints():
    m = mapping_for(*KARAMTARA)
    assert m == {
        "name": 0,
        "face_value": 1,
        "closing_price": 2,
        "market_cap": 3,
        "revenue_from_operations": 4,
        "eps_basic": 5,
        "eps_diluted": 6,
        "nav": 7,
        "pe": 8,
        "ronw_pct": 9,
    }


def test_prasolchem_maps_every_column_it_prints():
    m = mapping_for(*PRASOLCHEM)
    assert m == {
        "name": 0,
        "face_value": 2,
        "revenue_from_operations": 5,
        "total_income": 6,
        "eps_basic": 8,
        "eps_diluted": 11,
        "nav": 13,
        "pe_diluted": 16,
        "pe_basic": 17,
        "ronw_pct": 18,
    }


def test_the_same_field_sits_at_different_indices_in_the_two_issuers():
    """The reason this mapper exists, asserted directly rather than implied."""
    k = mapping_for(*KARAMTARA)
    p = mapping_for(*PRASOLCHEM)
    assert k["revenue_from_operations"] != p["revenue_from_operations"]
    assert k["face_value"] != p["face_value"]
    assert k["ronw_pct"] != p["ronw_pct"]


def test_the_column_SET_differs_too():
    k = set(mapping_for(*KARAMTARA))
    p = set(mapping_for(*PRASOLCHEM))
    assert "market_cap" in k and "market_cap" not in p
    assert "total_income" in p and "total_income" not in k
    # Six are universal across the four issuers measured.
    for field in ("name", "face_value", "revenue_from_operations", "nav", "ronw_pct"):
        assert field in k and field in p


def test_empty_filler_columns_are_dropped():
    """PRASOLCHEM reports 20 columns; about half are filler from whitespace
    gutters. A mapper that trusts the count mis-aligns."""
    table = peer_table(*PRASOLCHEM)
    headers = reconstruct_headers(table, detect_header_row_count(table))
    assert len(headers) >= 18
    assert len(mapping_for(*PRASOLCHEM)) == 10


def test_the_header_row_count_is_derived_not_guessed():
    """A fixed count pulled PRASOLCHEM's own DATA row into the header, so the
    first reconstructed header read "Name of Company Prasol Chemicals Limited".
    That is how a mapper points a field at the wrong column while looking like
    it worked."""
    table = peer_table(*PRASOLCHEM)
    count = detect_header_row_count(table)
    headers = reconstruct_headers(table, count)
    assert "Prasol Chemicals" not in headers[0]
    assert headers[0].strip() == "Name of Company"


def test_a_merged_parent_header_is_not_mapped_to_its_empty_column():
    """PRASOLCHEM's `EPS as on March 31, 2026` holds no values — its children
    `Basic` and `Diluted` do. Mapping the parent points the field at a column of
    empty cells, which is a confident wrong answer rather than a miss."""
    m = mapping_for(*PRASOLCHEM)
    assert m["eps_basic"] == 8
    assert m["eps_diluted"] == 11
    assert 7 not in m.values()


def test_a_bare_pe_is_a_data_column_when_no_child_follows():
    """The same text is a parent on one issuer and a data column on the other.
    Karamtara's `P/E` is followed by RoNW, so it holds the values."""
    assert mapping_for(*KARAMTARA)["pe"] == 8


def test_a_split_metric_keeps_both_halves_apart():
    m = mapping_for(*PRASOLCHEM)
    assert m["pe_diluted"] != m["pe_basic"]


@pytest.mark.parametrize(
    "row,expected",
    [
        (["Listed Peers", "", ""], True),
        (["Peer Group:", ""], True),
        (["listed peers"], True),
        (["Inox Wind Limited", "10.00"], False),
        (["", ""], False),
    ],
)
def test_the_divider_row_is_recognised(row, expected):
    assert is_divider_row(row) is expected


@pytest.mark.parametrize(
    "value,expected",
    [
        ("NA#", True),
        ("N.A.", True),
        ("[.]", True),
        ("", True),
        ("  ", True),
        ("-", True),
        ("30.15", False),
        ("1,161.56", False),
    ],
)
def test_pending_price_placeholders_are_absent_not_invalid(value, expected):
    """The issuer's own P/E is genuinely unknown until the Offer Price is set,
    and the document says so. Treating that as a parse failure rejects a valid
    row."""
    assert is_placeholder(value) is expected


def test_no_source_file_contains_a_control_character():
    """A guard against a real corruption that cost half an hour tonight.

    A regex written as ``\\bEPS\\b`` reached this file with the escapes already
    interpreted, so the source held literal BACKSPACE bytes and the pattern could
    never match. Every editor and diff renders them invisibly, so the code READ
    correctly, the tests were "not smart enough", and the fault looked like a
    logic gap rather than a corrupted file.

    It scans the item 8 modules rather than the whole tree: a check that reports
    on files this slice does not own would fail for reasons its owner cannot fix,
    and get switched off.
    """
    offenders = []
    for name in sorted(os.listdir(SCRIPTS_DIR)):
        if not name.startswith(("peer_table_", "test_peer_table_")):
            continue
        with io.open(os.path.join(SCRIPTS_DIR, name), encoding="utf-8") as handle:
            text = handle.read()
        bad = [hex(ord(c)) for c in text if ord(c) < 9 or 10 < ord(c) < 32]
        if bad:
            offenders.append("%s: %s" % (name, sorted(set(bad))))
    assert not offenders, "control characters in source: %s" % offenders
