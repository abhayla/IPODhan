# RCA — why live defects kept being found late on 2026-09-07 (owner directive 23:2x IST)

Owner: "find out why these issues got missed … this is happening very repeatedly … make this a rule … change whatever is needed."

## 1. The misses, with the time each one was already visible before anyone acted

| Defect (user impact) | First visible in an existing signal | First acted on | Lag | Signal that carried it |
|---|---|---|---|---|
| 23 prod IPOs show a share count as issue size (ESDS "Rs 1.76 Cr") | nightly floor on prod, 03:45 IST: `c_issue_size_floor` FAIL 23 | 15:5x IST, while chasing an unrelated anchor failure on staging | ~12 h | nightly audit output, read by nobody; audit-to-issues in dry-run |
| Sector empty on every IPO row (filter useless everywhere) | nightly floor `j_sector_populated` FAIL 0/313, for days | 12:4x IST, a worker noticed while building the dashboard dropdown | days | nightly audit output, read by nobody |
| Prod RHP extractor loops on a spawn timeout (ESDS, 6 times, never hard) | prod cycle summaries `extractionFailed 1` from 07:40 IST; the fix had merged the night before | 13:15 IST tick | ~5.5 h; fix-to-prod lag 23 h | cycle counter read every 30 min but not resolved to a document |
| Rentomojo price-band filing fails to persist every cycle (prod + staging) | prod log 12:04Z, staging 11:19Z | 16:49 IST tick, classified 17:5x | ~5 h | `extractionFailed` counter; the log line hides the database error |
| Steamhouse price-band ad refused (no unit) | staging 12:52Z | 18:45 IST tick | ~1.5 h | `extractionFailed` counter rising 1→2→3→4 |
| Three PRs closed unmerged seconds after creation | GitHub state, immediately | on the next merge attempt | minutes to hours | PR state; no read after `gh pr create` |
| Deploy 90 min late | session cron only fires when idle | 22:29 IST | 90 min | the timer itself |

## 2. Root causes (mechanism, not symptom)

**RC1 — Signals without an owner.** The nightly detection floor produces ~20 FAIL lines per night on prod. Nothing consumes them: the audit-to-issues sync is still in dry-run, no morning step reads the output, and tonight the output file could not even be located from the laptop. A wall of standing red hides every new red (alarm fatigue by design). The 23 wrong issue sizes and the empty sector column sat in that wall.

**RC2 — Counts instead of identities.** The supervision tick reads `extractionFailed: N` per cycle. A non-zero count was labelled "known" from memory of the previous tick without resolving which document and which error it was. Rentomojo and Steamhouse hid inside "1" for hours because a different failure had also been "1" earlier.

**RC3 — No delta.** Nothing compares today's failure set (floor ids, per-check entities, per-cycle failing documents) with yesterday's. A new class inside an old count is invisible; a class that disappears is never noticed either.

**RC4 — Fixed-on-main is mistaken for fixed.** The spawn-timeout fix merged at 23:16 the night before and prod kept looping for 23 hours. No signal says "this fix is not on the prod tag yet"; the brief and the ticks treated it as done.

**RC5 — Tool output that hides the cause.** The persist-failure log carries the SQL but not the database error; the coverage gate exits 2 with no text. Both turn a classifiable failure into "unknown", which then gets deferred.

**RC6 — Timers that depend on idleness.** Session crons only fire when the REPL is idle; a busy session silently slid the deploy by 90 minutes.

## 3. What was NOT the cause
- Not missing checks: every one of these defects already had a check or a counter that fired. The gap is between the signal and a human/agent acting on it.
- Not the reviewers: Tier A/B caught code defects well today (four guard holes, a stale RCA). Reviews do not read production.

## 4. The rule (new, global): every signal has an owner, and "known" needs a number
See `.claude/rules/signal-ownership.md`. In one line: a failure counter, a FAIL line or a red state may be called "known" only when it is resolved to an identity (which row/document/error) AND carries an issue number; anything new is escalated the same tick, and every nightly signal has a consumer that diffs it against the previous night.

## 5. Mechanisms (deterministic, each a contract with a T-id)
1. **T-496 failure-delta for the tick** — `scripts/ops/failure-delta.mjs` reads both slots' last cycles (read-only over ssh), resolves every failure to (ipo, docType, error class), keeps the previous set in a state file, prints NEW / GONE / SAME; a NEW entry blocks the tick line until an issue exists (the script can file it with `--file-issues`). Ticks stop printing bare counts.
2. **T-497 nightly floor delta with a consumer** — the VPS audit writes its floor output to one fixed path per night; `scripts/ops/floor-delta.mjs` prints NEW FAIL ids and NEW violation entities vs the previous night and POSTs to the Notifier; audit-to-issues goes live for NEW findings only (owner decision recorded in the brief; default proposal: live for NEW, comment-only for SAME).
3. **T-498 merged-not-deployed register** — a script lists fix commits on `main` not reachable from the latest `prod-*` tag, printed in every tick and every deploy brief ("fixed on main, still failing on prod: …").
4. **T-499 morning read as a gate** — the project SessionStart hook prints last night's floor delta and the merged-not-deployed list; a tick or a wave dispatch is refused while a NEW floor FAIL has no issue (learn-or-block shape).
5. **T-500 cause-bearing failures** — persist failures log `err.cause` (message + code); the coverage gate prints its reason before any non-zero exit (issues #402, #404).
6. **T-501 deploy timers** — the deploy cron fires 30 min before the window and the brief carries "session idle since"; the deploy step itself is a `run_in_background` command that does not depend on idleness.

## 6. Success metric
- Lag from first signal to first action on a new live defect: under one tick (30 min) for cycle-level failures, under one morning for nightly-floor findings.
- Zero "known" labels without an issue number in tick lines (mechanically checked by the failure-delta script).
