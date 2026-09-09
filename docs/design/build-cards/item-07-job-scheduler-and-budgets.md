# Item 7 — The job scheduler and the budgets

## Purpose

After this ships, the scraper runs as three named jobs on the owner's cadence (data 00:00/08:00/14:00
IST, live-figures every 30 min 10:00–18:30 IST gated on at least one OPEN IPO, closed-IPO 22:00 IST),
no job ever force-kills a cycle in progress, and the extraction/wake/lock budgets are raised to numbers
that are *derived* from a new invariant (never start an extraction unless the remaining wake budget can
absorb its full timeout) rather than typed and hoped to fit.

## Serves

OD-19 (§2.1, the owner's cadence), the "no job ever kills a running cycle" rule (§2.1), the
force-kill/budget derivation in §2.1 ("Why these numbers, and what they cost" / "The force-kill goes,
and the budgets that depend on it"), and O-4's demand-ordered tiering (§5.4) whose *scheduling* half
(the 22:00 window that gives the backlog somewhere to run without starving a live IPO) is this item;
§7.1 row 7 names this item explicitly ("The job scheduler and the budgets"). Does **not** serve the
closed-IPO job's own selection query, cap, or done-marker (§6) — that is item 17, which depends on this
item's scheduler existing. Does not serve O-4's *demand-ordering algorithm* itself (which fields get
walked first within a cycle) — that is item 6 (the pull walk); this item only removes the scheduling
constraint (force-kill) that made a longer backlog pass unsafe.

**Open contradiction surfaced, not resolved here:** §2.1's job table puts GMP (grey-market premium)
inside the live-figures job, gated to 10:00–18:30 IST and to days with an OPEN IPO — the same
market-hours gate that finding **F-41** (owner-approved 2026-09-08, §2.1.1) explicitly *removed* GMP
from, because GMP is most active exactly when this gate is closed (evenings, weekends). OD-19 is dated
2026-09-09, one day later, and its own words ("Live figures only during bidding") read as re-imposing
the gate on GMP along with subscription and demand graph. **The design does not say which one governs
GMP's schedule** — it does not mention F-41 anywhere near §2.1's job table, and does not say OD-19
supersedes it. This card is written on the **more recent, more specific, directly-dated instruction**
(OD-19's job table: GMP inside the gated live-figures job) because that is the literal text under
"What runs, and when", but this is a real fork the owner should confirm in one line before item 7 ships
— reverting F-41's evening/weekend GMP coverage is a user-visible regression (§2.1.1 measured "about 65
hours stale" over a weekend under the old gate) if it was not intended.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/src/services/filing-auto-persist.ts` | exists | `EXTRACT_TIMEOUT_MS` (line 166, `10 * 60 * 1000`) → `30 * 60 * 1000`. `FILING_EXTRACTION_LOCK_TTL_MS` (line 530, `45 * 60 * 1000`) → derived value below (rounds to `60 * 60 * 1000`). `maxAnchorSpawnsWithinLockTtl` (line 540-547) re-derived — see Interfaces. The per-document deadline check inside `processPendingFilings` (lines 1571, 1639, and the anchor pass at 1565-1576) changes from `now() >= deps.deadlineMs` to the new never-start-without-full-budget invariant — see Interfaces. |
| `scraper/src/services/document-cycle.ts` | exists | `DEFAULT_WAKE_BUDGET_MS` (line 158, `20 * 60 * 1000`) → `50 * 60 * 1000`. `getWakeBudgetMs()` (line 182) unchanged in shape — only its default and its `DOCUMENT_CYCLE_WAKE_BUDGET_MS` env override ceiling need re-documenting. `extractionBudgetMs` computation (line 1232-1234, `Math.min(DEFAULT_EXTRACTION_BUDGET_MS, wakeBudgetMs - (now() - startedAt) - PURGE_RESERVE_MS)`) and `deadlineMs = extractionStartedAt + extractionBudgetMs` (line 1263) feed the new invariant — no change to this file's arithmetic itself, but `DEFAULT_EXTRACTION_BUDGET_MS` (cited, not yet read this session — **the design does not say this constant's value; read it before implementing, do not assume it scales automatically with the wake budget**). |
| `scraper/src/index.ts` | exists | `CYCLE_LOCK_TTL_MS` (line 179, `getWakeBudgetMs() + 5 * 60 * 1000`) is *unchanged code* — it derives to 55 min automatically once `getWakeBudgetMs()` returns 50 min. The market-hours gate at line 343 (`isMarketHoursIST(now)`) and the aggregator-cadence block (lines 371-395) are subsumed by the new live-figures job (§2.1) — this item replaces the single `main()` due-step cycle's internal slot logic with dispatch on an explicit `--job=data\|live\|closed` argument (see Interfaces; **the design does not name this flag or any replacement CLI shape** — recommended here as the smallest change that reuses the existing one-shot-process-per-invocation model in lines 463-560, rather than inventing a long-running daemon). |
| `scraper/src/scheduler/due-step-cycle.ts` | exists | `DISCOVERY_SLOTS_IST_MINUTES` (line 15, `[08:30, 11:00, 14:00, 17:30]`) is D-13's cadence, explicitly superseded by OD-19 (§2.1: "This supersedes D-13's timing for everything below"). Becomes the **data job's** three slots `[00:00, 08:00, 14:00]` (minutes `[0, 480, 840]`). The live-figures window (currently `isMarketHoursIST`, weekday 10:00-17:00) extends to 10:00-18:30 and drops the OPEN-IPO gate from "zero network calls if zero OPEN" (already present, lines 353-359) — that check is *kept*, not removed; only the window widens. |
| `scripts/deploy-linux.sh` | exists | Lines 231-239 (`SCRAPER_CRON` computed per `$SLOT`) and line 681-683 / 1376 (`pm2 start ... --no-autorestart --cron-restart="${SCRAPER_CRON:-*/30 * * * *}"`) — the whole `--cron-restart` mechanism is removed (see PM2 change below). |
| `scripts/scraper-wake.sh` (NEW) | **NEW** | The lock-skip wrapper the owner's "never kill" rule requires — see PM2 ecosystem change below. |
| `scripts/scraper-wake.sh` | **NEW** | The lock-skip wrapper the owner's "never kill" rule requires — see PM2 ecosystem change below. |
| `scraper/tests/unit/services/filing-auto-persist.test.ts` | exists | Line 1412's existing static test (`'DEFAULT_MAX_SPAWNS_PER_CYCLE * EXTRACT_TIMEOUT_MS + anchor sidecar + 60s < FILING_EXTRACTION_LOCK_TTL_MS'`) currently asserts the OLD, now-broken derivation (`3 × 30 min = 90 min`, which is **not** `< 60 min`) and must be rewritten against the new expression — see Tests. |
| `scraper/tests/unit/services/document-cycle-wake-budget.test.ts` | exists | New assertions for `DEFAULT_WAKE_BUDGET_MS = 50 * 60 * 1000` and the env-override ceiling. |
| `docs/ops/prod-ops-recipes.md` | exists | New "reading the three jobs" recipe entry (per `defect-fix-contract.md`'s "record ops recipes the same turn"). |

## Schema

No schema change. This item is scheduling, process-lifecycle and numeric-constant work only.

## Interfaces

**1. The never-start invariant (the core of this item).**

```ts
// filing-auto-persist.ts — replaces the bare `now() >= deps.deadlineMs` check
// at the three call sites (anchor pass ~1571, filing loop ~1639).
function hasFullBudgetRemaining(deps: Pick<AutoPersistDeps, 'deadlineMs' | 'now'>): boolean {
  if (deps.deadlineMs === undefined) return true; // unbounded — existing callers/tests
  const now = (deps.now ?? Date.now)();
  return deps.deadlineMs - now >= EXTRACT_TIMEOUT_MS;
}
```

Every call site that today reads `deps.deadlineMs !== undefined && (deps.now ?? Date.now)() >= deps.deadlineMs`
(lines 1571, 1639) becomes `deps.deadlineMs !== undefined && !hasFullBudgetRemaining(deps)`. This is
strictly *more* conservative than today's check — it can now skip a spawn earlier than the raw deadline,
never later — so no existing caller that relies on "runs until the deadline" regresses into overrun.

**2. The re-derived spawn/lock arithmetic.**

```ts
// filing-auto-persist.ts
export const EXTRACT_TIMEOUT_MS = 30 * 60 * 1000; // was 10 min (owner, OD-19)

// document-cycle.ts
export const DEFAULT_WAKE_BUDGET_MS = 50 * 60 * 1000; // was 20 min (owner, OD-19)

// filing-auto-persist.ts — FILING_EXTRACTION_LOCK_TTL_MS derivation, shown not typed:
//   wake budget (50 min) + one anchor sidecar at SIDECAR_TIMEOUT_MS + LOCK_SLACK_MS (60s)
//   The design (§2.1) states this is "under 60 minutes" and names 60 min as the bound
//   rounded up to the minute. SIDECAR_TIMEOUT_MS's exact value was not re-read this
//   session for this card — the derivation must be computed from the real constant,
//   not from the 60-minute rounded bound, when this item is implemented.
export const FILING_EXTRACTION_LOCK_TTL_MS = 60 * 60 * 1000; // derived, see above — was 45 min

// maxAnchorSpawnsWithinLockTtl — the worst case is now the WAKE BUDGET, not
// spawns × timeout (spawns × timeout no longer bounds a single filing pass,
// because hasFullBudgetRemaining() already caps the pass at the wake budget).
export function maxAnchorSpawnsWithinLockTtl(sidecarTimeoutMs: number): number {
  const filingWorstMs = getWakeBudgetMs(); // was: DEFAULT_MAX_SPAWNS_PER_CYCLE * EXTRACT_TIMEOUT_MS
  const budgetForAnchors = FILING_EXTRACTION_LOCK_TTL_MS - filingWorstMs - LOCK_SLACK_MS;
  let n = Math.max(0, Math.floor(budgetForAnchors / sidecarTimeoutMs));
  while (n > 0 && n * sidecarTimeoutMs >= budgetForAnchors) n--;
  return n;
}
```

**Why the old derivation breaks and this is the fix.** At the new numbers,
`DEFAULT_MAX_SPAWNS_PER_CYCLE (3) × EXTRACT_TIMEOUT_MS (30 min) = 90 min`, which is longer than both
the 50-minute wake budget and any sane lock TTL — the design says this explicitly (§2.1, "The invariant
that makes this safe, and which does not exist today"). Once `hasFullBudgetRemaining()` gates every
spawn, the worst case of a *whole filing pass* is bounded by the wake budget itself (50 min), regardless
of spawn count — a pass that starts a third extraction only if ≥30 min remain in a 50-min wake can never
run past 50 min wall-clock for the filing side (it may run fewer than 3 spawns; it cannot run longer).
`maxAnchorSpawnsWithinLockTtl` must be re-derived from `getWakeBudgetMs()` for this reason, not from
`spawns × timeout`, or it silently under- or over-counts anchor headroom against a filing-pass bound
that no longer matches its own formula.

**3. The static test that must assert the derivation, not a re-typed number** (closes the
now-broken test named in Files): `filing-auto-persist.test.ts` line ~1412 changes from

```ts
// OLD — now false at the new numbers (90 min is not < 60 min)
expect(DEFAULT_MAX_SPAWNS_PER_CYCLE * EXTRACT_TIMEOUT_MS + SIDECAR_TIMEOUT_MS + 60_000)
  .toBeLessThan(FILING_EXTRACTION_LOCK_TTL_MS);
```
to
```ts
// NEW — asserts the actual bound the code now enforces
expect(getWakeBudgetMs() + SIDECAR_TIMEOUT_MS + LOCK_SLACK_MS).toBeLessThan(FILING_EXTRACTION_LOCK_TTL_MS);
```
so the test fails the moment `getWakeBudgetMs()`, `SIDECAR_TIMEOUT_MS` or `FILING_EXTRACTION_LOCK_TTL_MS`
drift out of the relationship this item establishes — never re-typing `50 * 60_000` as a literal.

**4. CLI job-selection (recommended shape — the design does not name one).**

```ts
// index.ts — new CLI arg alongside the existing --source=
const job = args.find(a => a.startsWith('--job='))?.split('=')[1] as 'data' | 'live' | 'closed' | undefined;
```
`--job=data` runs discovery + document cycle + verification reads (today's due-step body minus the
market-hours block). `--job=live` runs subscription/demand-graph/GMP only, still gated on `openCount`.
`--job=closed` is item 17's own entrypoint (out of scope here beyond accepting the flag). Omitting
`--job` preserves today's single-cycle behavior for any caller that has not been updated (fail-open,
not fail-closed, for local dev and existing tests).

### PM2 ecosystem change (the lock-skip rule, concretely) — part of Interfaces

`scripts/deploy-linux.sh` lines 681-683 / 1376 drop `--cron-restart="${SCRAPER_CRON}"` entirely — the
scraper's PM2 app becomes `pm2 start ... --no-autorestart -- src/index.ts --source=all --job=<job>`
with **no** PM2-level cron, because PM2's `cron_restart` always kills-and-restarts an online process at
the scheduled minute (that is the literal mechanism §2.2 describes as today's force-kill) and there is
no PM2 flag that turns that into "skip if busy" instead of "restart regardless". OS-level cron (or a
systemd timer — **the design does not say which, and this card does not choose between them**, since
neither is visible in the code read this session) invokes a new wrapper, `scripts/scraper-wake.sh` (NEW)
neither is visible in the code read this session) invokes a new wrapper, `scripts/scraper-wake.sh`
(**NEW**), once per scheduled slot per job:

```
0 0,8,14 * * *   scripts/scraper-wake.sh data
*/30 10-18 * * * scripts/scraper-wake.sh live
30 18 * * *      scripts/scraper-wake.sh live   # the 18:30 half of "10:00-18:30"
0 22 * * *       scripts/scraper-wake.sh closed
```

`scraper-wake.sh` does not decide anything about IST slot arithmetic itself (that logic already lives
in `due-step-cycle.ts` and stays there) — it exists only to avoid spawning a redundant node process when
one is still running, as a cheap pre-filter (`pm2 jlist` status check for `ipodhan-scraper`; if `online`,
log "skip: previous cycle still active" and exit 0; otherwise `pm2 start` with the matching `--job=`).
The **authoritative** skip is still the in-process Redis lock at `scraper/src/index.ts:167-186` /
`549` (`CYCLE_LOCK_RESOURCE`, already present, already logs "previous cycle still running... exiting 0
without doing anything" on a failed acquire) — the wrapper's pm2-status check only saves a wasted
process spawn in the common case; the Redis lock is what makes "never kill" true even when two slots
land in the same cron minute (e.g. 14:00 is both a data-job slot and a live-figures-job slot under this
table — a real overlap this design creates, resolved by whichever wins the Redis lock running and the
other exiting 0).

## Feature flag

No new flag. `ENABLE_DUE_STEP_SCHEDULER` (already read at `scraper/src/index.ts:540`, gating the whole
due-step body) stays as the kill-switch for the entire scheduled-cycle mechanism; the three-job split
and the budget changes ship inside that existing flag's `true` path. Default per slot: unchanged from
today (the design does not name a different default for this item, and none of the constants above are
individually flaggable — they are compile-time constants, consistent with how `EXTRACT_TIMEOUT_MS` and
`DEFAULT_MAX_SPAWNS_PER_CYCLE` are defined today).

## Tests

- **Unit, red before the change:** `scraper/tests/unit/services/filing-auto-persist.test.ts` — a new
  test asserting `hasFullBudgetRemaining()` returns `false` when `deadlineMs - now() < EXTRACT_TIMEOUT_MS`
  even though `now() < deadlineMs` (i.e., the exact case the old `now() >= deadlineMs` check would have
  wrongly allowed to start). Red today because `hasFullBudgetRemaining` does not exist yet.
- **Unit:** the rewritten static test at line ~1412 (Interfaces §3) — red today because
  `DEFAULT_MAX_SPAWNS_PER_CYCLE * EXTRACT_TIMEOUT_MS` at the new `EXTRACT_TIMEOUT_MS` (30 min) computes
  90 min, which is **not** `< FILING_EXTRACTION_LOCK_TTL_MS` at either 45 or 60 min — this test must fail
  the moment `EXTRACT_TIMEOUT_MS` is bumped and before `maxAnchorSpawnsWithinLockTtl` is re-derived,
  proving the old formula really does break.
- **Unit:** `document-cycle-wake-budget.test.ts` — `getWakeBudgetMs()` returns `50 * 60 * 1000` with no
  env override, and the `DOCUMENT_CYCLE_WAKE_BUDGET_MS` override still works at the new default.
- **Unit:** `due-step-cycle.ts`'s slot predicates (`mostRecentDiscoverySlotEpochMinute`, `isDiscoveryDue`)
  re-tested against `DISCOVERY_SLOTS_IST_MINUTES = [0, 480, 840]` (00:00/08:00/14:00) instead of the
  current four D-13 slots — tier: unit, per `.claude/rules/scraper-test-layout.md`.
- **Unit:** the widened live-figures window (10:00-18:30 vs today's 10:00-17:00) and the retained
  zero-OPEN-IPO short-circuit (`countIposByStatus(['OPEN'])`, `index.ts:355-359`) — a test asserting zero
  network calls when `openCount === 0` even inside the widened window.
- **Integration:** a lock-held scenario — two `main()` invocations racing the Redis `CYCLE_LOCK_RESOURCE`
  acquire, asserting the loser exits 0 and makes zero writes (extends the existing lock behavior at
  `index.ts:540-552`, not new machinery, but a new test naming it against the wider job set).
- No CLI-flag or PM2-wrapper test is proposable from code read this session — `scraper-wake.sh` is a
  bash script; its correctness is proven on staging (below), not by a unit test, per the deploy-script
  precedent already in this repo (`vps-data-audit-cron.sh` is smoke-tested by its cron running, not by a
  unit suite).

## Detection

No existing detection check covers scheduler cadence or budget derivation — this is new ground, not a
recurrence of a covered class. **New check recommended for item 10 to formalize** (this card does not
add it, since item 10 owns the detection-checks registry): a nightly assertion that
`maxAnchorSpawnsWithinLockTtl(SIDECAR_TIMEOUT_MS) × SIDECAR_TIMEOUT_MS + getWakeBudgetMs() + LOCK_SLACK_MS
< FILING_EXTRACTION_LOCK_TTL_MS` holds against the *live* deployed constants (not just the unit test,
which only proves it at commit time) — because a future PR could change one constant and forget the
others without touching the test file. Recorded here as a dependency on item 10, not invented as this
item's own detection change.

## Staging proof

The exact log line: a staging cycle log showing `'Due-step cycle: previous cycle still running
(scraper:cycle Redis lock held) — exiting 0 without doing anything'` (the existing message at
`index.ts:541`) appearing from a *second* job's wake while a *first* job's cycle is still in flight —
proving the skip-not-kill behavior end to end, not just in a unit test. Healthy value: that log line
present, and **no** PM2 restart/kill log entry (`pm2 logs` showing an `exit code` from a `SIGKILL`) for
the scraper app during an overlapping window. Second proof line: a staging filing-extraction cycle whose
`Document extraction budget exhausted` log (`document-cycle.ts:1247-1250`) never fires before at least
one 30-minute extraction has had the chance to complete, evidencing the wake budget actually reaches 50
minutes end to end. Which cycle carries it: the first data-job cycle after this item's deploy to
staging, per `docs/ops/prod-ops-recipes.md` §2 (staging cycle read recipe).

## Rollback

Revert the commit. Nothing here rewrites a stored row — `EXTRACT_TIMEOUT_MS`, `DEFAULT_WAKE_BUDGET_MS`,
`FILING_EXTRACTION_LOCK_TTL_MS` are process constants read fresh on every one-shot invocation, and
`scripts/deploy-linux.sh` / `scraper-wake.sh` / the crontab entries are configuration, not data. Rolling
back restores `--cron-restart="*/30 * * * *"` and the old constants in one deploy; the only irreversible
part is the wall-clock latency users experienced on documents that were force-killed under the old
regime and would not have been under this one — that latency cannot be recovered, only stopped going
forward. Per `defect-fix-contract.md` item 6 / `.claude/rules/recurrence-detection-gate.md`, this PR
touches `scraper/src/services/**` and needs either a detection-check change or an explicit `No detection
change: <reason>` line — see Detection above, which names the dependency on item 10 rather than adding
one here.

## Tier, budget and cost

**Tier A** — this is scheduled/cron work and a write-path (extraction) budget change, both named Tier-A
triggers in `engineering-roles.md` / the review-tier rule. `Budget: 60 min wall-clock, 120 tool calls`
(Tier A per `claude-behavior.md` R10's table). Cost: this is the largest of the eighteen items (§7.1
calls it "medium" sizing but it touches five files across two workspaces plus a deploy script and gates
item 6/9/10/17's tiering); expect one full review round plus a second only on a CRITICAL/MAJOR finding,
per the review-tier rule. It has no code dependency (§7.1: "— (scheduler)"), so it can start immediately
in parallel with item 1, but item 17 (closed-IPO job) and items 9/10 (re-read loop, verification checks)
cannot land until this item's scheduler and budgets exist.

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

26 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §2.1 | R-001, R-002, R-003, R-004, R-005, R-006, R-007, R-008, R-009, R-010, R-011, R-012, R-013, R-014, R-015, R-016, R-017, R-018 |
| §2.1.3 | R-019, R-020 |
| §5.1 | R-102, R-103, R-104 |
| §7.4 | R-146, R-147, R-148 |

## Known gaps

- **F-35 (MAJOR) — A nightly backlog drain adds a third extractor to a 2-vCPU box that already took a 522 outage from two.** Carried here rather than closed: a third extractor on a 2-vCPU box is a scheduling decision, and item 7 owns the lock, the budgets and the skip-rather-than-kill rule that bound it. Not fixed in the design (OD-47); it is this item's to close.

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
