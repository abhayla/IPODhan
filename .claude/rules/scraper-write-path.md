---
name: scraper-write-path
description: >
  Enforces the scraper's single write entry point (upsertIPO via the consolidation
  pipeline), mandatory field-priority-matrix registration for every scraped field,
  the BaseScraperOrchestrator contract, distributed locking, and feature-flag gating.
globs: ["scraper/src/**/*.ts", "scraper/scripts/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Scraper Write Path & Data Consolidation

## Single write entry point

ALL scraped IPO data MUST flow through `upsertIPO()` in
`scraper/src/services/data-persister.ts` (line ~199). It applies, in order:
IPO-level lock check (`scraper_locked`), field-level protection filtering, the
`DataValidationPipeline`, and consolidation via `data-consolidation-service.ts`.

- MUST NOT call `ipoRepository.update()` / raw Drizzle writes directly from a
  scraper, script, or service for scraped data — that bypasses protection,
  validation, and per-field source priority
- Backfill scripts MUST also write through `data-persister.ts` functions (e.g.
  `upsertIPO`, `createAnchorInvestors`) or domain repositories that wrap them
- When `FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION` is on, the consolidated result
  (not the raw scraper payload) is what gets persisted; consolidation failure
  falls back to a logged simple update — MUST NOT remove that fallback logging

## Field priority matrix — every field registers

`scraper/src/config/field-priority-matrix.ts` (`FIELD_PRIORITY_MATRIX`, 60+ fields)
decides per-field which source wins. Source priority: `ADMIN` (always wins) >
`DRHP` > `NSE` > `BSE` > `MONEYCONTROL` > `CHITTORGARH` > `INVESTORGAIN_GMP` >
`API_FALLBACK`.

Every NEW scraped field MUST get a matrix entry specifying:

| Field | Meaning |
|---|---|
| `sources` | Ordered `ScraperSource[]` — first wins (DRHP-first for financials, NSE-first for IPO core, BSE-first for lot size, CHITTORGARH-first for GMP) |
| `normalization` | `currency` \| `date` \| `company_name` \| `percentage` \| `number` \| `none` |
| `confidenceThreshold` | 70–95 (lower for GMP, higher for critical fields like issue_price) |
| `timeBased` | `true` = newest wins (GMP, subscriptions, status); `false` for stable data |
| `ignoreDRHP` | `true` for real-time fields (status, subscriptions, GMP) |
| `validation` | `{ min, max, regex, allowNull }` |
| `description` | human-readable doc |

A field scraped but absent from the matrix silently loses conflict resolution —
treat a missing entry as a bug, not a default.

## Orchestrator contract

Every scraper orchestrator MUST extend `BaseScraperOrchestrator` in
`scraper/src/base/BaseScraperOrchestrator.ts` and implement:
`getScraperName()`, `scrapeData()`, `validateIPO()` (+ optional
`validateSubscription()`). Prefer the `*-orchestrator-v2.ts` naming. The base
class `run()` template method is what enforces lock checks, protection
filtering, validation, and the consolidated upsert — MUST NOT override `run()`
to skip phases.

## Concurrency & rollout

- Writes that can race concurrent scraper runs MUST acquire the Redis
  distributed lock (`scraper/src/utils/distributed-lock.ts`, key `ipo:${slug}`,
  per-job TTL from `scraper/src/scheduler/config.ts` `LOCK_TTL`). If Redis is
  down: log a warning and continue — never hard-block on lock infrastructure
- New scraper features MUST gate behind `scraper/src/config/feature-flags.ts`:
  boolean `ENABLE_<FEATURE>` + optional `<FEATURE>_PERCENTAGE` (hash-based
  rollout via `shouldUseFeature()`). Never ship a new consolidation-path
  behavior unflagged

## CRITICAL RULES

- MUST route every scraped-data write through `upsertIPO()` / data-persister
  functions — never direct repository or Drizzle writes
- MUST register every new scraped field in `FIELD_PRIORITY_MATRIX` with all
  rule fields populated
- MUST extend `BaseScraperOrchestrator` for new sources; MUST NOT override
  `run()` to skip protection/validation/consolidation phases
- MUST acquire the distributed lock for racy writes and gate new behaviors
  behind feature flags
