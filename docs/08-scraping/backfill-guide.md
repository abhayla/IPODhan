# Historical IPO Data Backfill Guide (Story 11.4)

**Document Version:** 1.0
**Last Updated:** 2025-10-18
**Story:** Story 11.4 - Historical IPO Data Backfill from NSE Past Endpoints

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Execution Instructions](#execution-instructions)
4. [CLI Options](#cli-options)
5. [Workflow](#workflow)
6. [Troubleshooting](#troubleshooting)
7. [Output & Reports](#output--reports)

---

## Overview

The backfill script fetches historical IPO listing performance data from NSE's past endpoints and populates the `listing_performance` table in the database. It implements:

- **Data Fetching**: NSE `/api/public-past-issues` endpoint (200-300 past IPOs expected)
- **Data Transformation**: Field mapping, type conversion, validation
- **IPO Matching**: Symbol-first matching, fallback to pg_trgm name similarity
- **Batch Persistence**: Transaction-safe batch upserts (50 records/batch)
- **Quality Validation**: Data quality checks with scoring (target: >95%)
- **Operational Features**: Dry-run mode, resume capability, progress tracking

**Target Coverage (AC5):**
- Minimum 200 past IPOs fetched
- 60%+ matching success rate
- 95%+ data completeness

---

## Prerequisites

### 1. Environment Setup

Ensure you have the required environment variables in `scraper/.env`:

```bash
# Database connection (required)
DATABASE_URL=postgresql://user:password@host:5432/ipodhan

# OR use individual parameters:
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=ipodhan
DATABASE_USER=postgres
DATABASE_PASSWORD=your_password

# Redis connection (required)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional
```

### 2. Database Requirements

- **PostgreSQL 16+** with `pg_trgm` extension enabled (for fuzzy name matching)
- **Migration 0010_medical_viper** applied (adds `data_source` enum and enhances `listing_performance` table)

**Verify migration:**

```bash
cd web
npm run db:studio  # Check that listing_performance table has symbol, company_name, listing_date, data_source columns
```

### 3. Dependencies

Install required npm packages (should already be installed):

```bash
cd scraper
npm install commander cli-progress
npm install --save-dev @types/cli-progress
```

---

## Execution Instructions

### Step 1: Dry-Run Mode (Preview Only)

**Always start with a dry-run** to preview data without database writes:

```bash
cd scraper
npm run backfill:dry
```

**What it does:**
- Fetches past IPOs from NSE
- Transforms and validates data
- Matches against existing IPOs
- Calculates quality metrics
- **Does NOT write to database**
- Prints detailed report to console

**Expected Output:**
```
Backfill Progress |████████████████████████████████| 100% | 250/250 Records | ETA: 0s

================================================================================
BACKFILL REPORT - Story 11.4
================================================================================
Mode: DRY-RUN (Preview)
Duration: 45s

Coverage (AC5):
  Fetched from NSE: 250 (Target: 200+)
  Transformed: 248
  Matched: 165 (66%) [Target: 60%+]
  Unmatched: 83

Matching Breakdown (AC3):
  By Symbol (100%): 120
  By Name High (90%): 35
  By Name Medium (70%): 10

Data Quality (AC6):
  Quality Score: 96% (Target: >95%)
  All Required Fields: 248/248
  With Current Price: 200/248
  With Listing Gain: 240/248

Persistence (AC4):
  Upserted: 0 (DRY-RUN mode)
  Batches Processed: 0
  Conflicts: 12

Unmatched Report: /path/to/scraper/logs/unmatched-ipos-2025-10-18T12-00-00.csv
================================================================================
```

### Step 2: Verify Quality Score

**Check the quality score from dry-run output:**

- **Quality Score ≥ 95%**: ✅ Safe to proceed to production
- **Quality Score < 95%**: ❌ Investigate issues first

**If quality score is low**, run validation script:

```bash
npm run validate:backfill
```

### Step 3: Production Execution

**After successful dry-run with quality score ≥ 95%:**

```bash
npm run backfill
```

**Confirmation prompt:**
```
⚠️  WARNING: Running in PRODUCTION mode - will write to database!

Press Ctrl+C to cancel, or wait 5 seconds to continue...
```

**What it does:**
- Fetches and transforms data (same as dry-run)
- **Writes to database** in transaction-safe batches (50 records/batch)
- Invalidates cache for updated IPOs
- Saves checkpoints after each batch (for resume capability)
- Generates unmatched records CSV report

**Expected Duration:** 5-10 minutes for 200-300 records

---

## CLI Options

### Available Flags

```bash
npm run backfill -- [options]

Options:
  --dry-run              Preview mode without database writes (default: false)
  --batch-size <number>  Records per batch (default: 50, range: 10-100)
  --resume               Resume from last checkpoint (default: false)
  --start-batch <number> Start from specific batch number (default: 0)
  --yes                  Skip confirmation prompt (default: false)
  -h, --help             Display help information
```

### Examples

**1. Production with custom batch size:**
```bash
npm run backfill -- --batch-size=25
```

**2. Resume from checkpoint (if interrupted):**
```bash
npm run backfill -- --resume
```

**3. Start from specific batch:**
```bash
npm run backfill -- --start-batch=5
```

**4. Skip confirmation (for automation):**
```bash
npm run backfill -- --yes
```

**5. Dry-run with custom batch size:**
```bash
npm run backfill:dry -- --batch-size=25
```

---

## Workflow

### Complete Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Initialize NSE Session (Multi-Page Cookie Collection)       │
│    - Visit NSE homepage                                         │
│    - Visit market-data page                                     │
│    - Collect session cookies (nsit, nseappid, bm_sv)           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Fetch Past IPOs from NSE                                     │
│    - Endpoint: /api/public-past-issues                          │
│    - Expected: 200-300 records                                  │
│    - Retry logic: 3 attempts with exponential backoff           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Transform & Validate Data                                    │
│    - Clean symbols (uppercase, alphanumeric)                    │
│    - Parse prices (₹1,234.50 → 1234.50)                        │
│    - Parse dates (DD-MMM-YYYY → YYYY-MM-DD)                    │
│    - Calculate listing gain (%)                                 │
│    - Validate: min 3 required fields, positive prices, etc.     │
│    - Deduplicate: by symbol + listing_date (keep complete)      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Match IPOs Against Database                                  │
│    - Primary: Match by symbol (100% confidence)                 │
│    - Fallback: Match by name with pg_trgm similarity            │
│      • ≥ 90% similarity: 90% confidence (HIGH)                 │
│      • 70-89% similarity: 70% confidence (MEDIUM)               │
│      • < 70% similarity: No match (0% confidence)               │
│    - Unmatched: Store with NULL ipo_id                          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Calculate Quality Metrics                                    │
│    - Quality Score Formula (Target: >95%):                      │
│      (recordsWithAllRequired * 0.4 +                            │
│       recordsWithCurrentPrice * 0.3 +                           │
│       matchedRecords * 0.3) * 100                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. Batch Upsert to Database (Production Only)                   │
│    - Batch size: 50 records (configurable)                      │
│    - Transaction per batch (rollback on error)                  │
│    - Conflict resolution: onConflictDoUpdate on ipo_id          │
│    - Cache invalidation: Clear ipo:slug:* for matched IPOs      │
│    - Checkpoint: Save after each batch (for resume)             │
│    - Rate limiting: 2s delay between batches                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Generate Reports                                             │
│    - Backfill summary (console output)                          │
│    - Unmatched records CSV (logs/unmatched-ipos-{timestamp}.csv)│
│    - Checkpoint file (backfill-checkpoint.json)                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

### Common Issues

#### 1. NSE API Authentication Failed (401/403)

**Error:**
```
NSE API returned 401 Unauthorized after 3 attempts
```

**Cause:** NSE session cookies expired or insufficient cookies collected.

**Solution:**
- The script automatically refreshes cookies (3 retry attempts)
- If persistent, check if NSE API endpoints are accessible
- Verify network connectivity to nseindia.com

**Workaround:**
```bash
# Test NSE API connectivity first
cd scraper
tsx src/scripts/debug-nse-api.ts
```

---

#### 2. Database Connection Error

**Error:**
```
Failed to initialize database connection
```

**Cause:** Incorrect DATABASE_URL or database not running.

**Solution:**
1. Verify DATABASE_URL in `scraper/.env`:
   ```bash
   echo $DATABASE_URL
   ```
2. Test database connection:
   ```bash
   psql $DATABASE_URL -c "SELECT 1"
   ```
3. Ensure PostgreSQL is running:
   ```bash
   pg_isready
   ```

---

#### 3. pg_trgm Extension Not Found

**Error:**
```
function similarity(character varying, unknown) does not exist
```

**Cause:** pg_trgm extension not enabled in database.

**Solution:**
```sql
-- Connect to database
psql $DATABASE_URL

-- Enable extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Verify
\dx pg_trgm
```

---

#### 4. Low Quality Score (<95%)

**Error:**
```
Quality Score: 88% (Target: >95%)
```

**Cause:** Missing required fields or low match rate.

**Solution:**
1. Run validation script to identify issues:
   ```bash
   npm run validate:backfill
   ```
2. Check validation report for specific failures
3. Review unmatched records CSV to identify patterns
4. If NSE data quality is poor, proceed with caution or manually verify critical records

---

#### 5. Batch Upsert Failed - Transaction Rolled Back

**Error:**
```
Batch 3 failed - rolling back
```

**Cause:** Database constraint violation or connection timeout.

**Solution:**
1. Check logs for specific error:
   ```bash
   tail -50 logs/scraper.log
   ```
2. Resume from last checkpoint:
   ```bash
   npm run backfill -- --resume
   ```
3. If persistent, reduce batch size:
   ```bash
   npm run backfill -- --batch-size=25 --resume
   ```

---

#### 6. Script Interrupted Mid-Execution

**Scenario:** Press Ctrl+C or connection lost during backfill.

**Solution:**
Use resume capability (checkpoint automatically saved after each batch):

```bash
npm run backfill -- --resume
```

**How it works:**
- Checkpoint file: `scraper/backfill-checkpoint.json`
- Contains: last batch number, total upserted, timestamp
- Script automatically loads checkpoint and resumes from next batch

**Manual override (start from specific batch):**
```bash
npm run backfill -- --start-batch=10
```

---

#### 7. Verify Quality After Backfill

**Run validation script:**
```bash
npm run validate:backfill
```

**Expected Output:**
```
================================================================================
BACKFILL DATA QUALITY VALIDATION REPORT (AC6)
================================================================================
Timestamp: 2025-10-18T12:30:00.000Z
Total Records: 248

Validation Checks:
--------------------------------------------------------------------------------
✅ PASS | Required Fields (AC6.1)
       All records have required fields (symbol, company_name, listing_date, listing_price)
       Failures: 0

✅ PASS | Date Range (AC6.2)
       All listing dates within valid range (2015-01-01 to TODAY)
       Failures: 0

✅ PASS | Price Ranges (AC6.3)
       All prices are positive (> 0)
       Failures: 0

✅ PASS | Listing Gain (AC6.4)
       All listing gains within valid range (-100% to 1000%)
       Failures: 0

✅ PASS | Referential Integrity (AC6.5)
       All ipo_id foreign keys are valid
       Failures: 0

✅ PASS | No Duplicate ipo_id (AC6.6)
       No duplicate ipo_id found (one-to-one relationship maintained)
       Failures: 0

✅ PASS | No Duplicate Symbol+Date (AC6.7)
       No duplicate symbol + listing_date combinations found
       Failures: 0

Quality Score:
--------------------------------------------------------------------------------
Score: 96% (Target: > 95%)
Status: ✅ PASS

Overall Result:
--------------------------------------------------------------------------------
✅ VALIDATION PASSED
================================================================================
```

---

## Output & Reports

### 1. Console Output

**Real-time progress bar:**
```
Backfill Progress |████████████████████████| 100% | 248/248 Records | ETA: 0s
```

**Summary report (printed after completion):**
- Coverage metrics (fetched, transformed, matched counts)
- Matching breakdown by method (symbol, name-high, name-medium)
- Data quality metrics (quality score, field completeness)
- Persistence metrics (upserted count, batches, conflicts)

### 2. Unmatched Records CSV

**Location:** `scraper/logs/unmatched-ipos-{timestamp}.csv`

**Format:**
```csv
Symbol,Company Name,Listing Date,Listing Price,Reason,Extracted At
"ABC","ABC Company Ltd","2024-01-15","250","No match found (symbol or name)","2025-10-18T12:00:00.000Z"
```

**Use case:**
- Manual review of unmatched IPOs
- Identify missing IPOs in database
- Add missing IPOs manually or via separate import

### 3. Checkpoint File

**Location:** `scraper/backfill-checkpoint.json`

**Format:**
```json
{
  "lastBatch": 4,
  "totalUpserted": 200,
  "timestamp": "2025-10-18T12:15:30.000Z"
}
```

**Use case:**
- Resume interrupted backfill execution
- Track progress across multiple runs

### 4. Validation Failures CSV

**Location:** `scraper/logs/validation-failures-{timestamp}.csv` (only if validation fails)

**Format:**
```csv
Check,ID,Symbol,Company Name,Details
"Date Range","uuid","XYZ","XYZ Ltd","{\"listing_date\":\"2030-01-01\"}"
```

**Use case:**
- Debug data quality issues
- Identify specific records requiring manual correction

---

## Post-Backfill Actions

### 1. Verify Data in UI

Spot-check 5-10 IPO detail pages to ensure listing performance data is displayed:

```bash
# Example IPOs to check (replace with actual slugs from your database)
http://localhost:3000/ipos/company-xyz-ipo
http://localhost:3000/ipos/company-abc-ipo
```

**What to verify:**
- Listing price displayed
- Listing gain % displayed
- Current price displayed (if available)
- Data source shows "NSE_PAST_API"

### 2. Clear Checkpoint (After Successful Completion)

Checkpoint is automatically cleared after successful completion.

**Manual cleanup (if needed):**
```bash
rm scraper/backfill-checkpoint.json
```

### 3. Review Unmatched Records

**Manual review workflow:**
1. Open unmatched CSV: `scraper/logs/unmatched-ipos-{timestamp}.csv`
2. For each unmatched record:
   - Check if IPO exists in database with different symbol/name
   - Add missing IPO manually via admin interface
   - Re-run backfill to match previously unmatched records

---

## Best Practices

### 1. Always Start with Dry-Run

```bash
npm run backfill:dry
```

- Validates NSE API connectivity
- Previews data quality
- Identifies potential issues before database writes

### 2. Monitor Quality Score

- **Quality Score ≥ 95%**: ✅ Proceed to production
- **Quality Score 90-94%**: ⚠️ Review unmatched records, consider manual intervention
- **Quality Score < 90%**: ❌ Investigate NSE data quality issues, contact NSE or use alternative data source

### 3. Use Resume Capability

- For large datasets (>300 records), use resume if interrupted
- Checkpoints saved after each batch (50 records)
- Safe to Ctrl+C and resume later

### 4. Validate After Production Run

```bash
npm run validate:backfill
```

- Ensures data integrity
- Detects any database constraint violations
- Confirms quality score matches backfill report

### 5. Schedule Regular Backfills

**Recommended schedule:**
- **Monthly**: Backfill new past IPOs (listings from current month)
- **Quarterly**: Full re-backfill to update current prices

**Automation example (cron job):**
```bash
# Add to crontab (monthly on 1st at 2 AM)
0 2 1 * * cd /path/to/scraper && npm run backfill -- --yes >> logs/backfill-cron.log 2>&1
```

---

## Support & Debugging

### Enable Debug Logging

```bash
# Set log level to debug
export LOG_LEVEL=debug

# Run backfill with debug logs
npm run backfill:dry
```

### Check Logs

```bash
# View recent logs
tail -100 logs/scraper.log

# Search for errors
grep -i error logs/scraper.log

# Search for specific symbol
grep -i "SYMBOL" logs/scraper.log
```

### Database Queries

**Check backfilled records:**
```sql
SELECT
  COUNT(*) as total,
  COUNT(ipo_id) as matched,
  COUNT(*) - COUNT(ipo_id) as unmatched
FROM listing_performance
WHERE data_source = 'NSE_PAST_API';
```

**Check quality metrics:**
```sql
SELECT
  COUNT(*) FILTER (WHERE symbol IS NOT NULL AND listing_date IS NOT NULL AND listing_price IS NOT NULL) as with_required,
  COUNT(*) FILTER (WHERE current_price IS NOT NULL) as with_current_price,
  COUNT(*) FILTER (WHERE listing_gain_percent IS NOT NULL) as with_listing_gain
FROM listing_performance
WHERE data_source = 'NSE_PAST_API';
```

---

**Document End**
