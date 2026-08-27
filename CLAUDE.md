# 5 Wealths portfolio context — READ FIRST

This repo is one project inside Abhay's 5 Wealths portfolio. Before doing any strategic, scoping, or governance work in this session, read the three files below in order. They explain the portfolio, the boundary rule, the immutable principles, and the glossary used across all of Abhay's projects.

@./5W-CONTEXT.md
@./5W-PRINCIPLES.md
@./5W-GLOSSARY.md

**If the @-import syntax is not honored by your client (e.g., not running inside Claude Code), use the Read tool to load the three files manually before proceeding:**

- `./5W-CONTEXT.md` — what 5 Wealths is, where it lives, the L-042 boundary rule, cross-reference protocol
- `./5W-PRINCIPLES.md` — the four immutable principles (productize, scale, automate, continuously update)
- `./5W-GLOSSARY.md` — decoded shorthand (entities, regulators, sister projects, terms)

**Boundary reminder (non-negotiable):** Never write into `D:\Abhay\VibeCoding\5Wealths\` from this repo. Strategic decisions surfaced here get captured as `TODO(5W):` notes; Abhay carries them across in a separate 5 Wealths session.

---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

**Commands (root proxies dev/dev:scraper/scraper:nse/lint/build/test:unit + audit:prod — the rest run from web/):**
```bash
# Development
npm run dev                    # Next.js dev server (port 3000, Turbopack; web/ has dev:webpack fallback)
npm run dev:scraper            # Scraper in dev mode

# Testing
npm run test:unit              # Unit tests (<10s)
cd web && npm run test:integration   # Integration tests (requires DB + Redis; web/ only)
cd web && npm run test:e2e           # E2E tests with Playwright (web/ only)

# Single test
cd web && npx vitest run tests/unit/path/to/test.test.ts
cd web && npx playwright test tests/e2e/path/to/test.spec.ts

# Database (from web/)
npm run db:generate            # Generate migration from schema changes
npm run db:migrate             # Apply migrations
npm run db:studio              # Drizzle Studio GUI (port 4983)
npm run seed:force             # Seed database (truncates first)

# Code Quality
npm run lint && npm run build

# Scraper (from scraper/)
npm start                      # Run all enabled scrapers once (NSE included — there is no start:nse)
npm run start:bse              # Single source: bse | moneycontrol | chittorgarh | gmp | fallback | api
npm run scheduler              # Cron-based scheduler (production mode; SCRAPER_INTERVAL_MODE=dev relaxes cadence)
cd scraper && npx vitest run tests/unit/path/to/test.test.ts  # Single scraper test (tiers/configs: .claude/rules/scraper-test-layout.md)

# Production verification (run BOTH after any deploy — see .claude/rules/repeatable-production-audit.md)
npm run audit:prod                   # Read-only API + data-integrity audit of live site (exit 1 = real failure)
npm run audit:data                   # audit:coverage (--gate) + audit:prod — run this, not audit:prod alone
npm run audit:substance              # Plausibility gate: absurd-but-rendering values (exit 1 = real failure)
cd web && npm run test:prod-verify   # Browser-level Playwright sweep of prod routes (console errors, blank pages)
cd web && npm run lint:ci            # The lint gate CI actually runs (scripts/lint-ci-gate.mjs), not bare eslint
```

**Critical Rules:**
- **Schema**: Edit ONLY `packages/shared/src/db/schema.ts` (single source of truth)
- **Services/Server Components**: Use repositories directly, NEVER HTTP API calls
- **Repositories**: Extend `BaseRepository` for automatic caching
- **Slugs**: Use `generateIPOSlug()` from `@ipodhan/shared/utils/slug`

---

## Project Overview

IPODhan is an IPO information platform for Indian investors. Tech stack: Next.js 15 (App Router) + React 18, PostgreSQL 16 + Drizzle ORM, Redis, TypeScript, Tailwind CSS 4. (**README.md is stale — do not trust it.** It still claims Next.js 14 and a "Windows Server 2022 VPS" deployment that was retired in Aug 2026. `package.json` is authoritative for the stack; the Production & Deployment section below is authoritative for hosting.)

**Monorepo Structure (npm workspaces: web, scraper, packages/*):**
```
IPODhan/
├── packages/shared/                  # @ipodhan/shared - used by both web & scraper
│   └── src/db/schema.ts              # DB schema (26 tables) - SINGLE SOURCE OF TRUTH
│       (also: repositories, services, utils, errors, types)
├── web/                              # Next.js app
│   ├── app/                          # Pages & API routes
│   ├── lib/repositories/             # Data access with caching
│   ├── lib/services/                 # Business logic
│   └── lib/cache/                    # Redis client & cache keys
└── scraper/                          # Multi-source data scraping service (ESM, tsx)
```

---

## Critical Architecture Patterns

### 1. Database Schema

All schema in `packages/shared/src/db/schema.ts`. Re-exported via `web/lib/db/index.ts`.

```typescript
// ✅ Correct imports
import { ipos, ipoStatusEnum } from '@/lib/db';
import * as schema from '@ipodhan/shared/db/schema';

// ❌ Wrong - web/lib/db/schema.ts is a STALE legacy duplicate. Never import or edit it.
import { ipos } from '@/lib/db/schema';
```

**Schema Changes:** Edit schema.ts → `npm run db:generate` → Review SQL → `npm run db:migrate`

### 2. Repository Pattern

All repositories extend `BaseRepository` for cache-aside pattern:

```typescript
export class IPORepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,  // schema from @ipodhan/shared/db/schema
    protected redis: Redis
  ) {
    super(db, redis);
  }

  async findBySlug(slug: string) {
    return this.getFromCache(getIPOBySlugKey(slug), async () => {
      // DB query
    }, CacheTTL.IPO_DETAIL);
  }
}
```

### 3. Service Layer (CRITICAL)

**Services and Server Components MUST use repositories directly:**

```typescript
// ✅ CORRECT
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

export async function getData() {
  const redis = getRedisClient();
  const repo = new IPORepository(db, redis);
  return repo.findAll({ segment: ['MAINBOARD'] });
}

// ❌ WRONG - Never use API client in services/Server Components
import { apiClient } from '@/lib/api-client';
```

ESLint enforces this rule automatically.

### 4. Cache Keys

Defined in `web/lib/cache/cache-keys.ts` (pattern: `{entity}:{operation}:{identifier}`):
```typescript
export const CacheTTL = {
  IPO_DETAIL: 900,          // 15 min
  IPO_LIST: 900,            // 15 min
  IPO_LISTINGS: 300,        // 5 min - matches page ISR revalidation
  SUBSCRIPTION_LATEST: 300, // 5 min
  GMP_LATEST: 600,          // 10 min
  REFERENCE: 604800,        // 7 days (registrars, holidays, sectors)
  // ...see cache-keys.ts for the full list
};
```

### 5. Slug Generation

```typescript
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
const slug = generateIPOSlug('XYZ Corporation Ltd'); // 'xyz-corporation-ltd'
```

### 6. Scraper Multi-Source Priority

The scraper pulls from multiple sources (NSE, BSE, Moneycontrol, Chittorgarh, InvestorGain GMP, API fallback). When sources conflict, the **field priority matrix** (`scraper/src/config/field-priority-matrix.ts`) decides per-field which source wins:

- Source priority order: `ADMIN` (manual override, always wins) > `DRHP` > `NSE` > `BSE` > `MONEYCONTROL` > `CHITTORGARH` > `INVESTORGAIN_GMP` > `API_FALLBACK`
- Each field can specify normalization (currency/date/company_name), confidence thresholds, and time-based rules (newest wins for real-time data like GMP/subscription)
- Each source has an **orchestrator** in `scraper/src/scrapers/` (prefer `*-v2.ts` versions); feature flags in `scraper/src/config/feature-flags.ts`
- Never write scraped data directly to the DB bypassing the consolidation/priority logic

---

## API Route Pattern

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';

export async function GET(request: NextRequest) {
  try {
    const redis = getRedisClient();
    const repo = new ResourceRepository(db, redis);
    return NextResponse.json({ success: true, data: await repo.findAll() });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

---

## Common Troubleshooting

| Error | Solution |
|-------|----------|
| `Can't resolve './schema'` | Use `@/lib/db` not `@/lib/db/schema` (the latter is a stale legacy copy) |
| Schema change has no effect | You edited `web/lib/db/schema.ts` (legacy duplicate) instead of `packages/shared/src/db/schema.ts` |
| `NodePgDatabase type error` | Import schema from `@ipodhan/shared/db/schema` |
| Zod version conflicts | Pinned to `^4.1.11` in root package.json overrides |
| Redis down | App auto-falls back to database |
| Tests failing | Run `npm run db:migrate`, check DB connection |
| A migration in `_gated/` "won't apply" | By design — `web/drizzle/migrations/_gated/` is destructive DDL kept OUT of `meta/_journal.json`. Apply manually after owner sign-off; adding it to the journal drops production columns. `_repair/` holds idempotent non-destructive fixes. |
| Timestamps off by 5h30m | A `new Pool(...)` missing `options: '-c timezone=UTC'`, or `configureUtcTimestampParsing()` not called before the first query. Every pool (web, scraper, scripts) needs both. |
| Scraper change committed but broken | Pre-commit type-checks `web/**` ONLY (`tsc --noEmit`); `scraper/` has `strict: false` and no commit-time type gate. Verify scraper changes by running its tests, not by trusting the commit. |

---

## Production & Deployment

- **Serving target (since the 2026-08 migration):** Linux VPS `72.61.240.224` — nginx + PM2
  (`ipodhan-web` cluster x2, `ipodhan-scraper` one-shot on cron), behind Cloudflare.
- **Deploy:** GitHub Actions `deploy-linux.yml`, on the `linux-vps-ipodhan` self-hosted runner.
- **CI is narrower than it looks.** `pr-gate.yml` (lint + type-check + unit tests, skipped for docs-only
  PRs) is the ONLY workflow that triggers on a PR. `ci.yml` and `test.yml` are `workflow_dispatch`-only
  after a prior Actions billing block — integration and E2E do NOT run automatically. Before merging
  anything non-trivial, dispatch them yourself or run the suites locally; a green pr-gate is not a green CI.
- **Database host:** the Windows VPS `103.118.16.189` still runs PostgreSQL 16 (and the Redis
  instance AlgoChanakya uses). The app connects to it remotely as the least-privilege role
  `ipodhan_app`; the `postgres` superuser is **localhost-only** and its password was rotated
  (T-252, 2026-08-21). A nightly Windows scheduled task `IPODhan-DB-Backup` (02:00 IST) dumps,
  restore-verifies, and copies the dump offsite to the Linux box.
- **Retired:** the Windows deploy path. `deploy.yml` and the four `vps-*.yml` workflows now live
  in `.github/workflows-disabled/` (inert — GitHub only reads `.github/workflows/`); the Windows
  runner `windows-vps-ipodhan` is stopped. Windows-era runbooks under `docs/` and
  `.claude/skills/windows-deployment-expert/` describe that retired path — read them as history.
- **Shared package must be compiled before web/scraper builds:** `cd packages/shared && npx tsc` — CI verifies `dist/db/schema.d.ts` exists. If types from `@ipodhan/shared` seem stale locally, rebuild it.

---

## Key Documentation

- `docs/02-architecture/backend-architecture.md` - 3-layer architecture
- `docs/05-caching/CACHING_STRATEGY.md` - Cache patterns
- `docs/16-database/SCHEMA_MANAGEMENT.md` - Schema workflow
- `docs/16-database/screen-table-database-field-mapping.md` - UI to DB field mapping

---

## Performance Targets

- API p95 < 500ms, p99 < 1000ms
- LCP < 2.5s
- DB queries p95 < 100ms
- Cache hit rate > 80%
- Support 1000 concurrent users

<!-- hub:best-practices:start -->

<!-- PROTECTED SECTION — managed by claude-best-practices hub. -->
<!-- Do NOT condense, rewrite, reorganize, or remove.          -->
<!-- Any /init or optimization request must SKIP this section.  -->

## Rules for Claude

1. **Bug Fixing**: Use `/fix-loop` or `/fix-github-issue`. Start by writing a test that reproduces the bug, then fix and prove with a passing test.
2. **Rules**: Path-scoped rules live in `.claude/rules/` and auto-load via `globs:` frontmatter when matching files are opened. Browse with `ls .claude/rules/` — enumerating each rule here would cost ~4k tokens per session for zero enforcement benefit.

## Claude Code Configuration

The `.claude/` directory contains 157 skills, 37 agents, and 81 rules for Claude Code.

<!-- hub:best-practices:end -->
