"""Item 8 slice 3a — the extractor actually CALLS the ratio reader.

`financial_ratios.py` merged in #638 with zero importers: correct, tested, and
never invoked, so no document ever carried current_ratio / quick_ratio /
inventory_turnover. Same failure class as item 8a's peer locator.

These tests drive `run()` - the real entry point - on the real Prasol note
fixture, not the module in isolation.
"""

import io
import os

from extract_filing import run

FIXTURES = os.path.join(
    os.path.dirname(__file__), "..", "tests", "fixtures", "financial-ratios"
)


def pages(name="prasol-financial-ratios.txt"):
    with io.open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        raw = handle.read()
    out = []
    for chunk in raw.split("<<<PAGE "):
        if not chunk.strip():
            continue
        head, _, body = chunk.partition(">>>")
        out.append((int(head.strip()), body))
    return out


def field(envelope, name):
    return envelope.get("fields", {}).get(name)


def _with_statement(monkeypatch, years, pnl_text=None):
    """#771 round 3: the ratio column is chosen by the statement period the
    stored net worth / EPS belong to, which the shared P&L core reports. The
    fixture carries only the ratio note, so the core's answer is pinned."""
    import extract_filing

    real = extract_filing.extract_pnl_from_texts

    def fake(page_texts, **kwargs):
        out = real(page_texts, **kwargs)
        out["annualYears"] = list(years)
        if pnl_text is not None:
            out["pnlPage"] = 9999
        return out

    monkeypatch.setattr(extract_filing, "extract_pnl_from_texts", fake)
    extra = [(9999, pnl_text)] if pnl_text is not None else []
    return pages() + extra


def test_run_emits_the_current_ratio_for_the_statement_period(monkeypatch):
    envelope = run(_with_statement(monkeypatch, [2026, 2025, 2024]), "RHP", "prasol.txt")
    got = field(envelope, "current_ratio")
    assert got["value"] == 1.54, got
    assert got["page"] == 441, got
    assert got["ratio_read"]["period"] == "2026-03-31", got
    assert got["ratio_read"]["latest_statement_period"] == "2026-03-31", got
    assert got["ratio_read"]["period_label"] == "FY 25-26", got


def test_run_emits_the_inventory_turnover_for_the_statement_period(monkeypatch):
    envelope = run(_with_statement(monkeypatch, [2026, 2025, 2024]), "RHP", "prasol.txt")
    assert field(envelope, "inventory_turnover")["value"] == 5.59


def test_an_older_statement_period_takes_that_periods_column(monkeypatch):
    """Statement FY2025: both FY 24-25 columns (tables 1 and 2) print 1.34."""
    envelope = run(_with_statement(monkeypatch, [2025, 2024, 2023]), "RHP", "prasol.txt")
    assert field(envelope, "current_ratio")["value"] == 1.34


def test_no_statement_period_writes_nothing_and_says_why():
    envelope = run(pages(), "RHP", "prasol.txt")
    got = field(envelope, "current_ratio")
    assert got["value"] is None, got
    assert got["check"]["detail"] == "ratio_statement_period_unknown", got


def test_a_basis_different_from_the_statement_writes_nothing(monkeypatch):
    """Prasol's FY 25-26 column is Standalone. Against a consolidated P&L it
    would sit next to a net worth of another entity set."""
    envelope = run(_with_statement(monkeypatch, [2026, 2025],
                                   "Restated Consolidated Statement of Profit and Loss"),
                   "RHP", "prasol.txt")
    got = field(envelope, "current_ratio")
    assert got["value"] is None, got
    assert got["check"]["detail"] == "ratio_basis_differs_from_statement", got


def test_quick_ratio_names_the_balance_sheet_inputs_it_does_not_have():
    """The extractor does not read current assets / inventories / current
    liabilities, so the derivation cannot run. That must be SAID, not silently
    absent - the whole point of this slice's sibling (the peer reason)."""
    envelope = run(pages(), "RHP", "prasol-financial-ratios.txt")
    got = field(envelope, "quick_ratio")
    assert got is not None, "quick_ratio never emitted"
    assert got["value"] is None, got
    assert got["check"]["detail"].startswith("balance_sheet_inputs_absent:"), got


def test_a_document_with_no_ratio_note_names_its_cause():
    envelope = run([(1, "This page carries no financial ratio note at all.")],
                   "RHP", "empty.txt")
    for name in ("current_ratio", "inventory_turnover"):
        got = field(envelope, name)
        assert got is not None, "%s never emitted" % name
        assert got["value"] is None, got
        assert got["check"]["detail"] == "ratio_note_not_in_document", got


def test_a_price_band_ad_is_not_asked_for_ratios():
    """The ratio note lives in the prospectus family only; a price-band ad has
    no financial statements at all, so emitting a null there would manufacture
    a failure rather than record one."""
    envelope = run([(1, "PRICE BAND: Rs 100 to Rs 105 per equity share")],
                   "PRICE_BAND_AD", "pba.txt")
    assert field(envelope, "current_ratio") is None


def test_a_single_year_statement_header_is_not_a_statement_period(monkeypatch):
    """Item 46 review round 1 (CLASS run): Pooja Logistics' RHP (3a0a6ed7)
    wraps its header cells so only 2024 parsed; the ratio was read for
    31/03/2024 on an FY2026 document. One year is not a statement period."""
    envelope = run(_with_statement(monkeypatch, [2024]), "RHP", "prasol.txt")
    got = field(envelope, "current_ratio")
    assert got["value"] is None, got
    assert got["check"]["detail"] == "ratio_statement_period_unknown", got
