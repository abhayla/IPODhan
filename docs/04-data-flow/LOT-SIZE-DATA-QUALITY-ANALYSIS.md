# Lot Size Data Quality Analysis
**Date**: 2025-11-09
**Issue**: 14 IPOs with lot_size=1 (Historical Bug)
**Severity**: P3 (Data Quality) - RESOLVED
**Status**: ✅ COMPLETE - All Corrections Applied and Verified

---

## Executive Summary

During Phase 2 post-deployment verification, integration tests identified 14 IPOs with `lot_size=1`, a known historical bug from before data validation was implemented. Initial investigation reveals this is part of a broader data quality issue involving:

1. **Mis-categorization**: Some entries are RIGHTS issues, not IPOs
2. **Invalid data**: Some companies (VIP Industries) are already listed, not conducting IPOs
3. **Lot size bug**: Historical default value of `1` when scrapers returned null

**Root Cause**: Scraper validation was insufficient before Phase 2 Data Flow Architecture implementation.

---

## Affected IPOs (14 total)

### 1. Ashnisha Industries Ltd ⚠️ RIGHTS ISSUE
- **ID**: `fb6240af-081b-44ce-bf88-9284c13ac443`
- **Slug**: `ashnisha-industries-ltd`
- **Current lot_size**: 1 ❌
- **Actual Type**: Rights Issue (NOT IPO)
- **Open Date**: October 14, 2025
- **Close Date**: November 3, 2025
- **Rights Ratio**: 13 shares for every 8 held
- **Price**: ₹3 per share
- **Subscription**: 0.05x (as of Oct 23, 2025)
- **Source**: [Chittorgarh](https://www.chittorgarh.com/rights-issue/ashnisha-industries-rights-issue-2025/465/)

**Recommended Action**:
- Mark `offeringType = 'RIGHTS'` (currently likely 'IPO')
- Remove from IPO listings (or filter by offeringType)
- Lot size not applicable for rights issues

---

### 2. VIP Industries Ltd ❌ ALREADY LISTED
- **ID**: `78ea471f-3511-460a-a366-4e8901ca4d03`
- **Slug**: `vip-industries-ltd`
- **Current lot_size**: 1 ❌
- **Actual Status**: Already listed on NSE/BSE
- **NSE Symbol**: VIPIND
- **BSE Code**: 507880
- **Current Price**: ₹406.05 (NSE), ₹406.95 (BSE) as of Oct 31, 2025
- **Incorporated**: 1968

**Recommended Action**:
- ❌ **DELETE** from IPO database (invalid entry)
- This is NOT conducting an IPO
- Likely scraper error or test data

---

### 3. Star Housing Finance Ltd ⚠️ RIGHTS ISSUE
- **ID**: `f0892437-1248-465e-ae99-ff930e34dc3c`
- **Slug**: `star-housing-finance-ltd`
- **Current lot_size**: 1 ❌
- **Actual Type**: Rights Issue (NOT IPO)
- **Open Date**: October 27, 2025
- **Close Date**: November 3, 2025
- **Rights Ratio**: 7 shares for every 9 held
- **Price**: ₹16 per share
- **Issue Size**: ₹98.27 Crores
- **Note**: Company had IPO in 2015 (lot size was 4,000 shares)

**Recommended Action**:
- Mark `offeringType = 'RIGHTS'` (currently 'IPO')
- Remove from IPO listings or filter by offeringType
- Lot size not applicable for rights issues

---

### 4. Capital Infra Trust Ltd ⚠️ InvIT (NOT TRADITIONAL IPO)
- **ID**: `e7765944-270a-493b-aef4-a8298eecfed6`
- **Slug**: `capital-trust-ltd` (should be `capital-infra-trust-invit`)
- **Current lot_size**: 1 ❌
- **Correct lot_size**: 150 shares ✅
- **Actual Type**: InvIT (Infrastructure Investment Trust)
- **Open Date**: January 7, 2025
- **Close Date**: January 9, 2025
- **Price Band**: ₹99-100 per share
- **Issue Size**: ₹1,578 crore
- **Min Investment**: ₹15,000 (150 shares)

**Recommended Action**:
- Update `offeringType = 'INVIT'`
- Update `lot_size = 150`
- Update slug to reflect InvIT nature
- Keep in database (valid offering, just different type)

---

### 5. Mangalam Industrial Finance Ltd ⚠️ RIGHTS ISSUE
- **ID**: `9f0ba7b8-cfef-4797-be67-0d6d3d5ceeff`
- **Slug**: `mangalam-industrial-finance-ltd`
- **Current lot_size**: 1 ❌
- **Actual Type**: Rights Issue (NOT IPO)
- **Open Date**: October 27, 2025
- **Close Date**: November 14, 2025 (extended)
- **Rights Ratio**: 1 share for every 2 held
- **Price**: ₹1 per share
- **Issue Size**: ₹48.08 Crores
- **Record Date**: September 23, 2025

**Recommended Action**:
- Mark `offeringType = 'RIGHTS'`
- Remove from IPO listings or filter by offeringType
- Lot size not applicable for rights issues

---

### 6. Magnus Steel and Infra Ltd ⚠️ RIGHTS ISSUE
- **ID**: `64c4c707-02f2-4e82-9cf1-d58968b3069a`
- **Slug**: `magnus-steel-and-infra-ltd`
- **Current lot_size**: 1 ❌
- **Actual Type**: Rights Issue (NOT IPO)
- **Open Date**: October 23, 2025
- **Close Date**: November 14, 2025
- **Rights Ratio**: 2 shares for every 29 held
- **Price**: ₹10 per share
- **Issue Size**: ₹49.01 Crores
- **Record Date**: October 10, 2025
- **Source**: [Chittorgarh](https://www.chittorgarh.com/rights-issue/magnus-steel-and-infra-rights-issue/467/)

**Recommended Action**:
- Mark `offeringType = 'RIGHTS'` (currently 'IPO')
- Remove from IPO listings or filter by offeringType
- Lot size not applicable for rights issues

---

### 7. U H Zaveri Ltd ⚠️ RIGHTS ISSUE
- **ID**: `dc6daa24-d687-49c5-b56c-53c3a47dabc6`
- **Slug**: `u-h-zaveri-ltd`
- **Current lot_size**: 1 ❌
- **Actual Type**: Rights Issue (NOT IPO)
- **Open Date**: October 30, 2025
- **Close Date**: November 10, 2025
- **Rights Ratio**: 2 shares for every 1 held
- **Price**: ₹10 per share
- **Record Date**: October 3, 2025
- **Note**: Company had IPO in 2018 on BSE SME (lot size was 3,000 shares)

**Recommended Action**:
- Mark `offeringType = 'RIGHTS'`
- Remove from IPO listings or filter by offeringType
- Lot size not applicable for rights issues

---

### 8. Covidh Technologies Ltd ⚠️ RIGHTS ISSUE
- **ID**: `8c2efe49-d953-4fe0-ae66-82645e8e8d95`
- **Slug**: `covidh-technologies-ltd`
- **Current lot_size**: 1 ❌
- **Actual Type**: Rights Issue (NOT IPO)
- **Open Date**: November 3, 2025
- **Close Date**: November 10, 2025
- **Rights Ratio**: 25 shares for every 1 held
- **Price**: ₹10 per share
- **Issue Size**: ₹8.09 Crores
- **Record Date**: October 24, 2025
- **About**: Software development and IT consultancy (incorporated 1993)

**Recommended Action**:
- Mark `offeringType = 'RIGHTS'`
- Remove from IPO listings or filter by offeringType
- Lot size not applicable for rights issues

---

### 9. Times Green Energy (India) Ltd ⚠️ RIGHTS ISSUE
- **ID**: `fcb593db-193d-49bd-a80d-5830191e37a0`
- **Slug**: `times-green-energy-india-ltd`
- **Current lot_size**: 1 ❌
- **Actual Type**: Rights Issue (NOT IPO)
- **Open Date**: November 7, 2025
- **Close Date**: November 17, 2025
- **Rights Ratio**: 27 shares for every 40 held
- **Price**: ₹80 per share
- **Record Date**: October 31, 2025
- **Note**: Original SME IPO was in June 2021 (lot size was 2,000 shares)
- **Source**: [IPOWatch](https://ipowatch.in/times-green-energy-rights-issue-2025/)

**Recommended Action**:
- Mark `offeringType = 'RIGHTS'` (currently 'IPO')
- Remove from IPO listings or filter by offeringType
- Lot size not applicable for rights issues

---

### 10. Titan Intech Ltd ⚠️ RIGHTS ISSUE
- **ID**: `626e1816-d97a-49f7-8cdf-0a7548e45b1c`
- **Slug**: `titan-intech-ltd`
- **Current lot_size**: 1 ❌
- **Actual Type**: Rights Issue (NOT IPO)
- **Open Date**: November 10, 2025
- **Close Date**: November 19, 2025
- **Rights Ratio**: 3 shares for every 2 held
- **Price**: ₹1 per share
- **Issue Size**: ₹49.14 Crores
- **Record Date**: October 31, 2025
- **Source**: [IPOWatch](https://ipowatch.in/titan-intech-rights-issue-2025/)

**Recommended Action**:
- Mark `offeringType = 'RIGHTS'` (currently 'IPO')
- Remove from IPO listings or filter by offeringType
- Lot size not applicable for rights issues

---

### 11. Devinsu Trading Ltd ❌ ALREADY LISTED
- **ID**: `dc8f4909-c56a-4b7b-93db-bee0cf3b2fd7`
- **Slug**: `devinsu-trading-ltd`
- **Current lot_size**: 1 ❌
- **Actual Status**: Already listed on BSE Limited
- **CIN**: L51900MH1985PLC036383
- **Incorporated**: May 28, 1985
- **Business**: Investments in shares, securities, and immovable properties
- **Registered**: ROC Mumbai
- **Source**: [Screener](https://www.screener.in/company/512445/)

**Recommended Action**:
- ❌ **DELETE** from IPO database (invalid entry)
- This is NOT conducting an IPO
- Company has been publicly listed for decades

---

### 12. Shree Pacetronix Ltd ❌ ALREADY LISTED
- **ID**: `22218dec-e32d-40ab-bb66-5294d38ac558`
- **Slug**: `shree-pacetronix-ltd`
- **Current lot_size**: 1 ❌
- **Actual Status**: Already listed on NSE/BSE
- **NSE Symbol**: SHREEPAC
- **BSE Code**: 527005
- **Incorporated**: January 1988 (Private), converted to Public in 1993
- **Business**: Manufacturing pacemakers and cardiac devices
- **Source**: [Screener](https://www.screener.in/company/527005/consolidated/)

**Recommended Action**:
- ❌ **DELETE** from IPO database (invalid entry)
- This is NOT conducting an IPO
- Company has been publicly listed since 1993

---

### 13. Grand Foundry Ltd ❌ ALREADY LISTED
- **ID**: `ce4b88c7-4ea0-4944-be91-aaabd97a3eb1`
- **Slug**: `grand-foundry-ltd`
- **Current lot_size**: 1 ❌
- **Actual Status**: Already listed on NSE/BSE
- **NSE Symbol**: GFSTEELS
- **Incorporated**: August 1974
- **Public IPO**: February 1992
- **Market Cap**: Rs 28 crore (as of Oct 2025)
- **Acquired by**: Janglas family in 1978
- **Source**: [Groww](https://groww.in/stocks/grand-foundry-ltd)

**Recommended Action**:
- ❌ **DELETE** from IPO database (invalid entry)
- This is NOT conducting an IPO
- Company has been publicly listed since 1992

---

### 14. BJ Duplex Boards Ltd ❌ ALREADY LISTED
- **ID**: `0bd06d91-0c4d-4ea8-b4e2-7bb3559958bf`
- **Slug**: `bj-duplex-boards-ltd`
- **Current lot_size**: 1 ❌
- **Actual Status**: Already listed on BSE
- **CIN**: L21090DL1995PLC066281
- **Incorporated**: 1995
- **Business**: Paper and paper products manufacturing
- **2025 Event**: Open Offer (Nov 4-18, 2025) - NOT an IPO
  - Acquisition-related offer to existing shareholders
  - 49,47,410 shares (26%) at Re. 1 per share
- **Source**: [Screener](https://www.screener.in/company/531647/)

**Recommended Action**:
- ❌ **DELETE** from IPO database (invalid entry)
- This is NOT conducting an IPO
- Company has been publicly listed since 1995
- The 2025 event is an Open Offer (acquisition), not an IPO

---

## Root Cause Analysis

### Historical Context

**Timeline**:
- **Before October 2025**: Scrapers had minimal validation
- **Bug**: When NSE/BSE returned `null` for lot_size, scrapers defaulted to `1`
- **October 18, 2025**: Lot size validation fix implemented (Phase 2)
- **October 29 - November 8, 2025**: 14 IPOs created with lot_size=1 before validation active

### Why lot_size=1 is Invalid

**SEBI ICDR Regulations** (Regulation 32):
- **Mainboard IPOs**: Minimum application typically ₹10,000 - ₹15,000
  - If share price is ₹100, lot size = 100-150 shares (not 1)
- **SME IPOs**: Minimum application typically ₹1,00,000 - ₹2,00,000
  - If share price is ₹50, lot size = 2000-4000 shares (not 1)

**Real-World Examples**:
- Typical mainboard lot sizes: 50, 75, 100, 125, 150 shares
- Typical SME lot sizes: 1000, 2000, 3000, 4000 shares
- **lot_size=1 is NEVER correct** for IPOs

---

## Data Quality Issues Discovered

### Issue #1: Offering Type Mis-categorization

**Problem**: Rights issues incorrectly categorized as IPOs

**Affected**:
- Ashnisha Industries Ltd (confirmed RIGHTS issue)
- Possibly others (need verification)

**Impact**:
- Users see rights issues in IPO listings
- Incorrect application process shown
- Confusion for retail investors

**Fix**:
- Update `offeringType` field to 'RIGHTS'
- Filter IPO listings by `offeringType = 'IPO'`
- Create separate "Rights Issues" section if desired

---

### Issue #2: Invalid Entries (Already Listed Companies)

**Problem**: Already-listed companies incorrectly added as IPOs

**Affected**:
- VIP Industries Ltd (listed since 1968)
- Possibly others (need verification)

**Impact**:
- Misleading information for users
- Wasted database storage
- Scraper errors

**Fix**:
- **DELETE** invalid entries
- Add validation: Check if company already listed before creating IPO record
- Implement ISIN/symbol lookup to prevent duplicates

---

### Issue #3: Lot Size = 1 (Historical Bug)

**Problem**: Scraper defaulted to `1` when source returned `null`

**Affected**: All 14 IPOs listed above

**Impact**:
- Users see incorrect minimum investment amount
- Application process shows wrong lot size
- SEBI compliance risk (incorrect disclosures)

**Fix**:
- Research correct lot_size from official sources
- Update with correct values
- Mark source as 'ADMIN' (Priority 5)

---

## Recommended Actions

### Immediate (This Week) - Updated Based on Research

**Step 1: Delete Invalid Entries (5 companies)** ❌
```sql
-- Already-listed companies incorrectly added as IPOs
DELETE FROM ipos WHERE id IN (
  '78ea471f-3511-460a-a366-4e8901ca4d03', -- VIP Industries (listed since 1968)
  'dc8f4909-c56a-4b7b-93db-bee0cf3b2fd7', -- Devinsu Trading (listed since 1985)
  '22218dec-e32d-40ab-bb66-5294d38ac558', -- Shree Pacetronix (listed since 1993)
  'ce4b88c7-4ea0-4944-be91-aaabd97a3eb1', -- Grand Foundry (listed since 1992)
  '0bd06d91-0c4d-4ea8-b4e2-7bb3559958bf'  -- BJ Duplex Boards (listed since 1995)
);
```

**Step 2: Update RIGHTS Issues (9 companies)** ⚠️
```sql
-- Mark as RIGHTS issues (NOT IPOs)
UPDATE ipos
SET "offeringType" = 'RIGHTS'
WHERE id IN (
  'fb6240af-081b-44ce-bf88-9284c13ac443', -- Ashnisha Industries
  'f0892437-1248-465e-ae99-ff930e34dc3c', -- Star Housing Finance
  '9f0ba7b8-cfef-4797-be67-0d6d3d5ceeff', -- Mangalam Industrial Finance
  'dc6daa24-d687-49c5-b56c-53c3a47dabc6', -- U H Zaveri
  '8c2efe49-d953-4fe0-ae66-82645e8e8d95', -- Covidh Technologies
  '64c4c707-02f2-4e82-9cf1-d58968b3069a', -- Magnus Steel and Infra
  'fcb593db-193d-49bd-a80d-5830191e37a0', -- Times Green Energy
  '626e1816-d97a-49f7-8cdf-0a7548e45b1c'  -- Titan Intech
);

-- Note: For RIGHTS issues, lot_size is not applicable
-- Consider setting to NULL or removing from IPO listings via frontend filter
```

**Step 3: Update InvIT (1 company)** 🔧
```sql
-- Capital Infra Trust: Valid offering, needs correction
UPDATE ipos
SET "offeringType" = 'INVIT',
    "lotSize" = 150
WHERE id = 'e7765944-270a-493b-aef4-a8298eecfed6';
```

**Step 4: Execute Corrections via Admin Interface or SQL** ✅
- Use Dynamic Admin to apply corrections
- Mark field source as 'ADMIN' (Priority 5)
- Verify changes in database

---

### Short-Term (Week 2-3) - ✅ COMPLETED (Phase 3)

**Prevention Measures Implemented**:
1. ✅ **Enhanced Scraper Validation** (scraper/src/utils/data-validation.ts)
   - Rejects lot_size < 10 (CRITICAL error)
   - Warns on lot_size < 50 for MAINBOARD (MEDIUM warning)
   - Warns on lot_size < 1000 for SME (MEDIUM warning)
   - SEBI price band compliance checks

2. ✅ **Offering Type Auto-Detection** (scraper/src/utils/data-validation.ts)
   - Detects "rights issue", "InvIT", "REIT" keywords
   - Auto-fixes offeringType with HIGH confidence
   - Filters by offering type supported

3. ✅ **Duplicate Detection** (scraper/src/services/duplicate-detection-service.ts)
   - Checks stock symbol before creating (HIGH confidence)
   - Checks ISIN before creating (HIGH confidence)
   - Fuzzy company name matching (MEDIUM confidence, 85% threshold)
   - Date overlap detection (MEDIUM confidence)
   - Multi-tier matching prevents already-listed companies like VIP Industries

4. ✅ **Data Quality Monitoring** (web/scripts/data-quality-report.ts)
   - Weekly automated reports
   - 10+ validation checks including lot_size=1
   - Severity classification (CRITICAL, HIGH, MEDIUM, LOW)
   - First report generated: 2025-11-09

**Status**: All preventive measures are now active. Future lot_size=1 bugs will be automatically rejected by validation pipeline.

---

## Research Template

For each IPO, research using this template:

```markdown
### [Company Name]

**Official Sources**:
- NSE: [Link if found]
- BSE: [Link if found]
- Chittorgarh: [Link if found]
- SEBI DRHP: [Link if found]

**Verified Details**:
- Offering Type: IPO / RIGHTS / InvIT / REIT
- Segment: MAINBOARD / SME
- Price Band: ₹X - ₹Y
- Lot Size: [number] shares
- Minimum Investment: ₹[lot_size × price_upper]

**Source Confidence**: HIGH / MEDIUM / LOW

**Action**:
- [ ] Update lot_size
- [ ] Update offeringType if needed
- [ ] Delete if invalid
```

---

## Progress Tracking

### Research Status

- [x] Ashnisha Industries → RIGHTS issue ⚠️
- [x] VIP Industries → Invalid (DELETE) ❌
- [x] Star Housing Finance → RIGHTS issue ⚠️
- [x] Capital Infra Trust → InvIT (Update lot_size=150, offeringType='INVIT') 🔧
- [x] Mangalam Industrial Finance → RIGHTS issue ⚠️
- [x] Magnus Steel and Infra → RIGHTS issue ⚠️
- [x] U H Zaveri → RIGHTS issue ⚠️
- [x] Covidh Technologies → RIGHTS issue ⚠️
- [x] Times Green Energy (SME) → RIGHTS issue ⚠️
- [x] Titan Intech → RIGHTS issue ⚠️
- [x] Devinsu Trading → Invalid (DELETE) ❌
- [x] Shree Pacetronix → Invalid (DELETE) ❌
- [x] Grand Foundry → Invalid (DELETE) ❌
- [x] BJ Duplex Boards → Invalid (DELETE) ❌

**Completion**: 14/14 (100%) ✅

**Summary of Findings**:
- ⚠️ **RIGHTS Issues**: 8 companies (Ashnisha, Star Housing, Mangalam, U H Zaveri, Covidh, Magnus Steel, Times Green Energy, Titan Intech)
- 🔧 **InvIT**: 1 company (Capital Infra Trust - valid, needs update)
- ❌ **Invalid (Already Listed)**: 5 companies (VIP Industries, Devinsu Trading, Shree Pacetronix, Grand Foundry, BJ Duplex Boards - DELETE)

---

## Next Steps

1. ✅ **Manual Research** - COMPLETE (14/14 companies researched)
   - All 14 IPOs researched and documented
   - Findings: 8 RIGHTS issues, 1 InvIT, 5 invalid (already listed)

2. ✅ **Execute Corrections** - COMPLETE
   - ✅ Deleted 5 invalid entries (VIP Industries, Devinsu Trading, Shree Pacetronix, Grand Foundry, BJ Duplex Boards)
   - ✅ Updated 8 RIGHTS issues (all correctly marked offeringType='RIGHTS')
   - ✅ Updated 1 InvIT (Capital Infra Trust: offeringType='INVITS', lotSize=150)

3. ✅ **Verify** - COMPLETE
   - ✅ Verified RIGHTS issues (8/8 correctly updated)
   - ✅ Verified InvIT (Capital Infra Trust correctly updated)
   - Note: 8 RIGHTS issues still have lot_size=1 (acceptable - lot size not applicable for rights issues)

4. 🔄 **Document** - IN PROGRESS
   - Update SESSION_STATUS.md
   - Update DATA-QUALITY-CURRENT-STATUS.md
   - Create completion summary

**Status**: All corrections successfully applied and verified ✅

---

**Document Owner**: IPODhan Development Team
**Created**: 2025-11-09
**Research Completed**: 2025-11-09
**Corrections Executed**: 2025-11-09
**Status**: ✅ COMPLETE - All Corrections Applied
**Next Update**: N/A (Task Complete)

---

## Completion Summary

### Actions Taken (2025-11-09)

**Research Phase** (14/14 companies - 100%):
- Investigated each company with lot_size=1
- Identified root causes: RIGHTS issues, InvITs, and already-listed companies
- Documented findings with sources

**Correction Phase** (All verified ✅):
1. **Deleted 5 invalid entries** (Already-listed companies):
   - VIP Industries Ltd (listed since 1968)
   - Devinsu Trading Ltd (listed since 1985)
   - Shree Pacetronix Ltd (listed since 1993)
   - Grand Foundry Ltd (listed since 1992)
   - BJ Duplex Boards Ltd (listed since 1995)

2. **Updated 8 RIGHTS issues** (Marked offeringType='RIGHTS'):
   - Ashnisha Industries Ltd
   - Star Housing Finance Ltd
   - Mangalam Industrial Finance Ltd
   - U H Zaveri Ltd
   - Covidh Technologies Ltd
   - Magnus Steel and Infra Ltd
   - Times Green Energy India Ltd
   - Titan Intech Ltd

3. **Updated 1 InvIT** (Infrastructure Investment Trust):
   - Capital Infra Trust Ltd → offeringType='INVITS', lotSize=150

**Verification** (All passed ✅):
- ✅ 5 invalid entries deleted from database
- ✅ 8 RIGHTS issues correctly categorized
- ✅ 1 InvIT correctly updated with lot_size=150
- Note: 8 RIGHTS issues still have lot_size=1 (acceptable - lot size not applicable for rights issues)

### Impact Assessment

**Before Corrections**:
- 14 IPOs with lot_size=1 (data quality issue)
- Mis-categorized RIGHTS issues shown as IPOs
- Already-listed companies incorrectly in IPO database
- Users seeing incorrect information

**After Corrections**:
- 5 invalid entries removed (35.7%)
- 8 RIGHTS issues properly categorized (57.1%)
- 1 InvIT corrected with proper lot_size (7.1%)
- Database integrity improved
- Frontend filtering can now correctly exclude RIGHTS issues from IPO listings

### Prevention Measures (Phase 3 - Already Active)

✅ Data validation pipeline now prevents:
- lot_size < 10 (auto-rejected)
- RIGHTS issues mis-categorization (auto-detected)
- Duplicate/already-listed companies (multi-tier matching)
- SEBI compliance violations (price band checks)

### Files Created

1. `web/scripts/fix-lot-size-1-ipos.ts` - Database correction script
2. `web/scripts/fix-invit-only.ts` - InvIT-specific correction
3. `web/scripts/verify-rights-issues.ts` - RIGHTS verification
4. `web/scripts/verify-invit.ts` - InvIT verification

### Time Spent

- Research: ~60 minutes (14 companies researched)
- Corrections: ~15 minutes (SQL scripts executed)
- Verification: ~10 minutes (All verified)
- Documentation: ~20 minutes (Updates to this file)
- **Total**: ~105 minutes

### Lessons Learned

1. **Root Cause**: Historical scraper bug allowed invalid entries before validation pipeline was implemented
2. **Pattern**: Most lot_size=1 entries were RIGHTS issues, not IPOs
3. **Prevention**: Phase 3 validation pipeline prevents recurrence
4. **Database Schema**: Offering type enum supports 14 types including RIGHTS, INVITS, REITS

---
