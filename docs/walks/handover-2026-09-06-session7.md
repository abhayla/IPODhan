# Handover: IPODhan session 7 (resume 2026-09-06 morning; session 6 ended 2026-09-05 ~23:05 IST after the deploy and the merge batch)

Read first: (1) this file; (2) the last 40 lines of `docs/walks/2026-09-02-deepa-pipeline-walk.md`; (3) `docs/ops/branching-model.md` (owner rule 2026-09-05: prod deploys only from `release/prod-<date>`; main never frozen); (4) `docs/walks/batch-2026-09-05-post-deploy.md` (the staging proofs to read); (5) `~/.claude/CLAUDE.md` "One deployment window per day" and "Production hosts are not test benches".

**2026-09-06 early hours: batch 2 is merged and proven; jump to the UPDATE section at the end of this file first.**

## Production (verified 2026-09-05 22:00-22:35 IST)
- **Served: d38b72aa** from `release/prod-2026-09-05` (deploy run 33975270028, tag `prod-2026-09-05`), releases prod 3 / staging 2-3, disk 59% / 41 GB free, port 3999 free, pm2 all online, no OOM since 08:38, pm2 daemon stops still 38.
- `ENABLE_FILING_AUTO_PERSIST=true` restored 21:11 (backups `scraper.env.bak-20260905-preflagrestore`, `-w137`). `ENABLE_SME_FILING_AUTO_PERSIST` NOT set on prod (owner-present flip only).
- Extraction is back after 11 h 35 m off: 22:00 cycle persisted Glass Wall Systems' price-band ad and Prasol Chemicals' DRHP + 12 MB RHP (3 financial rows) under the memory ceiling, failed 0; 22:30 cycle persisted Prasol's remaining document and LCC Projects, failed 0. Pranav Constructions' RHP is still in rotation (spawn budget 3/cycle).
- **Kanohar Electricals repaired** (owner-approved): open 2026-09-08, close 2026-09-10, listing 2026-09-16, field_sources openDate/closeDate = NSE; page shows "8 Sept 2026 / 10 Sept 2026". The first apply landed one day early (the columns are DATE and an ISO timestamp was cast under UTC) and was corrected with date literals; lesson recorded.
- Known live items: the public API URL `/api/ipos/kanohar-electricals-ltd` returned a Cloudflare 522 while the origin served 200 in 20 ms and a cache-busted URL served 200 (W-163: purge at Cloudflare or wait). `audit:data` GATE FAIL on the same pre-existing classes as 2026-09-04 (59 degenerate bands on non-FIXED_PRICE rows = the W-143 gap now on main; issue_size 0 x2; registrar pollution x2). The Playwright `test:prod-verify` sweep did NOT run (killed for laptop memory; it also starts a local Next server when targeting prod, W-164) — run it in the morning with >= 2.5 GB free. Glass Wall Systems logged one CRITICAL CONFLICT (DRHP source) at 22:00 — W-165, read it.
- Hygiene cron switched to `/bin/bash /var/www/ipodhan/current/scripts/vps-disk-hygiene.sh` (the script file is mode 664 in the release dir, W-162); first run Sunday 04:17.

## Staging / main (the next release)
- **main = 4de93a3f** (12 PRs merged tonight: #292 W-159 pytest in pr-gate; #293 D-18/D-18c; #294 W-141 release-branch gate + hook; #295 W-136b; #296 W-140/152; #297 W-158; #298 W-144/153; #299 W-143; #302 W-160; #303 W-160b; #300 W-142/139; #301 W-147/148). The staging deploy of 4de93a3f was pending at write time (the concurrency group cancels superseded runs); confirm `readlink /var/www/ipodhan/current-staging` ends 4de93a3f in the morning.
- Staging env already has all flags on incl. the SME door; it soaks the whole batch overnight.
- Every gate was green at merge except #302 (W-160), which merged with a red unit job because my merge script gated on log text instead of the watch exit code; the failure was the T-327 timezone ratchet (W-160 added `new Date(rawDateString)` chains) and #303 fixed it forward within 30 min. Lesson saved to memory (`feedback-gate-on-exit-code-not-text`).

## Staging proofs to read first tomorrow (per `batch-2026-09-05-post-deploy.md`)
1. W-136b: the 4de93a3f staging deploy log shows "probe port 3999 free after Ns" and NO "still has a listener" / "fuser -k" / "ss not found".
2. W-142/W-139: reset the Qualiance anchor row with the new CLI (`scraper/scripts/reset-document.ts --ipo qualiance-international-ltd --doc-type ANCHOR_ALLOCATION_REPORT --apply`, staging DB via the tunnel; it invalidates the cache) -> next cycle logs "Anchor allocation report extracted and persisted automatically (W-142)" or a MANUAL_REVIEW with a reason; <= 3 spawns per cycle.
3. W-147: one real SME prospectus IPO (Horizon Reclaim RHP has no sha; pick a bsesme.com PROSPECTUS row that downloads) gets `issue_size` = shares x price; an ad-backed IPO (Prasol) keeps its five headline columns byte-identical (`skipped_lower_priority_source` in the log).
4. W-160: Kanohar on STAGING still holds Dec dates; the first NSE run after the deploy must flip both to Sep 8/10 via the date-invariant escape and write a resolved conflict row.
5. W-153: `listedSkippedUnenriched` falls over the day; W-143: one CORRIGENDUM fetched for a LISTED IPO; a fixed-price SME row gets FIXED_PRICE.
6. W-159: the python job is now part of every PR gate (ran green 4 times tonight on ubuntu incl. the 60 MB trip test).

## Open rows (designs written where noted)
- W-145 exchange field (design: `docs/walks/w145-exchange-field-design.md`; Opus-sized; includes W-145c: stray `ipos.exchange` varchar not in schema.ts = drift).
- W-151 ipo_details row per persisted filing (design: `docs/walks/w151-ipo-details-row-design.md`; after W-147).
- W-161/W-161b: why the live-IPO HOLD never wrote a conflict row before W-160 (the same-source theory was contradicted by field_sources = CHITTORGARH; test `upsertConflict` against ipodhan_test with the Kanohar tuple); the caller ignores `{skipped}` (log it).
- W-157 index on document_fetch_state(ipo_id, last_attempt_at); W-162 chmod +x in the deploy or keep `/bin/bash`; W-163 Cloudflare 522 on one API URL; W-164 prod-verify starts a local server; W-165 Glass Wall CRITICAL CONFLICT; W-166 the user-level Stop-hook sweep removed a fresh worktree with zero commits (make a first commit right after wt-new until the sweep exempts young/unstarted trees); W-167 Windows-only test path building (fileURLToPath); Autofurnish table-shape miss (W-148 sibling); D-15 SME flip on prod (owner present); the two W-160b MINORs (naive `T00:00:00` strings return null; `Date.UTC` rollover on out-of-range parts).
- Older backlog unchanged: W-113/114/115/118/119/120/123/125/127b, W-81, W-110, W-105-107, W-77, W-78, W-56, W-97, W-99.

## Tomorrow (2026-09-06)
1. Morning: confirm staging on 4de93a3f; read proofs 1-6 above (read-only; resets via the W-158 CLI on the staging DB only); run the Playwright prod sweep on the laptop with >= 2.5 GB free.
2. Build W-145 and W-151 from their designs (Opus, Tier A), W-161 test, the small rows.
3. Full local pass on the integration sha (scraper vitest by directory, web alone), one push, one gate.
4. Cut `release/prod-2026-09-06` from the soaked sha, Rule 6 brief, deploy in the 21:00-23:30 window on the owner's word; D-15 flip only with the owner present. DEEPA lists 8 Sep (I5/I6).

## Rules in force (new today)
- Branching model (`docs/ops/branching-model.md`, `.claude/rules/branching-model.md`, W-141 gate): prod only from `release/prod-<date>`; the hook blocks the wrong command.
- Timestamps in the ledger are read from `date`, never estimated. IDs differ per slot: resolve rows by slug. Read the column type before a manual write (`date` vs `timestamp`). Any manual DB reset goes through `reset-document.ts` (cache invalidation) or a `redis-cli DEL documents:<ipoId>`.
- Gate on exit codes, not text. Never run Playwright on this laptop with another session open; stop leftover `headless_shell`/`next start-server` by PID. Worker briefs forbid backgrounded shell commands.
- Supervision tick every 30 min (session cron) checks worktrees, branch bases, stash, agents vs budget, prod facts.

## Session totals (2026-09-05, session 6)
Worker rounds: ~26 Sonnet, ~15 Opus, ~7.5 M tokens. GitHub: 1 prod deploy, 12 PRs, ~16 hosted gate runs, ~12 staging deploy runs. Worktrees: 13 created, all removed. Lessons saved: release-branch model, architect oversight, timestamps read not guessed, manual reset vs cache, gate on exit code.

---

## UPDATE 2026-09-06 04:24 IST (session 7 continued overnight; owner said "whatever is pending, work on it now")

**Read this section first; the sections above describe the state at 23:05 IST and are superseded where they differ.**

### main and staging now
- **main = 0127cfa9 (code 37288341)**; staging serves `20260905-224733-37288341`. Batch 2 is fully merged: #305 W-161b, #306 W-164, #307 hook fix (Stop hook wait exemption), #308 W-151, #304 W-145, #310 W-168 (+W-168b), #311 W-170, #312 W-164b (`*.mjs eol=lf`), #309 W-169 (+b/c/d/e). All worktrees removed (main checkout proven intact each time), all merged branches deleted on origin. `git worktree list` = main only.
- **Local full pass on 7146969b** (scraper by directory, web alone): scraper green in every directory (config 121, db 5, errors 5, helpers 19, module-resolution 3, pipelines 4, repositories 28, scheduler 86, scrapers 455, scripts 349+6 skipped, services 1,337+1 skipped, utils 360, root 119); web unit 2,423 passed after W-164b (the only red was the CRLF shebang import); web tsc 0; scraper tsc 89 = baseline. W-169 (merged after) touches only `scripts/deploy-linux.sh`, `scripts/tests/*.sh`, `pr-gate.yml`, so that pass stands for 37288341; the deploy suite itself is proven on ubuntu (all cases) and by the staging deploy line below.

### Staging proofs already read (so the morning does not repeat them)
- **W-136b/W-169 PROVEN**: staging deploy of 37288341 logged `==> probe port 3999 free after 1s (direct listener kill)` and no `surviving pid(s)` line (fuser -k never ran). Wart W-169f: the older WARN "…attempting fuser -k as a last resort" still prints before the direct-kill block (string only).
- **W-168 PROVEN**: 22:39Z cycle: `Anchor auto-persist summary … considered 4, spawned 1, persisted 0, manualReview 0, failed 1, anchorSpawnBudgetRemaining 0` while Lumino Industries extracted 2 / persisted 2 filings in the same cycle (filing budget not starved). Ashutosh Fibre's refusal carries `deterministic: true` (the second identical failure lands MANUAL_REVIEW).
- **W-170 parser PROVEN, persist BLOCKED**: Shanti Inorganics' real letter parsed (allocation Rs 13.44 Cr), refused by the persister guard "exceeds 60% of the QIB portion (Rs 0.26 Cr) for an issue of Rs 0.57 Cr" because the stored issue size is wrong (W-177 below). Ashutosh (parsed at 12.13 by the OLD parser at 21:25Z) has not retried yet (backoff); the W-170 parser must derive 92.
- Not yet provable tonight: W-145 (needs an NSE + BSE cycle; watch for CRITICAL CONFLICT rows on SME single-board), W-151 (`audit:coverage --gate` "details row present" counter, WARN until 2026-09-09), W-147 SME headline, W-160 Kanohar flip on staging, W-153 counters over a day, W-142 Qualiance reset via the W-158 CLI.

### New rows found overnight
- **W-177 (prod correctness, high)**: `/api/ipos` shanti-inorganics-ltd `issueSize=5691200.00` with band 79-83, lot 1600, and ashutosh-fibre-ltd 6,124,800 with band 87-92: the SHARE COUNT in the rupee column, ~80x low on live SME pages (round-7 class). Root cause (Opus Tier A, verified at the lines): the T-329 guard fired, but `data-consolidation-orchestrator.ts:440` falls back to the raw scraped value when the consolidation result has no final value, which is exactly what a rejection on a NEW row (or a NULL stored value) looks like, so the rejected share count was written through `consolidatedUpsertIPO`, the prod door under `ENABLE_DATA_CONSOLIDATION`. Round 1 (fdbf9cb5 in worktree `IPODhan-w177`) guarded the persister create/legacy paths + audit:substance floor check + tests + `docs/reviews/w177-detection-rca.md`; round 2 (612d6173) makes the orchestrator distinguish rejected from absent, sweeps the same fallback pattern, uses the real shares field; Opus round 2 MERGEABLE WITH MINORS; round 3 (9e994c24) added the sweep test and the public-path tests. **PR #313 MERGED -> main 89bb340f, soaking on staging.** The two prod rows are corrected only through the pipeline or with the owner's word (decision for the morning). Full sibling count needs the DB query (`segment='SME' AND issue_size < 1e7 AND price_range_max > 0`); the public API ignores `offset`.
- **W-176 DONE (#314 -> main 9f80109e)**: the deploy now releases `lock:resource:scraper:cycle` and `lock:resource:filing-auto-persist:cycle` right after the real `pm2 stop` (compare-and-delete on the token via EVAL, `redis-cli -t 3`, fail-safe, dry-run log-only; Opus Tier A x1 + fix round). Why it was needed: the deploy waits <= 600 s for a cycle BEFORE the build but stops the scraper AFTER it, so a cron cycle starting during the build was the one killed. Also: the 23:30Z staging deploy of the W-177 merge was REFUSED by that guard (cycle > 10 min), so W-177 reached staging only with the 9f80109e deploy. Owner item: `DSN_ASSERT_REDIS_DB` is absent from BOTH live scraper.env files (prod db 0, staging db 1 are separated only by the URL path); add =0/=1 so the step-1 slot assertion is armed.
- **W-170b DONE (#315 -> main 292d4733)**: the Total row is the blank-named ~100% row with no investor-shaped row after it; follow-up W-170c fixture (a blank-named category subtotal before the real Total; ends in a refusal).
- **W-169f DONE** in #314 (WARN now says a direct listener kill is tried first). **W-171**: Kanohar DRHP band 72/82 vs 601/632 (held, verify in the morning). W-163/W-165/W-172/W-173/W-157/W-145c/Autofurnish unchanged.

### Lessons recorded tonight (memory + ledger)
- Gate through a pipe hides the exit code (`gh pr checks --watch | tail` -> tail's 0): `set -o pipefail` + file capture, then `$?` of the gate itself (2nd occurrence of the W-160b class; memory `feedback-gate-on-exit-code-not-text` extended).
- A branch that touches validators/schemas/dates must run the root-level scraper unit files too, not only its service directory (W-145's two reds on the hosted gate).
- Linux-only harness assumptions are real and cheap to catch on the hosted job: EPIPE under pipefail, a real `ss` on ubuntu, a bare `[ -n ] &&` as a function's last line under `set -e`, `#!/usr/bin/env bash` wrappers on a PATH containing a `bash` wrapper (infinite recursion). Five W-169 rounds, all caught by the job the row itself added.
- A worker's "pre-existing/flaky" claim that contradicts a green run earlier the same night is a regression until reproduced (W-169c).
- Worker budgets: a deploy suite with real sleeps needs > 10 min on this laptop when it is memory-starved; brief 20 min for it. Laptop free memory fell to 0.7 GB at 04:00; the harness killed background waits; no heavy local runs until it recovers.
- `wt-new.ps1` gives a bare tree: create junctions (root/web/scraper) to the main checkout's node_modules AND run `cd packages/shared && npx tsc` there, or scraper tsc reports 217 instead of the 89 baseline (a worker called 217 the real baseline; it is the missing gitignored dist). `wt-rm.ps1` removes the junctions as links.
- Three workers tonight ran `git stash` against their briefs (no loss, stash count 10 throughout): prose does not hold; build a user-level PreToolUse guard denying `git stash` in worktree paths (Tier A, morning).

### Final state at the end of the overnight work (main 292d4733)
- main = batch 2 + W-164b + W-177 (#313) + W-176/W-169f (#314) + W-170b (#315); staging redeploys to 292d4733 after #315; prod untouched at d38b72aa; no worktrees; stash 10.
- Owner items: (1) repair Shanti/Ashutosh `issue_size` on prod (share count stored as rupees) or wait for the pipeline; (2) add `DSN_ASSERT_REDIS_DB=0/1` to the prod/staging scraper.env files; (3) D-15 SME flip on prod; (4) approve the `git stash` guard hook; (5) tonight's deploy window: cut `release/prod-2026-09-06` after the morning proofs and the full local pass on 292d4733.

### Tomorrow (2026-09-06), revised
1. Morning reads (read-only): the remaining proofs above; Ashutosh anchor outcome after its backoff; W-177 RCA result; the Playwright prod sweep with >= 2.5 GB free (W-164 now targets prod without a local server).
2. Fix wave (Sonnet, Tier B unless noted): W-177 root cause + substance bound + sibling sweep (Tier A: it corrects prod data via the pipeline); W-176 lock release in the deploy script (Tier A: deploy script); W-169f, W-170b small.
3. Full local pass on the new integration sha, one push, one gate; cut `release/prod-2026-09-06`; Rule 6 brief; deploy in the 21:00-23:30 window only on the owner's word. D-15 SME flip on prod only with the owner present (W-168 + W-170 are now on main, the preconditions named earlier are met once soaked).

### Session totals so far (2026-09-06 00:30-04:55 IST)
Worker rounds: ~10 Sonnet (W-168b x2, W-145 fix, W-169b x2, W-169c, W-169d, W-169e, W-170 review, W-177 RCA), 0 Opus. GitHub: 0 prod deploys, 9 PRs merged, ~14 hosted gate runs, 5 real staging deploys (superseded ones auto-cancelled). Worktrees: 8 removed, 1 created and removed (W-164b). Laptop: two background waits killed for memory.
