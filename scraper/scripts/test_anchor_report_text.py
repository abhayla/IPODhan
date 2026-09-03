"""W-81 — reading order inside a wrapping name cell.

The scan is skewed, so the words of ONE printed line do not share a `top`.
Sorting a name cell by `(top, x0)` therefore interleaves its two lines; the
DEEPA letter published "OSWAL OT] LAL FINVEST N4 LI I\4ITE D" for what the
letter prints as two lines, "N4 OT] LAL OSWAL FINVEST" / "LI I\4ITE D".
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from anchor_report_text import _cell_text


def _w(text, x0, top):
    return {"text": text, "x0": x0, "x1": x0 + 10.0, "top": top}


def test_two_printed_lines_read_top_line_first_left_to_right():
    # Line 1 drifts 2.6pt across the column (skew); line 2 sits ~12pt below.
    cell = [
        _w("N4", 155.0, 300.0),
        _w("OT]", 170.0, 300.9),
        _w("LAL", 190.0, 301.5),
        _w("OSWAL", 210.0, 299.4),
        _w("FINVEST", 240.0, 302.0),
        _w("LI", 155.0, 312.4),
        _w("I\4ITE", 168.0, 313.0),
        _w("D", 195.0, 313.6),
    ]
    assert _cell_text(cell) == "N4 OT] LAL OSWAL FINVEST LI I\4ITE D"


def test_single_line_cell_is_left_to_right():
    cell = [_w("CP", 155.0, 400.0), _w("CAPITAL", 172.0, 399.2), _w("LTD", 210.0, 400.8)]
    assert _cell_text(cell) == "CP CAPITAL LTD"


def test_empty_cell_is_empty_string():
    assert _cell_text([]) == ""


# =========================================================================== #
# W-89 - the scanned-report name path.
#
# The DEEPA letter's text layer is a DAMAGED machine OCR: its glyphs are wrong
# (M -> "N4", I -> "]", W -> "I\4", % -> "o/o"), so the investor names cannot be
# read from it at all, while the numeric columns survive. The path below re-reads
# the NAMES from the pixels and puts each on the right row, keeping every number
# from the text layer. The fixture is a synthetic two-row table in the frame both
# sides use (PDF points, y down from the page top), so the alignment and join
# rules are testable without an OCR run.
# =========================================================================== #
from anchor_report_text import (  # noqa: E402
    apply_ocr_names,
    is_low_confidence_name,
    join_letter_runs,
    low_confidence_share,
    ocr_name_cells,
)


def _tw(text, x0, top, width=30.0, height=8.0):
    """One text-layer word, as pdfplumber reports it."""
    return {"text": text, "x0": x0, "x1": x0 + width, "top": top, "bottom": top + height}


def _ow(text, x0, top, width=30.0, height=8.0, score=0.9):
    """One OCR word, as `ocr_pages.ocr_pdf_page_boxes` reports it."""
    return {"text": text, "score": score, "box": [x0, top, x0 + width, top + height]}


def _line(words):
    return {"box": [[0, 0], [0, 0], [0, 0], [0, 0]],
            "text": " ".join(w["text"] for w in words), "score": 0.9, "words": words}


# Row 1's name wraps onto two printed lines; row 2's is a single line 30pt below.
NAME_BAND = (150.0, 300.0)
CENTRES = [300.0, 330.0]
NAME_GROUPS = [
    [_tw("LRS", 155.0, 300.0), _tw("D", 190.0, 300.6), _tw("S EC U R I TI ES", 205.0, 300.4)],
    [_tw("[4AYBANK", 155.0, 330.0), _tw("SECURITIES", 200.0, 330.5)],
]


# --------------------------------------------------------------------------- #
# alignment - each OCR word lands on the row its box sits on
# --------------------------------------------------------------------------- #
def test_ocr_words_align_to_the_row_they_overlap():
    lines = [
        _line([_ow("LRSD", 155.0, 300.2), _ow("SECURITIES", 205.0, 300.3)]),
        _line([_ow("MAYBANK", 155.0, 330.2), _ow("SECURITIES", 200.0, 330.4)]),
    ]
    assert ocr_name_cells(lines, NAME_GROUPS, CENTRES, NAME_BAND) == [
        "LRSD SECURITIES", "MAYBANK SECURITIES"]


def test_wrapped_second_line_does_not_land_on_the_row_above():
    # The measured W-89 failure of nearest-centre matching: row 2's name sits
    # nearer row 1's centre than to its own, and was swallowed by row 1.
    lines = [_line([_ow("MAYBANK", 155.0, 309.0), _ow("PTE", 200.0, 309.0)])]
    # ...but it overlaps row 2's text words, so it belongs to row 2.
    groups = [NAME_GROUPS[0], [_tw("[4AYBANK", 155.0, 309.0), _tw("PTE", 200.0, 309.2)]]
    assert ocr_name_cells(lines, groups, CENTRES, NAME_BAND) == ["", "MAYBANK PTE"]


def test_word_outside_the_name_column_is_never_adopted():
    # A serial (left of the name band) and an amount (right of it): both are
    # kept from the text layer and must not leak into a name.
    lines = [_line([_ow("11.", 120.0, 300.1, width=12.0),
                    _ow("2,82,486", 320.0, 300.1)])]
    assert ocr_name_cells(lines, NAME_GROUPS, CENTRES, NAME_BAND) == ["", ""]


def test_row_the_text_layer_lost_still_gets_its_name():
    # DEEPA row 4: the text layer has no name word at all on this row, so there
    # is nothing to overlap - the nearest-row fallback places it.
    groups = [[], NAME_GROUPS[1]]
    lines = [_line([_ow("TATA", 155.0, 300.5), _ow("INDIA", 190.0, 300.5)])]
    assert ocr_name_cells(lines, groups, CENTRES, NAME_BAND)[0] == "TATA INDIA"


def test_sub_lines_read_top_line_first_left_to_right():
    lines = [_line([
        _ow("FINVEST", 240.0, 300.0), _ow("MOTILAL", 155.0, 300.8),
        _ow("LIMITED", 155.0, 312.0),
    ])]
    groups = [[_tw("A", 155.0, 300.0, width=200.0, height=20.0)], []]
    assert ocr_name_cells(lines, groups, CENTRES, NAME_BAND)[0] == "MOTILAL FINVEST LIMITED"


# --------------------------------------------------------------------------- #
# the join rule - re-join shrapnel, never invent a name
# --------------------------------------------------------------------------- #
def test_letter_runs_join_only_into_dictionary_words():
    assert join_letter_runs("F U N D") == "FUND"
    assert join_letter_runs("L I M I T E D") == "LIMITED"
    assert join_letter_runs("EQUITY F U N D SER IES") == "EQUITY FUND SERIES"


def test_unjoinable_shrapnel_is_left_alone_not_guessed():
    # "MOTILAL OSWAL" would need three characters the OCR never read.
    assert join_letter_runs("M OTI LA OS WA FI N V EST") == "M OTI LA OS WA FI N V EST"


def test_join_leaves_a_clean_name_untouched():
    assert join_letter_runs("CP CAPITAL LTD") == "CP CAPITAL LTD"
    assert join_letter_runs("MAYBANK SECURITIES PTE LTD") == "MAYBANK SECURITIES PTE LTD"


# --------------------------------------------------------------------------- #
# the quality judgement the publication gate shares
# --------------------------------------------------------------------------- #
def test_is_low_confidence_name_matches_the_persister_rule():
    assert is_low_confidence_name("OSWAL OT] LAL FINVEST N4 LI I\4ITE D") is True
    assert is_low_confidence_name("") is True
    # W-89b FIXED this gap: the old rule needed a run of FOUR single letters,
    # so two-and-three-character shrapnel slipped through it. This is the
    # shape the DEEPA row 1 name takes after OCR; the run-of-short-tokens
    # signal now catches it (see test_w89b_deepa_name_verdicts below).
    assert is_low_confidence_name("M OTI LA OS WA FI N V EST") is True
    assert is_low_confidence_name("MAYBANK SECURITIES PTE LTD") is False
    assert is_low_confidence_name("360 ONE EQUITY OPPORTUNITIES FUND") is False


def test_low_confidence_share_counts_blank_rows():
    assert low_confidence_share(["MAYBANK SECURITIES PTE LTD", ""]) == 0.5
    assert low_confidence_share([]) == 0.0


# --------------------------------------------------------------------------- #
# W-89b - the 15 real DEEPA (commit 792f5387) strings, LOW verdicts, plus the
# CLEAN abbreviated/normal names that must NOT be flagged. Mirrors the same
# 26-case table in tests/unit/services/anchor-persister.test.ts (port fidelity).
# --------------------------------------------------------------------------- #
W89B_LOW_CONFIDENCE_NAMES = [
    "M OTI LA FI NV E ST LI M ITE D",
    "CA PITA 心 EQUITY FUND",
    "NOMURA SINGAPORE LIMITED GI RI K M LTI CA P G RO WTH EQUITY FUND- 1 INVESTMENT",
    "ACCOU NT",
    "SERIES 1",
    "INVESTMENT TRUST PLC HIGH CO N VI CTI 0 N FUND",
    "ALCHEMY LONG TERM VENTURES FUND SERIES 3 AS 0 KA",
    "360 ONE EQ UITY OPPORTUNITIES FUND - SERIES",
    "",
]

W89B_CLEAN_NAMES = [
    "CP CAPITAL LTD",
    "LRSD SECURITIES PVT LTD",
    "MAYBANK SECURITIES PTE LTD ODI",
    "FLEXI CAP FUND",
    "TATA INDIA CONSUMER FUND TATA DIVIDEND YIELD FUND MUTUAL FUND",
    "GROUP MAURITIUS PRIVATE LIMITED",
    "Motilal Oswal Finvest Limited",
    "WhiteOak Capital Equity Fund",
    "360 ONE Equity Opportunities Fund - Series 2",
    "HDFC Mutual Fund",
    "SBI Life Insurance Co Ltd",
    "Kotak Mahindra (International) Ltd",
    "ICICI Prudential Life Insurance Company Limited",
    "Abu Dhabi Investment Authority - Behave",
    "Goldman Sachs (Singapore) Pte",
    "LIC of India",
    "Fund 2 Ltd",
]


def test_w89b_deepa_name_verdicts():
    for name in W89B_LOW_CONFIDENCE_NAMES:
        assert is_low_confidence_name(name) is True, f"expected LOW: {name!r}"
    for name in W89B_CLEAN_NAMES:
        assert is_low_confidence_name(name) is False, f"expected CLEAN: {name!r}"


# --------------------------------------------------------------------------- #
# apply_ocr_names - numbers untouched, and never a downgrade
# --------------------------------------------------------------------------- #
def _rows():
    return {
        "preamble": "", "centres": list(CENTRES), "name_band": NAME_BAND,
        "name_groups": [list(g) for g in NAME_GROUPS],
        "names": ["LRS D S EC U R I TI ES PVT LTD", "[4AYBANK SECURITIES PTE LTD"],
        "serials": ["8", "9"],
        "columns": [["2 B2 486", "3,66,830"], ["3.63o/o", "4.71o/o"]],
    }


def test_ocr_names_replace_the_damaged_ones_and_leave_numbers_alone():
    lines = [
        _line([_ow("LRSD", 155.0, 300.2), _ow("SECURITIES", 205.0, 300.3)]),
        _line([_ow("MAYBANK", 155.0, 330.2), _ow("SECURITIES", 200.0, 330.4)]),
    ]
    out = apply_ocr_names(_rows(), lines)
    assert out["names"] == ["LRSD SECURITIES", "MAYBANK SECURITIES"]
    assert out["serials"] == ["8", "9"]
    assert out["columns"] == [["2 B2 486", "3,66,830"], ["3.63o/o", "4.71o/o"]]


def test_a_row_the_ocr_could_not_read_keeps_its_text_layer_name():
    rows = _rows()
    rows["names"][1] = "MAYBANK SECURITIES PTE LTD"  # already readable
    lines = [_line([_ow("N4AY8ANK", 155.0, 330.2)])]  # OCR read it worse
    assert apply_ocr_names(rows, lines)["names"][1] == "MAYBANK SECURITIES PTE LTD"


def test_a_row_with_no_ocr_words_keeps_its_text_layer_name():
    out = apply_ocr_names(_rows(), [])
    assert out["names"] == ["LRS D S EC U R I TI ES PVT LTD", "[4AYBANK SECURITIES PTE LTD"]
