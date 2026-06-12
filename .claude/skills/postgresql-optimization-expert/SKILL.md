---
name: postgresql-optimization-expert
description: PostgreSQL query optimization, index management, connection pooling, EXPLAIN ANALYZE, and Drizzle ORM performance tuning
---

# PostgreSQL Optimization Expert

**Purpose:** This skill provides expertise in PostgreSQL query optimization, index management, connection pooling, and performance tuning specific to IPODhan's database architecture. It covers EXPLAIN ANALYZE, Drizzle ORM optimizations, and production performance patterns.

**When to invoke:** Use this skill when optimizing slow queries, designing indexes, debugging connection pool issues, analyzing query performance, or scaling database capacity.

---

## Current Database Architecture

### Database Configuration

**PostgreSQL Version:** 16.x
**Host:** 103.118.16.189 (VPS)
**Database:** ipodhan
**Connection Pool:** 50 connections (max)
**Tables:** 13 tables with 46 strategic indexes

### Performance Targets

```
Simple queries (by ID):      < 20ms    ✅ Target
Indexed queries (by slug):   < 50ms    ✅ Target
List queries (filtered):     < 100ms   ⚠️ Maximum acceptable
Complex joins (with relations): < 150ms   🟡 Needs monitoring
```

### Connection Pool Settings

```typescript
// web/lib/db/connection.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,              // Maximum connections
  min: 10,              // Minimum idle connections
  idleTimeoutMillis: 30000,     // 30 seconds
  connectionTimeoutMillis: 5000, // 5 seconds
});

export const db = drizzle(pool);
```

**Capacity:**
- 50 connections supports ~2500 concurrent users (theoretical)
- Actual: ~1200-1500 users before degradation
- Each connection can handle ~25-50 requests/second

---

## Index Strategy

IPODhan has **46 strategic indexes** across 13 tables.

### Index Types

#### 1. Primary Key Indexes (Automatic)
```sql
-- Automatically created for all tables
CREATE UNIQUE INDEX ipos_pkey ON ipos(id);
CREATE UNIQUE INDEX subscriptions_pkey ON subscriptions(id);
-- ... etc for all 13 tables
```

#### 2. Foreign Key Indexes (Explicit)
```typescript
// Always index foreign keys for JOIN performance
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey(),
  ipoId: uuid('ipo_id').references(() => ipos.id, {
    onDelete: 'cascade',
  }).notNull(),
}, (table) => ({
  // INDEX foreign key
  ipoIdIdx: index('subscription_ipo_id_idx').on(table.ipoId),
}));
```

**Why:** PostgreSQL doesn't auto-index foreign keys; JOINs are slow without them.

#### 3. Unique Lookup Indexes
```typescript
export const ipos = pgTable('ipos', {
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  isinNumber: varchar('isin_number', { length: 12 }).unique(),
}, (table) => ({
  slugIdx: index('ipo_slug_idx').on(table.slug),
  isinIdx: index('ipo_isin_idx').on(table.isinNumber),
}));
```

**Why:** Slug and ISIN are frequently used for lookups (WHERE clauses).

#### 4. Filter Indexes
```typescript
export const ipos = pgTable('ipos', {
  status: ipoStatusEnum('status').default('UPCOMING').notNull(),
  segment: ipoSegmentEnum('segment'),
}, (table) => ({
  statusIdx: index('ipo_status_idx').on(table.status),
  segmentIdx: index('ipo_segment_idx').on(table.segment),
}));
```

**Why:** Status and segment are filtered in almost every query.

#### 5. Compound Indexes
```typescript
export const ipos = pgTable('ipos', {
  segment: ipoSegmentEnum('segment'),
  status: ipoStatusEnum('status'),
}, (table) => ({
  // Compound index for common filter combination
  segmentStatusIdx: index('ipo_segment_status_idx')
    .on(table.segment, table.status),
}));
```

**Why:** Queries often filter by both segment AND status simultaneously.

**Query Covered:**
```sql
SELECT * FROM ipos
WHERE segment = 'MAINBOARD'
  AND status = 'OPEN'
ORDER BY open_date DESC;
```

#### 6. Partial Indexes (PostgreSQL-Specific)
```typescript
import { sql } from 'drizzle-orm';

export const ipos = pgTable('ipos', {
  status: ipoStatusEnum('status'),
}, (table) => ({
  // Index only OPEN IPOs (most queried status)
  openIposIdx: index('ipo_open_status_idx')
    .on(table.status)
    .where(sql`status = 'OPEN'`),
}));
```

**Why:** Reduces index size; faster for most common query (open IPOs).

#### 7. Date Range Indexes
```typescript
export const ipos = pgTable('ipos', {
  openDate: date('open_date'),
  closeDate: date('close_date'),
  listingDate: date('listing_date'),
}, (table) => ({
  openDateIdx: index('ipo_open_date_idx').on(table.openDate),
  closeDateIdx: index('ipo_close_date_idx').on(table.closeDate),
  listingDateIdx: index('ipo_listing_date_idx').on(table.listingDate),
}));
```

**Why:** Date range queries are common (e.g., "IPOs opening this week").

---

## Query Optimization with EXPLAIN ANALYZE

### Understanding EXPLAIN ANALYZE Output

```sql
EXPLAIN ANALYZE
SELECT * FROM ipos
WHERE segment = 'MAINBOARD'
  AND status = 'OPEN'
ORDER BY open_date DESC
LIMIT 20;
```

**Good Output (Using Index):**
```
Index Scan using ipo_segment_status_idx on ipos
  (cost=0.28..123.45 rows=20 width=500)
  (actual time=0.045..2.134 rows=20 loops=1)
  Filter: (segment = 'MAINBOARD' AND status = 'OPEN')
Planning Time: 0.234 ms
Execution Time: 2.456 ms
```

**Bad Output (Sequential Scan):**
```
Seq Scan on ipos
  (cost=0.00..45678.90 rows=20 width=500)
  (actual time=125.456..789.123 rows=20 loops=1)
  Filter: (segment = 'MAINBOARD' AND status = 'OPEN')
  Rows Removed by Filter: 12458
Planning Time: 0.123 ms
Execution Time: 789.456 ms
```

### Key Metrics to Watch

1. **Scan Type:**
   - `Index Scan` - ✅ Good (using index)
   - `Index Only Scan` - ✅ Best (all data from index)
   - `Bitmap Index Scan` - ✅ Good (multiple indexes combined)
   - `Seq Scan` - ❌ Bad (reading entire table)

2. **Cost:**
   - First number: Startup cost
   - Second number: Total cost
   - **Lower is better**

3. **Actual Time:**
   - `actual time=0.045..2.134` means 0.045ms to start, 2.134ms total
   - **This is the real metric** (cost is estimate)

4. **Rows:**
   - `rows=20` (estimated) vs `actual ... rows=20`
   - Large discrepancy? Run `ANALYZE` to update statistics

5. **Rows Removed by Filter:**
   - High number = inefficient filter
   - Means index wasn't selective enough

### Running EXPLAIN in Drizzle ORM

```typescript
// Enable query logging in development
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Add query logging
pool.on('query', (query) => {
  console.log('Query:', query.text);
  console.log('Params:', query.values);
});

export const db = drizzle(pool, {
  logger: process.env.NODE_ENV === 'development',
});
```

**Analyze Specific Query:**
```typescript
// Get raw SQL from Drizzle query
const query = db
  .select()
  .from(ipos)
  .where(and(
    eq(ipos.segment, 'MAINBOARD'),
    eq(ipos.status, 'OPEN')
  ))
  .limit(20);

// Get SQL string
const sql = query.toSQL();
console.log(sql.sql); // Copy this to psql

// In psql:
// EXPLAIN ANALYZE <paste SQL here>;
```

---

## Connection Pool Optimization

### Current Configuration

```typescript
const pool = new Pool({
  max: 50,                // Maximum connections
  min: 10,                // Always keep 10 warm
  idleTimeoutMillis: 30000,     // Close idle after 30s
  connectionTimeoutMillis: 5000, // Wait 5s for connection
});
```

### Monitoring Connection Pool

```typescript
// Add pool monitoring
pool.on('connect', () => {
  console.log('New connection established');
});

pool.on('acquire', () => {
  console.log('Connection acquired from pool');
});

pool.on('remove', () => {
  console.log('Connection removed from pool');
});

pool.on('error', (err) => {
  console.error('Pool error:', err);
});

// Check pool stats
setInterval(() => {
  console.log({
    totalCount: pool.totalCount,     // Total connections
    idleCount: pool.idleCount,       // Idle connections
    waitingCount: pool.waitingCount, // Waiting clients
  });
}, 60000); // Every minute
```

### Connection Pool Sizing

**Formula:**
```
connections_needed = (max_concurrent_requests * avg_query_time) / 1000

Example:
- 1000 concurrent requests
- 50ms average query time
- connections_needed = (1000 * 50) / 1000 = 50 connections
```

**IPODhan Benchmarks:**
- 100 users: ~5-10 connections
- 500 users: ~20-30 connections
- 1000 users: ~40-50 connections
- **Breaking point:** 1200-1500 users (pool exhausted)

### Handling Pool Exhaustion

```typescript
async function executeWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      if (error.message.includes('timeout') && i < maxRetries - 1) {
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

// Usage
const ipos = await executeWithRetry(() =>
  ipoRepository.findAll({ status: ['OPEN'] })
);
```

---

## N+1 Query Prevention

### The Problem

```typescript
// ❌ BAD: N+1 queries
const ipos = await db.select().from(ipos).limit(20);

for (const ipo of ipos) {
  // N queries (one per IPO)
  const subscriptions = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.ipoId, ipo.id));

  const financials = await db
    .select()
    .from(financialData)
    .where(eq(financialData.ipoId, ipo.id));

  // Total: 1 + 20 + 20 = 41 queries!
}
```

### Solution 1: Drizzle Relations (Recommended)

```typescript
// Define relations in schema
export const iposRelations = relations(ipos, ({ many, one }) => ({
  subscriptions: many(subscriptions),
  financialData: one(financialData),
}));

// Use in query (single query with JOINs)
const iposWithRelations = await db.query.ipos.findMany({
  limit: 20,
  with: {
    subscriptions: true,
    financialData: true,
  },
});

// Total: 1 query!
```

### Solution 2: Manual JOINs

```typescript
const iposWithData = await db
  .select({
    ipo: ipos,
    subscription: subscriptions,
    financial: financialData,
  })
  .from(ipos)
  .leftJoin(subscriptions, eq(subscriptions.ipoId, ipos.id))
  .leftJoin(financialData, eq(financialData.ipoId, ipos.id))
  .limit(20);

// Group results manually
const grouped = iposWithData.reduce((acc, row) => {
  const ipoId = row.ipo.id;
  if (!acc[ipoId]) {
    acc[ipoId] = {
      ...row.ipo,
      subscriptions: [],
      financial: row.financial,
    };
  }
  if (row.subscription) {
    acc[ipoId].subscriptions.push(row.subscription);
  }
  return acc;
}, {});
```

### Solution 3: Batch Loading

```typescript
async function loadIPOsWithRelations(ipoIds: string[]) {
  // 3 queries total (not N+1)
  const [ipos, subscriptions, financials] = await Promise.all([
    db.select().from(ipos).where(inArray(ipos.id, ipoIds)),
    db.select().from(subscriptions).where(inArray(subscriptions.ipoId, ipoIds)),
    db.select().from(financialData).where(inArray(financialData.ipoId, ipoIds)),
  ]);

  // Group by IPO ID
  // ...
}
```

---

## Query Performance Patterns

### Pattern 1: Pagination with OFFSET

```typescript
// ❌ BAD: OFFSET gets slower as you go deeper
const page = 100;
const limit = 20;
const ipos = await db
  .select()
  .from(ipos)
  .limit(limit)
  .offset(page * limit); // Skips 2000 rows!
```

**Why Bad:** PostgreSQL must read and discard 2000 rows.

**Solution: Cursor-Based Pagination**

```typescript
// ✅ GOOD: Use cursor (last seen ID)
const lastSeenId = 'uuid-from-previous-page';

const ipos = await db
  .select()
  .from(ipos)
  .where(gt(ipos.id, lastSeenId)) // Continue from last ID
  .orderBy(ipos.id)
  .limit(20);
```

**Performance:**
- OFFSET pagination: 2s at page 100
- Cursor pagination: 20ms at any page

### Pattern 2: COUNT(*) Optimization

```typescript
// ❌ SLOW: Full table count
const total = await db
  .select({ count: sql<number>`count(*)` })
  .from(ipos);

// ✅ FAST: Approximate count (good enough for pagination)
const total = await db.execute(sql`
  SELECT reltuples::bigint AS estimate
  FROM pg_class
  WHERE relname = 'ipos'
`);
```

**When to Use:**
- Exact count: Use COUNT(*) only when necessary
- Approximate: Use pg_class estimate for pagination metadata

### Pattern 3: Selective Column Fetching

```typescript
// ❌ BAD: Fetching all columns (heavy)
const ipos = await db.select().from(ipos);

// ✅ GOOD: Only needed columns
const ipos = await db
  .select({
    id: ipos.id,
    companyName: ipos.companyName,
    slug: ipos.slug,
    status: ipos.status,
  })
  .from(ipos);
```

**Performance Gain:** 40-60% faster for large tables

### Pattern 4: IN vs EXISTS

```typescript
// For large lists, EXISTS is faster than IN

// ❌ SLOWER: IN with large array
const ipoIds = [...1000 IDs...];
const ipos = await db
  .select()
  .from(ipos)
  .where(inArray(ipos.id, ipoIds));

// ✅ FASTER: EXISTS with subquery
const ipos = await db
  .select()
  .from(ipos)
  .where(exists(
    db.select().from(activeIPOs).where(eq(activeIPOs.ipoId, ipos.id))
  ));
```

---

## Drizzle ORM-Specific Optimizations

### 1. Prepared Statements

```typescript
// Reuse prepared statements for repeated queries
const getIPOBySlug = db
  .select()
  .from(ipos)
  .where(eq(ipos.slug, sql.placeholder('slug')))
  .prepare('get_ipo_by_slug');

// Execute multiple times (no re-parsing)
const ipo1 = await getIPOBySlug.execute({ slug: 'abc-corp-ipo' });
const ipo2 = await getIPOBySlug.execute({ slug: 'xyz-corp-ipo' });
```

**Performance:** 10-20% faster for repeated queries

### 2. Transaction Batching

```typescript
// ❌ SLOW: Multiple round trips
await db.insert(ipos).values(ipo1);
await db.insert(ipos).values(ipo2);
await db.insert(ipos).values(ipo3);
// 3 round trips

// ✅ FAST: Single batch insert
await db.insert(ipos).values([ipo1, ipo2, ipo3]);
// 1 round trip
```

### 3. Efficient Updates

```typescript
// ❌ SLOW: Update each row individually
for (const ipo of ipos) {
  await db.update(ipos).set({ status: 'CLOSED' }).where(eq(ipos.id, ipo.id));
}

// ✅ FAST: Bulk update
await db
  .update(ipos)
  .set({ status: 'CLOSED' })
  .where(inArray(ipos.id, ipos.map(i => i.id)));
```

---

## Slow Query Debugging

### Step 1: Enable Slow Query Log

```sql
-- In PostgreSQL config (postgresql.conf)
log_min_duration_statement = 100  -- Log queries >100ms

-- Or set per session
SET log_min_duration_statement = 100;
```

### Step 2: Identify Slow Queries

```sql
-- View slow queries (requires pg_stat_statements extension)
SELECT
  query,
  calls,
  mean_exec_time,
  max_exec_time,
  rows
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### Step 3: Analyze Query Plan

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT * FROM ipos WHERE segment = 'MAINBOARD';
```

**Look For:**
- Sequential scans (add index?)
- High buffer hits (cache working well)
- Large row estimates vs actual (run ANALYZE)

### Step 4: Fix Common Issues

**Issue:** Sequential scan on indexed column

**Solution:** Index not being used
```sql
-- Check if index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'ipos';

-- If index exists but not used, update statistics
ANALYZE ipos;
```

**Issue:** Wrong join order

**Solution:** Give PostgreSQL hints
```sql
-- Increase statistics target for better estimates
ALTER TABLE ipos ALTER COLUMN segment SET STATISTICS 1000;
ANALYZE ipos;
```

---

## Monitoring & Maintenance

### Database Statistics

```sql
-- Table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan AS index_scans,
  idx_tup_read AS tuples_read,
  idx_tup_fetch AS tuples_fetched
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;

-- Unused indexes (candidates for removal)
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexname NOT LIKE '%_pkey';
```

### Routine Maintenance

```sql
-- Update table statistics (run weekly)
ANALYZE;

-- Reclaim space and update statistics (run monthly)
VACUUM ANALYZE;

-- Reindex tables (run quarterly if needed)
REINDEX TABLE ipos;
```

---

## Production Performance Checklist

### Database Configuration
- [ ] Connection pool sized correctly (50 connections)
- [ ] Slow query log enabled (>100ms threshold)
- [ ] pg_stat_statements extension enabled
- [ ] Appropriate work_mem (256MB recommended)
- [ ] shared_buffers = 25% of RAM
- [ ] effective_cache_size = 50% of RAM

### Indexes
- [ ] All foreign keys indexed
- [ ] Filter columns indexed (status, segment)
- [ ] Unique lookup columns indexed (slug, isinNumber)
- [ ] Compound indexes for common filter combinations
- [ ] No unused indexes (check pg_stat_user_indexes)

### Query Patterns
- [ ] No N+1 queries (use JOINs or batch loading)
- [ ] Cursor-based pagination (not OFFSET for deep pages)
- [ ] Selective column fetching (not SELECT *)
- [ ] Prepared statements for repeated queries
- [ ] Batch inserts/updates where possible

### Monitoring
- [ ] Query performance logging enabled
- [ ] Connection pool metrics tracked
- [ ] Slow query alerts configured
- [ ] pg_stat_statements reviewed weekly
- [ ] VACUUM/ANALYZE scheduled

---

## Common Performance Issues

### Issue: High CPU Usage

**Symptoms:** CPU >80%, slow queries

**Diagnosis:**
```sql
-- Check active queries
SELECT pid, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY duration DESC;
```

**Solutions:**
- Add missing indexes
- Optimize expensive queries
- Increase connection pool if queries are queued

### Issue: High Memory Usage

**Symptoms:** PostgreSQL using >80% RAM

**Solutions:**
- Reduce work_mem if set too high
- Check for memory leaks in connections
- Add more RAM (currently 16GB VPS)
- Optimize queries to use less temp space

### Issue: Connection Pool Exhausted

**Symptoms:** "timeout acquiring connection" errors

**Diagnosis:**
```typescript
console.log({
  total: pool.totalCount,
  idle: pool.idleCount,
  waiting: pool.waitingCount, // Should be 0 under normal load
});
```

**Solutions:**
- Increase max connections (currently 50)
- Reduce query execution time
- Add connection retry logic
- Scale horizontally (read replicas)

---

## References

- **PostgreSQL Performance Docs:** https://www.postgresql.org/docs/16/performance-tips.html
- **Drizzle ORM Performance:** https://orm.drizzle.team/docs/performance
- **pg_stat_statements:** https://www.postgresql.org/docs/16/pgstatstatements.html
- **Connection Pooling:** https://node-postgres.com/features/pooling

---

**Note:** Database optimization is an ongoing process. IPODhan's 46 strategic indexes provide excellent baseline performance, but monitoring and tuning are essential as data volume grows and usage patterns evolve.
