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
