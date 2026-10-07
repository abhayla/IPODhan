"""financial_labels (OD-173 step 3, OD-172) on row labels printed in REAL stored DRHPs.

Labels are taken from the grids of scraper/tests/fixtures/offer-doc-financials/<doc>.json at test time (never typed),
then judged by the ONE dictionary every reader and the unread-table guard use.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import financial_labels as L  # noqa: E402
import offer_doc_financials as F  # noqa: E402
import section_locator  # noqa: E402
import statement_grid as G  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "offer-doc-financials")


def labels(doc):
    with open(os.path.join(FIX, doc + ".json"), encoding="utf-8") as fh:
        fx = json.load(fh)
    gw = {int(k): {"width": v["width"], "words": [dict(zip(G.WORD_KEYS, w)) for w in v["words"]]}
          for k, v in fx["grid_words"].items()}
    pt = F.dense_pages(fx["page_texts"])
    loc = section_locator.locate(pt)
    out = []
    for p in G.read_section_grids(pt, loc["other"], gw.get, set())["pages"]:
        out += [r["label"] for g in p["grids"] for r in g.get("rows", [])]
    st = G.read_statement_grids(pt, section_locator.restated_start(loc), gw.get, set())["statements"]
    out += [r["label"] for s in st.values() for g in s.get("grids", []) for r in g.get("rows", [])]
    return out


def judged(doc, field, pattern, fields=L.FIELDS_3B):
    found = [lab for lab in labels(doc) if re.search(pattern, lab, re.I)]
    assert found, "no printed label matching %r in %s" % (pattern, doc)
    return {lab: L.accept_label(fields[field], lab) for lab in found}


def test_ebitda_percent_and_margin_rows_are_never_ebitda():
    """OD-172: 'EBITDA %' / 'EBITDA margin' rows are labels of EBITDA's shape that the dictionary refuses."""
    got = judged("elevate-campuses-ltd-DRHP", "ebitda", r"ebitda")
    refused = [lab for lab, (tier, why) in got.items() if why]
    plain = [lab for lab, (tier, why) in got.items() if tier == 0 and why is None]
    assert plain, got
    assert refused and all(re.search(r"%|margin", lab, re.I) for lab in refused), got


def test_return_on_net_worth_row_is_not_net_worth():
    got = judged("national-stock-exchange-of-india-ltd-DRHP", "net_worth", r"net\s*worth")
    for lab, (tier, why) in got.items():
        if re.search(r"return", lab, re.I):
            assert tier is None or why, (lab, tier, why)
    assert any(t == 0 and w is None for t, w in got.values()), got


def test_total_comprehensive_income_is_not_pat():
    got = judged("karamtara-engineering-ltd-DRHP", "profit", r"profit|comprehensive", fields=L.FIELDS)
    for lab in got:
        tier, _ = got[lab]
        if re.search(r"comprehensive|before tax|attributable", lab, re.I):
            assert re.search(L.FIELDS["profit"]["refuse"], L.raw_lower(lab)) or tier is None, lab


def test_norm_strips_roman_numerals_and_formulas():
    assert L.norm("XI Restated profit for the year (IX-X)") == "restated profit for the year"
    assert L.norm3("EBITDA1")[0] == "ebitda"
    assert L.norm3("EBITDA (%)")[1] is True


def test_classify_reads_statement_kind_from_row_labels():
    rows = [{"label": lab} for lab in labels("national-stock-exchange-of-india-ltd-DRHP")]
    assert L.classify([r for r in rows if re.search(r"revenue from|total income|other income|tax expense",
                                                    r["label"], re.I)])[0] == "pl"
