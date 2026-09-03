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
