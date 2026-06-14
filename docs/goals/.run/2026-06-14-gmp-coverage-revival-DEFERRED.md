# DEFERRED — GMP coverage revival run

Items intentionally not done in the current turn, with rule status + reason. None are fake-completes.

## D1 — Pre-existing scraper unit-suite failures (OUT OF SCOPE)
- **What:** `cd scraper && npx vitest run tests/unit/` shows ~47 failures across `validators.test.ts`, `moneycontrol-scraper.test.ts`, `bse-scraper.test.ts`, etc. Within `tests/unit/scrapers/`: 25 failures.
- **Proof they are pre-existing:** stashed my src edits + hid my new test files → true baseline = 25 failed / 142 passed in `tests/unit/scrapers/`; with my changes = 25 failed / **158** passed. My slice added +16/+13/+3 passing and **0** new failures. Zero GMP refs in the failing files.
- **Rule status:** `bug-triage-discipline.md` — these are a pre-existing red baseline unrelated to GMP (the contract scopes to GMP files). NOT chased to avoid scope creep. Flagged here as a `TODO` for a separate cleanup pass.

## D2 — Per-IPO `ipo:${slug}` lock in the GMP orchestrator (A1 refinement)
- **What:** `scraper-write-path.md` wants racy GMP writes to take the `ipo:${slug}` Redis lock. Implemented job-level lock via `registerJob(LOCK_TTL.gmpInvestorgain)` instead (every sibling scraper orchestrator does the same; none take a per-IPO lock).
- **Reason:** job-level lock prevents the GMP job racing itself, which is the real race once the external PM2 GMP run is retired at activation (§GATE). Per-IPO lock = a refinement; adding it only to GMP would be inconsistent with siblings.
- **Rule status:** `decision-authority.md` reversible/internal, convention-consistent. Revisit if double-writes are observed after activation.

## D3 — A3 normalizer JS↔SQL agreement test (integration tier)
- **What:** the JS normalizer (`data-persister.ts:normalizeCompanyNameForMatching`) and the SQL normalizer (`ipo-repository.ts:findByNormalizedName`) are parallel hand-maintained implementations. Contract A3 wants ONE shared function + a ≥30-name fixture run through BOTH (JS and live SQL via tunnel) failing on any divergence.
- **Reason deferred:** the SQL side requires a DB round-trip (integration tier, tunnel) — larger than a unit slice; needs its own focused turn so the agreement test is real, not mocked.
- **Rule status:** pending, not skipped. Highest-risk remaining Stage A task.

## D4 — A8 backfill, Stage B (schema), Stage C (web/docs/tests)
- Not started. Backfill (A8) writes prod additively (allowed) but needs A3 + a live InvestorGain fetch. Stage B authors migrations (destructive ones UNAPPLIED, gated). Stage C is web rendering + docs + Playwright. All require follow-up turns. PROGRESS ledger tracks them.
