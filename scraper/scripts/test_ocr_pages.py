#!/usr/bin/env python3
"""D6 / W-57 — tests for the OCR route (`ocr_pages.py`).

The image fixture is a crop of BSE's SCANNED price band advertisement for
Deepa (the same ad NSE published with a real text layer), so the assertions
are against values a second, independent source prints: band 168 / 177 and
lot 84.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import ocr_pages  # noqa: E402

FIXTURE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "tests", "fixtures", "ocr", "deepa-price-band-crop.png")

# A page whose text layer is broken font encoding — the shape BSE's scanned
# ads take: a few dozen mojibake characters and nothing readable.
GARBAGE_PAGE = ("\x01\x03\x02" * 12) + "\x00\x0e\x0f"

CLEAN_PAGE = (
    "DEEPA INDUSTRIES LIMITED\n"
    "PRICE BAND: Rs 168 TO Rs 177 PER EQUITY SHARE OF FACE VALUE OF Rs 2 EACH\n"
    "THE FLOOR PRICE IS 84 TIMES THE FACE VALUE AND THE CAP PRICE IS 88.5 TIMES\n"
    "BID/OFFER OPENS ON: SUNDAY, AUGUST 31, 2026\n"
    "BID/OFFER CLOSES ON: TUESDAY, SEPTEMBER 1, 2026\n"
    "Fresh Issue of Equity Shares aggregating up to Rs 2,500 million and an\n"
    "Offer for Sale of up to 11,848,340 Equity Shares by the Selling Shareholders.\n"
    "Allocation: QIB 50 per cent, Non-Institutional 15 per cent, Retail 35 per cent.\n"
    "Bid Lot: 84 Equity Shares and in multiples of 84 Equity Shares thereafter.\n")


backend_missing = pytest.mark.skipif(
    not ocr_pages.backend_available(),
    reason="OCR backend unavailable — pip install rapidocr-onnxruntime pypdfium2")
fixture_missing = pytest.mark.skipif(
    not os.path.exists(FIXTURE), reason="OCR image fixture not present: %s" % FIXTURE)


# --------------------------------------------------------------------------- #
# needs_ocr — the gate that decides a page has no usable text layer
# --------------------------------------------------------------------------- #
def test_needs_ocr_true_for_garbage_text_layer():
    assert ocr_pages.needs_ocr(GARBAGE_PAGE) is True


def test_needs_ocr_true_for_empty_page():
    assert ocr_pages.needs_ocr("") is True
    assert ocr_pages.needs_ocr(None) is True


def test_needs_ocr_false_for_clean_text_layer():
    # The NSE text copy of the same ad — a real text layer, left alone.
    assert ocr_pages.needs_ocr(CLEAN_PAGE * 3) is False


def test_needs_ocr_true_for_thin_text_layer():
    # A cover page carrying only a caption is not enough to extract from.
    assert ocr_pages.needs_ocr("Deepa Industries Limited\nPage 1 of 4\n") is True


def test_nonprintable_ratio_flags_broken_encoding():
    assert ocr_pages.nonprintable_ratio(GARBAGE_PAGE) > ocr_pages.MAX_NONPRINTABLE_RATIO
    assert ocr_pages.nonprintable_ratio(CLEAN_PAGE) == 0.0


# --------------------------------------------------------------------------- #
# reading order + confidence gate (no backend needed)
# --------------------------------------------------------------------------- #
def _box(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def test_reading_order_is_top_to_bottom_then_left_to_right():
    boxes = [
        (_box(300, 10, 400, 40), "177", 0.9),   # same line, to the right
        (_box(10, 100, 200, 130), "Bid Lot", 0.9),
        (_box(10, 10, 200, 40), "PRICE BAND 168 TO", 0.9),
    ]
    assert ocr_pages._reading_order(boxes) == "PRICE BAND 168 TO 177\nBid Lot"


def test_annotate_fields_marks_ocr_source_and_confidence():
    fields = {"price_band_floor": {"value": 168.0, "page": 0, "check": {"passed": True}}}
    ocr_pages.annotate_fields(fields, {0: 0.91})
    assert fields["price_band_floor"]["source_text"] == "OCR"
    assert fields["price_band_floor"]["ocr_confidence"] == 0.91
    assert fields["price_band_floor"]["value"] == 168.0


def test_annotate_fields_nulls_below_confidence_floor():
    fields = {"lot_size": {"value": 84, "page": 2, "check": {"passed": True}}}
    ocr_pages.annotate_fields(fields, {2: 0.41})
    assert fields["lot_size"]["value"] is None
    assert "ocr_low_confidence" in fields["lot_size"]["check"]["detail"]
    assert fields["lot_size"]["check"]["passed"] is False


def test_annotate_fields_leaves_text_layer_fields_alone():
    fields = {"face_value": {"value": 2.0, "page": 1, "check": {"passed": True}}}
    ocr_pages.annotate_fields(fields, {0: 0.9})
    assert fields["face_value"]["source_text"] == "TEXT"
    assert fields["face_value"]["value"] == 2.0


# --------------------------------------------------------------------------- #
# live OCR on the scanned fixture
# --------------------------------------------------------------------------- #
@backend_missing
@fixture_missing
def test_ocr_recovers_band_and_lot_from_scanned_fixture():
    text, confidence = ocr_pages.ocr_image(FIXTURE)
    flat = text.replace(",", "")
    assert "168" in flat, text
    assert "177" in flat, text
    assert "84" in flat, text
    assert 0.0 < confidence <= 1.0
    assert confidence >= ocr_pages.CONFIDENCE_FLOOR, "confidence %.3f" % confidence


@backend_missing
@fixture_missing
def test_scanned_fixture_text_beats_the_needs_ocr_gate():
    """OCR output must be good enough that the page no longer needs OCR."""
    text, _conf = ocr_pages.ocr_image(FIXTURE)
    assert ocr_pages.needs_ocr(text) is False


@backend_missing
@fixture_missing
def test_ocr_recovers_word_spacing_on_the_scanned_fixture():
    """Words must come back separated — the failure this route was fixed for.

    The recogniser never decodes the space character on dense all-caps English,
    so a whole line used to arrive as
    `PRICEBAND:R168TOR177PEREQUITYSHAREOFFACEVALUEOFR2EACH.` — every field
    regex misses it. `split_words` recovers the boundaries from the image.
    """
    text, _conf = ocr_pages.ocr_image(FIXTURE)
    upper = text.upper()
    assert "168" in upper, text
    assert "177" in upper, text
    assert "84" in upper, text
    assert "PRICE BAND" in upper, text
    assert "FACE VALUE" in upper, text
    # ...and the glued form must be gone, not merely accompanied.
    assert "PRICEBAND" not in upper.replace(" ", "!"), text


# --------------------------------------------------------------------------- #
# word splitting (pure geometry — no backend needed)
# --------------------------------------------------------------------------- #
def _text_strip(words, height=40, char_gap=5, word_gap=16, margin=6):
    """Render a synthetic text line: ink blocks separated by gaps."""
    np = pytest.importorskip("numpy")
    columns = [255] * margin
    for wi, word in enumerate(words):
        if wi:
            columns.extend([255] * word_gap)
        for ci in range(word):
            if ci:
                columns.extend([255] * char_gap)
            columns.extend([0] * 8)  # one "character" of ink
    columns.extend([255] * margin)
    strip = np.tile(np.array(columns, dtype="uint8"), (height, 1))
    return np.dstack([strip] * 3)


def test_split_words_finds_word_boundaries_not_character_gaps():
    crop = _text_strip([3, 5, 2])
    assert len(ocr_pages.split_words(crop)) == 3


def test_split_words_keeps_a_single_word_whole():
    crop = _text_strip([6])
    assert len(ocr_pages.split_words(crop)) == 1


def test_split_words_returns_the_crop_for_a_blank_image():
    np = pytest.importorskip("numpy")
    blank = np.full((30, 200, 3), 255, dtype="uint8")
    assert len(ocr_pages.split_words(blank)) == 1


def test_split_words_handles_light_text_on_a_dark_ground():
    crop = 255 - _text_strip([3, 4])
    assert len(ocr_pages.split_words(crop)) == 2
