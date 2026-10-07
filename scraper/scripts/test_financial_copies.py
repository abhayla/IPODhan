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


def grids_of(doc):
    fx, gw = load(doc)
    pt = F.dense_pages(fx["page_texts"])
    loc = F.section_locator.locate(pt)
    st = G.read_statement_grids(pt, F.section_locator.restated_start(loc), gw.get, set())
    sec = G.read_section_grids(pt, loc["other"], gw.get, set())
    return st, sec


def one_copy(grid, label_field, spec_fields, ci):
    r = next(r for r in grid["rows"] if FC.L.accept_label(spec_fields[label_field], r["label"]) == (0, None))
    return FC.copy_of("FY", r["cells"][ci], r["raw"][ci], 1.0, "test", grid, ci, r)


def test_single_pat_copy_must_equal_pbt_minus_tax():
    """Elevate p392 prints PBT 825.39, total tax 298.88, PAT 526.51 (FY2025): the identity holds."""
    g = grids_of("elevate-campuses-ltd-DRHP")[0]["statements"]["pl"]["grids"][0]
    c = one_copy(g, "profit", FC.L.FIELDS, 0)
    assert c["printed"] == 526.51 and FC.identity("profit", c) is True
    bad = dict(c, printed=625.51, val=625.51, shown="625.51")
    assert FC.identity("profit", bad) is False
    vals, _src, err, _n = FC.decide([bad], "profit")
    assert vals is None and "fails its table identity" in err


def test_single_total_borrowing_copy_must_equal_its_printed_parts():
    """Elevate's capitalisation statement p524: non-current 11,837.29 + current 228.67 = total 12,065.96."""
    sec = grids_of("elevate-campuses-ltd-DRHP")[1]
    g = next(g for p in sec["pages"] if p["page"] == 524 for g in p["grids"] if "refused" not in g)
    c = one_copy(g, "total_borrowing", FC.L.FIELDS_3B, 0)
    assert c["printed"] == 12065.96 and FC.identity("total_borrowing", c) is True
    assert FC.identity("total_borrowing", dict(c, printed=12165.96)) is False


def test_pat_identity_not_run_beside_a_share_of_associates_line():
    """NSE's P&L adds its share of associates' profit after tax: PBT - tax != PAT there, so no identity is claimed."""
    g = grids_of("national-stock-exchange-of-india-ltd-DRHP")[0]["statements"]["pl"]["grids"][0]
    assert any("share of" in FC.L.raw_lower(r["label"]) for r in g["rows"] if any(v is not None for v in r["cells"]))
    c = one_copy(g, "profit", FC.L.FIELDS, 0)
    assert FC.identity("profit", dict(c, printed=1.0)) is True  # only PAT <= total income is checkable here


def test_a_section_year_the_statements_did_not_read_is_dropped():
    """Guard 2: a copy for a fiscal year outside the restated statements' years never becomes a value."""
    r = read("national-stock-exchange-of-india-ltd-DRHP")
    years = {"FY%d" % y for y in r["fiscal_years"]}
    for name in ("ebitda", "net_worth", "ronw", "rent_expense", "total_borrowing"):
        assert {k for k in r["fields"][name].get("values", {}) if k.startswith("FY")} <= years, name
    # the same real tables, with the statements reading FY2026 and FY2025 only: NSE's printed FY2024 EBITDA
    # (a year the statements did not read) is dropped, never stored
    st, sec = grids_of("national-stock-exchange-of-india-ltd-DRHP")
    fx, _ = load("national-stock-exchange-of-india-ltd-DRHP")
    out = FC.interpret(st, sec, dict(F.dense_pages(fx["page_texts"])))
    for rec in out["fields"].values():
        (rec.get("values") or {}).pop("FY2024", None)
    for copies in out["_stmt_copies"].values():
        copies[:] = [c for c in copies if c["per"] != "FY2024"]
    ebitda = FC.interpret3b(out, sec, {})["fields"]["ebitda"]
    assert set(ebitda["values"]) == {"FY2026", "FY2025"}
    assert any("['FY2024'] dropped" in n for n in ebitda["refusals_seen"])


def run_with_ronw(monkeypatch, edit):
    """The real NSE read, with the RoNW periods edited, through extract_filing's series year check."""
    fx, gw = load("national-stock-exchange-of-india-ltd-DRHP")
    real = F.read_financials

    def edited(*a, **k):
        out = real(*a, **k)
        edit(out["fields"]["ronw"]["values"])
        return out
    monkeypatch.setattr(F, "read_financials", edited)
    return EF.run([tuple(p) for p in fx["page_texts"]], "DRHP", fx["source_doc"], grid_words_for_page=gw.get)["fields"]


def test_series_with_fewer_statement_years_is_kept(monkeypatch):
    """AceVector shape: RoNW printed for 2026 and 2024 while the statements read 2026/2025/2024 -> kept."""
    f = run_with_ronw(monkeypatch, lambda v: v.pop("FY2025"))
    assert f["ronw_by_fy"]["value"] == {"2024": 37.6, "2026": 33.21}
    assert f["ronw_by_fy"]["state"] == "VALUE"


def test_series_with_a_year_the_statements_did_not_read_is_refused(monkeypatch):
    f = run_with_ronw(monkeypatch, lambda v: v.update(FY2023=29.1))
    rec = f["ronw_by_fy"]
    assert rec["value"] is None and rec["state"] == "REFUSED"
    assert "[2023] not among the statement years [2024, 2025, 2026]" in rec["check"]["detail"]
    assert f["revenue_by_fy"]["value"] is not None


def test_subset_check_leaves_the_exact_check_unchanged():
    assert EF.check_fy_subset({"2025": 1.0}, [2025, 2024])[0] is True
    assert EF.check_fy_series({"2025": 1.0}, [2025, 2024])[0] is False


def test_locator_failure_names_the_missing_contents_page():
    fx, gw = load("national-stock-exchange-of-india-ltd-DRHP")
    pages = [p for p in fx["page_texts"] if p[0] != 5]  # the contents page
    rec = F.read_financials(pages, gw.get, set())["fields"]["revenue"]
    assert rec["missed"].startswith("section_locator: no contents page")


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
