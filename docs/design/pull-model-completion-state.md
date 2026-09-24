# Pull-model completion state

**What this is.** The live inventory of every pull-model build item, and the evidence for each verdict.
The policy that makes this list load-bearing is `.claude/rules/staging-is-the-release-gate.md`: no
production deploy is targeted until every item here is built and proven on staging.

**How to use it.** When an item lands, change its row here in the same PR. When a verdict is disputed,
re-measure - do not edit the verdict to match a card.

**FORMAT CONTRACT - this table is PARSED.** `scripts/ops/build-plan-board.mjs` reads every numbered
row with a strict pattern, and its verdict cell must contain **exactly** `**BUILT**`, `**PARTIAL**`
or `**NOT BUILT**` and nothing else. A qualifier inside the bold (`**PARTIAL - blocked on X**`)
reads fine to a human and silently stops the row matching: the parser then sees fewer items than it
expects and refuses to emit, failing the Detection-Change Gate on the NEXT unrelated PR. Put every
qualifier at the FRONT OF THE EVIDENCE CELL instead, where it reads the same. After editing this file, or `data-sourcing-pull-model.md`, run **`npm run docs:verify`** from the
repo root: FOUR separate generators parse these documents (plan board, rule index, design-
consistency checker, detection registry) and one edit can stale any of them. `docs:verify` runs all
four and ends with the consistency score; it exits non-zero on a real defect (verified). Running
only one of the four is how #872 and #875 both broke CI on an unrelated PR. (Learned the hard way in #872/#874; registered as
`docs/reviews/failure-classes/prose-edit-breaks-a-parser-of-that-prose.json`.)

**Measured 2026-09-21 against `refs/remotes/origin/main` = `748b8527`.** Always the explicit ref: a local
branch named `origin/main` has shadowed the remote twice and made a merged PR read as unmerged.

---

## Why this document exists rather than the cards

Every tracking artefact here has been caught wrong, so the cards cannot be the list:

- **24 of 42 build cards carry a Status line reading `unknown`**, and `check-build-cards.mjs:155` accepts
  that shape as valid. The gate passes while telling nobody anything. This is the single biggest reason
  nobody had an accurate picture.
- The stage-3 ledger showed five merged slices as `queued` for three days (corrected 2026-09-20).
- Item 31's card reads `NOT STARTED` for work the board records as landed in #813.
- `check-dod.mjs`'s D14 item has been red since 2026-09-09 because it hard-codes two open-fork rows that
  were correctly answered that day (#829).
- **Item 35 read `NOT BUILT` while #817 (`feat(ops): item 35 — admin queue open count in the nightly
  report`) merged to main 2026-09-19T18:13:30Z as `fb02ec1d`** - a merged-and-wired item marked not
  built, the same stale-verdict class as items 31/32/33/34.

So a card saying DONE is a claim. Each verdict below was checked against an artefact that exists.

---

## The items

| # | Item | Verdict | Evidence / what is missing |
|---|---|---|---|
| 1 | Child-table consolidated writer | **BUILT** | `data-consolidation-orchestrator.ts:731` `tableName: ChildConsolidationTable`; `:775` `SINGLETON_ROW_CHILD_TABLES`. Residual: #802 - `peer_companies` unwritten since 2026-06-17 |
| 2 | Field manifest + priority config | **BUILT** | `scraper/config/field-manifest.json`, `field-manifest-loader.ts`, `field-manifest-schema.ts`, 4 unit test files. Residual: #739 |
| 3 | Matrix cleanup / one source table (13 slices) | **PARTIAL** | 13 slices landed. **#923 (066d5203, 2026-09-23):** a configuration gap (a plan row whose source has no fetcher registered) no longer burns a real attempt, and reconciliation reopens rows it had wrongly stranded as exhausted. Staging repair owed: dry run measured 6,718 rows reset / 39 held for review — not yet applied on staging. Missing: **S6 churn-stop half** (#759, needs a `field_plan_state` migration); **S4 and S5 staging proofs owed**; **Swap Test never run** (#893); the churn-stop (#759) is also still open; S2-4 recorded FAIL (`n=10`, a card defect corrected in #835) |
| 4 | Per-field validation before write | **BUILT** | `field-extraction-validation.ts` (201 lines); `field_extraction_failures` in `schema.ts`. **Caveat: that table holds ZERO rows** - see OD-62 below |
| 5 | `ipo_field_plan` table + generator | **BUILT** | `ipoFieldPlan` in `schema.ts`; `field-plan-generator.ts`; `ipo-field-plan-repository.ts` |
| 6 | The pull walk over the plan | **PARTIAL** | `field-plan-walk.ts` + **4** fetchers registered at `field-plan-walk-deps.ts:197-201` (NSE, DOC, BSE, CHITTORGARH) - re-counted on `refs/remotes/origin/main` 2026-09-21 after PR #867 registered the NSE fetcher, which is what #705 and #759 correctly named as missing (57 manifest fields rank NSE, including the six E-1 fields only the exchange may state; 136 rows answered `NO_FETCHER_REGISTERED` every wake). #705's remaining premise is stale - the walk does have fetchers. Still open: INVESTORGAIN_GMP has no adapter, and #762's 12,480 parked plan rows (fix merged as #763, **not on prod**) |
| 7 | Job scheduler + budgets | **PARTIAL** | Scheduler built (`scheduler/`, `due-step-cycle.ts`). OD-55 force-kill removal merged but **not on prod** (#805). Tiering (O-4) unverified. Staging proof (2026-09-23, release 084928e0): S1 — the 22:20 IST live wake logged "Live-figures job: took scraper:live (independent of scraper:cycle, OD-27)" with ttlMs 240000, never took scraper:cycle, logged "GMP record created successfully" 23 times (17 rows carry a 22:xx source time; F-143), and released scraper:live. S2 — the 22:15 IST non-slot data wake skipped discovery and the document cycle as designed, but the website list scrapers still ran (F-142; slice S2b). S3 — closed-IPO cron lines installed at 25,55 22,23; ENABLE_CLOSED_IPO_JOB not set (off). Staging check (2026-09-24 08:41 IST, FAILED, release 084928e0): the non-slot skip holds (22:15-23:45 wakes skipped the document cycle; the 14:00 slot closed 21:45), but the 00:00 slot never closed - "incomplete: pass=discovery,listed_deferred" on all 16 wakes 00:15-07:45 with the document budget exhausted on blocked documents every wake (F-151, #943). |
| 8 | Ratios / basis-for-offer-price extractor | **BUILT** | RATIOS_BASIS_ISSUE_PRICE is deliberately excluded from `EXTRACTABLE_DOC_TYPES`/`AUTO_PERSIST_DOC_TYPES` (`filing-auto-persist.ts:137-162`) - no source parser exists for its content, and BSE has no ratios document source at all (`document-classifier.ts:177`). #716 (filed, then closed as non-bug) confirms this and finds detection already correct: `not_applicable_documents_named` (PR #677, merged 2026-09-16) reports these PENDING rows as not-applicable, not stuck. The real ratio-population signal is `issuer_ratio_yield` (#670), fed by RHP/DRHP/PROSPECTUS extraction. Row was wrong to call this a missing drainer. |
| 9 | The re-read loop | **PARTIAL** | **SUPERSEDED IN PART by OD-65/OD-66 (2026-09-21) — the spec's re-read-the-bytes loop is explicitly NOT wanted.** Owner: "everything should be done on day one itself, and it should not be repeated for the same IPO... one IPO, one round of document read." That dissolves the §3.2-vs-OD-32 contradiction (#853) rather than adjudicating it: nothing goes back to a purged PDF because nothing goes back at all. The sizing argument is also gone — the loop was scoped from "578 leadManagers conflicts"; decomposed (same-source rows, null-on-one-side, byte-identical) the real count is **1 on staging, 2 on prod**. What OD-66 DOES require is built and merged (#876): a new document is adjudicated on its own fields only, with the identity fields it must carry for slug resolution passed as CONTEXT rather than as claims — the defect there was real, 11 conflict rows auto-closed for fields no document read. **Still open under this item:** a genuinely new corrigendum/filing must still be FETCHED and read when it appears; that discovery path is item 22's, not a re-read loop |
| 10 | Verification checks of section 4 | **PARTIAL** | 8 `audit-*` scripts exist. **14 of the 21 paper checks accounted for 2026-09-20** (12 merged in #859, more in #863; `design_traceability` was already gating every PR and merely mislabelled as paper) — they found four live defects on their first runs (#858 retired listing prices, #860 null segments, #861 a check that never reports, #862 79 E-1 writes from DRHP). **All four now have class-level fixes**: #862 guarded at the `trackFieldUpdate` choke point (merged `685db95f`), #858 at the plan generator (merged `956bd761`), #860 at `IPORepository.create` (#866), #861 in #863. Existing bad ROWS are not repaired by those guards and are named in each issue. **6 of the remaining 8 are BLOCKED on mechanisms that do not exist** (measured, see #778): `pull_frozen` needs supersession (zero callers, no `superseded_by` column); the three `reread_*` need item 9; `pull_noblank` needs a current-value read across 190 columns; `pull_noop_suppression` needs its counters persisted. Real deliverable is 13-15 checks, not 21. |
| 11 | Crore conversion (OD-20) | **PARTIAL** | **The data conversion is WITHDRAWN — the capacity argument that justified it is false.** Measured 2026-09-21: all five rupee columns are `numeric(18,2)`, not the `numeric(15,2)` the spec's SS5.2 table stated. Saudi Aramco (Rs 2,50,000 cr, largest IPO ever priced anywhere) uses **0.025%** of the ceiling; Hyundai India 0.0028%; our largest stored row (NSE, Rs 26,579.64 cr) 0.0027%. The owner's test — "if the current field holds the world's largest IPO there is no need to change it" — is met with a factor of 4,000 to spare, so no migration, no repair tool, and #854's source-availability blocker is moot. What DID land: F-95 and F-77 (PR #871), the two readers comparing crore thresholds against the rupee column — NSE and a Rs 0.70 cr IPO scored identically before the fix. Storage stays rupees; display converts at the edge (`formatIssueSizeCrores`). Remaining under this item: the five OD-48 exception columns already stay in rupees by decision, so the only open work is unit TAGS on those columns if the owner still wants them |
| 12 | Name normaliser + duplicate detection | **PARTIAL** | Built and on `refs/remotes/origin/main`: `company-identity-fold.ts`, `company-name-normalizer.ts`, `company-name-similarity.ts`, `ipo-identity.ts` (OD-34 order). **OD-68/OD-69 landed 2026-09-23 (#910, 7db61b0c):** page-status suffixes and page-title text are stripped before matching (one implementation, `packages/shared/src/utils/identity-decoration.ts`, with a parity-tested JS copy for the audit); a name match binds only with the same segment and a matching known price band, an exact name within 180 days binds a postponement (OD-35); a WITHDRAWN row never binds a refiling (OD-71); a same-name live row with a differing known date or band is HELD for review (audit_logs + nightly `i_identity_held`), with an admin override; `mergeDuplicateInto` refuses differing CIN/ISIN/symbol/open date; the look-alike pairs (Himalayan Solar / Himalaya Nutravedics, Technocraft / Technocrats) are pinned as different. Nightly sweep for duplicates by identifier (#906). **#925 (ecc49140, 2026-09-23):** CIN is now the FIRST binding identifier in the resolver (OD-34 step 1, OD-69) — the resolver never joins two rows on a differing CIN. **Missing:** the SEBI draft number (OD-34's second identifier) is not yet a binding step — measured 2026-09-23: the only per-offering SEBI number present in our documents is the observation-letter number, filled in 10 of 12 RHP/Prospectus rows and `[●]` (unfilled) in 6 of 7 DRHPs; owner decision pending on which column carries it and whether a migration is needed. The live duplicate `rays-of-belief-ltd` / `rays-of-belief-ltd-o` is not merged yet (staging first, prod with the release, OD-68). Residual: #679 |
| 13 | OFS + fresh-issue extraction | **BUILT** | `filing-persister.ts:364-440` - F-51 reconciliation, tolerance constant |
| 14 | BSE share count to rupees | **PARTIAL** | **Existing rows only.** Re-measured 2026-09-21 on staging; #728's headline is CLOSED for new writes. BSE is `capable: false` for `ipos.issue_size` on `origin/main` (ranks `DOC -> CHITTORGARH`), and all 6 IPOs in #728's table now hold the EXACT printed total from CHITTORGARH (6/6: Hero Motors 10,000,000,000; SS Retail 5,007,500,000; NSE 265,796,400,000; Jindal Supreme 1,248,800,000; Manika Plastech 1,255,000,000; Sonaselection 1,415,700,000). A SECOND defect found and fixed in PR #870: `computeBSEIssueSize` returned the sentinel 0 on missing inputs and it was persisted as a value - ALL 20 zero-valued `issue_size` rows are BSE-sourced, no other source ever wrote one. Remaining: 17 non-zero BSE-sourced rows carry the wrong-quantity value and 20 hold 0; 19 of those 20 have no completed document to re-derive from, so the repair needs the same source decision blocking item 11. Collision with item 11 on `ipos.issue_size` still stands - a unit conversion and a correctness repair must not be in flight together |
| 15 | Revive `valueActuallyChanged` | **BUILT** | 7 occurrences in `data-consolidation-service.ts`; noop-write-suppression test |
| 16 | Retire Moneycontrol | **BUILT** | `scraper/src/index.ts:797-804`, with the freshness-SLO consequence recorded |
| 17 | Closed-IPO job (OD-22) | **PARTIAL** | **#919 (257421cf, 2026-09-23) rebuilt the mechanism: the job now PLANS then WALKS** (OD-76) — it no longer records DONE from a zero-work pass. DONE requires stored plan rows greater than zero AND every row settled (OD-79); the failure cause is `FIELDS_PENDING` when rows remain unsettled (OD-80, migration 0052); a picked event is re-picked rather than abandoned (OD-81); plan and walk share one fingerprint so they cannot drift apart (OD-82). Built and present on `refs/remotes/origin/main`: the job, `isClosedIpoJobDue` (22:00 IST boundary), `closed_ipo_resourcing` + migrations 0050/0052. **Still PARTIAL:** `ENABLE_CLOSED_IPO_JOB` stays OFF by default — the job's own spec-stated dependencies (items 6, 7, 10) are not all built; the new plan-then-walk behaviour has no staging proof yet (owed); the 10 wrong DONE rows recorded on staging by the OLD mechanism (#717, measured 2026-09-23, `fieldsWritten 0` / `NO_DUE_FIELDS`) await repair under the new logic. Follow-up: #932. Registry: `done-recorded-when-worker-found-nothing`. |
| 18 | Document retention (OD-32) | **BUILT** | `documentPages` table exists (`schema.ts:726`); the page-text writer is live in `filing-auto-persist.ts:1191` (PR #560, #628) and stores rows before COMPLETED is set. The purge (`document-cycle.ts`, `document-store.ts`) keys on per-document `extracted_at` + a `textless_count` veto so a COMPLETED document with zero stored pages is never deleted. 46 real unit tests pass (`document-page-text.test.ts`, `document-page-number-base.test.ts`, `document-pages-schema.test.ts`, `purge-requires-stored-text.test.ts`, `document-purge-policy.test.ts`), verified 2026-09-20. **Under question: #933** — an RHP extracted 2026-09-11 was still on the staging disk 2026-09-23, 12 days after its last extraction, against OD-32's 7-day purge window; cause unmeasured. |
| 19 | Merge tool on shared write path | **PARTIAL** | Singular and plural merge tools routed through `IPORepository.mergeDuplicateInto` (#432, #807 piece 1). **Merge log landed (#888) and made complete (#917, 27cd76f6, 2026-09-23):** both IPO rows are locked and snapshotted whole (`to_jsonb`, every live column), both IPOs' field_sources rows are logged, repointed rows are logged by id and rows deleted on a unique conflict are logged whole, with counts taken from the statements (RETURNING), not pre-counted; #900 fixed (one shared watcher no longer aborts or wipes the merge). **Missing:** the `unmerge` command itself - parked by the owner until the identity work (#903) lands; migration 0051 (ipo_merge_log) is not yet on staging or prod. |
| 20 | Design-traceability CI check | **BUILT** | `scripts/ci/check-design-traceability.mjs` + its test |
| 21 | The read side (OD-39/40/41) | **PARTIAL** | `FieldProvenanceLine.tsx` + test exist. Missing: `chosenConfirmedAt` column; **the staleness threshold is no longer needed (OD-72, 2026-09-23: the time-based marker is retired; the line states source and read date, and a missed live-refresh slot alerts the admin)**; touched-slugs tracker does not survive a restart |
| 22 | Document handling + download limits | **PARTIAL** | Row was stale: OD-37's other three limits are ALSO built with dedicated tests, not just the streaming cap — `resolveHostVerdict` (DNS-rebind fix, `company-host-source.ts:474`), the registrar host allow-list (`company-host-source.ts:756`), and cause-carrying refusal logging (`document-discovery-runner.ts:783-1036`), each tagged "item 22, OD-37" in the code and covered by `company-host-source-registrar-allowlist.test.ts` + `document-discovery-runner-download.test.ts`. `ENABLE_DOWNLOAD_STREAMING_CAP` (`feature-flags.ts:445`) is flag-gated code-complete; only its real-network staging proof is owed (#806) — an ops/deploy step, not a build. OD-36 is genuinely missing and confirmed by a repo-wide grep: no `partNumber`/`part_number` anywhere, no password-protected-PDF handling in `extract_filing.py`/`ocr_pages.py`, and no OCR-page-loses-a-disagreement rule in the field-priority path. Each needs a REAL fixture (a real multi-part filing, a real encrypted PDF) per the defect-fix contract — none exists in the repo today, so this is unbuilt, not unproven |
| 24 | Stage-gate deadlock | **BUILT** | PR #798 merged; #795 closed |
| 30 | Canonical IPO type table | **BUILT** | `docs/design/ipo-type-population.json` / `.md` |
| 31 | PR Spec-deviation block | **BUILT** | Landed as #813. **Card still reads NOT STARTED - card is stale** |
| 32 | Status line on every card + gate | **PARTIAL** | Gate built (`check-build-cards.mjs:142-156`). The 20 cards reading the `unknown` stopgap non-reason (PR #814) were each resolved against `refs/remotes/origin/main` + `gh pr view`: 10 are DONE (items 1,2,4,5,8,13,15,16,18,20 — artefact present, PR confirmed MERGED), 10 remain `unknown` because their OWN item is measurably PARTIAL in this document (items 6,7,9,10,11,12,14,19,21,22), each now with a real reason instead of the non-reason. The gate now REFUSES any `unknown` card not on a shrink-only `UNKNOWN_ALLOWED` list (`check-build-cards.mjs`), pinned by `scripts/tests/check-build-cards-status.test.mjs`, so no new card can pass with `unknown`. Not BUILT: the gate still accepts `unknown` for those 10 cards — it does not yet refuse the shape outright — so verdict stays PARTIAL until those 10 items themselves resolve to DONE or NOT STARTED. |
| 33 | Repoint `check-dod.mjs` into CI | **BUILT** | Row was stale on BOTH halves, re-measured 2026-09-22 on `refs/remotes/origin/main`. Root refusal built (`check-dod.mjs:13-18`), and **the CI wiring exists too** — `docs-gate.yml:85` runs `node docs/design/check-dod.mjs` on every docs PR, and has since the ENOENT fix; `grep -rn "check-dod" .github/workflows/` finds it. It runs `continue-on-error: true` by design, stated in the workflow: this DoD asserts the state of the 2026-09-09 design DELTA, not a live invariant, so an item drifting true-to-false as work legitimately continues must not redden unrelated docs PRs. #829 (the one item that could never be true again — it asserted two fork ids whose ABSENCE is the success condition of the process it measured) is FIXED and CLOSED by PR #883: it now delegates to `check-design-consistency.mjs`, which owns D14, and `scripts/tests/check-dod-d14-mechanism.test.mjs` (wired into docs-gate, 8 tests, 0.45s) guards the class. The walker's fork item now reports MET (end-to-end proof in #883, `DOD_E2E=1`, 6 pass 0 fail); the walker's OWN total is not asserted here because it spawns the mutation harness and any concurrent read of `docs/design/` perturbs it. **Residuals, named not hidden:** (a) `scripts/tests/check-dod-root-resolution.test.mjs` runs in no workflow — three of its four cases drive a full `check-dod` run that spawns the mutation harness, one had not finished after 15 minutes, and two such runs mutate the same tracked files concurrently; the reason is recorded beside the docs-gate step; (b) the card's own Known-gaps review — whether each remaining DoD item is still the right question — is the owner's and stays open |
| 34 | `spec_ref` on every failure class | **BUILT** | `validateSpecRefs()` in `scripts/build-detection-registry.mjs` (refs `origin/main` @ 485f5285) requires the key on every entry (throws if missing), requires an array, and validates each ref against the spec's real heading list, refreshed per run; `docs/reviews/failure-classes/*.json` all 45 entries carry `spec_ref` (currently `[]`); `scripts/tests/build-detection-registry.test.mjs` has 5 cases proving the DoD (missing key refused, bad section refused, non-empty ref renders in the GENERATED table, empty ref renders cleanly, `--check` catches the drift); `node scripts/tests/build-detection-registry.test.mjs` = 10/10 pass. **Card `item-34-findings-spec-ref.md` still reads NOT STARTED - card is stale, same class as item 31** |
| 35 | Admin queue open count in nightly report | **BUILT** | #817 (`feat(ops): item 35 — admin queue open count in the nightly report`) merged to `main` as `fb02ec1d` 2026-09-19T18:13:30Z. `scripts/ops/admin-queue-size.mjs` (`adminQueueSize`, `formatAdminQueueBlock`) is imported and called at `scripts/audit-detection-floor.mjs:82,1937-1938` (`console.log('\n' + formatAdminQueueBlock(queue))`), and `audit-detection-floor.mjs --gate` is invoked by the nightly cron `scripts/vps-data-audit-cron.sh:149` (step 3/5) - built AND wired, not merely present. **Caveat, not a build gap:** the printed block reports raw `conflicts`/`absences` counts per IPO, not the actionable-vs-abstention split (measured 2026-09-19: of 14,140 open `data_conflicts` rows, 13,850 are one-sided abstentions, 133 are identical values, 157 are true value-vs-value disagreements) - #818's 28,120 headline number is still unsplit where it is read. Tracked as a residual, not re-opening the item: **#818** |

**Totals: 17 built, 12 partial, 0 not built, of 29 items.** (2026-09-21: item 17 NOT BUILT -> BUILT; items 11 and 9 NOT BUILT -> PARTIAL, both because an
owner decision REMOVED work rather than because work was done — OD-67 withdrew the crore
conversion, OD-65 withdrew the re-read loop. Nothing now reads NOT BUILT. Derived per ROW by reading each row's verdict cell and
matching its leading `**BUILT` / `**PARTIAL` / `**NOT BUILT`, never by counting word occurrences
across the document: a naive `grep -c BUILT` matches inside NOT BUILT, and a row's own prose
contains all three words. An earlier session summary said 8/11/5 - that was wrong.)

### Not on the numbered list, and blocking

| item | verdict | why it matters |
|---|---|---|
| **OD-62 reason codes** | **NOT BUILT** | `field_extraction_failures` holds **zero rows** while 12,701 plan rows hold no value. Prerequisite of OD-63/S9 (#787 says so explicitly) |
| **OD-63 / S9 admin data-quality queue** | **NOT BUILT** | Blocked on OD-62. 881-line UI page. Note: no human has ever resolved a conflict - 31,706 resolutions, all `resolved_by = SYSTEM` |

---

## Dependency order

**Spec-stated** (the spec's own Depends-on column): 1<-none, 2<-none, 3<-2, 4<-2, 5<-1,2,3, 6<-5,15,
7<-(scheduler none; tiering 6), 8<-none, 9<-6, 10<-6,9, 11<-10, 12<-none, 13<-2, 14<-13, 15<-none,
16<-none, 17<-6,7,10, 18<-none, 19<-1, 20<-2, 21<-1,6, 22<-none.

**Remaining work, in order:**

1. **Unblocked now, can run in parallel:** item 22, item 18 (page-text writer),
   item 14 (#728), item 19 (second routing, #807), item 3's S6 churn-stop (#759) plus
   the Swap Test and the S4/S5 proofs, item 35's actionable-split residual (#818).
   Item 8 needs no build: RATIOS documents are excluded from extraction by design (#716).
2. **Then** item 6 completion - #705 and the #762 re-queue path. *Inferred, not spec-stated:* item 9
   cannot run over parked rows.
3. **Then** item 9 - the re-read loop, section 2.5.1 triggers 3-7. Spec-stated dep on 6.
4. **Then** item 10 - the 21 unbuilt checks. Spec-stated dep on 6 and 9.
5. **Then** item 17 - closed-IPO job. Spec-stated dep on 6, 7, 10.
6. **Then** item 11 - crore conversion. Spec-stated dep on 10; its own release.
7. *Inferred:* OD-62 reason codes must precede OD-63/S9.

Item 21's staleness threshold needs an **owner decision**, not a build.

---

## Size and tier

- **Small / Tier C:** items 32-residual, 33 CI wiring, item 35's actionable-split residual (#818), the
  S4/S5 proof runs, the Swap Test.
- **Medium / Tier B:** item 10's 21 checks, item 18 page-text writer, the #762 re-queue
  path, item 21's remaining halves.
- **Medium-large / Tier A:** item 22, item 9, item 17, item 19's second routing, S6 churn-stop, item 14's
  real fix, OD-62 reason codes.
- **Large / Tier A, own release:** item 11 (crore conversion), OD-63/S9 (admin queue).

---

## Source disagreements found while measuring

Recorded because each is a finding, not noise:

1. Item 31's card says `NOT STARTED`; the board says it landed as #813. **Card stale.**
2. Item 6: four fetchers are wired in code, but #705 is open saying the walk has none. *Unverified which
   is stale* - the file's own comment says the registry used to return an EMPTY registry.
3. 24 of 42 cards carry an `unknown` Status, accepted by the gate **by design**.
4. Item 19: the spec reads it as open; #807 says it is done and the spec text is stale - while a second
   raw-SQL tool survives.
5. The stage-3 ledger's S2 row records `S2-4 FAIL: n=10` inside a row marked `landed`.
6. Item 14: the card says it is mostly already built and the spec sizes it Tier C, while #728 shows the
   conversion is 41-76% wrong on every live IPO.
7. `check-dod.mjs` D14 asserts O-14/O-15 are open forks; they were answered 2026-09-09 (#829).
8. Items 32 and 33 read `NOT STARTED` while their primary artefacts exist on main. **Cards understate.**
9. **Item 35 read `NOT BUILT` while #817 merged and wired it into the nightly cron the day before
   (2026-09-19). Same stale-verdict class as items 31-34: this table lagged a merge by one day.**

**Unverified:** the section 9 S1-S9 slice table referenced in some session notes is not in
`data-sourcing-pull-model.md` on `origin/main` (zero `S9` hits). The document holding it was not located,
so OD-56's stage-change re-open and the S5/S6 mapping in those notes are unconfirmed against a source.
