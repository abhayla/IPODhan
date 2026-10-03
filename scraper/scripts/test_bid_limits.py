"""Appendix A rows 73-74: the maximum retail / employee bid amounts on REAL offer-document pages
(scraper/tests/fixtures/bid-limits/, each .meta.json names its document). Rupees per OD-48."""

import json
import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import answer_states  # noqa: E402
import bid_limits  # noqa: E402
from extract_filing import Emitter  # noqa: E402

FIX = os.path.join(HERE, "..", "tests", "fixtures", "bid-limits")
RET, EMP = "max_retail_subscription", "max_employee_subscription"


def load(name):
    with open(os.path.join(FIX, name + ".json"), encoding="utf-8") as fh:
        return [(int(i), t) for i, t in json.load(fh)["pages"]]


def read(pages):
    emit = Emitter("x")
    bid_limits.read_bid_limits(pages, emit)
    return emit.fields


# doc -> {field: value | None (MISSED)}
EXPECTED = {
    # "whose Bid Amount ... is not more than ₹ 0.20 million" (p.14); "shall not exceed ₹ 0.50 million" (p.10, p.13)
    "nse-mainboard-drhp": {RET: 200000, EMP: 500000},
    # the term wraps and is interleaved: "not more than Bidders” or “RIB(s)” ₹0.20 million" (p.15)
    "emcure-mainboard-drhp": {RET: 200000, EMP: 500000},
    # "₹200,000"; the next row's "not more than 10% of the Offer" is not an amount
    "ola-electric-mainboard-drhp": {RET: 200000, EMP: 500000},
    # unquoted term "Retail Individual Investors or RIIs" (p.10); no employee reservation
    "studds-mainboard-drhp": {RET: 200000, EMP: None},
    # "not" printed on the line above the term column, "more than" below it: the phrase is broken
    # by the term column, so it is not read (fail closed)
    "water-infra-mainboard-drhp": {RET: None, EMP: None},
    # SME, side-by-side unquoted row "... which is Bidder(s) or not more than ₹ 200,000/-": not a
    # Definitions row this reader recognises; MISSED, never guessed
    "rkfal-sme-drhp": {RET: None, EMP: None},
}


@pytest.mark.parametrize("doc,field", [(d, f) for d, fs in EXPECTED.items() for f in fs])
def test_real_documents(doc, field):
    got = read(load(doc))[field]
    want = EXPECTED[doc][field]
    if want is None:
        assert got["value"] is None and got["state"] == answer_states.MISSED, got
        assert got["check"]["detail"] not in answer_states.STATED_ABSENCE_REASONS
    else:
        assert got["state"] == answer_states.VALUE and got["value"] == want, got


def test_two_different_amounts_fail_closed():
    # p.12 only: p.10 keeps 0.50 million, so the two readings now disagree
    pages = [(i, t.replace("shall not\nexceed ₹ 0.50 million", "shall not\nexceed ₹ 0.40 million", 1) if i == 11 else t)
             for i, t in load("nse-mainboard-drhp")]
    got = read(pages)[EMP]
    assert got["state"] == answer_states.MISSED and got["check"]["detail"] == "max_employee_subscription_sources_disagree"


def test_an_amount_outside_the_regulatory_range_is_refused():
    pages = [(i, t.replace("not more than ₹ 0.20 million", "not more than ₹ 20 million")) for i, t in load("nse-mainboard-drhp")]
    got = read(pages)[RET]
    assert got["state"] == answer_states.REFUSED and got["refused_value"] == 20000000


@pytest.mark.parametrize("number,unit,want", [
    ("0.20", "million", 200000), ("2,00,000", None, 200000), ("200,000", None, 200000),
    ("2", "lakhs", 200000), ("0.50", "million", 500000), ("10", None, None),
])
def test_rupee_conversion(number, unit, want):
    assert bid_limits.rupees(number, unit) == want


def test_a_percentage_is_never_an_amount():
    # Ola p.12, the "Retail Portion" row inside the RIB row's window: "not more than 10% of the Offer"
    assert bid_limits.RIB_CAP.search("not more than 10% of the Offer consisting of up to") is None
    assert bid_limits.RIB_CAP.search("for an amount not more than ₹200,000 in any").group(1) == "200,000"


def test_mutation_without_the_required_rupee_mark_a_percentage_is_read(monkeypatch):
    loose = r"(?:Rs\.?|INR|₹|`)?\s*"
    amount = loose + r"(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)\s*(million|mn|lakhs?|lacs?|crores?)?\b"
    monkeypatch.setattr(bid_limits, "RIB_CAP", bid_limits.re.compile(
        r"\bnot\s+more\s+than\s+[^\d₹`.;%]{0,45}?" + amount, bid_limits.re.I))
    got = read([(0, "“RIB(s)” The portion being not more than 10% of the Offer")])[RET]
    # without the rupee mark "10" is taken for an amount (bare small number -> disagreement), not a miss
    assert got["check"]["detail"] != "max_retail_subscription_not_found"


def test_mutation_without_the_interleave_allowance_emcure_is_lost(monkeypatch):
    monkeypatch.setattr(bid_limits, "RIB_CAP", bid_limits.re.compile(r"\bnot\s+more\s+than\s+" + bid_limits.AMOUNT.pattern, bid_limits.re.I))
    assert read(load("emcure-mainboard-drhp"))[RET]["value"] is None
