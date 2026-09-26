"""#409 - a letter whose serial column was never learned rendered with no names
and no share counts ("only 0 investor rows could be read").

`<SYMBOL>-text-words.json` is pdfplumber's `extract_words(y_tolerance=1,
x_tolerance=1.5)` for every page of the real NSE letter (public zip
ANCHOR_<SYMBOL>.zip), rounded to 0.01pt; nothing else edited. Both letters
carry a full text layer - the defect was purely in the column geometry: digits
inside names ("EX-TOP 100", "(ULIF 071 22/05/23 SCF 110)") chain onto the serial
numbers, the serial cluster turns prose-dominant and is dropped, and
`page_rows` then read the SHARE column as the serial column.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from anchor_report_text import (  # noqa: E402
    column_bands,
    has_serial_band,
    page_rows,
    render_rows,
    table_bands,
)

FIXTURES = os.path.join(HERE, "..", "tests", "fixtures", "anchor")


def _words(symbol):
    with open(os.path.join(FIXTURES, symbol + "-text-words.json"), encoding="utf-8") as fh:
        return json.load(fh)["pages"]


def _render(symbol):
    pages_words = _words(symbol)
    bands = table_bands(pages_words)
    return [render_rows(r) if r else "" for r in (page_rows(w, bands) for w in pages_words)]


def _data_lines(pages):
    return [l for p in pages for l in p.split("\n") if l.startswith("# ") and "%" in l]


def test_kanohar_leftmost_band_is_the_share_column_not_a_serial():
    pages_words = _words("KANOHAR")
    assert has_serial_band(pages_words, column_bands(pages_words)) is False


def test_kanohar_rows_carry_name_and_share_count():
    lines = _data_lines(_render("KANOHAR"))
    assert "# 1 | ISIF EQUITY EX-TOP 100 LONG- SHORT FUND | 3,85,664 | 7.70% | 632.00 | 24,37,39,648" in lines
    assert "# 2 | ICICI PRUDENTIAL MULTI CAP FUND | 5,39,948 | 10.77% | 632.00 | 34,12,47,136" in lines
    # 42 main-table rows print a serial 1..42 on this letter's pages 0-2.
    serials = [l.split(" | ")[0] for l in lines[:42]]
    assert serials == ["# %d" % n for n in range(1, 43)]


def test_prasolchem_rows_carry_name_and_share_count():
    lines = _data_lines(_render("PRASOLCHEM"))
    assert "# 1 | KOTAK MAHINDRA TRUSTEE CO LTD | 1,17,898 | 5.31% | 676.00 | 7,96,99,048.00" in lines
    assert "# 7 | TATA AIA LIFE INSURANCE COMPANY | 2,95,878 | 13.33% | 676.00 | 20,00,13,528.00" in lines


def test_a_learned_serial_band_is_still_used():
    """The serial test must not demote a real serial column (the common case)."""
    words = []
    for i in range(8):
        top = 100.0 + 20 * i
        words += [
            {"text": str(i + 1), "x0": 60.0, "x1": 66.0, "top": top, "bottom": top + 8},
            {"text": "FUND", "x0": 100.0, "x1": 130.0, "top": top, "bottom": top + 8},
            {"text": "1,00,000", "x0": 300.0, "x1": 340.0, "top": top, "bottom": top + 8},
            {"text": "12.50%", "x0": 380.0, "x1": 410.0, "top": top, "bottom": top + 8},
            {"text": "1,00,00,000", "x0": 450.0, "x1": 500.0, "top": top, "bottom": top + 8},
        ]
    bands = column_bands([words])
    assert has_serial_band([words], bands) is True
    rows = page_rows(words, bands)
    assert rows["serials"][0] == "1"
    assert rows["names"][0] == "FUND"
