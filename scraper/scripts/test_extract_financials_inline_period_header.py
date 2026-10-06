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


# Revise round 1 (independent review): the inline path's aligner is strict - one cell per column.
from extract_financials_pdf import _align_factory  # noqa: E402

STUB_COLUMNS = [None, None, 2025, 2024, 2023]


def test_strict_aligner_never_reads_a_short_row_positionally():
    strict = _align_factory(STUB_COLUMNS, [2025, 2024, 2023], strict=True)
    assert strict("Revenue from operations 21 3,950.19 3,797.61") is None


def test_strict_aligner_reads_the_full_row_with_its_note_number():
    strict = _align_factory(STUB_COLUMNS, [2025, 2024, 2023], strict=True)
    row = "Revenue from operations 21 2,444.21 1,811.74 3,950.19 3,797.61 3,719.63"
    assert strict(row) == {2025: 3950.19, 2024: 3797.61, 2023: 3719.63}


def test_strict_aligner_refuses_a_dash_cell_and_a_shifted_note():
    strict = _align_factory(STUB_COLUMNS, [2025, 2024, 2023], strict=True)
    # "-" is dropped by money_values; the note 4 would otherwise land in the first column.
    assert strict("Intangible assets under development 4 - 45.10 63.10 1.00 2.00") is None
    assert strict("Other equity 15 1,248.50 988.11 (1,689.02) (169.17)") is None


def test_existing_callers_keep_the_annual_only_reading():
    plain = _align_factory(STUB_COLUMNS, [2025, 2024, 2023])
    assert plain("Revenue from operations 21 3,950.19 3,797.61") == {2025: 21.0, 2024: 3950.19,
                                                                     2023: 3797.61}


def test_day_month_order_header():
    line = "30 September 2025 30 September 2024 31 March 2025 31 March 2024 31 March 2023"
    assert _inline_period_columns([line]) == STUB_COLUMNS


def test_stub_columns_after_the_annual_ones_pair_in_printed_order():
    cols = _inline_period_columns(["March 31, 2025 March 31, 2024 September 30, 2025"])
    assert cols == [2025, 2024, None]
    strict = _align_factory(cols, [2025, 2024], strict=True)
    assert strict("Revenue from operations 100.00 90.00 55.00") == {2025: 100.0, 2024: 90.0}


def test_abbreviated_month_and_fiscal_headers_resolve_nothing():
    assert _inline_period_columns(["Mar 31, 2025 Mar 31, 2024 Mar 31, 2023"]) is None
    assert _inline_period_columns(["Fiscal 2025 Fiscal 2024 Fiscal 2023"]) is None


def test_balance_sheet_keeps_a_series_the_plain_reading_already_read():
    page = ("Restated Statement of Assets and Liabilities\n(in million)\n"
            "Particulars September 30, 2025 March 31, 2025 March 31, 2024\n"
            "Total assets 200.00 150.00\n"
            "Other equity 15 30.00 20.00 10.00\n")
    got = issuer_balance_rows.read_balance_totals([(10, page)], None)
    assert got["total_assets_by_fy"] == ({"2025": 200.0, "2024": 150.0}, 10, None)
    assert got["reserves_by_fy"] == ({"2025": 20.0, "2024": 10.0}, 10, None)
