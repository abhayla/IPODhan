---
name: ipo-duplicate-detection
description: >
  Enforces running confidence-tiered duplicate detection (symbol/ISIN/name/date)
  before creating a NEW IPO record, so scraper runs don't insert duplicates or
  re-list already-listed companies. Runs inside the data-validation pipeline.
paths: ["scraper/src/services/duplicate-detection-service.ts", "scraper/src/pipelines/**/*.ts", "scraper/src/scrapers/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# IPO Duplicate Detection

Multiple sources describe the same IPO under slightly different names. Before a
scraper **creates** a new `ipos` row it MUST check for an existing match via
`DuplicateDetectionService` (`scraper/src/services/duplicate-detection-service.ts`)
— this is how the system avoids duplicate records and detects companies that are
already listed.

## Confidence tiers (most → least reliable)

`checkForDuplicates()` runs these checks and returns the first match with its
confidence:

| Check | Confidence | Meaning |
|-------|-----------|---------|
| NSE/BSE `symbol` exact | `HIGH` | company likely already listed |
| `isin` exact | `HIGH` | duplicate IPO record |
| company name fuzzy match | `MEDIUM` | probable duplicate — review |
| open/close date overlap | `LOW` | weak signal — corroborate before acting |

- A `HIGH` match MUST block the create and route to update/merge of the existing
  record — MUST NOT insert a second row
- `MEDIUM`/`LOW` matches surface for reconciliation; do not silently drop them

## Run it through the pipeline, not ad hoc

Duplicate detection is wired into `DataValidationPipeline`
(`scraper/src/pipelines/data-validation-pipeline.ts`) and is **on by default**
(`skipDuplicateDetection: false`).

- New scraper writes MUST flow through the validation pipeline (and therefore
  `data-persister.ts` / `upsertIPO` — see `scraper-write-path.md`); that is what
  invokes detection. MUST NOT call `db.insert(ipos)` directly from a scraper
- `skipDuplicateDetection: true` is reserved for paths where identity is already
  known (migrations, in-DB reprocessing) — MUST NOT flip it on a live scrape path
  to "speed things up"
