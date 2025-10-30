# Database Field Mapping Documentation - Extended Features & Admin Tables

**Last Updated:** 2025-10-30
**Schema Version:** 0029
**Documentation Version:** 3.0 (Split Architecture)
**Part:** 7 of 7

---

## 📋 Document Purpose

This document maps **extended features and administrative tables** that support advanced functionality, data quality management, and system administration. These tables are mostly admin-facing or future features not yet fully implemented in the UI.

**Tables Covered:**
- `ipoScores` - AI-powered IPO quality scoring (11 fields, **0% mapped** ⚠️)
- `anchorInvestors` - Institutional anchor investment data (10 fields, **0% mapped** ⚠️)
- `ipoDetails` - Extended IPO metadata (28 fields, **20% mapped**)
- `affiliateClicks` - Affiliate link click tracking (6 fields, **0% mapped**)
- `fieldProtectionMetadata` - Manual data protection system (11 fields, **admin-only**)
- `adminSettings` - System configuration (5 fields, **admin-only**)
- `auditLogs` - Admin action audit trail (15 fields, **admin-only**)

**Related Documentation:**
- [Master Index](screen-database-mapping-index.md) - Navigation hub
- [Core IPO Mapping](screen-database-mapping-core-ipo.md) - Base IPO data
- [Utilities Mapping](screen-database-mapping-utilities.md) - Broker affiliates
- [Scraper Priority Matrix](database-schema-scraper-mapping.md) - Data sourcing

---

## 🎯 Key Insights

### Table Categories

**User-Facing Features (Not Yet Implemented):**
1. **ipoScores** - AI scoring system (CRITICAL GAP ⭐⭐⭐)
2. **anchorInvestors** - Institutional investment signals (HIGH VALUE ⭐⭐)
3. **ipoDetails** - Extended IPO metadata (20% implemented)
4. **affiliateClicks** - Click tracking analytics (supports brokerAffiliates)

**Admin/Internal Features:**
5. **fieldProtectionMetadata** - Prevents scraper overwrite of manually edited data
6. **adminSettings** - System configuration key-value store
7. **auditLogs** - Compliance and security audit trail

### Coverage Analysis

| Table | Total Fields | Mapped in UI | Admin Only | Status |
|-------|-------------|--------------|------------|--------|
| **ipoScores** | 11 | 0 (0%) | No | ⚠️ **CRITICAL GAP** |
| **anchorInvestors** | 10 | 0 (0%) | No | ⚠️ **HIGH PRIORITY** |
| **ipoDetails** | 28 | 6 (21%) | No | 🟡 **PARTIAL** |
| **affiliateClicks** | 6 | 0 (0%) | No | 🟡 **ANALYTICS** |
| **fieldProtectionMetadata** | 11 | N/A | Yes | ✅ **ADMIN TOOL** |
| **adminSettings** | 5 | N/A | Yes | ✅ **ADMIN TOOL** |
| **auditLogs** | 15 | N/A | Yes | ✅ **COMPLIANCE** |

---

## ⭐ Table 1: IPO Scores (`ipoScores` table)

**Database:** `ipoScores`
**Type:** One-to-one relationship with `ipos`
**Total Fields:** 11
**Mapped in UI:** 0 fields (0% coverage) ⚠️
**Status:** **CRITICAL GAP** - Complete AI scoring system exists but hidden from users

### Schema Reference

```typescript
// From packages/shared/src/db/schema.ts
export const ipoScores = pgTable('ipo_scores', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').notNull().unique().references(() => ipos.id, { onDelete: 'cascade' }),

  // Score components (each 0-25, total 0-100)
  totalScore: integer('total_score').notNull(), // 0-100
  fundamentalScore: integer('fundamental_score').notNull(), // 0-25
  sentimentScore: integer('sentiment_score').notNull(), // 0-25
  subscriptionScore: integer('subscription_score').notNull(), // 0-25
  sectorScore: integer('sector_score').notNull(), // 0-25

  // Verdict and confidence
  verdict: ipoVerdictEnum('verdict').notNull(), // APPLY | CONSIDER | SKIP
  confidence: confidenceLevelEnum('confidence').notNull(), // HIGH | MEDIUM | LOW
  reasoning: text('reasoning'),

  // Metadata
  calculatedAt: timestamp('calculated_at').defaultNow().notNull(),
  algorithmVersion: varchar('algorithm_version', { length: 50 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Verdict Enum Values:**
- `APPLY` - Strong buy recommendation (total score 76-100)
- `CONSIDER` - Moderate recommendation (total score 51-75)
- `SKIP` - Avoid recommendation (total score 0-50)

**Confidence Enum Values:**
- `HIGH` - 90-100% data completeness
- `MEDIUM` - 70-89% data completeness
- `LOW` - <70% data completeness

---

### ⚠️ CRITICAL GAP: Complete Feature Hidden from Users

**Impact:** This is a **major AI-powered differentiating feature** that exists in the database but is completely unused in the UI. The scoring system analyzes 4 dimensions of IPO quality:

1. **Fundamental Score (0-25):** Financial health, revenue growth, profitability
2. **Sentiment Score (0-25):** Market sentiment, analyst recommendations, media coverage
3. **Subscription Score (0-25):** Demand indicators (QIB, NII, retail subscription)
4. **Sector Score (0-25):** Sector performance, industry trends

**Current Status:** Database implementation complete, scoring algorithm developed, but **zero UI implementation**.

---

### 🚀 Recommended Implementation Plan

#### Phase 1: Basic Display (1-2 weeks) ⭐⭐⭐

**Tasks:**
1. Add score badge to IPO cards (homepage, lists)
   - Display: "IPODhan Score: 78/100" with color coding
   - Green (76-100), Yellow (51-75), Red (0-50)

2. Create "IPO Score" section in IPO Detail page
   - Display total score prominently
   - Show verdict badge (APPLY/CONSIDER/SKIP)
   - Display confidence indicator

3. Add score breakdown chart
   - 4-bar chart showing component scores
   - Tooltips explaining each component

**Effort:** 40-60 hours

---

#### Phase 2: Advanced Features (2-3 weeks) ⭐⭐

**Tasks:**
4. Add reasoning text display
   - Show AI-generated explanation
   - Highlight key factors (bulleted list)

5. Implement score history chart
   - Show how score changed over time
   - Track algorithm version changes

6. Add filter by score on listing pages
   - Filter: High (76+), Medium (51-75), Low (0-50)
   - Sort by score option

**Effort:** 60-80 hours

---

#### Phase 3: Score Calculation API (1 week) ⭐

**Tasks:**
7. Create score calculation service
   - Real-time score calculation
   - Batch recalculation cron job

8. Admin panel for score management
   - Manual score override
   - Algorithm version control
   - Recalculation triggers

**Effort:** 40 hours

---

### 📊 Example UI Implementation

```
┌─────────────────────────────────────────────────────────┐
│ IPODhan Score: 78/100                          ✅ APPLY │
│ Confidence: HIGH (95% data complete)                    │
├─────────────────────────────────────────────────────────┤
│ Score Breakdown:                                         │
│                                                          │
│ 💰 Fundamental   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░  20/25            │
│ 📈 Sentiment     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░  22/25            │
│ 🎯 Subscription  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░  18/25            │
│ 🏭 Sector        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░  18/25            │
│                                                          │
│ 📝 Key Insights:                                        │
│ ✓ Strong revenue growth (45% CAGR)                     │
│ ✓ High institutional demand (78x QIB subscription)     │
│ ✓ Attractive valuation (PE 22 vs industry avg 28)     │
│ ⚠️ Sector volatility (IT sector down 12% YoY)          │
│                                                          │
│ Last Updated: 2 hours ago (Algorithm v2.1)              │
└─────────────────────────────────────────────────────────┘
```

---

## 🏦 Table 2: Anchor Investors (`anchorInvestors` table)

**Database:** `anchorInvestors`
**Type:** One-to-one relationship with `ipos`
**Total Fields:** 10
**Mapped in UI:** 0 fields (0% coverage) ⚠️
**Status:** **HIGH PRIORITY** - Critical institutional investment signal

### Schema Reference

```typescript
// From packages/shared/src/db/schema.ts
export const anchorInvestors = pgTable('anchor_investors', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').notNull().references(() => ipos.id, { onDelete: 'cascade' }),

  bidDate: date('bid_date').notNull(),
  totalSharesOffered: bigint('total_shares_offered', { mode: 'number' }).notNull(),
  totalAmountRaised: numeric('total_amount_raised', { precision: 12, scale: 2 }).notNull(),
  anchorInvestorsCount: integer('anchor_investors_count').notNull(),
  lockIn50PercentDate: date('lock_in_50_percent_date').notNull(),
  lockInRemainingDate: date('lock_in_remaining_date').notNull(),

  // JSONB array of individual investors
  investorList: jsonb('investor_list').$type<IndividualInvestor[]>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export interface IndividualInvestor {
  name: string; // e.g., "HDFC Mutual Fund"
  type: string; // e.g., "Mutual Fund", "FII", "Insurance", "PMS"
  shares: number; // Number of shares allocated
  amount: number; // Amount in ₹ crores
  percentOfIssue: number; // % of total IPO size
}
```

**Indexes:**
- `idx_anchor_investors_ipo_id` - Fast IPO lookup
- `idx_anchor_investors_bid_date` - Sort by bid date

---

### 💡 Business Value

**Anchor investor participation is one of the strongest signals of IPO quality:**
1. **Institutional Validation:** Blue-chip institutions (mutual funds, FIIs) conduct thorough due diligence
2. **Price Discovery:** Anchor bidding happens 1 day before IPO opens, sets demand tone
3. **Lock-in Commitment:** 50% lock-in for 30 days, 50% for 90 days - shows confidence
4. **Retail Signal:** High anchor participation often correlates with high retail subscription

**Typical Anchor Allocation:** 30-60% of QIB quota, varies by IPO size

---

### 🚀 Recommended Implementation Plan

#### Phase 1: Basic Display (1 week) ⭐⭐⭐

**Tasks:**
1. Create "Anchor Investors" tab in IPO Detail page
   - Display after Subscription tab
   - Show only if anchor data exists

2. Summary statistics card
   - Total anchor allocation (shares & amount)
   - Number of anchor investors
   - % of IPO size allocated to anchors

3. Investor list table
   - Columns: Name, Type, Shares, Amount (₹ Cr), % of Issue
   - Sortable by amount/shares
   - Badge for investor type (Mutual Fund, FII, Insurance)

**Effort:** 30-40 hours

---

#### Phase 2: Enhanced Features (1 week) ⭐⭐

**Tasks:**
4. Lock-in timeline visualization
   - Show 50% lock-in expiry date
   - Show remaining 50% lock-in expiry date
   - Countdown timer for upcoming lock-in expiry

5. Investor type breakdown chart
   - Pie chart: Mutual Funds vs FIIs vs Insurance
   - Show institutional confidence indicator

6. Add to Compare Tool
   - Compare anchor allocation across 3 IPOs
   - Highlight highest institutional interest

**Effort:** 20-30 hours

---

### 📊 Example UI Implementation

```
┌─────────────────────────────────────────────────────────┐
│ Anchor Investors (Pre-IPO Institutional Allocation)     │
├─────────────────────────────────────────────────────────┤
│ 📊 Summary:                                             │
│   • Total Allocated: 1,50,00,000 shares (₹450 Cr)      │
│   • Anchor Investors: 28                                │
│   • % of IPO Size: 35% (Strong institutional demand)   │
│   • Bid Date: 14 Oct 2025 (1 day before IPO open)      │
│                                                          │
│ 🔒 Lock-in Timeline:                                    │
│   • 50% (₹225 Cr) unlocks: 13 Nov 2025 (30 days) ⏳    │
│   • 50% (₹225 Cr) unlocks: 12 Jan 2026 (90 days)       │
│                                                          │
│ 💼 Top Anchor Investors:                                │
│                                                          │
│ Name                      | Type     | Amount   | % of  │
│                           |          | (₹ Cr)   | Issue │
│ ────────────────────────────────────────────────────────│
│ HDFC Mutual Fund          | MF       | 75.00    | 8.3%  │
│ Goldman Sachs (FII)       | FII      | 60.00    | 6.7%  │
│ ICICI Prudential Life     | Insurance| 55.00    | 6.1%  │
│ SBI Mutual Fund           | MF       | 50.00    | 5.6%  │
│ ... and 24 more investors                              │
│                                                          │
│ [View Full List →]                                      │
└─────────────────────────────────────────────────────────┘
```

---

## 📋 Table 3: IPO Details (`ipoDetails` table)

**Database:** `ipoDetails`
**Type:** One-to-one relationship with `ipos`
**Total Fields:** 28
**Mapped in UI:** 6 fields (21% coverage)
**Status:** Partial implementation

### Schema Reference (Condensed)

```typescript
export const ipoDetails = pgTable('ipo_details', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').notNull().unique().references(() => ipos.id, { onDelete: 'cascade' }),

  // Issue structure (✅ MAPPED - 3 fields)
  issueType: issueTypeEnum('issue_type'), // BOOK_BUILDING | FIXED_PRICE | HYBRID
  freshIssue: numeric('fresh_issue', { precision: 12, scale: 2 }),
  ofsIssue: numeric('ofs_issue', { precision: 12, scale: 2 }),

  // Pricing (⏳ PARTIALLY MAPPED - 2 fields)
  cutOffPrice: numeric('cut_off_price', { precision: 10, scale: 2 }),
  minInvestment: numeric('min_investment', { precision: 12, scale: 2 }),

  // Registration (✅ MAPPED - 1 field)
  registrarLink: varchar('registrar_link', { length: 500 }),

  // Identifiers (❌ UNMAPPED - critical)
  isin: varchar('isin', { length: 12 }),
  faceValue: numeric('face_value', { precision: 10, scale: 2 }),

  // Extended timeline dates (❌ UNMAPPED - 3 fields)
  basisOfAllotmentDate: date('basis_of_allotment_date'),
  initiationOfRefundsDate: date('initiation_of_refunds_date'),
  creditOfSharesDate: date('credit_of_shares_date'),

  // Alternative data (❌ UNMAPPED - duplicates from ipos table)
  leadManagers: text('lead_managers').array(),
  exchanges: text('exchanges').array(),
  companyDescription: text('company_description'),

  // Metadata
  dataSource: varchar('data_source', { length: 50 }).notNull(),
  lastVerifiedAt: timestamp('last_verified_at'),

  // Company contact info (❌ UNMAPPED - 9 fields)
  companyAddress: text('company_address'),
  companyPhone: varchar('company_phone', { length: 50 }),
  companyEmail: varchar('company_email', { length: 255 }),
  companyCity: varchar('company_city', { length: 100 }),
  companyState: varchar('company_state', { length: 100 }),
  companyPincode: varchar('company_pincode', { length: 10 }),
  complianceOfficer: varchar('compliance_officer', { length: 255 }),
  complianceOfficerPhone: varchar('compliance_officer_phone', { length: 50 }),
  complianceOfficerEmail: varchar('compliance_officer_email', { length: 255 }),

  // Category reservation details (❌ UNMAPPED - 6 fields)
  qibSharesOffered: bigint('qib_shares_offered', { mode: 'number' }),
  niiSharesOffered: bigint('nii_shares_offered', { mode: 'number' }),
  retailSharesOffered: bigint('retail_shares_offered', { mode: 'number' }),
  retailMaxAllottees: integer('retail_max_allottees'),
  employeeSharesOffered: bigint('employee_shares_offered', { mode: 'number' }),
  anchorSharesOffered: bigint('anchor_shares_offered', { mode: 'number' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Note:** This table partially duplicates data from `ipos` table. Some organizations prefer a separate "extended details" table for optional/less-used fields.

---

### 🎯 High-Priority Missing Fields

#### 1. ISIN Code ⭐⭐⭐

**Field:** `isin`
**Impact:** International Securities Identification Number (ISIN) is a **standard identifier** used globally. Critical for:
- International investors
- Stock exchange APIs
- Portfolio management systems
- Trading platforms

**Recommendation:** Display in IPO Detail page header next to company name

---

#### 2. Extended Timeline Dates ⭐⭐

**Fields:** `basisOfAllotmentDate`, `initiationOfRefundsDate`, `creditOfSharesDate`

**Impact:** These dates matter for investors tracking their applications:
- **Basis of Allotment:** When allotment status is finalized (important milestone)
- **Refunds:** When rejected applicants get refunds (fund unlock timing)
- **Credit of Shares:** When shares credited to demat account (ownership transfer)

**Recommendation:** Add to IPO timeline/calendar visualization

---

#### 3. Company Contact Information ⭐

**Fields:** 9 contact fields (address, phone, email, compliance officer)

**Impact:** Investors may need to contact company for queries, complaints, or documentation.

**Recommendation:** Add "Company Contact" expandable section in IPO Detail page footer

---

#### 4. Category Reservation Breakdown ⭐⭐

**Fields:** Shares offered to each category (QIB, NII, Retail, Employee, Anchor)

**Impact:** Helps investors understand allocation structure and competition within their category.

**Recommendation:** Display in Subscription Tab as "Reservation Details" card

---

## 📊 Table 4: Affiliate Clicks (`affiliateClicks` table)

**Database:** `affiliateClicks`
**Type:** Time-series click tracking
**Total Fields:** 6
**Mapped in UI:** 0 fields (0% coverage)
**Status:** Analytics table (no UI display needed, used for reporting)

### Schema Reference

```typescript
export const affiliateClicks = pgTable('affiliate_clicks', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').references(() => ipos.id, { onDelete: 'set null' }),
  broker: varchar('broker', { length: 50 }).notNull(), // 'zerodha' | 'angelone'
  source: varchar('source', { length: 50 }).notNull(), // 'ipo_detail' | 'homepage' | 'affiliates'
  userSession: varchar('user_session', { length: 255 }), // Session ID for analytics
  clickedAt: timestamp('clicked_at').defaultNow().notNull(),
});
```

**Indexes:**
- `idx_affiliate_clicks_broker` - Group by broker
- `idx_affiliate_clicks_clicked_at` - Time-series queries
- `idx_affiliate_clicks_ipo_id` - IPO-specific conversion tracking

---

### 🎯 Usage: Analytics & Reporting

This table supports the `brokerAffiliates` system (see [Utilities Mapping](screen-database-mapping-utilities.md#broker-affiliates-migration)) and enables:

1. **Conversion Rate Analysis:**
   - Clicks per broker
   - IPO detail page → affiliate conversion rate
   - Homepage → affiliate conversion rate

2. **A/B Testing:**
   - Test broker display order
   - Test CTA button text
   - Test affiliate link placement

3. **Revenue Attribution:**
   - Track which IPOs drive most affiliate clicks
   - Identify high-converting brokers
   - Optimize affiliate partnerships

**Admin Dashboard Queries:**
```sql
-- Top brokers by clicks (last 30 days)
SELECT broker, COUNT(*) as click_count
FROM affiliate_clicks
WHERE clicked_at > NOW() - INTERVAL '30 days'
GROUP BY broker
ORDER BY click_count DESC;

-- Conversion funnel by source
SELECT source, COUNT(*) as clicks
FROM affiliate_clicks
WHERE clicked_at > NOW() - INTERVAL '7 days'
GROUP BY source;

-- IPO-specific affiliate performance
SELECT i.company_name, ac.broker, COUNT(*) as clicks
FROM affiliate_clicks ac
JOIN ipos i ON ac.ipo_id = i.id
WHERE ac.clicked_at > NOW() - INTERVAL '30 days'
GROUP BY i.company_name, ac.broker
ORDER BY clicks DESC;
```

**No UI Implementation Needed** - This is a backend analytics table.

---

## 🔒 Table 5: Field Protection Metadata (`fieldProtectionMetadata` table)

**Database:** `fieldProtectionMetadata`
**Type:** Manual data management system
**Total Fields:** 11
**Status:** Admin-only tool (no user-facing UI)

### Schema Reference

```typescript
export const fieldProtectionMetadata = pgTable('field_protection_metadata', {
  id: uuid('id').primaryKey().defaultRandom(),
  tableName: varchar('table_name', { length: 100 }).notNull(),
  fieldName: varchar('field_name', { length: 100 }).notNull(),
  ipoId: uuid('ipo_id').notNull().references(() => ipos.id, { onDelete: 'cascade' }),

  // Protection flags
  isProtected: boolean('is_protected').default(false).notNull(),
  autoProtected: boolean('auto_protected').default(false).notNull(),

  // Manual edit tracking
  manuallyEditedAt: timestamp('manually_edited_at'),
  manuallyEditedBy: varchar('manually_edited_by', { length: 255 }),
  editNote: text('edit_note'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Indexes:**
- `idx_field_protection_ipo_id` - Fast IPO lookup
- `idx_field_protection_table_name` - Filter by table
- `idx_field_protection_is_protected` - Find protected fields
- `unique_field_per_ipo` - One protection record per (table + field + IPO)

---

### 🎯 Purpose: Prevent Scraper Overwrites

**Problem:** When an admin manually corrects a scraped field (e.g., fixing incorrect lot size), the next scraper run would overwrite the manual correction.

**Solution:** Field protection system that:
1. **Marks fields as protected** when manually edited
2. **Prevents scraper overwrites** of protected fields
3. **Tracks edit history** for audit trail
4. **Auto-protects** fields after manual edit (optional)

**Use Cases:**
- Admin fixes incorrect financial data extracted from PDF
- Admin manually enters GMP data when Chittorgarh is down
- Admin corrects listing date scraped incorrectly

**Admin Panel Workflow:**
```
1. Admin edits IPO field in admin panel
2. System creates protection record:
   - tableName: 'ipos'
   - fieldName: 'lotSize'
   - ipoId: 'uuid-123'
   - isProtected: true
   - autoProtected: true
   - manuallyEditedBy: 'admin@ipodhan.com'
   - editNote: 'Corrected lot size from prospectus (scraper had wrong value)'

3. Next scraper run:
   - Scraper attempts to update lotSize
   - Protection system checks fieldProtectionMetadata
   - Finds isProtected = true
   - Skips update, logs warning

4. Admin can later:
   - Remove protection (allow scraper updates again)
   - View edit history
   - Add notes for future reference
```

**No User-Facing UI Needed** - This is an internal data quality tool.

---

## ⚙️ Table 6: Admin Settings (`adminSettings` table)

**Database:** `adminSettings`
**Type:** Key-value configuration store
**Total Fields:** 5
**Status:** Admin-only (no user-facing UI)

### Schema Reference

```typescript
export const adminSettings = pgTable('admin_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  settingKey: varchar('setting_key', { length: 100 }).notNull().unique(),
  settingValue: text('setting_value'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Indexes:**
- `idx_admin_settings_key` - Fast key lookup

---

### 🎯 Purpose: Flexible System Configuration

**Use Cases:**
- Feature flags (enable/disable features without deployment)
- Scraper configuration (intervals, rate limits)
- Maintenance mode toggle
- API keys for third-party services
- Global announcements/banners
- A/B testing variants

**Example Settings:**
```typescript
// Feature flags
{ settingKey: 'feature_ipo_scoring', settingValue: 'true' }
{ settingKey: 'feature_anchor_investors', settingValue: 'false' }

// Scraper config
{ settingKey: 'scraper_nse_interval_minutes', settingValue: '10' }
{ settingKey: 'scraper_bse_rate_limit', settingValue: '30' }

// Maintenance
{ settingKey: 'maintenance_mode', settingValue: 'false' }
{ settingKey: 'maintenance_message', settingValue: 'Scheduled maintenance tonight 10 PM - 2 AM IST' }

// Global banner
{ settingKey: 'global_banner_enabled', settingValue: 'true' }
{ settingKey: 'global_banner_text', settingValue: 'New feature: IPO Scoring now live!' }

// API keys (encrypted)
{ settingKey: 'api_key_capital_line', settingValue: 'encrypted_key_here' }
```

**Admin Panel:** Simple CRUD interface for managing settings

**No User-Facing UI Needed** - Configuration happens in admin panel only

---

## 📜 Table 7: Audit Logs (`auditLogs` table)

**Database:** `auditLogs`
**Type:** Immutable audit trail
**Total Fields:** 15
**Status:** Admin-only compliance/security tool

### Schema Reference

```typescript
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  adminUser: varchar('admin_user', { length: 255 }).notNull(),
  actionType: varchar('action_type', { length: 100 }).notNull(),

  // Related IPO (nullable)
  ipoId: uuid('ipo_id').references(() => ipos.id, { onDelete: 'set null' }),

  // Field-level changes
  tableName: varchar('table_name', { length: 100 }),
  fieldName: varchar('field_name', { length: 100 }),
  oldValue: text('old_value'),
  newValue: text('new_value'),

  // Additional context
  details: jsonb('details'), // Structured data

  // Request metadata
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),

  // Execution status
  success: boolean('success').default(true).notNull(),
  errorMessage: text('error_message'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

**Indexes:**
- `idx_audit_logs_timestamp` - Time-series queries (DESC)
- `idx_audit_logs_admin_user` - Filter by user
- `idx_audit_logs_ipo_id` - IPO-specific audit trail
- `idx_audit_logs_action_type` - Group by action
- `idx_audit_logs_timestamp_admin` - Common query pattern

---

### 🎯 Purpose: Compliance & Security

**Audit Log Types:**
1. **Field Updates:**
   - Action: "Field Updated"
   - Captures: tableName, fieldName, oldValue, newValue
   - Example: Admin changed lotSize from 50 to 100

2. **IPO Lifecycle:**
   - Action: "IPO Created", "IPO Published", "IPO Locked", "IPO Deleted"
   - Captures: ipoId, details (JSON)

3. **Protection Changes:**
   - Action: "Protection Enabled", "Protection Removed"
   - Captures: tableName, fieldName, ipoId

4. **Admin Actions:**
   - Action: "Admin Login", "Admin Logout", "Password Changed"
   - Captures: adminUser, ipAddress, userAgent

5. **Scraper Overrides:**
   - Action: "Scraper Override", "Manual Data Entry"
   - Captures: dataSource, oldValue, newValue

**Compliance Requirements:**
- **Immutable:** No updates or deletes allowed (INSERT only)
- **Retention:** 7 years minimum (regulatory requirement)
- **Security:** Admin access only, encrypted backups

**Admin Dashboard Queries:**
```sql
-- Recent admin actions (last 24 hours)
SELECT timestamp, admin_user, action_type, details
FROM audit_logs
WHERE timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC
LIMIT 100;

-- IPO change history
SELECT timestamp, admin_user, action_type, field_name, old_value, new_value
FROM audit_logs
WHERE ipo_id = 'uuid-123'
ORDER BY timestamp DESC;

-- Suspicious activity detection
SELECT admin_user, COUNT(*) as action_count
FROM audit_logs
WHERE timestamp > NOW() - INTERVAL '1 hour'
  AND success = false
GROUP BY admin_user
HAVING COUNT(*) > 50;
```

**No User-Facing UI Needed** - Admin security/compliance tool only

---

## 📊 Summary: Implementation Priority Matrix

### Critical User-Facing Gaps (High ROI)

| Feature | Table | Fields | Effort | Impact | Priority | Status |
|---------|-------|--------|--------|--------|----------|--------|
| **IPO Scoring** | ipoScores | 11 | 100h | ⭐⭐⭐ Very High | **P0** | Not started |
| **Anchor Investors** | anchorInvestors | 10 | 60h | ⭐⭐⭐ High | **P0** | Not started |
| **ISIN Display** | ipoDetails | 1 | 4h | ⭐⭐⭐ High | **P0** | Not started |
| **Extended Timeline** | ipoDetails | 3 | 8h | ⭐⭐ Medium | **P1** | Not started |
| **Company Contact** | ipoDetails | 9 | 12h | ⭐ Low | **P2** | Not started |

### Admin/Internal Tools (Already Functional)

| Feature | Table | Fields | Status | Notes |
|---------|-------|--------|--------|-------|
| **Field Protection** | fieldProtectionMetadata | 11 | ✅ Working | Prevents scraper overwrites |
| **Admin Settings** | adminSettings | 5 | ✅ Working | Configuration key-value store |
| **Audit Logs** | auditLogs | 15 | ✅ Working | Compliance & security |
| **Affiliate Tracking** | affiliateClicks | 6 | ✅ Working | Analytics (no UI needed) |

---

## 🚀 Recommended Implementation Roadmap

### Q1 2026: Critical Gaps ⭐⭐⭐

**Week 1-3: IPO Scoring System (P0)**
- Week 1: Basic score display (cards, badges)
- Week 2: Score breakdown & reasoning
- Week 3: Score calculation API & admin panel

**Week 4-5: Anchor Investors (P0)**
- Week 4: Anchor tab & investor list
- Week 5: Lock-in timeline & charts

**Week 6: ISIN & Timeline (P0, P1)**
- Display ISIN in IPO Detail header
- Add extended timeline dates to calendar

**Total Effort:** ~180 hours (6 weeks, 1 developer)

---

### Q2 2026: Enhanced Features ⭐⭐

**Weeks 1-2: Company Contact Information (P2)**
- Add "Company Contact" section
- Compliance officer details
- Interactive map for office location

**Weeks 3-4: Category Reservation Breakdown (P1)**
- Display shares offered per category
- Allocation probability calculator
- Historical allotment rates

**Total Effort:** ~40 hours (4 weeks part-time)

---

## 🔗 Related Tables & Dependencies

### Upstream Dependencies

**These tables are required:**
- `ipos` - All extended tables reference this via foreign key
- `financialData` - Required for IPO scoring (fundamental score)
- `subscriptions` - Required for IPO scoring (subscription score)
- `gmpRecords` - Required for IPO scoring (sentiment score)

### Downstream Consumers

**These features would use extended tables:**
- IPO Detail Page - Display scores, anchor investors, extended details
- IPO Cards - Show score badges
- Compare Tool - Compare scores and anchor allocation
- Admin Panel - Manage field protection, settings, audit logs
- Analytics Dashboard - Affiliate click reports

---

## 📚 Related Documentation

**Feature Implementation:**
- [Core IPO Mapping](screen-database-mapping-core-ipo.md) - Base IPO data
- [Financials Mapping](screen-database-mapping-financials.md) - Financial data for scoring
- [Subscription-GMP Mapping](screen-database-mapping-subscription-gmp.md) - Demand data for scoring

**Architecture:**
- [Backend Architecture](../02-architecture/backend-architecture.md) - Repository patterns
- [Testing Strategy](../02-architecture/testing-strategy.md) - How to test new features

**Admin Tools:**
- [Utilities Mapping](screen-database-mapping-utilities.md) - Broker affiliates system

---

## 📧 Document Maintenance

**Owner Team:** Product Team + Data Engineering Team
**Review Frequency:** Monthly (as features are implemented)
**Last Reviewed:** 2025-10-30
**Next Review:** 2025-11-30

**Update Triggers:**
- IPO scoring system implemented
- Anchor investors feature implemented
- New admin tool added
- Schema migration affecting these tables

---

**Version History:**
- **v3.0 (2025-10-30):** Initial creation covering 7 extended/admin tables
- **v2.x:** N/A (first version)
- **v1.x:** N/A (first version)

---

*Part of comprehensive database field mapping documentation. See [Master Index](screen-database-mapping-index.md) for navigation.*
