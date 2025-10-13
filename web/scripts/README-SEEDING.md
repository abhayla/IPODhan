# Database Seeding Documentation

## Overview

This document describes the database seeding mechanism for the IPODhan testing environment (Story 7.11).

The seeding scripts populate the database with 150+ realistic IPO records for comprehensive testing across all application features.

## Scripts

### 1. seed-database.ts

**Purpose:** Main seeding script that generates and inserts IPO data

**Features:**
- Creates 150 IPO records with diverse statuses and categories
- Populates listing performance for LISTED IPOs
- Batch processing (50 IPOs per batch)
- Idempotent execution (safe to run multiple times)
- Force re-seed capability
- Comprehensive logging

**Usage:**
```bash
# Normal seeding (skip if data exists)
npm run seed:database

# Force re-seed (clears existing data)
npm run seed:force
```

**Data Distribution:**
- **Total:** 150 IPOs
- **Status:**
  - OPEN: 12.5% (19 IPOs)
  - CLOSED: 22.5% (34 IPOs)
  - LISTED: 55% (82 IPOs)
  - UPCOMING: 10% (15 IPOs)
- **Category:**
  - MAINBOARD: 70% (105 IPOs)
  - SME: 30% (45 IPOs)

**Output:**
```
======================================================================
DATABASE SEEDING FOR TESTING ENVIRONMENT
Story 7.11: Comprehensive IPO Database Seeding
======================================================================
Target: 150 IPOs
Force mode: NO

[1/5] Checking existing data...
✓ Database is empty, ready for seeding

[2/5] Calculating data distributions...
Target Distribution:
  Total: 150
  └─ Status:
     ├─ OPEN: 19 (12.7%)
     ├─ CLOSED: 34 (22.7%)
     ├─ LISTED: 82 (54.7%)
     └─ UPCOMING: 15 (10.0%)
  └─ Category:
     ├─ MAINBOARD: 105 (70.0%)
     └─ SME: 45 (30.0%)

[3/5] Generating IPO data...
  Generating 19 OPEN IPOs (13 MAINBOARD, 6 SME)...
  Generating 34 CLOSED IPOs (24 MAINBOARD, 10 SME)...
  Generating 82 LISTED IPOs (57 MAINBOARD, 25 SME)...
  Generating 15 UPCOMING IPOs (11 MAINBOARD, 4 SME)...
✓ Generated 150 IPO records

[4/5] Inserting IPOs into database...
  ✓ Batch 1/3: Inserted 50 IPOs (Total: 50/150)
  ✓ Batch 2/3: Inserted 50 IPOs (Total: 100/150)
  ✓ Batch 3/3: Inserted 50 IPOs (Total: 150/150)

✓ Insertion complete: 150 succeeded, 0 failed

[5/5] Populating historical data for LISTED IPOs...
  Found 82 LISTED IPOs
  ✓ Created 82 listing performance records

======================================================================
SEEDING COMPLETED SUCCESSFULLY
======================================================================

Final Statistics:
  Total IPOs: 150

  Status Distribution:
    ├─ OPEN: 19 (12.7%)
    ├─ CLOSED: 34 (22.7%)
    ├─ LISTED: 82 (54.7%)
    └─ UPCOMING: 15 (10.0%)

  Category Distribution:
    ├─ MAINBOARD: 105 (70.0%)
    └─ SME: 45 (30.0%)

  Historical Data:
    └─ Listing Performance Records: 82

  Execution Time: 25.43s

======================================================================

Next Steps:
  1. Verify data: npm run verify:seed
  2. Start dev server: npm run dev
  3. Open Drizzle Studio: npm run db:studio
```

### 2. verify-seed.ts

**Purpose:** Verification script that validates seeding results

**Features:**
- Validates total IPO count (≥150)
- Checks status and category distributions
- Verifies unique slugs
- Validates required fields
- Checks enum values
- Verifies listing performance coverage

**Usage:**
```bash
npm run verify:seed
```

**Output:**
```
======================================================================
DATABASE SEED VERIFICATION
Story 7.11: Comprehensive IPO Database Seeding
======================================================================

[1/7] Verifying total IPO count...
[2/7] Verifying status distribution...
[3/7] Verifying category distribution...
[4/7] Checking for duplicate slugs...
[5/7] Checking required fields...
[6/7] Validating enum values...
[7/7] Checking listing performance coverage...

======================================================================
VERIFICATION RESULTS
======================================================================

✓ Total IPO Count
  Database contains 150 IPOs (target: ≥150)

✓ Status: OPEN
  OPEN: 19 IPOs (12.7%) - Expected: 10-15%

✓ Status: CLOSED
  CLOSED: 34 IPOs (22.7%) - Expected: 20-25%

✓ Status: LISTED
  LISTED: 82 IPOs (54.7%) - Expected: 50-60%

✓ Status: UPCOMING
  UPCOMING: 15 IPOs (10.0%) - Expected: 10-15%

✓ Category: MAINBOARD
  MAINBOARD: 105 IPOs (70.0%) - Expected: ~70%

✓ Category: SME
  SME: 45 IPOs (30.0%) - Expected: ~30%

✓ Unique Slugs
  All IPO slugs are unique (no duplicates found)

✓ Required Fields
  All required fields (companyName, slug, category, status, createdAt, updatedAt) are populated

✓ Enum Values
  All category and status enum values are valid

✓ Listing Performance
  82/82 LISTED IPOs have performance data (100.0% coverage)

======================================================================
Summary: 10 passed, 0 warnings, 0 failed
======================================================================

✓ All verification tests passed!
Database seeding is successful and meets all acceptance criteria.
```

## Workflow

### Initial Database Setup

```bash
# Step 1: Apply database schema
npm run db:push

# Step 2: Seed database
cd web
npm run seed:database

# Step 3: Verify results
npm run verify:seed

# Step 4: (Optional) View data in Drizzle Studio
npm run db:studio
```

### Re-seeding (Force Mode)

```bash
# Clear existing data and re-seed
npm run seed:force

# Verify
npm run verify:seed
```

### Testing Workflow

```bash
# Before each comprehensive test session:

# 1. Reset database
npm run seed:force

# 2. Verify seeding
npm run verify:seed

# 3. Run tests
npm run test

# 4. Start dev server
npm run dev
```

## Data Structure

### IPO Records

Each IPO record includes:

**Required Fields:**
- `companyName` - Unique company name
- `slug` - Unique URL-friendly identifier
- `category` - MAINBOARD or SME
- `status` - UPCOMING, OPEN, CLOSED, or LISTED
- `createdAt` - Timestamp (explicit)
- `updatedAt` - Timestamp (explicit)

**Financial Fields:**
- `issueSize` - Issue size in crores (100-5000 for MAINBOARD, 10-100 for SME)
- `priceRangeMin` - Minimum price per share
- `priceRangeMax` - Maximum price per share
- `lotSize` - Lot size (15-100 for MAINBOARD, 1000-5000 for SME)
- `faceValue` - Face value (1, 2, 5, or 10)

**Dates (Based on Status):**
- **UPCOMING:** Future dates (5-30 days from today)
- **OPEN:** Currently open (openDate≤today, closeDate≥today)
- **CLOSED:** Recently closed (past close, future listing)
- **LISTED:** Historical (all dates in past, chronological)

**Other Fields:**
- `sector` - Industry sector (15 different sectors)
- `companyDescription` - Brief description
- `listingExchanges` - NSE, BSE, or both
- `registrar` - Registrar name
- `leadManagers` - Array of lead managers
- `rating` - 2-5 stars
- `ratingRationale` - Rating explanation

### Listing Performance (LISTED IPOs Only)

For each LISTED IPO:
- `listingPrice` - Price at listing
- `issuePrice` - Issue price
- `listingGainPercent` - Listing gain percentage
- `currentPrice` - Current market price
- `currentGainPercent` - Current gain percentage

## Configuration

### Seed Configuration (in seed-database.ts)

```typescript
const SEED_CONFIG = {
  totalIPOs: 150,
  statusDistribution: {
    OPEN: { min: 10, max: 15 },      // 10-15%
    CLOSED: { min: 20, max: 25 },    // 20-25%
    LISTED: { min: 50, max: 60 },    // 50-60%
    UPCOMING: { min: 10, max: 15 },  // 10-15%
  },
  categoryDistribution: {
    MAINBOARD: 70,  // 70%
    SME: 30,        // 30%
  },
  batchSize: 50,  // Process 50 IPOs per batch
};
```

### Verification Tolerances (in verify-seed.ts)

```typescript
const EXPECTED_TOTAL = 150;
const TOLERANCE = 5; // ±5% tolerance for distributions
```

## Schema Compatibility

The seeding scripts are compatible with the IPODhan database schema (`web/lib/db/schema.ts`).

**Field Name Mapping:**
- ✅ `priceRangeMin` / `priceRangeMax` (NOT priceBandLow/High)
- ✅ Explicit `createdAt` / `updatedAt` timestamps
- ✅ Valid enum values (category, status, exchange)
- ✅ Nullable field handling (null for optional fields)

**Historical Fields (Story 7.10):**
All historical data fields are set to `null` by default:
- `subscriptionRetail`, `subscriptionHni`, `subscriptionQib`, `subscriptionTotal`
- `gmpPrice`, `gmpPercentageHistorical`, `gmpUpdatedAtHistorical`
- `listingPriceHistorical`, `listingGainPercentage`, `listingGainAmount`
- `currentPrice`, `currentGainPercentage`, `currentGainAmount`
- `historicalDataSource`, `historicalDataScrapedAt`

## Error Handling

### Common Issues

**1. Database connection error**
```
Error: Database configuration not found
```
**Solution:** Ensure `.env.local` file exists with `DATABASE_URL` or individual `DATABASE_*` variables

**2. Existing data**
```
⚠️  Database already contains 28 IPOs
Seed script is idempotent - skipping to avoid duplicates
```
**Solution:** Use `npm run seed:force` to clear and re-seed

**3. Batch insert failure**
```
✗ Batch 2/3 failed: [error details]
```
**Solution:** Check error message, verify schema compatibility, check database constraints

**4. Verification failures**
```
✗ Some verification tests failed.
```
**Solution:** Review verification output, check specific failures, re-run seed script if needed

## Performance

**Seed Script:**
- Execution time: <30 seconds for 150 IPOs
- Batch processing: <5 seconds per 50 IPOs
- Memory usage: <200MB

**Verification Script:**
- Execution time: <3 seconds
- Minimal memory footprint

## Troubleshooting

### Slug Duplicates

If verification reports duplicate slugs:
```bash
# Check duplicates in database
npm run db:studio

# Filter: slug WHERE COUNT(*) > 1

# Re-run seeding
npm run seed:force
```

### Distribution Out of Range

If status/category distributions are outside expected ranges:
- This is acceptable within ±5% tolerance
- For exact distributions, modify `SEED_CONFIG` in `seed-database.ts`

### Missing Listing Performance

If LISTED IPOs are missing listing_performance records:
- Check batch insert errors in seed script output
- Verify foreign key constraints
- Re-run seed script

## Database Queries

### Manual Verification Queries

```sql
-- Total count
SELECT COUNT(*) FROM ipos;

-- Status distribution
SELECT status, COUNT(*) as count,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM ipos
GROUP BY status
ORDER BY status;

-- Category distribution
SELECT category, COUNT(*) as count,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM ipos
GROUP BY category
ORDER BY category;

-- Duplicate slugs
SELECT slug, COUNT(*) as count
FROM ipos
GROUP BY slug
HAVING COUNT(*) > 1;

-- Listing performance coverage
SELECT
  COUNT(DISTINCT i.id) as listed_ipos,
  COUNT(DISTINCT lp.id) as with_performance,
  ROUND(100.0 * COUNT(DISTINCT lp.id) / COUNT(DISTINCT i.id), 2) as coverage_percent
FROM ipos i
LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
WHERE i.status = 'LISTED';
```

## Best Practices

1. **Always run verification after seeding** to ensure data integrity
2. **Use force mode between test runs** to ensure consistent test state
3. **Check logs for batch failures** - even partial success counts
4. **Monitor database size** - 150 IPOs = ~2MB (approximate)
5. **Clear data before production deployment** - seeded data is for testing only

## Known Limitations

1. **Synthetic Data:** Company names and metrics are generated, not real
2. **English Only:** All data in English language
3. **Limited Relations:** Only listing_performance populated
4. **No Time-Series Data:** No subscription/GMP snapshots
5. **Static Data:** Data doesn't update after seeding

## Future Enhancements

1. Populate subscription time-series data
2. Generate GMP records for active IPOs
3. Add document records (DRHP, RHP, Prospectus)
4. Populate financial_data table
5. Add peer_companies records
6. Support custom IPO counts via CLI argument
7. Multiple seed profiles (minimal, standard, comprehensive)
8. Real data import from Chittorgarh scraper

## Support

For issues or questions:
1. Check this documentation first
2. Review progress report: `docs/stories/progress-reports/story-7.11-progress-report.md`
3. Check story file: `docs/stories/7.11.database-seeding-for-testing.story.md`
4. Run verification: `npm run verify:seed`
5. Check database directly: `npm run db:studio`

---

**Documentation Version:** 1.0
**Last Updated:** 2025-10-13
**Story:** 7.11 - Database Seeding for Testing Environment
