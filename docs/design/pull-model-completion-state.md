# Pull-model completion state

**What this is.** The live inventory of every pull-model build item, and the evidence for each verdict.
The policy that makes this list load-bearing is `.claude/rules/staging-is-the-release-gate.md`: no
production deploy is targeted until every item here is built and proven on staging.

**How to use it.** When an item lands, change its row here in the same PR. When a verdict is disputed,
re-measure - do not edit the verdict to match a card.

**Measured 2026-09-21 against `refs/remotes/origin/main` = `94191e64`.** Always the explicit ref: a local
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
| 3 | Matrix cleanup / one source table (13 slices) | **PARTIAL** | 13 slices landed. Missing: **S6 churn-stop half** (#759, needs a `field_plan_state` migration); **S4 and S5 staging proofs owed**; **Swap Test never run**; S2-4 recorded FAIL (`n=10`, a card defect corrected in #835) |
| 4 | Per-field validation before write | **BUILT** | `field-extraction-validation.ts` (201 lines); `field_extraction_failures` in `schema.ts`. **Caveat: that table holds ZERO rows** - see OD-62 below |
| 5 | `ipo_field_plan` table + generator | **BUILT** | `ipoFieldPlan` in `schema.ts`; `field-plan-generator.ts`; `ipo-field-plan-repository.ts` |
| 6 | The pull walk over the plan | **PARTIAL** | `field-plan-walk.ts` + **4** fetchers registered at `field-plan-walk-deps.ts:197-201` (NSE, DOC, BSE, CHITTORGARH) - re-counted on `refs/remotes/origin/main` 2026-09-21 after PR #867 registered the NSE fetcher, which is what #705 and #759 correctly named as missing (57 manifest fields rank NSE, including the six E-1 fields only the exchange may state; 136 rows answered `NO_FETCHER_REGISTERED` every wake). #705's remaining premise is stale - the walk does have fetchers. Still open: INVESTORGAIN_GMP has no adapter, and #762's 12,480 parked plan rows (fix merged as #763, **not on prod**) |
| 7 | Job scheduler + budgets | **PARTIAL** | Scheduler built (`scheduler/`, `due-step-cycle.ts`). OD-55 force-kill removal merged but **not on prod** (#805). Tiering (O-4) unverified |
| 8 | Ratios / basis-for-offer-price extractor | **BUILT** | RATIOS_BASIS_ISSUE_PRICE is deliberately excluded from `EXTRACTABLE_DOC_TYPES`/`AUTO_PERSIST_DOC_TYPES` (`filing-auto-persist.ts:137-162`) - no source parser exists for its content, and BSE has no ratios document source at all (`document-classifier.ts:177`). #716 (filed, then closed as non-bug) confirms this and finds detection already correct: `not_applicable_documents_named` (PR #677, merged 2026-09-16) reports these PENDING rows as not-applicable, not stuck. The real ratio-population signal is `issuer_ratio_yield` (#670), fed by RHP/DRHP/PROSPECTUS extraction. Row was wrong to call this a missing drainer. |
| 9 | The re-read loop | **NOT BUILT** | Zero `reread` hits in `field-plan-walk.ts`. `detection-checks/reread_verdict.json` says it is designed, not yet built. Section 2.5.1 triggers 3-7 have no implementer; trigger 4 storage was deleted in S2 as dead code |
| 10 | Verification checks of section 4 | **PARTIAL** | 8 `audit-*` scripts exist. **14 of the 21 paper checks accounted for 2026-09-20** (12 merged in #859, more in #863; `design_traceability` was already gating every PR and merely mislabelled as paper) — they found four live defects on their first runs (#858 retired listing prices, #860 null segments, #861 a check that never reports, #862 79 E-1 writes from DRHP). **All four now have class-level fixes**: #862 guarded at the `trackFieldUpdate` choke point (merged `685db95f`), #858 at the plan generator (merged `956bd761`), #860 at `IPORepository.create` (#866), #861 in #863. Existing bad ROWS are not repaired by those guards and are named in each issue. **6 of the remaining 8 are BLOCKED on mechanisms that do not exist** (measured, see #778): `pull_frozen` needs supersession (zero callers, no `superseded_by` column); the three `reread_*` need item 9; `pull_noblank` needs a current-value read across 190 columns; `pull_noop_suppression` needs its counters persisted. Real deliverable is 13-15 checks, not 21. |
| 11 | Crore conversion (OD-20) | **PARTIAL - BLOCKED on an owner decision (#854)** | F-95 and F-77 both CLOSED in PR #871: the two scorers compared crore thresholds (1000/500/100) against a rupee column, so NSE at Rs26,579 Cr and PIYUSH at Rs0.70 Cr scored IDENTICALLY - a live bug, not the dormant one the card describes, since the smallest genuine row is still 7,007x the top threshold. Scope stays as #854 measured it: exactly 5 of the 37 CRORE columns hold rupees. The conversion itself is BLOCKED, measured not assumed: the spec (SS5.2) forbids arithmetic and mandates re-reading each row from source, but of the 307 rows a conversion would touch only **46 have a COMPLETED extractable document** - 261 do not (240 LISTED), because OD-32 purges document files after 7 days. A conforming tool converts 15% and skips 85%, leaving the column in two units at once. Three options + a recommendation are on #854, awaiting the owner. Also measured there: **no row in any of the 5 target columns is crore-shaped**, so the unit is known rather than unknown - which is what makes option 2 (arithmetic gated on a per-run proof) defensible |
| 12 | Name normaliser + duplicate detection | **BUILT** | `company-identity-fold.ts`, `company-name-normalizer.ts`, `company-name-similarity.ts`, `ipo-identity.ts`. Residual: #679 |
| 13 | OFS + fresh-issue extraction | **BUILT** | `filing-persister.ts:364-440` - F-51 reconciliation, tolerance constant |
| 14 | BSE share count to rupees | **PARTIAL - existing rows only** | Re-measured 2026-09-21 on staging; #728's headline is CLOSED for new writes. BSE is `capable: false` for `ipos.issue_size` on `origin/main` (ranks `DOC -> CHITTORGARH`), and all 6 IPOs in #728's table now hold the EXACT printed total from CHITTORGARH (6/6: Hero Motors 10,000,000,000; SS Retail 5,007,500,000; NSE 265,796,400,000; Jindal Supreme 1,248,800,000; Manika Plastech 1,255,000,000; Sonaselection 1,415,700,000). A SECOND defect found and fixed in PR #870: `computeBSEIssueSize` returned the sentinel 0 on missing inputs and it was persisted as a value - ALL 20 zero-valued `issue_size` rows are BSE-sourced, no other source ever wrote one. Remaining: 17 non-zero BSE-sourced rows carry the wrong-quantity value and 20 hold 0; 19 of those 20 have no completed document to re-derive from, so the repair needs the same source decision blocking item 11. Collision with item 11 on `ipos.issue_size` still stands - a unit conversion and a correctness repair must not be in flight together |
| 15 | Revive `valueActuallyChanged` | **BUILT** | 7 occurrences in `data-consolidation-service.ts`; noop-write-suppression test |
| 16 | Retire Moneycontrol | **BUILT** | `scraper/src/index.ts:797-804`, with the freshness-SLO consequence recorded |
| 17 | Closed-IPO job (OD-22) | **BUILT** | `scraper/src/scheduler/closed-ipo-job.ts` (job + `isClosedIpoJobDue`, one 22:00 IST boundary, catch-up-safe), `closed_ipo_resourcing` + migration 0050, `triggerClosedIpoJob` wired as `runStep(cycleId, 'closedIpoJob', ...)` at `index.ts:1092`, flag `ENABLE_CLOSED_IPO_JOB` (default false). All four verified BY CONTENT on `refs/remotes/origin/main` 2026-09-21 (PR #868). `resourceClosedIpo` runs the REAL `walkFieldPlanForIPO`, not a stub. Detection `closed_ipo_job_progress` filed under `notCoveredByThisManifest` until `audit-detection-floor.mjs` records it. **Residual #869:** 65 of the 155 PENDING documents are types with NO extractor (100% PENDING, 65/65, still arriving) - a second visit cannot help them; #717's "74 PROSPECTUS" is the half this job drains |
| 18 | Document retention (OD-32) | **BUILT** | `documentPages` table exists (`schema.ts:726`); the page-text writer is live in `filing-auto-persist.ts:1191` (PR #560, #628) and stores rows before COMPLETED is set. The purge (`document-cycle.ts`, `document-store.ts`) keys on per-document `extracted_at` + a `textless_count` veto so a COMPLETED document with zero stored pages is never deleted. 46 real unit tests pass (`document-page-text.test.ts`, `document-page-number-base.test.ts`, `document-pages-schema.test.ts`, `purge-requires-stored-text.test.ts`, `document-purge-policy.test.ts`), verified 2026-09-20 |
| 19 | Merge tool on shared write path | **PARTIAL** | Singular tool routed (#432). Plural clustering tool (`merge-duplicate-ipos.ts`) now routed too — its raw-SQL apply block replaced with `IPORepository.mergeDuplicateInto` calls, ratchet entry removed (piece 1 of #807, this PR). **#807 remaining: no merge log, so `unmerge` cannot yet exist — ordered as log first, then unmerge** |
| 20 | Design-traceability CI check | **BUILT** | `scripts/ci/check-design-traceability.mjs` + its test |
| 21 | The read side (OD-39/40/41) | **PARTIAL** | `FieldProvenanceLine.tsx` + test exist. Missing: `chosenConfirmedAt` column; **the staleness threshold has no value - an open OWNER decision, not a build**; touched-slugs tracker does not survive a restart |
| 22 | Document handling + download limits | **PARTIAL** | Row was stale: OD-37's other three limits are ALSO built with dedicated tests, not just the streaming cap — `resolveHostVerdict` (DNS-rebind fix, `company-host-source.ts:474`), the registrar host allow-list (`company-host-source.ts:756`), and cause-carrying refusal logging (`document-discovery-runner.ts:783-1036`), each tagged "item 22, OD-37" in the code and covered by `company-host-source-registrar-allowlist.test.ts` + `document-discovery-runner-download.test.ts`. `ENABLE_DOWNLOAD_STREAMING_CAP` (`feature-flags.ts:445`) is flag-gated code-complete; only its real-network staging proof is owed (#806) — an ops/deploy step, not a build. OD-36 is genuinely missing and confirmed by a repo-wide grep: no `partNumber`/`part_number` anywhere, no password-protected-PDF handling in `extract_filing.py`/`ocr_pages.py`, and no OCR-page-loses-a-disagreement rule in the field-priority path. Each needs a REAL fixture (a real multi-part filing, a real encrypted PDF) per the defect-fix contract — none exists in the repo today, so this is unbuilt, not unproven |
| 24 | Stage-gate deadlock | **BUILT** | PR #798 merged; #795 closed |
| 30 | Canonical IPO type table | **BUILT** | `docs/design/ipo-type-population.json` / `.md` |
| 31 | PR Spec-deviation block | **BUILT** | Landed as #813. **Card still reads NOT STARTED - card is stale** |
| 32 | Status line on every card + gate | **PARTIAL** | Gate built (`check-build-cards.mjs:142-156`) but **accepts the unknown shape as valid**, which is why 24 cards say nothing. #810 open |
| 33 | Repoint `check-dod.mjs` into CI | **PARTIAL** | Root refusal built (`check-dod.mjs:13-18`); CI wiring not. #829 open |
| 34 | `spec_ref` on every failure class | **BUILT** | `validateSpecRefs()` in `scripts/build-detection-registry.mjs` (refs `origin/main` @ 485f5285) requires the key on every entry (throws if missing), requires an array, and validates each ref against the spec's real heading list, refreshed per run; `docs/reviews/failure-classes/*.json` all 45 entries carry `spec_ref` (currently `[]`); `scripts/tests/build-detection-registry.test.mjs` has 5 cases proving the DoD (missing key refused, bad section refused, non-empty ref renders in the GENERATED table, empty ref renders cleanly, `--check` catches the drift); `node scripts/tests/build-detection-registry.test.mjs` = 10/10 pass. **Card `item-34-findings-spec-ref.md` still reads NOT STARTED - card is stale, same class as item 31** |
| 35 | Admin queue open count in nightly report | **BUILT** | #817 (`feat(ops): item 35 — admin queue open count in the nightly report`) merged to `main` as `fb02ec1d` 2026-09-19T18:13:30Z. `scripts/ops/admin-queue-size.mjs` (`adminQueueSize`, `formatAdminQueueBlock`) is imported and called at `scripts/audit-detection-floor.mjs:82,1937-1938` (`console.log('\n' + formatAdminQueueBlock(queue))`), and `audit-detection-floor.mjs --gate` is invoked by the nightly cron `scripts/vps-data-audit-cron.sh:149` (step 3/5) - built AND wired, not merely present. **Caveat, not a build gap:** the printed block reports raw `conflicts`/`absences` counts per IPO, not the actionable-vs-abstention split (measured 2026-09-19: of 14,140 open `data_conflicts` rows, 13,850 are one-sided abstentions, 133 are identical values, 157 are true value-vs-value disagreements) - #818's 28,120 headline number is still unsplit where it is read. Tracked as a residual, not re-opening the item: **#818** |

**Totals: 17 built, 11 partial, 1 not built, of 29 items.** (2026-09-21: item 17 NOT BUILT ->
BUILT, item 11 NOT BUILT -> PARTIAL. Derived per ROW by reading each row's verdict cell and
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
