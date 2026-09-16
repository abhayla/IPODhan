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


def test_run_emits_the_printed_current_ratio():
    envelope = run(pages(), "RHP", "prasol-financial-ratios.txt")
    got = field(envelope, "current_ratio")
    assert got is not None, "current_ratio never emitted"
    assert got["value"] == 1.54, got
    assert got["page"] == 441, got


def test_run_emits_the_printed_inventory_turnover():
    envelope = run(pages(), "RHP", "prasol-financial-ratios.txt")
    got = field(envelope, "inventory_turnover")
    assert got is not None, "inventory_turnover never emitted"
    assert got["value"] == 5.59, got


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
