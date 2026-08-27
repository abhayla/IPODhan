---
name: web-data-access
description: >
  Enforces the web app's 3-layer data access — services and Server Components use
  repositories directly (ESLint-backed), repositories extend BaseRepository with
  cache-aside, constructor DI of (db, redis), and centralized cache keys + TTLs.
paths: ["web/lib/services/**/*.ts", "web/lib/repositories/**/*.ts", "web/app/**/*.tsx"]
version: "1.0.0"
synthesized: true
private: false
---

# Web Data Access — repositories, cache-aside, DI

## Services & Server Components → repositories, NEVER apiClient

`web/eslint.config.mjs` enforces this with `no-restricted-imports` (error) on
`web/lib/services/**` and Server Components, blocking the patterns
`**/api-client`, `../api-client`, `../../api-client`, `@/lib/api-client` with
the message "ARCHITECTURAL VIOLATION: Services and Server Components must NOT
use HTTP API calls."

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

// ❌ WRONG — HTTP round-trip to your own server
import { apiClient } from '@/lib/api-client';
```

The apiClient exists for Client Components only.

## Repository contract

Every repository extends `BaseRepository`
(`packages/shared/src/repositories/base-repository.ts`) and uses cache-aside:

- Constructor DI — repositories receive `(db: NodePgDatabase<typeof schema>,
  redis: Redis)` injected by the caller; MUST NOT construct their own
  connections or reach for globals
- Reads go through `this.getFromCache(cacheKey, dbQueryFn, ttl)` — cache hit →
  return; miss → run query → `setCache`. The base class applies a 2s cache
  timeout and falls back to the database on any Redis error (Redis down ≠
  outage)
- MUST NOT bypass `getFromCache` for cacheable reads or hand-roll Redis calls
  inside a repository method

## Cache keys & TTLs are centralized

Keys follow `{entity}:{operation}:{identifier}` and live in
`web/lib/cache/cache-keys.ts` together with the `CacheTTL` constants:

```typescript
CacheTTL.IPO_DETAIL = 900            // 15 min
CacheTTL.IPO_LIST = 900              // 15 min
CacheTTL.IPO_LISTINGS = 300          // 5 min — matches page ISR revalidation
CacheTTL.SUBSCRIPTION_LATEST = 300   // 5 min
CacheTTL.GMP_LATEST = 600            // 10 min
CacheTTL.REFERENCE = 604800          // 7 days (registrars, holidays, sectors)
```

- MUST define new keys/TTLs in `cache-keys.ts` — never inline string keys or
  magic TTL numbers in a repository
- TTLs that back ISR pages MUST stay aligned with the page's revalidation
  interval (see `IPO_LISTINGS`)

## CRITICAL RULES

- MUST use repositories directly in services and Server Components — the
  apiClient is for Client Components only (ESLint enforces; don't fight it)
- MUST extend `BaseRepository` and route cacheable reads through
  `getFromCache` with a key + TTL from `cache-keys.ts`
- MUST inject `(db, redis)` via constructor — no self-constructed connections
- MUST NOT inline cache key strings or TTL literals
