"""general_information + page_furniture (OD-173 section 3, GI attempt 4) on REAL pages.

Fixtures: scraper/tests/fixtures/offer-doc-general-information/<doc>.json (see each .meta.json): page texts and
statement_grid.grid_words() of stored DRHPs; the cover, contents and General Information pages in full, every other
page as its edge lines (what the furniture learner and the page-number offset read). A fixture reads exactly as the
whole document does (asserted when it was built). Ported from the proven spike's table test, block tests and one
mutation per normalisation step (claude-doc/rebuild-gi/test_lines.py, mutate_r3.py).
"""
import json
import os
import re
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import extract_filing as ef  # noqa: E402
import general_information as gi  # noqa: E402
import page_furniture as pf  # noqa: E402
from offer_doc_financials import dense_pages  # noqa: E402
from statement_grid import WORD_KEYS, lines_of  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "offer-doc-general-information")
_CACHE = {}


def load(doc):
    if doc not in _CACHE:
        with open(os.path.join(FIX, doc + "-DRHP.json"), encoding="utf-8") as fh:
            fx = json.load(fh)
        gw = {int(k): {"width": v["width"], "words": [dict(zip(WORD_KEYS, w)) for w in v["words"]]}
              for k, v in fx["grid_words"].items()}
        _CACHE[doc] = (dense_pages(fx["page_texts"]), gw)
    return _CACHE[doc]


def read(doc):
    pages, gw = load(doc)
    return gi.read_general_information(pages, gw.get)


def section_words(doc):
    """the section's pages as the reader sees them (furniture removed unless CLEAN_INPUT is off)."""
    pages, gw = load(doc)
    sec = gi.locate_section(pages)
    want = range(sec["idx"], min(sec["end"], sec["idx"] + gi.SECTION_PAGES))
    if not gi.CLEAN_INPUT:
        return {i: gw[i] for i in want}
    m = pf.model_for(pages)
    return {i: pf.clean_grid_page(m, gw[i], i)[0] for i in want}


def cover_cells(doc):
    pages, gw = load(doc)
    m = pf.model_for(pages) if gi.CLEAN_INPUT else None
    cover = {i: (pf.clean_grid_page(m, gw[i], i)[0] if m else gw[i]) for i in gi.cover_page_indices(pages)}
    return gi.cover_cells(cover)


def printed_lines(doc):
    _, gw = load(doc)
    out = []
    for i, pw in gw.items():
        band = dict(kind="firm", lines=[(i, ws) for ws in gi.page_lines(pw)])
        out += [ln["text"] for ln in lines_of(pw["words"])]
        out += [ln["text"] for s in gi.column_streams(band)[1] for ln in s]
    return out


# (doc, line as printed, ctx, expected class, expected normalised name, step it exercises)
ROWS = [
    ("srit-india-ltd", "Name: Kfin Technologies Limited", {}, "entity_name", "Kfin Technologies Limited", "label prefix"),
    ("symbiotec-pharmalab-ltd", "The address and certain other details of our Registered", {}, "prose", None, "prose"),
    ("elevate-campuses-ltd", "Elevate Campuses Limited (formerly known as Good Host Spaces Limited)", {}, "entity_name",
     "Elevate Campuses Limited", "alias same line"),
    ("national-stock-exchange-of-india-ltd", "Equirus Capital Limited (formerly known as Equirus", {}, "entity_name",
     "Equirus Capital Limited", "alias wrapped (open)"),
    ("national-stock-exchange-of-india-ltd", "Capital Private Limited)", {"alias_open": True}, "alias_continuation", None,
     "alias wrapped (tail)"),
    ("national-stock-exchange-of-india-ltd", "360 ONE WAM Limited**", {}, "entity_name", "360 ONE WAM Limited",
     "digits in entity + marks"),
    ("symbiotec-pharmalab-ltd", "Nomura Financial Advisory and Securities (India)", {"next": "Private Limited"},
     "entity_name", "Nomura Financial Advisory and Securities (India) Private Limited", "wrapped name with (India)"),
    ("symbiotec-pharmalab-ltd", "Motilal Oswal Investment Advisors Limited^", {}, "entity_name",
     "Motilal Oswal Investment Advisors Limited", "footnote mark"),
    ("symbiotec-pharmalab-ltd", "/index.html", {"last_label": "website"}, "footnote_or_link_continuation", None,
     "link tail"),
    ("national-stock-exchange-of-india-ltd", "Smt. Prajakta Powle", {"expect_person": True}, "contact", None, "person"),
    ("national-stock-exchange-of-india-ltd", "National Stock Exchange of India Limited", {}, "entity_name",
     "National Stock Exchange of India Limited", "organisation after person"),
    ("elevate-campuses-ltd", "Lower Parel, Mumbai 400 013,", {}, "address", None, "address"),
    ("hero-motors-ltd", "Hero Nagar,", {}, "address", None, "address without a name line"),
    ("national-stock-exchange-of-india-ltd", "*Morgan Stanley India Company Private Limited, SBI Capital Markets", {},
     "footnote_or_link_continuation", None, "footnote"),
    ("tempsens-instruments-india-ltd", "Tel: +91 22 4336 0000", {}, "label", None, "label"),
    ("a-one-steels-india-ltd", "(formerly known as A-One Steels India Private Limited", {}, "alias_continuation", None,
     "alias-only line"),
]
PIN_ROWS = [  # (doc, printed line prefix, expected PIN)
    ("hero-motors-ltd", "Bandra (East), Mumbai 400-051", "400051"),
    ("orient-cables-india-ltd", "Maharashtra, India 400 070", "400070"),
    ("orient-cables-india-ltd", "Gurugram, Haryana – 1220 03, India", "122003"),
]
CONTACT_ROWS = [  # real pairs: A-One p86/p88, Jio cover, NSE cover, Karamtara GI
    ("Ashwinikumar Chavan", "Purva Kanabar", "Ashwinikumar Chavan / Purva Kanabar"),
    ("Vidit Jain /", "Rishank Chheda", "Vidit Jain / Rishank Chheda"),
    ("Gaurav", "Khandelwal / Souradeep Ghosh", "Gaurav Khandelwal / Souradeep Ghosh"),
    ("Harsh Thakkar/", "Tayal", None),
    ("Ashwani Kumar", "Sharma", None),
]


def table_failures():
    """the whole table test; [] when every row passes (the mutation tests expect a non-empty list)."""
    fails = []
    for doc, prefix, ctx, want, want_name, step in ROWS:
        lines = printed_lines(doc)
        hit = next((t for t in lines if t.strip() == prefix), None) or \
            next((t for t in lines if t.strip().startswith(prefix)), None)
        if hit is None:
            fails.append("[%s] fixture not printed in %s: %r" % (step, doc, prefix))
            continue
        text = prefix if want_name or ctx.get("next") or ctx.get("alias_open") else hit
        cls, info = gi.classify(text, ctx)
        if cls != want or (want_name and info.get("name") != want_name):
            fails.append("[%s] %r: got %s %r" % (step, prefix, cls, info.get("name")))
    for doc, prefix, pin in PIN_ROWS:
        if not any(prefix in t for t in printed_lines(doc)):
            fails.append("[pin] fixture not printed in %s: %r" % (doc, prefix))
        elif pin not in gi.pins(prefix):
            fails.append("[pin] %r: got %s" % (prefix, gi.pins(prefix)))
    for doc, bad_start, step in (("elevate-campuses-ltd", "Elevate", "alias"),
                                 ("a-one-steels-india-ltd", "(formerly", "alias-only line")):
        band = next(b for b in gi.bands(section_words(doc)) if b["kind"] == "regoff")
        blk = next(bl for s in gi.column_streams(band)[1] for bl in gi.blocks(s, "office") if gi.address_of(bl))
        a = ", ".join(gi.address_of(blk))
        if a.startswith(bad_start) or not gi.pins(a):
            fails.append("[%s] %s address reader: %r" % (step, doc, a[:70]))
    for prev, nxt, want in CONTACT_ROWS:
        st = [dict(page=0, text="Contact Person: " + prev, overrun=False), dict(page=0, text=nxt, overrun=False)]
        lab = gi.blocks(st, "firm")[0]["labels"][0]
        got = None if lab.get("refused") else lab["value"]
        if got != want:
            fails.append("[contact] %r + %r: got %r" % (prev, nxt, got))
    left = [ln["text"] for b in gi.bands(section_words("a-one-steels-india-ltd")) for s in gi.column_streams(b)[1]
            for ln in s if re.search(r"\d+\s*\|\s*P a g e", ln["text"])]
    if left:
        fails.append("[furniture] footer lines reach the classifier: %s" % left[:3])
    names = [x["name"] for x in read("a-one-steels-india-ltd")["fields"].get("brlm_rows", [])]
    if names != ["PL Capital Markets Private Limited", "Khambatta Securities Limited"]:
        fails.append("[furniture] A-One BRLM names: %s" % names)
    r = read("karamtara-engineering-ltd")
    if "IIFL Capital Services Limited" not in (r["fields"].get("lead_managers") or []):
        fails.append("[alias across columns] Karamtara IIFL block lost: %s" % r["log"][:3])
    cps = gi.cover_copies(cover_cells("tempsens-instruments-india-ltd"), "KFin Technologies Limited", "phone")
    if any(gi.phone_numbers(c)[:1] == ["2268077100"] for c in cps) or not cps:
        fails.append("[cover cells] Tempsens KFin copies: %s" % cps)
    nom = next((x for x in read("symbiotec-pharmalab-ltd")["fields"].get("brlm_rows", [])
                if x["name"].startswith("Nomura")), {})
    if not (nom.get("contact_person") and nom.get("sebi_reg_no")):
        fails.append("[link tail] Symbiotec Nomura lost contact / SEBI no.: %s" % nom)
    return fails


def test_every_line_shape_block_and_page_row_passes():
    assert table_failures() == []


FLAGS = ["STRIP_ALIAS", "STRIP_MARKS", "STRIP_LABEL_PREFIX", "ENTITY_DIGITS", "JOIN_WRAPPED_NAME", "SKIP_PROSE",
         "PIN_TOLERANT", "LINK_CONTINUATION", "COVER_CELLS", "CLEAN_INPUT", "ALIAS_ONLY_LINE", "CONTACT_SPLIT"]


@pytest.mark.parametrize("flag", FLAGS)
def test_switching_off_a_normalisation_step_turns_the_table_red(monkeypatch, flag):
    monkeypatch.setattr(gi, flag, False)
    assert table_failures(), "%s off and every row still passes: the step is untested" % flag


# ---------- whole-section reads (real documents) ----------
def test_label_prefix_never_kept_in_a_registrar_name():
    # SRIT GI p103: "Name: Kfin Technologies Limited"
    r = read("srit-india-ltd")
    assert r["fields"]["registrar"]["name"] == "Kfin Technologies Limited"


def test_nse_reads_all_twenty_brlms_with_their_contacts():
    r = read("national-stock-exchange-of-india-ltd")
    rows = {x["name"]: x for x in r["fields"]["brlm_rows"]}
    assert len(r["fields"]["lead_managers"]) == 20
    assert "360 ONE WAM Limited" in rows and "Equirus Capital Limited" in rows
    assert all(x["sebi_reg_no"] and x["sebi_reg_no"].startswith("INM") for x in rows.values())
    assert rows["JM Financial Limited"]["grievance_email"] == "grievance.ibd@jmfl.com"
    assert r["fields"]["registrar"]["grievance_email"] == "nse.ipo@in.mpms.mufg.com"


def test_a_block_out_of_grammar_refuses_the_list_but_keeps_its_rows_apart():
    # Elevate: a BRLM block is not confirmed -> no lead_managers, the readable rows stay per firm
    r = read("elevate-campuses-ltd")
    assert "lead_managers" not in r["fields"]
    assert any("lead_managers: refused" in x for x in r["log"])


def test_no_word_positions_reads_nothing():
    pages, _ = load("srit-india-ltd")
    r = gi.read_general_information(pages, None)
    assert r["reason"] == "general_information_no_word_positions" and r["fields"] == {}


def test_a_section_page_read_by_ocr_is_refused():
    pages, gw = load("srit-india-ltd")
    sec = gi.locate_section(pages)
    r = gi.read_general_information(pages, gw.get, ocr_pages={sec["idx"]})
    assert r["reason"].startswith("general_information_page_is_ocr") and r["fields"] == {}


# ---------- page furniture ----------
def test_a_one_spaced_page_footer_is_learned_and_removed():
    pages, gw = load("a-one-steels-india-ltd")
    m = pf.model_for(pages)
    assert any(e["kind"] == "counter" and "page" in e["key"] for e in m.evidence)
    sec = gi.locate_section(pages)
    removed = 0
    for i in range(sec["idx"], sec["end"]):
        page, n = pf.clean_grid_page(m, gw[i], i)
        removed += n
        assert not any(re.search(r"\d+\s*\|\s*P a g e", ln["text"]) for ln in lines_of(page["words"]))
    assert removed >= sec["end"] - sec["idx"]


def test_a_line_printed_once_is_never_furniture():
    pages = [(i, "Body line %d\nSome content" % i) for i in range(10)] + [(10, "A heading only here\nText")]
    m = pf.learn([(i, pf.page_lines(t)) for i, t in pages], lambda ex: True)
    assert pf.strip_lines(m, ["A heading only here", "Text"], 10)[1] == []


def test_page_number_counter_tracks_the_page_index():
    pages = [(i, "Content %s\nmore\n%d" % ("abc"[i % 3], i + 4)) for i in range(12)]
    m = pf.learn([(i, pf.page_lines(t)) for i, t in pages], lambda ex: False)
    kept, removed = pf.strip_lines(m, pf.page_lines(pages[5][1]), 5)
    assert [r[1] for r in removed] == ["counter"] and kept == ["Content c", "more"]


# ---------- the extractor's wiring ----------
def run_doc(doc, with_words=True):
    pages, gw = load(doc)
    return ef.run(pages, "DRHP", doc + ".pdf", grid_words_for_page=gw.get if with_words else None)["fields"]


def test_extractor_emits_the_rebuilt_brlm_fields():
    f = run_doc("symbiotec-pharmalab-ltd")
    lm = f["lead_managers"]["value"]
    assert lm[-1] == "Nomura Financial Advisory and Securities (India) Private Limited" and len(lm) == 4
    rows = {r["name"]: r for r in f["brlm_contacts"]["value"]}
    assert set(rows) == set(lm)
    assert set(f["brlm_grievance_emails"]["value"]) <= set(lm)
    assert f["registrar_grievance_email"]["value"] == "symbiotecpharmalab.ipo@in.mpms.mufg.com"
    assert "lead_manager_sebi_reg" not in f      # four BRLMs: no single registration number


def test_extractor_one_brlm_carries_its_own_registration_number():
    f = run_doc("srit-india-ltd")
    assert f["lead_managers"]["value"] == ["Choice Capital Advisors Private Limited"]
    reg = f["lead_manager_sebi_reg"]["value"]
    assert reg == f["brlm_contacts"]["value"][0]["sebi_reg_no"] and re.fullmatch(r"INM\d{9}", reg)


def test_extractor_without_word_positions_answers_null_never_today_s_reader():
    f = run_doc("srit-india-ltd", with_words=False)
    for n in ("lead_managers", "brlm_grievance_emails", "brlm_contacts", "registrar_grievance_email"):
        assert f[n]["value"] is None and f[n]["check"]["detail"] == "general_information_no_word_positions"


def test_extractor_keeps_today_s_registrar_and_officer_fields():
    with_words, without = run_doc("hero-motors-ltd"), run_doc("hero-motors-ltd", with_words=False)
    for n in ("registrar_name", "registrar_sebi_reg", "registrar_contact_person", "registrar_website",
              "registrar_phone", "registrar_email", "compliance_officer", "company_phone", "company_address"):
        assert with_words.get(n) == without.get(n), n
