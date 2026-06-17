"""
Offline unit test for the C3b Stage E RHP-PDF extractor (NO network, NO LLM).

Feeds the pure core (extract_from_texts) the VERBATIM captured text of the
Anubhav Plast RHP restated-P&L page (75) + the EBITDA/Net-Worth annexure page
(133), and asserts the mapped per-fiscal-year values equal exactly what the RHP
prints — including that the leading interim (December 31, 2025) column is dropped,
never mislabelled into an annual slot.

Run:  cd scraper && python -m pytest scripts/test_extract_financials_pdf.py -q
"""
import json
import os
import importlib.util

HERE = os.path.dirname(__file__)
spec = importlib.util.spec_from_file_location("efp", os.path.join(HERE, "extract_financials_pdf.py"))
efp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(efp)

FIXTURE = os.path.join(HERE, "..", "tests", "fixtures", "anubhav-rhp-financial-pages.json")


def load_pages():
    with open(FIXTURE, encoding="utf-8") as f:
        return [(int(idx), text) for idx, text in json.load(f)]


def test_extracts_annual_columns_and_drops_interim():
    r = efp.extract_from_texts(load_pages())
    assert r["unit"] == "lakhs"
    assert r["annualYears"] == [2025, 2024, 2023]  # interim Dec-2025 not an annual year


def test_revenue_from_operations_per_fiscal_year():
    m = efp.extract_from_texts(load_pages())["metrics"]
    # Page 75: "Revenue from operations 22 8,048.88 9,816.74 8,732.69 8,713.69"
    # 8,048.88 is the interim (Dec 2025) column and MUST be dropped.
    assert m["revenue"] == {2025: 9816.74, 2024: 8732.69, 2023: 8713.69}


def test_total_income_profit_eps():
    m = efp.extract_from_texts(load_pages())["metrics"]
    assert m["totalIncome"][2024] == 8740.66
    assert m["profit"] == {2025: 599.68, 2024: 207.99, 2023: 74.36}
    assert m["eps"][2024] == 2.60


def test_ebitda_and_networth_from_other_annexure():
    m = efp.extract_from_texts(load_pages())["metrics"]
    # Page 133: "EBITDA (3) 1,028.96 1,218.34 663.88 425.83" → interim dropped.
    assert m["ebitda"] == {2025: 1218.34, 2024: 663.88, 2023: 425.83}
    # "Net worth (11) 2,084.51 1,554.94 955.26 747.27" → interim dropped.
    assert m["netWorth"][2025] == 1554.94


def test_empty_input_yields_nothing():
    r = efp.extract_from_texts([(0, "no financial statement here")])
    assert r["metrics"] == {}
    assert r["annualYears"] == []
