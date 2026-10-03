"""Offer-document readers for six printed financial fields no DRHP / RHP / prospectus reader took.

Spec rows 66, 69 (financial_data.debt_to_equity / total_borrowing, D10), 75 (financial_data.ronw),
92 (financial_statements.op_cash_flow), 102 (ipo_valuation.ronw_weighted_3y) and the
financial_statements.rent_expense field (Appendix A row 122). The price band advertisement's readers
(`extract_price_band_ad`) are NOT reused: they match a flat newspaper row and read wrong values off
offer-document prose. Every reader here fails closed: a reason instead of a value, never a guess.

* ``read_ronw_block``      - the "Return on Net Worth" block of the Basis for Offer Price chapter:
  one row per period ("March 31, 2026 33.21% 3"), then "Weighted Average 37.92%". Only March 31
  (full fiscal year) rows are read; a stub-period row is never a fiscal year (D11). When the block
  prints weights and a weighted average, the average must be reproducible from the rows, else both
  are refused (a mis-read column). Two blocks that disagree are refused.
* ``read_statement_row``   - one row of a restated statement (operating cash flow, rent expense),
  mapped to fiscal years by the NEAREST date header above it (full dates, DD.MM.YYYY, Fiscal /
  FY forms, stacked period/year lines); stub columns are read and dropped. The page must carry the
  statement's own heading, state its own unit, and be on the basis the P&L page labels itself with
  (issuer_balance_rows' rule). Every eligible row must agree, and the series must cover every
  fiscal year of the P&L (spec row 92, C3: same year set as C1).
* ``read_capitalisation``  - the Capitalisation Statement's total-borrowings row (pre-offer column)
  and its total-borrowings / total-equity ratio row. D10 (spec rows 66, 69): a "-" or "Nil" in the
  total-borrowings row is 0; debt_to_equity is 0 ONLY when total borrowing is 0 by that rule; "NA"
  alone is never a number. The statement must be as at March 31 of the P&L's latest fiscal year
  (D11: a stub-date statement is not the fiscal-year snapshot financial_data holds).
"""
import re

from extract_financials_pdf import _normalize_numbers, _stacked_header_columns
import issuer_balance_rows

# ---------------------------------------------------------------------------- units
_UNIT_RX = re.compile(
    r"in\s+(?:[^\sA-Za-z0-9]+\s+)?(million|millions|lakh|lakhs|lac|lacs|crore|crores)\b", re.I)
_UNIT_RUPEES = {"lakhs": 1e5, "millions": 1e6, "crores": 1e7}


def _unit_of(line):
    """The unit a UNIT LINE states ("(in million, unless otherwise stated)", "(Amount in Rs.
    lakhs)"), or None. A prose sentence that happens to say "in millions" is not a unit line: the
    line must open with "(" or be short enough to be a caption, never a wrapped paragraph."""
    s = re.sub(r"[`₹’]", " ", line or "").strip()
    m = _UNIT_RX.search(s)
    if not m or not (s.startswith("(") or len(s) <= 60):
        return None
    u = m.group(1).lower()
    return "lakhs" if u.startswith("la") else "crores" if u.startswith("cr") else "millions"


def page_unit(text, row=None):
    """The unit stated by the unit line that HEADS the table holding line `row`: the nearest unit
    line above it (step-3a review A5: never the first prose mention anywhere on the page). With
    no `row`, the page's first unit line. None when no unit line qualifies."""
    lines = (text or "").split("\n")
    order = range(min(row, len(lines)) - 1, -1, -1) if row is not None else range(len(lines))
    for k in order:
        u = _unit_of(lines[k])
        if u:
            return u
    return None


def _convert(value, from_unit, to_unit):
    return value * _UNIT_RUPEES[from_unit] / _UNIT_RUPEES[to_unit]


# ---------------------------------------------------------------------------- cells
_NUM_CELL = re.compile(r"^\(?-?\d[\d,]*(?:\.\d+)?\)?%?[*#^]*$")
_DASH_CELL = re.compile(r"^(?:-|–|—|nil)[*#^]*$", re.I)
_NA_CELL = re.compile(r"^(?:n\.?\s?a\.?|not\s+applicable)[*#^]*$", re.I)
_PENDING_CELL = re.compile(r"^\[[●•.]?\][*#^]*$")
_PAREN_NOTE = re.compile(r"\([^()]*[A-Za-z][^()]*\)")


def _cell_value(tok):
    """('num', float) | ('dash', 0.0) | ('na', None) | ('pending', None) | None (not a cell)."""
    if _NUM_CELL.match(tok):
        t = tok.rstrip("*#^%")
        neg = t.startswith("(") and t.endswith(")")
        v = float(t.strip("()").replace(",", ""))
        return ("num", -v if neg else v)
    if _DASH_CELL.match(tok):
        return ("dash", 0.0)
    if _NA_CELL.match(tok):
        return ("na", None)
    if _PENDING_CELL.match(tok):
        return ("pending", None)
    return None


def _row_tokens(tail):
    return _normalize_numbers(_PAREN_NOTE.sub(" ", tail)).split()


def _row_cells(tail):
    """The cells of a row's tail after its label, or None when the tail holds anything that is
    not a cell (a word, a sentence): such a line is prose, not a table row."""
    toks = _row_tokens(tail)
    cells = [_cell_value(t) for t in toks]
    if not toks or any(c is None for c in cells):
        return None
    return cells


# ---------------------------------------------------------------------------- column headers
_MONTHS = ("january", "february", "march", "april", "may", "june", "july", "august",
           "september", "october", "november", "december")
_MONTH_RX = r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
_DATE_TOKEN = re.compile(
    r"(?P<md>(?P<m1>%s)\s+(?P<d1>\d{1,2}),?\s*(?P<y1>20\d{2}))"
    r"|(?P<dm>(?P<d2>\d{1,2})(?:st|nd|rd|th)?\s+(?P<m2>%s),?\s*(?P<y2>20\d{2}))"
    r"|(?P<num>(?<!\d)(?P<d3>\d{1,2})[./-](?P<m3>\d{1,2})[./-](?P<y3>20\d{2})(?!\d))"
    r"|(?P<fyr>(?:FY|Fiscal(?:\s+Year)?)\s*(?P<y4>20\d{2})\s*[-/]\s*(?P<e4>\d{2})(?!\d))"
    r"|(?P<fy>(?:FY|Fiscal(?:\s+Year)?)\s*(?P<y5>20\d{2})(?!\s*[-/]\s*\d))"
    % (_MONTH_RX, _MONTH_RX), re.I)


def _column_periods(line):
    """[fiscal_year | None per column] for the dated columns a header line names, in order: a
    March 31 period is that fiscal year; any other period end is a stub column (None)."""
    out = []
    for m in _DATE_TOKEN.finditer(line):
        if m.group("md") or m.group("dm") or m.group("num"):
            if m.group("num"):
                day, month, year = int(m.group("d3")), int(m.group("m3")), int(m.group("y3"))
            else:
                mon = (m.group("m1") or m.group("m2")).lower()
                day = int(m.group("d1") or m.group("d2"))
                month = _MONTHS.index(mon) + 1
                year = int(m.group("y1") or m.group("y2"))
            out.append(year if (month == 3 and day == 31) else None)
        elif m.group("fyr"):
            start, end = int(m.group("y4")), int(m.group("e4"))
            out.append((start // 100) * 100 + end if end != start % 100 else None)
        else:
            out.append(int(m.group("y5")))
    return out


def header_columns(lines, row_index, reach=60):
    """column_fy of the nearest date header above `row_index` (two or more dated columns), or
    None. A stacked period/year header ("June 30, March 31," over "2026 2026") is paired column
    for column; an unpairable stacked header is None, never a guess."""
    for i in range(row_index - 1, max(-1, row_index - 1 - reach), -1):
        stacked = _stacked_header_columns(lines[max(0, i - 1):i + 1])
        if stacked == "UNRESOLVED":
            return None
        if stacked is not None:
            return stacked
        cols = _column_periods(lines[i])
        if len(cols) >= 2:
            return cols
    return None


_SPLIT_HEAD_TOK = re.compile(r"^\d{1,3}$")
_SPLIT_TAIL_TOK = re.compile(r"^\d{1,3}(?:,\d{2,3})+\.\d+$")
_GROUPED_NUMBER = re.compile(r"^(?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})\.\d+$")
_NOTE_TOK = re.compile(r"^\d{1,2}$")


def _rejoin_split_cells(cells, ncols, toks=None):
    """pdfplumber splits the first digits off a single cell ("2 97,442.79" for 297,442.79, NSE RHP
    p326) where _normalize_numbers' two-split rule cannot fire. Step-3a review A2: only that exact
    shape is joined - a 1-3 digit token followed by a comma-grouped decimal token whose joined text
    is itself a validly grouped number (international 297,442.79 or Indian 2,97,442.79) - and only
    while the row has more cells than the header has columns. Never the row's first cell, and never
    when the surplus is explained by leading note numbers ("Rent 12 5 6.70": note 12, not 56.70)."""
    out = list(cells)
    if toks is None or len(toks) != len(cells) or len(out) <= ncols:
        return out
    toks = list(toks)
    lead = 0
    while lead < min(2, len(toks)) and _NOTE_TOK.match(toks[lead]):
        lead += 1
    if lead and len(out) - lead <= ncols:
        return out
    i = 1
    while len(out) > ncols and i < len(out) - 1:
        a, b = toks[i], toks[i + 1]
        if _SPLIT_HEAD_TOK.match(a) and _SPLIT_TAIL_TOK.match(b) and _GROUPED_NUMBER.match(a + b):
            joined = float((a + b).replace(",", ""))
            out[i:i + 2] = [("num", joined)]
            toks[i:i + 2] = [a + b]
            continue
        i += 1
    return out


def _map_cells(cells, column_fy, toks=None):
    """{fy: value} for the annual columns, or None when the cell count does not match the header
    (up to two leading note-number cells allowed). A "-" cell is a column that holds nothing for
    that year: it keeps the alignment and contributes no value."""
    cells = _rejoin_split_cells(cells, len(column_fy), toks)
    extra = len(cells) - len(column_fy)
    if extra < 0 or extra > 2:
        return None
    for kind, v in cells[:extra]:
        if kind != "num" or v != int(v) or not 0 < abs(v) < 100:
            return None
    out = {}
    for fy, (kind, v) in zip(column_fy, cells[extra:]):
        if kind in ("na", "pending"):
            return None
        if fy is not None and kind == "num":
            out[fy] = v
    return out


# ---------------------------------------------------------------------------- statement rows
OCF_LABEL = re.compile(
    r"^\s*(?:[A-Z]\)\s*)?net\s+cash\b[^\d]*?\boperating\s+activities\b"
    r"(?:\s*[-–]\s*total\b|\s*total\b|\s*[-–])?", re.I)
OCF_PAGE = re.compile(r"statement\s+of\s+cash\s*flows?|cash\s*flow\s+statement", re.I)
RENT_LABEL = re.compile(
    r"^\s*(?:\(?[a-z0-9]{1,3}[.)]\s*)?(?:rent(?:al)?\s+(?:charges|expenses?|paid)|rent\s*\(\s*paid\s*\)"
    r"|rent\s+expenses?|rent)\b(?!\s*(?:income|received|receivable|concession|deposit|,|and\b|&|including))",
    re.I)
RENT_PAGE = re.compile(r"\bother\s+expenses\b", re.I)
# Step-3a review A3: the rent row must sit INSIDE the "Other expenses" note (the P&L-linked note),
# not merely on a page that mentions other expenses (a lease or related-party table below it).
_OTHER_EXP_HEAD = re.compile(
    r"^\s*(?:note\s*)?(?:\d{1,3}(?:\.\d{1,2})?[.):]?\s*)?(?:\(?[a-z]\)\s*)?other\s+expenses?\b", re.I)
_NOTE_HEAD = re.compile(r"^\s*(?:note\s*)?\d{1,3}(?:\.\d{1,2})?[.):]?\s+\(?[A-Za-z]")
_NOTE_NUM = re.compile(r"^\s*(?:note\s*)?\d{1,3}(?:\.\d{1,2})?[.):]?\s+")
_HEAD_WORDS = re.compile(r"^[A-Za-z(][A-Za-z ,&()/'’\-.]*$")


def _is_note_heading(line):
    """A numbered note's title line ("28 Other expenses For the year ended", "35. Related party
    transactions"): a note number, then words only - no amount cell, so never a table row."""
    if not _NOTE_HEAD.match(line) or _trailing_cells(line):
        return False
    title = _NOTE_NUM.sub("", line, count=1).strip()
    return bool(_HEAD_WORDS.match(title)) and len(title.split()) <= 14


def _in_other_expenses_note(by_page, idx, lines, j):
    """True when the nearest note heading above line j (this page, then the previous page) is the
    "Other expenses" note's own heading; any other note heading in between is a different table."""
    def scan(ls, start):
        for k in range(start, -1, -1):
            ln = ls[k]
            if _OTHER_EXP_HEAD.match(ln) and not _trailing_cells(ln):
                return True
            if _is_note_heading(ln):
                return False
        return None
    got = scan(lines, j - 1)
    if got is None and (idx - 1) in by_page:
        prev = (by_page[idx - 1] or "").split("\n")
        got = scan(prev, len(prev) - 1)
    return bool(got)


def _heading_lines(text, n=10):
    return "\n".join((text or "").split("\n")[:n])


def read_statement_row(page_texts, label_rx, page_rx, what, fiscal_years, pnl_page, doc_unit,
                       heading_only=True, in_section=None):
    """(series {str(fy): value in doc_unit}, page, reason). See the module docstring."""
    if not fiscal_years:
        return None, None, "fiscal_years_unknown"
    if doc_unit not in _UNIT_RUPEES:
        return None, None, "unit_unknown"
    by_page = dict(page_texts)
    pnl_text = by_page.get(pnl_page) if pnl_page is not None else None
    want = issuer_balance_rows._basis(pnl_text) if pnl_text is not None else None
    found, unmapped, unitless, other_basis, outside = [], None, None, None, None
    for idx, text in page_texts:
        text = text or ""
        if not page_rx.search(_heading_lines(text) if heading_only else text):
            continue
        lines = text.split("\n")
        for j, ln in enumerate(lines):
            m = label_rx.match(ln)
            if not m:
                continue
            cells = _row_cells(ln[m.end():])
            if not cells or not any(k == "num" for k, _v in cells):
                continue
            if in_section is not None and not in_section(by_page, idx, lines, j):
                outside = idx if outside is None else outside
                continue
            cols = header_columns(lines, j)
            series = _map_cells(cells, cols, _row_tokens(ln[m.end():])) if cols else None
            if not series:
                unmapped = idx if unmapped is None else unmapped
                continue
            unit = page_unit(text, j)
            if unit is None:
                unitless = idx if unitless is None else unitless
                continue
            basis = issuer_balance_rows._basis(text)
            if basis == "both" or (want is not None and basis is not None and basis != want):
                other_basis = idx if other_basis is None else other_basis
                continue
            # Rounding slack of a 2-decimal figure printed in `unit`, expressed in doc_unit.
            slack = 0.005 * _UNIT_RUPEES[unit] / _UNIT_RUPEES[doc_unit] + 1e-6
            found.append((idx, {y: _convert(v, unit, doc_unit) for y, v in series.items()}, basis, slack))
    # The P&L page's own basis label decides; an unlabelled P&L (a summary page) accepts labelled
    # rows only when they all carry ONE basis - a document printing a consolidated AND a standalone
    # row for the same item cannot be told apart from an unlabelled P&L, so it fails closed.
    if want == "both" or (want is None and len({b for _p, _s, b, _t in found if b}) > 1):
        return None, found[0][0] if found else None, "%s_row_basis_not_told" % what
    slacks = [t for _p, _s, _b, t in found]
    found = [(p, s) for p, s, _b, _t in found]
    if not found:
        if other_basis is not None:
            return None, other_basis, "%s_row_basis_does_not_match_pnl" % what
        if unitless is not None:
            return None, unitless, "%s_page_unit_not_stated" % what
        if unmapped is not None:
            return None, unmapped, "%s_row_columns_do_not_match_the_header" % what
        if outside is not None:
            return None, outside, "%s_row_not_inside_its_note" % what
        return None, None, "%s_row_not_in_document" % what
    for n, (_p, s) in enumerate(found[1:], start=1):
        for y in s:
            if y in found[0][1] and abs(s[y] - found[0][1][y]) > slacks[0] + slacks[n]:
                return None, found[0][0], "%s_rows_disagree" % what
    merged, pages = {}, []
    for p, s in sorted(found, key=lambda c: abs(c[0] - pnl_page) if pnl_page is not None else c[0]):
        pages.append(p)
        for y, v in s.items():
            merged.setdefault(y, v)
    if not set(fiscal_years) <= set(merged):
        return None, pages[0], "%s_years_do_not_cover_the_pnl_years" % what
    return {str(y): merged[y] for y in fiscal_years}, pages[0], None


def read_op_cash_flow(page_texts, fiscal_years, pnl_page, doc_unit):
    return read_statement_row(page_texts, OCF_LABEL, OCF_PAGE, "op_cash_flow", fiscal_years,
                              pnl_page, doc_unit)


def read_rent_expense(page_texts, fiscal_years, pnl_page, doc_unit):
    return read_statement_row(page_texts, RENT_LABEL, RENT_PAGE, "rent_expense", fiscal_years,
                              pnl_page, doc_unit, heading_only=False,
                              in_section=_in_other_expenses_note)


# ---------------------------------------------------------------------------- RoNW block
RONW_HEADING = re.compile(r"return\s+on\s+net\s*worth|\bRo\s?NW\b", re.I)
_RONW_PERIOD = re.compile(
    r"^\s*(?:\d{1,2}[.)]\s*)?(?:(?:for\s+the\s+)?(?:financial\s+year|fiscal(?:\s+year)?|fy)\s*"
    r"(?:ended|ending)?\s*)?"
    r"(?:(?P<md>%s)\s+(?P<d1>\d{1,2}),?\s*(?P<y1>20\d{2})"
    r"|(?P<d2>\d{1,2})(?:st|nd|rd|th)?\s+(?P<dm>%s),?\s*(?P<y2>20\d{2})"
    r"|(?P<y3>20\d{2})\s*[-–]\s*(?P<e3>\d{2})(?!\d)"
    r"|(?P<y4>20\d{2})(?![\d,]))\s*"
    r"(?P<val>\(?-?\d+(?:\.\d+)?\)?)\s*(?P<pct>%%)?\s*(?:\(?[a-z*#^]\)?\s*)?(?P<w>\d{1,2})?\s*[*#^]*\s*$"
    % (_MONTH_RX, _MONTH_RX), re.I)
_WEIGHTED = re.compile(r"^\s*weighted\s+average\b", re.I)
_PCT_TOKEN = re.compile(r"\(?-?\d+\.\d+\)?%?|\(?-?\d+\)?%")


def _pct(tok):
    t = tok.rstrip("%")
    neg = t.startswith("(") and t.endswith(")")
    v = float(t.strip("()"))
    return -v if neg else v


def _parse_ronw_block(lines, start):
    """(rows {fy: pct}, weights {fy: w}, weighted, stop_index) from the lines after a heading."""
    rows, weights, weighted = {}, {}, None
    # Step-3a review A4: a period row is a RoNW percentage only when "%" is printed - on the row
    # itself, or on the block's own column header (the heading or a line before the first row,
    # "RoNW (%)"). A bare number under no percent sign is some other column.
    header_pct = "%" in lines[start]
    for j in range(start + 1, min(len(lines), start + 14)):
        ln = lines[j]
        if not rows and "%" in ln and not _RONW_PERIOD.match(ln) and not _WEIGHTED.match(ln):
            header_pct = True
        if _WEIGHTED.match(ln):
            tail = _WEIGHTED.sub("", ln)
            m = _PCT_TOKEN.search(tail)
            weighted = _pct(m.group(0)) if m else None
            decimals = len(m.group(0).rstrip("%)").split(".")[1]) if m and "." in m.group(0) else 0
            return rows, weights, (weighted, decimals), j
        m = _RONW_PERIOD.match(ln)
        if not m:
            continue
        if not m.group("pct") and not header_pct:
            continue
        if m.group("md") or m.group("dm"):
            mon = (m.group("md") or m.group("dm")).lower()
            day = int(m.group("d1") or m.group("d2"))
            if not (mon == "march" and day == 31):
                continue  # a stub period is never a fiscal year (D11)
            fy = int(m.group("y1") or m.group("y2"))
        elif m.group("y3"):
            start_y, end = int(m.group("y3")), int(m.group("e3"))
            if end != (start_y + 1) % 100:
                continue
            fy = (start_y // 100) * 100 + end
        else:
            fy = int(m.group("y4"))
        if fy in rows:
            return None
        rows[fy] = _pct(m.group("val"))
        if m.group("w"):
            weights[fy] = float(m.group("w"))
    return rows, weights, (weighted, 0), None


def read_ronw_block(page_texts):
    """{'ronw_by_fy': (series, page, reason), 'weighted_average_ronw': (value, page, reason)}."""
    blocks = []
    for idx, text in page_texts:
        lines = (text or "").split("\n")
        for i, ln in enumerate(lines):
            if not RONW_HEADING.search(ln) or len(re.findall(r"\d+\.\d+", ln)) >= 2:
                continue
            parsed = _parse_ronw_block(lines, i)
            if parsed is None:
                continue
            rows, weights, (weighted, decimals), stop = parsed
            # A block is the rows ABOVE its own "Weighted Average" line; period rows a stray
            # heading mention happens to precede (a later table's dates) are never a RoNW block.
            if rows and stop is not None:
                basis = issuer_balance_rows._basis("\n".join(lines[max(0, i - 1):stop + 1]))
                blocks.append((idx, rows, weights, weighted, decimals, basis))
    if not blocks:
        why = "ronw_year_table_not_in_document"
        return {"ronw_by_fy": (None, None, why), "weighted_average_ronw": (None, None, why)}

    def disagree(bs):
        _p0, r0, _w0, wa0, _d0, _b0 = bs[0]
        return any(any(abs(r[y] - r0[y]) > 0.005 for y in r if y in r0) or (
            wa is not None and wa0 is not None and abs(wa - wa0) > 0.005)
            for _p, r, _w, wa, _d, _b in bs[1:])

    # Step-3a review A5 / D13: a document printing a consolidated and a standalone block reads the
    # consolidated one; blocks that disagree with no consolidated label to decide are refused.
    cons = [b for b in blocks if b[5] == "consolidated"]
    if disagree(blocks):
        if not cons or disagree(cons):
            page = blocks[0][0]
            why = "ronw_blocks_disagree"
            return {"ronw_by_fy": (None, page, why), "weighted_average_ronw": (None, page, why)}
        blocks = cons
    elif cons:
        blocks = cons + [b for b in blocks if b[5] != "consolidated"]
    page, rows, weights, weighted, weighted_decimals, _basis = blocks[0]
    if any(not -1000 <= v <= 1000 for v in rows.values()):
        why = "ronw_outside_minus_1000_to_1000"
        return {"ronw_by_fy": (None, page, why), "weighted_average_ronw": (None, page, why)}
    series = {str(y): v for y, v in rows.items()}
    if weighted is None:
        return {"ronw_by_fy": (series, page, None),
                "weighted_average_ronw": (None, page, "weighted_average_ronw_not_printed")}
    if set(weights) != set(rows) or not sum(weights.values()):
        return {"ronw_by_fy": (series, page, None),
                "weighted_average_ronw": (None, page, "ronw_weights_not_printed_for_every_year")}
    computed = sum(rows[y] * weights[y] for y in rows) / sum(weights.values())
    # Half a unit of the printed average's last decimal, plus the rows' own rounding (Bajaj Housing
    # prints "14.3%" for 14.3167).
    if abs(computed - weighted) > 0.5 * 10 ** -weighted_decimals + 0.01:
        why = "weighted_ronw_does_not_match_year_rows:computed=%.4f,printed=%s" % (computed, weighted)
        return {"ronw_by_fy": (None, page, why), "weighted_average_ronw": (None, page, why)}
    return {"ronw_by_fy": (series, page, None), "weighted_average_ronw": (weighted, page, None)}


# ---------------------------------------------------------------------------- capitalisation statement
CAP_HEADING = re.compile(r"capitali[sz]ation\s+statement", re.I)
BORROWING_LABEL = re.compile(r"^\s*total\s+borrowings?\b(?!\s*/)", re.I)
RATIO_LABEL = re.compile(
    r"^\s*total\s+borrowings?\s*/\s*(?:total\s+equity|shareholders?['’]?\s*funds?|net\s*worth)", re.I)
_PRE_FIRST = re.compile(r"\bpre[\s-]*(?:offer|issue)\b", re.I)
_POST = re.compile(r"\b(?:post[\s-]*(?:offer|issue)|as\s+adjusted|adjusted\s+for)\b", re.I)


def _trailing_cells(line):
    """The run of cell tokens ending the line, left to right (the label/formula before it is
    ignored); [] when the line does not end in a cell."""
    toks = _normalize_numbers(line).split()
    out = []
    for tok in reversed(toks):
        c = _cell_value(tok)
        if c is None:
            break
        out.append(c)
    return list(reversed(out))


def read_capitalisation(page_texts, fiscal_years, doc_unit, total_assets_latest=None):
    """{'total_borrowing': (value in doc_unit, page, reason), 'debt_to_equity': (...)}."""
    pages = [(i, t or "") for i, t in page_texts
             if CAP_HEADING.search(_heading_lines(t, 4)) and BORROWING_LABEL.search(t or "")]
    if not pages:
        pages = [(i, t or "") for i, t in page_texts
                 if CAP_HEADING.search(t or "") and any(
                     BORROWING_LABEL.match(ln) for ln in (t or "").split("\n"))]

    def both(why, page=None):
        return {"total_borrowing": (None, page, why), "debt_to_equity": (None, page, why)}

    if not pages:
        return both("capitalisation_statement_not_in_document")
    if not fiscal_years:
        return both("fiscal_years_unknown")
    latest = max(fiscal_years)
    reads = []
    for idx, text in pages:
        lines = text.split("\n")
        cands = [j for j, ln in enumerate(lines) if BORROWING_LABEL.match(ln) and _trailing_cells(ln)]
        if not cands:
            continue
        bi = cands[0]
        # The column header is the nearest line above the row naming the pre-offer column (the
        # intro paragraph above it says "as adjusted for the Offer" too, so it is not read).
        ki = next((k for k in range(bi - 1, -1, -1) if _PRE_FIRST.search(lines[k])), None)
        if ki is None:
            return both("capitalisation_pre_offer_column_not_told", idx)
        post = _POST.search(lines[ki])
        pre = _PRE_FIRST.search(lines[ki])
        if post and post.start() < pre.start():
            return both("capitalisation_pre_offer_column_not_told", idx)
        # The as-at date often wraps ("Pre-Offer as at March 31, Adjusted for the Offer" over
        # "2025"): the pre-offer cell's text, then the next header lines with the post-offer
        # column's own words cut off, are read as one string.
        parts = [lines[ki][pre.start():post.start() if post else None]]
        for k in range(ki + 1, min(ki + 3, bi)):
            cut = _POST.search(lines[k])
            parts.append(lines[k][:cut.start()] if cut else lines[k])
        dates = _column_periods(" ".join(parts))
        if not dates:
            return both("capitalisation_as_at_date_not_found", idx)
        if dates[0] != latest:
            return both("capitalisation_date_is_not_the_latest_fiscal_year_end", idx)
        # Step-3a review A1: the table's own column count is what its value rows print (two: pre-
        # and post-offer; one when the post-offer column is blank on every row, NSE DRHP p393). A
        # total-borrowings line whose cells do not fill those columns - a sub-heading
        # "Total Borrowings -" over its component rows - is not the totals row.
        counts = [len(c) for c in (_trailing_cells(ln) for ln in lines[ki + 1:])
                  if c and any(k == "num" for k, _v in c)]
        ncols = max(set(counts), key=lambda n: (counts.count(n), n)) if counts else None
        rows = [j for j in cands if ncols is not None and len(_trailing_cells(lines[j])) == ncols]
        if not rows:
            return both("total_borrowings_row_cells_do_not_fill_the_columns", idx)
        bi = rows[0]
        cells = _trailing_cells(lines[bi])
        kind, value = cells[0]
        if kind not in ("num", "dash"):
            return both("total_borrowings_pre_offer_cell_not_a_number", idx)
        if kind == "dash":
            # A nil total against a printed non-nil borrowing component (current / non-current
            # borrowings, any row below the header naming borrowings) is a misread, not 0 (D10).
            for j, ln in enumerate(lines[ki + 1:], start=ki + 1):
                if j == bi or "/" in ln or not re.search(r"borrowing", ln, re.I):
                    continue
                c = _trailing_cells(ln)
                if len(c) == ncols and c[0][0] == "num" and c[0][1] != 0:
                    return both("total_borrowings_nil_with_non_nil_components", idx)
        # The unit line that heads THIS table (A5), never the first prose mention on the page.
        unit = page_unit(text, ki)
        if value != 0:
            if unit is None:
                return both("capitalisation_page_unit_not_stated", idx)
            if doc_unit not in _UNIT_RUPEES:
                return both("unit_unknown", idx)
            value = _convert(value, unit, doc_unit)
        ratio = None
        ri = next((j for j, ln in enumerate(lines) if RATIO_LABEL.match(ln)), None)
        if ri is not None:
            rcells = _trailing_cells(lines[ri])
            ratio = rcells[0] if rcells else ("unread", None)
        reads.append((idx, value, ratio, issuer_balance_rows._basis(text)))
    if not reads:
        return both("total_borrowings_row_not_in_capitalisation_statement")
    # D13: a consolidated statement and a standalone one -> the consolidated one is read.
    cons = [r for r in reads if r[3] == "consolidated"]
    if cons and len(cons) < len(reads):
        reads = cons
    page, value, ratio, _b = reads[0]
    for _p, v, _r, _bb in reads[1:]:
        if abs(v - value) > 0.011:
            return both("capitalisation_statements_disagree", page)
    if value < 0:
        return both("total_borrowing_negative", page)
    if total_assets_latest is not None and value > total_assets_latest:
        return both("total_borrowing_exceeds_total_assets", page)
    out = {"total_borrowing": (value, page, None)}
    if value == 0:
        # D10: 0 only when total borrowing is 0 by the "-"/"Nil" rule; a printed non-zero ratio
        # against nil borrowings is a contradiction, not a value.
        if ratio is not None and ratio[0] == "num" and ratio[1] != 0:
            out["debt_to_equity"] = (None, page, "debt_to_equity_printed_non_zero_with_nil_borrowings")
        else:
            out["debt_to_equity"] = (0.0, page, None)
    elif ratio is None:
        out["debt_to_equity"] = (None, page, "debt_to_equity_row_not_in_capitalisation_statement")
    elif ratio[0] == "num" and 0 <= ratio[1] <= 50:
        out["debt_to_equity"] = (ratio[1], page, None)
    elif ratio[0] == "num":
        out["debt_to_equity"] = (None, page, "debt_to_equity_outside_0_to_50")
    else:
        out["debt_to_equity"] = (None, page, "debt_to_equity_not_printed_as_a_number")
    return out
