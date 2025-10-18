# Phase 6: Issue Resolution - Execution Plan
**Started**: October 17, 2025
**Target Completion**: Within 48 hours
**Approach**: Fix foundational issues first, then scraper-specific problems

---

## Execution Strategy

### Order of Operations (Strategic)

1. **Fix Scraper Logging First** (P0-4) - 1-2 hours
   - Why: Enables debugging of all other scraper issues
   - Impact: Can see detailed logs for NSE, BSE, Chittorgarh failures

2. **Fix Schema Mismatches** (P0-1) - 2-4 hours
   - Why: Enables accurate validation and monitoring
   - Impact: Can verify fixes are working

3. **Fix Chittorgarh GMP Extraction** (P0-2) - 8-16 hours
   - Why: Simpler than NSE (API-based, no auth issues)
   - Impact: Restores GMP feature

4. **Fix NSE Scraper** (P0-3) - 4-8 hours
   - Why: Most complex (API auth + browser fallback)
   - Impact: Restores subscription tracking

5. **Fix BSE Scraper** (P0-3c) - 4-8 hours
   - Why: Similar to NSE (browser scraping)
   - Impact: Restores SME data updates

6. **Re-scrape Never-Scraped IPOs** (P1-1) - 4-8 hours
   - Why: After scrapers are fixed
   - Impact: Cleans up stale data

**Total Estimated Time**: 24-46 hours (1-2 days)

---

## Task 1: Fix Scraper Logging (P0-4)

### Issue
- Field mismatch: `scraper_name` vs `source`
- No scraper logs being captured
- Cannot diagnose scraper failures

### Root Cause Analysis Needed
1. Check `scraper/src/services/logger.ts` or similar
2. Find where scraper logs are inserted
3. Verify field name used

### Fix Plan
1. Search for scraper log insertion code
2. Update field name from `scraper_name` to `source`
3. Test with manual scraper run
4. Verify logs appear in database

### Verification
```sql
SELECT source, status, records_processed, created_at
FROM scraper_logs
ORDER BY created_at DESC
LIMIT 10;
```

**Expected**: See recent scraper runs logged

---

## Task 2: Fix Schema Mismatches (P0-1)

### Issues
50+ field name mismatches between validation queries and actual schema:

| Validation Query Field | Actual Schema Field | Location |
|----------------------|-------------------|----------|
| `qib_subscription` | `subscription_qib` | ipos table |
| `nii_subscription` | `subscription_hni` | ipos table |
| `retail_subscription` | `subscription_retail` | ipos table |
| `total_subscription` | `subscription_total` | ipos table |
| `description` | `company_description` | ipos table |
| `latest_gmp` | `gmp_price` | ipos table |
| `listing_gain_percent` | `listing_gain_percentage` | ipos table |
| `recorded_at` | `timestamp` | subscriptions/gmp_records |
| `scraper_name` | `source` | scraper_logs |
| `document_type` | `type` | documents |

### Fix Plan
1. Get actual schema from database
2. Update all validation query files
3. Re-run verification queries
4. Document field naming standard

### Verification
- All validation queries should execute without "column does not exist" errors

---

## Task 3: Fix Chittorgarh GMP Extraction (P0-2)

### Issue
- Chittorgarh scraper processed 303 IPOs successfully
- BUT created **0 GMP records** in `gmp_records` table
- GMP feature completely non-functional

### Investigation Needed
1. Check if Chittorgarh scraper extracts GMP from API response
2. Check if GMP data is being inserted into `gmp_records` table
3. Verify GMP data transformer/mapper

### Files to Examine
- `scraper/src/scrapers/chittorgarh-scraper.ts`
- `scraper/src/transformers/chittorgarh-transformer.ts`
- `scraper/src/services/data-persister.ts` (GMP insertion logic)

### Likely Root Cause
- GMP data extraction commented out or missing
- GMP records insertion code not implemented
- Field mapping issue

### Fix Plan
1. Examine Chittorgarh API response for GMP data
2. Add/fix GMP extraction logic
3. Implement GMP records insertion
4. Test with sample IPO

### Verification
```sql
SELECT COUNT(*) FROM gmp_records;
-- Expected: > 0 (should have records after fix)

SELECT i.company_name, g.gmp, g.timestamp
FROM gmp_records g
JOIN ipos i ON g.ipo_id = i.id
ORDER BY g.timestamp DESC
LIMIT 10;
-- Expected: Recent GMP records
```

---

## Task 4: Fix NSE Scraper (P0-3)

### Issues
1. NSE API returned 401 Unauthorized
2. Browser fallback found 0 IPOs
3. No subscription data created

### Investigation Needed
1. Check NSE API authentication mechanism
2. Check if API endpoints changed
3. Verify browser scraping selectors
4. Check subscription data extraction logic

### Files to Examine
- `scraper/src/scrapers/nse-scraper.ts`
- `scraper/src/scrapers/nse-api-client.ts`
- `scraper/src/transformers/nse-transformer.ts`

### Sub-Tasks

#### 4.1: Fix NSE API Authentication
- Check if API requires new headers/cookies
- Update session management
- Test API endpoint directly

#### 4.2: Fix Browser Scraping Fallback
- Check NSE website HTML structure
- Update selectors for IPO listings
- Update selectors for subscription data
- Test on sample OPEN IPO page

#### 4.3: Fix Subscription Data Extraction
- Verify subscription data transformer
- Verify subscription records insertion
- Test end-to-end flow

### Verification
```sql
SELECT COUNT(*) FROM subscriptions;
-- Expected: > 2 (should have records for OPEN IPOs)

SELECT i.company_name, s.qib_subscription, s.nii_subscription, s.retail_subscription, s.timestamp
FROM subscriptions s
JOIN ipos i ON s.ipo_id = i.id
ORDER BY s.timestamp DESC
LIMIT 10;
-- Expected: Recent subscription records
```

---

## Task 5: Fix BSE Scraper (P0-3c)

### Issue
- BSE scraper found 0 detail page URLs
- No SME IPOs being processed

### Investigation Needed
1. Check BSE website structure
2. Verify detail page URL extraction selectors
3. Check if BSE changed their listing page

### Files to Examine
- `scraper/src/scrapers/bse-scraper.ts`
- `scraper/src/transformers/bse-transformer.ts`

### Fix Plan
1. Visit BSE IPO page manually
2. Inspect HTML structure
3. Update selectors for:
   - IPO list table
   - Detail page links
   - IPO data fields
4. Test with sample SME IPO

### Verification
```sql
SELECT COUNT(*) FROM ipos WHERE category = 'SME' AND last_scraped_at > NOW() - INTERVAL '1 hour';
-- Expected: > 0 (should have recently scraped SME IPOs)
```

---

## Task 6: Re-scrape Never-Scraped IPOs (P1-1)

### Issue
- 150 IPOs (31% of database) have NULL last_scraped_at
- All created on 2025-10-17 05:44

### Investigation Needed
1. Identify which IPOs are seed data vs real
2. Determine which scraper should handle each IPO

### Fix Plan
1. Query never-scraped IPOs with their slugs
2. Create targeted scraper run for specific IPOs
3. Run scrapers sequentially
4. Verify all IPOs now have last_scraped_at

### Verification
```sql
SELECT COUNT(*) FROM ipos WHERE last_scraped_at IS NULL;
-- Expected: < 50 (under 10%)
```

---

## Success Criteria

### After All Fixes

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| NSE Scraper Success Rate | > 90% | 0% | ❌ |
| BSE Scraper Success Rate | > 90% | 0% | ❌ |
| Chittorgarh GMP Records | > 400 | 0 | ❌ |
| Subscription Records (OPEN IPOs) | > 33 (90% of 37) | 2 | ❌ |
| Scraper Logs Captured | 100% | 0% | ❌ |
| Schema Validation Success Rate | > 95% | 40% | ❌ |
| Never-Scraped IPOs | < 10% | 31% | ❌ |

### Final Verification Checklist
- [ ] All scrapers execute without errors
- [ ] Subscription data populating for OPEN IPOs
- [ ] GMP data populating for eligible IPOs
- [ ] Scraper logs being captured
- [ ] Validation queries execute without schema errors
- [ ] < 10% IPOs never scraped
- [ ] Re-run comprehensive test (Phases 2-3)
- [ ] All P0 issues resolved

---

## Rollback Plan (If Needed)

If any fix breaks existing functionality:

```bash
# Restore from backup
psql "postgresql://postgres:Papa3Monu%401234@103.118.16.189:5432/ipodhan" < database/backups/backup_pre_scrape_20251017_212423.sql

# Revert code changes
git checkout scraper/src/scrapers/

# Clear cache
redis-cli FLUSHALL
```

---

## Progress Tracking

### Task Completion Status

- [ ] P0-4: Fix Scraper Logging (1-2 hours)
- [ ] P0-1: Fix Schema Mismatches (2-4 hours)
- [ ] P0-2: Fix Chittorgarh GMP (8-16 hours)
- [ ] P0-3: Fix NSE Scraper (4-8 hours)
- [ ] P0-3c: Fix BSE Scraper (4-8 hours)
- [ ] P1-1: Re-scrape Never-Scraped IPOs (4-8 hours)
- [ ] Final: Re-run Comprehensive Test (3-4 hours)

**Total Progress**: 0/7 tasks complete

---

**Next Action**: Start with Task 1 (Fix Scraper Logging)
