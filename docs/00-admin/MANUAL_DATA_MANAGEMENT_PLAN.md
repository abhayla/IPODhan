# Comprehensive Manual Data Management System - Implementation Plan

**Date Created**: 2025-10-22
**Status**: Approved
**Estimated Timeline**: 6 weeks
**Priority**: High

---

## 🎯 Executive Summary

**Objective**: Build admin-only data management system with field-level + IPO-level protection flags to prevent scraper overwrites on manually edited data.

**Scope**: All 13 database tables, 32 UI screens, 19 scrapers, extensible notification system.

**Requirements Confirmed**:
1. ✅ **Access Control**: Admin users only (separate admin panel/dashboard)
2. ✅ **Flag Priority**: IPO-level flag overrides all (complete lockdown when ON)
3. ✅ **Admin UI**: Hybrid - view public page + edit via modal/sidebar
4. ✅ **Audit Trail**: Manual edit flag only (no full history tracking)
5. ✅ **Scraper Behavior**: Notify admin when blocked (Telegram later)
6. ✅ **Table Scope**: All 13 tables (comprehensive)
7. ✅ **Initial State**: All flags OFF (scraper can update everything initially)
8. ✅ **Auto-Lock on Edit**: Editing a field automatically sets protection flag (admin can toggle off)
9. ✅ **Architectural Enforcement**: ALL features auto-applied to new fields/tables/scrapers (zero manual code)

**🚀 CRITICAL REQUIREMENT - Future-Proofing**:

This system MUST be **self-extending**. When a developer:
- Adds a new database field → Admin UI + protection + auto-lock **automatically available**
- Adds a new table → Full CRUD admin page **automatically generated**
- Creates a new scraper → Protection checks **automatically enforced**

**Zero manual code required. The system introspects the schema and generates everything.**

---

## 📊 System Analysis Complete

### Current State Assessment:
- **UI Screens**: 32 total (26 data-driven + 6 static)
- **Database Tables**: 13 tables with 150+ fields
  - Core: `ipos` (40+ fields), `financialData`, `listingPerformance`
  - Time-series: `subscriptions`, `gmpRecords`
  - Supporting: `documents`, `peerCompanies`, `ipoReviews`, `marketHolidays`, `registrars`
  - Meta: `ipoScores`, `ipoFinancials`, `ipoDetails`, `brokerAffiliates`, `affiliateClicks`, `scraperLogs`
- **Scrapers**: 19 scraper files covering:
  - NSE (primary), BSE (primary), Moneycontrol, Chittorgarh, InvestorGain
  - Orchestrators, detail scrapers, document scrapers, GMP scrapers, listing performance updaters
- **Architecture**: Repository → Service → API Route pattern with Redis caching

### Key Findings:
1. **Most edited fields**: `company_name` (16 screens), `open_date/close_date` (12 screens), `status` (13 screens)
2. **Time-series tables**: `subscriptions`, `gmpRecords` need special handling for protection
3. **Calculated fields**: `listing_gain_percent`, `current_gain_percent` are derived, not scraped (no protection needed)
4. **Scraper pattern**: All scrapers use orchestrator → validator → persister → cache invalidator flow
5. **Existing protection**: `ipos.rating_override` already implements manual override pattern

---

## 🏗️ Architecture Design

### 1. Database Schema Changes

#### New Table: `field_protection_metadata`

**Purpose**: Store field-level protection flags for any table/field combination.

```sql
CREATE TABLE field_protection_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(100) NOT NULL,
  field_name VARCHAR(100) NOT NULL,
  ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
  is_protected BOOLEAN DEFAULT false,
  manually_edited_at TIMESTAMP,
  manually_edited_by VARCHAR(255), -- admin user ID (future auth)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(table_name, field_name, ipo_id)
);

-- Indexes for performance
CREATE INDEX idx_field_protection_ipo ON field_protection_metadata(ipo_id);
CREATE INDEX idx_field_protection_table_field ON field_protection_metadata(table_name, field_name);
CREATE INDEX idx_field_protection_protected ON field_protection_metadata(is_protected) WHERE is_protected = true;
```

**Example Records**:
```sql
-- Protect company_name for specific IPO
INSERT INTO field_protection_metadata (table_name, field_name, ipo_id, is_protected, manually_edited_at)
VALUES ('ipos', 'company_name', 'uuid-123', true, NOW());

-- Protect revenue_fy2024 in financialData
INSERT INTO field_protection_metadata (table_name, field_name, ipo_id, is_protected)
VALUES ('financial_data', 'revenue_fy2024', 'uuid-123', true);
```

#### New Columns in `ipos` Table

**Purpose**: Master IPO-level protection lock.

```sql
-- Migration: Add IPO-level protection
ALTER TABLE ipos ADD COLUMN scraper_locked BOOLEAN DEFAULT false;
ALTER TABLE ipos ADD COLUMN scraper_lock_note TEXT;
ALTER TABLE ipos ADD COLUMN last_manual_edit_at TIMESTAMP;

-- Index for scraper queries
CREATE INDEX idx_ipos_scraper_locked ON ipos(scraper_locked);
```

#### Flag Behavior Logic

**Priority Hierarchy**:
1. **Check IPO-level lock first** (`ipos.scraper_locked`):
   - If `true` → Skip entire IPO, log notification, return early
   - If `false` → Proceed to field-level checks

2. **Check field-level protection** (`field_protection_metadata`):
   - Query all protected fields for this IPO
   - Filter out protected fields from update data
   - Log each skipped field for notification

**Pseudocode**:
```typescript
function filterScrapedData(ipoId, tableName, scrapedData) {
  // Step 1: Check IPO-level lock
  const ipo = await getIPO(ipoId);
  if (ipo.scraper_locked) {
    logBlockedUpdate(ipoId, tableName, 'ALL_FIELDS', 'IPO_LOCKED');
    return null; // Skip entire IPO
  }

  // Step 2: Check field-level protection
  const protections = await getFieldProtections(ipoId, tableName);
  const filteredData = { ...scrapedData };

  for (const field of Object.keys(scrapedData)) {
    const isProtected = protections.some(
      p => p.field_name === field && p.is_protected
    );

    if (isProtected) {
      logBlockedUpdate(ipoId, tableName, field, scrapedData[field]);
      delete filteredData[field];
    }
  }

  return filteredData;
}
```

---

### 2. Admin Panel Architecture

#### Route Structure

```
web/app/admin/
├── layout.tsx                    # Admin shell with auth check
├── page.tsx                      # Admin dashboard (IPO list with edit buttons)
├── login/
│   └── page.tsx                  # Simple password login
├── edit/[slug]/
│   ├── page.tsx                  # Hybrid view: Public page with edit modal trigger
│   ├── components/
│   │   ├── EditModal.tsx         # Main edit modal with tabbed sections
│   │   ├── BasicInfoForm.tsx     # Company name, dates, status, sector, etc.
│   │   ├── FinancialForm.tsx     # Financial data fields (revenue, profit, ratios)
│   │   ├── SubscriptionForm.tsx  # Subscription data (latest snapshot)
│   │   ├── GMPForm.tsx           # GMP fields
│   │   ├── ListingForm.tsx       # Listing performance
│   │   ├── DocumentsForm.tsx     # Documents management (upload, delete)
│   │   ├── PeerCompaniesForm.tsx # Peer comparison data
│   │   ├── ReviewsForm.tsx       # IPO reviews
│   │   ├── FieldLockToggle.tsx   # Individual field protection toggle
│   │   ├── IPOLockToggle.tsx     # Master IPO lock toggle
│   │   └── ProtectionPanel.tsx   # Unified protection management
│   └── actions.ts                # Server actions for form submission
├── notifications/
│   ├── page.tsx                  # Scraper conflict dashboard
│   └── components/
│       ├── BlockedUpdatesList.tsx # Table of blocked updates
│       └── ConflictResolveModal.tsx # Review scraped vs manual data
├── settings/
│   └── page.tsx                  # Admin settings (change password, Telegram webhook)
├── api/
│   ├── update-field/route.ts     # PATCH /admin/api/update-field
│   ├── toggle-lock/route.ts      # POST /admin/api/toggle-lock
│   ├── notifications/route.ts    # GET /admin/api/notifications (scraper blocks)
│   └── field-protection/[ipoId]/route.ts # GET protection flags
└── components/
    ├── AdminNav.tsx              # Admin navigation
    ├── ProtectionStatusBadge.tsx # Visual indicator for protected fields
    ├── ScraperConflictAlert.tsx  # Show when scraper tried to update
    └── AuthGuard.tsx             # HOC for admin route protection
```

#### Authentication Approach

**Phase 1: Simple Password-Based Auth**
```typescript
// web/lib/auth/admin-auth.ts
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'secret');

export async function verifyAdminPassword(password: string): Promise<boolean> {
  return password === ADMIN_PASSWORD;
}

export async function createAdminSession(): Promise<string> {
  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(JWT_SECRET);

  return token;
}

export async function verifyAdminSession(): Promise<boolean> {
  const token = cookies().get('admin_session')?.value;
  if (!token) return false;

  try {
    await jwtVerify(token, JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}
```

**Phase 2: NextAuth.js Integration (Future)**
- Add NextAuth.js with database adapter
- Admin role stored in user table
- Support multiple admin users with audit trail

#### Admin Dashboard Features

**IPO List View**:
- Search bar (fuzzy search by company name)
- Filters: Status (OPEN, CLOSED, LISTED), Segment (MAINBOARD, SME), Protection Status (Locked, Partially Protected, Open)
- Table columns: Company, Status, Segment, Last Edited, Protection Status, Edit Button
- Bulk actions: Lock/Unlock multiple IPOs

**Edit Modal Features**:
```typescript
interface EditModalProps {
  ipoId: string;
  slug: string;
  initialData: IPO & RelatedData;
  protectionFlags: FieldProtectionMap;
}

<EditModal ipoId={id} slug={slug}>
  <Tabs>
    {/* Tab 1: Basic Info */}
    <Tab label="Basic Info" icon={<InfoIcon />}>
      <FieldGroup label="Company Details">
        <TextField
          name="company_name"
          label="Company Name"
          value={ipo.companyName}
          protected={fieldProtection.company_name}
          onToggleProtection={() => toggleFieldLock('ipos', 'company_name')}
          onChange={(val) => handleFieldChange('company_name', val)}
        />
        <TextField name="symbol" label="Stock Symbol" ... />
        <TextField name="isin" label="ISIN" ... />
        <SelectField name="segment" options={['MAINBOARD', 'SME']} ... />
        <TextField name="sector" ... />
      </FieldGroup>

      <FieldGroup label="Issue Details">
        <DateField name="open_date" label="Open Date" ... />
        <DateField name="close_date" label="Close Date" ... />
        <DateField name="allotment_date" label="Allotment Date" ... />
        <DateField name="listing_date" label="Listing Date" ... />
      </FieldGroup>

      <FieldGroup label="Pricing">
        <NumberField name="price_range_min" label="Min Price" ... />
        <NumberField name="price_range_max" label="Max Price" ... />
        <NumberField name="lot_size" label="Lot Size" ... />
        <NumberField name="face_value" label="Face Value" ... />
        <NumberField name="issue_size" label="Issue Size (Cr)" ... />
      </FieldGroup>
    </Tab>

    {/* Tab 2: Financials */}
    <Tab label="Financials" icon={<ChartIcon />}>
      <FinancialForm ipoId={id} protection={fieldProtection} />
      {/* Revenue FY1/2/3, Profit FY1/2/3, PE Ratio, ROE, etc. */}
    </Tab>

    {/* Tab 3: Subscription */}
    <Tab label="Subscription" icon={<TrendingIcon />}>
      <SubscriptionForm ipoId={id} protection={fieldProtection} />
      {/* QIB, NII, Retail subscription multiples */}
      {/* Note: Time-series data - editing creates new snapshot */}
    </Tab>

    {/* Tab 4: GMP */}
    <Tab label="GMP" icon={<CurrencyIcon />}>
      <GMPForm ipoId={id} protection={fieldProtection} />
      {/* GMP price, percentage, expected listing price */}
    </Tab>

    {/* Tab 5: Listing Performance */}
    <Tab label="Listing" icon={<RocketIcon />}>
      <ListingForm ipoId={id} protection={fieldProtection} />
      {/* Listing price, current price, gain percentages */}
    </Tab>

    {/* Tab 6: Documents */}
    <Tab label="Documents" icon={<FileIcon />}>
      <DocumentsForm ipoId={id} />
      {/* Upload DRHP, RHP, Prospectus, Basis of Allotment */}
      {/* List existing documents with delete option */}
    </Tab>

    {/* Tab 7: Peer Companies */}
    <Tab label="Peers" icon={<CompareIcon />}>
      <PeerCompaniesForm ipoId={id} protection={fieldProtection} />
      {/* Add/edit peer companies with financial metrics */}
    </Tab>

    {/* Tab 8: Reviews */}
    <Tab label="Reviews" icon={<ReviewIcon />}>
      <ReviewsForm ipoId={id} />
      {/* Add manual reviews (title, author, recommendation, content) */}
    </Tab>

    {/* Tab 9: Protection Settings */}
    <Tab label="Protection" icon={<LockIcon />}>
      <ProtectionPanel>
        {/* IPO-Level Lock */}
        <IPOLockToggle
          locked={ipo.scraper_locked}
          note={ipo.scraper_lock_note}
          onToggle={(locked, note) => toggleIPOLock(id, locked, note)}
        />

        {/* Field-Level Protection */}
        <FieldProtectionList
          tables={['ipos', 'financial_data', 'listing_performance']}
          protections={fieldProtection}
          onToggleField={(table, field, protected) =>
            toggleFieldLock(id, table, field, protected)
          }
        />

        {/* Bulk Actions */}
        <Button onClick={() => protectAllFields(id)}>
          Protect All Fields
        </Button>
        <Button onClick={() => unprotectAllFields(id)}>
          Unprotect All Fields
        </Button>
      </ProtectionPanel>
    </Tab>
  </Tabs>

  {/* Save/Cancel Footer */}
  <ModalFooter>
    <Button variant="ghost" onClick={onClose}>Cancel</Button>
    <Button onClick={handleSave} disabled={!hasChanges}>
      Save Changes
    </Button>
  </ModalFooter>
</EditModal>
```

**Visual Indicators**:
- 🔒 **Lock icon** next to protected fields in edit form
- 🔐 **Badge** on IPO card if `scraper_locked=true` (red "Locked" badge)
- 🟡 **Warning badge** if scraper attempted update but was blocked (orange "Conflict" badge)
- 📝 **Edit indicator** showing last manual edit timestamp
- ✅ **Saved indicator** showing successful save

---

### 3. Scraper Modification Strategy

#### New Utility: Field Protection Checker

**Location**: `scraper/src/utils/field-protection-checker.ts`

```typescript
import { db, getRedisClient } from '@ipodhan/shared';
import { eq, and } from 'drizzle-orm';
import { ipos, fieldProtectionMetadata } from '@ipodhan/shared/db/schema';
import logger from './logger.js';

export interface FieldProtection {
  tableName: string;
  fieldName: string;
  isProtected: boolean;
  editedAt: Date | null;
  editedBy: string | null;
}

/**
 * Check if entire IPO is locked from scraper updates
 */
export async function isIPOLocked(ipoId: string): Promise<boolean> {
  const redis = getRedisClient();
  const cacheKey = `protection:ipo:${ipoId}`;

  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    return cached === 'true';
  }

  // Query database
  const [ipo] = await db
    .select({ scraperLocked: ipos.scraperLocked })
    .from(ipos)
    .where(eq(ipos.id, ipoId))
    .limit(1);

  const locked = ipo?.scraperLocked ?? false;

  // Cache for 1 hour
  await redis.setex(cacheKey, 3600, locked ? 'true' : 'false');

  return locked;
}

/**
 * Check if specific field is protected
 */
export async function isFieldProtected(
  ipoId: string,
  tableName: string,
  fieldName: string
): Promise<boolean> {
  const redis = getRedisClient();
  const cacheKey = `protection:field:${ipoId}:${tableName}:${fieldName}`;

  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    return cached === 'true';
  }

  // Query database
  const [protection] = await db
    .select({ isProtected: fieldProtectionMetadata.isProtected })
    .from(fieldProtectionMetadata)
    .where(
      and(
        eq(fieldProtectionMetadata.ipoId, ipoId),
        eq(fieldProtectionMetadata.tableName, tableName),
        eq(fieldProtectionMetadata.fieldName, fieldName)
      )
    )
    .limit(1);

  const protected_ = protection?.isProtected ?? false;

  // Cache for 1 hour
  await redis.setex(cacheKey, 3600, protected_ ? 'true' : 'false');

  return protected_;
}

/**
 * Get all protected fields for an IPO in a specific table
 */
export async function getProtectedFields(
  ipoId: string,
  tableName: string
): Promise<Set<string>> {
  const redis = getRedisClient();
  const cacheKey = `protection:fields:${ipoId}:${tableName}`;

  // Try cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    return new Set(JSON.parse(cached));
  }

  // Query database
  const protections = await db
    .select({ fieldName: fieldProtectionMetadata.fieldName })
    .from(fieldProtectionMetadata)
    .where(
      and(
        eq(fieldProtectionMetadata.ipoId, ipoId),
        eq(fieldProtectionMetadata.tableName, tableName),
        eq(fieldProtectionMetadata.isProtected, true)
      )
    );

  const protectedFields = new Set(protections.map(p => p.fieldName));

  // Cache for 1 hour
  await redis.setex(cacheKey, 3600, JSON.stringify([...protectedFields]));

  return protectedFields;
}

/**
 * Filter scraped data to remove protected fields
 * Returns filtered data + list of skipped fields
 */
export async function filterProtectedFields<T extends Record<string, any>>(
  ipoId: string,
  tableName: string,
  data: T,
  scraper: string
): Promise<{ filtered: Partial<T>; skipped: Array<{ field: string; value: any }> }> {
  // Check IPO-level lock first
  const ipoLocked = await isIPOLocked(ipoId);
  if (ipoLocked) {
    logger.info({ ipoId, tableName, scraper }, 'IPO is locked, skipping all fields');

    // Log this blocked attempt
    await logBlockedUpdate(ipoId, tableName, null, null, scraper, 'IPO_LOCKED');

    return {
      filtered: {},
      skipped: Object.keys(data).map(field => ({ field, value: data[field] }))
    };
  }

  // Get all protected fields for this table
  const protectedFields = await getProtectedFields(ipoId, tableName);

  if (protectedFields.size === 0) {
    // No protected fields, return all data
    return { filtered: data, skipped: [] };
  }

  // Filter out protected fields
  const filtered: Partial<T> = {};
  const skipped: Array<{ field: string; value: any }> = [];

  for (const [field, value] of Object.entries(data)) {
    if (protectedFields.has(field)) {
      skipped.push({ field, value });
      logger.debug({ ipoId, tableName, field, scraper }, 'Field is protected, skipping');
    } else {
      filtered[field as keyof T] = value;
    }
  }

  // Log all skipped fields
  if (skipped.length > 0) {
    for (const { field, value } of skipped) {
      await logBlockedUpdate(ipoId, tableName, field, value, scraper, 'FIELD_PROTECTED');
    }
  }

  return { filtered, skipped };
}

/**
 * Log blocked update attempt for admin notification
 */
async function logBlockedUpdate(
  ipoId: string,
  tableName: string,
  fieldName: string | null,
  attemptedValue: any,
  scraper: string,
  reason: 'IPO_LOCKED' | 'FIELD_PROTECTED'
): Promise<void> {
  const redis = getRedisClient();
  const key = `scraper:blocked:${ipoId}`;
  const timestamp = Date.now();

  const payload = JSON.stringify({
    ipoId,
    tableName,
    fieldName,
    attemptedValue,
    scraper,
    reason,
    timestamp
  });

  // Store in Redis sorted set (score = timestamp)
  await redis.zadd(key, timestamp, payload);

  // Set expiration (7 days)
  await redis.expire(key, 86400 * 7);

  logger.info(
    { ipoId, tableName, fieldName, scraper, reason },
    'Logged blocked update attempt'
  );
}

/**
 * Invalidate protection cache for an IPO
 * Call this after admin changes protection flags
 */
export async function invalidateProtectionCache(ipoId: string): Promise<void> {
  const redis = getRedisClient();

  // Pattern: protection:*:ipoId:*
  const pattern = `protection:*:${ipoId}*`;

  // Delete all matching keys
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
    logger.info({ ipoId, keysDeleted: keys.length }, 'Invalidated protection cache');
  }
}
```

#### Integration Pattern for Scrapers

**Example 1: NSE Scraper Orchestrator**

Modify `scraper/src/scrapers/nse-scraper-orchestrator.ts`:

```typescript
// After line 82 (after validation, before upsert)

const validatedIPO = validation.data!;

// Generate slug and get existing IPO
const slug = generateSlug(validatedIPO.companyName);
const existingIPO = await ipoRepository.findBySlug(slug);

// ✅ NEW: Check protection and filter fields
const ipoId = existingIPO?.id || generateUUID(); // Use existing ID or create new one
const { filtered, skipped } = await filterProtectedFields(
  ipoId,
  'ipos',
  validatedIPO,
  'NSE'
);

// Skip if all fields protected
if (Object.keys(filtered).length === 0) {
  logger.warn(
    { companyName: validatedIPO.companyName, skippedFields: skipped.length },
    'IPO is fully protected, skipping update'
  );
  result.iposFailed++;
  result.errors.push(`${validatedIPO.companyName} is fully protected`);
  continue;
}

// Log if some fields were skipped
if (skipped.length > 0) {
  logger.info(
    { companyName: validatedIPO.companyName, skippedFields: skipped.map(s => s.field) },
    'Some fields protected, updating remaining fields'
  );
}

// Upsert IPO with filtered data
const upsertedId = await upsertIPO(ipoRepository, filtered, 'NSE');
```

**Example 2: Financial Data Updates**

Similar pattern for financial data scrapers:

```typescript
// In financial data processor
const { filtered, skipped } = await filterProtectedFields(
  ipoId,
  'financial_data',
  financialData,
  'MONEYCONTROL'
);

if (Object.keys(filtered).length > 0) {
  await financialDataRepository.upsert(ipoId, filtered);
}
```

#### All Scrapers to Modify

1. **NSE Scraper** (`nse-scraper-orchestrator.ts`) - Primary IPO data
2. **BSE Scraper** (`bse-scraper-orchestrator.ts`) - BSE/SME IPO data
3. **Moneycontrol Scraper** (`moneycontrol-orchestrator.ts`) - Financial aggregation
4. **Chittorgarh Scraper** (`chittorgarh-orchestrator.ts`) - Historical performance
5. **InvestorGain GMP** (`investorgain-gmp-orchestrator.ts`) - GMP updates
6. **Listing Performance** (`listing-performance-updater.ts`) - Current price updates
7. **BSE Detail** (`bse-detail-scraper.ts`) - Detailed BSE info
8. **IPO Alerts Fallback** (`ipo-alerts-fallback-orchestrator.ts`) - Fallback scraper

**Pattern for time-series tables (subscriptions, gmpRecords)**:
- Don't filter individual records (each is a point-in-time snapshot)
- Check IPO-level lock only
- If locked, skip creating new snapshot entirely

---

### 4. Notification System

#### Protection Notification Service

**Location**: `scraper/src/services/protection-notification-service.ts`

```typescript
import { getRedisClient } from '@ipodhan/shared';
import logger from '../utils/logger.js';

export interface BlockedUpdate {
  ipoId: string;
  companyName: string;
  tableName: string;
  fieldName: string | null;
  currentValue: any;
  attemptedValue: any;
  scraper: string;
  reason: 'IPO_LOCKED' | 'FIELD_PROTECTED';
  timestamp: number;
}

export class ProtectionNotificationService {
  private redis = getRedisClient();

  /**
   * Get all pending blocked updates for admin review
   */
  async getPendingNotifications(limit = 50): Promise<BlockedUpdate[]> {
    const allNotifications: BlockedUpdate[] = [];

    // Get all keys matching pattern: scraper:blocked:*
    const keys = await this.redis.keys('scraper:blocked:*');

    for (const key of keys) {
      // Get last N items from sorted set
      const items = await this.redis.zrevrange(key, 0, limit - 1);

      for (const item of items) {
        const parsed = JSON.parse(item);

        // Enrich with company name
        // TODO: Add company name query
        allNotifications.push({
          ...parsed,
          companyName: 'TODO: Query from DB'
        });
      }
    }

    // Sort by timestamp (most recent first)
    allNotifications.sort((a, b) => b.timestamp - a.timestamp);

    return allNotifications.slice(0, limit);
  }

  /**
   * Get blocked updates for specific IPO
   */
  async getIPONotifications(ipoId: string): Promise<BlockedUpdate[]> {
    const key = `scraper:blocked:${ipoId}`;
    const items = await this.redis.zrevrange(key, 0, -1); // Get all

    return items.map(item => {
      const parsed = JSON.parse(item);
      return {
        ...parsed,
        companyName: '' // Will be populated by caller
      };
    });
  }

  /**
   * Clear notifications for an IPO (after admin review)
   */
  async clearIPONotifications(ipoId: string): Promise<void> {
    const key = `scraper:blocked:${ipoId}`;
    await this.redis.del(key);
    logger.info({ ipoId }, 'Cleared blocked update notifications');
  }

  /**
   * Clear specific notification
   */
  async clearNotification(ipoId: string, timestamp: number): Promise<void> {
    const key = `scraper:blocked:${ipoId}`;

    // Remove item with this timestamp
    const items = await this.redis.zrangebyscore(key, timestamp, timestamp);
    if (items.length > 0) {
      await this.redis.zrem(key, items[0]);
      logger.info({ ipoId, timestamp }, 'Cleared specific notification');
    }
  }

  /**
   * Send notification to admin (Telegram bot - future)
   */
  async notifyAdmin(notifications: BlockedUpdate[]): Promise<void> {
    if (notifications.length === 0) return;

    // Phase 1: Log only
    logger.info(
      { count: notifications.length },
      'Blocked updates ready for admin notification'
    );

    // Phase 2: Telegram integration
    // const telegramWebhook = process.env.TELEGRAM_WEBHOOK_URL;
    // if (telegramWebhook) {
    //   await sendTelegramMessage(telegramWebhook, formatNotifications(notifications));
    // }
  }

  /**
   * Get notification count by IPO
   */
  async getNotificationCounts(): Promise<Map<string, number>> {
    const keys = await this.redis.keys('scraper:blocked:*');
    const counts = new Map<string, number>();

    for (const key of keys) {
      const ipoId = key.split(':')[2]; // Extract IPO ID from key
      const count = await this.redis.zcard(key);
      counts.set(ipoId, count);
    }

    return counts;
  }
}
```

#### Admin Notification Dashboard

**Route**: `web/app/admin/notifications/page.tsx`

```typescript
import { ProtectionNotificationService } from '@/lib/services/protection-notification-service';
import { BlockedUpdatesList } from './components/BlockedUpdatesList';
import { ConflictResolveModal } from './components/ConflictResolveModal';

export default async function NotificationsPage() {
  const service = new ProtectionNotificationService();
  const notifications = await service.getPendingNotifications(100);

  // Group by IPO
  const groupedByIPO = notifications.reduce((acc, notif) => {
    if (!acc[notif.ipoId]) {
      acc[notif.ipoId] = [];
    }
    acc[notif.ipoId].push(notif);
    return acc;
  }, {} as Record<string, BlockedUpdate[]>);

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Scraper Conflicts</h1>

      <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-6">
        <p className="text-sm text-blue-800">
          {notifications.length} updates were blocked by protection flags.
          Review these changes and decide whether to accept or dismiss.
        </p>
      </div>

      <BlockedUpdatesList
        groupedNotifications={groupedByIPO}
        onResolve={(ipoId, notif) => handleResolve(ipoId, notif)}
        onDismiss={(ipoId) => handleDismiss(ipoId)}
      />
    </div>
  );
}

async function handleResolve(ipoId: string, notif: BlockedUpdate) {
  // Open modal to compare current vs attempted value
  // Allow admin to accept update (unprotect field + re-run scraper)
}

async function handleDismiss(ipoId: string) {
  // Clear notifications for this IPO
  const service = new ProtectionNotificationService();
  await service.clearIPONotifications(ipoId);
}
```

**Notification List Component**:

```tsx
// web/app/admin/notifications/components/BlockedUpdatesList.tsx
interface Props {
  groupedNotifications: Record<string, BlockedUpdate[]>;
  onResolve: (ipoId: string, notif: BlockedUpdate) => void;
  onDismiss: (ipoId: string) => void;
}

export function BlockedUpdatesList({ groupedNotifications, onResolve, onDismiss }: Props) {
  return (
    <div className="space-y-4">
      {Object.entries(groupedNotifications).map(([ipoId, notifications]) => (
        <div key={ipoId} className="border rounded-lg p-4 bg-white">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="font-semibold text-lg">{notifications[0].companyName}</h3>
              <p className="text-sm text-gray-500">
                {notifications.length} blocked updates
              </p>
            </div>
            <div className="space-x-2">
              <Button variant="outline" onClick={() => onDismiss(ipoId)}>
                Dismiss All
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Attempted Value</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notifications.map((notif, idx) => (
                <TableRow key={idx}>
                  <TableCell>{notif.fieldName || 'All fields'}</TableCell>
                  <TableCell>{notif.tableName}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {JSON.stringify(notif.attemptedValue)}
                  </TableCell>
                  <TableCell>{notif.scraper}</TableCell>
                  <TableCell>{formatTimestamp(notif.timestamp)}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      onClick={() => onResolve(ipoId, notif)}
                    >
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
}
```

---

### 5. API Endpoints

#### 1. PATCH `/admin/api/update-field`

**Purpose**: Update a single field value and optionally set protection flag.

```typescript
// web/app/admin/api/update-field/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db, getRedisClient } from '@ipodhan/shared';
import { verifyAdminSession } from '@/lib/auth/admin-auth';
import { invalidateProtectionCache } from '@/lib/services/field-protection';

interface UpdateFieldRequest {
  ipoId: string;
  tableName: string;
  fieldName: string;
  value: any;
  setProtection?: boolean; // Auto-protect after manual edit
}

export async function PATCH(request: NextRequest) {
  // Verify admin session
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body: UpdateFieldRequest = await request.json();
    const { ipoId, tableName, fieldName, value, setProtection = true } = body;

    // Validate inputs
    if (!ipoId || !tableName || !fieldName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Update field value in database
    await db.update(tableName)
      .set({ [fieldName]: value })
      .where(eq(tableName.ipoId, ipoId));

    // Set protection flag if requested
    let fieldProtected = false;
    if (setProtection) {
      await db.insert(fieldProtectionMetadata)
        .values({
          ipoId,
          tableName,
          fieldName,
          isProtected: true,
          manuallyEditedAt: new Date(),
          manuallyEditedBy: 'admin' // TODO: Get from session
        })
        .onConflictDoUpdate({
          target: [fieldProtectionMetadata.ipoId, fieldProtectionMetadata.tableName, fieldProtectionMetadata.fieldName],
          set: {
            isProtected: true,
            manuallyEditedAt: new Date()
          }
        });

      fieldProtected = true;
    }

    // Update last_manual_edit_at in ipos table
    await db.update(ipos)
      .set({ lastManualEditAt: new Date() })
      .where(eq(ipos.id, ipoId));

    // Invalidate caches
    await invalidateProtectionCache(ipoId);
    await invalidateIPOCaches(ipoId); // Invalidate IPO data cache

    return NextResponse.json({
      success: true,
      fieldProtected
    });

  } catch (error) {
    console.error('Update field error:', error);
    return NextResponse.json(
      { error: 'Failed to update field' },
      { status: 500 }
    );
  }
}
```

#### 2. POST `/admin/api/toggle-lock`

**Purpose**: Toggle IPO-level or field-level protection locks.

```typescript
// web/app/admin/api/toggle-lock/route.ts
interface ToggleLockRequest {
  ipoId: string;
  lockType: 'ipo' | 'field';
  locked: boolean;
  tableName?: string;
  fieldName?: string;
  note?: string;
}

export async function POST(request: NextRequest) {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body: ToggleLockRequest = await request.json();
    const { ipoId, lockType, locked, tableName, fieldName, note } = body;

    if (lockType === 'ipo') {
      // Toggle IPO-level lock
      await db.update(ipos)
        .set({
          scraperLocked: locked,
          scraperLockNote: note || null,
          lastManualEditAt: new Date()
        })
        .where(eq(ipos.id, ipoId));

    } else if (lockType === 'field') {
      // Toggle field-level lock
      if (!tableName || !fieldName) {
        return NextResponse.json(
          { error: 'tableName and fieldName required for field lock' },
          { status: 400 }
        );
      }

      await db.insert(fieldProtectionMetadata)
        .values({
          ipoId,
          tableName,
          fieldName,
          isProtected: locked,
          manuallyEditedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [fieldProtectionMetadata.ipoId, fieldProtectionMetadata.tableName, fieldProtectionMetadata.fieldName],
          set: { isProtected: locked, updatedAt: new Date() }
        });
    }

    // Invalidate caches
    await invalidateProtectionCache(ipoId);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Toggle lock error:', error);
    return NextResponse.json(
      { error: 'Failed to toggle lock' },
      { status: 500 }
    );
  }
}
```

#### 3. GET `/admin/api/notifications`

**Purpose**: Retrieve blocked update notifications.

```typescript
// web/app/admin/api/notifications/route.ts
export async function GET(request: NextRequest) {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const ipoId = searchParams.get('ipoId');

    const service = new ProtectionNotificationService();

    let notifications: BlockedUpdate[];
    if (ipoId) {
      notifications = await service.getIPONotifications(ipoId);
    } else {
      notifications = await service.getPendingNotifications(limit);
    }

    return NextResponse.json({
      success: true,
      data: notifications,
      count: notifications.length
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}
```

#### 4. GET `/admin/api/field-protection/:ipoId`

**Purpose**: Get all protection flags for an IPO.

```typescript
// web/app/admin/api/field-protection/[ipoId]/route.ts
export async function GET(
  request: NextRequest,
  { params }: { params: { ipoId: string } }
) {
  const isAdmin = await verifyAdminSession();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { ipoId } = params;

    // Get IPO-level lock
    const [ipo] = await db
      .select({
        scraperLocked: ipos.scraperLocked,
        scraperLockNote: ipos.scraperLockNote,
        lastManualEditAt: ipos.lastManualEditAt
      })
      .from(ipos)
      .where(eq(ipos.id, ipoId))
      .limit(1);

    // Get all field-level protections
    const fieldProtections = await db
      .select()
      .from(fieldProtectionMetadata)
      .where(eq(fieldProtectionMetadata.ipoId, ipoId));

    // Group by table
    const grouped = fieldProtections.reduce((acc, p) => {
      if (!acc[p.tableName]) {
        acc[p.tableName] = {};
      }
      acc[p.tableName][p.fieldName] = {
        protected: p.isProtected,
        editedAt: p.manuallyEditedAt,
        editedBy: p.manuallyEditedBy
      };
      return acc;
    }, {} as Record<string, Record<string, any>>);

    return NextResponse.json({
      success: true,
      data: {
        ipoLocked: ipo?.scraperLocked ?? false,
        lockNote: ipo?.scraperLockNote,
        lastManualEdit: ipo?.lastManualEditAt,
        fields: grouped
      }
    });

  } catch (error) {
    console.error('Get field protection error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch field protection' },
      { status: 500 }
    );
  }
}
```

---

## 🤖 Architectural Enforcement & Auto-Generation System

**CRITICAL**: This section describes how the manual data management system **automatically extends** to any new database field, table, or scraper **without requiring manual code**. This is the "magic" that makes the system future-proof.

### Design Philosophy

When a developer adds:
- **New field** → Admin UI + protection + auto-lock automatically available
- **New table** → Full CRUD admin page automatically generated
- **New scraper** → Protection checks automatically enforced (cannot bypass)

**Zero manual code. The system introspects the schema and generates everything.**

---

### Architecture: Hybrid Build-Time + Runtime

#### Build-Time Generation (Code Generation)
- Schema introspection at build time
- Generate TypeScript code for forms, tables, validation
- Pre-compile protection checks into scraper base class
- Generate API endpoints for new tables

#### Runtime Reflection (Dynamic UI)
- Introspect schema at runtime for field metadata
- Dynamically render form fields based on data types
- Apply smart defaults (exclude IDs, timestamps, etc.)
- Hot-reload admin UI when schema changes (dev mode)

---

### Component 1: Schema Introspection System

**Purpose**: Read Drizzle schema and extract metadata about all tables/fields.

#### Implementation: Schema Parser

**Location**: `packages/shared/src/admin/schema-parser.ts`

```typescript
import * as schema from '../db/schema';
import { pgTable, PgColumn } from 'drizzle-orm/pg-core';

export interface TableMetadata {
  name: string;
  schema: any;
  columns: ColumnMetadata[];
  relations: RelationMetadata[];
  hasIPOReference: boolean; // Has ipoId foreign key?
}

export interface ColumnMetadata {
  name: string;
  type: string; // 'uuid' | 'varchar' | 'integer' | 'numeric' | 'date' | 'timestamp' | etc.
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isGenerated: boolean; // Auto-generated (id, timestamps)
  isEditable: boolean; // Can be edited in admin UI
  uiComponent: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'checkbox';
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface RelationMetadata {
  name: string;
  type: 'one' | 'many';
  targetTable: string;
  foreignKey: string;
}

/**
 * Parse Drizzle schema and extract table metadata
 */
export function parseSchema(): Map<string, TableMetadata> {
  const tables = new Map<string, TableMetadata>();

  // Iterate through all exported tables in schema
  for (const [exportName, exportValue] of Object.entries(schema)) {
    // Check if it's a Drizzle table
    if (isPgTable(exportValue)) {
      const tableName = (exportValue as any)._.name;

      tables.set(tableName, {
        name: tableName,
        schema: exportValue,
        columns: parseColumns(exportValue),
        relations: parseRelations(exportName),
        hasIPOReference: hasIPOForeignKey(exportValue)
      });
    }
  }

  return tables;
}

/**
 * Parse columns from table schema
 */
function parseColumns(table: any): ColumnMetadata[] {
  const columns: ColumnMetadata[] = [];
  const tableColumns = table._.columns;

  for (const [colName, colDef] of Object.entries(tableColumns)) {
    const col = colDef as any;

    columns.push({
      name: colName,
      type: col.columnType,
      nullable: col.notNull === false,
      isPrimaryKey: col.primary === true,
      isForeignKey: !!col.references,
      isGenerated: isGeneratedField(colName, col),
      isEditable: isEditableField(colName, col),
      uiComponent: inferUIComponent(col),
      validation: inferValidation(col)
    });
  }

  return columns;
}

/**
 * Smart defaults: Auto-detect non-editable fields
 */
function isEditableField(colName: string, col: any): boolean {
  // Skip auto-generated fields
  if (isGeneratedField(colName, col)) return false;

  // Skip foreign keys (edited via relations)
  if (col.references) return false;

  // Skip read-only fields (convention-based)
  if (colName.startsWith('last_') && colName.endsWith('_at')) return false;
  if (colName.startsWith('calculated_')) return false;

  return true;
}

/**
 * Detect auto-generated fields
 */
function isGeneratedField(colName: string, col: any): boolean {
  // Primary key with default random UUID
  if (col.primary && col.default?.toString().includes('random')) return true;

  // Timestamp fields with defaultNow()
  if (colName.endsWith('_at') && col.default?.toString().includes('now')) return true;

  // Specific field names
  const generatedFields = ['id', 'created_at', 'updated_at', 'last_scraped_at'];
  if (generatedFields.includes(colName)) return true;

  return false;
}

/**
 * Infer UI component type from column definition
 */
function inferUIComponent(col: any): ColumnMetadata['uiComponent'] {
  const type = col.columnType;

  if (type === 'varchar' || type === 'text') {
    return col.length && col.length > 255 ? 'textarea' : 'text';
  }
  if (type === 'integer' || type === 'numeric') return 'number';
  if (type === 'date') return 'date';
  if (type === 'timestamp') return 'date'; // datetime-local
  if (type === 'boolean') return 'checkbox';
  if (type.startsWith('enum_')) return 'select';

  return 'text'; // Default fallback
}

/**
 * Check if table has ipoId foreign key
 */
function hasIPOForeignKey(table: any): boolean {
  const columns = table._.columns;
  return 'ipoId' in columns || 'ipo_id' in columns;
}
```

---

### Component 2: Admin UI Code Generator

**Purpose**: Generate React components for admin CRUD pages at build time.

#### Implementation: CLI Code Generator

**Location**: `web/lib/admin/generators/admin-page-generator.ts`

```typescript
import { parseSchema, TableMetadata } from '@ipodhan/shared/admin/schema-parser';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Generate admin page for a table
 * Called by: npm run generate-admin
 */
export async function generateAdminPages() {
  const tables = parseSchema();

  for (const [tableName, metadata] of tables) {
    // Skip internal tables
    if (tableName === 'field_protection_metadata') continue;
    if (tableName === 'scraper_logs') continue;

    if (metadata.hasIPOReference) {
      // Generate tab component for IPO edit modal
      await generateIPOEditTab(tableName, metadata);
    } else {
      // Generate standalone admin page
      await generateStandaloneAdminPage(tableName, metadata);
    }
  }

  console.log(`✅ Generated admin UI for ${tables.size} tables`);
}

/**
 * Generate standalone CRUD admin page
 */
async function generateStandaloneAdminPage(tableName: string, metadata: TableMetadata) {
  const componentName = toPascalCase(tableName);
  const routePath = toKebabCase(tableName);

  // Generate list page
  const listPage = `
// AUTO-GENERATED by admin-page-generator.ts
// DO NOT EDIT MANUALLY - Changes will be overwritten
// To customize: Create ${routePath}/page.custom.tsx and it will be used instead

import { ${componentName}List } from './components/${componentName}List';
import { ${componentName}Form } from './components/${componentName}Form';

export default async function ${componentName}AdminPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">${metadata.name} Management</h1>

      <${componentName}List />
    </div>
  );
}
`;

  // Generate form component
  const formComponent = generateFormComponent(tableName, metadata);

  // Generate list component
  const listComponent = generateListComponent(tableName, metadata);

  // Write files
  const adminDir = path.join(process.cwd(), 'app', 'admin', routePath);
  await fs.promises.mkdir(adminDir, { recursive: true });
  await fs.promises.mkdir(path.join(adminDir, 'components'), { recursive: true });

  await fs.promises.writeFile(path.join(adminDir, 'page.tsx'), listPage);
  await fs.promises.writeFile(
    path.join(adminDir, 'components', `${componentName}Form.tsx`),
    formComponent
  );
  await fs.promises.writeFile(
    path.join(adminDir, 'components', `${componentName}List.tsx`),
    listComponent
  );

  console.log(`  ✅ Generated /admin/${routePath}`);
}

/**
 * Generate form component with all editable fields
 */
function generateFormComponent(tableName: string, metadata: TableMetadata): string {
  const componentName = toPascalCase(tableName);
  const editableFields = metadata.columns.filter(c => c.isEditable);

  const fieldComponents = editableFields.map(field => {
    switch (field.uiComponent) {
      case 'text':
        return `
        <FieldGroup>
          <Label htmlFor="${field.name}">${toTitleCase(field.name)}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="${field.name}"
              name="${field.name}"
              value={formData.${field.name} || ''}
              onChange={(e) => handleFieldChange('${field.name}', e.target.value)}
            />
            <FieldLockToggle
              field="${field.name}"
              locked={protection.${field.name}}
              autoProtected={autoProtected.${field.name}}
              onToggle={() => toggleProtection('${field.name}')}
            />
          </div>
        </FieldGroup>`;

      case 'number':
        return `
        <FieldGroup>
          <Label htmlFor="${field.name}">${toTitleCase(field.name)}</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              id="${field.name}"
              name="${field.name}"
              value={formData.${field.name} || ''}
              onChange={(e) => handleFieldChange('${field.name}', Number(e.target.value))}
            />
            <FieldLockToggle
              field="${field.name}"
              locked={protection.${field.name}}
              autoProtected={autoProtected.${field.name}}
              onToggle={() => toggleProtection('${field.name}')}
            />
          </div>
        </FieldGroup>`;

      case 'date':
        return `
        <FieldGroup>
          <Label htmlFor="${field.name}">${toTitleCase(field.name)}</Label>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              id="${field.name}"
              name="${field.name}"
              value={formData.${field.name} || ''}
              onChange={(e) => handleFieldChange('${field.name}', e.target.value)}
            />
            <FieldLockToggle
              field="${field.name}"
              locked={protection.${field.name}}
              autoProtected={autoProtected.${field.name}}
              onToggle={() => toggleProtection('${field.name}')}
            />
          </div>
        </FieldGroup>`;

      case 'checkbox':
        return `
        <FieldGroup>
          <div className="flex items-center gap-2">
            <Checkbox
              id="${field.name}"
              name="${field.name}"
              checked={formData.${field.name} || false}
              onCheckedChange={(checked) => handleFieldChange('${field.name}', checked)}
            />
            <Label htmlFor="${field.name}">${toTitleCase(field.name)}</Label>
            <FieldLockToggle
              field="${field.name}"
              locked={protection.${field.name}}
              autoProtected={autoProtected.${field.name}}
              onToggle={() => toggleProtection('${field.name}')}
            />
          </div>
        </FieldGroup>`;

      default:
        return `<!-- Unsupported field type: ${field.uiComponent} -->`;
    }
  }).join('\n');

  return `
// AUTO-GENERATED by admin-page-generator.ts
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldLockToggle } from '@/app/admin/components/FieldLockToggle';
import { useAdminForm } from '@/app/admin/hooks/useAdminForm';

export function ${componentName}Form({ data, onSave }: { data?: any; onSave: () => void }) {
  const {
    formData,
    protection,
    autoProtected,
    handleFieldChange,
    toggleProtection,
    handleSave
  } = useAdminForm({
    tableName: '${tableName}',
    initialData: data
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); handleSave(); onSave(); }}>
      ${fieldComponents}

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onSave}>
          Cancel
        </Button>
        <Button type="submit">
          Save Changes
        </Button>
      </div>
    </form>
  );
}
`;
}

function generateListComponent(tableName: string, metadata: TableMetadata): string {
  // Similar pattern - generates table with data
  // Implementation details omitted for brevity
  return `// List component for ${tableName}`;
}
```

**CLI Command**:
```json
// package.json
{
  "scripts": {
    "generate-admin": "tsx web/lib/admin/generators/run-generator.ts",
    "postinstall": "npm run generate-admin" // Auto-run after npm install
  }
}
```

---

### Component 3: Base Scraper Orchestrator (Protection Enforcement)

**Purpose**: **Force** all scrapers to respect protection flags. Developer cannot bypass.

#### Implementation: Abstract Base Class

**Location**: `scraper/src/base/BaseScraper Orchestrator.ts`

```typescript
import { db, getRedisClient } from '@ipodhan/shared';
import { filterProtectedFields } from '../utils/field-protection-checker';
import logger from '../utils/logger';

/**
 * ALL scrapers MUST extend this class
 * Enforces protection checks - cannot be bypassed
 */
export abstract class BaseScraperOrchestrator {
  protected abstract scraperName: string;

  /**
   * Main entry point - implements Template Method pattern
   */
  async run(): Promise<ScraperResult> {
    logger.info(`[${this.scraperName}] Starting scraper`);

    try {
      // Step 1: Scrape data (implemented by child class)
      const scrapedData = await this.scrapeData();

      // Step 2: Process each record with protection
      const results = await this.processWithProtection(scrapedData);

      return {
        success: true,
        processed: results.length,
        ...results
      };
    } catch (error) {
      logger.error(`[${this.scraperName}] Scraper failed`, error);
      return {
        success: false,
        processed: 0,
        error: error.message
      };
    }
  }

  /**
   * Child class implements: How to scrape data
   */
  protected abstract scrapeData(): Promise<Array<{
    table: string;
    data: any;
    ipoId?: string;
  }>>;

  /**
   * Protection enforcement - CANNOT be overridden by child class
   */
  private async processWithProtection(scrapedRecords: any[]): Promise<any[]> {
    const results = [];

    for (const record of scrapedRecords) {
      const { table, data, ipoId } = record;

      // ✅ AUTOMATIC PROTECTION CHECK
      const { filtered, skipped } = await filterProtectedFields(
        ipoId || data.id,
        table,
        data,
        this.scraperName
      );

      if (Object.keys(filtered).length === 0) {
        logger.warn(
          `[${this.scraperName}] Record fully protected, skipping`,
          { table, ipoId }
        );
        continue;
      }

      if (skipped.length > 0) {
        logger.info(
          `[${this.scraperName}] Some fields protected`,
          { table, skippedCount: skipped.length }
        );
      }

      // Persist filtered data
      const result = await this.persistData(table, filtered);
      results.push(result);
    }

    return results;
  }

  /**
   * Child class implements: How to persist data
   */
  protected abstract persistData(table: string, data: any): Promise<any>;
}
```

**Usage Example**:

```typescript
// scraper/src/scrapers/nse-scraper-orchestrator.ts
import { BaseScraperOrchestrator } from '../base/BaseScraperOrchestrator';

export class NSEScraperOrchestrator extends BaseScraperOrchestrator {
  protected scraperName = 'NSE';

  // Only implement scraping logic - protection is automatic
  protected async scrapeData() {
    const ipos = await fetchNSEIPOs();

    return ipos.map(ipo => ({
      table: 'ipos',
      data: {
        companyName: ipo.name,
        openDate: ipo.openDate,
        closeDate: ipo.closeDate,
        // ... other fields
      },
      ipoId: ipo.id
    }));
  }

  protected async persistData(table: string, data: any) {
    // Repository upsert logic
    return await ipoRepository.upsert(data);
  }
}

// Run scraper
const scraper = new NSEScraperOrchestrator();
await scraper.run(); // Protection automatically enforced
```

**Enforcement via ESLint**:

```javascript
// .eslintrc.js
module.exports = {
  rules: {
    // Custom rule: All scraper orchestrators must extend BaseScraperOrchestrator
    'scrapers/must-extend-base': 'error'
  }
};
```

---

### Component 4: Runtime Admin UI Generator

**Purpose**: Dynamically render forms based on schema (fallback if build-time generation skipped).

#### Implementation: Dynamic Form Renderer

**Location**: `web/app/admin/components/DynamicFormRenderer.tsx`

```typescript
'use client';

import { useSchemaMetadata } from '../hooks/useSchemaMetadata';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { FieldLockToggle } from './FieldLockToggle';

interface Props {
  tableName: string;
  data: any;
  onFieldChange: (field: string, value: any) => void;
  protection: Record<string, boolean>;
  autoProtected: Record<string, boolean>;
  onToggleProtection: (field: string) => void;
}

export function DynamicFormRenderer({
  tableName,
  data,
  onFieldChange,
  protection,
  autoProtected,
  onToggleProtection
}: Props) {
  // Fetch schema metadata at runtime
  const { columns, loading, error } = useSchemaMetadata(tableName);

  if (loading) return <div>Loading form...</div>;
  if (error) return <div>Error loading schema: {error.message}</div>;

  // Filter to editable fields only
  const editableFields = columns.filter(c => c.isEditable);

  return (
    <div className="space-y-4">
      {editableFields.map(field => (
        <div key={field.name} className="space-y-2">
          <Label htmlFor={field.name}>{toTitleCase(field.name)}</Label>

          <div className="flex items-center gap-2">
            {/* Dynamically render input based on field type */}
            {field.uiComponent === 'text' && (
              <Input
                id={field.name}
                value={data[field.name] || ''}
                onChange={(e) => onFieldChange(field.name, e.target.value)}
              />
            )}

            {field.uiComponent === 'number' && (
              <Input
                type="number"
                id={field.name}
                value={data[field.name] || ''}
                onChange={(e) => onFieldChange(field.name, Number(e.target.value))}
              />
            )}

            {field.uiComponent === 'date' && (
              <Input
                type="date"
                id={field.name}
                value={data[field.name] || ''}
                onChange={(e) => onFieldChange(field.name, e.target.value)}
              />
            )}

            {field.uiComponent === 'checkbox' && (
              <Checkbox
                id={field.name}
                checked={data[field.name] || false}
                onCheckedChange={(checked) => onFieldChange(field.name, checked)}
              />
            )}

            {/* Protection toggle */}
            <FieldLockToggle
              field={field.name}
              locked={protection[field.name]}
              autoProtected={autoProtected[field.name]}
              onToggle={() => onToggleProtection(field.name)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Schema Metadata API**:

```typescript
// web/app/api/admin/schema/[tableName]/route.ts
import { parseSchema } from '@ipodhan/shared/admin/schema-parser';
import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: { tableName: string } }
) {
  const tables = parseSchema();
  const metadata = tables.get(params.tableName);

  if (!metadata) {
    return NextResponse.json({ error: 'Table not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    data: {
      columns: metadata.columns,
      relations: metadata.relations
    }
  });
}
```

---

### Component 5: Enforcement via Linting & Type Checking

**Purpose**: Prevent developers from bypassing the system.

#### ESLint Rules

**Location**: `.eslintrc.js`

```javascript
module.exports = {
  rules: {
    // Enforce: All scrapers extend BaseScraperOrchestrator
    'custom/scrapers-must-extend-base': 'error',

    // Enforce: No direct db writes in scrapers (must use persistData)
    'custom/no-direct-db-writes-in-scrapers': 'error',

    // Enforce: Admin forms must include FieldLockToggle
    'custom/admin-forms-must-have-locks': 'warn',

    // Enforce: No hardcoded table/field names in admin code
    'custom/use-schema-metadata': 'error'
  }
};
```

#### TypeScript Compiler Plugin

**Location**: `tools/typescript-plugins/schema-validator.ts`

```typescript
// Validate at compile time that:
// 1. All table names reference real tables in schema
// 2. All field names reference real fields
// 3. No typos in protection metadata queries

// Example error:
// ❌ Error: Table 'ipo' not found in schema. Did you mean 'ipos'?
// ❌ Error: Field 'comapny_name' not found. Did you mean 'company_name'?
```

---

### How It All Works Together

#### Developer Adds New Field

```typescript
// 1. Developer modifies schema
// packages/shared/src/db/schema.ts

export const ipos = pgTable('ipos', {
  // ... existing fields

  // ✅ NEW FIELD ADDED
  marketCapitalization: numeric('market_capitalization', {
    precision: 15,
    scale: 2
  }),
});
```

```bash
# 2. Run migration
cd web
npm run db:generate
npm run db:migrate

# 3. Code generation runs automatically (via postinstall hook)
npm install
# Output:
#   ✅ Detected new field: market_capitalization in table ipos
#   ✅ Generated form component with protection toggle
#   ✅ Updated admin edit modal
#   ✅ Protection system ready
```

**Result**:
- ✅ Field appears in admin edit modal automatically
- ✅ Has lock toggle (🔒) automatically
- ✅ Auto-locks when edited (🔒 AUTO) automatically
- ✅ Scraper respects protection automatically
- ✅ Zero manual code written

#### Developer Adds New Table

```typescript
// 1. Developer adds new table
// packages/shared/src/db/schema.ts

export const ipoAnalytics = pgTable('ipo_analytics', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').notNull().references(() => ipos.id),
  viewCount: integer('view_count').default(0),
  favoriteCount: integer('favorite_count').default(0),
  shareCount: integer('share_count').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

```bash
# 2. Run migration + codegen
npm run db:migrate
npm install

# Output:
#   ✅ Detected new table: ipo_analytics
#   ✅ Table has ipoId FK → Adding as tab in IPO edit modal
#   ✅ Generated IPOAnalyticsForm component
#   ✅ Updated edit modal with new "Analytics" tab
#   ✅ Protection system configured
#   ✅ API endpoint created: /admin/api/ipo-analytics
```

**Result**:
- ✅ New "Analytics" tab in IPO edit modal
- ✅ All fields editable with protection toggles
- ✅ Auto-lock on edit
- ✅ Scraper protection (if analytics scraped)

#### Developer Creates New Scraper

```typescript
// 1. Developer creates new scraper
// scraper/src/scrapers/new-data-source-orchestrator.ts

import { BaseScraperOrchestrator } from '../base/BaseScraperOrchestrator';

// ✅ MUST extend base class (enforced by ESLint)
export class NewDataSourceOrchestrator extends BaseScraperOrchestrator {
  protected scraperName = 'NEW_DATA_SOURCE';

  protected async scrapeData() {
    // Scraping logic here
    return [
      {
        table: 'ipos',
        data: { /* scraped data */ },
        ipoId: 'uuid-123'
      }
    ];
  }

  protected async persistData(table: string, data: any) {
    // Persistence logic
    return await repository.upsert(data);
  }
}
```

**Result**:
- ✅ Protection checks automatically enforced (cannot bypass)
- ✅ Blocked updates automatically logged
- ✅ Admin notifications automatically created
- ✅ No manual `filterProtectedFields()` call needed

---

### Configuration & Customization

#### Override Smart Defaults

**Location**: `packages/shared/src/admin/schema-overrides.ts`

```typescript
export const SCHEMA_OVERRIDES = {
  // Force specific field to be editable (override smart default)
  'ipos.calculated_field': { isEditable: true },

  // Force specific field to NOT be editable
  'ipos.some_field': { isEditable: false },

  // Custom UI component
  'ipos.description': { uiComponent: 'rich-text-editor' },

  // Custom validation
  'ipos.email': {
    validation: {
      pattern: '^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$'
    }
  }
};
```

#### Disable Auto-Generation for Specific Tables

**Location**: `.adminconfig.json`

```json
{
  "codeGeneration": {
    "enabled": true,
    "excludeTables": [
      "scraper_logs",
      "field_protection_metadata",
      "affiliate_clicks"
    ]
  },
  "autoProtection": {
    "enforceBaseClass": true,
    "requireLintRules": true
  }
}
```

---

### Testing the Auto-Generation System

#### Unit Tests

```typescript
describe('Schema Parser', () => {
  test('correctly identifies editable fields')
  test('excludes auto-generated fields (id, timestamps)')
  test('excludes foreign keys')
  test('infers correct UI components')
  test('detects IPO-related tables')
});

describe('Code Generator', () => {
  test('generates valid React component code')
  test('includes all editable fields')
  test('includes protection toggles')
  test('generates correct API endpoints')
});

describe('Base Scraper Orchestrator', () => {
  test('enforces protection checks')
  test('cannot bypass protection')
  test('logs blocked updates')
});
```

#### Integration Tests

```typescript
describe('Auto-Generation E2E', () => {
  test('new field → admin UI → edit → protection works', async () => {
    // 1. Add field to schema (mock)
    // 2. Run code generator
    // 3. Verify form component includes field
    // 4. Edit field in admin UI
    // 5. Verify protection flag set
    // 6. Run scraper
    // 7. Verify field not overwritten
  });
});
```

---

### Performance Considerations

**Build-Time Generation**:
- ✅ Fast runtime (pre-compiled code)
- ✅ Type-safe (TypeScript validation)
- ❌ Requires rebuild on schema changes

**Runtime Reflection**:
- ✅ Instant updates (no rebuild needed)
- ✅ Hot-reload in dev mode
- ❌ Slightly slower (schema introspection overhead)

**Hybrid Approach (Recommended)**:
- Build-time: Generate static forms for existing tables
- Runtime: Dynamically render new fields added in dev mode
- Production: Always use build-time generated code

---

### Documentation for Developers

#### Developer Guide

**Location**: `docs/00-admin/DEVELOPER_GUIDE.md`

**Content**:
- How to add new database fields (automatic process)
- How to add new tables (automatic process)
- How to create new scrapers (extend BaseScraperOrchestrator)
- How to customize auto-generated UI (override patterns)
- How to test admin features
- Troubleshooting common issues

#### Checklist for New Features

```markdown
## Adding a New Database Field

- [ ] Add field to `packages/shared/src/db/schema.ts`
- [ ] Run `npm run db:generate` to create migration
- [ ] Run `npm run db:migrate` to apply migration
- [ ] Run `npm install` (triggers code generation)
- [ ] Verify field appears in admin UI
- [ ] Test protection toggle works
- [ ] Test scraper respects protection

**Expected time**: 5 minutes
**Manual code required**: 0 lines
```

---

### Future Enhancements

1. **AI-Powered Field Inference**
   - Use AI to suggest field types, validation rules
   - Auto-generate field descriptions for admin UI

2. **Visual Schema Editor**
   - Drag-and-drop schema builder
   - Real-time preview of admin UI

3. **Multi-Table Form Builder**
   - Automatically generate forms that span multiple related tables
   - Handle complex relations (one-to-many, many-to-many)

4. **Workflow Automation**
   - Auto-generate approval workflows for sensitive fields
   - Multi-step editing with validation gates

---

## 📋 Implementation Phases

### Phase 1: Database & Core Infrastructure (Week 1)

**Deliverables:**
1. ✅ Database migration files
   - `0XXX_add_field_protection_metadata.sql`
   - `0XXX_add_ipo_scraper_lock_columns.sql`
2. ✅ Field protection checker utility (`scraper/src/utils/field-protection-checker.ts`)
3. ✅ Protection notification service (`scraper/src/services/protection-notification-service.ts`)
4. ✅ Admin auth middleware (`web/lib/auth/admin-auth.ts`)
5. ✅ 4 API endpoints (update-field, toggle-lock, notifications, field-protection)
6. ✅ Unit tests for protection checker logic

**Tasks:**
- [ ] Write migration SQL for `field_protection_metadata` table
- [ ] Write migration SQL for `ipos` table columns
- [ ] Run migrations on development database
- [ ] Implement protection checker utility with Redis caching
- [ ] Implement notification service with Redis storage
- [ ] Implement simple password-based admin auth
- [ ] Build all 4 admin API endpoints
- [ ] Write unit tests (15 tests)

**Success Criteria:**
- Migrations run successfully without errors
- Protection checker returns correct results from cache and DB
- API endpoints return 401 without auth, 200 with auth
- Unit tests pass with 90%+ coverage

---

### Phase 2: Admin UI - Basic Editing (Week 2)

**Deliverables:**
1. ✅ Admin layout with authentication check
2. ✅ Admin login page
3. ✅ Admin dashboard (IPO list view)
4. ✅ Edit modal with first 3 tabs (Basic Info, Financials, Protection)
5. ✅ Field lock toggle component
6. ✅ IPO lock toggle component
7. ✅ Visual protection indicators (badges, icons)

**Tasks:**
- [ ] Build admin layout shell (`web/app/admin/layout.tsx`)
- [ ] Build login page with password form (`web/app/admin/login/page.tsx`)
- [ ] Build admin dashboard with IPO list table
- [ ] Build edit modal component with tab structure
- [ ] Build BasicInfoForm with 15+ fields
- [ ] Build FinancialForm with 10+ fields
- [ ] Build ProtectionPanel with lock toggles
- [ ] Add visual indicators (🔒 icons, badges)
- [ ] Integrate with API endpoints
- [ ] Add form validation with Zod
- [ ] Add loading states and error handling

**Success Criteria:**
- Admin can log in successfully
- IPO list loads and displays protection status
- Edit modal opens and displays IPO data
- Field values can be edited and saved
- Protection toggles work and update database
- Visual indicators display correctly

---

### Phase 3: Scraper Integration (Week 3)

**Deliverables:**
1. ✅ NSE orchestrator modified with protection checks
2. ✅ BSE orchestrator modified
3. ✅ Moneycontrol orchestrator modified
4. ✅ Chittorgarh orchestrator modified
5. ✅ InvestorGain GMP orchestrator modified
6. ✅ Listing performance updater modified
7. ✅ BSE detail scraper modified
8. ✅ IPO Alerts fallback modified
9. ✅ Scraper logs updated with blocked update tracking

**Tasks:**
- [ ] Modify NSE orchestrator (add filterProtectedFields before upsert)
- [ ] Modify BSE orchestrator
- [ ] Modify Moneycontrol orchestrator
- [ ] Modify Chittorgarh orchestrator
- [ ] Modify InvestorGain GMP orchestrator
- [ ] Modify listing performance updater
- [ ] Update scraper logs to track blocked updates
- [ ] Add integration tests (scraper + protection)
- [ ] Test with protected IPO (manual test)
- [ ] Verify notifications are created in Redis

**Success Criteria:**
- All scrapers respect IPO-level locks (skip entirely)
- All scrapers respect field-level locks (skip specific fields)
- Blocked updates are logged to Redis
- Scraper logs show protection status
- Integration tests pass (90%+ coverage)

---

### Phase 4: Extended Editing & Notifications (Week 4)

**Deliverables:**
1. ✅ Subscription editing tab (latest snapshot)
2. ✅ GMP editing tab (latest record)
3. ✅ Listing performance editing tab
4. ✅ Documents management tab (upload, delete)
5. ✅ Notification dashboard page
6. ✅ Blocked updates list component
7. ✅ Conflict resolve modal

**Tasks:**
- [ ] Build SubscriptionForm component
- [ ] Build GMPForm component
- [ ] Build ListingForm component
- [ ] Build DocumentsForm with file upload
- [ ] Build notifications page (`/admin/notifications`)
- [ ] Build BlockedUpdatesList component
- [ ] Build ConflictResolveModal (side-by-side comparison)
- [ ] Add dismiss/clear notification functionality
- [ ] Add Telegram webhook placeholder
- [ ] Test full admin workflow (edit → scraper → notification)

**Success Criteria:**
- All 8 tabs functional in edit modal
- Documents can be uploaded and deleted
- Notification dashboard displays blocked updates
- Notifications can be dismissed
- Conflict resolution UI shows current vs attempted values

---

### Phase 5: All Tables + Testing (Week 5)

**Deliverables:**
1. ✅ Peer companies editing support
2. ✅ IPO reviews editing support
3. ✅ Market holidays editing support
4. ✅ Registrars editing support
5. ✅ Bulk protection operations
6. ✅ Search & filter in admin dashboard
7. ✅ 30+ integration tests
8. ✅ 10+ E2E tests (Playwright)

**Tasks:**
- [ ] Build PeerCompaniesForm component
- [ ] Build ReviewsForm component
- [ ] Build MarketHolidaysForm (separate admin page)
- [ ] Build RegistrarsForm (separate admin page)
- [ ] Add bulk operations (protect/unprotect multiple fields)
- [ ] Add search & filter to admin dashboard
- [ ] Write integration tests for all tables
- [ ] Write E2E tests for admin workflows
- [ ] Performance testing (scraper overhead)
- [ ] Load testing (admin UI responsiveness)

**Success Criteria:**
- All 13 tables editable via admin UI
- Bulk operations work correctly
- Search/filter performs well (< 500ms)
- Integration tests pass (80%+ coverage)
- E2E tests pass on all browsers
- Scraper overhead < 10%

---

### Phase 6: Polish & Production Ready (Week 6)

**Deliverables:**
1. ✅ Audit logging system
2. ✅ Performance optimization (Redis caching tuned)
3. ✅ NextAuth.js integration (replace password auth)
4. ✅ Telegram notification implementation
5. ✅ Admin user documentation
6. ✅ Production deployment checklist
7. ✅ Monitoring & alerting setup

**Tasks:**
- [ ] Build audit log table and tracking
- [ ] Optimize Redis caching strategy
- [ ] Integrate NextAuth.js with admin role
- [ ] Implement Telegram bot webhook
- [ ] Write admin user documentation (30+ pages)
- [ ] Create production deployment guide
- [ ] Set up Sentry error tracking
- [ ] Configure monitoring dashboards
- [ ] Perform security audit
- [ ] Load test with 1000 concurrent users

**Success Criteria:**
- All admin actions logged to audit table
- Cache hit rate > 90% for protection checks
- Multiple admin users supported with roles
- Telegram notifications delivered < 5 minutes
- Documentation complete and reviewed
- Production ready (security + performance validated)

---

## 🧪 Testing Strategy

### Unit Tests (40 tests)

**Protection Checker Utilities** (15 tests):
```typescript
describe('Field Protection Checker', () => {
  test('isIPOLocked returns true for locked IPO')
  test('isIPOLocked returns false for unlocked IPO')
  test('isIPOLocked caches result in Redis')
  test('isFieldProtected returns true for protected field')
  test('isFieldProtected returns false for unprotected field')
  test('isFieldProtected caches result in Redis')
  test('getProtectedFields returns all protected fields')
  test('getProtectedFields returns empty set for unprotected IPO')
  test('filterProtectedFields removes protected fields')
  test('filterProtectedFields logs skipped fields')
  test('filterProtectedFields skips all fields for locked IPO')
  test('logBlockedUpdate stores notification in Redis')
  test('invalidateProtectionCache clears Redis keys')
  test('Protection cache has 1 hour TTL')
  test('Handles database errors gracefully')
});
```

**Admin API Endpoints** (10 tests):
```typescript
describe('Admin API', () => {
  test('PATCH /admin/api/update-field requires auth')
  test('PATCH /admin/api/update-field updates field')
  test('PATCH /admin/api/update-field sets protection flag')
  test('POST /admin/api/toggle-lock toggles IPO lock')
  test('POST /admin/api/toggle-lock toggles field lock')
  test('GET /admin/api/notifications returns blocked updates')
  test('GET /admin/api/field-protection returns all flags')
  test('API returns 400 for invalid input')
  test('API returns 500 for database errors')
  test('API invalidates cache after mutations')
});
```

**Notification Service** (10 tests):
```typescript
describe('Protection Notification Service', () => {
  test('getPendingNotifications returns sorted list')
  test('getIPONotifications returns IPO-specific list')
  test('clearIPONotifications deletes Redis keys')
  test('clearNotification removes specific item')
  test('getNotificationCounts returns counts by IPO')
  test('notifyAdmin logs notifications (Phase 1)')
  test('Notifications expire after 7 days')
  test('Handles empty notification list')
  test('Handles Redis connection errors')
  test('Pagination works correctly')
});
```

**Admin Auth** (5 tests):
```typescript
describe('Admin Authentication', () => {
  test('verifyAdminPassword accepts correct password')
  test('verifyAdminPassword rejects incorrect password')
  test('createAdminSession creates valid JWT')
  test('verifyAdminSession validates JWT')
  test('verifyAdminSession rejects expired JWT')
});
```

---

### Integration Tests (30 tests)

**Scraper Protection Integration** (15 tests):
```typescript
describe('Scraper Integration', () => {
  test('NSE scraper respects IPO-level lock')
  test('NSE scraper respects field-level lock')
  test('NSE scraper updates unprotected fields only')
  test('NSE scraper logs blocked updates')
  test('BSE scraper respects IPO-level lock')
  test('BSE scraper respects field-level lock')
  test('Moneycontrol scraper respects protection')
  test('Chittorgarh scraper respects protection')
  test('GMP scraper respects protection')
  test('Listing updater respects protection')
  test('Scraper skips fully protected IPO')
  test('Scraper processes partial protection')
  test('Scraper invalidates cache correctly')
  test('Protection check has <10% overhead')
  test('Multiple scrapers don't conflict')
});
```

**Admin Workflow Integration** (10 tests):
```typescript
describe('Admin Workflow', () => {
  test('Edit field → Save → Verify DB updated')
  test('Edit field → Toggle protection → Verify flag set')
  test('Toggle IPO lock → Run scraper → Verify skipped')
  test('Toggle field lock → Run scraper → Verify field not updated')
  test('Edit multiple fields → Save all → Verify batch update')
  test('Upload document → Verify file saved')
  test('Delete document → Verify file removed')
  test('Edit subscription → Verify new snapshot created')
  test('Notifications created after blocked update')
  test('Cache invalidation works after admin edit')
});
```

**Cache & Performance** (5 tests):
```typescript
describe('Cache Performance', () => {
  test('Protection flags cached for 1 hour')
  test('Cache invalidation clears related keys')
  test('Cache hit rate > 90% after warmup')
  test('Query time with cache < 50ms')
  test('Query time without cache < 200ms')
});
```

---

### E2E Tests - Playwright (10 tests)

**Admin Login Flow**:
```typescript
test('Admin can log in with correct password', async ({ page }) => {
  await page.goto('/admin/login');
  await page.fill('input[name="password"]', 'correct_password');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/admin');
});

test('Admin redirected to login if not authenticated', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL('/admin/login');
});
```

**Edit Workflow**:
```typescript
test('Admin can edit IPO field and save', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin');
  await page.click('button[data-ipo-id="test-ipo"]'); // Edit button
  await page.fill('input[name="company_name"]', 'Updated Company Name');
  await page.click('button:has-text("Save Changes")');
  await expect(page.locator('.toast')).toContainText('Saved successfully');
});

test('Admin can toggle field protection', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin/edit/test-ipo');
  await page.click('button[data-field="company_name"][data-action="toggle-lock"]');
  await expect(page.locator('[data-field="company_name"]')).toHaveClass(/protected/);
});
```

**Notification Flow**:
```typescript
test('Admin sees blocked update notification', async ({ page }) => {
  // Setup: Run scraper with protected IPO
  await protectIPO('test-ipo');
  await runNSEScraper();

  // Navigate to notifications
  await loginAsAdmin(page);
  await page.goto('/admin/notifications');

  // Verify notification displayed
  await expect(page.locator('.notification-item')).toContainText('Test IPO');
});

test('Admin can dismiss notification', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin/notifications');
  await page.click('button:has-text("Dismiss")');
  await expect(page.locator('.notification-item')).toHaveCount(0);
});
```

---

## 📊 Performance Considerations

### 1. Redis Caching Strategy

**Cache Keys**:
- `protection:ipo:{ipoId}` → IPO-level lock status (TTL: 1h)
- `protection:field:{ipoId}:{tableName}:{fieldName}` → Individual field protection (TTL: 1h)
- `protection:fields:{ipoId}:{tableName}` → All protected fields for table (TTL: 1h)
- `scraper:blocked:{ipoId}` → Blocked update notifications (TTL: 7d)

**Cache Invalidation**:
- On admin field edit → Invalidate `protection:field:*:{ipoId}*`
- On admin IPO lock toggle → Invalidate `protection:ipo:{ipoId}`
- On bulk protection change → Invalidate `protection:*:{ipoId}*`

**Performance Targets**:
- Cache hit time: < 10ms
- Cache miss time: < 100ms (includes DB query)
- Cache hit rate: > 90% after warmup
- Scraper overhead: < 10% (vs no protection checks)

### 2. Database Query Optimization

**Indexes**:
```sql
-- Already created in migration
CREATE INDEX idx_field_protection_ipo ON field_protection_metadata(ipo_id);
CREATE INDEX idx_field_protection_table_field ON field_protection_metadata(table_name, field_name);
CREATE INDEX idx_field_protection_protected ON field_protection_metadata(is_protected) WHERE is_protected = true;
CREATE INDEX idx_ipos_scraper_locked ON ipos(scraper_locked);
```

**Query Patterns**:
- **Single field check**: Use `idx_field_protection_table_field` (< 5ms)
- **All fields for IPO**: Use `idx_field_protection_ipo` (< 20ms)
- **All locked IPOs**: Use `idx_ipos_scraper_locked` (< 10ms)

**Batch Operations**:
- Fetch all protected fields in single query (not field-by-field)
- Use `WHERE IN` clause for multiple IPOs
- Prefetch protection flags before scraper batch processing

### 3. Admin UI Optimization

**Lazy Loading**:
- Load IPO list initially (basic info only)
- Load full IPO details on edit modal open
- Load related tables on tab switch (not all at once)

**Debouncing**:
- Autosave after 2 seconds of no typing
- Protection toggle debounced 500ms
- Search input debounced 300ms

**Pagination**:
- Admin IPO list: 50 items per page
- Notifications: 50 items per page
- Audit logs: 100 items per page

### 4. Scraper Performance Impact

**Baseline (no protection)**:
- NSE scraper: ~30 seconds for 50 IPOs
- Protection checks add: ~3 seconds (10% overhead)

**With optimization (Redis cache)**:
- Cache hit: ~0.5 seconds overhead (1.7%)
- Cache miss: ~3 seconds overhead (10%)
- Expected hit rate: 90% → Average 1.2 seconds overhead (4%)

**Acceptable**: < 10% overhead on scraper execution time

---

## 🚨 Risk Mitigation

### Risk 1: Scraper Performance Degradation

**Risk Level**: Medium
**Impact**: Scraper runs take longer, potentially missing real-time updates

**Mitigation**:
1. Aggressive Redis caching (1h TTL, 90%+ hit rate)
2. Batch protection queries (single query per IPO)
3. Early exit on IPO-level lock (no field checks needed)
4. Index optimization on protection tables
5. Monitoring: Alert if scraper duration > 2x baseline

**Rollback Plan**: Feature flag to disable protection checks temporarily

---

### Risk 2: Data Inconsistency

**Risk Level**: High
**Impact**: Manual edits overwritten by scraper due to race condition

**Mitigation**:
1. Transaction-based field updates (all-or-nothing)
2. Optimistic locking with `updatedAt` timestamp check
3. Protection flag set before value update (atomic operation)
4. Scraper runs scheduled during low-traffic periods
5. Comprehensive integration tests for race conditions

**Detection**: Daily audit comparing `lastManualEditAt` vs `lastScrapedAt`

---

### Risk 3: Accidental Data Loss

**Risk Level**: Medium
**Impact**: Admin accidentally overwrites good data

**Mitigation**:
1. Confirmation dialog before saving critical fields
2. Audit log of all admin changes (who, what, when)
3. Future: Undo capability (restore previous value)
4. Future: Field history tracking (see all changes)
5. Regular database backups (daily snapshots)

**Detection**: Monitor for large batch edits, alert on 10+ fields changed in 1 minute

---

### Risk 4: Unauthorized Access

**Risk Level**: High
**Impact**: Malicious user gains admin access, corrupts data

**Mitigation**:
1. Strong password requirement (min 16 chars, enforced)
2. Rate limiting on login attempts (5 attempts/hour)
3. Session timeout after 7 days inactivity
4. IP whitelist for admin panel (production only)
5. Future: 2FA with TOTP
6. All admin routes protected by middleware
7. Audit log of all admin logins

**Detection**: Alert on failed login attempts, unusual admin activity

---

### Risk 5: Notification Spam

**Risk Level**: Low
**Impact**: Admin overwhelmed with notifications

**Mitigation**:
1. Batch notifications (daily digest instead of real-time)
2. Notification grouping by IPO (not per-field)
3. Auto-dismiss after 7 days
4. Configurable notification preferences
5. Unsubscribe option in Telegram

**Monitoring**: Track notification count per day, alert if > 100

---

## 📝 Migration Plan

### Development Database Migration

**Step 1: Backup**
```bash
pg_dump -h localhost -U postgres -d ipodhan > backup_before_protection_$(date +%Y%m%d).sql
```

**Step 2: Run Migrations**
```bash
cd web
npm run db:generate  # Generate migration from schema changes
npm run db:migrate   # Apply migration
npm run db:studio    # Visual inspection
```

**Step 3: Verify**
```sql
-- Check table exists
SELECT * FROM field_protection_metadata LIMIT 1;

-- Check columns added
SELECT scraper_locked, scraper_lock_note, last_manual_edit_at
FROM ipos LIMIT 1;

-- Check indexes
\di field_protection_metadata*
\di ipos*
```

**Step 4: Seed Test Data (Optional)**
```sql
-- Protect a test IPO
UPDATE ipos SET scraper_locked = true WHERE slug = 'test-ipo-slug';

-- Protect specific fields
INSERT INTO field_protection_metadata
(table_name, field_name, ipo_id, is_protected)
VALUES
('ipos', 'company_name', (SELECT id FROM ipos WHERE slug = 'test-ipo-slug'), true),
('ipos', 'open_date', (SELECT id FROM ipos WHERE slug = 'test-ipo-slug'), true);
```

---

### Production Database Migration

**Timeline**: Off-peak hours (2 AM - 4 AM IST)

**Step 1: Announce Maintenance Window**
- Notify users 24 hours in advance
- Display maintenance banner on website
- Scraper jobs temporarily disabled

**Step 2: Production Backup**
```bash
# Full backup
pg_dump -h production-db -U postgres -d ipodhan > prod_backup_$(date +%Y%m%d_%H%M%S).sql

# Upload to S3
aws s3 cp prod_backup_*.sql s3://ipodhan-backups/migrations/
```

**Step 3: Apply Migration**
```bash
# Connect to production DB
psql -h production-db -U postgres -d ipodhan

# Run migration (transaction-wrapped)
BEGIN;
-- Paste migration SQL here
COMMIT;

# Verify
SELECT COUNT(*) FROM field_protection_metadata;
SELECT COUNT(*) FROM ipos WHERE scraper_locked IS NOT NULL;
```

**Step 4: Deploy Application**
```bash
# Deploy admin panel + scraper changes
pm2 stop ipodhan-web ipodhan-scraper
git pull origin main
npm ci --production
pm2 start ecosystem.config.js
```

**Step 5: Smoke Test**
- Test admin login
- Test field edit + save
- Test scraper run (dry-run mode first)
- Verify notifications created

**Step 6: Re-enable Scrapers**
```bash
pm2 restart ipodhan-scraper
```

**Step 7: Monitor**
- Watch Sentry for errors (first 2 hours)
- Monitor scraper execution time
- Check cache hit rates
- Verify no data corruption

---

### Rollback Strategy

**If issues detected within 1 hour**:

```bash
# Step 1: Stop application
pm2 stop ipodhan-web ipodhan-scraper

# Step 2: Restore database from backup
psql -h production-db -U postgres -d ipodhan < prod_backup_TIMESTAMP.sql

# Step 3: Revert to previous deployment
git reset --hard HEAD~1
npm ci --production
pm2 start ecosystem.config.js

# Step 4: Verify old version working
curl http://localhost:3000/api/health
```

**If issues detected after 1 hour**:
- Keep current version running
- Disable admin panel via feature flag
- Fix issues in hotfix branch
- Deploy hotfix

---

### Initial Flag State

**As per requirement**: All flags OFF (scraper can update everything)

```sql
-- Verify all flags are OFF after migration
SELECT
  COUNT(*) as total_ipos,
  COUNT(*) FILTER (WHERE scraper_locked = true) as locked_ipos,
  COUNT(*) FILTER (WHERE scraper_locked = false) as unlocked_ipos
FROM ipos;
-- Expected: locked_ipos = 0, unlocked_ipos = total_ipos

SELECT COUNT(*) as total_field_protections
FROM field_protection_metadata;
-- Expected: 0 (table empty initially)
```

Admin will manually opt in to protection for specific IPOs/fields as needed.

---

## 📦 Deliverables Checklist

### Code Deliverables

- [ ] **Database Schema**
  - [ ] Migration: `field_protection_metadata` table
  - [ ] Migration: `ipos` table columns
  - [ ] Migration: Indexes
  - [ ] Down migration (rollback)

- [ ] **Backend Services** (Scraper)
  - [ ] Field protection checker utility
  - [ ] Protection notification service
  - [ ] Modified NSE orchestrator
  - [ ] Modified BSE orchestrator
  - [ ] Modified Moneycontrol orchestrator
  - [ ] Modified Chittorgarh orchestrator
  - [ ] Modified InvestorGain GMP orchestrator
  - [ ] Modified listing performance updater
  - [ ] Modified BSE detail scraper
  - [ ] Modified IPO Alerts fallback

- [ ] **Backend Services** (Web)
  - [ ] Admin auth middleware
  - [ ] API: `/admin/api/update-field`
  - [ ] API: `/admin/api/toggle-lock`
  - [ ] API: `/admin/api/notifications`
  - [ ] API: `/admin/api/field-protection/:ipoId`
  - [ ] Cache invalidation service

- [ ] **Admin Panel UI**
  - [ ] Admin layout + navigation
  - [ ] Login page
  - [ ] Dashboard (IPO list)
  - [ ] Edit modal with 9 tabs
  - [ ] BasicInfoForm (15+ fields)
  - [ ] FinancialForm (10+ fields)
  - [ ] SubscriptionForm
  - [ ] GMPForm
  - [ ] ListingForm
  - [ ] DocumentsForm (upload/delete)
  - [ ] PeerCompaniesForm
  - [ ] ReviewsForm
  - [ ] ProtectionPanel
  - [ ] FieldLockToggle component
  - [ ] IPOLockToggle component
  - [ ] ProtectionStatusBadge
  - [ ] ScraperConflictAlert
  - [ ] Notification dashboard page
  - [ ] BlockedUpdatesList component
  - [ ] ConflictResolveModal

### Testing Deliverables

- [ ] **Unit Tests** (40 tests)
  - [ ] Protection checker tests (15)
  - [ ] Admin API tests (10)
  - [ ] Notification service tests (10)
  - [ ] Admin auth tests (5)

- [ ] **Integration Tests** (30 tests)
  - [ ] Scraper protection integration (15)
  - [ ] Admin workflow integration (10)
  - [ ] Cache performance tests (5)

- [ ] **E2E Tests** (10 tests)
  - [ ] Admin login flow (2)
  - [ ] Edit workflow (4)
  - [ ] Notification flow (2)
  - [ ] Protection toggle flow (2)

### Documentation Deliverables

- [ ] **Technical Documentation**
  - [ ] Architecture overview (this document)
  - [ ] Database schema documentation
  - [ ] API endpoint documentation
  - [ ] Scraper integration guide
  - [ ] Cache strategy documentation

- [ ] **User Documentation**
  - [ ] Admin user guide (30+ pages)
  - [ ] How to protect IPO data
  - [ ] How to resolve scraper conflicts
  - [ ] How to manage notifications
  - [ ] Troubleshooting guide

- [ ] **Operations Documentation**
  - [ ] Deployment guide
  - [ ] Migration guide
  - [ ] Rollback procedures
  - [ ] Monitoring & alerting setup
  - [ ] Security best practices

### Infrastructure Deliverables

- [ ] **Environment Setup**
  - [ ] Environment variables documented
  - [ ] Redis configuration
  - [ ] Database configuration
  - [ ] Admin password setup
  - [ ] Telegram webhook setup (optional)

- [ ] **Monitoring**
  - [ ] Sentry error tracking
  - [ ] Performance monitoring
  - [ ] Cache hit rate tracking
  - [ ] Scraper execution time tracking
  - [ ] Admin activity audit log

---

## 📈 Success Metrics

### Performance Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Admin edit response time | < 500ms | Time from save click to success toast |
| Protection check overhead | < 10% | Scraper execution time with vs without checks |
| Cache hit rate | > 90% | Redis cache hits / total protection queries |
| Scraper execution time | < 5% increase | NSE scraper: 30s → max 31.5s |
| Admin UI load time | < 2s | Time to interactive on dashboard |

### Data Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Protection accuracy | 100% | Protected fields never overwritten by scraper |
| Data consistency | 100% | No manual edits lost due to race conditions |
| Notification delivery | 100% | All blocked updates logged to Redis |
| Notification latency | < 5 minutes | Time from blocked update to admin visibility |

### User Experience Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Admin efficiency | < 30 seconds | Time to edit and save any field |
| Error rate | < 1% | Failed saves / total save attempts |
| User satisfaction | > 8/10 | Post-implementation survey |
| Training time | < 1 hour | Time for new admin to be productive |

### System Health Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Uptime | > 99.9% | Admin panel availability |
| Error rate | < 0.1% | API errors / total requests |
| Database load | < 20% increase | CPU usage before vs after |
| Redis memory | < 100 MB | Protection cache memory usage |

---

## 🔮 Future Enhancements (Post-Launch)

### Phase 7: Advanced Features (Month 2)

1. **Field-Level History Tracking**
   - New table: `field_edit_history` with full audit trail
   - UI: View all changes to a field over time
   - Rollback capability: Restore previous value with one click

2. **Conflict Resolution UI**
   - Side-by-side comparison: Current value vs Scraped value
   - Visual diff for complex fields (JSON, arrays)
   - "Accept scraped value" button (temporarily unprotects field)
   - "Keep manual value" button (maintains protection)

3. **Smart Auto-Protection**
   - Automatically protect field after manual edit
   - Configurable per admin user (preference setting)
   - Can be toggled on/off globally

4. **Bulk Import/Export**
   - CSV upload for manual data entry
   - Excel template download
   - Bulk edit via spreadsheet
   - Preview changes before applying

5. **Multi-Admin Support**
   - NextAuth.js integration complete
   - Role-based permissions:
     - **Viewer**: Read-only access
     - **Editor**: Can edit fields
     - **Admin**: Can manage protection flags
     - **Super Admin**: Can manage users
   - Activity audit trail with user attribution

6. **Enhanced Notifications**
   - Webhook support: Slack, Discord, Email
   - Configurable notification preferences per admin
   - Daily digest option (batch notifications)
   - Push notifications via service worker

---

## 📞 Support & Maintenance

### During Implementation (6 weeks)

**Weekly Check-ins**:
- Monday: Sprint planning, assign tasks
- Wednesday: Mid-week sync, unblock issues
- Friday: Demo progress, review code

**Communication Channels**:
- Slack: #admin-panel-dev
- GitHub: Issues for bugs, PRs for features
- Documentation: Confluence wiki

### Post-Launch (Ongoing)

**Incident Response**:
- P0 (Critical): < 1 hour response (data corruption, auth bypass)
- P1 (High): < 4 hours response (scraper failures, admin panel down)
- P2 (Medium): < 24 hours response (UI bugs, minor features)
- P3 (Low): < 1 week response (enhancements, documentation)

**Maintenance Schedule**:
- Weekly: Review scraper logs, check cache hit rates
- Monthly: Audit log analysis, performance tuning
- Quarterly: Security review, dependency updates

---

## 🎯 Conclusion

This implementation plan provides a **comprehensive, production-ready solution** for manual data management with scraper protection. The architecture is:

- ✅ **Scalable**: Handles all 13 tables, 150+ fields, 19 scrapers
- ✅ **Performant**: < 10% overhead on scraper execution
- ✅ **Maintainable**: Clear separation of concerns, extensive tests
- ✅ **Extensible**: Easy to add new tables, notification channels
- ✅ **Secure**: Admin auth, audit logging, input validation
- ✅ **User-Friendly**: Intuitive UI, clear visual indicators

**Timeline**: 6 weeks from start to production deployment
**Confidence Level**: High (9/10) - Requirements clear, architecture validated, risks mitigated

**Ready to proceed with Phase 1 implementation!** 🚀

---

**Document Version**: 1.0
**Last Updated**: 2025-10-22
**Author**: Claude Code
**Reviewers**: [To be filled]
**Status**: ✅ Approved for Implementation
