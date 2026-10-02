"""Item 44 / OD-164(f): an OCR-only amount printed "d.ddd" is ambiguous, never a decimal.

The NSE IPO's price band advertisement is a newspaper scan read by OCR. Staging's receipts
for it held priceRangeMin 1.7 / priceRangeMax 1.785 (OCR, confidence 0.7665) against the
true Rs 1,700 / Rs 1,785: the comma was read as a '.'. The real OCR lines of that page are
in tests/fixtures/ocr/nse-price-band-ad.ocr-page0.txt (this laptop's OCR read the commas
correctly on 2026-10-02); the "PRICE BAND:" line with '.' separators is that page's header
as the staging receipts' values show it was read.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import extract_filing  # noqa: E402
from ocr_pages import guard_ambiguous_thousands, OCR_AMBIGUOUS_THOUSANDS_REASON  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "ocr",
                       "nse-price-band-ad.ocr-page0.txt")


def _real_lines():
    with open(FIXTURE, encoding="utf-8") as fh:
        return [ln.rstrip("\n") for ln in fh if not ln.startswith("#")]


def _page(header):
    return "\n".join([header] + _real_lines())


def _run(header, ocr=True):
    return extract_filing.run([(0, _page(header))], "PRICE_BAND_AD", "nse-pba.pdf",
                              ocr_confidence={0: 0.7665} if ocr else None)


def test_dot_thousands_on_an_ocr_page_is_missed_not_1_7():
    out = _run("PRICE BAND: ₹1.700 TO ₹1.785 PER EQUITY SHARE OF FACE VALUE OF ₹1 EACH")
    for name, token in (("price_band_floor", "1.700"), ("price_band_cap", "1.785")):
        f = out["fields"][name]
        assert f["value"] is None, (name, f)
        assert f["state"] == "MISSED"
        assert f["check"]["detail"].startswith(OCR_AMBIGUOUS_THOUSANDS_REASON)
        assert f["ambiguous_token"] == token


def test_comma_thousands_on_an_ocr_page_is_kept():
    out = _run("PRICE BAND: ₹1,700 TO ₹1,785 PER EQUITY SHARE OF FACE VALUE OF ₹1 EACH")
    assert out["fields"]["price_band_floor"]["value"] == 1700
    assert out["fields"]["price_band_cap"]["value"] == 1785
    assert out["fields"]["price_band_cap"]["source_text"] == "OCR"


def test_the_same_shape_on_a_text_layer_page_is_untouched():
    # A text layer is the "text read in the same document": its '.' is a real decimal point.
    out = _run("PRICE BAND: ₹1.700 TO ₹1.785 PER EQUITY SHARE OF FACE VALUE OF ₹1 EACH", ocr=False)
    assert out["fields"]["price_band_floor"]["value"] == 1.7
    assert out["fields"]["price_band_cap"]["value"] == 1.785


def test_two_decimals_and_four_digit_groups_are_not_ambiguous():
    fields = {
        "a": {"value": 42.89, "page": 0, "source_text": "OCR", "state": "VALUE"},
        "b": {"value": 1.7854, "page": 0, "source_text": "OCR", "state": "VALUE"},
        "c": {"value": 1.785, "page": 0, "source_text": "MIXED", "state": "VALUE"},
    }
    guard_ambiguous_thousands(fields, {0: "IS 42.89 TIMES 1.7854 and 1.785"})
    assert [fields[k]["value"] for k in "abc"] == [42.89, 1.7854, 1.785]


def test_a_value_not_printed_in_the_ambiguous_shape_is_kept():
    fields = {"x": {"value": 1.7, "page": 0, "source_text": "OCR", "state": "VALUE"}}
    guard_ambiguous_thousands(fields, {0: "price 1.70 only"})
    assert fields["x"]["value"] == 1.7


# PR #1464 fix round 1 (MINOR 1): the guard covers ONLY the rupee price/amount fields, and only a
# token whose decimal reading is implausible for that field. A real "101.250" band is kept.
def test_a_three_digit_band_is_kept():
    out = _run("PRICE BAND: ₹101.250 TO ₹106.500 PER EQUITY SHARE OF FACE VALUE OF ₹1 EACH")
    assert out["fields"]["price_band_floor"]["value"] == 101.25, out["fields"]["price_band_floor"]
    assert out["fields"]["price_band_cap"]["value"] == 106.5
    assert out["fields"]["price_band_floor"]["state"] != "MISSED"


def test_a_three_decimal_crore_amount_is_kept():
    fields = {"fresh_issue_amount": {"value": 1.25, "page": 0, "source_text": "OCR", "state": "VALUE"}}
    guard_ambiguous_thousands(fields, {0: "FRESH ISSUE OF UP TO ₹1.250 CRORE"})
    assert fields["fresh_issue_amount"]["value"] == 1.25


def test_a_unit_scaled_implausible_amount_is_missed_by_its_printed_token():
    # Printed "1.700 lakh" (Rs 1.7 lakh, below any issue's floor of Rs 1 crore), emitted in the
    # document's unit (crores -> 0.017): the printed token is compared, not the converted value.
    for value in (1.7, 0.017, 170000.0):
        fields = {"fresh_issue_amount": {"value": value, "page": 0, "source_text": "OCR", "state": "VALUE"}}
        guard_ambiguous_thousands(fields, {0: "FRESH ISSUE AGGREGATING UP TO ₹1.700 LAKH"})
        f = fields["fresh_issue_amount"]
        assert f["value"] is None and f["state"] == "MISSED", (value, f)
        assert f["ambiguous_token"] == "1.700"


def test_a_non_money_field_in_the_ambiguous_shape_is_kept():
    fields = {"subscription_times": {"value": 1.25, "page": 0, "source_text": "OCR", "state": "VALUE"}}
    guard_ambiguous_thousands(fields, {0: "SUBSCRIBED 1.250 TIMES"})
    assert fields["subscription_times"]["value"] == 1.25
