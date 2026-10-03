"""Round 4 item 2 (D11): an RHP's restated statements and KPI tables print stub-quarter columns
(June 30, 2026 / June 30, 2025) before the fiscal years. Single-value fields take the latest FULL
fiscal year; a stub column is read and dropped, never taken as a year.

Real NSE RHP pages (fixtures/nse-rhp-financials/pages.json), values read by hand off the PDF:
  p86  TOTAL ASSETS  913,340.68 | 771,467.43 | 879,374.42 | 694,666.38 | 654,639.78
       Other equity  349,967.34 | 330,839.87 | 318,660.41 | 301,058.26 | 239,249.05
       header "June 30, June 30, March 31, March 31, March 31," over "2026 2025 2026 2025 2024"
  p89  Basic and Diluted (Rs) 12.61* 11.81* 41.62 49.24 33.56 (continuing and discontinued)
  p142 Return on Equity (48) % 9.26* 9.18* 32.98 44.87 37.37 under a grouped header
       "As of and for the three months period ended | As of and for the Fiscal ended March 31,"
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import issuer_balance_rows  # noqa: E402
from extract_financials_pdf import extract_from_texts  # noqa: E402

_FIX = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures",
                                   "nse-rhp-financials", "pages.json"), encoding="utf-8"))
PAGES = [(int(i), re.sub(r"[`₹]", " ", t)) for i, t in _FIX["pages"]]
FY = [2026, 2025, 2024]


def pages(*idx):
    return [p for p in PAGES if p[0] in idx]


def test_eps_continuation_page_with_the_same_stacked_header_is_read():
    r = extract_from_texts(pages(85, 86, 87, 88))
    assert r["annualYears"] == FY
    assert r["metrics"]["eps"] == {2026: 41.62, 2025: 49.24, 2024: 33.56}
    assert r["epsCombined"] is True
    assert r["epsPage"] == 88


def test_eps_continuation_with_a_different_stacked_header_is_not_read():
    """The continuation page's columns must be the statement's own, stub columns in the same places."""
    def shift(t):
        t = t.replace("June 30, June 30, March 31, March 31, March 31,",
                      "June 30, March 31, March 31, March 31, March 31,", 1)
        return t.replace("2026 2025 2026 2025 2024", "2026 2026 2025 2024 2023", 1)
    shifted = [(i, shift(t) if i == 88 else t) for i, t in pages(85, 86, 87, 88)]
    assert shifted != pages(85, 86, 87, 88)
    r = extract_from_texts(shifted)
    assert "eps" not in r["metrics"]


def test_balance_totals_take_the_march_31_columns_of_a_stacked_header():
    got = issuer_balance_rows.read_balance_totals(pages(85, 86, 87, 88), 87)
    assets, page, why = got["total_assets_by_fy"]
    assert why is None and page == 85
    assert assets == {"2026": 879374.42, "2025": 694666.38, "2024": 654639.78}
    reserves, _p, why = got["reserves_by_fy"]
    assert why is None
    assert reserves == {"2026": 318660.41, "2025": 301058.26, "2024": 239249.05}


def test_balance_totals_refuse_a_stacked_header_that_does_not_pair():
    broken = [(i, t.replace("2026 2025 2026 2025 2024", "2026 2025 2026 2025", 1) if i == 85 else t)
              for i, t in pages(85, 87)]
    got = issuer_balance_rows.read_balance_totals(broken, 87)
    assert got["total_assets_by_fy"][0] is None
    assert got["total_assets_by_fy"][2] == "balance_sheet_stacked_header_unresolved"


def test_roe_from_a_grouped_three_months_and_fiscal_header():
    series, page, why = issuer_balance_rows.read_roe(pages(141, 211, 427), FY)
    assert why is None
    assert series == {"2026": 32.98, "2025": 44.87, "2024": 37.37}
    assert page == 141


def test_roe_grouped_header_with_the_fiscal_years_first_is_refused():
    """FY first then the stub group: the trailing years are not the fiscal years -> no read."""
    swapped = [(i, t.replace("2026 2025 2026 2025 2024", "2026 2025 2024 2026 2025")) for i, t in pages(141)]
    series, _page, why = issuer_balance_rows.read_roe(swapped, FY)
    assert series is None
    assert why == "roe_row_columns_do_not_match_the_fiscal_years"


def test_roe_grouped_header_naming_no_stub_period_is_refused():
    no_stub = [(i, t.replace("June 30,", "March 31,", 1)) for i, t in pages(141)]
    series, _page, why = issuer_balance_rows.read_roe(no_stub, FY)
    assert series is None
