# Database Field Mapping Documentation - Subscription & GMP Data

**Last Updated:** 2025-10-30
**Schema Version:** 0029
**Documentation Version:** 3.0 (Split Architecture)
**Part:** 3 of 7

---

## 📋 Document Purpose

This document maps **time-series subscription and GMP (Grey Market Premium) data** from UI screens to database tables. These are the most dynamic data points, updated multiple times during IPO open period.

**Tables Covered:**
- `subscriptions` - Time-series subscription tracking (16 fields, 9 mapped, 56% coverage)
- `gmpRecords` - Time-series GMP tracking (9 fields, 6 mapped, 67% coverage)

**Related Documentation:**
- [Master Index](screen-database-mapping-index.md) - Navigation hub
- [Core IPO Mapping](screen-database-mapping-core-ipo.md) - Base IPO data
- [Financials Mapping](screen-database-mapping-financials.md) - Financial metrics
- [Scraper Priority Matrix](database-schema-scraper-mapping.md) - Data sourcing

---

## 🎯 Key Insights

### Data Characteristics

**Subscription Data:**
- **Update Frequency:** Real-time during IPO open period (typically updated 5-10 times per day)
- **Retention:** Full historical records for trend analysis
- **Primary Sources:** NSE(1), BSE(2) - 95%+ reliability
- **Cache TTL:** 3 minutes (most volatile data on platform)
- **Screen Usage:** 10+ screens display subscription data

**GMP Data:**
- **Update Frequency:** Daily (typically updated once per day from grey market)
- **Retention:** 7-day history for charting
- **Primary Source:** Chittorgarh(4) - 80%+ reliability
- **Cache TTL:** 15 minutes
- **Screen Usage:** 6+ screens display GMP data

### Coverage Analysis

| Table | Total Fields | Mapped | Unmapped | Coverage | Priority Gap |
|-------|-------------|---------|----------|----------|-------------|
| subscriptions | 16 | 9 (56%) | 7 (44%) | Partial | **HIGH** - Missing granular categories |
| gmpRecords | 9 | 6 (67%) | 3 (33%) | Good | **MEDIUM** - Missing trading details |

**Critical Gap:** 7 granular subscription categories (anchorInvestor, retailHNI, bNII, sNII, etc.) exist in database but not displayed in UI. This limits institutional investment analysis.

---

## 📊 Table 1: Subscriptions Table

**Database:** `subscriptions`
**Type:** Time-series (one-to-many relationship with `ipos`)
**Total Fields:** 16
**Mapped in UI:** 9 fields (56% coverage)
**Unmapped:** 7 fields (44%)

### Schema Reference

```typescript
// From packages/shared/src/db/schema.ts
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').notNull().references(() => ipos.id, { onDelete: 'cascade' }),
  timestamp: timestamp('timestamp').notNull(),

  // High-level categories (✅ MAPPED)
  qibSubscription: numeric('qib_subscription', { precision: 10, scale: 2 }),
  niiSubscription: numeric('nii_subscription', { precision: 10, scale: 2 }),
  retailSubscription: numeric('retail_subscription', { precision: 10, scale: 2 }),
  totalSubscription: numeric('total_subscription', { precision: 10, scale: 2 }),

  // Additional high-level (⏳ PARTIALLY MAPPED)
  employeeSubscription: numeric('employee_subscription', { precision: 10, scale: 2 }),
  othersSubscription: numeric('others_subscription', { precision: 10, scale: 2 }),

  // Granular breakdown (❌ UNMAPPED)
  anchorInvestorSubscription: numeric('anchor_investor_subscription', { precision: 10, scale: 2 }),
  retailHNISubscription: numeric('retail_hni_subscription', { precision: 10, scale: 2 }),
  retailOthersSubscription: numeric('retail_others_subscription', { precision: 10, scale: 2 }),
  bNIISubscription: numeric('b_nii_subscription', { precision: 10, scale: 2 }), // Big NII (≥₹10L)
  sNIISubscription: numeric('s_nii_subscription', { precision: 10, scale: 2 }), // Small NII (<₹10L)

  // Additional metrics (✅ MAPPED)
  totalApplications: integer('total_applications'),
  totalSharesBid: bigint('total_shares_bid', { mode: 'number' }),

  // Shares offered (❌ UNMAPPED)
  sharesOffered: bigint('shares_offered', { mode: 'number' }),
});
```

**Indexes:**
- `idx_subscriptions_ipo_timestamp` - Optimized for time-series queries

---

## 🖥️ UI Screens Using Subscription Data

### 1. IPO Detail Page - Subscription Tab (`/ipos/[slug]`)

**Component:** Subscription Tab with progress bars
**Update Frequency:** Real-time during IPO open period
**Cache TTL:** 3 minutes

#### Currently Displayed Fields

| UI Field Label | DB Column | Type | Scrape Sources | Display Format | Notes |
|----------------|-----------|------|----------------|----------------|-------|
| **Total Subscription** | `totalSubscription` | NUMERIC(10,2) | NSE(1), BSE(2) | Progress bar + "45.67x" | Overall subscription multiple |
| **QIB** | `qibSubscription` | NUMERIC(10,2) | NSE(1), BSE(2) | Progress bar + "78.90x" | Qualified Institutional Buyers |
| **NII** | `niiSubscription` | NUMERIC(10,2) | NSE(1), BSE(2) | Progress bar + "32.45x" | Non-Institutional Investors |
| **Retail** | `retailSubscription` | NUMERIC(10,2) | NSE(1), BSE(2) | Progress bar + "12.34x" | Retail Individual Investors |
| **Total Applications** | `totalApplications` | INTEGER | NSE(1), BSE(2) | Number + "1,23,456" | Application count |
| **Total Shares Bid** | `totalSharesBid` | BIGINT | NSE(1), BSE(2) | Number + "12,34,567" | Shares bid count |

**Component Location:** `web/components/ipo/SubscriptionTab.tsx` (estimated)

**Data Flow:**
1. Frontend: `/api/ipos/[slug]` API call
2. Backend: `IPORepository.findBySlug()` with subscription join
3. Cache: Redis key `ipo:slug:{slug}` (3-min TTL)
4. Scraper: NSE/BSE scrapers update every 5-10 minutes during open period

**Usage Notes:**
- Progress bars show subscription multiple (e.g., 45.67x means 4567% subscribed)
- Color coding: < 1x (red), 1-5x (yellow), > 5x (green)
- Last updated timestamp displayed from most recent `subscriptions.timestamp`

---

### 2. Compare IPOs Tool (`/tools/compare`)

**Displays Side-by-Side:** Up to 3 IPOs comparison
**Update Frequency:** Same as IPO detail page
**Cache TTL:** 3 minutes

#### Subscription Metrics Compared

| UI Metric | DB Column | Display Format | Used For |
|-----------|-----------|----------------|----------|
| **QIB Subscription** | `qibSubscription` | "78.90x" | Institutional interest comparison |
| **NII Subscription** | `niiSubscription` | "32.45x" | HNI demand comparison |
| **Retail Subscription** | `retailSubscription` | "12.34x" | Retail demand comparison |
| **Total Subscription** | `totalSubscription` | "45.67x" | Overall demand comparison |

**Component Location:** `web/components/tools/IPOCompare.tsx` (estimated)

**Unique Feature:** Highlights highest subscription in each category with green background

---

### 3. FPO/Mainboard/SME Listings Pages

**Pages:** `/fpo-listings`, `/mainboard-ipo-listings`, `/sme-ipo-listings`
**Display Type:** Table columns
**Update Frequency:** Static (historical data)

#### Subscription Columns

| UI Column | DB Column | Type | Display Format | Notes |
|-----------|-----------|------|----------------|-------|
| **Overall Subscription** | `totalSubscription` | NUMERIC(10,2) | "45.67x" | Latest subscription at IPO close |
| **QIB** | `qibSubscription` | NUMERIC(10,2) | "78.90x" | QIB final subscription |
| **NII** | `niiSubscription` | NUMERIC(10,2) | "32.45x" | NII final subscription |
| **Retail** | `retailSubscription` | NUMERIC(10,2) | "12.34x" | Retail final subscription |

**Query Pattern:**
```sql
SELECT DISTINCT ON (s.ipo_id)
  s.qib_subscription, s.nii_subscription, s.retail_subscription, s.total_subscription
FROM subscriptions s
WHERE s.ipo_id = :ipo_id
ORDER BY s.ipo_id, s.timestamp DESC
```

**Note:** These pages show **final subscription** numbers (last record before IPO closed), not time-series data.

---

### 4. Historical IPOs Page (`/history`)

**Display:** Single column in table
**Data Shown:** Final total subscription only

| UI Column | DB Column | Display Format | Notes |
|-----------|-----------|----------------|-------|
| **Subscription** | `totalSubscription` | "45.67x" | Historical final subscription |

**Component Location:** `web/app/history/page.tsx` (estimated)

---

## ❌ Missing Subscription Fields (7 unmapped)

### High Priority - Granular Institutional Breakdown

#### 1. **Anchor Investor Subscription** ⭐⭐⭐

**Database Field:** `anchorInvestorSubscription`
**Type:** NUMERIC(10,2)
**Scrape Sources:** NSE(1), BSE(2)

**Impact:** Anchor investor participation is a **critical signal** of IPO quality. Institutional investors commit capital 1 day before IPO opens, providing strong demand indication.

**Recommendation:**
- Add "Anchor Investor" row to Subscription Tab
- Display prominently with badge if > 1x
- Show in Compare Tool
- Add to listing tables

**Implementation Effort:** Low (field exists, just needs UI display)

---

#### 2. **Big NII vs Small NII Split** ⭐⭐

**Database Fields:**
- `bNIISubscription` - Big NII (bids ≥ ₹10 lakh)
- `sNIISubscription` - Small NII (bids < ₹10 lakh)

**Type:** NUMERIC(10,2) each
**Scrape Sources:** NSE(1), BSE(2)

**Impact:** bNII vs sNII split shows **HNI demand quality**. High bNII subscription indicates serious investor interest (larger ticket sizes).

**Recommendation:**
- Add collapsible "Advanced View" toggle in Subscription Tab
- Show NII breakdown: bNII (₹10L+) vs sNII (<₹10L)
- Add tooltip explaining difference
- Color code: bNII in blue, sNII in purple

**Implementation Effort:** Medium (needs UI toggle + layout)

---

#### 3. **Retail HNI vs Retail Others** ⭐

**Database Fields:**
- `retailHNISubscription` - Retail HNI
- `retailOthersSubscription` - Other retail investors

**Type:** NUMERIC(10,2) each
**Scrape Sources:** NSE(1), BSE(2)

**Impact:** Retail segmentation shows **distribution of retail demand**. High retail HNI indicates wealthier retail investor interest.

**Recommendation:**
- Add to "Advanced View" in Subscription Tab
- Show Retail breakdown: HNI vs Others
- Lower priority than bNII/sNII split

**Implementation Effort:** Medium (same as bNII/sNII)

---

#### 4. **Employee Subscription** ⭐

**Database Field:** `employeeSubscription`
**Type:** NUMERIC(10,2)
**Scrape Sources:** NSE(1), BSE(2)

**Impact:** Employee quota subscription shows **internal confidence**. High employee participation is a positive signal.

**Recommendation:**
- Add to "Advanced View"
- Show only if > 0 (many IPOs don't have employee quota)
- Display with "Internal Confidence" badge

**Implementation Effort:** Low

---

#### 5. **Others Subscription**

**Database Field:** `othersSubscription`
**Type:** NUMERIC(10,2)
**Scrape Sources:** NSE(1), BSE(2)

**Impact:** Catch-all category for miscellaneous subscriptions. Low priority.

**Recommendation:**
- Add to "Advanced View" for completeness
- Lower priority

**Implementation Effort:** Low

---

#### 6. **Shares Offered**

**Database Field:** `sharesOffered`
**Type:** BIGINT
**Scrape Sources:** NSE(1), BSE(2)

**Impact:** Total shares available for subscription. Useful for calculating subscription multiples.

**Recommendation:**
- Display in Subscription Tab header: "45,67,890 shares offered"
- Use for validation: `subscription_multiple = shares_bid / shares_offered`
- Show in IPO Details section

**Implementation Effort:** Low (informational field)

---

## 📈 Table 2: GMP Records Table

**Database:** `gmpRecords`
**Type:** Time-series (one-to-many relationship with `ipos`)
**Total Fields:** 9
**Mapped in UI:** 6 fields (67% coverage)
**Unmapped:** 3 fields (33%)

### Schema Reference

```typescript
// From packages/shared/src/db/schema.ts
export const gmpRecords = pgTable('gmp_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').notNull().references(() => ipos.id, { onDelete: 'cascade' }),
  timestamp: timestamp('timestamp').notNull(),

  // Basic GMP data (✅ MAPPED)
  gmp: integer('gmp').notNull(), // Grey market premium in INR
  expectedListingPrice: integer('expected_listing_price'),
  source: varchar('source', { length: 100 }).notNull(),

  // Trading details (❌ UNMAPPED)
  subjectRate: integer('subject_rate'), // Subject/safalya rate
  kostakRate: integer('kostak_rate'), // Kostak rate
  saudaDetails: text('sauda_details'), // Trading info
});
```

**Indexes:**
- `idx_gmp_records_ipo_timestamp` - Optimized for time-series queries

**Note:** The `ipos` table also stores latest GMP snapshot:
- `ipos.gmpPrice` - Latest GMP (synced from `gmpRecords`)
- `ipos.gmpPercentageHistorical` - GMP as % of issue price
- `ipos.gmpUpdatedAt` - Last GMP update timestamp

---

## 🖥️ UI Screens Using GMP Data

### 1. IPO Detail Page - GMP Tab (`/ipos/[slug]`)

**Component:** GMP Tab with 7-day history chart
**Update Frequency:** Daily (grey market data)
**Cache TTL:** 15 minutes

#### Currently Displayed Fields

| UI Field Label | DB Source | Type | Scrape Sources | Display Format | Notes |
|----------------|-----------|------|----------------|----------------|-------|
| **Latest GMP** | `ipos.gmpPrice` | INTEGER | Chittorgarh(4) | "₹250" | Current grey market premium |
| **GMP Percentage** | `ipos.gmpPercentageHistorical` | NUMERIC(5,2) | Calculated | "25.67%" | GMP as % of issue price |
| **Expected Listing Price** | `gmpRecords.expectedListingPrice` | INTEGER | Chittorgarh(4) | "₹1,225" | issue_price + gmp |
| **GMP History (7-day)** | `gmpRecords.gmp` | INTEGER | Chittorgarh(4) | Line chart | Time-series visualization |
| **Last Updated** | `ipos.gmpUpdatedAt` | TIMESTAMP | Chittorgarh(4) | "2 hours ago" | Relative timestamp |
| **Data Source** | `gmpRecords.source` | VARCHAR(100) | Chittorgarh(4) | "Chittorgarh" | Data attribution |

**Component Location:** `web/components/ipo/GMPTab.tsx` (estimated)

**Data Flow:**
1. Frontend: `/api/ipos/[slug]` API call
2. Backend: `IPORepository.findBySlug()` joins `gmpRecords`
3. Query: Last 7 records ordered by timestamp DESC
4. Cache: Redis key `gmp:latest:{ipoId}` (15-min TTL)

**Chart Rendering:**
- X-axis: Last 7 days (timestamp)
- Y-axis: GMP in ₹
- Tooltip: Shows exact GMP + expected listing price for each date
- Color: Green if GMP increasing, red if decreasing

---

### 2. Homepage - IPO Cards (`/`)

**Display:** Badge on each IPO card
**Update Frequency:** Real-time from cache
**Cache TTL:** 5 minutes (homepage data)

| UI Element | DB Source | Display Format | Notes |
|------------|-----------|----------------|-------|
| **GMP Badge** | `ipos.gmpPrice` | "GMP: ₹250 (25%)" | Shows latest GMP |

**Component Location:** `web/components/ipo/IPOCard.tsx` (estimated)

**Visual Design:**
- Badge color: Green if GMP > 0, grey if GMP = 0, red if GMP < 0 (rare)
- Positioned top-right corner of card
- Tooltip: "Grey Market Premium - Expected listing gain"

---

### 3. Compare IPOs Tool (`/tools/compare`)

**Display:** Row in comparison table
**Update Frequency:** Same as IPO detail page

| UI Row | DB Source | Display Format | Used For |
|--------|-----------|----------------|----------|
| **Current GMP** | `ipos.gmpPrice` | "₹250 (25.67%)" | Sentiment comparison |

**Unique Feature:** Highlights highest GMP among compared IPOs with green background

---

### 4. FPO/Mainboard/SME Listings Pages

**Pages:** `/fpo-listings`, `/mainboard-ipo-listings`, `/sme-ipo-listings`
**Display Type:** Table column
**Update Frequency:** Real-time from cache

| UI Column | DB Source | Display Format | Notes |
|-----------|-----------|----------------|-------|
| **GMP** | `ipos.gmpPrice` | "₹250" | Shows latest GMP before listing |

**Note:** For LISTED IPOs, GMP column may be hidden (no longer relevant after listing)

---

### 5. Dashboard Page (`/dashboard`)

**Display:** Badge in IPO cards (similar to homepage)
**Update Frequency:** Real-time
**Cache TTL:** 5 minutes

| UI Element | DB Source | Display Format |
|------------|-----------|----------------|
| **GMP Badge** | `ipos.gmpPrice` | "₹250" |

---

### 6. Mainboard/SME IPO Pages (`/mainboard-ipos`, `/sme-ipos`)

**Display:** Summary metrics
**Update Frequency:** Cached aggregations

| UI Metric | DB Query | Display Format | Notes |
|-----------|----------|----------------|-------|
| **Avg GMP** | `AVG(gmpPrice) WHERE status='OPEN'` | "₹185" | Average GMP of open IPOs |

**Component Location:** Summary cards at top of page

---

## ❌ Missing GMP Fields (3 unmapped)

### Medium Priority - Grey Market Trading Details

#### 1. **Kostak Rate** ⭐⭐

**Database Field:** `kostakRate`
**Type:** INTEGER
**Scrape Sources:** Chittorgarh(4)

**Definition:** Kostak rate is the premium paid for **unallocated applications** in the grey market. If investor doesn't get allotment, they can sell their application at kostak rate.

**Impact:** Important for understanding grey market trading mechanics. Serious investors use kostak rates to hedge IPO application risk.

**Recommendation:**
- Add to GMP Tab in "Advanced Metrics" section
- Show as: "Kostak Rate: ₹X per lot"
- Add explanatory tooltip: "Premium for unallotted applications"
- Display only if available (many IPOs don't have kostak rates)

**Implementation Effort:** Low (field exists, needs display)

**Target Audience:** Advanced investors, traders

---

#### 2. **Subject Rate (Safalya Rate)** ⭐⭐

**Database Field:** `subjectRate`
**Type:** INTEGER
**Scrape Sources:** Chittorgarh(4)

**Definition:** Subject rate is the premium paid for **allotted shares** before listing (subject to allotment). If investor gets allotment, they can sell at subject rate.

**Impact:** Indicates grey market demand for allocated shares. Higher subject rate shows strong listing expectation.

**Recommendation:**
- Add to GMP Tab in "Advanced Metrics" section
- Show as: "Subject Rate: ₹X per share"
- Add explanatory tooltip: "Premium for allotted shares"
- Display alongside kostak rate

**Implementation Effort:** Low

**Target Audience:** Advanced investors, traders

---

#### 3. **Sauda Details** ⭐

**Database Field:** `saudaDetails`
**Type:** TEXT
**Scrape Sources:** Chittorgarh(4)

**Definition:** Free-text trading information from grey market sources. May include trading volumes, buyer/seller sentiments, or market commentary.

**Impact:** Qualitative context for GMP data. Helps understand grey market sentiment beyond numbers.

**Recommendation:**
- Add to GMP Tab in collapsible "Trading Notes" section
- Display as formatted text block
- Show source and timestamp
- Lower priority (may be inconsistent/low quality)

**Implementation Effort:** Low (simple text display)

**Target Audience:** Market analysts, researchers

---

## 📊 Time-Series Data Patterns

### Subscription Data Flow

```
NSE/BSE API → Scraper (every 10 min during IPO open)
             ↓
  Database: INSERT INTO subscriptions (timestamp, ipoId, qib, nii, retail, total)
             ↓
  Cache: SET ipo:slug:{slug} (3-min TTL)
             ↓
  Frontend: API call → Display in Subscription Tab
```

**Subscription Timeline:**
- **T-0 (Open):** First subscription snapshot (usually 0x)
- **T+1 (Day 1):** 3-5 snapshots (morning, afternoon, close)
- **T+2 (Day 2):** 3-5 snapshots
- **T+3 (Day 3):** 3-5 snapshots + final snapshot at close
- **Total:** 10-20 snapshots per IPO over 3-day subscription period

**Storage:** All snapshots retained permanently for historical analysis

---

### GMP Data Flow

```
Chittorgarh Website → Scraper (daily)
                     ↓
  Database: INSERT INTO gmp_records (timestamp, ipoId, gmp, expected_listing_price)
           +UPDATE ipos SET gmp_price = :gmp, gmp_updated_at = NOW()
                     ↓
  Cache: SET gmp:latest:{ipoId} (15-min TTL)
                     ↓
  Frontend: API call → Display in GMP Tab + IPO cards
```

**GMP Timeline:**
- **T-30 to T-7 days (Pre-open):** Daily GMP updates (0-10 records)
- **T-7 to T-0 (Last week):** Daily GMP updates (7 records) - **displayed in chart**
- **T-0 to T+3 (During IPO):** Daily GMP updates (3-4 records)
- **T+3 to Listing:** Daily GMP updates (1-3 records)
- **Post-listing:** GMP becomes irrelevant, stops updating

**Storage:** All GMP records retained for historical analysis, but UI shows last 7 days only

---

## 🔍 Data Quality Considerations

### Subscription Data

**Reliability:** ✅ 95%+
- **Source:** NSE and BSE official APIs (authoritative sources)
- **Validation:** Cross-verify NSE vs BSE numbers (usually identical)
- **Issue:** Occasional 1-2 hour delays in BSE updates
- **Fallback:** Use NSE as primary, BSE as verification

**Data Completeness:**
- **Core categories (QIB, NII, Retail):** 100% coverage
- **Granular categories (bNII, sNII, anchor):** 85% coverage (some IPOs don't report)
- **Employee quota:** 40% coverage (only IPOs with employee reservation)

---

### GMP Data

**Reliability:** 🟡 80%+
- **Source:** Chittorgarh (unofficial grey market aggregator)
- **Validation:** No official verification possible (grey market is unregulated)
- **Issue:** Occasional stale data (1-2 days old)
- **Disclaimer:** Always shown with "Unofficial estimates" warning

**Data Completeness:**
- **Basic GMP:** 90% coverage for OPEN/UPCOMING IPOs
- **Kostak/Subject rates:** 60% coverage (only popular IPOs)
- **Expected listing price:** 95% coverage (calculated if missing)

**Best Practice:**
- Display "Last updated: X hours ago" prominently
- Show data source attribution
- Add disclaimer: "Grey market data is indicative, not guaranteed"

---

## 🎨 UI/UX Recommendations

### Subscription Tab Enhancements

**Current State:** Simple 4-row view (Total, QIB, NII, Retail)

**Proposed Enhancement:**

```
┌─────────────────────────────────────────────────────────┐
│ Subscription Status (as of 5 min ago)          [Details]│
├─────────────────────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ Total 45.67x (12,34,567 shares)       │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ QIB   78.90x                           │
│ ▓▓▓▓▓▓▓▓        NII   32.45x                           │
│ ▓▓▓▓            Retail 12.34x                          │
└─────────────────────────────────────────────────────────┘

[Expand Details ▼]

┌─────────────────────────────────────────────────────────┐
│ Detailed Breakdown                                       │
├─────────────────────────────────────────────────────────┤
│ Anchor Investors    98.50x  ⭐ Strong institutional signal│
│ Big NII (≥₹10L)     45.67x                              │
│ Small NII (<₹10L)   19.23x                              │
│ Retail HNI          15.67x                              │
│ Retail Others       8.90x                               │
│ Employee            2.34x   💼 Internal confidence       │
└─────────────────────────────────────────────────────────┘

Applications: 1,23,456 | Shares Bid: 12,34,567 | Offered: 45,678
```

**Key Features:**
- Default view: Simple 4 categories
- "Expand Details" toggle for 7 additional categories
- Progress bars color-coded: Red (<1x), Yellow (1-5x), Green (>5x)
- Badges for notable metrics (⭐ anchor investors, 💼 employees)
- Timestamp and refresh indicator

---

### GMP Tab Enhancements

**Current State:** 7-day line chart + latest GMP

**Proposed Enhancement:**

```
┌─────────────────────────────────────────────────────────┐
│ Grey Market Premium (GMP)              Last update: 2h ago│
├─────────────────────────────────────────────────────────┤
│ Current GMP: ₹250     (+25.67%)                         │
│ Expected Listing: ₹1,225 (Issue Price: ₹975)           │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  [7-day GMP trend chart]                                │
│                                                          │
├─────────────────────────────────────────────────────────┤
│ Advanced Trading Metrics                [Expand ▼]     │
└─────────────────────────────────────────────────────────┘

[Expand Advanced Metrics ▼]

┌─────────────────────────────────────────────────────────┐
│ Grey Market Trading Details                              │
├─────────────────────────────────────────────────────────┤
│ Kostak Rate:     ₹45 per lot   ℹ️ Premium for unallotted│
│ Subject Rate:    ₹265 per share ℹ️ Premium for allotted │
│                                                          │
│ Trading Notes:                                           │
│ "Strong buying interest from market makers. Subject rate│
│  increased by ₹15 in last 24 hours."                    │
│                                                          │
│ ⚠️ Disclaimer: Grey market data is unofficial and       │
│    indicative only. Not guaranteed.                     │
└─────────────────────────────────────────────────────────┘
```

**Key Features:**
- Prominent GMP display with percentage
- Expected listing price calculation
- 7-day trend visualization
- Collapsible "Advanced Metrics" for kostak/subject rates
- Trading notes if available
- Clear disclaimer about data reliability

---

## 🚀 Implementation Roadmap

### Phase 1: Quick Wins (1-2 days) ✅ Easy

1. **Add Shares Offered** to Subscription Tab
   - Display total shares available
   - Show in header: "45,678 shares offered"
   - **Impact:** Better context for subscription multiples
   - **Effort:** 2 hours

2. **Add Data Source Attribution** to GMP Tab
   - Show "Source: Chittorgarh" with timestamp
   - Add reliability indicator (80-95%)
   - **Impact:** Transparency, builds trust
   - **Effort:** 1 hour

---

### Phase 2: High-Value Features (3-5 days) ⭐ High Impact

3. **Add Anchor Investor Subscription**
   - New row in Subscription Tab
   - Badge if > 1x: "Strong Institutional Interest"
   - Add to Compare Tool
   - **Impact:** Critical investment signal
   - **Effort:** 6 hours

4. **Implement "Advanced View" Toggle**
   - Collapsible section in Subscription Tab
   - Shows 7 additional subscription categories
   - Color-coded badges for notable metrics
   - **Impact:** Comprehensive institutional analysis
   - **Effort:** 12 hours

---

### Phase 3: Advanced Features (1-2 weeks) 🔧 Complex

5. **Add Kostak & Subject Rates**
   - New "Advanced Trading Metrics" section in GMP Tab
   - Explanatory tooltips for each metric
   - Show only if data available
   - **Impact:** Advanced trader features
   - **Effort:** 8 hours

6. **Add Trading Notes Display**
   - Free-text section in GMP Tab
   - Formatted display with source attribution
   - **Impact:** Qualitative context for GMP
   - **Effort:** 4 hours

7. **Enhanced Subscription History Chart**
   - Time-series chart showing subscription growth
   - Separate lines for QIB, NII, Retail
   - Tooltip shows exact values at each timestamp
   - **Impact:** Trend visualization
   - **Effort:** 16 hours

---

## 📝 API Response Examples

### Subscription Data Response

```json
{
  "ipoId": "uuid-123",
  "companyName": "Example Corp Ltd",
  "subscription": {
    "timestamp": "2025-10-30T15:30:00Z",
    "total": 45.67,
    "categories": {
      "qib": 78.90,
      "nii": 32.45,
      "retail": 12.34,
      "employee": 2.34,
      "others": 0.00
    },
    "granular": {
      "anchorInvestor": 98.50,
      "bigNII": 45.67,
      "smallNII": 19.23,
      "retailHNI": 15.67,
      "retailOthers": 8.90
    },
    "metrics": {
      "totalApplications": 123456,
      "totalSharesBid": 1234567,
      "sharesOffered": 45678
    }
  }
}
```

---

### GMP Data Response

```json
{
  "ipoId": "uuid-123",
  "companyName": "Example Corp Ltd",
  "gmp": {
    "current": 250,
    "percentage": 25.67,
    "expectedListingPrice": 1225,
    "lastUpdated": "2025-10-30T08:00:00Z",
    "source": "Chittorgarh",
    "history": [
      {
        "date": "2025-10-30",
        "gmp": 250,
        "expectedListingPrice": 1225
      },
      {
        "date": "2025-10-29",
        "gmp": 235,
        "expectedListingPrice": 1210
      }
      // ... 7 days total
    ],
    "tradingDetails": {
      "kostakRate": 45,
      "subjectRate": 265,
      "saudaDetails": "Strong buying interest from market makers..."
    }
  }
}
```

---

## 🔗 Related Tables

### Upstream Dependencies

**These tables must exist for subscription/GMP data:**
- `ipos` - Parent table (ipoId foreign key reference)
  - See: [Core IPO Mapping](screen-database-mapping-core-ipo.md)

### Downstream Usage

**These features depend on subscription/GMP data:**
- IPO Scoring Algorithm - Uses subscription multiples for scoring
  - See: [Extended Features](screen-database-mapping-extended.md)
- Compare Tool - Displays subscription/GMP for comparison
  - See: [Core IPO Mapping](screen-database-mapping-core-ipo.md)
- Performance Trackers - Shows historical subscription data
  - See: [Financials Mapping](screen-database-mapping-financials.md)

---

## 📚 Related Documentation

**Architecture:**
- [Backend Architecture](../02-architecture/backend-architecture.md) - Repository patterns
- [Caching Strategy](../05-caching/CACHING_STRATEGY.md) - TTL strategy for time-series data

**Scraper:**
- [Scraper Priority Matrix](database-schema-scraper-mapping.md) - NSE/BSE/Chittorgarh scraper details
- [Scraping Strategy](../../scraper/docs/SCRAPING_STRATEGY.md) - NSE API endpoints

**Frontend:**
- [IPO Detail Page Components](../../web/components/ipo/) - Subscription & GMP tabs

---

## 📧 Document Maintenance

**Owner Team:** Data Engineering + Frontend Team
**Review Frequency:** Bi-weekly during IPO season, Monthly otherwise
**Last Reviewed:** 2025-10-30
**Next Review:** 2025-11-15

**Update Triggers:**
- New subscription categories added to NSE/BSE APIs
- GMP data source changes (e.g., new grey market aggregator)
- UI redesign of Subscription/GMP tabs
- Schema migration affecting these tables

---

**Version History:**
- **v3.0 (2025-10-30):** Split from monolithic doc, added granular breakdowns, trading details
- **v2.1 (2025-10-14):** Added gap analysis for unmapped fields
- **v2.0 (2025-10-10):** Added GMP history tracking
- **v1.0 (2025-09-15):** Initial comprehensive mapping

---

*Part of comprehensive database field mapping documentation. See [Master Index](screen-database-mapping-index.md) for navigation.*
