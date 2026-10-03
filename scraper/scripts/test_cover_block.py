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
    # p.13 Definitions: "M-BRLM SBI Capital Markets Limited acting as a book running lead manager to
    # the Offer*" - a BRLM printed in its own row with a selling-shareholder marker (BSE stores 20).
    "SBI Capital Markets Limited",
]

# NSE DRHP p.10-11 Definitions row, in its printed order (20 names; no separate M-BRLM row).
NSE_DRHP_BRLMS = [
    "Kotak Mahindra Capital Company Limited", "JM Financial Limited",
    "Morgan Stanley India Company Private Limited", "Citigroup Global Markets India Private Limited",
    "HSBC Securities and Capital Markets (India) Private Limited", "J.P. Morgan India Private Limited",
    "SBI Capital Markets Limited", "Anand Rathi Advisors Limited", "Avendus Capital Private Limited",
    "Axis Capital Limited", "DAM Capital Advisors Limited", "Equirus Capital Limited", "HDFC Bank Limited",
    "ICICI Securities Limited", "IDBI Capital Markets & Securities Limited", "IIFL Capital Services Limited",
    "Motilal Oswal Investment Advisors Limited", "Nuvama Wealth Management Limited",
    "Pantomath Capital Advisors Private Limited", "360 ONE WAM Limited",
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
    # F-243: the NSE DRHP. Its Definitions BRLM row (p.10) crosses the page break into p.11, and
    # its cover registrar cell (p.2) wraps over three lines in a multi-column table.
    "nse-mainboard-drhp": {
        "lead_managers": (NSE_DRHP_BRLMS, 9),
        "registrar_name": ("MUFG Intime India Private Limited", 91),
        "registrar_email": ("nse.ipo@in.mpms.mufg.com", 91),
        "registrar_phone": ("+91 810 811 4949", 91),
        "registrar_website": ("www.in.mpms.mufg.com", 91),
        "registrar_contact_person": ("Shanti Gopalkrishnan", 91),
        "registrar_sebi_reg": ("INR000004058", 91),
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


def test_run_carries_the_fields_for_an_rhp_and_for_a_price_band_ad():
    env = run(load("rkfal-sme-rhp"), "RHP", "rkfal.pdf", segment="SME")
    assert env["fields"]["registrar_name"]["value"] == "Cameo Corporate Services Limited"
    assert env["fields"]["lead_managers"]["value"] == ["Affinity Global Capital Market Private Limited"]
    # Item 39 round 2 (spec 2.5.6 item 2, "the price band advert ... where printed"): the advert
    # carries the cover reader's answers too. They are RHP-family fields, so the persister never
    # writes them from an advert (OD-96, filing-persister documentMayWriteField).
    pba = run(load("dove-soft-sme-price-band-ad"), "PRICE_BAND_AD", "dove-pba.pdf", segment="SME")
    for name in ("lead_managers", "registrar_name", "company_website"):
        assert pba["fields"][name]["state"] in answer_states.ALL_STATES


def test_email_domain_cross_check_is_recorded_not_enforced():
    fields = read("nse-mainboard-rhp")
    rec = fields["compliance_officer_email"]
    assert rec["state"] == answer_states.VALUE
    assert rec["cross_check"] == {"name": "email_domain_matches_website", "passed": False}


# ---- the BRLM-with-a-marker class (supervisor finding 1) ------------------ #
@pytest.mark.parametrize("line,want", [
    # real lines of the NSE RHP: a footnote / role marker is not part of the name
    ("SBI Capital Markets Limited#", "SBI Capital Markets Limited"),
    ("SBI Capital Markets Limited (SS) SBI Capital Markets Limited, participating as a Selling Shareholder",
     "SBI Capital Markets Limited"),
    ("ICICI Securities Limited*", "ICICI Securities Limited"),
    ("$SBI Capital Markets Limited is also participating as a Selling Shareholder in the Offer.",
     "SBI Capital Markets Limited"),
])
def test_a_marker_on_a_firm_name_is_kept_off_the_name(line, want):
    name, _two = cover_block._firm_line(line)
    assert name == want


def test_marketing_brlm_row_joins_the_brlm_list():
    defs = cover_block._definition_rows(load("nse-mainboard-rhp"))
    names, _page = defs["brlm"]
    assert names[-1] == "SBI Capital Markets Limited"
    assert len(names) == 20


def test_marketing_brlm_row_alone_does_not_make_a_list():
    # an M-BRLM row with no Book Running Lead Managers row is not the whole list: no value
    pages = [(i, t.replace("“Book Running Lead Managers”", "“Something Else”")) for i, t in load("nse-mainboard-rhp")]
    defs = cover_block._definition_rows(pages)
    assert "brlm" not in defs


def test_two_or_more_brlms_get_no_inm_pairing():
    # finding 4: the General Information BRLM blocks are printed two to a row; pairing an INM
    # number with a name by text order is a guess, so 2+ BRLMs emit no lead_manager_sebi_reg.
    fields = read("nse-mainboard-rhp")
    assert "lead_manager_sebi_reg" not in fields


# ---- Tier A round 1 (PR #1460) MAJOR-1: the Definitions row must stop at ANY firm suffix ---- #
def _nse_with(old, new, count=1):
    pages = load("nse-mainboard-rhp")
    out, hits = [], 0
    for i, t in pages:
        hits += t.count(old)
        out.append((i, t.replace(old, new, count)))
    assert hits >= 1, "mutation did not apply: %r" % old
    return out


def _brlm(pages):
    emit = Emitter("x")
    cover_block.read_cover_block(pages, emit)
    return emit.fields["lead_managers"]


SELLING_SHAREHOLDERS = ("MS Strategic (Mauritius) Limited", "ICICI Lombard General Insurance Company Limited")


@pytest.mark.parametrize("suffix", ["Ltd.", "Ltd", "Pvt. Ltd.", "LTD.", "Private Limited", "limited."])
def test_a_brlm_list_ending_in_any_suffix_never_overruns_into_the_footnote(suffix):
    # the reviewer's mutation: "...and 360 ONE WAM Limited." printed as "...360 ONE WAM Ltd." made
    # the row run into the footnote and read 26 names incl. two selling shareholders.
    rec = _brlm(_nse_with("and 360 ONE WAM Limited.", "and 360 ONE WAM " + suffix))
    got = rec["value"]
    if got is None:
        assert rec["state"] == answer_states.MISSED, rec
        return
    assert rec["state"] == answer_states.VALUE
    assert len(got) == 20, got
    assert not any(s in got for s in SELLING_SHAREHOLDERS), got
    assert got[18] == "360 ONE WAM " + suffix.rstrip(".") or got[18].startswith("360 ONE WAM"), got
    assert got[:18] == NSE_BRLMS[:18]
    assert got[19] == "SBI Capital Markets Limited"


def test_the_ltd_mutation_reads_the_right_list():
    rec = _brlm(_nse_with("and 360 ONE WAM Limited.", "and 360 ONE WAM Ltd."))
    assert rec["state"] == answer_states.VALUE, rec
    assert rec["value"] == NSE_BRLMS[:18] + ["360 ONE WAM Ltd.", "SBI Capital Markets Limited"]


def test_a_row_with_no_sentence_end_fails_closed_as_an_overrun():
    # no full stop after the last firm and the footnote marker gone: the row has no end
    rec = _brlm(_nse_with("and 360 ONE WAM Limited.\n*Morgan", "and 360 ONE WAM Limited and\nMorgan"))
    assert rec["value"] is None and rec["state"] == answer_states.MISSED, rec
    assert rec["check"]["detail"] == "lead_managers_row_overrun"


def test_a_duplicate_name_in_the_row_fails_closed():
    rec = _brlm(_nse_with("HDFC Bank Limited, ICICI", "HDFC Bank Limited, Axis Capital Limited, ICICI"))
    assert rec["value"] is None and rec["state"] == answer_states.MISSED, rec
    assert rec["check"]["detail"] == "lead_managers_duplicate_in_row"


def test_a_footnote_line_ends_the_row_even_without_a_full_stop():
    rec = _brlm(_nse_with("and 360 ONE WAM Limited.\n*Morgan", "and 360 ONE WAM Limited\n*Morgan"))
    assert rec["state"] == answer_states.VALUE, rec
    assert rec["value"] == NSE_BRLMS


def test_a_count_that_disagrees_with_the_cover_inm_numbers_fails_closed():
    # the cover BRLM block printing three INM numbers is a second count; 20 names disagree with it
    pages = load("nse-mainboard-rhp")
    brlm, _r = cover_block._cover_tables(pages)
    page = brlm["page"]
    first = brlm["lines"][0]
    pages = [(i, t.replace(first, first + " INM000008704 INM000010361 INM000011179", 1) if i == page else t)
             for i, t in pages]
    rec = _brlm(pages)
    assert rec["value"] is None and rec["state"] == answer_states.MISSED, rec
    assert rec["check"]["detail"] == "lead_managers_count_disagrees"


# ---- MINOR: phone forms the check refused although they are Indian numbers ---- #
@pytest.mark.parametrize("phone", ["+919823877359", "1800 309 4001", "1800-209-0444", "+91 9823877359"])
def test_real_indian_phone_forms_pass(phone):
    assert cover_block.check_indian_phone(phone)[0] is True


@pytest.mark.parametrize("phone", ["+91 22 2659 81", "12345", "1800 30", "+9198238773591234", "919823877359123"])
def test_non_phones_are_still_refused(phone):
    assert isinstance(cover_block.check_indian_phone(phone), answer_states.Refused)


# ---- MINOR: the OCR mark covers every agreeing place, not only the first ---- #
def test_every_agreeing_page_is_recorded_and_an_ocr_one_makes_the_value_mixed():
    import ocr_pages
    fields = read("nse-mainboard-rhp")
    rec = fields["registrar_name"]
    assert len(rec["pages"]) >= 2, rec
    text_page, other = rec["page"], [p for p in rec["pages"] if p != rec["page"]][0]
    ocr_pages.annotate_fields(fields, {other: 0.95})
    assert rec["value"] == "MUFG Intime India Private Limited"
    assert rec["source_text"] == "MIXED"
    fields = read("nse-mainboard-rhp")
    ocr_pages.annotate_fields(fields, {p: 0.95 for p in fields["registrar_name"]["pages"]})
    assert fields["registrar_name"]["source_text"] == "OCR"
    fields = read("nse-mainboard-rhp")
    ocr_pages.annotate_fields(fields, {})
    assert fields["registrar_name"]["source_text"] == "TEXT"
    assert text_page in fields["registrar_name"]["pages"]


def test_a_ltd_sentence_end_mid_line_cuts_the_row_before_the_footnote():
    # the footnote run onto the same line, no marker: only the sentence end can stop the row
    rec = _brlm(_nse_with("and 360 ONE WAM Limited.\n*Morgan", "and 360 ONE WAM Ltd. Morgan"))
    assert rec["state"] == answer_states.VALUE, rec
    assert rec["value"] == NSE_BRLMS[:18] + ["360 ONE WAM Ltd.", "SBI Capital Markets Limited"]


# ---- F-243: multi-column cover text (NSE DRHP) ------------------------------------------------ #
REGISTRAR_CONTACTS = ("registrar_email", "registrar_phone", "registrar_website",
                      "registrar_contact_person", "registrar_sebi_reg")
# real-text mutations on the NSE DRHP pages (0-based page index)
DIFFERENT_COVER_REGISTRAR = ("India Private Limited)\nBID", "Bigshare Services Private Limited)\nBID", 1)
NO_GI_REGISTRAR_BLOCK = ("Registrar to the Offer\nMUFG", "Registrar office\nMUFG", 91)


def _drhp_with(old, new, page=None):
    pages, hits = [], 0
    for i, t in load("nse-mainboard-drhp"):
        if page is None or i == page:
            hits += t.count(old)
            t = t.replace(old, new)
        pages.append((i, t))
    assert hits >= 1, "mutation did not apply: %r" % old
    return pages


def _read_pages(pages):
    emit = Emitter("x")
    cover_block.read_cover_block(pages, emit)
    return emit.fields


def test_a_definitions_row_split_by_a_page_break_is_read_whole():
    # p.10 ends "IIFL Capital Services Limited (formerly known as IIFL" and its page number "4";
    # p.11 opens with the column header "Term Description" and then "Securities Limited), Motilal Oswal ...".
    defs = cover_block._definition_rows(load("nse-mainboard-drhp"))
    assert "brlm_fail" not in defs, defs
    assert defs["brlm"] == (NSE_DRHP_BRLMS, 9)


def test_a_running_title_at_the_continuation_page_head_fails_closed():
    # B4(c): text at the next page's head that is neither furniture nor row text (a capitals
    # running title) means the row cannot be said to end: overrun, never a guessed list.
    pages = _drhp_with("Term Description\nSecurities Limited)",
                       "Term Description\nNATIONAL STOCK EXCHANGE OF INDIA LIMITED\nSecurities Limited)", page=10)
    rec = _read_pages(pages)["lead_managers"]
    assert rec["value"] is None and rec["state"] == answer_states.MISSED, rec
    assert rec["check"]["detail"] == "lead_managers_row_overrun"


def test_a_row_cut_by_a_missing_next_page_still_fails_closed():
    pages = [(i, t) for i, t in load("nse-mainboard-drhp") if i != 10]
    rec = _read_pages(pages)["lead_managers"]
    assert rec["value"] is None and rec["check"]["detail"] == "lead_managers_row_overrun", rec


@pytest.mark.parametrize("foot", ["\n4", ""], ids=["page-number-at-foot", "no-page-number"])
def test_a_row_ending_at_the_page_foot_on_a_bare_suffix_reads_its_continuation(foot):
    # the hole the continuation also closes: a page foot ending on a bare firm suffix ("...IIFL
    # Capital Services Limited" and nothing after it) read as the row's end (DEF_ROW_END_AT_EOT)
    # and kept a truncated list of 16
    pages = _drhp_with("Limited (formerly known as IIFL\n4", "Limited" + foot, page=9)
    pages = [(i, t.replace("Securities Limited), Motilal", "Motilal", 1) if i == 10 else t) for i, t in pages]
    rec = _read_pages(pages)["lead_managers"]
    assert rec["state"] == answer_states.VALUE, rec
    assert rec["value"] == NSE_DRHP_BRLMS


@pytest.mark.parametrize("fragment,full,want", [
    ("India Private Limited", "MUFG Intime India Private Limited", True),   # the NSE DRHP p.2 tail
    ("Intime India Private Limited", "MUFG Intime India Private Limited", True),
    ("dia Private Limited", "MUFG Intime India Private Limited", False),    # mid-word cut
    ("MUFG Intime India Private Limited", "MUFG Intime India Private Limited", False),  # not shorter
    ("Link Intime India Private Limited", "MUFG Intime India Private Limited", False),  # a different name
    ("Bigshare Services Private Limited", "MUFG Intime India Private Limited", False),
    ("MUFG Intime India", "MUFG Intime India Private Limited", False),     # a head is not a tail
])
def test_a_fragment_agrees_only_as_a_word_boundary_tail(fragment, full, want):
    assert cover_block._is_fragment_of(fragment, full) is want


def test_the_cover_registrar_cell_is_read_as_a_fragment():
    _brlm, reg = cover_block._cover_tables(load("nse-mainboard-drhp"))
    assert reg["name"] == "India Private Limited" and reg["fragment"] is True and reg["page"] == 1


def test_a_cover_that_names_a_different_registrar_still_fails_closed():
    fields = _read_pages(_drhp_with(*DIFFERENT_COVER_REGISTRAR))
    assert fields["registrar_name"]["value"] is None
    assert fields["registrar_name"]["check"]["detail"] == "registrar_sources_disagree"
    for name in REGISTRAR_CONTACTS:
        assert fields[name]["value"] is None and fields[name]["state"] == answer_states.MISSED, name


def test_a_fragment_alone_is_never_a_value():
    rec = _read_pages(_drhp_with(*NO_GI_REGISTRAR_BLOCK))["registrar_name"]
    assert rec["value"] is None and rec["state"] == answer_states.MISSED, rec
    assert rec["check"]["detail"] == "registrar_block_unresolved"


def test_mutation_without_the_fragment_rule_the_drhp_registrar_is_lost(monkeypatch):
    # the reviewer's mutation: drop the rule and the real document's registrar goes back to
    # registrar_sources_disagree, its contacts to registrar_block_not_found
    monkeypatch.setattr(cover_block, "_is_fragment_of", lambda _f, _n: False)
    fields = read("nse-mainboard-drhp")
    assert fields["registrar_name"]["check"]["detail"] == "registrar_sources_disagree"
    assert fields["registrar_email"]["check"]["detail"] == "registrar_block_not_found"


def test_mutation_without_the_page_continuation_the_drhp_brlms_are_lost(monkeypatch):
    monkeypatch.setattr(cover_block, "_continue_row", lambda *_a: None)
    rec = read("nse-mainboard-drhp")["lead_managers"]
    assert rec["value"] is None and rec["check"]["detail"] == "lead_managers_row_overrun"


def test_a_fragment_lends_no_text_support_to_an_ocr_value():
    # no OCR value outranks text: the value's pages are the full readings only, so a GI page OCR'd
    # below the floor drops the value even though the cover's text fragment agreed with it
    import ocr_pages
    fields = read("nse-mainboard-drhp")
    rec = fields["registrar_name"]
    assert rec["pages"] == [91], rec
    ocr_pages.annotate_fields(fields, {91: 0.10})
    assert rec["value"] is None and rec["state"] == answer_states.LOW_CONFIDENCE_OCR


# B4(d): every answer state of the registrar reader and what it emits, on the real NSE DRHP text.
# "stated not printed" is never emitted (asserted in every row); "unreadable" is the OCR floor above.
ANSWER_STATES = [
    ("printed value / fragment agrees", None, answer_states.VALUE, "MUFG Intime India Private Limited"),
    ("disagreement", DIFFERENT_COVER_REGISTRAR, answer_states.MISSED, "registrar_sources_disagree"),
    ("fragment alone", NO_GI_REGISTRAR_BLOCK, answer_states.MISSED, "registrar_block_unresolved"),
    ("not found", "drop", answer_states.MISSED, "registrar_not_found"),
]


@pytest.mark.parametrize("state,mutation,want_state,want", ANSWER_STATES, ids=[r[0] for r in ANSWER_STATES])
def test_registrar_answer_states(state, mutation, want_state, want):
    if mutation is None:
        pages = load("nse-mainboard-drhp")
    elif mutation == "drop":
        pages = [(i, t) for i, t in load("nse-mainboard-drhp") if i not in (1, 91)]
    else:
        pages = _drhp_with(*mutation)
    rec = _read_pages(pages)["registrar_name"]
    assert rec["state"] == want_state, rec
    assert (rec["value"] if want_state == answer_states.VALUE else rec["check"]["detail"]) == want
    assert rec["state"] != answer_states.STATED_NOT_PRINTED
    if rec["value"] is None:
        assert rec["check"]["detail"] not in answer_states.STATED_ABSENCE_REASONS


# ---- F-243: the side-by-side Definitions layout (Orient Cables DRHP p.9) ------------------------ #
# "or “BRLMs” IIFL Securities Limited) and JM Financial Limited" is followed, with no full stop, by
# the next row printed unquoted: "Broker Centres The broker centres notified by the Stock Exchanges ...".
ORIENT_ROW_END = "and JM Financial Limited\nBroker Centres"


def _orient_with(old, new):
    pages, hits = [], 0
    for i, t in load("orient-mainboard-drhp"):
        hits += t.count(old)
        pages.append((i, t.replace(old, new)))
    assert hits >= 1, "mutation did not apply: %r" % old
    return pages


def test_orient_drhp_values():
    fields = read("orient-mainboard-drhp")
    assert fields["lead_managers"]["state"] == answer_states.VALUE, fields["lead_managers"]
    assert fields["lead_managers"]["value"] == ["IIFL Capital Services Limited", "JM Financial Limited"]
    assert fields["lead_managers"]["page"] == 8
    assert fields["registrar_name"]["value"] == "KFin Technologies Limited"
    assert fields["registrar_email"]["value"] == "orient.ipo@kfintech.com"
    assert fields["registrar_phone"]["value"] == "+91 40 6716 2222"
    assert fields["registrar_website"]["value"] == "www.kfintech.com"
    assert fields["registrar_sebi_reg"]["value"] == "INR000000221"


def test_a_short_wrapped_name_line_is_not_read_as_the_next_row():
    # a name wrapped onto a short line keeps the list going: never a truncated list of two
    pages = _orient_with(ORIENT_ROW_END, "and JM Financial Limited\nJ.P. Morgan India Private\nLimited.\nBroker Centres")
    rec = _read_pages(pages)["lead_managers"]
    assert rec["state"] == answer_states.VALUE, rec
    assert rec["value"] == ["IIFL Capital Services Limited", "JM Financial Limited", "J.P. Morgan India Private Limited"]


def test_a_prose_line_naming_a_firm_does_not_end_the_row():
    # B4(c): the next line names a firm, so it is not a clean new-row line; the row runs on and fails closed
    pages = _orient_with(ORIENT_ROW_END, "and JM Financial Limited\nBroker Centres The broker centres of Axis Capital Limited where Bidders")
    rec = _read_pages(pages)["lead_managers"]
    assert rec["value"] is None and rec["state"] == answer_states.MISSED, rec


def test_mutation_without_the_unquoted_row_end_the_orient_brlms_are_lost(monkeypatch):
    monkeypatch.setattr(cover_block, "_starts_unquoted_row", lambda _p, _l: False)
    rec = read("orient-mainboard-drhp")["lead_managers"]
    assert rec["value"] is None and rec["check"]["detail"] == "lead_managers_row_overrun"
