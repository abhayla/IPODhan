"""OD-172 (owner, 2026-10-07): when an offer document prints both a plain "EBITDA" row and a
qualified one ("Operating EBITDA", "Adjusted EBITDA", ...), the EBITDA fields take the plain row; a
qualified row is used only when no plain EBITDA row exists. Two plain rows that disagree under the
same column map give no EBITDA (fail closed). Independent of row and page order.

Fixture: SRIT India DRHP (DRHP-a6abfd34) p281 (restated P&L, the chosen page) and p329 (KPI table:
"EBITDA ... 369.73 609.64 521.18 335.87" above "Operating EBITDA ... 320.74 498.09 409.85 225.05"),
text by pdfplumber page.extract_text().

Run:  cd scraper && python -m pytest scripts/test_extract_financials_plain_ebitda.py -q
"""
import io
import os

from extract_financials_pdf import extract_from_texts

HERE = os.path.dirname(__file__)
FIXTURE = os.path.join(HERE, "..", "tests", "fixtures", "financial-statements",
                       "srit-drhp-plain-and-operating-ebitda.txt")
NSE_FIXTURES = [os.path.join(HERE, "..", "tests", "fixtures", "financial-statements", name)
                for name in ("nse-rhp-restated-summary-stacked-header.txt",
                             "nse-drhp-restated-pnl-eps-continuation.txt")]
PLAIN_LINE = "EBITDA (in Rs. million) (refer below note 6) 369.73 609.64 521.18 335.87"
OPERATING_LINE = "Operating EBITDA (in Rs. million) (refer below note 7) 320.74 498.09 409.85 225.05"
PLAIN = {2025: 609.64, 2024: 521.18, 2023: 335.87}
OPERATING = {2025: 498.09, 2024: 409.85, 2023: 225.05}


def _pages(path=FIXTURE):
    with io.open(path, encoding="utf-8") as handle:
        raw = handle.read().replace("\r\n", "\n")
    out = []
    for chunk in raw.split("<<<PAGE "):
        if not chunk.strip():
            continue
        head, _, body = chunk.partition(">>>")
        out.append((int(head.strip()), body.lstrip("\n")))
    return out


def _with_kpi(transform):
    pages = dict(_pages())
    kpi = pages[329]
    assert PLAIN_LINE in kpi and OPERATING_LINE in kpi
    new = transform(kpi)
    assert new != kpi or transform is _same, "mutation did not apply"
    pages[329] = new
    return sorted(pages.items())


def _same(text):
    return text


def _ebitda(pages):
    out = extract_from_texts(pages)
    assert out["pnlPage"] == 281
    return out["metrics"].get("ebitda"), out


def test_plain_row_above_operating_row_gives_the_plain_figures():
    got, _o = _ebitda(_with_kpi(_same))
    assert got == PLAIN


def test_operating_row_first_still_gives_the_plain_figures():
    swapped = lambda t: t.replace(PLAIN_LINE + "\n" + OPERATING_LINE, OPERATING_LINE + "\n" + PLAIN_LINE)
    got, _o = _ebitda(_with_kpi(swapped))
    assert got == PLAIN


def test_operating_row_on_an_earlier_page_than_the_plain_row_still_gives_the_plain_figures():
    pages = _with_kpi(lambda t: t.replace(OPERATING_LINE + "\n", ""))
    header = "Particulars\nSeptember 30, 2025* March 31, 2025 March 31, 2024 March 31, 2023\n"
    pages = [(10, header + OPERATING_LINE + "\n")] + pages
    got, _o = _ebitda(pages)
    assert got == PLAIN


def test_only_an_operating_row_is_used_when_no_plain_row_exists():
    got, _o = _ebitda(_with_kpi(lambda t: t.replace(PLAIN_LINE + "\n", "")))
    assert got == OPERATING


def test_two_plain_rows_that_disagree_give_no_ebitda():
    other = PLAIN_LINE.replace("609.64", "611.00")
    got, out = _ebitda(_with_kpi(lambda t: t.replace(OPERATING_LINE, other)))
    assert got is None
    assert "ebitda" not in out["rejected"]


def test_a_ratio_to_ebitda_row_is_never_ebitda():
    got, _o = _ebitda(_with_kpi(lambda t: t.replace(
        PLAIN_LINE + "\n", "Net debt to EBITDA (times) 0.10 0.20 0.30 0.40\n").replace(
        OPERATING_LINE + "\n", "")))
    assert got is None


def test_nse_ebitda_is_unchanged():
    # Read before OD-172 (code at 235e4d497): neither NSE fixture prints an EBITDA row the reader
    # takes. The full NSE DRHP is compared on its saved page texts by the supervisor's wide check.
    got = {os.path.basename(p): extract_from_texts(_pages(p))["metrics"].get("ebitda") for p in NSE_FIXTURES}
    assert got == {"nse-rhp-restated-summary-stacked-header.txt": None,
                   "nse-drhp-restated-pnl-eps-continuation.txt": None}


# Fix A3 review round 1: a percent, margin, ratio, quotient, per-share or growth line naming EBITDA is
# never an EBITDA amount, plain or qualified.
import re  # noqa: E402

import pytest  # noqa: E402

from extract_financials_pdf import OTHER_METRICS, _QUALIFIED_EBITDA  # noqa: E402

_PLAIN_RX = next(rx for rx, key in OTHER_METRICS if key == "ebitda")


@pytest.mark.parametrize("line", [
    "EBITDA (%) 12.1 13.2 14.3",
    "EBITDA margin (%) 12.1 13.2 14.3",
    "EBITDA Margin 12.1 13.2 14.3",
    "Debt to Adjusted EBITDA 1.2 1.3 1.4",
    "Net debt to EBITDA 1.2 1.3 1.4",
    "EBITDA/Total income 0.12 0.13 0.14",
    "EBITDA as % of revenue 12.1 13.2 14.3",
    "EBITDA as a percentage of revenue 12.1 13.2 14.3",
    "EBITDA growth 12.1 13.2 14.3",
    "Adjusted EBITDA margin (%) 12.1 13.2 14.3",
])
def test_a_ratio_or_percent_line_is_neither_plain_nor_qualified(line):
    assert not _PLAIN_RX.search(line)
    assert not _QUALIFIED_EBITDA.search(line)


@pytest.mark.parametrize("line", [
    "EBITDA(3) 6,383.23 19,869.53 23,826.22 18,421.62",
    "EBITDA (C) 6,383.23 19,869.53 23,826.21 18,421.62",
    PLAIN_LINE,
    "EBITDA 320.74 498.09 409.85 225.05",
])
def test_a_plain_amount_line_is_plain(line):
    assert _PLAIN_RX.search(line)


@pytest.mark.parametrize("line", [
    "Operating EBITDA 320.74 498.09 409.85 225.05",
    "Adjusted EBITDA 320.74 498.09 409.85 225.05",
    OPERATING_LINE,
])
def test_a_qualified_amount_line_is_qualified_not_plain(line):
    assert _QUALIFIED_EBITDA.search(line)
    assert not _PLAIN_RX.search(line)


def test_a_percent_row_on_the_chosen_page_does_not_make_the_real_row_ambiguous():
    got, out = _ebitda(_with_kpi(lambda t: t.replace(
        OPERATING_LINE, "EBITDA (%) 12.10 13.20 14.30 15.40")))
    assert got == PLAIN and not out.get("ebitdaAmbiguous")


def test_a_debt_to_adjusted_ebitda_ratio_is_never_the_ebitda():
    got, out = _ebitda(_with_kpi(lambda t: t.replace(PLAIN_LINE + "\n", "").replace(
        OPERATING_LINE, "Debt to Adjusted EBITDA 1.20 1.30 1.40 1.50")))
    assert got is None
    assert "ebitda" not in out["rejected"]  # never read at all, not read and then rejected
