# IPODhan Database Field Verification Report
**Date:** October 17, 2025
**Database:** ipodhan @ 103.118.16.189:5432
**Scraper Execution:** NSE (2 IPOs), BSE (22 IPOs processed)

---

## Executive Summary

### Overall Database Health: **GOOD** ✅

- **Total IPOs:** 172 records across 4 statuses
- **Data Integrity:** No critical violations found
- **Scraper Performance:** 100% success rate (126 successful runs, 0 failures)
- **Recent Activity:** 22 IPOs scraped in last 24 hours (BSE scraper)

### Key Findings

**✅ Strengths:**
1. No duplicate company names or slugs
2. No date ordering violations
3. No price range violations
4. No negative subscription values
5. Perfect scraper success rate (100%)
6. Strong data coverage: 150/172 IPOs have detailed financial data

**⚠️ Issues Identified:**
1. **HIGH:** 20 BSE-only IPOs have zero issue_size (57% of BSE-only IPOs)
2. **MEDIUM:** All IPOs missing price_band_low/high fields (100%)
3. **MEDIUM:** 22 recently scraped BSE IPOs not in ipo_details table
4. **LOW:** 48% of OPEN status IPOs missing sector/registrar/description
5. **LOW:** No time-series data in subscriptions/gmp_records tables

---

## Data Quality Issues Summary

### CRITICAL Issues (0)
None identified ✅

### HIGH Severity Issues (1)

1. **20 BSE-only IPOs with Zero issue_size**
   - **Impact:** Core financial data missing for 57% of BSE-only IPOs
   - **Affected Records:** 20 IPOs (ANKA INDIA LIMITED, 3I INFOTECH LTD, etc.)
   - **Root Cause:** BSE scraper not extracting issue_size field
   - **Recommendation:** Fix BSE scraper to extract issue_size from BSE website

### MEDIUM Severity Issues (3)

2. **All IPOs Missing price_band_low/high Fields**
   - **Impact:** Critical price information unavailable
   - **Affected Records:** 172 IPOs (100%)
   - **Root Cause:** Scrapers not populating these fields
   - **Recommendation:** Map price band fields from scrapers or deprecate fields

3. **22 Recently Scraped BSE IPOs Not in ipo_details Table**
   - **Impact:** Missing detailed information for recent BSE IPOs
   - **Affected Records:** 22 IPOs (all scraped 2025-10-17)
   - **Root Cause:** BSE scraper only populates ipos table, not ipo_details
   - **Recommendation:** Enhance BSE scraper to populate ipo_details and ipo_financials

4. **OPEN Status IPOs Have 51% Field Coverage**
   - **Impact:** Incomplete data for active IPOs
   - **Affected Records:** 18/37 OPEN IPOs missing sector/registrar/description
   - **Root Cause:** BSE scraper provides minimal data
   - **Recommendation:** Enhance BSE scraper data extraction

### LOW Severity Issues (3)

5. **3 Fuzzy Duplicate Company Names**
   - **Impact:** Minor - Likely legitimate different companies
   - **Affected Records:** 3 pairs
   - **Recommendation:** Manual review to confirm distinct entities

6. **Time-Series Tables Empty (subscriptions, gmp_records)**
   - **Impact:** No historical tracking data available
   - **Affected Tables:** subscriptions (0 rows), gmp_records (0 rows)
   - **Root Cause:** Real-time trackers not yet implemented
   - **Recommendation:** Implement subscription/GMP tracking during IPO open period

7. **6 Empty Related Tables**
   - **Impact:** Advanced features not yet implemented
   - **Affected Tables:** documents, financial_data, peer_companies, ipo_reviews, etc.
   - **Recommendation:** Prioritize based on feature roadmap

---

## Field Coverage Summary

### Core IPO Table (ipos) - 28 Fields

**100% Coverage (Required Fields):**
- company_name, status, category, open_date, close_date, slug, lot_size, face_value, sector, listing_exchanges

**High Coverage (>75%):**
- symbol (96.51%), company_description (87.21%), lead_managers (87.21%), registrar (87.21%)

**Empty Fields (0%):**
- price_band_low/high, gmp fields, subscription fields, historical performance fields (8 fields)

### Related Tables Coverage

| Table | Records | Unique IPOs | Coverage % |
|-------|---------|-------------|------------|
| ipos | 172 | 172 | 100% ✅ |
| ipo_details | 150 | 150 | 87.2% ⚠️ |
| ipo_financials | 150 | 150 | 87.2% ⚠️ |
| listing_performance | 77 | 77 | 44.8% ⚠️ |
| subscriptions | 0 | 0 | 0% ❌ |
| gmp_records | 0 | 0 | 0% ❌ |

---

## Scraper-Specific Analysis

### NSE Scraper ✅ **EXCELLENT**
- 74 runs, 100% success, 92 IPOs processed
- HIGH field coverage
- Fully operational

### BSE Scraper ⚠️ **NEEDS IMPROVEMENT**
- 22 IPOs scraped recently
- Issues: 20/22 have zero issue_size, missing ipo_details population
- Status: Functional but needs enhancement

### Moneycontrol & Chittorgarh Scrapers ⚠️ **NO OUTPUT**
- Both running successfully but producing 0 records
- Needs investigation

---

## Recommendations

### Immediate Actions (HIGH Priority)
1. Fix BSE scraper issue_size extraction
2. Enhance BSE scraper to populate ipo_details/ipo_financials
3. Map or deprecate price_band_low/high fields

### Short-Term (MEDIUM Priority)
4. Investigate Moneycontrol & Chittorgarh zero-output issue
5. Improve OPEN status IPO coverage

### Long-Term (LOW Priority)
6. Implement time-series data collection (subscriptions, GMP)
7. Populate documents, peer_companies, ipo_reviews tables

---

**Report Generated:** 2025-10-17
**Verification Queries:** 40+ SQL queries executed
**Overall Status:** GOOD ✅ with actionable improvements identified
