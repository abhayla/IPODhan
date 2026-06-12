---
name: add-scraper-source
description: >
  Add a new data source to the IPODhan scraper end-to-end: orchestrator extending
  BaseScraperOrchestrator, field-priority-matrix registration, feature flag, CLI +
  npm script wiring, scheduler job with lock TTL, and the unit/integration tests.
  Use when integrating a new exchange, aggregator, or data provider.
type: workflow
allowed-tools: "Bash Read Write Edit Grep Glob"
argument-hint: "<source-name>"
version: "1.0.0"
synthesized: true
private: false
---

# Add a Scraper Source

Adding a source touches 7 surfaces. Missing any one produces a scraper that runs
manually but never on schedule, or scrapes fields that silently lose every
conflict-resolution decision.

## STEP 1: Create the orchestrator

Create `scraper/src/scrapers/<source>-scraper-orchestrator-v2.ts` extending
`BaseScraperOrchestrator<TIPO, TSubscription>` (`scraper/src/base/BaseScraperOrchestrator.ts`):

1. `getScraperName()` — return the new `ScraperSource` enum value (add it to the
   source type first if new)
2. `scrapeData()` — return `{ ipos, subscriptions }`; use
   `scraper/src/utils/scraper-utils.ts` helpers (`detectRenderingType`,
   `scrapeWithCheerio` for static, Puppeteer via `src/utils/browser.ts` for dynamic)
3. `validateIPO(ipo)` — Zod schema + business validation returning
   `{ success, data?, error? }` (validators live in `scraper/src/utils/validators.ts`)
4. `validateSubscription(sub)` — only if the source provides subscription data
   (see `chittorgarh-orchestrator-v2.ts` for the no-subscriptions variant)
5. Export `export function run<Source>Scraper(): Promise<ScraperResult>` at module end

Use `nse-scraper-orchestrator-v2.ts` as the canonical template. Do NOT override
`run()` — the base template method enforces lock checks, field protection,
validation pipeline, and the consolidated upsert.

## STEP 2: Register fields in the priority matrix

For every field this source provides, ensure an entry exists in
`FIELD_PRIORITY_MATRIX` (`scraper/src/config/field-priority-matrix.ts`) and add the
new source into each relevant field's `sources` array AT THE CORRECT PRIORITY
position (ADMIN > DRHP > NSE > BSE > MONEYCONTROL > CHITTORGARH >
INVESTORGAIN_GMP > API_FALLBACK). New fields need the full rule object —
`sources`, `normalization`, `confidenceThreshold`, `timeBased`, `ignoreDRHP`,
`validation`, `description` (see `scraper-write-path.md` rule).

## STEP 3: Feature flag (if experimental)

Add `ENABLE_<SOURCE>` (and optionally `<SOURCE>_PERCENTAGE`) to
`scraper/src/config/feature-flags.ts`, wire it into the orchestrator entry, and
extend `validateFeatureFlags()` bounds checks if a percentage flag was added.

## STEP 4: CLI + npm script

1. Register `run<Source>Scraper()` in `scraper/src/index.ts` (import + source case)
2. Add `"start:<source>": ...` to `scraper/package.json` scripts, mirroring
   `start:nse` / `start:bse`

## STEP 5: Scheduler registration

In `scraper/src/scheduler/config.ts`:

1. Add a job entry to `PROD_SCHEDULES` (timezone is always `Asia/Kolkata`;
   choose market/after-hours/weekend cadence to match the data's freshness)
2. Add a slower/disabled `DEV_SCHEDULES` override
3. Add a `LOCK_TTL` entry — 5 min for standard scrapers; longer only for
   long-running work (e.g. 1h for DRHP PDF processing)

## STEP 6: Tests

1. Unit: `scraper/tests/unit/scrapers/<source>-scraper.test.ts` — parsing and
   validation with fixture HTML/JSON, no network
2. Integration: `scraper/tests/integration/<source>-scraper.integration.test.ts`
   — real persistence path through `upsertIPO()` (60s budget)
3. Follow the tier rules in `scraper-test-layout.md` — no DB writes in e2e

## STEP 7: Verify end-to-end

```bash
cd scraper
npx vitest run tests/unit/scrapers/<source>-scraper.test.ts
npx vitest run -c vitest.integration.config.ts tests/integration/<source>-scraper.integration.test.ts
npm run start:<source>   # one manual run; inspect pino logs for upsert outcomes
```

Confirm in logs: lock acquired, validation passed, consolidation applied (or
flagged off), upsert counts sane. Check `data_conflicts` review queue if
conflict detection is enabled.

## CRITICAL RULES

- MUST extend `BaseScraperOrchestrator` and keep `run()` untouched
- MUST position the source correctly in every touched field's `sources` array —
  wrong position silently corrupts conflict resolution
- MUST register scheduler job + LOCK_TTL, or the source never runs in production
- MUST write through `upsertIPO()` only — no direct DB writes anywhere in the source
- MUST add both unit and integration tests in their correct tiers
