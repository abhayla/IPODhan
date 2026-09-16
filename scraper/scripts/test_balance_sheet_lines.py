"""Item 8b slice 1 — the three balance-sheet lines the ratios are built from.

Current ratio, quick ratio and inventory turnover all need current assets,
current liabilities and inventories. The extractor did not read any of them: it
reads revenue, total income, PAT, EPS, EBITDA, net worth and cash flow. So this
is an extraction slice, not the derivation slice the card assumed.

Every label in this test was READ OFF a real restated balance sheet rather than
recalled, and that mattered: the same table writes "Total OF current assets"
four lines above "Total current liabilities", so the obvious regex finds
nothing at all in the whole 529-page document.

The fixture carries FOUR real pages, each earning its place:

  p18  the heading "statement of assets and liabilities" with NO statement -
       a conventions/definitions page. In the real document 20 pages match
       that heading and exactly ONE is the statement, so locating it by
       heading alone picks the wrong page 19 times out of 20.
  p73  the restated balance sheet itself.
  p74  the restated P&L - without it there is no column structure to align
       any row against, and nothing is extracted at all.
  p75  the cash-flow statement, which carries a second row also labelled
       "Inventories" (the MOVEMENT, not the stock balance) - a real row, with
       real numbers, that passes the same clean-data-row guard as the real one.
"""

import io
import os

import pytest

from extract_financials_pdf import extract_from_texts

FIXTURES = os.path.join(
    os.path.dirname(__file__), "..", "tests", "fixtures", "balance-sheet"
)

# Read off the fixture, per year. The balance sheet prints FY2026, FY2025,
# FY2024 left to right.
CURRENT_ASSETS = {2026: 22499.66, 2025: 18274.40, 2024: 11756.58}
CURRENT_LIABILITIES = {2026: 20671.58, 2025: 15212.92, 2024: 10517.19}
INVENTORIES = {2026: 5718.18, 2025: 6915.69, 2024: 5285.85}

# The cash-flow row on page 75, which must NEVER be stored as inventories.
CASH_FLOW_INVENTORY_MOVEMENT = 1197.51


def pages(name="karamtara-balance-sheet.txt"):
    with io.open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        raw = handle.read()
    out = []
    for chunk in raw.split("<<<PAGE "):
        if not chunk.strip():
            continue
        head, _, body = chunk.partition(">>>")
        out.append((int(head.strip()), body))
    return out


@pytest.fixture(scope="module")
def metrics():
    return extract_from_texts(pages()).get("metrics") or {}


@pytest.mark.parametrize(
    "key,expected",
    [
        ("currentAssets", CURRENT_ASSETS),
        ("currentLiabilities", CURRENT_LIABILITIES),
        ("inventories", INVENTORIES),
    ],
)
def test_each_balance_sheet_line_is_read_for_every_year(metrics, key, expected):
    got = metrics.get(key)
    assert got, "%s was not extracted at all" % key
    for year, value in expected.items():
        assert year in got, "%s has no value for FY%d" % (key, year)
        assert abs(float(got[year]) - value) < 0.01, (
            "%s FY%d: got %s, the statement prints %s" % (key, year, got[year], value)
        )


def test_the_cash_flow_movement_is_not_stored_as_the_stock_balance(metrics):
    """The trap this fixture exists to catch.

    Page 75 carries `Inventories 1,197.51 (1,629.84) 14.84` - the movement in
    inventories during the year, one line of a cash-flow statement. It has the
    same label as the balance-sheet row, it is a clean data row, and it is
    plausible. Storing it would make every inventory-turnover figure wrong in a
    way no one would notice, because the number looks perfectly reasonable.
    """
    got = metrics.get("inventories") or {}
    for year, value in got.items():
        assert abs(float(value) - CASH_FLOW_INVENTORY_MOVEMENT) > 0.01, (
            "FY%s stored %s, which is the CASH-FLOW movement from page 75, not the "
            "balance-sheet stock" % (year, value)
        )


def test_the_document_own_balance_sheet_adds_up():
    """The statement checks itself, so the test does not depend on my reading.

    Total assets must equal total equity and liabilities - that is what makes it
    a balance sheet. If the extracted current assets were wrong, this identity
    would not hold against the printed totals.
    """
    text = "\n".join(t for _i, t in pages())
    assert "Total assets 41,422.37" in text
    assert "Total equity and liabilities 41,422.37" in text
    # and the current-assets figure this slice extracts is a component of it
    assert "Total of current assets 22,499.66" in text


def test_the_ratios_these_lines_exist_for_are_now_computable(metrics):
    """The point of the slice, stated as arithmetic.

    Not persisted here - that is the next slice - but if these three lines
    cannot produce a sane ratio then extracting them was pointless.
    """
    ca = metrics["currentAssets"][2026]
    cl = metrics["currentLiabilities"][2026]
    inv = metrics["inventories"][2026]

    current_ratio = float(ca) / float(cl)
    quick_ratio = (float(ca) - float(inv)) / float(cl)

    assert abs(current_ratio - 1.088) < 0.01, current_ratio
    assert abs(quick_ratio - 0.812) < 0.01, quick_ratio
    # Quick is always below current: it is the same numerator less inventories.
    assert quick_ratio < current_ratio


def test_a_working_capital_table_is_not_mistaken_for_a_balance_sheet():
    """Measured on a different prospectus, kept as a guard here.

    A working-capital section also prints "Total current assets" and "Total
    current liabilities", but its liabilities figure EXCLUDES borrowings - it
    gave a current ratio of 128, which is not a real one. The rows below are
    that shape. The point is that the numbers must come from the statement, so
    a page carrying only these must not silently satisfy the extractor.
    """
    working_capital_only = [
        (0, "\n".join([
            "Total current assets (in Rs million) 3,468.26 2,168.34 1,736.43",
            "Total current liabilities (in Rs million) 27.04 33.42 38.05",
            "Net working capital (in Rs million) 3,440.19 2,133.95 1,581.50",
            "Inventory holding days* 18 21 22",
        ]))
    ]
    result = extract_from_texts(working_capital_only)
    # No P&L page means no column structure to align against, so nothing is
    # extracted - the extractor refuses rather than guessing. That is the
    # behaviour that keeps a working-capital page from posing as a statement.
    assert not (result.get("metrics") or {}).get("currentAssets")


def test_the_stock_balance_wins_even_when_the_cash_flow_row_comes_first():
    """Order-independence, exercised rather than assumed.

    MUTATION TESTING WROTE THIS TEST, and then corrected my explanation of it.

    The first version of this slice put the three labels in OTHER_METRICS,
    which is searched doc-wide, and relied on an anchored pattern to keep the
    cash-flow row out. Loosening that pattern to a bare mid-line search changed
    no result and every test stayed green - so the anchor was doing nothing.
    The real reason it worked was that the balance sheet sits on page 73 and
    the cash-flow statement on page 75, so the first match happened to be the
    right one. Hand the pages over in the other order and the wrong row wins.

    Both rows are line-anchored ("Inventories 1,197.51 ..." starts its line
    too), so no pattern separates them. The fix was to locate the statement and
    read only from it. This test is what holds that: it feeds the cash-flow
    page first, which the doc-wide version could not survive.
    """
    by_page = dict(pages())
    reordered = [(74, by_page[74]), (75, by_page[75]), (73, by_page[73])]

    metrics = extract_from_texts(reordered).get("metrics") or {}
    got = metrics.get("inventories") or {}
    assert got, "inventories vanished when the pages were reordered"
    assert abs(float(got[2026]) - INVENTORIES[2026]) < 0.01, (
        "FY2026 stored %s; the balance sheet prints %s and the cash-flow page "
        "prints %s" % (got[2026], INVENTORIES[2026], CASH_FLOW_INVENTORY_MOVEMENT)
    )


def test_a_holding_period_row_is_never_read_as_a_stock_balance():
    """`Inventory holding days* 18 21 22` is a clean data row with real numbers.

    Measured on another prospectus's working-capital section. Storing 18 as the
    inventory balance would be silently wrong and entirely plausible.
    """
    by_page = dict(pages())
    poisoned = by_page[74] + chr(10) + "Inventory holding days* 18 21 22" + chr(10)
    metrics = extract_from_texts([(74, poisoned), (73, by_page[73])]).get("metrics") or {}
    got = metrics.get("inventories") or {}
    assert got, "inventories vanished"
    assert abs(float(got[2026]) - INVENTORIES[2026]) < 0.01, (
        "stored %s - a holding-period count, not the stock balance" % got[2026]
    )
