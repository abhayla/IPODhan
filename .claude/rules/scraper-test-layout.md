---
name: scraper-test-layout
description: >
  Enforces the scraper workspace's four-tier test layout (unit / integration / e2e /
  load), each with its own vitest config, directory, naming convention, and timeout.
globs: ["scraper/tests/**/*.ts", "scraper/vitest*.config.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Scraper Test Layout — four tiers, four configs

Tests in the scraper workspace are organized by tier. Each tier has a dedicated
directory, vitest config, and timeout budget. Placing a test in the wrong tier
either slows the fast suite or starves the slow one of its timeout.

| Tier | Directory | Config | Timeout | Pool | Purpose |
|------|-----------|--------|---------|------|---------|
| Unit | `scraper/tests/unit/` | `vitest.config.ts` | default | default | Mocked, isolated, fast |
| Integration | `scraper/tests/integration/` | `vitest.integration.config.ts` | 60s | default | Real DB + Redis (loads dotenv), no Puppeteer |
| E2E | `scraper/tests/e2e/` | `vitest.e2e.config.ts` | 120s | forks (singleFork) | Full orchestrator against real sources, no DB writes |
| Load | `scraper/tests/load/` | `vitest.load.config.ts` | 300s | default | Concurrency / performance |

## File naming

- Unit: `<subject>.test.ts` (e.g. `nse-scraper.test.ts`)
- Integration: `<subject>.integration.test.ts`
- E2E: `<subject>.e2e.test.ts`
- Load: `<subject>.test.ts` inside `tests/load/` (the directory is the marker)

## Placement rules

- MUST place a test in the tier matching its dependencies: anything touching a
  real database or Redis is at least integration; anything driving a real
  scraper orchestrator end-to-end is e2e
- MUST NOT add Puppeteer/browser work to integration tests — that belongs in e2e
  (which runs `singleFork` precisely because browser sessions don't parallelize)
- MUST NOT raise a tier's timeout to accommodate one slow test — move the test
  up a tier instead
- E2E tests MUST NOT write to the database — they validate scrape + transform,
  not persistence (persistence is covered by integration tests)
- New tiers/configs MUST NOT be invented ad hoc — extend the existing four or
  discuss a structural change first

## Running

```bash
cd scraper
npx vitest run tests/unit/path/to/x.test.ts                # single unit test
npx vitest run -c vitest.integration.config.ts             # integration suite
npx vitest run -c vitest.e2e.config.ts                     # e2e suite
npx vitest run -c vitest.load.config.ts                    # load suite
```

## CRITICAL RULES

- MUST match directory, file-name suffix, AND config to the tier
- MUST NOT mix tiers (DB access in unit, browser in integration)
- MUST NOT inflate tier timeouts — re-tier the test instead
