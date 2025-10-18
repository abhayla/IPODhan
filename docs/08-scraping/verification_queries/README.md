# IPODhan Database Verification Queries

This directory contains comprehensive SQL verification queries for validating the IPODhan database after scraper execution. These queries are based on Phase 3 of the comprehensive-scraping-plan.md.

## Overview

These queries help verify:
- Data quality and integrity
- Scraper field population correctness
- Time-series data validity
- Relationship coverage between tables
- Duplicate detection
- Conflict resolution

## Query Files

### 1. duplicate-detection.sql (Section 3.2)
**Purpose:** Detect duplicate and potentially duplicate IPO records

**Checks:**
- Duplicate company names (exact matches)
- Duplicate slugs (critical for routing)
- Duplicate ISIN codes
- Duplicate stock symbols
- Fuzzy duplicates (similar names using pg_trgm extension)

**Expected Result:** All queries should return 0 rows for a clean database

**How to Run:**
```bash
psql -h localhost -U postgres -d ipodhan -f verification_queries/duplicate-detection.sql
```

**Severity:** HIGH - Any duplicates found should be flagged immediately

---

### 2. data-quality-validation.sql (Section 3.3)
**Purpose:** Validate data integrity and business logic constraints

**Checks:**
- Date ordering violations (open_date > close_date, etc.)
- Price range violations (min > max, negative values)
- Positive value validation for numeric fields
- JSONB array validation (empty listing_exchanges)
- Future dates validation
- Subscription multiples validation (no negative values)
- GMP validation (reasonable percentage ranges)
- Listing performance validation
- Status and date consistency
- Minimum investment validation

**Expected Result:** All queries should return 0 rows

**How to Run:**
```bash
psql -h localhost -U postgres -d ipodhan -f verification_queries/data-quality-validation.sql
```

**Severity:** Any row returned indicates a data quality issue

---

### 3. scraper-field-validation.sql (Section 3.4)
**Purpose:** Verify each scraper populated its assigned fields correctly

**Scraper Responsibilities:**
- **NSE:** Subscription data, MAINBOARD IPOs, listing exchanges
- **BSE:** SME IPOs, issue_size, price bands
- **Chittorgarh:** GMP data (historical tracking)
- **Moneycontrol:** Sector, company descriptions, ratings
- **API Fallback:** Fill gaps from other scrapers

**Checks:**
- NSE field population for MAINBOARD IPOs
- BSE field population for SME IPOs
- Chittorgarh GMP data coverage
- Moneycontrol company data coverage
- Dual-listed IPO data merge verification
- Scraper execution logs

**Expected Result:** Empty result sets indicate complete coverage

**How to Run:**
```bash
psql -h localhost -U postgres -d ipodhan -f verification_queries/scraper-field-validation.sql
```

---

### 4. field-coverage-report.sql (Section 3.5)
**Purpose:** Generate comprehensive field population statistics

**Reports:**
- Core IPO table field population (all 30+ fields)
- Historical performance fields population
- Field population by IPO status
- Field population by category (MAINBOARD vs SME)
- Field-by-field analysis (transposed view)
- Missing critical fields report
- Field population timeline (recency)
- Overall field coverage score

**Expected Result:** Critical fields should be 100% populated

**How to Run:**
```bash
psql -h localhost -U postgres -d ipodhan -f verification_queries/field-coverage-report.sql > field_coverage_report.txt
```

---

### 5. conflict-resolution-check.sql (Section 3.6)
**Purpose:** Verify scraper priority system works correctly

**Scraper Priority:** NSE(1) > BSE(2) > Moneycontrol(3) > Chittorgarh(4) > API_Fallback(5)

**Checks:**
- Dual-listed IPO identification
- Scraper execution timeline
- Data comparison for dual-listed IPOs
- Field-level conflict detection
- Data freshness checks
- Conflict resolution integrity
- Moneycontrol supplementation verification
- GMP data priority check

**Expected Result:** Higher priority data should overwrite lower priority data

**How to Run:**
```bash
psql -h localhost -U postgres -d ipodhan -f verification_queries/conflict-resolution-check.sql
```

---

### 6. time-series-validation.sql (Section 3.7)
**Purpose:** Validate time-series data integrity for subscriptions and GMP records

**Checks:**
- **Subscriptions Table:**
  - Duplicate timestamps
  - Future timestamps
  - Subscriptions before IPO open date
  - Subscriptions after IPO close date
  - Time-series ordering
  - Time gaps detection
  - Data completeness

- **GMP Records Table:**
  - Duplicate timestamps
  - Future timestamps
  - GMP records before IPO open
  - Time-series ordering
  - Data freshness
  - Negative or extreme GMP values

**Expected Result:** No duplicates, no future timestamps, proper ordering

**How to Run:**
```bash
psql -h localhost -U postgres -d ipodhan -f verification_queries/time-series-validation.sql
```

---

### 7. field-population-report.sql (Section 3.10)
**Purpose:** Comprehensive report on field population across all tables

**Reports:**
- Core IPO fields population (categorized by field type)
- Field population by IPO status
- Field population by category
- Field population heatmap (status x category)
- Recently scraped vs older data comparison
- Top 10 most complete IPOs
- Top 10 least complete IPOs (needing attention)
- Overall database completeness score

**Expected Result:** Weighted completeness score should be ≥ 90%

**How to Run:**
```bash
psql -h localhost -U postgres -d ipodhan -f verification_queries/field-population-report.sql > field_population_report.txt
```

---

### 8. related-tables-coverage.sql (Section 3.11)
**Purpose:** Verify relationship coverage between ipos table and related tables

**Tables Checked:**
- subscriptions (time-series subscription data)
- gmp_records (time-series GMP tracking)
- documents (IPO documents: DRHP, RHP, etc.)
- listing_performance (listing and current prices)
- financial_data (legacy financial metrics)
- ipo_financials (enhanced financial data)
- ipo_details (extended IPO details)
- peer_companies (peer comparison data)
- ipo_reviews (analyst reviews)
- ipo_scores (AI scoring system)

**Reports:**
- Coverage percentage for each related table
- IPOs missing related data
- Document type distribution
- Comprehensive relationship coverage matrix
- IPOs with complete related data (gold standard)
- IPOs with minimal related data (needing attention)
- Overall related tables health summary

**Expected Result:** Key relationships should have high coverage

**How to Run:**
```bash
psql -h localhost -U postgres -d ipodhan -f verification_queries/related-tables-coverage.sql
```

---

## Running All Queries

To run all verification queries in sequence:

```bash
# PowerShell (Windows)
$queries = @(
  "duplicate-detection.sql",
  "data-quality-validation.sql",
  "scraper-field-validation.sql",
  "field-coverage-report.sql",
  "conflict-resolution-check.sql",
  "time-series-validation.sql",
  "field-population-report.sql",
  "related-tables-coverage.sql"
)

foreach ($query in $queries) {
  Write-Host "Running $query..." -ForegroundColor Green
  psql -h localhost -U postgres -d ipodhan -f "verification_queries/$query" > "verification_results/$query.txt"
  Write-Host "Completed $query" -ForegroundColor Green
}
```

```bash
# Bash (Linux/Mac)
for query in duplicate-detection data-quality-validation scraper-field-validation field-coverage-report conflict-resolution-check time-series-validation field-population-report related-tables-coverage
do
  echo "Running ${query}.sql..."
  psql -h localhost -U postgres -d ipodhan -f "verification_queries/${query}.sql" > "verification_results/${query}.txt"
  echo "Completed ${query}.sql"
done
```

---

## Output Directory

Create a directory for storing verification results:

```bash
mkdir -p verification_results
```

All query results will be saved to `verification_results/` directory with corresponding `.txt` files.

---

## Prerequisites

### Required PostgreSQL Extensions

Some queries require the `pg_trgm` extension for fuzzy duplicate detection:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### Database Connection

Ensure you have access to the IPODhan database:

```bash
# Test connection
psql -h localhost -U postgres -d ipodhan -c "SELECT COUNT(*) FROM ipos;"
```

### Environment Variables

Set PostgreSQL password to avoid prompts:

**Windows:**
```powershell
$env:PGPASSWORD = "your_password"
```

**Linux/Mac:**
```bash
export PGPASSWORD="your_password"
```

Or create a `.pgpass` file:
```
localhost:5432:ipodhan:postgres:your_password
```

---

## Interpreting Results

### Success Criteria

**All queries should return 0 rows for:**
- duplicate-detection.sql (no duplicates)
- data-quality-validation.sql (no violations)
- time-series-validation.sql (no invalid timestamps)

**Coverage percentages should be:**
- Critical fields: 100%
- Important fields: ≥ 90%
- Optional fields: ≥ 75%

**Related tables coverage should be:**
- Subscriptions: ≥ 90% for OPEN/CLOSED IPOs
- GMP records: ≥ 80% for OPEN/CLOSED/LISTED IPOs
- Documents: ≥ 70% for all IPOs
- Listing performance: 100% for LISTED IPOs

### Issue Severity Levels

**P0 (Critical) - Fix Immediately:**
- Duplicate slugs (breaks routing)
- Data corruption
- Scraper crashes
- Application errors

**P1 (High) - Fix Before Production:**
- Missing critical fields where source has data
- Date ordering violations
- Negative values
- Cache not invalidating

**P2 (Medium) - Fix This Sprint:**
- Incomplete optional fields
- Minor UI issues
- Performance issues
- Coverage gaps

**P3 (Low) - Backlog:**
- Cosmetic issues
- Optimization opportunities
- Nice-to-have features

---

## Troubleshooting

### Query Timeout

If queries take too long:

```sql
-- Increase statement timeout
SET statement_timeout = '5min';
```

### Permission Denied

Ensure your PostgreSQL user has read access:

```sql
GRANT SELECT ON ALL TABLES IN SCHEMA public TO your_user;
```

### Extension Not Found

Install pg_trgm extension:

```sql
-- As superuser
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

---

## Post-Verification Steps

After running verification queries:

1. **Review Results:** Check all `.txt` files in `verification_results/`
2. **Document Issues:** Create issue report with severity levels
3. **Prioritize Fixes:** Group issues by P0, P1, P2, P3
4. **Re-run Scrapers:** For specific data gaps
5. **Validate Fixes:** Re-run verification queries after fixes
6. **Update Dashboard:** Track verification metrics over time

---

## Maintenance

These queries should be run:

- **After each scraper execution** (automated verification)
- **Before production deployment** (release validation)
- **Weekly** (data quality monitoring)
- **After schema changes** (migration validation)

---

## Contact

For questions or issues with these verification queries, refer to:
- comprehensive-scraping-plan.md (testing methodology)
- screen-table-database-field-mapping.md (field definitions)
- CLAUDE.md (project documentation)

---

**Last Updated:** 2025-01-18
**Version:** 1.0
**Compatibility:** PostgreSQL 16+
