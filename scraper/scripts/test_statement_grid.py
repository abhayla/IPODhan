"""statement_grid (OD-173 steps 2 and 3b) on REAL word boxes of stored DRHPs.

Fixtures: scraper/tests/fixtures/offer-doc-financials/<doc>.json (see each .meta.json); grid_words are
statement_grid.grid_words() of the stored PDF's pages, coordinates rounded to 0.01 pt.
"""
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import offer_doc_financials as F  # noqa: E402
import section_locator  # noqa: E402
import statement_grid as G  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "offer-doc-financials")


def load(doc):
    with open(os.path.join(FIX, doc + ".json"), encoding="utf-8") as fh:
        fx = json.load(fh)
    gw = {int(k): {"width": v["width"], "words": [dict(zip(G.WORD_KEYS, w)) for w in v["words"]]}
          for k, v in fx["grid_words"].items()}
    return F.dense_pages(fx["page_texts"]), gw, set(fx["ocr_pages"])


def statements(doc):
    pt, gw, ocr = load(doc)
    start = section_locator.restated_start(section_locator.locate(pt))
    return G.read_statement_grids(pt, start, gw.get, ocr)["statements"]


def row(grid, label):
    return next(r for r in grid["rows"] if r["label"] == label)


def test_nse_profit_and_loss_grid_reads_three_fiscal_years():
    pl = statements("national-stock-exchange-of-india-ltd-DRHP")["pl"]
    g = pl["grids"][0]
    assert g["page"] == 286 and g["unit"] == "million"
    assert [(c["period"]["year"], c["period"]["month"], c["period"]["kind"]) for c in g["columns"]] == [
        (2026, 3, "fy"), (2025, 3, "fy"), (2024, 3, "fy")]
    assert row(g, "Revenue from operations")["cells"] == [166013.09, 171406.78, 147800.11]


def test_nse_statement_pages_and_continuations():
    st = statements("national-stock-exchange-of-india-ltd-DRHP")
    assert {k: v["pages"] for k, v in st.items()} == {"bs": [284, 285], "pl": [286, 287], "cf": [290, 291]}


def test_spaced_header_letters_are_refused_never_guessed():
    """Jindal's cash flow prints '3 1 s t M a r c h , 2 0 24': the column cannot resolve, so the grid is refused."""
    cf = statements("jindal-supreme-india-ltd-DRHP")["cf"]
    assert "refused" in cf["grids"][0]
    assert "0 periods" in cf["grids"][0]["refused"]


def test_two_value_columns_per_period_are_refused():
    """Orient's cash flow prints two amount columns under each year: unpaired columns refuse the grid."""
    cf = statements("orient-cables-india-ltd-DRHP")["cf"]
    assert "refused" in cf["grids"][0] and "header ''" in cf["grids"][0]["refused"]


def test_stub_period_column_is_a_stub_not_a_fiscal_year():
    g = statements("karamtara-engineering-ltd-DRHP")["pl"]["grids"][0]
    kinds = [(c["period"]["year"], c["period"]["month"], c["period"]["kind"]) for c in g["columns"]]
    assert kinds[:2] == [(2024, 9, "stub"), (2023, 9, "stub")]
    assert kinds[2:] == [(2024, 3, "fy"), (2023, 3, "fy"), (2022, 3, "fy")]


def test_ocr_page_is_refused_not_read():
    pt, gw, _ = load("national-stock-exchange-of-india-ltd-DRHP")
    start = section_locator.restated_start(section_locator.locate(pt))
    st = G.read_statement_grids(pt, start, gw.get, {286})["statements"]
    assert st["pl"]["grids"][0]["refused"].startswith("OCR page")


def test_section_tables_read_a_period_per_row_ronw_table():
    pt, gw, ocr = load("national-stock-exchange-of-india-ltd-DRHP")
    loc = section_locator.locate(pt)
    sec = G.read_section_grids(pt, loc["other"], gw.get, ocr)
    assert sec["problems"] == []
    assert {p["section"] for p in sec["pages"]} == {"bop", "ofi", "cap", "restated"}
    rows_tables = [g for p in sec["pages"] if p["section"] == "bop" for g in p["grids"]
                   if g.get("orientation") == "rows"]
    assert rows_tables, "the Basis for Offer Price RoNW table prints one fiscal year per row"


# Part-of-year headers as printed in the 24 cached documents (document, page): never a full fiscal year.
REAL_PART_HEADERS = [
    ("Q1 FY2026", (2025, 6), "LCC p138"), ("Q1 FY 2026", (2025, 6), "SS Retail p275"),
    ("Q1'FY26", (2025, 6), "Sonaselection p261"), ("Q3 FY2026", (2025, 12), "Jio Platforms p139"),
    ("Q4 Fiscal 2026", (2026, 3), "NSE p147"), ("H1 FY 2024", (2023, 9), "Runwal p181"),
    ("H1 FY26", (2025, 9), "Acevector p236"), ("9M FY24", (2023, 12), "Priority p102"),
    ("Nine months ended Fiscal 2024", (2023, 12), "German Green p259"),
    ("Six months ended Fiscal 2024", (2023, 9), "Runwal p188"), ("six months Fiscal 2025", (2024, 9), "Deepa p28"),
    ("three months Fiscal 2025", (2024, 6), "Symbiotec p229"), ("Six months FY25", (2024, 9), "Acevector p219"),
]


@pytest.mark.parametrize("text,end,where", REAL_PART_HEADERS)
def test_a_part_of_a_fiscal_year_is_a_stub(text, end, where):
    for parse in (G.periods_in, G.periods3):
        (y, mo, _d, kind), = parse(text)
        assert kind == "stub" and (y, mo) == end, (where, parse.__name__)


def test_quarter_header_beside_years_keeps_the_years():
    """A KPI header 'Q1 FY26 | FY25 | FY24': only the quarter column is a stub."""
    assert [p[3] for p in G.periods3("Q1 FY26 FY25 FY24")] == ["stub", "fy", "fy"]
    assert G.periods3("quarter ended FY25") == [(2025, 0, None, "stub")]
    assert G.periods_in("Fiscal 2025") == [(2025, 3, 31, "fy")]


def test_bare_years_under_a_part_of_year_heading_are_not_fiscal_years():
    assert G.resolve_period("2024", "Nine months ended Fiscal") is None
    assert G.resolve_period("2024", "Fiscal") == (2024, 3, 31, "fy")


def test_a_prose_amount_line_is_not_the_tables_unit():
    """The reviewer's case: a context sentence stating crore above a table captioned '(Rs in million)'."""
    ctx = [{"text": "As at March 31, 2025, our total borrowings were Rs 1,234.56 crore."}]
    hdr = [{"text": "(Rs in million)"}]
    assert G.unit_basis(ctx + hdr, 1, hdr, ctx)[0] == "million"
    assert G.unit_basis(ctx, 1, [], ctx)[0] is None
    assert G.unit_basis(ctx + [{"text": "(₹ in lakhs)"}], 2, [], [])[0] == "lakh"
    assert G.is_unit_declaration("(₹ in million, except per share data)")
    assert not G.is_unit_declaration("borrowings were Rs 1,234.56 crore.")


def test_section_tables_take_their_unit_from_a_declaration():
    pt, gw, ocr = load("national-stock-exchange-of-india-ltd-DRHP")
    loc = section_locator.locate(pt)
    sec = G.read_section_grids(pt, loc["other"], gw.get, ocr)
    units = {g.get("unit") for p in sec["pages"] for g in p["grids"] if "refused" not in g and g.get("unit")}
    assert units == {"million"}


def test_parse_cell_brackets_and_dashes():
    assert G.parse_cell("(1,234.50)") == (-1234.5, "ok")
    assert G.parse_cell("-") == (None, "empty")
    assert G.parse_cell("12,34.5") == (None, "bad")
