# Item 15 — revive `valueActuallyChanged` so no-op suppression can be measured

## Purpose

After this ships, a verification pass that re-asks a field and gets back the same value is
provably distinguishable — by a counter, not a guess — from a verification pass that rewrote the
value identically. Today neither the code nor any check can tell those two apart.

## Serves

Design §2.5.2 ("A re-ask must not rewrite an unchanged value") and check `PULL-NOOP` (design §4).
Finding F-49 (MAJOR, "W-106: `valueActuallyChanged` is dead, so no-op suppression cannot be verified
under the pull model"). Design §7.1 row 15: "small; **prerequisite of item 6**, which cannot be
verified without it."

## What I verified this session, and where the task brief's framing needs correcting

The brief asked me to "prove with grep that it exists and has no caller, cite the line." I ran:

```
grep -n "valueActuallyChanged" -r scraper/ web/ packages/
```

Result: **two files**, not zero callers:

```
scraper/src/services/data-consolidation-service.ts:930:          const valueActuallyChanged =
scraper/src/services/data-consolidation-service.ts:932:          const valueChanged = !existingValueFromMap || (choseIncoming && (hadDifferentSource || valueActuallyChanged));
scraper/tests/unit/services/data-consolidation-noop-write-suppression.test.ts:2: * S-02 §5 no-op write suppression: `valueActuallyChanged` used to compare
scraper/tests/unit/services/data-consolidation-noop-write-suppression.test.ts:48:describe('S-02 §5: no-op write suppression (valueActuallyChanged normalized comparison)', ...)
```

**`valueActuallyChanged` is a local `const`, not a function — it has no "callers" in the sense the
brief assumed; it is read exactly once, on the very next line (932), inside the same block.** The
correct statement of the defect (matching F-49's own detail line, which I read in full) is
different and narrower than "dead code with no caller":

```ts
// scraper/src/services/data-consolidation-service.ts:919-932
const existingValueFromMap = existingSourceMap.get(fieldResult.fieldName);
const choseIncoming = fieldResult.chosenSource === input.source;
const hadDifferentSource = existingValueFromMap && existingValueFromMap.source !== input.source;
const rulesForField = getFieldRules(fieldResult.fieldName);
const normalizedFinal = normalizeChosen(fieldResult.fieldName, fieldResult.finalValue, rulesForField);
const normalizedExistingFromMap = existingValueFromMap
  ? normalizeChosen(fieldResult.fieldName, existingValueFromMap.value, rulesForField)
  : null;
const valueActuallyChanged =
  !!existingValueFromMap && !areEquivalent(normalizedFinal, normalizedExistingFromMap);
const valueChanged = !existingValueFromMap || (choseIncoming && (hadDifferentSource || valueActuallyChanged));
```

`valueChanged`'s result only depends on `valueActuallyChanged` when **both** `existingValueFromMap`
is truthy **and** `hadDifferentSource` is `false` — i.e., the SAME source re-supplies a value for a
field that already has one. In every other combination, `valueActuallyChanged` is computed (JS does
not short-circuit a separately-assigned `const`) but its boolean result is thrown away by the `||`.
This matches F-49's own wording exactly: *"a higher-priority source with an equivalent value is
treated as convergence before the check is consulted"* — walk item W-106 (2026-09-03) found that on
every path it walked, `hadDifferentSource` (or `!existingValueFromMap`) was already `true`, so
`valueActuallyChanged`'s own answer never once decided the outcome in the cases actually observed.
It is not unreachable code; it is a computed value that has never been caught in the act of
mattering. **`grep`-provable "no caller" is the wrong test for this defect** — the right one, which
this card uses instead, is a counter that reports how often `valueActuallyChanged` alone decided
`valueChanged`'s value, which today nothing reports.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/src/services/data-consolidation-service.ts` | exists | Lines 919–932 (quoted above) gain a counter increment distinguishing three cases on `result` (the function's return object, already accumulating `fieldsUpdated` at line 927 area): (1) written because no existing value, (2) written because a higher/different-priority source chose incoming (`hadDifferentSource`), (3) written **because `valueActuallyChanged` alone was true** — same source, value genuinely changed. Case 3's count, divided by the number of fields re-asked in the cycle, is what `PULL-NOOP` (design §4) reads. |
| `scraper/tests/unit/services/data-consolidation-noop-write-suppression.test.ts` | exists | Gains a case that exercises the case-3 path specifically (same source, equivalent value after normalization) and asserts the new counter increments, plus a case (same source, genuinely different value) asserting it does NOT count as a no-op. Today's suite (per its own describe block, line 48) already covers `areEquivalent`/`normalizeChosen` normalization; it does not appear (title read only, not the full file body this session — **fork**: I did not read this test file's full body, so I cannot certify it lacks a case-3 assertion, only that the design's own F-49 says the counter this exposes is unverified) to expose the new counter. |
| `scraper/src/services/data-consolidation-orchestrator.ts` | exists, cited by design §7.1 at line 187 (`tableName: 'ipos'` only) | Wherever this orchestrator surfaces per-cycle stats to the report the nightly `PULL-NOOP` consumer reads (**not located this session** — the design names `PULL-NOOP`'s formula, "writes per cycle ÷ fields re-asked per cycle" (§4), but does not name which file emits the nightly report line; this is a fork for the implementer, not guessed here). |

## Schema

No schema change. This is an in-memory counter surfaced in a per-cycle report, not a stored value.
**Fork, not decided here:** if `PULL-NOOP` needs the count persisted across cycles for its
"near zero on a day with no filings" / "rises without a matching document arrival" comparison
(design §4), it needs a small time-series row somewhere (per-cycle counters table) — the design
does not name one, and none of item 15's cited files show an existing per-cycle stats table. This
is the same class of gap item 10 ("the verification checks in §4, each a named script with an exit
code") is more likely to own; item 15 is scoped here to making the number computable and exposed,
not to building `PULL-NOOP`'s own storage — that dependency is explicit in §7.1's table ("15" has no
listed dependents beyond being a prerequisite of item 6, and `PULL-NOOP` is listed under item 10's
domain in §4, not item 15's).

## Interfaces

```ts
// Illustrative shape only — the design does not specify a return-type name.
interface NoopSuppressionCounts {
  writtenNoExisting: number;      // !existingValueFromMap
  writtenDifferentSource: number; // hadDifferentSource
  writtenSameSourceChanged: number; // valueActuallyChanged alone decided it — THE new signal
  suppressedNoop: number;         // existingValueFromMap && !valueChanged — the counter PULL-NOOP wants on the OTHER side of its ratio
}
```

`suppressedNoop` is the more directly useful counter for `PULL-NOOP`'s stated formula ("writes per
cycle ÷ fields re-asked per cycle") — every re-ask that reaches this code path and result in
`valueChanged === false` is a suppressed no-op; every one where `valueChanged === true` is a write.
The three-way split above is what makes `writtenSameSourceChanged` — the branch F-49 says has never
been observed to fire — separately visible from `writtenDifferentSource`, which is the entire point:
without the split, a healthy `PULL-NOOP` ratio and a `valueActuallyChanged` that has silently never
mattered look identical.

## Feature flag

The design does not name one for item 15, and none is needed — this is a read/count-only addition,
not a behavior change to what gets written (`valueChanged`'s formula is untouched; only what gets
counted alongside it changes). No rollback risk to gate.

## Tests

- **Unit, extend `data-consolidation-noop-write-suppression.test.ts`**: three cases matching the
  `NoopSuppressionCounts` shape above — (a) no existing value -> `writtenNoExisting` increments; (b)
  existing value, different source, any value -> `writtenDifferentSource` increments,
  `writtenSameSourceChanged` does not; (c) existing value, SAME source, value equivalent after
  normalization -> `suppressedNoop` increments and neither written counter does; (d) existing value,
  same source, value genuinely different (not just string-shape-different, e.g. `6800000000` vs
  `6900000000`, not `6800000000` vs `"6800000000.00"`) -> `writtenSameSourceChanged` increments.
  **Case (d) is the one F-49 says has never been exercised** — it must be red before this change in
  the sense that nothing today asserts it separately from the general `fieldsUpdated` counter, even
  though the underlying `valueActuallyChanged` boolean already computes correctly; the test is new,
  not a fix to broken logic.
- Tier per `.claude/rules/scraper-test-layout.md`: unit, `scraper/tests/unit/services/`.

## Detection

**No detection change: 20+ characters** — this item builds the measurement `PULL-NOOP` depends on;
it is not itself a live write-path behavior change subject to
`.claude/rules/recurrence-detection-gate.md` in the sense of a new failure class, and `PULL-NOOP`
(design §4, already specified) is the detection upgrade this item exists to make possible. Item 15
does not itself add `PULL-NOOP` — that is item 10's "verification checks in §4, each a named script"
— so this card's own change carries no detection addition beyond the new unit-test cases above.

## Staging proof

No staging proof obligation on its own per `defect-fix-contract.md`'s framing — this item changes no
write behavior (the `valueChanged` boolean formula is unchanged; only counters alongside it are
added), so there is no data-repair or behavior-change to prove on real data. **It becomes a
precondition of item 6 and item 10's staging proof**: `PULL-NOOP`'s first real reading (design §4:
"the first proof is a staging slot whose log line names a counter that moved") is only meaningful
once this item's counters exist. This card's own "done" is: the four unit-test cases above pass,
and `writtenSameSourceChanged` is confirmed (by a manual staging read, not required for merge) to
be a real, nonzero-when-expected number rather than a permanently-zero one — proving the branch F-49
found "dead in every tested path" is now at least observable.

## Rollback

Reversible (design §7.2 lists item 15 explicitly under "Reversible: ... additive or subtractive
behind a flag, with no stored value rewritten"). Revert the commit; no data is touched, only
counters are removed from the report.

## Tier, budget and cost

**Tier B** (design §7.1: "small; prerequisite of item 6" — ordinary app code, no deploy/auth/
migration/deletion; the task brief also names it Tier B). `Budget: 20 min wall-clock, 40 tool calls`
for implementation — this is the smallest of the three items in scope and should not need a second
review round.
