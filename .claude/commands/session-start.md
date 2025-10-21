# Session Startup Sequence

Execute this comprehensive startup sequence to orient Claude Code to the IPODhan project architecture.

## Step 0: Read CLAUDE.md (Project Overview)

**FIRST**, read `CLAUDE.md` to get the complete project context:
- Project overview and tech stack
- Monorepo structure
- Critical architecture patterns
- Environment variables
- Common development commands

This is the foundation - read it before all other steps.

## Step 1: Git Status Check

Run the following git commands to understand current state:

```bash
git status && git log --oneline -5 && git branch
```

Analyze and report:
- **Current branch**: What feature/task context does this indicate?
- **Recent commits** (last 5): What work has been done recently?
- **Uncommitted changes**: Any files in progress?
- **Branch status**: Ahead/behind main?

## Step 2: Read Core Architecture Documents

Read these two essential architecture documents:

1. **`docs/02-architecture/backend-architecture.md`** (555 lines)
   - Focus on: Repository pattern, service layer, BaseRepository usage
   - Key takeaway: Repository type requirements, cache-aside pattern

2. **`docs/05-caching/CACHING_STRATEGY.md`** (340 lines)
   - Focus on: Cache key conventions, TTL strategy, invalidation patterns
   - Key takeaway: Always use cache key generator functions

## Step 3: Provide Concise Summary

After reading, provide a **brief summary** (keep it under 15 lines):

### Git Context:
- Current branch and feature context
- Any critical uncommitted changes

### Key Architectural Patterns:
1. **Repository Pattern**: All repositories must extend `BaseRepository`
   - Type requirement: `NodePgDatabase<typeof schema>` from `@ipodhan/shared/db/schema`
2. **Caching**: Always use generator functions from `cache-keys.ts` (never hardcode)
3. **Cache Invalidation**: Mutations MUST invalidate related caches
4. **Service Layer**: Business logic coordinates multiple repositories
5. **Slug Generation** (Phase 3): Use canonical `generateIPOSlug()` from shared package
6. **API Fallback** (Phase 3): Use `findBySlugWithFallback()` for resilient lookups
7. **Monitoring & Logging** (Phase 5): Use Winston logger and Sentry APM for observability
8. **Real-time Scoring** (Phase 5): Use `IPOScoringService` for dynamic 0-10 scores
9. **Load Testing** (Phase 5): Use k6 scripts in `web/tests/load/` for performance validation

### Critical Warnings:
- Database schema: ONLY edit `packages/shared/src/db/schema.ts`
- No direct DB access in API routes (always use repositories)
- Cache keys: Use `getIPOBySlugKey(slug)` not `'ipo:slug:${slug}'`
- Slug generation: Use `generateIPOSlug()` not custom logic
- Scraper lot_size: Never allow lot_size = 1 (use validation utility)

## Step 4: Task Context

Ask the user: **"What task are you working on in this session?"**

Based on their response, automatically read relevant additional documentation:

### If Database/Schema Work:
- Read `docs/16-database/SCHEMA_MANAGEMENT.md` (workflow documentation)
- Read `packages/shared/src/db/schema.ts` (single source of truth)
- Remind: Schema → Migration → Database (never skip migration)

### If Writing Tests:
- Read `docs/02-architecture/testing-strategy.md` (600 lines)
- Remind: 80% coverage target, 90% for repositories
- Show: Test pyramid (70% unit, 20% integration, 10% E2E)

### If Adding Repository/Service:
- Read an example: `web/lib/repositories/ipo-repository.ts`
- Read `web/lib/repositories/base-repository.ts` for patterns
- Show: Repository constructor type requirements

### If Scraper Work:
- Read `scraper/README.md`
- Read `scraper/docs/SCRAPING_STRATEGY.md`
- If working on lot_size: Read `scraper/docs/LOT_SIZE_EXECUTIVE_SUMMARY.md`
- Remind: Use canonical slug generation from `@ipodhan/shared/utils/slug`

### If API Development:
- Read `docs/02-architecture/api-specification.md` (if exists)
- Remind: API Routes → Services → Repositories architecture
- If working on search/lookup: Read `web/docs/FUZZY_MATCHING.md` (fuzzy fallback patterns)
- Remind: Use `findBySlugWithFallback()` for resilient lookups

### If Frontend/UI Work:
- Read `docs/16-database/screen-table-database-field-mapping.md`
- Show: UI-to-database field mappings
- If working on IPO selection/dropdowns: Read `web/docs/IPO_COMPARE_VALIDATION.md`
- Remind: Always validate slugs before API calls

### If Category Pages (MAINBOARD/SME):
- Remind: Use `segment` filter in all queries (not `category`)
- Show: Zero cross-contamination validated (Phase 4: 495 IPOs tested)
- Test reports available: `test-results/phase-4/PHASE-4-SUMMARY.md`
- Cache isolation: MAINBOARD uses `mainboard:*`, SME uses `sme:*` prefixes
- Critical: All repositories filter by segment at query time

### If Working with Slugs/URLs:
- Read `packages/shared/docs/SLUG_GENERATION.md`
- Remind: Use `generateIPOSlug()` from `@ipodhan/shared/utils/slug`
- Show: Never create custom slug generation logic
- Migration script available: `web/scripts/regenerate-slugs.ts`

### If Monitoring/Logging Work (Phase 5):
- Read `web/lib/monitoring/README.md` (complete monitoring guide)
- Quick Start: `web/lib/monitoring/QUICK_START.md` (5-minute setup)
- Remind: Use Winston logger from `@/lib/logging/logger`
- Show: `logPerformance()`, `logError()` helper functions
- Sentry APM: Use `trackPerformance()` and `captureAPIError()` from `@/lib/monitoring/sentry-utils`
- Health endpoints: `/api/health-detailed`, `/api/metrics`
- Monitoring scripts: `db-health-check.ts`, `monitor-redis.ts`

### If IPO Scoring Work (Phase 5):
- Read `test-results/phase-5/real-time-scoring-report.md`
- Remind: Use `IPOScoringService` from `@/lib/services/ipo-scoring-realtime`
- Show: 5-component methodology (Financial, Valuation, Subscription, Market, Fundamentals)
- API endpoint: `GET /api/ipos/[slug]/score`
- Bulk calculation: `npx tsx scripts/recalculate-all-scores.ts`
- Testing: 32 tests, 93.5% coverage

### If Performance/Load Testing Work (Phase 5):
- Read `test-results/phase-5/production-load-testing-report.md`
- Show: k6 load test scripts in `web/tests/load/`
- Run API test: `k6 run web/tests/load/api-load-test.js`
- Run stress test: `k6 run web/tests/load/stress-test.js`
- Lighthouse CI: `lhci autorun` (Core Web Vitals)
- Performance targets: p95 < 500ms, p99 < 1000ms
- Database pool: 50 connections (~2500 users max)

## Step 5: Quick Validation

Optionally run health check (only if needed):
```bash
curl http://localhost:3000/api/health
```

If server not running, remind user:
```bash
cd web && npm run dev
```

## Step 6: Ready to Code

Conclude with:
- Summary of what docs were read
- Key patterns to remember for this specific task
- Any red flags or warnings specific to their task
- Confirmation: "Ready to start [task]. Architectural context loaded."

---

## Notes

- **This command replaces the need for separate Init** - it reads CLAUDE.md as Step 0
- This command should complete in **3-4 minutes**
- Keep summaries concise (users can always ask for details)
- Proactively read task-specific docs based on user's response
- Don't run health check unless specifically needed (e.g., debugging, testing)
- **Single command solution**: `/session-start` does everything for complete session orientation
