"""Item 46 round 3 (OD-165, OD-158) - SME RHP peer sections the reader missed.

Staging 2026-10-03: S. K. Offset, Papadmalji, Vivekanand Cotspin and Robokidz
each had 0 peer_companies rows. Read on their real text (pages cut from the
staging-store documents, see each sibling .meta.json), the causes were:

* Vivekanand p113 "6. Comparison with Peer Group Companies:" - a heading the
  locator did not know, then a table whose header sits one column RIGHT of
  every value, so no row parsed. It prints two listed peers.
* Robokidz p97 "6. Comparison of Accounting Ratios with Industry Peers" (no
  "listed"), whose body states "The company has no directly comparable listed
  peers" - a stated absence that read as peer_comparison_table_not_in_document.
* S. K. Offset prints no peer section; its KPI section p119 states "There are
  presently no listed Companies in India that are engaged in a business that
  is directly comparable" - a stated absence that read as a miss.
* Papadmalji p128 already reads as a stated absence; its p132 KPI heading is
  misspelt ("indictors") and must never be taken for the peer section.
"""

import json
import os

import pytest

from peer_companies import (NO_LISTED_PEERS, NOT_IN_DOCUMENT, ONLY_KPI_TABLE,
                            extract_peer_companies)
from peer_table_section import find_peer_table_section

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "extractor")


def load(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        data = json.load(handle)
    pages = [tuple(page) for page in data["pages"]]
    tables = {int(k): v for k, v in data["tables"].items()}
    return pages, (lambda index: tables.get(index, []))


def test_vivekanand_peer_group_section_yields_its_two_printed_peers():
    pages, tables = load("vivekanand-cotspin-ltd-rhp-peer-pages.json")
    found, reason = extract_peer_companies(pages, tables)
    assert reason is None
    assert found["page"] == 113
    assert found["issuer"]["name"] == "Vivekanand Cotspin Limited"
    # Values exactly as printed on p113 (Rs in lakhs for revenue).
    assert found["peers"] == [
        {"name": "Deepak Spinners limited", "revenue_from_operations": "53,416.00",
         "eps_basic": "5.06", "eps_diluted": "5.06", "pe_diluted": "22.11", "nav": "319.10",
         "is_listed": True},
        {"name": "Lagnam Spintex Limited", "revenue_from_operations": "60,498.05",
         "eps_basic": "8.14", "eps_diluted": "8.14", "pe_diluted": "9.52", "nav": "76.60",
         "is_listed": True},
    ]


def test_vivekanand_issuer_figures_come_from_the_value_cells_not_the_header_cells():
    pages, tables = load("vivekanand-cotspin-ltd-rhp-peer-pages.json")
    found, _ = extract_peer_companies(pages, tables)
    assert found["issuer"]["revenue_from_operations"] == "40,801.01"
    assert found["issuer"]["nav"] == "17.81"


@pytest.mark.parametrize("fixture,page", [
    ("robokidz-eduventures-ltd-rhp-peer-pages.json", None),
    ("s-k-offset-ltd-rhp-peer-pages.json", None),
    ("papadmalji-agro-foods-ltd-rhp-peer-pages.json", None),
])
def test_a_document_that_states_no_listed_peer_is_a_stated_absence(fixture, page):
    pages, tables = load(fixture)
    found, reason = extract_peer_companies(pages, tables)
    assert found is None
    assert reason == NO_LISTED_PEERS


def test_robokidz_industry_peers_heading_is_the_peer_section():
    pages, _ = load("robokidz-eduventures-ltd-rhp-peer-pages.json")
    lines = dict(pages)[97].split("\n")
    heading, _body = find_peer_table_section(lines)
    assert heading is not None
    assert "Comparison of Accounting Ratios with Industry Peers" in lines[heading]


def test_misspelt_kpi_heading_is_never_the_peer_section():
    pages, _ = load("papadmalji-agro-foods-ltd-rhp-peer-pages.json")
    lines = dict(pages)[132].split("\n")
    heading, _body = find_peer_table_section(lines)
    assert heading is None


def test_kpi_section_without_a_no_peers_sentence_stays_a_miss():
    """The KPI-section fallback reads ONLY a literal statement: remove S. K.
    Offset's sentence and the answer is the KPI-only miss, never an absence."""
    pages, tables = load("s-k-offset-ltd-rhp-peer-pages.json")
    edited = [(i, t.replace("There are presently no listed Companies in India",
                            "Below is the KPI comparison for the Company"))
              for i, t in pages]
    found, reason = extract_peer_companies(edited, tables)
    assert found is None
    assert reason == ONLY_KPI_TABLE


def test_no_peer_and_no_kpi_section_is_not_in_document():
    pages, tables = load("s-k-offset-ltd-rhp-peer-pages.json")
    only_p116 = [p for p in pages if p[0] == 116]
    found, reason = extract_peer_companies(only_p116, tables)
    assert found is None
    assert reason == NOT_IN_DOCUMENT


def test_uniform_shift_refused_when_one_mapped_column_holds_its_own_data():
    """Fail closed: if any mapped column already has values, the left-shift is
    not uniform and nothing moves (a partial shift would put one field's numbers
    under another). Same real table, NAV figures copied into the NAV header column."""
    from peer_table_rows import parse_peer_table
    _pages, tables = load("vivekanand-cotspin-ltd-rhp-peer-pages.json")
    table = [list(row) for row in tables(113)[3]]
    for row in table[6:]:
        row[22] = row[21]
    parsed = parse_peer_table(table)
    assert parsed["columns"]["revenue_from_operations"] == 7
    assert parsed["peers"] == []


def test_uniform_shift_refused_when_a_left_neighbour_is_labelled():
    from peer_table_rows import parse_peer_table
    _pages, tables = load("vivekanand-cotspin-ltd-rhp-peer-pages.json")
    table = [list(row) for row in tables(113)[3]]
    table[1][6] = "CMP (Rs)"
    parsed = parse_peer_table(table)
    assert parsed["columns"]["revenue_from_operations"] == 7
