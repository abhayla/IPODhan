# Failure-class registry (recurrence loop, part 1)

Machine-readable registry of data/scraper/persister failure classes that have recurred or
could recur. Seeded 2026-09-06 from `scripts/lib/substance-checks.mjs`,
`scripts/audit-ipo-coverage.mjs`, `scripts/audit-detection-floor.mjs`,
`docs/reviews/round-7-detection-rca.md`, `docs/reviews/w177-detection-rca.md`, and the last two
weeks of `docs/walks/2026-09-02-deepa-pipeline-walk.md`.

**`detection_check` must be a real, verifiable id** — a `key` from the `SUBSTANCE_CHECKS` array in
`scripts/lib/substance-checks.mjs`, a `checkId` string passed to `record(...)` in
`scripts/audit-detection-floor.mjs`, or an invariant name in `scripts/audit-ipo-coverage.mjs`. Where
no such check exists, the row says `unguarded` honestly rather than naming something that isn't a
real, running check. A write-time guard inside the scraper/consolidation code (rejects/collapses a
bad value before it is stored) is NOT the same as a `detection_check` — it stops the write but does
not surface a signal if a new write path bypasses it, which is exactly how this class recurs (see
Why, above the table). Guarded rows below are guarded because an *audit* check exists that would
independently re-flag the bad value in the DB even if a write path let it through.

| class_id | feature | symptom (user-visible) | first_seen | fix_prs | detection_check | status |
|---|---|---|---|---|---|---|
| share-count-as-issue-size | scraper persist (issue_size) | `issue_size` column holds a raw share count (~80x too small) instead of rupees, e.g. `4,575,000` shown as the issue size in rupees | Aug 2026 (round 6/7 detection RCA); recurred Sep 2026 on the create path (W-177) | round-7 RCA fix + `w177-detection-rca.md` fix (segment-floor + shares-x-band consistency rule; `SME_ISSUE_SIZE_FLOOR`) | `issue_size_segment_floor` (`scripts/lib/substance-checks.mjs`) + `c_issue_size_consistency` / `c_issue_size_floor` (`scripts/audit-detection-floor.mjs`, `checkC()`) | guarded |
| DRHP-emitted price band | field-priority-matrix (price band) | a DRHP-sourced price band (pre-final, often `[•]` placeholder-derived) is shown instead of the live RHP/Price-Band-Ad/exchange value | flagged in `docs/reviews/skyways-field-audit.md` (2026-08-27) as a live-matrix ordering question, not confirmed as a shipped bug | none — matrix order (`ADMIN>NSE>BSE>DRHP`) was reviewed and left as-is for Skyways | none found in `substance-checks.mjs` or the audit scripts (no plausibility/source check ties price-band value to its `field_sources` origin) | unguarded |
| degenerate price band | scraper persist (price_range_min/max) | price band min==max or min>max stored on a non-fixed-price issue | pre-existing (SUBSTANCE_CHECKS design) | `checkDegenerateBookbuildingBand` added to substance checks | `degenerate_bookbuilding_band` (`scripts/lib/substance-checks.mjs`) | guarded |
| issue_size 0 or negative | scraper persist (issue_size) | `issue_size` stored as 0 or negative on a live IPO row (a null `issue_size` is NOT caught by this check — `checkIssueSize` returns null/no-violation for a null value; the go-forward `issue_size` presence invariant in `scripts/lib/ipo-stage-completeness.mjs` (`issue_size IS NOT NULL AND issue_size > 0`) is what catches a null) | round-6/7 detection RCA (`docs/reviews/round-7-detection-rca.md` P1-3) | round-7 fix (`[FAIL] issue_size > 0` gate) | `issue_size` (`scripts/lib/substance-checks.mjs`) + go-forward presence invariant (`scripts/lib/ipo-stage-completeness.mjs`) | guarded |
| registrar address pollution | scraper persist (registrar) | `registrar` field carries an address/contact fragment instead of the registrar name | round-7 detection RCA (P3 batch) | `checkRegistrarQuality` added | `registrar_quality` (`scripts/lib/substance-checks.mjs`) | guarded |
| date-order violation | scraper persist (open/close/allotment/listing dates) | open > close, or allotment before close, or listing before allotment | pre-existing (SUBSTANCE_CHECKS design) | `checkDateOrdering` | `date_ordering` (`scripts/lib/substance-checks.mjs`) | guarded |
| fabricated open/close dates from Moneycontrol | moneycontrol-scraper.ts | open/close dates are ESTIMATED from listing/allotment date (listing-3, listing-10, allotment-2) and written as if scraped; recurred in `chittorgarh-scraper.ts` / `chittorgarh-rights-debt-adapter.ts` (same class, `close = open + 3` when empty) | 2026-09-04 (W-02 class recurrence; walk W-116) | hotfix `c018f4e1` + `210ad865` (estimation removed both places; matrix reordered so exchanges outrank the filing for bidding-window dates) | **none** — `docs/walks/2026-09-02-deepa-pipeline-walk.md` W-119 explicitly says "No substance rule catches a fabricated date ... open, after the walk (detection upgrade for the W-116 class)" | unguarded |
| NUL rupee glyph | extract_filing.py / PDF text extraction | the rupee glyph renders as a backtick or NUL/garbage character in extracted amounts (e.g. `` `0.50 million` ``) | walk W-92 | `aca495f0` (glyph normaliser scoped to bid-window text) | none in `substance-checks.mjs` or the audit scripts (round-7 RCA P3 batch names "name glyph" as a still-open audit gap, not shipped) | unguarded |
| extractor memory blow-up | scraper/scripts/*.py (pdfplumber/OCR extraction) | Python extractor OOMs or aborts with a C-level MemoryError that the caller misclassifies as a soft/retryable failure | walk W-137 | `dfa42f7c`..`6c44ec21`..`2a6817a9` (memory ceiling, single-thread BLAS, hard-classify C-level aborts, exit 3 JSON) | none — this is a process-exit-code contract inside `scraper/scripts/*.py`, not a DB-row audit check; nothing in `substance-checks.mjs` or the audit scripts re-verifies extractor exit-code handling | unguarded |
| deploy probe port held | scripts/deploy-linux.sh | the deploy's port-probe listener is not fully killed (group signal misses a child outside the leader's process group), blocking the next deploy | walk W-169 | `d8322a00`, `37288341`, `2cc19d43` (kill by PORT, not only by pgid) | none in `substance-checks.mjs`/`audit-*.mjs` (mitigated by deploy-script bash tests, not a data/audit check) | unguarded |
| scraper locks left by deploy | scripts/deploy-linux.sh / scraper cycle locks | a deploy that stops the scraper mid-cycle leaves the Redis cycle lock held, starving the next cron cycle | walk W-176 | `7f964415`, `648c2ba8`, `1d966477` (release locks on deploy stop; compare-and-delete on the lock token) | none in `substance-checks.mjs`/`audit-*.mjs` | unguarded |
| both slots extracting at once (522) | scraper cron cadence / nginx | both staging cron slots (:00/:30) run extraction simultaneously on 2 vCPUs, starving nginx and producing Cloudflare 522s | walk W-178 | `7300e0aa`, `ea40e3c3`, `6039504a`, `252cd9d0` (cron offset to :15/:45, nice priority, TZ restore) | none in `substance-checks.mjs`/`audit-*.mjs` (an ops/cadence class, not a DB-row check) | unguarded |
| garbled anchor names | anchor-report-parser.ts (OCR text) | anchor investor names published with OCR corruption (e.g. `OSWAL OT] LAL FINVEST N4 LI IITE D`) | walk W-81 | `c17d5d18` — write-time `NAME_QUALITY_FLOOR` 0.3 gate refuses to publish a book with >30% unreadable names | none in `substance-checks.mjs`/`audit-*.mjs` — the fix is a write-time refusal gate in the parser, not an independent audit check on stored `anchor_investors` rows | unguarded |
| exchange defaulting to BOTH for SME | data-consolidation-service.ts / data-consolidation-orchestrator.ts | an SME IPO is stored with `listing_exchanges = [NSE, BSE]` when SME issues list on exactly one exchange | walk W-145 | `violatesSmeSingleExchange` / `collapseSmeExchanges` — write-time invariant in the consolidation service and orchestrator | none in `substance-checks.mjs`/`audit-*.mjs` — the guard runs only on the write path; no audit check independently re-verifies stored SME rows for a two-exchange value | unguarded |
| listed rotation stall | document-cycle.ts / document-discovery-runner.ts (LISTED-tier candidate rotation) | shape 1: a LISTED IPO inside the 10-day rotation window has `documents` on file but ZERO `document_fetch_state` rows — `MAX(last_attempt_at)` sorts it first forever (NULLS FIRST), so it occupies the front of the LISTED queue every cycle and `enrichListedCandidates`'s `listedCap * 4` bound starves every LISTED row behind it (`listedSkippedUnenriched` stuck at 7). shape 2 (round 2, W-136): rows DO exist but the discovery-budget wall clock trips every cycle before the LISTED tier is reached — `MAX(last_attempt_at)` never advances even though DUE rows remain — a row in a deliberate future `next_retry_at` backoff is excluded, never counted as stalled (ESDS Software, Priority Jewels: staging, 2 rows re-selected every cycle while 7 others waited) | 2026-09-06 (rotation-stall-null-fetch-state; live on prod, 4 IPOs: madhur-knit-crafts, hy-tech-engineers, augmont-enterprises, tempsens-instruments); round 2 2026-09-06 (staging, ESDS Software Solution + Priority Jewels stuck 2+ days) | `runIpo`'s rotation-stamp guard (`document-discovery-runner.ts`) for shape 1 — guarantees a `document_fetch_state` row is written on every visit, including a `plan.skipIpo` with no prior history and an exception thrown mid-fetch, both of which previously left zero rows written. Shape 2: `runDocumentCycle`'s budget-trip loop now reserves up to `listedCap` LISTED slots (mirroring the existing WITHDRAWN/POSTPONED purge reservation) so `runIpo` — and therefore the rotation stamp — still runs for LISTED rows even when the live backlog burns the whole discovery budget every cycle (`listedReserved`/`listedProcessedAfterBudget` in the cycle summary/log) | `listed_rotation_stall` (`scripts/lib/document-state-checks.mjs`, wired in `scripts/audit-detection-floor.mjs`) — two shapes in the same check | guarded |

## Summary (as seeded 2026-09-06; updated 2026-09-06)

15 rows: 7 `guarded` (an audit check independently re-verifies the DB), 8 `unguarded` (fixed at a
write path or in ops config, but nothing independently re-checks it — this is exactly the shape
that let share-count-as-issue-size recur in September after its August fix).

## Nightly audit -> GitHub issues (recurrence loop, part 2)

A `guarded` row in the table above only means a check EXISTS and RUNS nightly. It says nothing
about whether a FAIL that check reports actually gets looked at — `docs/reviews/round-7-detection-
rca.md` and the walks above are full of checks that ran clean for weeks while a defect it would
have caught sat unfixed, because a FAIL line in a cron log nobody reads is not a tracked work
item. Part 2 closes that gap: every FAIL or UNVERIFIABLE from `scripts/audit-detection-floor.mjs`
becomes — and stays — a GitHub issue until the check passes again.

**Mechanism.**

1. `scripts/audit-detection-floor.mjs` writes `<STATE_DIR>/findings-latest.json` on every run
   (gate mode or plain report mode): `{ runDate, generatedAt, gate, results, findings }`, where
   `findings[checkId]` is the list of offending rows (`{ rowKey, title, body }`, capped at 200 per
   check) collected during that run. This file is a snapshot, not an append log — it is
   overwritten every run.
2. `scripts/audit-findings-to-issues.mjs` reads that file and, for every check currently FAIL or
   UNVERIFIABLE, syncs ONE GitHub issue titled `[nightly-audit] <checkId>: <name>`:
   - no open issue exists -> **create** it, labeled `nightly-audit` plus either `needs-decision`
     (the check's rows are data already sitting wrong in the DB — a human decides the repair) or
     `pipeline-failure` (the check's rows are a broken piece of machinery — a worker fixes it in
     code). An UNVERIFIABLE check always gets `needs-decision`, because "the audit went blind" is
     never something a worker can code-fix without first finding out why.
   - an open issue exists and the failing row-key set is UNCHANGED since the last run -> do
     nothing (no comment). This mirrors the digest de-duplication `audit-detection-floor.mjs`
     itself already does for Notifier pages (see that file's header comment on the "~72 pages a
     night" incident) — a bot commenting on its own unchanged issue every night is the same noise
     class in a different channel.
   - an open issue exists and the row-key set CHANGED -> comment listing which row keys are new
     and which resolved, so the issue's history reads as a timeline instead of a wall of
     repeated dumps.
   - the check is back to PASS and an open issue exists -> comment `PASS on <date>` and close it.
3. Classification of `needs-decision` vs `pipeline-failure` for a FAIL is currently a static map
   (`DATA_REPAIR_CHECK_IDS` in `audit-findings-to-issues.mjs`) rather than a field in
   `docs/reviews/detection-checks.json`, because only one check (`listed_rotation_stall`) carries
   a `registryRow` today. When a check's `detection-checks.json` entry does carry a `registryRow`,
   its text is included in the issue body so a reader lands on the right registry row without
   guessing.
4. A per-run `--max-issues` cap (default 30) stops one very bad night from opening dozens of
   issues in a single run; anything past the cap is logged, not filed, and picked up on the next
   run.

**Fail-open, by design.** This step runs on a production root cron on the VPS, and its own repo
rule is that a missing tool or a network blip must never turn a healthy audit into a failed one.
`scripts/audit-findings-to-issues.mjs` exits 0 and prints `ISSUES-SKIP: <reason>` whenever `gh` is
missing, `gh auth status` fails, the findings file does not exist yet, or any `gh` call throws —
never a non-zero exit from this step. `scripts/vps-data-audit-cron.sh` additionally wraps the call
in `|| true` as a second, redundant layer of the same guarantee.

**Dry-run switch.** `AUDIT_ISSUES_DRY_RUN=1` (or the script's own `--dry-run` flag) makes every
`gh` command something the script would have run — printed, never executed, exit 0 — for exercising
this on the box the first night before trusting it with real issue creation:

```bash
AUDIT_ISSUES_DRY_RUN=1 node scripts/audit-findings-to-issues.mjs
# or, off the box against a saved findings-latest.json:
node scripts/audit-findings-to-issues.mjs --dry-run /path/to/findings-latest.json
```

**State.** `<STATE_DIR>/issues-sync-state.json` — `{ [checkId]: { issueNumber, firstSeen,
lastRowKeys, closedAt? } }` — lives next to `findings-latest.json` in the audit's own state dir and
is the only way the script knows "unchanged since last night" vs "this is new". A closed entry is
KEPT, never deleted, precisely so a PASS->FAIL flap re-attaches to the SAME issue instead of
opening a new one every cycle. Losing this file is recoverable, not silent-failure-shaped: the next
run just re-discovers issues (open OR closed — `gh issue list --state all`) by title and treats
every row as new (one extra comment, not a duplicate issue or a reopen, because the title match
still finds the existing issue in whatever state it is in).

**Human-closed issues are never reopened or recreated.** A check that a human closed as "won't fix"
or "accepted legacy" while it still FAILs gets a comment only when the failing row-key set actually
changes since the issue was closed — never a reopen, never a duplicate issue. See `planIssueSync()`
in `scripts/audit-findings-to-issues.mjs` for the exact rule.

**Public-repo caveat.** Issue bodies and comments embed real data from tonight's run — company
names, dates, price/lot values, row keys — pulled straight from the production database. `abhayla/
IPODhan` is a public repo, so this mechanism publishes that data to anyone who can read its Issues
tab. Nothing here is a secret (it already renders on the live site), but it is a step beyond "a
private log file on the VPS" and should be kept in mind before pointing this mechanism at a check
whose row detail is more sensitive than public IPO data.
