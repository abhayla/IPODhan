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
DEC_INTERIM = re.compile(r"(?:December\s+31,?\s*|31\s+December\s+)(20\d{2})", re.I)

# Metric label -> output key. Order matters (first match wins per line).
# `profit` matches loss-makers too — a loss-making issuer's bottom line reads
# "Loss for the year" / "(Loss)/profit for the period"; the sign is recovered by
# the accounting-negative (parenthesised) parsing in money_values (issue #67).
PNL_METRICS = [
    (re.compile(r"revenue\s+from\s+operations", re.I), "revenue"),
    (re.compile(r"total\s+income", re.I), "totalIncome"),
    (re.compile(r"(profit|loss)[\s/()]*(for\s+the\s+(period|year)|after\s+tax)", re.I), "profit"),
    # EPS: either the explicit "Basic EPS / Basic earnings per share" label, OR a
    # line that is just "(1) Basic ..." under a "loss/earnings per equity share"
    # section header (the mainboard layout — Ather). align() filters false
    # positives: a prose "basic" line lacks the trailing money columns.
    (re.compile(r"basic\s+(eps|earnings\s+per|loss\s+per)|^\s*\(?\s*1?\s*\)?\s*basic\b", re.I), "eps"),
]
OTHER_METRICS = [
    (re.compile(r"^\s*EBITDA\b(?!\s*Margin)", re.I), "ebitda"),
    (re.compile(r"net\s*worth", re.I), "netWorth"),
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
    return line


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


def detect_unit(text):
    t = text.lower()
    if re.search(r"in\s+lakh", t):
        return "lakhs"
    if re.search(r"in\s+cror", t):
        return "crores"
    if re.search(r"in\s+million", t):
        return "millions"
    return "lakhs"  # SME RHP default; consumer still applies plausibility bounds


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
    may be preceded by a Note-No. column or label digits, so the TRAILING
    len(column_fy) tokens are taken and mapped positionally; only annual (non-None)
    columns are emitted.
    """
    ncols = len(column_fy)

    def align(line):
        vals = money_values(line)
        if len(vals) >= ncols >= 1:
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
    if not re.search(r"statement\s+of\s+profit\s+and\s+loss", text, re.I):
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

    annual_years = []
    for y in MARCH.findall(header):
        yi = int(y)
        if yi not in annual_years:
            annual_years.append(yi)
    annual_years.sort(reverse=True)
    if not annual_years:
        return None

    interim = len(set(DEC_INTERIM.findall(header)))
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
    return {
        "unit": detect_unit(text),
        "years": annual_years,
        "metrics": metrics,
        "align": align,
        "score": len(metrics),
    }


def extract_from_texts(page_texts):
    """Pure core: given [(page_index, text)], return the extracted financials.

    Separated from PDF I/O so it can be unit-tested offline on captured page text.
    Always returns `metricsFound` + `lowConfidence` so the Node consumer can flag
    "extractor produced nothing" rather than persist silently-empty financials.
    """
    result = {
        "unit": "lakhs", "annualYears": [], "metrics": {}, "pages": 0,
        "metricsFound": 0, "lowConfidence": True,
    }

    # 1. Parse EVERY candidate P&L page; keep the richest (most metrics, then most
    #    annual columns). This skips summary/index pages that carry the title but no
    #    data rows, and reads the unit from the chosen DATA page (issue #67).
    candidates = [c for c in (_parse_pnl_page(t) for _i, t in page_texts) if c]
    if not candidates:
        return result
    best = max(candidates, key=lambda c: (c["score"], len(c["years"])))

    result["unit"] = best["unit"]
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

    # 3. Confidence signal — empty, or no revenue/total-income anchor, is low-confidence.
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
