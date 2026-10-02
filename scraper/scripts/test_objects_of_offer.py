"""Item 40 (OD-164(c), row 27): the objects-of-the-offer reader on REAL offer documents.

Each fixture under scraper/tests/fixtures/objects-of-offer/ is the pdfplumber text of the objects pages of a
real document (URL in the sibling .meta.json); deepa-rhp-pages.json is the Deepa RHP fixture item 7 added. Every
expected value below was read off that text by hand: printed amounts in the document's own unit, the page as
the 0-based index extract_filing.run receives. Amounts are asserted in crore (row 27's unit), converted once.
"""

import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import answer_states  # noqa: E402
import objects_of_offer as oo  # noqa: E402
from extract_filing import run  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "objects-of-offer")
DEEPA = os.path.join(HERE, "..", "tests", "fixtures", "extractor", "deepa-rhp-pages.json")
RUPEE = "₹"


def load(name, path=None):
    with open(path or os.path.join(FIX, name + ".json"), encoding="utf-8") as fh:
        doc = json.load(fh)
    pages = doc["pages"] if isinstance(doc, dict) else doc
    return [(int(i), t) for i, t in pages]


# --- the per-document table (rows read, unit, Cr, proceeds, F4) -------------------------------------------

def test_hy_tech_prospectus_mainboard_million_serial_less_rows():
    a = oo.read_objects_of_offer(load("hy-tech-mainboard-prospectus"))
    assert a["state"] == "TABLE" and a["unit"] == "million" and a["page"] == 103
    assert [(i["printed_amount"], i["amount_cr"]) for i in a["items"]] == [
        (299.66, 29.966), (160.0, 16.0), (59.64, 5.964)]
    assert a["items"][2]["label"] == "General corporate purposes"
    assert (a["gross_cr"], a["net_cr"], a["printed_total_cr"]) == (60.0, 51.93, 51.93)
    assert a["f4"][0] is True and "GCP 5.96 Cr <= 25% of gross 60.00 Cr" in a["f4"][1]


def test_lcc_prospectus_mainboard_serial_without_dot_and_wrapped_label():
    a = oo.read_objects_of_offer(load("lcc-projects-mainboard-prospectus"))
    assert a["state"] == "TABLE" and a["unit"] == "million" and a["page"] == 98
    assert [(i["serial"], i["printed_amount"], i["amount_cr"]) for i in a["items"]] == [
        (1, 146.91, 14.691), (2, 1800.0, 180.0), (3, 417.28, 41.728)]
    assert "borrowings availed by our Company" in a["items"][1]["label"]
    assert (a["gross_cr"], a["net_cr"]) == (258.0, 236.419)
    assert a["f4"][0] is True


def test_panchatv_sme_prospectus_lakhs_with_percentage_columns():
    a = oo.read_objects_of_offer(load("panchatv-sme-prospectus"))
    assert a["state"] == "TABLE" and a["unit"] == "lakhs" and a["page"] == 86
    assert [(i["printed_amount"], i["amount_cr"]) for i in a["items"]] == [
        (600.0, 6.0), (1150.0, 11.5), (366.88, 3.6688)]
    assert "renovation, modernization and fit-out thereof" in a["items"][0]["label"]
    assert (a["gross_cr"], a["net_cr"]) == (24.584, 21.1688)
    assert a["f4"][0] is True


def test_vinod_sme_drhp_lacs_unpriced_proceeds_keeps_priced_rows():
    a = oo.read_objects_of_offer(load("vinod-texworld-sme-drhp"))
    assert a["state"] == "TABLE" and a["unit"] == "lacs" and a["page"] == 128
    assert [(i["printed_amount"], i["amount_cr"], i["check"]) for i in a["items"]] == [
        (638.77, 6.3877, "priced"), (650.0, 6.5, "priced"), (1850.0, 18.5, "priced"),
        (None, None, "not_priced_yet"), (None, None, "not_priced_yet")]
    assert a["gross_cr"] is None and a["net_cr"] is None
    assert a["f4"][0] is True and "not verifiable before the price is set" in a["f4"][1]


def test_deepa_rhp_unpriced_gcp_bounded_by_gross():
    a = oo.read_objects_of_offer(load(None, DEEPA))
    assert a["state"] == "TABLE" and a["unit"] == "million" and a["page"] == 104
    assert [(i["printed_amount"], i["amount_cr"], i["check"]) for i in a["items"]] == [
        (2150.0, 215.0, "priced"), (None, None, "not_priced_yet")]
    assert a["gross_cr"] == 250.0
    assert a["f4"][0] is True and "priced objects 215.00 Cr <= gross proceeds 250.00 Cr" in a["f4"][1]


def test_rk_fashion_sme_drhp_nested_sub_objects_are_unreadable_not_guessed():
    a = oo.read_objects_of_offer(load("rk-fashion-sme-drhp-nested"))
    assert a == {"state": "UNREADABLE", "reason": "nested_objects_table", "page": 127}


def test_nse_rhp_pure_offer_for_sale_is_a_stated_none():
    a = oo.read_objects_of_offer(load("nse-mainboard-rhp-pure-ofs"))
    assert a == {"state": "STATED_NONE", "reason": oo.NO_FRESH_ISSUE_REASON, "page": 132}


# --- the envelope (answer states the persister reads) -----------------------------------------------------

def envelope(pages, doc_type="RHP"):
    return run(pages, doc_type, "fixture")["fields"]["objects_of_offer"]


def test_envelope_table_is_a_value_in_crore_with_the_f4_check():
    f = envelope(load("lcc-projects-mainboard-prospectus"), "PROSPECTUS")
    assert f["state"] == answer_states.VALUE and f["page"] == 98
    assert f["check"]["name"] == "objects_f4_vs_net_proceeds" and f["check"]["passed"] is True
    assert [i["amount_cr"] for i in f["value"]] == [14.691, 180.0, 41.728]


def test_envelope_pure_ofs_is_stated_not_printed():
    f = envelope(load("nse-mainboard-rhp-pure-ofs"))
    assert f["state"] == answer_states.STATED_NOT_PRINTED and f["value"] is None
    assert f["check"]["detail"] == oo.NO_FRESH_ISSUE_REASON


def test_envelope_nested_table_is_missed_never_refused_or_stated():
    f = envelope(load("rk-fashion-sme-drhp-nested"), "DRHP")
    assert f["state"] == answer_states.MISSED and f["value"] is None


def test_envelope_no_table_is_missed_not_a_stated_absence():
    f = envelope([(0, "RED HERRING PROSPECTUS\nSome cover text without any objects chapter")])
    assert f["state"] == answer_states.MISSED
    assert f["check"]["detail"] == "objects_table_not_found"


def test_envelope_f4_failure_is_refused_with_the_refused_value():
    pages = [(i, t.replace(" 160.00", " 190.00", 1))
             for i, t in load("hy-tech-mainboard-prospectus")]
    f = envelope(pages, "PROSPECTUS")
    assert f["state"] == answer_states.REFUSED and f["value"] is None
    assert f["refused_value"][1]["amount_cr"] == 19.0


# --- fail-closed paths -----------------------------------------------------------------------------------

def test_unit_line_unreadable_is_unreadable_never_a_ten_times_guess():
    pages = [(i, t.replace("(%s in million)" % RUPEE, "").replace("(in %s million)" % RUPEE, ""))
             for i, t in load("hy-tech-mainboard-prospectus")]
    a = oo.read_objects_of_offer(pages)
    assert a["state"] == "UNREADABLE" and a["reason"] == "objects_table_unit_unreadable"


def test_f4_sum_not_matching_net_proceeds_is_refused():
    pages = [(i, t.replace(" 160.00", " 190.00", 1)) for i, t in load("hy-tech-mainboard-prospectus")]
    a = oo.read_objects_of_offer(pages)
    assert a["state"] == "TABLE"
    assert isinstance(a["f4"], answer_states.Refused)
    assert "objects sum 54.93 Cr != net proceeds 51.93 Cr" in a["f4"][1]


def test_f4_gcp_over_a_quarter_of_gross_is_refused():
    items = [{"label": "Capex", "amount_cr": 10.0}, {"label": "General corporate purposes", "amount_cr": 30.0}]
    r = oo.check_f4(items, 40.0, 100.0, 40.0)
    assert isinstance(r, answer_states.Refused) and "exceeds 25% of gross" in r[1]


def test_f4_fully_priced_without_any_reference_is_missed_not_passed():
    r = oo.check_f4([{"label": "Capex", "amount_cr": 10.0}], None, None, None)
    assert isinstance(r, answer_states.Missed)


def test_f4_priced_objects_above_the_bound_are_refused():
    items = [{"label": "Capex", "amount_cr": 300.0}, {"label": "General corporate purposes", "amount_cr": None}]
    assert isinstance(oo.check_f4(items, None, 250.0, None), answer_states.Refused)


@pytest.mark.parametrize("unit,factor", [("million", 0.1), ("lakhs", 0.01), ("lacs", 0.01), ("crore", 1.0)])
def test_unit_conversion_to_crore_happens_once(unit, factor):
    text = "Utilisation of Net Proceeds\n(%s in %s)\n1. Capex 100.00\nTotal 100.00\nMeans of finance\n" % (RUPEE, unit)
    a = oo.read_objects_of_offer([(0, text)])
    assert a["items"][0]["amount_cr"] == round(100.0 * factor, 4)


# --- integer amounts, years in labels, whole-offer stated-none (PR #1462 round 2) -------------------------

def _table(rows, extra=""):
    return ("Utilisation of Net Proceeds\n(%s in million)\n%s\nTotal 1,350\n%sMeans of finance\n"
            % (RUPEE, "\n".join(rows), extra))


def test_integer_amounts_are_priced_and_f4_really_sums():
    text = "Net Proceeds 1,350\n" + _table(["1. Capital expenditure 1,250", "2. General corporate purposes 100"])
    a = oo.read_objects_of_offer([(0, text)])
    assert a["state"] == "TABLE"
    assert [(i["printed_amount"], i["amount_cr"], i["check"]) for i in a["items"]] == [
        (1250.0, 125.0, "priced"), (100.0, 10.0, "priced")]
    assert a["f4"][0] is True and a["f4"][1].startswith("objects sum 135.00 Cr == ")


def test_integer_amounts_not_summing_to_the_total_are_refused():
    a = oo.read_objects_of_offer([(0, _table(["1. Capital expenditure 1,250", "2. General corporate purposes 50"]))])
    assert isinstance(a["f4"], answer_states.Refused)


def test_placeholder_row_stays_unpriced_next_to_integer_amounts():
    a = oo.read_objects_of_offer([(0, _table(["1. Capital expenditure 1,250", "2. General corporate purposes [" + "●" + "]"]))])
    assert [i["check"] for i in a["items"]] == ["priced", "not_priced_yet"]
    assert a["items"][1]["amount_cr"] is None


def test_year_in_label_is_not_the_amount():
    rows = ["1. Repayment of loans by March 2027 1,250", "2. Capex in FY 2027 100 7.41", "3. Working capital for 2027"]
    a = oo.read_objects_of_offer([(0, _table(rows))])
    got = [(i["label"], i["printed_amount"]) for i in a["items"]]
    assert got == [("Repayment of loans by March 2027", 1250.0), ("Capex in FY 2027", 100.0),
                   ("Working capital for 2027", None)]


def test_serial_number_is_not_the_amount():
    a = oo.read_objects_of_offer([(0, _table(["1 Capital expenditure 1,250", "2 General corporate purposes 100"]))])
    assert [i["printed_amount"] for i in a["items"]] == [1250.0, 100.0]


OFS_PAGE = ("OBJECTS OF THE OFFER\nThe Offer comprises an Offer for Sale. Our Company will not receive any "
            "proceeds of the Offer.")


def test_pure_ofs_with_a_fresh_issue_on_the_cover_is_not_stated_none():
    pages = [(1, "RED HERRING PROSPECTUS\nFresh Issue of up to 1,000 million and an Offer for Sale"), (50, OFS_PAGE)]
    a = oo.read_objects_of_offer(pages)
    assert a["state"] == "UNREADABLE" and a["reason"] == oo.FRESH_ISSUE_ELSEWHERE_REASON
    f = envelope(pages)
    assert f["state"] == answer_states.MISSED and f["value"] is None


def test_pure_ofs_with_no_fresh_issue_anywhere_stays_stated_none():
    a = oo.read_objects_of_offer([(1, "RED HERRING PROSPECTUS\nOffer for Sale of equity shares"), (50, OFS_PAGE)])
    assert a["state"] == "STATED_NONE"
