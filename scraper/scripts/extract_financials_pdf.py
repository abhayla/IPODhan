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

MONEY = re.compile(r"-?\(?\d[\d,]*\.\d{2}\)?")
MARCH = re.compile(r"March\s+31,?\s*(20\d{2})", re.I)

# Metric label -> output key. Order matters (first match wins per line).
PNL_METRICS = [
    (re.compile(r"revenue\s+from\s+operations", re.I), "revenue"),
    (re.compile(r"total\s+income", re.I), "totalIncome"),
    (re.compile(r"profit\s+(for\s+the\s+(period|year)|after\s+tax)", re.I), "profit"),
    (re.compile(r"basic\s+eps|basic\s+earnings\s+per", re.I), "eps"),
]
OTHER_METRICS = [
    (re.compile(r"^\s*EBITDA\b(?!\s*Margin)", re.I), "ebitda"),
    (re.compile(r"net\s*worth", re.I), "netWorth"),
]


def money_values(line):
    """All money-like numbers on a line (2-decimal), accounting-negatives handled."""
    out = []
    for tok in MONEY.findall(line):
        neg = tok.startswith("(") and tok.endswith(")")
        n = tok.strip("()").replace(",", "")
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


def extract_from_texts(page_texts):
    """Pure core: given [(page_index, text)], return the extracted financials.

    Separated from PDF I/O so it can be unit-tested offline on captured page text.
    """
    result = {"unit": "lakhs", "annualYears": [], "metrics": {}, "pages": 0}
    if True:
        # 1. Locate the restated P&L statement page.
        pnl_text = None
        for _i, t in page_texts:
            if re.search(r"restated.*statement of profit and loss", t, re.I) and MONEY.search(t):
                pnl_text = t
                break
        if pnl_text is None:
            return result
        result["unit"] = detect_unit(pnl_text)

        # 2. Annual column years (descending) from the header.
        march_years = []
        for y in MARCH.findall(pnl_text):
            yi = int(y)
            if yi not in march_years:
                march_years.append(yi)
        if not march_years:
            return result
        result["annualYears"] = march_years

        # 3. Column count from the revenue-from-operations row; infer leading interim.
        rev_line = next((ln for ln in pnl_text.split("\n") if re.search(r"revenue\s+from\s+operations", ln, re.I)), None)
        if not rev_line:
            return result
        k = len(money_values(rev_line))
        interim = max(0, k - len(march_years))
        if interim > 1 or k < len(march_years):
            return result  # ambiguous header — emit nothing rather than misalign

        # columnFY[i] = fiscal year for data column i (None for the leading interim)
        column_fy = ([None] * interim) + march_years

        def align(line):
            vals = money_values(line)
            if len(vals) == len(column_fy):
                return {column_fy[i]: vals[i] for i in range(len(vals)) if column_fy[i] is not None}
            if len(vals) == len(march_years):  # row omits the interim column
                return {march_years[i]: vals[i] for i in range(len(vals))}
            return None

        # 4. P&L metrics on the statement page.
        for ln in pnl_text.split("\n"):
            for rx, key in PNL_METRICS:
                if key in result["metrics"]:
                    continue
                if rx.search(ln):
                    mapped = align(ln)
                    if mapped:
                        result["metrics"][key] = mapped
                    break

        # 5. EBITDA + Net Worth searched doc-wide, aligned to the same columns.
        for i, t in page_texts:
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

    return result


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    keep = "--keep" in sys.argv
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
