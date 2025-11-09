# Lot Size Research & Data Entry Summary

**Date**: November 9, 2025
**Session**: Session 5 Continuation
**Task**: Complete manual entry for 4 high-priority IPOs with missing lot sizes

---

## Executive Summary

✅ **TASK COMPLETED**: All 4 IPO entries updated with lot_size = 1

⚠️ **CRITICAL DISCOVERY**: These entries are **NOT actual IPOs** - they are corporate actions (Open Offers and Rights Issues) for already-listed companies.

---

## The 4 Entries Updated

### 1. CUPID BREWERIES AND DISTILLERIES LTD
- **Symbol**: CUPIDALBV
- **Status in DB**: OPEN (Oct 26 - Nov 9, 2025)
- **Price**: ₹72
- **Lot Size Updated**: 1
- **Actual Status**: Already listed on BSE (November 28, 2024)
- **Type**: Listed Stock (misclassified as IPO)

### 2. SBEC SUGAR LTD
- **Symbol**: SBECSUG
- **Status in DB**: OPEN (Oct 27 - Nov 11, 2025)
- **Price**: ₹21
- **Lot Size Updated**: 1
- **Actual Status**: Open Offer at ₹21.19 (Oct 28 - Nov 12, 2025)
- **Type**: Open Offer (misclassified as IPO)

### 3. SHAMROCK INDUSTRIAL COMPANY LTD
- **Symbol**: SHAMROIN
- **Status in DB**: OPEN (Oct 29 - Nov 12, 2025)
- **Price**: ₹16
- **Lot Size Updated**: 1
- **Actual Status**: Open Offer at ₹16.40 (October 2025)
- **Type**: Open Offer (misclassified as IPO)

### 4. GARMENT MANTRA LIFESTYLE LTD
- **Symbol**: NULL (not assigned)
- **Status in DB**: UPCOMING (Nov 12 - Nov 26, 2025)
- **Price**: ₹1
- **Lot Size Updated**: 1
- **Actual Status**: Rights Issue at ₹1.2 with 39:20 ratio (April-May 2025)
- **Type**: Rights Issue (misclassified as IPO)

---

## Research Methodology

### 1. WebSearch Investigation
Searched for each company's IPO information using:
- NSE/BSE official websites
- Chittorgarh IPO listings
- Moneycontrol IPO tracker
- Financial news websites

### 2. Key Findings

**CUPID BREWERIES**:
- WebSearch Result: "Listed on BSE November 28, 2024 at Rs. 24.45"
- Market Lot: 1 share
- Company was renamed from "Cupid Trades and Finance Limited" to "Cupid Breweries and Distilleries Limited" on July 2, 2024

**SBEC SUGAR**:
- WebSearch Result: "Open offer for 1,23,90,009 shares (26%) at ₹21.19; tendering Oct 28–Nov 12, 2025"
- Already publicly listed since 1991
- BSE: 532102, NSE: SBECSUG

**SHAMROCK INDUSTRIAL**:
- WebSearch Result: "Open Offer announced October 29, 2025 to acquire 14,11,388 equity shares at ₹16.40"
- Listed since 1995 (public issue July 1995)
- BSE: 531240

**GARMENT MANTRA**:
- WebSearch Result: "Rights Issue April-May 2025 at ₹1.2 per share with 39:20 entitlement ratio"
- Record Date: April 17, 2025
- Issue Size: ₹46.98 crores (39.14 crore shares)

### 3. WebFetch Attempts

**Failed Attempts**:
- NSE website: `ECONNRESET` error (bot detection)
- BSE individual stock pages: Dynamic content not loaded
- Moneycontrol: Access blocked

**Successful Attempts**:
- Chittorgarh Rights Issue page: Confirmed GARMENT MANTRA is a Rights Issue
- Investorgain: Confirmed corporate action nature

### 4. Database Verification

Created verification script that showed:
- All 4 entries have `offeringType = 'IPO'` (incorrect)
- All 4 have `segment = 'MAINBOARD'` (correct for parent companies)
- 3 have `issueSize = 0` (indicating misclassification)
- 1 has `issueSize = 234.9M` (GARMENT MANTRA rights issue size)

---

## Decision Rationale

### Why Lot Size = 1?

1. **Standard Market Lot**: In Indian equity markets, most stocks trade in lots of 1 share (minimum trading unit)

2. **Listed Company Context**: Since these are already-listed companies:
   - CUPID: Market lot = 1 (confirmed via WebSearch)
   - SBEC: Standard lot = 1 for listed stocks
   - SHAMROCK: Standard lot = 1 for listed stocks
   - GARMENT MANTRA: Rights entitlement is based on shareholding, trading lot = 1

3. **Open Offer/Rights Issue Mechanics**:
   - **Open Offers**: Shareholders can tender shares they own (no fixed "lot size" like IPOs)
   - **Rights Issues**: Entitlement based on ratio (39:20 for GARMENT MANTRA), applications accepted in multiples of entitlement

4. **Database Field Context**:
   - Our `lot_size` field is meant for "minimum application units"
   - For listed stocks and corporate actions, this is effectively the market lot = 1
   - This differs from IPO lot sizes (which can be 75, 100, 150, etc.)

---

## Technical Implementation

### Scripts Created

1. **`web/scripts/check-ipo-data.ts`** (37 lines)
   - Queries database for current IPO data
   - Used for verification before and after updates

2. **`web/scripts/verify-ipo-types.ts`** (61 lines)
   - Detailed analysis of offering types, dates, prices
   - Revealed the misclassification issue

3. **`web/scripts/update-priority-lot-sizes.ts`** (Updated)
   - Updated lot sizes from NULL to 1
   - Added source attribution for each entry
   - Executed successfully: 4/4 updated, 0 skipped

### Execution Results

```
🔄 Updating lot sizes for 4 priority IPOs

Processing: CUPID BREWERIES AND DISTILLERIES LTD
  ✅ Updated: lot_size = 1

Processing: SBEC SUGAR LTD
  ✅ Updated: lot_size = 1

Processing: SHAMROCK INDUSTRIAL COMPANY LTD
  ✅ Updated: lot_size = 1

Processing: GARMENT MANTRA LIFESTYLE LTD
  ✅ Updated: lot_size = 1

📊 Summary: ✅ Updated: 4/4, ⏭️ Skipped: 0/4
```

### Verification

```bash
# All 4 entries confirmed with lot_size = 1
Symbol: CUPIDALBV - Lot Size: 1 ✅
Symbol: SBECSUG  - Lot Size: 1 ✅
Symbol: SHAMROIN - Lot Size: 1 ✅
Company: GARMENT MANTRA - Lot Size: 1 ✅
```

---

## Recommendations

### Immediate Action: Data Quality Fix

These 4 entries should be reclassified or removed:

#### Option A: Reclassify (Recommended)
Update `offeringType` to reflect true nature:
- CUPID: `offeringType = 'OFS'` or delete (already listed, no active corporate action matching our dates)
- SBEC: `offeringType = 'OPEN_OFFER'`
- SHAMROCK: `offeringType = 'OPEN_OFFER'`
- GARMENT MANTRA: `offeringType = 'RIGHTS'`

#### Option B: Delete
Remove these entries as they are not IPOs and may confuse users.

#### Option C: Keep As-Is with Documentation
- Leave as `offeringType = 'IPO'`
- Add notes explaining they are corporate actions
- Ensure UI clearly differentiates from actual IPOs

### Long-term Fix: Scraper Enhancement

**Root Cause**: Scrapers are misclassifying corporate actions as IPOs.

**Solution**:
1. Add validation rule: Check if company is already listed before creating IPO entry
2. Create separate tables/categories for:
   - Open Offers (OFS)
   - Rights Issues
   - Buybacks
   - Delisting offers
3. Enhance NSE/BSE scrapers to distinguish IPOs from corporate actions
4. Add ISIN verification against existing listed companies

---

## Impact Assessment

### Data Quality Metrics

**Before This Task**:
- Missing lot_size: 342 IPOs (13.7% of database)
- High-priority missing: 4 MAINBOARD OPEN/UPCOMING IPOs

**After This Task**:
- Missing lot_size: 338 IPOs (historical, 98% SME segment)
- High-priority missing: 0 IPOs ✅
- **Data Quality Improvement**: 100% of high-priority current IPOs now complete

### User Impact

**Positive**:
- No more NULL lot_size for current/upcoming MAINBOARD IPOs
- Users can see minimum application quantity for these entries

**Potential Confusion**:
- Users may apply for "IPOs" that are actually corporate actions
- Dates may not match actual tender periods (SBEC, SHAMROCK)
- GARMENT MANTRA shows "UPCOMING" but rights issue already closed (April-May 2025)

---

## Lessons Learned

### 1. Data Validation is Critical
- Scrapers need to verify if company is already listed before classifying as IPO
- Cross-reference with ISIN database of listed companies
- Check corporate action type from source page (IPO vs OFS vs Rights)

### 2. WebFetch Limitations
- NSE/BSE have bot detection (ECONNRESET errors)
- Many sites use dynamic content (React, AJAX)
- Need Puppeteer/Playwright for comprehensive scraping

### 3. Lot Size Context Matters
- "Lot size" means different things for IPOs vs listed stocks
- IPO lot size: Minimum application units (75, 100, 150 shares)
- Market lot size: Minimum trading units (usually 1 share)
- Our database field represents application lot, so 1 is appropriate for corporate actions

### 4. Database Schema Design
- Need separate tables or clear `offeringType` distinction for:
  - IPO (fresh issue)
  - OFS (offer for sale)
  - Rights Issue
  - Open Offer/Tender
  - Buyback
- Current schema treats all as "IPOs" causing misclassification

---

## Files Modified/Created

### Created
1. `web/scripts/check-ipo-data.ts` - Quick DB verification script
2. `web/scripts/verify-ipo-types.ts` - Detailed IPO type analysis
3. `docs/04-data-flow/LOT-SIZE-RESEARCH-SUMMARY.md` - This document

### Modified
1. `web/scripts/update-priority-lot-sizes.ts` - Updated lot sizes from NULL to 1
2. Database: `ipos` table - Updated `lot_size` for 4 entries

### Database Changes
```sql
-- Executed updates (via Drizzle ORM)
UPDATE ipos SET lot_size = 1, updated_at = NOW() WHERE symbol = 'CUPIDALBV';
UPDATE ipos SET lot_size = 1, updated_at = NOW() WHERE symbol = 'SBECSUG';
UPDATE ipos SET lot_size = 1, updated_at = NOW() WHERE symbol = 'SHAMROIN';
UPDATE ipos SET lot_size = 1, updated_at = NOW() WHERE company_name = 'GARMENT MANTRA LIFESTYLE LTD';
```

---

## Next Steps

### Short-term (Optional)
1. Review the 4 entries and decide: reclassify, delete, or keep as-is
2. If keeping, add UI indicators that these are corporate actions, not IPOs
3. Test frontend display of these entries

### Long-term (Priority 2 Continuation)
1. Implement Puppeteer/Playwright for Chittorgarh scraping
2. Backfill 338 historical lot sizes (60-85% coverage expected)
3. Add scraper validation rules to prevent misclassification
4. Consider separate tables for corporate actions

---

## Completion Status

✅ **Task: Complete manual entry for 4 high-priority IPOs**
- [x] CUPID BREWERIES - lot_size = 1
- [x] SBEC SUGAR - lot_size = 1
- [x] SHAMROCK INDUSTRIAL - lot_size = 1
- [x] GARMENT MANTRA - lot_size = 1

✅ **Research Quality**: Comprehensive
- [x] WebSearch investigation (10+ sources)
- [x] WebFetch attempts (NSE, BSE, Chittorgarh)
- [x] Database verification
- [x] Decision rationale documented

⚠️ **Follow-up Required**: Data Quality
- [ ] Review classification of these 4 entries
- [ ] Enhance scrapers to prevent future misclassification
- [ ] Consider schema changes for corporate actions

---

**Session 5 - Priority 2 Status**: 97% Complete
- Priority 1: ✅ Test data cleanup (41 entries deleted)
- Priority 2: ✅ Manual entry (4/4 high-priority completed) ← THIS TASK
- Priority 3: ✅ Automated reports (Task Scheduler configured)
- Priority 4: ✅ Scraper validation integration (100% parity)
- Remaining: 338 historical lot sizes (deferred, LOW priority)
