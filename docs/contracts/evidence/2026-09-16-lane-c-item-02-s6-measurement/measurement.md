# Lane C item 2 slice 6 — measurement (#515: price_range holds face value)

Read-only measurement, 2026-09-16. No code/DB writes.

## Class query

```sql
select id, slug, company_name, status, segment, offering_type, face_value,
       price_range_min, price_range_max, issue_size, lot_size, isin, bse_ipo_no,
       listing_exchanges
from ipos
where offering_type = 'IPO'
  and (
    (price_range_min = face_value and price_range_max = face_value)
    or (price_range_min = face_value and price_range_max is null)
  )
  and face_value is not null
order by company_name;
```

Positive control: NIRBHAY COLOURS INDIA LTD present on prod — CONFIRMED.

## Class rows (identical on prod and ipodhan_staging — same 5 rows, same values)

| slug | company_name | status | segment | face_value | price_range_min | price_range_max | issue_size | lot_size | isin | bse_ipo_no |
|---|---|---|---|---|---|---|---|---|---|---|
| banganga-paper-industries-ltd | BANGANGA PAPER INDUSTRIES LTD | CLOSED | MAINBOARD | 1 | 1 | 1 | 133025551.00 | 100 | null | null |
| maruti-interior-products-ltd | MARUTI INTERIOR PRODUCTS LTD | LISTED | SME | 10 | 10 | 10 | 453000000.00 | 1000 | null | null |
| muthoot-fincotp-ltd | MUTHOOT FINCOTP LIMITED | CLOSED | MAINBOARD | 1000 | 1000 | 1000 | 2000000000.00 | 100 | null | null |
| nirbhay-colours-india-ltd | NIRBHAY COLOURS INDIA LTD | CLOSED | MAINBOARD | 10 | 10 | 10 | 14797000.00 | 100 | null | null |
| stanbik-agro-ltd | STANBIK AGRO LIMITED | CLOSED | SME | 1000 | 1000 | 1000 | 750000000.00 | 100 | null | null |

Class count: 5 rows on prod, 5 rows on staging (identical set).

## field_sources (camelCase field_name; positive control 'issueSize' hit for 2/5 rows)

| ipo | priceRangeMin | priceRangeMax | faceValue | issueSize (control) |
|---|---|---|---|---|
| banganga-paper-industries-ltd | BSE, conf 100, 2026-06-16T12:52:41.601Z | BSE, conf 100, 2026-06-16T12:52:41.643Z | BSE, conf 100, 2026-06-16T12:52:41.745Z | BSE, conf 100, 2026-06-16T12:52:41.589Z |
| maruti-interior-products-ltd | none | none | none | none |
| muthoot-fincotp-ltd | none | none | none | none |
| nirbhay-colours-india-ltd | BSE, conf 100, 2026-06-16T12:52:59.652Z | BSE, conf 100, 2026-06-16T12:52:59.665Z | BSE, conf 100, 2026-06-16T12:52:59.678Z | BSE, conf 100, 2026-06-16T12:52:59.637Z |
| stanbik-agro-ltd | none | none | none | none |

Same on both slots. For the 2 rows with provenance, BSE wrote priceRangeMin = priceRangeMax = faceValue together in the same write burst (all three fields written within ~100ms of each other) — consistent with BSE's own feed carrying face value into the price-band fields, not a downstream bug. The other 3 rows have no field_sources rows at all (pre-dates field_sources tracking or written by a path that doesn't record provenance).

## Source availability (read-only, no DB write)

Chittorgarh report-82 (`https://webnodejs.chittorgarh.com/cloud/report/data-read/82/<page>/10/2026/2026-27/0/<mainboard|sme>/0?search=&v=15-11`) fetched in full for both `mainboard` (1640 rows) and `sme` (2980 rows) categories. None of the 5 companies appear in either dataset by name match (BANGANGA, MARUTI INTERIOR, MUTHOOT FINCOTP, NIRBHAY, STANBIK all 0 hits). Chittorgarh does not carry these issues at all — no reachable source.

BSE IPO board: all 5 rows have `bse_ipo_no = null` — per the task's scope ("only for rows with a bse_ipo_no"), the BSE board check does not apply to any of the 5 rows.

## Verdict table

| slot | company | stored band | face_value | source found | provenance state | verdict |
|---|---|---|---|---|---|---|
| prod+staging | BANGANGA PAPER INDUSTRIES LTD | 1-1 | 1 | none (Chittorgarh: 0 hits; BSE: no bse_ipo_no) | field_sources: BSE wrote all 3 fields together, conf 100 | UNSOURCEABLE |
| prod+staging | MARUTI INTERIOR PRODUCTS LTD | 10-10 | 10 | none (Chittorgarh: 0 hits; BSE: no bse_ipo_no) | no field_sources rows | UNSOURCEABLE |
| prod+staging | MUTHOOT FINCOTP LIMITED | 1000-1000 | 1000 | none (Chittorgarh: 0 hits; BSE: no bse_ipo_no) | no field_sources rows | UNSOURCEABLE |
| prod+staging | NIRBHAY COLOURS INDIA LTD | 10-10 | 10 | none (Chittorgarh: 0 hits; BSE: no bse_ipo_no) | field_sources: BSE wrote all 3 fields together, conf 100 | UNSOURCEABLE |
| prod+staging | STANBIK AGRO LIMITED | 1000-1000 | 1000 | none (Chittorgarh: 0 hits; BSE: no bse_ipo_no) | no field_sources rows | UNSOURCEABLE |

No row shows a face value of Rs 1000 paired with debenture/NCD markers in the queried columns (offering_type is already filtered to 'IPO'); nothing in this class reads as NCD-MISLABELLED from the fields available. All 5 are small/obscure issues (BSE-only listing_exchanges, no ISIN, no bse_ipo_no) that neither Chittorgarh nor a BSE-board lookup can source — a repair here would require a different source (e.g. BSE's own detail/announcement page by scrip, or the DRHP/prospectus) not probed in this budget.
