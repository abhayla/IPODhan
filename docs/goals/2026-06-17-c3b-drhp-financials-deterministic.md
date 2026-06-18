# GOAL — C3b: DRHP financials/peers/objectives via deterministic Chittorgarh extraction (NO LLM)

**Type:** Autonomous **build** contract (run via `/goal`). Execute end-to-end with **zero user
input**. Every design decision is pre-made below — do not pause to ask; make the call the
contract specifies and keep going until the Definition of Done is fully met.

**Owner:** Abhay · **Created:** 2026-06-17 · **Scope:** `scraper/` + `packages/shared/` ONLY
**Invocation:** `/goal docs/goals/2026-06-17-c3b-drhp-financials-deterministic.md`

---

## 0. Mission

The investor-facing IPO detail page has three dark sections — **financials, peers, and
objects-of-issue** — all at **0 rows** today (`financial_data` 0/266, `peer_companies` 0/266,
`ipos.objectives` null). This run fills them **deterministically, with NO LLM**, by extending
the proven Chittorgarh detail-page extractor (the same pattern that already drives lot_size
82% and registrar 85%) to parse the financial/KPI/peer/objective HTML tables on
`chittorgarh.com/ipo/<slug>/<id>/`. "Done" = pure `html → value` extractors (unit-tested
offline, output-plausibility-gated), field-priority-matrix entries, a dry-run-default backfill
that writes only through the data-persister, and a backfill run against the prod tunnel that
materially lifts coverage of `financial_data` / `peer_companies` / `ipos.objectives`. **No LLM,
no synthetic data, no fabricated numbers** — a value that doesn't parse cleanly or fails a
sanity bound is left NULL, never guessed (honesty is the Tier-0 product requirement). The
non-negotiable outcome: every number persisted is exactly what Chittorgarh published, or it is
blank.

**Two-tier deterministic ladder (both NO LLM):** (1) Chittorgarh HTML scrape = broad primary;
(2) **free `pdfplumber` extraction from the stored RHP PDFs** = fallback + enrichment for the
stored-PDF population (validated 2026-06-17 on a real 371-page RHP — extracted full restated
P&L + multi-year KPIs + peer table cleanly). An **LLM is NOT built and NOT needed** — it is a
documented last resort only for a truly garbled/scanned RHP a future goal may revisit.

**Out of scope (do NOT build):** `anchor_investors` (separate page + ~1-day-pre-open timing →
its own later goal); any **LLM** PDF fallback (the free `pdfplumber` tier replaces it); bulk RHP
PDF discovery beyond the 81 already in `documents` (separate C3a-bulk goal); web detail-page
rendering/UX (C-tier, a later goal).

---

## 0.2 PREFLIGHT — read the coverage ledger FIRST (idempotency · NO duplication)

**This is the first action of the run, before ANY stage. Non-negotiable.** A parallel session
may already have implemented part of this contract. This contract must be **safe to run at any
time without redoing finished work.**

1. **Read the project's state-of-record** — `memory/*.md` (esp. `ipo-data-completeness-progress.md`,
   `b1-listing-backfill-diagnosis.md`), any `docs/goals/.run/*-PROGRESS.md`, and
   `docs/goals/2026-06-16-ipo-data-completeness.md` (the master contract this is a sub-goal of).
2. **For every item below, check the code + `git log --oneline -25` + a live tunnel DB read
   before building it.** If `chittorgarh-detail-fields.ts` already exports
   `extractFinancialsFromDetailHtml` / `extractPeersFromDetailHtml` /
   `extractObjectivesFromDetailHtml`, or `financial_data` / `peer_companies` already have rows,
   **SKIP the build** for that part — verify-only and move on. Build only the missing delta.
3. **Record every skip** in the final report's "skipped (already covered)" list.

This makes the contract **idempotent**: a re-run after partial progress produces only the
remaining delta — never a duplicate.

---

## 1. Context you need (read first)

| Thing | Path / import | Why it matters |
|---|---|---|
| **Proven extractor pattern** | `scraper/src/scrapers/chittorgarh-detail-fields.ts` | The exact template: pure `html → value` fns (`extractLotSizeFromDetailHtml`, `extractRegistrarFromDetailHtml`) with an output-plausibility gate (return `null`, never persist garbage). Add the new extractors HERE, same style. |
| **Proven fetch + discovery** | `scraper/scripts/backfill-lot-size-chittorgarh-detail.ts` | The working pipeline: Report 118 JSON (`webnodejs.chittorgarh.com/cloud/report/data-read/118/1/10/<year>/<range>/0/all/0`) → `{slug,id}` discovery map keyed by normalized name; `fetchDetailHtml(slug,id)` → `chittorgarh.com/ipo/<slug>/<id>/`. Copy this structure for the financials backfill. |
| **Registrar backfill (2nd template)** | `scraper/scripts/backfill-registrar-chittorgarh-detail.ts` | Second reference for dry-run-default + per-item error handling + data-persister write. |
| **Financials target table** | `packages/shared/src/db/schema.ts:371` `financialData` (`financial_data`) | Columns: `revenue_fy2022/2023/2024`, `profit_fy2022/2023/2024`, `ebitda_fy2022/2023/2024`, `total_income_fy2022/2023/2024`, `net_worth`, `reserves_and_surplus`, `total_assets`, `total_borrowings`, `pe_ratio`, `eps`, `pre_ipo_eps`, `post_ipo_eps`, `roe`, `ronw`, `debt_to_equity`, `current_ratio`, `market_cap` (all `numeric`). Map only the fields Chittorgarh publishes; leave the rest NULL. |
| **Peers target table** | `packages/shared/src/db/schema.ts:592` `peerCompanies` (`peer_companies`) | Read its exact columns at runtime; map name + the per-peer metrics Chittorgarh's "Peer Group" table carries (typically name, P/E, EPS, RoNW, NAV). |
| **Objectives target** | `packages/shared/src/db/schema.ts:201` `ipos.objectives` jsonb, type `IPOObjective[]` = `{serial, description, amount}` (interface at schema.ts:996) | Objects-of-issue is a jsonb column ON the `ipos` row, NOT a child table — write via `upsertIPO`. |
| **Single write entry point** | `scraper/src/services/data-persister.ts` (`upsertIPO`, and the child-table writers e.g. `createAnchorInvestors`) | ALL writes go through here (`scraper-write-path.md`). For child tables add a writer following the `createAnchorInvestors` pattern if one doesn't exist for financials/peers; objectives ride `upsertIPO`. NEVER `db.insert()` directly. |
| **Field priority matrix** | `scraper/src/config/field-priority-matrix.ts` | Every new scraped field MUST be registered (source order incl. `CHITTORGARH`, normalization=`currency`/`number`, confidenceThreshold, validation min/max). A field absent from the matrix silently loses conflict resolution. |
| **Source page (verified live)** | `https://www.chittorgarh.com/ipo/<slug>/<id>/` | 343 KB static HTML; confirmed to contain Restated financials, Revenue, PAT, Net Worth, Total Borrowing, EBITDA, RoNW, RoCE, EPS, Objects of the Issue, Peer Group as inline tables. Fetch with a `Referer: https://www.chittorgarh.com/` header (as the existing scripts do). |
| **Test layout** | `.claude/rules/scraper-test-layout.md` | Unit tests → `scraper/tests/unit/*.test.ts` (mocked, offline). The extractors are pure → unit tier. |

**Gotchas:**
- **CWD:** scraper commands run from `scraper/`. The DB is **prod via the SSH tunnel at
  `localhost:15432`**; backfills hit prod **additively**. Use working creds from
  `web/.env.local` (`require('dotenv').config({path:'../web/.env.local'})`) — the scraper's own
  `.env` has stale direct-prod creds.
- **Population is broader than the 81 stored PDFs.** Report 118 discovery covers the same
  ~82–85% of real IPOs that lot/registrar reached — target that population, not just
  `documents`' 81 rows.
- **scraper/ is NOT type-gated at commit** (`shared-package-build.md`) — verify by running the
  scraper unit tests, not by trusting the commit.
- **Chittorgarh number formats:** values come as `₹1,234.56`, lakhs/crores, sometimes `(12.3)`
  for negatives. Normalize to plain numeric (rupees-in-the-column's-unit); reject unparseable.

---

## 2. STAGE A — pure extractors (TDD, output-plausibility-gated)

**File(s):** `scraper/src/scrapers/chittorgarh-detail-fields.ts` (edit — add functions);
`scraper/tests/unit/chittorgarh-detail-fields.test.ts` (create or extend).
**Keep untouched:** the existing `extractLotSizeFromDetailHtml` / `extractRegistrarFromDetailHtml`.

### Pre-made design decisions (do NOT deviate)
1. Add three pure functions, same signature style as the existing ones (`(html: string) => T | null`):
   `extractFinancialsFromDetailHtml(html)` → a partial `financial_data` shape (only fields found);
   `extractPeersFromDetailHtml(html)` → `Array<{name, peRatio?, eps?, ronw?, nav?}>`;
   `extractObjectivesFromDetailHtml(html)` → `IPOObjective[]` (`{serial, description, amount}`).
2. **TDD red-first** (`tdd-rule.md`): capture 2–3 real Chittorgarh detail-page HTML fixtures
   (e.g. `modern-diagnostic-ipo/2276`, plus one mainboard, one with sparse financials) into the
   test dir, write failing tests asserting the extracted numbers match the page, THEN implement.
3. **Output-plausibility gate on EVERY numeric field** (`output-plausibility-verification.md`):
   reject and return `null` for that field when out of domain-sane bounds — e.g. negative
   revenue is suspicious (allow negative PAT — losses are real), EPS/PE within sane ranges,
   RoNW/RoCE as a percentage in roughly [-100, 300], net_worth/assets ≥ 0. A field that doesn't
   parse cleanly is **omitted (left NULL)**, never guessed.
4. Anchor each field on its label cell then read the adjacent value cell (mirror the existing
   `Lot Size`/`registrar-name` anchoring); never positional-index the table blindly.
5. Currency normalization: strip `₹` and thousands separators; map `(x)` → `-x`; preserve the
   column's published unit (do not invent crore↔lakh conversions — store as published and record
   the unit if the column carries one).

### Stage A acceptance (run the §3 gate sweep before committing)
- Unit tests green; each extractor returns correct numbers on the fixtures and `null`/`[]` on a
  page lacking the section.
- A deliberately corrupted fixture (garbled numbers) yields NULLs, not garbage.
- **Stage gate sweep:** static (scraper unit tests) → G-INDEPENDENT (reproduce + substance).

---

## 3. STAGE B — register fields in the priority matrix

**File(s):** `scraper/src/config/field-priority-matrix.ts` (edit).
### Pre-made design decisions
1. Add a matrix entry for every new financial field + the peer/objective payloads, with
   `sources` placing `CHITTORGARH` appropriately (DRHP-first conceptually, but the live source
   here is CHITTORGARH), `normalization: 'currency'|'number'|'percentage'`, a
   `confidenceThreshold` (financials are stable data → 85–90), `timeBased: false`, and
   `validation {min,max}` matching the Stage-A plausibility bounds (single source of truth for
   the bounds — reference the same constants).
2. MUST NOT invent a second conflict-resolution path — every field flows through the matrix.

### Stage B acceptance
- Every field the extractors emit has a matrix entry; `npm`/tsx loads the matrix without error.
- **Stage gate sweep:** static → G-INDEPENDENT.

---

## 4. STAGE C — backfill script (dry-run default)

**File(s):** `scraper/scripts/backfill-financials-chittorgarh-detail.ts` (create).
**Keep untouched:** the lot-size/registrar backfills (copy, don't mutate them).
### Pre-made design decisions (do NOT deviate)
1. Structure mirrors `backfill-lot-size-chittorgarh-detail.ts`: build the Report 118 discovery
   map (all fiscal years in its `FISCAL_YEARS`), match each real IPO by normalized name, fetch
   the detail HTML, run the three Stage-A extractors, persist.
2. **Dry-run by default; `--apply` writes.** `--limit N` caps detail fetches for testing
   (`backfill-script.md` convention).
3. **Writes ONLY through `data-persister`** (`scraper-write-path.md`): financials/peers via the
   child-table writer functions (add them following `createAnchorInvestors` if absent),
   objectives via `upsertIPO`. NEVER `db.insert()` directly. Per-item try/catch; pino +
   final-summary logging (`structured-logging.md`).
4. Idempotent: skip an IPO already populated (verify-only) unless `--force`.
5. NEVER `git add -A` the fetched HTML or any scratch artifacts.

### Stage C acceptance
- `--limit 3` dry-run prints would-write rows with sane numbers for 3 IPOs; `--limit 3 --apply`
  writes them and a tunnel read-back confirms (G-PERSIST).
- **Stage gate sweep:** static → G-PERSIST (per-batch read-back) → G-INDEPENDENT.

---

## 5. STAGE D — run the backfill + verify coverage

### Pre-made design decisions
1. Run `--apply` across the full Chittorgarh-discoverable population (additive, via the tunnel).
2. After the run, query the tunnel for coverage of `financial_data` (rows + distinct ipos),
   `peer_companies`, and `ipos.objectives IS NOT NULL`; record before/after.
3. **Substance check** (`output-plausibility-verification.md`): spot-read 5 random populated
   IPOs against their live Chittorgarh page — every persisted number must match the page exactly
   (deterministic, so it must) and be domain-sane. Any mismatch → STOP, fix the extractor, re-run.

### Stage D acceptance
- `financial_data` distinct-ipo coverage rises from 0 to a material fraction of the
  Chittorgarh-discoverable population (target ≥ 60% get core financials: revenue + PAT ×3yr +
  ≥1 valuation ratio; peers + objectives best-effort). Un-scrapeable IPOs stay NULL + are listed
  DEFERRED (honest, not fabricated).
- 5/5 spot-checks match the source page.
- **Stage gate sweep:** G-PERSIST (final coverage query) → G-INDEPENDENT (reproduce + substance + sibling-sweep).

---

## 5b. STAGE E — free PDF fallback + enrichment (pdfplumber, NO LLM)

**Validated 2026-06-17:** a spike ran `pdfplumber` on a real 371-page RHP and extracted the full
restated P&L + 3-year KPIs + peer table cleanly (Revenue 8,048.88 / EBITDA 1,028.96 / PAT 529.57
/ Net Worth 2,084.51, in Lakhs). This stage productizes that for the stored-PDF population.

**File(s):** `scraper/scripts/extract-financials-pdf.py` (create — Python sidecar);
`scraper/scripts/backfill-financials-pdf.ts` (create — Node consumer) OR extend Stage-C's
backfill to ingest the sidecar's JSON. **New dependency authorized:** `pdfplumber` (Python,
free/OSS) — pinned in a `scraper/scripts/requirements.txt`. NO other new deps; NO LLM.

### Pre-made design decisions (do NOT deviate)
1. **Python sidecar, Node persists.** The sidecar reads a stored RHP PDF (URL/path from the
   `documents` table) and emits **JSON only** — it MUST NOT touch the DB. The Node backfill reads
   that JSON and writes through `data-persister` (the write-path SSOT is unchanged).
2. **Target population:** the 81 IPOs with a stored RHP in `documents`. Use Stage E to (a) FILL
   any of the 81 the HTML scrape (Stage A–D) missed, and (b) ENRICH all 81 with the multi-year
   restated P&L the HTML lacks. The un-stored tail stays NULL + DEFERRED (no LLM, no fabrication).
3. **Page targeting (proven):** score each page by `(financial-keyword count) × (money-number
   count)`; the top-scored pages are the KPI / restated-P&L / peer tables. Anchor each metric on
   its label row; map columns to fiscal years from the `FY 20xx-yy` header row.
4. **Unit normalization:** RHP values are stated "in Lakhs" — read the stated unit from the label
   and normalize to the schema's convention (confirm the existing `financial_data` unit
   convention at runtime; `financial-column-precision.md` — money is `numeric`, never float).
5. **Same output-plausibility gate as Stage A** (single source of truth for the bounds): a value
   that doesn't parse cleanly or fails a sane bound is omitted (NULL), never guessed. Set a
   lower-confidence flag for PDF-sourced values vs HTML (mapping is heuristic).
6. **Run encoding:** set `PYTHONIOENCODING=utf-8` (the `₹` glyph breaks the default Windows
   cp1252 console). Dry-run default; `--apply` writes; `--limit N` caps PDFs.
7. **TDD:** capture 1–2 real RHP financial-page fixtures; assert the mapped fields equal the page.

### Stage E acceptance
- The sidecar emits correct mapped financials for ≥1 real RHP (matches the page); the Node
  consumer persists them via `data-persister`; tunnel read-back confirms (G-PERSIST).
- Stored-PDF population (the 81) reaches materially higher financial completeness than HTML alone
  (multi-year P&L present where HTML gave only a snapshot).
- **Stage gate sweep:** static (sidecar fixture test + scraper unit) → G-PERSIST → G-INDEPENDENT
  (reproduce + 5 spot-checks against the actual RHP page + sibling-sweep).

---

## 6. Verification gates

**All rules in `.claude/rules/` are operative for this run.** The gates below are load-bearing
for an autonomous `/goal` run. **G-PERSIST and G-INDEPENDENT are MANDATORY at every task AND
every stage boundary.** G-UI does not apply (no web change in this contract).

### G-PERSIST — write→persistence verification (per DB write, MANDATORY) — `e2e-persistence-verification.md`
After any write (backfill apply), confirm it persisted — exit code / "it ran" do **not** count.
Two signals: (1) the run's count/log reflects the write; (2) **independent DB read-back via
`node`+`pg` to `localhost:15432`** (creds from `web/.env.local`) confirms the row/column
shape+values. For the multi-row backfill verify **per batch**, then a final coverage query.
≤3 attempts → `/fix-loop`. Degrade → "persistence verification skipped because <reason>"; never
claim complete.

### G-INDEPENDENT — post-stage independent + substance verification (ALWAYS fires) — `independent-test-verification.md` + `supervisor-verification.md` + `output-plausibility-verification.md`
After a stage is otherwise green, re-verify with FRESH eyes BEFORE marking complete: **reproduce
the gate** (re-run the exact scraper unit test / coverage query — never trust a reported exit
code) AND **inspect substance** (are the numbers domain-sane AND exactly equal to the source
page on the default path?). Sibling-sweep the same output class. 3 reconcile cycles →
`/systematic-debugging`; unresolved → log DEFERRED, proceed with state noted.

### Rules 15 / 17 / 20 / 23 (`.claude/rules/claude-behavior.md`)
- **15** — test failures → use the skills (`/fix-loop`, `/systematic-debugging`); no ad-hoc retrying.
- **17** — no laziness; fix the root cause, not a band-aid.
- **20** — epistemic honesty; **NO synthetic/fake data**; a number that won't parse cleanly is
  left NULL, never guessed; surface `**Assumption:** X` not fiction.
- **23** — keep going through the full DoD; context-budget anxiety is NOT a stop condition.

### Failure-recovery budget
- **Per-task fix budget:** ~15 attempts (≈5 inline → `/fix-loop` → `/systematic-debugging`) →
  then DEFER the task and continue; do NOT halt the whole run.
- **Tunnel recovery:** if `localhost:15432` drops, re-establish:
  `ssh -i ~/.ssh/ipodhan_vps -N -L 15432:127.0.0.1:5432 administrator@103.118.16.189`.
- **Chittorgarh fetch failure** (rate-limit/timeout): log warn + skip that IPO + continue; do
  not hard-fail the run. Report skipped IPOs.
- **Hard halt ONLY:** `npm install` failure; a decision contradiction inside this contract; an
  irrecoverable build break after the full fix budget; an OS permission denial; a dead tunnel
  that won't re-establish. Context-budget anxiety is NOT a halt — hand off via a one-line
  continuation note in the PROGRESS file, never fake-complete.

---

## 7. Commit + push

- **Commits (conventional, scoped `feat(scraper):`):** (A) extractors + unit tests; (B) matrix
  entries; (C) backfill script (+ any new data-persister child writers). Stage D is a data run —
  no code commit beyond a short coverage note in `docs/goals/.run/c3b-PROGRESS.md`.
- **Stage only named files** — NEVER `git add -A` (a stray `gmp-staleness-header.png` and
  `manual-listing-entries.csv` exist untracked; do not stage them).
- **Feature branch `feat/ipo-c3b-financials-deterministic` + DRAFT PR.** Do NOT merge to main
  and do NOT deploy — **deploy/PM2/cron activation is GATED** (`deploy-requires-approval`).
- Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## 8. Definition of Done (all MUST be true)

**Build / change:**
- [ ] `extractFinancialsFromDetailHtml` / `extractPeersFromDetailHtml` /
      `extractObjectivesFromDetailHtml` exist, pure, output-plausibility-gated.
- [ ] Every emitted field registered in `FIELD_PRIORITY_MATRIX` with `CHITTORGARH` source +
      validation bounds.
- [ ] `backfill-financials-chittorgarh-detail.ts` exists, dry-run-default, writes only via
      data-persister.
- [ ] **Stage E:** `extract-financials-pdf.py` (pdfplumber sidecar → JSON, no DB) + the Node
      consumer exist; fixture test green; the 81 stored-PDF IPOs enriched with multi-year P&L;
      `pdfplumber` pinned in `scraper/scripts/requirements.txt`; **no LLM**.

**Static gates:**
- [ ] `cd scraper && npx vitest run tests/unit/chittorgarh-detail-fields.test.ts` green; no
      regression in the existing detail-fields tests.

**G-PERSIST (per DB write):**
- [ ] dual-signal: the run/log reflects the writes AND `node`+`pg` read-back to `localhost:15432`
      confirms `financial_data` / `peer_companies` / `ipos.objectives` shape+values.

**G-INDEPENDENT (every stage):**
- [ ] gate reproduced (re-ran the test/coverage query, not trusted exit code) AND 5/5 spot-checks
      match the live Chittorgarh page exactly AND are domain-sane; sibling-swept.

**Coverage:**
- [ ] `financial_data` distinct-ipo coverage 0 → ≥60% of the Chittorgarh-discoverable real-IPO
      population for core financials; peers + objectives best-effort; un-scrapeable tail left
      NULL + DEFERRED.

**Ship:**
- [ ] 4–5 conventional commits pushed to `feat/ipo-c3b-financials-deterministic` (A extractors,
      B matrix, C HTML backfill, E pdfplumber sidecar + consumer); DRAFT PR opened; NOT merged,
      NOT deployed.
- [ ] Deferrals logged in `docs/goals/.run/c3b-DEFERRED.md` with reason (anchor; bulk RHP-PDF
      discovery beyond the 81; LLM last-resort for garbled/scanned RHPs; any field neither
      Chittorgarh nor the RHP carries).

---

## 9. Final report (required on completion)

Produce a closing report containing: commit SHAs + per-stage gate results; G-PERSIST verdict per
write path (with read-back coverage numbers before/after); G-INDEPENDENT result (the 5 spot-check
IPOs + their source-page match); coverage before/after for `financial_data` / `peer_companies` /
`ipos.objectives`; the §GATE list awaiting Abhay (merge PR + deploy + any prod implications);
skipped (already-covered) list; DoD tally; DEFERRED entries with reason.

---

## 10. Guardrails (hard stops)

- **`scraper/` + `packages/shared/` only.** Never write outside; never write
  `D:\Abhay\VibeCoding\5Wealths\`.
- **NO LLM.** Both tiers are deterministic. PDF parsing is done with **free `pdfplumber`** (Stage
  E), NOT an LLM. An LLM is a documented last resort for a garbled/scanned RHP only — a SEPARATE
  future goal; do not add one here.
- **No synthetic/fake data** — a number that doesn't parse cleanly is NULL, never guessed.
- **One new dependency, authorized:** `pdfplumber` (Python, free/OSS) for Stage E, pinned in
  `scraper/scripts/requirements.txt`. No other new deps (Cheerio/regex + `pg`/`dotenv` for the
  Node side).
- **No design reinvention** — extend `chittorgarh-detail-fields.ts` + the backfill template;
  reuse `data-persister` + the matrix.
- **Stop only on a true blocker** (dead tunnel, decision contradiction, irrecoverable build
  break after the full fix budget). Context-budget anxiety is NOT a blocker — hand off via a
  one-line continuation note, never fake-complete.
- **Strategic items are `TODO(5W):` notes**, not handled here.

---

## Authorization trail

| # | Decision | Choice |
|---|---|---|
| 1 | Extraction approach | **B — deterministic Chittorgarh-HTML, NO LLM** (Abhay delegated to the role; goal-anchored: honesty + $0 + proven pattern) |
| 2 | Payload scope | Full payload one pass: financials + KPIs + peers + objectives |
| 3 | Anchor investors | **Deferred** (separate page + pre-open timing → later goal) |
| 4 | PDF fallback for the tail | **Free `pdfplumber` (Stage E), NOT an LLM** — Abhay asked to try free OSS PDF libs before paying; a spike validated it on a real 371-page RHP (clean restated P&L + KPIs + peers). LLM dropped to documented last-resort only. |
| 4b | Spike evidence | `pdfplumber` extracted Revenue 8,048.88 / EBITDA 1,028.96 / PAT 529.57 / Net Worth 2,084.51 (Lakhs) + 3-yr KPIs + peer table from Anubhav Plast RHP — deterministic, ₹0 |
| 5 | Source + discovery | Chittorgarh detail page `/ipo/<slug>/<id>/` + Report 118 discovery (proven by lot/registrar 82–85%) |
| 6 | Targets | `financial_data` table, `peer_companies` table, `ipos.objectives` jsonb (all exist — no migration) |
| 7 | Coverage DoD | ≥60% of Chittorgarh-discoverable real IPOs get core financials; rest NULL + DEFERRED |
| 8 | Deploy | GATED — DRAFT PR only, no merge/deploy |

---

## References (loaded transitively by the skills this contract invokes)

- `.claude/rules/claude-behavior.md` — rules 15, 17, 20, 23
- `.claude/rules/supervisor-verification.md` · `independent-test-verification.md` · `e2e-persistence-verification.md` · `output-plausibility-verification.md` — the G-PERSIST / G-INDEPENDENT gates
- `.claude/rules/tdd-rule.md` — red-green-refactor for Stage A
- `.claude/rules/scraper-write-path.md` — all writes via `data-persister` + matrix registration
- `.claude/rules/scraper-rendering-detection.md` · `scraper-test-layout.md` · `structured-logging.md` · `schema-imports.md` · `shared-package-build.md` · `financial-column-precision.md`
- `.claude/rules/goal-anchored-decisions.md` · `decision-authority.md` · `deploy-requires-approval` (memory)
- Skills the run drives: `/backfill-script`, `/tdd`, `/fix-loop`, `/systematic-debugging`, `/pg-query`, `/data-validation-expert`
