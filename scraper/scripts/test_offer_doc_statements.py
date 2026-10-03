"""Offer-document readers for rows 66/69 (D10), 75, 92, 102 and rent expense, on REAL page text.

Fixtures: scraper/tests/fixtures/offer-doc-statements/*.json are pdfplumber page texts copied from
the stored NSE DRHP (d88fad44) and RHP (3cb0ba27), Bajaj Housing, Ola Electric and Orient Cables
DRHPs (see each .meta.json). Expected values are the answer keys' (drhp-truth.json / rhp-truth.json).
"""
import json
import os
import re
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import offer_doc_statements as O  # noqa: E402
import extract_filing as EF  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "offer-doc-statements")


def pages(name):
    with open(os.path.join(FIX, name + ".json"), encoding="utf-8") as fh:
        return [(i, re.sub(r"[`₹]", " ", t or "")) for i, t in json.load(fh)]


NSE_FY = [2026, 2025, 2024]


# ---------------------------------------------------------------- RoNW (rows 75, 102)
def test_nse_drhp_ronw_rows_and_weighted_average():
    got = O.read_ronw_block(pages("nse-drhp-pages"))
    assert got["ronw_by_fy"] == ({"2026": 33.21, "2025": 45.14, "2024": 37.6}, 119, None)
    assert got["weighted_average_ronw"] == (37.92, 119, None)


def test_nse_rhp_stub_row_is_never_a_fiscal_year():
    got = O.read_ronw_block(pages("nse-rhp-pages"))
    series = got["ronw_by_fy"][0]
    assert series == {"2026": 33.21, "2025": 45.14, "2024": 37.6}
    assert 9.33 not in series.values()
    assert got["weighted_average_ronw"][0] == 37.92


def test_one_decimal_weighted_average_is_reproduced():
    got = O.read_ronw_block(pages("bajaj-housing-drhp-ronw"))
    assert got["ronw_by_fy"][0] == {"2024": 15.2, "2023": 14.6, "2022": 11.1}
    assert got["weighted_average_ronw"][0] == 14.3


def test_a_misread_year_row_refuses_both():
    p = [(i, t.replace("March 31, 2025 45.14% 2", "March 31, 2025 54.14% 2")) for i, t in pages("nse-drhp-pages")]
    got = O.read_ronw_block(p)
    assert got["ronw_by_fy"][0] is None and got["weighted_average_ronw"][0] is None
    assert got["ronw_by_fy"][2].startswith("weighted_ronw_does_not_match_year_rows")


def test_rows_without_their_weighted_average_line_are_not_a_block():
    p = [(i, t.replace("Weighted Average 37.92% -", "")) for i, t in pages("nse-drhp-pages")]
    got = O.read_ronw_block(p)
    assert got["ronw_by_fy"][0] is None


# ---------------------------------------------------------------- operating cash flow (row 92)
def test_nse_drhp_op_cash_flow_per_fiscal_year():
    got = O.read_op_cash_flow(pages("nse-drhp-pages"), NSE_FY, 78, "millions")
    assert got[0] == {"2026": 238361.75, "2025": 40914.87, "2024": 297442.79}


def test_nse_rhp_op_cash_flow_drops_stub_columns_and_rejoins_a_split_cell():
    # p326 prints "2 97,442.79" for FY2024 and two June 30 stub columns first.
    got = O.read_op_cash_flow(pages("nse-rhp-pages"), NSE_FY, 87, "millions")
    assert got == ({"2026": 238361.75, "2025": 40914.87, "2024": 297442.79}, 326, None)


def test_a_note_page_operating_line_without_a_cash_flow_heading_is_never_read():
    # p352 / p391 (a discontinued operation's own operating cash line) carry no statement heading.
    only_note = [(i, t) for i, t in pages("nse-rhp-pages") if i in (87, 391)]
    assert O.read_op_cash_flow(only_note, NSE_FY, 87, "millions")[0] is None


def test_disagreeing_statements_are_refused():
    p = [(i, t.replace("238,361.75", "238,361.95") if i == 80 else t) for i, t in pages("nse-drhp-pages")]
    got = O.read_op_cash_flow(p, NSE_FY, 78, "millions")
    assert got[0] is None and got[2] == "op_cash_flow_rows_disagree"


def test_op_cash_flow_is_converted_into_the_document_unit():
    got = O.read_op_cash_flow(pages("nse-drhp-pages"), NSE_FY, 78, "crores")
    assert got[0]["2026"] == pytest.approx(23836.175, abs=1e-6)


# ---------------------------------------------------------------- rent expense
def test_nse_drhp_rental_charges_from_the_other_expenses_note():
    got = O.read_rent_expense(pages("nse-drhp-pages"), NSE_FY, 78, "millions")
    assert got == ({"2026": 50.72, "2025": 43.08, "2024": 55.65}, 324, None)


def test_nse_rhp_prints_no_rent_line_so_nothing_is_read():
    got = O.read_rent_expense(pages("nse-rhp-pages"), NSE_FY, 87, "millions")
    assert got[0] is None and got[2] == "rent_expense_row_not_in_document"


def test_a_rent_row_off_an_other_expenses_page_is_not_read():
    # The same row on a page that is not an expense note (a related-party or KPI table) is a
    # different entity's or a different measure's figure.
    p = [(i, re.sub(r"other\s+expenses", "xx", t, flags=re.I)) for i, t in pages("nse-drhp-pages")]
    assert O.read_rent_expense(p, NSE_FY, 78, "millions")[0] is None


@pytest.mark.parametrize("label", ["Rental income", "Rent Received", "Rent, Rates & Taxes",
                                   "Rent and warehouse expenses", "Rent Deposits"])
def test_rent_lookalike_rows_are_not_rent_expense(label):
    assert not O.RENT_LABEL.match("%s 5.18 4.10 3.72" % label)


# ---------------------------------------------------------------- capitalisation (rows 66, 69, D10)
def test_nse_drhp_nil_borrowings_are_zero_and_debt_to_equity_zero():
    got = O.read_capitalisation(pages("nse-drhp-pages"), NSE_FY, "millions")
    assert got["total_borrowing"] == (0.0, 393, None)
    assert got["debt_to_equity"] == (0.0, 393, None)


def test_nse_rhp_stub_dated_statement_is_not_the_fiscal_year_snapshot():
    got = O.read_capitalisation(pages("nse-rhp-pages"), NSE_FY, "millions")
    assert got["total_borrowing"][0] is None
    assert got["total_borrowing"][2] == "capitalisation_date_is_not_the_latest_fiscal_year_end"


def test_ola_wrapped_stub_date_is_refused():
    got = O.read_capitalisation(pages("ola-electric-drhp-capitalisation"), [2023, 2022], "millions")
    assert got["total_borrowing"][2] == "capitalisation_date_is_not_the_latest_fiscal_year_end"


def test_orient_printed_borrowings_and_ratio():
    got = O.read_capitalisation(pages("orient-cables-drhp-capitalisation"), [2025, 2024, 2023], "millions")
    assert got["total_borrowing"] == (1134.5, 334, None)
    assert got["debt_to_equity"] == (0.63, 334, None)


def test_na_ratio_with_non_nil_borrowings_is_never_a_number():
    p = [(i, t.replace("Total Borrowings (C) = (A)+(B) -", "Total Borrowings (C) = (A)+(B) 1,250.00"))
         for i, t in pages("nse-drhp-pages")]
    got = O.read_capitalisation(p, NSE_FY, "millions")
    assert got["total_borrowing"][0] == 1250.0
    assert got["debt_to_equity"] == (None, 393, "debt_to_equity_not_printed_as_a_number")


def test_blank_borrowings_cell_is_not_zero():
    p = [(i, t.replace("Total Borrowings (C) = (A)+(B) -", "Total Borrowings (C) = (A)+(B)"))
         for i, t in pages("nse-drhp-pages")]
    got = O.read_capitalisation(p, NSE_FY, "millions")
    assert got["total_borrowing"][0] is None and got["debt_to_equity"][0] is None


# ---------------------------------------------------------------- wiring through extract_rhp
def test_extract_rhp_emits_the_six_fields_for_the_nse_drhp():
    emit = EF.Emitter("DRHP-d88fad44.pdf")
    EF._read_offer_doc_statements(pages("nse-drhp-pages"), emit, NSE_FY, 78, "millions")
    v = {k: emit.fields[k]["value"] for k in ("ronw_by_fy", "weighted_average_ronw", "op_cash_flow_by_fy",
                                               "rent_by_fy", "total_borrowing", "debt_to_equity")}
    assert v == {
        "ronw_by_fy": {"2026": 33.21, "2025": 45.14, "2024": 37.6},
        "weighted_average_ronw": 37.92,
        "op_cash_flow_by_fy": {"2026": 238361.75, "2025": 40914.87, "2024": 297442.79},
        "rent_by_fy": {"2026": 50.72, "2025": 43.08, "2024": 55.65},
        "total_borrowing": 0.0,
        "debt_to_equity": 0.0,
    }
    assert all(emit.fields[k]["check"]["passed"] for k in v)


def test_extract_rhp_path_calls_the_offer_doc_readers():
    src = open(os.path.join(HERE, "extract_filing.py"), encoding="utf-8").read()
    body = src[src.index("def extract_rhp("):src.index("def _stop_reason_for(")]
    assert "_read_offer_doc_statements(" in body
