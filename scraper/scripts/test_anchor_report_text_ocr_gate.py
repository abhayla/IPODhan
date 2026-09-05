"""W-139: which pages `anchor_report_text.py` sends to OCR.

The live miss this covers (Lumino, MAINBOARD anchor letter): the page had table
rows but its name column came back empty from the text layer. `low_confidence_share`
returns 0.0 for an empty name list, so the page scored perfectly, never reached
OCR, parsed to nothing, and the document stayed PENDING forever.

Tested on the decision function rather than on a scanned PDF: this repo carries
no scanned anchor fixture (the two SME samples are text-layer PDFs), and a
synthetic image PDF would test pdfplumber and tesseract, not the decision.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from anchor_report_text import (  # noqa: E402
    NAME_QUALITY_FLOOR,
    has_name_shaped_word,
    page_needs_ocr,
)


def rows(names):
    return {"names": names}


def test_readable_names_do_not_go_to_ocr():
    assert page_needs_ocr(rows(["MOTILAL OSWAL MUTUAL FUND", "SBI EQUITY FUND"])) is False


def test_damaged_names_over_the_floor_go_to_ocr():
    # 2 of 3 unreadable = 0.66 > the 0.3 floor.
    assert NAME_QUALITY_FLOOR == 0.3
    assert page_needs_ocr(rows(["M OTI LA", "0 1", "SBI EQUITY FUND"])) is True


def test_w139_page_with_rows_but_no_name_material_goes_to_ocr():
    """The regression: every name cell blank scored 0.0 and was skipped."""
    assert page_needs_ocr(rows(["", "   ", ""])) is True
    assert page_needs_ocr(rows(["", "-", "123"])) is True


def test_page_with_no_rows_is_not_flagged():
    """No row geometry means the OCR read has nowhere to land — see the docstring."""
    assert page_needs_ocr(None) is False
    assert page_needs_ocr(rows([])) is False


def test_has_name_shaped_word():
    assert has_name_shaped_word("SBI") is True
    assert has_name_shaped_word("Ab") is True
    assert has_name_shaped_word("A") is False
    assert has_name_shaped_word("1,234.00") is False
    assert has_name_shaped_word("") is False
    assert has_name_shaped_word(None) is False
