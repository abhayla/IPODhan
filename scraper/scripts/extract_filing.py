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
)

DOC_TYPES = ("RHP", "PRICE_BAND_AD", "PROSPECTUS", "DRHP")

STATUS_OK = "OK"
STATUS_PARTIAL = "PARTIAL"
STATUS_NEEDS_OCR = "NEEDS_OCR"

# `[●]` (and the `[•]`/`[.]` variants pdfplumber emits) marks a cell that cannot be
# filled until the issue is priced — E3: null with reason, never a guess.
TBD = re.compile(r"\[\s*[•●○▪·.\-]\s*\]")

MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june",
     "july", "august", "september", "october", "november", "december"])}
DATE_RX = re.compile(
    r"(January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+(\d{1,2}),?\s*(20\d{2})", re.I)

CIN_RX = re.compile(r"\b([UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b")


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


def check_shares_amount(shares, price, amount_mn, unit="millions", tol=0.005):
    """shares x price ~= the printed issue amount, within +/-0.5%.

    MAJOR-3: the printed amount is in the document's OWN money unit, so the
    divisor comes from the detected unit, never a hard-coded ₹ million. With no
    detected unit the check fails CLOSED — a crore-denominated ad must surface a
    reason, not silently pass a 10x-wrong comparison.
    """
    mult = unit_multiplier(unit)
    if mult is None:
        return False, "unit_unknown: cannot compare shares x price to a printed amount"
    if None in (shares, price, amount_mn) or amount_mn == 0:
        return False, "shares, price or amount missing"
    computed = shares * price / mult
    drift = abs(computed - amount_mn) / abs(amount_mn)
    if drift > tol:
        return False, "%sx%s = %.2f %s vs printed %s (%.4f%%)" % (
            shares, price, computed, unit, amount_mn, drift * 100)
    return True, "%.2f %s ~= %s (%.4f%%)" % (computed, unit, amount_mn, drift * 100)


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


def check_mcap_consistency(mcap_floor, floor, shares_floor, mcap_cap, cap, shares_cap,
                           unit="millions", tol=0.005):
    """Market cap, price and fresh-issue share count must be mutually consistent,
    not just individually monotonic (MAJOR-2). mcap (Rs million) / price gives the
    POST-issue share count at that price point; subtracting the fresh-issue shares
    at that same price point gives the implied PRE-issue share count. That implied
    count must agree whether computed at floor or at cap, within +/-0.5% — a
    mismatch means at least one of mcap/shares/price was misread from the table.
    """
    mult = unit_multiplier(unit)
    if mult is None:
        return False, "unit_unknown: market capitalisation has no known money unit"
    if None in (mcap_floor, floor, shares_floor, mcap_cap, cap, shares_cap) or not floor or not cap:
        return False, "missing inputs"
    pre_floor = mcap_floor * mult / floor - shares_floor
    pre_cap = mcap_cap * mult / cap - shares_cap
    denom = max(abs(pre_floor), abs(pre_cap), 1.0)
    drift = abs(pre_floor - pre_cap) / denom
    if drift > tol:
        return False, "implied pre-issue shares %.0f (floor) != %.0f (cap) (%.4f%%)" % (
            pre_floor, pre_cap, drift * 100)
    return True, "implied pre-issue shares %.0f ~= %.0f (%.4f%%)" % (pre_floor, pre_cap, drift * 100)


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


def check_holding_dilution(pre_pct, post_pct, shares_held=None, fresh_shares=None, tol=0.01):
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
        pre_shares = shares_held * 100.0 / pre_pct
        expected_post = pre_pct * pre_shares / (pre_shares + fresh_shares)
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
#
# MAJOR-3 (T-430 round 2): the presence check itself must not false-match PROSE.
# "3 million customers in millions of cities" and "in lakhs of homes" both used to
# match, and every C-group money field is scaled by the detected unit — so a prose
# match is a silent 10x/100x error carrying a GREEN check. Only two shapes count:
#   (a) currency-anchored — "₹ in million", "Rs. in lakhs", "INR in crores";
#   (b) caption-anchored  — "in million)" / "in lakhs, unless otherwise stated" /
#       "in million, except per share data" — the shape a units caption takes.
# "in <unit> of ..." is rejected outright: that is always prose.
UNIT_WORD = r"(million|millions|lakh|lakhs|crore|crores)"
UNIT_CURRENCY_RX = re.compile(r"(?:₹|`|rs\.?|inr|rupees?)\s*in\s+" + UNIT_WORD + r"\b", re.I)
UNIT_CAPTION_RX = re.compile(
    r"\bin\s+" + UNIT_WORD + r"\b\s*(?:\)|,?\s*unless\s+otherwise\s+stated|,?\s*except\b)", re.I)


def _canonical_unit(word):
    w = word.lower()
    if w.startswith("lakh"):
        return "lakhs"
    if w.startswith("cror"):
        return "crores"
    return "millions"


def _unit_hits(rx, cleaned, idx, out):
    """Collect (unit, page) for every match of `rx` that is not prose ("in X of")."""
    for m in rx.finditer(cleaned):
        if re.match(r"\s+of\b", cleaned[m.end():m.end() + 4]):
            continue  # "in millions of cities" — prose, never a units caption
        out.append((_canonical_unit(m.group(1)), idx))


def _find_unit(page_texts):
    """Explicit unit-line detection (C7 + MAJOR-3). Returns (unit, page, detail).

    Currency-anchored matches are a stronger tier than caption-anchored ones and
    win outright when present. Within the surviving tier, two DIFFERENT units
    across the document is a contradiction we refuse to resolve: the unit is
    nulled with reason `unit_conflict` so every C-group money field fails closed.
    """
    currency, caption = [], []
    for idx, text in page_texts:
        raw = text or ""
        # The rupee glyph survives for the currency anchor; the caption anchor runs
        # on a glyph-stripped copy so "(` in million)" still closes on ")".
        _unit_hits(UNIT_CURRENCY_RX, raw, idx, currency)
        _unit_hits(UNIT_CAPTION_RX, re.sub(r"[`₹’]", " ", raw), idx, caption)
    hits = currency or caption
    if not hits:
        return None, None, "no explicit unit line found"
    units = {u for u, _ in hits}
    if len(units) > 1:
        pages = sorted({p for _u, p in hits})
        return None, None, "unit_conflict: %s across pages %s" % (
            ", ".join(sorted(units)), pages)
    unit, page = hits[0]
    return unit, page, unit


UNIT_MULTIPLIER = {"millions": 1_000_000.0, "lakhs": 100_000.0, "crores": 10_000_000.0}


def unit_multiplier(unit):
    """Rupees per printed money unit, or None when the unit is unknown."""
    return UNIT_MULTIPLIER.get(unit)


# --------------------------------------------------------------------------- #
# PRICE_BAND_AD extraction (groups A, B, C-as-reprinted, D, E, F)
# --------------------------------------------------------------------------- #
def extract_price_band_ad(page_texts, emit, segment="MAINBOARD"):
    # MAJOR-3: the A/B market-cap and issue-amount checks are money-unit dependent,
    # so the unit must be known BEFORE them, not only before the C block below.
    unit, unit_page, unit_detail = _find_unit(page_texts)
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
    k = _find(lines, re.compile(r"FLOOR PRICE AND THE CAP PRICE ARE", re.I))
    fm_floor = fm_cap = None
    if k >= 0:
        m = re.search(r"ARE\s+([\d.]+)\s+TIMES\s+AND\s+([\d.]+)\s+TIMES", lines[k], re.I)
        if m:
            fm_floor, fm_cap = float(m.group(1)), float(m.group(2))
    emit.put("floor_multiple_of_face", fm_floor, page_for(k), "floor_multiple_recomputed",
             check_face_multiple(floor, face, fm_floor))
    emit.put("cap_multiple_of_face", fm_cap, page_for(k), "cap_multiple_recomputed",
             check_face_multiple(cap, face, fm_cap))

    # ---- A7/A8: the fresh-issue / market-cap table -------------------------
    shares_floor = amt_floor = shares_cap = amt_cap = None
    fi = _find(lines, re.compile(r"^\s*Fresh Issue\s+[\d,]", re.I))
    if fi >= 0:
        vals = money_values(lines[fi])
        if len(vals) >= 4:
            shares_floor, amt_floor, shares_cap, amt_cap = vals[-4:]
    ofs_amount = None
    oi = _find(lines, re.compile(r"^\s*Offer for sale\b", re.I))
    if oi >= 0:
        vals = money_values(lines[oi])
        ofs_amount = 0.0 if not vals else vals[-1]
    mcap_floor = mcap_cap = None
    mi = _find(lines, re.compile(r"Post-?Issue market capitali[sz]ation", re.I))
    if mi >= 0:
        vals = money_values(lines[mi])
        if len(vals) >= 2:
            mcap_floor, mcap_cap = vals[-2:]

    emit.put("shares_at_floor", shares_floor, page_for(fi), "shares_x_price_equals_amount",
             check_shares_amount(shares_floor, floor, amt_floor, unit))
    emit.put("shares_at_cap", shares_cap, page_for(fi), "shares_x_price_equals_amount",
             check_shares_amount(shares_cap, cap, amt_cap, unit))
    emit.put("fresh_issue_amount", amt_floor, page_for(fi), "fresh_issue_amount_consistent",
             (amt_floor is not None and amt_cap == amt_floor,
              "%s at both prices" % amt_floor if amt_floor == amt_cap
              else "%s vs %s" % (amt_floor, amt_cap)))
    emit.put("ofs_amount", ofs_amount, page_for(oi), "ofs_non_negative",
             (ofs_amount is not None and ofs_amount >= 0, "%s" % ofs_amount))
    emit.put("shares_monotonic", shares_floor is not None and shares_cap is not None,
             page_for(fi), "more_shares_at_floor_than_cap",
             check_monotonic_shares(shares_floor, shares_cap))
    mcap_check = _combine(
        check_monotonic_mcap(mcap_floor, mcap_cap),
        check_mcap_consistency(mcap_floor, floor, shares_floor, mcap_cap, cap, shares_cap, unit),
    )
    emit.put("market_cap_at_floor", mcap_floor, page_for(mi),
             "market_cap_ordering_and_consistency", mcap_check)
    emit.put("market_cap_at_cap", mcap_cap, page_for(mi),
             "market_cap_ordering_and_consistency", mcap_check)
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
    ai = _find(lines, re.compile(r"QIB PORTION\s*:", re.I))
    qib = nii = retail = None
    if ai >= 0:
        m = re.search(r"QIB PORTION\s*:\s*NOT LESS THAN\s*([\d.]+)\s*%", lines[ai], re.I)
        n = re.search(r"NON-?\s?INSTITUTIONAL PORTION\s*:\s*NOT MORE THAN\s*([\d.]+)\s*%",
                      lines[ai], re.I)
        r = re.search(r"RETAIL PORTION\s*:\s*NOT MORE THAN\s*([\d.]+)\s*%", lines[ai], re.I)
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
    labels = {
        "anchor_bid_date": re.compile(r"Anchor Investor bidding date", re.I),
        "open_date": re.compile(r"Bid/\s?Issue opens on", re.I),
        "close_date": re.compile(r"Bid/\s?Issue closes on", re.I),
        "basis_of_allotment_date": re.compile(r"Finalisation of Basis of Allotment", re.I),
        "refund_date": re.compile(r"Initiation of refunds", re.I),
        "credit_date": re.compile(r"Credit of Equity Shares to demateriali", re.I),
        "listing_date": re.compile(r"Commencement of trading of the Equity Shares", re.I),
    }
    tt = _find(lines, re.compile(r"indicative timetable", re.I))
    dates, date_pages = {}, {}
    for name, rx in labels.items():
        idx = _find(lines, rx, max(tt, 0))
        if idx < 0:
            continue
        # The newspaper's two-column layout splits "On or about" from its date, and
        # the intervening line belongs to the OTHER column — so look ahead up to two
        # lines, stopping at the next event label so a date is never stolen from it.
        iso = None
        for look in range(idx, min(idx + 3, len(lines))):
            if look > idx and any(r.search(lines[look]) for n, r in labels.items() if n != name):
                break
            iso = _iso(lines[look])
            if iso:
                break
        if iso:
            dates[name] = iso
            date_pages[name] = page_for(idx)
    tl = check_timeline(dates)
    for name in labels:
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
    fi2 = _find(lines, re.compile(r"red herring prospectus dated", re.I))
    rhp_date = _iso(lines[fi2]) if fi2 >= 0 else None
    emit.put("rhp_filing_date", rhp_date, page_for(fi2), "rhp_filed_before_open",
             check_date_before(rhp_date, dates.get("open_date"), "RHP filing before bid open"))

    # ---- C: fiscal years + the reprinted financial rows --------------------
    fiscal_years = []
    hy = _find(lines, re.compile(r"^\s*20\d{2}\s+20\d{2}\s+20\d{2}\s*$"))
    if hy >= 0:
        fiscal_years = [int(y) for y in re.findall(r"20\d{2}", lines[hy])]
    # MAJOR-1 (C7): the unit must be read EXPLICITLY, never defaulted — search the
    # whole ad (it is a single/few-page cover document) for an "in <unit>" line.
    def series_row(rx, count, start=0):
        idx = _find(lines, rx, start)
        if idx < 0 or not fiscal_years:
            return None, None
        vals = money_values(lines[idx])
        if len(vals) < count:
            return None, None
        tail = vals[-count:]
        return {str(fiscal_years[n]): tail[n] for n in range(count)}, page_for(idx)

    ncols = len(fiscal_years) or 3
    pat, pat_page = series_row(re.compile(r"Profit/\(Loss\) after tax", re.I), ncols)
    ocf, ocf_page = series_row(re.compile(r"operating activities", re.I), ncols)
    dscr, dscr_page = series_row(re.compile(r"Debt service coverage ratio", re.I), ncols)
    rent, rent_page = series_row(re.compile(r"Rent expenses", re.I), ncols)

    emit.put("fiscal_years", fiscal_years, page_for(hy), "fiscal_years_consecutive",
             check_fy_series({str(y): 0 for y in fiscal_years}, fiscal_years))
    emit.put("unit", unit, unit_page, "unit_not_stated", (unit is not None, unit_detail))
    emit.put_c_money(unit, "pat_by_fy", pat, pat_page, "pat_year_series",
                      check_fy_series(pat or {}, fiscal_years))
    emit.put_c_money(unit, "op_cash_flow_by_fy", ocf, ocf_page, "op_cash_flow_year_series",
                      check_fy_series(ocf or {}, fiscal_years))
    emit.put_c_money(unit, "dscr_by_fy", dscr, dscr_page, "dscr_year_series",
                      check_fy_series(dscr or {}, fiscal_years))
    emit.put_c_money(unit, "rent_by_fy", rent, rent_page, "rent_year_series",
                      check_fy_series(rent or {}, fiscal_years))

    # EPS: "March 31, 2026 (41.98) (41.98) 3" — basic, diluted, weight, per year.
    eps_basic, eps_diluted, eps_page = {}, {}, None
    for idx, ln in enumerate(lines):
        m = re.match(r"\s*March\s+31,\s*(20\d{2})\b", ln)
        if not m:
            continue
        if m.group(1) in eps_basic:
            continue  # first occurrence is the EPS table; later ones are prose
        vals = money_values(ln)
        # The EPS row is exactly: [year-token, basic, diluted, weight]. Anything else
        # on a line starting with the same date is prose, not the table.
        if len(vals) == 4:
            basic, diluted, _weight = vals[-3:]
            eps_basic[m.group(1)] = basic
            eps_diluted[m.group(1)] = diluted
            eps_page = page_for(idx)
    emit.put_c_money(unit, "eps_basic_by_fy", eps_basic or None, eps_page, "eps_year_series",
                      check_fy_series(eps_basic, fiscal_years))
    emit.put_c_money(unit, "eps_diluted_by_fy", eps_diluted or None, eps_page, "eps_year_series",
                      check_fy_series(eps_diluted, fiscal_years))
    emit.put_c_money(unit, "eps_sign_matches_pat", bool(eps_basic and pat), eps_page,
                      "eps_sign_matches_pat", check_sign_consistency(eps_basic, pat or {}))
    bi = _find(lines, re.compile(r"Restated Consolidated Financial Information", re.I))
    emit.put("financial_basis", "restated_consolidated" if bi >= 0 else None, page_for(bi),
             "financial_basis_stated", (bi >= 0, "restated consolidated"))

    # ---- D: promoter and cost of acquisition -------------------------------
    prom = None
    pn = _find(lines, re.compile(r"^\s*OUR PROMOTER\s*:", re.I))
    if pn >= 0:
        prom = lines[pn].split(":", 1)[1].strip().title()
    emit.put("promoter_name", prom, page_for(pn), "promoter_name_present", (bool(prom), "%s" % prom))

    shares_held = pre_pct = post_pct_cap = None
    sh_page = None
    if prom:
        si = _find(lines, re.compile(r"^\s*1\.\s+" + re.escape(prom) + r"\s+[\d,]", re.I))
        if si >= 0:
            vals = money_values(lines[si])
            if len(vals) >= 7:
                shares_held, pre_pct = vals[1], vals[2]
                post_pct_cap = vals[6]
            sh_page = page_for(si)
    emit.put("promoter_shares_held", shares_held, sh_page, "promoter_shares_positive",
             (shares_held is not None and shares_held > 0, "%s" % shares_held))
    dil = check_holding_dilution(pre_pct, post_pct_cap, shares_held, shares_cap)
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
    emit.put("promoter_waca", waca, page_for(wi), "promoter_waca_positive",
             (waca is not None and waca > 0, "%s" % waca))
    if wi >= 0 and re.search(r"\bNil\b", lines[wi], re.I):
        emit.null("waca_last_1y", "bonus_nil", page_for(wi))

    waca_3y = mult_3y = None
    t3 = _find(lines, re.compile(r"^\s*Last three years\b", re.I))
    if t3 >= 0:
        vals = money_values(lines[t3])
        if len(vals) >= 2:
            waca_3y, mult_3y = vals[0], vals[1]
    wc = check_waca_multiple(cap, waca_3y, mult_3y)
    emit.put("waca_last_3y", waca_3y, page_for(t3), "cap_over_waca_equals_printed_multiple", wc)
    emit.put("cap_multiple_last_3y", mult_3y, page_for(t3),
             "cap_over_waca_equals_printed_multiple", wc)

    pp = _find(lines, re.compile(r"has not undertaken a pre-?IPO placement", re.I))
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

    gk = _find(lines, re.compile(r"Contact person\s*:", re.I))
    co = None
    if gk >= 0:
        m = re.search(r"Contact person\s*:\s*([A-Za-z .'\-]+?)\s*,", lines[gk], re.I)
        co = m.group(1).strip() if m else None
    emit.put("compliance_officer", co, page_for(gk), "compliance_officer_present",
             (bool(co), "%s" % co))

    cin = None
    cidx = _find(lines, CIN_RX)
    if cidx >= 0:
        cin = CIN_RX.search(lines[cidx]).group(1)
    emit.put("cin", cin, page_for(cidx), "cin_matches_mca_pattern", check_cin(cin))

    # ---- F1 / F3 -----------------------------------------------------------
    bd_start = _find(lines, re.compile(r"^\s*WE ARE A\b", re.I))
    desc = None
    if bd_start >= 0:
        buf = []
        for ln in lines[bd_start:bd_start + 8]:
            if re.match(r"^\s*THE ISSUE IS BEING MADE", ln, re.I):
                break
            buf.append(ln.strip())
        desc = " ".join(buf).strip()
    emit.put("business_description", desc, page_for(bd_start), "description_within_length",
             check_text_length(desc, 1200))

    def first_pct(rx):
        idx = _find(lines, rx)
        if idx < 0:
            return None, None
        m = re.search(r"(\d{1,3}\.\d{2})\s*%", lines[idx])
        return (float(m.group(1)) if m else None), page_for(idx)

    top10, p1 = first_pct(re.compile(r"^\s*contributed\s+\d{1,3}\.\d{2}%", re.I))
    women, p2 = first_pct(re.compile(r"contributing\s+\d{1,3}\.\d{2}%", re.I))
    city, p3 = first_pct(re.compile(r"^\s*\d{1,3}\.\d{2}% and \d{1,3}\.\d{2}%, respectively", re.I))
    emit.put("top10_brands_pct_fy2026", top10, p1, "percentage_in_range", check_percentage(top10))
    emit.put("womenswear_pct_fy2026", women, p2, "percentage_in_range", check_percentage(women))
    emit.put("mumbai_gmv_pct_fy2026", city, p3, "percentage_in_range", check_percentage(city))

    return {"unit": unit, "fiscal_years": fiscal_years}


# --------------------------------------------------------------------------- #
# RHP / PROSPECTUS / DRHP extraction (group C from the restated P&L, F2 count)
# --------------------------------------------------------------------------- #
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
    unit, unit_page, unit_detail = _find_unit(cleaned)

    emit.put("fiscal_years", fiscal_years, None, "fiscal_years_consecutive",
             check_fy_series({str(y): 0 for y in fiscal_years}, fiscal_years))
    emit.put("unit", unit, unit_page, "unit_not_stated", (unit is not None, unit_detail))
    for key, name in (("revenue", "revenue_by_fy"), ("totalIncome", "total_income_by_fy"),
                      ("profit", "pat_by_fy"), ("eps", "eps_basic_by_fy"),
                      ("ebitda", "ebitda_by_fy"), ("netWorth", "net_worth_by_fy")):
        series = {str(k): v for k, v in (metrics.get(key) or {}).items()}
        emit.put_c_money(unit, name, series or None, None, "%s_year_series" % name,
                          check_fy_series(series, fiscal_years))

    # F2: numbered risk-factor headings inside the "Risk Factors" section.
    headings, first_page = set(), None
    in_section = False
    for idx, text in page_texts:
        t = text or ""
        if re.search(r"^\s*RISK FACTORS\s*$", t, re.I | re.M):
            in_section = True
            if first_page is None:
                first_page = idx
        if not in_section:
            continue
        for ln in t.split("\n"):
            m = re.match(r"^\s*(\d{1,3})\.\s+[A-Z]", ln)
            if m:
                headings.add(int(m.group(1)))
    emit.put("risk_factor_count", len(headings) or None, first_page, "risk_factor_minimum_count",
             check_min_count(len(headings), 20))

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
def run(page_texts, doc_type, source_doc, segment="MAINBOARD"):
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

    return {
        "doc_type": doc_type,
        "source_doc": source_doc,
        "pages": len(page_texts),
        "extraction_status": STATUS_PARTIAL if emit.failed else STATUS_OK,
        "unit": meta.get("unit"),
        "fiscal_years": meta.get("fiscal_years") or [],
        "fields": emit.fields,
    }


def extract(pdf_path, doc_type, segment="MAINBOARD"):
    import pdfplumber
    with pdfplumber.open(pdf_path) as pdf:
        page_texts = [(i, p.extract_text() or "") for i, p in enumerate(pdf.pages)]
    return run(page_texts, doc_type, os.path.basename(pdf_path), segment)


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
        out = extract(positional[0], doc_type, segment)
    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    main()
