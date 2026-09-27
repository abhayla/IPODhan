"""#545 — a prospectus (RHP / DRHP) names its promoters, and the extractor must emit them.

Every SEBI ICDR offer document prints "OUR PROMOTERS: A, B AND C" on its cover.
Before this fix only `extract_price_band_ad` read that line, so an IPO whose
only filings were an RHP and a DRHP ended with zero `promoters` rows (staging
2026-09-26: 59 of 91 COMPLETED RHP/DRHP documents belong to IPOs with no
promoter row at all).

The fixtures are the first three pages of four REAL documents copied from the
staging document store (see each sibling .meta.json): MAINBOARD RHP + DRHP of
the same issuer, a MAINBOARD RHP whose promoter line wraps onto a second line,
and an SME RHP. Read with `run()`, the same entry the CLI uses.
"""

import json
import os

import pytest

from extract_filing import run

FIXTURES = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "extractor")


def load(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        return [tuple(page) for page in json.load(handle)]


CASES = [
    ("a-one-steels-india-ltd-rhp-cover-pages.json", "RHP", "MAINBOARD",
     ["Sandeep Kumar", "Sunil Jallan", "Krishan Kumar Jalan"]),
    ("a-one-steels-india-ltd-drhp-cover-pages.json", "DRHP", "MAINBOARD",
     ["Sandeep Kumar", "Sunil Jallan", "Krishan Kumar Jalan"]),
    # Page 0 wraps the third name onto the next line ("... IRAKI AND" / "IBRARULHAQ
    # INAMULHAQ IRAKI"); a reader that stops at the line end loses a promoter.
    ("german-green-steel-and-power-ltd-rhp-cover-pages.json", "RHP", "MAINBOARD",
     ["Inamulhaq Shamsulhaq Iraki", "Abdulhaq Shamsulhaq Iraki", "Ibrarulhaq Inamulhaq Iraki"]),
    ("green-asia-impex-ltd-rhp-cover-pages.json", "RHP", "SME",
     ["Pasupuleti Venkata Ramarao", "Pasupuleti Meenakshi"]),
    # #545 round 3: large-issuer covers print "PROMOTERS OF OUR COMPANY:" and
    # "THE PROMOTERS OF OUR COMPANY:" (names hand-read off each PDF's cover page).
    ("moneyview-ltd-rhp-cover-pages.json", "RHP", "MAINBOARD",
     ["Puneet Agarwal", "Sanjay Aggarwal", "Sushma Abburi"]),
    ("acevector-ltd-rhp-cover-pages.json", "RHP", "MAINBOARD",
     ["Kunal Bahl", "Rohit Kumar Bansal", "Starfish I Pte. Ltd."]),
]


@pytest.mark.parametrize("fixture,doc_type,segment,expected", CASES)
def test_prospectus_emits_every_promoter_named_on_the_cover(fixture, doc_type, segment, expected):
    out = run(load(fixture), doc_type, fixture, segment)
    field = out["fields"]["promoter_names"]
    assert field["value"] == expected
    assert field["page"] is not None
    assert out["fields"]["promoter_name"]["value"] == expected[0]


def test_no_promoter_line_is_a_named_null_not_a_guess():
    pages = [(0, "RED HERRING PROSPECTUS\nSome Company Limited\nTHE OFFER")]
    out = run(pages, "RHP", "synthetic", "MAINBOARD")
    field = out["fields"]["promoter_names"]
    assert field["value"] is None


def test_promoter_names_with_ampersand_or_slash_are_kept():
    # #545 round 2: a firm or joint promoter name was silently dropped.
    from extract_filing import promoter_names_from_statement
    assert promoter_names_from_statement("SUNIL JALLAN, JALLAN & SONS AND A/B HOLDINGS") == [
        "Sunil Jallan", "Jallan & Sons", "A/B Holdings"]


@pytest.mark.parametrize("line", [
    "OUR PROMOTERS: PUNEET AGARWAL AND SUSHMA ABBURI",
    "OUR PROMOTER: PUNEET AGARWAL AND SUSHMA ABBURI",
    "PROMOTERS OF OUR COMPANY: PUNEET AGARWAL AND SUSHMA ABBURI",
    "THE PROMOTERS OF OUR COMPANY: PUNEET AGARWAL AND SUSHMA ABBURI",
    "PROMOTER OF OUR COMPANY: PUNEET AGARWAL AND SUSHMA ABBURI",
    "PROMOTERS OF THE COMPANY: PUNEET AGARWAL AND SUSHMA ABBURI",
    "OUR PROMOTERS ARE PUNEET AGARWAL AND SUSHMA ABBURI",
    "PROMOTERS OF OUR COMPANY - PUNEET AGARWAL AND SUSHMA ABBURI",
])
def test_every_cover_wording_of_the_promoter_statement_is_read(line):
    # #545 round 3: the class is the statement's WORDING, not two strings.
    from extract_filing import read_cover_promoters
    cover = "\n".join(["RED HERRING PROSPECTUS", line, "THE OFFER"])
    names, page = read_cover_promoters([(0, cover)])
    assert names == ["Puneet Agarwal", "Sushma Abburi"]
    assert page == 0


def test_table_of_contents_heading_is_not_a_promoter_statement():
    from extract_filing import read_cover_promoters
    toc = "\n".join(["OUR PROMOTERS AND PROMOTER GROUP ........................ 305",
                     "DIVIDEND POLICY ...... 308"])
    assert read_cover_promoters([(0, toc)]) == ([], None)


def test_mixed_case_prose_about_promoters_is_not_a_statement():
    # The "ARE" form is read only off an upper-case cover line; body prose is not a list.
    from extract_filing import read_cover_promoters
    prose = "Our Promoters are also Directors"
    assert read_cover_promoters([(0, prose)]) == ([], None)


@pytest.mark.parametrize("line", [
    "OUR PROMOTER-GROUP ENTITIES",
    "Our Promoters - also Directors",
])
def test_hyphenated_or_mixed_case_dash_line_is_not_a_statement(line):
    # #545 r1 review: the dash form matched inside "PROMOTER-GROUP" and yielded a
    # promoter "Group Entities". A separator dash stands apart from the word, and the
    # dash form, like the ARE/IS form, is read only off an upper-case cover line.
    from extract_filing import read_cover_promoters
    assert read_cover_promoters([(0, line)]) == ([], None)
