# Screen to Database Mapping - Financials & Performance

**Last Updated:** 2025-10-30
**Schema Version:** 0029
**Documentation Version:** 3.0 (Split Architecture)
**Part:** 2 of 7

---

**Document:** screen-database-mapping-financials.md
**Domain:** Financial Metrics & Performance Tracking
**Tables Covered:** `financialData`, `listingPerformance`, `peerCompanies`
**Field Coverage:** financialData 43% (12/28), listingPerformance 71% (10/14), peerCompanies 100% (13/13)
**Parent Index:** [Master Index](screen-database-mapping-index.md)
**Related Docs:** [Core IPO](screen-database-mapping-core-ipo.md), [Extended Features](screen-database-mapping-extended.md)

---

## Overview

This document maps UI screens and fields to three financial-related tables:
1. **`financialData`** - Company financial metrics (28 fields total, 12 mapped)
2. **`listingPerformance`** - IPO listing and current performance (14 fields, 10 mapped)
3. **`peerCompanies`** - Peer comparison data (13 fields, 100% mapped ✅)

**Database Schema Source:** `packages/shared/src/db/schema.ts`

**Scrape Sources:**
- Financial metrics: Prospectus Documents (manual extraction)
- Performance data: NSE(1), BSE(2), Historical Scraper
- Peer data: Moneycontrol(3), Manual curation

---

## Table of Contents

1. [IPO Detail Page - Financials Tab](#ipo-detail-page---financials-tab)
2. [IPO Detail Page - Peer Comparison](#ipo-detail-page---peer-comparison)
3. [Performance Trackers](#performance-trackers)
4. [Compare Tool - Financial Metrics](#compare-tool---financial-metrics)
5. [Missing Fields Analysis](#missing-fields-analysis)

---

## IPO Detail Page - Financials Tab

**Route:** `/ipos/[slug]` (Financials Tab)

### Revenue & Profit Metrics
*Table Display (3-Year View)*

| UI Metric | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Revenue FY 2022 | financialData | revenueFy2022 | NUMERIC(12,2) | Prospectus Documents (manual) | IPO Detail Page |
| Revenue FY 2023 | financialData | revenueFy2023 | NUMERIC(12,2) | Prospectus Documents (manual) | IPO Detail Page |
| Revenue FY 2024 | financialData | revenueFy2024 | NUMERIC(12,2) | Prospectus Documents (manual) | IPO Detail Page |
| Net Profit FY 2022 | financialData | profitFy2022 | NUMERIC(12,2) | Prospectus Documents (manual) | IPO Detail Page |
| Net Profit FY 2023 | financialData | profitFy2023 | NUMERIC(12,2) | Prospectus Documents (manual) | IPO Detail Page |
| Net Profit FY 2024 | financialData | profitFy2024 | NUMERIC(12,2) | Prospectus Documents (manual) | IPO Detail Page |

**Notes:**
- All amounts in ₹ Crores
- Manual extraction from DRHP/RHP/Prospectus PDFs
- Updated during IPO filing stage

---

### Financial Ratios
*Card/Grid Display*

| UI Metric | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| EPS (₹) | financialData | eps | NUMERIC(10,2) | Prospectus Documents (manual) | IPO Detail Page |
| P/E Ratio | financialData | peRatio | NUMERIC(10,2) | Prospectus Documents (manual) | IPO Detail Page |
| ROE (%) | financialData | roe | NUMERIC(5,2) | Prospectus Documents (manual) | IPO Detail Page |
| Debt to Equity | financialData | debtToEquity | NUMERIC(10,2) | Prospectus Documents (manual) | IPO Detail Page |
| Total Assets | financialData | totalAssets | NUMERIC(12,2) | Prospectus Documents (manual) | IPO Detail Page |
| Total Borrowing | financialData | totalBorrowing | NUMERIC(12,2) | Prospectus Documents (manual) | IPO Detail Page |

**Calculation Notes:**
- EPS = Net Profit / Outstanding Shares
- P/E = Issue Price / EPS
- ROE = (Net Profit / Equity) × 100
- Debt-to-Equity = Total Debt / Total Equity

---

## IPO Detail Page - Peer Comparison

**Route:** `/ipos/[slug]` (Peer Comparison Section)

**Status:** ✅ **IMPLEMENTED** on 2025-10-20

### Peer Comparison Table
*Horizontal Scroll Table*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | peerCompanies | companyName | VARCHAR(255) | Moneycontrol(3), Manual | IPO Detail Page |
| Sector | peerCompanies | sector | VARCHAR(100) | Moneycontrol(3), Manual | IPO Detail Page (secondary text) |
| Listed | peerCompanies | isListed | BOOLEAN | Moneycontrol(3), Manual | IPO Detail Page |
| PE Ratio | peerCompanies | peRatio | NUMERIC(10,2) | Moneycontrol(3), Manual | IPO Detail Page |
| EPS (₹) | peerCompanies | eps | NUMERIC(10,2) | Moneycontrol(3), Manual | IPO Detail Page |
| RONW (%) | peerCompanies | ronw | NUMERIC(5,2) | Moneycontrol(3), Manual | IPO Detail Page |
| NAV (₹) | peerCompanies | nav | NUMERIC(10,2) | Moneycontrol(3), Manual | IPO Detail Page |
| PBV Ratio | peerCompanies | pbvRatio | NUMERIC(10,2) | Moneycontrol(3), Manual | IPO Detail Page |

**Implementation Details:**
- Component: `web/components/ipo/PeerComparisonSection.tsx` (217 lines)
- Location: IPO Detail Page, after IPO Score Section
- Coverage: 1482 peer records across 494 IPOs
- Features:
  - Responsive design (desktop table + mobile cards)
  - Financial metrics legend with definitions
  - Null/missing data handling
  - Listed/Not Listed status badges
  - Professional table styling with hover effects

**Foreign Key:**
- `ipoId` (UUID) references `ipos.id`
- One-to-many relationship (1 IPO can have 3-5 peer companies)

**Unmapped Fields** (Admin/Metadata):
- `dilutedEps` - Using main `eps` instead
- `financialStatementType` - ENUM (STANDALONE/CONSOLIDATED)
- `dataSource` - VARCHAR(100) - Source tracking
- `lastUpdated` - TIMESTAMP - Update tracking

**Metrics Definitions** (shown in UI):
- **PE Ratio:** Price to Earnings - Lower values may indicate undervaluation
- **EPS:** Earnings Per Share - Higher values indicate better profitability
- **RONW:** Return on Net Worth - Profitability measure
- **NAV:** Net Asset Value per share
- **PBV:** Price to Book Value - Market value vs book value

---

## Performance Trackers

### Mainboard IPO Performance Tracker

**Route:** `/mainboard-ipo-performance-tracker`

#### Performance Table
*Sortable Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3) | Performance Tracker, All Pages |
| Listed On | ipos | listingDate | DATE | NSE(1), BSE(2), Historical Scraper | Performance Tracker |
| Issue Price (₹) | listingPerformance | issuePrice | INTEGER | NSE(1), BSE(2) | Performance Tracker, IPO Detail |
| Listing Day Close (₹) | listingPerformance | listingPrice | INTEGER | NSE(1), BSE(2), Historical Scraper | Performance Tracker, IPO Detail |
| Listing Day Gain (%) | listingPerformance | listingGainPercent | NUMERIC(5,2) | **Calculated** | Performance Tracker, IPO Detail |
| Current Price (₹) | listingPerformance | currentPriceNSE, currentPriceBSE | INTEGER | Historical Scraper | Performance Tracker, IPO Detail |
| Profit/Loss (%) | listingPerformance | currentGainPercent | NUMERIC(5,2) | **Calculated** | Performance Tracker, IPO Detail |

**Calculation Formulas:**
```typescript
listingGainPercent = ((listingPrice - issuePrice) / issuePrice) * 100
currentGainPercent = ((currentPrice - issuePrice) / issuePrice) * 100
```

**Notes:**
- Filtered by: `ipos.segment = 'MAINBOARD'` AND `ipos.status = 'LISTED'`
- Current Price: Shows NSE price preferentially, falls back to BSE
- Color coding: Green for positive gains, Red for losses
- Sortable by all numeric columns

---

### SME IPO Performance Tracker

**Route:** `/sme-ipo-performance-tracker`

#### Performance Table
*Identical structure to Mainboard tracker*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3) | Performance Tracker, All Pages |
| Listed On | ipos | listingDate | DATE | NSE(1), BSE(2), Historical Scraper | Performance Tracker |
| Issue Price (₹) | listingPerformance | issuePrice | INTEGER | NSE(1), BSE(2) | Performance Tracker, IPO Detail |
| Listing Day Close (₹) | listingPerformance | listingPrice | INTEGER | NSE(1), BSE(2), Historical Scraper | Performance Tracker, IPO Detail |
| Listing Day Gain (%) | listingPerformance | listingGainPercent | NUMERIC(5,2) | **Calculated** | Performance Tracker, IPO Detail |
| Current Price (₹) | listingPerformance | currentPriceNSE, currentPriceBSE | INTEGER | Historical Scraper | Performance Tracker, IPO Detail |
| Profit/Loss (%) | listingPerformance | currentGainPercent | NUMERIC(5,2) | **Calculated** | Performance Tracker, IPO Detail |

**Notes:**
- Filtered by: `ipos.segment = 'SME'` AND `ipos.status = 'LISTED'`
- Zero cross-contamination with MAINBOARD (Phase 4 validated)

---

### IPO Detail Page - Listing Performance Section

**Route:** `/ipos/[slug]` (Performance Metrics Card)

| UI Metric | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Issue Price | listingPerformance | issuePrice | INTEGER | NSE(1), BSE(2) | IPO Detail Page |
| Listing Price | listingPerformance | listingPrice | INTEGER | NSE(1), BSE(2), Historical Scraper | IPO Detail Page, Performance Trackers |
| Listing Day Return | listingPerformance | listingGainPercent | NUMERIC(5,2) | **Calculated** | IPO Detail Page, Performance Trackers |
| Current Price (NSE) | listingPerformance | currentPriceNSE | INTEGER | Historical Scraper | IPO Detail Page, Performance Trackers |
| Current Price (BSE) | listingPerformance | currentPriceBSE | INTEGER | Historical Scraper | IPO Detail Page, Performance Trackers |
| Overall Return | listingPerformance | currentGainPercent | NUMERIC(5,2) | **Calculated** | IPO Detail Page, Performance Trackers |

**Foreign Key:**
- `ipoId` (UUID) references `ipos.id`
- One-to-one relationship

---

## Compare Tool - Financial Metrics

**Route:** `/tools/compare`

### Financial Comparison Fields
*Side-by-Side Display (2-4 IPOs)*

| UI Field | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------|----------|-----------|------|----------------|-----------------|
| PE Ratio | financialData | peRatio | NUMERIC(10,2) | Prospectus Documents | Compare Tool |
| EPS | financialData | eps | NUMERIC(10,2) | Prospectus Documents | Compare Tool |
| ROE | financialData | roe | NUMERIC(5,2) | Prospectus Documents | Compare Tool |
| Revenue (Latest FY) | financialData | revenueFy2024 | NUMERIC(12,2) | Prospectus Documents | Compare Tool |
| Profit (Latest FY) | financialData | profitFy2024 | NUMERIC(12,2) | Prospectus Documents | Compare Tool |

**Notes:**
- Highlights best/worst values across compared IPOs
- Empty cells for missing data
- Color-coded performance indicators

---

## Missing Fields Analysis

### financialData Table - Unmapped Fields (16 fields)

**⚠️ HIGH PRIORITY - Advanced Financial Metrics**

#### Balance Sheet Metrics (2 fields)

| DB Field | Type | Purpose | Priority |
|----------|------|---------|----------|
| netWorth | NUMERIC(12,2) | Net worth in crores | Medium |
| reservesAndSurplus | NUMERIC(12,2) | Reserves and surplus | Medium |

---

#### Promoter Holding (2 fields - Story 11.9)

| DB Field | Type | Purpose | Priority |
|----------|------|---------|----------|
| promoterHoldingPreIssue | NUMERIC(5,2) | Pre-issue promoter % | **High** |
| promoterHoldingPostIssue | NUMERIC(5,2) | Post-issue promoter % | **High** |

**Impact:** Promoter holding dilution not shown. Important governance signal.

**Recommendation:** Add "Promoter Holding" section showing pre/post IPO percentages.

---

#### KPI Highlights (4 fields - Story 11.11)

| DB Field | Type | Purpose | Priority |
|----------|------|---------|----------|
| marketCap | NUMERIC(15,2) | Market capitalization | **High** |
| preIpoEps | NUMERIC(10,2) | Pre-IPO EPS | Medium |
| postIpoEps | NUMERIC(10,2) | Post-IPO EPS | Medium |
| ronw | NUMERIC(5,2) | Return on Net Worth % | **High** |

**Impact:** Key valuation metrics missing from summary cards.

**Recommendation:** Add "Key Highlights" card with Market Cap, RONW, Post-IPO EPS.

---

#### Enhanced Metrics (8 fields - Story 11.12)

| DB Field | Type | Purpose | Priority |
|----------|------|---------|----------|
| ebitdaFy2022 | NUMERIC(12,2) | EBITDA FY2022 | Medium |
| ebitdaFy2023 | NUMERIC(12,2) | EBITDA FY2023 | Medium |
| ebitdaFy2024 | NUMERIC(12,2) | EBITDA FY2024 | Medium |
| totalIncomeFy2022 | NUMERIC(12,2) | Total income FY2022 | Low |
| totalIncomeFy2023 | NUMERIC(12,2) | Total income FY2023 | Low |
| totalIncomeFy2024 | NUMERIC(12,2) | Total income FY2024 | Low |
| currentRatio | NUMERIC(5,2) | Current ratio | **High** |
| quickRatio | NUMERIC(5,2) | Quick ratio | **High** |
| inventoryTurnover | NUMERIC(5,2) | Inventory turnover | Medium |

**Impact:** Advanced liquidity and profitability ratios not available.

**Recommendation:** Add "Advanced Metrics" accordion with:
- Liquidity: Current Ratio, Quick Ratio
- Profitability: EBITDA margins
- Efficiency: Inventory Turnover

---

### listingPerformance Table - Unmapped Fields (4 fields)

| DB Field | Type | Status | Reason |
|----------|------|--------|--------|
| symbol | VARCHAR(20) | Duplicate | From `ipos` table |
| companyName | VARCHAR(255) | Duplicate | From `ipos` table |
| currentPrice | INTEGER | **@deprecated** | Use currentPriceNSE/BSE instead |
| dataSource | ENUM | Admin metadata | MANUAL/SCRAPER/NSE_PAST_API |

**Notes:**
- `currentPrice` marked deprecated - UI correctly uses exchange-specific prices
- `dataSource` used for scraper monitoring, not user-facing

---

### Alternative Table - ipoFinancials (14 fields - Unused)

**⚠️ DUPLICATE TABLE**

The `ipoFinancials` table exists but is **not used**. It has more comprehensive metrics than `financialData`:

| Unique Fields | Type | Purpose |
|--------------|------|---------|
| pbRatio | NUMERIC(8,2) | Price-to-Book ratio |
| rocePercentage | NUMERIC(5,2) | Return on Capital Employed % |
| industryPe | NUMERIC(8,2) | Industry average P/E |
| peerCompanies | TEXT[] | Array of peer names |
| financialYearEnd | VARCHAR(10) | FY end month |

**Recommendation:** Evaluate migrating from `financialData` to `ipoFinancials` for richer metrics.

---

## Schema Reference

### financialData Table Structure

```typescript
// From packages/shared/src/db/schema.ts
export const financialData = pgTable('financial_data', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').references(() => ipos.id, { onDelete: 'cascade' }).unique(),

  // Revenue & Profit (3 FYs)
  revenueFy2022: numeric('revenue_fy2022', { precision: 12, scale: 2 }),
  revenueFy2023: numeric('revenue_fy2023', { precision: 12, scale: 2 }),
  revenueFy2024: numeric('revenue_fy2024', { precision: 12, scale: 2 }),
  profitFy2022: numeric('profit_fy2022', { precision: 12, scale: 2 }),
  profitFy2023: numeric('profit_fy2023', { precision: 12, scale: 2 }),
  profitFy2024: numeric('profit_fy2024', { precision: 12, scale: 2 }),

  // Balance Sheet
  totalAssets: numeric('total_assets', { precision: 12, scale: 2 }),
  totalBorrowing: numeric('total_borrowing', { precision: 12, scale: 2 }),
  netWorth: numeric('net_worth', { precision: 12, scale: 2 }),
  reservesAndSurplus: numeric('reserves_and_surplus', { precision: 12, scale: 2 }),

  // Ratios (Currently Mapped)
  eps: numeric('eps', { precision: 10, scale: 2 }),
  peRatio: numeric('pe_ratio', { precision: 10, scale: 2 }),
  roe: numeric('roe', { precision: 5, scale: 2 }),
  debtToEquity: numeric('debt_to_equity', { precision: 10, scale: 2 }),

  // Promoter Holding (Story 11.9 - UNMAPPED)
  promoterHoldingPreIssue: numeric('promoter_holding_pre_issue', { precision: 5, scale: 2 }),
  promoterHoldingPostIssue: numeric('promoter_holding_post_issue', { precision: 5, scale: 2 }),

  // KPI Highlights (Story 11.11 - UNMAPPED)
  marketCap: numeric('market_cap', { precision: 15, scale: 2 }),
  preIpoEps: numeric('pre_ipo_eps', { precision: 10, scale: 2 }),
  postIpoEps: numeric('post_ipo_eps', { precision: 10, scale: 2 }),
  ronw: numeric('ronw', { precision: 5, scale: 2 }),

  // Enhanced Metrics (Story 11.12 - UNMAPPED)
  ebitdaFy2022: numeric('ebitda_fy2022', { precision: 12, scale: 2 }),
  ebitdaFy2023: numeric('ebitda_fy2023', { precision: 12, scale: 2 }),
  ebitdaFy2024: numeric('ebitda_fy2024', { precision: 12, scale: 2 }),
  totalIncomeFy2022: numeric('total_income_fy2022', { precision: 12, scale: 2 }),
  totalIncomeFy2023: numeric('total_income_fy2023', { precision: 12, scale: 2 }),
  totalIncomeFy2024: numeric('total_income_fy2024', { precision: 12, scale: 2 }),
  currentRatio: numeric('current_ratio', { precision: 5, scale: 2 }),
  quickRatio: numeric('quick_ratio', { precision: 5, scale: 2 }),
  inventoryTurnover: numeric('inventory_turnover', { precision: 5, scale: 2 }),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

**Total Fields:** 28
**Documented & Mapped:** 12 (43%)
**Unmapped:** 16 (57%)

---

### listingPerformance Table Structure

```typescript
export const listingPerformance = pgTable('listing_performance', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').references(() => ipos.id, { onDelete: 'cascade' }).unique(),

  // Listing Metrics
  issuePrice: integer('issue_price'),
  listingPrice: integer('listing_price'),
  listingGainPercent: numeric('listing_gain_percent', { precision: 5, scale: 2 }),

  // Current Performance
  currentPriceNSE: integer('current_price_nse'),
  currentPriceBSE: integer('current_price_bse'),
  currentGainPercent: numeric('current_gain_percent', { precision: 5, scale: 2 }),

  // Deprecated
  currentPrice: integer('current_price'), // @deprecated - use exchange-specific

  // Metadata
  symbol: varchar('symbol', { length: 20 }),
  companyName: varchar('company_name', { length: 255 }),
  listingDate: date('listing_date'),
  dataSource: varchar('data_source', { length: 50 }), // MANUAL/SCRAPER/NSE_PAST_API

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  lastUpdated: timestamp('last_updated'), // @deprecated
});
```

**Total Fields:** 14
**Documented & Mapped:** 10 (71%)
**Unmapped/Deprecated:** 4 (29%)

---

### peerCompanies Table Structure

```typescript
export const peerCompanies = pgTable('peer_companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').references(() => ipos.id, { onDelete: 'cascade' }),

  // Company Info
  companyName: varchar('company_name', { length: 255 }).notNull(),
  sector: varchar('sector', { length: 100 }),
  isListed: boolean('is_listed').default(true),

  // Financial Metrics (ALL MAPPED)
  peRatio: numeric('pe_ratio', { precision: 10, scale: 2 }),
  eps: numeric('eps', { precision: 10, scale: 2 }),
  dilutedEps: numeric('diluted_eps', { precision: 10, scale: 2 }),
  ronw: numeric('ronw', { precision: 5, scale: 2 }),
  nav: numeric('nav', { precision: 10, scale: 2 }),
  pbvRatio: numeric('pbv_ratio', { precision: 10, scale: 2 }),

  // Metadata
  financialStatementType: varchar('financial_statement_type', { length: 20 }), // STANDALONE/CONSOLIDATED
  dataSource: varchar('data_source', { length: 100 }),
  lastUpdated: timestamp('last_updated'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

**Total Fields:** 13
**Documented & Mapped:** 13 (100%) ✅
**Status:** FULLY IMPLEMENTED on 2025-10-20

---

## Related Documentation

- **[Master Index](screen-database-mapping-index.md)** - Navigation hub
- **[Core IPO](screen-database-mapping-core-ipo.md)** - IPO entity and basic info
- **[Extended Features](screen-database-mapping-extended.md)** - ipoFinancials alternative table
- **[Scraper Priority Matrix](database-schema-scraper-mapping.md)** - Field-to-scraper mapping

---

**Last Updated:** 2025-10-30
**Maintainer:** FinTech Team
**Review Frequency:** Monthly
