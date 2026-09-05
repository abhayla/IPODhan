# Handover: IPODhan session 7 (resume 2026-09-06 morning; session 6 ended 2026-09-05 ~23:05 IST after the deploy and the merge batch)

Read first: (1) this file; (2) the last 40 lines of `docs/walks/2026-09-02-deepa-pipeline-walk.md`; (3) `docs/ops/branching-model.md` (owner rule 2026-09-05: prod deploys only from `release/prod-<date>`; main never frozen); (4) `docs/walks/batch-2026-09-05-post-deploy.md` (the staging proofs to read); (5) `~/.claude/CLAUDE.md` "One deployment window per day" and "Production hosts are not test benches".

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
