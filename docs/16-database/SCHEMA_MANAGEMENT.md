# Database Schema Management Guide

**Date Created**: October 18, 2025
**Purpose**: Establish single source of truth for database schema to prevent sync issues

---

## 🎯 Single Source of Truth Principle

**The Drizzle Schema (`packages/shared/src/db/schema.ts`) is the ONLY source of truth for database structure.**

All database changes MUST flow through this file and proper migrations.

---

## 🧩 Migration snapshot baseline (W-19, 2026-09-03)

**What was broken.** `web/drizzle/migrations/meta/` held snapshots `0000`–`0013` only.
Migrations `0014`–`0047` (journal idx 14–30) were **hand-written SQL** — no snapshot was
ever committed for them. drizzle-kit always diffs `schema.ts` against the **last snapshot
in `meta/` (sorted by filename)**, so `npm run db:generate` diffed against the 2025-era
`0013_snapshot.json` and proposed re-creating the entire schema (35 `CREATE TABLE`s,
814 lines of SQL, plus interactive "is this enum created or renamed?" prompts). Nobody
could safely use `db:generate`.

**What was done.** A single **baseline snapshot** `meta/0047_snapshot.json` was generated
from the current `packages/shared/src/db/schema.ts` and installed as the snapshot for the
last journal entry (idx 30, tag `0047_intermediary_role_sub_syndicate`). Its `prevId` is
set to the `id` of `0013_snapshot.json`, i.e. the chain skips the hand-written range.
**No SQL migration was added and nothing was run against any database.**

drizzle-kit tolerates this gap: `validateWithReport()` (drizzle-kit 0.31.7) only rejects
*malformed* snapshots and *`prevId` collisions* (two snapshots claiming the same parent).
Missing intermediate snapshots are not checked — `prepareOutFolder()` simply lists
`meta/*.json`, sorts by name, and diffs against the last one.

Verified after install:

```
$ npx drizzle-kit generate
...
No schema changes, nothing to migrate 😴
```

(no files created; `git status` clean apart from the new snapshot).

**Filename-collision guard.** drizzle-kit's default `index` prefix names the next
migration after `journal.entries.length` — which is **31**, colliding with the existing
`0031_add_ipo_slug_redirects.sql` and, worse, writing `meta/0031_snapshot.json`, which
sorts *before* `0047_snapshot.json` and would silently make the baseline the "latest"
snapshot again. `db:generate` therefore now runs with `--prefix=timestamp`, so new
migrations are named `YYYYMMDDHHMMSS_*` and always sort last:

```json
"db:generate": "drizzle-kit generate --prefix=timestamp"
```

**Rules going forward.**

- `db:generate` is usable again, but **review its output before trusting it**. It diffs
  against the baseline snapshot, i.e. against `schema.ts` — it does **not** know what the
  live database actually contains. Confirm with `npm run audit:schema-drift`
  (schema.ts vs live DB) before applying anything.
- Migrations `0014`–`0047` remain hand-written and **must not be regenerated**; their
  snapshots cannot be reconstructed.
- Never hand-edit `meta/_journal.json` to add a migration that drizzle-kit did not
  generate without also adding a matching snapshot — that is exactly how this defect was
  created.
- Destructive DDL still goes to `web/drizzle/migrations/_gated/` (kept out of the journal)
  and needs owner sign-off.

## 📋 Schema Management Workflow

### Making Schema Changes

#### Step 1: Update Drizzle Schema
```bash
# Edit the schema file
vim packages/shared/src/db/schema.ts
```

#### Step 2: Rebuild Shared Package
```bash
cd packages/shared
npm run build
```

#### Step 3: Generate Migration
```bash
cd ../web
npm run db:generate
# This creates a new migration in web/drizzle/migrations/
```

#### Step 4: Review Generated SQL
```bash
# Check the generated migration file
cat web/drizzle/migrations/00XX_*.sql
```

#### Step 5: Apply Migration
```bash
# Apply to database
npm run db:migrate

# OR for development (auto-applies without migration file)
npm run db:push
```

#### Step 6: Verify Changes
```bash
# Visual verification
npm run db:studio

# Or verify specific table
npm run verify:seed
```

---

## ⚠️ Common Anti-Patterns to AVOID

### ❌ DO NOT: Manually Alter Database

```sql
-- WRONG: Direct database modification
ALTER TABLE ipos ADD COLUMN new_field VARCHAR(255);
```

**Problem**: Creates schema drift - code expects one thing, database has another.

**What happened**: On 2025-10-18, we manually fixed `listing_performance` table, causing temporary confusion until properly documented.

### ❌ DO NOT: Edit Schema Without Migration

```typescript
// WRONG: Changing schema without generating migration
export const ipos = pgTable('ipos', {
  newField: varchar('new_field', { length: 255 }) // Added without migration
});
```

**Problem**: Local works, production breaks. Other developers get errors.

---

## ✅ Correct Workflow Example

### Example: Adding a Column to IPOs Table

```bash
# 1. Edit schema
# packages/shared/src/db/schema.ts
export const ipos = pgTable('ipos', {
  // ... existing fields
  newField: varchar('new_field', { length: 255 }),
});

# 2. Rebuild shared package
cd packages/shared && npm run build

# 3. Generate migration
cd ../web && npm run db:generate
# Prompts: "What should we name this migration?"
# Enter: "add_new_field_to_ipos"

# 4. Review migration
cat web/drizzle/migrations/00XX_add_new_field_to_ipos.sql

# 5. Apply migration
npm run db:migrate

# 6. Commit both schema and migration
git add packages/shared/src/db/schema.ts
git add web/drizzle/migrations/00XX_add_new_field_to_ipos.sql
git commit -m "feat(schema): Add newField to ipos table"
```

---

## 🔍 Verifying Schema Sync

### Check if Database Matches Schema

```bash
cd web
npm run db:push
```

**Expected Output (if in sync)**:
```
No schema changes detected
```

**Warning Output (if out of sync)**:
```
⚠️ You're about to apply schema changes...
```

### Manual Verification

```bash
# Check table structure
node --env-file=.env -e "
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const result = await client.query(\`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'your_table'
\`);
console.table(result.rows);
await client.end();
"
```

---

## 🚨 Schema Drift Incident Log

### Incident #1: listing_performance Schema Mismatch
- **Date**: October 18, 2025, 11:30 UTC
- **Symptom**: NSE scraper failing with "Failed to fetch IPO by slug"
- **Root Cause**: Database missing 6 columns that Drizzle schema expected:
  - `symbol`, `company_name`, `listing_date`, `data_source`, `created_at`, `updated_at`
- **Fix**: Manually added columns, then documented in migration `0013_fix_listing_performance_schema.sql`
- **Prevention**: This document created to establish workflow

**Error Message**:
```
DrizzleQueryError: column "symbol" does not exist
```

**Lesson Learned**: Always use `npm run db:push` to detect schema drift before debugging application code.

---

### Incident #2: Segment Field Too Restrictive - Blocking RIGHTS/InvIT/REIT Offerings
- **Date**: January 20, 2025, 17:00 UTC
- **Symptom**: All scrapers (NSE, Moneycontrol) rejecting 100% of retrieved IPOs with validation error "Invalid segment - must be MAINBOARD or SME"
- **Root Cause**:
  - `segment` field defined as `.notNull()` in schema (line 125)
  - RIGHTS issues, InvITs, REITs, QIP, Preferential offerings don't have market segments
  - Validation schema enforced NOT NULL constraint, rejecting all non-traditional offerings
- **Impact**:
  - NSE scraper: 0/4 IPOs validated (100% rejection rate)
  - Moneycontrol scraper: 0/7 IPOs validated (100% rejection rate)
  - GMP scraper: 0/15 GMPs matched (fuzzy matching issue - separate fix)
  - Only Chittorgarh scraper working (more flexible validation)
- **Fix Applied**:
  1. Made `segment` field nullable in `packages/shared/src/db/schema.ts` (line 125)
  2. Generated migration: `0016_make_segment_nullable.sql`
  3. Applied migration to VPS database
  4. Updated `scraper/src/utils/validators.ts` to accept nullable segment
  5. Updated NSE API client (`nse-api-client.ts`) to use segment+offeringType
  6. Updated Moneycontrol scraper to include segment field
- **Secondary Issue**: ISS-011 - Missing offering types (INVITS, REITS, IPP, QIP, PREFERENTIAL)
  - Fixed by adding 5 missing types to `detect-offering-type.ts` (lines 130-149)
- **Verification**:
  - Migration applied successfully: `ALTER TABLE "ipos" ALTER COLUMN "segment" DROP NOT NULL;`
  - Database query confirmed: `is_nullable: YES`
  - Scraper re-test results:
    - NSE: 3/4 success (75%) ✅
    - Moneycontrol: 7/7 success (100%) ✅
    - GMP: 13/15 success (87%) ✅
  - Validation success rate: 0% → 95%
- **Prevention**:
  - Design schema fields to accommodate all offering types from the start
  - Make fields nullable when business logic allows NULL values
  - Test scrapers with diverse offering types (not just IPOs)
  - Add offering type detection tests to CI/CD

**Error Message**:
```
IPO validation failed, skipping
companyName: "SMC Global Securities Limited"
errors: [
  {
    "code": "invalid_value",
    "message": "Invalid segment - must be MAINBOARD or SME",
    "path": ["segment"]
  }
]
```

**Migration Applied**:
```sql
-- Migration: Make segment field nullable to support RIGHTS/InvITs/REITs offerings
-- Issue: ISS-007 - Schema validation too strict
-- Date: 2025-01-20

ALTER TABLE "ipos" ALTER COLUMN "segment" DROP NOT NULL;
```

**Lesson Learned**: Overly restrictive schema constraints can silently block data ingestion. Always test scrapers with production-like data covering all offering types.

**Related Issues**: ISS-001, ISS-007, ISS-011 (all resolved)

---

## 📚 Migration Best Practices

### Naming Conventions

```
Format: NNNN_descriptive_snake_case.sql

Examples:
✅ 0013_fix_listing_performance_schema.sql
✅ 0014_add_subscription_timestamps.sql
✅ 0015_alter_ipos_add_isin.sql

❌ fix.sql (too vague)
❌ migration.sql (not descriptive)
❌ update-2025-10-18.sql (no context)
```

### Migration Content Guidelines

1. **Include Context**:
   ```sql
   -- Migration: Add ISIN field for IPO tracking
   -- Date: 2025-10-18
   -- Story: JIRA-123
   -- Reason: Required for NSE/BSE integration
   ```

2. **Use IF NOT EXISTS**:
   ```sql
   ALTER TABLE ipos ADD COLUMN IF NOT EXISTS isin VARCHAR(12);
   ```

3. **Include Rollback Comments**:
   ```sql
   -- To rollback: ALTER TABLE ipos DROP COLUMN IF EXISTS isin;
   ```

---

## 🔄 Drizzle Kit Commands Reference

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `npm run db:generate` | Generate migration from schema | After schema changes |
| `npm run db:migrate` | Apply pending migrations | Production deployments |
| `npm run db:push` | Push schema directly (no migration) | Development only |
| `npm run db:studio` | Open GUI for database | Visual inspection |

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────┐
│ packages/shared/src/db/schema.ts        │
│ ✅ SINGLE SOURCE OF TRUTH               │
└─────────────────┬───────────────────────┘
                  │
                  │ npm run db:generate
                  ↓
┌─────────────────────────────────────────┐
│ web/drizzle/migrations/NNNN_*.sql       │
│ Migration files (version control)       │
└─────────────────┬───────────────────────┘
                  │
                  │ npm run db:migrate
                  ↓
┌─────────────────────────────────────────┐
│ PostgreSQL Database                     │
│ Actual tables and data                  │
└─────────────────────────────────────────┘
```

---

## 🎓 Developer Checklist

Before pushing schema changes:

- [ ] Updated `packages/shared/src/db/schema.ts`
- [ ] Rebuilt shared package (`npm run build`)
- [ ] Generated migration (`npm run db:generate`)
- [ ] Reviewed generated SQL
- [ ] Applied migration locally (`npm run db:migrate`)
- [ ] Tested scraper/application
- [ ] Verified in Drizzle Studio (`npm run db:studio`)
- [ ] Committed both schema AND migration files
- [ ] Updated this document if new patterns emerge

---

## 📞 Questions?

If you encounter schema drift or sync issues:

1. **Check schema sync**: `cd web && npm run db:push`
2. **Review recent migrations**: `ls -la web/drizzle/migrations/`
3. **Check incident log** above for similar issues
4. **Document new incidents** in this file

---

**Remember**: The database should NEVER be manually altered. Always go through the schema → migration → database flow.
