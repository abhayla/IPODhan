# Contract 1: code fixes from the pending inventory (no data repair)

**Executor:** /goal (unattended-capable; owner may be away)   ·   **Created:** 2026-09-26
**Source list:** `docs/design/pending-inventory-2026-09-26.md` (merged in #1109, owner decisions OD-123..OD-125 in #1110).

**Mission.** Fix, in code, every open defect the inventory measured as BUILD, and prove each fix on
real staging data by READING it, never by writing it. 89 issues in six themes (T2 values, T3 documents,
T4 ops, T5 repair-tool safety, T7 web, T6 tests/CI), after a step 0 that makes the nightly detection
floor run all of its checks. Done means every one of the 89 is either DONE (merged, staging-proven,
issue closed or labelled `fixed-on-main`) or PARKED (open issue labelled `parked`, with evidence and
what is left). Row repairs, admin editing and the release-gate items belong to later contracts.

**The /goal line (paste this in a fresh window; never the bare path):**

```
/goal Fix in code every issue listed in docs/contracts/2026-09-26-contract-1-code-fixes.md (step 0 then T2, T3, T4, T5, T7, T6), proving each on staging by read-only reads, never repairing rows. Complete ONLY when the final line of docs/contracts/.run/contract-1-code-fixes-PROGRESS.md is "CONTRACT 1 COMPLETE" and every listed issue has a DONE line with its PR, staging proof and issue state, or a PARKED line with an open issue labelled parked. Reading or complying with the contract is not completion. Waiting on a staging window, a market event or the owner is neither completion nor impossibility.
```

---

## §0 Start of run (in this order)

1. **One goal session at a time (run-discipline A3).** Read the last line of every
   `docs/contracts/.run/*-PROGRESS.md` in every worktree (`git worktree list`). On 2026-09-26 all end in
   DONE / ALL ITEMS CLOSED. If any other log's last line is not a run-end line, another goal session may
   be running: write one line to `docs/contracts/.run/owner-questions-<date>.md` and stop building.
2. **Leftover worktrees.** `IPODhan-IPODhan-item32-partial` and `IPODhan-IPODhan-zip-member-rows` existed
   on 2026-09-26 from earlier runs. Do not edit or remove them. Run `wt-sweep.ps1 -Repo D:/Abhay/Ventures/IPODhan`
   in report mode and log what it says; removal of a tree that is not this run's is the owner's call.

## §0.1 Worktree isolation

Mandate kept from the hub block; mechanics are this repo's (the 2026-09-24 contract, decisions 4-11).
- **Never edit, build, test or run anything in the main checkout** `D:\Abhay\Ventures\IPODhan`. Its
  working tree lags origin/main by days; its `@ipodhan/shared` junction is shared by every worktree.
- Every change runs in its own worktree made by `~/.claude/tools/wt-new.ps1 -Repo D:/Abhay/Ventures/IPODhan
  -Name IPODhan-c1-<issue> -Branch fix/<issue>-<slug> -Purpose "<issue>: <one line>" -TtlHours 48`, and is
  removed the same session its PR merges, only by `~/.claude/tools/wt-rm.ps1 -Path <tree>` (it proves
  the main checkout's files and packages survived). Never `rm -rf`, never a bare `git worktree remove --force`.
- Read code from origin/main only: `MSYS_NO_PATHCONV=1 git show refs/remotes/origin/main:<path>` and
  `MSYS_NO_PATHCONV=1 git grep -n <pat> refs/remotes/origin/main -- <paths>`, after `git fetch -q origin main`.
- Never `git stash`, never `git checkout -- <file>` on uncommitted work, never `--no-verify`, never
  `core.hooksPath`/`HUSKY=0` (hooks block these).

## §0.2 Idempotency preflight

Before building any item:
1. Read its row in `docs/design/pending-inventory-2026-09-26.md`, then the issue (`gh issue view N --comments`),
   `gh pr list --state open --search "#N"`, and `git log refs/remotes/origin/main --oneline -E --grep "#N([^0-9]|$)"`.
2. Re-read the code the row names on origin/main. About 40 BUILD verdicts were verified twice; the rest rest
   on one reader's file:line evidence, and 5 of 53 "fixed" verdicts were overturned in pass 2. So this
   re-read is mandatory, but it is a check, not a re-triage: if the defect is already gone, record
   `SKIPPED (already fixed: <sha / reading>)`, close or label the issue per §Closing, and move on.
3. If the remaining work turns out to be a row repair only, record `MOVED TO DATA CONTRACT` and move on.

## §0.3 Progress log

`docs/contracts/.run/contract-1-code-fixes-PROGRESS.md` (gitignored). First line: slug, branch, start
time, this contract's path, the mission line. Stamp every line with `date '+%Y-%m-%d %H:%M IST'` read in
the same command (never typed). At most 2 lines per entry; types STAGE, PROGRESS, DEFECT, EVENT,
DECISION, RECOVERY, PARKED, BLOCKER, DONE. Append before moving on from each event. The final line is
exactly `CONTRACT 1 COMPLETE`, written only when the DoD below holds.

## Scope boundary

- **In scope:** code under `scraper/`, `packages/shared/`, `web/`, `scripts/`, `.github/workflows/`,
  `docs/` (ledger, findings, failure-class registry), `scraper/config/`.
- **Goal type:** bug-fix loop (defect-fix contract per item).
- **OUT of scope, hard:**
  - **Any data repair.** No repair tool run with `--apply`, no backfill, no `UPDATE`/`INSERT`/`DELETE`
    issued by hand or by a one-off script against `ipodhan_staging` or production. A repair tool may be
    BUILT or hardened and run in its default dry-run mode only; attach the dry-run output to the item's
    issue for the later data contract. The normal scraper and jobs, running on their own schedule on
    staging with the merged code, are the product working, not a repair.
  - Production: no deploy, no release branch, no prod writes, no prod DB reads beyond the facts collector.
  - The VPS: no config change, no ad-hoc run (production-host rule). Read state only (logs, `pm2 status`, `df`).
  - Item 36 admin editing (#1108), #787, item 7's remainder, Swap Test path 2, S6 floor wiring,
    board-from-data: contract 2.
  - Row-repair items moved to the data contract: #696, #453, #561, #212, #684, #598, #472, #1002, #241,
    #94 (rows; its substance check is in scope only if it is code), #97 (seed rows), and applying OD-123.
  - Anything labelled `parked`, `fixed-on-main` (already fixed), and global tooling (#607, #613).

## Context to read first

- `docs/design/pending-inventory-2026-09-26.md`: the source list, with evidence per issue.
- `docs/design/data-sourcing-pull-model.md` (the SSOT spec; decision log §0.0.1). Grep it by every key
  term of an item before designing the fix (`~/.claude/rules/spec-first.md`).
- `docs/design/findings.json` (F-ids) and `docs/reviews/failure-classes/` (one JSON per class).
- `.claude/rules/defect-fix-contract.md` (the six items every fix carries), `.claude/rules/staging-is-the-release-gate.md`,
  `.claude/rules/signal-ownership.md`, `.claude/rules/ist-timezone.md` (bind rules for timestamps),
  `.claude/rules/recurrence-detection-gate.md` (scraper write paths need a detection change or the exact line).
- `docs/ops/prod-ops-recipes.md` (staging read recipes, §14 staging windows and the manual button).
- `docs/contracts/2026-09-24-finish-pending-build-items.md` (decisions 2-11: brief lines, tiers, merges).
- `~/.claude/rules/run-discipline.md` (park, no pop-up questions, batch docs PRs, local CI before push).

## Pre-made design decisions (the run must NOT pause on these)

1. **Order:** step 0, then T2, T3, T4, T5, T7, T6 (owner, 2026-09-26: issues before admin editing; code
   only). Within a theme, cheapest proof first. An item blocked on another item waits; the run takes the
   next one.
2. **Step 0 is the nightly floor.** On 2026-09-25 the floor delta reported 13 checks MISSING
   (`d_corporate_action_shape, d_lot_band_window, d_segment_provenance, e_route_sweep, e_unknown_slug_404,
   e_verdict_leak_sweep, f_conflict_noise_ratio, g_freshness_per_type, g_repeated_warn, h_pm2_env_tz,
   i_ipo_title_in_name, i_same_ipo_two_rows, i_wire_or_retire`). Find why each did not run
   (`scripts/audit-detection-floor.mjs`, `scripts/ops/floor-delta.mjs`, the VPS cron log, read only) and
   fix the code so every registered check runs every night. Done when one real nightly floor run on
   staging reports NEW/GONE/SAME with MISSING (0). If the cause is host configuration, not code, PARK it
   with the evidence and continue with T2.
3. **One defect = one issue = one PR**, unless two issues are the same class (then one PR naming both).
   Same class groups already known: #394 + #343 + #73 (sector writer); #70 + #72 + #36 (listing date and
   performance); #932 + #777 (stage-change re-pick); #502 + #503 (risk factors); #507 + #616 + #681
   (tests CI never runs); #634 + #676 (document state columns).
4. **Builders:** at most 2 at once, never on the same files. Sonnet by default; Opus only with a
   `Why Opus: <reason>` line (fuzzy spec, multi-file, shared write path). Every brief carries, as in the
   2026-09-24 contract: `Budget: <N> min wall-clock, <M> tool calls`, `Report: evidence-table`,
   `Class:` and `Proof:` lines (defect-fix contract), the spec section it implements, the reviewer's
   checklist (run-discipline B4), and "never modify the main checkout".
5. **Review tier by blast radius:** Tier A (fresh Opus, adversarial) for shared write paths
   (`data-consolidation-*`, `field-plan-walk*`, `filing-persister`, `ipo-repository`), migrations,
   deploy scripts and anything touching auth; Tier B (Sonnet, diff-only) for ordinary code; Tier C (no
   review) for docs and test-only CI wiring. At most 2 review rounds, then PARK (A1).
6. **Local CI before every push (B3):** in the item's worktree, run the checks CI will run for the
   touched trees: `cd web && npm run lint:ci && npx tsc --noEmit` for web; `cd scraper && npx vitest run
   <touched tests>` and `npm run type-check:scripts` for scraper; `node --test scripts/tests/<file>.test.mjs`
   for scripts; `npm run docs:verify` for docs. Install/test output goes to a log file, tail only.
   A new file under `scripts/tests/` must be named in `.github/workflows/pr-gate.yml`, or CI never runs it.
7. **Generated files stay out of feature PRs (B2).** Board pages, rules.json and registry aggregates are
   regenerated in the batched docs PR, except when the change itself requires them (a new OD row or
   registry entry), as in #1107/#1110.
8. **Merges:** only `node scripts/ops/merge-if-current.mjs <PR> > /dev/null 2>&1 && gh pr merge <PR> --squash`.
   Always `&&`, never `;` (a hook refuses `;`). Zero CI runs on a PR means CONFLICTING: rebase it.
9. **Staging proof, read only.** A merged fix reaches staging through the VPS cron windows (13:30 and
   21:30 IST) or `scripts/ops/deploy-staging-now.sh` (cap 2 per day, each with a logged reason).
   Proof = a scraper-cycle log line naming the counter that moved, or a read-only query on
   `ipodhan_staging` through the tunnel (`bash scripts/ops/db-tunnel.sh start`; standing approval of
   2026-07-02; stop it with `bash scripts/ops/db-tunnel.sh stop` when no read is pending). Every query
   session sets `default_transaction_read_only=on` and `timezone=UTC` and checks `current_database() =
   'ipodhan_staging'` before running. A proof must be able to fail: assert the exact value, not "changed".
10. **Closing (signal-ownership R5):** a fix that never reaches production (tests, CI, dev tooling) is
    closed with its PR and proof. Every other fix gets the label `fixed-on-main` and a comment with its
    PR and staging reading; the first release closes it. Never close on a merge alone.
11. **Owner delegation (OD-95, in force since 2026-09-24):** where you would ask the owner, take your
    own recommendation if it conforms to `docs/design/data-sourcing-pull-model.md`; record it as an OD
    row with the quote *"owner delegation 2026-09-24: go with the recommendation if it conforms to the
    spec"* and a DECISION line. A SPEC CHANGE, a new product behaviour the spec does not cover, a row
    repair, production, a VPS change and anything destructive are NOT delegated: write them to
    `docs/contracts/.run/owner-questions-<date>.md` with a recommendation and a `Spec basis:` line, and
    continue with the next item. Never call AskUserQuestion (run-discipline A2).
12. **Findings and ledger (spec-first R6, B5):** every proven finding goes into `docs/design/findings.json`
    (next free F-id, after F-177) with a citing line in the spec, and every defect class into
    `docs/reviews/failure-classes/<slug>.json`, batched into one docs PR per theme, not per item.
13. **Board:** republish `docs/design/board/index.html` to the board URL only when a stage crosses
    (owner-status-artifact R4); an ordinary merge is not a stage change. When the `board-owed-guard`
    hook asks and no stage crossed, clear its marker with the reason.
14. **Time:** every human-read time is IST; every stored time is UTC (ist-timezone rule). A fix that
    binds a timestamp follows that rule's split (raw pg parameter: ISO string; drizzle column: `Date`).

## The PARK rule (run-discipline A1)

PARK an item as soon as: (a) two fix or review rounds failed; (b) its proof needs a real-world event
(an IPO opening, a new prospectus, a real duplicate) that has not happened within 2 working days of the
code reaching staging; (c) it is blocked by something outside this contract; (d) its only remaining
work is a row repair. Parking = in the same turn: label the issue `parked` with the evidence and what is
left, a `PARKED (#N): <what is left>` line in PROGRESS, and move on. Never retry a parked item.

## Stages

### Step 0: the nightly floor runs every check
- **Do:** decision 2.
- **Acceptance:** the next nightly floor on staging reports `MISSING (0)` and a NEW/GONE/SAME delta
  (read with `node scripts/ops/floor-delta.mjs`), recorded in PROGRESS with the run date; or the item is
  PARKED with the host-side cause.

### Per item (T2, T3, T4, T5, T7, T6 in that order)
- **Do:** §0.2 preflight; brief a builder (decision 4) with the six defect-fix items (RCA, Class, failing
  test first on the real function, class-level fix, retest + one real-data proof, detection upgrade or
  the exact line `No detection change: <reason of 20+ chars>`); supervisor re-runs the builder's gate
  (supervisor-verification); review per decision 5; local CI (decision 6); PR; merge (decision 8);
  staging proof (decision 9); close or label (decision 10); remove the worktree.
- **Acceptance:** a PROGRESS line `DONE #N PR #P proof: <the reading with identities and exact values>
  issue: closed|fixed-on-main`, or `PARKED (#N): ...`, or `SKIPPED (already fixed: ...)`, or
  `MOVED TO DATA CONTRACT (#N)`.

## The 89 issues

The "what is left" column is the inventory's measured text; the run re-reads it on origin/main first
(§0.2). "MEASURE FIRST" rows have an unknown verdict: measure, then fix or skip.

### T2 Wrong or missing values: fix the WRITER, never the rows (19)

| Issue | What is left (from the inventory; re-read on origin/main before building) | Size |
|---|---|---|
| #394 ipos.sector is an empty string on every row (prod and staging) — sect… | Spec field 13 = DOC then CG. Staging 2026-09-26: sector empty/null on 369 of 390 ipos rows. Same class as #343, #73. |  |
| #343 sector has no live source after #339: build a real sector writer (Chi… | Directly conforms to spec's own source ordering for field 13; not yet built (0/251 sector coverage per the issue). | M |
| #73 #69 residual: deterministic sector VALUE source (matrix entry shipped… | Either confirm NSE truly cannot supply sector in prod, or fix the CHITTORGARH/company_description extractor so its 163 sourced rows actually write a sector value. | M |
| #70 Systemic: 142/167 (85%) genuine IPOs stuck at status=CLOSED with null… | A reconciliation job that fetches listing_date/listing_price for old CLOSED IPOs and advances status; plus the gate assertion the issue proposes. | M |
| #72 #70 residual: extend CLOSED→LISTED listing coverage (older FYs + null… | The suggested pacing/retry + null-identifier resolution was never added; residual 105/147 rows still uncovered. | M |
| #36 B1: listing_performance 0/91 — NSE past-issues feed lacks listing pri… | No commit closes #36; the NSE past-issues feed still lacks listing-day price and no SME listing source was added, so the 0/91 defect is presumably still live. | M |
| #938 listing_exchanges wrong for the NSE IPO: stored [BSE, NSE], lists on … | Find the writer that added NSE to this row's listing_exchanges (field_sources for listingExchanges — not read this session) and correct it; OD-64's exchange-ranking logic is affected while it stands. | S |
| #454 An IPO row can carry a published issue size with zero field_sources r… | Identify and close the write path that skips field_sources for issue_size; add the nightly floor check the issue proposes; backfill or flag the 11 existing rows. | M |
| #349 Live pipeline did not refresh Karamtara's issue_size after the issuer… | Karamtara's issue_size row was hand-repaired (staging now shows 8,750,000,000 = correct 875 Cr, confirmed this session) but the requested class-level detection check (c_upcoming_source_drift) for the NEXT issuer revision was not … | M |
| #963 parseNSEDate turns a missing NSE date into today's date, so a dateles… | Confirmed unfixed on main: a missing/unparseable NSE date is still converted to today's date rather than staying null/absent. | M |
| #951 Consolidated IPO save writes fields the caller never claimed (overwri… | The general defect (a partial-payload write also overwrites listingExchanges/segment/lastScrapedAt) is proven and unfixed at the shared-path level; risk to every dual-listed IPO remains. | M |
| #1074 leadManagers field_sources upsert targets 3 columns but the unique ke… | Directly verified in the current file: the ON CONFLICT target omits row_key, so this upsert will throw 42P10 whenever it runs (unmeasured whether it's dead code, per the issue itself). | M |
| #721 Lot-size Rule 9 (exact SEBI window) never fires for payloads without … | BSE payloads with segment:undefined still skip the exact-window check at write time; only the nightly d_lot_band_window floor catches it a day later, exactly as the issue describes. | M |
| #928 OD-69 CIN differ: same name+slug, different CIN silently fails create… | The decline-then-silent-create-failure mechanism described in the issue is still present; no real case has been observed on prod/staging yet (per the issue itself), so this is a known, unconfirmed gap conforming to the spec's own… | M |
| #903 IPO identity: stop the same IPO becoming two rows, and stop two offer… | Multi-scenario identity rework (S1-S7). Confirmed landed: OD-34/OD-69 CIN-first binding (#925), OD-68 decorated-name matching + merge refusal (#910), nightly duplicate/split detection (#906). NOT confirmed landed on main: full S1… | M |
| #553 STAGING: duplicate IPO rows on ipodhan_staging - the unbound copy has… | Identify and fix the document pipeline gap for the 2 remaining OPEN IPOs with no details row. | S |
| #356 NSE/BSE discovery (unrestricted, 4x/day) did not create Karamtara Eng… | No fix or investigation-closing commit found; the root cause (budget/lock starvation vs source-side gap) is still unestablished on main. | M |
| #222 backlog: wire ipo_details.issue_type writer (Chittorgarh detail-page … | Conforms to spec (CG is a named source for issue_type) and is not built — this is an enhancement filling a gap the spec already sanctions. | M |
| #818 Admin queue is 28,120 open items across 268 IPOs — above what one per… | The reporting mechanism (item 35) is built and wired; the actual pipeline defect #818 asks for (draining abstention/non-disagreement classes so the number is human-sized) is explicitly tracked as still open and, if anything, has … | M |

### T3 Document pipeline: fetch, extract, retry (20)

| Issue | What is left (from the inventory; re-read on origin/main before building) | Size |
|---|---|---|
| #632 Nightly floor m_blocked_all_age: four documents BLOCKED_ALL for up to… | Staging 2026-09-26: 460 document_fetch_state rows are BLOCKED_ALL across 103 real IPOs (offering_type IPO), 339 blocked for more than 7 days; live IPOs include 20 with RHP and 19 with DRHP blocked. Needs the per-row cause read an… | M |
| #583 Recurrence of #396: spawnSync nice ETIMEDOUT, now hard-blocked at ret… | Root-cause the spawnSync ETIMEDOUT under nice (resource contention) and give blocked documents a real recovery path other than a version-string bump. | M |
| #1046 OCR step crashes deterministically (rapidocr ONNXRuntimeError 'infere… | Deferred, not parked: OCR crash root cause unmeasured; needs a local repro first. | M |
| #620 Document step never drains its queue: budgetExhausted on every prod c… | The issue itself states the fix (item 7) exists but is unmerged pending an owner decision, and no commit references #620 directly — so the budget-exhaustion defect is still live on main. | M |
| #545 staging: RHP and DRHP extraction writes no promoters and no peer_comp… | Confirmed-real defect (extractor gap), matches the pull model's own item 8 requirement, and the only merged commit about it is documentation recording the evidence, not a fix. | M |
| #606 Peer table: a two-level header maps child columns by the LABEL's inde… | The issue states a failing test is already committed (PR #605, xfail(strict=True) on PRASOLCHEM) and the fix direction is not yet implemented; current code confirms the signature is still headers-only. | M |
| #502 Extractor emits duplicate risk-factor rows with empty bodies (14 surp… | No commit directly closes #502; the keying-by-heading fix (#513) may or may not also eliminate the empty-body duplicate rows — unconfirmed, treat as still open. | M |
| #503 Table rows are being scraped into ipo_risk_factors.heading (prasol-ch… | This is a genuine extractor defect (table cells concatenated into a risk-factor heading) that the issue itself scoped as needing its own slice with a real fixture; nothing found addressing it. | M |
| #347 Anchor allocation report rejected: printed % vs computed share disagr… | Real defect (a report with one investor across multiple rows fails a per-row % check and the whole valid report is dropped) with a clear, still-unimplemented fix plan. | M |
| #409 anchor-deterministic-refusal: Kanohar Electricals Limited (staging) | Diagnose why the anchor-allocation extractor refuses this document deterministically and fix or accept as a genuine no-anchor-investors case. | S |
| #771 issuer_ratio_yield FAIL: 6 of 6 prospectus-family documents extracted… | Re-run extraction (or backfill) for the 6 named documents against the wired financial_ratios reader on staging, and add a reason-code column/mechanism so a genuine absence is distinguishable from a bug; re-verify current_ratio is… | M |
| #634 A retry loop that discards its own failure causes: ten attempts retai… | Schema is unchanged from the issue's description: extraction_error remains a single column overwritten each attempt, and ipo_pipeline_steps still keeps one row per step not per attempt, so the retry-cause-discarding class is stil… | M |
| #676 extraction_status enum and documents.extraction_status values have dr… | The exact drift described (declared enum, commented values, and actually-written values are three different sets) is unchanged on origin/main. | M |
| #959 Extraction-failure backoff is a timed re-read of a stored document (f… | The exact timer mechanism the issue names is still present and wired on main; contradicts the spec's explicit 'never on a backoff timer' rule (§2.5.1). | M |
| #365 capture a real NSE OFS payload and verify the parse before enabling o… | The exact follow-up action named by the referencing commit has not been done; flag is still off pending the live-payload capture this issue asks for. | M |
| #932 Closed-IPO job: a stage change is inferred from listing_date, so a la… | OD-78/OD-81: a PARTIAL IPO is re-picked on a real stage change; inferring the stage from listing_date misses a late status flip. #777 folds in. |  |
| #777 S5 note: the claim query's re-open trigger was already broken when it… | Folded into #932 (same re-open trigger). |  |
| #648 F-101 residual: a writer that keys every provenance row '' is indisti… | Technical detection design; decided in the goal (Claude), not an owner fork. |  |
| #695 report-82 reader: FY2026-27 returns the identical page for every page… | Add the 'stop when a page adds zero new rows after dedup' check (keep the 200-page ceiling as a last-resort fallback), a red-first test with a same-page-every-number stub asserting the walk ends at page 2, and remove the #692 rep… | S |
| #933 Document PDFs outlive OD-32's retention: RHP read 2026-09-11 still on… | MEASURE FIRST (verdict unknown): Needs a read of the staging document store on the VPS (read-only ls) to see whether OD-32 retention removed the file. |  |

### T4 Scheduler, deploy and ops safety (13)

| Issue | What is left (from the inventory; re-read on origin/main before building) | Size |
|---|---|---|
| #624 A deploy kills the running scraper cycle and later wakes exit on the … | No code change addresses a deploy's SIGINT killing an in-flight cycle then leaving the Redis lock held for the next wake to bounce off of. | M |
| #348 Nightly audit cron runs the PREVIOUS night's script: bash parses run_… | The recommended fix (a thin wrapper outside the repo on the VPS) has not been built — the script comment documents the defect but the mechanism is unchanged. | M |
| #707 scraper-wake: no detection for repeated wake-skipped lines (stale loc… | #707 explicitly says 'not a blocker for #660' and asks for a narrower, additional signal (consecutive skip-count) than the freshness check that was later built for #663; that narrower check is still missing. | M |
| #698 assert-repair-held counts every scraper start as a cycle: three deplo… | The exact mechanism described (deploy restart moves the same markers as a scheduled cycle) is unchanged in the current script on main. | M |
| #151 prod+staging share one Redis instance with no slot-namespaced cache k… | Confirmed on main: no slot/environment prefix in cache keys, matching the issue's described cross-slot pollution mechanism exactly. | M |
| #752 deploy-config.sh: three pre-existing holes in repo-root/lineage resol… | F6 (no repo-identity check via remote get-url) is confirmed still absent. F5 (GIT_DIR bypass) and F7 (SKIP_FETCH prod refusal) were not conclusively re-checked line-by-line this session — treating the whole issue as still open si… | M |
| #568 C:/Program Files/Git/api/version is edge-cached for a year, so every … | The route still relies on Next's static/CDN caching with no explicit no-cache header, so a public-URL sha read can still be a year-stale edge hit. | M |
| #640 A script that forgets DATABASE_NAME connects to PRODUCTION, silently,… | The exact unsafe fallback (missing DATABASE_NAME silently defaults to prod db name, as the postgres superuser) is still present verbatim; a related PR (#643, #640-referencing) fixed a different script (persist-filing.ts) refusing… | M |
| #481 openRepairDb times out anonymously when only DATABASE_URL is set — in… | The exact code path described (initPool ignoring a lone DATABASE_URL, no named cause in the error) is still present verbatim. | M |
| #240 Decide: retire or fix the dead API_FALLBACK scraper source (round-7 P… | Retire it: API_FALLBACK is not a source in the spec (0 hits) and not a walk fetcher; scraper/src/index.ts still references it 4 times. |  |
| #881 Windows-era tooling: retire the .ps1 scripts and their runbooks toget… | Retire the Windows-era .ps1 scripts + runbooks: CLAUDE.md records the Windows deploy path as retired. |  |
| #630 unattended-upgrades restarts the self-hosted Actions runner mid-deplo… | Repo-side half only (the VPS half is DONE, ops recipe 16): at deploy start, remove orphan half-built release dirs and orphan build processes that a killed deploy-linux.sh EXIT trap left behind. | S |
| #719 Staging wake wrapper cannot read the Redis cycle lock TTL and proceed… | MEASURE FIRST (verdict unknown): Read /var/log/ipodhan-scraper-wake-staging.log on staging for 'lock-read-unavailable' lines today (owner-run, via the sanctioned ops recipe) and compare the daily count against the issue's 17/17 b… | S |

### T5 Repair-tool safety (code only; never --apply) (7)

| Issue | What is left (from the inventory; re-read on origin/main before building) | Size |
|---|---|---|
| #386 Migrate the 25 pre-T-490 repair/backfill tools onto scripts/lib/repai… | 16 of 25 exempted repair tools still lack the shared guard module; ongoing migration backlog, not complete. | M |
| #422 repair-source-trust-batch-t292: hard-coded corrections are stale — wo… | The proposed fix (skip a correction when row is LISTED/CLOSED or citation is stale) is not present in the tool; still able to null real dates on a live row. | M |
| #457 Repair ledgers record which rows changed but not what they held — a c… | backfill-normalized-name.ts-style ledgers (changedIds only, no before-value) remain a real rollback-artifact gap for the next repair tool with varied prior values. | M |
| #671 refresh-registrar-urls-t300.ts writes registrars under --apply with n… | File still carries the bare exemption comment and no openRepairDb/--expect-db/ledger guard has been added. | M |
| #1051 Two more ungated ipos-row delete paths (name-pollution repair loser m… | Both named ungated delete paths are still present verbatim on origin/main; the issue is an accurate, current read of the code. | M |
| #715 Repair tools fall back to localhost:6379 for cache invalidation when … | Finish open PR #1070 (fail-closed cache invalidation when no Redis target), then merge through the gate. | M |
| #1054 repair-issue-size-od74 integration test may hit the same DB-wide test… | Finish open PR #1059 (--ipo scope for the OD-74 repair tool), then merge through the gate. Code only: the tool is never run with --apply. | M |

### T7 Reader-facing web (7)

| Issue | What is left (from the inventory; re-read on origin/main before building) | Size |
|---|---|---|
| #57 Home page IPO tables not wrapped in AsyncErrorBoundary (temp-disabled… | Defect in existing behaviour (no error-boundary resilience on the home page) still present; not fixed. | M |
| #98 Landing summary metrics are FABRICATED (60/40 gain split, 25%/15% har… | Build the real AVG/count aggregate from listing_performance and render actual gain/loss cards instead of nulls, per the issue's own 'Fix shipped... (interim)' section. | S |
| #975 web: freeze a DELISTED IPO page with a notice (OD-38 -> OD-8 mechanis… | No DELISTED-specific freeze/notice handling exists in the web layer on main; the label-only display the issue describes appears unchanged. | M |
| #983 Delisting detection for the post-listing price job (split from #972) | Directly conforms to and extends an existing owner decision (OD-38); not yet built, and the owner already approved splitting it out as its own item. | M |
| #551 three modules invalidate IPO caches and each clears a different, part… | Consolidation into one injectable, correctly-keyed module not yet done; author explicitly marks it non-urgent debt. | M |
| #58 Mainboard 'Recently Listed' cards don't show listing-gain % (generic … | Build OD-124: a LISTED IPO card shows its listing gain % (signed, colour-coded); blank when missing, never 0%. Un-skip MainboardContentSections.test.tsx "should show gain/loss percentages for listed IPOs". | S |
| #167 Populate IPO Reviews/Scores/Anchor Investors feature (currently de-na… | Build OD-125: retire the empty review pages/routes (mainboard + SME review lists, sitemap entries) and the never-invoked review scraper/repository path; reconcile the score widget scale with the live API (0-25 vs 0-10). Anchors s… | M |

### T6 Tests and CI coverage (23)

| Issue | What is left (from the inventory; re-read on origin/main before building) | Size |
|---|---|---|
| #109 42 pre-existing failing unit tests in 8 files (found by the installed… | Files still exist and no fix-loop / test-repair commit citing #109 was found in the log; treated as still-open pending a real test run, which this triage could not perform. | M |
| #252 scraper integration tier is broken on main (12 files fail against an … | Partial progress (DB service added, 2/12 files repaired) but the issue's core ask — a deterministic 4-IPO seed fixture plus skip-with-reason for the rest — is not evidenced on main. | M |
| #507 11 of 17 scraper integration tests run nowhere — pr-gate's integratio… | Partial: 2 of 11 orphaned files wired in, but item 1 of the fix (self-checking coverage test) and the remaining 9 files (including the company-name-normalizer-agreement test, called out as most urgent) are not evidenced as done. | M |
| #575 phase-1-e2e.test.ts fails: all 5 cases; test IPO ids are not UUIDs | Fixture ids like 'test-ipo-e2e-001' still don't match the uuid column; the only end-to-end consolidation test remains broken/uncovered by CI. | M |
| #616 28 of 51 test files under scripts/tests/ are never run by CI - they p… | The repo's own PR-gate comment confirms the systemic per-file-listing gap named in #616 is still open and was deliberately deferred; individual new tests get wired ad hoc but no glob/manifest mechanism exists. | M |
| #681 23 scripts/tests files are named by no workflow and never run in CI (… | Only a 3-file subset (the #687 family) was wired by a different PR; the general 23-file class this issue names remains unaddressed. | M |
| #832 The web-integration baseline still has 25 entries, and the owner's re… | The baseline count on main today is still exactly 25, matching the issue precisely; no commit reduces it. | M |
| #754 data-consolidation-document-outranks-websites.test.ts (T-520) asserts… | The exact vacuous-pass literals named in the issue are still present unchanged. | M |
| #631 101 optional members across 8 *Deps interfaces — the compiler cannot … | #625 fixed the one instance that was caught by a live-data query; the generalized enumerating-test helper for the other 100 optional members across 7 more interfaces has not been built. | M |
| #635 'redis as never' in filing-persist-deps hides a dual-package Redis ty… | The exact cast the issue flags is still on main, unchanged, on the now-live consolidation write path. | M |
| #392 Pre-existing: importing @ipodhan/shared/db together with a src/utils … | No fix found on main; the dual-entry-point ESM resolution hazard as described is a real repro-able defect affecting scraper/scripts tooling reliability. | M |
| #434 scraper/scripts: 23 legacy tools excluded from the new type-check gat… | Exclude list confirmed non-empty on main; the gate still leaves 21 files unchecked. | M |
| #890 scraper/src has 22 type errors no CI job sees; the scripts type-check… | The 22 errors were fixed (34c1e10f) but CI still type-checks only web/ and scraper/scripts; scraper/src has no direct gate (pr-gate.yml:664-679). |  |
| #886 drizzle's snapshot chain is BROKEN at 0050: the next generated migrat… | The specific naming-scheme collision described (0050_bright_power_man sorting before timestamp-named snapshots) has not been repaired — the file is still there unrenamed, and no second snapshot-chain fix commit exists. | M |
| #501 Migration journal has two idx/when pairs running backwards in time (#… | A monotonicity guard for NEW journal entries (excluding the two named historic pairs) is proposed but not confirmed built; low urgency (nothing mis-applied today) per the issue itself. | M |
| #665 audit:schema-drift compares columns only; hand-applied indexes and co… | assert-schema-drift.ts now HAS a checkUniqueConstraints()/checkIndexes() pass (added since the issue was filed), but it only compares constraints/indexes schema.ts DECLARES against the live DB (one-directional) — an extra live ar… | M |
| #196 G-K: standing mutation job — a guard that survives deletion with a gr… | The exact requested artifact (a weekly mutation-guard-sweep.sh with the seeded GUARDS registry) does not exist on main. | M |
| #195 G-J: alert-channel quality — standing signal:noise measurement + synt… | The two named mechanisms (J1 weekly noise-ratio assert, J2 synthetic drill proving the notify path is alive) are still absent; this is a good, well-specified standing-monitoring feature not covered by the pull-model spec. | M |
| #469 Design traceability mode 1: a card can drop a rule it implements and … | The issue's own text says this is 'not urgent' and defers to a future slice; code confirms mode 1 still uses ANY-card semantics, so a card can drop a rule it owns and stay green if another card merely mentions it. | M |
| #258 Stage-isolated test harness for the IPO pipeline (stages 0-9) | Stages 0, 5-9 have merged harness parts; the issue's own table also listed stages 1 (partial), 2-4 (unmerged T-403 branch) and 6 (NO) as not done — those stages are not covered by the two merged PRs, so the full 0-9 ask is only p… | M |
| #1106 20 build cards have a hand-written rules block with no generator mark… | Batch policy for the 20 hand-written card rule blocks; Claude decides (tooling). |  |
| #819 a_b_min_application FAIL 2026-09-20 is NEW: #736's NULL-segment cause… | Run the audit's own oracle fetch (node scripts/audit-detection-floor.mjs) against staging to find today's failing identity, per the issue's own stated next step. | S |
| #573 bse-scraper.integration.test.ts fails: 3 'Data Discrepancy Handling' … | MEASURE FIRST (verdict unknown): Run `cd scraper && npx vitest run tests/integration/bse-scraper.integration.test.ts` to confirm current pass/fail, then either fix the test's expectations or the merge logic, and add the file to p… | S |

## Verification gates

All global rules in `.claude/rules/` and `~/.claude/rules/` are operative. Test by blast radius of the
changed surface; placement per `testing.md` / `e2e-best-practices.md`.

| Gate | Rule (loads transitively) | What it gates | Fires when |
|---|---|---|---|
| Supervisor verification | `supervisor-verification.md` | Re-run the builder's claimed gate; read the diff for scope creep; for UI, drive the page (screenshot, ARIA, console, interact) | every builder return; UI rows for T7 and #57/#98 |
| Blind test verification | `independent-test-verification.md` | A test verdict is re-checked by a separate context-blind agent | any test verdict |
| Output plausibility | `output-plausibility-verification.md` | A value a reader sees is domain-sane on the default path (e.g. an issue size is rupees, not a share count) | T2 and T7 items |
| Persistence verification | `e2e-persistence-verification.md` | A write actually landed: a read-only re-read of the row on staging after the cycle that wrote it | any fix to a write path |
| Bug-triage discipline | `bug-triage-discipline.md` | "Why was this missed?" plus a repo-wide sibling-class audit before close | every item |
| Defect-fix contract | `.claude/rules/defect-fix-contract.md` | RCA, Class, failing test first, class fix, real-data proof, detection | every item |
| Static gates | decision 6 | lint, type-check, unit tests green for every touched tree | every code change |

Evidence handoff: screenshots from browser tools may land in the session's primary directory; copy
them into the item's worktree evidence folder and `ls` them before a blind verifier reads them.

## Failure-recovery budget

- **Per item:** 2 fix or review rounds, then PARK (overrides the hub's 15-attempt budget; owner rule
  A1). A second red of the same class after one fix round gets an independent reviewer first (global
  rule "second occurrence = independent review"), then the third round is built around its findings.
- **Tool hangs:** 3 recovery cycles (wait and retry; restart the tool; restart the process by PID),
  then PARK the item and continue. Never kill a process by a pattern that matches your own command line.
- **Hard halt ONLY for:** a missing credential, an OS permission denial, a contradiction inside this
  contract, or the main checkout's files or packages changing (a `wt-rm.ps1` proof mismatch). Context
  size is not a halt: write a continuation note in PROGRESS and keep going.

## Commit and push policy

- **Granularity:** one PR per item or per same-class group (decision 3); docs batched per theme (B5).
- **Messages:** Conventional Commits; the PR body carries motivation, approach, test plan, the
  `Spec deviation` block, `Class:` and `Proof:` lines, and the detection change or the exact
  `No detection change: <reason>` line (the recurrence gate reads the PR body at run time).
- **Branches:** `fix/<issue>-<slug>` from origin/main in its own worktree; merge to `main` only through
  decision 8. Never push to `main` directly.
- **Do not stage:** `docs/contracts/.run/`, `scraper/scripts/state/`, `scripts/state/`, any `.env*`,
  `scripts/fix-test-category-fields.ps1`, or generated aggregates outside decision 7.

## Definition of Done (verbs are load-bearing)

- [ ] **Step 0:** a nightly floor run on staging after the fix reports `MISSING (0)`, read from
      `floor-delta.mjs` and recorded in PROGRESS; or step 0 is PARKED with its host-side cause.
- [ ] **Every one of the 89 issues listed above** has exactly one terminal PROGRESS line: `DONE` (PR
      merged, staging proof with identities and exact values, issue closed or labelled `fixed-on-main`),
      `PARKED` (issue labelled `parked` with evidence), `SKIPPED (already fixed: ...)`, or
      `MOVED TO DATA CONTRACT`. A representative sample does not satisfy this line; all 89 do.
- [ ] Every DONE fix to a write path shows a staging read of a row written after the fix reached staging.
- [ ] No row on `ipodhan_staging` or production was changed by a repair, backfill or hand edit during
      the run (the PROGRESS log records every tunnel session as read-only).
- [ ] Findings and failure classes from the run are in `findings.json` and `docs/reviews/failure-classes/`,
      merged in batched docs PRs.
- [ ] The data-contract hand-off list exists: every MOVED and every row-repair remainder, with its
      dry-run output, in `docs/contracts/.run/contract-1-data-handoff.md` and summarised in the final report.
- [ ] Final report written and the run-end SUMMARY (DONE / PENDING / BLOCKED / PARKED / NEXT) is in PROGRESS.
- [ ] The last PROGRESS line is `CONTRACT 1 COMPLETE`.

## Guardrails (hard stops)

- No data repair of any kind (Scope boundary). No production action. No VPS change.
- No new runtime dependency unless the fix cannot be written without it; record why in the PR.
- No spec departure without the owner: a fix that needs one goes to owner-questions and the item waits.
- No synthetic data in proofs; a fixture for a parser comes from a real captured page or document.
- No AskUserQuestion; no recurring cron inside the session (run-discipline D4).

## Final report (committed with the last batched docs PR, and summarised in PROGRESS)

- Per theme: each issue's terminal line with PR, proof reading and issue state.
- The SKIPPED list (already fixed) and the MOVED TO DATA CONTRACT list with dry-run outputs.
- The PARKED list with issue numbers and what each waits for.
- Owner questions raised (the owner-questions file), each with its recommendation.
- LEARNINGS TO FOLD BACK: proposals only, routed per `learnings-routing.md`.
- DONE / PENDING / BLOCKED / PARKED / NEXT, where NEXT names contract 2 (release gate: item 36 admin
  editing, item 7 remainder, Swap Test, S6 wiring, board from data) and the data contract.

## Authorization trail (owner, 2026-09-25/26)

| Fork | Decision | Why |
|---|---|---|
| Inventory scope | Everything open except `parked` | Owner: "Everything open" |
| What is on hold | Only `parked` (and #1063, parked by its own comment) | Owner, recommended option |
| Issue triage | An issue is not a requirement: build if spec-conformant, reject if contrary, owner call if new | Owner direction 2026-09-25 |
| Production | Out of scope; noted | Owner, recommended option |
| How contracts are cut | Issues first; admin editing (item 36) after, in a separate contract | Owner chose "Issues first, admin later" |
| Data | "We are not fixing data right now as part of contract, only code" | Owner, 2026-09-26 |
| Where the code-only line is | Code + read-only staging proof; repair tools may be built and dry-run, never applied | Owner, recommended option |
| Order, run rules | Step 0 floor, then T2, T3, T4, T5, T7, T6; 2 builders; park after 2 rounds; no pop-ups; OD-95 continues | Owner approved the checkpoint |
| #979 / #58 / #167 / #630 | OD-123 NOT_SOURCED (data contract applies it) / OD-124 gain % on card / OD-125 no reviews / runner exempt (done) | Owner calls 2026-09-26 |

## References (load transitively)

- `.claude/rules/{defect-fix-contract, staging-is-the-release-gate, signal-ownership, ist-timezone, recurrence-detection-gate, spec-verified-recommendations, supervisor-verification, owner-status-artifact}.md`
- `~/.claude/rules/{run-discipline, spec-first, status-artifact}.md`
- `docs/design/pending-inventory-2026-09-26.md`, `docs/design/data-sourcing-pull-model.md`, `docs/design/findings.json`
- `docs/contracts/2026-09-24-finish-pending-build-items.md` (brief lines, tiers, merges), `docs/ops/prod-ops-recipes.md`
