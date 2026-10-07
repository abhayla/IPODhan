"""statement_grid (OD-173 steps 2 and 3b) on REAL word boxes of stored DRHPs.

Fixtures: scraper/tests/fixtures/offer-doc-financials/<doc>.json (see each .meta.json); grid_words are
statement_grid.grid_words() of the stored PDF's pages, coordinates rounded to 0.01 pt.
"""
import json
import os
import sys

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


def test_parse_cell_brackets_and_dashes():
    assert G.parse_cell("(1,234.50)") == (-1234.5, "ok")
    assert G.parse_cell("-") == (None, "empty")
    assert G.parse_cell("12,34.5") == (None, "bad")
