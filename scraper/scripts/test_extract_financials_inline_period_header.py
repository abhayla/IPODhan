"""D11 (spec "RHP read, step-0 round 5"): a restated statement whose column header prints every
column's period end WITH its year on one line, stub columns first:

    September 30, 2025 September 30, 2024 March 31, 2025 March 31, 2024 March 31, 2023

Fixture: AceVector DRHP (DRHP-c1a9392d) pages 314-316, text by pdfplumber page.extract_text(),
the same call the extractor makes. Before this fix the year reader took only the three March 31
years, counted no interim column (it knows only "December 31" stubs), and so mapped five-cell rows
onto three columns: no row aligned, page 315 was dropped and the document gave no fiscal years.

Run:  cd scraper && python -m pytest scripts/test_extract_financials_inline_period_header.py -q
"""
import io
import os

import issuer_balance_rows
from extract_financials_pdf import _inline_period_columns, extract_from_texts

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures",
                       "financial-statements", "acevector-drhp-restated-inline-period-header.txt")
HEADER = ("September 30, 2025 September 30, 2024 March 31, 2025 March 31, 2024 March 31, 2023")
STUB_FIGURES = {2444.21, 1811.74, 2519.09, 1864.92, -224.62, -1103.99, -0.65, -2.47}


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


def test_fixture_is_the_real_acevector_statement():
    texts = dict(pages())
    assert "Restated Consolidated Summary Statement of Profit and Loss" in texts[315]
    assert HEADER in texts[315]
    assert "Revenue from operations 21 2,444.21 1,811.74 3,950.19 3,797.61 3,719.63" in texts[315]


def test_header_pairs_each_column_with_its_own_period_end():
    assert _inline_period_columns(["Particulars Notes", HEADER]) == [None, None, 2025, 2024, 2023]


def test_pnl_reads_three_fiscal_years_from_page_315_with_stubs_dropped():
    out = extract_from_texts(pages())
    assert out["pnlPage"] == 315
    assert out["annualYears"] == [2025, 2024, 2023]
    m = out["metrics"]
    assert m["revenue"] == {2025: 3950.19, 2024: 3797.61, 2023: 3719.63}
    assert m["totalIncome"] == {2025: 4067.70, 2024: 3847.40, 2023: 3881.26}
    assert m["profit"] == {2025: -1259.38, 2024: -512.97, 2023: -2675.32}
    assert m["eps"] == {2025: -3.04, 2024: -1.26, 2023: -5.88}
    for key, series in m.items():
        assert not STUB_FIGURES & set(series.values()), key


def test_balance_sheet_totals_read_on_the_same_header():
    got = issuer_balance_rows.read_balance_totals(pages(), 315)
    assets, page, why = got["total_assets_by_fy"]
    assert (assets, page, why) == ({"2025": 5539.65, "2024": 4104.97, "2023": 3783.72}, 314, None)
    reserves, page, why = got["reserves_by_fy"]
    assert reserves == {"2025": 988.11, "2024": -1689.02, "2023": -169.17}


# Fail closed: a header that cannot be paired column for column resolves nothing.
def test_a_fiscal_year_named_twice_is_unresolved():
    line = "September 30, 2025 March 31, 2025 March 31, 2025 March 31, 2024"
    assert _inline_period_columns([line]) == "UNRESOLVED"


def test_a_header_with_a_stray_year_is_unresolved():
    line = "September 30, 2025 March 31, 2025 March 31, 2024 2023"
    assert _inline_period_columns([line]) == "UNRESOLVED"


def test_a_header_with_no_march_31_column_is_unresolved():
    line = "September 30, 2025 September 30, 2024"
    assert _inline_period_columns([line]) == "UNRESOLVED"


def test_a_window_without_a_dated_line_is_none():
    assert _inline_period_columns(["Particulars", "For the year ended"]) is None


def test_rows_with_more_cells_than_the_header_read_nothing():
    texts = dict(pages())
    # Drop the last column from the header only: five-cell rows no longer pair with four columns.
    broken = texts[315].replace(HEADER, HEADER.rsplit(" March 31, 2023", 1)[0])
    out = extract_from_texts([(315, broken)])
    assert out["annualYears"] == [] or 3719.63 not in out["metrics"].get("revenue", {}).values()
    assert "revenue" not in out["metrics"]
