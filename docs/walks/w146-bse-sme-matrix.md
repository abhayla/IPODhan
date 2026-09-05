# W-146 — BSE SME filing-extractor proof matrix (laptop-only)

Ran `scraper/scripts/extract_filing.py` (Python 3.13.7, `C:\Python313\python.exe`,
`pdfplumber==0.11.6`, no venv found — installed to the user site-packages) against
3 live BSE SME documents downloaded via curl (`-L`, browser UA, `Referer:
https://www.bsesme.com/`). Invocation: `python extract_filing.py <pdf> --doc-type
<RHP|PROSPECTUS> --sme` (default memory ceiling env, unset). All 3 downloads
succeeded (HTTP 200).

## Document facts

| Doc | Size | Pages | Text layer (p0 chars) | Cover says |
|---|---|---|---|---|
| Horizon Reclaim RHP | 6.1 MB | 325 | 5115 (native text) | Book-Built, Fresh 52.69L sh @ FV ₹10, size `[●]` (unpriced RHP) |
| Vahh Chemicals Prospectus | 5.9 MB | 345 | 4622 (native text) | **Fixed Price**, Fresh 22.42L sh, ₹1,345.20L (= ₹60/sh, 6.0x FV₹10), OFS N/A |
| Autofurnish Prospectus | 15.6 MB | 377 | 4902 (native text) | **100% Fixed Price**, Fresh 35.61L sh @ ₹41/sh, ₹1,460.01L, OFS N/A |

## Run results

| Doc | Exit | extraction_status | Wall time |
|---|---|---|---|
| Horizon RHP | 0 | PARTIAL_OCR | 64.2s |
| Vahh Prospectus | 0 | PARTIAL_OCR | 63.6s |
| Autofurnish Prospectus | 0 | PARTIAL_OCR | 63.8s |

Peak RSS: background-measured on Horizon run, psutil not confirmed within
budget (subprocess still running at report time — see note below); all 3
finished well under the default memory ceiling (exit 0, no ceiling-exit code 3).

## Headline field comparison (extractor output vs cover page)

| Field | Horizon RHP | Vahh Prospectus | Autofurnish Prospectus |
|---|---|---|---|
| Issue size | **NOT EXTRACTED** | **NOT EXTRACTED** | **NOT EXTRACTED** |
| Price band / fixed price | **NOT EXTRACTED** | **NOT EXTRACTED** | **NOT EXTRACTED** |
| Fixed-price recognized as such | N/A (field absent) | N/A (field absent) | N/A (field absent) |
| Face value | **NOT EXTRACTED** | **NOT EXTRACTED** | **NOT EXTRACTED** |
| Lot size | **NOT EXTRACTED** | **NOT EXTRACTED** | **NOT EXTRACTED** |
| Fresh vs OFS (headline) | **NOT EXTRACTED** | **NOT EXTRACTED** | **NOT EXTRACTED** |
| CIN | MATCH (U22199UP2006PLC032294) | MATCH (U24110GJ2019PLC111346) | MATCH (U51101DL2015PLC279742) |
| Revenue (3 FY) | extracted, 3/3 yrs | extracted, 3/3 yrs | **NOT EXTRACTED** (no values found) |
| PAT (3 FY) | **rejected** — plausibility check flagged 9.93x YoY jump | **rejected** — plausibility check flagged 7.49x YoY jump | **NOT EXTRACTED** |
| EBITDA (3 FY) | **rejected** — same YoY-bound trip | extracted, 3/3 yrs | **NOT EXTRACTED** |
| Net worth (3 FY) | extracted, 3/3 yrs | **rejected** — same YoY-bound trip | **NOT EXTRACTED** |

## What is broken, specific to BSE SME

1. **Root cause: `extract_price_band_ad()` — the ONLY function that emits
   `price_band_floor/cap`, `face_value`, `lot_size`, `fresh_issue_amount` — is
   dispatched only for `doc_type == PRICE_BAND_AD` (`extract_filing.py:2186`).
   For `RHP`/`PROSPECTUS`/`DRHP` the code calls `extract_rhp()` instead, which
   emits ONLY financials + `objects_of_offer` + `risk_factors` + `cin` — it
   never touches issue size, price, face value, or lot size at all. This is
   not an SME-specific bug in isolation — it means the auto-persist door for
   any SME RHP/PROSPECTUS (the doc types this task simulates) structurally
   cannot populate the offering headline fields, full stop.
2. **Fast-growing SME financials trip the YoY plausibility guard.** Both
   real SME issuers here show >5x YoY profit/EBITDA growth (genuine — small
   base effect), and `check_yoy_ratio_within_bounds` (0.2x–5.0x band) rejects
   PAT/EBITDA/net-worth as false positives on 2/3 filings. The Qualiance
   (NSE Emerge) proof did not hit this because that filer's growth was flatter.
3. **Autofurnish's financial tables extracted zero values** despite a fine
   text layer — a table-shape miss (largest file, 377pp, likely a column
   layout `extract_pnl_from_texts` doesn't match), independent of (1)/(2).

## Compare to NSE Emerge (Qualiance) proof

Qualiance (NSE Emerge, PRICE_BAND_AD path) got price band, face value, lot
size populated because it ran through `extract_price_band_ad`. No SME
document tested here is a `PRICE_BAND_AD` doc type, so none can reach that
code path — the gap is the doc-type routing, not a BSE-vs-NSE parsing
difference per se.
