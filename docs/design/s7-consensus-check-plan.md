# S7 — nightly consensus check (runs right after S3b, NOT last: it gates any flag flip)

**Core:** a check that reads the consensus verdicts written by S3b and fails when they are wrong
or absent.
**Proof:** the check is RED on a planted violation in `ipodhan_test` and GREEN when clean —
both runs read, not inferred.

Tier B. Depends on: S3b (nothing writes a verdict until then).

## Two halves, and the second is the one people forget

### Half 1 — the verdict is sane
For every `field_sources` row written since the last run:
  - a row with 2+ real witness answers that agree   -> CONFIRMED
  - a row with 2+ real answers that disagree        -> DISPUTED
  - a row with exactly 1 real answer + abstentions  -> UNCONFIRMED
  - a field whose segment gives it 1 capable source -> SINGLE_SOURCE
  - a field with 0 capable sources for its segment  -> NO_WITNESS
Each mismatch reported BY IDENTITY (ipo, table, field), never as a count — signal-ownership R1.

Population resolved PER SEGMENT at run time from the manifest, never a static list:
MAINBOARD 1-source 68 / SME_BSE 87 / SME_NSE 77, and SME_BSE + SME_NSE each have 1 field with
NO witness at all. A static list would mislabel 19 fields on SME_NSE alone.

### Half 2 — OD-61: NO public payload carries a verdict or a second value
The owner's words: *"keep everything admin only... no user should not see any disagreement."*
The check must assert this, because it is the one rule a future UI change can break silently
and no test would notice.

Concretely, for every PUBLIC route (`web/app/api/ipos/**`, the rendered IPO page):
  - the JSON payload contains no `verdict`, no `witnesses`, no second value, no "sources differ"
  - MEASURED 2026-09-19: zero occurrences of `verdict` or `witnesses` in `web/app/api/**` today,
    so the check starts GREEN and its job is to STAY green.
A check that starts green is only useful if it can go red: the mutation test is to add the field
to a public serializer and watch it fail.

Admin routes (`/api/admin/**`, `/admin/conflicts`) are EXCLUDED by design, named explicitly in
the check rather than by a path glob that could silently widen.

## Registry entry
`docs/reviews/detection-checks/<id>.json` with `"section": "checks"` ONLY once a `record()` call
exists. Before that it goes in `notCoveredByThisManifest` — that is the honest-labelling rule the
registry already enforces (case 79). Then run `node scripts/build-detection-registry.mjs` and
commit BOTH the per-entry file and the regenerated aggregate.

NOTE for the builder: a `record()` call does NOT have to live in `audit-detection-floor.mjs`.
Several checks record from their own script (`audit-reverse-sweep.mjs`, `audit-ipo-coverage.mjs`,
`scripts/ci/require-fixture-provenance.mjs`). Pick the script whose consumer matches the check's
own `"consumer"` field, and say which in the PR.

## Failing tests first
- planted CONFIRMED on two DISAGREEING witnesses -> RED
- planted DISPUTED where one witness abstained (OD-60) -> RED, because an abstention is not a vote
- a `verdict` key added to a public route payload -> RED (this is half 2's mutation)
- clean DB -> GREEN

## What it must NOT do
Do not have it "fix" anything. It reads and reports. The repair path for a wrong verdict is the
admin queue (S9), not an auto-correct that would hide the bug that produced it.


## Added 2026-09-19 after S3b-2 and the tolerance fixes landed

**The verdict writer EXISTS now and is DORMANT.** `ENABLE_VERDICT_WRITER` reads
`process.env.ENABLE_VERDICT_WRITER === 'true'` and is set NOWHERE in any workflow or deploy script
(verified by grep over .github and scripts). So:
- The column is EMPTY on every slot. A check that only counts verdicts reports 0 and looks like it
  passed. It must distinguish "no verdicts written" from "verdicts all correct" and say which.
- This check is the JUSTIFICATION for ever flipping that flag. It has to be able to fail before the
  flag is worth flipping, which means it needs a planted-violation proof on ipodhan_test, not a
  clean-DB pass.

**The verdict states as built** (scraper/src/services/witness-verdict.ts):
CONFIRMED / DISPUTED / UNCONFIRMED / SINGLE_SOURCE / NO_WITNESS, decided in that order —
NO_WITNESS and SINGLE_SOURCE are structural facts about the SEGMENT, checked before any comparison.

**Comparison is ALL-PAIRS as of #790**, not pivot. A check that re-derives "should this be
CONFIRMED" must use all-pairs too, or it will disagree with the writer on exactly the
non-transitive cases (995.01 / 1000 / 1004.99).

**The families are now EIGHT in the manifest, SEVEN comparable** (COUNT added in #790; ABSTAIN is
writer-only). If this check re-derives a verdict it must read the family from the manifest, never
a hardcoded list — a hardcoded copy is the exact drift #783 was filed about and a test copy of it
broke on #790.

**ABSTAIN fields (14) have NO verdict by design.** The check must treat a null verdict on an
ABSTAIN field as CORRECT, and a null verdict on a 2+-witness non-ABSTAIN field as a finding.
Getting this backwards would make the check fail on 14 fields forever.

## Registry note, learned tonight
A `record()` call does NOT have to live in `audit-detection-floor.mjs` — `g_reverse_sweep` records
from `audit-reverse-sweep.mjs`, `g_served_stored_delta` from `audit-ipo-coverage.mjs`, and
`fixture_provenance` from its own CI script. Pick the script whose consumer matches this check's own
`consumer` field and say which in the PR. Until a `record()` call exists the registry entry goes in
`section: "notCoveredByThisManifest"` — that is the honest-labelling rule (case 79) and 21 pull/
reread checks currently sit there correctly.

## REUSE, measured — do not build a second route sweep
`e_route_sweep` in `scripts/audit-detection-floor.mjs` (~line 540-575) ALREADY:
  - enumerates every `web/app/api/**` route,
  - splits admin out (`adminRoutes` = startsWith('/api/admin/'), `publicRoutes` = the rest, :544-545),
  - fetches each public route with a 15s abort, and
  - has the RESPONSE BODY TEXT in hand (`const text = await res.text()`, :560) before calling
    `classifyRouteResponse` (exported from `scripts/lib/detection-floor-checks.mjs:246`).

So OD-61's half of S7 — "no public payload carries a verdict or a second value" — is a small
addition INSIDE that existing loop: scan the text it already fetched for `verdict`, `witnesses`,
and a second-value marker, and record it as its own check id. Building a parallel sweep would mean
a second enumeration to drift out of sync with the first, and double the outbound traffic on a box
that serves production.

Admin routes stay EXCLUDED by the existing filter, which is what OD-61 wants — disputes live on the
admin surface. Name the exclusion explicitly in the check's registry entry rather than relying on
the path prefix silently.
