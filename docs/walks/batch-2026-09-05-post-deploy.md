# Post-deploy merge batch, 2026-09-05 evening (Fable)

Precondition: production verified on release/prod-2026-09-05 (d38b72aa), flag restored, 22:00 cycle read.
Each push to main redeploys staging, so merge in ONE sitting, in this order (least to most behavioural),
one PR per branch, merge commit, pr-gate green (it now includes the python job once W-159 is in).
Total: 11 PRs, ~7,000 lines, 11 gate runs (~5 min each). Docs commits on local main (44) go with the first push.

| # | Branch | Head | Tier / review evidence | Size |
|---|---|---|---|---|
| 1 | ci/w159-pytest-in-pr-gate | 5ae90eea | A: Opus r1 + round 2 (ceiling opt-out, 60 MB trip cap); 112 pass local | 60 |
| 2 | chore/d18b-quote-rule-paths (= D-18 + D-18c) | c568c948 | C: self-check; docs/rules only | 113 |
| 3 | chore/w141-release-branch-gate | 4a8072de | A: Opus r1 + Sonnet r2 PASS; mutation 2 red | 568 |
| 4 | fix/w136b-probe-cleanup-wait | ade94864 | A: Opus r1 + built-in mutation proof; 112 PASS | 327 |
| 5 | fix/w140-extraction-lock-signal-release | 2dbfb0e6 | B: PASS WITH NOTES; 11 tests | 315 |
| 6 | feat/w158-reset-document-cli | 20748a24 | B: PASS WITH NOTES; 13 tests | 704 |
| 7 | test/w144-listed-rotation-cycles (W-144 + W-153) | c5786116 | B: PASS WITH NOTES; 42 tests | 515 |
| 8 | fix/w143-discovery-corrigendum-fixed-price | 2706966b | B: PASS WITH NOTES r1, r2 done; services 1,226 | 640 |
| 9 | fix/w142-sme-anchor-zip (W-142 + W-139) | 25a3d5ed | A: Opus r1, r2, round 3; services 1,252 | 1,554 |
| 10 | feat/w147-prospectus-offering-headline (W-147 + W-148) | 0adcf632 | A: Opus r1 + Sonnet r2 PASS; pytest 37 | 1,448 |
| 11 | fix/w160-exchange-consensus-beats-held-date | d4ad5f33 | A: Opus r1 + r2 MERGEABLE; services 1,229 | 830 |

Per PR: `git push -u origin <branch>` (once) -> `gh pr create --base main --fill --body-file <tmp>` with the
tier line + review evidence + "Generated with Claude Code" footer -> `gh pr checks --watch` (one watch) ->
`gh pr merge --merge --delete-branch`. After each merge: `git -C main pull --ff-only`; the worktree is
removed with `wt-rm.ps1` (no -Discard needed once merged) and `git status` of the main checkout is read.

Staging soak overnight on the merged main; tomorrow morning the staging proofs named in each review:
W-136b deploy log lines ("probe port 3999 free after Ns", no fuser); W-142 anchor row reset via the W-158
CLI (Qualiance) -> "Anchor allocation report extracted and persisted automatically (W-142)"; W-147 one real SME
prospectus IPO issue_size = shares x price; W-160 Kanohar flips on the first NSE run; W-153 listedSkippedUnenriched
falls over the day; W-143 one corrigendum fetched for a LISTED IPO.

Then cut release/prod-2026-09-06 from the soaked sha, brief, deploy in the 21:00-23:30 window with the owner's word.
