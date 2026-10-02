"""Item 46 round 2 (OD-165, spec 5.6 C): restated financials on a real mainboard
RHP whose column header is STACKED (period ends on one line, years on the next).

Fixture: NSE RHP (staging document 3cb0ba27) pages 87-88 and 418, text by
pdfplumber page.extract_text(), the same call the extractor makes. Before this
round the reader read the stacked header as one 2026 column, dropped page 87,
and took fiscal years [2025, 2024] from the page-418 MD&A prose.

Run:  cd scraper && python -m pytest scripts/test_extract_financials_stacked_header.py -q
"""
import io
import os

from extract_financials_pdf import (
    _rejoin_split_initial,
    _stacked_header_columns,
    extract_from_texts,
)

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures",
                       "financial-statements", "nse-rhp-restated-summary-stacked-header.txt")


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


def test_fixture_is_the_real_nse_summary_page():
    texts = dict(pages())
    assert "SUMMARY OF RESTATED CONSOLIDATED STATEMENT OF PROFIT AND LOSS" in texts[87]
    assert "June 30, June 30, March 31, March 31, March 31," in texts[87]


def test_stacked_header_reads_three_fiscal_years_from_page_87():
    out = extract_from_texts(pages())
    assert out["pnlPage"] == 87
    assert out["annualYears"] == [2026, 2025, 2024]
    assert out["unit"] == "millions" and out["unitStated"] is True


def test_rows_equal_what_page_87_prints_with_the_stub_columns_dropped():
    m = extract_from_texts(pages())["metrics"]
    assert m["revenue"] == {2026: 166013.09, 2025: 171406.78, 2024: 147800.11}
    # "T otal income" - pdfplumber split the label's initial capital.
    assert m["totalIncome"] == {2026: 187133.7, 2025: 191768.31, 2024: 163520.62}
    # The total "Profit for the period/year (A)", never the continuing-operations line.
    assert m["profit"] == {2026: 103020.61, 2025: 121876.89, 2024: 83057.41}


def test_return_on_net_worth_percent_row_is_never_net_worth():
    page = ("SUMMARY OF RESTATED CONSOLIDATED STATEMENT OF PROFIT AND LOSS\n"
            "(₹ in million, unless stated otherwise)\n"
            "Particulars March 31, 2026 March 31, 2025 March 31, 2024\n"
            "Revenue from operations 166,013.09 171,406.78 147,800.11\n"
            "Return on Net Worth (in %)(2) 33.21 45.14 37.60\n")
    out = extract_from_texts([(1, page)])
    assert "netWorth" not in out["metrics"]


def test_stacked_header_pairs_column_for_column():
    window = ["Particulars For the period/year ended",
              "June 30, June 30, March 31, March 31, March 31,",
              "2026 2025 2026 2025 2024", "Income"]
    assert _stacked_header_columns(window) == [None, None, 2026, 2025, 2024]


def test_stacked_header_that_does_not_pair_fails_closed():
    window = ["June 30, March 31, March 31,", "2026 2026 2025 2024"]
    assert _stacked_header_columns(window) == "UNRESOLVED"
    dup = ["March 31, March 31,", "2026 2026"]
    assert _stacked_header_columns(dup) == "UNRESOLVED"
    page = ("STATEMENT OF PROFIT AND LOSS\n(₹ in million)\n"
            "June 30, March 31, March 31,\n2026 2026 2025 2024\n"
            "Revenue from operations 1.00 2.00 3.00 4.00\n")
    assert extract_from_texts([(1, page)])["metrics"] == {}


def test_no_stacked_header_leaves_the_old_path():
    assert _stacked_header_columns(["Particulars March 31, 2026 March 31, 2025"]) is None


def test_split_initial_rejoins_only_the_label():
    assert _rejoin_split_initial("T otal income 52,521.74") == "Total income 52,521.74"
    assert _rejoin_split_initial("Total income 1 2") == "Total income 1 2"
