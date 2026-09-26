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

from extract_filing import read_cover_company_name, run
from peer_companies import NO_LISTED_PEERS, check_against_printed_summary, extract_peer_companies
from peer_table_rows import parse_peer_table

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "extractor")


def load(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        data = json.load(handle)
    pages = [tuple(page) for page in data["pages"]]
    tables = {int(k): v for k, v in data["tables"].items()}
    return pages, (lambda index: tables.get(index, []))


def cover_of(peer_fixture):
    """The same document's real cover pages (sibling fixture)."""
    with open(os.path.join(FIXTURES, peer_fixture.replace("-peer-pages", "-cover-pages")),
              encoding="utf-8") as handle:
        return [tuple(page) for page in json.load(handle)]


def issuer_of(peer_fixture):
    """The issuer name exactly as the document's own cover prints it."""
    name = read_cover_company_name(cover_of(peer_fixture))
    assert name, peer_fixture
    return name


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
    found, reason = extract_peer_companies(pages, tables_for_page, issuer_of(fixture))
    assert reason is None, reason
    assert [p["name"] for p in found["peers"]] == expected


@pytest.mark.parametrize("fixture,expected", CASES)
def test_run_emits_peer_companies_for_a_prospectus(fixture, expected):
    pages, tables_for_page = load(fixture)
    doc_type = "DRHP" if "-drhp-" in fixture else "RHP"
    out = run(cover_of(fixture) + pages, doc_type, fixture, "MAINBOARD",
              tables_for_page=tables_for_page)
    field = out["fields"]["peer_companies"]
    assert [p["name"] for p in field["value"]] == expected
    assert field["page"] is not None


def test_the_issuer_is_never_its_own_peer():
    for fixture, _expected in CASES:
        pages, tables_for_page = load(fixture)
        found, _reason = extract_peer_companies(pages, tables_for_page, issuer_of(fixture))
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


# ---------------------------------------------------------------- #545 round 2

HEADER = ["Name of Company", "Face Value", "P/E", "Basic EPS", "Diluted EPS", "RoNW (%)", "NAV"]


def test_cover_company_name_is_read_from_every_real_cover():
    for fixture, _expected in CASES:
        assert issuer_of(fixture).endswith(("LIMITED", "LTD", "LTD.")), fixture


def test_a_no_listed_peers_sentence_does_not_discard_peers_printed_after_it():
    # Real-shaped: A-One Steels RHP p221's own row lines, under a section whose
    # opening sentence says there is no EXCLUSIVE listed peer - and then lists two.
    pages = [(220, "7. Comparison of Accounting Ratio with Listed Industry Peers\n"
                   "There are no listed companies in India engaged exclusively in the business\n"
                   "carried on by our Company; however, the following listed peers are\n"
                   "engaged in a broadly similar business:\n"
                   "A-One Consolidate 10 4,20,205.44 18.47 18.47 119.93 15.43 [●]# [●]#\n"
                   "Steels d\nIndia\nLimited*\n"
                   "Listed Peers\n"
                   "MSP Consolidate 10 2,84,604.06 0.60 0.56 18.18 N.A 61.52 12.71\n"
                   "Steel and d\nPower\nLimited\n"
                   "Jai Balaji Standalone 2 5,82,059.00 1.42 1.42 24.75 N.A 45.76 18.17\n"
                   "Industries\nLtd.\n")]
    found, reason = extract_peer_companies(pages, lambda _i: [], "A-ONE STEELS INDIA LIMITED")
    assert reason is None, reason
    assert [p["name"] for p in found["peers"]] == ["MSP Steel and Power Limited",
                                                  "Jai Balaji Industries Ltd."]


def test_no_summary_is_not_cross_checked_never_a_pass():
    for fixture, _expected in CASES:
        pages, tables_for_page = load(fixture)
        doc_type = "DRHP" if "-drhp-" in fixture else "RHP"
        field = run(cover_of(fixture) + pages, doc_type, fixture, "MAINBOARD",
                    tables_for_page=tables_for_page)["fields"]["peer_companies"]
        # Measured: none of the four real documents prints a highest/lowest summary.
        assert field["cross_check"]["status"] == "not_cross_checked", fixture
        assert field["check"]["name"] != "peer_list_matches_printed_summary", fixture
        assert field["value"], fixture
    passed, detail = check_against_printed_summary([{"name": "X Ltd"}], [(1, "no summary here")])
    assert passed is None and detail.startswith("not_cross_checked")


def test_a_printed_summary_still_passes_or_fails_the_cross_check():
    text = [(1, "Highest 61.57 MSP Steel & Power Limited\nLowest 8.92 VMS TMT Limited\n")]
    assert check_against_printed_summary(
        [{"name": "MSP Steel & Power Limited"}, {"name": "VMS TMT Limited"}], text)[0] is True
    assert check_against_printed_summary([{"name": "MSP Steel & Power Limited"}], text)[0] is False


def test_is_listed_follows_the_rows_actual_group():
    # German Green's combined divider says nothing per row: unknown, not True.
    pages, tables_for_page = load("german-green-steel-and-power-ltd-rhp-peer-pages.json")
    found, _ = extract_peer_companies(pages, tables_for_page, "GERMAN GREEN STEEL AND POWER LIMITED")
    assert {p["is_listed"] for p in found["peers"]} == {None}
    table = [HEADER,
             ["Issuer Co Limited", "10", "NA", "14.91", "14.91", "18.86", "77.76"],
             ["Listed Peers", "", "", "", "", "", ""],
             ["Alpha Steel Limited", "10", "22.54", "18.94", "18.94", "3.49", "548.18"],
             ["Unlisted Peers", "", "", "", "", "", ""],
             ["Beta Ispat Private Limited", "10", "NA", "20.07", "20.07", "14.60", "137.44"]]
    parsed = parse_peer_table(table)
    assert [(p["name"], p["is_listed"]) for p in parsed["peers"]] == [
        ("Alpha Steel Limited", True), ("Beta Ispat Private Limited", False)]


def test_no_divider_fallback_checks_the_issuer_name():
    rows = [["Alpha Steel Limited", "10", "22.54", "18.94", "18.94", "3.49", "548.18"],
            ["Issuer Co Limited", "10", "NA", "14.91", "14.91", "18.86", "77.76"],
            ["Gamma Metals Ltd", "1", "14.57", "2.78", "2.72", "19.77", "14.06"]]
    # Issuer printed second: recognised by name, and row 1 stays a peer.
    parsed = parse_peer_table([HEADER] + rows, "ISSUER CO LIMITED")
    assert parsed["issuer"]["name"] == "Issuer Co Limited"
    assert [p["name"] for p in parsed["peers"]] == ["Alpha Steel Limited", "Gamma Metals Ltd"]
    # No row carries the issuer's name, or no name is known: refused, never guessed.
    assert parse_peer_table([HEADER] + rows, "SOMEONE ELSE LIMITED")["peers"] == []
    assert parse_peer_table([HEADER] + rows)["peers"] == []
