# S3a — collect every witness's answer; still write the rank-1 winner

**Core:** the walk can ask ALL ranked sources for one field in one pass and hold their answers
together. Today it CANNOT: `attemptOneField` returns on the first SUPPLIED answer
(`scraper/src/services/field-plan-walk.ts`, the SUPPLIED branch ~line 752, `return
recordAndClassify(...)` at 808/834/852).
**Proof:** one real staging-shaped field with two capable sources logs a line naming N=2
answers and their sources, and the written value is still the rank-1 one (byte-identical to
what the walk writes today).

RCA: `attemptOneField`'s rank loop is a FIND-FIRST loop. Consensus needs a COLLECT-ALL loop.
Class: every field walked by PASS 3, all segments, all statuses, all 190 manifest fields —
       not one field or one IPO.
Tier: A (control-flow change on the production write path).

## Behaviour contract — this slice changes NOTHING a reader sees
The value written, its source, the plan state recorded, and every counter must be identical
before and after, for every input. S3a only ADDS collection. S3b is where the verdict decides.
That is what makes S3a provable: a diff of walk outcomes across a staging cycle must be empty.

## The shape
- The rank loop keeps going after a SUPPLIED answer instead of returning.
- Answers accumulate as `{rank, source, outcome, value, docType?}`.
- After the loop, the winner = the LOWEST-RANK SUPPLIED answer — which is exactly the one the
  find-first loop returned. The write happens once, with that answer, as today.
- The other SUPPLIED answers go nowhere yet (S2's `witnesses` column is written in S3b).
  S3a logs them: `PASS 3: collected N answers for <field> [rank1:DOC=SUPPLIED,
  rank2:CHITTORGARH=SUPPLIED]`.

## The four traps, named
1. **NOT_AVAILABLE_YET returns early too** (line ~730) and calls `tryProvisional`, which itself
   walks lower ranks. Under collect-all, `tryProvisional` becomes redundant — its work is a
   subset of the main loop. Do NOT delete it in S3a; that changes behaviour. Leave it, and note
   the overlap for S3b. Deleting it is a separate slice with its own proof.
2. **Cost — MEASURED, and it is not a problem.** Two measurements, both taken 2026-09-19:
   (a) From `scraper/config/field-manifest.json` v2, ranks per field per segment:
       MAINBOARD 68 fields have 1 source, 72 have 2, 50 have 3 -> collect-all makes 362 fetcher
       CALLS against find-first's 190 worst case. 1.9x, not 3x, and 68 fields cost nothing extra.
       SME_BSE 322 vs 189; SME_NSE 327 vs 189.
   (b) Those calls are NOT network requests. `buildFieldPlanWalkFetchers` is called ONCE per
       cycle and closes over `BseFieldFetcherState` / `ChittorgarhFieldFetcherState`. Read from
       `field-plan-walk-bse-fetcher.ts:60-76` (the code, not its comment): `board` is a single
       memoized Promise and `detailByIpoNo` is a per-IPO Promise Map. The HTTP fetch happens once
       per wake (board) and once per IPO (detail) however many fields ask.
   So the extra 172 calls are in-memory map reads. NO flag gate is needed for cost reasons.
   Still COUNT fetcher invocations in the staging proof — a memo that silently stopped memoizing
   is exactly the kind of regression this slice would hide.
3. **A later rank can THROW after the winner is already known.** That must not turn a successful
   field into a failure. A throw at rank 2 when rank 1 SUPPLIED is a witness that abstained, not
   a field failure — it goes in `failures[]` for the log and does NOT set `sawTransientFailure`
   in a way that changes the recorded state.
4. **Claim/timeout budget.** Three fetches take ~3x as long, and the claim staleness window is
   what stops two walkers colliding. Check the window is still comfortably longer than the worst
   case before enabling.

## Failing tests first
- A1: two fetchers both SUPPLIED -> both are collected (assert N=2 AND both source names), the
  written value is rank 1's. RED today because the loop returns after rank 1.
- A2: rank 1 SUPPLIED, rank 2 THROWS -> still SETTLED with rank 1's value; the recorded state is
  unchanged from the single-source case.
- A3: behaviour-neutrality — a table-driven test over every outcome combination asserting the
  written value and recorded state match the find-first expectation.

## Mutation tests
- Make the winner the LAST supplied answer instead of the lowest rank -> A1 red.
- Let a rank-2 throw set the field's failure state -> A2 red.

## Real-data proof
A staging cycle read: the new log line present with N>=2 for at least one field, AND
`walk-proof.mjs` mismatches still 0, AND the fetch-count measurement from trap 2 recorded.

Depends on: S2 merged (the `witnesses` column must exist before S3b; S3a can land without it,
but landing them in order keeps the migration single-headed).
