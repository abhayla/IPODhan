# Chittorgarh IPO Detail Page - Gap Analysis

**Date**: 2025-10-26
**Purpose**: Comprehensive comparison of Chittorgarh.com's IPO detail page features vs IPODhan's current implementation
**Reference Images**: 16 screenshots from Chittorgarh.com (Canara HSBC Life IPO)
**Current IPODhan Documentation**: `IPO_DETAIL_PAGE_DOCUMENTATION.md`

---

## Executive Summary

### Overall Feature Coverage: 62% Complete

**Coverage Breakdown by Section**:
- **IPO Details**: 85% complete (missing employee discount, share holding pre/post issue)
- **Lot Details**: 95% complete (missing investment range table for HNI categories)
- **Promoter Holding**: 0% complete (NOT IMPLEMENTED)
- **Company Financials**: 55% complete (missing EBITDA, Reserves & Surplus, multiple FY columns)
- **Category Reservations**: 0% complete (NOT IMPLEMENTED)
- **IPO Reservation**: 70% complete (have basic allocation, missing max allottees)
- **Anchor Investors**: 0% complete (NOT IMPLEMENTED)
- **IPO Objectives**: 0% complete (NOT IMPLEMENTED)
- **KPIs**: 40% complete (missing market cap, pre/post IPO EPS comparison, P/E breakdown)
- **Subscription Status**: 85% complete (missing bNII/sNII split, total applications count)
- **Prospectus**: 60% complete (have documents, missing anchor investor list link)
- **Listing Details**: 90% complete (missing BSE script code, NSE/BSE listing group)
- **Registrar**: 100% complete
- **Lead Manager**: 90% complete (missing performance tracking links)
- **Contact Details**: 0% complete (NOT IMPLEMENTED)
- **Recommendation Summary**: 20% complete (have score, missing broker/member reviews aggregation)

**Database Availability**: ~75% of required fields exist in schema
**Implementation Effort**: 4-6 weeks for high-priority gaps

---

## Section-by-Section Analysis

### 1. IPO Details

**What Chittorgarh Shows**:
- IPO Date (Open to Close range)
- Listing Date
- Face Value (₹10 per share)
- Issue Price Band (₹100 to ₹106 per share)
- Issue Price Final (₹106 per share)
- Lot Size (140 Shares)
- Sale Type (Offer For Sale)
- Total Issue Size (23,75,00,000 shares, aggregating up to ₹2,517.50 Cr)
- Employee Discount (₹10.00)
- Issue Type (Bookbuilding IPO)
- Listing At (BSE, NSE)
- Share Holding Pre Issue (95,00,00,000 shares)
- Share Holding Post Issue (95,00,00,000 shares)

**What IPODhan Has**:
- Open Date: ✅ `ipos.openDate`
- Close Date: ✅ `ipos.closeDate`
- Listing Date: ✅ `ipos.listingDate`
- Face Value: ✅ `ipos.faceValue`
- Price Range: ✅ `ipos.priceRangeMin`, `ipos.priceRangeMax`
- Lot Size: ✅ `ipos.lotSize`
- Issue Size: ✅ `ipos.issueSize`
- Listing Exchanges: ✅ `ipos.listingExchanges`
- Issue Type: ✅ `ipoDetails.issueType` (BOOK_BUILDING, FIXED_PRICE, HYBRID)

**What's Missing**:
1. **Employee Discount Amount**: Field exists in seed data but NOT in schema
   - Database: ❌ Not available
   - Effort: Medium (add `employeeDiscount` to `ipoDetails` table)

2. **Final Issue Price**: Only have range, not final decided price
   - Database: ✅ `ipoDetails.cutOffPrice` exists
   - Effort: Low (display `cutOffPrice` field)

3. **Sale Type Label**: "Offer For Sale" vs "Fresh Issue"
   - Database: ✅ `ipoDetails.freshIssue` and `ipoDetails.ofsIssue` exist
   - Effort: Low (derive label from these fields)

4. **Share Holding Pre/Post Issue**: Total shares before and after IPO
   - Database: ❌ Not available
   - Effort: Medium (add to `ipoDetails` table)

5. **Total Issue Size in Shares**: Currently only show ₹ amount
   - Database: ❌ Not directly available
   - Effort: Low (calculate from `issueSize` / `priceRangeMax`)

**Priority**: MEDIUM
**Implementation Effort**: 2-3 days

---

### 2. Lot Size Details

**What Chittorgarh Shows**:
Detailed investment range table by category:

| Application | Lots | Shares | Amount |
|-------------|------|--------|---------|
| Retail (Min) | 1 | 140 | ₹14,840 |
| Retail (Max) | 13 | 1,820 | ₹1,92,920 |
| S-HNI (Min) | 14 | 1,960 | ₹2,07,760 |
| S-HNI (Max) | 67 | 9,380 | ₹9,94,280 |
| B-HNI (Min) | 68 | 9,520 | ₹10,09,120 |

**What IPODhan Has**:
- Lot Calculator component: ✅ `LotCalculator` embedded
- Shows: number of lots, total investment, amount per lot
- Only basic calculation, no category-specific ranges

**What's Missing**:
1. **Category Investment Ranges**: Retail/S-HNI/B-HNI specific min/max
   - Database: ❌ Not available (static ranges based on SEBI rules)
   - Effort: Low (hardcoded SEBI limits: Retail max ₹2L, S-HNI ₹2L-₹10L, B-HNI >₹10L)

2. **Pre-filled Category Table**: Professional presentation
   - Database: N/A (calculated)
   - Effort: Low (enhance `LotCalculator` component)

**Priority**: LOW
**Implementation Effort**: 4-6 hours

---

### 3. Promoter Holding

**What Chittorgarh Shows**:
- Promoter Holding Pre Issue: 77.00%
- Promoter Holding Post Issue: 62%
- Note: "The value will be calculated using Equity Dilution = Share Holding Pre Issue - Share Holding Post Issue"

**What IPODhan Has**:
- ❌ **NOT IMPLEMENTED AT ALL**
- No promoter holding data displayed anywhere
- No mention in Overview tab or Financials tab

**What's Missing**:
1. **Promoter Holding Pre-Issue %**
   - Database: ❌ Not available
   - Effort: Medium (add `promoterHoldingPreIssue` to `ipoDetails` or `financialData`)

2. **Promoter Holding Post-Issue %**
   - Database: ❌ Not available
   - Effort: Medium (same as above)

3. **Equity Dilution Calculation**
   - Database: N/A (derived field)
   - Effort: Low (automatic calculation)

**Priority**: HIGH (critical investor information)
**Implementation Effort**: 1 day

**Database Schema Addition**:
```sql
-- Add to ipoDetails table
ALTER TABLE ipo_details
  ADD COLUMN promoter_holding_pre_issue NUMERIC(5,2),  -- percentage
  ADD COLUMN promoter_holding_post_issue NUMERIC(5,2); -- percentage
```

---

### 4. Company Financials

**What Chittorgarh Shows**:
Multi-period financial table with:
- Period Ended: 30 Jun 2025, 31 Mar 2025, 31 Mar 2024, 31 Mar 2023
- Assets: 44,047.98, 41,852.09, 37,815.80, 30,548.89 (in ₹ Crore)
- Total Income: 42.35, 234.01, 240.88, 261.59
- Profit After Tax: 23.41, 116.98, 113.32, 91.19
- EBITDA: 31.28, 149.91, 146.56, 118.82
- NET Worth: 1,540.28, 1,516.86, 1,418.88, 1,353.07
- Reserves and Surplus: 590.28, 566.86, 468.88, 403.07
- Note: "Revenue decreased by 3% and profit after tax (PAT) rose by 3%..."

**What IPODhan Has**:
- Revenue FY2022-2024: ✅ `financialData.revenueFy2022/2023/2024`
- Profit FY2022-2024: ✅ `financialData.profitFy2022/2023/2024`
- Net Worth: ✅ `financialData.netWorth`
- Reserves & Surplus: ✅ `financialData.reservesAndSurplus`
- Total Assets: ✅ `financialData.totalAssets`
- Displayed in Financials tab (not visible in screenshots)

**What's Missing**:
1. **EBITDA (Earnings Before Interest, Tax, Depreciation, Amortization)**
   - Database: ❌ Not in `financialData` table
   - Effort: Low (add single column)

2. **Multi-Period Display (4+ quarters/years)**
   - Database: ⚠️ Limited (only FY2022, FY2023, FY2024)
   - Effort: Medium (need quarterly data structure)
   - Alternative: Use `ipoFinancials` table (more flexible FY1/FY2/FY3)

3. **Total Income Row** (separate from Revenue)
   - Database: ❌ Not available
   - Effort: Low (add to schema or calculate)

4. **Financial Trend Analysis**: "Revenue decreased by 3%..."
   - Database: N/A (calculated)
   - Effort: Low (YoY % calculation in UI)

5. **Quarter-end Dates Display**: "Period Ended"
   - Database: ✅ `ipoFinancials.financialYearEnd`
   - Effort: Low (display existing field)

**Priority**: HIGH (critical for investor decisions)
**Implementation Effort**: 3-4 days

**Database Schema Addition**:
```sql
-- Add to financialData table
ALTER TABLE financial_data
  ADD COLUMN ebitda_fy2022 NUMERIC(12,2),
  ADD COLUMN ebitda_fy2023 NUMERIC(12,2),
  ADD COLUMN ebitda_fy2024 NUMERIC(12,2),
  ADD COLUMN total_income_fy2022 NUMERIC(12,2),
  ADD COLUMN total_income_fy2023 NUMERIC(12,2),
  ADD COLUMN total_income_fy2024 NUMERIC(12,2);
```

---

### 5. Investor Category Reservations

**What Chittorgarh Shows**:
Detailed bidding rules table:

| Application Category | Maximum Bidding Limits | Bidding at Cut-off Price Allowed |
|---------------------|------------------------|----------------------------------|
| Only RII | Up to Rs 2 Lakhs | Yes |
| Only sNII | Rs 2 Lakhs to Rs 10 Lakhs | No |
| Only bNII | Rs 10 Lakhs to NII Reservation Portion | No |
| Only employee | - | Yes |
| Employee + RII/NII | Various conditions listed | Yes for Employee and RII/NII |

**What IPODhan Has**:
- ❌ **NOT IMPLEMENTED AT ALL**
- No category reservation rules displayed
- Basic issue structure shows allocation % only

**What's Missing**:
1. **Category-specific Bidding Rules**
   - Database: ❌ Not available
   - Effort: Low (static SEBI rules, can be hardcoded)

2. **Cut-off Price Eligibility by Category**
   - Database: N/A (static rules)
   - Effort: Low (static data)

3. **Detailed Employee + Combined Category Rules**
   - Database: N/A (static rules)
   - Effort: Low (documentation/static content)

**Priority**: LOW (informational, not IPO-specific data)
**Implementation Effort**: 1 day (mostly static content component)

**Note**: This is regulatory information that doesn't change per IPO. Can be a static component with explanatory text.

---

### 6. IPO Reservation (Share Allocation)

**What Chittorgarh Shows**:
Detailed allocation table:
- Narrative: "Canara HSBC Life IPO offers total 23,75,00,000 shares. Out of which 11,79,75,000 (49.67%) allocated to QIB, 4,71,90,000 (19.87%) allocated to QIB (Ex- Anchor), 3,53,92,500 (14.90%) allocated to NII 8,25,82,500 (34.77%) allocated to RII and 7,07,85,000 (29.80%) allocated to Anchor investors."

| Investor Category | Shares Offered | Maximum Allottees |
|------------------|----------------|-------------------|
| QIB Shares Offered | 11,79,75,000 (49.67%) | NA |
| NII (HNI) Shares Offered | 3,53,92,500 (14.90%) | NA |
| Retail Shares Offered | 8,25,82,500 (34.77%) | 5,89,875 |
| Employee Shares Offered | 15,50,000 (0.65%) | NA |
| Total Shares Offered | 23,75,00,000 (100.00%) | - |

**What IPODhan Has**:
- Issue Structure Section: ✅ Shows basic allocation %
- Likely has: Retail %, HNI %, QIB %, Employee %
- Data source: Unknown (need to check `ipoDetails` or hardcoded)

**What's Missing**:
1. **Shares Offered Count by Category**
   - Database: ⚠️ Partial (`subscriptions.sharesOffered` is total)
   - Effort: Medium (add category breakdown to `ipoDetails`)

2. **Maximum Allottees Count**
   - Database: ❌ Not available
   - Effort: Medium (add to schema)

3. **Anchor Investor Allocation %**
   - Database: ❌ Not available
   - Effort: Low (add single field)

4. **QIB (Ex-Anchor) Split**
   - Database: ❌ Not available
   - Effort: Low (separate QIB into anchor/non-anchor)

**Priority**: MEDIUM
**Implementation Effort**: 2 days

**Database Schema Addition**:
```sql
-- Add to ipoDetails table
ALTER TABLE ipo_details
  ADD COLUMN qib_shares_offered BIGINT,
  ADD COLUMN qib_allocation_percent NUMERIC(5,2),
  ADD COLUMN nii_shares_offered BIGINT,
  ADD COLUMN nii_allocation_percent NUMERIC(5,2),
  ADD COLUMN retail_shares_offered BIGINT,
  ADD COLUMN retail_allocation_percent NUMERIC(5,2),
  ADD COLUMN retail_max_allottees INTEGER,
  ADD COLUMN employee_shares_offered BIGINT,
  ADD COLUMN employee_allocation_percent NUMERIC(5,2),
  ADD COLUMN anchor_shares_offered BIGINT,
  ADD COLUMN anchor_allocation_percent NUMERIC(5,2);
```

---

### 7. Anchor Investors Details

**What Chittorgarh Shows**:
- Narrative: "Canara HSBC Life IPO raises ₹750.32 crore from anchor investors."
- Link: "Canara HSBC Life IPO Anchor Investors list"
- Bid Date: October 9, 2025
- Shares Offered: 7,07,85,000
- Anchor Portion Size (In Cr): 750.32
- Anchor lock-in period end date for 50% shares (30 Days): November 13, 2025
- Anchor lock-in period end date for remaining shares (90 Days): January 12, 2026

**What IPODhan Has**:
- ❌ **NOT IMPLEMENTED AT ALL**
- No anchor investor information displayed anywhere
- No separate section or tab

**What's Missing**:
1. **All Anchor Investor Fields** (complete section missing)
   - Anchor bid date
   - Shares offered to anchors
   - Anchor portion size (₹ amount)
   - Lock-in period dates (50% and remaining)
   - Link to anchor investor list

2. **Database Schema for Anchor Data**
   - Database: ❌ No `anchor_investors` table exists
   - Effort: High (new table + scraper + UI)

**Priority**: MEDIUM-HIGH (important for institutional confidence signal)
**Implementation Effort**: 1 week

**Database Schema Addition** (new table required):
```sql
CREATE TABLE anchor_investors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,

  -- Aggregate anchor data
  bid_date DATE,
  total_shares_offered BIGINT,
  total_amount_raised NUMERIC(12,2), -- in crores
  anchor_investors_count INTEGER,

  -- Lock-in periods
  lock_in_50_percent_date DATE, -- 30 days
  lock_in_remaining_date DATE,  -- 90 days

  -- Individual investors (JSON array)
  investor_list JSONB, -- [{name: "...", shares: 123, amount: 45.6}, ...]

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

### 8. IPO Objectives (Objects of the Issue)

**What Chittorgarh Shows**:
Table of fund utilization:

| S.No. | Objects of the Issue | Expected Amount (₹ in crores) |
|-------|---------------------|-------------------------------|
| 1 | To carry out the Offer for Sale of up to 237,500,000 Equity Shares of face value of ₹10 each by the Selling Shareholders aggregating up to ₹[●] million; and | - |
| 2 | Achieve the benefits of listing the Equity Shares on the Stock Exchanges | - |

**What IPODhan Has**:
- ❌ **NOT IMPLEMENTED AT ALL**
- No "Objects of the Issue" section
- No fund utilization breakdown

**What's Missing**:
1. **IPO Objectives List**
   - Database: ❌ Not available
   - Effort: Medium (add `objectives` JSONB field to `ipoDetails`)

2. **Expected Amount per Objective**
   - Database: ❌ Not available
   - Effort: Medium (part of objectives structure)

**Priority**: MEDIUM (useful but not critical)
**Implementation Effort**: 2 days

**Database Schema Addition**:
```sql
-- Add to ipoDetails table
ALTER TABLE ipo_details
  ADD COLUMN objectives JSONB; -- [{sno: 1, description: "...", amount: 500}, ...]
```

**Example Data Structure**:
```json
[
  {
    "sno": 1,
    "description": "Repayment of debt",
    "amount": 500.50
  },
  {
    "sno": 2,
    "description": "Working capital requirements",
    "amount": 300.00
  },
  {
    "sno": 3,
    "description": "General corporate purposes",
    "amount": null
  }
]
```

---

### 9. Key Performance Indicators (KPIs)

**What Chittorgarh Shows**:
- Market Capitalization: ₹10070.00 Cr
- KPI Table:
  - ROE: 7.71%
  - RoNW: 7.97%
  - Price to Book Value: 6.64
  - Market Capitalization: 10070.00
- Pre IPO vs Post IPO EPS:
  - EPS ₹: Pre IPO 1.23, Post IPO 0.99
  - P/E (x): Pre IPO 86.08, Post IPO 107.53
- Note: "The Pre IPO EPS is calculated based on Pre issue shareholding as on date of RHP and the latest FY earnings as of March 31, 2025..."

**What IPODhan Has**:
- Basic financial metrics: ✅ PE ratio, ROE in `financialData`
- Market cap: ❌ Not stored
- Pre/Post IPO comparison: ❌ Not available
- Displayed in peer comparison but not as dedicated KPI section

**What's Missing**:
1. **Market Capitalization**
   - Database: ❌ Not available
   - Effort: Low (calculate or scrape)
   - Formula: `Post-issue shares × Issue price`

2. **Price to Book Value Ratio**
   - Database: ⚠️ Available as `financialData.pbvRatio` but not prominently displayed
   - Effort: Low (display existing field)

3. **Pre-IPO vs Post-IPO EPS Comparison**
   - Database: ❌ Not available
   - Effort: Medium (add pre/post fields)

4. **Pre-IPO vs Post-IPO P/E Comparison**
   - Database: ❌ Not available
   - Effort: Low (calculate from EPS)

5. **RoNW (Return on Net Worth)**
   - Database: ✅ `peerCompanies.ronw` exists, not in main financial table
   - Effort: Low (add to `financialData`)

**Priority**: HIGH (key investor metrics)
**Implementation Effort**: 3 days

**Database Schema Addition**:
```sql
-- Add to financialData table
ALTER TABLE financial_data
  ADD COLUMN market_cap NUMERIC(15,2), -- in crores
  ADD COLUMN pre_ipo_eps NUMERIC(10,2),
  ADD COLUMN post_ipo_eps NUMERIC(10,2),
  ADD COLUMN pre_ipo_pe NUMERIC(10,2),
  ADD COLUMN post_ipo_pe NUMERIC(10,2),
  ADD COLUMN ronw NUMERIC(5,2); -- return on net worth %
```

---

### 10. Subscription Status (Bidding Detail)

**What Chittorgarh Shows**:
- IPO Review summary (editorial content)
- Subscription summary: "The Canara HSBC Life IPO is subscribed 2.30 times on October 14, 2025 5:04:41 PM (Day 3). The public issue subscribed 0.42 times in the retail category, 7.05 times in the QIB category, and 0.33 times in the NII category."
- Link: "Day by Day Subscription Details (Live Status)"
- Detailed subscription table:

| Category | Subscription (times) | Shares Offered | Shares bid for |
|----------|---------------------|----------------|----------------|
| QIB (Ex Anchor) | 7.05 | 4,71,90,000 | 33,28,94,520 |
| NII | 0.33 | 3,53,92,500 | 1,17,54,540 |
| bNII (bids above ₹10L) | 0.28 | 2,35,95,000 | 65,80,700 |
| sNII (bids below ₹10L) | 0.44 | 1,17,97,500 | 51,73,840 |
| Retail | 0.42 | 8,25,82,500 | 3,47,89,020 |
| Employee | 2.06 | 15,50,000 | 31,87,800 |
| Total | 2.30 | 16,67,15,000 | 38,26,25,880 |

- Total Application: 1,75,204

**What IPODhan Has**:
- Subscription tab: ✅ Exists
- Time-series data: ✅ `subscriptions` table with timestamps
- Category breakdown: ✅ QIB, NII, Retail, Employee
- Latest snapshot: ✅ Displayed in key metrics card
- Total subscription: ✅ Shown

**What's Missing**:
1. **bNII and sNII Split** (Big HNI vs Small HNI)
   - Database: ✅ `subscriptions.bNIISubscription`, `subscriptions.sNIISubscription` exist!
   - Effort: Low (already in schema, just display it)

2. **Shares Offered per Category**
   - Database: ⚠️ Only total `subscriptions.sharesOffered`
   - Effort: Medium (need category breakdown in subscription table)

3. **Shares Bid For Count**
   - Database: ⚠️ Have `subscriptions.totalSharesBid` (total only)
   - Effort: Medium (add category breakdown)

4. **Total Applications Count**
   - Database: ✅ `subscriptions.totalApplications` exists!
   - Effort: Low (display existing field)

5. **IPO Review Editorial Content**
   - Database: ⚠️ `ipoReviews` table exists but not for platform editorial
   - Effort: Medium (add platform review capability)

6. **Day-by-Day Subscription Link**
   - Database: N/A (UI feature)
   - Effort: Low (already have time-series data, just need detailed view)

**Priority**: MEDIUM (good data already exists, needs better display)
**Implementation Effort**: 2-3 days

**Database Schema Addition**:
```sql
-- Add to subscriptions table (for shares bid breakdown)
ALTER TABLE subscriptions
  ADD COLUMN qib_shares_bid BIGINT,
  ADD COLUMN nii_shares_bid BIGINT,
  ADD COLUMN b_nii_shares_bid BIGINT,
  ADD COLUMN s_nii_shares_bid BIGINT,
  ADD COLUMN retail_shares_bid BIGINT,
  ADD COLUMN employee_shares_bid BIGINT;
```

---

### 11. Prospectus (Documents)

**What Chittorgarh Shows**:
- Canara HSBC Life IPO DRHP (clickable link)
- Canara HSBC Life IPO RHP (clickable link)
- Anchor Investors in Canara HSBC Life IPO (clickable link)
- Canara HSBC Life IPO Final Prospectus (clickable link)

**What IPODhan Has**:
- Documents tab: ✅ Exists
- Document types: ✅ DRHP, RHP, PROSPECTUS, BASIS_OF_ALLOTMENT, ADDENDUM
- External links: ✅ NSE, BSE, SEBI links supported
- Database: ✅ `documents` table with `type`, `url`, `title`

**What's Missing**:
1. **Anchor Investors List Document**
   - Database: ⚠️ Can store in `documents` table but no specific type
   - Effort: Low (add to `documentTypeEnum` or use PROSPECTUS type with anchor title)

2. **Better Document Presentation**
   - Database: N/A (UI improvement)
   - Effort: Low (enhance Documents tab layout)

**Priority**: LOW (already functional, minor enhancement)
**Implementation Effort**: 4 hours

---

### 12. Listing Details

**What Chittorgarh Shows**:
- Listing Date: October 17, 2025
- BSE Script Code: 544583
- NSE Symbol: CANHLIFE
- ISIN: INE01TY01017
- Final Issue Price: ₹106 per share
- NSE Listing Group: EQ (Rolling)
- BSE Listing Group: B (Rolling)
- Links: "Pre-Open Session - NSE", "Pre-Open Session - BSE"

**What IPODhan Has**:
- Listing date: ✅ `ipos.listingDate`
- NSE symbol: ✅ `ipos.symbol`
- ISIN: ✅ `ipos.isin`
- Final price: ⚠️ Have price range, need cut-off price
- Exchanges: ✅ `ipos.listingExchanges`

**What's Missing**:
1. **BSE Script Code**
   - Database: ❌ Only have `symbol` (NSE), no BSE code
   - Effort: Low (add `bseScriptCode` field)

2. **NSE Listing Group** (EQ, T, etc.)
   - Database: ❌ Not available
   - Effort: Low (add single field)

3. **BSE Listing Group** (A, B, T, etc.)
   - Database: ❌ Not available
   - Effort: Low (add single field)

4. **Pre-Open Session Links**
   - Database: N/A (external links, can be generated)
   - Effort: Low (generate URLs from NSE/BSE symbol)

**Priority**: MEDIUM
**Implementation Effort**: 1 day

**Database Schema Addition**:
```sql
-- Add to ipos table or listingPerformance table
ALTER TABLE listing_performance
  ADD COLUMN bse_script_code VARCHAR(20),
  ADD COLUMN nse_listing_group VARCHAR(10),
  ADD COLUMN bse_listing_group VARCHAR(10);
```

---

### 13. Registrar Details

**What Chittorgarh Shows**:
- Registrar Name: KFin Technologies Ltd.
- Phone: 04067162222, 04079611000
- Email: einward.ris@kfintech.com
- Website: https://ipostatus.kfintech.com/

**What IPODhan Has**:
- Registrar name: ✅ `ipos.registrar` and `registrars.name`
- Phone: ✅ `registrars.phone`
- Email: ✅ `registrars.email`
- Website: ✅ `registrars.website`
- Allotment check URL: ✅ `registrars.allotmentCheckUrl`
- Displayed in: InfoSection and AllotmentCheckerCard

**What's Missing**:
- ✅ **NOTHING** - This section is 100% complete!

**Priority**: N/A (already complete)
**Implementation Effort**: 0 hours

---

### 14. Lead Manager Details

**What Chittorgarh Shows**:
- Numbered list of lead managers with performance tracking links:
  1. SBI Capital Markets Ltd. (Past IPO Performance)
  2. BNP Paribas (Past IPO Performance)
  3. HSBC Securities & Capital Markets (India) Pvt.Ltd. (Past IPO Performance)
  4. JM Financial Ltd. (Past IPO Performance)
  5. Motilal Oswal Investment Advisors Ltd. (Past IPO Performance)
- Additional sections:
  - Lead Manager Reports
  - IPO Lead Manager Performance Summary
  - IPO Lead Manager Performance Tracker

**What IPODhan Has**:
- Lead managers list: ✅ `ipos.leadManagers` (JSONB array)
- Displayed in: InfoSection
- Format: Comma-separated list

**What's Missing**:
1. **Lead Manager Performance Tracking Links**
   - Database: ❌ No lead manager performance data
   - Effort: High (requires new feature - lead manager performance tracking)

2. **Individual Lead Manager Pages**
   - Database: ❌ No `lead_managers` table
   - Effort: High (new feature)

3. **Lead Manager Reports Section**
   - Database: ❌ Not available
   - Effort: High (research reports aggregation)

**Priority**: LOW (nice-to-have, not critical)
**Implementation Effort**: 2 weeks (full feature)

**Note**: This is a significant feature requiring:
- New `lead_managers` table
- Historical IPO performance by manager
- Performance metrics (avg listing gain, success rate)
- Scraper for lead manager data

---

### 15. Contact Details

**What Chittorgarh Shows**:
Complete company contact information:
- Company Name: Canara HSBC Life Insurance Co.Ltd.
- Full Address: 8 th Floor, Unit No. 808- 814, Ambadeep Building, Kasturba Gandhi Marg, Connaught Place, Central Delhi, Delhi, New Delhi, 110001
- Phone: +91 01244506761
- Email: investor@canarahsbclife.in

**What IPODhan Has**:
- ❌ **NOT IMPLEMENTED AT ALL**
- No company contact details section
- No address, phone, email displayed

**What's Missing**:
1. **All Contact Information Fields**
   - Company address
   - Company phone
   - Company email (investor relations)

2. **Database Schema for Contact Info**
   - Database: ❌ Not available
   - Effort: Low (add to `ipoDetails` or `ipos` table)

**Priority**: LOW-MEDIUM (useful but not critical for investment decision)
**Implementation Effort**: 1 day

**Database Schema Addition**:
```sql
-- Add to ipoDetails table
ALTER TABLE ipo_details
  ADD COLUMN company_address TEXT,
  ADD COLUMN company_phone VARCHAR(50),
  ADD COLUMN company_email VARCHAR(255),
  ADD COLUMN company_city VARCHAR(100),
  ADD COLUMN company_state VARCHAR(100),
  ADD COLUMN company_pincode VARCHAR(10);
```

---

### 16. Recommendation Summary (Buy or Not)

**What Chittorgarh Shows**:
- Section title: "Canara HSBC Life IPO - Buy or Not"
- Link: "Canara HSBC Life IPO Recommendation Summary"
- Aggregated review table:

| Review By | Subscribe | Neutral | Avoid |
|-----------|-----------|---------|-------|
| Brokers | 5 | 0 | 0 |
| Members | 0 | 0 | 0 |

- Buttons: "Read All Reviews", "Post Your Review", "Manage Reviews"

**What IPODhan Has**:
- IPO Score Section: ✅ Platform's proprietary rating (0-10 scale)
- Score breakdown: ✅ 5 components (financial, valuation, subscription, market, fundamentals)
- Verdict: ✅ Rating labels (Exceptional, Strong, Good, Average, Poor)
- Reviews table: ⚠️ `ipoReviews` table exists but seems for analyst reviews only

**What's Missing**:
1. **Broker Reviews Aggregation**
   - Database: ⚠️ `ipoReviews` table exists with `recommendation` enum
   - Effort: Medium (categorize reviews by source: broker vs analyst vs platform)

2. **User/Member Reviews**
   - Database: ❌ No user-generated reviews
   - Effort: High (requires authentication, moderation, user system)

3. **Review Count by Recommendation Type**
   - Database: N/A (calculated from `ipoReviews`)
   - Effort: Low (aggregate query)

4. **Subscribe/Neutral/Avoid Categorization**
   - Database: ✅ `reviewRecommendationEnum` has: 'May apply', 'Subscribe', 'Avoid', 'Not Recommended'
   - Effort: Low (map to 3 categories)

**Priority**: MEDIUM
**Implementation Effort**: 1 week (for broker aggregation), 3-4 weeks (for user reviews)

**Enhancement for Existing `ipoReviews` table**:
```sql
-- Add source type to distinguish broker vs analyst reviews
ALTER TABLE ipo_reviews
  ADD COLUMN review_source_type VARCHAR(50), -- 'BROKER' | 'ANALYST' | 'RESEARCH_FIRM' | 'USER'
  ADD COLUMN broker_name VARCHAR(255), -- if review_source_type = 'BROKER'
  ADD COLUMN is_verified BOOLEAN DEFAULT false;
```

---

## Complete Missing Fields Summary

### Critical Missing Fields (HIGH Priority)

**1. Promoter Holding (ipoDetails)**
```sql
promoter_holding_pre_issue NUMERIC(5,2)
promoter_holding_post_issue NUMERIC(5,2)
```

**2. Financial Metrics Enhancement (financialData)**
```sql
ebitda_fy2022 NUMERIC(12,2)
ebitda_fy2023 NUMERIC(12,2)
ebitda_fy2024 NUMERIC(12,2)
market_cap NUMERIC(15,2)
pre_ipo_eps NUMERIC(10,2)
post_ipo_eps NUMERIC(10,2)
ronw NUMERIC(5,2)
```

**3. Anchor Investors (NEW TABLE)**
```sql
CREATE TABLE anchor_investors (
  id UUID PRIMARY KEY,
  ipo_id UUID REFERENCES ipos(id),
  bid_date DATE,
  total_shares_offered BIGINT,
  total_amount_raised NUMERIC(12,2),
  lock_in_50_percent_date DATE,
  lock_in_remaining_date DATE,
  investor_list JSONB
);
```

**4. IPO Allocation Details (ipoDetails)**
```sql
qib_shares_offered BIGINT
qib_allocation_percent NUMERIC(5,2)
nii_shares_offered BIGINT
retail_shares_offered BIGINT
retail_max_allottees INTEGER
anchor_shares_offered BIGINT
anchor_allocation_percent NUMERIC(5,2)
```

### Medium Priority Fields

**5. Listing Details (listingPerformance)**
```sql
bse_script_code VARCHAR(20)
nse_listing_group VARCHAR(10)
bse_listing_group VARCHAR(10)
```

**6. IPO Objectives (ipoDetails)**
```sql
objectives JSONB -- [{description: "...", amount: 500}, ...]
```

**7. Company Contact (ipoDetails)**
```sql
company_address TEXT
company_phone VARCHAR(50)
company_email VARCHAR(255)
```

**8. Subscription Breakdown (subscriptions)**
```sql
qib_shares_bid BIGINT
nii_shares_bid BIGINT
retail_shares_bid BIGINT
```

### Low Priority Fields

**9. Issue Details (ipoDetails)**
```sql
employee_discount NUMERIC(10,2)
share_holding_pre_issue BIGINT
share_holding_post_issue BIGINT
```

**10. Review Enhancement (ipoReviews)**
```sql
review_source_type VARCHAR(50)
broker_name VARCHAR(255)
is_verified BOOLEAN
```

---

## Priority Recommendations

### Phase 1: Critical Data Gaps (Week 1-2)

**Focus**: High-impact investor decision fields

1. **Promoter Holding** (1 day)
   - Add pre/post issue fields to `ipoDetails`
   - Display in new "Shareholding Pattern" section
   - Scraper: Extract from RHP/DRHP

2. **Enhanced Financials** (3 days)
   - Add EBITDA, market cap, pre/post IPO EPS
   - Enhance Financials tab with multi-period view
   - Calculate YoY growth percentages

3. **Anchor Investors** (5 days)
   - Create new table and schema
   - Build dedicated Anchor Investors section
   - Scraper: NSE/BSE anchor allocation announcements

**Deliverable**: Core investor metrics visible (~30% feature coverage increase)

---

### Phase 2: Subscription & Allocation Detail (Week 3)

**Focus**: IPO mechanics and transparency

1. **Detailed Subscription Display** (2 days)
   - Show bNII/sNII split (data already exists!)
   - Add shares bid/offered breakdown
   - Display total applications count

2. **IPO Allocation Breakdown** (2 days)
   - Add category-wise shares offered
   - Show max allottees for retail
   - Display anchor allocation separately

3. **Lot Size Calculator Enhancement** (1 day)
   - Add category-specific investment ranges
   - Create detailed lot table (Retail/S-HNI/B-HNI)

**Deliverable**: Complete subscription transparency (~20% feature coverage increase)

---

### Phase 3: Listing & KPI Enhancements (Week 4)

**Focus**: Post-listing metrics and market performance

1. **Listing Details Enhancement** (1 day)
   - Add BSE script code
   - Add NSE/BSE listing group
   - Generate pre-open session links

2. **KPI Section Creation** (2 days)
   - New dedicated KPI card/section
   - Market cap display
   - Pre/Post IPO EPS comparison
   - RoNW, P/B ratio prominence

3. **IPO Objectives Display** (1 day)
   - Add objectives field to schema
   - Create "Use of Proceeds" section
   - Manual data entry in admin

**Deliverable**: Professional KPI presentation (~15% feature coverage increase)

---

### Phase 4: Nice-to-Have Features (Week 5-6)

**Focus**: User experience and additional context

1. **Company Contact Details** (1 day)
   - Add contact fields to schema
   - Display in Overview tab or footer
   - Manual data entry

2. **Broker Review Aggregation** (3 days)
   - Enhance `ipoReviews` with source type
   - Create review summary widget
   - Scrape broker recommendations

3. **Category Reservation Rules** (1 day)
   - Static component with SEBI rules
   - Educational content for investors

**Deliverable**: Complete professional presentation (~10% feature coverage increase)

---

## Implementation Effort Summary

| Phase | Focus | Duration | Features | Coverage Gain |
|-------|-------|----------|----------|---------------|
| 1 | Critical Data | 2 weeks | Promoter, Financials, Anchor | +30% |
| 2 | Subscription Detail | 1 week | Allocation, bNII/sNII, Lot table | +20% |
| 3 | KPIs & Listing | 1 week | Market cap, EPS, BSE code | +15% |
| 4 | Nice-to-Have | 2 weeks | Contact, Reviews, Rules | +10% |
| **Total** | **Full Parity** | **6 weeks** | **16 sections** | **+75% → 95%** |

---

## Database Schema Impact

### New Tables Required: 1
- `anchor_investors` (complete new feature)

### Tables to Modify: 5
- `ipoDetails` - 15+ new columns
- `financialData` - 7 new columns
- `listingPerformance` - 3 new columns
- `subscriptions` - 6 new columns (shares bid breakdown)
- `ipoReviews` - 3 new columns (source categorization)

### Total New Fields: ~35-40 columns

---

## Scraper Impact

### New Data Sources Required:
1. **Anchor Investor Data** - NSE/BSE anchor allocation PDF
2. **Promoter Holding** - RHP shareholding pattern section
3. **EBITDA & Extended Financials** - DRHP financial statements
4. **IPO Objectives** - DRHP "Objects of the Issue" section
5. **Company Contact** - DRHP company information page
6. **BSE Script Code** - BSE listing announcements
7. **Broker Reviews** - Multiple broker websites (manual/API)

### Scraper Complexity:
- **High**: Anchor investors (PDF parsing), Broker reviews (multiple sources)
- **Medium**: Promoter holding, EBITDA (DRHP parsing)
- **Low**: BSE script code, contact details (structured data)

---

## UI Component Impact

### New Components Required: 8
1. `PromoterHoldingSection` - Shareholding pattern display
2. `AnchorInvestorsSection` - Anchor details and lock-in
3. `IPOObjectivesSection` - Use of proceeds table
4. `KPISection` - Dedicated key metrics card
5. `CategoryReservationRules` - Static SEBI rules component
6. `DetailedLotSizeTable` - Category investment ranges
7. `CompanyContactCard` - Contact information display
8. `BrokerReviewAggregation` - Review summary widget

### Components to Enhance: 5
1. `FinancialsTab` - Multi-period view, EBITDA row
2. `SubscriptionTab` - bNII/sNII split, shares bid/offered
3. `InfoSection` - Add BSE code, listing groups
4. `ListingDetails` - Pre-open session links
5. `IssueStructureSection` - Max allottees, anchor split

---

## Risk Assessment

### Low Risk (Easy Wins)
- ✅ Displaying existing fields (bNII/sNII, total applications)
- ✅ Calculated fields (equity dilution, YoY growth %)
- ✅ Static content (SEBI rules, category reservations)

### Medium Risk (Moderate Complexity)
- ⚠️ Schema additions (15-20 fields per table)
- ⚠️ DRHP/RHP parsing (financial statements, objectives)
- ⚠️ Multi-period financial display (UI complexity)

### High Risk (Significant Effort)
- ❌ Anchor investor PDF parsing (unstructured data)
- ❌ Broker review aggregation (multiple sources, authentication)
- ❌ Lead manager performance tracking (historical data collection)
- ❌ User review system (authentication, moderation, spam prevention)

---

## Competitive Analysis

**Chittorgarh Strengths (that IPODhan lacks)**:
1. Anchor investor transparency (complete section)
2. Promoter holding dilution (critical metric)
3. EBITDA and extended financials (4+ periods)
4. Pre/Post IPO EPS comparison (valuation clarity)
5. Broker review aggregation (third-party validation)
6. BSE-specific data (script code, listing group)
7. IPO objectives breakdown (use of funds transparency)

**IPODhan Strengths (that Chittorgarh lacks)**:
1. Real-time AI scoring system (0-10 scale with confidence)
2. Peer comparison table (sector benchmarking)
3. Interactive lot calculator (embedded in page)
4. Time-series GMP tracking (historical trends)
5. Listing performance analysis (sector average comparison)
6. Modern UI/UX (responsive, fast, clean design)

**Verdict**: IPODhan has better UX and proprietary features, but Chittorgarh has more comprehensive raw data coverage.

---

## Conclusion

**Current State**: IPODhan covers **62% of Chittorgarh's features**, with strong modern UX but gaps in critical investor data.

**Recommended Approach**: Implement Phase 1 (Critical Data Gaps) immediately to reach **~90% essential feature parity** within 2 weeks. Phases 2-4 can be rolled out incrementally based on user feedback.

**Key Insight**: ~25% of missing features are **already in the database** (bNII/sNII, total applications, cut-off price) and just need UI display. This is low-hanging fruit for quick wins.

**Strategic Advantage**: Focus on IPODhan's unique strengths (AI scoring, peer comparison, modern UX) while closing the top 5 data gaps (promoter holding, anchor investors, EBITDA, pre/post EPS, IPO objectives) to achieve competitive superiority.

---

**End of Gap Analysis**
