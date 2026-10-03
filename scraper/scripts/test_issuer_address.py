"""Appendix A rows 61-66: the issuer's registered office and contact, read off REAL offer-document
covers (the cover-block fixtures; each .meta.json names the document). Every expected value was read
off the fixture text by hand; pages are the 0-based index extract_filing.run receives."""

import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import answer_states  # noqa: E402
import cover_block  # noqa: E402
import issuer_address  # noqa: E402
from extract_filing import Emitter, run  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "cover-block")


def load(name):
    with open(os.path.join(FIX, name + ".json"), encoding="utf-8") as fh:
        return [(int(i), t) for i, t in json.load(fh)["pages"]]


def read(pages):
    emit = Emitter("x")
    cover_block.read_cover_block(pages, emit)
    return emit.fields


ADDRESS = ("company_address", "company_city", "company_state", "company_pincode")
CONTACT = ("company_phone", "company_email")

EXPECTED = {
    "nse-mainboard-drhp": {
        "company_address": "Exchange Plaza, C-1, Block G, Bandra Kurla Complex, Bandra (East) Mumbai 400 051, "
                           "Maharashtra, India",
        "company_city": "Mumbai", "company_state": "Maharashtra", "company_pincode": "400051",
        "company_phone": "+91 22 2659 8100", "company_email": "nse_ipo@nse.co.in",
    },
    "nse-mainboard-rhp": {
        "company_address": "Exchange Plaza, C-1, Block G, Bandra Kurla Complex, Bandra (East) Mumbai 400 051, "
                           "Maharashtra, India",
        "company_city": "Mumbai", "company_state": "Maharashtra", "company_pincode": "400051",
        "company_phone": "+91 22 2659 8100", "company_email": "nse_ipo@nse.co.in",
    },
    "nityas-mainboard-drhp": {
        "company_address": "Sector-1, 6th & 7th Floor, Ratih House, SY-376, TPS-4, PI-7, Paiki Part-B, Parshottam "
                           "Farm Compound Opp. Podar Arcade, Varachha Road, A. K. Road, Surat – 395 008, "
                           "Gujarat, India",
        "company_city": "Surat", "company_state": "Gujarat", "company_pincode": "395008",
        "company_phone": "+91 70462 19807", "company_email": "cs@nityas.in",
    },
    # Registered office in New Delhi, corporate office in Gurugram: the REGISTERED office is read.
    "orient-mainboard-drhp": {
        "company_address": "House No. 8 BLK-D, Second Floor, Ashok Vihar PH-1, New Delhi, Delhi – 110 052, India",
        "company_city": "New Delhi", "company_state": "Delhi", "company_pincode": "110052",
    },
    # SME layout: the label and the address on separate lines (p.1) and again in prose (p.2).
    "rkfal-sme-drhp": {
        "company_address": "Room No. A-201, 2nd Floor, Bagree Market 71, B. R. B. Basu Road, Kolkata - 700001, "
                           "West Bengal, India",
        "company_city": "Kolkata", "company_state": "West Bengal", "company_pincode": "700001",
    },
    "vishal-nirmiti-mainboard-rhp": {
        "company_address": "303, 17 Elphinstone House, Marzban Road, New Empire Cinema, Fort, Mumbai – 400001 "
                           "Maharashtra, India",
        "company_city": "Mumbai", "company_state": "Maharashtra", "company_pincode": "400001",
    },
    "dove-soft-sme-rhp": {
        "company_address": "Office No. 1101, DLH Park, Opp. MTNL, Goregaon West Mumbai-400062, Maharashtra, India",
        "company_city": "Mumbai", "company_state": "Maharashtra", "company_pincode": "400062",
    },
}


@pytest.mark.parametrize("doc,field", [(d, f) for d, fs in EXPECTED.items() for f in fs])
def test_printed_value_is_read(doc, field):
    got = read(load(doc))[field]
    assert got["state"] == answer_states.VALUE, (field, got)
    assert got["value"] == EXPECTED[doc][field]


def test_both_labelled_places_agree_and_both_pages_are_recorded():
    rec = read(load("rkfal-sme-drhp"))["company_address"]
    assert rec["pages"] == [0, 1]


def test_company_contact_is_the_same_reading_as_the_compliance_officers():
    fields = read(load("nse-mainboard-drhp"))
    for company, officer in (("company_phone", "compliance_officer_phone"), ("company_email", "compliance_officer_email")):
        assert fields[company]["value"] == fields[officer]["value"]
        assert fields[company]["state"] == fields[officer]["state"]


def test_an_abridged_prospectus_without_a_label_is_missed_never_absent():
    # advit p.1 prints "Registered Office:" - the abridged prospectus does carry it; strip the
    # labels to model a cover that prints no registered office at all.
    pages = [(i, t.replace("Registered Office", "Office")) for i, t in load("advit-abridged-prospectus")]
    fields = read(pages)
    for name in ADDRESS:
        assert fields[name]["state"] == answer_states.MISSED
        assert fields[name]["check"]["detail"] not in answer_states.STATED_ABSENCE_REASONS


def test_two_different_labelled_addresses_fail_closed():
    pages = [(i, t.replace("Kolkata - 700001", "Howrah - 711101") if i == 1 else t) for i, t in load("rkfal-sme-drhp")]
    fields = read(pages)
    for name in ADDRESS:
        assert fields[name]["value"] is None and fields[name]["state"] == answer_states.MISSED
    assert fields["company_address"]["check"]["detail"] == "company_address_sources_disagree"


def test_a_registrar_office_after_the_lead_manager_heading_is_not_the_issuers():
    # Dove Soft p.3 prints the registrar's "Registered Office: ... Bandra (East), Mumbai - 400051"
    # under the intermediaries' heading. Only the issuer block before that heading is read.
    assert read(load("dove-soft-sme-rhp"))["company_pincode"]["value"] == "400062"


def test_a_cover_with_no_registered_office_label_on_the_issuers_page_reads_nothing_after_the_heading():
    pages = [(i, t.replace("Registered office:", "Office:")) for i, t in load("dove-soft-sme-rhp")]
    fields = read(pages)
    assert fields["company_address"]["state"] == answer_states.MISSED


@pytest.mark.parametrize("address,want", [
    ("House No. 8, Ashok Vihar, New Delhi, Delhi - 110 052, India", ("New Delhi", None)),
    ("Plot 1, Bandra (East) Mumbai 400 051, Maharashtra, India", ("Mumbai", None)),
    ("Plot 1, Goregaon West Mumbai-400062, Maharashtra, India", ("Mumbai", None)),
    ("Jamna Lal Bajaj Marg, C-Scheme, Jaipur, Rajasthan- 302001", ("Jaipur", None)),
    # real Hyundai DRHP p.3: a district is not a city
    ("Sriperumbudur Taluk, Kancheepuram District – 602 105, Tamil Nadu, India", (None, "is_a_district")),
    # real Panchatv DRHP p.2: the place before the state is "North West Delhi" -> "Delhi", the state
    ("Sec 14 Rohini, Prashant Vihar, North West Delhi, Delhi-110085, India", (None, "is_the_state")),
    # a place and a state run together, or three words, is never guessed
    ("Plot 1, MIDC, Pune Maharashtra 411001, India", (None, "unresolved")),
    ("Plot 1, Some Long Place Name 411001, Maharashtra, India", (None, "unresolved")),
])
def test_city_reader(address, want):
    state, _w = issuer_address._state(address)
    assert issuer_address._city(address, state) == want


def test_two_pins_or_two_states_fail_closed():
    assert issuer_address._pincode("Mumbai 400 051 and Pune 411 001") == (None, "two_candidates")
    assert issuer_address._state("Mumbai, Maharashtra; branch Bengaluru, Karnataka") == (None, "two_candidates")
    assert issuer_address._state("Orissa") == ("Odisha", None)


def test_an_address_without_a_pin_is_refused_and_the_parts_follow():
    pages = [(i, t.replace("Kolkata - 700001", "Kolkata")) for i, t in load("rkfal-sme-drhp")]
    fields = read(pages)
    assert fields["company_address"]["state"] == answer_states.REFUSED
    for name in ADDRESS[1:]:
        assert fields[name]["state"] == answer_states.MISSED


def test_mutation_without_the_block_end_the_registrars_office_is_read(monkeypatch):
    # Remove the issuer-block guard: on a cover whose issuer page has no label, the registrar's
    # "Registered Office" under the lead manager heading becomes the company's address - the
    # guard is what keeps it out.
    pages = [(i, t.replace("Registered office:", "Office:")) for i, t in load("dove-soft-sme-rhp")]
    monkeypatch.setattr(issuer_address, "BLOCK_END", issuer_address.re.compile(r"(?!)"))
    # the registrar's two-column block (KESHAVA ... Bandra (East), Mumbai - 400051 / Lower Parel ...)
    assert "KESHAVA" in (read(pages)["company_address"]["value"] or "")


def test_mutation_without_the_agreement_rule_a_disagreement_would_be_written(monkeypatch):
    pages = [(i, t.replace("Kolkata - 700001", "Howrah - 711101") if i == 1 else t) for i, t in load("rkfal-sme-drhp")]
    monkeypatch.setattr(issuer_address, "_canon", lambda a: "same")
    assert read(pages)["company_address"]["state"] == answer_states.VALUE


def test_run_carries_the_fields_on_an_rhp_envelope():
    env = run(load("rkfal-sme-rhp"), "RHP", "rkfal.pdf", segment="SME")
    assert env["fields"]["company_pincode"]["value"] == "700001"
    assert env["fields"]["company_email"]["value"] == "cs@citygirljewellery.com"
