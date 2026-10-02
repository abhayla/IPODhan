"""Item 39 (OD-164(b), OD-162): the cover-block reader on REAL offer documents.

Each fixture under scraper/tests/fixtures/cover-block/ is the pdfplumber text of
a real document (its URL is in the sibling .meta.json). Every expected value
below was read off that text by hand; the page is the 0-based index
extract_filing.run receives (printed page = index + 1).
"""

import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import answer_states  # noqa: E402
import cover_block  # noqa: E402
from extract_filing import Emitter, run  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "cover-block")


def load(name):
    with open(os.path.join(FIX, name + ".json"), encoding="utf-8") as fh:
        doc = json.load(fh)
    return [(int(i), t) for i, t in doc["pages"]]


def read(name):
    emit = Emitter(name)
    cover_block.read_cover_block(load(name), emit)
    return emit.fields


def v(fields, name):
    return fields[name]["value"]


NSE_BRLMS = [
    "Kotak Mahindra Capital Company Limited", "JM Financial Limited",
    "Morgan Stanley India Company Private Limited", "Citigroup Global Markets India Private Limited",
    "HSBC Securities and Capital Markets (India) Private Limited", "J.P. Morgan India Private Limited",
    "Anand Rathi Advisors Limited", "Avendus Capital Private Limited", "Axis Capital Limited",
    "DAM Capital Advisors Limited", "Equirus Capital Limited", "HDFC Bank Limited",
    "ICICI Securities Limited", "IDBI Capital Markets & Securities Limited",
    "IIFL Capital Services Limited", "Motilal Oswal Investment Advisors Limited",
    "Nuvama Wealth Management Limited", "Pantomath Capital Advisors Private Limited",
    "360 ONE WAM Limited",
]

# name -> {field: (value, page)}; page None = any page
EXPECTED = {
    "nse-mainboard-rhp": {
        "lead_managers": (NSE_BRLMS, 10),
        "registrar_name": ("MUFG Intime India Private Limited", 14),
        "registrar_email": ("nse.ipo@in.mpms.mufg.com", 105),
        "registrar_phone": ("+91 810 811 4949", 105),
        "registrar_website": ("www.in.mpms.mufg.com", 105),
        "registrar_contact_person": ("Shanti Gopalkrishnan", 105),
        "registrar_sebi_reg": ("INR000004058", 105),
        "company_website": ("www.nseindia.com", 0),
        "compliance_officer": ("Prajakta Powle", 2),
        "compliance_officer_email": ("nse_ipo@nse.co.in", 0),
        "compliance_officer_phone": ("+91 22 2659 8100", 2),
    },
    "nityas-mainboard-drhp": {
        "lead_managers": (["Choice Capital Advisors Private Limited"], 1),
        "registrar_name": ("Bigshare Services Private Limited", 1),
        "registrar_email": ("ipo@bigshareonline.com", 111),
        "registrar_phone": ("+91 22 6263 8200", 111),
        "registrar_website": ("www.bigshareonline.com", 111),
        "registrar_contact_person": ("Vikram Morbale", 111),
        "registrar_sebi_reg": ("INR000001385", 111),
        "company_website": ("www.nityas.in", 0),
        "compliance_officer": ("Manvi Meet Shah", None),
        "compliance_officer_email": ("cs@nityas.in", 0),
        "compliance_officer_phone": ("+91 70462 19807", None),
    },
    "vishal-nirmiti-mainboard-rhp": {
        "lead_managers": (["Saffron Capital Advisors Private Limited"], 1),
        "registrar_name": ("MUFG Intime India Private Limited", 1),
        "registrar_email": ("vishalnirmiti.ipo@in.mpms.mufg.com", 1),
        "registrar_phone": ("+91 8108114949", 1),
        "company_website": ("www.vishalnirmiti.com", None),
        "compliance_officer": ("Suhas Ganpat Naik", None),
        "compliance_officer_email": ("ipo@vishalnirmiti.com", None),
        "compliance_officer_phone": ("+91 9823877359", None),
    },
    "rkfal-sme-rhp": {
        "lead_managers": (["Affinity Global Capital Market Private Limited"], 0),
        "registrar_name": ("Cameo Corporate Services Limited", 0),
        "registrar_email": ("investor@cameoindia.com", 0),
        "registrar_phone": ("+91 44 2846 0390", 0),
        "company_website": ("www.citygirljewellery.co.in", 0),
        "compliance_officer": ("Ravi Kumar Bahl", None),
        "compliance_officer_email": ("cs@citygirljewellery.com", 0),
        "compliance_officer_phone": ("+91 8282052929", None),
    },
    "rkfal-sme-drhp": {
        "lead_managers": (["Affinity Global Capital Market Private Limited"], 0),
        "registrar_name": ("Cameo Corporate Services Limited", 0),
        "company_website": ("www.citygirljewellery.co.in", 0),
        "compliance_officer": ("Ravi Kumar Bahl", None),
    },
    "dove-soft-sme-rhp": {
        "lead_managers": (["SWASTIKA INVESTMART LIMITED"], 1),
        "registrar_name": ("PURVA SHAREGISTRY (INDIA) PRIVATE LIMITED", 1),
        "registrar_email": ("newissue@purvashare.com", 1),
        "registrar_phone": ("022 4961 4132", 1),
        "registrar_contact_person": ("Deepali Dhuri", 1),
        "company_website": ("www.dovesoft.io", 1),
        "compliance_officer": ("Archit Tundia", None),
        "compliance_officer_email": ("secretarial@dove-soft.com", 1),
        "compliance_officer_phone": ("+91 9321938063", None),
    },
}


@pytest.mark.parametrize("doc,field", [(d, f) for d, fs in EXPECTED.items() for f in fs])
def test_printed_value_is_read(doc, field):
    fields = read(doc)
    want, page = EXPECTED[doc][field]
    got = fields[field]
    assert got["state"] == answer_states.VALUE, (field, got)
    assert got["value"] == want
    if page is not None:
        assert got["page"] == page


def test_abridged_prospectus_without_a_cover_block_is_missed_not_absent():
    # The stored PROSPECTUS for this IPO is an abridged prospectus whose pages do
    # not print the block (p.7's "Company Secretary and Compliance Officer" is a
    # directors-table row). Every field is a MISS, never a stated absence.
    fields = read("advit-abridged-prospectus")
    for name in ("lead_managers", "registrar_name", "company_website", "compliance_officer",
                 "compliance_officer_email", "compliance_officer_phone"):
        assert fields[name]["value"] is None
        assert fields[name]["state"] == answer_states.MISSED, (name, fields[name])


def test_no_reason_this_reader_emits_is_a_stated_absence():
    for doc in list(EXPECTED) + ["advit-abridged-prospectus"]:
        for name, rec in read(doc).items():
            if rec["value"] is None and rec["check"]["name"] == "not_extractable":
                assert rec["check"]["detail"] not in answer_states.STATED_ABSENCE_REASONS, (doc, name)
                assert rec["state"] == answer_states.MISSED


def test_multi_column_cover_table_is_not_read_as_names():
    # NSE p.2 prints 6 BRLMs in two columns: text order gives "Limited JM
    # Financial Limited". The cover table must be unresolved, not guessed.
    brlm, _reg = cover_block._cover_tables(load("nse-mainboard-rhp"))
    assert brlm["unresolved"] is True


def test_disagreeing_sources_fail_closed():
    pages = load("nityas-mainboard-drhp")
    # rename the registrar in the General Information block only
    pages = [(i, t.replace("Bigshare Services Private Limited\nOffice", "Other Registry Private Limited\nOffice"))
             for i, t in pages]
    emit = Emitter("x")
    cover_block.read_cover_block(pages, emit)
    assert emit.fields["registrar_name"]["value"] is None
    assert emit.fields["registrar_name"]["state"] == answer_states.MISSED
    assert emit.fields["registrar_name"]["check"]["detail"] == "registrar_sources_disagree"


def test_bad_formats_are_refused_not_written():
    assert cover_block.check_sebi_reg("INR00000138", "INR") == (False, cover_block.check_sebi_reg("INR00000138", "INR")[1])
    assert isinstance(cover_block.check_sebi_reg("INR00000138", "INR"), answer_states.Refused)
    assert isinstance(cover_block.check_indian_phone("+91 22 2659 81"), answer_states.Refused)
    assert isinstance(cover_block.check_email("cs@nityas"), answer_states.Refused)
    assert isinstance(cover_block.check_website("www.x"), answer_states.Refused)
    assert cover_block.check_indian_phone("022 4961 4132")[0] is True
    assert cover_block.check_indian_phone("+91 810 811 4949")[0] is True


def test_refused_phone_reaches_the_envelope_as_refused():
    pages = [(i, t.replace("+91 22 2659 8100", "+91 22 2659 81")) for i, t in load("nse-mainboard-rhp")]
    emit = Emitter("x")
    cover_block.read_cover_block(pages, emit)
    rec = emit.fields["compliance_officer_phone"]
    assert rec["value"] is None and rec["state"] == answer_states.REFUSED


def test_run_carries_the_fields_for_an_rhp_and_not_for_a_price_band_ad():
    env = run(load("rkfal-sme-rhp"), "RHP", "rkfal.pdf", segment="SME")
    assert env["fields"]["registrar_name"]["value"] == "Cameo Corporate Services Limited"
    assert env["fields"]["lead_managers"]["value"] == ["Affinity Global Capital Market Private Limited"]
    pba = run(load("dove-soft-sme-price-band-ad"), "PRICE_BAND_AD", "dove-pba.pdf", segment="SME")
    assert "lead_managers" not in pba["fields"]
    assert "registrar_name" not in pba["fields"]


def test_email_domain_cross_check_is_recorded_not_enforced():
    fields = read("nse-mainboard-rhp")
    rec = fields["compliance_officer_email"]
    assert rec["state"] == answer_states.VALUE
    assert rec["cross_check"] == {"name": "email_domain_matches_website", "passed": False}
