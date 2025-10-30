# Screen to Database Mapping - Core IPO Entity

**Last Updated:** 2025-10-30
**Schema Version:** 0029
**Documentation Version:** 3.0 (Split Architecture)
**Part:** 1 of 7

---

**Document:** screen-database-mapping-core-ipo.md
**Domain:** Core IPO Data
**Tables Covered:** `ipos` (primary)
**Field Coverage:** 52% (28/54 fields documented)
**Parent Index:** [Master Index](screen-database-mapping-index.md)
**Related Docs:** [Financials](screen-database-mapping-financials.md), [Subscription & GMP](screen-database-mapping-subscription-gmp.md)

---

## Overview

This document maps UI screens and fields to the **`ipos` table**, which is the central entity of the IPODhan platform. The `ipos` table contains 54 fields total, of which 28 are currently displayed in the UI.

**Database Schema Source:** `packages/shared/src/db/schema.ts` (canonical)
**Re-exported via:** `web/lib/db/index.ts`

**Scrape Source Priority:** NSE(1) → BSE(2) → Moneycontrol(3) → Chittorgarh(4) → API_Fallback(5)

---

## Table of Contents

1. [Homepage Sections](#homepage-sections)
2. [IPO Detail Page - Basic Info](#ipo-detail-page---basic-info)
3. [Dashboard](#dashboard)
4. [Mainboard IPO Pages](#mainboard-ipo-pages)
5. [SME IPO Pages](#sme-ipo-pages)
6. [Compare IPOs Tool](#compare-ipos-tool)
7. [Lot Calculator](#lot-calculator)
8. [Other Category Pages](#other-category-pages)
9. [Missing Fields Analysis](#missing-fields-analysis)

---

## Homepage Sections

### IPO 2025 List (Mainboard)
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Issuer Company | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, IPO List Pages, Dashboard |
| Open | ipos | openDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, IPO List Pages, Dashboard |
| Close | ipos | closeDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, IPO List Pages, Dashboard |

**Notes:**
- Filtered by: `segment = 'MAINBOARD'` AND `status IN ('UPCOMING', 'OPEN', 'CLOSED')`
- Sorted by: `openDate DESC`

---

### SME IPO 2025 List
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Issuer Company | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, SME IPO Pages, Dashboard |
| Open | ipos | openDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, SME IPO Pages, Dashboard |
| Close | ipos | closeDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, SME IPO Pages, Dashboard |

**Notes:**
- Filtered by: `segment = 'SME'` AND `status IN ('UPCOMING', 'OPEN', 'CLOSED')`
- Sorted by: `openDate DESC`

---

### Upcoming Mainboard IPOs (Filed with SEBI)
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, Mainboard IPO Pages |
| Status | ipos | status | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Homepage, All IPO Pages |
| Date | ipos | openDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, All IPO Pages |

**Status Enum:** UPCOMING, OPEN, CLOSED, LISTED, WITHDRAWN, DEFERRED

**Notes:**
- Filtered by: `segment = 'MAINBOARD'` AND `status = 'UPCOMING'`
- Sorted by: `openDate ASC` (nearest first)

---

### Upcoming SME IPOs (Filed with BSE/NSE)
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, SME IPO Pages |
| Status | ipos | status | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Homepage, All IPO Pages |
| Date | ipos | openDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, All IPO Pages |

**Notes:**
- Filtered by: `segment = 'SME'` AND `status = 'UPCOMING'`
- Sorted by: `openDate ASC`

---

## IPO Detail Page - Basic Info

**Route:** `/ipos/[slug]`

### IPO Header (Hero Section)
*Detail View Fields*

| UI Field Label | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| Company Logo | ipos | - | - | Manual Upload | IPO Detail Page |
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | IPO Detail Page, All Lists |
| Status Badge | ipos | status | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | IPO Detail Page, All Lists |
| Category Badge | ipos | segment | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | IPO Detail Page, All Lists |
| Sector | ipos | sector | VARCHAR(100) | NSE(1), BSE(2), Moneycontrol(3) | IPO Detail Page |
| IPODhan Rating | ipos | rating | INTEGER | Internal Rating Algorithm | IPO Detail Page |
| Rating Rationale | ipos | ratingRationale | TEXT | Internal Rating Algorithm | IPO Detail Page |

**⚠️ Field Name Update:**
- Document shows `category` but schema uses `segment` (enum: MAINBOARD, SME, nullable) + `offeringType` (enum: IPO, FPO, RIGHTS, etc.)
- Migration 0015 restructured this field

**Segment Enum Values:**
- `MAINBOARD` - Large cap IPOs
- `SME` - Small & Medium Enterprises
- `null` - For RIGHTS/InvITs/REITs/NCDs (use `offeringType` instead)

---

### Key Metrics Cards
*Detail View Fields*

| UI Field Label | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| Issue Size | ipos | issueSize | NUMERIC(12,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | IPO Detail Page, Lists |

**Note:** Subscription and GMP metrics shown here reference other tables - see [Subscription & GMP](screen-database-mapping-subscription-gmp.md)

---

### IPO Details Section
*Detail View Fields*

| UI Field Label | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| Open Date | ipos | openDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | IPO Detail Page, Lists |
| Close Date | ipos | closeDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | IPO Detail Page, Lists |
| Allotment Date | ipos | allotmentDate | DATE | NSE(1), BSE(2), Moneycontrol(3) | IPO Detail Page |
| Listing Date | ipos | listingDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4) | IPO Detail Page, Lists |
| Price Range | ipos | priceRangeMin, priceRangeMax | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | IPO Detail Page |
| Face Value | ipos | faceValue | INTEGER | NSE(1), BSE(2), Moneycontrol(3) | IPO Detail Page |
| Lot Size | ipos | lotSize | INTEGER | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | IPO Detail Page, Calculators |
| Listing Exchanges | ipos | listingExchanges | JSONB | NSE(1), BSE(2), Moneycontrol(3) | IPO Detail Page |
| Registrar | ipos | registrar | VARCHAR(255) | NSE(1), BSE(2) + Registrars Scraper | IPO Detail Page, Registrar Pages |
| Lead Managers | ipos | leadManagers | JSONB | NSE(1), BSE(2) | IPO Detail Page |

**⚠️ Field Name Updates:**
- `price_band_low/high` → `priceRangeMin/Max` (actual schema names)

**JSONB Field Formats:**
- `listingExchanges`: `["NSE", "BSE"]` or `["NSE"]` or `["BSE"]`
- `leadManagers`: `["ICICI Securities", "Kotak Mahindra", "Axis Capital"]`

**Foreign Key:**
- `registrarId` (UUID) references `registrars.id`
- Display uses `registrar` (VARCHAR) for backward compatibility

---

### Company Description Section
*Detail View Fields*

| UI Field Label | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| About Company | ipos | companyDescription | TEXT | NSE(1), BSE(2), Moneycontrol(3) | IPO Detail Page |

**Note:** Limited to first 500 characters with "Read More" expansion

---

## Dashboard

**Route:** `/dashboard`

### Active IPOs Widget
*Card Display*

| UI Field | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Dashboard, All Lists |
| Status | ipos | status | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Dashboard, All Lists |
| Open Date | ipos | openDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Dashboard, All Lists |
| Close Date | ipos | closeDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Dashboard, All Lists |
| Issue Size | ipos | issueSize | NUMERIC(12,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Dashboard, Lists |

**Notes:**
- Filtered by: `status IN ('OPEN', 'UPCOMING')` AND `closeDate >= CURRENT_DATE - 7 days`
- Limit: 10 most recent
- Includes both MAINBOARD and SME

---

### Upcoming IPOs Widget
*Card Display*

| UI Field | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Dashboard |
| Expected Open Date | ipos | openDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Dashboard |
| Category | ipos | segment | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Dashboard |

**Notes:**
- Filtered by: `status = 'UPCOMING'` AND `openDate IS NOT NULL`
- Sorted by: `openDate ASC`
- Limit: 5 nearest

---

## Mainboard IPO Pages

**Route:** `/mainboard-ipos`

### IPO List (Mainboard)
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Mainboard Pages, Lists |
| Open Date | ipos | openDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Mainboard Pages |
| Close Date | ipos | closeDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Mainboard Pages |
| Issue Size (₹ Cr) | ipos | issueSize | NUMERIC(12,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Mainboard Pages |
| Price Range | ipos | priceRangeMin, priceRangeMax | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Mainboard Pages |
| Status | ipos | status | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Mainboard Pages |

**Notes:**
- Filtered by: `segment = 'MAINBOARD'`
- Pagination: 20 per page
- Sortable columns: Company Name, Open Date, Issue Size

---

## SME IPO Pages

**Route:** `/sme-ipos`

### IPO List (SME)
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | SME Pages, Lists |
| Open Date | ipos | openDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | SME Pages |
| Close Date | ipos | closeDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | SME Pages |
| Issue Size (₹ Cr) | ipos | issueSize | NUMERIC(12,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | SME Pages |
| Price Range | ipos | priceRangeMin, priceRangeMax | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | SME Pages |
| Status | ipos | status | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | SME Pages |

**Notes:**
- Filtered by: `segment = 'SME'`
- Pagination: 20 per page
- Zero cross-contamination with MAINBOARD (Phase 4 validated)

---

## Compare IPOs Tool

**Route:** `/tools/compare`

### Comparison Fields
*Side-by-Side Display*

| UI Field | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Compare Tool |
| Issue Size | ipos | issueSize | NUMERIC(12,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Compare Tool |
| Price Range | ipos | priceRangeMin, priceRangeMax | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Compare Tool |
| Lot Size | ipos | lotSize | INTEGER | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Compare Tool |
| Open Date | ipos | openDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Compare Tool |
| Close Date | ipos | closeDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Compare Tool |
| Listing Date | ipos | listingDate | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4) | Compare Tool |

**Notes:**
- Supports comparing 2-4 IPOs simultaneously
- Uses `slug` for IPO selection
- Validation: See [IPO Compare Validation](../../web/docs/IPO_COMPARE_VALIDATION.md)

---

## Lot Calculator

**Route:** `/tools/lot-calculator`

### Calculator Input Fields
*Form Fields*

| UI Field | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------|----------|-----------|------|----------------|-----------------|
| Select IPO | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Lot Calculator |
| Price Range (Min) | ipos | priceRangeMin | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Lot Calculator |
| Price Range (Max) | ipos | priceRangeMax | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Lot Calculator |
| Lot Size | ipos | lotSize | INTEGER | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Lot Calculator |

**Critical Data Quality:**
- Lot size validation: See [Lot Size Data Quality](../../scraper/docs/LOT_SIZE_EXECUTIVE_SUMMARY.md)
- Phase 3 fix: 68.89% of IPOs had incorrect `lot_size = 1`
- Validation utility prevents lot_size = 1 unless verified

---

## Other Category Pages

### OFS - Offer for Sale

**Route:** `/ofs`

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3) | OFS Pages |
| Open Date | ipos | openDate | DATE | NSE(1), BSE(2), Moneycontrol(3) | OFS Pages |
| Close Date | ipos | closeDate | DATE | NSE(1), BSE(2), Moneycontrol(3) | OFS Pages |

**Notes:**
- Filtered by: `offeringType = 'OFS'`
- `segment` may be null for OFS

---

### NCD - Non-Convertible Debentures

**Route:** `/ncd`

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2) | NCD Pages |
| Open Date | ipos | openDate | DATE | NSE(1), BSE(2) | NCD Pages |
| Close Date | ipos | closeDate | DATE | NSE(1), BSE(2) | NCD Pages |

**Notes:**
- Filtered by: `offeringType = 'NCD'`
- Different price structure (yield-based)

---

### Rights Issues

**Route:** `/rights`

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2) | Rights Pages |
| Open Date | ipos | openDate | DATE | NSE(1), BSE(2) | Rights Pages |
| Close Date | ipos | closeDate | DATE | NSE(1), BSE(2) | Rights Pages |
| Rights Ratio | ipos | - | - | **Missing in schema** | Rights Pages |

**Notes:**
- Filtered by: `offeringType = 'RIGHTS'`
- `segment` is null for rights issues
- Rights ratio data needs to be added to schema or `ipoDetails` table

---

### FPO Listings

**Route:** `/fpo`

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | companyName | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3) | FPO Pages |
| Open Date | ipos | openDate | DATE | NSE(1), BSE(2), Moneycontrol(3) | FPO Pages |
| Close Date | ipos | closeDate | DATE | NSE(1), BSE(2), Moneycontrol(3) | FPO Pages |
| Issue Size | ipos | issueSize | NUMERIC(12,2) | NSE(1), BSE(2), Moneycontrol(3) | FPO Pages |
| Price Range | ipos | priceRangeMin, priceRangeMax | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3) | FPO Pages |

**Notes:**
- Filtered by: `offeringType = 'FPO'`
- Follow-on public offerings for already listed companies

---

## Missing Fields Analysis

### Critical Identifiers NOT Shown in UI (2 fields)

**⚠️ HIGH PRIORITY**

| DB Field | Type | Scrape Source | Recommendation |
|----------|------|---------------|----------------|
| **symbol** | VARCHAR(20) | NSE(1), BSE(2) | Display in IPO header, use for stock lookup |
| **isin** | VARCHAR(12) | NSE(1), BSE(2) | Display in IPO details section |

**Impact:** Standard stock identifiers missing. Users can't easily lookup IPOs on exchanges or portfolio apps.

---

### Historical Performance Fields in `ipos` (17 fields - Story 7.10)

**⚠️ DENORMALIZED DATA**

These fields duplicate data from `listingPerformance` and `subscriptions` tables:

| DB Field | Type | Purpose | Status |
|----------|------|---------|--------|
| subscriptionRetail | NUMERIC(10,2) | Retail subscription | Duplicate of subscriptions table |
| subscriptionHni | NUMERIC(10,2) | HNI subscription | Duplicate |
| subscriptionQib | NUMERIC(10,2) | QIB subscription | Duplicate |
| subscriptionTotal | NUMERIC(10,2) | Total subscription | Duplicate |
| gmpPrice | NUMERIC(10,2) | GMP absolute value | Renamed from `gmp` |
| gmpPercentageHistorical | NUMERIC(5,2) | GMP percentage | Renamed from `gmp_percentage` |
| gmpUpdatedAtHistorical | TIMESTAMP | GMP update time | New field |
| listingPriceHistorical | NUMERIC(10,2) | Listing price | Duplicate of listingPerformance |
| listingGainPercentage | NUMERIC(5,2) | Listing gain % | Duplicate |
| listingGainAmount | NUMERIC(10,2) | Listing gain amount | Duplicate |
| listingDateHistorical | DATE | Historical listing date | Duplicate |
| currentPrice | NUMERIC(10,2) | Current market price | Duplicate |
| currentGainPercentage | NUMERIC(5,2) | Current gain % | Duplicate |
| currentGainAmount | NUMERIC(10,2) | Current gain amount | Duplicate |
| currentPriceUpdatedAt | TIMESTAMP | Price update time | New field |
| historicalDataSource | VARCHAR(100) | Data source | Metadata |
| historicalDataScrapedAt | TIMESTAMP | Scrape timestamp | Metadata |

**Recommendation:** These fields were added for query optimization (avoid JOINs). Use normalized tables (`subscriptions`, `listingPerformance`) for primary data, use these for quick listing displays.

---

### Manual Data Management Fields (3 fields - Phase 6)

| DB Field | Type | Purpose | Status |
|----------|------|---------|--------|
| scraperLocked | BOOLEAN | Master protection lock | Admin feature ✅ |
| scraperLockNote | TEXT | Lock explanation | Admin feature ✅ |
| lastManualEditAt | TIMESTAMP | Manual edit tracking | Admin feature ✅ |

**Status:** Backend implementation exists. Prevents scrapers from overwriting manually corrected data. Correctly not displayed in user-facing UI.

---

### IPO Objectives (1 field - Story 11.13)

| DB Field | Type | Format | Scrape Source |
|----------|------|--------|---------------|
| objectives | JSONB | Array of {serial, description, amount} | Prospectus (manual) |

**Example:**
```json
[
  {"serial": 1, "description": "Working capital requirements", "amount": 50000000},
  {"serial": 2, "description": "Repayment of borrowings", "amount": 30000000},
  {"serial": 3, "description": "General corporate purposes", "amount": 20000000}
]
```

**Impact:** Use of IPO proceeds not displayed. Investors can't see how funds will be utilized.

**Recommendation:** Add "Use of Proceeds" section to IPO Detail page.

---

### Other Unmapped Fields (8 fields)

| DB Field | Type | Purpose | Priority |
|----------|------|---------|----------|
| slug | VARCHAR(255) | URL routing | Used internally ✅ |
| id | UUID | Primary key | Used internally ✅ |
| createdAt | TIMESTAMP | Record creation | Admin metadata ✅ |
| updatedAt | TIMESTAMP | Last update | Admin metadata ✅ |
| lastScrapedAt | TIMESTAMP | Scraper sync time | Admin metadata ✅ |
| ratingOverride | BOOLEAN | Admin override flag | Admin feature ✅ |
| offeringType | ENUM | IPO/FPO/RIGHTS/etc. | Used for filtering ✅ |

**Status:** Correctly unmapped - these are routing, admin, or filtering fields not meant for user display.

---

## Schema Reference

### ipos Table Structure

```typescript
// From packages/shared/src/db/schema.ts
export const ipos = pgTable('ipos', {
  // Primary Key
  id: uuid('id').primaryKey().defaultRandom(),

  // Core Identity
  companyName: varchar('company_name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).unique().notNull(),

  // Classification
  segment: varchar('segment', { length: 20 }), // MAINBOARD, SME, null
  offeringType: varchar('offering_type', { length: 20 }).notNull(), // IPO, FPO, RIGHTS, etc.
  sector: varchar('sector', { length: 100 }),

  // Pricing
  issueSize: numeric('issue_size', { precision: 12, scale: 2 }),
  priceRangeMin: numeric('price_range_min', { precision: 10, scale: 2 }),
  priceRangeMax: numeric('price_range_max', { precision: 10, scale: 2 }),
  faceValue: integer('face_value'),
  lotSize: integer('lot_size'),

  // Timeline
  openDate: date('open_date'),
  closeDate: date('close_date'),
  allotmentDate: date('allotment_date'),
  listingDate: date('listing_date'),

  // Status
  status: varchar('status', { length: 20 }).notNull(), // UPCOMING, OPEN, CLOSED, LISTED, etc.

  // Identifiers
  symbol: varchar('symbol', { length: 20 }), // Stock ticker
  isin: varchar('isin', { length: 12 }), // International Securities Identification Number

  // Related Entities
  listingExchanges: jsonb('listing_exchanges'), // ["NSE", "BSE"]
  leadManagers: jsonb('lead_managers'), // Array of strings
  registrar: varchar('registrar', { length: 255 }),
  registrarId: uuid('registrar_id').references(() => registrars.id),

  // Content
  companyDescription: text('company_description'),
  objectives: jsonb('objectives'), // Array of {serial, description, amount}

  // Rating
  rating: integer('rating'), // 1-5
  ratingRationale: text('rating_rationale'),
  ratingOverride: boolean('rating_override').default(false),

  // Historical Performance (denormalized for performance)
  // ... 17 fields (see Missing Fields section above)

  // Manual Data Management
  scraperLocked: boolean('scraper_locked').default(false),
  scraperLockNote: text('scraper_lock_note'),
  lastManualEditAt: timestamp('last_manual_edit_at'),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  lastScrapedAt: timestamp('last_scraped_at'),
});
```

**Total Fields:** 54
**Documented & Mapped:** 28 (52%)
**Unmapped:** 26 (48%)

---

## Related Documentation

- **[Master Index](screen-database-mapping-index.md)** - Navigation hub
- **[Financials & Performance](screen-database-mapping-financials.md)** - Financial metrics, listing performance
- **[Subscription & GMP](screen-database-mapping-subscription-gmp.md)** - Demand data, grey market premium
- **[Extended Features](screen-database-mapping-extended.md)** - IPO details, scoring, anchor investors
- **[Scraper Priority Matrix](database-schema-scraper-mapping.md)** - Field-to-scraper mapping

---

**Last Updated:** 2025-10-30
**Maintainer:** Frontend Team
**Review Frequency:** Monthly
