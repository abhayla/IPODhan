"""EPS is the row the profit-and-loss statement prints under its own heading (step-1 review, item 2).

Fixture: the Emcure Pharmaceuticals DRHP page 302 (0-based), pdfplumber text as extract_filing receives it:
"Annexure II - Restated Consolidated Statement of Profit and Loss", EPS printed per segment (continuing
14.91 ... 32.11, discontinued - ... (10.43)) and the continuing-and-discontinued total
"Basic 46 14.91 11.16 29.42 36.62 21.68", then the auditor's sign-off ("The above Annexure should be read
with ...").

The review's shape: a page carrying two basic-EPS rows that disagree ("as reported" and "adjusted for
bonus") lost its EPS because every row on the page was a candidate; the old reader took the first row. No
real document in the sweep prints the second row OUTSIDE the statement, so the tests that need one append
it after the sign-off (MINIMAL EDIT of real text, labelled so in each test).

Run:  cd scraper && python -m pytest scripts/test_extract_financials_eps_block.py -q
"""
import io
import os

from extract_financials_pdf import _align_factory, _read_eps_rows

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures",
                       "financial-statements", "emcure-drhp-restated-pnl-eps-segments.txt")
# Two interim columns (Sep-23, Sep-22) then FY2023, FY2022, FY2021.
ALIGN = _align_factory([None, None, 2023, 2022, 2021], [2023, 2022, 2021])
TOTAL = {2023: 29.42, 2022: 36.62, 2021: 21.68}


def page():
    with io.open(FIXTURE, encoding="utf-8") as handle:
        raw = handle.read().replace("\r\n", "\n")
    return raw.split(">>>", 1)[1].lstrip("\n").split("\n")


def test_fixture_is_the_real_emcure_statement():
    lines = page()
    assert "Restated Consolidated Statement of Profit and Loss" in lines[1]
    assert "Basic 46 14.91 11.16 29.42 36.62 21.68" in lines


def test_real_page_gives_the_continuing_and_discontinued_total():
    series, _combined, ambiguous = _read_eps_rows(page(), ALIGN)
    assert series == TOTAL
    assert ambiguous is False


def test_a_disagreeing_eps_row_after_the_statement_does_not_drop_the_statement_eps():
    # MINIMAL EDIT: a bonus-adjusted EPS row appended after the statement's sign-off.
    lines = page() + ["Basic EPS (adjusted for bonus issue) 2.98 2.23 5.88 7.32 4.34"]
    series, _combined, ambiguous = _read_eps_rows(lines, ALIGN)
    assert series == TOTAL
    assert ambiguous is False


def test_two_disagreeing_rows_inside_the_statement_fail_closed():
    # MINIMAL EDIT: the statement's own EPS block replaced by "as reported" and "adjusted for bonus" rows.
    lines = page()
    start = lines.index("Earnings per share (for continuing operations):")
    end = lines.index("Basic 46 14.91 11.16 29.42 36.62 21.68") + 3
    lines[start:end] = [
        "Earnings per share:",
        "Basic EPS (as reported) 46 10.50 8.10 21.00 26.40 15.60",
        "Basic EPS (adjusted for bonus issue) 46 2.10 1.62 4.20 5.28 3.12",
    ]
    series, _combined, ambiguous = _read_eps_rows(lines, ALIGN)
    assert series is None
    assert ambiguous is True


def test_an_unlabelled_row_that_disagrees_with_the_total_inside_the_statement_fails_closed():
    # MINIMAL EDIT: the continuing-operations label removed, so its row is no longer a named segment and
    # nothing on the page says which of the two disagreeing rows is the EPS.
    lines = page()
    lines.remove("Earnings per share (for continuing operations):")
    series, _combined, ambiguous = _read_eps_rows(lines, ALIGN)
    assert series is None
    assert ambiguous is True


def test_segment_rows_alone_inside_the_statement_give_no_eps():
    lines = page()
    cut = lines.index("Earnings per share (for continuing and discontinued operations):")
    series, _combined, _ambiguous = _read_eps_rows(lines[:cut], ALIGN)
    assert series is None
