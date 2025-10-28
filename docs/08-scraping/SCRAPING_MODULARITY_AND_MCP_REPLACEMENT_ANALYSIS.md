# Scraping Modularity & MCP Replacement Impact Analysis

**Document Version:** 1.0
**Date:** 2025-10-27
**Status:** Architecture Analysis
**Author:** System Architecture Team

---

## Executive Summary

This document provides a comprehensive analysis of the IPODhan scraping system's modularity and assesses the impact of replacing the current scraping implementation with an MCP (Model Context Protocol) based solution.

**Key Findings:**
- **Modularity Score:** 8.5/10 - Highly modular with excellent separation of concerns
- **Replacement Impact:** MEDIUM - Requires interface compatibility layer but feasible
- **Recommended Approach:** Hybrid implementation (Option B) for minimal disruption
- **Estimated Migration Time:** 2-3 days including testing

---

## Table of Contents

1. [Modularity Assessment](#1-modularity-assessment)
2. [Architecture Overview](#2-architecture-overview)
3. [Integration Points](#3-integration-points)
4. [Dependency Analysis](#4-dependency-analysis)
5. [Coupling Analysis](#5-coupling-analysis)
6. [MCP Replacement Impact](#6-mcp-replacement-impact)
7. [Implementation Strategies](#7-implementation-strategies)
8. [Required Interface Contracts](#8-required-interface-contracts)
9. [Migration Checklist](#9-migration-checklist)
10. [Testing Strategy](#10-testing-strategy)
11. [Recommendations](#11-recommendations)

---

## 1. Modularity Assessment

### 1.1 Modularity Score: **8.5/10**

The IPODhan scraping system demonstrates **excellent modularity** with well-defined boundaries and separation of concerns.

### 1.2 Strengths

✅ **Independent Scraper Implementations**
- Each scraper (NSE, BSE, Moneycontrol, Chittorgarh, GMP) operates independently
- Can replace individual scrapers without affecting others
- CLI supports selective execution: `--source=nse|bse|moneycontrol|all`

✅ **Template Method Pattern**
- All scrapers extend `BaseScraperOrchestrator<TIPO, TSubscription>`
- Enforces consistent protection checks, validation, and cache invalidation
- Standardized result interface (`ScraperResult`)

✅ **Loose Coupling Between Scrapers**
- No dependencies between NSE, BSE, Moneycontrol implementations
- Each has its own orchestrator and scraping logic
- Shared utilities are optional (validators, transformers)

✅ **Service Layer Abstraction**
- `data-persister.ts` - Isolated database upsert logic
- `cache-invalidator.ts` - Independent cache cleanup service
- `failure-tracker.ts` - Scraper health monitoring
- `alerting-service.ts` - Notification system

✅ **Single Source of Truth**
- Database schema: `packages/shared/src/db/schema.ts`
- All scrapers use shared schema via `@ipodhan/shared` package
- Type safety enforced through Drizzle ORM

### 1.3 Weaknesses

⚠️ **Tight Coupling to Web Package**
- Scrapers import protection logic from `web/lib/admin/field-protection-checker.ts`
- Uses TypeScript path alias `@web/*` for cross-package imports
- **Risk:** Scraper breaks if protection logic moves

⚠️ **Inconsistent Database Initialization**
- Some files use `db` from `@ipodhan/shared`
- Others use `getDb()` from `web/lib/db/index.ts`
- **File:** `scraper/src/scheduler/jobs/update-statuses.ts` uses web's `getDb()`

⚠️ **Type Duplication**
- `ScraperSource` defined in both `scraper/src/services/types.ts` and `web/lib/db/types.ts`
- Risk of type drift if definitions diverge

⚠️ **No Transaction Support**
- Scrapers persist data without database transactions
- Partial updates possible if connection drops mid-operation
- Mitigated by retry logic with exponential backoff

⚠️ **Silent Cache Failures**
- Redis errors are caught and logged but don't halt scraping
- Users may see stale cache even with fresh data
- Acceptable trade-off (app works without Redis)

---

## 2. Architecture Overview

### 2.1 Directory Structure

```
scraper/
├── src/
│   ├── base/
│   │   └── BaseScraperOrchestrator.ts       # Template Method pattern
│   │
│   ├── scrapers/
│   │   ├── nse-scraper.ts                   # NSE scraping logic
│   │   ├── nse-scraper-orchestrator-v2.ts   # NSE orchestration
│   │   ├── bse-scraper.ts                   # BSE scraping logic
│   │   ├── bse-scraper-orchestrator-v2.ts   # BSE orchestration
│   │   ├── moneycontrol-scraper.ts          # Moneycontrol scraper
│   │   ├── moneycontrol-orchestrator-v2.ts  # Moneycontrol orchestration
│   │   ├── chittorgarh-scraper.ts           # Historical data scraper
│   │   ├── investorgain-gmp-scraper.ts      # GMP data scraper
│   │   ├── ipo-alerts-fallback.ts           # API fallback scraper
│   │   ├── listing-performance-updater.ts   # Listing performance
│   │   ├── bse-document-scraper.ts          # BSE documents
│   │   └── rights-debt-enrichment-scraper.ts # RIGHTS/debt enrichment
│   │
│   ├── services/
│   │   ├── data-persister.ts                # Database upsert + merge
│   │   ├── cache-invalidator.ts             # Redis cache cleanup
│   │   ├── scraper-failure-tracker.ts       # Failure tracking
│   │   ├── scraper-metrics-tracker.ts       # Metrics collection
│   │   ├── alerting-service.ts              # Alert notifications
│   │   └── ipo-alerts-client.ts             # API client + rate limiting
│   │
│   ├── scheduler/
│   │   ├── scheduler.ts                     # Main scheduler service
│   │   ├── config.ts                        # Scheduler configuration
│   │   ├── job-lock.ts                      # Redis-based job locking
│   │   └── jobs/
│   │       ├── update-statuses.ts           # Status update job
│   │       ├── health-check.ts              # Health monitoring
│   │       └── daily-summary.ts             # Daily reporting
│   │
│   ├── utils/
│   │   ├── validators.ts                    # Zod schemas
│   │   ├── logger.ts                        # Pino logger
│   │   ├── browser.ts                       # Puppeteer utilities
│   │   ├── match-ipo.ts                     # IPO matching logic
│   │   ├── lot-size-validator.ts            # Lot size validation
│   │   └── transform-past-ipo.ts            # Data transformation
│   │
│   ├── config.ts                            # Configuration loader
│   └── index.ts                             # CLI entry point
```

### 2.2 Scraper Hierarchy

```
BaseScraperOrchestrator<TIPO, TSubscription> (abstract)
  │
  ├─ NSEScraperOrchestratorV2
  │    └─ Uses: nse-scraper.ts
  │
  ├─ BSEScraperOrchestratorV2
  │    └─ Uses: bse-scraper.ts
  │
  ├─ MoneycontrolOrchestratorV2
  │    └─ Uses: moneycontrol-scraper.ts
  │
  ├─ ChittorgarhOrchestratorV2
  │    └─ Uses: chittorgarh-scraper.ts
  │
  ├─ InvestorgainGMPOrchestratorV2
  │    └─ Uses: investorgain-gmp-scraper.ts
  │
  └─ IPOAlertsFallbackOrchestratorV2
       └─ Uses: ipo-alerts-fallback.ts
```

### 2.3 Template Method Pattern

**File:** `scraper/src/base/BaseScraperOrchestrator.ts`

```typescript
export abstract class BaseScraperOrchestrator<TIPO, TSubscription = any> {
  // Abstract methods (subclasses MUST implement)
  protected abstract getScraperName(): ScraperSource;
  protected abstract scrapeData(): Promise<ScrapedData<TIPO, TSubscription>>;
  protected abstract validateIPO(ipo: TIPO): { success: boolean; data?: any; error?: any };

  // Template method (NOT overridable - enforces workflow)
  public async run(): Promise<ScraperResult> {
    // 1. Initialize repositories & services
    const ipoRepository = new IPORepository(this.db, this.redis);
    const subscriptionRepository = new SubscriptionRepository(this.db, this.redis);

    // 2. Scrape data (subclass-specific implementation)
    const { ipos, subscriptions } = await this.scrapeData();

    // 3. Process each IPO with protection checks
    for (const ipo of ipos) {
      // Check IPO-level lock (Phase 2 protection)
      if (await isIPOLocked(ipo.id)) {
        result.iposSkipped++;
        continue;
      }

      // Filter protected fields (Phase 2 protection)
      const filteredIPO = await filterProtectedFields(ipo);
      result.fieldsProtected += (Object.keys(ipo).length - Object.keys(filteredIPO).length);

      // Validate data
      const validation = this.validateIPO(filteredIPO);
      if (!validation.success) {
        result.iposFailed++;
        continue;
      }

      // Persist to database
      const persisted = await upsertIPO(validation.data);
      result.iposInserted += persisted.inserted ? 1 : 0;
      result.iposUpdated += persisted.updated ? 1 : 0;
    }

    // 4. Process subscriptions
    for (const sub of subscriptions) {
      await createSubscriptionSnapshot(sub);
      result.subscriptionsCreated++;
    }

    // 5. Cache invalidation
    await invalidateIPOCaches(this.redis, updatedSlugs);
    await invalidateSubscriptionCache(this.redis, updatedIPOIds);

    // 6. Logging
    await this.logResult(result);

    return result;
  }
}
```

**Key Features:**
- **Enforced Protection Checks:** IPO-level locks + field-level protection
- **Automatic Cache Invalidation:** Redis cleanup after each run
- **Standardized Error Handling:** Retry logic with exponential backoff
- **Comprehensive Logging:** Structured JSON logs with metrics

---

## 3. Integration Points

### 3.1 Database Integration

**Schema Location:** `packages/shared/src/db/schema.ts` (13 tables, single source of truth)

**Import Pattern:**
```typescript
// Scrapers import from shared package
import {
  db,                      // Drizzle database instance
  getRedisClient,          // Redis client singleton
  IPORepository,           // Data access layer
  SubscriptionRepository,
  GMPRepository,
  ScraperLogRepository
} from '@ipodhan/shared';

// Direct schema imports for advanced queries
import * as schema from '@ipodhan/shared/db/schema';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
```

**Database Connection (Lazy Pattern):**
```typescript
// File: packages/shared/src/db/index.ts
let _db: NodePgDatabase<typeof schema> | null = null;

export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_, prop) {
    if (!_db) {
      _db = drizzle(initPool(), { schema });
    }
    return (_db as any)[prop];
  }
});
```

**Tables Updated by Scrapers:**

| Table | Purpose | Updated By | Frequency |
|-------|---------|------------|-----------|
| `ipos` | Core IPO entity | All scrapers | Every run |
| `subscriptions` | Time-series subscription data | NSE, BSE | Every 15 min (market hours) |
| `gmp_records` | Grey Market Premium | GMP scraper | Daily |
| `documents` | IPO documents | BSE document scraper | On upload |
| `listing_performance` | Listing data | Listing scraper | Post-listing |
| `scraper_logs` | Execution logs | All scrapers | Every run |

### 3.2 Data Persistence Layer

**File:** `scraper/src/services/data-persister.ts`

**Key Functions:**

```typescript
// Upsert IPO with merge logic for dual-listed IPOs
export async function upsertIPO(
  ipoData: IPOInsert,
  repository: IPORepository
): Promise<{ inserted: boolean; updated: boolean; ipo: IPO }> {
  const slug = generateIPOSlug(ipoData.companyName);
  const existingIPO = await repository.findBySlug(slug);

  if (existingIPO) {
    // Merge listing exchanges for dual-listed IPOs (NSE + BSE)
    const mergedExchanges = mergeListingExchanges(
      existingIPO.listingExchanges,
      ipoData.listingExchange
    );

    // Check for data discrepancies (NSE vs BSE)
    if (existingIPO.issueSize !== ipoData.issueSize && ipoData.source === 'BSE') {
      logger.warn('Issue size mismatch, prioritizing NSE data');
      delete ipoData.issueSize; // Don't overwrite NSE data
    }

    const updated = await repository.update(existingIPO.id, {
      ...ipoData,
      listingExchanges: mergedExchanges
    });

    return { inserted: false, updated: true, ipo: updated };
  } else {
    const created = await repository.create(ipoData);
    return { inserted: true, updated: false, ipo: created };
  }
}

// Create subscription snapshot with retry logic
export async function createSubscriptionSnapshot(
  subscriptionData: SubscriptionInsert,
  repository: SubscriptionRepository
): Promise<Subscription> {
  const maxRetries = 3;
  const retryDelays = [1000, 2000, 4000]; // Exponential backoff

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await repository.create(subscriptionData);
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await sleep(retryDelays[attempt]);
    }
  }
}
```

**Merge Logic Features:**
- **Dual-Listed IPO Support:** Automatically merges NSE + BSE listings
- **Data Priority:** NSE data is authoritative for conflicting fields
- **Retry Logic:** Exponential backoff (1s → 2s → 4s) for transient errors
- **Constraint Handling:** Skips permanent DB constraint violations

### 3.3 Cache Invalidation

**File:** `scraper/src/services/cache-invalidator.ts`

```typescript
// Invalidate specific IPO caches
export async function invalidateIPOCaches(
  redis: Redis,
  slug: string
): Promise<void> {
  const keys = [
    `ipo:detail:${slug}`,
    `ipo:slug:${slug}`,
  ];

  await redis.del(...keys);

  // Pattern-based invalidation (safe with SCAN)
  await deleteKeysByPattern(redis, 'ipo:list:*');
  await deleteKeysByPattern(redis, 'ipo:search:*');
}

// Invalidate subscription caches
export async function invalidateSubscriptionCache(
  redis: Redis,
  ipoId: string
): Promise<void> {
  const keys = [
    `subscription:latest:${ipoId}`,
  ];

  await redis.del(...keys);
  await deleteKeysByPattern(redis, `subscription:history:${ipoId}:*`);
}

// Safe pattern-based deletion using SCAN
async function deleteKeysByPattern(
  redis: Redis,
  pattern: string
): Promise<number> {
  let cursor = '0';
  let deletedCount = 0;

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH', pattern,
      'COUNT', 100
    );

    if (keys.length > 0) {
      await redis.del(...keys);
      deletedCount += keys.length;
    }

    cursor = nextCursor;
  } while (cursor !== '0');

  return deletedCount;
}
```

**Invalidation Triggers:**
- **After each scraper run:** Clears all IPO list/search caches
- **After IPO upsert:** Clears specific IPO detail cache
- **After subscription update:** Clears subscription history cache

**Cache Key Patterns:**
- `ipo:detail:{slug}` - IPO detail page cache
- `ipo:slug:{slug}` - Slug-based lookup cache
- `ipo:list:*` - All filtered IPO list caches
- `ipo:search:*` - All search result caches
- `subscription:latest:{ipoId}` - Latest subscription snapshot
- `subscription:history:{ipoId}:*` - Subscription history

### 3.4 Scheduler Integration

**File:** `scraper/src/scheduler/scheduler.ts`

**Scheduled Jobs:**

| Job Name | Cron Expression (Prod) | Cron Expression (Dev) | Purpose |
|----------|----------------------|---------------------|---------|
| NSE Market Hours | `*/15 9-17 * * 1-5` | `*/30 9-17 * * 1-5` | Weekday 9AM-5PM IST |
| NSE After Hours | `*/30 0-8,18-23 * * 1-5` | `0 */2 0-8,18-23 * * 1-5` | Weekday 5PM-9AM IST |
| NSE Weekends | `0 */1 * * 0,6` | `0 */2 * * 0,6` | Saturday-Sunday |
| BSE (Same) | Same as NSE | Same as NSE | Same frequency |
| GMP Scraper | `0 10,16 * * 1-5` | `0 */4 * * *` | 10AM, 4PM IST |
| Health Check | `*/5 * * * *` | `*/10 * * * *` | Monitor scraper health |
| Daily Summary | `0 8 * * *` | Disabled | 8 AM IST reporting |
| Log Cleanup | `0 2 * * 0` | Disabled | Sunday 2 AM |

**Job Locking Mechanism (Redis-based):**
```typescript
// File: scraper/src/scheduler/job-lock.ts
export class JobLockManager {
  async acquireLock(jobName: string, ttl: number): Promise<boolean> {
    const lockKey = `scheduler:lock:${jobName}`;
    const acquired = await this.redis.set(lockKey, '1', 'EX', ttl, 'NX');
    return acquired === 'OK';
  }

  async releaseLock(jobName: string): Promise<void> {
    const lockKey = `scheduler:lock:${jobName}`;
    await this.redis.del(lockKey);
  }
}

// Usage in scheduler
const lockManager = new JobLockManager(redis);

cron.schedule('*/15 9-17 * * 1-5', async () => {
  if (await lockManager.acquireLock('nse-market-hours', 900)) { // 15 min TTL
    try {
      const orchestrator = new NSEScraperOrchestratorV2(db, redis);
      await orchestrator.run();
    } finally {
      await lockManager.releaseLock('nse-market-hours');
    }
  }
}, { timezone: 'Asia/Kolkata' });
```

**Configuration:**
```typescript
// File: scraper/src/scheduler/config.ts
export const schedulerConfig = {
  enabled: process.env.SCRAPER_ENABLED === 'true',
  mode: process.env.SCRAPER_INTERVAL_MODE || 'prod', // 'prod' or 'dev'
  timezone: 'Asia/Kolkata',
  jobs: {
    nse: {
      enabled: true,
      marketHours: '*/15 9-17 * * 1-5',
      afterHours: '*/30 0-8,18-23 * * 1-5',
      weekends: '0 */1 * * 0,6',
    },
    bse: {
      enabled: true,
      marketHours: '*/15 9-17 * * 1-5',
      afterHours: '*/30 0-8,18-23 * * 1-5',
      weekends: '0 */1 * * 0,6',
    },
    gmp: {
      enabled: true,
      interval: '0 10,16 * * 1-5',
    },
    healthCheck: {
      enabled: true,
      interval: '*/5 * * * *',
    },
  },
};
```

### 3.5 API Integration (Admin Monitoring)

**File:** `web/app/api/admin/scraper/status/route.ts`

```typescript
export async function GET(request: NextRequest) {
  try {
    const db = await getDb();
    const redis = getRedisClient();

    const scraperLogRepository = new ScraperLogRepository(db, redis);

    // Get last 10 scraper runs
    const recentLogs = await scraperLogRepository.findRecent(10);

    // Get failure tracking metrics
    const metrics = {
      nse: await getScraperMetrics('nse'),
      bse: await getScraperMetrics('bse'),
      moneycontrol: await getScraperMetrics('moneycontrol'),
      gmp: await getScraperMetrics('gmp'),
    };

    return NextResponse.json({
      success: true,
      data: {
        recentLogs,
        metrics,
        health: calculateOverallHealth(metrics),
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch scraper status' },
      { status: 500 }
    );
  }
}

function getScraperMetrics(source: ScraperSource) {
  return {
    lastRun: getLastRunTimestamp(source),
    consecutiveFailures: getConsecutiveFailures(source),
    successRate24h: getSuccessRate(source, 24),
    avgDuration: getAvgDuration(source),
  };
}
```

**Admin Dashboard Integration:**
- **Endpoint:** `GET /api/admin/scraper/status`
- **Purpose:** Monitor scraper health, success rates, last run timestamps
- **Data Source:** Reads from `scraper_logs` table and Redis metrics
- **No Trigger:** Admin API is read-only; scrapers run on schedule

### 3.6 Failure Tracking & Fallback

**File:** `scraper/src/services/scraper-failure-tracker.ts`

```typescript
export class ScraperFailureTracker {
  private failures = new Map<ScraperSource, number>();

  recordSuccess(source: ScraperSource): void {
    this.failures.set(source, 0);
  }

  recordFailure(source: ScraperSource): number {
    const count = (this.failures.get(source) || 0) + 1;
    this.failures.set(source, count);
    return count;
  }

  shouldTriggerFallback(source: ScraperSource): boolean {
    return (this.failures.get(source) || 0) >= 3;
  }
}

// Usage in orchestrator
const tracker = new ScraperFailureTracker();

try {
  const result = await nseScraper.run();
  tracker.recordSuccess('nse');
} catch (error) {
  const failureCount = tracker.recordFailure('nse');

  if (tracker.shouldTriggerFallback('nse')) {
    logger.warn('NSE scraper failed 3 times, triggering API fallback');
    await ipoAlertsFallback.run();
  }
}
```

**Fallback Behavior:**
- **Trigger:** NSE or BSE scraper fails 3 consecutive times
- **Fallback Source:** IPO Alerts API (https://api.ipoalerts.in)
- **Data Merge:** NSE/BSE data is ALWAYS authoritative; API is supplementary only
- **New IPOs:** Created if not found in NSE/BSE data
- **Rate Limiting:** 100 requests/hour for IPO Alerts API

---

## 4. Dependency Analysis

### 4.1 Shared Package Dependencies

**Key Exports from `@ipodhan/shared`:**

```typescript
// Database & Cache
export { db, pool, closePool, testConnection } from './db/index.js';
export { getRedisClient } from './cache/redis-client.js';

// Repositories (data access layer)
export { IPORepository } from './repositories/ipo-repository.js';
export { SubscriptionRepository } from './repositories/subscription-repository.js';
export { GMPRepository } from './repositories/gmp-repository.js';
export { ScraperLogRepository } from './repositories/scraper-log-repository.js';
export { DocumentRepository } from './repositories/document-repository.js';
export { ListingPerformanceRepository } from './repositories/listing-performance-repository.js';

// Types (Drizzle inferred types)
export type {
  IPO,
  IPOInsert,
  Subscription,
  SubscriptionInsert,
  GMPRecord,
  GMPRecordInsert,
  ScraperLog,
  ScraperLogInsert,
  ScraperSource,
  ScraperResult,
} from './types/index.js';

// Utilities
export { generateIPOSlug, validateSlug, generateUniqueSlug } from './utils/slug.js';
export { detectOfferingType } from './utils/offering-type.js';
```

**Scraper Import Pattern:**
```typescript
// File: scraper/src/scrapers/nse-scraper-orchestrator-v2.ts
import {
  db,
  getRedisClient,
  IPORepository,
  SubscriptionRepository,
  generateIPOSlug,
  type IPOInsert,
  type SubscriptionInsert,
} from '@ipodhan/shared';

import { BaseScraperOrchestrator } from '../base/BaseScraperOrchestrator.js';
import type { ScrapedIPO } from '../utils/validators.js';
```

### 4.2 External Library Dependencies

**Core Libraries:**

| Library | Version | Purpose | Critical? |
|---------|---------|---------|-----------|
| `puppeteer` | ^22.0.0 | Browser automation for NSE/BSE | ✅ YES |
| `cheerio` | ^1.1.2 | HTML parsing (lightweight) | ✅ YES |
| `node-cron` | ^4.2.1 | Cron scheduling | ✅ YES |
| `zod` | ^4.1.11 | Data validation | ✅ YES |
| `pino` | ^8.19.0 | Structured JSON logging | ✅ YES |
| `drizzle-orm` | 0.44.6 | ORM (via shared package) | ✅ YES |
| `pg` | latest | PostgreSQL driver | ✅ YES |
| `ioredis` | latest | Redis client | ✅ YES |
| `axios` | latest | HTTP client (API fallback) | 🟡 NO |

### 4.3 Environment Variables

**Required Configuration:**

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/ipodhan
# OR use individual parameters:
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=ipodhan
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password

# Redis (optional but recommended)
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional

# Scraper URLs
NSE_URL=https://www.nseindia.com/market-data/public-issues
BSE_URL=https://www.bseindia.com/publicissue.html
MONEYCONTROL_URL=https://www.moneycontrol.com/ipo/

# API Fallback (optional)
IPO_ALERTS_API_URL=https://api.ipoalerts.in
IPO_ALERTS_API_KEY=your_api_key

# Scraper Settings
SCRAPER_TIMEOUT=30000
RETRY_ATTEMPTS=3
RETRY_DELAYS=1000,2000,4000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW=3600000

# Scheduler (optional)
SCRAPER_ENABLED=true
SCRAPER_INTERVAL_MODE=prod  # 'prod' or 'dev'

# Logging
LOG_LEVEL=info
NODE_ENV=development
```

### 4.4 Cross-Package Dependencies

**Scraper → Shared Package (Required):**
```
@ipodhan/shared/db              → Database & schema
@ipodhan/shared/cache           → Redis client
@ipodhan/shared/repositories    → Data access layer
@ipodhan/shared/utils/slug      → Slug generation
@ipodhan/shared/types           → Type definitions
```

**Scraper → Web Package (Problematic):**
```
@web/lib/admin/field-protection-checker  → IPO protection checks
```
⚠️ **Issue:** This creates a circular dependency risk. Protection logic should be moved to shared package.

**Recommended Refactor:**
```
packages/shared/src/admin/
  └── field-protection-checker.ts  → Move here for shared access
```

---

## 5. Coupling Analysis

### 5.1 Tight Coupling (Necessary)

#### To Database Schema
- **Coupling:** Scraper repositories directly use `db` instance from shared package
- **Dependency:** Hard dependency on exact schema field names and types
- **Impact:** Changing schema requires migration + scraper code updates
- **Mitigation:** Schema is single source of truth in `packages/shared/src/db/schema.ts`
- **Risk Level:** 🟡 **MEDIUM** (managed through migrations)

#### To Validation Schemas
- **Coupling:** All scrapers use Zod schemas from `utils/validators.ts`
- **Dependency:** Type definitions must match database column types
- **Impact:** Schema changes require validator updates
- **Mitigation:** Schemas are version-controlled and tested
- **Risk Level:** 🟢 **LOW** (well-managed)

### 5.2 Loose Coupling (Replaceable)

#### Scraper Implementations
- **Independence:** Each scraper can be replaced without affecting others ✅
- **Interface:** Standard `BaseScraperOrchestrator<TIPO, TSubscription>` contract
- **Example:** Could replace NSE Puppeteer with API-based scraper if NSE changes
- **Risk Level:** 🟢 **VERY LOW** (excellent modularity)

#### Data Persistence Layer
- **Isolation:** `data-persister.ts` is isolated service
- **Flexibility:** Could implement different merge logic without affecting scrapers
- **Abstraction:** Repositories abstract database operations
- **Risk Level:** 🟢 **LOW** (well-abstracted)

#### Cache Layer
- **Independence:** `cache-invalidator.ts` is independent service
- **Graceful Degradation:** Application works without Redis (cache failures are non-fatal)
- **Source of Truth:** Database is always authoritative
- **Risk Level:** 🟢 **VERY LOW** (optional component)

#### Scheduler
- **Configuration:** Job definitions configurable via environment variables
- **Flexibility:** Cron expressions can be changed without code changes
- **Control:** Individual jobs can be disabled via flags
- **Risk Level:** 🟢 **LOW** (highly configurable)

### 5.3 Hidden Dependencies (Not Obvious)

#### 1. Protection Checker (Web ↔ Scraper)

**File:** `scraper/src/base/BaseScraperOrchestrator.ts`

```typescript
import {
  isIPOLocked,
  isFieldProtected,
  filterProtectedFields
} from '@web/lib/admin/field-protection-checker';  // ← Path alias to web/
```

**Issue:** Scraper imports from web/ directory via TypeScript path alias
**Defined In:** `scraper/tsconfig.json` path mapping `@web/*`
**Risk:** 🔴 **HIGH** - Tight coupling between scraper and admin protection logic
**Recommended Fix:** Move protection logic to `packages/shared/src/admin/`

#### 2. Database Initialization Inconsistency

**Pattern 1 (Correct):**
```typescript
// Scraper uses shared package db
import { db } from '@ipodhan/shared';
```

**Pattern 2 (Inconsistent):**
```typescript
// Scheduler job uses web db function
// File: scraper/src/scheduler/jobs/update-statuses.ts
import { getDb } from '../../../../web/lib/db/index.js';
```

**Issue:** Two different ways to access same database
**Risk:** 🟡 **MEDIUM** - Confusion and potential connection pool issues
**Recommended Fix:** Standardize on `db` from `@ipodhan/shared`

#### 3. Type Duplication

**Location 1:** `scraper/src/services/types.ts`
```typescript
export type ScraperSource = 'nse' | 'bse' | 'moneycontrol' | 'chittorgarh' | 'gmp' | 'fallback';
```

**Location 2:** `web/lib/db/types.ts`
```typescript
export type ScraperSource = 'nse' | 'bse' | 'moneycontrol' | 'chittorgarh' | 'gmp' | 'fallback';
```

**Issue:** Type drift if definitions diverge
**Risk:** 🟡 **MEDIUM** - Type safety compromised
**Recommended Fix:** Move to `packages/shared/src/types/scraper-types.ts`

### 5.4 Interface Contracts

#### Scraper → Repository Contract

```typescript
// Required repository methods
interface IIPORepository {
  findBySlug(slug: string): Promise<IPO | null>;
  create(data: IPOInsert): Promise<IPO>;
  update(id: string, data: Partial<IPOInsert>): Promise<IPO>;
  upsert(data: IPOInsert): Promise<IPO>;
}

// Scraper usage
const ipoRepository = new IPORepository(db, redis);
const ipo = await ipoRepository.upsert(ipoData);
```

#### Scraper → Validation Contract

```typescript
// All validated data must match this interface
interface ScrapedIPO {
  companyName: string;
  issueSize: number;            // In crores (₹)
  priceRangeMin: number;
  priceRangeMax: number;
  openDate: string;             // ISO 8601 format
  closeDate: string;            // ISO 8601 format
  segment: 'MAINBOARD' | 'SME' | null;
  offeringType: 'IPO' | 'FPO' | 'RIGHTS' | 'OFS' | 'INVIT' | 'REIT' | 'NCD';
  status: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED';
  lotSize: number;              // MUST be >= 10
  listingExchange: 'NSE' | 'BSE';

  // Optional fields
  leadManagers?: string[];
  registrar?: string;
  bseScripCode?: string;
  nseSymbol?: string;
}
```

#### Scraper Result Contract

```typescript
// All scrapers must return this result structure
interface ScraperResult {
  success: boolean;
  source: ScraperSource;
  iposProcessed: number;
  iposInserted: number;
  iposUpdated: number;
  iposFailed: number;
  iposSkipped: number;
  subscriptionsCreated: number;
  subscriptionsSkipped: number;
  fieldsProtected: number;
  duration: number;             // In milliseconds
  errors: string[];
  timestamp: Date;
}
```

---

## 6. MCP Replacement Impact

### 6.1 Impact Level: **MEDIUM**

Replacing the scraping system with MCP-based scraping requires an **interface compatibility layer** but is **feasible without major architectural changes**.

### 6.2 What Needs to Change

#### Critical Integration Points

```
MCP Scraper Must Provide:
├─ Data Persistence → Write to same PostgreSQL tables (13 tables)
├─ Cache Invalidation → Clear Redis keys after updates
├─ Validation → Match Zod schemas (ScrapedIPOSchema)
├─ Protection Checks → Respect IPO-level locks + field-level protection
├─ Result Reporting → Return ScraperResult interface
└─ Scheduler Integration → Cron-based job scheduling
```

#### Database Tables to Update

| Table | Purpose | Required? | Frequency |
|-------|---------|-----------|-----------|
| `ipos` | Core IPO entity | ✅ **YES** | Every scrape |
| `subscriptions` | Time-series subscription data | ✅ **YES** | Every scrape |
| `gmp_records` | Grey Market Premium | 🟡 Optional | If scraping GMP |
| `documents` | IPO documents | 🟡 Optional | If scraping docs |
| `listing_performance` | Listing performance | 🟡 Optional | Historical data |
| `scraper_logs` | Execution logs | ✅ Recommended | Monitoring |

#### Required Imports

```typescript
// MCP scraper MUST import from shared package
import {
  db,                    // Drizzle database instance
  getRedisClient,        // Redis client
  IPORepository,         // Data access layer
  SubscriptionRepository,
  ScraperLogRepository,
  generateIPOSlug,       // Canonical slug generation
  type IPOInsert,
  type SubscriptionInsert,
  type ScraperResult,
} from '@ipodhan/shared';
```

### 6.3 What Stays the Same (No Impact)

✅ **Web Application**
- API routes continue working unchanged
- UI components require no modifications
- User experience remains identical
- No frontend code changes needed

✅ **Repository Layer**
- Existing repositories continue functioning
- `IPORepository.create()` / `update()` methods work as-is
- Cache-aside pattern remains intact
- No repository code changes needed

✅ **Admin Panel**
- Protection logic still enforced automatically
- IPO-level locks respected
- Field-level protection intact
- Admin monitoring continues working

✅ **Redis Cache**
- Same cache key patterns used
- Cache invalidation logic unchanged
- Graceful degradation remains
- No cache configuration changes

### 6.4 Impact Summary by Component

| Component | Impact Level | Changes Required | Risk |
|-----------|-------------|------------------|------|
| **Web Application** | 🟢 **NONE** | No changes | Very Low |
| **API Routes** | 🟢 **NONE** | Continue working | Very Low |
| **Database Schema** | 🟢 **NONE** | Use existing tables | Very Low |
| **Cache Layer** | 🟢 **NONE** | Same Redis keys | Very Low |
| **Shared Package** | 🟢 **NONE** | Reuse repositories | Very Low |
| **Scheduler** | 🟡 **MEDIUM** | Update cron jobs | Medium |
| **Admin Panel** | 🟢 **NONE** | Protection works | Very Low |
| **Monitoring** | 🟡 **LOW** | Update dashboard source | Low |
| **Testing** | 🟡 **MEDIUM** | Write integration tests | Medium |
| **Documentation** | 🟡 **LOW** | Update scraper docs | Low |

---

## 7. Implementation Strategies

### 7.1 Option A: Complete Replacement (Low Risk)

**Approach:** Build MCP scraper that replaces `scraper/` package entirely

```
Project Structure:
mcp-scraper/
├── src/
│   ├── nse-mcp-scraper.ts       # MCP-based NSE scraper
│   ├── bse-mcp-scraper.ts       # MCP-based BSE scraper
│   ├── gmp-mcp-scraper.ts       # MCP-based GMP scraper
│   └── data-writer.ts           # Writes to shared DB
├── package.json
└── tsconfig.json
```

**Implementation:**

```typescript
// File: mcp-scraper/src/nse-mcp-scraper.ts
import { db, IPORepository, getRedisClient, generateIPOSlug } from '@ipodhan/shared';
import { invalidateIPOCaches } from './cache-invalidator';

export async function mcpNSEScraper(): Promise<ScraperResult> {
  const result: ScraperResult = {
    success: true,
    source: 'nse',
    iposProcessed: 0,
    iposInserted: 0,
    iposUpdated: 0,
    iposFailed: 0,
    errors: [],
  };

  try {
    // 1. Use MCP tool to scrape NSE data
    const scrapedIPOs = await mcp.scrapeNSE(); // Your MCP tool

    // 2. Use existing repositories
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    // 3. Process each IPO
    for (const ipoData of scrapedIPOs) {
      // Validate using Zod
      const validation = ScrapedIPOSchema.safeParse(ipoData);
      if (!validation.success) {
        result.iposFailed++;
        result.errors.push(validation.error.message);
        continue;
      }

      // Generate slug
      const slug = generateIPOSlug(ipoData.companyName);

      // Upsert to database
      const existing = await ipoRepository.findBySlug(slug);
      if (existing) {
        await ipoRepository.update(existing.id, validation.data);
        result.iposUpdated++;
      } else {
        await ipoRepository.create(validation.data);
        result.iposInserted++;
      }

      // Invalidate cache
      await invalidateIPOCaches(redis, slug);

      result.iposProcessed++;
    }

    return result;
  } catch (error) {
    result.success = false;
    result.errors.push(error.message);
    return result;
  }
}
```

**Pros:**
- ✅ Complete control over scraping logic
- ✅ No dependency on existing scraper code
- ✅ Can optimize for MCP architecture
- ✅ Seamless drop-in replacement

**Cons:**
- ⚠️ Must implement protection checks manually
- ⚠️ Must implement cache invalidation manually
- ⚠️ Must implement scheduler yourself
- ⚠️ More code to write and maintain

**Timeline:** 4-5 days

---

### 7.2 Option B: Hybrid Approach (Recommended)

**Approach:** Keep `BaseScraperOrchestrator` pattern, replace scraping logic only

```typescript
// File: scraper/src/scrapers/nse-mcp-orchestrator.ts
import { BaseScraperOrchestrator } from '../base/BaseScraperOrchestrator';
import { mcpScrapeNSE } from 'your-mcp-package';
import type { ScrapedIPO } from '../utils/validators';

export class NSEMCPOrchestrator extends BaseScraperOrchestrator<ScrapedIPO> {
  protected getScraperName(): ScraperSource {
    return 'nse';
  }

  protected async scrapeData(): Promise<ScrapedData<ScrapedIPO, SubscriptionData>> {
    // Use MCP instead of Puppeteer
    const ipos = await mcpScrapeNSE();  // Your MCP tool

    // Extract subscriptions if available
    const subscriptions = ipos
      .filter(ipo => ipo.subscriptionData)
      .map(ipo => ({
        ipoId: ipo.id,
        ...ipo.subscriptionData,
      }));

    return { ipos, subscriptions };
  }

  protected validateIPO(ipo: ScrapedIPO): ValidationResult {
    // Use existing validation logic
    return ScrapedIPOSchema.safeParse(ipo);
  }
}

// Usage
const orchestrator = new NSEMCPOrchestrator(db, redis);
const result = await orchestrator.run();
```

**Pros:**
- ✅ **Automatic protection checks** (IPO locks, field protection)
- ✅ **Automatic cache invalidation** (Redis cleanup)
- ✅ **Automatic logging** to `scraper_logs` table
- ✅ **Scheduler integration** continues working
- ✅ **Admin monitoring** endpoint works unchanged
- ✅ **Failure tracking** and fallback mechanism intact
- ✅ **Minimal code changes** (only `scrapeData()` method)

**Cons:**
- ⚠️ Must extend `BaseScraperOrchestrator` class
- ⚠️ Must follow existing interface contracts

**Timeline:** 2-3 days

---

### 7.3 Option C: MCP as Fallback (Lowest Risk)

**Approach:** Add MCP scraper as additional fallback source

```
Current Fallback Chain:
NSE → BSE → Moneycontrol → IPO Alerts API

New Fallback Chain:
NSE → BSE → Moneycontrol → MCP Scraper → IPO Alerts API
```

**Implementation:**

```typescript
// File: scraper/src/services/scraper-failure-tracker.ts
export class ScraperFailureTracker {
  async runWithFallback(): Promise<ScraperResult> {
    // 1. Try NSE scraper
    try {
      return await nseScraper.run();
    } catch (error) {
      logger.warn('NSE scraper failed, trying BSE');
    }

    // 2. Try BSE scraper
    try {
      return await bseScraper.run();
    } catch (error) {
      logger.warn('BSE scraper failed, trying Moneycontrol');
    }

    // 3. Try Moneycontrol scraper
    try {
      return await moneycontrolScraper.run();
    } catch (error) {
      logger.warn('Moneycontrol scraper failed, trying MCP');
    }

    // 4. Try MCP scraper (NEW)
    try {
      return await mcpScraper.run();
    } catch (error) {
      logger.warn('MCP scraper failed, trying API fallback');
    }

    // 5. Try IPO Alerts API (last resort)
    return await ipoAlertsFallback.run();
  }
}
```

**Pros:**
- ✅ Zero risk to existing scrapers
- ✅ MCP as safety net
- ✅ Gradual migration path
- ✅ Easy to test and validate

**Cons:**
- ⚠️ MCP may rarely run (NSE/BSE are 95%+ reliable)
- ⚠️ Doesn't fully replace existing scrapers
- ⚠️ Limited value if primary scrapers work

**Timeline:** 1-2 days

---

### 7.4 Comparison Matrix

| Criteria | Option A | Option B (Recommended) | Option C |
|----------|----------|----------------------|----------|
| **Risk Level** | Medium | Low | Very Low |
| **Development Time** | 4-5 days | 2-3 days | 1-2 days |
| **Code Reuse** | Low | High | High |
| **Protection Checks** | Manual | Automatic | Automatic |
| **Cache Invalidation** | Manual | Automatic | Automatic |
| **Scheduler Integration** | Manual | Automatic | Automatic |
| **Monitoring** | Manual | Automatic | Automatic |
| **Full Replacement** | Yes | Yes | No |
| **Fallback Safety** | No | Yes | Yes |
| **Testing Effort** | High | Medium | Low |
| **Maintenance** | High | Low | Low |

**Recommendation:** **Option B (Hybrid Approach)** offers the best balance of risk, effort, and maintainability.

---

## 8. Required Interface Contracts

### 8.1 Scraped Data Structure

Your MCP scraper **MUST** provide this data structure:

```typescript
interface ScrapedIPO {
  // ===== REQUIRED FIELDS =====

  // Company Information
  companyName: string;                  // Example: "XYZ Corporation Ltd"
  slug: string;                         // Use generateIPOSlug(companyName)
  segment: 'MAINBOARD' | 'SME' | null;  // null for RIGHTS/InvITs/REITs
  offeringType: 'IPO' | 'FPO' | 'RIGHTS' | 'OFS' | 'INVIT' | 'REIT' | 'NCD';
  status: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED';

  // Financial Information
  issueSize: number;                    // In crores (₹) - Example: 500.00
  priceRangeMin: number;                // Example: 100
  priceRangeMax: number;                // Example: 120
  lotSize: number;                      // MUST be >= 10 (CRITICAL)

  // Dates (ISO 8601 strings)
  openDate: string;                     // Example: "2025-10-27T00:00:00.000Z"
  closeDate: string;                    // Example: "2025-10-30T00:00:00.000Z"

  // Exchange Information
  listingExchange: 'NSE' | 'BSE';

  // ===== OPTIONAL BUT RECOMMENDED =====

  listingDate?: string | null;          // ISO 8601
  allotmentDate?: string | null;        // ISO 8601
  bseScripCode?: string | null;         // Example: "543210"
  nseSymbol?: string | null;            // Example: "XYZLTD"

  // Issue Details
  totalShares?: number | null;          // In thousands
  freshIssue?: number | null;           // In crores
  offerForSale?: number | null;         // In crores
  minInvestment?: number | null;        // lotSize * priceRangeMin
  maxInvestment?: number | null;        // lotSize * priceRangeMax

  // Parties
  leadManagers?: string[] | null;       // ["Manager 1", "Manager 2"]
  registrar?: string | null;            // "Link Intime India Pvt Ltd"

  // Company Details
  sector?: string | null;               // "Technology"
  industry?: string | null;             // "Software Development"
  description?: string | null;          // Company description

  // ===== SUBSCRIPTION DATA (Optional) =====

  subscriptionData?: {
    qibSubscription: number;            // Times subscribed (e.g., 2.5)
    niiSubscription: number;            // Times subscribed
    retailSubscription: number;         // Times subscribed
    totalSubscription: number;          // Times subscribed
    timestamp: Date;                    // When this snapshot was taken
  } | null;

  // ===== METADATA =====

  source: ScraperSource;                // 'nse' | 'bse' | 'mcp'
  scrapedAt: Date;                      // Timestamp of scrape
}
```

### 8.2 Critical Validation Rules

Your MCP scraper **MUST** respect these validation rules:

```typescript
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';

// 1. LOT SIZE VALIDATION (CRITICAL - Phase 3 fix)
if (lotSize < 10) {
  throw new ValidationError('Invalid lot size - must be >= 10');
}
// Historical incident: 68.89% of IPOs had lot_size = 1 before fix

// 2. DATE VALIDATION
const openDateObj = new Date(openDate);
const closeDateObj = new Date(closeDate);
if (closeDateObj < openDateObj) {
  throw new ValidationError('Close date cannot be before open date');
}

// 3. PRICE RANGE VALIDATION
if (priceRangeMax < priceRangeMin) {
  throw new ValidationError('Max price cannot be less than min price');
}

// 4. SLUG GENERATION (use canonical utility - NEVER custom logic)
const slug = generateIPOSlug(companyName);
// Example: "XYZ Corporation Ltd" → "xyz-corporation-ltd"

// 5. SEGMENT FIELD IS NULLABLE (supports RIGHTS/InvITs/REITs)
const segment = detectSegment(companyName); // 'MAINBOARD' | 'SME' | null

// 6. ISSUE SIZE VALIDATION
if (issueSize <= 0) {
  throw new ValidationError('Issue size must be positive');
}

// 7. STATUS VALIDATION
const validStatuses = ['UPCOMING', 'OPEN', 'CLOSED', 'LISTED'];
if (!validStatuses.includes(status)) {
  throw new ValidationError(`Invalid status: ${status}`);
}

// 8. OFFERING TYPE VALIDATION
const validOfferingTypes = ['IPO', 'FPO', 'RIGHTS', 'OFS', 'INVIT', 'REIT', 'NCD'];
if (!validOfferingTypes.includes(offeringType)) {
  throw new ValidationError(`Invalid offering type: ${offeringType}`);
}
```

### 8.3 Scraper Result Interface

All scrapers must return this standardized result:

```typescript
interface ScraperResult {
  // Overall status
  success: boolean;                     // true if scraper completed without critical errors
  source: ScraperSource;                // 'nse' | 'bse' | 'moneycontrol' | 'mcp'

  // IPO metrics
  iposProcessed: number;                // Total IPOs attempted
  iposInserted: number;                 // New IPOs created in database
  iposUpdated: number;                  // Existing IPOs updated
  iposFailed: number;                   // IPOs that failed validation/persistence
  iposSkipped: number;                  // IPOs skipped (e.g., due to locks)

  // Subscription metrics
  subscriptionsCreated: number;         // Subscription snapshots created
  subscriptionsSkipped: number;         // Subscriptions skipped (e.g., duplicates)

  // Protection metrics (Phase 2)
  fieldsProtected: number;              // Number of fields blocked by protection

  // Performance metrics
  duration: number;                     // Scraper execution time in milliseconds
  timestamp: Date;                      // When scraper completed

  // Error tracking
  errors: string[];                     // Array of error messages
  warnings: string[];                   // Array of warning messages
}

// Example result
const result: ScraperResult = {
  success: true,
  source: 'nse',
  iposProcessed: 15,
  iposInserted: 3,
  iposUpdated: 12,
  iposFailed: 0,
  iposSkipped: 0,
  subscriptionsCreated: 5,
  subscriptionsSkipped: 10,
  fieldsProtected: 2,
  duration: 12500, // 12.5 seconds
  timestamp: new Date(),
  errors: [],
  warnings: ['Subscription data missing for IPO X'],
};
```

### 8.4 Cache Invalidation Contract

After scraping, your MCP scraper **MUST** invalidate these Redis cache keys:

```typescript
import { getRedisClient } from '@ipodhan/shared';

async function invalidateCachesAfterScrape(
  updatedSlugs: string[],
  updatedIPOIds: string[]
): Promise<void> {
  const redis = getRedisClient();

  // 1. Invalidate IPO detail caches
  for (const slug of updatedSlugs) {
    await redis.del(
      `ipo:detail:${slug}`,
      `ipo:slug:${slug}`
    );
  }

  // 2. Invalidate subscription caches
  for (const ipoId of updatedIPOIds) {
    await redis.del(`subscription:latest:${ipoId}`);
    await deleteKeysByPattern(redis, `subscription:history:${ipoId}:*`);
  }

  // 3. Pattern-based invalidation (bulk cleanup)
  await deleteKeysByPattern(redis, 'ipo:list:*');
  await deleteKeysByPattern(redis, 'ipo:search:*');
  await deleteKeysByPattern(redis, 'mainboard:*');
  await deleteKeysByPattern(redis, 'sme:*');
}

// Safe pattern-based deletion using SCAN (not KEYS)
async function deleteKeysByPattern(
  redis: Redis,
  pattern: string
): Promise<number> {
  let cursor = '0';
  let deletedCount = 0;

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      'MATCH', pattern,
      'COUNT', 100
    );

    if (keys.length > 0) {
      await redis.del(...keys);
      deletedCount += keys.length;
    }

    cursor = nextCursor;
  } while (cursor !== '0');

  return deletedCount;
}
```

**Critical Cache Keys to Invalidate:**
- `ipo:detail:{slug}` - IPO detail page cache
- `ipo:slug:{slug}` - Slug-based lookup cache
- `ipo:list:*` - All filtered IPO list caches (wildcards)
- `ipo:search:*` - All search result caches
- `subscription:latest:{ipoId}` - Latest subscription snapshot
- `subscription:history:{ipoId}:*` - Subscription history
- `mainboard:*` - MAINBOARD category caches
- `sme:*` - SME category caches

---

## 9. Migration Checklist

### 9.1 Pre-Migration Setup

- [ ] **Install Shared Package**
  ```bash
  npm install @ipodhan/shared
  ```

- [ ] **Verify Database Access**
  ```bash
  # Test connection string
  DATABASE_URL=postgresql://localhost:5432/ipodhan
  psql $DATABASE_URL -c "SELECT 1"
  ```

- [ ] **Verify Redis Access (Optional)**
  ```bash
  # Test Redis connection
  redis-cli -h localhost -p 6379 PING
  # Expected: PONG
  ```

- [ ] **Review Database Schema**
  ```bash
  # Read schema file
  cat packages/shared/src/db/schema.ts
  ```

- [ ] **Review Existing Validators**
  ```bash
  # Check validation rules
  cat scraper/src/utils/validators.ts
  ```

### 9.2 Development Checklist

- [ ] **Implement MCP Scraper**
  - [ ] Choose implementation strategy (Option A, B, or C)
  - [ ] Create scraper file (`nse-mcp-orchestrator.ts`)
  - [ ] Implement `scrapeData()` method using MCP
  - [ ] Return data in `ScrapedIPO` format

- [ ] **Slug Generation**
  - [ ] Import `generateIPOSlug()` from `@ipodhan/shared`
  - [ ] Use for all company names
  - [ ] NEVER create custom slug logic

- [ ] **Data Validation**
  - [ ] Import Zod schemas from `validators.ts`
  - [ ] Validate all scraped data
  - [ ] Handle validation errors gracefully
  - [ ] Check lot_size >= 10 (critical)

- [ ] **Protection Checks**
  - [ ] Import `isIPOLocked()` from shared
  - [ ] Import `filterProtectedFields()` from shared
  - [ ] Skip locked IPOs
  - [ ] Filter protected fields before upsert

- [ ] **Database Operations**
  - [ ] Use `IPORepository.upsert()` for IPOs
  - [ ] Use `SubscriptionRepository.create()` for subscriptions
  - [ ] Use `ScraperLogRepository.create()` for logging
  - [ ] Handle database errors with retry logic

- [ ] **Cache Invalidation**
  - [ ] Import `invalidateIPOCaches()` from `cache-invalidator.ts`
  - [ ] Call after each IPO update
  - [ ] Use pattern-based invalidation for bulk cleanup
  - [ ] Handle Redis errors gracefully (non-fatal)

- [ ] **Error Handling**
  - [ ] Implement try-catch blocks
  - [ ] Retry logic (3 attempts, exponential backoff)
  - [ ] Log errors to `scraper_logs` table
  - [ ] Return `ScraperResult` with error details

- [ ] **Result Reporting**
  - [ ] Return `ScraperResult` interface
  - [ ] Include all metrics (processed, inserted, updated, failed)
  - [ ] Include performance metrics (duration)
  - [ ] Include error messages

### 9.3 Testing Checklist

- [ ] **Unit Tests**
  ```bash
  # Test validation logic
  npm run test:unit -- mcp-scraper.test.ts
  ```

- [ ] **Integration Tests**
  ```bash
  # Test with real database
  DATABASE_URL=postgresql://localhost:5432/ipodhan_test \
    npm run test:integration -- mcp-scraper-integration.test.ts
  ```

- [ ] **Dry Run Test**
  ```bash
  # Test scraper without database writes
  npx tsx scraper/src/scrapers/mcp-orchestrator.ts --dry-run
  ```

- [ ] **Cache Invalidation Test**
  ```bash
  # Monitor Redis invalidation in real-time
  redis-cli MONITOR | grep "DEL"
  ```

- [ ] **Database Verification**
  ```sql
  -- Check scraper logs
  SELECT * FROM scraper_logs
  WHERE source = 'mcp'
  ORDER BY created_at DESC
  LIMIT 5;

  -- Check inserted/updated IPOs
  SELECT company_name, slug, status, updated_at
  FROM ipos
  WHERE updated_at > NOW() - INTERVAL '1 hour'
  ORDER BY updated_at DESC;
  ```

- [ ] **Protection Check Test**
  ```bash
  # Lock an IPO in admin panel
  # Run scraper
  # Verify IPO was skipped in logs
  ```

### 9.4 Deployment Checklist

- [ ] **Update Scheduler Configuration**
  ```typescript
  // File: scraper/src/scheduler/config.ts
  export const schedulerConfig = {
    jobs: {
      mcp: {
        enabled: true,
        interval: '*/15 9-17 * * 1-5',  // Every 15 min, market hours
      }
    }
  };
  ```

- [ ] **Update Environment Variables**
  ```bash
  # Add MCP-specific config
  MCP_SCRAPER_ENABLED=true
  MCP_SCRAPER_URL=https://your-mcp-endpoint.com
  ```

- [ ] **Update Admin Monitoring**
  ```typescript
  // Update scraper status endpoint to include MCP
  const metrics = {
    nse: await getScraperMetrics('nse'),
    bse: await getScraperMetrics('bse'),
    mcp: await getScraperMetrics('mcp'),  // Add this
  };
  ```

- [ ] **Update Documentation**
  - [ ] Update `scraper/README.md` with MCP details
  - [ ] Update CLI usage documentation
  - [ ] Update architecture diagrams

- [ ] **Gradual Rollout**
  - [ ] Deploy to development environment first
  - [ ] Monitor for 24-48 hours
  - [ ] Verify data quality and consistency
  - [ ] Deploy to production with fallback enabled

### 9.5 Monitoring Checklist

- [ ] **Track Scraper Health**
  ```bash
  # Check scraper logs
  tail -f logs/scraper.log | grep "mcp"
  ```

- [ ] **Monitor Database Activity**
  ```sql
  -- Monitor scraper performance
  SELECT
    source,
    COUNT(*) as run_count,
    AVG(duration) as avg_duration,
    SUM(ipos_inserted) as total_inserted,
    SUM(ipos_updated) as total_updated,
    SUM(ipos_failed) as total_failed
  FROM scraper_logs
  WHERE created_at > NOW() - INTERVAL '24 hours'
  GROUP BY source;
  ```

- [ ] **Monitor Cache Hit Rates**
  ```bash
  # Check Redis metrics
  redis-cli INFO stats | grep "keyspace"
  redis-cli INFO stats | grep "hits"
  ```

- [ ] **Set Up Alerts**
  - [ ] Alert on scraper failure (3+ consecutive)
  - [ ] Alert on high failure rate (>20%)
  - [ ] Alert on long execution time (>5 min)
  - [ ] Alert on database connection errors

---

## 10. Testing Strategy

### 10.1 Unit Tests

**Location:** `scraper/tests/unit/mcp-scraper.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { NSEMCPOrchestrator } from '../src/scrapers/nse-mcp-orchestrator';

describe('NSEMCPOrchestrator', () => {
  it('should validate scraped IPO data correctly', async () => {
    const mockIPO = {
      companyName: 'Test Company Ltd',
      issueSize: 500,
      priceRangeMin: 100,
      priceRangeMax: 120,
      lotSize: 75,
      openDate: '2025-10-27',
      closeDate: '2025-10-30',
      segment: 'MAINBOARD',
      status: 'UPCOMING',
    };

    const orchestrator = new NSEMCPOrchestrator(mockDb, mockRedis);
    const result = orchestrator.validateIPO(mockIPO);

    expect(result.success).toBe(true);
  });

  it('should reject IPO with lot size < 10', async () => {
    const mockIPO = {
      // ... other fields
      lotSize: 5, // Invalid
    };

    const orchestrator = new NSEMCPOrchestrator(mockDb, mockRedis);
    const result = orchestrator.validateIPO(mockIPO);

    expect(result.success).toBe(false);
    expect(result.error).toContain('lot size');
  });

  it('should generate correct slug from company name', () => {
    const slug = generateIPOSlug('XYZ Corporation Ltd');
    expect(slug).toBe('xyz-corporation-ltd');
  });

  it('should respect IPO-level locks', async () => {
    const mockIPO = { id: 'locked-ipo-id', /* ... */ };
    vi.mocked(isIPOLocked).mockResolvedValue(true);

    const orchestrator = new NSEMCPOrchestrator(mockDb, mockRedis);
    const result = await orchestrator.run();

    expect(result.iposSkipped).toBe(1);
    expect(result.iposUpdated).toBe(0);
  });
});
```

### 10.2 Integration Tests

**Location:** `scraper/tests/integration/mcp-scraper-integration.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, getRedisClient, IPORepository } from '@ipodhan/shared';
import { NSEMCPOrchestrator } from '../src/scrapers/nse-mcp-orchestrator';

describe('MCP Scraper Integration', () => {
  let redis: Redis;
  let ipoRepository: IPORepository;

  beforeAll(async () => {
    // Setup test database
    await db.delete(ipos).where(sql`slug LIKE 'test-%'`);
    redis = getRedisClient();
    ipoRepository = new IPORepository(db, redis);
  });

  afterAll(async () => {
    // Cleanup
    await db.delete(ipos).where(sql`slug LIKE 'test-%'`);
  });

  it('should insert new IPO into database', async () => {
    const orchestrator = new NSEMCPOrchestrator(db, redis);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.iposInserted).toBeGreaterThan(0);

    // Verify in database
    const insertedIPO = await ipoRepository.findBySlug('test-company-ipo');
    expect(insertedIPO).toBeTruthy();
    expect(insertedIPO.companyName).toBe('Test Company Ltd');
  });

  it('should update existing IPO in database', async () => {
    // Create initial IPO
    const initialIPO = await ipoRepository.create({
      companyName: 'Test Company Ltd',
      slug: 'test-company-ipo',
      issueSize: 500,
      status: 'UPCOMING',
      // ... other fields
    });

    // Run scraper (should update)
    const orchestrator = new NSEMCPOrchestrator(db, redis);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.iposUpdated).toBeGreaterThan(0);

    // Verify update
    const updatedIPO = await ipoRepository.findBySlug('test-company-ipo');
    expect(updatedIPO.id).toBe(initialIPO.id);
    expect(updatedIPO.status).toBe('OPEN'); // Updated status
  });

  it('should invalidate cache after scraping', async () => {
    // Set initial cache
    await redis.set('ipo:slug:test-company-ipo', JSON.stringify({ id: 'old-data' }));

    // Run scraper
    const orchestrator = new NSEMCPOrchestrator(db, redis);
    await orchestrator.run();

    // Verify cache invalidation
    const cachedData = await redis.get('ipo:slug:test-company-ipo');
    expect(cachedData).toBeNull(); // Cache should be cleared
  });

  it('should create subscription snapshots', async () => {
    const orchestrator = new NSEMCPOrchestrator(db, redis);
    const result = await orchestrator.run();

    expect(result.subscriptionsCreated).toBeGreaterThan(0);

    // Verify in database
    const subscriptions = await db.select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.ipoId, testIPOId))
      .orderBy(desc(subscriptionsTable.timestamp))
      .limit(1);

    expect(subscriptions.length).toBe(1);
    expect(subscriptions[0].totalSubscription).toBeGreaterThan(0);
  });
});
```

### 10.3 End-to-End Tests

**Location:** `scraper/tests/e2e/mcp-scraper-e2e.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('MCP Scraper E2E', () => {
  it('should complete full scraper run via CLI', async () => {
    const { stdout, stderr } = await execAsync(
      'npx tsx scraper/src/index.ts --source=mcp --dry-run'
    );

    expect(stdout).toContain('Scraper completed successfully');
    expect(stdout).toContain('IPOs processed:');
    expect(stderr).toBe('');
  }, { timeout: 60000 }); // 60 second timeout

  it('should respect scheduler configuration', async () => {
    // Start scheduler
    const schedulerProcess = exec('npm run scheduler:test');

    // Wait for job execution
    await new Promise(resolve => setTimeout(resolve, 65000)); // 65 seconds

    // Check logs
    const { stdout } = await execAsync('tail -n 50 logs/scraper.log');
    expect(stdout).toContain('[MCP Scraper] Job started');
    expect(stdout).toContain('[MCP Scraper] Job completed');

    // Kill scheduler
    schedulerProcess.kill();
  }, { timeout: 120000 }); // 2 minute timeout
});
```

### 10.4 Performance Tests

```typescript
import { describe, it, expect } from 'vitest';

describe('MCP Scraper Performance', () => {
  it('should complete scraping within 30 seconds', async () => {
    const startTime = Date.now();

    const orchestrator = new NSEMCPOrchestrator(db, redis);
    const result = await orchestrator.run();

    const duration = Date.now() - startTime;

    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(30000); // 30 seconds
  });

  it('should handle 100 IPOs within performance targets', async () => {
    const orchestrator = new NSEMCPOrchestrator(db, redis);
    const result = await orchestrator.run();

    expect(result.iposProcessed).toBeGreaterThan(100);
    expect(result.duration).toBeLessThan(60000); // 60 seconds

    // Calculate average time per IPO
    const avgTimePerIPO = result.duration / result.iposProcessed;
    expect(avgTimePerIPO).toBeLessThan(500); // < 500ms per IPO
  });
});
```

---

## 11. Recommendations

### 11.1 Primary Recommendation: **Option B (Hybrid Approach)**

**Rationale:**
- ✅ **Best Risk-to-Benefit Ratio:** Reuses existing infrastructure while enabling MCP
- ✅ **Automatic Protection:** IPO locks and field protection enforced automatically
- ✅ **Minimal Code Changes:** Only need to implement `scrapeData()` method
- ✅ **Production-Ready:** Scheduler, monitoring, and admin panel work unchanged
- ✅ **Fastest Implementation:** 2-3 days vs 4-5 days for complete replacement

**Implementation Steps:**
1. Create `nse-mcp-orchestrator.ts` extending `BaseScraperOrchestrator`
2. Implement `scrapeData()` to call MCP tool
3. Keep existing validation, persistence, and cache logic
4. Update scheduler configuration to use new orchestrator
5. Test with `--dry-run` flag before production deployment

### 11.2 Refactoring Recommendations (Before MCP Migration)

#### 1. Move Protection Logic to Shared Package

**Current Issue:**
```typescript
// scraper imports from web (tight coupling)
import { isIPOLocked } from '@web/lib/admin/field-protection-checker';
```

**Recommended Fix:**
```typescript
// Create: packages/shared/src/admin/field-protection-checker.ts
export { isIPOLocked, isFieldProtected, filterProtectedFields };

// Update scraper imports:
import { isIPOLocked } from '@ipodhan/shared/admin/field-protection-checker';
```

**Benefits:**
- Eliminates scraper ↔ web coupling
- Makes protection logic available to MCP scraper
- Reduces circular dependency risks

#### 2. Consolidate Database Initialization

**Current Issue:** Inconsistent DB access patterns
```typescript
// Pattern 1: Direct from shared
import { db } from '@ipodhan/shared';

// Pattern 2: Via web function
import { getDb } from '@web/lib/db/index';
```

**Recommended Fix:**
- Standardize on `db` from `@ipodhan/shared`
- Remove all `getDb()` imports from scraper
- Update scheduler jobs to use shared `db`

#### 3. Unify Type Definitions

**Current Issue:** `ScraperSource` duplicated in scraper and web

**Recommended Fix:**
```typescript
// Create: packages/shared/src/types/scraper-types.ts
export type ScraperSource =
  | 'nse'
  | 'bse'
  | 'moneycontrol'
  | 'chittorgarh'
  | 'gmp'
  | 'mcp'       // Add MCP here
  | 'fallback';

// Remove duplicates from:
// - scraper/src/services/types.ts
// - web/lib/db/types.ts
```

### 11.3 Post-Migration Monitoring

After MCP scraper is deployed, monitor these metrics:

#### Success Metrics
- **Scraper Success Rate:** Target > 95%
- **Average Execution Time:** Target < 30 seconds
- **IPO Data Accuracy:** Compare with NSE/BSE scrapers
- **Cache Hit Rate:** Target > 80% after warmup

#### Alert Thresholds
- 🔴 **CRITICAL:** 3+ consecutive scraper failures
- 🟡 **WARNING:** Execution time > 60 seconds
- 🟡 **WARNING:** Validation failure rate > 10%
- 🔴 **CRITICAL:** Database connection errors

#### Comparison Baseline
Run MCP scraper **in parallel** with existing scrapers for 48-72 hours to:
- Compare data consistency (NSE vs MCP)
- Identify edge cases or missing validations
- Verify cache invalidation works correctly
- Ensure no performance degradation

### 11.4 Rollback Plan

If MCP scraper encounters critical issues:

**Phase 1: Immediate Rollback (< 5 minutes)**
```bash
# Disable MCP scraper in scheduler
export SCRAPER_ENABLED_MCP=false
pm2 restart scraper-scheduler

# Revert to previous scrapers
git revert HEAD
npm run build
pm2 restart all
```

**Phase 2: Data Verification (< 30 minutes)**
```sql
-- Check for data inconsistencies
SELECT company_name, slug, status, updated_at, source
FROM ipos
WHERE updated_at > NOW() - INTERVAL '2 hours'
  AND source = 'mcp'
ORDER BY updated_at DESC;

-- Rollback MCP-created records if needed
UPDATE ipos SET source = 'nse' WHERE source = 'mcp';
```

**Phase 3: Root Cause Analysis**
- Review scraper logs for error patterns
- Check MCP tool API response times
- Verify validation rules match NSE/BSE data
- Test with smaller dataset before re-deploying

---

## 12. Conclusion

### 12.1 Summary

The IPODhan scraping system is **highly modular (8.5/10)** with excellent separation of concerns. The Template Method pattern ensures consistent protection checks, cache invalidation, and error handling across all scrapers.

**Replacing with MCP-based scraping is feasible** with MEDIUM impact, primarily requiring an interface compatibility layer. The recommended **Hybrid Approach (Option B)** minimizes risk by reusing existing infrastructure while enabling MCP integration.

### 12.2 Key Takeaways

✅ **Scraper Modularity:** Each scraper (NSE, BSE, Moneycontrol) is independent and replaceable

✅ **Standard Interfaces:** `BaseScraperOrchestrator` provides consistent workflow

✅ **Loose Coupling:** Data persistence, cache invalidation, and validation are isolated services

⚠️ **Minor Refactoring Needed:** Move protection logic from web to shared package

✅ **MCP Migration Path:** Hybrid approach offers fastest, lowest-risk implementation

### 12.3 Next Steps

1. **Choose Implementation Strategy:** Recommend Option B (Hybrid)
2. **Refactor Protection Logic:** Move to shared package (1 day)
3. **Implement MCP Scraper:** Extend `BaseScraperOrchestrator` (2 days)
4. **Testing:** Unit + integration tests (1 day)
5. **Parallel Deployment:** Run alongside existing scrapers (2-3 days)
6. **Full Migration:** Switch scheduler to MCP scraper (1 day)

**Total Estimated Timeline:** 7-9 days (including testing and validation)

### 12.4 Questions to Answer Before Implementation

1. **Which MCP tool are you using?** (Playwright MCP, custom tool, etc.)
2. **Replace all scrapers?** (NSE, BSE, Moneycontrol) or just one?
3. **Scheduler integration required?** Or manual execution only?
4. **Keep existing scrapers as fallback?** Recommended for safety
5. **Performance targets?** Current: < 30 seconds per run

---

**Document Status:** Ready for Implementation
**Review Date:** 2025-10-27
**Next Review:** After MCP Migration Complete

