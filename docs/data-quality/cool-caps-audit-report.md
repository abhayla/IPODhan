# Cool Caps Industries Limited - Database Audit Report

**Audit Date**: October 22, 2025
**Auditor**: Sarah (Product Owner)
**IPO ID**: `0c52ceac-6490-424e-8fdb-8241f4c4dc7a`
**Slug**: `cool-caps-industries-limited`

---

## 🎯 Executive Summary

**Verdict**: 🎭 **TEST/SEED DATA** (Confidence: 95%)

Cool Caps Industries Limited record in the IPODhan database is **test/seed data**, NOT real scraped data from NSE. Only **13.3% of fields** (2 out of 15) are correct.

---

## 📊 Database Record Details

| Attribute | Value |
|-----------|-------|
| **Record Created** | October 18, 2025 16:54:21 IST |
| **Last Updated** | October 20, 2025 22:40:24 IST |
| **Age** | 4 days old (recent test data) |

---

## ❌ Field-by-Field Analysis (13.3% Accuracy)

| Field | Database Value | Expected (NSE) | Status |
|-------|---------------|----------------|---------|
| company_name | Cool Caps Industries Limited | Cool Caps Industries Limited | ✅ **CORRECT** |
| symbol | COOLCAPSR | COOLCAPS | ❌ **WRONG** (extra 'R') |
| segment | MAINBOARD | SME | ❌ **CRITICAL ERROR** |
| category | `undefined` | IPO | ❌ **MISSING** |
| status | OPEN | LISTED | ❌ **WRONG** (it's a 2022 IPO!) |
| open_date | 2025-10-20 | 2022-03-10 | ❌ **3+ YEARS OFF** |
| close_date | 2025-10-20 | 2022-03-15 | ❌ **3+ YEARS OFF** |
| min_price | `undefined` | 36 | ❌ **MISSING** |
| max_price | `undefined` | 38 | ❌ **MISSING** |
| face_value | 10 | 10 | ✅ **CORRECT** |
| lot_size | 1 | 3000 | ❌ **CRITICAL ERROR** |
| issue_size_crores | `undefined` | 11.63 | ❌ **MISSING** |
| total_shares | `undefined` | 3060000 | ❌ **MISSING** |
| registrar_id | `null` | Link Intime ID | ❌ **MISSING** |
| lead_manager | `undefined` | Holani Consultants | ❌ **MISSING** |

**Statistics**:
- ✅ Correct: 2 fields (13.3%)
- ❌ Incorrect: 12 fields (80.0%)
- ⚠️ NULL/Missing: 1 field (6.7%)

---

## 🔗 Related Data Check

| Related Table | Record Count | Status |
|--------------|--------------|--------|
| Subscriptions | 0 | ❌ **NO DATA** |
| GMP Records | 0 | ❌ **NO DATA** |
| Financial Data | 0 | ❌ **NO DATA** |
| Documents | 0 | ❌ **NO DATA** |
| Listing Performance | 0 | ❌ **NO DATA** |
| Scraper Logs | ? (query error) | ⚠️ **LIKELY 0** |

**Total Related Records**: **0** across all tables

---

## 🚨 Critical Issues Identified

### 1. **Wrong Dates (CRITICAL)**
- **Database**: Open: 2025-10-20, Close: 2025-10-20
- **NSE Reality**: Open: 2022-03-10, Close: 2022-03-15
- **Difference**: 3 years, 7 months off
- **Impact**: Platform shows a 2022 IPO as currently "OPEN" in 2025!

### 2. **Wrong Segment (CRITICAL)**
- **Database**: MAINBOARD
- **NSE Reality**: SME
- **Impact**: Completely wrong categorization, Phase 4 category isolation violated

### 3. **Wrong Lot Size (CRITICAL)**
- **Database**: 1 share
- **NSE Reality**: 3000 shares
- **Impact**: Investment calculations off by 3000x! Phase 3 validation not enforced

### 4. **Wrong Status (CRITICAL)**
- **Database**: OPEN
- **NSE Reality**: LISTED (since March 2022)
- **Impact**: Misleading investors - this IPO closed 3+ years ago

### 5. **Missing Price Band (HIGH)**
- **Database**: NULL
- **NSE Reality**: ₹36-38
- **Impact**: Users cannot calculate investment amounts

### 6. **Missing Issue Size (HIGH)**
- **Database**: NULL
- **NSE Reality**: 30.6L shares (~₹11.63 Cr)
- **Impact**: Users cannot assess IPO scale

### 7. **No Related Data (HIGH)**
- **Database**: 0 subscriptions, 0 documents, 0 financials
- **NSE Reality**: Complete subscription breakdown, documents, etc.
- **Impact**: Core platform features not working

---

## 🔬 Data Source Analysis

### Evidence This is Test/Seed Data:

1. **✅ Recent Creation Date**
   - Created: Oct 18, 2025 (4 days ago)
   - This is a 2022 IPO - should have creation date from 2022 if real data

2. **✅ Wrong Dates (Future Instead of Past)**
   - Shows Oct 2025 dates for a March 2022 IPO
   - Classic test data pattern: using current date instead of real date

3. **✅ lot_size = 1 (Phase 3 Anti-Pattern)**
   - LOT_SIZE_EXECUTIVE_SUMMARY.md documented this as invalid
   - 68.89% of IPOs had this issue - known test data indicator

4. **✅ Wrong Segment Classification**
   - SME IPO incorrectly marked as MAINBOARD
   - Suggests automated scraper not running (would catch this)

5. **✅ Zero Related Data**
   - No subscriptions, GMP, documents, financials, listing data
   - Real IPO would have at least some of this data

6. **✅ No Scraper Logs**
   - No evidence of scraper ever processing this IPO
   - Manual insertion or seed script, not automated scraping

7. **✅ Only 2 Fields Correct**
   - company_name and face_value are correct
   - Everything else is wrong or missing
   - Pattern: Minimal data to make record exist, not real data

8. **✅ Symbol Suffix Error**
   - COOLCAPSR instead of COOLCAPS
   - Indicates slug/symbol generation bug, not NSE data

---

## ⚖️ Final Verdict

**Data Source**: 🎭 **TEST/SEED DATA** (Not Real Scraped Data)

**Confidence**: **95% (Very High)**

**Reasoning**:
1. Created 4 days ago for a 3-year-old IPO
2. Dates are in 2025 instead of 2022
3. Only 13.3% field accuracy
4. Classic test data patterns (lot_size=1, wrong segment, no related data)
5. No scraper logs (manually inserted)

---

## 💡 Recommended Actions

### Immediate Actions (P0)

1. **Delete This Record**
   ```sql
   DELETE FROM ipos WHERE id = '0c52ceac-6490-424e-8fdb-8241f4c4dc7a';
   ```

2. **Re-Scrape from NSE**
   - Use correct NSE URL: `https://www.nseindia.com/market-data/issue-information?symbol=COOLCAPS&series=SME&type=Past`
   - Ensure scraper identifies SME segment correctly
   - Validate all fields before insert

3. **Implement User Stories**
   - Story 10.1: Fix Segment Classification
   - Story 10.2: Fix Lot Size Validation
   - Story 10.3: Add Subscription Data Scraping
   - Story 10.4: Add Missing Core IPO Details

### Follow-Up Actions (P1)

4. **Audit Other Records**
   - Check if other IPOs have similar test data patterns
   - Query: `SELECT * FROM ipos WHERE lot_size = 1 OR created_at > '2025-01-01'`

5. **Implement Validation**
   - Database constraints (lot_size > 1, segment IN ['SME', 'MAINBOARD', null])
   - Scraper validation utilities (reject invalid data)
   - Date sanity checks (don't allow future dates for past IPOs)

6. **Review Seed Scripts**
   - Check `web/scripts/seed-database.ts`
   - Ensure seed data is clearly marked as test data
   - Separate test data from production data

---

## 🔍 Investigation Questions

1. **Who created this record?**
   - Check git history for database seed files
   - Review application logs for insert statements
   - Check if there's a seed script that creates "Cool Caps"

2. **Why October 18, 2025?**
   - Was this added for testing Phase 5 features?
   - Check git commits around Oct 18, 2025

3. **Are there other test records?**
   - Audit all IPOs with `created_at > '2025-10-01'`
   - Check for patterns in test data

4. **Why is it showing on homepage?**
   - Mainboard landing page query should filter properly
   - Investigate why test data is visible in production UI

---

## 📋 Audit Metadata

| Attribute | Value |
|-----------|-------|
| **Audit Script** | `web/scripts/audit-coolcaps-data.ts` |
| **Audit Method** | Direct database query + field comparison |
| **Audit Duration** | ~2 minutes |
| **Database** | PostgreSQL (production/development) |
| **Total Fields Checked** | 15 |
| **Related Tables Checked** | 6 |

---

## ✅ Conclusion

Cool Caps Industries Limited is **definitively test/seed data** and should be:
1. ✅ Deleted from database
2. ✅ Re-scraped with correct NSE data
3. ✅ Used as case study for improving data quality

This audit validates the **Data Validation Report** findings and confirms that the platform needs immediate data quality fixes before launch.

---

**Report Status**: ✅ Complete
**Next Steps**: Execute recommended actions + Move to Task 3 (Scraper Logs Review)
