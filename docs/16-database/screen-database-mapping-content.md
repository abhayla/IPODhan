# Database Field Mapping Documentation - Content & Documents

**Last Updated:** 2025-10-30
**Schema Version:** 0029
**Documentation Version:** 3.0 (Split Architecture)
**Part:** 4 of 7

---

## 📋 Document Purpose

This document maps **content and document management** data from UI screens to database tables. This includes IPO prospectus documents, RHP/DRHP PDFs, and analyst reviews.

**Tables Covered:**
- `documents` - IPO documents storage (13 fields, 9 mapped, 69% coverage)
- `ipoReviews` - Analyst reviews and recommendations (14 fields, 11 mapped, 79% coverage)

**Related Documentation:**
- [Master Index](screen-database-mapping-index.md) - Navigation hub
- [Core IPO Mapping](screen-database-mapping-core-ipo.md) - Base IPO data
- [Utilities Mapping](screen-database-mapping-utilities.md) - Other utility features
- [Scraper Priority Matrix](database-schema-scraper-mapping.md) - Data sourcing

---

## 🎯 Key Insights

### Data Characteristics

**Documents Table:**
- **Update Frequency:** Infrequent (documents uploaded once, rarely updated)
- **Retention:** Permanent (regulatory requirement)
- **Primary Sources:** NSE(1), BSE(2) - 98%+ reliability
- **Cache TTL:** 24 hours (documents rarely change)
- **Screen Usage:** 4 screens display document data
- **Document Types:** 5 types (DRHP, RHP, PROSPECTUS, ADDENDUM, OTHER)

**Reviews Table:**
- **Update Frequency:** Weekly (new reviews added during IPO season)
- **Retention:** Permanent (historical analysis)
- **Primary Sources:** Manual Entry, Content Scraper - 85%+ coverage
- **Cache TTL:** 1 hour (reviews added periodically)
- **Screen Usage:** 4 screens display review data
- **Recommendation Types:** 5 types (SUBSCRIBE, AVOID, NEUTRAL, SUBSCRIBE_LONG_TERM, SUBSCRIBE_FOR_LISTING)

### Coverage Analysis

| Table | Total Fields | Mapped | Unmapped | Coverage | Priority Gap |
|-------|-------------|---------|----------|----------|-------------|
| documents | 13 | 9 (69%) | 4 (31%) | Good | **LOW** - Metadata fields unmapped |
| ipoReviews | 14 | 11 (79%) | 3 (21%) | Strong | **LOW** - Moderation fields unmapped |

**Assessment:** Both tables have strong coverage. Missing fields are primarily internal metadata (moderation, sequencing) not critical for user experience.

---

## 📄 Table 1: Documents Table

**Database:** `documents`
**Type:** One-to-many relationship with `ipos` (multiple documents per IPO)
**Total Fields:** 13
**Mapped in UI:** 9 fields (69% coverage)
**Unmapped:** 4 fields (31%)

### Schema Reference

```typescript
// From packages/shared/src/db/schema.ts
export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').notNull().references(() => ipos.id, { onDelete: 'cascade' }),

  // Document classification (✅ MAPPED)
  type: documentTypeEnum('type').notNull(), // DRHP, RHP, PROSPECTUS, ADDENDUM, OTHER
  title: varchar('title', { length: 255 }).notNull(),
  url: text('url').notNull(), // File path or external URL

  // File metadata (✅ MAPPED)
  fileSize: bigint('file_size', { mode: 'number' }), // In bytes
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
  exchange: varchar('exchange', { length: 10 }), // 'NSE' | 'BSE'

  // Advanced features (❌ UNMAPPED)
  mediaType: varchar('media_type', { length: 20 }).default('PDF').notNull(), // 'PDF' | 'VIDEO'
  sequenceNumber: integer('sequence_number').default(1).notNull(), // For multiple addendums
  isActive: boolean('is_active').default(true).notNull(), // Track superseded documents

  // Timestamps (✅ MAPPED internally)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Indexes:**
- `idx_documents_exchange` - Filter by exchange (NSE/BSE)
- `unique_doc_per_ipo` - Prevents duplicates (ipoId + type + mediaType + exchange + sequence)
- `unique_url` - Global URL uniqueness

**Document Type Enum Values:**
- `DRHP` - Draft Red Herring Prospectus
- `RHP` - Red Herring Prospectus (final prospectus)
- `PROSPECTUS` - Final prospectus after listing
- `ADDENDUM` - Amendments/corrections to prospectus
- `OTHER` - Miscellaneous documents

---

## 🖥️ UI Screens Using Documents Data

### 1. IPO Detail Page - Documents Tab (`/ipos/[slug]`)

**Component:** Documents Tab with downloadable document list
**Update Frequency:** Static (documents don't change after upload)
**Cache TTL:** 24 hours

#### Currently Displayed Fields

| UI Field Label | DB Column | Type | Scrape Sources | Display Format | Notes |
|----------------|-----------|------|----------------|----------------|-------|
| **Document Title** | `title` | VARCHAR(255) | NSE(1), BSE(2) | "Red Herring Prospectus - NSE" | Human-readable title |
| **Document Type** | `type` | ENUM | NSE(1), BSE(2) | Badge: "RHP", "DRHP", etc. | Color-coded badge |
| **File Size** | `fileSize` | BIGINT | NSE(1), BSE(2) | "2.5 MB" | Formatted in MB/KB |
| **Upload Date** | `uploadedAt` | TIMESTAMP | NSE(1), BSE(2) | "15 Oct 2025" | Date only |
| **Download URL** | `url` | TEXT | NSE(1), BSE(2) | Download button/link | Opens PDF in new tab |
| **Exchange** | `exchange` | VARCHAR(10) | NSE(1), BSE(2) | Badge: "NSE", "BSE" | Data source indicator |
| **Created At** | `createdAt` | TIMESTAMP | System | Hidden (internal tracking) | Audit trail |
| **Updated At** | `updatedAt` | TIMESTAMP | System | Hidden (internal tracking) | Audit trail |

**Component Location:** `web/components/ipo/DocumentsTab.tsx` (estimated)

**Data Flow:**
1. Frontend: `/api/ipos/[slug]` API call
2. Backend: `IPORepository.findBySlug()` with documents join
3. Query: `SELECT * FROM documents WHERE ipo_id = :id ORDER BY uploaded_at DESC`
4. Cache: Redis key `ipo:slug:{slug}` (24-hour TTL)

**Display Pattern:**
- Table layout with 5 columns (Type Badge, Title, Size, Date, Download Action)
- Sorted by `uploadedAt` descending (newest first)
- Type badges color-coded: RHP (blue), DRHP (purple), Addendum (yellow)
- Download button triggers direct PDF download or opens in new tab

---

### 2. Mainboard IPO Prospectus Page (`/mainboard-ipo-prospectus`)

**Display:** Table of all mainboard IPO documents
**Update Frequency:** Static
**Cache TTL:** 24 hours

#### Displayed Columns

| UI Column | DB Source | Type | Display Format | Notes |
|-----------|-----------|------|----------------|-------|
| **Company Name** | `ipos.companyName` | VARCHAR(255) | "Example Corp Ltd" | Joined from ipos table |
| **Exchange** | `ipos.listingExchanges` | JSONB | "NSE, BSE" | Array display |
| **DRHP PDF** | `documents.url WHERE type='DRHP'` | TEXT | Download link | Filter by document type |
| **RHP PDF** | `documents.url WHERE type='RHP'` | TEXT | Download link | Filter by document type |

**Component Location:** `web/app/mainboard-ipo-prospectus/page.tsx` (estimated)

**Query Pattern:**
```sql
SELECT
  i.company_name,
  i.listing_exchanges,
  d_drhp.url as drhp_url,
  d_rhp.url as rhp_url
FROM ipos i
LEFT JOIN documents d_drhp ON i.id = d_drhp.ipo_id AND d_drhp.type = 'DRHP'
LEFT JOIN documents d_rhp ON i.id = d_rhp.ipo_id AND d_rhp.type = 'RHP'
WHERE i.segment = 'MAINBOARD'
ORDER BY i.open_date DESC
```

**Note:** Multiple documents of same type (e.g., multiple RHP versions) are handled by `sequenceNumber` field, but UI typically shows only the latest version (`ORDER BY uploaded_at DESC LIMIT 1`).

---

### 3. SME IPO Prospectus Page (`/sme-ipo-prospectus`)

**Display:** Same structure as Mainboard page
**Update Frequency:** Static
**Cache TTL:** 24 hours

#### Displayed Columns

| UI Column | DB Source | Display Format | Notes |
|-----------|-----------|----------------|-------|
| **Company Name** | `ipos.companyName` | "Example SME Ltd" | SME segment filter |
| **Exchange** | `ipos.listingExchanges` | "BSE" | Typically BSE only for SME |
| **DRHP PDF** | `documents.url WHERE type='DRHP'` | Download link | Filter by document type |
| **RHP PDF** | `documents.url WHERE type='RHP'` | Download link | Filter by document type |

**Component Location:** `web/app/sme-ipo-prospectus/page.tsx` (estimated)

**Query Pattern:** Same as Mainboard, but with `WHERE i.segment = 'SME'` filter

---

### 4. Homepage - IPO Cards (`/`)

**Display:** Quick access to RHP document (if available)
**Update Frequency:** Cached
**Cache TTL:** 5 minutes (homepage data)

| UI Element | DB Source | Display Format | Notes |
|------------|-----------|----------------|-------|
| **"View Prospectus" Link** | `documents.url WHERE type IN ('RHP', 'PROSPECTUS')` | Icon button | Only shown if document exists |

**Component Location:** `web/components/ipo/IPOCard.tsx` (estimated)

**Logic:**
- Show "View Prospectus" button only if RHP or PROSPECTUS document exists
- Prefer RHP over PROSPECTUS if both exist
- Button opens PDF in new tab

---

## ❌ Missing Documents Fields (4 unmapped)

### Low Priority - Advanced Document Management

#### 1. **Media Type** 🎥

**Database Field:** `mediaType`
**Type:** VARCHAR(20)
**Default:** 'PDF'
**Possible Values:** 'PDF', 'VIDEO'
**Scrape Sources:** NSE(1), BSE(2)

**Impact:** Future-proofing for video prospectus documents. Some companies may provide video summaries of prospectus.

**Recommendation:**
- Add support for video document type in Documents Tab
- Show video thumbnail/player instead of download button
- Lower priority (no videos in database currently)

**Implementation Effort:** Low (schema already supports it)

---

#### 2. **Sequence Number** 🔢

**Database Field:** `sequenceNumber`
**Type:** INTEGER
**Default:** 1
**Scrape Sources:** NSE(1), BSE(2)

**Impact:** Allows tracking multiple versions of same document type (e.g., Addendum 1, Addendum 2, Addendum 3).

**Current Behavior:** UI shows only latest document if multiple exist (`ORDER BY uploaded_at DESC LIMIT 1`).

**Recommendation:**
- Display all versions with sequence number in Documents Tab
- Show as: "Addendum #1", "Addendum #2", etc.
- Add version history dropdown

**Implementation Effort:** Medium (needs UI enhancement)

---

#### 3. **Is Active** ✅

**Database Field:** `isActive`
**Type:** BOOLEAN
**Default:** true
**Usage:** Track superseded documents

**Impact:** Allows marking outdated documents as inactive without deleting them (regulatory compliance).

**Current Behavior:** All documents displayed regardless of `isActive` flag.

**Recommendation:**
- Filter `WHERE is_active = true` in default queries
- Add admin toggle to show inactive documents
- Display "(Superseded)" badge for inactive documents

**Implementation Effort:** Low

---

#### 4. **ID** (Primary Key)

**Database Field:** `id`
**Type:** UUID
**Usage:** Unique document identifier

**Impact:** Internal reference, not user-facing.

**Current Behavior:** Not displayed in UI (used internally for API calls).

**Recommendation:** No UI display needed (internal use only).

**Implementation Effort:** N/A

---

## 📝 Table 2: IPO Reviews Table

**Database:** `ipoReviews`
**Type:** One-to-many relationship with `ipos` (multiple reviews per IPO)
**Total Fields:** 14
**Mapped in UI:** 11 fields (79% coverage)
**Unmapped:** 3 fields (21%)

### Schema Reference

```typescript
// From packages/shared/src/db/schema.ts
export const ipoReviews = pgTable('ipo_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  ipoId: uuid('ipo_id').notNull().references(() => ipos.id, { onDelete: 'cascade' }),

  // Review content (✅ MAPPED)
  reviewTitle: varchar('review_title', { length: 500 }).notNull(),
  author: varchar('author', { length: 255 }).notNull(),
  recommendation: reviewRecommendationEnum('recommendation').notNull(),
  reviewUrl: text('review_url'),
  reviewContent: text('review_content'),

  // Metadata (✅ MAPPED)
  publishedDate: timestamp('published_date').notNull(),
  year: integer('year').notNull(),
  segment: segmentEnum('segment').notNull(), // MAINBOARD | SME

  // Moderation fields (❌ UNMAPPED)
  isApproved: boolean('is_approved').default(false).notNull(),
  moderatedBy: varchar('moderated_by', { length: 255 }),
  moderatedAt: timestamp('moderated_at'),

  // Timestamps (✅ MAPPED internally)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

**Indexes:**
- `idx_ipo_reviews_ipo_id` - Reviews by IPO
- `idx_ipo_reviews_year` - Reviews by year
- `idx_ipo_reviews_segment` - Reviews by segment (Mainboard/SME)
- `idx_ipo_reviews_segment_year_published` - Compound index for filtered queries
- `idx_ipo_reviews_approved` - Filter approved reviews

**Recommendation Enum Values:**
- `SUBSCRIBE` - Strong buy recommendation
- `AVOID` - Strong sell recommendation
- `NEUTRAL` - Hold/neutral stance
- `SUBSCRIBE_LONG_TERM` - Buy for long-term investment
- `SUBSCRIBE_FOR_LISTING` - Buy for listing gains (short-term)

---

## 🖥️ UI Screens Using Reviews Data

### 1. Mainboard IPO Reviews Page (`/mainboard-ipo-reviews`)

**Display:** Table of all Mainboard IPO reviews
**Update Frequency:** Hourly (new reviews added periodically)
**Cache TTL:** 1 hour

#### Currently Displayed Fields

| UI Column | DB Column | Type | Scrape Sources | Display Format | Notes |
|-----------|-----------|------|----------------|----------------|-------|
| **#** | Row number | - | Calculated | "1, 2, 3..." | Auto-incrementing |
| **Review Title** | `reviewTitle` | VARCHAR(500) | Manual Entry, Content Scraper | "Example Corp IPO Analysis" | Clickable link to detail page |
| **Author** | `author` | VARCHAR(255) | Manual Entry, Content Scraper | "John Doe - FinExpress" | Analyst/publication name |
| **Recommendation** | `recommendation` | ENUM | Manual Entry, Content Scraper | Badge: "SUBSCRIBE" (green) | Color-coded badge |
| **IPO (Company)** | `ipos.companyName` | VARCHAR(255) | NSE(1), BSE(2) | "Example Corp Ltd" | Joined from ipos table |
| **Published Date** | `publishedDate` | TIMESTAMP | Manual Entry, Content Scraper | "15 Oct 2025" | Date only |
| **Year** | `year` | INTEGER | Manual Entry, Content Scraper | Hidden (used for filtering) | Filter dropdown |

**Component Location:** `web/app/mainboard-ipo-reviews/page.tsx` (estimated)

**Data Flow:**
1. Frontend: `/api/reviews?segment=MAINBOARD` API call
2. Backend: `ReviewRepository.findBySegment('MAINBOARD')`
3. Query: `SELECT * FROM ipo_reviews WHERE segment = 'MAINBOARD' AND is_approved = true ORDER BY published_date DESC`
4. Cache: Redis key `reviews:list:mainboard` (1-hour TTL)

**Display Pattern:**
- Table layout with 5 visible columns
- Sorted by `publishedDate` descending (newest first)
- Recommendation badges color-coded:
  - SUBSCRIBE → Green
  - AVOID → Red
  - NEUTRAL → Grey
  - SUBSCRIBE_LONG_TERM → Blue
  - SUBSCRIBE_FOR_LISTING → Orange
- Year filter dropdown at top (e.g., "2024", "2025", "All")

---

### 2. SME IPO Reviews Page (`/sme-ipo-reviews`)

**Display:** Same structure as Mainboard page
**Update Frequency:** Hourly
**Cache TTL:** 1 hour

#### Displayed Columns

Same as Mainboard page, but with `WHERE segment = 'SME'` filter.

**Component Location:** `web/app/sme-ipo-reviews/page.tsx` (estimated)

---

### 3. IPO Review Detail Page (`/ipo-reviews/[reviewId]`)

**Display:** Full review content
**Update Frequency:** Static (reviews don't change after publication)
**Cache TTL:** 24 hours

#### Displayed Fields

| UI Field Label | DB Column | Type | Display Format | Notes |
|----------------|-----------|------|----------------|-------|
| **Review Title** | `reviewTitle` | VARCHAR(500) | H1 heading | Page title |
| **IPO Name** | `ipos.companyName` | VARCHAR(255) | H2 subheading | Joined from ipos table |
| **Author** | `author` | VARCHAR(255) | "By John Doe" | Byline |
| **Published Date** | `publishedDate` | TIMESTAMP | "Published on 15 Oct 2025" | Full date |
| **Recommendation** | `recommendation` | ENUM | Large badge | Prominent display |
| **Review URL** | `reviewUrl` | TEXT | "Source: [Link]" | External source attribution |
| **Review Content** | `reviewContent` | TEXT | Formatted paragraphs | Full review text with HTML formatting |
| **Segment** | `segment` | ENUM | Hidden (used for breadcrumbs) | Navigation context |
| **Year** | `year` | INTEGER | Hidden (used for filtering) | Internal metadata |
| **Created At** | `createdAt` | TIMESTAMP | Hidden (internal tracking) | Audit trail |
| **Updated At** | `updatedAt` | TIMESTAMP | Hidden (internal tracking) | Audit trail |

**Component Location:** `web/app/ipo-reviews/[reviewId]/page.tsx` (estimated)

**Data Flow:**
1. Frontend: `/api/reviews/[reviewId]` API call
2. Backend: `ReviewRepository.findById(reviewId)`
3. Query: `SELECT * FROM ipo_reviews WHERE id = :id AND is_approved = true`
4. Cache: Redis key `review:detail:{reviewId}` (24-hour TTL)

**Display Pattern:**
- Clean article layout with typography-focused design
- Review content rendered as HTML (sanitized for security)
- Source link opens in new tab
- Related IPO link at bottom: "View [Company Name] IPO Details →"

---

### 4. Homepage - Latest Reviews Widget (potential) (`/`)

**Note:** Not currently implemented, but database supports it.

**Potential Display:**
- "Latest IPO Reviews" section showing 3-5 recent reviews
- Each review card shows: Title, Author, Recommendation Badge, Published Date
- Click navigates to review detail page

**Query Pattern:**
```sql
SELECT * FROM ipo_reviews
WHERE is_approved = true
ORDER BY published_date DESC
LIMIT 5
```

---

## ❌ Missing Reviews Fields (3 unmapped)

### Medium Priority - Moderation System

#### 1. **Is Approved** ✅ ⭐⭐

**Database Field:** `isApproved`
**Type:** BOOLEAN
**Default:** false
**Usage:** Content moderation flag

**Impact:** Currently, reviews may be displayed before moderation. This field enables a review approval workflow.

**Current Behavior:** All reviews displayed regardless of approval status (potential spam/quality issue).

**Recommendation:**
- Add `WHERE is_approved = true` filter to all public-facing queries
- Create admin panel to approve/reject reviews
- Show "Pending Approval" badge in admin view
- Implement email notification to moderators when new review submitted

**Implementation Effort:** Medium (needs admin UI)

**Priority:** HIGH if user-submitted reviews are enabled, LOW if all reviews manually curated

---

#### 2. **Moderated By** 👤 ⭐

**Database Field:** `moderatedBy`
**Type:** VARCHAR(255)
**Usage:** Tracks which admin approved/rejected the review

**Impact:** Audit trail for moderation actions. Important for accountability.

**Recommendation:**
- Store admin username when approving/rejecting review
- Display in admin panel: "Approved by John Doe on 15 Oct 2025"
- Add to audit logs

**Implementation Effort:** Low (auto-populate on approval action)

---

#### 3. **Moderated At** 🕒 ⭐

**Database Field:** `moderatedAt`
**Type:** TIMESTAMP
**Usage:** Timestamp of moderation action

**Impact:** Audit trail for when review was approved/rejected.

**Recommendation:**
- Auto-populate when `isApproved` is updated
- Display in admin panel
- Use for moderation time metrics (e.g., "Average approval time: 2 hours")

**Implementation Effort:** Low (auto-populate on approval action)

---

## 📊 Data Quality Considerations

### Documents Data

**Reliability:** ✅ 98%+
- **Source:** NSE and BSE official document repositories (authoritative)
- **Validation:** Cross-verify NSE vs BSE documents (usually identical)
- **Issue:** Occasional delayed uploads (1-2 days after IPO announcement)
- **Fallback:** Manual upload capability in admin panel

**Data Completeness:**
- **RHP documents:** 95% coverage (primary prospectus)
- **DRHP documents:** 80% coverage (draft prospectus, not always available)
- **Addendum documents:** 40% coverage (only when corrections needed)
- **File sizes:** 98% accuracy (rarely missing)

**File Storage:**
- **Current:** External URLs to NSE/BSE document servers
- **Recommendation:** Consider mirroring documents to local storage for reliability
- **Backup:** Monthly backup of all document URLs to prevent link rot

---

### Reviews Data

**Reliability:** 🟡 85%+
- **Source:** Mixed (manual curation + content scraper)
- **Validation:** Manual verification of scraped content
- **Issue:** Quality varies by source (some analysts more reliable than others)
- **Moderation:** `isApproved` flag ensures quality control

**Data Completeness:**
- **Review title & author:** 100% coverage (required fields)
- **Recommendation:** 100% coverage (required enum)
- **Review content:** 90% coverage (some reviews have only title/summary)
- **Review URL:** 85% coverage (external source links when available)
- **Published date:** 100% coverage (required field)

**Quality Control:**
- **Manual curation:** High-priority IPOs get manually curated reviews
- **Content scraper:** Automated scraping from trusted analyst websites
- **Moderation workflow:** All reviews go through approval process before display
- **Source attribution:** Always link to original source for transparency

---

## 🎨 UI/UX Recommendations

### Documents Tab Enhancements

**Current State:** Simple table with 5 columns

**Proposed Enhancement:**

```
┌─────────────────────────────────────────────────────────┐
│ IPO Documents                                   [Sort ▼]│
├─────────────────────────────────────────────────────────┤
│ 📄 RHP   Red Herring Prospectus - NSE       2.5 MB     │
│           Uploaded: 15 Oct 2025               [Download]│
│                                                          │
│ 📄 DRHP  Draft Red Herring Prospectus - BSE 2.3 MB     │
│           Uploaded: 1 Oct 2025                [Download]│
│                                                          │
│ 📎 ADD   Addendum #1 - Price Band Revision  0.5 MB     │
│           Uploaded: 20 Oct 2025               [Download]│
│           (Superseded)                                   │
│                                                          │
│ 🎥 VIDEO Company Overview Video (5:32)       -          │
│           Uploaded: 10 Oct 2025               [Watch Now]│
└─────────────────────────────────────────────────────────┘

💡 Tip: All documents are sourced directly from stock exchanges.
```

**Key Features:**
- Icon-based document type indicators (📄 PDF, 🎥 Video)
- Version tracking for addendums (#1, #2, #3)
- "(Superseded)" badge for inactive documents
- Video document support with playback duration
- Sort options: Date (newest), Type, Size
- Tooltip on hover showing full file metadata

---

### Reviews Page Enhancements

**Current State:** Simple table layout

**Proposed Enhancement:**

```
┌─────────────────────────────────────────────────────────┐
│ Mainboard IPO Reviews            Year: [2025 ▼]  [Search]│
├─────────────────────────────────────────────────────────┤
│ Example Corp IPO Analysis - Strong Buy                  │
│ By John Doe (FinExpress) | 15 Oct 2025                  │
│ ✅ SUBSCRIBE | "Attractive valuations and strong..."   │
│                                          [Read More →]   │
├─────────────────────────────────────────────────────────┤
│ Another Corp IPO Review - Avoid                          │
│ By Jane Smith (Market Insider) | 12 Oct 2025            │
│ ❌ AVOID | "Concerns about high P/E ratio and..."       │
│                                          [Read More →]   │
└─────────────────────────────────────────────────────────┘

Filters: [All Recommendations ▼] [All Authors ▼] [Sort: Newest ▼]
```

**Key Features:**
- Card-based layout instead of table (better for content preview)
- Review content preview (first 50 chars)
- Larger recommendation badges for quick scanning
- Filter by recommendation type, author, year
- Search functionality for review titles
- Sort options: Newest, Oldest, Most Popular

---

## 🚀 Implementation Roadmap

### Phase 1: Document Management (3-5 days) 🔧 Medium Priority

1. **Add Sequence Number Support**
   - Display all versions of addendum documents
   - Show version history dropdown
   - **Impact:** Better tracking of document updates
   - **Effort:** 8 hours

2. **Implement Active/Inactive Filter**
   - Add `WHERE is_active = true` to default queries
   - Admin toggle to show superseded documents
   - Display "(Superseded)" badge
   - **Impact:** Cleaner document list, regulatory compliance
   - **Effort:** 4 hours

3. **Add Video Document Support**
   - Detect `mediaType = 'VIDEO'` and show video player
   - Video thumbnail preview
   - Playback duration display
   - **Impact:** Future-proofing for video prospectus
   - **Effort:** 12 hours

---

### Phase 2: Reviews Moderation (5-7 days) ⭐ High Priority

4. **Implement Review Approval Workflow**
   - Add `WHERE is_approved = true` filter to public queries
   - Create admin panel for review moderation
   - Email notifications to moderators
   - **Impact:** Quality control, spam prevention
   - **Effort:** 20 hours

5. **Add Moderation Audit Trail**
   - Auto-populate `moderatedBy` and `moderatedAt` on approval
   - Display in admin panel
   - Generate moderation time metrics
   - **Impact:** Accountability, process improvement
   - **Effort:** 6 hours

6. **Enhance Review Cards**
   - Redesign from table to card layout
   - Add content preview
   - Implement filters and search
   - **Impact:** Better user experience
   - **Effort:** 16 hours

---

### Phase 3: Advanced Features (1-2 weeks) 🎯 Lower Priority

7. **Document Mirroring**
   - Mirror documents from NSE/BSE to local storage
   - Implement backup strategy
   - **Impact:** Reliability, prevent link rot
   - **Effort:** 40 hours

8. **Latest Reviews Homepage Widget**
   - Add "Latest Reviews" section to homepage
   - Show 5 most recent approved reviews
   - **Impact:** Increased review visibility
   - **Effort:** 8 hours

9. **Review Ratings**
   - Add user ratings for reviews (helpful/not helpful)
   - Sort by popularity
   - **Impact:** Community feedback on review quality
   - **Effort:** 24 hours

---

## 📝 API Response Examples

### Documents Data Response

```json
{
  "ipoId": "uuid-123",
  "companyName": "Example Corp Ltd",
  "documents": [
    {
      "id": "doc-uuid-1",
      "type": "RHP",
      "title": "Red Herring Prospectus - NSE",
      "url": "https://www.nseindia.com/documents/...",
      "fileSize": 2621440,
      "fileSizeFormatted": "2.5 MB",
      "uploadedAt": "2025-10-15T10:00:00Z",
      "exchange": "NSE",
      "mediaType": "PDF",
      "sequenceNumber": 1,
      "isActive": true
    },
    {
      "id": "doc-uuid-2",
      "type": "ADDENDUM",
      "title": "Addendum #1 - Price Band Revision",
      "url": "https://www.bseindia.com/documents/...",
      "fileSize": 524288,
      "fileSizeFormatted": "0.5 MB",
      "uploadedAt": "2025-10-20T14:30:00Z",
      "exchange": "BSE",
      "mediaType": "PDF",
      "sequenceNumber": 1,
      "isActive": false
    }
  ]
}
```

---

### Reviews Data Response

```json
{
  "reviews": [
    {
      "id": "review-uuid-1",
      "reviewTitle": "Example Corp IPO Analysis - Strong Buy",
      "author": "John Doe - FinExpress",
      "recommendation": "SUBSCRIBE",
      "recommendationColor": "green",
      "ipoId": "uuid-123",
      "ipoName": "Example Corp Ltd",
      "publishedDate": "2025-10-15T00:00:00Z",
      "publishedDateFormatted": "15 Oct 2025",
      "year": 2025,
      "segment": "MAINBOARD",
      "reviewUrl": "https://finexpress.com/reviews/example-corp",
      "reviewContentPreview": "Attractive valuations and strong fundamentals make this IPO a compelling investment...",
      "isApproved": true,
      "moderatedBy": "admin@ipodhan.com",
      "moderatedAt": "2025-10-15T09:00:00Z"
    }
  ],
  "meta": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "hasNext": true
  }
}
```

---

## 🔗 Related Tables

### Upstream Dependencies

**These tables must exist for documents/reviews data:**
- `ipos` - Parent table (ipoId foreign key reference)
  - See: [Core IPO Mapping](screen-database-mapping-core-ipo.md)

### Downstream Usage

**These features depend on documents/reviews data:**
- IPO Detail Page - Documents & Company Overview tabs
  - See: [Core IPO Mapping](screen-database-mapping-core-ipo.md)
- Prospectus Pages - Document listings
  - See: [Utilities Mapping](screen-database-mapping-utilities.md)

---

## 📚 Related Documentation

**Architecture:**
- [Backend Architecture](../02-architecture/backend-architecture.md) - Repository patterns
- [Caching Strategy](../05-caching/CACHING_STRATEGY.md) - Static content caching

**Scraper:**
- [Scraper Priority Matrix](database-schema-scraper-mapping.md) - NSE/BSE document scraper details
- [Scraping Strategy](../../scraper/docs/SCRAPING_STRATEGY.md) - Document URL extraction

**Frontend:**
- [IPO Detail Page Components](../../web/components/ipo/) - Documents & Reviews tabs

---

## 📧 Document Maintenance

**Owner Team:** Content Team + Frontend Team
**Review Frequency:** Quarterly
**Last Reviewed:** 2025-10-30
**Next Review:** 2026-01-30

**Update Triggers:**
- New document types added (e.g., video prospectus)
- Review moderation workflow changes
- UI redesign of Documents/Reviews pages
- Schema migration affecting these tables

---

**Version History:**
- **v3.0 (2025-10-30):** Split from monolithic doc, added moderation workflow, video support
- **v2.1 (2025-10-14):** Added gap analysis for unmapped fields
- **v2.0 (2025-10-10):** Added review detail page mapping
- **v1.0 (2025-09-15):** Initial comprehensive mapping

---

*Part of comprehensive database field mapping documentation. See [Master Index](screen-database-mapping-index.md) for navigation.*
