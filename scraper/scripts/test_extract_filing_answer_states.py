"""#1420 step 1 / F-219: every field record says WHICH answer the reader gave.

Spec: data-sourcing-pull-model.md section 6, rule 4 (answer-state table, OD-153,
OD-158). A stored value is cleared on REFUSED and STATED_NOT_PRINTED and kept on
MISSED and LOW_CONFIDENCE_OCR, so the envelope must tell them apart. Before this
change a missed label and a refused value were both `value: None` and the ratio
reader sent both out as PASSING nulls (F-219).

Every document below is a committed capture of a real filing; where a test adds
anything to it, the docstring says what and why.
"""

import inspect
import io
import json
import os

import pytest

import answer_states
import extract_filing
import financial_ratios
from extract_filing import run

HERE = os.path.dirname(__file__)
RATIO_FIXTURES = os.path.join(HERE, "..", "tests", "fixtures", "financial-ratios")
EXTRACTOR_FIXTURES = os.path.join(HERE, "..", "tests", "fixtures", "extractor")


def ratio_pages(name):
    with io.open(os.path.join(RATIO_FIXTURES, name), encoding="utf-8") as handle:
        raw = handle.read()
    out = []
    for chunk in raw.split("<<<PAGE "):
        if not chunk.strip():
            continue
        head, _, body = chunk.partition(">>>")
        out.append((int(head.strip()), body))
    return out


def json_pages(name):
    with io.open(os.path.join(EXTRACTOR_FIXTURES, name), encoding="utf-8") as handle:
        return [(int(i), t) for i, t in json.load(handle)]


def _statement_years(monkeypatch, years, basis_header=None):
    """The ratio fixtures carry only the ratio note, so the P&L core's fiscal
    years (and, when given, its basis header) are pinned - the same device
    test_extract_filing_ratio_wiring.py uses."""
    real = extract_filing.extract_pnl_from_texts

    def fake(page_texts, **kwargs):
        out = real(page_texts, **kwargs)
        out["annualYears"] = list(years)
        if basis_header is not None:
            out["pnlPage"] = 9999
        return out

    monkeypatch.setattr(extract_filing, "extract_pnl_from_texts", fake)
    return [(9999, basis_header)] if basis_header is not None else []


# ------------------------------------------------------------------ the core
# (a) VALUE after the split-label fix. German Green RHP page 440 prints
#     "Inventory Turnover <reason prose>" / "5 Total Revenue from Customers
#     Traded Inventories 5.63 6.02 8.85 -6.41% (31.97)%" / "Ratio <prose>".


def test_german_green_inventory_turnover_reads_through_the_wrapped_label():
    got = financial_ratios.read_ratio(
        ratio_pages("german-green-steel-ratio-analysis.txt"), "inventory_turnover", (2026, 3, 31))
    assert got.get("value") == 5.63, got
    assert got["period"] == "2026-03-31" and got["page"] == 440, got


def test_german_green_inventory_turnover_is_emitted_as_value(monkeypatch):
    extra = _statement_years(monkeypatch, [2026, 2025, 2024])
    env = run(ratio_pages("german-green-steel-ratio-analysis.txt") + extra, "RHP", "gg.txt")
    got = env["fields"]["inventory_turnover"]
    assert (got["state"], got["value"], got["check"]["passed"]) == ("VALUE", 5.63, True), got
    assert env["fields"]["current_ratio"]["state"] == "VALUE", env["fields"]["current_ratio"]


# (b) MISSED: Studds prints its ratio note with a vertical period header the
#     reader cannot read (ratio_period_headings_unreadable). A miss, never a
#     refusal: nothing was identified as the latest period's value.


def test_studds_unreadable_header_is_missed(monkeypatch):
    extra = _statement_years(monkeypatch, [2025, 2024, 2023])
    env = run(ratio_pages("studds-analytical-ratios.txt") + extra, "RHP", "studds.txt")
    got = env["fields"]["current_ratio"]
    assert got["state"] == "MISSED", got
    assert got["check"]["detail"] == "ratio_period_headings_unreadable", got
    assert "refused_value" not in got, got


def test_no_ratio_note_is_missed_not_a_passing_null():
    env = run([(1, "This page carries no financial ratio note at all.")], "RHP", "empty.txt")
    for name in ("current_ratio", "inventory_turnover"):
        assert env["fields"][name]["state"] == "MISSED", env["fields"][name]


# (c) REFUSED: Prasol's real ratio page prints FY 25-26 as Standalone. The
#     statement-basis header line is ADDED by the test (the fixture carries only
#     the note), exactly as test_extract_filing_ratio_wiring.py does: against a
#     consolidated P&L the reader refuses the 1.54 it read.


def test_prasol_basis_mismatch_is_refused_and_carries_the_refused_value(monkeypatch):
    extra = _statement_years(monkeypatch, [2026, 2025],
                             "Restated Consolidated Statement of Profit and Loss")
    env = run(ratio_pages("prasol-financial-ratios.txt") + extra, "RHP", "prasol.txt")
    got = env["fields"]["current_ratio"]
    assert got["state"] == "REFUSED", got
    assert got["refused_value"] == 1.54, got
    assert got["value"] is None and got["check"]["passed"] is False, got
    # Today's reason string is kept verbatim: scripts/lib/ratio-yield-verdict.mjs
    # matches it exactly against RATIO_REFUSALS.
    assert got["check"]["detail"] == "ratio_basis_differs_from_statement", got


# (d) STATED_NOT_PRINTED: Deepa's price band ad prints "Last three years ...
#     Not Applicable" in the WACA table (reason on the shared allow-list).


def test_deepa_not_applicable_is_stated_not_printed():
    env = run(json_pages("deepa-price-band-ad-pages.json"), "PRICE_BAND_AD", "deepa-ad")
    for name in ("waca_last_3y", "cap_multiple_last_3y"):
        got = env["fields"][name]
        assert got["state"] == "STATED_NOT_PRINTED", got
        assert got["check"]["detail"] == "not_applicable_no_qualifying_transaction", got


def test_a_reason_off_the_allow_list_is_missed_even_when_it_says_not_in_document():
    """`peer_comparison_table_not_in_document` is emitted when NO peer row was
    parsed - a pattern miss. A stated absence is only what the list names."""
    assert answer_states.null_state("peer_comparison_table_not_in_document") == "MISSED"
    assert answer_states.null_state("ratio_note_not_in_document") == "MISSED"
    assert answer_states.null_state("not_applicable_no_qualifying_transaction") == "STATED_NOT_PRINTED"


# ------------------------------------------------------- the whole contract


def test_every_field_of_a_real_document_carries_a_known_state():
    env = run(json_pages("deepa-rhp-pages.json"), "RHP", "deepa-rhp")
    assert env["fields"], "no fields emitted"
    states = {name: f.get("state") for name, f in env["fields"].items()}
    unknown = {n: s for n, s in states.items() if s not in answer_states.ALL_STATES}
    assert not unknown, unknown
    for name, f in env["fields"].items():
        if f["state"] == "VALUE":
            assert f["value"] is not None and f["check"]["passed"] is True, (name, f)
        else:
            assert f["value"] is None, (name, f)
        if f["state"] == "REFUSED":
            assert f.get("refused_value") is not None, (name, f)


def _check_functions():
    return [(n, f) for n, f in inspect.getmembers(extract_filing, inspect.isfunction)
            if n.startswith("check_") and f.__module__ == "extract_filing"]


def test_the_check_function_set_is_enumerated_not_assumed():
    assert len(_check_functions()) >= 30, [n for n, _f in _check_functions()]


@pytest.mark.parametrize("name,fn", _check_functions(), ids=[n for n, _f in _check_functions()])
def test_every_check_function_given_no_inputs_answers_missed(name, fn):
    """An absent input is a MISS, not a failed check: a failed check with a
    value is a REFUSAL, and OD-153 clears a stored value on a refusal."""
    params = [p for p in inspect.signature(fn).parameters.values()
              if p.default is inspect.Parameter.empty]
    result = fn(*[None] * len(params))
    assert answer_states.check_state(123.0, result) == "MISSED", (name, result)
    assert result[0] is not True, (name, result)


def test_a_failed_check_on_a_present_value_is_refused():
    result = extract_filing.check_price_band(500.0, 900.0)
    assert result[0] is False
    assert answer_states.check_state(500.0, result) == "REFUSED"


# --------------------------------------------------------------------- OCR


def test_a_field_on_a_low_confidence_ocr_page_is_low_confidence_ocr():
    from ocr_pages import annotate_fields
    fields = {"lot_size": {"value": 25.0, "page": 3, "state": "VALUE",
                           "check": {"name": "x", "passed": True, "detail": "25"}},
              "face_value": {"value": 10.0, "page": 4, "state": "VALUE",
                             "check": {"name": "x", "passed": True, "detail": "10"}}}
    out = annotate_fields(fields, {3: 0.41, 4: 0.97}, floor=0.80)
    assert out["lot_size"]["state"] == "LOW_CONFIDENCE_OCR", out["lot_size"]
    assert out["lot_size"]["value"] is None
    assert out["face_value"]["state"] == "VALUE", out["face_value"]


# ----------------------------------------------------------- the shared list


def test_the_allow_list_is_the_shared_json_file():
    path = os.path.join(HERE, "..", "src", "config", "stated-absence-reasons.json")
    with io.open(path, encoding="utf-8") as handle:
        listed = {e["reason"] for e in json.load(handle)["reasons"]}
    assert answer_states.STATED_ABSENCE_REASONS == listed
    assert listed, "an empty allow-list turns every stated absence into a miss"


def test_a_combined_check_keeps_an_absent_input_a_miss():
    """`_combine` chains checks (cover price, issue size); the first failure it
    returns must still say MISSED when that failure was an absent input."""
    combined = extract_filing._combine(extract_filing.check_cover_price(None), (True, "x"))
    assert combined == (False, "price not printed on the cover")
    assert answer_states.check_state(250.0, combined) == "MISSED"
    refused = extract_filing._combine((True, "x"), extract_filing.check_price_band(500.0, 900.0))
    assert answer_states.check_state(500.0, refused) == "REFUSED"


def test_an_inline_check_that_fails_on_a_value_never_read_is_missed():
    """Many fields carry an inline check over their own value, e.g.
    promoter_waca: (waca is not None and waca > 0, "%s" % waca). With nothing
    read it fails, but there is no value to refuse: MISSED, never REFUSED."""
    emit = extract_filing.Emitter("doc")
    emit.put("promoter_waca", None, 7, "promoter_waca_positive", (False, "None"))
    got = emit.fields["promoter_waca"]
    assert got["state"] == "MISSED" and "refused_value" not in got, got
    emit.put("promoter_waca", -3.0, 7, "promoter_waca_positive", (False, "-3.0"))
    got = emit.fields["promoter_waca"]
    assert got["state"] == "REFUSED" and got["refused_value"] == -3.0, got
