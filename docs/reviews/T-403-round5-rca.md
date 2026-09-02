# T-403 round 5 — root-cause analysis (Fable, 2026-09-02 09:40 IST)

Round-4 fresh review (T-408) verdict: NOT MERGEABLE. One blocker, two majors, four minors.
Two of the findings are RECURRENCES of classes already "fixed" in earlier rounds, so per the
owner's Rule 6 this RCA is written by Fable, not by the implementer.

## Class 1 (recurring, 3rd occurrence): a non-answer recorded as evidence of absence

| Round | Instance | "Fix" applied |
|---|---|---|
| r3 | every SEBI failure path returned `null`, read by the caller as ABSENT → NOT_YET_FILED | B-1: escalation gate reworked |
| r4 | HTTP 503 recorded as "not filed" | H-2/H-3: FAILED vs ABSENT distinguished per rung |
| r4-review | escalation-budget refusal returns `'absent'` at `document-discovery-runner.ts:888, :923, :1105` → NOT_YET_FILED from a request never made | (this round) |

**Root cause.** The rung outcome is a bare string union `'found' | 'absent' | 'failed'`. Nothing in
the type stops a code path that never received an HTTP response from returning `'absent'`. Each
round fixed the instances it could see; the type still lets the next early-return mint absence.
Prose rules in §9 ("ABSENT is evidence") do not constrain a string literal.

**Mechanism (the class fix, not another instance fix).** Make absence unconstructible without
evidence: `type RungOutcome = {kind:'found', doc} | {kind:'absent', evidence: AnsweredResponse} |
{kind:'failed', reason}` where `AnsweredResponse` can only be built from an actual response object
(status, url, bytes). Budget refusals, timeouts, shape errors, cached failures have no response and
therefore cannot type-check as absent. Add one test that greps/iterates every early-return in the
runner and asserts none returns `absent` without an `AnsweredResponse` argument (a structural test,
not a per-case fixture). Cache the verifier page per cycle so the budget is not burned per type.

**Detection gap.** The M-d budget test asserted `escalationGets <= BUDGET` — it tested that the cap
exists, never what the cap does to the row's state. Same shape as the round-2 acceptance test that
ratified an unreachable SEBI rung. Upgrade: every test of a limit/cap/guard must also assert the
row state it leaves behind.

## Class 2 (new, but the same family as T-403 r1 blocker "raw SQL bypass"): a write placed in one branch of a feature-flag if/else

`BaseScraperOrchestrator.ts:446` branches on `ENABLE_DATA_CONSOLIDATION` (true in prod). The
`recordDocumentSourceHints` call sits at `:512–515` in the `else` branch only, under a comment that
says "one choke point". With the prod flag on, `ipos.verifier_url` stays NULL and the verifier rung
logs `skipped:no_verifier_url` forever — the H-1 symptom survives its fix.

**Root cause.** No test drives `processIPO` with the consolidation flag ON. The orchestrator has
two exits and the write was hung on one of them.

**Mechanism.** Hoist the hint write to after `upsertedIPOId` is assigned, outside the if/else and
before the protected-field early return at `:432–439`. Add an orchestrator test matrix
{consolidation ON, OFF} × {new IPO, existing all-protected IPO} asserting the hint writer is called.

## Majors / minors to fix in the same round

3. Read-side host check claimed but absent: filter `verifier_url` with `isVerifierUrl` in
   `loadCandidateIpos` (or guard in `tryVerifier`), one test.
4. `:1475` downgrades `all_sources_failed` → `no_link` when the chain is short; replace with a
   non-settling outcome that stays retryable without asserting "not filed".
5. Integration tests use raw SQL for `documents.sha256` / `ipos.verifier_url`; route through
   `DocumentRepository.upsertDocument` / `IPORepository.updateDocumentSourceHints`.
6. Company rung: page 1 answers with no link, page 2 returns 403 → currently `absent`; must be
   `failed` (a 403 is not evidence). Falls out of the Class-1 type fix if done right.
7. `sourceOfDocumentUrl` returns `'NSE'` for an unparseable URL → return `'UNKNOWN'`.
8. Migration 0035 was edited in place (added `documents.sha256`). Branch-local so acceptable, but
   the acceptance run must be re-done on a DB rebuilt with `--reset`, and this is recorded here.

## Exit criteria for round 5

- Class-1 type fix landed; structural test proves no `absent` without evidence; M-d test also
  asserts row state.
- Class-2 hoist landed; orchestrator matrix test green.
- Items 3–8 done.
- Full scraper suite green; tsc clean; acceptance run 8/8 re-run on a `--reset` DB; evidence refreshed.
- One fresh Opus review of the round-5 diff only.

## Round-5 review (2026-09-02 11:10 IST) — Class 1, 4th instance: absence INHERITED, not minted

`escalateBeyondExchanges` returns `null` when every rung was skipped; the caller
(`document-discovery-runner.ts:1594–1605`) acts only on `found`/`failed`, so a pre-escalation
`outcome = 'no_link'` (set when the exchanges answered) survives even though
`settledByExchanges` was false. Chain
`EXCHANGES:no_link → SEBI:skipped → COMPANY:skipped → VERIFIER:skipped` → NOT_YET_FILED, no retry,
no alert. Reachable for every prod row until `verifier_url` is populated.

**Why the round-5 mechanism missed it.** The branded type constrains how absence is
*constructed*. This path never constructs it; it *inherits* a mutable `outcome` variable set
earlier in a 200-line function. The "structural" test is a source regex for `kind: 'absent'`
and cannot see a value that is merely not overwritten.

**Class fix (round 6).** The final outcome must be *derived*, never inherited: replace the
mutable `outcome` with a pure `resolveFinalOutcome(exchanges, settledByExchanges, escalation)`
that pattern-matches exhaustively (`never` on the default arm) and returns
`chain_incomplete` for `escalation === null && !settledByExchanges`. Unit-test that function
over the full input matrix (exchanges ∈ {ok/no_link, not_on_board, failed} × settled ∈ {t,f} ×
escalation ∈ {found, failed, null}); the runner calls it once at the end. The regex test stays
as a secondary guard. Also: `answeredFrom` not exported (test via behaviour); 0037 constraint
guard qualified by `conrelid`; `chain_incomplete` preserves `blockedSinceAt`; A4's expected
failure set pinned as a literal in a unit test.

**Detection upgrade.** Nightly check: any row that reached NOT_YET_FILED whose chain has zero
`ok`-answered rungs for a type the exchanges cannot serve → FAIL (`m_absence_without_evidence`).
