#!/usr/bin/env python3
"""
C3b Stage E — deterministic RHP/Prospectus financial extractor (NO LLM).

Reads a stored RHP/Prospectus PDF (path or URL) and emits JSON ONLY — it never
touches the database. The Node consumer (backfill-financials-pdf.ts) reads the
JSON and persists via data-persister (the write-path SSOT is unchanged).

Approach (free, deterministic, pdfplumber):
  1. Find the "Restated ... Statement of Profit and Loss" page via text search.
  2. Read the unit ("in Lakhs" / "in Crores" / "in Millions") from that section.
  3. Parse the period header: collect the "March 31, YYYY" annual column years
     (descending). A leading interim stub column (e.g. "December 31, YYYY") is
     detected as (money-columns - annual-columns) and skipped — never mislabelled.
  4. For each metric row (revenue from operations / total income / profit for the
     year / basic EPS) take the trailing MONEY numbers (those with 2 decimals, so
     a stray annexure-ref integer is ignored) and align them to the columns.
  5. EBITDA + Net Worth are searched across the whole document (they sit in other
     annexures) and aligned to the same column structure.

Honesty: a value is emitted ONLY when columns map confidently. Ambiguous headers
yield nothing for that metric — never a guessed year. Output is raw published
numbers in the document's unit; the Node consumer normalises to ₹ crore.

Usage:
  PYTHONIOENCODING=utf-8 python extract_financials_pdf.py <path-or-url> [--keep]
Outputs a single JSON object on stdout.
"""
import sys
import os
import re
import json
import tempfile
import urllib.request

# A money token: optional sign/paren, digit run with thousands commas, optional
# decimals. Unlike the old 2-decimals-only form, this also matches whole-number
# money (mainboard RHPs report "in millions" with NO decimals, e.g. "17,538").
# The Note-No. column and stray label digits are removed downstream by taking the
# TRAILING N tokens (N = column count), so a permissive token regex is safe here.
MONEY = re.compile(r"\(?-?\d[\d,]*(?:\.\d+)?\)?")
# Annual column years — both "March 31, 2024" (SME) and "31 March 2024" (mainboard).
MARCH = re.compile(r"(?:March\s+31,?\s*|31\s+March\s+)(20\d{2})", re.I)
# Interim (nine-month / stub) column period-ends — used to count leading interim
# columns so they are read and then DROPPED (we only keep annual fiscal years).
# The year is captured (optionally) so _count_interim_columns can dedupe
# multiple mentions of the SAME interim column by year, rather than by raw
# text — a header can legitimately name "December 31" once in the actual
# column header and once more in unrelated prose without that being two
# interim columns.
DEC_INTERIM = re.compile(r"(?:December\s+31,?\s*|31\s+December\s+)(20\d{2})?", re.I)


def _count_interim_columns(header):
    """How many leading interim (nine-month / stub) columns a header names.

    W-128: dedupes by the captured YEAR when one is present — a header can
    mention "December 31" once as the real (possibly wrapped-onto-the-next-
    line) column header and once more in unrelated prose; both may match, but
    they are the same one interim column. When a mention has no year on its
    own line, the immediately following line is checked for a bare "YYYY"
    (the common wrapped-header layout); only if that also fails is it counted
    as a yearless "bare" mention. Bare mentions cap at a single interim column
    (ambiguous without a year to distinguish them) unless a dated mention
    already established at least one — in which case the year-based count
    wins outright, since it is the more reliable signal.
    """
    lines = header.split("\n")
    years = set()
    bare = 0
    bare_year_rx = re.compile(r"^\s*(20\d{2})\s*$")
    for i, ln in enumerate(lines):
        for m in DEC_INTERIM.finditer(ln):
            if m.group(1):
                years.add(m.group(1))
                continue
            nxt = bare_year_rx.match(lines[i + 1]) if i + 1 < len(lines) else None
            if nxt:
                years.add(nxt.group(1))
            else:
                bare += 1
    if years:
        return len(years)
    return 1 if bare else 0
# Continuation form of a wrapped "March 31, YYYY" header cell — only consulted
# when a full MARCH anchor already matched on the same header (see _parse_pnl_page).
MARCH_LOOSE = re.compile(r"(?<!\d)31,\s*(20\d{2})")

# W-128: SME RHP KPI/summary tables head their columns "FY 2025-26 FY 2024-25
# FY 2023-24" (or "FY2025-26" / "FY 25-26" / bare "2025-26") instead of the
# mainboard "March 31, YYYY" form. A range header names the fiscal year by its
# START; the calendar year it belongs to is the one it ENDS in
# (FY 2025-26 -> 2026).
FY_RANGE = re.compile(r"(?:FY|Fiscal)\s*[:\-]?\s*(\d{2,4})\s*[-/]\s*(\d{2})\b", re.I)
# Bare "2025-26" with no FY/Fiscal prefix — the 4-digit start guards against a
# bare page-range footnote ("8-10") ever being mistaken for a fiscal year.
BARE_YEAR_RANGE = re.compile(r"(?<![\d/-])(20\d{2})\s*-\s*(\d{2})(?!\d)")
# "FY 2026" / "Fiscal 2026" — already the fiscal year's own end-year. The
# negative lookahead keeps this from also firing on the START year of a range
# ("FY 2025-26" must be read as ONE end-year 2026 via FY_RANGE, not additionally
# as a bare "FY 2025").
FY_SINGLE = re.compile(r"(?:FY|Fiscal)\s+(20\d{2})\b(?!\s*[-/]\s*\d{2}\b)", re.I)


def _fy_end_year(start_str, end_str):
    """Map a "start-end" fiscal-year range to the calendar year it ENDS in.

    "2025-26" -> 2026, "FY 25-26" -> 2026 (same math once the 2-digit start is
    given the 2000s century). A same-century rollover ("99-00") is handled by
    bumping the century when the 2-digit end is numerically before the start.
    """
    start_str = start_str.strip()
    start = int(start_str) if len(start_str) == 4 else 2000 + int(start_str)
    century = start - (start % 100)
    end = century + int(end_str)
    if end < start:
        end += 100
    return end


def _year_header_years(header):
    """All fiscal-year end-years named in a header block, in encounter order
    (the caller sorts descending). Accepts, in any mixture within the same
    header: "March 31, YYYY" / "31 March YYYY" (incl. the wrapped-continuation
    form once a full anchor is present), "FY YYYY-YY" / "FYYYYY-YY" /
    "FY YY-YY" / bare "YYYY-YY" range forms, and "FY YYYY" / "Fiscal YYYY".
    Never guesses: a header matching none of these forms yields [].
    """
    years = []

    def add(y):
        if y not in years:
            years.append(y)

    for y in MARCH.findall(header):
        add(int(y))
    if years:
        for y in MARCH_LOOSE.findall(header):
            add(int(y))
    for start_s, end_s in FY_RANGE.findall(header):
        add(_fy_end_year(start_s, end_s))
    for start_s, end_s in BARE_YEAR_RANGE.findall(header):
        add(_fy_end_year(start_s, end_s))
    for y in FY_SINGLE.findall(header):
        add(int(y))
    return years


# Metric label -> output key. Order matters (first match wins per line).
# `profit` matches loss-makers too — a loss-making issuer's bottom line reads
# "Loss for the year" / "(Loss)/profit for the period"; the sign is recovered by
# the accounting-negative (parenthesised) parsing in money_values (issue #67).
# W-128: SME KPI tables label the row bare "PAT" (no "profit"/"after tax" text)
# — `(?!\s*Margin)` keeps a "PAT Margin(...)" row from being read as the PAT
# amount even if it happened to precede the real row.
PNL_METRICS = [
    (re.compile(r"revenue\s+from\s+operations", re.I), "revenue"),
    (re.compile(r"total\s+income", re.I), "totalIncome"),
    (re.compile(r"\bPAT\b(?!\s*Margin)|(profit|loss)[\s/()]*(for\s+the\s+(period|year)|after\s+tax)", re.I),
     "profit"),
    # EPS: either the explicit "Basic EPS / Basic earnings per share" label, OR a
    # line that is just "(1) Basic ..." under a "loss/earnings per equity share"
    # section header (the mainboard layout — Ather). align() filters false
    # positives: a prose "basic" line lacks the trailing money columns.
    (re.compile(r"basic\s+(eps|earnings\s+per|loss\s+per)|^\s*\(?\s*1?\s*\)?\s*basic\b", re.I), "eps"),
]
OTHER_METRICS = [
    (re.compile(r"^\s*EBITDA\b(?!\s*Margin)", re.I), "ebitda"),
    # W-128: anchored to the START of the line, like the EBITDA row above — the
    # unanchored form matched prose ("Net worth has been computed in the
    # manner...") whose three incidental numbers (a regulation reference, a
    # sub-clause, a year) happened to satisfy the column count and got read as
    # the net-worth row before the real, later "Net Worth(8) 2,473.65 ..." line.
    (re.compile(r"^\s*net\s*worth\b", re.I), "netWorth"),
]


def _normalize_numbers(line):
    """Repair pdfplumber's number-tokenisation artifacts on a line.

    pdfplumber splits financial-table numbers unpredictably: "( 23)" for (23),
    "4 ,089" for 4,089, "4, 089" for 4,089. Stitch those back so MONEY matches a
    single token. Intra-digit splits without a comma ("2 09" for 209) are NOT
    repaired (ambiguous); they only affect non-target rows.
    """
    line = re.sub(r"\(\s+", "(", line)            # "( 23)"  -> "(23)"
    line = re.sub(r"\s+\)", ")", line)            # "(23 )"  -> "(23)"
    line = re.sub(r"(\d)\s+,(\d)", r"\1,\2", line)  # "4 ,089" -> "4,089"
    line = re.sub(r"(\d),\s+(\d)", r"\1,\2", line)  # "4, 089" -> "4,089"
    return _repair_split_digits(line)


# W-33 root cause. On some prospectus annexure pages pdfplumber inserts a space
# after the FIRST character of every numeric cell: "19,266.76" comes back as
# "1 9,266.76", "12.78" as "1 2.78", "0.73" as "0 .73". The old repairs covered
# only a space ADJACENT TO THE COMMA ("4 ,089" / "4, 089"), so the leading digit
# became its own token and the row's trailing-N alignment silently read
# 13,970.10 as 3,970.10 and 10,245.68 as 245.68 (Deepa Jewellers RHP, page 256).
#
# The repair is deliberately conservative: it fires only when a line carries at
# least TWO isolated single-digit tokens each followed by whitespace and a
# decimal number. On a correctly tokenised money row ("19,277.25 14,001.00") the
# digit before every space is part of a longer number, so the lookbehind blocks
# every match and the line is returned untouched.
SPLIT_DIGIT = re.compile(r"(?<![\d.,])(\d)\s+(?=[\d,]*\.\d)")


def _repair_split_digits(line):
    if len(SPLIT_DIGIT.findall(line)) < 2:
        return line
    return SPLIT_DIGIT.sub(r"\1", line)


def money_values(line):
    """All money-like numbers on a line; accounting-negatives (parens) handled."""
    out = []
    for tok in MONEY.findall(_normalize_numbers(line)):
        neg = tok.startswith("(") and tok.endswith(")")
        n = tok.strip("()").replace(",", "")
        if n in ("", "-"):
            continue
        try:
            v = float(n)
        except ValueError:
            continue
        out.append(-v if neg else v)
    return out


# W-35: the unit phrase may carry a currency glyph/word between "in" and the unit
# ("(All amounts are in Rs million)", "(in ` millions)"), and pdfplumber emits the
# rupee sign as a glyph. Matching "in <unit>" literally missed those and silently
# fell through to the "lakhs" default on a document that says million.
UNIT_PHRASE = re.compile(
    r"in\s+(?:(?:₹|`|rs\.?|inr|rupees?|indian\s+rupees)\s*)?(lakh|cror|million)", re.I)


def detect_unit_detail(text):
    """(unit, phrase) read from THIS text, or (None, None) when unstated.

    Returns the matched phrase so the caller can report WHICH statement it used
    (W-35) instead of an unattributable unit.
    """
    m = UNIT_PHRASE.search(text or "")
    if not m:
        return None, None
    stem = m.group(1).lower()
    unit = {"lakh": "lakhs", "cror": "crores", "million": "millions"}[stem]
    return unit, m.group(0).strip()


def detect_unit(text):
    unit, _phrase = detect_unit_detail(text)
    # SME RHP default; the caller still gates on `unitStated` before writing money.
    return unit or "lakhs"


def extract(pdf_path):
    import pdfplumber

    with pdfplumber.open(pdf_path) as pdf:
        page_texts = [(i, p.extract_text() or "") for i, p in enumerate(pdf.pages)]
    out = extract_from_texts(page_texts)
    out["pages"] = len(page_texts)
    return out


def _align_factory(column_fy, annual_years):
    """Build an aligner for a known column structure (closes over the FY mapping).

    `column_fy` lists the fiscal year for every data column, left to right, with
    `None` for leading interim (nine-month / stub) columns. A row's money tokens
    may be preceded by up to TWO leading note tokens (a Sr.No. column, a
    Note-No. column, a footnote-marker digit — each a bare or parenthesised
    1-2 digit integer, never a real monetary figure), so the TRAILING
    len(column_fy) tokens are taken and mapped positionally; only annual
    (non-None) columns are emitted.

    W-128: the leading-noise allowance is capped at exactly the note-token
    shape above, up to two of them. A wider row — e.g. a peer-comparison table
    repeating the same header across several companies — carries many more
    values than the header's own year count (and they are not note-shaped)
    and MUST NOT be read as this table's data; the old unbounded `>=` allowed
    exactly that.
    """
    ncols = len(column_fy)
    NOTE_TOKEN = re.compile(r"^\(?\d{1,2}\)?$")

    def align(line):
        tokens = MONEY.findall(_normalize_numbers(line))
        vals = money_values(line)
        extra = len(vals) - ncols
        if ncols >= 1 and 0 <= extra <= 2 and len(tokens) == len(vals):
            leading = tokens[:extra]
            if all(NOTE_TOKEN.match(t) for t in leading):
                tail = vals[-ncols:]
                return {column_fy[i]: tail[i] for i in range(ncols) if column_fy[i] is not None}
        if len(vals) == len(annual_years):  # row carries only the annual columns
            return {annual_years[i]: vals[i] for i in range(len(vals))}
        return None

    return align


def _parse_pnl_page(text):
    """Try to parse one candidate P&L page into {unit, years, metrics, align, score}.

    Returns None when the page is not a usable P&L data page (no annual header, no
    revenue/total-income anchor row, or zero aligned metrics). The caller iterates
    EVERY candidate page and keeps the richest — instead of breaking on the first
    title match, which on mainboard prospectuses is often a summary/index page with
    the title but no data rows (issue #67).
    """
    # W-128: an SME RHP's KPI/summary table ("Key Performance Indicators ...")
    # carries the same revenue/EBITDA/PAT/net-worth rows the mainboard
    # "Statement of Profit and Loss" title carries, just under a different
    # section heading — accept either as the anchor.
    if not re.search(r"statement\s+of\s+profit\s+and\s+loss|key\s+performance\s+indicators",
                      text, re.I):
        return None

    lines = text.split("\n")
    # The header is everything before the first data (revenue / total income) row —
    # isolate it so column-year counting is not polluted by dates inside notes.
    data_start = next(
        (i for i, ln in enumerate(lines)
         if re.search(r"revenue\s+from\s+operations|total\s+income", ln, re.I)),
        None,
    )
    if data_start is None:
        return None
    header = "\n".join(lines[:data_start]) or text

    # W-128 review: the YEAR header is read only from the block of lines
    # immediately above the data row — walk upward at most 8 lines and stop at
    # the first line (plus its wrapped continuation) that parses as a year
    # header. A prose sentence naming an unrelated fiscal year much higher up
    # the page ("... as required for FY 2018-19") must never inject a phantom
    # column into a table it has nothing to do with.
    window = lines[max(0, data_start - 8):data_start]
    year_header = None
    for i in range(len(window) - 1, -1, -1):
        candidate = window[i]
        if i + 1 < len(window):
            candidate = candidate + "\n" + window[i + 1]
        if _year_header_years(candidate):
            year_header = candidate
            break
    if year_header is None:
        return None
    annual_years = _year_header_years(year_header)
    annual_years.sort(reverse=True)
    if not annual_years:
        return None

    interim = _count_interim_columns(header)
    column_fy = ([None] * interim) + annual_years
    align = _align_factory(column_fy, annual_years)

    metrics = {}
    for ln in lines:
        for rx, key in PNL_METRICS:
            if key in metrics:
                continue
            if rx.search(ln):
                mapped = align(ln)
                if mapped:
                    metrics[key] = mapped
                break
    if not metrics:
        return None
    unit, phrase = detect_unit_detail(text)
    return {
        "unit": unit or "lakhs",
        "unitStated": unit is not None,
        "unitPhrase": phrase,
        "years": annual_years,
        "metrics": metrics,
        "align": align,
        "score": len(metrics),
    }


# --------------------------------------------------------------------------- #
# W-33 plausibility gate. Column mis-alignment and number-token damage produce
# values that are individually well-formed and arithmetically absurd (PAT larger
# than revenue, a 3,970x year-on-year jump, EPS of 95 on a PAT of 5.8). Every
# check below is NAMED, runs on the parsed series, and REJECTS the offending
# metric — the extractor then emits null with the failing check's reason instead
# of a wrong number.
# --------------------------------------------------------------------------- #
YOY_MIN, YOY_MAX = 0.2, 5.0


def _shared_years(a, b):
    return sorted(set(a) & set(b), reverse=True)


def check_pat_not_above_revenue(metrics):
    """Profit after tax can never exceed revenue from operations."""
    rev, pat = metrics.get("revenue") or {}, metrics.get("profit") or {}
    years = _shared_years(rev, pat)
    if not years:
        return True, "not applicable (revenue or PAT missing)", []
    bad = [y for y in years if pat[y] > rev[y] * 1.0001]
    if bad:
        return (False,
                "PAT above revenue in %s (%s)" % (
                    bad, ", ".join("%s: %s > %s" % (y, pat[y], rev[y]) for y in bad)),
                ["profit"])
    return True, "PAT <= revenue for %s years" % len(years), []


def check_ebitda_at_least_pat(metrics):
    """For a profitable year EBITDA (pre-interest, pre-tax, pre-depreciation)
    cannot be below PAT."""
    ebitda, pat = metrics.get("ebitda") or {}, metrics.get("profit") or {}
    years = [y for y in _shared_years(ebitda, pat) if pat[y] > 0]
    if not years:
        return True, "not applicable (no profitable year with EBITDA)", []
    bad = [y for y in years if ebitda[y] < pat[y] * 0.99]
    if bad:
        return False, "EBITDA below PAT in %s" % bad, ["ebitda"]
    return True, "EBITDA >= PAT for %s profitable years" % len(years), []


def check_yoy_ratio_within_bounds(metrics):
    """No published annual series moves by less than 0.2x or more than 5x in a
    single year without the parse being suspect. A dropped leading digit
    (13,970.10 read as 3,970.10) shows up here as a 3,970x step."""
    failed, details, ok = [], [], 0
    for key, series in sorted(metrics.items()):
        years = sorted(series, reverse=True)
        for newer, older in zip(years, years[1:]):
            a, b = series[newer], series[older]
            if a == 0 or b == 0:
                continue
            ratio = abs(a) / abs(b)
            if ratio < YOY_MIN or ratio > YOY_MAX:
                failed.append(key)
                details.append("%s %s/%s = %.2fx" % (key, newer, older, ratio))
            else:
                ok += 1
    if failed:
        return False, "year-on-year step outside %sx..%sx: %s" % (
            YOY_MIN, YOY_MAX, "; ".join(details)), sorted(set(failed))
    return True, "%s year-on-year steps within %sx..%sx" % (ok, YOY_MIN, YOY_MAX), []


def check_eps_times_shares_matches_pat(metrics, weighted_shares, tol=0.02):
    """EPS x weighted average shares must reproduce PAT. Skipped (not failed)
    when the share count is not available to this document."""
    eps, pat = metrics.get("eps") or {}, metrics.get("profit") or {}
    if not weighted_shares:
        return True, "skipped: weighted share count unavailable", []
    years = _shared_years(eps, pat)
    if not years:
        return True, "not applicable (EPS or PAT missing)", []
    bad = []
    for y in years:
        shares = weighted_shares.get(y) or weighted_shares.get(str(y))
        if not shares or pat[y] == 0:
            continue
        implied = eps[y] * shares
        if abs(implied - pat[y]) / abs(pat[y]) > tol:
            bad.append("%s: EPS %s x %s shares = %.2f vs PAT %s" % (y, eps[y], shares, implied, pat[y]))
    if bad:
        return False, "; ".join(bad), ["eps"]
    return True, "EPS x shares reproduces PAT", []


def check_unit_stated_near_table(unit_stated, unit_phrase, unit_page, table_page):
    """W-35: the magnitude of every parsed number depends on the unit, so the
    unit must come from a statement ON (or adjacent to) the table that was read
    — never from a global first match elsewhere in a 400-page document."""
    if not unit_stated:
        return False, "no explicit unit statement on the parsed table's page", []
    if unit_page is not None and table_page is not None and abs(unit_page - table_page) > 1:
        return False, "unit statement on page %s is not adjacent to the table on page %s" % (
            unit_page, table_page), []
    return True, "read %r from page %s" % (unit_phrase, unit_page), []


def check_cross_document_agreement(a, b, tol=0.01, label_a="doc A", label_b="doc B"):
    """Agreement between the same metric series read from two documents (the
    price band advertisement's KPI table and the RHP's restated summary). Both
    are published by the same issuer on the same day, so a disagreement means one
    of the two was mis-parsed and NEITHER may be written."""
    a = a or {}
    b = b or {}
    compared, bad = 0, []
    for key in sorted(set(a) & set(b)):
        sa, sb = a[key] or {}, b[key] or {}
        for y in _shared_years(sa, sb):
            va, vb = float(sa[y]), float(sb[y])
            denom = max(abs(va), abs(vb), 1e-9)
            compared += 1
            if abs(va - vb) / denom > tol:
                bad.append("%s %s: %s (%s) vs %s (%s)" % (key, y, va, label_a, vb, label_b))
    if not compared:
        return True, "no overlapping metric/year between the two documents", []
    if bad:
        return False, "; ".join(bad), sorted({x.split()[0] for x in bad})
    return True, "%s values agree within %.1f%%" % (compared, tol * 100), []


def run_plausibility(metrics, unit_stated, unit_phrase, unit_page, table_page,
                     weighted_shares=None):
    """Run every named check; return (checks, surviving metrics, rejected)."""
    results = [
        ("pat_not_above_revenue",) + check_pat_not_above_revenue(metrics),
        ("ebitda_at_least_pat",) + check_ebitda_at_least_pat(metrics),
        ("yoy_ratio_within_bounds",) + check_yoy_ratio_within_bounds(metrics),
        ("eps_times_shares_matches_pat",) + check_eps_times_shares_matches_pat(
            metrics, weighted_shares),
        ("unit_stated_near_table",) + check_unit_stated_near_table(
            unit_stated, unit_phrase, unit_page, table_page),
    ]
    checks, rejected = [], {}
    for name, passed, detail, offenders in results:
        checks.append({"name": name, "passed": bool(passed), "detail": detail})
        if not passed:
            for key in offenders:
                rejected.setdefault(key, "%s: %s" % (name, detail))
    # The unit gate is document-wide: with no trustworthy unit NO magnitude may be
    # written, so every metric is rejected, not just one.
    if not results[-1][1]:
        for key in list(metrics):
            rejected.setdefault(key, "unit_stated_near_table: %s" % results[-1][2])
    kept = {k: v for k, v in metrics.items() if k not in rejected}
    return checks, kept, rejected


def extract_from_texts(page_texts):
    """Pure core: given [(page_index, text)], return the extracted financials.

    Separated from PDF I/O so it can be unit-tested offline on captured page text.
    Always returns `metricsFound` + `lowConfidence` so the Node consumer can flag
    "extractor produced nothing" rather than persist silently-empty financials.
    """
    result = {
        "unit": "lakhs", "unitStated": False, "unitPage": None, "unitPhrase": None,
        "annualYears": [], "metrics": {}, "pages": 0,
        "metricsFound": 0, "lowConfidence": True, "checks": [], "rejected": {},
    }

    # 1. Parse EVERY candidate P&L page; keep the richest (most metrics, then most
    #    annual columns). This skips summary/index pages that carry the title but no
    #    data rows, and reads the unit from the chosen DATA page (issue #67).
    candidates = []
    for idx, text in page_texts:
        parsed = _parse_pnl_page(text)
        if parsed:
            parsed["page"] = idx
            candidates.append(parsed)
    if not candidates:
        return result
    # A page that states its own unit and carries more annual columns is a better
    # read of the same statement than a garbled annexure page (W-33/W-35).
    best = max(candidates, key=lambda c: (c["score"], len(c["years"]), c["unitStated"]))

    result["unit"] = best["unit"]
    result["unitStated"] = best["unitStated"]
    result["unitPhrase"] = best["unitPhrase"]
    result["unitPage"] = best["page"] if best["unitStated"] else None
    result["pnlPage"] = best["page"]
    result["annualYears"] = best["years"]
    result["metrics"] = dict(best["metrics"])
    align = best["align"]

    # 2. EBITDA + Net Worth searched doc-wide, aligned to the chosen page's columns.
    for _i, t in page_texts:
        for ln in t.split("\n"):
            for rx, key in OTHER_METRICS:
                if key in result["metrics"]:
                    continue
                if rx.search(ln):
                    mapped = align(ln)
                    if mapped:
                        result["metrics"][key] = mapped
        if all(k2 in result["metrics"] for _, k2 in OTHER_METRICS):
            break

    # 3. Plausibility gate (W-33): a metric that fails a named check is DROPPED,
    #    so the consumer sees null-with-a-reason rather than a confident wrong
    #    number. `rejected` carries the failing check and its detail per metric.
    checks, kept, rejected = run_plausibility(
        result["metrics"], result["unitStated"], result["unitPhrase"],
        result["unitPage"], result.get("pnlPage"))
    result["checks"] = checks
    result["metrics"] = kept
    result["rejected"] = rejected

    # 4. Confidence signal — empty, or no revenue/total-income anchor, is low-confidence.
    result["metricsFound"] = len(result["metrics"])
    result["lowConfidence"] = result["metricsFound"] == 0 or not (
        "revenue" in result["metrics"] or "totalIncome" in result["metrics"]
    )
    return result


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep = "--keep" in sys.argv

    # Offline test seam: --texts <json> runs the pure core on captured page text
    # ([[pageIndex, "text"], ...]) without a PDF. Used by the unit tests; never on
    # the production path (which always passes a real PDF path/URL).
    if "--texts" in sys.argv:
        try:
            with open(args[0], "r", encoding="utf-8") as fh:
                pages = json.load(fh)
            page_texts = [(int(p[0]), p[1]) for p in pages]
            data = extract_from_texts(page_texts)
            data["pages"] = len(page_texts)
            print(json.dumps(data))
            sys.exit(0)
        except Exception as e:  # noqa: BLE001 — sidecar must always emit JSON
            print(json.dumps({"error": str(e)}))
            sys.exit(2)

    if not args:
        print(json.dumps({"error": "no input path/url"}))
        sys.exit(1)
    src = args[0]
    tmp = None
    try:
        if re.match(r"^https?://", src):
            req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                content = r.read()
            # NSE/BSE serve RHP/anchor docs as .zip wrappers — unzip to the first PDF
            # member before pdfplumber (built-in zipfile, no new dependency).
            if content[:2] == b"PK":
                import io
                import zipfile
                with zipfile.ZipFile(io.BytesIO(content)) as zf:
                    pdf_name = next((n for n in zf.namelist() if n.lower().endswith(".pdf")), None)
                    if pdf_name is None:
                        print(json.dumps({"error": "zip contains no pdf member"}))
                        sys.exit(0)
                    content = zf.read(pdf_name)
            tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
            tmp.write(content)
            tmp.close()
            path = tmp.name
        else:
            path = src
        data = extract(path)
        print(json.dumps(data))
    except Exception as e:  # noqa: BLE001 — sidecar must always emit JSON, never crash the caller
        print(json.dumps({"error": str(e)}))
        sys.exit(2)
    finally:
        if tmp and not keep:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass


if __name__ == "__main__":
    main()
