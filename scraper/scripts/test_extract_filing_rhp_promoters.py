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
