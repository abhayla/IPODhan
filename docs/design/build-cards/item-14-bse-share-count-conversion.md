# Item 14 — convert BSE `Issue_Size_No_of_shares` from a share count to rupees (F-54)

## The design contradicts the code — read this before building anything

**F-54 and §7.1 item 14 describe this as an open defect: "BSE serves issue size as a SHARE COUNT...
Using it directly is exactly the share-count-stored-as-issue-size class."** That is true of the raw
field, but **the conversion already exists in the codebase and is already covered by unit tests**:

- `scraper/src/scrapers/bse-api-scraper.ts:147-151` —
  `export function computeBSEIssueSize(shares: number, priceFloor?: number): number` returns
  `Math.round(shares * priceFloor)`, guarded against zero/missing inputs.
- `scraper/src/scrapers/bse-api-scraper.ts:268,277` — `buildScrapedIPO()`, the shared mapper for
  BOTH the list+detail and detail-only paths, computes `shares` from
  `detail.Issue_Size_No_of_shares` and sets `issueSize: computeBSEIssueSize(shares, band.min)` —
  **the floor price, never the cap** (comment at the test file explains why: T-403's original
  fixture wrongly asserted cap-priced multiplication; W-109/round-8 corrected it to floor-priced,
  matching the real filing total for Glass Wall Systems).
- `scraper/tests/unit/scrapers/bse-api-scraper.test.ts:113-130` — three tests already exist:
  shares × floor (asserts the exact real value 482,280,000), zero-guard, and a named regression
  (`W-109 (round-8, Glass Wall Systems)`) asserting the floor-priced total and explicitly asserting
  it is NOT the cap-priced total.
- A repo-wide `grep` for `Issue_Size_No_of_shares` found exactly one call site
  (`bse-api-scraper.ts:268`) — there is no second, unconverted path writing this field from BSE.

**What this means for this card:** the extractor half of F-54 (the code fix + a conversion test) is
**already shipped**, dated (by the `W-109`/`T-403`/`round-8` references) to before this design
session. §7.1's framing — "small, but it is the recurrence class the detection gate exists for" —
undersells the recurrence-detection point (below) and oversells the extractor work as still to do.
This card is written for what is **actually** left, not what the design assumed was left.

## Purpose

Confirm and lock in place the BSE share-count → rupee conversion for `ipos.issueSize` that already
exists, and close the one real gap: an INDEPENDENT detection check for the "share count stored as a
rupee amount" class that does not depend on `computeBSEIssueSize` specifically — because this exact
class has already recurred once on a different write path after being fixed once
(`docs/reviews/failure-classes/share-count-as-issue-size.json`: "first_seen Aug 2026... recurred Sep
2026 on the create path (W-177)"), and the pull-model rewrite (items 1-9) is about to add MORE write
paths for `ipos.issueSize` (the consolidated child-table writer, item 1) where the same mistake can
recur a third time if detection is tied to this one call site.

## Serves

`docs/design/findings.json` F-54 (MAJOR). `docs/design/data-sourcing-pull-model.md` §7.1 item 14.
`.claude/rules/recurrence-detection-gate.md` (the rule this item is the worked example for).
`docs/reviews/failure-classes/share-count-as-issue-size.json` (the registered failure class this
item's detection half must keep "guarded," not re-guard from scratch).

## Files

| Path | State | Change |
|---|---|---|
| `scraper/src/scrapers/bse-api-scraper.ts:147-151` | exists | `computeBSEIssueSize` — **no change**. Already correct (floor-priced, guarded, tested) |
| `scraper/src/scrapers/bse-api-scraper.ts:262-286` | exists | `buildScrapedIPO` — **no change to the issue-size line**. Read this session for line-range accuracy only |
| `scraper/tests/unit/scrapers/bse-api-scraper.test.ts:113-130` | exists | **No change** — already the regression guard. An implementer should run this file (`cd scraper && npx vitest run tests/unit/scrapers/bse-api-scraper.test.ts`) as the FIRST step of this item, not write a new test blind |
| `docs/design/probes/fixtures/bse/GetMkt_ISSUE_BBS_IPO-7950.json` | exists | Real BSE payload (ARCIL/Asset Reconstruction, the F-51 duplicate-row IPO) — `Issue_Size_No_of_shares: "36912363"`, `Price_Band: "132.00-139.00"`. Confirms the field shape assumed by `computeBSEIssueSize`; **no OFS/fresh breakdown in this payload** — BSE's API exposes only the TOTAL share count, which is why item 14 depends on item 13 (the total this item produces is the reconciliation target item 13's gate checks fresh+OFS against) |
| `docs/reviews/detection-checks/c_issue_size_consistency.json` | exists | Already asserts `issue_size` (any source) falls inside a one-sided plausibility band against `shares_offered × price_range_max` (0.75x–3.0x, redefined 2026-09-07 from a symmetric band that false-positived real IPOs). **This check is source-agnostic — it already covers a future BSE-shaped regression.** No change needed |
| `docs/reviews/detection-checks/c_issue_size_floor.json` | exists | Already asserts `issue_size` clears a segment floor (Rs10,00,00,000 MAINBOARD / Rs1,00,00,000 SME) — the exact check that catches a raw share count (typically 4-40 million) being stored where rupees (typically 500 million-100 billion) are expected. **Already independent of write path** (reads `ipos` table only). No change needed |
| `docs/reviews/failure-classes/share-count-as-issue-size.json` | exists | `status: "guarded"` — this item does not need to create a new failure-class entry; it needs to keep this one accurate. If item 1's new consolidated writer introduces a THIRD write path for `ipos.issue_size`, this file's `detection_check` field already names the checks that cover it (`c_issue_size_consistency`/`c_issue_size_floor`) — no update needed unless a NEW check is added |
| `scraper/src/config/field-priority-matrix.ts` | exists | `issue_size` entry — confirm BSE's rank is unchanged (per F-54: "The rank stays because BSE does serve the concept") — **verify only, no edit expected** |

## Schema

**No schema change.** `ipos.issueSize` is unaffected by this item structurally; item 11's crore
conversion changes its unit, independently, on its own release. This item concerns only whether the
RUPEE value BSE contributes before that conversion is correct at the share-count-to-rupee step —
which it already is.

## Interfaces

No new interface. `computeBSEIssueSize(shares: number, priceFloor?: number): number` is unchanged;
document it as the reviewed-and-confirmed contract:
```typescript
// scraper/src/scrapers/bse-api-scraper.ts:147 (existing, unchanged)
export function computeBSEIssueSize(shares: number, priceFloor?: number): number;
```

## Feature flag

`ENABLE_BSE_API` (per project memory, `bse-json-api-enrichment.md`: deployed and ON in prod since
2026-06-17 via PR #39). **No new flag.** This item makes no behaviour change to gate.

## Tests

**Already exist and already pass** (`bse-api-scraper.test.ts:113-130`) — this item's test
obligation is: (1) run them and record the pass in the PR body as the "before" baseline (a Tier-B
item with pre-existing green tests still needs the reviewer to SEE them run, per
`supervisor-verification.md` — a claim of "tests already exist" is itself a claim to reproduce, not
accept); (2) add ONE new test asserting `c_issue_size_floor`'s failThreshold values
(`docs/reviews/detection-checks/c_issue_size_floor.json`) are still consistent with
`computeBSEIssueSize`'s real output range — i.e., a synthetic BSE payload at the smallest plausible
SME share count and smallest plausible SME floor price does NOT trip the floor check, closing the
loop between the extractor and the detection check this item is responsible for keeping aligned.

## Detection

**Already satisfied — this is the load-bearing correction to the design brief's framing.** The
brief states "the Detection heading here is not optional, and the check it adds must be independent
of the write path." Both existing checks (`c_issue_size_consistency`, `c_issue_size_floor`) already
ARE independent of the write path — they read `ipos`/`subscriptions` tables directly, with no
reference to BSE, NSE, or any specific scraper. **This item's actual detection obligation is
narrower than the brief implies: confirm these two checks still run in the pull-model's nightly
audit after items 1-10 land** (the audit script's invocation path,
`scripts/audit-detection-floor.mjs`, is not itself changed by the pull-model rewrite per this
session's reading of §7.1 — item 10 is "the verification checks in §4," a different check family
from the detection-floor audit) — **flagged as a cross-check for whoever lands item 10**, not a new
check this item builds. If a genuinely NEW gap is found (e.g., a check that only fires for
`ipos.issue_size` specifically and would miss a same-class defect on `ipo_details.freshIssue`, which
item 13 also touches), that gap belongs to item 13's card, not this one — item 14 is scoped to
`ipos.issueSize` alone, per F-54's own title.

## Staging proof

`node scripts/audit-detection-floor.mjs` (or its documented CI invocation) run against staging after
a real BSE scraper cycle, reading `c_issue_size_consistency` and `c_issue_size_floor`'s result lines:
both `PASS` with zero violations for BSE-sourced rows. Cross-check: pick one BSE-sourced IPO from the
staging `ipos` table this cycle wrote, and confirm `issue_size / (shares_at_floor_from_BSE ×
price_band_floor)` ≈ 1.0 (not ≈ 1/8,000,000, which is what an unconverted share count would produce).
No repair-invariant proof is needed — this item repairs no existing data (the conversion was already
correct at write time; there is no wrong-unit historical BSE-issue_size backlog this item creates or
inherits, unlike item 11 and item 13).

## Rollback

Nothing to roll back — this item changes no code. If the confirmation step (Tests, above) finds the
existing tests or checks have drifted (e.g., `c_issue_size_floor`'s threshold no longer matches
`computeBSEIssueSize`'s real range for a segment), the fix is a threshold adjustment to the JSON
check definition, which is data, not code, and reverts by restoring the previous JSON.

## Tier, budget and cost

**Tier B** (per the brief; confirmed appropriate — no write-path behaviour changes, only
confirmation + a detection-alignment check). Depends on item 13 (per §7.1's table) because item 13's
reconciliation gate is the consumer of the total this item guarantees is correctly denominated —
**not** because item 14 needs any code from item 13.
`Budget: 20 min wall-clock, 40 tool calls` — most of this item's original scope turned out to already
exist; the remaining work is confirmation, one alignment test, and updating this card's find into the
PR body so the next reviewer does not re-open a defect that is not there.

## Rules implemented

None. This item implements no numbered rule of the design — it is scaffolding for
the items that do. Stated explicitly rather than left blank, because an empty list and
a forgotten list look identical.

## Known gaps

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
