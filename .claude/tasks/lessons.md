# Lessons (persist across sessions)

Append-only log of error→fix→lesson patterns. Review at session start.

## 2026-06-14 — Map consumers BEFORE editing; don't skip plan-before-coding

**Error:** Editing `/history` for a client crash (`reading 'total' of undefined`),
I edited `app/history/page-client.tsx` and burned multiple build cycles chasing a
"stale chunk" — the chunk hash never changed. Root cause: `page-client.tsx` was
**orphan dead code**; the live route renders `app/history/HistoricalIPOsContent.tsx`
(imported by `page.tsx`). I edited a file nothing imports. Abhay called it out:
"why are you not planning before implementation? is this not in the rules?" — it is
(`.claude/rules/plan-before-coding.md`).

**Fix:** Reverted+deleted the orphan; fixed the real component (API returns a FLAT
`{data:[],pagination:{...hasMore}}` but the component read nested `data.data.ipos` /
`pagination.totalPages`). Verified 32/32 + clean browser console against the VPS DB.

**Lesson / how to apply:**
- Before editing ANY component to fix a bug, run the consumer map first:
  `grep -rn "<ComponentName>\|<filename>" app/ components/` to confirm it's the LIVE
  file the route actually renders. Similarly-named siblings (`page-client.tsx` vs
  `HistoricalIPOsContent.tsx`) are a classic trap.
- A build whose output **contenthash does not change** after a source edit is a
  signal the edit isn't in the compiled graph (wrong file / dead code) — STOP and
  re-map, don't chase caches/processes.
- Produce the visible plan + root-cause/consumer map BEFORE the first edit, per
  `plan-before-coding.md`. Skipping it cost ~4 wasted build cycles here.
- Client crash class to watch: component's response interface ≠ the API route's
  actual return shape (nested-vs-flat). Add an `Array.isArray`/shape guard so drift
  surfaces as the error state, not a white screen.

## 2026-06-17 — secret-scanner has an inline `secret-scan:allow` escape; never `--no-verify`

**Error:** Committing the hub-sync framework refresh, the `secret-scanner` pre-commit
hook blocked on doc-example connection strings (`pg-query`, `docker-optimize`,
`iac-deploy` reference files with `postgresql://user:password@host`). The momentary
temptation is `--no-verify` — which `security-baseline.md` forbids.

**Fix:** The hook itself prints the sanctioned escape: append `secret-scan:allow` to a
line that is a *verified* dummy/placeholder. Marked the 3 pg-query placeholders; for
the docker/iac files the right move was pruning them (irrelevant infra stacks), not
marking. Commit then passed clean with the hook intact.

**Lesson / how to apply:**
- A secret-scanner block on a KNOWN placeholder → append `secret-scan:allow` to that
  line (a bash/code comment is fine). NEVER `--no-verify` (security-baseline.md).
- First *verify* it's truly a dummy (read the line) before marking — the marker is for
  confirmed placeholders, not a blanket silencer.
- If the flagged file is itself irrelevant to this project's stack (k8s/docker/iac on a
  PM2/Windows app), prune it rather than mark it — removes the trigger AND the bloat.

## 2026-06-17 — Try free OSS PDF libraries before paying for LLM extraction

**Context:** For C3b (extract IPO financials), the first instinct was a paid LLM to read RHP
PDFs. Abhay pushed back: try free GitHub PDF libraries first; LLM is the last option. A 10-min
spike with `pdfplumber` (pure-Python, free) on a real 371-page RHP extracted the full restated
P&L + 3-year KPIs + peer table CLEANLY (Revenue/EBITDA/PAT/Net Worth, correct numbers).

**Lesson / how to apply:**
- For structured-document extraction, **spike a free OSS library before reaching for a paid
  LLM** — `pdfplumber` (no Ghostscript/JVM) for general tables; `camelot`/`tabula` for bordered
  tables; `PyMuPDF` for speed. Score pages by `(keyword count) × (money-number count)` to
  auto-target the right table; map columns to fiscal years from the header row.
- The LLM is the LAST resort (garbled/scanned docs only) — not the default. Free + deterministic
  beats paid + hallucination-prone for a money platform (goal-anchored honesty).
- Windows gotchas in a PDF spike: git-bash `/tmp` ≠ native-Python `/tmp` (use the real
  `C:/Users/.../AppData/Local/Temp` path); set `PYTHONIOENCODING=utf-8` or the `₹` glyph crashes
  the cp1252 console (looks like a parse failure but isn't).
- [2026-06-28] Parser fixes: synthetic fixtures built from a bug REPORT can pass while the REAL document still fails. Ather #67 — the report named loss-regex/unit/layout, but the real RHP also had integer money (no decimals), 2 interim columns + a Note column, and pdfplumber token garble ("4 ,089","( 23)"). My first fix went green on synthetic fixtures yet still returned metrics={} on the real 586-page PDF. ALWAYS verify a parser/extractor fix against the REAL source document + an independent oracle, never just synthetic green (output-plausibility-verification / supervisor-verification).

## 2026-06-29 — IPO data-quality run (#8/#69/#70/#71)
- **mistake:** field-priority-matrix entries keyed snake_case (`company_description`, `listing_date`) were silently DEAD → **root cause:** consolidation keys incoming fields by **camelCase** (data-persister `ipoData`), no snake→camel conversion → falls through to default rules → **rule:** every matrix entry for a consolidated field MUST be keyed by its camelCase name (add a twin like lotSize/allotmentDate); a CG backfill source MUST also be registered in that field's `sources` (else rejected at priority -1). [Caught by scraper-change-reviewer, missed by generic blind verify — use the domain reviewer for scraper changes.]
- **mistake:** ran `git stash`/`git stash pop` to peek at base when the worktree was clean → **root cause:** clean tree makes `stash` a no-op, so `pop` pops a PRE-EXISTING stash (applied unrelated changes + a conflict) → **rule:** never `git stash` to inspect another ref — use `git show <ref>:<path>`.
- **mistake (avoided):** assumed contract's BSE/NSE listing source; empirically BSE StockReachGraph returns only today's intraday (no listing-day anchor) and NSE is bot-blocked → **rule:** probe source reachability/shape BEFORE committing to a source; Chittorgarh (report-25 listing, report-118 dates, detail "About"/financials) is the reachable deterministic IPO source from this environment.

## 2026-07-02 — Windows worktree cleanup deleted main-repo files (packages/shared wiped)
- **Mistake:** after `git worktree remove` failed with "Invalid argument", ran `rm -rf` on leftover worktree dirs (IPODhan-run-*). Shortly after, ALL of packages/shared/* (54 tracked files) + an untracked web/ script were gone from the MAIN repo and an auto-git checkpoint branch had staged the deletions.
- **Root cause (best evidence):** npm-workspace `node_modules/@ipodhan/shared` is a Windows JUNCTION in each tree; rm -rf/worktree deletion on Windows can traverse junctions or fail mid-delete ("Invalid argument"), and damage landed outside the target dir. Exact path not fully reconstructable — but the class is "cleanup of trees containing node_modules junctions is not scoped".
- **Rule:** after ANY worktree removal or bulk dir deletion on Windows, IMMEDIATELY run `git status --porcelain` in the main repo and verify 0 unexpected entries BEFORE the next git operation. Never `rm -rf` a tree containing node_modules on Windows — use `git worktree remove` (no --force first), and if it errors, inspect for junctions (`cmd //c dir /AL`) instead of escalating to rm -rf.
- **Recovery that worked:** `git archive HEAD packages/shared | tar -x` (additive) + `git reset packages/shared` (index-only) — avoids destructive-restore classifiers and cannot lose content.

## 2026-08-23 — Mechanism-class batch from T-276..T-293 (round-2/3/4 fix waves)

This file was gitignored (`.claude/*` with no negation for `tasks/`) since at least
2026-07-02, so ~10 fix tasks (T-276 through T-287 and siblings) shipped real defect
classes with no lesson landing here — T-291's independent review flagged this gap
(P3-10) and this entry (+ the `.gitignore` fix that makes this file trackable) closes
it. Each item below is a MECHANISM class, not a single-row incident — check new code
against the class, not just the original row.

- **Consolidation flag inert (T-283).** `shouldUseFeature('CONSOLIDATION_PERCENTAGE', ...)`
  gates `consolidateIPOData()` at its ONE call site — but `CONSOLIDATION_PERCENTAGE` was
  never set in ANY prod/staging env (only `ENABLE_DATA_CONSOLIDATION=true`, a different
  flag, was set), so the entire consolidation pipeline silently ran `fallbackConsolidation()`
  (accept-all, no comparison, no conflict detection) for its ENTIRE production lifetime on
  both Windows and Linux. The code that would have warned about this
  (`validateFeatureFlags()`, correct message: `'DATA_CONSOLIDATION enabled but percentage
  is 0%'`) existed but was never CALLED from anywhere in the scraper. **Root cause:** a
  two-flag design (`ENABLE_X` + `X_PERCENTAGE`) where only one flag is visible in normal
  config review, and the validator that would catch the other being unset was itself dead
  code. **Rule:** (1) every feature with a `_PERCENTAGE` rollout knob MUST have its
  `validateFeatureFlags()`/`logFeatureFlags()` equivalent actually invoked at process
  startup, not just defined — grep for the call site, not just the definition, when
  reviewing a flag-gated feature. (2) When a downstream guard (price-band, dedup,
  protection) appears to be "dead code" or "never triggers" in prod logs, check the
  UPSTREAM gate it depends on before assuming the guard itself is broken — T-276/T-280/
  T-282's price-band-guard incidents were this same root cause wearing three different
  costumes before T-283 found the actual switch.

- **Repair-before-deploy (T-281 / T-277 / T-280).** A DB data repair that fixes rows
  currently corrupted by a live scraper bug is NOT durable until the CODE fix that
  prevents recorruption is deployed and served, not just merged. T-281 repaired 89
  price-band rows while its guarding PR was still unmerged; the next 30-minute scraper
  cycle re-collapsed all 89 rows back to degenerate bands before the fix ever reached
  prod. **Root cause:** "merged" and "deployed" were treated as equivalent when
  sequencing a contract that pairs a code fix with a data repair. **Rule:** any task that
  pairs a mechanism/guard fix with a prod data repair MUST sequence strictly: land the
  PR → deploy → verify the SERVED sha (not just main HEAD) → THEN repair → hold the
  repaired rows through at least one full live scraper cycle → re-verify before closing.
  Repairing first "to see the fix work" inverts the one ordering that makes the repair
  survive.

- **Guard/write identity mismatch (T-287F3 / T-276).** A protection/lock check and the
  write it's supposed to gate resolved the SAME logical row through TWO DIFFERENT
  identity paths — `processIPO()`'s protection-lookup used slug-only matching while the
  downstream `upsertIPO()` write used normalized-name-first-then-slug matching. A raw
  scraped title with a trailing parenthetical (which the slug generator doesn't strip
  but the name normalizer does) made the slug-only lookup return null every cycle —
  silently skipping IPO-lock and field-protection checks entirely — while the write,
  moments later, found and mutated the exact row that should have been protected. T-276
  hit the same class from the write side: a repair script that OVERWRITES an existing
  visible value must not resolve its target row via the same loose name-matching path
  used for null-filling — a `'symbol'`-only identity mode (no normalized-name fallback)
  was added specifically for overwrite paths. **Rule:** whenever a guard/check and the
  write it protects each resolve "the row" independently, they MUST use the IDENTICAL
  resolution function/parameters — never two paths that merely usually agree. Any script
  that overwrites (not just fills) an existing user-visible field needs a STRICTER
  identity bar than one that only fills nulls.

- **Degenerate cross-source overwrite (T-276 / T-281).** A price-band (or any
  min/max-pair) guard that only checks the field-priority-matrix / `field_sources`
  tracking table silently no-ops whenever that field has NO tracked row — which is
  exactly the state a row is left in after a direct-to-table repair script. With no
  tracked entry, `consolidateField()` falls into "no existing value → accept incoming",
  so a single-price scrape from ANY source (even one not on that field's priority list)
  can collapse a real range (`285-300`) to a degenerate one (`300/300`) on the very next
  cycle — bypassing the priority matrix entirely. **Rule:** a degenerate-value guard
  MUST also check the raw EXISTING row data as a fallback when `field_sources` has no
  tracked entry for that field — "untracked" must never be read as "no real value
  exists." Never write a min==max band from a single-price source unless the incoming
  data explicitly signals a fixed-price issue (a structural flag, never inferred from
  the numeric values themselves).

- **Silent `rowCount` (T-287F).** A repair script logged "8/8 written" as success while
  only 5 rows actually landed, because `db.update()`'s result was assigned and never
  inspected — Drizzle/pg returns a result object with `rowCount`, and an UPDATE whose
  WHERE clause matches zero rows still resolves without throwing. **Rule:** every
  write-verification helper in a repair/backfill script MUST treat `rowCount < 1` as an
  ERROR (not silently "nothing to do"), log the specific row id that didn't land, and
  make the script exit non-zero if ANY intended write failed to apply. "The `UPDATE`
  didn't throw" is not evidence the row changed — check `rowCount`, or read the row back.

- **Similarity-threshold classes are two-sided, not one bug (T-277 dedup family).**
  `checkCompanyName`'s `similarity > 0.85` threshold produces BOTH false negatives (a
  genuine duplicate scoring just under, like a hyphen/no-separator variant —
  "Poly-Plast" vs "Polyplast" normalizing to different keys) and false positives (a
  bare-word structural match like `/\btrust\b/i` rejecting "Trust Fintech Limited",
  where "Trust" is a brand word + its own suffix, not an InvIT/REIT class-word). Fixing
  the miss side (add a secondary compact/word-break key, OR'd never replacing the exact
  match) and the over-match side (require the trigger word to be the TERMINAL
  legal-entity-type token, not any substring occurrence) are separate, independent
  fixes — a name-matching change reviewed for only one direction (usually "does this
  catch more duplicates?") will miss the other. **Rule:** any change to a
  fuzzy/similarity name-matcher needs BOTH a positive regression test (known duplicate
  pair that should now merge) AND a negative regression test (known distinct pair that
  must NOT merge) in the same PR — one without the other ships a fix that trades one
  failure mode for its opposite.

- **Single-source-bucket date trust (T-278 allotment_date).** `allotment_date` was
  ~1% populated because it was NEVER extracted by NSE, BSE, or the bulk Chittorgarh JSON
  report scrapers (zero code references across all three) — the only writer was a
  legacy `moneycontrol-scraper.ts` CLOSED-table branch, itself superseded by
  `moneycontrol-orchestrator-v2.ts` (the version actually wired into the live scheduler),
  which drops the field entirely. So a date field was effectively designed around
  exactly ONE narrow, non-authoritative bucket, and that bucket silently stopped being
  the live code path — with no alternate extraction route, the field just went dark with
  no error, no warning, and no field_sources trail to notice from. **Rule:** when a
  date/fact field has exactly one populating code path, treat that as a standing risk —
  add a second, independent extraction route (here: a per-IPO detail-page parser,
  following the established `extractLotSizeFromDetailHtml`/`extractRegistrarFromDetailHtml`
  pattern) BEFORE the single bucket goes stale, not after an audit discovers the gap.
  Parse explicit date components (`month/day/year`) rather than `new Date(raw).toISOString()`
  — the latter silently shifts by a day depending on the running process's local
  timezone offset (see also `utc-naive-timestamp-normalization.md`).

- **A written gate that is not scheduled is a document, not a gate (T-297, discovery-coverage
  meta-analysis).** Five consecutive full-site review rounds produced 0 / 16 / 12 / 12 / 11
  findings — a FLAT rate while the defect population shrank. That is the signature of a
  method-limited search, not a defect-limited one: each round found new issues because it used
  a discovery METHOD the previous round had not used (round 2 opened a browser; round 3 audited
  the alert channel; round 4 ran the comparison BACKWARDS, external-list→our-site, and instantly
  found a real SME IPO invisible on the site — something no forward comparison can ever reach,
  because a row we do not have fails no check that iterates our rows). Two compounding causes,
  both mechanical: (1) checks were written and never scheduled — `audit-ipo-coverage.mjs --gate`
  and `audit-substance-plausibility.mjs --gate` were wired to no npm script, no workflow and no
  cron, and one of them hard-crashed on `readFileSync('web/.env.local')` so it could only ever
  run on one laptop; `prod-verify.yml` was demoted to manual-only and sat red and unread for 53
  days; the freshness watchdog had no scheduler at all. (2) gates asserted SHAPE, not SUBSTANCE
  — `npm run audit:prod` returned 24/24 PASS on a site with four live P1s, because it checked
  HTTP 200 and grepped the IPO API for known seed names, so it could not see client-rendered
  mock rows, a poisoned registrar cache, or a page rendering "No NCDs available" for eight
  months while two NCDs were open for subscription. **Rules:** (a) a new check MUST land with
  its trigger — npm script AND cron/CI entry — in the SAME change; an unscheduled gate is worth
  zero. (b) Never let a gate depend on a file that exists only on a developer machine; make env
  loading optional and fail loudly when nothing is configured. (c) Every check must assert a
  value re-derived, a count reconciled, or a row proven to exist — "renders 200 with >80
  characters" is a claim about shape and an empty state satisfies it. (d) Forward and reverse
  are DIFFERENT checks: anything iterating our rows is half a check; the other half iterates the
  world's rows. (e) Measure a review loop by METHOD COVERAGE promoted per round, not by
  findings per round — the latter is flat by construction. Full matrix and the 14 remaining
  uncovered cells: `docs/data-quality/discovery-coverage.md`.
