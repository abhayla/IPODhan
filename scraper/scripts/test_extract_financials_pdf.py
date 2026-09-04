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


# --------------------------------------------------------------------------- #
# W-33 — the Deepa Jewellers RHP annexure page. pdfplumber inserts a space after
# the FIRST character of every numeric cell ("1 9,266.76"), so the old tokenizer
# read 13,970.10 as 3,970.10 and 10,245.68 as 245.68. These tests assert (a) the
# repaired parse equals what the document prints and (b) the named plausibility
# checks REJECT the old, wrong output.
# --------------------------------------------------------------------------- #
DEEPA_FIXTURE = os.path.join(HERE, "..", "tests", "fixtures", "extractor", "deepa-rhp-pages.json")

WRONG_PRE_FIX = {
    "revenue": {2026: 3970.1, 2025: 1.0, 2024: 245.68},
    "profit": {2026: 5.8, 2025: 2.0, 2024: 43.47},
    "eps": {2026: 95.0, 2025: 2.0, 2024: 97.0},
}
TRUE_VALUES = {
    "revenue": {2026: 19266.76, 2025: 13970.10, 2024: 10245.68},
    "profit": {2026: 1047.88, 2025: 405.80, 2024: 243.47},
    "eps": {2026: 12.78, 2025: 4.95, 2024: 2.97},
    "ebitda": {2026: 1463.37, 2025: 560.06, 2024: 357.71},
}


def load_deepa():
    with open(DEEPA_FIXTURE, encoding="utf-8") as f:
        return [(int(idx), text) for idx, text in json.load(f)]


def test_deepa_split_digit_cells_are_repaired():
    """"1 9,266.76" must tokenise as one number, not as 1 and 9,266.76."""
    assert efp.money_values("I. Revenue from operations 23 1 9,266.76 1 3,970.10 1 0,245.68")[-3:] == [
        19266.76, 13970.10, 10245.68]
    # A correctly tokenised row must be left ALONE by the same repair.
    assert efp.money_values("III. Total income 19,277.25 14,001.00 10,257.29") == [
        19277.25, 14001.00, 10257.29]


def test_deepa_metrics_match_the_printed_statement():
    r = efp.extract_from_texts(load_deepa())
    assert r["unit"] == "millions"          # W-35: "(All amounts are in Rs million...)"
    assert r["unitStated"] is True
    assert r["annualYears"] == [2026, 2025, 2024]
    for key, expected in TRUE_VALUES.items():
        assert r["metrics"][key] == expected, key
    assert r["rejected"] == {}


def test_plausibility_rejects_the_pre_fix_output():
    """Every check that should have caught the W-33 numbers actually fails on
    them — and passes on the true ones."""
    ok, detail, offenders = efp.check_yoy_ratio_within_bounds(WRONG_PRE_FIX)
    assert ok is False and "revenue" in offenders, detail
    ok, _d, _o = efp.check_yoy_ratio_within_bounds(TRUE_VALUES)
    assert ok is True

    # PAT 5.8 vs revenue 3970.1 passes the revenue test, but EPS 95 on a PAT of
    # 5.8 million cannot be: 95 x 82,000,000 shares is nowhere near 5.8.
    shares = {2026: 82_000_000, 2025: 82_000_000, 2024: 82_000_000}
    ok, detail, offenders = efp.check_eps_times_shares_matches_pat(WRONG_PRE_FIX, shares)
    assert ok is False and offenders == ["eps"], detail

    # A mis-read that puts PAT above revenue is rejected outright.
    ok, detail, offenders = efp.check_pat_not_above_revenue(
        {"revenue": {2026: 100.0}, "profit": {2026: 250.0}})
    assert ok is False and offenders == ["profit"], detail

    # EBITDA below PAT in a profitable year is impossible.
    ok, detail, offenders = efp.check_ebitda_at_least_pat(
        {"profit": {2026: 1047.88}, "ebitda": {2026: 5.8}})
    assert ok is False and offenders == ["ebitda"], detail


def test_unit_must_be_stated_next_to_the_table():
    ok, detail, _o = efp.check_unit_stated_near_table(True, "in Rs million", 73, 73)
    assert ok is True and "73" in detail
    ok, detail, _o = efp.check_unit_stated_near_table(True, "in Rs million", 21, 255)
    assert ok is False and "not adjacent" in detail
    ok, detail, _o = efp.check_unit_stated_near_table(False, None, None, 255)
    assert ok is False


def test_cross_document_agreement():
    ad = {"revenue": {2026: 19266.76}, "profit": {2026: 1047.88}}
    rhp = {"revenue": {2026: 19266.76}, "profit": {2026: 1047.88}}
    ok, _d, _o = efp.check_cross_document_agreement(ad, rhp)
    assert ok is True
    ok, detail, offenders = efp.check_cross_document_agreement(
        ad, {"revenue": {2026: 3970.10}, "profit": {2026: 5.8}})
    assert ok is False and offenders == ["profit", "revenue"], detail


def test_metrics_that_fail_a_check_are_dropped_not_emitted():
    """A page whose numbers are implausible yields NO metric for the offender."""
    page = "\n".join([
        "Restated Statement of Profit and Loss",
        "(All amounts are in Rs million)",
        "31 March 2026 31 March 2025 31 March 2024",
        "Revenue from operations 19,266.76 13,970.10 10,245.68",
        "Profit for the year 40,000.00 405.80 243.47",
    ])
    r = efp.extract_from_texts([(0, page)])
    assert "profit" not in r["metrics"]
    assert "pat_not_above_revenue" in r["rejected"]["profit"]
    assert r["metrics"]["revenue"] == {2026: 19266.76, 2025: 13970.10, 2024: 10245.68}


# --------------------------------------------------------------------------- #
# W-128 — SME RHP "Key Performance Indicators" table headed "FY 2025-26
# FY 2024-25 FY 2023-24" instead of the mainboard "March 31, YYYY" form.
# Before the fix this header did not parse at all, so the KPI table was never
# picked up as a P&L candidate; the extractor then read fiscal_years=[2026] and
# every *_by_fy value from unrelated content elsewhere in the document (the
# production defect: revenue_by_fy {2026: 3722.94} — the KPI table's own
# FY2023-24 column, mislabelled — plus a PAT/net-worth value pulled from an
# entirely different table).
# --------------------------------------------------------------------------- #
QUALIANCE_FIXTURE = os.path.join(
    HERE, "..", "tests", "fixtures", "sme", "qualiance-rhp-kpi-pages-84-85.txt")


def load_qualiance():
    """Split the captured pdfplumber page-text fixture (marked
    "===== PAGE N") into the [(page_index, text)] shape extract_from_texts
    expects — the same shape extract_filing.py's extract_rhp() feeds it."""
    with open(QUALIANCE_FIXTURE, encoding="utf-8") as f:
        raw = f.read()
    pages = []
    for chunk in raw.split("===== PAGE ")[1:]:
        header, _, body = chunk.partition("\n")
        pages.append((int(header.strip()) - 1, body))
    return pages


def test_qualiance_kpi_table_fy_range_header():
    r = efp.extract_from_texts(load_qualiance())
    assert r["unit"] == "lakhs"
    assert r["annualYears"] == [2026, 2025, 2024]
    m = r["metrics"]
    assert m["revenue"] == {2026: 7689.11, 2025: 5307.24, 2024: 3722.94}
    assert m["ebitda"] == {2026: 1671.67, 2025: 797.05, 2024: 486.15}
    assert m["profit"] == {2026: 1186.90, 2025: 489.85, 2024: 283.93}
    assert m["netWorth"] == {2026: 2473.65, 2025: 1382.25, 2024: 892.40}
    assert r["rejected"] == {}


def test_unparseable_year_header_yields_no_year_and_no_metrics():
    """A KPI/summary table whose header the parser cannot read (no recognised
    March-31 / FY-YYYY-YY / FY-YYYY form) is skipped outright — never defaulted
    to the current or latest year."""
    page = "\n".join([
        "Key Performance Indicators of our Company",
        "(Rs. In Lakhs)",
        "Particulars Period A Period B Period C",
        "Revenue from operations 7,689.11 5,307.24 3,722.94",
    ])
    r = efp.extract_from_texts([(0, page)])
    assert r["annualYears"] == []
    assert r["metrics"] == {}
