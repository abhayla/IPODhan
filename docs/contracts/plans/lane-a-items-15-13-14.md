> Pre-made slice plan (supervisor, 2026-09-10). The build card, including its dated "Architect correction" block, wins where they differ.

# Lane A pre-made slice plans — items 15, 13, 14

Advisory. The build card and the owner decisions (design §0.0.1 / contract §"Pre-made design decisions") always win.
Verified against `origin/main` at `6c31d995` (2026-09-10). Line numbers below are from `git show origin/main:<path>`.

## Card/code contradictions found (resolve per decision 16 — a worker never resolves one by choosing)

| # | Card line | Code fact on origin/main | Action |
|---|---|---|---|
| C1 | item-13 Files row 1: "beyond `offerTotalMn === freshMn + ofsAtCapMn` **when both legs are present in the SAME document** (line 692)" | `filing-persister.ts:691-695` **computes** `offerTotalMn = statedTotalMn ?? (freshMn + ofsAtCapMn)`. There is no `===` comparison anywhere. When the document prints its own total AND both legs, the two are never compared. | The card overstates existing coverage; the same-document check is part of item 13's work, not pre-existing. Correct the card in item 13's close docs PR. |
| C2 | item-13 Files row 1 cites `:678-698`, row 2 `:887-897`, item-15 cites `:919-932` | Actual: `freshMn` at 679; `mark('freshIssue')` at 894-899; `valueActuallyChanged` at 929-931, `valueChanged` at 932 | Ranges drifted ≤7 lines. Use symbol names, never line numbers, in briefs. |
| C3 | item-14: "`docs/design/probes/fixtures/bse/GetMkt_ISSUE_BBS_IPO-7950.json` exists" | Exists, but is a single line with no trailing newline (`wc -l` = 0). | No action; do not read `wc -l` as "missing". |
| C4 | item-15 Files row 3: the orchestrator "surfaces per-cycle stats … not located this session" | `scraper/src/index.ts:532` already does `logger.info(getFeatureStatus(), …)` at startup; `data-consolidation-orchestrator.ts` (600 lines) is where per-cycle result aggregation lives. | Slice 15-S2 below closes the fork. |
| C5 | item-13/15 assume item 1's consolidated child-table writer exists | Not on main. Only its prerequisites merged (#444 #445 #448 #450 #453/#456 #455). Item 20's check merged (#460). | Both items must be re-based on item 1's final `data-consolidation-service.ts` / `filing-persister.ts`; do not start before item 1 is DONE. |

---

# Item 15 — revive `valueActuallyChanged` (Tier B item, 2 slices)

## Dependencies
- **From item 1, merged first:** the consolidated writer's final shape of `data-consolidation-service.ts` (item 1 Files table names this exact file) and of `data-consolidation-orchestrator.ts`. A counter added before item 1's rewrite will conflict on both files.
- **Lane B overlap:** item 21 Files names `scraper/src/services/data-consolidation-orchestrator.ts:90` and `scraper/src/index.ts` — **slice 15-S2 collides with item 21**. Item 21 is last in lane B's order; land 15-S2 first or coordinate.
- No overlap with items 20, 22, 18, 16, 8.

## Slices

| # | Title | R-ids | Files | Failing test (assertion, one line) | Lines | Tier | Flag |
|---|---|---|---|---|---|---|---|
| 15-S1 | Three-way write-reason counters beside `valueChanged` | R-061, R-062, R-063 | `scraper/src/services/data-consolidation-service.ts` (exists); `scraper/tests/unit/services/data-consolidation-noop-write-suppression.test.ts` (exists, 202 lines, 5 `it()`) | same source + value differing only by pg NUMERIC shape ⇒ `result.noopCounts.suppressedNoop === 1` and both written counters 0; same source + genuinely different value (`6800000000` vs `6900000000`) ⇒ `writtenSameSourceChanged === 1` | ~130 | **B, conditional** — B only if `git diff` shows the `const valueChanged = …` expression byte-identical; if that line changes at all it is a write-path change ⇒ **Tier A** (decision 6, "unsure A/B → A") | none (card: read/count-only) |
| 15-S2 | Emit the per-cycle counters on the consolidation cycle line | R-063 | `scraper/src/services/data-consolidation-orchestrator.ts` (exists, 600 lines); its unit test under `scraper/tests/unit/services/` (NEW if absent) | one cycle over two IPOs, one no-op and one real change ⇒ the emitted cycle object carries `{suppressedNoop:1, writtenSameSourceChanged:1}` summed across IPOs | ~110 | B | none |

- No slice writes or deletes rows, adds a migration, hook, CI job, scheduler change or repair tool.
- `NoopSuppressionCounts` shape per the card: `writtenNoExisting` · `writtenDifferentSource` · `writtenSameSourceChanged` · `suppressedNoop`.
- `PULL-NOOP`'s storage is **item 10's**, not this item's (design §4 line 2238). Do not add a per-cycle stats table here.

## Mutations a reviewer will try
- 15-S1: (a) flip `!areEquivalent(...)` to `areEquivalent(...)` ⇒ the "genuinely different value" case must go red; (b) drop the `!!existingValueFromMap &&` guard ⇒ the brand-new-field case must go red (it must count `writtenNoExisting`, not `writtenSameSourceChanged`); (c) increment `writtenSameSourceChanged` inside the `hadDifferentSource` branch too ⇒ the cross-source case must go red; (d) delete `suppressedNoop++` ⇒ the pg-NUMERIC case must go red.
- 15-S2: (a) sum only the last IPO instead of all ⇒ the two-IPO test must go red; (b) emit the counters but never reset them between cycles ⇒ a two-cycle test must go red.

## Staging proof
- Card claims none is owed; decision 10 still requires an item proof line. Use: the staging consolidation cycle log line printing `suppressedNoop` and `writtenSameSourceChanged` after 15-S2.
- **Obtainable without the owner: yes, conditionally.** No flag is added, and `scraper/src/index.ts:532` already prints `getFeatureStatus()`. **Unverified:** whether `ENABLE_DATA_CONSOLIDATION` / `CONSOLIDATION_PERCENTAGE` are non-zero on staging — read that startup line first; if consolidation is off on staging the item is MERGED-UNPROVEN and the owner is asked, not worked around.
- `writtenSameSourceChanged` being **0** on the first cycle is not a failure — F-49 says that branch has never been observed firing. Record the number, do not chase it.

---

# Item 13 — fresh/OFS extraction + reconciliation gate (F-51, Tier A item, 3 slices)

## Dependencies
- **From item 1, merged first:** `filing-persister.ts` (item 1 Files table names it) — the `mark()` path at 836 and the `withholdAll` pattern at 1120-1133 are both item 1 territory. Also depends on **item 2** (field manifest / priority config) per §7.1; item 2 runs *after* 13 in the contract's order (decision 3: 1, 20, 15, 13, 14, 12, 4, 2 …). **This is an ordering conflict** — the card says "depends on item 2", the contract order puts 2 eighth. Resolution: item 13 adds the gate inside `filing-persister.ts`'s existing path and does **not** touch `field-priority-matrix.ts`; the matrix entries `fresh_issue_size` (:277) / `offer_for_sale_size` (:286) stay unconsumed until item 2. Record this as the deviation; do not reorder.
- **Lane B overlap:** item 8 Files names `scraper/src/services/filing-persister.ts` and `scraper/src/config/field-priority-matrix.ts`; item 21 also names `filing-persister.ts`. **13-S2 collides with item 8.**
- Out of scope by F-51's own `fix_in`: repairing the already-wrong live rows. That is a separate contract (decision 12).

## Slices

| # | Title | R-ids | Files | Failing test (assertion) | Lines | Tier | Flag |
|---|---|---|---|---|---|---|---|
| 13-S1 | `reconcileFreshAndOfs` as a standalone pure module | R-068, R-069 | `scraper/src/services/fresh-ofs-reconciliation.ts` (**NEW** — keeps S1 off the write path and satisfies decision 13's module rule; add item 20's import-direction test in this slice); `scraper/tests/unit/services/fresh-ofs-reconciliation.test.ts` (**NEW**) | `{fresh: 60cr, ofsDirect: 995.74cr, total: 1055.74cr}` ⇒ `ok:false` and `reason` names both figures; `{fresh: 300cr, ofs: 755.74cr, total: 1055.74cr}` ⇒ `ok:true`, `deltaPct <= 0.5` | ~200 | B | none |
| 13-S2 | Wire the gate: withhold `freshIssue` **and** `ofsIssue` together on failure | R-066, R-067, R-070 | `scraper/src/services/filing-persister.ts` (exists, 1881 lines — the `mark()` calls at 894-899 and the `offerTotalMn` block at 679-700); `scraper/tests/unit/services/filing-persister.test.ts` (exists, 2206 lines) | given a real fixture whose fresh leg is digit-wrong, **neither** `ipo_details.freshIssue` nor `ipo_details.ofsIssue` appears in the written columns and `skippedFailedCheck` names the reconciliation; fresh-only offering (no OFS anywhere) ⇒ gate does **not** fire | ~150 | **A** (write path decides what is persisted) | none new — already inside `ENABLE_FILING_AUTO_PERSIST` (`feature-flags.ts:212`) |
| 13-S3 | Independent nightly check `c_fresh_ofs_reconciliation` | R-070 | `docs/reviews/detection-checks/c_fresh_ofs_reconciliation.json` (**NEW**, `"section": "checks"`); `scripts/audit-detection-floor.mjs` (exists, 1474 lines — add `record('c_fresh_ofs_reconciliation', …)` beside `c_issue_size_floor` at :411); regenerate `docs/reviews/detection-checks.json` + `docs/reviews/failure-classes.md` via `node scripts/build-detection-registry.mjs`; `scripts/tests/audit-detection-floor.test.mjs` (exists) | rows with both `freshIssue` and `ofsIssue` non-null and `|fresh+ofs-issueSize|/issueSize > 0.005` ⇒ check returns FAIL and lists the slugs; a row with one leg null ⇒ not counted | ~170 | **A** (CI/detection gate) | n/a |

**Real fixture (defect-fix-contract R2, required):** reuse `docs/design/probes/fixtures/extraction/asset-reconstruction-company-india-ltd-RHP.json` and `…-DRHP.json` and `vinod-texworld-ltd-DRHP.json` on main. Do **not** hand-type a filing format. If none of the three carries both a fresh and an OFS statement, that is a BLOCKER to name, not a reason to synthesize.

## The six defect-fix-contract items (one line each, for the PR bodies of 13-S2 and 13-S3)
- **RCA:** `filing-persister.ts` computes `offerTotalMn` from the two legs instead of checking them against a total, so a digit-wrong `fresh_issue_amount` reconciles against a number derived from itself.
- **Class:** every IPO of any segment and any status whose `ipo_details.freshIssue`/`ofsIssue` are written by the document extractor — rows already written before the fix and every row the persister writes after it.
- **Failing test first:** 13-S2's digit-wrong-fresh fixture case, red on `origin/main` + test-only (decision 4's red-line worktree), green after.
- **Fix at class level:** the gate sits in the single `mark()` path both legs pass through, not per-IPO; matrix ranks untouched.
- **Real-data proof:** the staging cycle line below (13-S2) and `node scripts/audit-detection-floor.mjs` against `ipodhan_staging` through the tunnel (13-S3).
- **Detection upgrade:** `c_fresh_ofs_reconciliation`, reads `ipos`/`ipo_details` only — independent of any write path, so it also catches item 1's new writer.

## Mutations a reviewer will try
- 13-S1: (a) widen the tolerance from 0.005 to 0.05 ⇒ the Kanohar-shaped case must go red; (b) return `ok:true` when `totalRupees` is null ⇒ the missing-total case must go red; (c) compare against `freshRupees` alone instead of the sum ⇒ the OFS-only case must go red.
- 13-S2: (a) withhold `ofsIssue` only, keep `freshIssue` ⇒ the both-withheld assertion must go red; (b) call the gate after `mark()` instead of before ⇒ the "neither column written" assertion must go red; (c) treat a `null` OFS leg as `0` ⇒ the fresh-only-offering case must go red (false positive); (d) drop the `skippedFailedCheck.push` ⇒ the reason-reported assertion must go red.
- 13-S3: (a) change the check's SQL to `OR` instead of `AND` on the non-null legs ⇒ the one-leg-null case must go red; (b) make the check `PASS` on zero rows examined ⇒ a fixture with zero eligible rows must be asserted as SKIP, not PASS.

## Staging proof
- Card's line: `{ ipoId, freshIssue, ofsIssue, reconciled: true, deltaPct }` with `deltaPct <= 0.5` from a real staging filing extraction; plus the same line with `reconciled:false` and both fields absent for a deliberately-broken fixture.
- **Obtainable without the owner: conditional.** It needs `ENABLE_FILING_AUTO_PERSIST` true on staging. The run may not edit server env files (decision 11). `scraper/src/index.ts:532` already prints the flag, so **read the staging startup line first**; if it prints `FILING_AUTO_PERSIST: false`, the item is MERGED-UNPROVEN and the owner is asked to set it on staging. **Do not** convert this flag to the slot-aware default as a workaround — it is (per session memory) already on in prod, and a slot default would silently turn it off there.

---

# Item 14 — BSE share-count → rupees (F-54, Tier B item, 1 slice + a docs close)

## Dependencies
- Nothing from item 1. §7.1 lists a dependency on item 13; per the card that is conceptual (13's gate consumes 14's total), **not** a code dependency. Item 14 can build the moment item 13's last slice merges.
- **Lane B overlap:** item 16 (retire Moneycontrol) Files names `scraper/src/config/field-priority-matrix.ts` and `scraper/src/config/feature-flags.ts`. Item 14 only **reads** the matrix (verify-only, no edit), so no collision as long as the diff touches neither file.

## Slices

| # | Title | R-ids | Files | Failing test (assertion) | Lines | Tier | Flag |
|---|---|---|---|---|---|---|---|
| 14-S1 | Lock the extractor↔floor-check alignment | none (card: this item implements no numbered rule) | `scraper/tests/unit/scrapers/bse-api-scraper.test.ts` (exists, 343 lines — extend); reads `docs/reviews/detection-checks/c_issue_size_floor.json` (exists, 11 lines) | the smallest plausible SME BSE payload (min share count × min floor price) run through `computeBSEIssueSize` clears `c_issue_size_floor`'s SME `failThreshold` read **from the JSON at test time**, not a copied literal | ~70 | B | `ENABLE_BSE_API`, already ON in prod; no new flag |

- **No source change.** `computeBSEIssueSize` (`bse-api-scraper.ts:148-152`) and `buildScrapedIPO` (`:262-286`, one call site, `band.min`) stay untouched — verified this session.
- Step 1 of the slice is to **run** `cd scraper && npx vitest run tests/unit/scrapers/bse-api-scraper.test.ts` and paste the pass as the PR body's baseline (supervisor-verification: "tests already exist" is a claim, not proof).
- Item close (Tier C, coordination worktree docs PR, not a slice): correct item-14's card and F-54's framing — the extractor half shipped with W-109/round-8; and flag to item 10's owner that `c_issue_size_consistency` / `c_issue_size_floor` (`audit-detection-floor.mjs:411,413`) must keep running after items 1-10.
- **Detection:** `No detection change: both c_issue_size_consistency and c_issue_size_floor already read the ipos table independently of any write path.` (≥20 chars — required, `recurrence-detection-gate.md`, because the slice touches no `scraper/src/scrapers/**` source but the reviewer will look for the line).

## Mutations a reviewer will try
- (a) Hard-code the SME floor threshold in the test instead of reading the JSON ⇒ mutate the JSON threshold and the test must still go red; (b) pass `band.max` to `computeBSEIssueSize` ⇒ the existing W-109 regression at `:113-130` must go red; (c) delete the zero-guard's `!priceFloor` ⇒ the zero-guard test must go red.

## Staging proof
- Card's line: `node scripts/audit-detection-floor.mjs` against staging after a real BSE cycle — `c_issue_size_consistency` and `c_issue_size_floor` both PASS with zero BSE-sourced violations; cross-check one BSE row's `issue_size / (shares × band floor) ≈ 1.0`.
- **Obtainable without the owner: yes.** Read-only through the tunnel against `ipodhan_staging`; no flag flip, no env change, no repair.

---

# Pipelining

**The contract forbids it.** Decision 2: "One item at a time; slices one at a time." Nothing below may be built concurrently without an owner decision that relaxes decision 2. Recorded only so the answer is on file if he does:

| Pair | Share any file? | Would be safe? |
|---|---|---|
| 15-S1 ∥ 15-S2 | no (`data-consolidation-service.ts` vs `-orchestrator.ts`) | yes, but S2 asserts on S1's counters — sequence anyway |
| 13-S1 ∥ 13-S3 | no (NEW module vs audit script + registry) | yes |
| 13-S1 ∥ 14-S1 | no | yes |
| 13-S3 ∥ 14-S1 | no (audit script vs bse test) — but both regenerate/read the detection registry | only if 14-S1 adds no registry entry (it adds none) |
| 13-S2 ∥ anything in item 13 | yes (`filing-persister.ts`) | no |

---

# Known traps (all three items)

- **Migration ⇒ journal-count fixture.** None of these three items has a schema change; if one appears, bump `scraper/tests/unit/pipeline-stages/fixtures/stage-0/expected-schema.json` in the same slice or stage 0 goes red.
- **`docs/ops/prod-ops-recipes.md` is CRLF.** Append with CRLF endings or the diff rewrites the file.
- **No password in any file, PR body, ledger line or board write** (contract §"Commit + push policy"). Read `IPODHAN_APP_DB_PASSWORD` into an env var in a separate step, reference by name.
- **`node --test` on a glob matching nothing exits 0 (#461).** 13-S3 runs `node --test scripts/tests/audit-detection-floor.test.mjs` and `node --test scripts/tests/build-detection-registry-parity.test.mjs` by explicit path and asserts the test count is non-zero.
- **The schema-drift check ignores indexes** until lane A's hardening slice lands — do not read a green `audit:schema-drift` as index coverage.
- **Detection-change declaration** is required for any PR touching `scraper/src/services/**` or `scraper/src/scrapers/**` (13-S2 and, if it ever changes source, 14-S1): either a changed check file or `^No detection change: <20+ chars>$` in the PR body, else `detection-change-gate` fails.
- **Registry layout (T-487):** never hand-edit `docs/reviews/detection-checks.json` or the table in `docs/reviews/failure-classes.md`. Add `docs/reviews/detection-checks/<id>.json`, run `node scripts/build-detection-registry.mjs`, commit both. A check specified before `record('<id>'` exists goes in `"section": "notCoveredByThisManifest"` or `audit-detection-floor.test.mjs` case 79 fails.
- **Red line via a second worktree, never `git stash`** (a PreToolUse hook blocks stash in linked worktrees). `wt-new.ps1 -Name IPODhan-red-<item>-<slice> -Base origin/main -TtlHours 4`, then `wt-rm.ps1 -Discard`.
- **Line numbers in the cards have drifted** (C2 above) and will drift again once item 1's writer lands. Brief workers with symbol names.
- **Gate on exit codes, never on grepping output for the word "fail".**
