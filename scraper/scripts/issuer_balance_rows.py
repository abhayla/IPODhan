"""Issuer balance-sheet totals and return on equity, read off an offer document (OD-165, item 46).

Three financial_data fields the document prints and no reader took (spec §1.4 rows 65, 67, 68):

* ``total_assets_by_fy``   - the "TOTAL ASSETS" row of the restated statement of assets and
  liabilities (row 68, crore after the document's unit).
* ``reserves_by_fy``       - the "Other equity" (Ind AS) / "Reserves and surplus" row of the same
  statement (row 67).
* ``roe_by_fy``            - the issuer's "Return on Equity" KPI row, in percent (row 65).

Fail-closed rules (each returns a reason instead of a value, never a guess):

* The statement is a page carrying the balance-sheet heading AND a clean TOTAL ASSETS data row.
  Of several (summary, consolidated annexure, standalone annexure), only those on the basis the
  P&L page labels itself with are eligible (a basis that cannot be told fails closed), and of
  those the one nearest the P&L page is used, so the totals and the P&L share one basis.
* Its columns are mapped from that page's OWN year header; no header, no read.
* Two reserves rows on the statement that disagree are refused.
* Every clean ROE row in the document is read; rows that disagree on a shared year are refused,
  a row with no percent sign is not an ROE in percent and is skipped, and a value outside
  -100..100 in a year the issuer made a profit is refused (spec row 65 check).
"""
import re

from extract_financials_pdf import (
    _BALANCE_SHEET_HEADING,
    _align_factory,
    _inline_period_columns,
    _PERIOD_END,
    _YEARS_ONLY_LINE,
    _is_clean_data_row,
    _stacked_header_columns,
    _year_header_years,
)

TOTAL_ASSETS_RX = re.compile(r"^\s*t\s?otal\s+assets\b", re.I)
RESERVES_RX = re.compile(r"^\s*(?:other\s+equity|reserves\s*(?:and|&)\s*surplus)\b", re.I)
ROE_RX = re.compile(r"^\s*(?:return\s+on\s+(?:average\s+)?equity|RoE)\b", re.I)
_HEADER_LINES = 12


def _clean_rows(lines, rx):
    out = []
    for ln in lines:
        m = rx.search(ln)
        if m and _is_clean_data_row(ln, m.end()):
            out.append(ln)
    return out


_CONSOLIDATED_RX = re.compile(r"\bconsolidated\b", re.I)
_STANDALONE_RX = re.compile(r"\bstand\s*-?\s*alone\b", re.I)


def _basis(text):
    """The basis a statement page labels itself with: 'consolidated', 'standalone', None (no label)
    or 'both' (a page naming both cannot be told)."""
    c, s = bool(_CONSOLIDATED_RX.search(text or "")), bool(_STANDALONE_RX.search(text or ""))
    return "both" if c and s else "consolidated" if c else "standalone" if s else None


def _statement_page(page_texts, pnl_page):
    """(page, text, None), or (None, None, reason). Step-2 review (item 4): the statement must be on
    the basis the P&L page labels itself with (restated consolidated vs standalone), so the totals and
    the P&L figures share one basis; of those, the one nearest the P&L page. An unlabelled P&L page
    matches only unlabelled statements, and only when the document's statement pages do not print both
    bases. With no P&L page every statement must share one basis. Anything else fails closed."""
    cands = [(i, t) for i, t in page_texts
             if _BALANCE_SHEET_HEADING.search(t or "")
             and _clean_rows((t or "").split("\n"), TOTAL_ASSETS_RX)]
    if not cands:
        return None, None, "balance_sheet_total_assets_row_not_in_document"
    labels = {i: _basis(t) for i, t in cands}
    if pnl_page is None:
        told = set(labels.values())
        if len(told) != 1 or "both" in told:
            return None, None, "balance_sheet_basis_not_told"
        return cands[0][0], cands[0][1], None
    pnl_text = next((t for i, t in page_texts if i == pnl_page), None)
    if pnl_text is None:
        return None, None, "balance_sheet_basis_not_told"
    want = _basis(pnl_text)
    printed = set(labels.values()) | {want}
    if want == "both" or (want is None and {"consolidated", "standalone"} <= printed):
        return None, None, "balance_sheet_basis_not_told"
    same = [c for c in cands if labels[c[0]] == want]
    if not same:
        return None, None, "balance_sheet_basis_does_not_match_pnl"
    page, text = min(same, key=lambda c: (abs(c[0] - pnl_page), c[0]))
    return page, text, None


def _one_series(rows, align, what):
    """(series, None) when every row maps and they agree, else (None, reason)."""
    series = [align(r) for r in rows]
    if not rows:
        return None, "%s_row_not_on_statement" % what
    if any(s is None for s in series):
        return None, "%s_row_columns_do_not_match_the_year_header" % what
    first = series[0]
    for s in series[1:]:
        if s != first:
            return None, "%s_rows_disagree" % what
    return {str(k): v for k, v in first.items()}, None


def read_balance_totals(page_texts, pnl_page):
    """{'total_assets_by_fy': (series, page, reason), 'reserves_by_fy': (...)}."""
    page, text, why = _statement_page(page_texts, pnl_page)
    if page is None:
        return {"total_assets_by_fy": (None, None, why), "reserves_by_fy": (None, None, why)}
    lines = text.split("\n")
    # Round 4 item 2 (D11): an RHP's statement stacks its header ("June 30, June 30, March 31, March 31,
    # March 31," over "2026 2025 2026 2025 2024", NSE RHP p86). The two lines are paired column for
    # column; a stub column is read and dropped, so each fiscal year takes its own March 31 column. A
    # stacked header that does not pair is refused, never read as the plain year list.
    stacked = _stacked_header_columns(lines[:_HEADER_LINES])
    if stacked == "UNRESOLVED":
        why = "balance_sheet_stacked_header_unresolved"
        return {"total_assets_by_fy": (None, page, why), "reserves_by_fy": (None, page, why)}
    if stacked is not None:
        column_fy = list(stacked)
        years = [y for y in column_fy if y is not None]
    else:
        years = _year_header_years("\n".join(lines[:_HEADER_LINES]))
        column_fy = years
    if len(years) < 2:
        why = "balance_sheet_year_header_not_found"
        return {"total_assets_by_fy": (None, page, why), "reserves_by_fy": (None, page, why)}
    align = _align_factory(column_fy, years)
    assets, a_why = _one_series(_clean_rows(lines, TOTAL_ASSETS_RX), align, "total_assets")
    reserves, r_why = _one_series(_clean_rows(lines, RESERVES_RX), align, "reserves")
    mismatch = "_row_columns_do_not_match_the_year_header"
    if stacked is None and any(w and w.endswith(mismatch) for w in (a_why, r_why)):
        # D11, AceVector DRHP p314: a one-line header naming each column's period end with its year
        # ("September 30, 2025 ... March 31, 2023"). Tried only when the plain year reading could
        # not map a row, so a statement read today is read exactly as before; unpairable = refused.
        inline = _inline_period_columns(lines[:_HEADER_LINES])
        if inline is not None and inline != "UNRESOLVED":
            strict = _align_factory(inline, [y for y in inline if y is not None], strict=True)
            # Only a series that failed on the mismatch is re-read; one already read stays as it is.
            if a_why and a_why.endswith(mismatch):
                assets, a_why = _one_series(_clean_rows(lines, TOTAL_ASSETS_RX), strict, "total_assets")
            if r_why and r_why.endswith(mismatch):
                reserves, r_why = _one_series(_clean_rows(lines, RESERVES_RX), strict, "reserves")
    if assets is not None and any(v <= 0 for v in assets.values()):
        assets, a_why = None, "total_assets_not_positive"
    if assets is not None and reserves is not None and any(
            reserves[y] > assets[y] for y in reserves if y in assets):
        assets, reserves = None, None
        a_why = r_why = "reserves_exceed_total_assets"
    return {"total_assets_by_fy": (assets, page, a_why),
            "reserves_by_fy": (reserves, page, r_why)}


_GROUP_HEADER_LINES = 3


def _is_march_31(m):
    return (m.group(1) or m.group(4)).lower() == "march" and int(m.group(2) or m.group(3)) == 31


def _row_columns(lines, row_index, annual_years):
    """column_fy for the table a row sits in, from the nearest years-only header line above it, or
    None (no such header: the caller keeps the annual-columns-only reading).

    Round 4 item 2 (D11). Two header shapes carry a stub period beside the fiscal years:
    * stacked, one period end per column ("June 30, June 30, March 31, ..." over the years) - paired
      column for column by `_stacked_header_columns`;
    * grouped, one label per GROUP of columns ("As of and for the three months period ended June 30,
      | As of and for the Fiscal ended March 31," over "2026 2025 2026 2025 2024", NSE RHP p141/p212).
      pdfplumber wraps the group labels, so their text order is not the column order (p141 prints
      "March 31," before the wrapped "June 30,"). Accepted only when the label block names both a
      March 31 and another period end, the years line ends with exactly the statement's fiscal years
      (newest first), and the one or two leading years (the stub group) run newest first: those leading
      columns are read and dropped. A fiscal-first layout (2026 2025 2024 2026 2025) does not end with
      the fiscal years and is refused. Any other grouped header is "UNRESOLVED" (never guessed)."""
    for k in range(row_index - 1, -1, -1):
        if not _YEARS_ONLY_LINE.match(lines[k]):
            continue
        window = lines[max(0, k - _GROUP_HEADER_LINES):k + 1]
        stacked = _stacked_header_columns(window)
        if stacked is not None and stacked != "UNRESOLVED":
            return stacked
        label = " ".join(lines[max(0, k - _GROUP_HEADER_LINES):k])
        ends = list(_PERIOD_END.finditer(label))
        stubs = [m for m in ends if not _is_march_31(m)]
        if not stubs or len(stubs) == len(ends):
            # No stub period named (or no March 31): the table carries only fiscal-year columns, and
            # the annual-columns-only reading applies unchanged.
            return None
        years = [int(y) for y in re.findall(r"20\d{2}", lines[k])]
        fy = sorted(annual_years, reverse=True)
        n = len(years) - len(fy)
        lead = years[:n]
        if (not 1 <= n <= 2 or years[n:] != fy
                or any(a <= b for a, b in zip(lead, lead[1:]))):
            return "UNRESOLVED"
        return [None] * n + fy
    return None


def read_roe(page_texts, annual_years, pat_by_fy=None):
    """(series, page, reason) for the issuer's Return on Equity, in percent."""
    if len(annual_years) < 1:
        return None, None, "fiscal_years_unknown"
    plain = _align_factory(list(annual_years), list(annual_years))
    found, unmapped = [], None
    for i, t in page_texts:
        lines = (t or "").split("\n")
        for j, ln in enumerate(lines):
            m = ROE_RX.search(ln)
            if not (m and _is_clean_data_row(ln, m.end())) or "%" not in ln:
                continue
            columns = _row_columns(lines, j, annual_years)
            if columns == "UNRESOLVED":
                s = None
            elif columns is not None:
                s = _align_factory(list(columns), [y for y in columns if y is not None])(ln.replace("%", " "))
            else:
                s = plain(ln.replace("%", " "))
            if s:
                found.append((i, {str(k): v for k, v in s.items()}))
            elif unmapped is None:
                unmapped = i
    if not found:
        if unmapped is not None:
            return None, unmapped, "roe_row_columns_do_not_match_the_fiscal_years"
        return None, None, "roe_row_not_in_document"
    page, first = found[0]
    for _p, s in found[1:]:
        if any(abs(s[y] - first[y]) > 0.005 for y in s if y in first):
            return None, page, "roe_rows_disagree"
    pat = {str(k): v for k, v in (pat_by_fy or {}).items()}
    for y, v in first.items():
        loss_year = pat.get(y) is not None and pat[y] < 0
        if not loss_year and not -100 <= v <= 100:
            return None, page, "roe_outside_minus_100_to_100"
    return first, page, None
