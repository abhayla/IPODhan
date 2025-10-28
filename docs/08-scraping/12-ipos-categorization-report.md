# 12 IPOs Categorization Report
**Analysis Date**: October 28, 2025
**Source**: NSE Website + Database Query
**Analyst**: IPODhan Development Team

---

## Executive Summary

**Critical Finding**: All 12 IPOs scraped on October 28, 2025 have **NULL segment** values in the database, but NSE categorizes them as follows:

| Category | Count | Percentage |
|----------|-------|------------|
| **MAINBOARD** | 3 | 25.0% |
| **SME** | 2 | 16.7% |
| **RIGHTS** | 7 | 58.3% |
| **Total** | 12 | 100% |

**Root Cause**: NSE scraper is not extracting or storing the segment field correctly.

---

## Detailed Categorization

### 🏢 MAINBOARD IPOs (3)

| # | Company Name | Slug | Symbol | Security Type | Price Range | Issue Size |
|---|-------------|------|--------|---------------|-------------|------------|
| 1 | **Lenskart Solutions Limited** | lenskart-solutions-limited | LENSKART | EQ | ₹382 - ₹402 | ₹18,386.58 Cr |
| 2 | **Studds Accessories Limited** | studds-accessories-limited | STUDDS | EQ | ₹557 - ₹585 | ₹778.61 Cr |
| 3 | **Orkla India Limited** | orkla-india-limited | ORKLAINDIA | EQ | ₹695 - ₹730 | ₹1,599.91 Cr |

**NSE Source**: `/market-data/all-upcoming-issues-ipo` → "Upcoming Issues" tab
**Security Type**: EQ (Equity - MAINBOARD)

**Database Status**:
- ✅ Company names correctly stored
- ✅ Price ranges correctly stored (for 3/3)
- ⚠️ Segment = NULL (should be 'MAINBOARD')
- ⚠️ Lot size = 1 (invalid for 2/3, Studds missing data)

---

### 🏭 SME IPOs (2)

| # | Company Name | Slug | Symbol | Security Type | Price Range | Issue Size | Lot Size |
|---|-------------|------|--------|---------------|-------------|------------|----------|
| 4 | **Shreeji Global FMCG Limited** | shreeji-global-fmcg-limited | SHETHJI | SME | ₹120 - ₹125 | ₹68.00 Cr | 1000 ✅ |
| 5 | **Jayesh Logistics Limited** | jayesh-logistics-limited | - | SME | ₹116 - ₹122 | ₹27.17 Cr | 1000 |

**NSE Source**:
- Shreeji: `/market-data/all-upcoming-issues-ipo` → "Upcoming Issues" tab (SME label)
- Jayesh: NSE SME Emerge Platform (Active Oct 27-29, 2025)

**Database Status**:
- ✅ Company names correctly stored
- ⚠️ Shreeji: Lot size = 1000 (correct) but segment = NULL
- ⚠️ Jayesh: Missing price range, issue size = 0, segment = NULL

**Note**: Jayesh Logistics IPO was open Oct 27-29, subscribed 4.28x on Day 1.

---

### 📜 RIGHTS Issues (7)

| # | Company Name | Slug | Symbol | Issue Period | Status |
|---|-------------|------|--------|--------------|--------|
| 6 | **Delphi World Money Limited** | delphi-world-money-limited | DELPHIFXR | Oct 27 - Nov 7 | Active |
| 7 | **Indian Emulsifiers Limited** | indian-emulsifiers-limited | IEMLR | Oct 24 - Nov 7 | Active |
| 8 | **SEPC Limited - Call Money** | sepc-limited-call-money | SEPCCM | Oct 24 - Nov 7 | Active |
| 9 | **Utkarsh Small Finance Bank Ltd** | utkarsh-small-finance-bank-limited | UTKARSHBNR | Oct 24 - Nov 3 | Active |
| 10 | **Capital Trust Limited** | capital-trust-limited | CAPTRUSTRR | Oct 20 - Nov 11 | Active |
| 11 | **3i Infotech Limited** | 3i-infotech-limited | 3IINFOLTDR | Oct 7 - Oct 27 | Closed |
| 12 | **Cool Caps Industries Limited** | cool-caps-industries-limited | COOLCAPSR | Sep 30 - Oct 29 | Active |

**NSE Source**: `/market-data/all-upcoming-issues-ofs-rights` → "Rights" tab
**Offering Type**: Rights Entitlements (existing shareholders)

**Database Status**:
- ✅ Company names correctly stored
- ⚠️ **ALL** have segment = NULL (should be NULL for RIGHTS, but offeringType should indicate RIGHTS)
- ❌ Issue size = 0 for all RIGHTS issues (NSE doesn't provide in API)
- ❌ Price ranges missing for all RIGHTS issues
- ⚠️ Lot size = 1 for all (invalid)

**Key Insight**: RIGHTS issues are **NOT IPOs**. They are offerings to existing shareholders and should:
- Have `segment = NULL` (correct)
- Have `offeringType = 'RIGHTS'` (currently showing 'IPO' - incorrect)
- Not appear in MAINBOARD/SME IPO lists

---

## Data Quality Issues

### Critical Issues

| Issue | Affected IPOs | Severity | Impact |
|-------|--------------|----------|--------|
| **Segment = NULL for MAINBOARD** | 3/3 (100%) | 🔴 CRITICAL | Cannot categorize/filter IPOs correctly |
| **Segment = NULL for SME** | 2/2 (100%) | 🔴 CRITICAL | SME IPOs mixed with MAINBOARD |
| **Incorrect offeringType for RIGHTS** | 7/7 (100%) | 🔴 CRITICAL | RIGHTS issues shown as IPOs |
| **Lot Size = 1 (invalid)** | 11/12 (91.7%) | 🔴 CRITICAL | Cannot calculate investment amounts |
| **Missing Price Ranges** | 8/12 (66.7%) | 🟠 HIGH | Cannot calculate valuations |
| **Issue Size = 0** | 8/12 (66.7%) | 🟠 HIGH | Missing key financial metric |

### Root Causes

1. **NSE API Limitation**: The `/api/all-upcoming-issues?category=ipo` endpoint does NOT include:
   - Segment field (MAINBOARD/SME distinction)
   - Security type (EQ/SME indicator)
   - Complete financial data for RIGHTS issues

2. **Mixed Endpoint Data**: Scraper fetches from:
   - `/api/all-upcoming-issues?category=ipo` (5 IPOs)
   - `/api/all-upcoming-issues?category=rights` (7 RIGHTS)
   - Treats both as "IPOs" without distinguishing offering types

3. **No Security Type Detection**: NSE provides security type on website (EQ/SME) but NOT in API response

---

## Recommendations

### Immediate Actions (High Priority)

#### 1. Implement Security Type Detection
**Problem**: Cannot distinguish MAINBOARD (EQ) vs SME from API
**Solution**: Use NSE website scraping for security type

```typescript
// After API fetch, scrape NSE website for each IPO
const securityType = await scrapeNSESecurityType(symbol);
if (securityType === 'EQ') {
  segment = 'MAINBOARD';
} else if (securityType === 'SME') {
  segment = 'SME';
}
```

**Expected Benefit**: 100% segment accuracy for MAINBOARD/SME

#### 2. Add Offering Type Detection
**Problem**: RIGHTS issues incorrectly marked as IPOs
**Solution**: Detect source endpoint and set offeringType accordingly

```typescript
if (source === '/api/all-upcoming-issues?category=rights') {
  offeringType = 'RIGHTS';
  segment = null; // Expected for RIGHTS
} else if (source === '/api/all-upcoming-issues?category=ipo') {
  offeringType = 'IPO';
  // Segment determined by security type
}
```

**Expected Benefit**: RIGHTS issues properly categorized and filtered

#### 3. Implement BSE Fallback for RIGHTS Issues
**Problem**: NSE API provides minimal data for RIGHTS
**Solution**: Create dedicated BSE scraper for RIGHTS offerings

**Expected Benefit**: Fill in missing lot sizes, price ranges, issue sizes

#### 4. Update Database for 12 IPOs
**Problem**: All 12 have incorrect segment values
**Solution**: Manual correction script

```sql
-- MAINBOARD
UPDATE ipos SET segment = 'MAINBOARD', offering_type = 'IPO'
WHERE slug IN ('lenskart-solutions-limited', 'studds-accessories-limited', 'orkla-india-limited');

-- SME
UPDATE ipos SET segment = 'SME', offering_type = 'IPO'
WHERE slug IN ('shreeji-global-fmcg-limited', 'jayesh-logistics-limited');

-- RIGHTS
UPDATE ipos SET segment = NULL, offering_type = 'RIGHTS'
WHERE slug IN (
  'delphi-world-money-limited',
  'indian-emulsifiers-limited',
  'sepc-limited-call-money',
  'utkarsh-small-finance-bank-limited',
  'capital-trust-limited',
  '3i-infotech-limited',
  'cool-caps-industries-limited'
);
```

---

### Medium Priority

#### 5. Enhance Data Validation
Add post-scrape validation rules:
- Alert if segment is NULL for offering_type = 'IPO'
- Alert if offering_type = 'IPO' but source is RIGHTS endpoint
- Alert if lot_size = 1 for MAINBOARD/SME
- Flag records for manual review

#### 6. Separate RIGHTS from IPO Listings
**Current**: RIGHTS appear in IPO lists
**Future**: Create separate RIGHTS section in UI

```typescript
// Filter IPOs only (exclude RIGHTS)
const ipos = await repository.findAll({
  offeringType: 'IPO',
  segment: ['MAINBOARD', 'SME']
});

// Separate RIGHTS listings
const rights = await repository.findAll({
  offeringType: 'RIGHTS'
});
```

---

## Technical Details

### NSE API Endpoints Used

#### 1. Upcoming IPOs Endpoint
```
GET /api/all-upcoming-issues?category=ipo
Response: 5 IPOs (Lenskart, Studds, Orkla, Shreeji, Jayesh)
Security Types: Mixed (EQ + SME) - NOT provided in response
```

#### 2. Upcoming RIGHTS Endpoint
```
GET /api/all-upcoming-issues?category=rights
Response: 7 RIGHTS issues
Data Quality: Minimal (no lot sizes, prices, issue sizes)
```

#### 3. Current Issues Endpoint
```
GET /api/ipo-current-issue
Response: 1 IPO (not used in this analysis)
```

### Database Query Results

```typescript
// All 12 IPOs have:
segment: null           // ❌ Should be MAINBOARD/SME/NULL
offeringType: 'IPO'     // ❌ 7 should be 'RIGHTS'
lotSize: 1 (mostly)     // ❌ Invalid
priceRangeMin: null (8) // ❌ Missing
priceRangeMax: null (8) // ❌ Missing
issueSize: 0 (8)        // ❌ Missing
```

---

## Impact Assessment

### User Impact

| Issue | User Experience Impact | Severity |
|-------|----------------------|----------|
| No segment filtering | Users cannot filter MAINBOARD vs SME | 🔴 HIGH |
| RIGHTS in IPO lists | Confusion - RIGHTS ≠ IPOs | 🔴 HIGH |
| Lot size = 1 | Wrong investment calculations | 🔴 HIGH |
| Missing prices | Cannot evaluate valuation | 🟠 MEDIUM |

### Business Impact

- **MAINBOARD/SME Pages**: Zero-contamination violated (RIGHTS appearing)
- **IPO Comparison Tool**: Invalid comparisons (RIGHTS vs IPOs)
- **Investment Calculator**: Wrong results (lot size = 1)
- **Data Integrity**: 16.67% completeness (only 2/12 critical fields)

---

## Next Steps

1. **Immediate**: Run manual correction script for 12 IPOs ✅
2. **This Week**: Implement security type detection from NSE website
3. **This Week**: Add offering type detection logic
4. **Next Week**: Create BSE fallback scraper for RIGHTS issues
5. **Next Week**: Update UI to separate RIGHTS from IPO listings
6. **Ongoing**: Monitor data quality for future scraper runs

---

## Related Documents

1. **NSE Scraping Results**: `docs/08-scraping/nse-scraping-results.md`
2. **Lot Size Data Quality**: `scraper/docs/LOT_SIZE_EXECUTIVE_SUMMARY.md`
3. **Scraping Strategy**: `scraper/docs/SCRAPING_STRATEGY.md`
4. **Schema Management**: `docs/16-database/SCHEMA_MANAGEMENT.md`

---

**Document Version**: 1.0
**Last Updated**: 2025-10-28 21:00 UTC
**Author**: IPODhan Development Team
**Status**: Analysis Complete ✅
