"""F-242 (OD-164, §2.5.6): the offer terms an advert prints, read from the offer document itself.

Fixtures are the REAL pdfplumber text under scraper/tests/fixtures/cover-block/ (each with its
public URL in the sibling .meta.json). Every expected value was read off that text by hand; the
page is the 0-based index `extract_filing.run` receives.
"""

import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import answer_states  # noqa: E402
import offer_doc_terms  # noqa: E402
from extract_filing import Emitter, check_allocation, run  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "cover-block")
TERMS = ("designated_stock_exchange", "book_building_regulation", "upi_cutoff_time",
         "qib_pct", "nii_pct", "retail_pct")


def load(name):
    with open(os.path.join(FIX, name + ".json"), encoding="utf-8") as fh:
        doc = json.load(fh)
    return [(int(i), t) for i, t in doc["pages"]]


def read(pages):
    emit = Emitter("t")
    offer_doc_terms.read_offer_terms(pages, emit, check_allocation)
    return emit


def values(fields):
    return {k: (f["value"] if f["state"] == answer_states.VALUE else f["state"])
            for k, f in fields.items() if k in TERMS}


# name -> expected answer per field (a value means VALUE; MISSED means fail-closed miss)
EXPECTED = {
    # NSE DRHP d88fad44: p1 "the Designated Stock Exchange shall be BSE"; p2 "UPI mandate end time
    # and date shall be at 5.00 p.m."; p3 "Book Building Process in compliance with Regulations
    # 6(1)", "not more than 50% ... QIBs", "not less than 15% ... NIBs", "not less than 35% ... RIBs".
    "nse-mainboard-drhp": {"designated_stock_exchange": "BSE", "book_building_regulation": "6(1)",
                           "upi_cutoff_time": "17:00", "qib_pct": 50.0, "nii_pct": 15.0,
                           "retail_pct": 35.0},
    "nse-mainboard-rhp": {"designated_stock_exchange": "BSE", "book_building_regulation": "6(1)",
                          "upi_cutoff_time": "17:00", "qib_pct": 50.0, "nii_pct": 15.0,
                          "retail_pct": 35.0},
    # Regulation 6(2): "at least 75% ... QIBs", "not more than 15%" NII, "not more than 10%" RIBs;
    # "the Designated Stock Exchange shall be [*]" (a DRHP before the RHP) -> not yet filled.
    "nityas-mainboard-drhp": {"designated_stock_exchange": "MISSED", "book_building_regulation": "6(2)",
                              "upi_cutoff_time": "17:00", "qib_pct": 75.0, "nii_pct": 15.0,
                              "retail_pct": 10.0},
    # "50% of the Offer" (no "Net"); no designated-exchange sentence in these pages.
    "orient-mainboard-drhp": {"designated_stock_exchange": "MISSED", "book_building_regulation": "MISSED",
                              "upi_cutoff_time": "17:00", "qib_pct": 50.0, "nii_pct": 15.0,
                              "retail_pct": 35.0},
    # SME (Chapter IX): "shall be allocated ... to QIBs", retail is "Individual Bidders".
    "rkfal-sme-drhp": {"designated_stock_exchange": "MISSED", "book_building_regulation": "MISSED",
                       "upi_cutoff_time": "17:00", "qib_pct": 50.0, "nii_pct": 15.0, "retail_pct": 35.0},
    "dove-soft-sme-rhp": {"designated_stock_exchange": "BSE", "book_building_regulation": "MISSED",
                          "upi_cutoff_time": "17:00", "qib_pct": 50.0, "nii_pct": 15.0,
                          "retail_pct": 35.0},
    # Prints QIB "not more than 1%" and NII "not less than 29%", but no retail sentence the reader
    # resolves: the set of three is incomplete, so all three stay MISSED (never a partial set).
    "vishal-nirmiti-mainboard-rhp": {"designated_stock_exchange": "NSE", "book_building_regulation": "6(1)",
                                     "upi_cutoff_time": "17:00", "qib_pct": "MISSED",
                                     "nii_pct": "MISSED", "retail_pct": "MISSED"},
}


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_real_offer_documents_give_the_printed_terms(name):
    assert values(read(load(name)).fields) == EXPECTED[name]


def test_values_carry_their_page():
    f = read(load("nse-mainboard-drhp")).fields
    assert (f["designated_stock_exchange"]["page"], f["upi_cutoff_time"]["page"],
            f["book_building_regulation"]["page"], f["qib_pct"]["page"]) == (0, 1, 2, 2)


def test_a_miss_is_never_a_failed_check_or_a_clearing_state():
    # REFUSED and STATED_NOT_PRINTED clear a stored value (OD-153); an offer document's silence on
    # an advert field must not. A miss also must not flip the document's status to PARTIAL.
    emit = read(load("orient-mainboard-drhp"))
    assert emit.failed == 0
    assert {f["state"] for f in emit.fields.values()} <= {answer_states.VALUE, answer_states.MISSED}


def page(text):
    return [(0, text)]


def test_not_found():
    f = read(page("Nothing about the offer terms here.")).fields
    assert {k: f[k]["state"] for k in TERMS} == {k: answer_states.MISSED for k in TERMS}
    assert f["upi_cutoff_time"]["check"]["detail"] == "upi_cutoff_time_not_found"


def test_unfilled_placeholder_is_missed_not_a_value():
    f = read(page("For the purposes of the Offer, the Designated Stock Exchange shall be [●].")).fields
    assert f["designated_stock_exchange"]["state"] == answer_states.MISSED
    assert f["designated_stock_exchange"]["check"]["detail"] == "designated_exchange_not_yet_filled"


def test_two_different_readings_are_ambiguous_and_missed():
    f = read([(0, "the Designated Stock Exchange shall be BSE."),
              (9, "the Designated Stock Exchange shall be NSE.")]).fields
    assert f["designated_stock_exchange"]["state"] == answer_states.MISSED
    assert f["designated_stock_exchange"]["check"]["detail"] == "ambiguous: BSE vs NSE"


def test_same_reading_in_two_spellings_agrees():
    f = read([(0, "the Designated Stock Exchange shall be BSE."),
              (9, "the Designated Stock Exchange will be the BSE Limited.")]).fields
    assert (f["designated_stock_exchange"]["value"], f["designated_stock_exchange"]["page"]) == ("BSE", 0)


def test_regulation_needs_the_book_building_sentence():
    # "made in terms of Regulation 6(1)" names eligibility, not the price process; the persister
    # turns this field into issue_type BOOK_BUILDING, so only the Book Building sentence counts.
    f = read(page("The Offer is being made in terms of Regulation 6(1) of the SEBI ICDR Regulations.")).fields
    assert f["book_building_regulation"]["state"] == answer_states.MISSED


def test_unreadable_time_is_missed():
    f = read(page("The UPI mandate end time and date shall be at 25.00 p.m. on the Closing Date.")).fields
    assert f["upi_cutoff_time"]["state"] == answer_states.MISSED


ALLOC = ("not more than {q}% of the Net Offer shall be available for allocation on a proportionate "
         "basis to QIBs. not less than {n}% of the Net Offer shall be available for allocation to "
         "Non-Institutional Bidders and not less than {r}% of the Net Offer shall be available for "
         "allocation to Retail Individual Bidders.")


def test_allocation_that_does_not_add_up_is_missed_as_a_set():
    f = read(page(ALLOC.format(q=50, n=15, r=45))).fields
    assert {k: f[k]["state"] for k in ("qib_pct", "nii_pct", "retail_pct")} == {
        "qib_pct": answer_states.MISSED, "nii_pct": answer_states.MISSED,
        "retail_pct": answer_states.MISSED}
    assert f["qib_pct"]["check"]["detail"].startswith("allocation_check_failed")


@pytest.mark.parametrize("q,n,r", [(50, 15, 10), (40, 25, 35)])
def test_allocation_must_add_to_the_whole_net_offer(q, n, r):
    # A set under 100 (50/15/10) or with QIB under its floor but still summing to 100 (40/25/35)
    # is never written: the three portions of the Net Offer are the whole of it.
    f = read(page(ALLOC.format(q=q, n=n, r=r))).fields
    assert {f[k]["state"] for k in ("qib_pct", "nii_pct", "retail_pct")} == {answer_states.MISSED}
    assert f["qib_pct"]["value"] is None


def test_allocation_values_when_consistent():
    f = read(page(ALLOC.format(q=50, n=15, r=35))).fields
    assert [f[k]["value"] for k in ("qib_pct", "nii_pct", "retail_pct")] == [50.0, 15.0, 35.0]


def test_an_existing_field_from_another_reader_is_never_overwritten():
    emit = Emitter("t")
    emit.put("upi_cutoff_time", "16:00", 3, "other_reader", (True, "16:00"))
    offer_doc_terms.read_offer_terms(load("nse-mainboard-drhp"), emit, check_allocation)
    assert emit.fields["upi_cutoff_time"]["value"] == "16:00"


@pytest.mark.parametrize("doc_type", ["DRHP", "RHP", "PROSPECTUS"])
def test_run_reads_offer_terms_for_every_offer_document_type(doc_type):
    env = run(load("nse-mainboard-drhp"), doc_type, "nse.pdf")
    assert env["fields"]["designated_stock_exchange"]["value"] == "BSE"
    assert env["fields"]["qib_pct"]["value"] == 50.0


def test_run_on_an_advert_keeps_the_advert_reader_only():
    # The price band advert keeps extract_price_band_ad's own answers; the offer-document readers
    # are not run on it (Dove Soft's advert prints none of these sentences).
    env = run(load("dove-soft-sme-price-band-ad"), "PRICE_BAND_AD", "ad.pdf")
    for name in TERMS:
        field = env["fields"].get(name)
        assert field is None or field["check"]["name"] not in (
            "designated_exchange_consensus", "regulation_consensus", "upi_cutoff_consensus")
