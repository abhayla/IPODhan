# Item 16 — Retire Moneycontrol (OD-3)

## Purpose

Moneycontrol stops being fetched by any scheduled or default-path run. It keeps its rank-0
place in history: the `MONEYCONTROL` enum value and the ~180 `field_sources` rows it already wrote
are untouched.

## Serves

`docs/design/data-sourcing-pull-model.md` §1.11.1 (owner decision, 2026-09-09: "Moneycontrol is
retired as a source. It holds no rank in this design.") and §7.1 item 16. Serves no open finding —
§1.11.1 states the fields Moneycontrol used to supply are already covered top-three by
document+NSE+BSE or document+Chittorgarh, so this item is pure removal, not a fix for a broken thing.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/src/index.ts` | exists | Line 389: delete the `aggregator:MONEYCONTROL` step — `const mcOk = await runCycleStep('aggregator:MONEYCONTROL', () => runMoneycontrolScraper({ allowedStatuses: ['UPCOMING', 'OPEN'] }));` — from the due-step cycle's 24h aggregator-refresh branch (the branch itself, guarded by `AGGREGATOR_INTERVAL_MINUTES` at line 186, still runs for Chittorgarh; only the Moneycontrol call inside it goes). This is the call site that actually fires in production, because prod runs the due-step scheduler. |
| `scraper/src/index.ts` | exists | Lines 702–725: the legacy `--source=all` fallback block `if (source === 'moneycontrol' \|\| runsLegacyAllPath) { ... }` (guarded by `runsLegacyAllPath = source === 'all' && !FEATURE_FLAGS.ENABLE_DUE_STEP_SCHEDULER`, line 628) — remove the `moneycontrolResult` call and its four `combinedResult` accumulations. This path only fires when `ENABLE_DUE_STEP_SCHEDULER` is false, which is not how prod runs today, but it is still reachable from a local `--source=all` run and must stop reaching Moneycontrol too. |
| `scraper/src/index.ts` | exists | Line 15: delete `import { runMoneycontrolScraper } from './scrapers/moneycontrol-orchestrator-v2.js';` once both call sites above are gone. |
| `scraper/src/index.ts` | exists | Lines 535–536: `--source=moneycontrol` stops being a valid CLI value — remove `'moneycontrol'` from the allow-list `['nse', 'bse', 'moneycontrol', 'chittorgarh', 'gmp', 'fallback', 'api', 'all']` and from the error message that lists them. |
| `scraper/src/index.ts` | exists | Line 461: the `--source=all` help comment `(NSE + BSE + Moneycontrol + Chittorgarh + API fallback + GMP sequentially)` — drop `Moneycontrol +` so the comment matches the code once the block above is gone. |
| `scraper/package.json` | exists | Line 8: delete the `"start:moneycontrol": "tsx --tsconfig tsx.tsconfig.json src/index.ts --source=moneycontrol"` script — it becomes a dead entry point once `--source=moneycontrol` is invalid. |
| `scraper/src/scrapers/moneycontrol-orchestrator-v2.ts` | exists | No change. The file is not deleted — see Rollback. Its `FEATURE_FLAGS.ENABLE_MONEYCONTROL_SUBSCRIPTION` read at line 101 becomes unreachable code once nothing calls `runMoneycontrolScraper`, which is acceptable for a retired-not-deleted source. |
| `scraper/src/scrapers/moneycontrol-scraper.ts` | exists | No change — same reasoning. |
| `scraper/src/scrapers/moneycontrol-rss.ts` | exists | No change. This reads the IPO **news** feed, not IPO data (§1.11.1 point 4: "Kept, and separate"). Out of scope for this item entirely. |
| `scraper/src/config/feature-flags.ts` | exists | Line 75: `ENABLE_MONEYCONTROL_SUBSCRIPTION` flag definition — kept as-is. See Feature flag section below. |
| `scraper/src/config/field-priority-matrix.ts` | exists | **No change in this item.** The matrix still lists `MONEYCONTROL` as a source across dozens of financial-field entries (e.g. lines 133–225). Removing it from the matrix is build item 3 ("Matrix cleanup... adopt the manifest"), which replaces the matrix wholesale — touching it here would be scope creep into a different, dependency-ordered item. |
| `packages/shared/src/db/schema.ts` | exists | **No change.** `scraperSourceEnum` (line 121) keeps `'MONEYCONTROL'` (line 126) — see Schema section. |

## Schema

No schema change. `scraperSourceEnum` at `packages/shared/src/db/schema.ts:121-128` keeps the
`'MONEYCONTROL'` value:

```ts
export const scraperSourceEnum = pgEnum('scraper_source', [
  'ADMIN',
  'DRHP',
  'NSE',
  'BSE',
  'API_FALLBACK',
  'MONEYCONTROL',
  'CHITTORGARH',
]);
```

Removing an enum value that ~180 `field_sources.source` rows and `field_sources.previous_source`
rows still reference would either fail the migration (FK-style dependency inside the enum) or
require rewriting those rows — exactly the provenance-falsification §1.11.1 rules out. No
`ALTER TYPE ... DROP VALUE` is written. No row in `field_sources` is edited, deleted, or
re-attributed.

## Interfaces

No new interface. `runMoneycontrolScraper` (exported from `moneycontrol-orchestrator-v2.ts`)
keeps its existing signature — it is simply no longer called from `index.ts`. No function is
renamed or removed.

## Feature flag

No new flag. `ENABLE_MONEYCONTROL_SUBSCRIPTION` (`scraper/src/config/feature-flags.ts:75`,
read at `moneycontrol-orchestrator-v2.ts:101`) is left exactly as it is — it already defaults to
`false` in every slot (`process.env.ENABLE_MONEYCONTROL_SUBSCRIPTION === 'true'`, no default
override), and once nothing calls `runMoneycontrolScraper` the flag is dead code rather than a
behavior change. Turning it into a no-op explicitly is not required by the design and is not done
here (YAGNI — no caller needs it touched).

This change itself sits behind no flag: the call sites are deleted outright, not branched. The
design does not say the retirement should be flag-gated, and a flag here would only delay the
saving §1.11.1 names ("one fewer source fetched every aggregator run") behind a toggle nobody asked
for. **Fork, not invented:** if the owner wants a killswitch to re-enable Moneycontrol without a
revert, that is a new decision this card does not make.

## Tests

Red before the change, green after:

- `scraper/tests/unit/index-due-step-scheduler-wiring.test.ts` (exists) — add/extend a case
  asserting the due-step cycle's aggregator-refresh branch calls `runCycleStep` for
  `'aggregator:CHITTORGARH'` (or its actual step name — confirm at the call site) but never for
  `'aggregator:MONEYCONTROL'`. Mock `runMoneycontrolScraper` and assert it is never invoked from a
  simulated due-step cycle run.
- A new unit test asserting `--source=moneycontrol` is rejected by the CLI: exercise the same
  validation branch at `scraper/src/index.ts:535-536` and assert the error path fires for
  `'moneycontrol'` the way it already fires for an unrecognized string.
- `scraper/tests/unit/scrapers/moneycontrol-scraper.test.ts` and
  `moneycontrol-orchestrator-v2` unit tests (if any exist beyond the scraper test) are **not**
  deleted or modified — the module under test still exists and its own behavior is unchanged; only
  its caller is removed.
- Tier: unit, per `.claude/rules/scraper-test-layout.md` (`scraper/tests/unit/`, no DB/Redis
  involved in the wiring assertion).

## Detection

`No detection change: this removes a scheduled fetch, it does not change what any write path
accepts or rejects, so no audit check gains or loses a class to catch.` The existing detection
suite already has no Moneycontrol-specific check to retire (grep of
`docs/reviews/detection-checks/*.json` for `moneycontrol` this session returned nothing), so
nothing needs updating there either.

## Staging proof

Deploy to staging, then over one full 24-hour aggregator cadence (`AGGREGATOR_INTERVAL_MINUTES =
24 * 60`, `scraper/src/index.ts:186`) confirm the scraper log carries **zero** occurrences of
`aggregator:MONEYCONTROL` or `Running Moneycontrol scraper`, where before the change one
`aggregator:MONEYCONTROL` line appeared once per 24h cycle. Grep the staging scraper log for
`grep -c "MONEYCONTROL" <staging-scraper-log>` before and after — the healthy value after is `0`
for any line that is a scheduled *call*, not a `field_sources.source` read (which will still show
historical `MONEYCONTROL` rows and is expected to).

## Rollback

Revert the commit. Nothing stored is rewritten — the enum value, the `field_sources` rows, and the
Moneycontrol scraper/orchestrator files are all left in place, so reverting restores the exact
prior call sites with no data migration in either direction. This is a "reversible" item per §7.2
of the design (listed among items 1, 2, 3, 9, 10, 15, 16, 18).

## Tier, budget and cost

**Tier C** — docs/config-shaped removal of scheduled calls, no schema change, no new write path,
per `.claude/rules/defect-fix-contract.md`'s tier rubric and the design's own item table (§7.1: "16
| Retire Moneycontrol (OD-3) ... | C | small"). CI + self-check is the gate; no mutation-tested
review round required.

`Budget: 20 min wall-clock, 40 tool calls.`

Cost: small, independent of every other item — §7.1 lists item 16 among the four items ("4, 8, 16
and 18") that can start immediately in parallel with item 1. One review round expected (Tier C: no
review, CI-gated merge on green per `engineering-roles.md`'s review-tier table).

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

1 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §1.11.1 | R-157 |

## Known gaps

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
