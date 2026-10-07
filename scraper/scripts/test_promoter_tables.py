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


def test_a_qualifying_bracket_is_a_different_holder():
    declared = ["Rajesh Kumar Sharma"]
    assert pt.match_promoter("Rajesh Kumar Sharma (HUF)", declared) is None
    assert pt.match_promoter("Rajesh Kumar Sharma (as trustee of RKS Family Trust)", declared) is None
    assert pt.match_promoter("Rajesh Kumar Sharma (jointly with Anita Sharma)", declared) is None
    assert pt.match_promoter("Rajesh Kumar Sharma (on behalf of Sharma Family)", declared) is None
    # the bracket itself stops the match (not only the extra letters it adds)
    assert pt.identity("Rajesh Kumar Sharma (HUF)") is None
    assert pt.identity("ABC Holdings (Ltd)") is None
    # an alias bracket and a footnote reference are not qualifiers
    assert pt.match_promoter("Rajesh Kumar Sharma (also the Promoter Selling Shareholder)", declared) == \
        "Rajesh Kumar Sharma"
    assert pt.match_promoter("Rajesh Kumar Sharma(1)", declared) == "Rajesh Kumar Sharma"


def test_entity_type_is_part_of_identity():
    assert pt.match_promoter("ABC Holdings LLP", ["ABC Holdings Private Limited"]) is None
    assert pt.match_promoter("Sunil Kumar Gupta", ["Sunil Kumar Gupta HUF"]) is None
    assert pt.match_promoter("Sunil Kumar Gupta HUF", ["Sunil Kumar Gupta"]) is None
    assert pt.match_promoter("Vipul Family Trust", ["Vipul Family"]) is None
    assert pt.match_promoter("ABC Holdings Pvt. Ltd.", ["ABC Holdings Private Limited"]) == \
        "ABC Holdings Private Limited"
    # Jindal p94: "3. Abhishek Jindal HUF" is not the promoter Abhishek Jindal
    assert pt.match_promoter("3. Abhishek Jindal HUF", ["Abhishek Jindal", "Sonam Jindal"]) is None


def test_no_prefix_or_cut_name_match():
    # AceVector p23 prints only "Starfish (also the Promoter Selling Shareholder)" for Starfish I Pte. Ltd.
    assert pt.match_promoter("Starfish (also the Promoter Selling Shareholder)", ["Starfish I Pte. Ltd."]) is None
    assert pt.match_promoter("Rajesh Kumar", ["Rajesh Kumar Sharma"]) is None


def test_joint_holder_first_line_is_never_a_promoter():
    declared = ["Rajesh Kumar Sharma"]
    assert pt.match_promoter("Rajesh Kumar Sharma &", declared) is None
    assert pt.match_promoter("Rajesh Kumar Sharma and", declared) is None
    assert pt.match_promoter("Rajesh Kumar Sharma jointly with", declared) is None
    seg = dict(rows=[dict(label="Rajesh Kumar Sharma &", ext="Rajesh Kumar Sharma & Anita Sharma",
                          cells=["100", "1.00"])])
    assert pt.matched_rows(seg, declared) == []


def test_cover_phrase_is_never_a_name():
    assert pt._cover_names("OFFER FOR SALE BY THE PROMOTERS OF OUR COMPANY AND THE PROMOTER GROUP") is None
    assert pt._cover_names("THE PROMOTERS OF OUR COMPANY ARE: AND THE PROMOTER GROUP") is None
    assert pt._cover_names("Our Promoters are also interested in the Offer") is None
    assert pt._cover_names("OUR PROMOTERS: RAJ KUMAR AND SITA DEVI") == ["Raj Kumar", "Sita Devi"]


def test_single_cover_copy_needs_the_promoter_section(monkeypatch):
    one = [(0, "OUR PROMOTERS: RAJ KUMAR AND SITA DEVI\nDETAILS OF THE OFFER")]
    assert pt.declared_promoters(one)[:2] == (None, "single_cover_copy_unconfirmed")
    monkeypatch.setattr(pt, "_section_text", lambda *_a: "OUR PROMOTERS AND PROMOTER GROUP Raj Kumar ... Sita Devi")
    assert pt.declared_promoters(one)[:2] == (["Raj Kumar", "Sita Devi"], "cover_and_promoter_section")
    monkeypatch.setattr(pt, "_section_text", lambda *_a: "OUR PROMOTERS AND PROMOTER GROUP Raj Kumar")
    assert pt.declared_promoters(one)[:2] == (None, "single_cover_copy_unconfirmed")


def _seg(hdr_lines, rows, ctx=""):
    """a holding segment from (x0, text) header chunks and (label, cells) rows: label ends x=100, cells end
    at x=200, 300."""
    hdr = [[dict(text=t, x0=x, x1=x + 60, top=0, bottom=1) for x, t in line] for line in hdr_lines]
    return dict(ctx=ctx, hdr=hdr, page=1, kind="hold",
                rows=[dict(label=l, ext=l, cells=c, lab_x1=100.0, cx1=[200.0, 300.0][:len(c)]) for l, c in rows])


def test_holding_table_unit_and_pre_offer_column():
    rows = [("Raj Kumar", ["10", "50.00"]), ("Total", ["10", "50.00"])]
    ok = _seg([[(140, "Number of shares"), (240, "% of pre-Offer capital")]], rows)
    assert pt.holding_refusal(ok) is None
    lakh = _seg([[(140, "Shares (in lakh)"), (240, "% of pre-Offer capital")]], rows)
    assert pt.holding_refusal(lakh).startswith("shares_column_scaled_unit")
    post = _seg([[(140, "Number of shares"), (240, "% of post-Offer capital")]], rows)
    assert pt.holding_refusal(post).startswith("pct_column_post_offer")
    unstated = _seg([[(140, "Number of shares"), (240, "% of capital")]], rows)
    assert pt.holding_refusal(unstated) == "pct_column_not_shown_pre_offer"


def test_group_flag_reason_codes_for_the_persister():
    assert pt.group_flag([False, False]) == (False, "not_promoter_group_stated")
    assert pt.group_flag([True]) == (True, "promoter_group_stated")
    assert pt.group_flag([]) == (None, None)
    assert pt.group_flag([True, False]) == (None, None)


def test_unstated_group_row_carries_no_code():
    # Symbiotec rows the headings never classify keep is_promoter_group None and no reason code
    _names, got = read("symbiotec-pharmalab-ltd")
    for r in got["rows"]:
        if r["is_promoter_group"] is None:
            assert "is_promoter_group" not in r["reasons"]
        else:
            assert r["reasons"]["is_promoter_group"] in ("promoter_group_stated", "not_promoter_group_stated")


def test_od176_caption_states_the_period_for_a_one_cost_column_table():
    # AceVector p38: caption "... acquired in the one year ..."; headings: shares acquired | ONE cost column.
    names, got = read("acevector-ltd")
    rows = rows_by_name(got)
    assert rows["Kunal Bahl"]["waca_last_year"] == 1.84
    assert rows["Rohit Kumar Bansal"]["waca_last_year"] == 1.88


def test_od176_two_cost_columns_need_the_period_in_the_column_heading():
    copy = dict(hdr="Average cost of acquisition per Equity Share (in ₹)",
                hdr_acquired="Number of Equity Shares acquired", acquired=10.0,
                caption="Average cost of acquisition of shares acquired in the one year preceding the DRHP")
    assert pt.one_year_checks(dict(copy, cost_columns=1), "A", 20.0) == (True, "od175_one_year_single_copy")
    assert pt.one_year_checks(dict(copy, cost_columns=2), "A", 20.0)[1] == "one_year_heading_not_printed"


def test_od176_cost_columns_counted_from_headings():
    seg = _seg([[(140, "Number of shares acquired"), (240, "Average cost per share (in ₹)")]],
               [("Raj Kumar", ["10", "5.00"])])
    assert pt.cost_column_count(seg) == 1
    two = dict(seg, rows=[dict(label="Raj Kumar", ext="Raj Kumar", cells=["10", "5.00", "6.00"], lab_x1=100.0,
                               cx1=[200.0, 300.0, 400.0])],
               hdr=seg["hdr"] + [[dict(text="Weighted average price (in ₹)", x0=340, x1=400, top=0, bottom=1)]])
    assert pt.cost_column_count(two) == 2


def test_is_promoter_group_only_as_the_table_states_it():
    seg = _seg([[(0, "Promoters")]], [("Raj Kumar", ["10", "1"])])
    seg["rows"] += [dict(label="Promoter Group", ext="Promoter Group", cells=[], head=True),
                    dict(label="Sita Devi", ext="Sita Devi", cells=["5", "1"], lab_x1=100.0, cx1=[200.0, 300.0])]
    assert pt.stated_group(seg, 0) is False
    assert pt.stated_group(seg, 2) is True
    bare = _seg([[(0, "Name of the shareholder")]], [("Raj Kumar", ["10", "1"])])
    assert pt.stated_group(bare, 0) is None
    both = _seg([[(0, "Promoters and Promoter Group")]], [("Raj Kumar", ["10", "1"])])
    assert pt.stated_group(both, 0) is None


def test_orient_promoter_rows_are_stated_promoters():
    _names, got = read("orient-cables-india-ltd")
    assert all(r["is_promoter_group"] is False and r["reasons"]["is_promoter_group"] == "not_promoter_group_stated"
               for r in got["rows"])


def test_name_match_is_fail_closed():
    declared = ["Vipul Nagpal", "Garima Nagpal", "Vipul Family Trust"]
    assert pt.match_promoter("1. Vipul Nagpal**", declared) == "Vipul Nagpal"
    assert pt.match_promoter("Darshan Lal Nagpal", declared) is None
    assert pt.match_promoter("Nagpal", declared) is None
    assert pt.match_promoter("Starfish (also the Promoter Selling", ["Starfish I Pte. Ltd."]) is None


# ---------- costs: row 111 nil rule, OD-175 ----------
def test_cost_held_validated_by_own_shares_cell():
    _names, got = read("orient-cables-india-ltd")
    rows = rows_by_name(got)
    assert rows["Vipul Nagpal"]["waca"] == 0.01


def test_printed_zero_cost_is_null_bonus_nil():
    # Spec row 111: Orient p27 "Vardaan Nagpal 100,000 0.00" - a nil WACA is null (bonus_nil), never 0.
    _names, got = read("orient-cables-india-ltd")
    for n in ("Vardaan Nagpal", "Vipul Family Trust", "Garima Family Trust"):
        row = rows_by_name(got)[n]
        assert row["waca"] is None and row["reasons"]["waca"] == "bonus_nil"


def test_nil_cost_is_null_bonus_nil_never_zero():
    # LCC p31: "Maya Arjan Rabari 8 Nil**"; one-year table prints Nil for every promoter.
    _names, got = read("lcc-projects-ltd")
    rows = rows_by_name(got)
    maya = rows["Maya Arjan Rabari"]
    assert maya["shares_held"] == 8.0
    assert maya["waca"] is None and maya["reasons"]["waca"] == "bonus_nil"
    # the one-year Nils are null; LCC's headings never state the one-year period, so OD-175 refuses the copy
    # before its value is read (a refusal, not a stated nil)
    assert all(r["waca_last_year"] is None for r in got["rows"])
    assert {r["reasons"]["waca_last_year"] for r in got["rows"]} <= {"bonus_nil", "one_year_heading_not_printed"}


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


def test_od175_checks_read_the_column_headings_not_the_caption():
    # Karamtara p24 headings: cost column "Weighted average price of acquisition per Equity Share*(in ₹)",
    # shares column "Number of equity shares ... acquired in the last one year".
    copy = dict(hdr="Weighted average price of acquisition per Equity Share*(in ₹)",
                hdr_acquired="Number of equity shares of face value of ₹ 10 each acquired in the last one year",
                acquired=10.0)
    assert pt.one_year_checks(copy, "A", 20.0) == (True, "od175_one_year_single_copy")
    # AceVector p38: "one year" only in the caption above the table; the headings never say it -> refused.
    ace = dict(hdr="Average cost of acquisition per Equity Share (in ₹)*#",
               hdr_acquired="Number of Equity Shares of face value of ₹1 each acquired", acquired=10.0,
               ctx="Weighted average price ... acquired in the one year preceding the date of this DRHP")
    assert pt.one_year_checks(ace, "A", 20.0)[1] == "one_year_heading_not_printed"
    assert pt.one_year_checks(dict(copy, hdr="Weighted average price (in %)"), "A", 20.0)[1] == \
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
