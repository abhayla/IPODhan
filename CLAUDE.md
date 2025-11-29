# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

**Commands (run from root or web/):**
```bash
# Development
npm run dev                    # Next.js dev server (port 3000)
npm run dev:scraper            # Scraper in dev mode

# Testing
npm run test:unit              # Unit tests (<10s)
npm run test:integration       # Integration tests (requires DB + Redis)
npm run test:e2e               # E2E tests with Playwright

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
```

**Critical Rules:**
- **Schema**: Edit ONLY `packages/shared/src/db/schema.ts` (single source of truth)
- **Services/Server Components**: Use repositories directly, NEVER HTTP API calls
- **Repositories**: Extend `BaseRepository` for automatic caching
- **Slugs**: Use `generateIPOSlug()` from `@ipodhan/shared/utils/slug`

---

## Project Overview

IPODhan is an IPO information platform for Indian investors. Tech stack: Next.js 15 (App Router), PostgreSQL 16 + Drizzle ORM, Redis, TypeScript, Tailwind CSS 4.

**Monorepo Structure:**
```
IPODhan/
├── packages/shared/src/db/schema.ts  # DB schema (13 tables) - SINGLE SOURCE OF TRUTH
├── web/                              # Next.js app
│   ├── app/                          # Pages & API routes
│   ├── lib/repositories/             # Data access with caching
│   ├── lib/services/                 # Business logic
│   └── lib/cache/                    # Redis client & cache keys
└── scraper/                          # Data scraping service
```

---

## Critical Architecture Patterns

### 1. Database Schema

All schema in `packages/shared/src/db/schema.ts`. Re-exported via `web/lib/db/index.ts`.

```typescript
// ✅ Correct imports
import { ipos, ipoStatusEnum } from '@/lib/db';
import * as schema from '@ipodhan/shared/db/schema';

// ❌ Wrong - file doesn't exist
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

Defined in `web/lib/cache/cache-keys.ts`:
```typescript
export const CacheTTL = {
  IPO_DETAIL: 900,    // 15 min
  IPO_LIST: 300,      // 5 min
  SUBSCRIPTION: 180,  // 3 min
  GMP: 900,           // 15 min
};
```

### 5. Slug Generation

```typescript
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
const slug = generateIPOSlug('XYZ Corporation Ltd'); // 'xyz-corporation-ltd'
```

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
| `Can't resolve './schema'` | Use `@/lib/db` not `@/lib/db/schema` |
| `NodePgDatabase type error` | Import schema from `@ipodhan/shared/db/schema` |
| Zod version conflicts | Pinned to `^4.1.11` in root package.json overrides |
| Redis down | App auto-falls back to database |
| Tests failing | Run `npm run db:migrate`, check DB connection |

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
