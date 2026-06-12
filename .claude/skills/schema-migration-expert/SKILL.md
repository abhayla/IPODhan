---
name: schema-migration-expert
description: Database schema management with single source of truth, migration workflows, type safety, and Drizzle ORM patterns
---

# Schema & Migration Expert

**Purpose:** This skill provides expertise in database schema management, migration workflows, and the single source of truth pattern used in IPODhan. It covers schema editing, migration generation, type safety requirements, and incident history lessons.

**When to invoke:** Use this skill when making schema changes, creating migrations, fixing type errors, understanding table relationships, or resolving import errors related to the schema.

---

## Single Source of Truth Principle

### Critical Rule

**ALL database schema is defined in ONE location:**

```
packages/shared/src/db/schema.ts
```

**NEVER modify schema anywhere else.**

### Why This Matters

**History:** On 2025-10-18, schema drift occurred when schema was modified in multiple locations:
- `web/lib/db/schema.ts` had different column definitions
- `packages/shared/src/db/schema.ts` was out of sync
- Scraper failed because types didn't match actual database
- Required emergency fix and database reconciliation

**Lesson:** One schema file = one source of truth = no drift = no production failures.

### Re-Export Chain

The schema is re-exported through the web package for compatibility:

```
packages/shared/src/db/schema.ts  (SOURCE OF TRUTH)
           ↓
     web/lib/db/index.ts  (re-exports schema)
           ↓
   Application Code  (imports from @/lib/db)
```

**All application code imports from the shared schema via web/lib/db/index.ts.**

---

## Database Schema Overview

IPODhan has **13 tables** with specific relationships:

### Core Tables

1. **ipos** - Main IPO entity
   - Primary key: `id` (uuid)
   - Unique fields: `slug`, `isinNumber`
   - Nullable `segment`: 'MAINBOARD' | 'SME' | null
   - Status: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED'
   - 46 strategic indexes for performance

2. **subscriptions** - Time-series subscription data
   - Foreign key: `ipoId` → `ipos.id`
   - Category: 'QIB' | 'NII' | 'RETAIL' | 'EMPLOYEE' | 'OTHERS' | 'TOTAL'
   - Tracks times subscribed, shares bid, amount
   - Multiple records per IPO (one per update, per category)

3. **gmpRecords** - Grey Market Premium tracking
   - Foreign key: `ipoId` → `ipos.id`
   - Time-series: `recordDate`, `gmpValue`, `premium`
   - Used for trend analysis and IPO scoring

4. **financialData** - Financial metrics (one-to-one with ipos)
   - Foreign key: `ipoId` → `ipos.id` (unique constraint)
   - Revenue, profit, ROE, P/E ratio, market cap
   - Used for IPO valuation and scoring

5. **documents** - IPO documents (one-to-many)
   - Foreign key: `ipoId` → `ipos.id`
   - Type: 'DRHP' | 'RHP' | 'PROSPECTUS' | 'BASIS_OF_ALLOTMENT'
   - PDF URLs, upload dates

6. **listingPerformance** - Listing day data (one-to-one)
   - Foreign key: `ipoId` → `ipos.id` (unique constraint)
   - Listing price, open/close/high/low
   - Listing gain/loss calculation

### Supporting Tables

7. **marketHolidays** - Trading calendar
   - Holiday dates for NSE/BSE
   - Used to calculate IPO timelines

8. **registrars** - Registrar information
   - Company name, website, contact details
   - Referenced by `ipos.registrar`

9. **peerCompanies** - Peer comparison data
   - Foreign key: `ipoId` → `ipos.id`
   - Competitor names, metrics for comparison

10. **brokerAffiliates** - Affiliate tracking
    - Broker names, affiliate links
    - Revenue tracking

11. **affiliateClicks** - Click tracking
    - Foreign key: `affiliateId` → `brokerAffiliates.id`
    - Timestamp, IP, user agent

12. **scraperLogs** - Scraper monitoring
    - Source, success/failure, error messages
    - Used for debugging scraper issues

13. **ipoReviews** - Analyst reviews
    - Foreign key: `ipoId` → `ipos.id`
    - Review text, recommendation, analyst name

---

## Schema Management Workflow

### Step 1: Edit Schema

**Location:** `packages/shared/src/db/schema.ts`

**Example - Adding a New Column:**

```typescript
export const ipos = pgTable('ipos', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),

  // ... existing columns ...

  // NEW COLUMN
  isAnchorBook: boolean('is_anchor_book').default(false),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // ... existing indexes ...
}));
```

**Example - Adding a New Table:**

```typescript
export const ipoTimeline = pgTable('ipo_timeline', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').references(() => ipos.id, { onDelete: 'cascade' }).notNull(),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  eventDate: date('event_date').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  ipoIdIdx: index('ipo_timeline_ipo_id_idx').on(table.ipoId),
  eventDateIdx: index('ipo_timeline_event_date_idx').on(table.eventDate),
}));

// Add relation
export const ipoTimelineRelations = relations(ipoTimeline, ({ one }) => ({
  ipo: one(ipos, {
    fields: [ipoTimeline.ipoId],
    references: [ipos.id],
  }),
}));

// Update ipos relations
export const iposRelations = relations(ipos, ({ many, one }) => ({
  // ... existing relations ...
  timeline: many(ipoTimeline),
}));
```

**Example - Modifying a Column:**

```typescript
// Before
priceRangeLow: numeric('price_range_low', { precision: 10, scale: 2 }),

// After (increase precision)
priceRangeLow: numeric('price_range_low', { precision: 12, scale: 2 }),
```

### Step 2: Generate Migration

Navigate to `web/` directory and run:

```bash
cd web
npm run db:generate
```

**What This Does:**
- Compares schema with current database state
- Generates SQL migration file in `web/drizzle/migrations/`
- Creates timestamp-named folder (e.g., `0001_add_anchor_book_column`)
- Generates both `.sql` file and `meta.json`

**Output:**
```
Drizzle Kit migration generated successfully!

📦 Migration: 0001_add_anchor_book_column
📂 Location: web/drizzle/migrations/0001_add_anchor_book_column/

Files:
  - migration.sql
  - snapshot.json
```

### Step 3: Review Generated SQL

**Location:** `web/drizzle/migrations/0001_add_anchor_book_column/migration.sql`

**Example Migration SQL:**

```sql
-- Add new column
ALTER TABLE ipos ADD COLUMN is_anchor_book boolean DEFAULT false;

-- Add index if needed
CREATE INDEX IF NOT EXISTS ipo_anchor_book_idx ON ipos(is_anchor_book);

-- Update existing rows if needed
UPDATE ipos SET is_anchor_book = false WHERE is_anchor_book IS NULL;
```

**What to Check:**
1. Column types match schema definition
2. Default values are correct
3. Indexes are created for foreign keys and frequently queried columns
4. No data loss (dropping columns, changing types)
5. Constraints are correct (NOT NULL, UNIQUE, etc.)

**Warning Signs:**
- `DROP COLUMN` without backup
- `ALTER COLUMN TYPE` that might truncate data
- Missing `CASCADE` on foreign key deletes
- Large table updates without batching

### Step 4: Apply Migration

```bash
npm run db:migrate
```

**What This Does:**
- Connects to database using `DATABASE_URL` from `.env.local`
- Runs all pending migrations in order
- Updates migration tracking table
- Verifies schema matches database

**Output:**
```
✅ Migration 0001_add_anchor_book_column applied successfully
Database schema is up to date
```

**Troubleshooting Failed Migrations:**

If migration fails halfway through:

```bash
# Check database state
npm run db:studio

# Manually fix if needed (use psql)
psql -h 103.118.16.189 -U postgres -d ipodhan

# Rollback migration (manual)
-- Check migration history
SELECT * FROM __drizzle_migrations;

-- Drop problematic changes
ALTER TABLE ipos DROP COLUMN is_anchor_book;

-- Delete migration record
DELETE FROM __drizzle_migrations WHERE name = '0001_add_anchor_book_column';

# Re-run migration
npm run db:migrate
```

### Step 5: Verify in Drizzle Studio

```bash
npm run db:studio
```

Opens GUI at http://localhost:4983

**What to Check:**
1. New column appears in table
2. Data types are correct
3. Indexes are created
4. Foreign key relationships work
5. Existing data is intact

**Studio Features:**
- Browse tables and data
- Run queries visually
- Edit records (be careful!)
- View relationships
- Check indexes

---

## Import Patterns

### Correct Import Patterns

#### In Repositories (Direct Import from Shared)

```typescript
// ✅ CORRECT
import * as schema from '@ipodhan/shared/db/schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

export class IPORepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }
}
```

#### In Application Code (Import via Web Re-export)

```typescript
// ✅ CORRECT
import { ipos, ipoStatusEnum, subscriptions } from '@/lib/db';
// or
import { db } from '@/lib/db';

// ❌ WRONG - Don't import from schema directly in app code
import { ipos } from '@/lib/db/schema';

// ❌ WRONG - This file doesn't exist anymore
import { ipos } from '@ipodhan/shared/db/schema';
```

#### In Services

```typescript
// ✅ CORRECT
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

export async function getMainboardIPOs() {
  const redis = getRedisClient();
  const ipoRepository = new IPORepository(db, redis);

  return ipoRepository.findAll({ segment: ['MAINBOARD'] });
}
```

### Type Safety Requirements

#### Repository Constructor Types

**All repositories MUST use:**

```typescript
NodePgDatabase<typeof schema>
```

where `schema` is imported from `@ipodhan/shared/db/schema`.

**Example:**

```typescript
import * as schema from '@ipodhan/shared/db/schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

export class IPORepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>, // ← REQUIRED TYPE
    protected redis: Redis
  ) {
    super(db, redis);
  }
}
```

**Why This Type?**
- Ensures type inference works correctly
- All table types available in repository methods
- InferSelectModel and InferInsertModel work properly
- Prevents type errors at compile time

#### Type Inference from Schema

```typescript
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { ipos, subscriptions } from '@ipodhan/shared/db/schema';

// Infer types from schema
export type IPO = InferSelectModel<typeof ipos>;
export type NewIPO = InferInsertModel<typeof ipos>;

export type Subscription = InferSelectModel<typeof subscriptions>;
export type NewSubscription = InferInsertModel<typeof subscriptions>;

// Use in function signatures
async function createIPO(data: NewIPO): Promise<IPO> {
  // TypeScript knows all fields and types
}
```

---

## Common Schema Patterns

### Adding an Index

```typescript
export const ipos = pgTable('ipos', {
  // columns...
}, (table) => ({
  slugIdx: index('ipo_slug_idx').on(table.slug),
  statusIdx: index('ipo_status_idx').on(table.status),
  segmentIdx: index('ipo_segment_idx').on(table.segment),

  // Compound index
  segmentStatusIdx: index('ipo_segment_status_idx').on(table.segment, table.status),

  // Partial index (PostgreSQL specific)
  openIposIdx: index('ipo_open_status_idx')
    .on(table.status)
    .where(sql`status = 'OPEN'`),
}));
```

**Index Strategy:**
- Index foreign keys (automatic for relations)
- Index frequently filtered columns (status, segment)
- Index unique lookup columns (slug, isinNumber)
- Compound indexes for common filter combinations
- Avoid over-indexing (slows writes, uses storage)

### Adding a Foreign Key

```typescript
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Foreign key to ipos table
  ipoId: uuid('ipo_id')
    .references(() => ipos.id, {
      onDelete: 'cascade', // Delete subscriptions when IPO deleted
      onUpdate: 'cascade', // Update if IPO id changes (rare)
    })
    .notNull(),

  // other columns...
}, (table) => ({
  // Index foreign keys for JOIN performance
  ipoIdIdx: index('subscription_ipo_id_idx').on(table.ipoId),
}));
```

**Cascade Options:**
- `onDelete: 'cascade'` - Delete child records when parent deleted
- `onDelete: 'set null'` - Set FK to null when parent deleted
- `onDelete: 'restrict'` - Prevent parent deletion if children exist
- `onUpdate: 'cascade'` - Update FK when parent key changes

### Adding a Relation

```typescript
export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  // Many subscriptions belong to one IPO
  ipo: one(ipos, {
    fields: [subscriptions.ipoId],
    references: [ipos.id],
  }),
}));

export const iposRelations = relations(ipos, ({ many, one }) => ({
  // One IPO has many subscriptions
  subscriptions: many(subscriptions),

  // One IPO has one financial data
  financialData: one(financialData, {
    fields: [ipos.id],
    references: [financialData.ipoId],
  }),

  // One IPO has many documents
  documents: many(documents),
}));
```

**Relation Types:**
- `one()` - One-to-one or many-to-one
- `many()` - One-to-many

### Adding an Enum

```typescript
// Define enum values
export const ipoStatusEnum = pgEnum('ipo_status', [
  'UPCOMING',
  'OPEN',
  'CLOSED',
  'LISTED'
]);

// Use in table
export const ipos = pgTable('ipos', {
  id: uuid('id').primaryKey().defaultRandom(),
  status: ipoStatusEnum('status').default('UPCOMING').notNull(),
  // other columns...
});
```

**Migration for Enum Changes:**

Adding values is safe:
```sql
ALTER TYPE ipo_status ADD VALUE 'WITHDRAWN';
```

Removing values requires careful migration:
```sql
-- 1. Add new enum type
CREATE TYPE ipo_status_new AS ENUM ('UPCOMING', 'OPEN', 'CLOSED', 'LISTED');

-- 2. Migrate data
ALTER TABLE ipos ALTER COLUMN status TYPE ipo_status_new USING status::text::ipo_status_new;

-- 3. Drop old type
DROP TYPE ipo_status;

-- 4. Rename new type
ALTER TYPE ipo_status_new RENAME TO ipo_status;
```

### Adding a JSON Column

```typescript
export const ipos = pgTable('ipos', {
  id: uuid('id').primaryKey(),

  // JSON column for flexible data
  metadata: jsonb('metadata').default({}),

  // Other columns...
});

// Usage
type IPOMetadata = {
  customField1?: string;
  customField2?: number;
  tags?: string[];
};

const ipo = await db.insert(ipos).values({
  companyName: 'XYZ Corp',
  metadata: { tags: ['tech', 'growth'], customField1: 'value' } as IPOMetadata
});
```

---

## Troubleshooting

### Error: "Module not found: Can't resolve './schema'"

**Cause:** Trying to import from `@/lib/db/schema` which no longer exists.

**Solution:**
```typescript
// ❌ Old (broken)
import { ipos } from '@/lib/db/schema';

// ✅ New (correct)
import { ipos } from '@/lib/db';
```

### Error: "Type 'NodePgDatabase<typeof schema>' is not assignable"

**Cause:** Repository constructor uses wrong schema import.

**Solution:**
```typescript
// ❌ Wrong
import { db } from '@/lib/db';
constructor(protected db: typeof db) // Wrong type

// ✅ Correct
import * as schema from '@ipodhan/shared/db/schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

constructor(protected db: NodePgDatabase<typeof schema>)
```

### Error: "Zod version conflict"

**Cause:** Multiple Zod versions in dependency tree.

**Solution:**
Zod is pinned to `^4.1.11` in root `package.json`:

```json
{
  "overrides": {
    "zod": "^4.1.11"
  }
}
```

Don't upgrade Zod without testing all workspace packages.

### Migration Failed: "column already exists"

**Cause:** Migration was partially applied or run twice.

**Solution:**
```bash
# Check migration history
npm run db:studio
# View __drizzle_migrations table

# Or use psql
psql -h 103.118.16.189 -U postgres -d ipodhan
SELECT * FROM __drizzle_migrations ORDER BY created_at DESC;

# If column exists but migration record doesn't:
# Manually add migration record
INSERT INTO __drizzle_migrations (name, hash, created_at)
VALUES ('0001_add_column', 'hash_value', NOW());
```

### Schema Out of Sync with Database

**Symptoms:**
- Queries fail with "column does not exist"
- Type errors in repository methods
- Drizzle Studio shows wrong columns

**Solution:**
```bash
# 1. Backup database
pg_dump -h 103.118.16.189 -U postgres -d ipodhan > backup.sql

# 2. Check schema diff
npm run db:generate

# 3. Review generated migration carefully
# 4. Apply migration
npm run db:migrate

# 5. Verify in Drizzle Studio
npm run db:studio
```

### Build Fails After Schema Change

**Cause:** Old .next build cache referencing old types.

**Solution:**
```bash
cd web
rm -rf .next
npm run build
```

---

## Schema Change Checklist

Before making schema changes:

- [ ] Backup database (production)
- [ ] Test schema change locally first
- [ ] Review impact on existing queries
- [ ] Check if indexes need updating
- [ ] Plan data migration for existing rows
- [ ] Document breaking changes

Schema change process:

- [ ] Edit `packages/shared/src/db/schema.ts` (ONLY location)
- [ ] Run `npm run db:generate` from `web/`
- [ ] Review generated SQL in `web/drizzle/migrations/`
- [ ] Test migration on local database
- [ ] Run `npm run db:migrate`
- [ ] Verify in Drizzle Studio (`npm run db:studio`)
- [ ] Test application with new schema
- [ ] Update repository methods if needed
- [ ] Update type definitions if needed
- [ ] Run tests (`npm run test`)
- [ ] Commit schema, migration, and code changes together

Post-migration:

- [ ] Monitor application logs for errors
- [ ] Check query performance (new indexes may be needed)
- [ ] Update documentation if schema changed significantly
- [ ] Document migration in `docs/16-database/SCHEMA_MANAGEMENT.md`

---

## Incident History

### 2025-10-18: Schema Drift Incident

**What Happened:**
- Schema modified in both `web/lib/db/schema.ts` and `packages/shared/src/db/schema.ts`
- Web package had column `offeringType` with different type than shared
- Scraper imported from shared, web imported from local
- Type mismatch caused scraper to fail in production
- Database had different column definitions than either schema

**Root Cause:**
- No single source of truth enforced
- Two schema files existed, both being modified
- No validation that schema matched database

**Resolution:**
1. Deleted `web/lib/db/schema.ts` completely
2. Made `packages/shared/src/db/schema.ts` the only schema file
3. Updated all imports to use shared schema
4. Generated migration to reconcile database with schema
5. Added documentation to CLAUDE.md about single source of truth

**Lessons Learned:**
1. **One schema file, period.** No exceptions.
2. **Schema changes MUST go through migration workflow**
3. **Never manually ALTER database** without updating schema
4. **Test scrapers after schema changes**
5. **Document all schema changes in migration**

### 2025-11-01: 3-Layer Architecture Violations

**What Happened:**
- 9 files were importing and using HTTP API calls in services/Server Components
- Caused "Network request failed" errors in production builds
- Server Components tried to fetch from non-existent API in build process

**Root Cause:**
- Architectural pattern not enforced
- Copy-paste code brought bad patterns into codebase

**Resolution:**
1. Replaced all API calls with direct repository access
2. Added ESLint rules to prevent future violations
3. Documented pattern in CLAUDE.md

**Lessons Learned:**
1. **Services NEVER use HTTP**, always repositories
2. **ESLint can enforce architecture**
3. **Documentation alone isn't enough**

---

## Best Practices

### 1. Always Use Descriptive Column Names

```typescript
// ✅ Good
priceRangeLow: numeric('price_range_low', { precision: 10, scale: 2 }),
priceRangeHigh: numeric('price_range_high', { precision: 10, scale: 2 }),

// ❌ Bad
low: numeric('low'),
high: numeric('high'),
```

### 2. Add Indexes for Foreign Keys

```typescript
export const subscriptions = pgTable('subscriptions', {
  ipoId: uuid('ipo_id').references(() => ipos.id),
}, (table) => ({
  // ALWAYS index foreign keys
  ipoIdIdx: index('subscription_ipo_id_idx').on(table.ipoId),
}));
```

### 3. Use Cascade Appropriately

```typescript
// For dependent data (delete when parent deleted)
.references(() => ipos.id, { onDelete: 'cascade' })

// For optional relationships (keep when parent deleted)
.references(() => ipos.id, { onDelete: 'set null' })

// For critical relationships (prevent parent deletion)
.references(() => ipos.id, { onDelete: 'restrict' })
```

### 4. Default Values for Non-Nullable Columns

```typescript
// ✅ Good
status: ipoStatusEnum('status').default('UPCOMING').notNull(),
createdAt: timestamp('created_at').defaultNow().notNull(),

// ❌ Bad (will fail on insert if not provided)
status: ipoStatusEnum('status').notNull(),
```

### 5. Use Transactions for Related Changes

```typescript
await db.transaction(async (tx) => {
  // Create IPO
  const ipo = await tx.insert(ipos).values(ipoData).returning();

  // Create related financial data
  await tx.insert(financialData).values({
    ipoId: ipo[0].id,
    ...financialDetails
  });

  // Both succeed or both rollback
});
```

---

## References

- **Schema File:** `packages/shared/src/db/schema.ts`
- **Web Re-export:** `web/lib/db/index.ts`
- **Migrations:** `web/drizzle/migrations/`
- **Schema Docs:** `docs/16-database/SCHEMA_MANAGEMENT.md`
- **Drizzle ORM Docs:** https://orm.drizzle.team/docs/overview

---

**Critical Reminder:** The schema at `packages/shared/src/db/schema.ts` is the ONLY source of truth for database structure. All changes MUST go through the proper workflow: Schema → Generate → Review → Migrate → Verify.
