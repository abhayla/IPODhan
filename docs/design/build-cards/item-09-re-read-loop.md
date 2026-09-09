# Item 9 — The re-read loop

## Purpose

After this ships, a value already SUPPLIED by the pull walk is never silently trusted forever: it is
scheduled for a rank-2 re-check, and a genuine disagreement re-fetches and re-extracts the winning
document's own bytes (never adopts the website's number), stops after a bounded number of attempts keyed
to the evidence rather than a resettable counter, and — if still unresolved — becomes visible instead of
disappearing into a table nobody reads.

## Serves

§3 in full ("What happens when sources disagree — the re-read loop") and the `verify_due_at` /
`verify_state` / `verify_source` / `verify_value` / `disagreement_count` columns §2.3 puts on
`ipo_field_plan` for exactly this purpose ("§3's state, scheduled rather than accidental"). Also serves
OD-6 (*"Verification is a read, not a write"*, §2.5) — step 4 of §3.2 never adopts the disagreeing
source, and F-30's detection half (item 10) reads this item's `REREAD-RECEIPT` / `REREAD-VERDICT` /
`REREAD-LATENCY` checks from §4, which this item's writes make possible. §7.1 row 9 depends on item 6
(the pull walk) — the re-read loop re-checks values the walk already supplied; it has no work to do
before item 6 exists.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/src/services/re-read-loop.ts` | **NEW** | The scheduler + disagreement handler described below — walks `ipo_field_plan` rows whose `verify_due_at <= now()`, re-fetches, re-extracts one field, writes the extraction receipt, compares, and updates `verify_state`/`disagreement_count` per §3.2. |
| `scraper/src/services/filing-auto-persist.ts` | exists | The single-field re-extraction path this item calls is the SAME extractor invocation `processPendingFilings` already uses for a fresh document (line 1373 onward) — this item does not fork a second extraction code path; it calls the existing one with a page hint from `chosen_page` on the plan row (§2.3's `ipo_field_plan` schema, item 5/6's table). |
| `scraper/src/services/document-store.ts` | exists | The re-fetch in step 1 of §3.2 ("re-fetch the winning document's bytes and re-hash them") reuses whatever this file's existing download path is for a document already on record — **not read this session in enough depth to name a line range; the implementer must confirm the re-download entrypoint exists and is idempotent (same URL, same sha256 expected) before wiring this item to it.** |
| `scraper/tests/unit/services/re-read-loop.test.ts` | **NEW** | Unit tests per Tests below. |

## Schema

**No new table.** This item writes into columns §2.3 already assigns to `ipo_field_plan` (item 5/6's
table, not this item's): `verify_due_at`, `verify_state`, `verify_source`, `verify_value`,
`disagreement_count`. **The design does not name where the re-read BOUNDS of §3.3 are counted**
(2 re-reads per `(IPO, field, sha256)`; 1 re-read per document per day; 1 re-read per IPO per slot) — none
of the five verify_* columns above hold a per-`sha256` attempt count or a per-document daily stamp.
Recorded as a gap, not invented as settled: this card recommends two additional columns on
`ipo_field_plan`, to be confirmed as part of item 5/6's schema rather than assumed here:

| Column (recommended, not decided) | Purpose |
|---|---|
| `verify_attempts_on_sha256` | count of §3.2 re-reads against the *current* `chosen_sha256` — resets to 0 whenever `chosen_sha256` changes (§3.3's "Reset: a new sha256"), so 2 is a hard ceiling per byte-identity rather than a value someone can zero out |
| `verify_receipt_sha256`, `verify_receipt_at` | the extraction receipt of §3.2 step 3 ("sha256 computed now, extractor run id, page, timestamp") — without a stored receipt, `REREAD-RECEIPT` (§4) has nothing to check a re-read against |

The "1 re-read per document per day" and "1 re-read per IPO per slot" bounds in §3.3 are **document-** and
**IPO-scoped**, not field-scoped, so they cannot live on a per-field `ipo_field_plan` row without either a
join back to `documents.id` (already on the plan row as `chosen_document_id`, per §2.3) or a small
per-document/per-IPO cadence table mirroring the existing `AGGREGATOR_CADENCE_KEY` pattern
(`scraper/src/index.ts:186`, a Redis cadence key, not a DB table) — **the design does not say which**, and
this card does not choose between a DB column and a Redis cadence key on the implementer's behalf; either
satisfies §3.3's wording, and the choice should follow whichever pattern item 6 already establishes for
per-cycle state.

## Interfaces

```ts
// scraper/src/services/re-read-loop.ts (NEW)

/** One outcome of §3.2's five-step comparison. */
export type ReReadOutcome =
  | { kind: 'confirmed'; value: unknown }               // same value, check passes
  | { kind: 'corrected'; oldValue: unknown; newValue: unknown } // different, check passes
  | { kind: 'rejected'; storedValue: unknown }           // different, check fails — keep stored value
  | { kind: 'unresolved_disagreement' };                 // still disagreeing after the bound (§3.3)

export interface ReReadReceipt {
  sha256: string;        // computed NOW, from bytes read THIS cycle — never the cached extraction's hash
  extractorRunId: string;
  page: number | null;
  computedAt: Date;
}

/**
 * Re-checks one due plan row per §3.2. Returns `null` (no-op, logged) when the
 * re-download fails and produces no receipt — per §3.2's own warning, a
 * verification with no fresh receipt must never be recorded as a verification.
 */
export async function reReadField(
  planRow: IpoFieldPlanRow,
  deps: { store: DocumentStore; extractor: FilingExtractor; now: () => number }
): Promise<{ outcome: ReReadOutcome; receipt: ReReadReceipt } | null>;

/** Selects rows due this slot, respecting the §3.3 bounds (see Schema gap above for where they live). */
export async function selectDueReReads(now: Date, limit: number): Promise<IpoFieldPlanRow[]>;
```

**No receipt, no verification** is enforced structurally: `reReadField` returns `null` (not a
`'confirmed'` outcome) whenever step 1's re-download does not produce fresh bytes to hash — the caller
must never synthesize a receipt from a cached extraction, per §3.2's explicit warning about a wrong value
being "confirmed... forever" if this is skipped.

## Feature flag

**The design does not name a flag for this item.** Given `ENABLE_FILING_AUTO_PERSIST`
(`filing-auto-persist.ts`, read this session as the gate on the existing extraction path this item
reuses) and `ENABLE_DUE_STEP_SCHEDULER` (`index.ts:540`) are the two existing gates in this area,
recommended: a new `ENABLE_REREAD_LOOP` flag in `scraper/src/config/feature-flags.ts`, defaulting OFF in
every slot until the staging proof below is real, then ON in staging, then prod on the owner's word — the
standard rollout shape this repo already uses (`ENABLE_BSE_API`, `ENABLE_FILING_AUTO_PERSIST` per
CLAUDE.md's scraper-multi-source-priority section). If this item ships bundled with item 6's own flag
instead of its own, that is a call for whoever builds item 6, not assumed here.

## Tests

- **Unit, red before the change** (`scraper/tests/unit/services/re-read-loop.test.ts`, **NEW**):
  - `reReadField` returns `null`, not a `'confirmed'` outcome, when the re-download step throws or
    returns stale bytes — the direct test of the "no receipt, no verification" rule in §3.2's own
    warning paragraph.
  - Same value, check passes → `'confirmed'`, and the row's `disagreement_count` does not increment.
  - Different value, check passes → `'corrected'`, and `field_sources`/`data_conflicts` receive the
    correction (per §3.2 step 4's "write the correction").
  - Different value, check fails → `'rejected'`, and the **stored** value is unchanged — this is the
    direct test of "the website's number is never adopted."
  - A third re-read attempt against the SAME `sha256` is refused before any I/O happens (asserts
    `verify_attempts_on_sha256 >= 2` short-circuits `reReadField`, per §3.3's bound).
  - A new `sha256` on the same field resets the attempt count to 0 and allows a re-read even though the
    old `sha256` was already at its bound (§3.3's "Reset: a new sha256").
  - Two plan rows on the same document, same slot: only one re-read fires (the "re-reads per document
    per day: 1" bound covers both, not one each) — this test is the direct check on the schema gap named
    above; it cannot be written until that gap is resolved one way or the other.
- **Integration:** `selectDueReReads` against a real `ipo_field_plan` table (item 5/6's schema) — rows
  with `verify_due_at <= now()` are selected; rows not yet due are not.
- Tier per `.claude/rules/scraper-test-layout.md`: unit for the pure comparison/outcome logic, integration
  for anything touching the plan table or a real document download.

## Detection

`REREAD-RECEIPT`, `REREAD-VERDICT` and `REREAD-LATENCY` (§4) are the named checks for this item's
behavior, but **item 10 owns turning them into scripts with exit codes** — this item's job is only to
make the underlying facts (a receipt row, a verdict, a due-and-unattempted row) exist to be checked.
Recorded here as `No detection change: the checks this item's behavior needs (REREAD-RECEIPT,
REREAD-VERDICT, REREAD-LATENCY) are specified and built in item 10, which depends on this item existing
first (§7.1 row 10: "6, 9")` — a 20+ character reason naming the dependency, per
`.claude/rules/recurrence-detection-gate.md`, rather than adding a duplicate check here.

## Staging proof

The exact counter: a staging cycle log line from `reReadField` showing `outcome.kind` for at least one
row this cycle, plus a `data_conflicts` row resolved (§3.2 step 4's "resolve the conflict" on a
`'confirmed'` outcome) or corrected (a new `field_sources` row with the document as source on a
`'corrected'` outcome) — visible via `docs/ops/prod-ops-recipes.md` §2's staging cycle read. Healthy
value: at least one due row processed per cycle once `verify_due_at` rows exist (zero processed on a
cycle with zero due rows is not a failure — §4's `PULL-NOOP` check is what catches a walk that never
finds anything due when it should). Which cycle carries it: the first data-job cycle (item 7) after
`ipo_field_plan` (item 5/6) holds at least one row with a past-due `verify_due_at` — this item cannot be
proven on staging before items 5, 6 and 7 are live there.

## Rollback

Revert the commit and flip `ENABLE_REREAD_LOOP` off (if built per the Feature flag recommendation above).
Reversible with no data rewrite risk in the sense that `field_sources` already records the previous value
and source for every field (§7.2's general reversibility note for this class of item) — a bad
`'corrected'` write can be rolled back per field from that history. Not reversible: a `'confirmed'`
verdict that was actually wrong (the document really did change and the check missed it) cannot be
distinguished after the fact from a correct confirmation without re-running the loop again — this is a
risk inherent to the design (§3.2's own warning), not a new one this rollback note introduces.

## Tier, budget and cost

**Tier A** — this changes a write path (extraction re-triggering, `field_sources`/`data_conflicts`
writes) per `engineering-roles.md`'s Tier-A trigger list, and §7.1 marks item 9 Tier A directly.
`Budget: 60 min wall-clock, 120 tool calls`. Cost: "medium" per §7.1's sizing; one review round expected,
a second only on a CRITICAL/MAJOR finding. Depends on item 6 (§7.1: "6"); nothing in this item can be
exercised end-to-end before the pull walk exists to have supplied the values this item re-checks.

## Rules implemented

2 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §3.1 | R-090 |
| §3.2 | R-091 |

## Known gaps

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
