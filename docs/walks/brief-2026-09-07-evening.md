# Evening deploy brief — 2026-09-07 (DRAFT, finalised at 20:30 IST)

Rule 6 brief. Status: DRAFT written 12:0x IST; numbers refreshed at 20:30 before the owner's go.

## (a) Done + proof
- Release branch `release/prod-2026-09-07` frozen at f0c66b6b (07:55 IST), full local pass; proofs 1a/1b/5 in the morning brief.
- Since the freeze, main has moved 87 commits (25 PRs merged today by 12:00). Candidates for a RE-CUT, in order of user value:
  1. Restricted scraper runs now create newly announced IPOs (#354) — prod is missing 14 of 40 calendar IPOs. Proof: the 19:00 staging read of the ~18:15 aggregator run (expect only real names, <= 6).
  2. Unknown slugs 404 instead of serving a different IPO (#355) + list tiebreakers (#370) + slug negative cache (#344).
  3. SME/FPO type and hard-date guards at every write door (#377); band-provenance tool (#379) — tools are staging-run only.
  4. Score card renders the real financial score (#378; staging proof hy-tech 5/10 read 11:0x).
  4b. Repair-tool safety (#385/#390/#393): all 11 scripts that write the IPO table now refuse prod unless explicitly allowed; 6 of them had NO guard before today. Detection: never-escalating extraction retries (#398).
  5. Audit/registry/deploy-gate work (lineage gate #353, flag liveness #352, registry per-file #375/#380/#382/#383, main gate #384 manual only).
- Persist failure (16:49-17:45 IST): Rentomojo (UPCOMING, mainboard) PRICE_BAND_AD insert into ipo_details fails on staging (2x) AND on prod's old build (3x today), cause not logged (#402) — pre-existing, so NOT a re-cut regression; prod already has 1 details row for it. Two persist-path commits merged today (#377, #365) are not in the frozen cut; a re-cut would carry them.
- Re-cut decision rule: re-cut ONLY if the 19:00 read is clean; otherwise ship f0c66b6b as frozen.

## (b) Cost so far today
- Prod deploys: 0 (window 21:00-23:30). Staging deploys: ~34 by 13:50 (one per code merge; docs commits are path-ignored).
- GitHub Actions runs: 96 (72 PR gates, 24 staging deploys). Review rounds: ~30 (Tier A on every prod-write tool; three tools needed 2-3 rounds each).
- VPS disk 57% used, 43G free; releases kept 3 prod / 3 staging. OOM 0.

## (c) Pending + what the owner will see live
- After deploy: (fill at 20:30 from the final cut) — at minimum the UPI timer hydration fix, cadence document cycle, issue_size definition (total incl. OFS) with the eight repaired rows already on prod.
- Prod data runs waiting on the owner's word (NOT part of the deploy): band-provenance backfill (#379, 87 rows), SME/FPO row repair (#377).
- Prod data repair waiting on the owner's word, separate from the deploy: 23 IPOs still show a share count as issue_size (#401; nightly floor FAIL on prod). Staging repair done: 27 considered / 21 written / 1 skipped; repair-held over 2 staging cycles: HELD (0 violations, 17:18 + 17:45 IST). Command for prod after the go: `npx tsx scraper/scripts/backfill-issue-size-chittorgarh-detail.ts --apply --allow-prod` (dry run first), then assert-repair-held --cycles 2.
- Open owner decisions: main-gate push trigger (Actions spend), Karamtara issue_size, 10 pre-existing stashes, ratchet exception #241, issue-sync go-live marker, SME flip, Actions spend for #198/#252, crontab wrapper for #348.

- Known live defect NOT in the bundle: prod RHP extraction for one IPO fails with `spawnSync nice ETIMEDOUT` (six times today, retryCount 7, never hard) — issue #396, RCA in progress; it costs cycle budget but does not block the deploy.
- Open puzzle: three tooling PRs (#381, #383, #395) were closed unmerged seconds after creation with the owner's account as actor; no closer found; reopen+merge works. Not release-related.

## (d) Recommendation
- (fill at 20:30) Default: DEPLOY the frozen f0c66b6b; RE-CUT to include #354 only on a clean 19:00 read, then one full local pass on the new cut before 21:00.

## (e) If DEFER, finish first
- Nothing outstanding on the frozen cut. A re-cut needs: 19:00 read clean + local full pass green + rollback ref f9b67d0a written in the runbook.

## Runbook (recipes section 3/4)
- `gh workflow run deploy-linux.yml --ref release/prod-2026-09-07 -f slot=prod -f ref=<sha>`; rollback `-f ref=f9b67d0a`; verify served sha, pm2 x2 online, audit:data + test:prod-verify, tag.
