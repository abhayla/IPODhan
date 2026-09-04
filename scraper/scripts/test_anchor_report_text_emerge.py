"""W-132 - the NSE Emerge (SME) anchor letter's merged price/amount column.

Qualiance International Limited's letter (NSE Emerge) prints "Bid Price" and
"Total Amount" close enough together that `column_bands` clusters them into a
SINGLE numeric band (COL_GAP_PT=15.0pt apart, well under the gap that would
split them) - unlike the mainboard DEEPA scan this sidecar was built against,
where the two sit far enough apart to land in their own bands. The merged cell
this produces ("127 3,26,39,000") is exactly the shape the TS parser's
`splitPriceAndAmount` is built to re-split (see W-132 in
anchor-report-parser.ts) - this test proves the PYTHON side already reduces
the real letter's column geometry to that shape, so the split is correctly
owned downstream in TS rather than guessed at here.

The letter's own header also splits its three column labels ("No. of Equity
Shares Allocated", "Bid Price (₹ Per Equity Share)", "Total Amount allocated
(in ₹)") across three separate printed lines above the table - this must not
get mistaken for investor rows or shift the column geometry, since none of
those header words carries a digit.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from anchor_report_text import column_bands, page_rows, render_rows

ROW_TOP = {1: 300.0, 2: 315.0, 3: 330.0, 4: 345.0, 5: 360.0, 6: 375.0}


def _w(text, x0, top, width=None):
    if width is None:
        width = max(10.0, 6.0 * len(text))
    return {"text": text, "x0": x0, "x1": x0 + width, "top": top}


def _row_words(serial, name, shares, pct, price, amount, top):
    """One investor row, with the price and amount cells 10pt apart (< COL_GAP_PT

    = 15.0pt) - the real letter's own column geometry, which the mainboard
    letters this sidecar was first built for do not share (there the two sit
    far enough apart to land in separate bands).
    """
    words = [
        _w(f"{serial}.", 40.0, top),
        _w(name, 70.0, top),
        _w(shares, 260.0, top),
        _w(pct, 340.0, top),
        _w(price, 400.0, top),
        _w(amount, 410.0, top),
    ]
    return words


def _header_words():
    """The letter's 3-line header, split across the printed column labels.

    None of these words carries a digit, so they must never enter a numeric
    band or be mistaken for a table row.
    """
    lines = [
        ("No of Equity", 80.0, 270.0),
        ("No. of Equity Bid Price Total Amount", 80.0, 280.0),
        ("Name of Anchor Investors Shares (Rs Per Equity allocated", 80.0, 290.0),
    ]
    out = []
    for text, x0, top in lines:
        x = x0
        for token in text.split(" "):
            out.append(_w(token, x, top))
            x += 6.0 * len(token) + 4.0
    return out


def _rows_words():
    return (
        _header_words()
        + _row_words("1", "Bharat Venture Opportunities Fund", "2,57,000", "25.47%", "127", "3,26,39,000", ROW_TOP[1])
        + _row_words("2", "Carnelian AIF Category I Trust", "2,57,000", "25.47%", "127", "3,26,39,000", ROW_TOP[2])
        + _row_words("3", "Hem Growth Opportunities Fund", "2,57,000", "25.47%", "127", "3,26,39,000", ROW_TOP[3])
        + _row_words("4", "Finavenue Capital Trust", "80,000", "7.93%", "127", "1,01,60,000", ROW_TOP[4])
        + _row_words("5", "360 ONE LVF Treasury Solutions Fund", "79,000", "7.83%", "127", "1,00,33,000", ROW_TOP[5])
        + _row_words("6", "Tattvam AIF Trust", "79,000", "7.83%", "127", "1,00,33,000", ROW_TOP[6])
    )


def test_price_and_amount_columns_merge_into_one_band():
    words = _rows_words()
    bands = column_bands([words])
    # serial, name-gap is not a numeric band; the numeric bands are:
    # serial, shares, pct, and ONE merged price+amount band - four, not five.
    assert len(bands) == 4, f"expected 4 numeric bands (price+amount merged), got {len(bands)}: {bands}"


def test_render_rows_emits_the_merged_trailing_cell_the_ts_parser_splits():
    words = _rows_words()
    bands = column_bands([words])
    rows = page_rows(words, bands)
    assert rows is not None
    rendered = render_rows(rows)
    lines = [ln for ln in rendered.split("\n") if ln.startswith("# ") and ln[2:3].strip().isdigit()]
    assert len(lines) == 6
    first = [f.strip() for f in lines[0][2:].split("|")]
    # serial | name | shares | pct | <merged price+amount cell>
    assert first[0] == "1"
    assert first[1] == "Bharat Venture Opportunities Fund"
    assert first[2] == "2,57,000"
    assert first[3] == "25.47%"
    assert first[4] == "127 3,26,39,000"


def test_multiline_header_never_becomes_a_table_row():
    words = _rows_words()
    bands = column_bands([words])
    rows = page_rows(words, bands)
    assert rows is not None
    rendered = render_rows(rows)
    row_lines = [ln for ln in rendered.split("\n") if ln.startswith("# ") and ln[2:3].strip().isdigit()]
    # Exactly the 6 investor rows - none of the 3 header lines was read as one.
    assert len(row_lines) == 6
    # The header text survives only in the preamble, never inside an investor row.
    assert "preamble" in rows and "Bid Price" in rows["preamble"]
    for ln in row_lines:
        assert "Bid Price" not in ln
        assert "No. of Equity" not in ln
