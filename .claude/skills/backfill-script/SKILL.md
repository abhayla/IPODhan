---
name: backfill-script
description: >
  Create a data backfill script for the IPODhan scraper following the project's
  observed script conventions — tsx CLI in scraper/scripts/, idempotent candidate
  selection, per-item error handling, pino + summary logging, writes only through
  data-persister/repositories — with dry-run-by-default as the going-forward standard.
type: workflow
allowed-tools: "Bash Read Write Edit Grep Glob"
argument-hint: "<field-or-domain> [--target-table <table>]"
version: "1.0.0"
synthesized: true
private: false
---

# Create a Backfill Script

Backfill scripts populate missing historical data (lot sizes, anchor investors,
financials, objectives, peer companies, reviews, price bands). Seven existing
scripts in `scraper/scripts/backfill-*.ts` define the convention; the newest
(`backfill-lot-size-from-chittorgarh.ts`) adds the dry-run safety layer that new
scripts MUST adopt.

## STEP 1: Scaffold the script

Create `scraper/scripts/backfill-<name>.ts`:

1. Header comment block with Usage examples (every existing script has one)
2. `dotenv.config()` FIRST, before any `@ipodhan/shared` import that opens
   connections
3. Imports: `db, getRedisClient` from `@ipodhan/shared`, `logger` from
   `../src/utils/logger.js`, the relevant repository, and write functions from
   `../src/services/data-persister.js`
4. Define `interface BackfillCandidate` and `interface BackfillResult`

## STEP 2: CLI argument parsing

Implement `parseArgs()` reading `process.argv.slice(2)`:

- `--execute` — required for real writes; **default is dry-run**
  (`const dryRun = !args.includes('--execute')`)
- `--limit N` — process only the first N candidates (always test with
  `--limit 5` first)
- Domain filters as needed: `--status=OPEN`, `--ipo-id=<uuid>`, `--force`
  (reprocess existing data)

Print a mode banner via console (allowed for CLI UX — see
`structured-logging.md`): `Mode: DRY-RUN (no database updates)` vs `EXECUTE`.

## STEP 3: Idempotent candidate selection

Query ONLY rows that actually need the backfill, so re-runs are safe:

```typescript
// e.g. only IPOs missing the target field
where(and(isNull(ipos.lotSize), /* domain filters */))
```

`--force` is the explicit escape hatch for reprocessing; never reprocess by default.

## STEP 4: Processing loop

For each candidate: validate → fetch from source → write. Rules:

- Per-item try/catch — one bad IPO MUST NOT abort the run; record the error in
  the results array and continue
- Writes go through `data-persister.ts` functions or domain repositories —
  NEVER raw Drizzle updates (see `scraper-write-path.md`)
- Honor `dryRun`: compute and log what WOULD change; skip the write
- Track `{ success, errors, skipped }` counts per item in `BackfillResult[]`

## STEP 5: Summary + results log

1. Log per-item outcomes through pino (structured: `{ ipoId, field, outcome }`)
2. Print a final console summary table (processed / updated / skipped / errors)
3. Write the run record to `backfill-<name>.log` (the established convention —
   JSON or CSV of the results array)

## STEP 6: npm script + first run

1. Add `"backfill-<name>": "tsx scripts/backfill-<name>.ts"` to
   `scraper/package.json`
2. First run: `npm run backfill-<name> -- --limit 5` (dry-run) → inspect output
   → `--limit 5 --execute` → verify rows in DB → full `--execute`

## CRITICAL RULES

- MUST default to dry-run; writes require explicit `--execute`
- MUST select candidates idempotently (missing-data predicate); `--force` is
  the only reprocess path
- MUST write through data-persister/repository functions — never raw DB updates
- MUST handle errors per-item and finish the run with a summary + results log file
- MUST test with `--limit 5` before a full execute run
