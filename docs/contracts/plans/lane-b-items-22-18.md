> Pre-made slice plan (supervisor, 2026-09-10). The build card, including its dated "Architect correction" block, wins where they differ.

# Lane B pre-made slice plans — item 22 (document handling / download limits) and item 18 (document retention)

Status: PLANNING ONLY, written 2026-09-10 against `origin/main` @ `6c31d995`. The build card and the
owner decisions (design §0.0.1 / contract decisions) always win over this file. Verify every line
number again at build time (`export MSYS_NO_PATHCONV=1; git show origin/main:<path>`).

## Verified-against-code facts (origin/main @ 6c31d995)

| Card claim | Code fact | Verdict |
|---|---|---|
| `defaultFetcher` L609, `arrayBuffer` L619, `DOWNLOAD_TIMEOUT_MS=120_000` L206, `FETCH_TIMEOUT_MS` L163 | all exact (`document-discovery-runner.ts`, 2158 lines) | OK |
| `MAX_DOCUMENT_BYTES = 150MB` L34, `verifyDownload` L274, `selectZipMemberForType` L241 | exact (`document-download-verifier.ts`, 380 lines) | OK |
| `TRUSTED_DOCUMENT_HOSTS` L336, `isTrustedDocumentHost(url)` L375, `normalizeCompanyUrl` L246 | exact; `PRIVATE_HOST_PATTERNS` is L225 (card says 216–233) | OK, minor drift |
| item 22: "storeDocument once per part … same idempotency" | **CONTRADICTION.** `documents` carries `unique('unique_url').on(table.url)` (schema.ts, documents block) and `unique_doc_per_ipo` on (ipoId,type,mediaType,exchange,sequenceNumber). N parts of ONE zip share ONE `url` → part 2's row insert violates `unique_url`. `storeDocument` (`document-store.ts:160`) writes only the FILE; the ROW goes through `DocumentRepository.create` (`packages/shared/src/repositories/document-repository.ts:77`), a plain insert with no conflict handling. Multi-part needs a decided row identity (recommended: keep `url` = zip URL + `#part=N` fragment, or drop `unique_url` in a gated migration) — this is an **O-nn owner/design fork, not a builder's choice** (parent decision 16). |
| item 18 card Tier B | **CONTRADICTION.** Parent decision 6: Tier A for any slice that writes/deletes rows, changes a migration, or is a repair tool. Item 18 adds a migration AND deletes PDF bytes AND (per lane B scope line) a `scraper/scripts/**` retention tool via `repair-tool.ts`. Slices 2–4 are **Tier A**; the card's Tier line is corrected in the same slice. |
| item 18's proposed `PurgeDecision` type | **CONTRADICTION.** Current `decidePurge` (`document-store.ts:264`) has a `withdrawn → purge` arm (matrix F15) and `no_close_date`; the card's replacement type drops both. Withdrawal-immediate purge must survive; keep the arm. |
| item 18: `isPurgeDue` retired, "nothing outside document-cycle calls it" | `document-cycle.ts:1451` calls `decidePurge`, `:1461` `purgeIpoDocuments(ipoId)` (whole-IPO directory). `isPurgeDue` L231 has its own tests in `document-purge-policy.test.ts` / `document-store.test.ts` — delete those cases with the export. | OK with note |
| item 18: `documents.extractedAt`, `retryCount`, `extractionStatus` exist | all present in schema.ts documents block | OK |
| item 22 flag: slot-aware helper | `git show origin/main:scraper/src/config/feature-flags.ts \| grep -c DEPLOY_SLOT` → **0** (non-empty file, 477 lines, so the 0 is real). Lane A's decision-11 duty NOT merged. | Flag slice GATED |
| item 22 `pdf-lib` for the blank-password attempt | not a dependency; `scraper/package.json:45` has `pdf-parse ^2.4.5`. Adding `pdf-lib` is a new dep. Prefer proving `pdf-parse` already throws a distinguishable encryption error before adding one. | Fork, builder measures |
| lane B scope names `scraper/config/download-allowlist*.json` | `scraper/config/` **does not exist** on main. Per decision 13 the allow-list is a config file + JSON schema validated at start; item 22's card does not mention it. First slice creating the dir also adds the import-direction test (decision 13). | New work, in plan |

---

# Item 22 — document handling and download limits (Tier A, R-021, R-023, R-025, R-159, R-160)

## Dependency note

- **On lane A:** slice 22-5 (the `ENABLE_DOWNLOAD_STREAMING_CAP` flag) is **GATED** on lane A's
  decision-11 flag-helper PR (slot helper in `scraper/src/config/feature-flags.ts` + `DEPLOY_SLOT`
  export in `scripts/deploy-linux.sh` + both key lists in `scripts/assert-env-keys.sh` + the two rule/header
  amendments). Re-check with the `MSYS_NO_PATHCONV=1` grep before every rebase; if lane A has not started
  it when items 22 and 18 are otherwise done, lane B does the whole duty as its own slice and posts a
  Notifier line. **Non-flag slices ship first** (22-1 … 22-4, 22-6).
- **On items 1 / 5:** none. Item 22 touches no lane A file except `packages/shared/src/db/schema.ts`
  (slice 22-6 migration; lane A items 1 and 5 add columns too) and `scraper/src/config/feature-flags.ts`
  (slice 22-5).
- **Conflict-list files touched:** `schema.ts`, `web/drizzle/migrations/meta/_journal.json`,
  `scraper/tests/unit/pipeline-stages/fixtures/stage-0/expected-schema.json` (22-6);
  `feature-flags.ts` (22-5); `docs/reviews/detection-checks/` + generated registry (22-4).
- **Blocked pending an owner call:** multi-part row identity vs `unique_url` (see the fact table).
  File the `O-nn` in design §0.0.2 at slice-plan time so the answer arrives before 22-6/22-7.

## Slices

| # | Title | R-ids | Files (E=exists, N=new) | Failing test — assertion in one line | Lines | Tier | Flag |
|---|---|---|---|---|---|---|---|
| 22-1 | Resolved-address (DNS-rebinding) refusal | R-160 | E `scraper/src/services/company-host-source.ts`; E `scraper/tests/unit/services/company-host-source.test.ts` | with `dns.promises.lookup` mocked to `127.0.0.1`, `isResolvedAddressPrivate('public-looking.example')` is `true` and the existing `PRIVATE_HOST_PATTERNS` cases stay green | ~140 | A | none |
| 22-2 | Allow-list as config + registrar hosts injected | R-160 | N `scraper/config/download-allowlist.json`, N `scraper/config/download-allowlist.schema.json`, N `scraper/src/config/download-allowlist.ts` (loader, validated at process start), E `company-host-source.ts` (`isTrustedDocumentHost(url, registrarHosts)`), N `loadRegistrarDocumentHosts` (per-cycle cache, `boardCache` pattern at runner L644), E `company-host-source.test.ts`, N import-direction test | a registrar hostname in the injected set passes `isTrustedDocumentHost`; a `registrars.website` that is non-http(s) or a private-string host is excluded from the set | ~260 | A | none |
| 22-3 | Streaming byte cap in `defaultFetcher` + 100 MB constant | R-160 | E `document-discovery-runner.ts` (L609–635), E `document-download-verifier.ts` (L34 → `100*1024*1024`, `PROSPECTUS_MAX_DOCUMENT_MB` env override), E `scraper/tests/unit/services/document-discovery-runner-download.test.ts`, E `document-download-verifier.test.ts` | a byte-counting mock `ReadableStream` proves the fetcher **never accumulates past the cap** (assert on bytes pulled, not on the final verdict — a verdict-only test passes against unfixed code); a 100–150 MB body now fails `too_large` | ~230 | A | 22-5 wires the flag |
| 22-4 | Structured refusal log + detection check | R-160 | E `document-discovery-runner.ts` (`request()` ~L768, `fetchAndVerify` L933, `downloadOneCandidate` L1016), N `docs/reviews/detection-checks/document-download-refusals.json`, regenerated `docs/reviews/detection-checks.json` + `docs/reviews/failure-classes.md` via `node scripts/build-detection-registry.mjs`, E runner test | every refusal (`too_large`, `password_protected`, resolved-private, untrusted-host) emits `document-download: refused url=<url> host=<host> reason=<reason>` with all three non-empty | ~180 | A | none |
| 22-5 | **GATED** — `ENABLE_DOWNLOAD_STREAMING_CAP` flag, slot-aware | R-160 | E `scraper/src/config/feature-flags.ts` (flag line only — the helper is lane A's), E runner, N flag unit test | flag off → old buffer-then-check path; flag on → streaming path; slot `staging` → default ON, prod/unset → OFF | ~90 | A | itself |
| 22-6 | Schema: `part_number`, `exchange_document_id` | R-021, R-025 | E `packages/shared/src/db/schema.ts` (documents block), N `web/drizzle/migrations/00NN_*.sql` + `meta/_journal.json`, E `scraper/tests/unit/pipeline-stages/fixtures/stage-0/expected-schema.json` (**bump `journalEntries` 36→37**) | `db:generate` output equals the committed SQL and the journal fixture count matches the journal file | ~110 | A | none |
| 22-7 | Multi-volume classifier + per-part store loop | R-021, R-025 | E `scraper/src/services/document-classifier.ts` (multi-volume member-set check), E `document-download-verifier.ts` (return all real PDF members), E `document-discovery-runner.ts` `downloadOneCandidate`, E `packages/shared/src/repositories/document-repository.ts` (row identity per the O-nn answer), E `document-download-verifier.test.ts`, E runner test | a two-member `VOL1_`/`VOL2_` zip produces two `documents` rows with `part_number` 1 and 2 and both files on disk — one row must not replace the other | ~300 | A | none |
| 22-8 | Blank-password attempt | R-023 | E `document-download-verifier.ts` (`password_protected` reason), E `scraper/src/config/feature-flags.ts` (`ENABLE_DOCUMENT_PASSWORD_CHECK`), E verifier test, N encrypted fixture | an encrypted PDF fixture returns `password_protected` with the library error string, not `not_a_pdf`, and is attempted exactly once | ~150 | A | `ENABLE_DOCUMENT_PASSWORD_CHECK` |

No repair/deletion slice in item 22 (new columns default null; no existing row is rewritten) — the
card's own Staging-proof §3 says `assert-repair-held.mjs` does not apply. Defect-fix-contract six items
therefore not required per slice; the PR body still carries R-ids + the detection line.

## Pipelining pairs (no shared files; verifier proves empty `git diff --name-only` intersection)

- 22-1 ∥ 22-3 — host-source vs runner/verifier. (22-2 imports 22-1's helper → sequential after 22-1.)
- 22-6 ∥ 22-4 — schema/migration vs runner logging + detection registry.
- 22-8 ∥ 22-2 — verifier vs host-source/config. Never 22-3 ∥ 22-7 (both edit `downloadOneCandidate`).
- Cap: two open lane-B PRs at once.

## Mutations a Tier A reviewer will try (which test must go red)

| Slice | Mutation | Test that must go red |
|---|---|---|
| 22-1 | invert the IPv4-private CIDR test; drop the AAAA/`all:true` branch; return `false` on lookup error | rebinding case; an IPv6 ULA case; a lookup-throws case must refuse, not allow |
| 22-2 | make the registrar set always empty; skip the non-http(s) reject; make the cache never invalidate | registrar-passes case; bad-website-excluded case; a second-cycle-refresh case |
| 22-3 | raise the cap back to 150 MB; move the size check to after the full read; count chunks not bytes | over-cap `too_large` case; the byte-accumulation assertion; a many-small-chunks case |
| 22-4 | drop `host` from the log object; log only on `too_large` | the refusal-shape assertion for each of the four reasons |
| 22-6 | remove one `ADD COLUMN`; leave `journalEntries` at 36 | schema-vs-generated-SQL diff; the stage-0 fixture test |
| 22-7 | keep only the first member; assign `partNumber` from the loop index without 1-indexing; reuse one row | two-row assertion; part numbers `[1,2]`; unique-identity assertion |
| 22-8 | swallow the encryption error into `not_a_pdf`; retry the blank password twice | `password_protected` case; an attempt-count spy assertion |

## Fixtures

| Need | Source | Note |
|---|---|---|
| multi-part filing (VOL1/VOL2 zip) | **synthetic** two-member zip built in the test from two tiny valid PDFs | real NSE multi-volume zip is a KNOWN GAP in the card; capture one from a live NSE URL if reachable and put it under `docs/design/probes/fixtures/nse/`, else state the synthetic reason in the PR body |
| password-protected PDF | **synthetic**, generated once by a committed script (deterministic bytes) into `docs/design/probes/fixtures/extraction/` | §2.2.1 asks for a real encrypted filing; none exists in the repo — record as an owed real fixture, not a silent substitution |
| oversized response | **synthetic** streamed chunk generator (never a 100 MB file in git) | the assertion is on the byte counter, so no real payload is needed |
| private-range host | **synthetic** mocked `dns.promises.lookup` | a unit test must make no real DNS call (test-layout rule: real network ⇒ e2e tier) |
| registrar websites | real rows via `docs/design/probes/fixtures/registrars/*.html` shapes + a fixture `registrars` row set | no live DB in a unit test |

## Staging proof (card's own lines) — obtainable without the owner?

1. `document-download: refused url=… host=… reason=…` for one real refusal, forced by lowering
   `PROSPECTUS_MAX_DOCUMENT_MB` on staging. **Owner needed** — the run never edits a server env file
   (parent decision 11); ask for the one-cycle env override in the landing note, or obtain the line from a
   naturally-refused host/untrusted-host refusal, which needs no env change. **Recommend the latter first.**
2. A real multi-part filing stored as two rows with `partNumber: 2` in `field_sources.dataLineage`.
   **Obtainable** only if staging discovers a multi-volume zip in the proof window; otherwise the item is
   `MERGED-UNPROVEN` and the report names the cycle waited on.
3. Not a data-repair item → `assert-repair-held.mjs` N/A.
4. Tier A ⇒ a rollback rehearsal (flag off for one cycle) is owed at item close ⇒ **owner note required**.

---

# Item 18 — document retention (R-151, R-010; Tier A for slices 2–4, card's Tier B is corrected)

## Dependency note

- **On lane A:** none functionally. Conflict-list files: `packages/shared/src/db/schema.ts`,
  `web/drizzle/migrations/meta/_journal.json`, the stage-0 journal fixture (bump again, 37→38 if item 22
  landed first), `docs/reviews/detection-checks/` + registry, `config/write-ratchet-baseline.json` (the
  retention tool is a new writer/deleter — check the ratchet before pushing).
- **On items 1 / 5:** none. Item 18 does NOT need `ipo_field_plan`.
- **Ordering vs item 22:** run item 18 after item 22 (contract item order 20, 22, 18, …). Both add a
  migration — the second one rebases and re-checks the journal count (decision 20).
- **Until lane A's schema-drift index hardening lands:** the verifier must additionally diff `schema.ts`
  against the generated SQL by hand (`npm run db:generate` in a scratch tree, `git diff --stat` on the
  migrations dir must show exactly the new file) and assert the exact ordered column list of every new
  index/constraint from `pg_index`/`pg_constraint` in the integration test (contract "Commit + push policy").
- **`db:generate` journal-timestamp check:** after `db:generate`, assert the new `meta/_journal.json`
  entry's `when` is within **5 minutes** of `date +%s%3N` taken in the same command. A future-dated entry
  is what made migrations skip silently (fixed in `6797fdab`); the fixture count alone does not catch it.

## Slices

| # | Title | R-ids | Files (E/N) | Failing test — assertion in one line | Lines | Tier | Flag |
|---|---|---|---|---|---|---|---|
| 18-1 | Retire the post-listing live window | R-151 | E `scraper/src/services/document-state-machine.ts` (L749 `LIVE_WINDOW_DAYS_AFTER_LISTING`, L751 `isInLiveWindow` → documented always-true no-op), E `scraper/src/services/document-cycle.ts` (L762–770 filter), E `scraper/tests/unit/services/document-state-machine.test.ts`, E `document-cycle-*` tests | `loadCandidateIpos` includes a `LISTED` IPO whose `listingDate` is 30 days past — excluded today, included after | ~120 | A (cycle candidate set) | none |
| 18-2 | Schema: `document_pages` + `documents.purged_unread` | R-151 | E `packages/shared/src/db/schema.ts`, N `web/drizzle/migrations/00NN_*.sql` + journal, E stage-0 fixture (`journalEntries` +1, and `publicTables` gains `document_pages`), N `scraper/tests/integration/document-pages.integration.test.ts` (added to the `scraper-document-integration` job's run line in `.github/workflows/pr-gate.yml`, same PR) | the unique `(document_id, page_number)` and the `idx_document_pages_document_id` index exist with that exact ordered column list read from `pg_index`/`pg_constraint`, against `ipodhan_test2` | ~180 | A | none |
| 18-3 | `decidePurge` re-anchored on `extractedAt`, per document | R-151 | E `scraper/src/services/document-store.ts` (`decidePurge` L264 new signature, `isPurgeDue` L231 retired, N `purgeDocumentFile(documentId)` beside `purgeIpoDocuments` L332), E `document-cycle.ts` (L1440–1465 call site → per-document, new candidate SQL), E `scraper/tests/unit/services/document-store.test.ts`, E `document-purge-policy.test.ts` | `extractedAt` 8 days past → `{purge:true, reason:'extracted_and_expired'}`; `extractedAt:null` with `retryCount < maxRetries` → `{purge:false, reason:'within_retry_budget'}` even past the old close-date window; **`withdrawn:true` still purges (F15 arm kept)** | ~290 | A | none |
| 18-4 | Third arm records the failure + read path | R-151, R-010 | E `document-store.ts` (`readExtractedText`), E `document-cycle.ts` (sets `documents.purged_unread = true`), E tests | `retryCount >= maxRetries` → `{purge:true, reason:'retries_exhausted', recordFailure:true}` and the row's `purged_unread` is `true`; a re-read of a document with `document_pages` rows calls `readExtractedText` and the download spy records **zero** invocations | ~230 | A | none |
| 18-5 | Retention tool (deletes PDF bytes) | R-151 | N `scraper/scripts/repair-document-retention.ts` (**must** `import … from '../lib/repair-tool.js'` and call `openRepairDb(` — `scripts/ci/require-repair-tool-module.mjs` enforces both, comment/string-stripped), N `scraper/tests/unit/scripts/repair-document-retention.test.ts` | dry-run (the default) deletes nothing and prints the identity list; `--apply` without the prod guard refuses; a document inside its 7-day window is never listed | ~280 | A | none |
| 18-6 | Detection check | R-151 | N `docs/reviews/detection-checks/document_retention_progress.json`, regenerated registry + `failure-classes.md` (`node scripts/build-detection-registry.mjs`, `--check` in CI), E `scripts/audit-*.mjs` with a `record('document_retention_progress')` call (section `checks`, never `notCoveredByThisManifest` without the call) | a document with `extractedAt` 8 days past **and** a PDF still on disk fails the check; a document with no PDF, no `document_pages` rows and `purged_unread=false` fails it | ~170 | A | none |

### Defect-fix contract — slice 18-5 (the deletion tool), six items, one line each

1. **RCA:** the purge window is anchored on the IPO's `closeDate`, so a document extracted late is
   deleted before its bytes have been read and one never extracted is kept to the 30-day hard cap.
2. **Class:** every `documents` row, every status except WITHDRAWN/POSTPONED (which purge immediately by
   F15), both segments, both slots, rows written before the fix (already on disk, close-date-anchored) and
   after it (extraction-anchored) — not "the September documents", not one IPO.
3. **Failing test first:** `repair-document-retention.test.ts` — a document `extractedAt` 8 days past with
   a file present is listed for deletion; one at 6 days is not; red before the tool exists.
4. **Fix at class level:** the retention decision lives in `decidePurge` (18-3) for the forward path; the
   backlog is repaired by this productized, re-runnable tool through `openRepairDb`, never by hand `rm`.
5. **Retest + real-data proof:** unit green, then dry run on `ipodhan_staging`, then `--apply` on staging
   only, then `node scripts/assert-repair-held.mjs <retention-invariant> --cycles 2` on staging (two real
   cycles — schedule the read, do not wait idle). **NEVER production**; the production command is written
   into the ledger with the staging dry-run output, for the owner.
6. **Detection upgrade:** `document_retention_progress` (18-6) — both arms — catches the next member.

## Pipelining pairs

- 18-1 ∥ 18-2 — state-machine/cycle-filter vs schema+migration (no file overlap; 18-1 touches
  `document-cycle.ts` L762–770 and 18-3 touches L1440–1465 — **same file, so 18-1 and 18-3 are sequential**).
- 18-2 ∥ 18-5 — schema vs `scraper/scripts/**` (18-5's tool reads the new column, so rebase 18-5 after 18-2 merges).
- 18-4 ∥ 18-6 — store/cycle vs detection registry. Never 18-3 ∥ 18-4 (both edit `decidePurge`/its call site).

## Mutations a Tier A reviewer will try

| Slice | Mutation | Test that must go red |
|---|---|---|
| 18-1 | make `isInLiveWindow` return `false`; leave the `.filter` conditional in place | the LISTED-30-days-past inclusion case |
| 18-2 | drop the unique constraint; reverse the index column order; leave `journalEntries` unchanged | the `pg_index`/`pg_constraint` ordered-column assertion; the stage-0 fixture test |
| 18-3 | anchor back on `closeDate`; delete the `withdrawn` arm; flip `<=`/`<` on the 7-day boundary | the `extractedAt`-anchored case; the F15 withdrawn case; a day-7-vs-day-8 boundary case |
| 18-4 | never set `purged_unread`; let `readExtractedText` fall through to a fetch on an empty result | the `purged_unread=true` assertion; the zero-download spy assertion |
| 18-5 | make `--apply` the default; remove `openRepairDb`; widen the filter to ignore `extractedAt` | the dry-run-default case; `require-repair-tool-module.mjs` (CI); the in-window-never-listed case |
| 18-6 | make the check return PASS on an empty result set; drop the second arm | a seeded-violation case; the no-PDF/no-pages/`purged_unread=false` case |

## Fixtures

All item-18 cases are DB/filesystem state, not captured payloads: seeded rows in `ipodhan_test2` plus
temp-dir PDF files. No `docs/design/probes/fixtures/` entry is needed. Reason stated because the card's
"real fixture" discipline applies to parsers/extractors, and item 18 parses nothing.

## Staging proof (card's own lines) — obtainable without the owner?

1. Purge log line naming the document and its `extractedAt`-anchored age; a PDF older than 7 days past
   `extractedAt` deleted, one inside the window surviving. **Obtainable** — read per `docs/ops/prod-ops-recipes.md` §2.
2. Re-read never re-downloads: no new `documents.url` fetch log line for a purged document. **Obtainable**.
3. Counter-case: a repeatedly-failing document purged with `purged_unread = true`. **Obtainable** if staging
   has such a row in the window; else seed it via the tool's staging `--apply` (permitted by decision 12).
4. `assert-repair-held.mjs --cycles 2` on staging for 18-5. **Obtainable**, but it needs two real cycles —
   schedule it, do not idle.
5. Tier A ⇒ rollback rehearsal at item close. No flag exists here, so the card's Rollback section is
   executed on staging and the cycle line shows the prior behaviour ⇒ **owner note required** at close.

## Cross-item ordering note

If item 22 lands first, item 18's migration is the SECOND journal entry: bump the stage-0 fixture from the
value item 22 left, never from 36, and re-run the journal-timestamp check after every rebase (decision 20).

## Supervisor decisions on the contradictions above (2026-09-10, architect session; reversible, internal, so decided here and not raised as O-nn)

1. **Multi-part filings vs `documents` unique constraints:** one `documents` row per DOWNLOAD (the zip / the container URL), never one row per part. Parts are recorded under that row: each part's extraction carries `partNumber` and the part's own sha256 in its provenance/extraction record (the design's "part number in provenance", OD-36), and the parent row's status is COMPLETED only when every part extracted. `unique_url` and `unique_doc_per_ipo` stay as they are. A reader sees one document with N parts, which is what the exchange shows too. Item 22's card is corrected in the same slice (Tier C docs hunk); no product shape changes, so no O-nn.
2. **Item 18 tier:** Tier A (parent decision 6: migration + row/byte deletion + repair tool). The card's "Tier B" line is corrected in the slice.
3. **Item 18 purge decision:** the new decision function KEEPS the existing `withdrawn` and `no_close_date` arms from `document-store.ts` as explicit cases with tests; a rewrite that drops a live arm is a MAJOR finding.
4. **Dependencies and config dir:** no new dependency (`pdf-lib` is not in the tree and no card names it; use `pdf-parse` which is present); the first slice that needs `scraper/config/` creates it with its JSON-schema loader per OD-51, and item 22's allow-list is the first file in it.
