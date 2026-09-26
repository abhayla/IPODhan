"""#545 - a prospectus's listed-peer comparison must yield its peers.

Staging 2026-09-26: 89 of 91 COMPLETED RHP/DRHP documents belong to IPOs with 0
peer_companies rows, and every real RHP tried returned
`peer_comparison_table_found_but_no_peer_rows_parsed`. Each case below is one
mechanism, on pages cut from a REAL staging-store document (see each sibling
.meta.json): the page text exactly as extract_filing.py reads it, and the
tables exactly as `tables_for_page` returns them.
"""

import json
import os

import pytest

from extract_filing import run
from peer_companies import NO_LISTED_PEERS, extract_peer_companies

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "extractor")


def load(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        data = json.load(handle)
    pages = [tuple(page) for page in data["pages"]]
    tables = {int(k): v for k, v in data["tables"].items()}
    return pages, (lambda index: tables.get(index, []))


CASES = [
    # Mechanism 1 + 2: the heading ends p220, the table is on p221, and p221's
    # table body is plain text (pdfplumber returns the header cells only).
    ("a-one-steels-india-ltd-rhp-peer-pages.json",
     ["MSP Steel and Power Limited", "Jai Balaji Industries Ltd.", "Shyam Metallics and Energy Ltd."]),
    # Mechanism 3: "f) Comparison of Accounting Ratios with listed industry peers"
    # (a letter marker) was not matched, and p184's "Comparison of Key
    # Performance Indicators with listed industry peers" was taken instead. Its
    # divider reads "Listed and unlisted Peers".
    ("german-green-steel-and-power-ltd-rhp-peer-pages.json",
     ["Beekay Steel Industries Ltd", "Gallant Ispat Limited", "Kamdhenu Limited",
      "MSP Steel & Power Limited", "VMS TMT Limited"]),
    # The same issuer's DRHP prints no divider row at all: issuer first, peers after.
    ("a-one-steels-india-ltd-drhp-peer-pages.json",
     ["MSP Steel and Power Limited", "Jai Balaji Industries Ltd.", "Shyam Metallics and Energy Ltd."]),
    # SME: the names sit one column right of their header, and "Limited" wraps
    # into a row of its own.
    ("green-asia-impex-ltd-rhp-peer-pages.json",
     ["Apex Frozen Foods Limited", "Kings Infra Ventures Limited", "Essex Marine Limited"]),
]


@pytest.mark.parametrize("fixture,expected", CASES)
def test_real_peer_section_yields_every_peer_on_the_page(fixture, expected):
    pages, tables_for_page = load(fixture)
    found, reason = extract_peer_companies(pages, tables_for_page)
    assert reason is None, reason
    assert [p["name"] for p in found["peers"]] == expected


@pytest.mark.parametrize("fixture,expected", CASES)
def test_run_emits_peer_companies_for_a_prospectus(fixture, expected):
    pages, tables_for_page = load(fixture)
    doc_type = "DRHP" if "-drhp-" in fixture else "RHP"
    out = run(pages, doc_type, fixture, "MAINBOARD", tables_for_page=tables_for_page)
    field = out["fields"]["peer_companies"]
    assert [p["name"] for p in field["value"]] == expected
    assert field["page"] is not None


def test_the_issuer_is_never_its_own_peer():
    for fixture, _expected in CASES:
        pages, tables_for_page = load(fixture)
        found, _reason = extract_peer_companies(pages, tables_for_page)
        issuer = found["issuer"]["name"].lower()
        assert all(p["name"].lower() != issuer for p in found["peers"]), fixture


def test_an_issuer_that_states_it_has_no_listed_peer_gets_its_own_reason():
    pages = [(90, "5. Comparison of Accounting Ratios with Listed Industry Peers\n"
                  "There are no listed companies in India that are engaged in a business\n"
                  "similar to that of our Company. Accordingly, it is not possible to\n"
                  "provide an industry comparison in relation to our Company.\n")]
    found, reason = extract_peer_companies(pages, lambda _i: [])
    assert found is None
    assert reason == NO_LISTED_PEERS
