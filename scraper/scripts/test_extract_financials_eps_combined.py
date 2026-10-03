"""financial_data.eps / financial_statements.eps_basic + eps_diluted (spec Appendix A rows 88, 118, 119; C6).

Fixture: the NSE DRHP (d88fad44) pages 78-79 and 119, pdfplumber text as extract_filing receives it. The
restated P&L starts on page 78 and its EPS block is on the continuation page 79, printed as three
"Basic & Diluted" rows: continuing operations 41.13 / 46.89 / 33.97, discontinued 0.49 / 2.35 / (0.41), and
continuing AND discontinued 41.62 / 49.24 / 33.56 (the EPS; page 119's Basis for Offer Price table prints the
same 41.62 / 49.24 / 33.56 as both Basic and Diluted). Before the fix the reader never read page 79 and
eps_basic_by_fy was MISSED "no values".

Run:  cd scraper && python -m pytest scripts/test_extract_financials_eps_combined.py -q
"""
import io
import os

from extract_financials_pdf import extract_from_texts
from extract_filing import run

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures",
                       "financial-statements", "nse-drhp-restated-pnl-eps-continuation.txt")
NSE_EPS = {2026: 41.62, 2025: 49.24, 2024: 33.56}


def pages():
    with io.open(FIXTURE, encoding="utf-8") as handle:
        raw = handle.read().replace("\r\n", "\n")
    out = []
    for chunk in raw.split("<<<PAGE "):
        if not chunk.strip():
            continue
        head, _, body = chunk.partition(">>>")
        out.append((int(head.strip()), body.lstrip("\n")))
    return out


def test_fixture_is_the_real_nse_pnl_and_its_continuation():
    texts = dict(pages())
    assert "SUMMARY STATEMENT OF PROFIT AND LOSS" in texts[78]
    assert texts[79].count("asic & Diluted") == 3


def test_total_basic_and_diluted_row_on_the_continuation_page_is_the_eps():
    r = extract_from_texts(pages())
    assert r["pnlPage"] == 78
    assert r["metrics"]["eps"] == NSE_EPS
    assert r["epsPage"] == 79
    assert r["epsCombined"] is True


def test_segment_rows_alone_are_never_the_eps():
    # Only the continuing-operations and discontinued-operations rows: no total row -> no EPS (fail closed).
    texts = dict(pages())
    cut = texts[79].split("Earnings per equity share for profit from continuing and")[0]
    r = extract_from_texts([(78, texts[78]), (79, cut)])
    assert "eps" not in r["metrics"]


def test_two_total_rows_that_disagree_are_ambiguous():
    texts = dict(pages())
    extra = ("\nEarnings per equity share (Face Value 1 each)\nBasic & Diluted (₹) 40.00 49.24 33.56\n")
    r = extract_from_texts([(78, texts[78]), (79, texts[79] + extra)])
    assert "eps" not in r["metrics"]
    assert r.get("epsAmbiguous") is True


def test_continuation_page_with_other_years_is_not_read():
    texts = dict(pages())
    shifted = texts[79].replace("March 31, 2024", "March 31, 2023")
    r = extract_from_texts([(78, texts[78]), (79, shifted)])
    assert "eps" not in r["metrics"]


def test_rhp_envelope_gives_basic_and_diluted_from_a_combined_row():
    f = run(pages(), "DRHP", "fixture")["fields"]
    assert f["eps_basic_by_fy"]["state"] == "VALUE"
    assert {int(k): v for k, v in f["eps_basic_by_fy"]["value"].items()} == NSE_EPS
    assert f["eps_diluted_by_fy"]["state"] == "VALUE"
    assert {int(k): v for k, v in f["eps_diluted_by_fy"]["value"].items()} == NSE_EPS


def test_a_basic_only_row_gives_no_diluted():
    texts = dict(pages())
    basic_only = texts[79].replace("Basic & Diluted (₹) 41.62", "Basic (₹) 41.62")
    f = run([(78, texts[78]), (79, basic_only)], "DRHP", "fixture")["fields"]
    assert {int(k): v for k, v in f["eps_basic_by_fy"]["value"].items()} == NSE_EPS
    assert f.get("eps_diluted_by_fy", {}).get("value") is None
