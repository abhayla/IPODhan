#!/usr/bin/env python3
"""
WP C-2 (T-430) — deterministic filing extractor (NO LLM).

Reads a stored IPO filing PDF (RHP / PRICE_BAND_AD / PROSPECTUS / DRHP) and emits
JSON only. Never touches the database; the Node consumer persists (WP C-3).

Contract: docs/reviews/wp-c-extraction-contract.md §1 (what each field group is,
where it lives, how it is read, and the arithmetic check it must pass) and §2
(document-shape edge cases). Every emitted field carries its value, the page it
came from, the source document, and the named check that was run. A field whose
check FAILS is emitted as null with a reason — never as a guess.

Usage:
  PYTHONIOENCODING=utf-8 python extract_filing.py <pdf-path> --doc-type PRICE_BAND_AD
  python extract_filing.py --texts pages.json --doc-type PRICE_BAND_AD   (offline seam)
"""
import sys
import os
import re
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Reuse, do not copy (T-430 DoD): the column/number helpers already proven on RHPs.
from extract_financials_pdf import (  # noqa: E402
    money_values,
    _normalize_numbers,
    extract_from_texts as extract_pnl_from_texts,
    check_pat_not_above_revenue,
    check_ebitda_at_least_pat,
    check_yoy_ratio_within_bounds,
    check_cross_document_agreement,
)

DOC_TYPES = ("RHP", "PRICE_BAND_AD", "PROSPECTUS", "DRHP")

STATUS_OK = "OK"
STATUS_PARTIAL = "PARTIAL"
STATUS_NEEDS_OCR = "NEEDS_OCR"
# D6/W-57: a run whose text came (wholly or partly) from the OCR route.
STATUS_OK_OCR = "OK_OCR"
STATUS_PARTIAL_OCR = "PARTIAL_OCR"

# `[●]` (and the `[•]`/`[.]` variants pdfplumber emits) marks a cell that cannot be
# filled until the issue is priced — E3: null with reason, never a guess.
TBD = re.compile(r"\[\s*[•●○▪·.\-]\s*\]")

MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june",
     "july", "august", "september", "october", "november", "december"])}
_MONTH_ALT = (r"(January|February|March|April|May|June|July|August|September|October"
              r"|November|December)")
DATE_RX = re.compile(_MONTH_ALT + r"\s+(\d{1,2}),?\s*(20\d{2})", re.I)
# OCR of a SCANNED newspaper reads the comma after the day as a digit or a speck
# ("BID/OFFER OPENS ON: TUESDAY, SEPTEMBER 01 1 2026"). Tolerate at most ONE such
# noise token between the day and the four-digit year. A month NAME must still
# precede the day, so a bare run of numbers can never be read as a date, and the
# timetable ordering check still guards whatever this repair produces.
DATE_OCR_NOISE_RX = re.compile(
    _MONTH_ALT + r"\s+(\d{1,2})\s*[.,]?\s+(?:[^\w\s]|\d)\s+(20\d{2})", re.I)

_SENTENCE_SPLIT_RX = re.compile(r"(?<=[.!?])\s+")


def _cut_column_splice(text):
    """(cut_text, was_cut) — a prose field (business_description) whose
    neighbouring newspaper column got spliced in shows up as a sentence that is
    almost all upper-case (a heading/notice line from the other column). Keep
    sentences from the start while each one still reads as sentence-case prose
    (upper-case-letter ratio below 0.6) or is too short to judge (<4 words);
    stop at the first sentence that fails both. Applies to text-layer AND OCR
    routes alike — a text-layer ad with a bad column order can splice too."""
    if not text:
        return text, False
    sentences = [s.strip() for s in _SENTENCE_SPLIT_RX.split(text.strip()) if s.strip()]
    kept = []
    cut = False
    for s in sentences:
        words = s.split()
        letters = [c for c in s if c.isalpha()]
        upper_ratio = (sum(1 for c in letters if c.isupper()) / len(letters)) if letters else 0.0
        if len(words) < 4 or upper_ratio < 0.6:
            kept.append(s)
        else:
            cut = True
            break
    return " ".join(kept).strip(), cut


CIN_RX = re.compile(r"\b([UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b")
# A figure printed WITH the rupee mark — pdfplumber renders the sign as "`" in
# newspaper ads and as "₹" in prospectuses.
CURRENCY_AMOUNT = re.compile(r"[`₹]\s*(\(?-?[\d,]+(?:\.\d+)?\)?)")


# --------------------------------------------------------------------------- #
# checks (§1). Each returns (passed: bool, detail: str). Named, one per rule.
# --------------------------------------------------------------------------- #
def check_price_band(floor, cap, segment="MAINBOARD"):
    """floor < cap, and cap within the regulatory band width of floor."""
    if floor is None or cap is None:
        return False, "floor or cap missing"
    limit = 1.4 if segment == "SME" else 1.2
    if not floor < cap:
        return False, "floor %s not < cap %s" % (floor, cap)
    if cap > limit * floor:
        return False, "cap %s > %sx floor %s" % (cap, limit, floor)
    return True, "%s < %s <= %sx floor" % (floor, cap, limit)


def check_lot_value(lot, floor, segment="MAINBOARD"):
    """lot x floor must clear the SEBI minimum application value (Rs 10,000)."""
    if lot is None or floor is None:
        return False, "lot or floor missing"
    value = lot * floor
    if value < 10000:
        return False, "lot value %s < 10000" % value
    if value > 20000:
        return False, "lot value %s > 20000 (implausible for a retail lot)" % value
    return True, "lot value %s" % value


def check_face_multiple(price, face, printed):
    """The ad prints floor/cap as multiples of face value; recompute and compare."""
    if None in (price, face, printed) or face == 0:
        return False, "price, face value or printed multiple missing"
    computed = price / face
    if abs(computed - printed) > 0.01 * max(1.0, abs(printed)):
        return False, "computed %s != printed %s" % (computed, printed)
    return True, "%s/%s = %s == %s" % (price, face, computed, printed)


def check_shares_amount(shares, price, amount_mn, tol=0.005):
    """shares x price ~= the issue amount, in Rs million, within +/-0.5%."""
    if None in (shares, price, amount_mn) or amount_mn == 0:
        return False, "shares, price or amount missing"
    computed = shares * price / 1_000_000.0
    drift = abs(computed - amount_mn) / abs(amount_mn)
    if drift > tol:
        return False, "%sx%s = %.2fmn vs printed %s (%.4f%%)" % (
            shares, price, computed, amount_mn, drift * 100)
    return True, "%.2fmn ~= %s (%.4f%%)" % (computed, amount_mn, drift * 100)


def check_monotonic_shares(shares_floor, shares_cap):
    if shares_floor is None or shares_cap is None:
        return False, "missing"
    if not shares_floor > shares_cap:
        return False, "shares at floor %s not > at cap %s" % (shares_floor, shares_cap)
    return True, "%s > %s" % (shares_floor, shares_cap)


def check_monotonic_mcap(mcap_floor, mcap_cap):
    if mcap_floor is None or mcap_cap is None:
        return False, "missing"
    if not mcap_floor < mcap_cap:
        return False, "mcap at floor %s not < at cap %s" % (mcap_floor, mcap_cap)
    return True, "%s < %s" % (mcap_floor, mcap_cap)


def check_mcap_consistency(mcap_floor, floor, shares_floor, mcap_cap, cap, shares_cap, tol=0.005):
    """Market cap, price and fresh-issue share count must be mutually consistent,
    not just individually monotonic (MAJOR-2). mcap (Rs million) / price gives the
    POST-issue share count at that price point; subtracting the fresh-issue shares
    at that same price point gives the implied PRE-issue share count. That implied
    count must agree whether computed at floor or at cap, within +/-0.5% — a
    mismatch means at least one of mcap/shares/price was misread from the table.
    """
    if None in (mcap_floor, floor, shares_floor, mcap_cap, cap, shares_cap) or not floor or not cap:
        return False, "missing inputs"
    pre_floor = mcap_floor * 1_000_000.0 / floor - shares_floor
    pre_cap = mcap_cap * 1_000_000.0 / cap - shares_cap
    denom = max(abs(pre_floor), abs(pre_cap), 1.0)
    drift = abs(pre_floor - pre_cap) / denom
    if drift > tol:
        return False, "implied pre-issue shares %.0f (floor) != %.0f (cap) (%.4f%%)" % (
            pre_floor, pre_cap, drift * 100)
    return True, "implied pre-issue shares %.0f ~= %.0f (%.4f%%)" % (pre_floor, pre_cap, drift * 100)


def check_sum_equals(parts, total, label, tol=0.5):
    """Component rows must add up to the printed total (offer size, selling
    shareholders vs the offer for sale)."""
    parts = [x for x in parts if x is not None]
    if total is None or not parts:
        return False, "%s: missing parts or total" % label
    s = sum(parts)
    if abs(s - total) > tol:
        return False, "%s: parts sum %s != printed total %s" % (label, s, total)
    return True, "%s: %s == %s" % (label, s, total)


def check_ratio_equals(numerator, denominator, printed, label, tol=0.01):
    """numerator/denominator must reproduce a printed ratio (P/E from price and
    EPS, cap price over WACA) within +/-1%."""
    if None in (numerator, denominator, printed) or not denominator:
        return False, "%s: missing input" % label
    computed = numerator / denominator
    drift = abs(computed - printed) / max(abs(printed), 1e-9)
    if drift > tol:
        return False, "%s: %s/%s = %.4f vs printed %s (%.2f%%)" % (
            label, numerator, denominator, computed, printed, drift * 100)
    return True, "%s: %.4f ~= %s" % (label, computed, printed)


def check_weighted_average(series, weights, printed, label, tol=0.01):
    """A printed weighted average must be reproducible from the year series and
    the printed weights — the check that catches a mis-read year column."""
    if printed is None or not series or not weights:
        return False, "%s: missing series, weights or printed average" % label
    years = [y for y in series if y in weights]
    if not years:
        return False, "%s: no year has both a value and a weight" % label
    total_w = sum(weights[y] for y in years)
    if not total_w:
        return False, "%s: weights sum to zero" % label
    computed = sum(series[y] * weights[y] for y in years) / total_w
    if abs(computed - printed) > max(tol * abs(printed), 0.005):
        return False, "%s: computed %.4f != printed %s" % (label, computed, printed)
    return True, "%s: %.4f ~= %s" % (label, computed, printed)


def check_mean_equals(values, printed, label, tol=0.005):
    if printed is None or not values:
        return False, "%s: missing values or printed average" % label
    computed = sum(values) / len(values)
    if abs(computed - printed) > max(tol * abs(printed), 0.005):
        return False, "%s: mean %.4f != printed %s" % (label, computed, printed)
    return True, "%s: mean %.4f ~= %s" % (label, computed, printed)


def _combine(*results):
    """Chain multiple (passed, detail) check results — first failure wins."""
    for passed, detail in results:
        if not passed:
            return False, detail
    return True, "; ".join(detail for _passed, detail in results)


def check_allocation(qib, nii, retail):
    """QIB+NII+Retail <= 100 and, book-built, QIB >= 50."""
    parts = [p for p in (qib, nii, retail) if p is not None]
    if len(parts) != 3:
        return False, "one or more allocation percentages missing"
    total = sum(parts)
    if total > 100.0001:
        return False, "allocation sums to %s > 100" % total
    if qib < 50:
        return False, "book-built QIB portion %s%% < 50%%" % qib
    return True, "QIB %s + NII %s + Retail %s = %s" % (qib, nii, retail, total)


def _working_days_between(a, b):
    """Weekdays strictly after `a` up to and including `b` (Mon-Fri only).

    Holidays are deliberately NOT accounted for — the exchange holiday calendar
    is not available to this offline extractor. This is a documented
    approximation (WP C-3 follow-up: wire the real holiday calendar), not a claim
    of exact settlement-day accuracy.
    """
    from datetime import timedelta
    n = 0
    d = a + timedelta(days=1)
    while d <= b:
        if d.weekday() < 5:  # Mon=0 .. Fri=4
            n += 1
        d += timedelta(days=1)
    return n


def check_timeline(dates):
    """anchor < open <= close < allotment <= refund <= credit < listing, and T+3
    WORKING days (Sat/Sun skipped; holidays ignored — see _working_days_between)."""
    from datetime import date
    order = ["anchor_bid_date", "open_date", "close_date", "basis_of_allotment_date",
             "refund_date", "credit_date", "listing_date"]
    present = [(k, dates[k]) for k in order if dates.get(k)]
    if len(present) < 2:
        return False, "fewer than two dates found"
    strict = {("anchor_bid_date", "open_date"), ("close_date", "basis_of_allotment_date"),
              ("credit_date", "listing_date")}
    for (ka, a), (kb, b) in zip(present, present[1:]):
        if (ka, kb) in strict:
            if not a < b:
                return False, "%s %s not < %s %s" % (ka, a, kb, b)
        elif a > b:
            return False, "%s %s > %s %s" % (ka, a, kb, b)
    if dates.get("close_date") and dates.get("listing_date"):
        c = date(*[int(x) for x in dates["close_date"].split("-")])
        l = date(*[int(x) for x in dates["listing_date"].split("-")])
        wd = _working_days_between(c, l)
        if wd > 3:
            return False, ("listing %s more than 3 working days after close %s "
                            "(%s working days, Sat/Sun skipped, holidays ignored)" % (l, c, wd))
    return True, " < ".join("%s=%s" % (k, v) for k, v in present)


def check_category_sum(parts, total, tol=0.0):
    """Category rows must reconcile with the printed total (BRLM track record)."""
    if total is None or not parts:
        return False, "missing parts or total"
    s = sum(parts)
    if abs(s - total) > tol:
        return False, "parts sum %s != printed total %s" % (s, total)
    return True, "parts sum %s == total %s" % (s, total)


def check_track_record(total_issues, closed_below):
    if total_issues is None or closed_below is None:
        return False, "missing"
    if closed_below > total_issues:
        return False, "closed below issue price %s > total issues %s" % (closed_below, total_issues)
    return True, "%s of %s" % (closed_below, total_issues)


def check_holding_dilution(pre_pct, post_pct, shares_held=None, fresh_shares=None, tol=0.01,
                           sold_shares=0.0):
    """A fresh issue can only dilute: post % must be below pre %.

    When the promoter's absolute pre-issue share count AND the fresh-issue share
    count are both known (D8), also recompute post = pre * pre_shares /
    (pre_shares + fresh) — where pre_shares (total pre-issue outstanding shares)
    is derived from the promoter's own held shares and pre-issue percentage — and
    require it to reproduce the printed post-issue %% within +/-1%%.
    """
    if pre_pct is None or post_pct is None:
        return False, "missing"
    if not post_pct < pre_pct:
        return False, "post-issue %s%% not < pre-issue %s%%" % (post_pct, pre_pct)
    if shares_held and fresh_shares and pre_pct:
        # A promoter who is ALSO a selling shareholder is diluted twice: by the
        # fresh issue AND by the shares they sell in the offer for sale. Ignoring
        # the sale made this check fail on every fresh-issue-plus-OFS book
        # (Deepa Jewellers: printed 35.45%, fresh-only formula says 41.62%).
        pre_shares = shares_held * 100.0 / pre_pct
        expected_post = (shares_held - (sold_shares or 0.0)) * 100.0 / (pre_shares + fresh_shares)
        drift = abs(expected_post - post_pct) / max(abs(expected_post), 1e-6)
        if drift > tol:
            return False, "formula post %.4f%% != printed %s%% (%.4f%%)" % (
                expected_post, post_pct, drift * 100)
        return True, "%s%% -> %s%% (formula %.4f%% within %.1f%%)" % (
            pre_pct, post_pct, expected_post, tol * 100)
    return True, "%s%% -> %s%%" % (pre_pct, post_pct)


def check_waca_multiple(cap_price, waca, printed_multiple, tol=0.01):
    """cap / WACA must reproduce the printed 'X times' multiple within +/-1%."""
    if None in (cap_price, waca, printed_multiple) or not waca:
        return False, "cap price, WACA or printed multiple missing"
    computed = cap_price / waca
    drift = abs(computed - printed_multiple) / abs(printed_multiple)
    if drift > tol:
        return False, "%s/%s = %.2f vs printed %s (%.2f%%)" % (
            cap_price, waca, computed, printed_multiple, drift * 100)
    return True, "%.2f ~= %s" % (computed, printed_multiple)


def check_fy_series(series, fiscal_years):
    """A per-fiscal-year series must cover exactly the header's consecutive years."""
    if not series:
        return False, "no values"
    if not fiscal_years:
        return False, "fiscal years not read from a header row"
    years = sorted(int(y) for y in fiscal_years)
    if any(years[i] + 1 != years[i + 1] for i in range(len(years) - 1)):
        return False, "fiscal years not consecutive: %s" % years
    if sorted(int(k) for k in series) != years:
        return False, "series years %s != header years %s" % (sorted(series), years)
    # A prose sentence enumerates its periods ("for Fiscal 2026, Fiscal 2025 and
    # Fiscal 2024 were `(147.30) million, ...") and those year tokens parse as
    # money. If one survived into a value slot the row was mis-read: null it.
    leaked = [k for k, v in series.items() if float(v) in {float(y) for y in years}]
    if leaked:
        return False, "year token leaked into the value of %s (%s)" % (
            sorted(leaked), [series[k] for k in sorted(leaked)])
    return True, "%s years %s" % (len(series), years)


def check_sign_consistency(eps_series, pat_series):
    """EPS sign must agree with PAT sign for every shared year."""
    shared = set(eps_series) & set(pat_series)
    if not shared:
        return False, "no shared years"
    bad = [y for y in shared if (eps_series[y] < 0) != (pat_series[y] < 0)]
    if bad:
        return False, "sign mismatch in %s" % sorted(bad)
    return True, "signs agree across %s years" % len(shared)


def check_percentage(pct):
    if pct is None:
        return False, "missing"
    if not 0 < pct <= 100:
        return False, "%s outside (0, 100]" % pct
    return True, "%s" % pct


def check_cin(cin):
    if not cin:
        return False, "missing"
    if not CIN_RX.fullmatch(cin):
        return False, "%s does not match the CIN pattern" % cin
    return True, cin


def check_text_length(text, limit):
    if not text:
        return False, "missing"
    if len(text) > limit:
        return False, "%s chars > %s" % (len(text), limit)
    return True, "%s chars" % len(text)


def check_min_count(n, minimum):
    if n is None:
        return False, "missing"
    if n < minimum:
        return False, "%s < required %s" % (n, minimum)
    return True, "%s" % n


def check_objects_total(listed_sum, unpriced, fresh_issue, tol=0.01):
    """E5: the printed object amounts must reconcile with the fresh issue size.

    A red herring prospectus prints the general-corporate-purposes row as
    `[bullet]` — that amount is finalised only once the Offer Price is known —
    so exact equality is NOT verifiable at RHP stage and asserting it would
    fail every honest RHP. When a row is unpriced the check falls back to the
    bound that IS verifiable: the priced objects can never exceed the fresh
    issue. When every row carries an amount, the sum must equal the fresh issue
    within `tol`."""
    if listed_sum is None:
        return False, "no object amount printed"
    if fresh_issue is None:
        return False, "fresh issue amount not printed"
    if unpriced:
        if listed_sum > fresh_issue * (1 + tol):
            return False, "priced objects %.2f exceed fresh issue %.2f" % (listed_sum, fresh_issue)
        return True, ("priced objects %.2f <= fresh issue %.2f; %d object(s) unpriced "
                      "([bullet]), exact sum not verifiable at RHP stage"
                      % (listed_sum, fresh_issue, unpriced))
    if abs(listed_sum - fresh_issue) > fresh_issue * tol:
        return False, "objects sum %.2f != fresh issue %.2f" % (listed_sum, fresh_issue)
    return True, "%.2f == %.2f" % (listed_sum, fresh_issue)


def check_date_before(a, b, label):
    if not a or not b:
        return False, "missing"
    if not a < b:
        return False, "%s not before %s (%s)" % (a, b, label)
    return True, "%s < %s" % (a, b)


# --------------------------------------------------------------------------- #
# emission helpers
# --------------------------------------------------------------------------- #
class Emitter:
    def __init__(self, source_doc):
        self.source_doc = source_doc
        self.fields = {}
        self.failed = 0

    def put(self, name, value, page, check_name, check_result):
        passed, detail = check_result
        if not passed:
            self.failed += 1
        self.fields[name] = {
            "value": value if passed else None,
            "page": page if passed else None,
            "source_doc": self.source_doc,
            "check": {"name": check_name, "passed": bool(passed),
                      "detail": detail if passed else "check_failed: %s" % detail},
        }

    def null(self, name, reason, page=None):
        """A field the document deliberately does not carry a value for yet."""
        self.fields[name] = {
            "value": None, "page": page, "source_doc": self.source_doc,
            "check": {"name": "not_extractable", "passed": True, "detail": reason},
        }

    def put_c_money(self, unit, name, value, page, check_name, check_result):
        """A C-group money field (MAJOR-1 / C7): writable ONLY when an explicit
        unit line was found. `unit` is None -> null with reason unit_unknown,
        regardless of whether the value itself would otherwise pass its check —
        a number with no known unit is not a value, it is a guess."""
        if unit is None:
            self.null(name, "unit_unknown", page)
        else:
            self.put(name, value, page, check_name, check_result)


def _num(tok):
    vals = money_values(tok)
    return vals[0] if vals else None


def _iso(text):
    m = DATE_RX.search(text or "")
    if not m:
        return None
    return "%04d-%02d-%02d" % (int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2)))


def _iso_ocr(text):
    """(iso, repaired) — the strict reading first, then the one-noise-token OCR
    repair. `repaired` is True only when the tolerant pattern was needed, so the
    caller can drop the date if it breaks the timetable ordering."""
    iso = _iso(text)
    if iso:
        return iso, False
    m = DATE_OCR_NOISE_RX.search(text or "")
    if not m:
        return None, False
    return ("%04d-%02d-%02d" % (int(m.group(3)), MONTHS[m.group(1).lower()],
                                int(m.group(2))), True)


# The offer sentence on the cover restates the fresh-issue SIZE and the OFS SHARE
# COUNT in prose. On a scanned copy the table cells are the first thing OCR
# mangles (a leading digit dropped, a share count split across a space) while the
# sentence survives — so it is the fallback source for exactly those two figures.
_PROSE_FRESH_RX = re.compile(
    r"FRESH ISSUE OF UP TO[^\n]{0,120}?AGGREGATING UP TO\s*[^\d\n]{0,4}"
    r"([\d,]+(?:\.\d+)?)\s*MILLION", re.I)
_PROSE_OFS_SHARES_RX = re.compile(
    r"OFFER FOR SALE OF UP TO\s+(\d[\d,\s]{4,14}?)\s*EQUITY SHARES", re.I)


def _prose_fresh_issue_amount_line(lines):
    """(amount_mn, line_index) from the offer sentence, or (None, -1)."""
    for i, ln in enumerate(lines):
        m = _PROSE_FRESH_RX.search(ln)
        if m:
            return _num(m.group(1)), i
    return None, -1


def _prose_ofs_shares_line(lines):
    """(share_count, line_index) from the offer sentence, or (None, -1).

    OCR splits the count into groups ("11 848340"). The groups are joined ONLY
    when the joined number is 6-9 digits, so a genuinely small printed count is
    never inflated by swallowing the digits of a neighbouring figure."""
    for i, ln in enumerate(lines):
        m = _PROSE_OFS_SHARES_RX.search(ln)
        if m:
            digits = re.sub(r"[,\s]", "", m.group(1))
            if 6 <= len(digits) <= 9:
                return float(digits), i
    return None, -1


def _agrees_within(a, b, tol=0.005):
    if a is None or b is None or a == 0:
        return False
    return abs(a - b) / abs(a) <= tol


def _put_table_or_prose(emit, name, table_value, table_page, check_name, check_result,
                        prose_value, prose_page):
    """Offer-table field precedence: an arithmetic-checked table value wins; a
    table value whose check FAILS falls back to the same figure read from the
    offer sentence; a passing table value the prose contradicts is nulled rather
    than published (one of the two was mis-read and we cannot tell which)."""
    passed = bool(check_result[0])
    if passed and prose_value is not None and not _agrees_within(table_value, prose_value):
        emit.null(name, "table_prose_disagree", table_page)
        return
    if passed or prose_value is None:
        emit.put(name, table_value, table_page, check_name, check_result)
        return
    emit.put(name, prose_value, prose_page, "prose_fallback",
             (True, "table check %s failed (%s); offer sentence reads %s"
                    % (check_name, check_result[1], prose_value)))
    emit.fields[name]["source_text"] = "prose"


def _find_row(lines, rx, minvals, start=0):
    """First line matching `rx` that actually CARRIES at least `minvals` numbers.

    A price band advertisement mentions its own table headings in prose one
    paragraph earlier ("...and the post Offer market capitalization of the
    Company, each at the Floor Price..."). Taking the first textual match read the
    prose line, found no numbers, and nulled a field the document does print.
    """
    idx = _find(lines, rx, start)
    while idx >= 0:
        if len(money_values(lines[idx])) >= minvals:
            return idx
        idx = _find(lines, rx, idx + 1)
    return -1


def _find(lines, rx, start=0):
    for i in range(start, len(lines)):
        if rx.search(lines[i]):
            return i
    return -1


# MAJOR-1: `extract_financials_pdf.detect_unit` silently defaults to "lakhs" when
# no "in <unit>" line is found (it is a numeric-column-alignment helper, not a
# write-gate, and its default must NOT change). C7 of the extraction contract
# requires an EXPLICIT unit line for any C-group money field to be written — so
# this extractor does its own presence check, over the cover page and every
# other page, and never falls back to a default.
UNIT_RX = re.compile(r"(?:₹|rs\.?|rupees?)?\s*in\s+(million|millions|lakh|lakhs|crore|crores)",
                     re.I)


def _find_unit(page_texts):
    """Explicit unit-line detection (C7). Returns (unit, page) or (None, None) —
    never a guess, never the shared module's silent default."""
    for idx, text in page_texts:
        cleaned = re.sub(r"[`₹’]", " ", text or "")
        m = UNIT_RX.search(cleaned)
        if m:
            u = m.group(1).lower()
            if u.startswith("lakh"):
                return "lakhs", idx
            if u.startswith("cror"):
                return "crores", idx
            return "millions", idx
    return None, None


# --------------------------------------------------------------------------- #
# PRICE_BAND_AD extraction (groups A, B, C-as-reprinted, D, E, F)
# --------------------------------------------------------------------------- #
# --- W-74 (E5/F5): syndicate members and litigation notices -----------------
#
# Both sections sit in the small print of the price band advertisement, which a
# newspaper sets in two columns. The PDF text layer merges the columns into one
# physical line, so the right column arrives glued to the tail of the left
# column's prose. The helpers below recover the right column from the shape of
# the list itself rather than from x-coordinates the text layer has already lost.

SUB_SYNDICATE_RX = re.compile(r"SUB[\s-]?SYNDICATE\s+MEMBERS?\s*:", re.I)
SYNDICATE_RX = re.compile(r"(?<!SUB-)(?<!SUB )SYNDICATE\s+MEMBERS?\s*:", re.I)
_NAME_END_RX = re.compile(r"(?:Limited|Ltd|LLP|Inc|Corporation)\.?\)?\s*$", re.I)
_NAME_START_RX = re.compile(r"^[(\"']?[A-Z0-9&]")

# A notice worth publishing names a legal instrument, not the word "notice" on
# its own - the ad prints "public notice/ press release" in its own bid-period
# boilerplate, which is not litigation.
LITIGATION_RX = re.compile(
    r"(?:received\s+(?:a|an)\s+(?:legal\s+|show[\s-]cause\s+|termination\s+|"
    r"cease[\s-]and[\s-]desist\s+)?notice"
    r"|show[\s-]cause\s+notice|legal\s+notice|termination\s+notice"
    r"|cease[\s-]and[\s-]desist"
    r"|(?:trade\s?mark|patent|copyright|licen[cs]e)[^.]{0,80}?(?:infringement|terminat)"
    r"|infringement\s+(?:notice|proceedings?|suit)"
    r"|arbitration\s+proceedings?|civil\s+suit|criminal\s+(?:complaint|proceedings?))",
    re.I)

LITIGATION_SUMMARY_MAX = 500


def _column_tail(line):
    """The right-hand column of a merged two-column line, when that column is a
    semicolon-separated list of firm names. Walks back from the first ';' over
    the capitalised tokens of the entry it closes; the first lower-case prose
    word ("... Limited at | Securities Limited;") is the column boundary."""
    semi = line.find(";")
    if semi < 0:
        return None
    start = semi
    for m in reversed(list(re.finditer(r"\S+", line[:semi]))):
        if _NAME_START_RX.match(m.group(0)):
            start = m.start()
        else:
            break
    return line[start:].strip()


def _split_firm_names(blob):
    """';' and ',' both separate entries in the printed list; no entry in it
    carries an internal comma. Trailing separators leave empty pieces."""
    out = []
    for piece in re.split(r"[;,]", blob):
        name = piece.strip().strip(";")
        if len(name) > 3 and _NAME_START_RX.match(name):
            out.append(name)
    return out


def syndicate_members(lines):
    """[{name, role}] for the lead Syndicate Member and every sub-syndicate
    member the advertisement lists. Returns ([], None) when neither is printed."""
    members = []
    anchor = None

    li = _find(lines, SYNDICATE_RX)
    if li >= 0:
        m = SYNDICATE_RX.search(lines[li])
        lead = lines[li][m.end():].split(",")[0].strip()
        if len(lead) > 3:
            members.append({"name": lead, "role": "SYNDICATE"})
            anchor = li

    si = _find(lines, SUB_SYNDICATE_RX)
    if si >= 0:
        m = SUB_SYNDICATE_RX.search(lines[si])
        parts = [lines[si][m.end():].strip()]
        # The list runs on into the same column of the following lines until an
        # entry ends on a corporate suffix - the only in-text signal that the
        # last name is complete.
        for nxt in lines[si + 1:si + 5]:
            if _NAME_END_RX.search(parts[-1]):
                break
            tail = _column_tail(nxt)
            if not tail:
                break
            parts.append(tail)
        for name in _split_firm_names(" ".join(parts)):
            members.append({"name": name, "role": "SUB_SYNDICATE"})
        if anchor is None:
            anchor = si

    return members, anchor


ISSUE_BANK_RXS = [
    ("SPONSOR_BANK", re.compile(r"SPONSOR\s+BANKS?\(?s?\)?\s*:", re.I)),
    ("ESCROW_BANK", re.compile(r"ESCROW\s+COLLECTION\s+BANKS?\(?s?\)?\s*:", re.I)),
    ("PUBLIC_ISSUE_BANK",
     re.compile(r"PUBLIC\s+(?:OFFER|ISSUE)\s+ACCOUNT\s+BANKS?\(?s?\)?\s*:", re.I)),
]


def _bank_names(blob):
    """The banks named after one "<ROLE> BANK(s):" label.

    The advertisement prints these labels several to a line, separated by "|",
    and ends each list with a full stop, so the value runs only to the first
    "|" or "." — reading to end-of-line would swallow the NEXT role's banks.
    Two banks in one role are joined by "and" (never a comma inside a name).
    """
    value = re.split(r"[|.]", blob, maxsplit=1)[0]
    out = []
    for piece in re.split(r"\s+and\s+|[;,]", value, flags=re.I):
        name = piece.strip()
        if len(name) > 3 and _NAME_START_RX.match(name):
            out.append(name)
    return out


def issue_banks(lines):
    """[{name, role}] for the sponsor / escrow-collection / public-issue-account
    banks the advertisement names. Returns ([], None) when none is printed.

    The refund bank is deliberately NOT emitted: `intermediary_role` has no
    REFUND_BANK member, so a row for it could not be filed without a migration.
    """
    banks, anchor = [], None
    for role, rx in ISSUE_BANK_RXS:
        idx = _find(lines, rx)
        if idx < 0:
            continue
        m = rx.search(lines[idx])
        for name in _bank_names(lines[idx][m.end():]):
            banks.append({"name": name, "role": role})
        if anchor is None:
            anchor = idx
    return banks, anchor


def litigation_notices(lines):
    """[{summary}] for each litigation / IP-dispute notice the advertisement
    describes. Each summary is the sentence carrying the notice, capped at
    LITIGATION_SUMMARY_MAX characters. Returns ([], None) when none is printed."""
    found, anchor, seen = [], None, set()
    for idx, line in enumerate(lines):
        for sentence in re.split(r"(?<=\.)\s+", line):
            if not LITIGATION_RX.search(sentence):
                continue
            summary = " ".join(sentence.split())[:LITIGATION_SUMMARY_MAX].strip()
            if len(summary) < 20 or summary in seen:
                continue
            seen.add(summary)
            found.append({"summary": summary})
            if anchor is None:
                anchor = idx
    return found, anchor


def extract_price_band_ad(page_texts, emit, segment="MAINBOARD"):
    all_lines = [(i, _normalize_numbers(ln)) for i, t in page_texts for ln in (t or "").split("\n")]
    lines = [ln for _i, ln in all_lines]
    page_of = [i for i, _ln in all_lines]
    whole = "\n".join(lines)

    def page_for(idx):
        return page_of[idx] if 0 <= idx < len(page_of) else None

    # ---- A1/A2: price band + face value ------------------------------------
    floor = cap = face = None
    i = _find(lines, re.compile(r"PRICE BAND\s*:", re.I))
    if i >= 0:
        m = re.search(r"PRICE BAND\s*:\s*\S?\s*([\d,]+(?:\.\d+)?)\s*TO\s*\S?\s*([\d,]+(?:\.\d+)?)",
                      lines[i], re.I)
        fm = re.search(r"FACE VALUE OF\s*\S?\s*([\d,]+(?:\.\d+)?)", lines[i], re.I)
        if m:
            floor, cap = _num(m.group(1)), _num(m.group(2))
        if fm:
            face = _num(fm.group(1))
    band = check_price_band(floor, cap, segment)
    emit.put("price_band_floor", floor, page_for(i), "price_band_ordering", band)
    emit.put("price_band_cap", cap, page_for(i), "price_band_ordering", band)
    emit.put("face_value", face, page_for(i), "face_value_positive",
             (face is not None and face > 0, "%s" % face))

    # ---- A3: lot size + multiple -------------------------------------------
    lot = lot_multiple = None
    j = _find(lines, re.compile(r"BIDS CAN BE MADE FOR A MINIMUM OF", re.I))
    if j >= 0:
        block = " ".join(lines[j:j + 3])
        m = re.search(r"MINIMUM OF\s+([\d,]+)\s+EQUITY SHARES", block, re.I)
        mm = re.search(r"MULTIPLES OF\s+([\d,]+)\s+EQUITY SHARES", block, re.I)
        lot = _num(m.group(1)) if m else None
        lot_multiple = _num(mm.group(1)) if mm else None
    emit.put("lot_size", lot, page_for(j), "lot_min_application_value",
             check_lot_value(lot, floor, segment))
    emit.put("lot_multiple", lot_multiple, page_for(j), "lot_multiple_matches_lot",
             (lot_multiple is not None and lot_multiple == lot,
              "%s == lot %s" % (lot_multiple, lot) if lot_multiple == lot
              else "%s != lot %s" % (lot_multiple, lot)))

    # ---- A4: floor/cap as multiples of face value --------------------------
    # Two printed wordings: "THE FLOOR PRICE AND THE CAP PRICE ARE x TIMES AND y
    # TIMES the face value" and, split into two clauses, "THE FLOOR PRICE IS x
    # TIMES ... AND THE CAP PRICE IS y TIMES ..." (Deepa Jewellers).
    k = _find(lines, re.compile(r"FLOOR PRICE (?:AND THE CAP PRICE ARE|IS)", re.I))
    fm_floor = fm_cap = None
    if k >= 0:
        block = " ".join(lines[k:k + 3])
        m = re.search(r"ARE\s+([\d.]+)\s+TIMES\s+AND\s+([\d.]+)\s+TIMES", block, re.I)
        if m:
            fm_floor, fm_cap = float(m.group(1)), float(m.group(2))
        else:
            f = re.search(r"FLOOR PRICE IS\s+([\d.]+)\s+TIMES", block, re.I)
            c = re.search(r"CAP PRICE IS\s+([\d.]+)\s+TIMES", block, re.I)
            fm_floor = float(f.group(1)) if f else None
            fm_cap = float(c.group(1)) if c else None
    emit.put("floor_multiple_of_face", fm_floor, page_for(k), "floor_multiple_recomputed",
             check_face_multiple(floor, face, fm_floor))
    emit.put("cap_multiple_of_face", fm_cap, page_for(k), "cap_multiple_recomputed",
             check_face_multiple(cap, face, fm_cap))

    # ---- A7/A8: the fresh-issue / market-cap table -------------------------
    shares_floor = amt_floor = shares_cap = amt_cap = None
    fi = _find_row(lines, re.compile(r"^\s*Fresh Issue\s+[\d,]", re.I), 4)
    if fi >= 0:
        vals = money_values(lines[fi])
        if len(vals) >= 4:
            shares_floor, amt_floor, shares_cap, amt_cap = vals[-4:]
    # The offer-for-sale row: singular OR the "Offer for Sales" plural the Deepa
    # Jewellers ad prints, and either the 4-cell (shares + amount at each price)
    # or the amount-only shape.
    ofs_amount = ofs_amount_cap = ofs_shares = None
    oi = _find_row(lines, re.compile(r"^\s*Offer for sales?\b", re.I), 1)
    if oi >= 0:
        vals = money_values(lines[oi])
        if len(vals) >= 4:
            ofs_shares, ofs_amount, _shares_cap, ofs_amount_cap = vals[-4:]
        elif vals:
            ofs_amount = vals[-1]
        else:
            ofs_amount = 0.0
    # Market capitalisation row: "Post-Issue" / "Post Offer", and either two cells
    # (amount at floor, amount at cap) or four (share COUNT precedes each amount).
    mcap_floor = mcap_cap = None
    post_shares_floor = post_shares_cap = None
    mi = _find_row(lines, re.compile(
        r"Post[- ]?(?:Issue|Offer)\s+market\s+capitali[sz]ation", re.I), 2)
    if mi >= 0:
        vals = money_values(lines[mi])
        if len(vals) >= 4:
            post_shares_floor, mcap_floor, post_shares_cap, mcap_cap = vals[-4:]
        elif len(vals) >= 2:
            mcap_floor, mcap_cap = vals[-2:]
    total_shares_floor = total_amount_floor = total_shares_cap = None
    ti2 = _find(lines, re.compile(r"^\s*Total Offer Size\b", re.I))
    if ti2 >= 0:
        vals = money_values(lines[ti2])
        if len(vals) >= 4:
            total_shares_floor, total_amount_floor = vals[-4], vals[-3]
            total_shares_cap = vals[-2]

    emit.put("shares_at_floor", shares_floor, page_for(fi), "shares_x_price_equals_amount",
             check_shares_amount(shares_floor, floor, amt_floor))
    emit.put("shares_at_cap", shares_cap, page_for(fi), "shares_x_price_equals_amount",
             check_shares_amount(shares_cap, cap, amt_cap))
    prose_fresh_amt, pf_idx = _prose_fresh_issue_amount_line(lines)
    prose_ofs_shares, po_idx = _prose_ofs_shares_line(lines)

    _put_table_or_prose(
        emit, "fresh_issue_amount", amt_floor, page_for(fi), "fresh_issue_amount_consistent",
        (amt_floor is not None and amt_cap == amt_floor,
         "%s at both prices" % amt_floor if amt_floor == amt_cap
         else "%s vs %s" % (amt_floor, amt_cap)),
        prose_fresh_amt, page_for(pf_idx))

    # An offer-table AMOUNT is only ever published when the shares x price
    # arithmetic of its own row holds. A scanned copy loses a leading digit
    # ("1,990.52" read as ",990.52" -> 1) and a non-negativity test would happily
    # publish that stray 1 as the offer-for-sale size.
    ofs_row_empty = oi >= 0 and ofs_shares is None and ofs_amount == 0.0
    if ofs_row_empty:
        emit.put("ofs_amount", 0.0, page_for(oi), "ofs_row_carries_no_amount", (True, "0"))
        emit.null("ofs_shares", "offer_for_sale_row_has_no_share_count", page_for(oi))
        emit.null("ofs_amount_at_cap", "offer_for_sale_row_has_no_cap_amount", page_for(oi))
    elif ofs_shares is None and prose_ofs_shares is None:
        emit.null("ofs_amount", "offer_for_sale_amount_not_arithmetic_checkable", page_for(oi))
        emit.null("ofs_shares", "offer_for_sale_row_has_no_share_count", page_for(oi))
        emit.null("ofs_amount_at_cap", "offer_for_sale_row_has_no_cap_amount", page_for(oi))
    else:
        ofs_check = _combine(
            check_shares_amount(ofs_shares, floor, ofs_amount),
            check_shares_amount(ofs_shares, cap, ofs_amount_cap),
        )
        _put_table_or_prose(emit, "ofs_shares", ofs_shares, page_for(oi),
                            "ofs_shares_x_price_equals_amount", ofs_check,
                            prose_ofs_shares, page_for(po_idx))
        emit.put("ofs_amount", ofs_amount, page_for(oi),
                 "ofs_shares_x_price_equals_amount", ofs_check)
        emit.put("ofs_amount_at_cap", ofs_amount_cap, page_for(oi),
                 "ofs_shares_x_price_equals_amount", ofs_check)
    if total_shares_floor is None:
        emit.null("total_offer_shares_at_floor", "total_offer_size_row_not_in_document", page_for(ti2))
        emit.null("total_offer_amount_at_floor", "total_offer_size_row_not_in_document", page_for(ti2))
    else:
        tot_check = _combine(
            check_sum_equals([shares_floor, ofs_shares], total_shares_floor,
                             "fresh + OFS shares at floor", tol=1.0),
            check_sum_equals([amt_floor, ofs_amount], total_amount_floor,
                             "fresh + OFS amount at floor", tol=0.02),
        )
        emit.put("total_offer_shares_at_floor", total_shares_floor, page_for(ti2),
                 "total_offer_size_reconciles", tot_check)
        emit.put("total_offer_amount_at_floor", total_amount_floor, page_for(ti2),
                 "total_offer_size_reconciles", tot_check)
    # The cap-side total is checked on its own arithmetic (fresh at cap + OFS),
    # never inferred from the floor-side total: at the cap the fresh leg buys
    # fewer shares while the OFS leg is a fixed share count, so the two totals
    # differ and one cannot stand in for the other.
    if total_shares_cap is None:
        emit.null("total_offer_shares_at_cap", "total_offer_size_row_has_no_cap_share_count",
                  page_for(ti2))
    else:
        emit.put("total_offer_shares_at_cap", total_shares_cap, page_for(ti2),
                 "total_offer_size_reconciles",
                 check_sum_equals([shares_cap, ofs_shares], total_shares_cap,
                                  "fresh + OFS shares at cap", tol=1.0))
    emit.put("shares_monotonic", shares_floor is not None and shares_cap is not None,
             page_for(fi), "more_shares_at_floor_than_cap",
             check_monotonic_shares(shares_floor, shares_cap))
    mcap_check = _combine(
        check_monotonic_mcap(mcap_floor, mcap_cap),
        check_mcap_consistency(mcap_floor, floor, shares_floor, mcap_cap, cap, shares_cap),
    )
    emit.put("market_cap_at_floor", mcap_floor, page_for(mi),
             "market_cap_ordering_and_consistency", mcap_check)
    emit.put("market_cap_at_cap", mcap_cap, page_for(mi),
             "market_cap_ordering_and_consistency", mcap_check)
    if post_shares_floor is None:
        emit.null("post_offer_shares_at_floor", "market_cap_row_has_no_share_count", page_for(mi))
        emit.null("post_offer_shares_at_cap", "market_cap_row_has_no_share_count", page_for(mi))
    else:
        ps_check = _combine(
            check_shares_amount(post_shares_floor, floor, mcap_floor),
            check_shares_amount(post_shares_cap, cap, mcap_cap),
        )
        emit.put("post_offer_shares_at_floor", post_shares_floor, page_for(mi),
                 "post_offer_shares_x_price_equals_market_cap", ps_check)
        emit.put("post_offer_shares_at_cap", post_shares_cap, page_for(mi),
                 "post_offer_shares_x_price_equals_market_cap", ps_check)
    emit.put("issue_structure", "FRESH_ONLY" if ofs_amount == 0 else "FRESH_AND_OFS", page_for(oi),
             "issue_structure_from_ofs_row", (ofs_amount is not None, "ofs=%s" % ofs_amount))

    # ---- A9/A10: P/E and weighted average RoNW -----------------------------
    pi = _find(lines, re.compile(r"PRICE TO EARNINGS RATIO IS NOT ASCERTAINABLE", re.I))
    if pi >= 0:
        emit.null("pe_at_floor", "not_ascertainable_loss", page_for(pi))
        emit.null("pe_at_cap", "not_ascertainable_loss", page_for(pi))
    ri = _find(lines, re.compile(r"WEIGHTED AVERAGE RETURN ON NET WORTH", re.I))
    ronw = None
    if ri >= 0:
        m = re.search(r"IS\s*(\(?)\s*([\d.]+)\s*%?\s*\)?", lines[ri], re.I)
        if m:
            ronw = -float(m.group(2)) if m.group(1) else float(m.group(2))
    emit.put("weighted_average_ronw", ronw, page_for(ri), "ronw_within_plausible_range",
             (ronw is not None and -1000 <= ronw <= 1000, "%s" % ronw))

    # ---- A12/A13/A14: regulation, allocation, designated exchange ----------
    gi = _find(lines, re.compile(r"BOOK BUILDING PROCESS IN ACCORDANCE WITH REGULATION", re.I))
    reg = None
    if gi >= 0:
        m = re.search(r"REGULATION\s+(\d+\(\d+\))", lines[gi], re.I)
        reg = m.group(1) if m else None
    emit.put("book_building_regulation", reg, page_for(gi), "regulation_cited",
             (reg is not None, "%s" % reg))
    # Under Regulation 6(2) the QIB portion is "NOT LESS THAN 75%"; under 6(1) it
    # is "NOT MORE THAN 50%" with NII/Retail as "NOT LESS THAN". Accept either
    # direction for every category, and read across the 3 lines the ad wraps the
    # bullet list over.
    ai = _find(lines, re.compile(r"QIB PORTION\s*:", re.I))
    qib = nii = retail = None
    if ai >= 0:
        block = " ".join(lines[ai:ai + 3])
        bound = r"\s*:\s*NOT\s+(?:MORE|LESS)\s+THAN\s*([\d.]+)\s*%"
        m = re.search(r"QIB PORTION" + bound, block, re.I)
        n = re.search(r"NON-?\s?INSTITUTIONAL PORTION" + bound, block, re.I)
        r = re.search(r"RETAIL PORTION" + bound, block, re.I)
        qib = float(m.group(1)) if m else None
        nii = float(n.group(1)) if n else None
        retail = float(r.group(1)) if r else None
    alloc = check_allocation(qib, nii, retail)
    emit.put("qib_pct", qib, page_for(ai), "allocation_sums_and_qib_floor", alloc)
    emit.put("nii_pct", nii, page_for(ai), "allocation_sums_and_qib_floor", alloc)
    emit.put("retail_pct", retail, page_for(ai), "allocation_sums_and_qib_floor", alloc)
    di = _find(lines, re.compile(r"SHALL BE THE DESIGNATED STOCK EXCHANGE", re.I))
    dex = None
    if di >= 0:
        m = re.search(r"\b(NSE|BSE)\b\s+SHALL BE THE DESIGNATED", lines[di], re.I)
        dex = m.group(1).upper() if m else None
    emit.put("designated_stock_exchange", dex, page_for(di), "designated_exchange_known",
             (dex in ("NSE", "BSE"), "%s" % dex))

    # ---- A: the issue price is not fixed until the Prospectus (E3) ---------
    ip = _find(lines, re.compile(r"AT A PRICE OF", re.I))
    if ip >= 0 and TBD.search(lines[ip]):
        emit.null("issue_price", "not_priced_yet", page_for(ip))

    # ---- B: the indicative timetable ---------------------------------------
    # Every label is printed in several shapes across issuers ("BID/OFFER OPENS
    # ON" vs "Bid/Issue opens on", "Anchor Investor bidding date" vs "ANCHOR
    # INVESTOR BID/ OFFER PERIOD OPENS AND CLOSES ON", "Credit of the Equity
    # Shares to depository accounts" vs "...to dematerialised accounts").
    labels = {
        "anchor_bid_date": re.compile(
            r"Anchor Investor bidding date|Anchor Investor Bid\s*/?\s*Offer Period", re.I),
        "open_date": re.compile(r"Bid\s*/\s?(?:Issue|Offer)\s+opens on", re.I),
        "close_date": re.compile(r"Bid\s*/\s?(?:Issue|Offer)\s+closes on", re.I),
        "basis_of_allotment_date": re.compile(r"Finalisation of Basis of Allotment", re.I),
        "refund_date": re.compile(r"Initiation of refunds", re.I),
        "credit_date": re.compile(
            r"Credit of (?:the )?Equity Shares to (?:demateriali|depository)", re.I),
        "listing_date": re.compile(r"Commencement of trading of the Equity Shares", re.I),
    }
    tt = _find(lines, re.compile(r"indicative timetable", re.I))
    dates, date_pages, repaired = {}, {}, set()
    for name, rx in labels.items():
        idx = _find(lines, rx, max(tt, 0))
        if idx < 0:
            idx = _find(lines, rx)  # some ads print the headline dates above the table
        if idx < 0:
            continue
        # The newspaper's two-column layout splits "On or about" from its date, and
        # the intervening line belongs to the OTHER column — so look ahead up to two
        # lines, stopping at the next event label so a date is never stolen from it.
        iso, was_repaired = None, False
        for look in range(idx, min(idx + 3, len(lines))):
            if look > idx and any(r.search(lines[look]) for n, r in labels.items() if n != name):
                break
            iso, was_repaired = _iso_ocr(lines[look])
            if iso:
                break
        if iso:
            dates[name] = iso
            date_pages[name] = page_for(idx)
            if was_repaired:
                repaired.add(name)
    tl = check_timeline(dates)
    # A date that only parsed because of the OCR-noise repair and then breaks the
    # anchor < open < close ordering is a bad REPAIR, not a bad document: drop it
    # (with its own reason) and re-check the rest, rather than nulling the whole
    # timetable on it.
    dropped = set()
    if not tl[0]:
        for name in sorted(repaired):
            trial = {k: v for k, v in dates.items() if k != name}
            if check_timeline(trial)[0]:
                dropped.add(name)
                dates = trial
                tl = check_timeline(dates)
                break
    for name in labels:
        if name in dropped:
            emit.null(name, "date_order_after_ocr_repair", date_pages.get(name))
        else:
            emit.put(name, dates.get(name), date_pages.get(name), "timeline_ordering", tl)

    ui = _find(lines, re.compile(r"UPI mandate end time", re.I))
    upi = None
    if ui >= 0:
        m = re.search(r"(\d{1,2})[.:](\d{2})\s*(a\.?m|p\.?m)", lines[ui], re.I)
        if m:
            hh = int(m.group(1))
            if m.group(3).lower().startswith("p") and hh != 12:
                hh += 12
            upi = "%02d:%02d" % (hh, int(m.group(2)))
    emit.put("upi_cutoff_time", upi, page_for(ui), "upi_cutoff_parsed", (upi is not None, "%s" % upi))

    # ---- B9: RHP filing date (cover) ---------------------------------------
    # Read the date that FOLLOWS "dated" — the sentence often carries an earlier,
    # unrelated date (incorporation, conversion) that a whole-line scan would take.
    dated_rx = re.compile(r"red herring prospectus\s+dated\s*:?\s*", re.I)
    fi2 = _find(lines, dated_rx)
    rhp_date = None
    if fi2 >= 0:
        m = dated_rx.search(lines[fi2])
        rhp_date = _iso(lines[fi2][m.end():])
    emit.put("rhp_filing_date", rhp_date, page_for(fi2), "rhp_filed_before_open",
             check_date_before(rhp_date, dates.get("open_date"), "RHP filing before bid open"))

    # ---- C: fiscal years + the reprinted financial rows --------------------
    fiscal_years = []
    hy = _find(lines, re.compile(r"^\s*20\d{2}\s+20\d{2}\s+20\d{2}\s*$"))
    if hy < 0:
        # KPI-table header form: "Particulars Fiscal 2026 Fiscal 2025 Fiscal 2024".
        hy = _find(lines, re.compile(r"Fiscal\s+20\d{2}\s+Fiscal\s+20\d{2}\s+Fiscal\s+20\d{2}", re.I))
    if hy >= 0:
        seen = []
        for y in re.findall(r"20\d{2}", lines[hy]):
            if int(y) not in seen:
                seen.append(int(y))
        fiscal_years = seen
    # MAJOR-1 (C7): the unit must be read EXPLICITLY, never defaulted — search the
    # whole ad (it is a single/few-page cover document) for an "in <unit>" line.
    unit, unit_page = _find_unit(page_texts)

    def series_row(rx, count, start=0):
        """First line matching `rx` that actually CARRIES the year columns.

        The old version took the first textual match and gave up when it had too
        few numbers — so a prose mention ("negative cash flows from operating
        activities:") shadowed the sentence three lines later that holds the
        three yearly figures.
        """
        if not fiscal_years:
            return None, None
        idx = _find(lines, rx, start)
        while idx >= 0:
            vals = money_values(lines[idx])
            if len(vals) >= count:
                tail = vals[-count:]
                return {str(fiscal_years[n]): tail[n] for n in range(count)}, page_for(idx)
            idx = _find(lines, rx, idx + 1)
        return None, None

    YEAR_TOKEN = re.compile(r"\b(?:Fiscal|FY|March\s+31,)\s*20\d{2}", re.I)

    def prose_series(rx, count, span=3):
        """Read a year series out of a SENTENCE rather than a table row.

        The advertisement states some figures only in prose ("Net cash (used in) /
        generated from operating activities for Fiscal 2026, Fiscal 2025 and
        Fiscal 2024 were `(147.30) million, `(98.64) million and `48.45 million"),
        and the newspaper's two-column layout wraps that sentence over several
        lines with the neighbouring column spliced in. Join the following lines,
        drop the period tokens, and take the leading `count` figures.
        """
        if not fiscal_years:
            return None, None
        idx = _find(lines, rx)
        while idx >= 0:
            joined = YEAR_TOKEN.sub(" ", " ".join(lines[idx:idx + span]))
            # Only figures printed WITH the currency mark are data; the list
            # numbering of the risk factors ("9.", "18.") is not.
            vals = [money_values(m.group(1))[0]
                    for m in CURRENCY_AMOUNT.finditer(joined)
                    if money_values(m.group(1))]
            if len(vals) >= count:
                head = vals[:count]
                return {str(fiscal_years[n]): head[n] for n in range(count)}, page_for(idx)
            idx = _find(lines, rx, idx + 1)
        return None, None

    def optional_series(name, rx, count, reason):
        """A row many ads simply do not print: null WITH a reason, not a failed
        arithmetic check (a document that never carried the row is not a defect)."""
        series, page = series_row(rx, count)
        if series is None:
            emit.null(name, reason)
            return None
        emit.put_c_money(unit, name, series, page, "%s_year_series" % name,
                         check_fy_series(series, fiscal_years))
        return series

    ncols = len(fiscal_years) or 3
    pat, pat_page = series_row(
        re.compile(r"Profit/\(Loss\) after tax|Profit after tax\s*\(PAT\)", re.I), ncols)
    # The newspaper's two-column layout can split the phrase "operating
    # activities" across lines, so the sentence that CARRIES the figures reads
    # "activities for Fiscal 2026, ... were `(147.30) million, ...".
    ocf_rx = re.compile(r"operating activities|activities for Fiscal\s+20\d{2}", re.I)
    ocf, ocf_page = series_row(ocf_rx, ncols)
    if ocf is None or not check_fy_series(ocf, fiscal_years)[0]:
        ocf, ocf_page = prose_series(ocf_rx, ncols)

    emit.put("fiscal_years", fiscal_years, page_for(hy), "fiscal_years_consecutive",
             check_fy_series({str(y): 0 for y in fiscal_years}, fiscal_years))
    emit.put("unit", unit, unit_page, "unit_not_stated",
             (unit is not None, "%s" % unit if unit else "no explicit unit line found"))
    emit.put_c_money(unit, "pat_by_fy", pat, pat_page, "pat_year_series",
                      check_fy_series(pat or {}, fiscal_years))
    emit.put_c_money(unit, "op_cash_flow_by_fy", ocf, ocf_page, "op_cash_flow_year_series",
                      check_fy_series(ocf or {}, fiscal_years))
    optional_series("dscr_by_fy", re.compile(r"Debt service coverage ratio", re.I), ncols,
                    "row_not_in_document")
    optional_series("rent_by_fy", re.compile(r"Rent expenses", re.I), ncols,
                    "row_not_in_document")
    revenue = optional_series(
        "revenue_by_fy", re.compile(r"Revenue from operations\s*\(", re.I), ncols,
        "row_not_in_document")
    ebitda = optional_series(
        "ebitda_by_fy", re.compile(r"\bEBITDA\s*(?:\([ivx]+\))?\s*\(", re.I), ncols,
        "row_not_in_document")
    # Plausibility, on the ad's own reprinted rows (W-33): the same named checks
    # the RHP path runs, so an absurd-but-well-formed series is nulled here too.
    fin_metrics = {k: {int(y): v for y, v in (series or {}).items()}
                   for k, series in (("revenue", revenue), ("profit", pat), ("ebitda", ebitda))
                   if series}
    plaus = {
        "pat_not_above_revenue": check_pat_not_above_revenue(fin_metrics),
        "ebitda_at_least_pat": check_ebitda_at_least_pat(fin_metrics),
        "yoy_ratio_within_bounds": check_yoy_ratio_within_bounds(fin_metrics),
    }
    for cname, (passed, detail, offenders) in plaus.items():
        emit.put("financial_plausibility_%s" % cname, bool(passed) or None, None, cname,
                 (passed, detail))
        if not passed:
            for key in offenders:
                field = {"revenue": "revenue_by_fy", "profit": "pat_by_fy",
                         "ebitda": "ebitda_by_fy"}[key]
                emit.put(field, None, None, cname, (False, detail))

    # EPS: "March 31, 2026 (41.98) (41.98) 3" — basic, diluted, weight, per year.
    # "March 31, 2026 (41.98) (41.98) 3" / "Fiscal 2026 12.78 12.78 3". The cells
    # are matched positionally FROM THE START of the line: a newspaper's two-column
    # merge appends the neighbouring column's prose (and its digits) to the same
    # line, so the old "the line has exactly four numbers" rule dropped every EPS
    # row that happened to sit beside a footnote.
    NUM = r"\(?-?[\d,]*\.?\d+\)?"
    EPS_ROW = re.compile(
        r"^\s*(?:March\s+31,\s*|Fiscal\s+)(20\d{2})\s+(%s)\s+(%s)\s+(\d+)(?!\S)" % (NUM, NUM))
    eps_basic, eps_diluted, eps_weight, eps_page = {}, {}, {}, None
    for idx, ln in enumerate(lines):
        m = EPS_ROW.match(ln)
        if not m or m.group(1) in eps_basic:
            continue
        cells = money_values(" ".join(m.group(2, 3, 4)))
        if len(cells) == 3:
            eps_basic[m.group(1)], eps_diluted[m.group(1)], eps_weight[m.group(1)] = cells
            eps_page = page_for(idx)
    emit.put_c_money(unit, "eps_basic_by_fy", eps_basic or None, eps_page, "eps_year_series",
                      check_fy_series(eps_basic, fiscal_years))
    emit.put_c_money(unit, "eps_diluted_by_fy", eps_diluted or None, eps_page, "eps_year_series",
                      check_fy_series(eps_diluted, fiscal_years))
    emit.put_c_money(unit, "eps_sign_matches_pat", bool(eps_basic and pat), eps_page,
                      "eps_sign_matches_pat", check_sign_consistency(eps_basic, pat or {}))
    # Weighted average EPS: recomputable from the year series and the printed
    # weights — the check that would have caught a mis-read EPS column.
    wi_eps = _find(lines, re.compile(r"^\s*Weighted Average\s+[\d.]+", re.I))
    weighted_eps = None
    if wi_eps >= 0:
        vals = money_values(lines[wi_eps])
        weighted_eps = vals[0] if vals else None
    if weighted_eps is None:
        emit.null("eps_weighted_average", "weighted_average_eps_row_not_in_document")
    else:
        emit.put("eps_weighted_average", weighted_eps, page_for(wi_eps),
                 "weighted_eps_matches_year_series",
                 check_weighted_average(eps_basic, eps_weight, weighted_eps, "weighted EPS"))

    # RoNW year series: "Fiscal 2026 56.45% 3".
    ronw_series, ronw_weight, ronw_page = {}, {}, None
    for idx, ln in enumerate(lines):
        m = re.match(r"\s*Fiscal\s+(20\d{2})\s+([\d.]+)\s*%\s+(\d+)(?!\S)", ln)
        if m and m.group(1) not in ronw_series:
            ronw_series[m.group(1)] = float(m.group(2))
            ronw_weight[m.group(1)] = float(m.group(3))
            ronw_page = page_for(idx)
    if not ronw_series:
        emit.null("ronw_by_fy", "ronw_year_table_not_in_document")
    else:
        emit.put("ronw_by_fy", ronw_series, ronw_page, "weighted_ronw_matches_year_series",
                 check_weighted_average(ronw_series, ronw_weight, ronw, "weighted RoNW"))

    # P/E at each end of the band, recomputed from price / diluted EPS.
    pe_floor = pe_cap = None
    pei = _find_row(lines, re.compile(r"^\s*Based on diluted EPS", re.I), 3)
    if pei >= 0:
        # "Based on diluted EPS for Fiscal 2026 13.15 13.85" — the year token
        # leads, the two P/E cells trail.
        vals = money_values(lines[pei])
        if len(vals) >= 3:
            pe_floor, pe_cap = vals[1], vals[2]
    eps_latest = None
    if eps_diluted and fiscal_years:
        eps_latest = eps_diluted.get(str(max(fiscal_years)))
    if pe_floor is None:
        if not emit.fields.get("pe_at_floor"):
            emit.null("pe_at_floor", "pe_table_not_in_document")
            emit.null("pe_at_cap", "pe_table_not_in_document")
    else:
        pe_check = _combine(
            check_ratio_equals(floor, eps_latest, pe_floor, "P/E at floor"),
            check_ratio_equals(cap, eps_latest, pe_cap, "P/E at cap"),
        )
        emit.put("pe_at_floor", pe_floor, page_for(pei), "pe_equals_price_over_diluted_eps", pe_check)
        emit.put("pe_at_cap", pe_cap, page_for(pei), "pe_equals_price_over_diluted_eps", pe_check)

    bi = _find(lines, re.compile(r"Restated Consolidated Financial Information", re.I))
    bs = _find(lines, re.compile(r"Restated Financial Information", re.I))
    basis = "restated_consolidated" if bi >= 0 else ("restated_standalone" if bs >= 0 else None)
    if basis is None:
        emit.null("financial_basis", "financial_basis_not_stated")
    else:
        emit.put("financial_basis", basis, page_for(bi if bi >= 0 else bs),
                 "financial_basis_stated", (True, basis))

    # ---- D: promoter and cost of acquisition -------------------------------
    # "OUR PROMOTER: X" and "OUR PROMOTERS: A, B AND C" — the plural form was
    # silently unmatched, which then broke every promoter-row lookup downstream.
    prom, prom_names = None, []
    pn = _find(lines, re.compile(r"^\s*OUR PROMOTERS?\s*:", re.I))
    if pn >= 0:
        raw = lines[pn].split(":", 1)[1].strip()
        raw = re.split(r"\s{2,}|(?<=[a-z])\s+INITIAL PUBLIC", raw)[0]
        for part in re.split(r",|\bAND\b", raw, flags=re.I):
            name = part.strip().strip(".").title()
            if 3 <= len(name) <= 60 and re.match(r"^[A-Za-z][A-Za-z .'\-]+$", name):
                prom_names.append(name)
        prom = prom_names[0] if prom_names else None
    emit.put("promoter_name", prom, page_for(pn), "promoter_name_present", (bool(prom), "%s" % prom))
    emit.put("promoter_names", prom_names or None, page_for(pn), "promoter_names_present",
             (bool(prom_names), "%s" % prom_names))

    # Promoter selling shareholders: name, shares offered and WACA per share. The
    # share counts must add up to the offer for sale — a real arithmetic tie
    # between two different tables of the same advertisement.
    pss, pss_page = [], None
    for idx, ln in enumerate(lines):
        if not re.search(r"Promoter Selling Shareholder", ln, re.I):
            continue
        name = re.split(r"Promoter Selling Shareholder", ln, flags=re.I)[0].strip()
        if not re.match(r"^[A-Za-z][A-Za-z .'\-]{2,59}$", name):
            continue
        vals = money_values(ln)
        big = [v for v in vals if v >= 1000]
        if not big:
            continue
        pss.append({"name": name.title(), "shares_offered": max(big), "waca": vals[-1]})
        pss_page = page_for(idx)
    if not pss:
        emit.null("promoter_selling_shareholders", "no_promoter_selling_shareholder_table")
    else:
        emit.put("promoter_selling_shareholders", pss, pss_page,
                 "selling_shareholder_shares_sum_equals_ofs",
                 check_sum_equals([r["shares_offered"] for r in pss], ofs_shares,
                                  "promoter selling shareholders vs offer for sale", tol=1.0))

    shares_held = pre_pct = post_pct_cap = None
    sh_page = None
    if prom:
        si = _find(lines, re.compile(
            r"^\s*1\.\s+" + re.escape(prom) + r"[\^*#\u00b0]*\s+[\d,]", re.I))
        if si >= 0:
            vals = money_values(lines[si])
            if len(vals) >= 7:
                shares_held, pre_pct = vals[1], vals[2]
                post_pct_cap = vals[6]
            sh_page = page_for(si)
    emit.put("promoter_shares_held", shares_held, sh_page, "promoter_shares_positive",
             (shares_held is not None and shares_held > 0, "%s" % shares_held))
    sold_by_prom = next((r["shares_offered"] for r in pss
                         if prom and r["name"].lower() == prom.lower()), 0.0)
    dil = check_holding_dilution(pre_pct, post_pct_cap, shares_held, shares_cap,
                                 sold_shares=sold_by_prom)
    emit.put("promoter_holding_pre_pct", pre_pct, sh_page, "fresh_issue_dilutes_promoter", dil)
    emit.put("promoter_holding_post_pct_at_cap", post_pct_cap, sh_page,
             "fresh_issue_dilutes_promoter", dil)

    waca = None
    wi = -1
    if prom:
        surname = prom.split()[-1]
        wi = _find(lines, re.compile(r"^\s*" + re.escape(surname) + r"\s+[\d,]{6,}\s+[\d.]+", re.I))
        if wi >= 0:
            vals = money_values(lines[wi])
            if len(vals) >= 2:
                waca = vals[1]
    if waca is None and pss:
        # The cost-of-acquisition column of the selling-shareholder table carries
        # the same figure when the standalone WACA table is not printed.
        waca = next((r["waca"] for r in pss if prom and r["name"].lower() == prom.lower()), None)
        wi = -1 if waca is None else wi
    emit.put("promoter_waca", waca, page_for(wi) if wi >= 0 else pss_page,
             "promoter_waca_positive",
             (waca is not None and waca > 0, "%s" % waca))
    if wi >= 0 and re.search(r"\bNil\b", lines[wi], re.I):
        emit.null("waca_last_1y", "bonus_nil", page_for(wi))

    waca_3y = mult_3y = None
    t3 = _find(lines, re.compile(r"^\s*Last three years\b", re.I))
    if t3 >= 0 and re.search(r"Not Applicable", lines[t3], re.I):
        emit.null("waca_last_3y", "not_applicable_no_qualifying_transaction", page_for(t3))
        emit.null("cap_multiple_last_3y", "not_applicable_no_qualifying_transaction", page_for(t3))
    else:
        if t3 >= 0:
            vals = money_values(lines[t3])
            if len(vals) >= 2:
                waca_3y, mult_3y = vals[0], vals[1]
        wc = check_waca_multiple(cap, waca_3y, mult_3y)
        emit.put("waca_last_3y", waca_3y, page_for(t3), "cap_over_waca_equals_printed_multiple", wc)
        emit.put("cap_multiple_last_3y", mult_3y, page_for(t3),
                 "cap_over_waca_equals_printed_multiple", wc)

    # "- Based on secondary transactions 70.20 2.39 times 2.52 times": the WACA
    # and BOTH printed multiples, each recomputable from the price band.
    sec = _find(lines, re.compile(r"Based on secondary transactions\s+[\d.]+", re.I))
    if sec < 0:
        emit.null("waca_secondary_transactions", "secondary_transaction_waca_row_not_in_document")
        emit.null("floor_multiple_of_waca_secondary", "secondary_transaction_waca_row_not_in_document")
        emit.null("cap_multiple_of_waca_secondary", "secondary_transaction_waca_row_not_in_document")
    else:
        vals = money_values(lines[sec])
        w_sec = f_mult = c_mult = None
        if len(vals) >= 3:
            w_sec, f_mult, c_mult = vals[-3:]
        sec_check = _combine(
            check_ratio_equals(floor, w_sec, f_mult, "floor / secondary WACA"),
            check_ratio_equals(cap, w_sec, c_mult, "cap / secondary WACA"),
        )
        emit.put("waca_secondary_transactions", w_sec, page_for(sec),
                 "price_over_secondary_waca_equals_printed_multiple", sec_check)
        emit.put("floor_multiple_of_waca_secondary", f_mult, page_for(sec),
                 "price_over_secondary_waca_equals_printed_multiple", sec_check)
        emit.put("cap_multiple_of_waca_secondary", c_mult, page_for(sec),
                 "price_over_secondary_waca_equals_printed_multiple", sec_check)

    pp = _find(lines, re.compile(r"has not undertaken (?:a |any )?pre-?IPO placement", re.I))
    emit.put("pre_ipo_placement", False if pp >= 0 else None, page_for(pp),
             "pre_ipo_placement_stated", (pp >= 0, "explicitly stated as none"))

    # ---- E: intermediaries + BRLM track record -----------------------------
    ei = _find(lines, re.compile(r"SEBI Registration Number", re.I))
    regs = re.findall(r"\b(IN[MR]\d{9})\b", lines[ei]) if ei >= 0 else []
    brlm_regs = [r for r in regs if r.startswith("INM")]
    registrar_reg = next((r for r in regs if r.startswith("INR")), None)
    emit.put("brlm_sebi_regs", brlm_regs or None, page_for(ei), "brlm_reg_numbers_found",
             (len(brlm_regs) >= 1, "%s" % brlm_regs))
    emit.put("registrar_sebi_reg", registrar_reg, page_for(ei), "registrar_reg_number_found",
             (registrar_reg is not None, "%s" % registrar_reg))

    tr_rows, tr_page = [], None
    ti = _find(lines, re.compile(r"^\s*Total\s+\d+\s+\d+\s*$"))
    total_issues = closed_below = None
    if ti >= 0:
        vals = money_values(lines[ti])
        if len(vals) >= 2:
            total_issues, closed_below = vals[-2:]
        tr_page = page_for(ti)
        for idx in range(max(0, ti - 14), ti):
            m = re.match(r"\s*(.{4,}?(?:Limited|Ltd\.?)\)?)\*?\s+(\d+)\s+(\d+)\s*$",
                         lines[idx])
            if m:
                tr_rows.append({"brlm": m.group(1).strip(), "issues_3y": int(m.group(2)),
                                "closed_below": int(m.group(3))})
    ci = _find(lines, re.compile(r"^\s*Common Issues\s+\d+\s+\d+"))
    common = money_values(lines[ci])[:2] if ci >= 0 else []
    emit.put("brlm_track_record", tr_rows or None, tr_page, "brlm_rows_reconcile_with_total",
             check_category_sum([r["issues_3y"] for r in tr_rows] + ([common[0]] if common else []),
                                total_issues))
    trec = check_track_record(total_issues, closed_below)
    emit.put("brlm_issues_3y_total", total_issues, tr_page, "closed_below_le_total", trec)
    emit.put("brlm_closed_below_total", closed_below, tr_page, "closed_below_le_total", trec)

    # Listed-peer comparison table. A peer row is a company name followed by the
    # full 10-column accounting-ratio set; the issuer's own row is excluded by the
    # same rule (its price-dependent cells are still "[.]").
    peers, peers_page = [], None
    for idx, ln in enumerate(lines):
        m = re.match(r"^\s*(.{3,60}?(?:Limited|Ltd\.?))\s+(\d.*)$", ln)
        if not m:
            continue
        vals = money_values(m.group(2))
        if len(vals) < 10:
            continue
        face, price, revenue_ops, mcap, pb, pe, eps_b, eps_d, ronw_pct, nav = vals[:10]
        peers.append({"name": m.group(1).strip(), "face_value": face, "closing_price": price,
                      "revenue_from_operations": revenue_ops, "market_cap": mcap,
                      "pb": pb, "pe": pe, "eps_basic": eps_b, "eps_diluted": eps_d,
                      "ronw_pct": ronw_pct, "nav": nav})
        peers_page = page_for(idx)
    peer_avg = None
    pa = _find(lines, re.compile(r"^\s*Average\s+[\d.]+\s*$", re.I))
    if pa >= 0:
        vals = money_values(lines[pa])
        peer_avg = vals[-1] if vals else None
    peer_check = check_mean_equals([r["pe"] for r in peers], peer_avg,
                                   "industry peer group P/E")
    if not peers:
        emit.null("peer_companies", "peer_comparison_table_not_in_document")
        emit.null("industry_peer_pe_average", "peer_comparison_table_not_in_document")
    else:
        emit.put("peer_companies", peers, peers_page,
                 "peer_pe_average_matches_printed", peer_check)
        emit.put("industry_peer_pe_average", peer_avg, page_for(pa),
                 "peer_pe_average_matches_printed", peer_check)

    gk = _find(lines, re.compile(r"Contact person\s*:", re.I))
    co = None
    if gk >= 0:
        m = re.search(r"Contact person\s*:\s*([A-Za-z .'\-]+?)\s*,", lines[gk], re.I)
        co = m.group(1).strip() if m else None
    emit.put("compliance_officer", co, page_for(gk), "compliance_officer_present",
             (bool(co), "%s" % co))

    # W-88 E4: the same cover line that names the compliance officer prints the
    # company's telephone and e-mail. They are read off THAT line only -- the
    # advertisement repeats "Telephone:" and "E-mail:" for every BRLM and for
    # the registrar, so a document-wide search would file a bank's switchboard
    # as the issuer's grievance contact.
    co_phone = co_email = None
    if gk >= 0:
        pm = re.search(r"Telephone\s*:\s*([+0-9][0-9 ()+\-]{6,30})", lines[gk], re.I)
        if pm:
            co_phone = " ".join(pm.group(1).split()).strip(" -")
        em = re.search(r"E-?mail\s*:\s*([^\s;,]+@[^\s;,]+)", lines[gk], re.I)
        if em:
            co_email = em.group(1).rstrip(".;,")
    if co_phone is None:
        emit.null("compliance_officer_phone", "no_telephone_on_the_contact_person_line",
                  page_for(gk))
    else:
        emit.put("compliance_officer_phone", co_phone, page_for(gk),
                 "phone_fits_column_and_has_enough_digits",
                 (len(co_phone) <= 50 and sum(c.isdigit() for c in co_phone) >= 8,
                  co_phone))
    if co_email is None:
        emit.null("compliance_officer_email", "no_email_on_the_contact_person_line",
                  page_for(gk))
    else:
        emit.put("compliance_officer_email", co_email, page_for(gk),
                 "email_fits_column_and_is_addressable",
                 (len(co_email) <= 255 and co_email.count("@") == 1, co_email))

    cin = None
    cidx = _find(lines, CIN_RX)
    if cidx >= 0:
        cin = CIN_RX.search(lines[cidx]).group(1)
    emit.put("cin", cin, page_for(cidx), "cin_matches_mca_pattern", check_cin(cin))

    # ---- F1 / F3 -----------------------------------------------------------
    # The one-paragraph business description sits between the offer tables and the
    # "THE OFFER IS BEING MADE THROUGH THE BOOK BUILDING PROCESS" line. Issuers
    # open it with "WE ARE A ..." or "Our Company <verb> ...".
    bd_start = _find(lines, re.compile(
        r"^\s*(?:WE ARE A\b|Our Company (?:is|processes|manufactures|operates|provides|"
        r"designs|develops|owns|distributes)\b)", re.I))
    desc = None
    if bd_start >= 0:
        buf = []
        for ln in lines[bd_start:bd_start + 8]:
            if re.match(r"^\s*THE (?:ISSUE|OFFER) IS BEING MADE", ln, re.I):
                break
            buf.append(ln.strip())
        desc = " ".join(buf).strip()
    spliced = False
    if desc:
        desc, spliced = _cut_column_splice(desc)
    if spliced and (not desc or len(desc) < 60):
        emit.null("business_description", "description_column_splice", page_for(bd_start))
    else:
        emit.put("business_description", desc, page_for(bd_start), "description_within_length",
                 check_text_length(desc, 1200))

    # Objects of the offer — many price band advertisements do not reprint them.
    obj_idx = _find(lines, re.compile(r"^\s*OBJECTS OF THE (?:OFFER|ISSUE)\b", re.I))
    if obj_idx < 0:
        emit.null("objects_of_offer", "objects_section_not_in_document")
    else:
        objs = []
        for ln in lines[obj_idx + 1:obj_idx + 12]:
            t = ln.strip()
            if not t or re.match(r"^[A-Z ]{12,}$", t):
                break
            objs.append(t)
        emit.put("objects_of_offer", objs or None, page_for(obj_idx), "objects_listed",
                 (bool(objs), "%s entries" % len(objs)))

    # W-32: concentration KPIs are read GENERICALLY from the risk-factor /
    # justification sentences ("<subject> ... representing X%, Y% and Z% of ..."),
    # not as issuer-specific named fields. Each entry keeps the sentence's own
    # subject as its label plus one percentage per fiscal year.
    kpis, kpi_page = concentration_kpis(all_lines, fiscal_years)
    if not kpis:
        emit.null("concentration_kpis", "no_concentration_sentence_found")
    else:
        bad = [k for k in kpis if not (0 < k["value_pct"] <= 100)]
        emit.put("concentration_kpis", kpis, kpi_page, "concentration_percentages_in_range",
                 (not bad, "%s entries" % len(kpis) if not bad else "out of range: %s" % bad))

    # ---- E5/F5 (W-74): syndicate members + litigation notices --------------
    members, syn_idx = syndicate_members(lines)
    if not members:
        emit.null("syndicate_members", "section_not_found")
    else:
        overlong = [m["name"] for m in members if len(m["name"]) > 255]
        emit.put("syndicate_members", members, page_for(syn_idx),
                 "syndicate_member_names_storable",
                 (not overlong, "%s members" % len(members) if not overlong
                  else "names over 255 chars: %s" % overlong))

    banks, bank_idx = issue_banks(lines)
    if not banks:
        emit.null("issue_banks", "no_sponsor_escrow_or_public_issue_bank_line")
    else:
        overlong = [b["name"] for b in banks if len(b["name"]) > 255]
        emit.put("issue_banks", banks, page_for(bank_idx), "issue_bank_names_storable",
                 (not overlong, "%s banks" % len(banks) if not overlong
                  else "names over 255 chars: %s" % overlong))

    notices, lit_idx = litigation_notices(lines)
    if not notices:
        emit.null("litigation_notices", "section_not_found")
    else:
        overlong = [n["summary"] for n in notices
                    if len(n["summary"]) > LITIGATION_SUMMARY_MAX]
        emit.put("litigation_notices", notices, page_for(lit_idx),
                 "litigation_summaries_bounded",
                 (not overlong, "%s notices" % len(notices) if not overlong
                  else "summaries over %d chars: %s" % (LITIGATION_SUMMARY_MAX, overlong)))

    return {"unit": unit, "fiscal_years": fiscal_years}


CONCENTRATION_TRIGGER = re.compile(
    r"\b(?:representing|accounted for|contributed|contributing|comprising|constituting)\b", re.I)
# A concentration sentence is ABOUT a concentration; the trigger word alone also
# appears in unrelated prose that happens to sit beside a percentage column.
CONCENTRATION_SUBJECT = re.compile(
    r"\b(?:top\s+\d+\s+\w+|concentrat\w*|significant portion|"
    r"(?:southern|northern|eastern|western|south|north|east|west)\s+india|"
    r"geograph\w*|single (?:customer|supplier|brand)|largest\s+\w+)\b", re.I)
PCT = re.compile(r"(\d{1,3}(?:\.\d{1,2})?)\s*%")
# The sentence's SUBJECT is what the percentages are about — take the words that
# immediately precede the first predicate verb.
_PREDICATE = re.compile(
    r"\b(amounted|accounted|contributed|contributing|represent\w*|stood|was|were|is|are|had)\b",
    re.I)
_LEAD_NOISE = re.compile(r"^(?:our|we|the|its|their|a|an|of|for|and|in|to)$", re.I)


def _kpi_label(prefix):
    """Slug of the sentence subject that the percentages describe."""
    verb = _PREDICATE.search(prefix)
    subject = prefix[:verb.start()] if verb else prefix
    words = [w for w in re.findall(r"[A-Za-z0-9]+", subject)
             if not re.fullmatch(r"(?:19|20)\d{2}", w)][-6:]
    while words and (_LEAD_NOISE.match(words[0]) or words[0].isdigit()):
        words.pop(0)
    if len(words) < 2 or any(len(w) >= 3 and w.isdigit() for w in words):
        return None
    return "_".join(w.lower() for w in words)


def concentration_kpis(all_lines, fiscal_years):
    """Generic replacement for the three Purple-Style-Labs-specific fields (W-32).

    Scans concentration sentences in the risk-factor / justification prose for a
    run of percentages and returns [{label, value_pct, fiscal_year}]. Lines are
    read pairwise because the newspaper layout wraps a sentence across two lines,
    and a repeated percentage tuple is emitted once (the same fact is restated in
    the "Justification for Basis for the Offer Price" section).
    """
    out, page, seen_label, seen_values = [], None, set(), set()
    texts = [ln for _i, ln in all_lines]
    for idx in range(len(texts)):
        # Three lines: the newspaper wraps a long concentration sentence over up
        # to three physical lines of its column.
        joined = " ".join(texts[idx:idx + 3])
        for sentence in re.split(r"(?<=[.])\s+(?=[A-Z0-9])", joined):
            trig = CONCENTRATION_TRIGGER.search(sentence)
            if not trig or not CONCENTRATION_SUBJECT.search(sentence):
                continue
            pcts = [float(m.group(1)) for m in PCT.finditer(sentence[trig.start():])]
            label = _kpi_label(sentence[:trig.start()])
            if not pcts or not label or label in seen_label:
                continue
            years = [int(y) for y in re.findall(r"Fiscal\s+(20\d{2})", sentence)]
            years = sorted(set(years), reverse=True) or sorted(fiscal_years, reverse=True)
            pcts = pcts[:len(years)] if years else pcts
            key = tuple(pcts)
            if not pcts or key in seen_values:
                continue
            seen_label.add(label)
            seen_values.add(key)
            for n, value in enumerate(pcts):
                out.append({"label": label, "value_pct": value,
                            "fiscal_year": years[n] if n < len(years) else None})
            if page is None:
                page = all_lines[idx][0]
    return out, page


# --------------------------------------------------------------------------- #
# RHP / PROSPECTUS / DRHP extraction (group C from the restated P&L, F2 count)
# --------------------------------------------------------------------------- #
_UTILISATION_RX = re.compile(r"^\s*Utilisation of (?:the )?Net Proceeds\s*:?\s*$", re.I)
_OBJ_STOP_RX = re.compile(
    r"^(?:\(\d+\)|Proposed schedule|Means of finance|Details of Objects|Offer|Total\b)", re.I)
_OBJ_SKIP_RX = re.compile(r"^(?:\(?in\s+.{0,14}(?:million|lakh|crore)|Sr\.?\s*No\b)", re.I)
# A trailing cell: either a printed amount (2,150.00) or an unpriced placeholder
# the prospectus writes as [bullet] / [•] / [●] because the price is not yet set.
_AMT_TAIL_RX = re.compile(r"(\[\s*\S{0,3}\s*\]|[\d,]+\.\d{2})\s*$")


def _fresh_issue_amount(page_texts):
    """The fresh issue size the objects table must reconcile against."""
    for idx, text in page_texts:
        m = re.search(r"Gross Proceeds of the Fresh Issue[^\d\n]*([\d,]+\.\d{2})",
                      text or "", re.I)
        if m:
            return _num(m.group(1)), idx
    for idx, text in page_texts:
        m = re.search(r"Fresh Issue of up to.{0,240}?aggregating up to\s*([\d,]+(?:\.\d+)?)\s*"
                      r"\n?\s*million", text or "", re.I | re.S)
        if m:
            return _num(m.group(1)), idx
    return None, None


def extract_objects_of_offer(page_texts):
    """E5: the 'Utilisation of Net Proceeds' table of the OBJECTS OF THE OFFER
    chapter — one row per object, amount in the document's own million unit.

    Returns (items, page). A row whose amount cell is an unpriced `[bullet]`
    yields `amount_mn: None` with `check: "not_priced_yet"` rather than a
    guessed number."""
    for idx, text in page_texts:
        lines = (text or "").split("\n")
        start = None
        for i, ln in enumerate(lines):
            if _UTILISATION_RX.match(ln):
                start = i + 1
                break
        if start is None:
            continue
        rows = []
        for ln in lines[start:]:
            s = ln.strip()
            if not s:
                if rows:
                    break
                continue
            if _OBJ_STOP_RX.match(s):
                break
            if _OBJ_SKIP_RX.match(s):
                continue
            m = re.match(r"^(\d{1,3})\.\s+(.*)$", s)
            if m:
                rows.append([m.group(2)])
            elif rows:
                rows[-1].append(s)
        items = []
        for row in rows:
            amount_tok, label_parts = None, []
            for part in row:
                mm = _AMT_TAIL_RX.search(part)
                if mm and amount_tok is None:
                    amount_tok = mm.group(1)
                    part = part[:mm.start()]
                label_parts.append(part.strip())
            label = re.sub(r"\s+", " ", " ".join(p for p in label_parts if p)).strip()
            label = re.sub(r"\(\d+\)$", "", label).strip()
            if not label:
                continue
            if amount_tok is None:
                items.append({"label": label, "amount_mn": None, "check": "no_amount_printed"})
            elif amount_tok.startswith("["):
                items.append({"label": label, "amount_mn": None, "check": "not_priced_yet"})
            else:
                items.append({"label": label, "amount_mn": _num(amount_tok), "check": "priced"})
        if items:
            return items, idx
    return [], None


_RF_HEAD_RX = re.compile(r"^\s*(?:SECTION\s+[IVXL]+\s*[-–—:]?\s*)?RISK FACTORS\s*$", re.I)
_SECTION_RX = re.compile(r"^\s*SECTION\s+[IVXL]+\b", re.I)


def extract_risk_factors(page_texts, limit=480):
    """E8: the numbered risk factors of the RISK FACTORS chapter.

    The chapter heading is matched in ANY of its printed forms ("SECTION II -
    RISK FACTORS" as well as a bare "RISK FACTORS"); a line carrying dot
    leaders is the table of contents, not the chapter. Items are accepted only
    in strict sequence (n == previous + 1), which is what separates a real risk
    factor from the nested lists and wrapped line numbers that also start with
    "<digits>." inside the chapter."""
    items, first_page, expected, in_section = [], None, 1, False
    for idx, text in page_texts:
        lines = [ln.strip() for ln in (text or "").split("\n")]
        headings = [ln for ln in lines if "...." not in ln]
        if not in_section:
            if any(_RF_HEAD_RX.match(ln) for ln in headings):
                in_section = True
                first_page = idx
            else:
                continue
        elif any(_SECTION_RX.match(ln) and not _RF_HEAD_RX.match(ln) for ln in headings):
            break
        current = None
        for ln in lines:
            m = re.match(r"^(\d{1,3})\.\s+(.+)$", ln)
            if m and int(m.group(1)) == expected:
                current = {"n": expected, "parts": [m.group(2)]}
                items.append(current)
                expected += 1
                continue
            if current is not None:
                if not ln or re.match(r"^\d{1,4}$", ln) or re.match(r"^\d{1,3}\.\s", ln):
                    current = None
                else:
                    current["parts"].append(ln)
    out = []
    for item in items:
        joined = re.sub(r"\s+", " ", " ".join(item["parts"])).strip()
        sentence = re.match(r"^(.+?[.?!])(?:\s|$)", joined)
        if sentence:
            # A found first sentence is used verbatim — W-80: never truncate it,
            # even past `limit`, so a short heading is never mangled by a cap
            # meant for the no-sentence fallback below.
            heading = sentence.group(1)
        elif len(joined) <= limit:
            heading = joined
        else:
            # No sentence-ending punctuation within reach: cut at the last word
            # boundary before `limit` chars (never mid-word, never mid-number —
            # both are single unbroken tokens with no internal whitespace) and
            # mark the cut with an ellipsis so a truncated heading is visibly
            # partial rather than looking like a complete, un-terminated one.
            cut = joined[:limit].rstrip()
            last_space = cut.rfind(" ")
            if last_space > 0:
                cut = cut[:last_space]
            heading = cut.rstrip() + "…"
        out.append({"n": item["n"], "heading": heading.strip()})
    return out, first_page


def extract_rhp(page_texts, emit):
    # Strip the rupee glyphs before the shared core: prospectuses write
    # "(<glyph> in million)", and the unit detector's "in <unit>" pattern will not
    # match across the glyph, so it would silently fall back to the SME default.
    # Money parsing is unaffected (the glyph is never part of a number token).
    cleaned = [(i, re.sub(r"[`₹]", " ", t or "")) for i, t in page_texts]
    pnl = extract_pnl_from_texts(cleaned)
    fiscal_years = pnl.get("annualYears") or []
    metrics = pnl.get("metrics") or {}
    # MAJOR-1 (C7): do NOT trust `pnl["unit"]` — the shared module's own detector
    # silently defaults to "lakhs" when no "in <unit>" line is found (that default
    # exists only so numeric column alignment never crashes; it is not a claim the
    # unit is known). This extractor does its own presence check, over every page
    # including the cover, and writes null when no explicit unit line exists.
    unit, unit_page = _find_unit(cleaned)

    emit.put("fiscal_years", fiscal_years, None, "fiscal_years_consecutive",
             check_fy_series({str(y): 0 for y in fiscal_years}, fiscal_years))
    emit.put("unit", unit, unit_page, "unit_not_stated",
             (unit is not None, "%s" % unit if unit else "no explicit unit line found"))
    for key, name in (("revenue", "revenue_by_fy"), ("totalIncome", "total_income_by_fy"),
                      ("profit", "pat_by_fy"), ("eps", "eps_basic_by_fy"),
                      ("ebitda", "ebitda_by_fy"), ("netWorth", "net_worth_by_fy")):
        series = {str(k): v for k, v in (metrics.get(key) or {}).items()}
        emit.put_c_money(unit, name, series or None, None, "%s_year_series" % name,
                          check_fy_series(series, fiscal_years))

    # The RHP cover states its own date: "RED HERRING PROSPECTUS / Dated: August 25, 2026".
    rhp_date = None
    rhp_page = None
    dated_rx = re.compile(r"red herring prospectus\s*(?:\n|\s)*dated\s*:?\s*", re.I)
    for idx, text in page_texts[:3]:
        m = dated_rx.search(text or "")
        if m:
            rhp_date = _iso((text or "")[m.end():m.end() + 60])
            rhp_page = idx
            break
    emit.put("rhp_filing_date", rhp_date, rhp_page, "rhp_filing_date_on_cover",
             (rhp_date is not None, "%s" % rhp_date))

    # W-33: surface the shared core's named plausibility checks, and the metric it
    # rejected, instead of silently emitting a number that failed one.
    for chk in pnl.get("checks") or []:
        emit.put("financial_plausibility_%s" % chk["name"], chk["passed"] or None, None,
                 chk["name"], (chk["passed"], chk["detail"]))
    # When no unit line exists at all, put_c_money has already nulled every money
    # field with the C7 reason `unit_unknown`; do not overwrite that clearer
    # classification with the same finding worded as a plausibility failure.
    for key, reason in ((pnl.get("rejected") or {}) if unit is not None else {}).items():
        name = {"revenue": "revenue_by_fy", "totalIncome": "total_income_by_fy",
                "profit": "pat_by_fy", "eps": "eps_basic_by_fy",
                "ebitda": "ebitda_by_fy", "netWorth": "net_worth_by_fy"}.get(key)
        if name:
            emit.put(name, None, None, "plausibility_rejected", (False, reason))

    # E5: objects of the offer — the price band advertisement has no objects
    # section at all, so this is an RHP-only field.
    objects, obj_page = extract_objects_of_offer(cleaned)
    if not objects:
        emit.null("objects_of_offer", "no 'Utilisation of Net Proceeds' table found")
    else:
        priced = [o["amount_mn"] for o in objects if o["amount_mn"] is not None]
        fresh_issue, _fresh_page = _fresh_issue_amount(cleaned)
        emit.put("objects_of_offer", objects, obj_page, "objects_sum_vs_fresh_issue",
                 check_objects_total(sum(priced) if priced else None,
                                     len(objects) - len(priced), fresh_issue))

    # E8/F2: the numbered risk factors of the RISK FACTORS chapter.
    risks, first_page = extract_risk_factors(page_texts)
    emit.put("risk_factor_count", len(risks) or None, first_page, "risk_factor_minimum_count",
             check_min_count(len(risks), 20))
    emit.put("risk_factors", risks or None, first_page, "risk_factor_headings_complete",
             check_min_count(len(risks), 20))

    found = None
    for idx, text in page_texts:
        m = CIN_RX.search(text or "")
        if m:
            found = (m.group(1), idx)
            break
    emit.put("cin", found[0] if found else None, found[1] if found else None,
             "cin_matches_mca_pattern", check_cin(found[0] if found else None))
    return {"unit": unit, "fiscal_years": fiscal_years}


# --------------------------------------------------------------------------- #
def run(page_texts, doc_type, source_doc, segment="MAINBOARD", ocr_confidence=None):
    """`ocr_confidence` (D6/W-57): {page_index: confidence} for pages whose text
    came from OCR rather than from the PDF's own text layer."""
    emit = Emitter(source_doc)
    # E4/E5: a document with no text layer is classified, never guessed at.
    if not any((t or "").strip() for _i, t in page_texts):
        return {"doc_type": doc_type, "source_doc": source_doc, "pages": len(page_texts),
                "extraction_status": STATUS_NEEDS_OCR, "unit": None, "fiscal_years": [],
                "fields": {}}

    if doc_type == "PRICE_BAND_AD":
        meta = extract_price_band_ad(page_texts, emit, segment)
    else:
        meta = extract_rhp(page_texts, emit)

    status = STATUS_PARTIAL if emit.failed else STATUS_OK
    fields = emit.fields
    if ocr_confidence:
        from ocr_pages import annotate_fields, CONFIDENCE_FLOOR
        fields = annotate_fields(fields, ocr_confidence, CONFIDENCE_FLOOR)
        status = STATUS_OK_OCR if status == STATUS_OK else STATUS_PARTIAL_OCR

    return {
        "doc_type": doc_type,
        "source_doc": source_doc,
        "pages": len(page_texts),
        "extraction_status": status,
        "unit": meta.get("unit"),
        "fiscal_years": meta.get("fiscal_years") or [],
        "fields": fields,
    }


def extract(pdf_path, doc_type, segment="MAINBOARD", ocr=True,
            ocr_dpi=None, ocr_backend=None):
    """Read the PDF's text layer; for any page that has none worth trusting,
    fall back to the OCR route (D6/W-57) instead of stopping at NEEDS_OCR."""
    import pdfplumber
    with pdfplumber.open(pdf_path) as pdf:
        page_texts = [(i, p.extract_text() or "") for i, p in enumerate(pdf.pages)]

    ocr_confidence = {}
    if ocr:
        import ocr_pages
        scanned = [i for i, t in page_texts if ocr_pages.needs_ocr(t)]
        if scanned:
            backend = ocr_backend or ocr_pages.DEFAULT_BACKEND
            if not ocr_pages.backend_available(backend):
                sys.stderr.write("ocr backend %s unavailable; pages %s left as-is\n"
                                 % (backend, scanned))
            else:
                recovered = ocr_pages.ocr_pdf_pages(
                    pdf_path, scanned, ocr_dpi or ocr_pages.DEFAULT_DPI, backend)
                by_page = dict(page_texts)
                for idx, text, conf in recovered:
                    by_page[idx] = text
                    ocr_confidence[idx] = conf
                page_texts = sorted(by_page.items())

    return run(page_texts, doc_type, os.path.basename(pdf_path), segment,
               ocr_confidence or None)


def main():
    argv = sys.argv[1:]
    doc_type = "RHP"
    if "--doc-type" in argv:
        doc_type = argv[argv.index("--doc-type") + 1].upper()
    if doc_type not in DOC_TYPES:
        print(json.dumps({"error": "unknown doc type %s" % doc_type}))
        sys.exit(2)
    segment = "SME" if "--sme" in argv else "MAINBOARD"
    positional = [a for a in argv if not a.startswith("--") and a != doc_type]

    if "--texts" in argv:
        with open(positional[0], "r", encoding="utf-8") as fh:
            pages = json.load(fh)
        out = run([(int(p[0]), p[1]) for p in pages], doc_type,
                  os.path.basename(positional[0]), segment)
    else:
        ocr_dpi = int(argv[argv.index("--ocr-dpi") + 1]) if "--ocr-dpi" in argv else None
        backend = argv[argv.index("--backend") + 1] if "--backend" in argv else None
        out = extract(positional[0], doc_type, segment, ocr="--no-ocr" not in argv,
                      ocr_dpi=ocr_dpi, ocr_backend=backend)
    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    main()
