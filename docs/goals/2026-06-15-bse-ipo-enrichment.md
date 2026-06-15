# GOAL — Enrich REAL BSE IPOs via BSE's JSON API (fill issue_size/lot/registrar/…) + dedup, tested on a live IPO

**Type:** Autonomous **rebuild + enrich + migration** contract (run via `/goal`). Execute end-to-end with
**zero user input**. Every design decision is pre-made below — make the call the contract specifies and keep
going until the Definition of Done is met.

**Owner:** Abhay · **Created:** 2026-06-15 · **Scope:** `scraper/`, `packages/shared/`, `web/`, `docs/` ONLY
**Invocation:** `/goal docs/goals/2026-06-15-bse-ipo-enrichment.md`
**Companion:** monitoring runs from a separate session — see `docs/goals/.run/2026-06-15-bse-ipo-enrichment-PROGRESS.md`.

---

## 0. Mission

Real BSE-listed IPOs render as skeletons (issue_size=0, lot_size/registrar/price-band/lead_managers blank)
because the BSE scraper is **broken**: the list step uses Puppeteer against `publicissue.html` (now a JS SPA)
and the detail step parses `td.TTRow_left` HTML cells from BSE detail pages that **also migrated to a SPA** —
so `bse-detail-scraper.ts` extracts nothing. The robust, already-validated fix is **BSE's JSON API**
(`api.bseindia.com/BseIndiaAPI/api/IPO_HomePageDetail/w` returns the live board cleanly).

**Done = the current REAL BSE IPOs (`Susan Electricals`, `Horizon Reclaim`) and the ~140 under-populated
mainboard IPOs have their available core fields filled in prod (issue_size>0, lot_size, price band, registrar,
lead managers, schedule dates), duplicate status-code-suffix rows are merged, and the live page of a real IPO
shows real data — proven by tunnel DB read-back + the live site.** Fix GENERALLY (all IPOs), not per-IPO.
This is a fix-and-rebuild, not greenfield. NON-IPO corporate actions are already handled (PR #23) — do NOT
re-classify; this contract only enriches genuine IPOs.

---

## 0.2 PREFLIGHT — read what is already done FIRST (idempotency · NO duplication)

**First action, before any stage.** A parallel session / prior PR may have done part of this.
1. Read `memory/ipo-corporate-action-pollution.md` and `memory/gmp-coverage-root-cause.md` for prior context.
2. Scan `git log --oneline -25` and branch `feat/ipo-field-enrichment` (**PR #23 already merged/open**:
   corporate-action classification via BSE `IR_flag` + detail-page 404 guard — DONE, do NOT redo).
3. For each task below, check the code + a live tunnel DB read before building; SKIP anything already present
   (verify-only); build only the delta; record skips in the final report.
4. Re-measure coverage via the tunnel before Stage A and after each stage.

---

## 1. Context you need (read first)

**Stack/prod path:** scraper (ESM/tsx) + `packages/shared` + Next.js web. DB = prod via SSH tunnel at
`localhost:15432`. Run scrapers locally against prod with `DATABASE_URL='postgresql://…@localhost:15432/ipodhan'`
(the shared `db` pool prefers `DATABASE_HOST/PORT`; a plain `pg.Client` on `DATABASE_URL` is the reliable path —
see `reclassify-corporate-actions.ts`). `psql` absent — use `node`+`pg`. Deploy is GATED.

| Thing | Path | Why |
|---|---|---|
| BSE list scrape (BROKEN — Puppeteer/SPA) | `scraper/src/scrapers/bse-scraper.ts` (`scrapeBSEIPOs`, `BSE_URL=publicissue.html`) | replace with JSON API |
| BSE detail parse (BROKEN — `td.TTRow_left` SPA) | `scraper/src/scrapers/bse-detail-scraper.ts` | replace/repair via API |
| BSE orchestrator | `scraper/src/scrapers/bse-scraper-orchestrator-v2.ts` | wiring |
| **BSE JSON API (WORKS)** | `https://api.bseindia.com/BseIndiaAPI/api/IPO_HomePageDetail/w` (list: Scrip_name, Start/End_Dt, IR_flag, IR_FLAG_FULL, IPO_NO, Scrip_cd) | new source. Headers: UA + `Origin/Referer: https://www.bseindia.com`. Detail endpoint for issue_size/lot/registrar/price/lead-managers must be DISCOVERED — leads in the SPA bundle (`main-*.js`): method names `mktPubDisplayIPO` (`/Mkt_Pub_DisplayIPO__beta/w`), `ipoHomePageDetail`; try `IPONo`/`scripcode` params; inspect the SPA's network calls if needed. |
| Write path | `scraper/src/services/data-persister.ts` `upsertIPO()` | ALL writes here; consolidation + `field_sources` + lock |
| Field priority matrix | `scraper/src/config/field-priority-matrix.ts` | register fields w/ BSE source + validation |
| Name normalizer (dedup keystone) | `packages/shared/src/utils/company-name-normalizer.ts` (JS) + `ipo-repository.ts findByNormalizedName` (SQL) — MUST stay in agreement | extend to strip trailing status-code tokens |
| Real test IPO | `Susan Electricals India Ltd` (BSE `IPO/Book Building`), `Horizon Reclaim` | verify enrichment |

**Gotchas:** sarda etc. are takeovers (PR #23) — out of scope. The `field-sources` table audits which source
set each field — verify writes landed via it. Listing services filter `offeringType IN ('IPO')`.

---

## 2. STAGE A — Rebuild BSE list+detail on the JSON API (core enrichment)

**Files:** `bse-scraper.ts` (or a new `bse-api-scraper.ts`), `bse-detail-scraper.ts`, `bse-scraper-orchestrator-v2.ts`,
`field-priority-matrix.ts`. **Keep untouched:** the PR #23 classification path; non-BSE scrapers.

### Pre-made decisions (do NOT deviate)
1. **TDD red-first** for every task (scraper test tiers per `scraper-test-layout.md`).
2. **Source the list from `IPO_HomePageDetail/w`** (JSON), behind a feature flag `ENABLE_BSE_API` (default OFF →
   activation is a deploy = GATED). Map only `IR_flag='IPO'` rows here as IPOs (others already classified by PR #23).
3. **Discover the BSE detail/issue endpoint** that returns issue_size, lot_size, price band, registrar,
   lead managers, face value, schedule dates — keyed by `IPO_NO`/`Scrip_cd`. Use it for enrichment. If no clean
   JSON detail endpoint exists, fall back to the BSE detail HTML **only if** it is server-rendered (it is NOT today)
   — otherwise drive it via the SPA's underlying XHR. Root-cause, not a band-aid selector.
4. **Compute issue_size** from shares×price (existing `calculateIssueSize`) when the API gives shares; guard >0.
5. Route every field through `upsertIPO`; register each in `FIELD_PRIORITY_MATRIX` (BSE source, validation e.g. issue_size>0, lot_size>0).
6. **Backfill (additive via tunnel):** after green for the test IPO, run the new BSE-API enrichment across all
   current + historical BSE IPOs to repair the ~140 skeletons. Capture before/after coverage.

### Stage A acceptance
- `Susan Electricals` (and other real current BSE IPOs) have issue_size>0, lot_size, price band, registrar in prod (tunnel read-back).
- Mainboard issue_size coverage materially rises from the 60/178 baseline. Gate sweep (§5) green.

---

## 3. STAGE B — Dedup status-code-suffix rows (#16)

**Files:** `company-name-normalizer.ts` (+ SQL side in `ipo-repository.ts`), a dedup/merge backfill script.
1. **Extend the normalizer** to strip trailing BSE status-code tokens that leak into `company_name`
   (` O`, ` CT`, ` N`, trailing ` IPO`, etc.) so variants collapse — keep JS↔SQL agreement (add the agreement test).
2. **Merge existing dup rows** (e.g. `Susan Electricals India Ltd.` / `… Ltd. O` / `… Ltd. CT`; Horizon 2×; Leapfrog 2×):
   pick the canonical row, merge non-null fields + relations, repoint, delete the dups. Idempotent, dry-run default, additive/corrective via tunnel.

### Stage B acceptance
- One row per real IPO; no `Ltd. O`/`Ltd. CT`/` IPO` suffix duplicates in current IPO listings; normalizer agreement test green.

---

## 4. STAGE C — Subscription (T2) + DRHP best-effort (T3)

1. **Subscription:** diagnose why `subscriptions`=0 even for symbol-having OPEN IPOs; fix the live-subscription
   capture (Moneycontrol/BSE). Real-time only for OPEN IPOs.
2. **DRHP best-effort:** the extractor exists (`web/lib/services/drhp-extractor-service.ts`, `/api/admin/drhp/extract`)
   but is manual-upload-gated; the gap is DRHP URL auto-discovery. Discover a real IPO's DRHP/RHP URL (BSE/SEBI) and
   feed the existing extractor for financials/objectives/documents/anchor. If auto-discovery is a multi-day pipeline,
   fill what's feasible and file a follow-up — do NOT fake data.

---

## 5. Verification gates (IPODhan-adapted — load-bearing)

**Static (right CWD):** `npm run lint && npm run build`; `cd packages/shared && npx tsc && test -f dist/db/schema.d.ts`;
`cd scraper && npx vitest run tests/unit/scrapers/`; `cd web && npx vitest run tests/unit`.
- **G-PERSIST** (`e2e-persistence-verification.md`): after each scraper run / backfill, independent DB read-back via
  `node`+`pg` to `localhost:15432` confirms the fields/shape — never trust exit code; verify per-batch + a final coverage query.
- **G-UI** (`supervisor-verification.md`): drive a real IPO's live page (`/ipos/susan-electricals-india-ltd` or the
  correct slug) with Playwright MCP — screenshot + ARIA + console; the page shows real issue_size/lot/price (not blanks/zeros), 0 new console errors.
- **G-INDEPENDENT** (`independent-test-verification.md` + `output-plausibility-verification.md`): reproduce the gate +
  substance-check values are domain-sane (issue_size in ₹cr range, lot_size plausible). Sibling-sweep across the IPO class.
- Behavior: `claude-behavior.md` rules 15/17/20/23. Pino logging (no console.* in scraper/src). Failure budget per `/fix-loop`→`/systematic-debugging`.

---

## 6. Commit + push
Branch `feat/bse-ipo-enrichment` (off main, AFTER PR #23 is merged/deployed). Conventional commits, named files
(never `git add -A` — a stray `gmp-staleness-header.png` exists). Push branch + open **DRAFT PR**. **Do NOT merge,
do NOT deploy** (`ENABLE_BSE_API` activation + the cron are your deploy). Co-author trailer. Keep the PROGRESS ledger current.

## 7. Definition of Done
- [ ] BSE list+detail enrichment runs off the JSON API (flag-gated); real current BSE IPOs have issue_size>0, lot_size, price band, registrar, lead managers in prod (read-back proven).
- [ ] Mainboard coverage materially improved by the backfill (report before/after).
- [ ] #16 dup rows merged (one row per IPO); normalizer JS↔SQL agreement test green.
- [ ] Subscription landing for OPEN IPOs (or DEFERRED w/ reason); DRHP best-effort (or DEFERRED w/ reason).
- [ ] Static gates green; G-PERSIST + G-UI + G-INDEPENDENT passed on the real test IPO.
- [ ] Draft PR pushed; **§GATE** (enable `ENABLE_BSE_API` + deploy) listed for Abhay; deferrals logged.

## 8. Final report
Commit SHAs + per-stage gates; coverage before/after (issue_size/lot per segment); G-UI verdict + screenshot path of the real IPO page; G-PERSIST read-back values; dedup count; skipped (already-covered) list; DEFERRED items; §GATE (deploy/flag) awaiting Abhay.

## 9. Guardrails
- **IPODhan repo only**; never `5Wealths\`. **No prod deploy / no merge to main** — feature branch + draft PR.
- **Prod DB additive/corrective via tunnel only** (enrich + dedup-merge). No destructive schema ops without a gated migration.
- **General fix, never per-IPO branching.** Test on a real BSE IPO. Do NOT touch corporate actions (PR #23 owns them).
- Route writes through `upsertIPO`; register fields in the matrix; respect `scraper_locked`/field protection; gate new behavior behind a feature flag.
- **No fake/synthetic data** — fill from real sources or leave blank + document. Root cause not patch (use the API, don't band-aid the dead HTML selectors).
- Secret: prod DB password is the known-leaked one (rotation tracked) — never echo/commit it.

## Authorization trail
| # | Decision | Choice |
|---|---|---|
| 1 | Prod path | additive/corrective via tunnel; deploy + flag activation GATED |
| 2 | BSE source | rebuild on BSE JSON API (`IPO_HomePageDetail/w` + a discovered detail endpoint); Puppeteer/HTML parser are broken (SPA) |
| 3 | Scope | A: core enrichment · B: #16 dedup · C: subscription + DRHP best-effort. Corporate actions OUT (PR #23) |
| 4 | Generality | fix all IPOs; test on Susan Electricals (real current BSE IPO) |
| 5 | Test case | NOT sarda (it is a takeover, correctly de-listed by PR #23) |

## References
`.claude/rules/scraper-write-path.md` · `scraper-test-layout.md` · `structured-logging.md` · `schema-imports.md` ·
`shared-package-build.md` · `tdd-rule.md` · `e2e-persistence-verification.md` · `supervisor-verification.md` ·
`independent-test-verification.md` · `output-plausibility-verification.md` · skills `/fix-loop` `/systematic-debugging` `/backfill-script` `/playwright`.
