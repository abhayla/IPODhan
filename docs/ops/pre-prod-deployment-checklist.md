# Pre-production deployment checklist

Written 2026-09-20. Owner rule: production is not a target until staging is feature-complete
(`.claude/rules/staging-is-the-release-gate.md`). This file is the list of things to do WHEN that
day comes — it is not a signal that the day is near, and nothing on it should be run early.

Each step says why it exists, so nobody re-derives it. Most entries come from something that
already went wrong once.

---

## A. Before anything is cut

1. **Staging is feature-complete**, not merely green. The work list is
   `docs/design/pull-model-completion-state.md`; every item BUILT.
2. **The Swap Test has actually run** on staging. `check-stage3-dod.mjs --slice S4` reports
   `4 PASS, 0 FAIL, 4 SKIP` today — the four SKIPs ARE the Swap Test. Stage 3's own spec:
   *"If this test cannot be run by the supervisor with zero code edits, stage 3 is not done."*
3. **Every measurement in the deploy brief is re-taken on PROD**, never carried over from staging.
   Measured 2026-09-20: the two slots differ in size AND in shape.
   - unresolved `data_conflicts`: staging 14,141 / prod 2,220
   - genuine disagreements: staging 76 / prod 59
   - same-source junk rows: staging 12,774 / **prod 0** — prod never ran the code that wrote them
   - dominant source pair: staging CHITTORGARH-vs-MONEYCONTROL 38/76; prod exchange-vs-exchange
     (BSE-vs-CHITTORGARH 22, CHITTORGARH-vs-NSE 21), MONEYCONTROL only 5/59

   A staging number is not evidence about prod. Re-run, do not copy.

4. **Prod's migration gap is closed or explicitly accepted.** Measured earlier: prod is
   **16 migrations behind** (34 of 50), 46 drift findings, 4 missing tables. Staging has all 16.
   Applying 16 as one batch against prod's state has **never been rehearsed**.
5. **Nothing rides in unnamed.** Every open issue that ships is named and accepted in the brief
   (one-deploy-window rule R5).

## B. The cut

6. **Frozen release branch only** — `release/prod-<date>`, deployed with
   `--ref release/prod-<date> -f slot=prod -f ref=<sha>`. `main` is never frozen and feeds staging.
7. **One complete bundle**, not a partial. Every fix done, every suite green locally, the e2e proof
   run, the runbook written.
8. **Rollback plan written BEFORE the deploy**, not after.
9. **Disk checked first.** ~3.1 GB per release; refuse above 80% used. The brief prints free disk,
   release count, and when `vps-disk-hygiene.sh` last ran.

## C. The window

10. **One prod deploy per project per day**, low-traffic window (~21:00–23:30 IST). No
    "one more fix" the same day. Only a named outage overrides this.
11. **Owner is asked, with the full brief** — what is done and its proof; the cost so far; what is
    pending and what will be visible live; a DEPLOY or DEFER recommendation with reasoning.
12. **Scheduled 30 minutes early** and run by a command that does not wait for an idle session
    (signal-ownership R7).

## D. After it lands, same window

13. **Verify against the running site**, not the deploy log: served sha, process alive, smoke lines,
    the audit pair (`npm run audit:data`, which is coverage + prod audit — not `audit:prod` alone).
14. **Gate on exit codes, never on output text.** A PR once merged past a red gate because the
    script's text was read instead of its status.
15. **A fix is not fixed until it is on the prod tag AND its signal has gone** (signal-ownership R5).
    `scripts/ops/merged-not-deployed.mjs` lists fix commits on main that are not on the prod tag.
16. **Findings from prod are recorded like any other finding** — a per-entry file under
    `docs/reviews/failure-classes/`, regenerated aggregate, in the same turn they are proven. An
    issue tracks the work; the registry holds the knowledge.

## E. Data repairs against prod

17. **Never hand SQL.** A productized, source-backed, re-runnable tool with a dry-run default and a
    prod guard.
18. **Dry run on staging → apply on staging → prod only on the owner's word.**
19. **A clean read straight after a repair proves nothing.** Run
    `scripts/assert-repair-held.mjs <invariant> --cycles 2` — the question is whether it survives
    the next real scraper cycle.
20. **A backlog count is decomposed before it is quoted.** Measured 2026-09-20: 99.5% of staging's
    `data_conflicts` backlog was the writer's own historical bugs. Quote the residue, never the
    row count. See `docs/reviews/failure-classes/a-backlog-count-is-mostly-its-own-bugs.json`.

## F. Known at the time of writing — to re-check, not to trust

- Prod 16 migrations behind, 4 tables missing, unrehearsed as a batch.
- `ipos.issueSize` is the dominant real disagreement on both slots, and is the column build items
  11 (crore conversion) and 14 (#728) both touch. **Those two must not be in flight together**
  (#854).
- 74 PENDING `PROSPECTUS` documents on each slot, oldest 2026-06-16, waiting on the item-17
  closed-IPO job which is NOT STARTED (#717).
