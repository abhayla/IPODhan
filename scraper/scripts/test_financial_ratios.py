"""Item 8b slice 2 — read the issuer's own ratio note; derive only what nobody prints.

The fixture is Prasol Chemicals' note 49, captured from the real RHP, with
pdfplumber's mangling preserved rather than tidied: the figures arrive as
"1 .54" and "5 .59", and the issuer's own typos ("Cost of good sold",
"Invetory)/2]") are left exactly as printed. A cleaned fixture would stop
exercising the repair this slice depends on.
"""

import io
import os
import re

import pytest

from financial_ratios import (
    derive_quick_ratio,
    find_ratio_note_pages,
    read_ratio,
)

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


def test_the_note_is_located_on_every_page_it_spans():
    """Prasol's note runs across two pages because it discloses two comparison
    periods. Reading only the first would silently drop the older year."""
    found = find_ratio_note_pages(pages())
    assert found == [441, 442], found


# --------------------------------------------------------------- quick ratio


def test_quick_ratio_is_derived_because_nobody_prints_it():
    """Karamtara's own balance sheet, from slice 1: current assets 22,499.66,
    inventories 5,718.18, current liabilities 20,671.58."""
    assert derive_quick_ratio(22499.66, 5718.18, 20671.58) == 0.81


def test_the_quick_ratio_is_never_above_the_current_ratio():
    """Same numerator less inventories. If this ever inverts, an input is wrong."""
    current = round(22499.66 / 20671.58, 2)
    assert derive_quick_ratio(22499.66, 5718.18, 20671.58) < current


@pytest.mark.parametrize(
    "ca,inv,cl",
    [(None, 5718.18, 20671.58), (22499.66, None, 20671.58), (22499.66, 5718.18, None),
     (22499.66, 5718.18, 0), ("", 5718.18, 20671.58)],
)
def test_a_missing_input_yields_no_ratio_rather_than_a_plausible_one(ca, inv, cl):
    """An absent quick ratio is honest. A quick ratio computed from a missing
    input looks exactly like a real one on the page, which is worse."""
    assert derive_quick_ratio(ca, inv, cl) is None


def test_a_continuation_page_is_read_even_though_it_has_no_heading():
    """The defect this slice found in its own first version.

    Page 441 carries the heading "49 Financial Ratios" and two comparison
    tables. Page 442 carries a THIRD table and no heading at all. A locator
    that looks only for the heading finds 441, silently drops 442, and loses
    the oldest year - with no error anywhere, because a shorter list of ratios
    looks exactly like an issuer who disclosed fewer.
    """
    by_page = dict(pages())
    assert not re.search(r"financial\s+ratios", by_page[442], re.I), (
        "page 442 now has a heading; this test no longer proves the continuation rule"
    )
    assert find_ratio_note_pages(pages()) == [441, 442]


def test_a_stray_ratio_row_elsewhere_is_not_swept_in():
    """The continuation rule is ORDERED, not a free search. A page carrying a
    ratio-shaped row must directly follow a page already in the note, or the
    reader would pick up any lookalike row anywhere in a 590-page document."""
    row = "1 Current Ratio Current Assets Current Liabilities 1 .54 1.34 15.09% x"
    stray = [
        (10, "49 Financial Ratios :-" + chr(10) + row),
        (11, "unrelated prose page"),
        (12, "1 Current Ratio Current Assets Current Liabilities 9 .99 9.99 1.00% stray lookalike"),
    ]
    assert find_ratio_note_pages(stray) == [10]
    got = read_ratio(stray, "current_ratio", (2026, 3, 31))
    assert got.get("value") != 9.99, got


# --------------------------------------------------------------------- #771
# Three more real prospectuses, three more layouts. Before #771 the reader was
# built from Prasol alone (a digit serial, exactly two values, a "Financial
# Ratios" heading) and returned `ratio_row_not_in_note` for every one of these,
# although each prints its current ratio. The fixtures are the issuers' own
# pages; the expected values are read off those pages by eye.


def test_a_statement_of_ratios_with_no_financial_ratios_heading_is_found():
    """Green Asia Impex titles the note 'Statement of Ratios', puts the label
    on its own line and the values on a later unnumbered line."""
    found = find_ratio_note_pages(pages("green-asia-impex-statement-of-ratios.txt"))
    assert 321 in found, found


def test_the_accounting_ratios_statement_is_not_the_ratio_note():
    """Green Asia's page 320 ('Statement of Earnings Per Share and Other
    Statutory Ratios') carries EPS / RoNW / NAV and no current ratio."""
    found = find_ratio_note_pages(pages("green-asia-impex-statement-of-ratios.txt"))
    assert 320 not in found, found


# ------------------------------------------------ #771 round 3: by PERIOD
# The column written is the one whose period heading equals the latest restated
# statement period (the period of the stored net worth / EPS). Rounds 1-2 chose
# it by position; the independent review of 2026-09-27 measured five layouts
# where that published another period's ratio. One row per layout below.

_AMOUNTS = "a) Current Ratio Current Assets 1,234.56 Current Liabilities 987.65 1.25 1.10 13.6%"
_HEAD = "Ratio Numerator Denominator {} Variance %"


def _note(*lines):
    return [(7, "60 Key Financial Ratios\n" + "\n".join(lines))]


FY26 = (2026, 3, 31)
FY25 = (2025, 3, 31)

LAYOUTS = [
    # (id, pages, key, latest period, expected value or None, expected reason)
    ("prasol_two_tables_mixed_basis", pages(), "current_ratio", FY26, 1.54, None),
    ("prasol_older_statement_year", pages(), "current_ratio", FY25, 1.34, None),
    ("prasol_inventory_turnover", pages(), "inventory_turnover", FY26, 5.59, None),
    ("a_one_lettered_glued_variance", pages("a-one-steels-key-financial-ratios.txt"),
     "current_ratio", FY26, 1.34, None),
    ("german_green_stranded_header", pages("german-green-steel-ratio-analysis.txt"),
     "current_ratio", FY26, 0.97, None),
    ("green_asia_label_then_value_line", pages("green-asia-impex-statement-of-ratios.txt"),
     "current_ratio", FY26, 1.16, None),
    ("studds_vertical_header", pages("studds-analytical-ratios.txt"), "current_ratio",
     (2025, 6, 30), None, "ratio_period_headings_unreadable"),
    ("studds_vertical_header_fy", pages("studds-analytical-ratios.txt"), "current_ratio",
     FY25, None, "ratio_period_headings_unreadable"),
    ("water_infra_split_header", pages("water-infra-ratios-analysis.txt"), "current_ratio",
     FY25, 1.76, None),
    ("modern_diagnostic_stub_is_latest", pages("modern-diagnostic-ratios.txt"), "current_ratio",
     (2024, 9, 30), 0.87, None),
    ("modern_diagnostic_fy_is_latest", pages("modern-diagnostic-ratios.txt"), "current_ratio",
     (2024, 3, 31), 0.75, None),
    # The reviewer's four synthetic probes, as printed (no readable period heading).
    ("probe_four_years_one_variance", _note(
        "1 Current Ratio Current Assets Current Liabilities 1.40 1.25 1.10 1.05 12.00%"),
     "current_ratio", FY26, None, "ratio_period_headings_unreadable"),
    ("probe_amounts_before_ratios", _note(_AMOUNTS), "current_ratio", FY26, None,
     "ratio_period_headings_unreadable"),
    ("probe_difference_before_percent", _note(
        "1 Current Ratio Current Assets Current Liabilities 1.40 1.25 0.15 12.00%"),
     "current_ratio", FY26, None, "ratio_period_headings_unreadable"),
    ("probe_stub_variances_full_years_only", _note(
        "1 Current Ratio Current Assets Current Liabilities 0.87 0.75 0.58 16.00% 29.30%"),
     "current_ratio", (2025, 9, 30), None, "ratio_period_headings_unreadable"),
    # The same shapes WITH a readable header: the right column, or a refusal.
    ("four_years_one_variance_with_header", _note(
        _HEAD.format("FY 25-26 FY 24-25 FY 23-24 FY 22-23"),
        "1 Current Ratio Current Assets Current Liabilities 1.40 1.25 1.10 1.05 12.00%"),
     "current_ratio", FY26, 1.40, None),
    ("amounts_before_ratios_with_header", _note(_HEAD.format("31-Mar-26 31-Mar-25"), _AMOUNTS),
     "current_ratio", FY26, None, "ratio_heading_count_differs_from_value_count"),
    ("difference_before_percent_with_header", _note(
        _HEAD.format("FY 25-26 FY 24-25"),
        "1 Current Ratio Current Assets Current Liabilities 1.40 1.25 0.15 12.00%"),
     "current_ratio", FY26, None, "ratio_heading_count_differs_from_value_count"),
    ("stub_first_full_year_latest", _note(
        _HEAD.format("30/09/2025 31/03/2025 31/03/2024"),
        "1 Current Ratio Current Assets Current Liabilities 0.87 0.75 0.58 16.00% 29.30%"),
     "current_ratio", FY25, 0.75, None),
    ("oldest_first_order", _note(
        _HEAD.format("FY 23-24 FY 24-25 FY 25-26"),
        "1 Current Ratio Current Assets Current Liabilities 1.05 1.25 1.40 12.00% 5.00%"),
     "current_ratio", FY26, 1.40, None),
    ("latest_period_not_printed", _note(
        _HEAD.format("FY 24-25 FY 23-24"),
        "1 Current Ratio Current Assets Current Liabilities 1.25 1.10 12.00%"),
     "current_ratio", FY26, None, "ratio_latest_period_not_in_headings"),
    ("value_out_of_range", _note(
        _HEAD.format("FY 25-26 FY 24-25"),
        "1 Current Ratio Current Assets Current Liabilities 75.00 1.10 12.00%"),
     "current_ratio", FY26, None, "ratio_value_out_of_range"),
    ("qualified_row_is_not_the_ratio", _note(
        _HEAD.format("FY 25-26 FY 24-25"),
        "b) Current Ratio excluding inventory Current Assets Current Liabilities 0.80 0.75 6.67%"),
     "current_ratio", FY26, None, "ratio_row_not_in_note"),
    ("two_tables_disagree_on_latest", _note(
        _HEAD.format("FY 25-26 FY 24-25"),
        "1 Current Ratio Current Assets Current Liabilities 1.40 1.25 12.00%",
        _HEAD.format("FY 25-26 FY 24-25"),
        "1 Current Ratio Current Assets Current Liabilities 1.45 1.25 16.00%"),
     "current_ratio", FY26, None, "ratio_rows_disagree_for_latest_period"),
    ("no_statement_period", pages(), "current_ratio", None, None,
     "ratio_statement_period_unknown"),
]


@pytest.mark.parametrize("case", LAYOUTS, ids=[c[0] for c in LAYOUTS])
def test_each_layout_writes_the_latest_periods_value_or_a_named_refusal(case):
    _id, page_texts, key, latest, value, reason = case
    got = read_ratio(page_texts, key, latest)
    assert got.get("value") == value, got
    if value is None:
        assert got["reason"] == reason, got
    else:
        assert got["period"] == "%04d-%02d-%02d" % latest, got


def test_the_value_page_is_the_page_of_the_row_not_the_heading():
    text = [(10, "49 Financial Ratios\nsome preamble"),
            (11, "Ratio FY 25-26 FY 24-25\n"
                 "1 Current Ratio Current Assets Current Liabilities 1.54 1.34 15.09% x")]
    assert read_ratio(text, "current_ratio", FY26)["page"] == 11


def test_the_split_digit_mangling_is_repaired_not_mis_joined():
    raw = "\n".join(t for _i, t in pages())
    assert "1 .54" in raw, "the fixture was tidied; the repair is no longer exercised"
    assert read_ratio(pages(), "current_ratio", FY26)["value"] == 1.54


def test_a_basis_different_from_the_statement_is_refused():
    """Prasol's FY 25-26 column is Standalone, FY 24-25 Consolidated."""
    assert read_ratio(pages(), "current_ratio", FY26, "standalone")["value"] == 1.54
    got = read_ratio(pages(), "current_ratio", FY26, "consolidated")
    assert got["value"] is None and got["reason"] == "ratio_basis_differs_from_statement", got
    assert read_ratio(pages(), "current_ratio", FY25, "consolidated")["value"] == 1.34


def test_renamed_notes_are_found_not_claimed_absent():
    """Studds ('Analytical Ratios'), Water Infra ('RATIOS ANALYSIS') and Modern
    Diagnostic (no heading; the page carries the Schedule III ratio set) were
    all reported ratio_note_not_in_document while printing the note."""
    assert 321 in find_ratio_note_pages(pages("studds-analytical-ratios.txt"))
    assert 427 in find_ratio_note_pages(pages("water-infra-ratios-analysis.txt"))
    assert find_ratio_note_pages(pages("modern-diagnostic-ratios.txt")) == [196]


def test_a_no_note_claim_carries_the_pages_that_print_a_current_ratio_line():
    kpi = [(41, "Key Performance Indicators\nCurrent Ratio(11) 1.76 1.63 1.57")]
    got = read_ratio(kpi, "current_ratio", FY25)
    assert got["reason"] == "ratio_note_not_in_document"
    assert got["current_ratio_line_pages"] == [41]
    assert read_ratio([(1, "no ratios")], "current_ratio", FY25)["current_ratio_line_pages"] == []


def test_a_mid_month_date_is_not_a_period_heading():
    """German Green's variance caption '2024-25 March 2025' contains '25 March
    2025'; a statement period ends on a month's last day."""
    from financial_ratios import period_tokens
    # The caption reads as four periods out of order, so it never passes as a header.
    assert [d for d, _l in period_tokens("2025-26 2024-25 March 2025 to March 2026")] == [
        (2026, 3, 31), (2025, 3, 31), (2025, 3, 31), (2026, 3, 31)]
    assert period_tokens("allotted on 25 March 2025") == []
    assert period_tokens("to March 25") == []
    got = [d for d, _l in period_tokens("30/09/2024 31/03/2024")]
    assert got == [(2024, 9, 30), (2024, 3, 31)]


@pytest.mark.parametrize("heading,dates", [
    ("FY25 FY24", [(2025, 3, 31), (2024, 3, 31)]),
    ("FY'25 FY'24", [(2025, 3, 31), (2024, 3, 31)]),
    ("Mar-25 Mar-24", [(2025, 3, 31), (2024, 3, 31)]),
    ("March 2025 March 2024", [(2025, 3, 31), (2024, 3, 31)]),
    ("2024-25 2023-24", [(2025, 3, 31), (2024, 3, 31)]),
    ("Sep-24 Mar-24", [(2024, 9, 30), (2024, 3, 31)]),
])
def test_short_fiscal_year_headings_map_to_31_march(heading, dates):
    """#771 r3 review MINOR: Indian fiscal years end 31 March, so FY25,
    Mar-25, March 2025 and a bare 2024-25 all name 31-Mar-2025."""
    from financial_ratios import period_tokens
    assert [d for d, _l in period_tokens(heading)] == dates
    got = read_ratio(_note(_HEAD.format(heading),
                           "1 Current Ratio Current Assets Current Liabilities 1.40 1.25 12.00%"),
                     "current_ratio", dates[0])
    assert got["value"] == 1.40, got


@pytest.mark.parametrize("heading", ["Mar 25 Mar 24", "2024-26 2023-25", "25 March 2025 24 March 2024", "FY 2025 25"])
def test_ambiguous_short_headings_are_still_refused(heading):
    """'Mar 25' may be 25 March; 2024-26 is not one fiscal year; a mid-month
    date is a date, not a period."""
    got = read_ratio(_note(_HEAD.format(heading),
                           "1 Current Ratio Current Assets Current Liabilities 1.40 1.25 12.00%"),
                     "current_ratio", (2025, 3, 31))
    assert got["value"] is None, got


# ------------------------------------------------ #1420 / F-219: wrapped labels
# A printed row whose LABEL wraps around its value line was read as absent
# (ratio_row_not_in_note). Two real notes print it that way:
#   German Green p440: "Inventory Turnover <prose>" / "5 Total Revenue ... 5.63
#   6.02 8.85 -6.41% (31.97)%" / "Ratio <prose>"
#   Water Infra p427:  "Inventory Turnover" / "over Average 3.00 3.57 4.67
#   (16.02%) (23.51%) - -" / "Ratio"


@pytest.mark.parametrize("fixture,latest,value", [
    ("german-green-steel-ratio-analysis.txt", FY26, 5.63),
    ("german-green-steel-ratio-analysis.txt", FY25, 6.02),
    ("water-infra-ratios-analysis.txt", FY25, 3.00),
])
def test_a_wrapped_inventory_turnover_label_is_read(fixture, latest, value):
    got = read_ratio(pages(fixture), "inventory_turnover", latest)
    assert got.get("value") == value, got


def test_a_wrapped_label_is_not_stitched_across_another_ratios_row():
    """The join is bounded to head / ONE values line / tail. A values line that
    carries another ratio's label belongs to that ratio, not to the wrapped one."""
    note = _note(_HEAD.format("FY 25-26 FY 24-25"),
                 "Inventory Turnover",
                 "6 Trade Receivables Turnover Ratio Revenue Receivables 7.10 6.90 2.90%",
                 "Ratio")
    got = read_ratio(note, "inventory_turnover", FY26)
    assert got.get("value") is None and got["reason"] == "ratio_row_not_in_note", got


def test_a_wrapped_label_with_values_on_the_head_line_is_read():
    """Synthetic layout (no real fixture yet): the serial, the label head and
    the values on one line, the label's last word alone on the next."""
    note = _note(_HEAD.format("FY 25-26 FY 24-25"),
                 "5 Inventory Turnover Cost of goods sold Average inventory 4.40 4.10 7.32%",
                 "Ratio")
    assert read_ratio(note, "inventory_turnover", FY26).get("value") == 4.40


# Item 46 (OD-165, #1179). NSE RHP: the locator matched three pages on the prose
# words "financial ratios" and the document prints no Current Ratio anywhere
# (measured over all 668 pages). The answer is "no note", with the page evidence
# the verdict reads (empty), never ratio_row_not_in_note.
def test_prose_ratio_mentions_with_no_current_ratio_anywhere_is_no_note():
    read = read_ratio(pages("nse-rhp-no-current-ratio-printed.txt"), "current_ratio", (2026, 3, 31))
    assert read["value"] is None
    assert read["reason"] == "ratio_note_not_in_document"
    assert read["current_ratio_line_pages"] == []


def test_a_current_ratio_printed_elsewhere_keeps_the_miss_open():
    # Fail closed: any Current Ratio mention (here a peer working-capital table,
    # Shah Investor's Home RHP p376 shape) means the row may exist, so the miss
    # stays a miss and is never claimed as "no note".
    extra = (376, "Particulars\nConsolidated Consolidated\nCurrent ratio 1.36 1.28 2.04 1.56\n")
    read = read_ratio(pages("nse-rhp-no-current-ratio-printed.txt") + [extra], "current_ratio", (2026, 3, 31))
    assert read["reason"] == "ratio_row_not_in_note"


def test_a_current_ratio_label_wrapped_across_lines_keeps_the_miss_open():
    extra = (400, "1 Current\nRatio Current assets Current liabilities\n")
    read = read_ratio(pages("nse-rhp-no-current-ratio-printed.txt") + [extra], "current_ratio", (2026, 3, 31))
    assert read["reason"] == "ratio_row_not_in_note"


@pytest.mark.parametrize("printed", ["CurrentRatio 1.36 1.28", "Current-Ratio 1.36 1.28", "Current Ratio 1.36"])
def test_a_glued_or_hyphenated_current_ratio_keeps_the_miss_open(printed):
    extra = (376, "Particulars\n" + printed + "\n")
    read = read_ratio(pages("nse-rhp-no-current-ratio-printed.txt") + [extra], "current_ratio", (2026, 3, 31))
    assert read["reason"] == "ratio_row_not_in_note", read


def test_a_glued_inventory_turnover_keeps_the_miss_open():
    extra = (400, "InventoryTurnover 4.1 3.9\n")
    pg = pages("nse-rhp-no-current-ratio-printed.txt") + [extra]
    from financial_ratios import _ratio_named_anywhere
    assert _ratio_named_anywhere(pg, "inventory_turnover")
