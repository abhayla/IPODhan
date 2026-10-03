"""OD-165 item 46: total assets, reserves and ROE off a real offer document.

Page text is copied verbatim from the National Stock Exchange DRHP (d88fad44, pdf pages 77, 124,
189, 381 as the extractor's text layer reads them); the expected values are the answer key's.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import issuer_balance_rows as B  # noqa: E402

NSE_P77 = """SUMMARY STATEMENT OF ASSETS AND LIABILITIES
( in million, unless otherwise stated)
Particulars As at
March 31, 2026 March 31, 2025 March 31, 2024
ASSETS
Non-current assets
Property, plant and equipment 11,928.41 11,204.35 10,042.68
T otal non-current assets 188,226.12 222,439.35 220,521.80
T otal current assets 688,257.21 469,843.03 425,593.01
T OTAL ASSETS 879,374.42 694,666.38 654,639.78
EQUITY AND LIABILITIES
EQUITY
Equity share capital 2,475.00 2,475.00 495.00
Other equity 318,660.41 301,058.26 239,249.05
T otal Equity 321,135.41 303,533.26 239,738.75"""

NSE_P124 = """As of and for the Fiscal ended March 31,
Particulars Units
2026 2025 2024
Return on Capital Employed (47) % 42.80 52.11 45.50
Return on Equity (48) % 32.98 44.87 37.37"""
NSE_P189 = "Return on Equity (28) (36) % 32.98 44.87 37.37"
NSE_P381 = "Return on Equity 32.98% 44.87% 37.37%\nReturn on Net Worth 33.21% 45.14% 37.60%"
NSE_P19 = ("Return on Equity Return on Equity represents Profit for the year attributable to Owners "
           "of National Stock Exchange of")
YEARS = [2026, 2025, 2024]


def test_nse_total_assets_and_reserves_from_the_statement():
    out = B.read_balance_totals([(76, NSE_P77)], pnl_page=78)
    assert out["total_assets_by_fy"] == (
        {"2026": 879374.42, "2025": 694666.38, "2024": 654639.78}, 76, None)
    # "Other equity" is the Ind AS reserves line; total equity and share capital are not read.
    assert out["reserves_by_fy"] == (
        {"2026": 318660.41, "2025": 301058.26, "2024": 239249.05}, 76, None)


def test_the_statement_nearest_the_pnl_page_is_used():
    other = NSE_P77.replace("879,374.42", "1.00").replace("318,660.41", "0.50")
    out = B.read_balance_totals([(76, NSE_P77), (284, other)], pnl_page=78)
    assert out["total_assets_by_fy"][0]["2026"] == 879374.42
    out = B.read_balance_totals([(76, NSE_P77), (284, other)], pnl_page=283)
    assert out["total_assets_by_fy"][0]["2026"] == 1.0


@pytest.mark.parametrize("edit, field, reason", [
    (lambda t: t.replace("T OTAL ASSETS", "Total non-current assets"), "total_assets_by_fy",
     "balance_sheet_total_assets_row_not_in_document"),
    (lambda t: t.replace("March 31, 2026 March 31, 2025 March 31, 2024", "Fiscal"),
     "total_assets_by_fy", "balance_sheet_year_header_not_found"),
    (lambda t: t + "\nReserves and surplus 1.00 2.00 3.00", "reserves_by_fy", "reserves_rows_disagree"),
    (lambda t: t.replace("Other equity 318,660.41", "Other equity 999,999.99"), "reserves_by_fy",
     "reserves_exceed_total_assets"),
    (lambda t: t.replace("T OTAL ASSETS 879,374.42 694,666.38 654,639.78",
                         "T OTAL ASSETS 879,374.42 694,666.38"), "total_assets_by_fy",
     "total_assets_row_columns_do_not_match_the_year_header"),
    (lambda t: t.replace("SUMMARY STATEMENT OF ASSETS AND LIABILITIES", "CAPITAL STRUCTURE"),
     "total_assets_by_fy", "balance_sheet_total_assets_row_not_in_document"),
])
def test_unresolved_statement_shapes_fail_closed(edit, field, reason):
    series, _page, why = B.read_balance_totals([(76, edit(NSE_P77))], pnl_page=78)[field]
    assert series is None
    assert why == reason


def test_nse_roe_from_every_kpi_row_that_agrees():
    pages = [(18, NSE_P19), (123, NSE_P124), (188, NSE_P189), (380, NSE_P381)]
    assert B.read_roe(pages, YEARS) == ({"2026": 32.98, "2025": 44.87, "2024": 37.37}, 123, None)


@pytest.mark.parametrize("pages, reason", [
    ([(123, NSE_P124), (188, NSE_P189.replace("32.98", "23.98"))], "roe_rows_disagree"),
    ([(123, NSE_P124.replace(" % 32.98", " 32.98"))], "roe_row_not_in_document"),
    ([(18, NSE_P19)], "roe_row_not_in_document"),
    ([(123, NSE_P124.replace("32.98", "132.98"))], "roe_outside_minus_100_to_100"),
    ([(123, NSE_P124.replace("% 32.98 44.87 37.37", "% 9.1 32.98 44.87 37.37"))],
     "roe_row_columns_do_not_match_the_fiscal_years"),
])
def test_unresolved_roe_shapes_fail_closed(pages, reason):
    series, _page, why = B.read_roe(pages, YEARS)
    assert series is None
    assert why == reason


def test_roe_beyond_100_is_kept_in_a_loss_year():
    pages = [(123, NSE_P124.replace("32.98", "-132.98"))]
    series, _p, why = B.read_roe(pages, YEARS, {2026: -5.0, 2025: 1.0, 2024: 1.0})
    assert why is None and series["2026"] == -132.98
