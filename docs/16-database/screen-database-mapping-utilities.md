# Database Field Mapping Documentation - Utilities & Features

**Last Updated:** 2025-10-30
**Schema Version:** 0029
**Documentation Version:** 3.0 (Split Architecture)
**Part:** 5 of 7

---

## 📋 Document Purpose

This document maps **utility features and supporting data** from UI screens to database tables. These are helper features that support the core IPO functionality.

**Tables Covered:**
- `marketHolidays` - Trading holidays calendar (8 fields, 100% coverage ✅)
- `registrars` - IPO registrars directory (11 fields, 8 mapped, 73% coverage)
- `brokerAffiliates` - Affiliate broker links (8 fields, **database exists but UI hardcoded** ⚠️)

**Related Documentation:**
- [Master Index](screen-database-mapping-index.md) - Navigation hub
- [Core IPO Mapping](screen-database-mapping-core-ipo.md) - Base IPO data
- [Content Mapping](screen-database-mapping-content.md) - Documents and reviews
- [Scraper Priority Matrix](database-schema-scraper-mapping.md) - Data sourcing

---

## 🎯 Key Insights

### Data Characteristics

**Market Holidays:**
- **Update Frequency:** Annual (NSE/BSE announce next year's holidays in December)
- **Retention:** 10 years historical + 1 year future
- **Primary Sources:** NSE(1), BSE(2) - 100% reliability
- **Cache TTL:** 24 hours (rarely changes)
- **Screen Usage:** 3 screens (Market Holidays page, 2 calendar pages)
- **Perfect Coverage:** ✅ All 8 fields mapped and displayed

**Registrars:**
- **Update Frequency:** Quarterly (registrar contact details change occasionally)
- **Retention:** Permanent (all active and inactive registrars)
- **Primary Sources:** Registrars Scraper, Manual Entry - 90%+ coverage
- **Cache TTL:** 6 hours (semi-static data)
- **Screen Usage:** 2 screens (Registrars page, IPO Detail page)
- **Good Coverage:** 73% (8 of 11 fields mapped)

**Broker Affiliates:**
- **Update Frequency:** N/A (currently hardcoded, not database-driven)
- **Retention:** Database exists but unused
- **Primary Sources:** Manual Entry (database) / Hardcoded (current UI)
- **Cache TTL:** N/A (static in code)
- **Screen Usage:** 1 screen (Affiliates page)
- **Critical Gap:** ⚠️ **Database table exists but UI uses hardcoded array**

### Coverage Analysis

| Table | Total Fields | Mapped | Unmapped | Coverage | Priority Gap |
|-------|-------------|---------|----------|----------|-------------|
| marketHolidays | 8 | 8 (100%) | 0 (0%) | **Perfect ✅** | None |
| registrars | 11 | 8 (73%) | 3 (27%) | Good | **LOW** - Logo, active flag, ID |
| brokerAffiliates | 8 | 0 (0%) | 8 (100%) | **None ⚠️** | **HIGH** - Complete migration needed |

**Critical Finding:** `brokerAffiliates` table is fully implemented in database but completely bypassed by UI hardcoded array. This prevents dynamic affiliate management and click tracking.

---

## 🗓️ Table 1: Market Holidays Table

**Database:** `marketHolidays`
**Type:** Utility table (no foreign keys)
**Total Fields:** 8
**Mapped in UI:** 8 fields (100% coverage ✅)
**Unmapped:** 0 fields

### Schema Reference

```typescript
// From packages/shared/src/db/schema.ts
export const marketHolidays = pgTable('market_holidays', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Holiday details (✅ ALL MAPPED)
  date: date('date').notNull(),
  description: varchar('description', { length: 255 }).notNull(),
  type: holidayTypeEnum('type').notNull(), // TRADING | CLEARING | BOTH
  exchange: exchangeEnum('exchange').notNull(), // NSE | BSE | BOTH
  year: integer('year').notNull(),

  // Timestamps (✅ MAPPED internally)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Indexes:**
- `idx_market_holidays_date` - Fast date lookups
- `idx_market_holidays_year` - Filter by year

**Holiday Type Enum Values:**
- `TRADING` - Markets closed for trading only
- `CLEARING` - Clearing house closed only
- `BOTH` - Both trading and clearing closed

**Exchange Enum Values:**
- `NSE` - National Stock Exchange holiday
- `BSE` - Bombay Stock Exchange holiday
- `BOTH` - Holiday for both exchanges

---

## 🖥️ UI Screens Using Market Holidays Data

### 1. Market Holidays Page (`/market-holidays`)

**Component:** Card grid displaying holidays
**Update Frequency:** Annual (data refreshed once per year)
**Cache TTL:** 24 hours

#### ✅ ALL Fields Displayed (100% Coverage)

| UI Field Label | DB Column | Type | Scrape Sources | Display Format | Notes |
|----------------|-----------|------|----------------|----------------|-------|
| **Date** | `date` | DATE | NSE(1), BSE(2) | "15 Oct 2025" | Formatted date |
| **Holiday Description** | `description` | VARCHAR(255) | NSE(1), BSE(2) | "Diwali" | Holiday name |
| **Holiday Type** | `type` | ENUM | NSE(1), BSE(2) | Badge: "Trading" | Color-coded badge |
| **Exchange** | `exchange` | ENUM | NSE(1), BSE(2) | Badge: "NSE+BSE" | Exchange indicator |
| **Year** | `year` | INTEGER | NSE(1), BSE(2) | Hidden (used for filtering) | Filter dropdown |
| **ID** | `id` | UUID | System | Hidden (internal reference) | Primary key |
| **Created At** | `createdAt` | TIMESTAMP | System | Hidden (internal tracking) | Audit trail |
| **Updated At** | `updatedAt` | TIMESTAMP | System | Hidden (internal tracking) | Audit trail |

**Component Location:** `web/app/market-holidays/page.tsx` (estimated)

**Data Flow:**
1. Frontend: `/api/market-holidays` API call
2. Backend: `MarketHolidaysRepository.findAll({ year })`
3. Query: `SELECT * FROM market_holidays WHERE year = :year ORDER BY date ASC`
4. Cache: Redis key `market_holidays:year:{year}` (24-hour TTL)

**Display Pattern:**
- Card grid layout (3-4 cards per row)
- Each card shows: Date (large), Description, Type badge, Exchange badge
- Sorted chronologically by date
- Year filter dropdown at top (defaults to current year)
- Badge colors:
  - Type: Trading (blue), Clearing (purple), Both (red)
  - Exchange: NSE (orange), BSE (green), Both (grey)

---

### 2. Mainboard IPO Calendar (`/mainboard-ipo-calendar`)

**Display:** Calendar events integrated with IPO dates
**Update Frequency:** Real-time (IPO data) + daily (holidays)
**Cache TTL:** 24 hours (holidays only)

| UI Element | DB Source | Display Format | Notes |
|------------|-----------|----------------|-------|
| **Holiday Events** | `marketHolidays.date, .description` | Red calendar cells | Holidays shown as background events |
| **Holiday Exchange** | `marketHolidays.exchange` | Tooltip: "NSE+BSE Holiday" | Additional info on hover |

**Component Location:** `web/app/mainboard-ipo-calendar/page.tsx` (estimated)

**Calendar Integration:**
- Holidays displayed as red background cells
- IPO events (open/close/allotment/listing) overlaid on calendar
- Hover shows holiday details
- Prevents confusion about why IPOs aren't opening on holidays

---

### 3. SME IPO Calendar (`/sme-ipo-calendar`)

**Display:** Same structure as Mainboard calendar
**Update Frequency:** Same as Mainboard
**Cache TTL:** 24 hours (holidays)

Same mapping as Mainboard calendar, but with `WHERE exchange IN ('BSE', 'BOTH')` filter (SME IPOs typically list on BSE only).

**Component Location:** `web/app/sme-ipo-calendar/page.tsx` (estimated)

---

## 🏢 Table 2: Registrars Table

**Database:** `registrars`
**Type:** Utility table (no foreign keys, referenced by `ipos.registrarId`)
**Total Fields:** 11
**Mapped in UI:** 8 fields (73% coverage)
**Unmapped:** 3 fields (27%)

### Schema Reference

```typescript
// From packages/shared/src/db/schema.ts
export const registrars = pgTable('registrars', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Basic info (✅ MAPPED)
  name: varchar('name', { length: 255 }).notNull(),
  shortName: varchar('short_name', { length: 100 }),

  // Contact details (✅ MAPPED)
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  website: text('website'),
  address: text('address'),

  // IPO-specific URLs (✅ MAPPED)
  allotmentCheckUrl: text('allotment_check_url'),

  // Visual & status fields (❌ UNMAPPED)
  logoUrl: text('logo_url'),
  active: boolean('active').default(true).notNull(),

  // Timestamps (✅ MAPPED internally)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**No Indexes:** Simple lookup table, small size (~20-30 records)

**Typical Registrars:**
- Link Intime India Pvt Ltd
- KFin Technologies Limited
- Karo Gehlot & Associates
- Integrated Registry Management Services
- Bigshare Services Pvt Ltd

---

## 🖥️ UI Screens Using Registrars Data

### 1. Registrars Directory Page (`/registrars`)

**Component:** Table/Card grid of all registrars
**Update Frequency:** Quarterly (registrar details updated occasionally)
**Cache TTL:** 6 hours

#### Currently Displayed Fields

| UI Column | DB Column | Type | Scrape Sources | Display Format | Notes |
|-----------|-----------|------|----------------|----------------|-------|
| **Name** | `shortName`, `name` | VARCHAR | Registrars Scraper, Manual | "Link Intime" (bold) / "Link Intime India Pvt Ltd" (small) | Two-line display |
| **Email** | `email` | VARCHAR(255) | Registrars Scraper, Manual | "contact@linkintime.co.in" | Clickable mailto link |
| **Phone** | `phone` | VARCHAR(20) | Registrars Scraper, Manual | "+91-22-1234-5678" | Clickable tel link |
| **Website** | `website` | TEXT | Registrars Scraper, Manual | "linkintime.co.in" | Clickable external link |
| **Allotment Check URL** | `allotmentCheckUrl` | TEXT | Registrars Scraper, Manual | Button: "Check Status" | Opens in new tab |
| **Address** | `address` | TEXT | Registrars Scraper, Manual | Full address | Tooltip or expandable row |
| **Created At** | `createdAt` | TIMESTAMP | System | Hidden (internal tracking) | Audit trail |
| **Updated At** | `updatedAt` | TIMESTAMP | System | Hidden (internal tracking) | Audit trail |

**Component Location:** `web/app/registrars/page.tsx` (estimated)

**Data Flow:**
1. Frontend: `/api/registrars` API call
2. Backend: `RegistrarsRepository.findAll()`
3. Query: `SELECT * FROM registrars ORDER BY name ASC`
4. Cache: Redis key `registrars:list:all` (6-hour TTL)

**Display Pattern:**
- Table layout for desktop, cards for mobile
- Sorted alphabetically by `shortName` or `name`
- Contact info (email/phone) clickable
- "Check Allotment Status" button prominent
- Search/filter by registrar name

---

### 2. IPO Detail Page (`/ipos/[slug]`)

**Display:** Registrar info in IPO Details section
**Update Frequency:** Static (registrar assigned once per IPO)
**Cache TTL:** 15 minutes (IPO detail cache)

| UI Field Label | DB Source | Display Format | Notes |
|----------------|-----------|----------------|-------|
| **Registrar** | `registrars.name` | "Link Intime India Pvt Ltd" | Joined from ipos.registrarId |
| **Check Allotment** | `registrars.allotmentCheckUrl` | Button/link | Quick access from IPO detail |

**Component Location:** `web/components/ipo/IPODetailsSection.tsx` (estimated)

**Query Pattern:**
```sql
SELECT i.*, r.name, r.allotment_check_url
FROM ipos i
LEFT JOIN registrars r ON i.registrar_id = r.id
WHERE i.slug = :slug
```

**Usage:**
- Registrar name displayed in IPO Details section
- "Check Allotment Status" button links to registrar's allotment check portal
- Tooltip shows registrar contact info on hover (optional enhancement)

---

## ❌ Missing Registrars Fields (3 unmapped)

### Low Priority - Visual & Status Enhancements

#### 1. **Logo URL** 🖼️ ⭐

**Database Field:** `logoUrl`
**Type:** TEXT
**Scrape Sources:** Registrars Scraper, Manual Entry

**Impact:** Text-only registrar directory looks unprofessional. Logos improve brand recognition.

**Recommendation:**
- Display registrar logos in directory grid (card view)
- Show logo next to registrar name on IPO Detail page
- Use placeholder image for missing logos
- Admin panel to upload/update logos

**Implementation Effort:** Low (8 hours)
- Frontend: Image component with fallback
- Backend: Already in schema, just needs display logic

**Example Enhancement:**
```
┌──────────────────────────────────────┐
│ [Logo]  Link Intime India Pvt Ltd   │
│         contact@linkintime.co.in     │
│         +91-22-1234-5678             │
│         [Check Allotment Status →]   │
└──────────────────────────────────────┘
```

---

#### 2. **Active Flag** ✅ ⭐

**Database Field:** `active`
**Type:** BOOLEAN
**Default:** true
**Usage:** Track active vs inactive registrars

**Impact:** Currently, all registrars displayed regardless of active status. Some registrars may have ceased operations or changed company names.

**Current Behavior:** No filtering by `active` flag.

**Recommendation:**
- Add `WHERE active = true` filter to registrars directory
- Admin toggle to show inactive registrars
- Display "(Inactive)" badge for inactive registrars
- Prevent inactive registrars from being assigned to new IPOs

**Implementation Effort:** Low (4 hours)

**Use Cases:**
- Registrar company acquired/merged → mark as inactive
- Registrar stopped IPO services → mark as inactive
- Historical data preservation (keep record, but hide from active list)

---

#### 3. **ID** (Primary Key)

**Database Field:** `id`
**Type:** UUID
**Usage:** Unique registrar identifier, referenced by `ipos.registrarId`

**Impact:** Internal reference only, not user-facing.

**Current Behavior:** Used internally for foreign key relations, not displayed in UI.

**Recommendation:** No UI display needed (internal use only).

**Implementation Effort:** N/A

---

## 🔗 Table 3: Broker Affiliates Table

**Database:** `brokerAffiliates`
**Type:** Utility table (no foreign keys)
**Total Fields:** 8
**Mapped in UI:** 0 fields (0% coverage ⚠️)
**Unmapped:** 8 fields (100%)

**⚠️ CRITICAL ISSUE:** Database table exists and is fully implemented, but Affiliates page (`/affiliates`) uses a hardcoded array instead of database data.

### Schema Reference

```typescript
// From packages/shared/src/db/schema.ts
export const brokerAffiliates = pgTable('broker_affiliates', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Broker details (❌ ALL UNMAPPED)
  brokerName: varchar('broker_name', { length: 255 }).notNull(),
  brokerLogo: text('broker_logo'),
  affiliateUrl: text('affiliate_url').notNull(),
  displayText: varchar('display_text', { length: 100 }),

  // Display control (❌ UNMAPPED)
  active: boolean('active').default(true).notNull(),
  displayOrder: integer('display_order').default(0).notNull(),

  // Timestamps (❌ UNMAPPED)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Indexes:**
- `idx_broker_affiliates_active_order` - Filter active brokers and sort by display order

**Related Table:**
- `affiliateClicks` - Tracks clicks on affiliate links (6 fields)
  - `id`, `ipoId`, `broker`, `source`, `userSession`, `clickedAt`
  - See: [Extended Features](screen-database-mapping-extended.md)

---

## 🖥️ Current Affiliates Page Implementation

### Affiliates Page (`/affiliates`)

**Current Implementation:** Hardcoded array in component
**Database Status:** Table exists but unused
**Cache TTL:** N/A (static code)

#### Hardcoded Broker Array (Example)

```typescript
// Current implementation (hardcoded)
const brokers = [
  {
    name: "Zerodha",
    logo: "/images/brokers/zerodha.png",
    url: "https://zerodha.com/?ref=ipodhan",
    features: ["Free account opening", "₹20 per trade", "Best platform"],
  },
  {
    name: "Angel One",
    logo: "/images/brokers/angelone.png",
    url: "https://angelone.in/?ref=ipodhan",
    features: ["Free trades", "Research reports", "Mobile app"],
  },
  // ... 4-6 more brokers hardcoded
];
```

**Issues with Current Approach:**
1. **No Dynamic Updates:** Requires code deployment to add/remove brokers
2. **No A/B Testing:** Can't test different affiliate links or broker order
3. **No Click Tracking:** Can't measure conversion rates or optimize
4. **No Admin Control:** Marketing team can't manage brokers without developer
5. **Database Waste:** Fully-implemented table sitting unused

---

## ⚠️ Critical Gap: Broker Affiliates Migration

### High Priority - Complete System Overhaul Needed ⭐⭐⭐

#### Problem Statement

**Database table exists and fully functional, but completely bypassed by UI hardcoded array.**

**Database Fields Available (ALL unmapped):**

| DB Field | Type | Purpose | Current UI | Gap |
|----------|------|---------|------------|-----|
| `brokerName` | VARCHAR(255) | Broker name | Hardcoded in array | Not using DB |
| `brokerLogo` | TEXT | Logo URL | Hardcoded in array | Not using DB |
| `affiliateUrl` | TEXT | Tracking link | Hardcoded in array | Not using DB |
| `displayText` | VARCHAR(100) | CTA button text | Hardcoded as "Open Account" | Not using DB |
| `active` | BOOLEAN | Enable/disable | No toggle (all shown) | Not using DB |
| `displayOrder` | INTEGER | Sort order | Hardcoded array order | Not using DB |
| `createdAt` | TIMESTAMP | Audit trail | N/A | Not using DB |
| `updatedAt` | TIMESTAMP | Audit trail | N/A | Not using DB |

---

### Recommended Migration Plan

#### Phase 1: Backend API (1 day) ✅ Easy

**Task:** Create API endpoint to fetch broker affiliates from database

```typescript
// GET /api/broker-affiliates
export async function GET() {
  const db = await getDb();
  const redis = getRedisClient();
  const repository = new BrokerAffiliatesRepository(db, redis);

  const brokers = await repository.findAllActive(); // WHERE active = true ORDER BY display_order
  return NextResponse.json({ success: true, data: brokers });
}
```

**Effort:** 4 hours (create repository, API route, caching)

---

#### Phase 2: Frontend Migration (2 days) 🔧 Medium

**Task:** Replace hardcoded array with API call

```typescript
// Before (hardcoded)
const brokers = [ /* hardcoded array */ ];

// After (database-driven)
const { data: brokers } = await fetch('/api/broker-affiliates').then(r => r.json());
```

**Changes Required:**
1. Remove hardcoded array
2. Add API call with error handling
3. Update component to handle dynamic data
4. Add loading state (skeleton cards)
5. Handle empty state (no active brokers)

**Effort:** 10 hours (frontend refactor, testing)

---

#### Phase 3: Admin Panel (3-5 days) 🎯 High Value

**Task:** Create admin interface to manage broker affiliates

**Admin Features:**
- **Broker CRUD:** Add, edit, delete brokers
- **Logo Upload:** Upload broker logos (file storage integration)
- **Active Toggle:** Enable/disable brokers without deleting
- **Display Order:** Drag-and-drop reordering
- **Affiliate Link Management:** Update tracking URLs
- **Preview:** See how changes look on affiliates page before publishing

**Implementation:**
- Admin panel at `/admin/broker-affiliates`
- Protected route (admin authentication required)
- Form validation (required fields, URL format)
- File upload for logos (S3 or local storage)

**Effort:** 24 hours (admin UI, CRUD operations, file handling)

---

#### Phase 4: Click Tracking Integration (1-2 days) 📊 Analytics

**Task:** Enable click tracking using `affiliateClicks` table

**Current State:** `affiliateClicks` table exists but unused (like `brokerAffiliates`)

**Implementation:**
```typescript
// When user clicks affiliate link
async function trackAffiliateClick(broker: string, ipoId: string | null, source: string) {
  await fetch('/api/affiliate-clicks', {
    method: 'POST',
    body: JSON.stringify({ broker, ipoId, source })
  });
  // Then redirect to affiliate URL
}
```

**Analytics Queries:**
- Total clicks per broker (last 30 days)
- Conversion funnel (IPO detail page → affiliate click)
- Source attribution (homepage vs IPO detail vs affiliates page)

**Effort:** 10 hours (tracking API, analytics dashboard)

---

#### Phase 5: A/B Testing (Optional, 2-3 days) 🧪 Advanced

**Task:** Test different broker orders, CTA text, and link variations

**Features:**
- Variant testing: Show different broker orders to different users
- CTA testing: "Open Account" vs "Start Investing" vs "Get Started"
- Link testing: Direct affiliate links vs landing pages
- Results dashboard: Click-through rate by variant

**Effort:** 20 hours (A/B testing framework, results tracking)

---

### Migration ROI

**Benefits:**
- ✅ **Dynamic Management:** Update brokers without code deployment (5-min update vs 1-hour deployment)
- ✅ **Click Tracking:** Measure conversion rates, optimize broker order (estimated 10-20% CTR improvement)
- ✅ **A/B Testing:** Test different CTAs, broker orders (estimated 15-30% revenue increase)
- ✅ **Admin Control:** Marketing team autonomy (reduces developer bottleneck)
- ✅ **Database Utilization:** Use existing infrastructure (no new tables needed)

**Costs:**
- **Development:** 60-80 hours (Phases 1-4, excluding A/B testing)
- **Testing:** 10-15 hours (QA, UAT)
- **Deployment:** 2-4 hours (migrations, rollout)

**Total Effort:** 72-99 hours (1.5-2 developer-weeks)

**Recommendation Priority:** **HIGH** - Table already exists, high ROI potential

---

## 📊 Data Quality Considerations

### Market Holidays

**Reliability:** ✅ 100%
- **Source:** NSE and BSE official holiday calendars (authoritative)
- **Validation:** Cross-verify NSE vs BSE holidays (usually identical)
- **Issue:** Rare discrepancies (NSE trading, BSE closed) handled by exchange field
- **Completeness:** 100% coverage (all holidays scraped annually in December)

**Update Process:**
- Annual scraper runs in December for next year
- Manual verification by data team
- Automatic email alerts if scraper fails

---

### Registrars

**Reliability:** 🟡 90%+
- **Source:** Mixed (scraper + manual entry + registrar verification)
- **Validation:** Contact details verified manually (email/phone tests)
- **Issue:** Some registrar websites change URLs without notice
- **Completeness:** 95% coverage (20 active registrars tracked)

**Data Quality:**
- **Name & Short Name:** 100% accurate (verified from SEBI registrations)
- **Email & Phone:** 90% accurate (some registrars change contact info)
- **Website:** 95% accurate (occasional URL changes)
- **Allotment Check URL:** 85% accurate (registrars frequently update portals)

**Maintenance:**
- Quarterly manual verification of contact details
- Automated URL checker (monitors allotment check links)
- User-reported issues flagged for review

---

### Broker Affiliates

**Reliability:** N/A (currently hardcoded)
- **Potential Reliability:** 100% (when migrated to database)
- **Update Frequency:** On-demand (admin panel control)
- **Validation:** Admin approval required for all changes

---

## 🎨 UI/UX Recommendations

### Market Holidays Page Enhancement

**Current State:** Simple card grid

**Proposed Enhancement:**

```
┌─────────────────────────────────────────────────────────┐
│ Market Holidays 2025                        Year: [2025 ▼]│
├─────────────────────────────────────────────────────────┤
│ ┌────────────┐  ┌────────────┐  ┌────────────┐         │
│ │ 15 Oct     │  │ 01 Nov     │  │ 15 Nov     │         │
│ │ Diwali     │  │ Diwali     │  │ Guru Nanak │         │
│ │ 🏛️ NSE+BSE  │  │ 🏛️ NSE+BSE  │  │ 🏛️ NSE+BSE  │         │
│ │ TRADING    │  │ CLEARING   │  │ BOTH       │         │
│ └────────────┘  └────────────┘  └────────────┘         │
│                                                          │
│ ⏸️ Trading Closed: 10 days | 📋 Clearing Closed: 8 days  │
│                                                          │
│ [Download Calendar (PDF)] [Add to Google Calendar]      │
└─────────────────────────────────────────────────────────┘
```

**Key Features:**
- Year dropdown filter
- Badge icons for exchange (🏛️) and type (⏸️ Trading, 📋 Clearing)
- Summary stats (total trading/clearing closed days)
- Export options (PDF, Google Calendar, iCal)
- Color coding: Trading (blue), Clearing (purple), Both (red)

---

### Registrars Page Enhancement

**Current State:** Table/card layout

**Proposed Enhancement:**

```
┌─────────────────────────────────────────────────────────┐
│ IPO Registrars Directory                    [Search 🔍] │
├─────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────┐   │
│ │ [Logo]  Link Intime India Pvt Ltd                 │   │
│ │         📧 contact@linkintime.co.in               │   │
│ │         📞 +91-22-1234-5678                       │   │
│ │         🌐 linkintime.co.in                       │   │
│ │         📍 Mumbai, Maharashtra                    │   │
│ │                                                   │   │
│ │ [Check Allotment Status →] [View All IPOs (45)]  │   │
│ └───────────────────────────────────────────────────┘   │
│                                                          │
│ ┌───────────────────────────────────────────────────┐   │
│ │ [Logo]  KFin Technologies Limited                 │   │
│ │         📧 info@kfintech.com                      │   │
│ │         ...                                       │   │
│ └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Key Features:**
- Registrar logos displayed prominently
- Icon-based contact info (📧 email, 📞 phone, 🌐 website, 📍 address)
- "View All IPOs" link showing count of IPOs handled by registrar
- Search/filter by registrar name
- Sort by: Name, IPO count, Recently added

---

### Broker Affiliates Page Enhancement (Post-Migration)

**Current State:** Hardcoded static cards

**Proposed Enhancement:**

```
┌─────────────────────────────────────────────────────────┐
│ Partner Brokers - Open Your Demat Account               │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────┐  ┌─────────────────┐               │
│ │ [Zerodha Logo]  │  │ [Angel One Logo]│               │
│ │                 │  │                 │               │
│ │ ✓ Free account  │  │ ✓ Free trades   │               │
│ │ ✓ ₹20 per trade │  │ ✓ Research      │               │
│ │ ✓ Best platform │  │ ✓ Mobile app    │               │
│ │                 │  │                 │               │
│ │ [Open Account →]│  │ [Get Started →] │               │
│ └─────────────────┘  └─────────────────┘               │
│                                                          │
│ 💡 Comparison: [View All Features] [Compare Plans]      │
└─────────────────────────────────────────────────────────┘
```

**Key Features:**
- Dynamic broker cards from database
- A/B tested CTA buttons ("Open Account" vs "Get Started")
- Click tracking enabled (analytics dashboard)
- Sort by: Display order (admin-controlled)
- Filter by: Features offered (future enhancement)

---

## 🚀 Implementation Roadmap

### Phase 1: Low-Hanging Fruit (1-2 days) ✅ Easy

1. **Add Registrar Logos**
   - Display `logoUrl` in directory and IPO detail
   - Use placeholder for missing logos
   - **Impact:** Professional appearance
   - **Effort:** 8 hours

2. **Filter Inactive Registrars**
   - Add `WHERE active = true` to registrars queries
   - Admin toggle to show inactive
   - **Impact:** Cleaner directory, hide defunct registrars
   - **Effort:** 4 hours

3. **Market Holidays Export**
   - Add "Download PDF" and "Add to Calendar" buttons
   - Generate PDF with holiday list
   - Generate iCal file for calendar imports
   - **Impact:** User convenience
   - **Effort:** 8 hours

---

### Phase 2: Broker Affiliates Migration (1-2 weeks) ⭐ High Priority

4. **Backend API for Broker Affiliates**
   - Create `BrokerAffiliatesRepository`
   - API route: `GET /api/broker-affiliates`
   - Caching with Redis (24-hour TTL)
   - **Impact:** Foundation for dynamic management
   - **Effort:** 4 hours

5. **Frontend Migration**
   - Replace hardcoded array with API call
   - Add loading/error states
   - **Impact:** Database-driven display
   - **Effort:** 10 hours

6. **Admin Panel for Brokers**
   - CRUD interface for broker management
   - Logo upload functionality
   - Display order drag-and-drop
   - **Impact:** Marketing team autonomy
   - **Effort:** 24 hours

7. **Click Tracking Implementation**
   - Track clicks using `affiliateClicks` table
   - Analytics dashboard
   - **Impact:** Conversion rate optimization
   - **Effort:** 10 hours

---

### Phase 3: Advanced Features (2-3 weeks) 🎯 Lower Priority

8. **Registrar IPO History**
   - "View All IPOs" link showing IPOs handled by registrar
   - Sortable table with IPO names, dates, segments
   - **Impact:** Enhanced registrar profiles
   - **Effort:** 12 hours

9. **A/B Testing for Broker Affiliates**
   - Test broker order, CTA text, link variations
   - Results dashboard
   - **Impact:** Revenue optimization
   - **Effort:** 20 hours

10. **Registrar Performance Metrics**
    - Average allotment turnaround time
    - User satisfaction ratings
    - **Impact:** Quality insights for investors
    - **Effort:** 16 hours

---

## 📝 API Response Examples

### Market Holidays Response

```json
{
  "holidays": [
    {
      "id": "holiday-uuid-1",
      "date": "2025-10-15",
      "description": "Diwali",
      "type": "TRADING",
      "exchange": "BOTH",
      "year": 2025
    },
    {
      "id": "holiday-uuid-2",
      "date": "2025-11-01",
      "description": "Diwali (Clearing)",
      "type": "CLEARING",
      "exchange": "BOTH",
      "year": 2025
    }
  ],
  "meta": {
    "year": 2025,
    "totalDays": 12,
    "tradingClosed": 10,
    "clearingClosed": 8
  }
}
```

---

### Registrars Response

```json
{
  "registrars": [
    {
      "id": "reg-uuid-1",
      "name": "Link Intime India Pvt Ltd",
      "shortName": "Link Intime",
      "email": "contact@linkintime.co.in",
      "phone": "+91-22-1234-5678",
      "website": "https://www.linkintime.co.in",
      "address": "C-101, 1st Floor, 247 Park, L B S Marg, Vikhroli (West), Mumbai - 400083",
      "allotmentCheckUrl": "https://linkintime.co.in/ipo/public-issues.html",
      "logoUrl": "/images/registrars/linkintime.png",
      "active": true,
      "ipoCount": 45
    }
  ]
}
```

---

### Broker Affiliates Response (Post-Migration)

```json
{
  "brokers": [
    {
      "id": "broker-uuid-1",
      "brokerName": "Zerodha",
      "brokerLogo": "/images/brokers/zerodha.png",
      "affiliateUrl": "https://zerodha.com/?ref=ipodhan&campaign=affiliates",
      "displayText": "Open Account",
      "active": true,
      "displayOrder": 1,
      "clickCount": 1234
    },
    {
      "id": "broker-uuid-2",
      "brokerName": "Angel One",
      "brokerLogo": "/images/brokers/angelone.png",
      "affiliateUrl": "https://angelone.in/?ref=ipodhan",
      "displayText": "Get Started",
      "active": true,
      "displayOrder": 2,
      "clickCount": 987
    }
  ]
}
```

---

## 🔗 Related Tables

### Upstream Dependencies

**These tables must exist for utilities data:**
- `ipos` - References registrars via `ipos.registrarId` foreign key
  - See: [Core IPO Mapping](screen-database-mapping-core-ipo.md)

### Downstream Usage

**These features depend on utilities data:**
- IPO Calendars - Display market holidays alongside IPO events
  - See: [Core IPO Mapping](screen-database-mapping-core-ipo.md)
- IPO Detail Page - Displays registrar information
  - See: [Core IPO Mapping](screen-database-mapping-core-ipo.md)
- Affiliate Click Tracking - Depends on `brokerAffiliates` table
  - See: [Extended Features](screen-database-mapping-extended.md)

---

## 📚 Related Documentation

**Architecture:**
- [Backend Architecture](../02-architecture/backend-architecture.md) - Repository patterns
- [Caching Strategy](../05-caching/CACHING_STRATEGY.md) - Static content caching

**Scraper:**
- [Scraper Priority Matrix](database-schema-scraper-mapping.md) - Market holidays scraper details
- [Scraping Strategy](../../scraper/docs/SCRAPING_STRATEGY.md) - NSE/BSE holiday extraction

**Frontend:**
- [Market Holidays Page](../../web/app/market-holidays/) - Calendar implementation
- [Registrars Page](../../web/app/registrars/) - Directory implementation

---

## 📧 Document Maintenance

**Owner Team:** Platform Team + Frontend Team
**Review Frequency:** Quarterly (or after broker affiliate migration)
**Last Reviewed:** 2025-10-30
**Next Review:** 2026-01-30

**Update Triggers:**
- Broker affiliate migration completed
- New registrars added to database
- Market holidays scraper changes
- Schema migration affecting these tables

---

**Version History:**
- **v3.0 (2025-10-30):** Split from monolithic doc, identified broker affiliates critical gap
- **v2.1 (2025-10-14):** Added gap analysis for unmapped fields
- **v2.0 (2025-10-10):** Added registrar directory mapping
- **v1.0 (2025-09-15):** Initial comprehensive mapping

---

*Part of comprehensive database field mapping documentation. See [Master Index](screen-database-mapping-index.md) for navigation.*
