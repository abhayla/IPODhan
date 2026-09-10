> Pre-made slice plan (supervisor, 2026-09-10). The build card, including its dated "Architect correction" block, wins where they differ.

# Lane C pre-made slice plans — items 12, 2, 3 (lane C order: 14, 12, 2, 3)

Advisory. The build card and the owner decisions (design §0.0.1 / contract §"Pre-made design decisions") always win.
Verified against `origin/main` at `40889f8a` (2026-09-10). Use symbol names in briefs, never line numbers.

**Item 14's slice plan is in `lane-a-items-15-13-14.md` (§"Item 14") and is now LANE C's** — build it first, unchanged,
except: its dependency line says "the moment item 13's last slice merges"; item 13 is LANE A's. Lane C's 14-S1 touches no
lane-A file (it is a test-only extension of `scraper/tests/unit/scrapers/bse-api-scraper.test.ts`), so it does **not** wait
for item 13 — record that deviation in the ledger.

Lane C's contract mirrors `docs/contracts/2026-09-10-pull-model-implementation-lane-b.md`: own coordination worktree,
own lock (`.run-active-c.lock`), own ledger branch, own test DB (`ipodhan_test3` via `scripts/ops/test-db-lifecycle.mjs`
— never `ipodhan_test` or `ipodhan_test2`), pipelining only between slices with an empty `git diff --name-only`
intersection, rebase before every PR, `[lane C]` in every PR title, own daily PR-gate cap under the shared 60.

## Card/code contradictions (parent decision 16 — a worker never resolves one by choosing)

| # | Card line | Code fact on origin/main | Action |
|---|---|---|---|
| C1 | item-12 Files: "`scraper/src/services/document-discovery-runner.ts` … New step: after a candidate IPO row is created/matched at discovery" | That file (2158 lines) **never creates an `ipos` row** — it iterates IPOs already in the DB to discover documents; it imports only `compactCompanyNameKey`, for a cache key. IPO identity resolution lives in `packages/shared/src/repositories/ipo-identity.ts` (`resolveIpoRow`, 500 lines; tiers ISIN → symbol → normalized name → 3b prefix → fuzzy). | Build the duplicate check in `ipo-identity.ts`, not the discovery runner. Correct the card in item 12's close docs PR. |
| C2 | item-12: "no rows are merged or deleted by item 12 itself … rollback has nothing destructive to undo" | Since #445/#448/#455 the normaliser's output is **persisted**: `rowKeyForName()` is `normalizeCompanyNameForMatching` on the normal path, and its result is stored in `promoters.normalized_name`, `peer_companies.normalized_name`, `ipo_intermediaries.normalized_name`, each under a `UNIQUE (ipo_id, normalized_name)`. Changing the normaliser silently re-keys those rows and can make two existing rows collide on that constraint. | Item 12 gains a mandatory backfill slice (12-S4) and a pre-merge violation query. Not optional. |
| C3 | item-12 Files: the agreement test "not located this session" | Both exist: `packages/shared/src/utils/company-name-normalizer.test.ts` and `scraper/tests/integration/company-name-normalizer-agreement.integration.test.ts` (the TS↔SQL lock-step test). | No fork. If the integration test changes it must be named in the `scraper-document-integration` job's run line in the same PR (decision 8). |
| C4 | item-12: F-46's binding site "whether it already has partial ambiguity handling or none is unverified" | `investorgain-gmp-orchestrator-v2.ts` binds by **exact open+close date first**, then on multiple date matches by a **character-similarity score with a 0.6 accept threshold** (`matchIPOByDates`). The design's rule is "exact match only … never substring, edit-distance, or closest". | Replacing it is a live behaviour change (GMP rows may stop binding). Flag-gated slice 12-S7, last, Tier A. |
| C5 | item-02: "`.yaml` + a JSON Schema … ajv, draft-07" | Neither `ajv` nor `yaml` is a dependency of `scraper/package.json`, the root `package.json`, or `packages/shared` (`zod ^4.1.11` is present in scraper). | Recommend JSON + `ajv` (one new dep, matches OD-5's literal `config/field-sources.json` and item 22's `.json` allow-list). Card deviation, not an owner fork. |
| C6 | item-03 Files row: "`data_conflicts` production rows with `field_name = 'listingExchange'`" vs its own Schema block `DELETE FROM field_sources …` | The two name different tables. `grep -rn "'listingExchange'" scraper/src` = 0 write sites either way. | Measure BOTH tables through the tunnel before the tool is written; the tool touches only the table the count proves. |
| C7 | item-03 names the repair script `repair-listing-exchange-singular-provenance.mjs` | `scripts/ci/require-repair-tool-module.mjs` matches `^(repair|backfill)-.*\.ts$` under `scraper/scripts` — a `.mjs` file evades the guard lint entirely. | The tool is `scraper/scripts/repair-listing-exchange-singular-provenance.ts`, importing `lib/repair-tool.ts` and calling `openRepairDb()`. |
| C8 | Lane B contract scope: "16 → … `field-priority-matrix.ts` (rank rows the card names)" | item-16's own Files table says of `field-priority-matrix.ts`: **"No change in this item."** | Item 16 does NOT edit the matrix. Lane C owns every matrix hunk (items 2 and 3). Re-confirm at every rebase; do not assume. |
| C9 | item-03: "13 dead snake_case keys" (design §0.6) vs the card's measured 27 | Re-measured this session: `FIELD_PRIORITY_MATRIX` has **77** keys, exactly **27** contain an underscore, and the 27 are the card's list verbatim. | The card's 27 is right; its C-1 stands as a card-local decision (recommendation: 27). |

Shared duties lane C NEVER builds (lane A owns all, in flight): the slot-aware flag helper + `DEPLOY_SLOT` in
`scripts/deploy-linux.sh` / `scripts/assert-env-keys.sh`, `ci.yml` hardening, `.gitattributes`, schema-drift index
coverage. Verified this session: `git show origin/main:scraper/src/config/feature-flags.ts | grep -c DEPLOY_SLOT` → **0**
on a 477-line file, so the helper is NOT merged. **Every flag slice below is GATED on that PR and rebases onto it.**

---

# Item 12 — name fold + duplicate detection at identity time (Tier A item, 7 slices)

## Dependencies
- **On main first:** item 14 done (lane C's own order). Lane A's flag-helper PR before 12-S5 and 12-S7.
- **Files shared with item 1 (lane A, IN FLIGHT — never touch):** `data-consolidation-service.ts`, `data-consolidation-orchestrator.ts`, `filing-persister.ts`, `anchor-persister.ts`, `data-persister.ts`, `packages/shared/src/repositories/field-sources-repository.ts` + its `web/lib/repositories/` twin, and the `data_conflicts` repository. Item 1 **reads** `company-name-normalizer.ts` as its row-key function and does not change it — item 12 changes it. Sequence: land 12-S2 + 12-S4 **before** item 1's writer slices, or rebase item 1 onto them; announce the merge in the ledger so lane A re-runs its row-key tests.
- **Item 16 (lane B):** no overlap (C8).
- **The merge write path is fixed:** `scraper/scripts/repair-merge-duplicate-ipo.ts` (item 19, DONE) → `IPORepository.mergeDuplicateInto` → helpers in `packages/shared/src/utils/duplicate-ipo-merge.ts`. **No slice below opens a new SQL merge path** (write ratchet + `config/write-ratchet-baseline.json`). Any row merge this item surfaces is routed to that tool, on the owner's word for prod.
- Out of scope, stated: auto-merge-on-converging-identifier (§2.3.3.1), `ipos.company_id`, `ipos.sebi_observation_date`, and a table for AMBIGUOUS/UNBOUND outcomes — the card's own owner fork. **12-S5/S7 record outcomes as structured log lines only** (`resolveIpoRow` already emits `identity_conflict`); a table needs an `O-nn`.

## Slices

| # | Title | R-ids | Files (E=exists, N=new) | Failing test (assertion) | Lines | Tier | Flag |
|---|---|---|---|---|---|---|---|
| 12-S1 | One fold function; three copies collapsed | R-039, R-167 | N `packages/shared/src/utils/company-identity-fold.ts`; E `packages/shared/src/utils/duplicate-ipo-merge.ts` (`foldCompanyName` re-exports it, body deleted); N `…/company-identity-fold.test.ts`; N parity test that `scripts/lib/repair-invariants/duplicate-ipo-rows.mjs`'s `foldName` agrees on a 20-name fixture (that `.mjs` keeps its own copy — plain-node script, cannot import TS) | the ARCIL pair folds equal; `Sun Pharmaceutical Industries Ltd` and `Sunrise Pharmaceutical Industries Ltd` fold DIFFERENT; the `.mjs` and the TS agree on all 20 fixture names | ~180 | B | none |
| 12-S2 | Whole-word fold inside the binding normaliser, TS and SQL in lock-step | R-036, R-167, R-032 | E `packages/shared/src/utils/company-name-normalizer.ts` (`normalizeCompanyNameForMatching`'s suffix chain → whole-word strip, run AFTER `[()]`→space; `normalizedCompanyNameSql` changed in the same commit); E `…/company-name-normalizer.test.ts`; E `scraper/tests/integration/company-name-normalizer-agreement.integration.test.ts` (+ its run line in `pr-gate.yml`) | `normalizeCompanyNameForMatching("ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED") === normalizeCompanyNameForMatching("Asset Reconstruction Co.(India) Ltd.")`; every existing case still passes; TS output === SQL output on all fixtures | ~200 | **A** (identity — what binds to what) | none (correctness-only) |
| 12-S3 | Zero-false-merge proof over real names | R-039 | N `scripts/audit/fold-collision-report.mjs` (read-only, carries a `// repair-tool-exempt:` line) | run over the real prod + staging `ipos.company_name` list: the NEW fold yields the OLD fold's group count plus exactly the intended ARCIL-shape merges, listed BY NAME (signal-ownership R1) | ~120 | B | n/a |
| 12-S4 | Re-key the three persisted `normalized_name` columns | R-167 | E `scraper/scripts/backfill-normalized-name.ts` (exists — re-run path + dry-run/idempotency assertions); N `scripts/lib/repair-invariants/normalized-name-current.mjs` | a row whose stored `normalized_name` differs from `rowKeyForName(name)` under the new fold is reported by the dry run and repaired by `--apply`; a second `--apply` changes 0 rows | ~150 | **A** (repair tool, writes rows) | none |
| 12-S5 | Duplicate candidates at identity time — flag only, never merge | R-032, R-034, R-035, R-038, R-177 | E `packages/shared/src/repositories/ipo-identity.ts` (after the tier chain in `resolveIpoRow`: fold + open-date scan over LIVE rows → structured `duplicate_candidate` log; return value unchanged); E `scraper/src/config/feature-flags.ts` (flag line only); E `packages/shared/src/repositories/ipo-identity.test.ts` | two live rows folding equal with the same `open_date` ⇒ one `duplicate_candidate` log naming BOTH slugs, and `resolveIpoRow`'s returned row byte-identical to today's; different open dates ⇒ no log | ~180 | **A** | `ENABLE_DISCOVERY_DUPLICATE_CHECK` (**GATED** on lane A's helper) |
| 12-S6 | CIN as an identity tier, above the name tiers | R-041, R-042, R-177, R-178 | E `packages/shared/src/repositories/ipo-identity.ts` (`cin?` on `IpoIdentity`; tier 0 exact CIN before ISIN); E `packages/shared/src/repositories/ipo-repository.ts` (`findByCin`, NULL-safe); E their tests | a non-empty CIN matching exactly one row wins over a disagreeing name match and logs `identity_conflict`; a NULL/empty CIN on either side never matches; two rows sharing a CIN ⇒ AMBIGUOUS, no bind, both names logged | ~220 | **A** | same flag |
| 12-S7 | List-row binding: BOUND / AMBIGUOUS / UNBOUND, no fuzzy | R-032, R-033, R-036, R-053 | E `scraper/src/scrapers/investorgain-gmp-orchestrator-v2.ts` (`matchIPOByDates` → symbol → ISIN → exact normalized name; the 0.6-similarity path removed behind the flag); E its unit test | two date-matching candidates ⇒ `AMBIGUOUS`, **no GMP row written**, both names logged (today the 0.61-similar one is written); zero candidates ⇒ `UNBOUND` logged, not an error; a bound row whose open/close date disagrees ⇒ nothing written | ~200 | **A** | `ENABLE_STRICT_LIST_BINDING` (**GATED**) |

## Defect-fix contract (12-S2, 12-S4, 12-S5, 12-S7 PR bodies — one line each)
- **RCA:** the binding normaliser strips `company`/`co` only when they are the LAST token, but the trailing-parens rule runs once, before the suffix chain, so in `… Co.(India) Ltd.` the corporate-form word is never last when its own regex fires.
- **Class:** every `ipos` row of any status, segment and offering type whose identity is resolved by name — rows written before the fix (re-keyed by 12-S4, flagged by 12-S5) and every row `resolveIpoRow` touches after it; plus every `promoters` / `peer_companies` / `ipo_intermediaries` row whose `normalized_name` was minted by the old fold.
- **Failing test first:** 12-S2's ARCIL equality case, red on `origin/main` in a `-red-` worktree with only the test file applied.
- **Fix at class level:** one fold function (12-S1) used by the normaliser, the SQL twin and the merge helper; no per-name special case, no slug list.
- **Real-data proof:** 12-S3's report over real prod + staging names, then `node scripts/assert-repair-held.mjs scripts/lib/repair-invariants/duplicate-ipo-rows.mjs --cycles 2` on staging.
- **Detection upgrade:** `duplicate_ipo_at_discovery` — fold + open-date collision over LIVE rows, as `docs/reviews/detection-checks/duplicate_ipo_at_discovery.json` (`"section": "checks"`) with its `record('duplicate_ipo_at_discovery', …)` call in `scripts/audit-detection-floor.mjs`, then `node scripts/build-detection-registry.mjs`, both files committed. **Fold it into 12-S6's PR** (it reads `ipos` only, independent of every write path). `No detection change:` is not available to this item — the gate's paths cover `scraper/src/scrapers/**`.

## Mutations a Tier A reviewer will try
- **12-S2:** (a) restore the suffix anchor `\s+company$` ⇒ the ARCIL case must go red; (b) change the TS fold but not `normalizedCompanyNameSql` ⇒ the agreement integration test must go red; (c) add `industries` to the word list ⇒ the "Sun vs Sunrise stay distinct" case must go red; (d) fold `and`/`the`/`of` in the BINDING key but not the de-dup key ⇒ the parity test must go red.
- **12-S4:** (a) make `--apply` the default ⇒ the dry-run-default test must go red; (b) key the backfill on row id instead of name ⇒ the "second `--apply` changes 0 rows" assertion must go red; (c) skip rows whose `normalized_name` is `''` ⇒ the legacy default-`''` case must go red.
- **12-S5:** (a) return the duplicate row instead of logging ⇒ the "return value byte-identical" assertion must go red; (b) drop the `open_date` equality ⇒ the different-open-dates case must go red (false positive); (c) scan all statuses instead of the four LIVE ones ⇒ a WITHDRAWN-pair fixture must go red.
- **12-S6:** (a) treat an empty-string CIN as a key ⇒ the NULL-safety case must go red; (b) put the CIN tier below the name tier ⇒ the disagreement case must go red; (c) bind the first of two CIN-sharing rows ⇒ the AMBIGUOUS case must go red.
- **12-S7:** (a) reinstate the 0.6 threshold ⇒ the two-candidate case must go red; (b) make `UNBOUND` throw ⇒ the zero-candidate case must go red; (c) skip the open/close-date cross-check ⇒ the date-disagreement case must go red.

## Pipelining pairs (no shared files; parent decision 2 as amended by lane B decision 2)
- 12-S1 ∥ 12-S3 (new shared module vs a new read-only script). 12-S3 ∥ 12-S4 (report vs `scraper/scripts`). 12-S6 ∥ 12-S7 (`ipo-identity.ts`/`ipo-repository.ts` vs the GMP orchestrator) — but S7's fixtures assume S6's tiers, so sequence unless S7 stubs them.
- **Never** 12-S5 ∥ 12-S6 (both edit `ipo-identity.ts`); never 12-S1 ∥ 12-S2 (both edit the fold); never any pair while item 1's writer PR is open (no file overlap, but a lane-A merge invalidates a green gate).

## Real fixtures
- **Duplicate-name pairs, read-only through the tunnel** (standing approval; password read into `IPODHAN_APP_DB_PASSWORD` in a separate step, referenced by name, never written to a file):
  `psql "postgresql://ipodhan_app:${IPODHAN_APP_DB_PASSWORD}@localhost:15432/ipodhan_staging" -c "select id, slug, company_name, open_date, status from ipos where status in ('UPCOMING','OPEN','CLOSED','LISTED') order by company_name"` → run both folds locally over the result. Repeat against `ipodhan` (read-only) for the class check. Staging is expected to report **12 groups** of a *different* defect (F-57 slug-suffix rows) — that number is the design's, not re-measured; record what the run actually reads, do not chase the 12.
- Freeze the pairs found as a checked-in fixture (public company names only, no PII) under `packages/shared/src/utils/__fixtures__/`, so the unit tests never need the tunnel.

## Staging proof (card's line) — obtainable without the owner?
- Card's line: the duplicate-invariant count before/after, plus `node scripts/assert-repair-held.mjs scripts/lib/repair-invariants/duplicate-ipo-rows.mjs --cycles 2` (`DUPLICATE_INVARIANT_FOLDS=<the folds this item touched>` narrows it, per that file's own header).
- **12-S1..S4 and 12-S3's report: yes** — read-only tunnel plus a staging `--apply` of the backfill, which decision 12 permits through the repair tool's own guard.
- **12-S5, S6, S7: conditional.** Their flags are slot-aware, so they cannot be ON on staging until lane A's `DEPLOY_SLOT` PR is merged and the staging cycle log prints the slot. Until then they are **MERGED-UNPROVEN** and the landing note asks the owner; never edit a server env file, never hand-default a flag to `true`.
- Prod row merges stay the owner's: the exact command goes in the ledger with the staging dry-run output attached, run by the owner or in his presence.

---

# Item 2 — field manifest and priority configuration (Tier B item, 4 slices)

## Dependencies
- **`scraper/config/` does not exist on main** (verified). **Lane B's item 22 slice 22-2 creates it and its JSON-schema loader (`scraper/src/config/download-allowlist.ts`), and item 22 is earlier in lane B's queue than item 2 is in lane C's** — lane B almost certainly lands first. **2-S1 is SKIP-IF-EXISTS:** before cutting it, read `origin/main:scraper/src/config/` and 22-2's loader; if it is generic enough, item 2 imports it and 2-S1 becomes a one-line ledger note. If 22-2 hard-codes the allow-list shape, 2-S1 extracts the generic core **without changing 22-2's public signature**, and rebases. Either way there is **exactly one** `loadValidatedConfig` in the tree — a second copy is a MAJOR review finding for whichever lane writes it second. Post one Notifier line naming the file when either lane lands it.
- A new module ⇒ the import-direction test from item 20 (merged, #462) is added in the slice that creates it (decision 13, R-143/R-144).
- Files shared with item 1: none. With item 3: `field-priority-matrix.ts` — **item 2 does not touch it** (the card says so); every matrix hunk is item 3's.
- `scraper/src/index.ts` is also edited by lane B's item 16 (source registry, CLI allow-list, the `--source=all` block). 2-S3 touches only the CLI guard at the bottom of the file — the smallest possible hunk; rebase immediately before the PR.

## Slices

| # | Title | R-ids | Files | Failing test (assertion) | Lines | Tier | Flag |
|---|---|---|---|---|---|---|---|
| 2-S1 | **SKIP-IF-EXISTS** — one validated-config loader for `scraper/config/` | R-142, R-143, R-144 | N `scraper/src/config/validated-config-loader.ts` (`loadValidatedConfig<T>(configPath, schemaPath): T`, ajv draft-07 strict, throws naming file + JSON pointer); E `scraper/package.json` (add `ajv`, exact version, lockfile committed); N `scraper/tests/unit/config/validated-config-loader.test.ts`; N import-direction test | a config violating its schema throws an error naming the FILE and the failing JSON pointer, not a bare `data/0 must be object` | ~160 | B | none |
| 2-S2 | The manifest file, its schema, and the capability cross-check | R-054, R-055, R-153, R-154, R-155 | N `scraper/config/field-manifest.json` (the card's three worked rows verbatim, JSON not YAML — C5); N `scraper/config/field-manifest.schema.json`; N `scraper/src/config/field-manifest-loader.ts` (thin over 2-S1 + the cross-check); N `scraper/tests/unit/config/field-manifest-loader.test.ts` | a row whose `rank[]` names a source with `capability.<source>.capable: false` throws an error naming **that field and that source**, distinct from the schema error; an unknown `class` throws; a well-formed file returns the typed object | ~220 | B | none |
| 2-S3 | Validate at process start | R-055, R-169 | E `scraper/src/index.ts` (call inside the CLI guard, **before** `main()`); E `scraper/src/config/feature-flags.ts` (flag line only); N unit test on the ordering | with a deliberately malformed manifest the process exits non-zero **before** any cycle-start log line is emitted (assert on ordering, not on the exit code alone) | ~90 | **A** (entrypoint / scheduler path) | `ENABLE_FIELD_MANIFEST`, default OFF everywhere (**GATED** on lane A's helper) |
| 2-S4 | Seed the manifest for the 16 live Group-C fields + a config-diff test | R-118, R-126, R-127, R-128, R-129, R-130, R-131 | E `scraper/config/field-manifest.json`; N `scraper/tests/unit/config/field-manifest-content.test.ts` | every one of item 3's 16 Group-C `table.column` keys has an entry whose `rank[0]` and `unit` match `docs/design/field-source-resolution.spec.mjs`'s output for that field; a row naming `MONEYCONTROL` in a rank is LISTED by the test as a known pending decision (card C-1), not silently accepted | ~250 | B | none |

- **Do not** put the full 190-field manifest in one slice. 2-S4 covers exactly the 16 fields item 3 needs, so item 3 can delete their dead keys without regressing them; the rest is a later, unscheduled slice.
- The card's C-1 (drop `MONEYCONTROL` from every rank in the same pass as item 16, or keep it as a documented no-op rank) is a **card-local decision, not an owner fork**: apply the card's recommendation (drop it) only in item 3, where the matrix is actually edited; item 2 records the pending rows in the 2-S4 test. `MONEYCONTROL` appears 83 times in the matrix today.
- **Detection:** `No detection change: item 2 adds a config file and a loader that no write path reads until item 3 flips ENABLE_FIELD_MANIFEST; item 3 carries the manifest-vs-matrix drift check.` (verbatim, ≥20 chars, in every item-2 PR body.)

## Mutations a reviewer will try
- **2-S1:** (a) swallow the ajv error and return the raw parsed object ⇒ the malformed-config test must go red; (b) drop `strict` mode so unknown keys pass ⇒ an unknown-key fixture must go red.
- **2-S2:** (a) run the capability cross-check before the schema validation ⇒ the "distinct error message" assertion must go red; (b) check only `rank.MAINBOARD` ⇒ an `SME_NSE`-only violation fixture must go red; (c) let a missing `MAINBOARD` key default to `[]` ⇒ the required-key test must go red.
- **2-S3:** (a) move the call after `main()` ⇒ the ordering assertion must go red; (b) wrap it in try/catch and log ⇒ the non-zero-exit assertion must go red.
- **2-S4:** (a) change one field's `rank[0]` in the JSON ⇒ the content test must go red (proves it reads the file, not a copied literal).

## Pipelining pairs
- 2-S1 ∥ nothing (everything else imports it). 2-S2 ∥ nothing (2-S3 and 2-S4 both read the file it creates). 2-S4 ∥ 3-S1 (JSON content vs matrix deletions — no shared file) is the one genuinely safe cross-item pair, and only once item 2 has closed (parent decision 2: no second item before the current one is DONE or BLOCKED).

## Real fixture — "a real manifest diff"
- `node docs/design/field-source-resolution.spec.mjs` (exists on main) is the generator of record (`generatedFrom` in the card's own interface). Run it, diff its per-field rank output against the live `FIELD_PRIORITY_MATRIX` extracted from `scraper/src/config/field-priority-matrix.ts`, and commit that diff as the fixture 2-S4's test reads. **No DB and no tunnel needed** — fully obtainable offline.
- Where the two disagree, the spec wins for the manifest and the disagreement is listed in item 3's PR body (item 3 is where the matrix changes).

## Staging proof — obtainable without the owner?
- Card's line: after deploy with `ENABLE_FIELD_MANIFEST=false`, `pm2 logs ipodhan-scraper --lines 20` at the next scheduled wake shows the normal cycle-start line and **no new error** — proving the loader import does not throw when unused.
- **Yes, without the owner** — read-only per `docs/ops/prod-ops-recipes.md` §2; no flag flip, no env change. (The proof that the manifest governs a write belongs to item 3.)

---

# Item 3 — matrix cleanup (mixed-tier item, 5 slices)

## Dependencies
- **Item 2 fully merged first** (3-S3 imports `loadFieldManifest`; 3-S1/3-S2 do not).
- **Item 1 (lane A, IN FLIGHT):** 3-S3 edits `scraper/src/services/data-consolidation-service.ts`, which item 1 **rewrites** (it threads a `rowKey` through the same `getFieldRules`/`getSourcePriority` call sites). **3-S3 does not start until item 1 is DONE on main**, and is then written against item 1's final call sites — a rebase here is a real conflict, not a textual one. 3-S1, 3-S2, 3-S4, 3-S5 touch no item-1 file.
- **Item 16 (lane B):** does NOT edit the matrix (C8) — but re-read item-16's PR at every rebase; if lane B edits it anyway, stop and record the collision.
- Matrix hunks, one small hunk per slice, ordered so no two overlap: **3-S1 = deletions only** (the 27 key blocks, no other line touched) → **3-S2 = additions only** (16 new camelCase key blocks appended at the object's end) → **3-S3 = the two function bodies only** (`getFieldRules`, `getSourcePriority`, plus the new `canonicalPath` helper).

## Slices

| # | Title | R-ids | Files | Failing test (assertion) | Lines | Tier | Flag |
|---|---|---|---|---|---|---|---|
| 3-S1 | Delete the 27 unreachable snake_case keys | R-158 | E `scraper/src/config/field-priority-matrix.ts` (deletions only); N `scraper/tests/unit/config/field-priority-matrix.test.ts` | each of the 27 names is absent from `Object.keys(FIELD_PRIORITY_MATRIX)`, and the 5 Group-A camelCase siblings (`openDate`, `closeDate`, `lotSize`, `companyDescription`, `gmpPrice`) still return the identical `FieldRules` they return today (deep-equal against a snapshot captured before the deletion) | ~180 | B | none |
| 3-S2 | Give the 16 live Group-C fields a real entry | R-158 | E `scraper/src/config/field-priority-matrix.ts` (additions only); E the 3-S1 test file | `getFieldRules('totalSubscription')` (and each of the other 15) no longer returns `DEFAULT_RULES`, and returns the rank order item 2's manifest fixture gives for that `table.column` | ~250 | **A** (changes the rules deciding live writes for 16 fields) | none |
| 3-S3 | Manifest-first lookup, `tableName` threaded through | R-054, R-055, R-158 | E `scraper/src/config/field-priority-matrix.ts` (`getFieldRules(fieldName, tableName?)`, `getSourcePriority(fieldName, source, tableName?)`, new `canonicalPath`); E `scraper/src/services/data-consolidation-service.ts` (its `getFieldRules`/`getSourcePriority` call sites gain the `tableName` already in scope); E the unit tests | with `ENABLE_FIELD_MANIFEST=true` and a manifest fixture containing `ipos.issue_size`, `getFieldRules('issueSize','ipos')` returns the manifest's rank order; with the flag off, byte-identical behaviour to 3-S2 | ~230 | **A** (write path) | `ENABLE_FIELD_MANIFEST` (**GATED**) |
| 3-S4 | Repair the stale singular-`listingExchange` provenance rows | R-158 | N `scraper/scripts/repair-listing-exchange-singular-provenance.ts` (**`.ts`, not `.mjs`** — C7; imports `lib/repair-tool.ts`, calls `openRepairDb`, dry-run default, `--apply`, `--allow-prod` gate, backup, one transaction, ledger); N `scripts/lib/repair-invariants/listing-exchange-singular-gone.mjs`; N its unit test | the dry run reports the exact row count for the table the tunnel measurement proves holds them (C6) and writes nothing; `--apply` on `ipodhan_test3` leaves 0 rows; a second `--apply` reports 0 and exits 0 | ~200 | **A** (repair tool, deletes rows) | none |
| 3-S5 | Nightly matrix/manifest drift check | R-158 | N `docs/reviews/detection-checks/matrix_manifest_drift.json` (`"section": "checks"`); E `scripts/audit-detection-floor.mjs` (`record('matrix_manifest_drift', …)`); regenerate `docs/reviews/detection-checks.json` + `docs/reviews/failure-classes.md` via `node scripts/build-detection-registry.mjs`; E `scripts/tests/audit-detection-floor.test.mjs` | a matrix key containing an underscore that has a camelCase sibling ⇒ the check FAILS and NAMES the key; a sole-entry snake_case key ⇒ not counted; a manifest row whose rank disagrees with the matrix entry for the same `table.column` ⇒ FAIL naming both | ~190 | **A** (CI / detection) | n/a |

## Defect-fix contract (3-S2 and 3-S4 PR bodies — one line each)
- **RCA (3-S2):** 16 live camelCase fields have no matrix entry at all, so `getFieldRules` falls through to `DEFAULT_RULES` (plain NSE-first, no confidence threshold, no validation bounds) on every consolidation cycle, while a dead snake_case twin sits in the file looking like coverage.
- **Class:** every consolidation write of those 16 `table.column` fields for every IPO of every status and segment, before and after the fix; and for 3-S4, every `field_sources` / `data_conflicts` row keyed on a column name that has never existed.
- **Failing test first:** 3-S2's "no longer `DEFAULT_RULES`" case and 3-S4's dry-run count, both red in a `-red-` worktree at `origin/main`.
- **Fix at class level:** the entry is added for all 16, not for whichever happened to be wrong that day; the repair is a re-runnable guarded tool, never a hand-typed DELETE.
- **Real-data proof:** the staging cycle line below (3-S2/3-S3) and, for 3-S4, the staging before/after count plus `node scripts/assert-repair-held.mjs scripts/lib/repair-invariants/listing-exchange-singular-gone.mjs --cycles 2`.
- **Detection upgrade:** `matrix_manifest_drift` (3-S5).

## Mutations a Tier A reviewer will try
- **3-S2:** (a) point one of the 16 at the wrong `table.column` ⇒ the manifest-agreement assertion must go red; (b) leave `DEFAULT_RULES` as the return for one field ⇒ that field's case must go red; (c) copy a rank order into the test as a literal ⇒ mutate the manifest fixture and the test must still go red.
- **3-S3:** (a) look the manifest up with the camelCase name instead of `canonicalPath`'s snake_case ⇒ the manifest-hit case must go red; (b) make `tableName` required ⇒ an existing no-`tableName` caller's test must go red; (c) read the manifest when the flag is OFF ⇒ the byte-identical-behaviour case must go red; (d) call `loadFieldManifest()` per field instead of once ⇒ the load-count assertion must go red.
- **3-S4:** (a) make `--apply` the default ⇒ the dry-run test must go red; (b) drop the `--allow-prod` gate ⇒ `require-repair-tool-module.mjs` and the guard test must both fail; (c) widen the `WHERE` to `field_name LIKE 'listingExchange%'` ⇒ a fixture holding real plural rows must go red.
- **3-S5:** (a) make the check PASS on zero rows examined ⇒ the empty-input case must be asserted SKIP, not PASS; (b) compare only key presence, not rank order ⇒ the disagreeing-rank fixture must go red.

## Pipelining pairs
- 3-S1 ∥ 3-S4 (matrix vs `scraper/scripts` + invariants). 3-S1 ∥ 3-S5 (matrix vs audit script + registry). 3-S4 ∥ 3-S5 (repair tool vs detection registry) — safe, except that 3-S5's registry regeneration collides with any lane-B registry slice on the generated aggregate; rebase, never union-merge.
- **Never** 3-S1 ∥ 3-S2 ∥ 3-S3 (all three edit `field-priority-matrix.ts`); never 3-S3 ∥ any lane-A item-1 slice.

## Real fixtures
- The 27-key list and the 16 Group-C names are measured and reproducible offline: `awk 'NR>=129 && NR<=800' field-priority-matrix.ts | grep -oE '^  [a-zA-Z_][a-zA-Z0-9_]*:' | grep _` → exactly 27 (re-verified this session). Commit that list as the test's fixture so a future key addition is caught.
- The `listingExchange` row counts: read-only through the tunnel against `ipodhan_staging` **and** `ipodhan`, for BOTH `field_sources` and `data_conflicts` (C6), pasted in 3-S4's PR body before the tool is written.

## Staging proof — obtainable without the owner?
- Card's line: `pm2 logs ipodhan-scraper` after the next cycle shows at least one `issueSize` / `openDate` / `lotSize` field resolving and writing normally (proving the Group-A deletions did not take the live sibling with them); plus the `listingExchange` count 0 after `--apply`, plus `assert-repair-held --cycles 2`.
- **3-S1, 3-S2, 3-S4, 3-S5: yes** — read-only log reads, plus the staging `--apply` decision 12 permits through the repair tool's guard. Two real cycles take hours: schedule the read, do not poll (R10).
- **3-S3: no, until lane A's `DEPLOY_SLOT` PR is merged** — `ENABLE_FIELD_MANIFEST` must be ON on staging and printed in the cycle log; until then 3-S3 is MERGED-UNPROVEN and the landing note asks the owner. Never edit a server env file.
- Production `--apply` for 3-S4 is the owner's, with the staging dry-run output attached in the ledger.

---

# Known traps (all three items)

- **Migration ⇒ journal-count fixture.** None of these 16 slices adds a migration. If one appears, bump `scraper/tests/unit/pipeline-stages/fixtures/stage-0/expected-schema.json` (`journalEntries`, and `publicTables` for a new table) in the SAME slice, and re-check after every rebase — lane B's items 18 and 22 bump it too.
- **`docs/ops/prod-ops-recipes.md` is CRLF** — stage it with `git -c core.autocrlf=false add`; a plain `git add` splits shell commands in half.
- **Registry layout (T-487):** never hand-edit `docs/reviews/detection-checks.json` or the table in `docs/reviews/failure-classes.md`; add the per-entry file, run `node scripts/build-detection-registry.mjs`, commit both. A check specified before its `record('<id>'` call exists goes in `"section": "notCoveredByThisManifest"`.
- **Detection-change gate** fires on every PR touching `scraper/src/services/**`, `scraper/src/scrapers/**`, `field-priority-matrix.ts`, `scraper/scripts/*.py` — so 12-S5/S6/S7 and 3-S1/S2/S3 each need a changed check file or the exact line `^No detection change: <20+ chars>$`.
- **Write ratchet:** `node scripts/check-write-ratchet.mjs` fails on any NEW file that writes `ipos`. 12-S5/S6 stay read-only in `ipo-identity.ts`; 3-S4 writes `field_sources`/`data_conflicts`, not `ipos`, and still goes through `openRepairDb`.
- **`node --test` on a glob matching nothing exits 0 (#461)** — run registry/audit tests by explicit path and assert a non-zero test count.
- **Red line via a second worktree, never `git stash`** (a PreToolUse hook blocks stash in linked worktrees): `wt-new.ps1 -Name IPODhan-red-c<NN>-<K> -Base origin/main -TtlHours 4`; copy evidence out **before** `wt-rm.ps1 -Discard`.
- **Never a password in any file** (`scraper/.env.test` included) — export it inline in the same command; dotenv does not override an already-set process variable.
- **Gate on exit codes, never on grepping output for the word "fail".** And read the CI job itself: an early failing step SKIPS every later step, so a new check can pass locally and never run in CI at all.
- **`export MSYS_NO_PATHCONV=1` before every `git show origin/main:<path>`** — without it Git Bash mangles the argument, the command fails silently and `grep -c` prints a false 0 (lane A read exactly that 0 as "done" on 2026-09-10).
