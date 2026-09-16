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
    read_printed_ratios,
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


def test_the_printed_current_ratio_is_read_exactly_as_printed():
    got = read_printed_ratios(pages())
    assert got["current_ratio"][:2] == [1.54, 1.34], got["current_ratio"]


def test_the_printed_inventory_turnover_is_read_exactly_as_printed():
    """This is the number that CANNOT be recomputed from the statements.

    Measured on Karamtara, which prints 4.09 and 3.57: cost of material over
    average inventory gives 4.074 / 3.491, plus the inventory change 3.989 /
    3.492, over closing stock 4.501 / 3.080. The numerator needed is 99.85
    higher one year and 481.54 the next - not a constant, so no fixed
    adjustment exists. Reading the printed figure is the only way to agree with
    the document.
    """
    got = read_printed_ratios(pages())
    assert got["inventory_turnover"][:2] == [5.59, 5.75], got["inventory_turnover"]


def test_the_split_digit_mangling_is_repaired_where_it_actually_occurs():
    """'1 .54' must come back as 1.54, not as 1 and 0.54, and not as 154.

    The fixture keeps the mangling on purpose. `_normalize_numbers` in the
    shared extractor does NOT repair these rows - its split-digit rule requires
    two such tokens on a line and these carry one - so this slice repairs inside
    the value span it has already identified.
    """
    raw = "\n".join(t for _i, t in pages())
    assert "1 .54" in raw, "the fixture was tidied; the repair is no longer exercised"
    assert "5 .59" in raw, "the fixture was tidied; the repair is no longer exercised"

    got = read_printed_ratios(pages())
    for value in got["current_ratio"] + got["inventory_turnover"]:
        assert 0.01 < value < 1000, "%s looks like a mis-joined number" % value


def test_the_second_period_table_is_read_too():
    """The note prints FY25-26 against FY24-25, then FY24-25 against FY23-24.
    Both tables are real disclosures and the reader must not stop at the first.
    """
    got = read_printed_ratios(pages())
    assert len(got["current_ratio"]) >= 4, got["current_ratio"]
    assert 1.19 in got["current_ratio"], got["current_ratio"]


def test_a_document_with_no_ratio_note_yields_nothing_rather_than_guessing():
    assert read_printed_ratios([(0, "A prospectus with no such note at all.")]) == {}


def test_only_the_two_ratios_this_item_wants_are_taken():
    """The note lists ten ratios - debt-equity, return on equity, receivables
    turnover and more. Reading them all would quietly widen this item's scope
    into fields nobody has asked for or designed a column for."""
    got = read_printed_ratios(pages())
    assert set(got) == {"current_ratio", "inventory_turnover"}, sorted(got)


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
    got = read_printed_ratios(stray)
    assert 9.99 not in got.get("current_ratio", []), got
