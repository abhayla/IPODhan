# IPO Data Backfill Process

## Overview

This document describes the process for backfilling historical IPO data into the IPODhan database.

## Backfill Script

**Location:** `ipodhan-data-pipeline/scripts/backfill_historical_data.py`

**Purpose:** Scrapes and imports historical IPO data from the past 2 years and GMP historical data where available.

## Prerequisites

1. Database must be running and accessible
2. Environment variables configured in `.env`:
   ```bash
   DB_HOST=your_db_host
   DB_PORT=5432
   DB_NAME=ipodhan
   DB_USER=postgres
   DB_PASSWORD=your_password
   ```
3. All Python dependencies installed (`pip install -r requirements.txt`)

## Execution Instructions

### Step 1: Prepare Database

Ensure database migrations are up to date:

```bash
cd infrastructure/database
python scripts/run_migration.py 002_enhanced_ipo_schema.sql
```

### Step 2: Run Backfill Script

```bash
cd ipodhan-data-pipeline
python scripts/backfill_historical_data.py
```

### Step 3: Monitor Progress

The script provides:
- Progress tracking with percentage complete
- Resumability if interrupted (tracks last processed date)
- Error logging to `backfill_errors.log`
- Summary statistics upon completion

## Expected Output

```
[2025-10-02 10:00:00] Starting historical backfill...
[2025-10-02 10:00:05] Scraping IPOs from 2023-10-02 to 2025-10-02
[2025-10-02 10:00:10] Progress: 10% (50/500 IPOs processed)
[2025-10-02 10:05:30] Progress: 50% (250/500 IPOs processed)
[2025-10-02 10:10:45] Progress: 100% (500/500 IPOs processed)
[2025-10-02 10:11:00] Backfilling GMP data for 500 IPOs...
[2025-10-02 10:15:30] Backfill complete!

Summary:
- Total IPOs scraped: 500
- Successfully inserted: 487
- Duplicates skipped: 13
- GMP records inserted: 1,250
- Errors: 0
- Duration: 15 minutes
```

## Data Verification

After backfill, verify data integrity:

```sql
-- Check total IPOs imported
SELECT COUNT(*) FROM ipos WHERE created_at >= NOW() - INTERVAL '2 years';

-- Check GMP history records
SELECT COUNT(*) FROM gmp_tracking;

-- Verify date ranges
SELECT MIN(open_date), MAX(open_date) FROM ipos;

-- Check data completeness
SELECT status, COUNT(*) FROM ipos GROUP BY status;
```

## Resumability

If the backfill process is interrupted:

1. The script saves progress to `backfill_checkpoint.json`
2. On restart, it resumes from the last successfully processed date
3. No duplicate data will be inserted (duplicate detection handles this)

## Troubleshooting

### Issue: Connection timeout
**Solution:** Increase timeout in script or check database connectivity

### Issue: Rate limiting from source websites
**Solution:** Script includes built-in delays (30s between requests). If blocked, wait 1 hour and restart.

### Issue: Duplicate key violations
**Solution:** This is normal - duplicate detection prevents re-insertion. Script will continue.

### Issue: Missing GMP data for older IPOs
**Solution:** GMP sources may not have historical data beyond 6 months. This is expected.

## Performance Considerations

- **Estimated time:** 15-30 minutes for 2 years of data (~500 IPOs)
- **Network usage:** ~100-200 HTTP requests
- **Database load:** Moderate (batch inserts used where possible)
- **Disk space:** Negligible (<10 MB for 500 IPOs with GMP history)

## Post-Backfill Tasks

1. Refresh materialized views:
   ```sql
   REFRESH MATERIALIZED VIEW CONCURRENTLY gmp_current;
   ```

2. Update database statistics:
   ```sql
   ANALYZE ipos;
   ANALYZE gmp_tracking;
   ```

3. Verify data quality:
   ```bash
   cd ipodhan-data-pipeline
   python -m pytest tests/integration/test_full_pipeline.py -v
   ```

## Scheduling Future Backfills

For incremental updates, set up a weekly cron job:

```bash
# Every Sunday at 2 AM
0 2 * * 0 cd /path/to/ipodhan-data-pipeline && python scripts/backfill_historical_data.py --incremental
```

## Notes

- First run imports all data from past 2 years
- Subsequent runs (with --incremental flag) only import new data
- GMP data availability varies by source (typically 3-6 months history max)
- Script respects rate limits and includes anti-bot detection bypasses
