# IPO Detail Page - Missing Features Summary

**Based on**: Chittorgarh.com IPO Detail Page Analysis
**Date**: 2025-10-26
**Current Coverage**: 62% of Chittorgarh features implemented

---

## Critical Missing Features (Priority 1)

### 1. Promoter Holding Section (0% Complete)
**Status**: ❌ NOT IMPLEMENTED
**Impact**: HIGH - Critical investor information

**Missing Information**:
- Pre-IPO promoter shareholding (number of shares + %)
- Post-IPO promoter shareholding (number of shares + %)
- Promoter dilution percentage
- List of individual promoters with shareholding breakdown
- Promoter categories (Individual, Corporate, etc.)

**Database Status**: ❌ Table doesn't exist
**Required**: New table `promoter_holdings` with fields:
- `promoterName`, `category`, `preIpoShares`, `preIpoPercent`
- `postIpoShares`, `postIpoPercent`, `dilutionPercent`

**Implementation Effort**: 4-5 days (database + UI)

---

### 2. Anchor Investors Details (0% Complete)
**Status**: ❌ NOT IMPLEMENTED
**Impact**: HIGH - Key institutional confidence signal

**Missing Information**:
- Anchor investor names
- Allocation amount (₹ Crores)
- Number of shares allocated
- Percentage of total issue
- Lock-in period details
- Allocation date
- Total anchor book size

**Database Status**: ❌ Table doesn't exist
**Required**: New table `anchor_investors` with fields:
- `investorName`, `investorType`, `sharesAllocated`, `amountCrores`
- `percentOfIssue`, `lockInPeriod`, `allocationDate`

**Implementation Effort**: 3-4 days (database + UI)

---

### 3. IPO Objectives (0% Complete)
**Status**: ❌ NOT IMPLEMENTED
**Impact**: HIGH - Helps investors understand fund usage

**Missing Information**:
- Objects of the issue (why raising money?)
- Detailed fund utilization breakdown:
  - Debt repayment (₹X Cr)
  - Working capital (₹X Cr)
  - Capital expenditure (₹X Cr)
  - General corporate purposes (₹X Cr)
  - Acquisitions (₹X Cr)
- Percentage allocation per objective
- Timeline for fund deployment

**Database Status**: ❌ Fields don't exist
**Required**: Add to `ipoDetails` table (JSONB column):
- `objectives` JSONB array: `[{objective, amount, percent, timeline}]`

**Implementation Effort**: 2-3 days (database + UI)

---

### 4. Company Contact Details (0% Complete)
**Status**: ❌ NOT IMPLEMENTED
**Impact**: MEDIUM - Investor relations contact

**Missing Information**:
- Registered office address (full address with pincode)
- Corporate office address
- Phone number
- Fax number
- Email address
- Company website URL
- Investor relations email
- Compliance officer name + contact

**Database Status**: ⚠️ Partially exists
- ✅ `ipos.website` exists
- ❌ Address, phone, email don't exist

**Required**: Add to `ipos` table:
- `registeredAddress`, `corporateAddress`, `phone`, `email`
- `investorRelationsEmail`, `complianceOfficer`

**Implementation Effort**: 1-2 days (database + UI)

---

### 5. Category-wise Reservation Details (0% Complete)
**Status**: ❌ NOT IMPLEMENTED
**Impact**: MEDIUM-HIGH - Shows exact allocation percentages

**Missing Information**:
- QIB (Qualified Institutional Buyers) reservation %
- Non-Institutional Investors (NII) reservation %
- Retail Individual Investors (RII) reservation %
- Employee reservation (if applicable) %
- Maximum shares per category
- Maximum allottees per category

**Database Status**: ✅ Mostly exists in `ipoDetails`
- ✅ `qibReservation`, `niiReservation`, `retailReservation`
- ❌ Missing: `maxSharesPerCategory`, `maxAllotteesPerCategory`

**Implementation Effort**: 1 day (UI only, data exists)

---

## Important Missing Features (Priority 2)

### 6. Enhanced Financial Metrics (55% Complete)
**Status**: ⚠️ PARTIALLY IMPLEMENTED

**Currently Have**:
- ✅ Revenue FY2023
- ✅ Profit FY2023
- ✅ Basic P/E ratio
- ✅ Net worth

**Missing**:
- EBITDA (Earnings Before Interest, Tax, Depreciation, Amortization)
- Reserves & Surplus
- Total Borrowings
- Multi-year comparison (FY2021, FY2022, FY2023 side-by-side)
- Growth percentages YoY
- Total assets
- Current ratio
- Quick ratio
- Inventory turnover

**Database Status**: ⚠️ Partially exists
- ✅ Revenue/Profit for multiple FYs exist
- ❌ Missing: EBITDA, Reserves, Borrowings, Ratios

**Implementation Effort**: 3-4 days (database + UI enhancements)

---

### 7. KPI Highlight Section (40% Complete)
**Status**: ⚠️ PARTIALLY IMPLEMENTED

**Currently Have**:
- ✅ Basic financial metrics scattered across tabs

**Missing Dedicated KPI Display**:
- Market Capitalization (₹ Crores)
- Price/Book Value (P/BV) ratio
- Return on Net Worth (RoNW) %
- Return on Equity (ROE) %
- Pre-IPO EPS vs Post-IPO EPS comparison
- Debt/Equity ratio prominently displayed

**Database Status**: ✅ Most data exists
- ✅ ROE, P/E ratio fields exist
- ❌ Missing: Market cap calculation, pre/post EPS fields

**Implementation Effort**: 2 days (mostly UI, add KPI card component)

---

### 8. Enhanced Subscription Breakdown (85% Complete)
**Status**: ⚠️ MOSTLY IMPLEMENTED

**Currently Have**:
- ✅ Total subscription multiplier
- ✅ Retail, HNI, QIB subscriptions (in tab)

**Missing**:
- bNII (Big Non-Institutional) vs sNII (Small Non-Institutional) split
- Total number of applications received
- Number of applications per category
- Average lot size per application
- Real-time bid analysis (price-wise bidding data)

**Database Status**: ✅ Schema supports it
- ✅ `subscriptions.retailSubscription`, `hniSubscription`, `qibSubscription`
- ❌ Missing: bNII/sNII split columns, application counts

**Implementation Effort**: 2-3 days (database + UI)

---

### 9. Lot Size Investment Table (95% Complete)
**Status**: ⚠️ MOSTLY IMPLEMENTED (have basic calculator)

**Currently Have**:
- ✅ Basic lot calculator

**Missing Detailed Table**:
```
Application     | Lots | Shares | Amount
Retail (Min)    | 1    | 140    | ₹14,840
Retail (Max)    | 13   | 1,820  | ₹1,92,920
S-HNI (Min)     | 14   | 1,960  | ₹2,07,760
S-HNI (Max)     | 67   | 9,380  | ₹9,94,280
B-HNI (Min)     | 68   | 9,520  | ₹10,09,120
B-HNI (Max)     | ∞    | -      | -
```

**Database Status**: ✅ Data exists (can calculate)
**Implementation Effort**: 1 day (UI enhancement to lot calculator)

---

### 10. Recommendation Summary/Reviews (20% Complete)
**Status**: ⚠️ MINIMAL IMPLEMENTATION

**Currently Have**:
- ✅ IPODhan proprietary score

**Missing**:
- Broker recommendations aggregation (Apply/Avoid/Subscribe)
- Member/User reviews summary
- Expert analyst opinions
- Review count and average rating
- Sentiment analysis (% positive vs negative)
- Top reasons to Apply/Avoid

**Database Status**: ✅ Table exists
- ✅ `ipoReviews` table exists
- ❌ Not populated with data, not displayed in UI

**Implementation Effort**: 3-4 days (scraper + UI for review aggregation)

---

## Nice-to-Have Features (Priority 3)

### 11. Enhanced Listing Details (90% Complete)

**Missing**:
- BSE scrip code
- NSE listing group (EQ, BE, etc.)
- Listing segment details

**Database Status**: ❌ Not in schema
**Implementation Effort**: 1 day

---

### 12. Lead Manager Performance Tracking (90% Complete)

**Missing**:
- Historical performance link for lead managers
- Success rate of past IPOs managed
- Average listing gain of managed IPOs

**Database Status**: ❌ Not tracked
**Implementation Effort**: 5-7 days (requires historical data analysis)

---

## Quick Wins (Data Exists, Just Needs Display)

These features have data in the database but aren't displayed in UI:

1. **Cut-off Price** - ✅ `ipoDetails.cutOffPrice`
   - Display in IPO Details section
   - Effort: 0.5 day

2. **Fresh Issue vs OFS Split** - ✅ `ipoDetails.freshIssue`, `ipoDetails.ofsIssue`
   - Show breakdown in Issue Size
   - Effort: 0.5 day

3. **QIB/NII/Retail Reservation %** - ✅ In `ipoDetails`
   - Display Category Reservations section
   - Effort: 1 day

4. **Reserves & Surplus** - ✅ `financialData.reservesAndSurplus`
   - Add to financials tab
   - Effort: 0.5 day

---

## Database Schema Changes Required

### New Tables Needed (2)

1. **`promoter_holdings`**
```sql
CREATE TABLE promoter_holdings (
  id UUID PRIMARY KEY,
  ipo_id UUID REFERENCES ipos(id),
  promoter_name VARCHAR(255),
  promoter_category VARCHAR(50), -- Individual, Corporate, etc.
  pre_ipo_shares BIGINT,
  pre_ipo_percent DECIMAL(5,2),
  post_ipo_shares BIGINT,
  post_ipo_percent DECIMAL(5,2),
  dilution_percent DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT NOW()
);
```

2. **`anchor_investors`**
```sql
CREATE TABLE anchor_investors (
  id UUID PRIMARY KEY,
  ipo_id UUID REFERENCES ipos(id),
  investor_name VARCHAR(255),
  investor_type VARCHAR(100), -- Mutual Fund, FII, DII, Insurance, etc.
  shares_allocated BIGINT,
  amount_crores DECIMAL(10,2),
  percent_of_issue DECIMAL(5,2),
  lock_in_period VARCHAR(50), -- "30 days", "6 months", etc.
  allocation_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Columns to Add to Existing Tables

**`ipos` table**: Add 6 columns
- `registered_address` TEXT
- `corporate_address` TEXT
- `phone` VARCHAR(20)
- `email` VARCHAR(255)
- `investor_relations_email` VARCHAR(255)
- `compliance_officer` VARCHAR(255)

**`ipoDetails` table**: Add 10 columns
- `employee_discount` DECIMAL(5,2)
- `share_holding_pre_issue` BIGINT
- `share_holding_post_issue` BIGINT
- `total_issue_shares` BIGINT
- `objectives` JSONB -- Array of {objective, amount, percent, timeline}
- `max_shares_per_qib` BIGINT
- `max_shares_per_nii` BIGINT
- `max_shares_per_retail` BIGINT
- `bse_scrip_code` VARCHAR(20)
- `nse_listing_group` VARCHAR(10)

**`financialData` table**: Add 8 columns
- `ebitda` DECIMAL(12,2)
- `total_borrowings` DECIMAL(12,2)
- `total_assets` DECIMAL(12,2)
- `current_ratio` DECIMAL(5,2)
- `quick_ratio` DECIMAL(5,2)
- `inventory_turnover` DECIMAL(5,2)
- `pre_ipo_eps` DECIMAL(5,2)
- `post_ipo_eps` DECIMAL(5,2)

**`subscriptions` table**: Add 3 columns
- `bnii_subscription` DECIMAL(5,2) -- Big NII
- `snii_subscription` DECIMAL(5,2) -- Small NII
- `total_applications` BIGINT

---

## Implementation Timeline

### Phase 1: Critical Features (Weeks 1-2) - 30% Coverage Gain

**Week 1**:
1. Promoter Holdings (5 days)
   - Create database table
   - Build UI component
   - Add to IPO detail page

**Week 2**:
2. Anchor Investors (4 days)
   - Create database table
   - Build UI component
   - Add to IPO detail page

3. IPO Objectives (3 days)
   - Add JSONB column to ipoDetails
   - Build UI component

**Impact**: +30% feature coverage (62% → 92%)

---

### Phase 2: Important Enhancements (Week 3) - 20% Coverage Gain

**Days 1-2**:
4. Enhanced Financials (2 days)
   - Add missing columns (EBITDA, Reserves, Borrowings)
   - Update financials tab with multi-year view

**Days 3-4**:
5. KPI Highlight Section (2 days)
   - Create KPI card component
   - Display market cap, RoNW, P/BV, ROE prominently

**Day 5**:
6. Category Reservations Display (1 day)
   - Use existing ipoDetails data
   - Create reservation breakdown UI

**Impact**: +20% feature coverage (92% → 112% - exceeding Chittorgarh)

---

### Phase 3: Nice-to-Have (Week 4) - 15% Polish

**Days 1-2**:
7. Enhanced Subscription Details (2 days)
   - Add bNII/sNII split columns
   - Display applications count

**Days 3-4**:
8. Company Contact Details (2 days)
   - Add address/phone/email columns
   - Create contact info card

**Day 5**:
9. Quick Wins (1 day)
   - Display cut-off price
   - Show Fresh/OFS split
   - Add reserves to financials

**Impact**: Refinement and polish

---

## ROI Analysis

### Current State:
- **62% feature parity** with Chittorgarh
- **6 major features** (0% complete) missing
- **~35% of data** already in database but not displayed

### After Phase 1 (2 weeks):
- **92% feature parity**
- All critical investor information available
- Competitive with or exceeding Chittorgarh

### Effort vs Impact:
- **Total effort**: 4 weeks (1 developer)
- **Impact**: +50% feature coverage
- **User value**: HIGH (professional-grade IPO analysis)

---

## Priority Ranking (Implementation Order)

### Must Have (Week 1-2):
1. **Promoter Holdings** - Critical for investment decisions
2. **Anchor Investors** - Strong confidence signal
3. **IPO Objectives** - Transparency on fund usage

### Should Have (Week 3):
4. **Enhanced Financials** - Better analysis capability
5. **KPI Section** - Quick insights
6. **Category Reservations** - Allocation clarity

### Could Have (Week 4):
7. **Subscription Details** - Granular tracking
8. **Contact Details** - Investor relations
9. **Quick Wins** - Polish existing features

---

## Competitive Analysis

### Chittorgarh Strengths (What We're Missing):
1. ✅ Comprehensive promoter holding display
2. ✅ Detailed anchor investor list
3. ✅ Clear IPO objectives breakdown
4. ✅ Multi-year financial comparison (3 FYs side-by-side)
5. ✅ Dedicated KPI highlight cards
6. ✅ bNII/sNII subscription split
7. ✅ Company contact details

### IPODhan Strengths (What We Have That They Don't):
1. ✅ Real-time IPO scoring with AI
2. ✅ Peer comparison table
3. ✅ Interactive lot calculator
4. ✅ Sector average comparison for listings
5. ✅ Affiliate integration for easy application
6. ✅ Clean, modern UI/UX
7. ✅ Mobile-optimized design

### After Implementation:
**IPODhan** will have **feature parity + unique differentiators**, positioning as the premium IPO research platform.

---

## Technical Notes

### Scraper Impact:
- **2 new scrapers** needed:
  1. Promoter holdings scraper (from DRHP/RHP)
  2. Anchor investor scraper (from allotment list)

- **Existing scrapers to enhance**:
  3. Financial scraper (add EBITDA, borrowings)
  4. Subscription scraper (add bNII/sNII, applications)

### Data Sources:
- **Promoter Holdings**: DRHP Section "Capital Structure"
- **Anchor Investors**: Allotment list published post-anchor allocation
- **IPO Objectives**: DRHP Section "Objects of the Issue"
- **Enhanced Financials**: DRHP Section "Financial Statements"

### Testing Requirements:
- **Integration tests**: 4 new test suites (promoters, anchors, objectives, enhanced financials)
- **E2E tests**: Update IPO detail page E2E to verify new sections
- **Data validation**: Ensure scraped data accuracy (manual spot-checking)

---

## Conclusion

**Current Gap**: 38% of Chittorgarh features missing
**Critical Gaps**: 6 major sections (0% implemented)
**Implementation Timeline**: 4 weeks to achieve 95%+ parity
**Resource Requirement**: 1 full-stack developer
**Business Impact**: HIGH - Professional-grade IPO analysis platform

**Recommendation**: Prioritize Phase 1 (Promoter Holdings, Anchor Investors, IPO Objectives) for immediate implementation to close the most visible and impactful gaps.

---

**For detailed section-by-section analysis, see**: `CHITTORGARH_GAP_ANALYSIS.md` (37KB comprehensive breakdown)
