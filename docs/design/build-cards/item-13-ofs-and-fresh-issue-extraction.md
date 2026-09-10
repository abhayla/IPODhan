# Item 13 — extract `ofs_issue` in both forms, fix `fresh_issue`, gate on reconciliation (F-51)

> **Architect correction, 2026-09-10 (binding; this block wins over the text below where they differ).**
> Files row 1 is wrong about the code: `scraper/src/services/filing-persister.ts:691-695` COMPUTES `offerTotalMn = statedTotalMn ?? (freshMn + ofsMn)`; there is no same-document comparison today. The `offerTotalMn === freshMn + ofsAtCapMn` check is this item's work, with its failing test first. Do not slot-default `ENABLE_FILING_AUTO_PERSIST` (existing flag, ON in production); the slot helper applies to NEW flags only.


## Purpose

`ipo_details.ofsIssue` is captured from both the document's rupee statement and its share-count
statement (converted at the cap price), `freshIssue` extraction stops producing digit-wrong values,
and no fresh/OFS pair is written unless `fresh + OFS = ipos.issueSize` within ±0.5% — closing F-51.

## Serves

`docs/design/findings.json` F-51 (CRITICAL). `docs/design/data-sourcing-pull-model.md` §2.5.4 (the
full reconciliation table and the two-defect diagnosis), §7.1 item 13 (depends on item 2 — the field
manifest/priority configuration).

## The "6 of 9" claim — verified this session, not re-typed from memory

**What I could verify without a live DB query (Tier C, no ad-hoc runs on production data per
`.claude/rules/claude-behavior.md` and the VPS-is-production rule): the ARITHMETIC in §2.5.4's table
is internally consistent and checks out exactly, independent of trusting the design doc's prose.**

| IPO | Design's claimed reconciliation | Recomputed this session |
|---|---|---|
| Kanohar | 300 + 11,957,915 × ₹632 = ₹1,055.74 cr | `300 + 11957915*632/1e7` = **1055.740228** ✓ matches |
| Glass Wall | 60 + 20,213,722 × ₹182 = ₹427.89 cr | `60 + 20213722*182/1e7` = **427.8897404** ✓ matches |
| Pranav | implied OFS ₹35.43 cr ÷ 2,856,869 = ₹124/share | `354300000/2856869` = **124.02** ≈ 124 ✓ matches (rounds to the stated cap) |
| Prasol | 80 + 420 = ₹500 cr | trivial, ✓ |
| Karamtara | 675 + 200 = ₹875 cr | trivial, ✓ |

**What I could NOT verify: the population count itself.** "Six of nine fail" and "all six [have
ofs_issue never extracted]" describe a live-database query run in an earlier session dated
2026-09-09 (same day, per the design doc's own "diagnosing it (2026-09-09)"). This card's brief
prohibits ad-hoc runs against the production/staging database from this Tier-C documentation task,
and the `docs/design/probes/` directory (this session's read-only evidence tree) has no saved query
output for this specific reconciliation — unlike `amount-columns.out.json`, there is no
`fresh-ofs-reconciliation.out.json`. **I did not re-run the query. I verified the arithmetic on the
five named rows and found it exact; I did not verify the count "9" or the count "6," and neither
does any artifact in this repo.** Stated as `**Unverified:** the 9-row denominator and the 6-row
failure count` per `claude-behavior.md` rule 20 — this is not the same as confirming the claim, and
the reader should not treat it as confirmed.

**What I verified in the code, which is corroborating evidence for the mechanism (not the count):**
`scraper/src/services/filing-persister.ts:678-679` reads `freshMn`/`ofsAtCapMn` from
`extraction.fresh_issue_amount`/`extraction.ofs_amount_at_cap` (falling back to `ofs_amount`) — two
independently-parsed fields with **no cross-check between them and `ipos.issueSize` anywhere in this
file**. `grep` for a `0.5%`/reconciliation tolerance check in `filing-persister.ts` found none. The
absence of a gate is real and independently confirmed; the exact historical failure count is not.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/src/services/filing-persister.ts:678-698` | exists | `freshMn`/`ofsAtCapMn`/`offerTotalMn` computed but never checked against each other beyond `offerTotalMn === freshMn + ofsAtCapMn` **when both legs are present in the SAME document** (line 692) — this is a same-document sum, not a reconciliation against the STORED `ipos.issueSize` (which may have come from a website on a prior cycle, per §2.5.4's core finding). Add the cross-source gate here |
| `scraper/src/services/filing-persister.ts:887-897` | exists | `mark('freshIssue', ...)` / `mark('ofsIssue', ...)` write unconditionally once a unit is available. Add: withhold BOTH when the reconciliation check (below) fails, mirroring the existing withhold pattern already used for cross-document disagreement (`withholdAll`, lines 1122-1133) — same mechanism, new trigger |
| `scraper/src/services/filing-persister.ts:1297` | exists | `vset('ofsShares', num(extraction, 'ofs_shares'))` — the SHARE form is already captured into `ipo_valuation.ofsShares` (bigint, share count, correctly unconverted). **This item's "both forms" requirement is already half-built**: the share count is already stored; what is missing is USING it — computing `ofsShares × priceCap` as a second, independent estimate of the rupee OFS amount and checking it agrees with the directly-extracted rupee figure before either is trusted |
| `scraper/src/services/filing-persister.ts:281-284` | exists | `convertUnit(value, from, to)` — reusable for the share→rupee step (`ofsShares * priceCap`, already in rupees, no unit conversion needed there; `convertUnit` is for the amount-unit side, not the price side) |
| `scraper/src/config/field-priority-matrix.ts:277-291` | exists | `fresh_issue_size` / `offer_for_sale_size` matrix entries exist (`sources: ['ADMIN','DRHP','NSE','BSE','MONEYCONTROL']`) but per §7.1 item 1, `ipo_details` has **no consolidated writer yet** — this matrix entry is presently unconsumed for these two fields (item 1 is the prerequisite that wires it; not this item's job to build that writer, only to add the reconciliation gate inside whichever writer item 1 lands) |
| `scraper/src/config/feature-flags.ts:251-251,con text 245-250` | exists | `ENABLE_NSE_OFS` — a SEPARATE, unrelated OFS mechanism (NSE website scraping of an OFS book, not document extraction), default `false`, "no real OFS book has been observed since this wiring landed... payload shape is unverified." **Not this item's scope** — named here only so an implementer does not confuse it with the document-extraction OFS this item fixes |
| `scraper/tests/unit/services/filing-persister.test.ts` (verify exists — this session did not open it) | exists (assumed; confirm with `ls`) | Add the reconciliation-gate tests |

## Schema

**No schema change.** `ipo_details.freshIssue`/`ofsIssue` and `ipo_valuation.ofsShares` already
exist (see item-11's card for the crore-conversion of the first two, which is independent of and
sequenced to run against whatever this item writes — item 11 depends on item 10 which depends on
item 9 which depends on item 6, none of which depend on item 13; item 13 depends only on item 2 per
§7.1's table, so it can land before or after item 11 without reordering either).

## Interfaces

```typescript
// scraper/src/services/filing-persister.ts — new function, colocated with convertUnit/toRupees
/**
 * F-51: fresh + OFS must equal the total within 0.5%, using the SAME document's total when present,
 * or the currently-stored ipos.issueSize when the document does not state a total. A digits-wrong
 * fresh_issue (Kanohar: 60 vs the correct 300) reconciles falsely against nothing — only against a
 * total — which is why a magnitude bound alone (item 11's detection check) cannot catch it.
 */
export interface ReconciliationInput {
  freshRupees: number | null;
  ofsRupeesDirect: number | null;      // extraction.ofs_amount_at_cap / ofs_amount, converted to rupees
  ofsSharesAtCap: number | null;       // ipo_valuation.ofsShares
  priceCap: number | null;             // ipo_valuation.priceCap
  totalRupees: number | null;          // this document's stated total, or stored ipos.issueSize
}
export interface ReconciliationResult {
  ok: boolean;
  ofsRupeesResolved: number | null;    // the value actually written, or null if withheld
  reason: string | null;               // e.g. "ofs_amount_at_cap (₹427.89cr) vs ofs_shares*cap (₹368.13cr): 16% apart"
}
export function reconcileFreshAndOfs(input: ReconciliationInput): ReconciliationResult;
```

Resolution order when both OFS forms are present and DISAGREE with each other: **withhold both and
report** (mirrors the existing `withholdAll` pattern for cross-document disagreement — a within-
document disagreement between the two ways OFS is stated is the same class of "the table was
mis-parsed" signal). When only one form is present, use it, then check `fresh + OFS` against
`totalRupees` at the ±0.5% tolerance; a failure withholds `freshIssue` AND `ofsIssue` together
(never one alone — a failing reconciliation cannot attribute the error to one leg, per §2.5.4's own
observation that the two known defects are independent but the check can't tell them apart).

## Feature flag

None new — this is a write-path GATE inside `filing-persister.ts`, which is itself already behind
`ENABLE_FILING_AUTO_PERSIST` (default `false`, `feature-flags.ts:212`). No new flag needed; the gate
activates whenever the persister runs, same as every other check inside it (cross-document
agreement, numeric-fit, protection). Rollback is "the gate is stricter, revert the commit" — see
Rollback.

## Tests

- **Red before the change**, unit, in `scraper/tests/unit/services/filing-persister.test.ts`
  (extend): given `freshMn=60`, `ofsAtCapMn` computed to a value such that `60 + ofs != totalMn`
  within 0.5%, both `freshIssue` and `ofsIssue` are WITHHELD (currently both would be WRITTEN —
  this is the regression test proving the gate is new).
- Given `ofs_shares × priceCap` disagrees with `ofs_amount_at_cap` by more than the tolerance, both
  OFS forms are withheld and the report names both values (Kanohar/Glass Wall-shaped fixture,
  synthesized from the design doc's own numbers since no `.json` fixture for these two IPOs exists
  under `docs/design/probes/fixtures/` this session — **a real fixture from the live NSE/document
  source is required before this test is considered proof-grade**, per this item's Tier-A status and
  the defect-fix-contract's "a parser/extractor brief carries a REAL fixture" rule. This card names
  the requirement; sourcing the actual Kanohar/Glass Wall filing text is implementation-time work).
- Given a document states only `freshMn` (no OFS anywhere in it, a fresh-issue-only offering), the
  gate does NOT fire (matches §2.6's existing rule: absence of a component is not a reconciliation
  failure).

## Detection

**New check**, `docs/reviews/detection-checks/c_fresh_ofs_reconciliation.json` (NEW) — nightly audit reads
every row where BOTH `ipo_details.freshIssue` and `ipo_details.ofsIssue` are non-null and asserts
`|fresh + ofs - issueSize| / issueSize <= 0.005`. This is independent of the write path (reads only
`ipos`/`ipo_details`, not the scraper internals), so it also catches a future write path that
bypasses this item's in-persister gate — the same "independent of the write path" requirement item
14 states explicitly, applied here because F-51 is itself a two-write-path problem (the document
extractor vs. whatever wrote the currently-wrong live values, which this session could not identify
— see the Files table's `ENABLE_FILING_AUTO_PERSIST` note above and item 11's parallel open question).

## Staging proof

Deploy to staging with `ENABLE_FILING_AUTO_PERSIST=true` (staging-only, per the flag's existing
staging/prod split), run one real filing extraction against a document that has both a fresh-issue
and an OFS statement (Chittorgarh/NSE/BSE fixture already in
`docs/design/probes/fixtures/` — reuse rather than fetch new), and read the persister's structured
log line for the reconciliation outcome: `{ ipoId, freshIssue, ofsIssue, reconciled: true, deltaPct }`
with `deltaPct <= 0.5`. For a deliberately-broken fixture (fresh mis-stated), the same log line with
`reconciled: false` and BOTH fields absent from what was written that cycle.

## Rollback

Fully reversible — the gate is additive (it can only WITHHOLD a write that would otherwise have
happened, never write a NEW value the old code wouldn't). Reverting the commit restores the
pre-gate behaviour exactly; no stored data is rewritten by this item itself (the actual repair of
the 6 already-wrong live rows is a SEPARATE data-repair task per F-51's own `fix_in` note: "extractor
fix + data repair — needs its own contract, NOT a design change" — this card is the extractor-fix
half only).

## Tier, budget and cost

**Tier A** (write-path change, per `.claude/rules/engineering-roles.md` review-tier rule — any
change to a write path that decides what gets persisted is Tier A by default). Depends on item 2.
`Budget: 45 min wall-clock, 90 tool calls` for the implementation task. One review round expected;
escalate to two if the reviewer flags the withhold-both-on-disagreement policy as too coarse (a
plausible finding — the design does not specify per-leg attribution, and this card did not invent
one beyond "withhold both").

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

5 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §2.5.4 | R-066, R-067, R-068, R-069, R-070 |

## Known gaps

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
