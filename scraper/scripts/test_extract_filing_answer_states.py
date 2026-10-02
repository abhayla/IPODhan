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


# (d) Per-cell answers. Deepa's price band ad prints "Last three years 0.00(1)
#     (2) Not Applicable Nil(3) - 80.00(1)" under the columns WACA | cap price is
#     x times the WACA | lowest - highest price. Only the multiple's OWN cell
#     reads Not Applicable; the WACA cell prints 0.00. Round 1 nulled both as
#     stated absences because the phrase appeared somewhere on the row, so
#     OD-158 would have CLEARED a stored WACA the document actually prints.


def test_deepa_last_three_years_reads_each_field_from_its_own_cell():
    env = run(json_pages("deepa-price-band-ad-pages.json"), "PRICE_BAND_AD", "deepa-ad")
    waca = env["fields"]["waca_last_3y"]
    assert (waca["state"], waca["value"]) == ("VALUE", 0.0), waca
    mult = env["fields"]["cap_multiple_last_3y"]
    assert mult["state"] == "STATED_NOT_PRINTED", mult
    assert mult["check"]["detail"] == "not_applicable_no_qualifying_transaction", mult


def test_the_waca_row_splits_into_cells_with_footnotes_dropped():
    """Deepa's real rows, verbatim from the fixture (page 1, lines 58 and 72)."""
    cells = extract_filing._waca_row_cells
    assert cells("0.00(1) (2) Not Applicable Nil(3) – 80.00(1)") == [
        ("NUM", 0.0), ("NA", None), ("NIL", None), ("NUM", 80.0)]
    assert cells("preceding Nil(3) Not Applicable Nil(3) – Nil(3)") == [
        ("NIL", None), ("NA", None), ("NIL", None), ("NIL", None)]


def test_bonus_nil_is_read_only_from_the_promoter_rows_one_year_cell():
    """waca_last_1y is a stated absence only when the promoter row's own
    last-one-year cell - the cell after shares and WACA (T-430 layout "name
    shares waca nil") - reads Nil. The first row is Deepa's real promoter line
    (page 1 line 101) without the first name; a Nil in any other cell is not a
    statement about the one-year WACA."""
    says = extract_filing._promoter_row_says_bonus_nil
    assert says("Agarwal 40,005,000 0.50", "Agarwal") is False
    assert says("Agarwal 40,005,000 0.50 Nil", "Agarwal") is True
    assert says("Agarwal 40,005,000 0.50 1.25 Nil", "Agarwal") is False
    assert says("Agarwal Nil 40,005,000 0.50", "Agarwal") is False


# (e) A failed check is REFUSED only when it says so. Deepa's ad with its
#     "Offer for Sales 11,848,340 1,990.52 ..." row REMOVED (the test drops that
#     one line; everything else is the real capture): the OFS amount was never
#     read, so issue_structure cannot be judged. Round 1 emitted REFUSED with
#     refused_value FRESH_AND_OFS, which OD-153 would act on as a refusal.


def test_an_unread_ofs_row_leaves_issue_structure_missed_not_refused():
    pages = [(i, "\n".join(l for l in t.split("\n") if not l.startswith("Offer for Sales")))
             for i, t in json_pages("deepa-price-band-ad-pages.json")]
    env = run(pages, "PRICE_BAND_AD", "deepa-ad-no-ofs-row")
    got = env["fields"]["issue_structure"]
    assert got["state"] == "MISSED", got
    assert "refused_value" not in got, got
    full = run(json_pages("deepa-price-band-ad-pages.json"), "PRICE_BAND_AD", "deepa-ad")
    assert full["fields"]["issue_structure"]["state"] == "VALUE", full["fields"]["issue_structure"]


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


def test_a_refusal_read_off_a_low_confidence_ocr_page_is_low_confidence_ocr():
    """#1420 round 3 (OD-158): a refusal is only as good as the page it was read
    from. Emitter.refuse keeps the page, so annotate_fields sees it and a refusal
    off a page under the floor is LOW_CONFIDENCE_OCR (the stored value is kept),
    never REFUSED (which would clear it)."""
    from ocr_pages import annotate_fields
    em = extract_filing.Emitter("RHP")
    em.refuse("pe_at_cap", 99.0, 3, "pe_basis", "basis_mismatch")
    out = annotate_fields(em.fields, {3: 0.10}, floor=0.80)
    assert out["pe_at_cap"]["state"] == "LOW_CONFIDENCE_OCR", out["pe_at_cap"]
    assert "refused_value" not in out["pe_at_cap"], out["pe_at_cap"]


def test_a_failed_check_refusal_off_a_low_confidence_ocr_page_is_low_confidence_ocr():
    from ocr_pages import annotate_fields
    em = extract_filing.Emitter("RHP")
    em.put("price_band_floor", 500.0, 3, "price_band", extract_filing.check_price_band(500.0, 900.0))
    assert em.fields["price_band_floor"]["state"] == "REFUSED"
    out = annotate_fields(em.fields, {3: 0.10}, floor=0.80)
    assert out["price_band_floor"]["state"] == "LOW_CONFIDENCE_OCR", out["price_band_floor"]


def test_a_refusal_off_a_trusted_page_stays_refused():
    from ocr_pages import annotate_fields
    em = extract_filing.Emitter("RHP")
    em.refuse("pe_at_cap", 99.0, 3, "pe_basis", "basis_mismatch")
    out = annotate_fields(em.fields, {3: 0.97}, floor=0.80)
    assert out["pe_at_cap"]["state"] == "REFUSED", out["pe_at_cap"]
    assert out["pe_at_cap"]["value"] is None


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


def test_a_plain_failed_tuple_is_missed_even_with_a_value():
    """REFUSED is opt-in (#1420 round 2): a bare (False, detail) is a check
    nobody marked as a refusal, so it keeps the stored value (MISSED). Only the
    Refused marker - from a check, or judge() on a present value - refuses."""
    emit = extract_filing.Emitter("doc")
    emit.put("issue_structure", "FRESH_AND_OFS", 3, "issue_structure_from_ofs_row",
             (False, "ofs=None"))
    got = emit.fields["issue_structure"]
    assert got["state"] == "MISSED" and "refused_value" not in got, got
    emit.put("promoter_waca", -3.0, 7, "promoter_waca_positive",
             answer_states.judge(True, False, "-3.0"))
    got = emit.fields["promoter_waca"]
    assert got["state"] == "REFUSED" and got["refused_value"] == -3.0, got
    emit.put("promoter_waca", -3.0, 7, "promoter_waca_positive",
             answer_states.judge(False, False, "-3.0"))
    assert emit.fields["promoter_waca"]["state"] == "MISSED", emit.fields["promoter_waca"]


# Every check function that can refuse, with arguments that make it refuse and
# the positions of the inputs it judges. A new check_* function must be listed
# here or in NEVER_REFUSES, so a refusal is never added without this test.
REFUSING_ARGS = {
    "check_allocation": ((40.0, 30.0, 40.0), (0, 1, 2)),
    "check_category_sum": (([1.0, 2.0], 5.0), (0, 1)),
    "check_cin": (("NOT-A-CIN",), (0,)),
    "check_cover_arithmetic": ((1000.0, 10.0, 1.0, "crores"), (0, 1, 2, 3)),
    "check_cover_face_value": ((-1.0,), (0,)),
    "check_cover_lot": ((10 ** 6,), (0,)),
    "check_cover_price": ((10 ** 6,), (0,)),
    "check_cover_share_count": ((10.0,), (0,)),
    "check_date_before": (("2026-02-01", "2026-01-01", "x"), (0, 1)),
    "check_face_multiple": ((100.0, 10.0, 5.0), (0, 1, 2)),
    "check_fy_series": (({2024: 1.0, 2025: 2.0}, [2024, 2025, 2026]), (0, 1)),
    "check_holding_dilution": ((50.0, 60.0), (0, 1)),
    "check_lot_value": ((1.0, 100.0), (0, 1)),
    "check_mcap_consistency": ((1000.0, 100.0, 1e6, 1000.0, 200.0, 1e6), (0, 1, 2, 3, 4, 5)),
    "check_mean_equals": (([1.0, 2.0], 5.0, "x"), (0, 1)),
    "check_min_count": ((1, 3), (0,)),
    "check_monotonic_mcap": ((200.0, 100.0), (0, 1)),
    "check_monotonic_shares": ((100.0, 200.0), (0, 1)),
    "check_percentage": ((150.0,), (0,)),
    "check_price_band": ((500.0, 900.0), (0, 1)),
    "check_ratio_equals": ((1.0, 2.0, 5.0, "x"), (0, 1, 2)),
    "check_shares_amount": ((1000.0, 10.0, 5.0), (0, 1, 2)),
    "check_sign_consistency": (({2025: 1.0}, {2025: -1.0}), (0, 1)),
    "check_sum_equals": (([1.0, 2.0], 10.0, "x"), (0, 1)),
    "check_text_length": (("abcdef", 3), (0,)),
    "check_timeline": (({"open_date": "2026-02-02", "close_date": "2026-02-01"},), (0,)),
    "check_track_record": ((1, 5), (0, 1)),
    "check_waca_multiple": ((100.0, 10.0, 5.0), (0, 1, 2)),
    "check_weighted_average": (({2025: 1.0}, {2025: 1}, 5.0, "x"), (0, 1, 2)),
}
NEVER_REFUSES = {"check_cover_issue_size"}  # WARN level: an out-of-band size is published


def test_every_check_function_is_classified():
    names = {n for n, _f in _check_functions()}
    listed = set(REFUSING_ARGS) | NEVER_REFUSES
    assert names == listed, {"unclassified": names - listed, "stale": listed - names}


@pytest.mark.parametrize("name", sorted(REFUSING_ARGS))
def test_a_check_refuses_only_when_every_judged_input_is_present(name):
    fn = getattr(extract_filing, name)
    args, inputs = REFUSING_ARGS[name]
    result = fn(*args)
    assert isinstance(result, answer_states.Refused), (name, result)
    assert answer_states.check_state(123.0, result) == "REFUSED", (name, result)
    for i in inputs:
        absent = list(args)
        absent[i] = None
        got = fn(*absent)
        assert answer_states.check_state(123.0, got) == "MISSED", (name, i, got)


@pytest.mark.parametrize("name", sorted(NEVER_REFUSES))
def test_a_never_refusing_check_never_returns_the_marker(name):
    fn = getattr(extract_filing, name)
    assert not isinstance(fn(1e9, "crores", "MAINBOARD"), answer_states.Refused)


def test_a_disagreeing_ratio_refusal_carries_a_list(monkeypatch):
    """ratio_rows_disagree_for_latest_period is the one refusal whose
    refused_value is a LIST (every value the note printed for the latest
    period) with no refused_page; the OD-153 consumer must handle that shape.
    The note is the existing two_tables_disagree_on_latest layout from
    test_financial_ratios.py (same device, no new fixture)."""
    import test_financial_ratios as tfr
    note = next(c[1] for c in tfr.LAYOUTS if c[0] == "two_tables_disagree_on_latest")
    extra = _statement_years(monkeypatch, [2026, 2025])
    env = run(note + extra, "RHP", "disagree.txt")
    got = env["fields"]["current_ratio"]
    assert got["state"] == "REFUSED", got
    assert got["check"]["detail"] == "ratio_rows_disagree_for_latest_period", got
    assert got["refused_value"] == [1.4, 1.45], got
    assert got["refused_page"] is None, got
