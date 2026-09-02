# Detection-gap RCA: G4 filing persister, review round 7 (2026-09-03 00:35 IST)

Tier A review of round 7 (1298065a) returned NOT MERGEABLE with two CRITICAL, two MAJOR findings.
Per the detection-gap rule, each finding records what should have caught it and the detection
upgrade that ships with round 8.

| Finding | Instance | Class mechanism | Why the previous round did not catch it | Detection upgrade (round 8) |
|---|---|---|---|---|
| C1 `ipo_valuation` protection computed then discarded (payload built from the unfiltered object) | fix payload from `valuationWritable`; sweep all tables | field-protection filter must feed the payload, not only the emptiness check | The round-6/7 test asserted only that `filterFields` was CALLED per table (shape, not substance). A mutation removing the filter's effect stayed green. | Per-table substance test: protected column absent from the written payload; mutation "remove filter effect" must go red |
| C2 anchor path ignores `scraper_locked` | lock check in `anchor-persister.ts` | every door into a persister checks the row lock | Round 7 added field protection on the anchor path and the reviewer's checklist stopped there; no test covers a locked IPO on that door | Locked-IPO test for the anchor door; review checklist item "every door: lock + protection" |
| M1 red test: RHP writes `issueSize` from the fresh leg alone | write only with both legs / stated total | one-leg totals never become issue_size | The fixture change (f38cc4a2) landed from another worker; the persister test was not re-run on that commit (per-file runs, no branch-wide suite yet) | Branch-wide `npm run test:unit` before any PR; a suite run is now a hard step in the walk's end sequence |
| M2 refusal exit tested as a pure function only | wiring test with mocked `process.exit` | script wiring is tested, not only its decision function | Round 7 extracted the decision to make it testable and stopped there | `persist-filing-wiring.test.ts` |

Success metric for round 8's review: recurrences of these classes = 0; findings a listed check
should have caught = 0.
