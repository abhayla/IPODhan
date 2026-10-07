"""promoter_tables (OD-173 section 2, OD-174, OD-175) and the period-table caption rule, on REAL pages.

Fixtures: scraper/tests/fixtures/offer-doc-promoters/<doc>.json (see each .meta.json): page texts and
statement_grid.grid_words() of the stored DRHPs' pages, coordinates rounded to 0.01 pt; a fixture reads
exactly as the whole document does (asserted when it was built).
"""
import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import extract_filing as ef  # noqa: E402
import offer_doc_tables as odt  # noqa: E402
import promoter_tables as pt  # noqa: E402
from offer_doc_financials import dense_pages  # noqa: E402
from statement_grid import WORD_KEYS  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "offer-doc-promoters")


def load(doc):
    with open(os.path.join(FIX, doc + "-DRHP.json"), encoding="utf-8") as fh:
        fx = json.load(fh)
    gw = {int(k): {"width": v["width"], "words": [dict(zip(WORD_KEYS, w)) for w in v["words"]]}
          for k, v in fx["grid_words"].items()}
    return dense_pages(fx["page_texts"]), gw


def read(doc):
    pages, gw = load(doc)
    names, _src, _page = pt.declared_promoters(pages)
    return names, pt.read_promoter_tables(pages, gw.get, names)


def rows_by_name(got):
    return {r["name"]: r for r in got["rows"]}


# ---------- declared promoters (cover copies) ----------
def test_cover_names_wrapped_list_is_whole():
    pages, _ = load("hero-motors-ltd")
    names, src, _ = pt.declared_promoters(pages)
    assert names == ["Pankaj Munjal", "Charu Munjal", "Abhishek Munjal", "O P Munjal Holdings"]
    assert src in ("cover", "cover_wrapped_copy")


def test_cover_list_continuing_after_a_comma_joins_a_long_next_line():
    # Priority Jewels p0: "... TUSHAR MEHTA," / "ADITI KARAN MOTLA, AASHNA SANGANI PARIKH AND PRIORITY RETAIL ..."
    pages, _ = load("priority-jewels-ltd")
    names, _src, _ = pt.declared_promoters(pages)
    assert names == ["Shailesh Sangani", "Manisha Shailesh Sangani", "Tushar Mehta", "Aditi Karan Motla",
                     "Aashna Sangani Parikh", "Priority Retail Ventures Private Limited"]


def test_no_identifiable_promoter_gives_no_names():
    pages, _ = load("national-stock-exchange-of-india-ltd")
    assert pt.declared_promoters(pages)[:2] == (None, "no_identifiable_promoter")


# ---------- holdings ----------
def test_orient_five_promoters_shares_and_total():
    names, got = read("orient-cables-india-ltd")
    rows = rows_by_name(got)
    assert {n: rows[n]["shares_held"] for n in names} == {
        "Vipul Nagpal": 24722800.0, "Garima Nagpal": 5788000.0, "Vardaan Nagpal": 100000.0,
        "Vipul Family Trust": 35712000.0, "Garima Family Trust": 35712000.0}
    assert got["holding"]["pct"] == 99.99          # pdf p20 "Total holding of the Promoters 102,034,800 99.99"
    assert got["holding"]["shares"] == 102034800.0
    assert all(r["is_promoter_group"] is False for r in got["rows"])


def test_promoter_group_rows_are_never_promoter_rows():
    # Orient p106 / p20 print promoter-group members (Darshan Lal Nagpal, Prem Nagpal) beside the promoters.
    names, got = read("orient-cables-india-ltd")
    assert [r["name"] for r in got["rows"]] == names
    assert not any("Darshan" in r["name"] or "Prem" in r["name"] for r in got["rows"])


def test_name_match_is_fail_closed():
    declared = ["Vipul Nagpal", "Garima Nagpal", "Vipul Family Trust"]
    assert pt.match_promoter("1. Vipul Nagpal**", declared) == "Vipul Nagpal"
    assert pt.match_promoter("Darshan Lal Nagpal", declared) is None
    assert pt.match_promoter("Nagpal", declared) is None
    assert pt.match_promoter("Starfish (also the Promoter Selling", ["Starfish I Pte. Ltd."]) == "Starfish I Pte. Ltd."


# ---------- costs: row 111 nil rule, OD-175 ----------
def test_cost_held_validated_by_own_shares_cell():
    _names, got = read("orient-cables-india-ltd")
    rows = rows_by_name(got)
    assert rows["Vipul Nagpal"]["waca"] == 0.01
    assert rows["Vardaan Nagpal"]["waca"] == 0.0           # printed "0.00", a number, not Nil


def test_nil_cost_is_null_bonus_nil_never_zero():
    # LCC p31: "Maya Arjan Rabari 8 Nil**"; one-year table prints Nil for every promoter.
    _names, got = read("lcc-projects-ltd")
    rows = rows_by_name(got)
    maya = rows["Maya Arjan Rabari"]
    assert maya["shares_held"] == 8.0
    assert maya["waca"] is None and maya["reasons"]["waca"] == "bonus_nil"
    assert all(r["waca_last_year"] is None and r["reasons"]["waca_last_year"] == "bonus_nil" for r in got["rows"])


def test_od175_single_one_year_copy_saved_with_four_checks():
    # Symbiotec p38: "2. Kashish Satwani 2,700,000 276.00" (held 2,750,896).
    _names, got = read("symbiotec-pharmalab-ltd")
    rows = rows_by_name(got)
    assert rows["Kashish Satwani"]["waca_last_year"] == 276.0
    assert rows["Kashish Satwani"]["reasons"]["waca_last_year"] == "od175_one_year_single_copy"
    assert rows["Sushil Satwani"]["waca_last_year"] == 276.0


def test_od175_shares_acquired_above_shares_held_is_refused():
    # Symbiotec p38: "1. Anil Satwani 3,470,000 248.16" but he holds 3,170,896 now -> check 4 fails.
    _names, got = read("symbiotec-pharmalab-ltd")
    anil = rows_by_name(got)["Anil Satwani"]
    assert anil["shares_held"] == 3170896.0
    assert anil["waca_last_year"] is None
    assert anil["reasons"]["waca_last_year"].startswith("shares_acquired_exceed_shares_held")


def test_od175_checks_unit_and_heading():
    copy = dict(ctx="Weighted average price per Equity Share (in ₹) acquired in the one year", acquired=10.0)
    assert pt.one_year_checks(copy, "A", 20.0) == (True, "od175_one_year_single_copy")
    assert pt.one_year_checks(dict(copy, ctx="price per Equity Share (in ₹) in three years"), "A", 20.0)[1] == \
        "one_year_heading_not_printed"
    assert pt.one_year_checks(dict(copy, ctx="price in the one year (in %)"), "A", 20.0)[1] == \
        "unit_not_rupees_per_share"
    assert pt.one_year_checks(copy, "A", None)[1] == "shares_held_not_validated"


# ---------- rows 161-165: OD-174 ----------
def test_od174_all_shareholders_caption_is_mixed():
    pages, _ = load("orient-cables-india-ltd")
    got = odt.read_acquisition_ranges(pages)
    assert got["rows"] is None and got["reason"].startswith("caption_mixes_groups")


def test_od174_promoters_with_selling_shareholders_caption_is_mixed():
    # A-One Steels: "... transacted by the promoter, Promoter Group and Selling Shareholders in the last one year"
    pages, _ = load("a-one-steels-india-ltd")
    got = odt.read_acquisition_ranges(pages)
    assert got["rows"] is None and got["reason"].startswith("caption_mixes_groups")


def test_od174_caption_rule():
    assert odt._caption_mixes_groups("all shareholders")
    assert odt._caption_mixes_groups("the Promoters, Promoter Group, Selling Shareholders and Shareholders with "
                                     "special rights")
    assert not odt._caption_mixes_groups("our Promoters and members of our Promoter Group")
    assert not odt._caption_mixes_groups("the Promoters (also the Promoter Selling Shareholders)")


def test_no_promoter_issuer_keeps_selling_shareholder_table_and_nil_range_end_is_null():
    pages, _ = load("national-stock-exchange-of-india-ltd")
    got = odt.read_acquisition_ranges(pages)
    assert got["rows"]["1Y"]["waca"] == 1909.02
    assert (got["rows"]["1Y"]["low"], got["rows"]["1Y"]["high"]) == (1350.0, 2260.0)
    assert got["rows"]["3Y"]["waca"] == 229.23
    assert got["rows"]["3Y"]["low"] is None and got["rows"]["3Y"]["range_why"] == "range_end_printed_nil"


# ---------- wiring: extract_filing field names and shapes ----------
def test_extract_filing_emits_promoter_fields():
    pages, gw = load("orient-cables-india-ltd")
    names, _src, _page = pt.declared_promoters(pages)
    emit = ef.Emitter("DRHP-test.pdf")
    ef._read_promoter_tables(pages, emit, gw.get, names)
    assert emit.fields["promoter_shares_held"]["value"] == 102034800.0
    assert emit.fields["promoter_holding_pre_pct"]["value"] == 99.99
    rows = emit.fields["promoter_rows"]["value"]
    assert [r["name"] for r in rows] == names
    assert set(rows[0]) == {"name", "is_promoter_group", "shares_held", "waca", "waca_last_year", "reasons"}


def test_extract_filing_no_declared_promoter_nulls_every_field():
    emit = ef.Emitter("DRHP-test.pdf")
    ef._read_promoter_tables([], emit, lambda i: None, None)
    for n in ef._PROMOTER_TABLE_FIELDS:
        assert emit.fields[n]["value"] is None and emit.fields[n]["check"]["detail"] == "no_declared_promoter"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
