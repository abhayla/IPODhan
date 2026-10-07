"""financial_copies + offer_doc_financials (OD-173 steps 3, 3b, 4) on REAL stored DRHPs, plus the extract_filing wiring.

Expected values are the answer keys' (claude-doc keys, 2026-10-07: NSE drhp-truth.json; Karamtara / Elevate hold-out 1
keys built blind from the PDFs). Fixtures: scraper/tests/fixtures/offer-doc-financials/<doc>.json.
Mutation tests prove the step-4 guards bite: switched off, the known wrong-value classes come back.
"""
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import extract_filing as EF  # noqa: E402
import financial_copies as FC  # noqa: E402
import offer_doc_financials as F  # noqa: E402
import statement_grid as G  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "offer-doc-financials")


def load(doc):
    with open(os.path.join(FIX, doc + ".json"), encoding="utf-8") as fh:
        fx = json.load(fh)
    gw = {int(k): {"width": v["width"], "words": [dict(zip(G.WORD_KEYS, w)) for w in v["words"]]}
          for k, v in fx["grid_words"].items()}
    return fx, gw


def read(doc):
    fx, gw = load(doc)
    return F.read_financials(fx["page_texts"], gw.get, set(fx["ocr_pages"]))


def test_nse_drhp_statement_and_section_fields():
    r = read("national-stock-exchange-of-india-ltd-DRHP")
    f = r["fields"]
    assert r["fiscal_years"] == [2026, 2025, 2024]
    assert f["revenue"]["values"] == {"FY2026": 16601.309, "FY2025": 17140.678, "FY2024": 14780.011}
    assert f["eps_basic"]["values"]["FY2026"] == 41.62  # not the continuing-operations 41.13 (mutation class)
    assert f["net_worth"]["values"]["FY2026"] == 31869.72  # the printed Net worth, not total equity 32,113.54
    assert f["ebitda"]["values"]["FY2026"] == 14519.093
    assert f["ronw"]["values"] == {"FY2024": 37.6, "FY2025": 45.14, "FY2026": 33.21}
    assert r["single"]["total_borrowing"]["value"] == 0.0  # D10: a "-" printed total borrowings
    assert f["revenue"]["copies"]["FY2026"] >= 2


def test_disagreeing_printed_copies_refuse_the_field():
    """F-248: Karamtara's statement prints Other equity 4,038.31 (FY2022), its Offer Document Summary 4,033.13."""
    rec = read("karamtara-engineering-ltd-DRHP")["fields"]["reserves_and_surplus"]
    assert "values" not in rec
    assert "printed copies disagree" in rec["missed"]
    assert "4,038.31" in rec["missed"] and "4,033.13" in rec["missed"]


def test_mutation_without_copies_check_reads_the_conflicting_value(monkeypatch):
    monkeypatch.setattr(FC, "CHECK_COPIES", False)
    rec = read("karamtara-engineering-ltd-DRHP")["fields"]["reserves_and_surplus"]
    assert rec.get("values", {}).get("FY2022") == pytest.approx(403.831)


def test_unread_table_guard_uses_the_dictionary():
    """Elevate prints an 'EBITDA %' row in a table that cannot be read; a percent row is never EBITDA (OD-172)."""
    assert read("elevate-campuses-ltd-DRHP")["fields"]["ebitda"]["values"]["FY2025"] == pytest.approx(259.316)


def test_mutation_guard_without_dictionary_refuses_elevate_ebitda(monkeypatch):
    monkeypatch.setattr(FC, "GUARD_USES_DICTIONARY", False)
    rec = read("elevate-campuses-ltd-DRHP")["fields"]["ebitda"]
    assert "values" not in rec and "unread table" in rec["missed"]


def test_unread_table_printing_another_number_refuses():
    """Orient's capitalisation statement prints Total Borrowings 1,134.5 in a table that cannot be read."""
    rec = read("orient-cables-india-ltd-DRHP")["fields"]["total_borrowing"]
    assert "values" not in rec and "1134.5" in rec["missed"]


def test_stub_periods_are_kept_apart_from_fiscal_years():
    r = read("karamtara-engineering-ltd-DRHP")
    assert r["fiscal_years"] == [2024, 2023, 2022]
    assert r["fields"]["revenue"]["values"]["S2024-09"] == pytest.approx(1413.104)
    assert F.fy_series(r["fields"]["revenue"], "money", "millions") == {
        "2024": 24251.5, "2023": 16003.07, "2022": 12448.09}


def test_no_word_boxes_means_null_with_reason():
    fx, _ = load("national-stock-exchange-of-india-ltd-DRHP")
    out = EF.run([tuple(p) for p in fx["page_texts"]], "DRHP", fx["source_doc"])
    rec = out["fields"]["revenue_by_fy"]
    assert rec["value"] is None and "word_boxes_unavailable" in rec["check"]["detail"]


def run_doc(doc):
    fx, gw = load(doc)
    return EF.run([tuple(p) for p in fx["page_texts"]], "DRHP", fx["source_doc"], grid_words_for_page=gw.get)


def test_extract_filing_keeps_the_output_shape_in_the_document_unit():
    out = run_doc("jindal-supreme-india-ltd-DRHP")  # a lakhs document
    assert out["unit"] == "lakhs" and out["fiscal_years"] == [2025, 2024, 2023]
    rev = out["fields"]["revenue_by_fy"]
    assert rev["value"] == {"2025": 58639.93, "2024": 64543.98, "2023": 50612.0}
    assert rev["state"] == "VALUE" and rev["page"] == 237
    assert out["fields"]["ronw_by_fy"]["value"] is None
    assert "printed copies disagree" in out["fields"]["ronw_by_fy"]["check"]["detail"]


def test_extract_filing_nse_total_borrowing_and_debt_to_equity():
    f = run_doc("national-stock-exchange-of-india-ltd-DRHP")["fields"]
    assert f["total_borrowing"]["value"] == 0.0
    assert f["net_worth_by_fy"]["value"] == {"2024": 238330.98, "2025": 301650.48, "2026": 318697.2}
    assert f["eps_diluted_by_fy"]["value"] == {"2026": 41.62, "2025": 49.24, "2024": 33.56}
