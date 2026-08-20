# T-228 — Scraper cycle ends `iposFailed=5 errorCount=7` (exit 1)

Diagnosis recorded 2026-08-20 against the live VPS + live upstreams. Four
independent root causes hide behind one summary line.

## Before (verbatim, VPS `--source=all`, 2026-08-20T14:48:20Z)

```
Scraper execution completed
    source: "all"
    success: false
    iposProcessed: 204
    iposFailed: 5
    errorCount: 7
errors: [
  "Validation failed for Rays of Belief Ltd.",
  "Validation failed for Kwick Forensic Solutions Ltd.",
  "Validation failed for Cube Highways Trust (Cube Highways Trust InvIT)",
  "Validation failed for Bagmane Prime Office REIT (Bagmane REIT)",
  "Validation failed for Citius Transnet Investment Trust (Citius Transnet InvIT IPO)",
  "Investorgain API error (ipo): /cloud/report/data-read/331/1/10/2026/2026-27/0/ipo API NOT FOUND",
  "Investorgain API error (sme): /cloud/report/data-read/331/1/10/2026/2026-27/0/sme API NOT FOUND"
]
EXITCODE=1
```

## RC1 — Investorgain: API versioned to /v2/, not dead

Probed read-only. The v1 path 404s for EVERY financial year, including the
previously-working `2025/2025-26` — so this is NOT the FY rollover the path
shape suggests:

| URL | Result |
|---|---|
| `/cloud/report/data-read/331/1/10/2026/2026-27/0/ipo` | `{"msg":"API not found"}` |
| `/cloud/report/data-read/331/1/10/2025/2025-26/0/ipo` | `{"msg":"API not found"}` |
| `/cloud/v2/report/data-read/331/1/8/2026/2026-27/0/ipo?search=&v=20-16` | `msg:1`, 16 rows |
| `/cloud/v2/report/data-read/331/1/8/2026/2026-27/0/sme?search=&v=20-16` | `msg:1`, rows |

Investorgain migrated to Next.js; the report page moved
`/report/live-ipo-gmp/331/ipo/` -> `/report/ipo-gmp-live/331/`, and the data
call is built in a client chunk as:

```
cloud/v2/report/data-read/{reportId}/{page}/{month}/{year}/{financialYear}/{sort|0}/{parameter_id|0}?search=&v={version}
```

Differences from the v1 caller:
1. Base path gains `/v2`.
2. **Positional slot 3 changed meaning: `perPage` -> `month`.**
3. Category (`ipo`/`sme`) moved into the `parameter_id` slot.
4. Record field `Price` renamed to `Price (₹)`. All other keys
   (`~id`, `~ipo_name`, `GMP`, `~gmp_percent_calc`, `Updated-On`, `~Srt_Open`,
   `~Srt_Close`, `~Str_Listing`, `~urlrewrite_folder_name`, `~IPO_Category`)
   are unchanged.

**Why it was invisible as an HTTP failure:** the 404 body is returned with
**HTTP 200**, so `response.ok` is true and the existing `if (!response.ok)`
guard never fires. Only the `msg` field distinguishes success (`1`) from
failure (`"API not found"`).

## RC2 — REIT/InvIT misclassification: enum vocabulary mismatch

`detectOfferingType()` (scraper/src/utils/data-validation.ts) returns the
display strings `'REIT'` and `'InvIT'`. The DB enum `offering_type`
(packages/shared/src/db/schema.ts) defines `'REITS'` and `'INVITS'`.

Consequences per cycle:
1. `detectedType ('REIT') !== data.offeringType ('IPO')` -> OFFERING_TYPE_MISMATCH
   warning fires forever; it can never converge.
2. The HIGH-confidence auto-fix assigns `autoFixes.offeringType = 'REIT'`, an
   invalid enum value, which `Object.assign(data, autoFixesApplied)` writes onto
   the record. The write is rejected/discarded and the row stays `IPO`.

`nse-api-client.ts` already emits the correct `'INVITS'`/`'REITS'`; the
validator is the sole outlier.

**This is a live user-facing correctness bug, not cosmetic:**

```
Cube Highways Trust  | offering_type = IPO    | status = LISTED   <- an InvIT shown as an IPO
CITIUS TRANNET ...   | offering_type = INVITS | status = CLOSED   <- correct (written by NSE)
```

## RC3 — Dhanwel upsert: permanent 23505 misclassified as transient

Two rows exist; a source typo created a duplicate:

```
Dhanwel Hybird Seeds Limited | slug dhanwel-hybird-seeds-ltd | symbol DHANWEL | last_scraped 2026-06-23
Dhanwel Hybrid Seeds Ltd.    | slug dhanwel-hybrid-seeds-ltd | symbol NULL    | last_scraped 2026-08-20
```

The live row is matched by slug (no slug collision), then tries to write
`symbol='DHANWEL'`, which the stale typo'd row already holds. Reproduced inside
a rolled-back transaction:

```
code       = 23505
constraint = ipos_symbol_key
detail     = Key (symbol)=(DHANWEL) already exists.
```

`shouldSkipRetry()` DOES list `UNIQUE_VIOLATION`, but it reads `error?.code` —
and `IPORepository.update()` wraps the pg error as
`new DatabaseError(msg, undefined, error)`, which exposes no `code` (the pg
error is nested under `.cause`). The permanent violation is therefore
misclassified as transient and retried 3x every cycle before failing.

## RC4 — "Price range min must be positive" on unannounced price bands

`ScrapedIPOSchema.priceRangeMin` is `.positive().optional()`. Genuinely-new
IPOs have no announced price band yet; the Chittorgarh detail (Phase 2) fetch
supplies an explicit `0` rather than omitting the field, and `.positive()`
rejects the whole record. `0` here means "not announced yet", which is exactly
what `optional`/absent already models.

Affected this cycle: `Rays of Belief Ltd.`, `Kwick Forensic Solutions Ltd.`
(neither is a REIT/InvIT — a distinct cause that merely shares the
"Validation failed for ..." wording).
