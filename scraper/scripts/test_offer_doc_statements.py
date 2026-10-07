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
def _nse_drhp_envelope_fields():
    # OD-173: RoNW year rows, operating cash flow, rent and total borrowing are the rebuilt reader's (it needs
    # word boxes), so they are read from the REAL NSE DRHP fixture with word boxes; the weighted RoNW and the
    # debt-to-equity ratio stay _read_offer_doc_statements' and are asserted in the same envelope.
    import statement_grid
    path = os.path.join(FIX, "..", "offer-doc-financials", "national-stock-exchange-of-india-ltd-DRHP.json")
    with open(path, encoding="utf-8") as fh:
        fx = json.load(fh)
    gw = {int(k): {"width": v["width"], "words": [dict(zip(statement_grid.WORD_KEYS, w)) for w in v["words"]]}
          for k, v in fx["grid_words"].items()}
    out = EF.run([tuple(p) for p in fx["page_texts"]], "DRHP", fx["source_doc"], grid_words_for_page=gw.get)
    assert out["unit"] == "millions"
    return out["fields"]


def test_extract_rhp_emits_the_six_fields_for_the_nse_drhp():
    f = _nse_drhp_envelope_fields()
    keys = ("ronw_by_fy", "weighted_average_ronw", "op_cash_flow_by_fy", "rent_by_fy", "total_borrowing",
            "debt_to_equity")
    v = {k: f[k]["value"] for k in keys}
    assert v == {
        "ronw_by_fy": {"2026": 33.21, "2025": 45.14, "2024": 37.6},
        "weighted_average_ronw": 37.92,
        "op_cash_flow_by_fy": {"2026": 238361.75, "2025": 40914.87, "2024": 297442.79},
        "rent_by_fy": {"2026": 50.72, "2025": 43.08, "2024": 55.65},
        "total_borrowing": 0.0,
        "debt_to_equity": 0.0,
    }
    assert all(f[k]["check"]["passed"] for k in keys)


def test_the_statements_reader_no_longer_emits_the_rebuilt_readers_fields():
    emit = EF.Emitter("DRHP-d88fad44.pdf")
    EF._read_offer_doc_statements(pages("nse-drhp-pages"), emit, NSE_FY, 78, "millions")
    assert emit.fields["weighted_average_ronw"]["value"] == 37.92
    for k in ("ronw_by_fy", "op_cash_flow_by_fy", "rent_by_fy", "total_borrowing"):
        assert k not in emit.fields, k


def test_extract_rhp_path_calls_the_offer_doc_readers():
    src = open(os.path.join(HERE, "extract_filing.py"), encoding="utf-8").read()
    body = src[src.index("def extract_rhp("):src.index("def _stop_reason_for(")]
    assert "_read_offer_doc_statements(" in body


# ---------------------------------------------------------------- step-3a review fixes (A1-A5)
# Every edit below is a MINIMAL EDIT of real page text for a shape no fixture document prints;
# each says which line it changes.
ORIENT_FY = [2025, 2024, 2023]


def _edit(name, page, old, new):
    out = []
    for i, t in pages(name):
        if i == page:
            assert old in t, old
            t = t.replace(old, new, 1)
        out.append((i, t))
    return out


def test_a1_dash_on_a_total_borrowings_subheading_is_never_zero():
    # Minimal edit: Orient p334's bare "Total Borrowings" sub-heading printed with a dash. The
    # totals row below it (1,134.50) is the value; the heading's dash is not a nil total.
    p = _edit("orient-cables-drhp-capitalisation", 334, "Total Borrowings\n", "Total Borrowings –\n")
    got = O.read_capitalisation(p, ORIENT_FY, "millions")
    assert got["total_borrowing"] == (1134.5, 334, None)
    assert got["debt_to_equity"] == (0.63, 334, None)


def test_a1_dash_heading_without_a_two_cell_totals_row_is_null():
    p = _edit("orient-cables-drhp-capitalisation", 334, "Total Borrowings\n", "Total Borrowings –\n")
    p = [(i, t.replace("Total Borrowings (B) 1,134.50 [●]", "Total (B) 1,134.50 [●]")) for i, t in p]
    got = O.read_capitalisation(p, ORIENT_FY, "millions")
    assert got["total_borrowing"][0] is None and got["debt_to_equity"][0] is None
    assert got["total_borrowing"][2] == "total_borrowings_row_cells_do_not_fill_the_columns"


def test_a1_nil_total_against_a_printed_component_is_refused():
    # Minimal edit: NSE p393's current borrowings printed as 1,250.00 under a "-" total.
    p = _edit("nse-drhp-pages", 393, "Current Borrowings (B) -", "Current Borrowings (B) 1,250.00")
    got = O.read_capitalisation(p, NSE_FY, "millions")
    assert got["total_borrowing"] == (None, 393, "total_borrowings_nil_with_non_nil_components")


def test_a2_split_digit_join_only_for_the_exact_grouped_shape():
    toks = "12 5 6.70".split()
    assert O._map_cells([O._cell_value(t) for t in toks], [2025, 2024], toks) == {2025: 5.0, 2024: 6.7}
    # Leading note numbers explain the surplus: "1 50,000.00" is never joined into 150,000.00.
    toks = "12 1 50,000.00 40,000.00".split()
    assert O._map_cells([O._cell_value(t) for t in toks], [2025, 2024], toks) == {2025: 50000.0, 2024: 40000.0}
    toks = "3 5 120.5 110.2".split()
    assert O._map_cells([O._cell_value(t) for t in toks], [2025, 2024], toks) == {2025: 120.5, 2024: 110.2}
    # NSE RHP p326's real split cell is still joined (international grouping).
    toks = "30,078.89 70,402.83 238,361.75 40,914.87 2 97,442.79".split()
    got = O._map_cells([O._cell_value(t) for t in toks], [None, None, 2026, 2025, 2024], toks)
    assert got == {2026: 238361.75, 2025: 40914.87, 2024: 297442.79}
    # A tail that is not comma-grouped is never joined ("2 9742.79" is two cells, not 29,742.79).
    toks = "30,078.89 70,402.83 238,361.75 40,914.87 2 9742.79".split()
    assert O._map_cells([O._cell_value(t) for t in toks], [None, None, 2026, 2025, 2024], toks) is None


def test_a3_rent_row_under_another_note_heading_is_not_read():
    # Minimal edit: a "29 Leases" note heading inserted above NSE p324's rental charges row.
    p = _edit("nse-drhp-pages", 324, "Rental charges 5", "29 Leases\nRental charges 5")
    got = O.read_rent_expense(p, NSE_FY, 78, "millions")
    assert got[0] is None and got[2] == "rent_expense_row_not_inside_its_note"


def _bajaj_rows_without_pct():
    return [(i, re.sub(r"(March 31, 20\d\d \d+\.\d)%", r"\1", t)) for i, t in pages("bajaj-housing-drhp-ronw")]


def test_a4_ronw_rows_with_no_percent_anywhere_are_not_read():
    # Minimal edit: Bajaj p107's rows AND its "RoNW (%)" column header printed without "%".
    p = [(i, t.replace("RoNW (%)", "RoNW")) for i, t in _bajaj_rows_without_pct()]
    assert O.read_ronw_block(p)["ronw_by_fy"][0] is None


def test_a4_a_percent_column_header_covers_bare_rows():
    # Studds p146 / Hyundai p123 print "RoNW (%)" in the header and bare numbers in the rows.
    got = O.read_ronw_block(_bajaj_rows_without_pct())
    assert got["ronw_by_fy"][0] == {"2024": 15.2, "2023": 14.6, "2022": 11.1}


def test_a5_unit_is_the_line_heading_the_table_not_prose():
    # Minimal edit: Orient p334 states its table "(in lakhs)" while an intro sentence says million.
    p = _edit("orient-cables-drhp-capitalisation", 334, "(in   million)", "(in   lakhs)")
    p = [(i, "Amounts in this chapter are in million unless stated otherwise in the table heading below.\n" + t)
         for i, t in p]
    got = O.read_capitalisation(p, ORIENT_FY, "millions")
    assert got["total_borrowing"][0] == pytest.approx(113.45)


def test_a5_unit_line_of_an_earlier_table_on_the_page_is_not_this_tables():
    # Minimal edit: Orient p334's table states "(in lakhs)"; an earlier table's own unit line
    # "(in million)" is printed at the top of the page.
    p = _edit("orient-cables-drhp-capitalisation", 334, "(in   million)", "(in   lakhs)")
    p = [(i, "(in million)\nRevenue from operations 1,000.00\n" + t) for i, t in p]
    got = O.read_capitalisation(p, ORIENT_FY, "millions")
    assert got["total_borrowing"][0] == pytest.approx(113.45)


def test_a5_debt_to_equity_is_null_whenever_total_borrowing_is_null():
    # Step-3a review A5, same exact assertion on the new source: the stored total borrowing is the rebuilt
    # reader's. With it absent (as when the unit is unknown) the statement's ratio is nulled with its reason.
    emit = EF.Emitter("DRHP-d88fad44.pdf")
    emit.null("total_borrowing", "unit_unknown")
    EF._read_offer_doc_statements(pages("nse-drhp-pages"), emit, NSE_FY, 78, None)
    assert emit.fields["total_borrowing"]["value"] is None
    assert emit.fields["debt_to_equity"]["value"] is None
    assert emit.fields["debt_to_equity"]["check"]["detail"] == "debt_to_equity_without_total_borrowing"


def test_a5_d13_consolidated_capitalisation_statement_wins():
    # Minimal edit: a standalone copy of p393 (page 394) printing 1,250.00 borrowings.
    base = pages("nse-drhp-pages")
    p393 = dict(base)[393]
    standalone = (p393.replace("Restated Consolidated", "Restated Standalone")
                  .replace("Total Borrowings (C) = (A)+(B) -", "Total Borrowings (C) = (A)+(B) 1,250.00"))
    got = O.read_capitalisation(base + [(394, standalone)], NSE_FY, "millions")
    assert got["total_borrowing"] == (0.0, 393, None)


def test_a5_d13_consolidated_ronw_block_wins_over_a_disagreeing_standalone_one():
    # Minimal edits: NSE p119's heading labelled "(Consolidated)", plus a standalone block (p120)
    # with its own rows: (30*3 + 40*2 + 35*1) / 6 = 34.17.
    p = _edit("nse-drhp-pages", 119, "4. Return on Net Worth (“RoNW”)", "4. Return on Net Worth (“RoNW”) (Consolidated)")
    p.append((120, "5. Return on Net Worth (“RoNW”) (Standalone)\nFinancial Year ended RoNW % Weight\n"
                   "March 31, 2026 30.00% 3\nMarch 31, 2025 40.00% 2\nMarch 31, 2024 35.00% 1\n"
                   "Weighted Average 34.17% -"))
    got = O.read_ronw_block(p)
    assert got["ronw_by_fy"] == ({"2026": 33.21, "2025": 45.14, "2024": 37.6}, 119, None)
    assert got["weighted_average_ronw"][0] == 37.92
