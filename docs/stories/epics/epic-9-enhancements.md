# Epic 9: IPO Listings & Dedicated Pages - Enhancements

## Epic Goal

Expand the IPO listing capabilities by adding four categorized IPO tables to the home page AND creating thirteen dedicated pages: two comprehensive landing pages (Mainboard IPOs & SME IPOs), three standalone pages for Rights Issues, Offer for Sale (OFS), and NCD Issues, plus eight category-specific pages (4 for Mainboard + 4 for SME) for IPO Performance Tracking, IPO Prospectus Documents, IPO Calendar, and IPO Reviews & Analysis. The landing pages will serve as central hubs featuring summary metrics, content sections, navigation cards, and detailed IPO listings. This enhancement will provide users with immediate visibility of various IPO categories on the home page while offering comprehensive landing pages and detailed, dedicated experiences tailored specifically for Mainboard and SME investors, including specialized issue types, post-listing performance analysis, document access, event scheduling, and expert investment recommendations, improving overall user engagement and platform comprehensiveness.

## Epic Description

### Existing System Context

**Current relevant functionality:**
- Home page exists at `web/app/page.tsx` with Hero section, Features section ("Everything You Need for IPO Investments"), and CTA section
- Existing IPO API endpoint `/api/ipos` supports filtering by status (UPCOMING, OPEN, CLOSED, LISTED) and category (MAINBOARD, SME, RIGHTS, NCD)
- IPO data model includes: companyName, category, status, openDate, closeDate, issueSize, sector
- Dashboard page at `/dashboard` displays IPO cards/grid with full filtering and search

**Technology stack:**
- Next.js 15.5.4 (App Router) with React 19.1.0
- TypeScript 5
- Tailwind CSS 4 for styling
- PostgreSQL database with Drizzle ORM
- Redis for caching
- Server-side rendering with data fetching
- Existing UI components: `components/ui/table.tsx`, `components/ui/card.tsx`, `components/ui/badge.tsx`
- API client utilities in `lib/api-client.ts`
- Date formatting with `date-fns` library

**Integration points:**
- Insert new table section on home page above line 62 (before "Everything You Need for IPO Investments" h2 heading)
- Use existing `/api/ipos` endpoint with filters for data fetching
- Link "More..." buttons to dashboard with pre-applied filters
- Follow existing responsive design patterns (mobile-first, grid layouts)

### Enhancement Details

**What's being added/changed:**

This epic delivers TWO major enhancements:

#### Part 1: Home Page IPO Tables (Stories 9.1-9.3)

Add a new section to the home page containing **4 IPO listing tables** with the following categories:

1. **IPO 2025 List (Mainboard)** - Active and recent mainboard IPOs
   - Columns: Issuer Company | Open | Close
   - Color-coded rows (green=currently open, yellow=closing soon, white=upcoming/closed)
   - "More Mainline IPO..." link at bottom

2. **SME IPO 2025 List** - Active and recent SME IPOs
   - Columns: Issuer Company | Open | Close
   - Same color-coding as mainboard table
   - "More SME IPO..." link at bottom

3. **Upcoming Mainboard IPOs (Filed with SEBI)** - IPOs in registration phase
   - Columns: Company Name | Status | Date
   - Status values: "Filed with SEBI", "SEBI approval received"
   - "More Upcoming Mainline IPO..." link at bottom

4. **Upcoming SME IPOs (Filed with BSE/NSE)** - SME IPOs in registration phase
   - Columns: Company Name | Status | Date
   - Status value: "Filed with Exchange"
   - "More Upcoming SME IPO..." link at bottom

**Visual Requirements (from reference image):**
- Two-column layout on desktop (Mainboard left, SME right)
- Single column layout on mobile (stacked)
- Tables have alternating row colors
- Active IPOs highlighted with green background
- IPOs closing within 2 days highlighted with yellow background
- Clean borders and spacing matching the reference design
- Responsive typography

**How it integrates:**
- Server-side data fetching on page load using existing API
- Static rendering with revalidation for SEO and performance
- Tables rendered as new section between Hero and Features sections
- "More..." links navigate to `/dashboard` with query parameters to pre-filter results
- Uses existing table components and styling patterns

**Success criteria:**
- All 4 tables visible on home page above "Everything You Need for IPO Investments" section
- Tables display correct IPO data filtered by category and status
- Color-coding works correctly based on IPO dates and status
- "More..." links navigate correctly with filters applied
- Tables are fully responsive (mobile, tablet, desktop)
- Page load performance remains under 2 seconds (LCP)
- No visual layout shift (CLS) during table load

---

#### Part 2: Dedicated Pages (Stories 9.4-9.16)

Create **13 dedicated pages**: 2 comprehensive landing pages, 3 standalone pages for special issue types, plus 8 category-specific pages (4 Mainboard + 4 SME):

**Landing Pages (Stories 9.15-9.16):**

0. **Mainboard IPOs Landing Page** (`/mainboard-ipos`)
   - Summary metrics dashboard (6 cards): Total IPOs, Listed in Gain, Listed in Loss, Upcoming & OnGoing, Gain AOT, Loss AOT
   - Content sections (card/grid layout): Current IPOs, Upcoming IPOs, Recently Listed IPOs, Reviews, Performance highlights, Subscription status
   - Navigation cards to 4 dedicated Mainboard pages
   - Detailed IPO listing table with minimize/maximize toggle
   - Column-level search, year navigation, sortable columns
   - Accessible by clicking "Mainboard IPOs" in navigation

0. **SME IPOs Landing Page** (`/sme-ipos`)
   - Same structure as Mainboard landing page
   - Filters for SME category only
   - Navigation cards to 4 dedicated SME pages
   - Accessible by clicking "SME IPOs" in navigation

**Standalone Pages (Stories 9.4-9.6):**

1. **Rights Issue Page** (`/rights-issues`)
   - Two tabs: "Upcoming" | "Live"
   - Columns: Issuer Company | Record Date | Open Date | Renunciation Date
   - Educational content explaining Rights Issues
   - "More Rights Issues..." link from home page

2. **Offer for Sale (OFS) Page** (`/ofs`)
   - Single table view
   - Columns: Issuer Company | Non Retail Date | Retail Date
   - Educational content explaining OFS
   - Accessible from main navigation

3. **NCD Issue Page** (`/ncd`)
   - Single table view
   - Columns: Issuer Company | Open Date | Close Date
   - Educational content explaining NCDs
   - "More NCD Public Issues..." link from home page

**Mainboard Category Pages (Stories 9.7a, 9.8a, 9.9a, 9.10a):**

4. **Mainboard IPO Performance Tracker** (`/mainboard-ipo-performance-tracker`)
   - Year filter (2025, 2024, etc.)
   - Columns: Company Name | Listed On | Issue Price | Listing Day Close | Listing Day Gain | Current Price | Profit/Loss
   - Color-coded performance metrics (green/red)
   - Expandable IPO Detail and Stock Quotes links
   - Shows only Mainboard IPOs
   - Accessible from Mainboard IPOs submenu

5. **Mainboard IPO Prospectus** (`/mainboard-ipo-prospectus`)
   - Column-level search
   - Columns: Company Name | Exchange | DRHP PDF | RHP PDF
   - Sortable columns
   - Direct PDF download links
   - Total records count display
   - Shows only Mainboard IPOs
   - Accessible from Mainboard IPOs submenu

6. **Mainboard IPO Calendar** (`/mainboard-ipo-calendar`)
   - Monthly calendar grid view
   - Month navigation (Previous << Current >> Next)
   - Events: Opens, Closes, Allotment Status, Lists
   - Color-coded days (yellow for multiple events)
   - Holiday markers
   - Search functionality
   - Shows only Mainboard IPO events
   - Accessible from Mainboard IPOs submenu

7. **Mainboard IPO Reviews** (`/mainboard-ipo-reviews`)
   - Columns: # | Review Title | Author | Recommendation | IPO
   - Year navigation (Previous << Current >> Next)
   - Column-level search (Review Title, Author, Recommendation, IPO)
   - Total records count display
   - Educational header explaining IPO reviews
   - Sortable columns
   - Review title links to detailed review pages
   - Shows only Mainboard IPO reviews
   - Accessible from Mainboard IPOs submenu

**SME Category Pages (Stories 9.11, 9.12, 9.13, 9.14):**

8. **SME IPO Performance Tracker** (`/sme-ipo-performance-tracker`)
   - Same structure as Mainboard Performance Tracker
   - Shows only SME IPOs
   - Accessible from SME IPOs submenu

9. **SME IPO Prospectus** (`/sme-ipo-prospectus`)
   - Same structure as Mainboard Prospectus
   - Shows only SME IPOs
   - Accessible from SME IPOs submenu

10. **SME IPO Calendar** (`/sme-ipo-calendar`)
    - Same structure as Mainboard Calendar
    - Shows only SME IPO events
    - Accessible from SME IPOs submenu

11. **SME IPO Reviews** (`/sme-ipo-reviews`)
    - Same structure as Mainboard Reviews
    - Shows only SME IPO reviews
    - Accessible from SME IPOs submenu

**Navigation Structure:**
```
Main Navigation:
├── Mainboard IPOs → /mainboard-ipos (clickable + dropdown on hover)
│   ├── Mainboard IPO Performance Tracker → /mainboard-ipo-performance-tracker
│   ├── Mainboard IPO Prospectus → /mainboard-ipo-prospectus
│   ├── Mainboard IPO Calendar → /mainboard-ipo-calendar
│   └── Mainboard IPO Reviews → /mainboard-ipo-reviews
│
├── SME IPOs → /sme-ipos (clickable + dropdown on hover)
│   ├── SME IPO Performance Tracker → /sme-ipo-performance-tracker
│   ├── SME IPO Prospectus → /sme-ipo-prospectus
│   ├── SME IPO Calendar → /sme-ipo-calendar
│   └── SME IPO Reviews → /sme-ipo-reviews
│
├── Rights Issues → /rights-issues (standalone)
├── OFS → /ofs (standalone)
└── NCD → /ncd (standalone)
```

**Technical Approach:**
- Each page follows existing dashboard patterns
- Server-side rendering with ISR (5-minute revalidation)
- Use existing `/api/ipos` endpoint with category filters (category=MAINBOARD or category=SME)
- Responsive design: tables on desktop, cards on mobile
- May require schema enhancements for Rights and OFS dates
- NO tabs on category-specific pages - each page shows only its category data
- URLs follow SEO-optimized naming: `/mainboard-ipo-[feature]` and `/sme-ipo-[feature]`

**Success criteria:**
- All 13 dedicated pages accessible and functional
- Landing pages (Mainboard IPOs, SME IPOs) display:
  - Summary metrics dashboard with 6 cards
  - Content sections in card/grid layout (6 sections each)
  - Navigation cards to dedicated pages (4 cards each)
  - Detailed table with minimize/maximize toggle
- Each page displays correct filtered data for its category (Mainboard or SME)
- Educational banners explain issue types clearly (Rights, OFS, NCD, Reviews, Landing pages)
- Performance tracker displays accurate calculations for respective category
- Year filter works correctly on performance tracker, reviews pages, and landing page tables
- Prospectus pages provide PDF download access for respective category
- Calendar pages visualize IPO events in monthly grid for respective category
- Reviews pages provide expert analysis and recommendations for respective category
- NO tabs on category-specific pages - clean, focused experience
- Navigation menu items (Mainboard IPOs, SME IPOs) are both clickable AND have dropdown on hover
- Navigation dropdowns work correctly (Mainboard IPOs and SME IPOs submenus)
- All pages are fully responsive
- Performance targets met (LCP < 2s, CLS < 0.1)

## Stories

### Story 9.1: Data Layer & API Integration for Home Page IPO Tables

**Description:** Create or enhance data fetching utilities to support the four IPO table categories on the home page. This includes creating specialized query functions that fetch filtered IPO data for each table category and implementing server-side data fetching with proper caching.

**Key Work:**
- Create `lib/services/home-ipo-service.ts` with four functions:
  - `getMainboardIPOs()` - fetch active mainboard IPOs (status: OPEN, CLOSED last 30 days)
  - `getSMEIPOs()` - fetch active SME IPOs (status: OPEN, CLOSED last 30 days)
  - `getUpcomingMainboardIPOs()` - fetch upcoming mainboard IPOs (status: UPCOMING)
  - `getUpcomingSMEIPOs()` - fetch upcoming SME IPOs (status: UPCOMING)
- Each function uses existing `/api/ipos` endpoint with appropriate filters
- Implement proper TypeScript types for table data
- Add Redis caching with 5-minute TTL for each category
- Handle errors gracefully with fallback empty arrays

**Acceptance Criteria:**
1. Four data fetching functions return properly typed IPO data
2. Each function fetches correct category and status combinations
3. Results are limited to 10 items per table
4. Data is cached in Redis with proper cache keys
5. Functions handle API errors without throwing
6. All existing API functionality continues to work unchanged

### Story 9.2: IPO Table Components with Styling

**Description:** Build four reusable table components matching the reference design with color-coding, responsive layout, and navigation links. Components should follow existing UI patterns and be fully accessible.

**Key Work:**
- Create `components/home/IPOListTable.tsx` - Main table component (columns: Company | Open | Close)
- Create `components/home/UpcomingIPOTable.tsx` - Upcoming table (columns: Company | Status | Date)
- Create `components/home/HomeIPOTablesSection.tsx` - Section wrapper with 2x2 grid layout
- Implement color-coding logic:
  - Green background: IPO currently open (today between openDate and closeDate)
  - Yellow background: IPO closing within 2 days (closeDate within 2 days from today)
  - White/default: All other IPOs
- Add "More..." links that navigate to dashboard with category filters:
  - "More Mainline IPO..." → `/dashboard?category=mainboard`
  - "More SME IPO..." → `/dashboard?category=sme`
  - "More Upcoming Mainline IPO..." → `/dashboard?category=mainboard&status=upcoming`
  - "More Upcoming SME IPO..." → `/dashboard?category=sme&status=upcoming`
- Ensure responsive design: 2-column on desktop, single column on mobile
- Use existing `components/ui/table.tsx` and Tailwind CSS
- Add loading skeletons for each table
- Ensure proper semantic HTML and ARIA labels

**Acceptance Criteria:**
1. Four distinct table components render correctly with proper data
2. Color-coding works based on date logic (green=open, yellow=closing soon, white=default)
3. Tables are responsive and match reference design
4. "More..." links navigate to dashboard with correct filters:
   - "More Mainline IPO..." → `/dashboard?category=mainboard`
   - "More SME IPO..." → `/dashboard?category=sme`
   - "More Upcoming Mainline IPO..." → `/dashboard?category=mainboard&status=upcoming`
   - "More Upcoming SME IPO..." → `/dashboard?category=sme&status=upcoming`
5. Tables follow existing design system and patterns
6. Loading states display properly
7. Accessibility: Tables have proper ARIA labels and semantic markup
8. Empty states handled gracefully with "No IPOs available" message

### Story 9.3: Home Page Integration & Deployment

**Description:** Integrate the IPO tables section into the home page above the "Everything You Need for IPO Investments" section. Implement server-side data fetching with proper SEO optimization and performance best practices.

**Key Work:**
- Modify `web/app/page.tsx`:
  - Import and use home IPO data service functions
  - Fetch all four table datasets on server-side
  - Insert `<HomeIPOTablesSection>` component above Features section (before line 62)
  - Add proper error boundaries
- Implement static generation with ISR (Incremental Static Regeneration):
  - Set `revalidate` to 300 seconds (5 minutes)
- Add structured data for SEO (IPO listings)
- Ensure no layout shift during load (reserve space)
- Test performance:
  - LCP < 2 seconds
  - CLS < 0.1
  - TTI < 3 seconds
- Update any relevant tests

**Acceptance Criteria:**
1. Home page displays all 4 IPO tables above "Everything You Need for IPO Investments" heading
2. Tables are populated with live IPO data on page load
3. Page uses ISR with 5-minute revalidation
4. No console errors or warnings
5. Existing home page functionality (Hero, Features, CTA) remains unchanged
6. Performance metrics meet targets (LCP < 2s, CLS < 0.1, TTI < 3s)
7. Page renders correctly on mobile, tablet, and desktop
8. SEO: Structured data includes IPO listings
9. Existing tests pass, new integration tests added for table section

---

### Story 9.4: Rights Issue Page

**Description:** Create a dedicated page for Rights Issues with tabbed navigation (Upcoming/Live), filterable table, and comprehensive issue details including Record Date, Open Date, and Renunciation Date.

**Key Work:**
- Create `app/rights-issues/page.tsx` - Rights Issue dedicated page
- Create `components/rights/RightsIssueTable.tsx` - Table component with 4 columns (Issuer Company, Record, Open, Renunciation)
- Create `components/rights/RightsIssueTabs.tsx` - Tab component for Upcoming/Live filtering
- Implement data fetching service:
  - `lib/services/rights-service.ts` with `getRightsIssues(status: 'upcoming' | 'live')`
  - Fetch from `/api/ipos?category=RIGHTS&status={UPCOMING|OPEN}`
- Add "More Rights Issues..." link navigation from home page tables
- Implement routing: `/rights-issues`
- Use ISR with 5-minute revalidation
- Add metadata for SEO (title, description, keywords)
- Responsive design: table on desktop, cards on mobile

**Technical Notes:**
- Rights Issues are stored in the same `ipos` table with `category = 'RIGHTS'`
- Record Date, Renunciation Date might need new fields in schema (check existing schema first)
- If fields don't exist, use `closeDate` for now and add schema migration later
- Tab state managed with URL query params: `/rights-issues?tab=live`

**Acceptance Criteria:**
1. Rights Issue page accessible at `/rights-issues`
2. Two tabs: "Upcoming" and "Live" with proper filtering
3. Table displays: Issuer Company, Record Date, Open Date, Renunciation Date
4. Tab state persists in URL query params
5. "More Rights Issues..." link from home page navigates correctly
6. Page uses ISR with 5-minute revalidation
7. Responsive: table on desktop, cards on mobile
8. Empty state shows "No rights issues available" message
9. Loading skeleton displays during data fetch
10. SEO metadata configured (title, description, structured data)

---

### Story 9.5: Offer for Sale (OFS) Page

**Description:** Create a dedicated page for Offer for Sale (OFS) issues with a table showing Non-Retail and Retail dates, targeting institutional and retail investors separately.

**Key Work:**
- Create `app/ofs/page.tsx` - OFS dedicated page
- Create `components/ofs/OFSTable.tsx` - Table component with 3 columns (Issuer Company, Non Retail Date, Retail Date)
- Implement data fetching service:
  - `lib/services/ofs-service.ts` with `getOFSIssues()`
  - Fetch from `/api/ipos?category=OFS` (may need to add OFS category to schema)
- Add navigation from header/menu: "OFS" link
- Implement routing: `/ofs`
- Use ISR with 5-minute revalidation
- Add metadata for SEO
- Responsive design: table on desktop, cards on mobile
- Educational banner: "What is OFS?" with brief explanation

**Technical Notes:**
- OFS might not exist in current schema - check `ipoCategoryEnum` in schema
- If OFS not in enum, add to schema:
  - Update `ipoCategoryEnum` to include 'OFS'
  - Run migration
- Non-Retail Date and Retail Date need to be mapped:
  - Non-Retail Date → `openDate` (institutional investors)
  - Retail Date → custom field or use `closeDate`
- Consider adding `nonRetailDate` and `retailDate` fields to schema

**Acceptance Criteria:**
1. OFS page accessible at `/ofs`
2. Table displays: Issuer Company, Non Retail Date, Retail Date
3. Page fetches OFS category IPOs correctly
4. Educational banner explains OFS concept
5. Page uses ISR with 5-minute revalidation
6. Responsive: table on desktop, cards on mobile
7. Empty state shows "No OFS available" message
8. Loading skeleton displays during data fetch
9. SEO metadata configured
10. Navigation link added to header/menu

---

### Story 9.6: NCD Issue Page

**Description:** Create a dedicated page for Non-Convertible Debentures (NCD) issues with a table showing issue dates and company details, targeting fixed-income investors.

**Key Work:**
- Create `app/ncd/page.tsx` - NCD dedicated page
- Create `components/ncd/NCDTable.tsx` - Table component with 3 columns (Issuer Company, Open, Close)
- Implement data fetching service:
  - `lib/services/ncd-service.ts` with `getNCDIssues()`
  - Fetch from `/api/ipos?category=NCD`
- Add "More NCD Public Issues..." link navigation from home page
- Implement routing: `/ncd`
- Use ISR with 5-minute revalidation
- Add metadata for SEO
- Responsive design: table on desktop, cards on mobile
- Educational banner: "What are NCDs?" with brief explanation
- Sort by Open Date (descending - newest first)

**Technical Notes:**
- NCD category already exists in schema (`ipoCategoryEnum` includes 'NCD')
- NCD issues use standard `openDate` and `closeDate` fields
- NCDs are debt instruments, not equity - consider adding badge/indicator
- Interest rate information might be relevant (consider adding to detail view later)

**Acceptance Criteria:**
1. NCD page accessible at `/ncd`
2. Table displays: Issuer Company, Open Date, Close Date
3. Page fetches NCD category IPOs correctly
4. Educational banner explains NCD concept
5. "More NCD Public Issues..." link from home page navigates correctly
6. Page uses ISR with 5-minute revalidation
7. Responsive: table on desktop, cards on mobile
8. NCDs sorted by Open Date (descending)
9. Empty state shows "No NCDs available" message
10. Loading skeleton displays during data fetch
11. SEO metadata configured

---

### Story 9.7a: Mainboard IPO Performance Tracker Page

**Description:** Create a comprehensive Mainboard IPO Performance Tracker page that shows post-listing performance of Mainboard IPOs with listing day gains and current profit/loss percentages. This page helps investors track how Mainboard IPOs have performed since listing and make informed investment decisions.

**Key Work:**
- Create `app/mainboard-ipo-performance-tracker/page.tsx` - Mainboard performance tracker page
- Create `components/performance/MainboardPerformanceTrackerTable.tsx` - Table component with 7 columns:
  1. Company Name (with expandable IPO Detail and Stock Quotes links)
  2. Listed On (listing date)
  3. Issue Price (₹)
  4. Listing Day Close (₹)
  5. Listing Day Gain (%) - color-coded
  6. Current Price (₹)
  7. Profit/Loss (%) - color-coded from issue price
- Create `components/performance/YearFilter.tsx` - Year selector component
- Implement data fetching service:
  - `lib/services/mainboard-performance-service.ts` with `getMainboardIPOPerformance(year?: number)`
  - Fetch IPOs with status=LISTED and category=MAINBOARD
  - Join with `listingPerformance` table for listing day data
  - Calculate current profit/loss: `((currentPrice - issuePrice) / issuePrice) * 100`
- Implement routing: `/mainboard-ipo-performance-tracker`
- Year filter functionality:
  - Default to current year (2025)
  - Previous years accessible via year selector
  - URL query params: `/mainboard-ipo-performance-tracker?year=2024`
  - Filters only Mainboard IPOs (category=MAINBOARD)
- Color coding:
  - Green text: Positive gains/profits
  - Red text: Negative losses
- Expandable links for each IPO:
  - "IPO Detail" → links to `/ipos/[slug]`
  - "Stock Quotes" → links to external stock quote page or internal charts
- Use ISR with 5-minute revalidation
- Add metadata for SEO
- Responsive design: table on desktop, cards/list on mobile

**Technical Notes:**
- Requires `listingPerformance` table with fields:
  - `listingClose` (closing price on listing day)
  - `listingOpen` (optional)
  - `listingHigh`, `listingLow` (optional)
- Current Price needs to be fetched:
  - Option 1: Add `currentPrice` field to `listingPerformance` table (updated by scraper)
  - Option 2: Fetch from external API in real-time (performance concern)
  - **Recommended:** Use cached current price updated every 5-15 minutes
- Issue Price comes from IPO table: `priceRangeMax` or dedicated `issuePrice` field
- Listing Day Gain calculation: `((listingClose - issuePrice) / issuePrice) * 100`
- Profit/Loss calculation: `((currentPrice - issuePrice) / issuePrice) * 100`
- Year filter based on `listingDate` year
- Sort by Listed On date (descending - newest first)

**Data Requirements:**
- Check if `listingPerformance` table exists and has required fields
- May need to add `currentPrice` and `lastUpdated` fields to track real-time prices
- Consider adding `issuePrice` field to `ipos` table for clarity (currently using `priceRangeMax`)

**Acceptance Criteria:**
1. Mainboard Performance tracker page accessible at `/mainboard-ipo-performance-tracker`
2. Table displays all 7 columns with correct Mainboard IPO data only
3. Year filter works correctly (default: current year)
4. Year filter updates URL query params
5. Only Mainboard IPOs displayed (category=MAINBOARD filter applied)
6. Color coding applied correctly:
   - Green for positive percentages
   - Red for negative percentages
7. "IPO Detail" links navigate to respective IPO detail pages
8. "Stock Quotes" links functional (external or internal)
9. Calculations are accurate:
   - Listing Day Gain = ((listingClose - issuePrice) / issuePrice) × 100
   - Profit/Loss = ((currentPrice - issuePrice) / issuePrice) × 100
10. IPOs sorted by listing date (descending)
11. Page uses ISR with 5-minute revalidation
12. Responsive: table on desktop, compact cards on mobile
13. Empty state shows "No Mainboard IPOs listed in [year]" message
14. Loading skeleton displays during data fetch
15. SEO metadata configured (title, description, keywords)
16. Navigation link added to "Mainboard IPOs" submenu
17. Performance data displays with 2 decimal precision for percentages
18. Rupee symbol (₹) displayed correctly for prices

---

### Story 9.8a: Mainboard IPO Prospectus PDF Download Page

**Description:** Create a comprehensive Mainboard IPO Prospectus PDF download page that provides access to Draft Red Herring Prospectus (DRHP) and Red Herring Prospectus (RHP) documents for Mainboard IPOs. This page helps investors access official Mainboard IPO documents for due diligence and research.

**Key Work:**
- Create `app/mainboard-ipo-prospectus/page.tsx` - Mainboard prospectus download page
- Create `components/prospectus/MainboardProspectusTable.tsx` - Table component with 4 columns:
  1. Company Name (clickable link to IPO detail page, searchable)
  2. Exchange (BSE, NSE, or both - searchable)
  3. DRHP PDF (Draft Red Herring Prospectus download link)
  4. RHP PDF (Red Herring Prospectus download link)
- Create `components/prospectus/ColumnSearch.tsx` - Individual column search component
- Implement data fetching service:
  - `lib/services/mainboard-prospectus-service.ts` with `getMainboardProspectusDocuments(filters?: ProspectusFilters)`
  - Fetch from `documents` table joined with `ipos` table
  - Filter by document type (DRHP, RHP) and category=MAINBOARD
  - Support company name and exchange filtering
- Implement routing: `/mainboard-ipo-prospectus`
- Column-level search functionality:
  - Search by company name (fuzzy search)
  - Filter by exchange (dropdown: All, BSE, NSE, Both)
  - Real-time filtering without page reload
- Sortable columns:
  - Company Name (alphabetical)
  - Exchange (alphabetical)
  - Default sort: Company Name A-Z
- PDF download links:
  - Direct download links for DRHP and RHP PDFs
  - External link icon indicator
  - Links open in new tab
- Total records count display
- Use ISR with 10-minute revalidation (documents change less frequently)
- Add metadata for SEO
- Responsive design: table on desktop, cards/list on mobile
- Pagination: 50 records per page

**Technical Notes:**
- Requires `documents` table with fields:
  - `documentType` (enum: DRHP, RHP, etc.)
  - `documentUrl` (URL to PDF file)
  - `ipoId` (foreign key to ipos table)
- Company name links to `/ipos/[slug]`
- PDF links stored in `documents.documentUrl`
- Search uses PostgreSQL full-text search or fuzzy matching
- Exchange filter based on `ipos.listingExchanges` field (JSONB array)
- Consider adding download tracking (optional for MVP)
- PDFs may be hosted externally (SEBI website) or internally

**Data Requirements:**
- Check if `documents` table exists and has DRHP/RHP document types
- May need to populate `documents` table with PDF URLs (manual or via scraper)
- Verify `ipos.listingExchanges` field exists for exchange filtering

**Acceptance Criteria:**
1. Mainboard Prospectus page accessible at `/mainboard-ipo-prospectus`
2. Table displays all 4 columns with correct Mainboard IPO data only
3. Total records count displays (e.g., "Total Records: 847")
4. Column-level search boxes functional:
   - Company Name search filters results
   - Exchange filter works (All, BSE, NSE, Both)
5. Sortable columns work correctly (Company Name, Exchange)
6. Company name links navigate to respective IPO detail pages
7. DRHP and RHP PDF links are functional:
   - Links open in new tab (`target="_blank"`)
   - External link icon displayed
   - Download attribute set for direct download
8. Search results update in real-time (debounced 300ms)
9. Empty state shows "No Mainboard prospectus documents available" message
10. Loading skeleton displays during data fetch
11. Page uses ISR with 10-minute revalidation
12. Responsive: table on desktop, cards/list on mobile
13. Pagination works correctly (50 records per page)
14. SEO metadata configured (title, description, keywords)
15. Navigation link added to "Mainboard IPOs" submenu
16. Only Mainboard IPOs displayed (filter: category=MAINBOARD)
17. PDF download links handle missing documents gracefully (show "-" or "Not Available")

---

### Story 9.9a: Mainboard IPO Calendar Page

**Description:** Create an interactive Mainboard IPO Calendar page with monthly grid view showing Mainboard IPO-related events (open dates, close dates, allotment status, listing dates). This page helps investors visualize Mainboard IPO schedules and plan their applications with a clear timeline view.

**Key Work:**
- Create `app/mainboard-ipo-calendar/page.tsx` - Mainboard IPO Calendar page
- Create `components/calendar/MainboardIPOCalendarGrid.tsx` - Monthly calendar grid component
- Create `components/calendar/CalendarEvent.tsx` - Individual event card component (reusable)
- Create `components/calendar/MonthNavigation.tsx` - Previous/Next month navigation (reusable)
- Create `components/calendar/EventSearch.tsx` - Event search functionality (reusable)
- Implement data fetching service:
  - `lib/services/mainboard-calendar-service.ts` with `getMainboardIPOEvents(month: number, year: number)`
  - Fetch only Mainboard IPOs (category=MAINBOARD)
  - Aggregate IPO events by date:
    - Open Date → "IPO Opens on [date]"
    - Close Date → "IPO Closes on [date]"
    - Allotment Date → "IPO Allotment Status"
    - Listing Date → "IPO Lists on [date]"
  - Include market holidays from `marketHolidays` table
- Implement routing: `/mainboard-ipo-calendar`
- Calendar features:
  - Monthly grid view (Sunday - Saturday)
  - Month/Year navigation (Previous << Current >> Next)
  - Default: Current month view
  - URL query params: `/mainboard-ipo-calendar?month=10&year=2025`
  - NO tabs - shows only Mainboard IPO events
- Event display:
  - Calendar icon (📅) for each event
  - Company name clickable → links to `/ipos/[slug]`
  - Event type description
  - Multiple events per day displayed in cell
- Color coding:
  - White cells: Regular days with 0-1 events
  - Yellow/highlighted cells: Days with 2+ events
  - Holiday cells: Marked with "Holiday - [name]"
- Search functionality:
  - Search by company name (filters events in calendar)
  - "Search" and "Clear Search" buttons
- Descriptive header text explaining the calendar
- Use ISR with 5-minute revalidation
- Add metadata for SEO
- Responsive design: calendar on desktop, list view on mobile

**Technical Notes:**
- Calendar grid: 7 columns × 5-6 rows (depending on month)
- Events aggregation logic:
  - Query all IPOs for the month
  - Group by date (openDate, closeDate, allotmentDate, listingDate)
  - Flatten into event list per day
- Date calculations:
  - Use `date-fns` for date manipulation
  - Calculate first day of month (to determine grid start)
  - Calculate days in month
  - Handle month boundaries (previous/next month dates in gray)
- Holiday integration:
  - Fetch from `marketHolidays` table
  - Display holiday events in calendar cells
- Consider using a calendar library (e.g., `react-calendar`) or build custom
- Event search:
  - Client-side filtering for performance
  - Filter events by company name match

**Data Requirements:**
- IPO data with all relevant dates (openDate, closeDate, allotmentDate, listingDate)
- Market holidays from `marketHolidays` table
- Efficient query to fetch IPOs for a specific month/year range

**Acceptance Criteria:**
1. Mainboard IPO Calendar page accessible at `/mainboard-ipo-calendar`
2. Monthly calendar grid displays correctly:
   - 7 columns (Sunday - Saturday)
   - Correct number of days for the month
   - Days of week header row (green background)
3. Month navigation works:
   - Previous month button functional
   - Next month button functional
   - URL updates with month/year query params
4. Only Mainboard IPO events displayed (category=MAINBOARD filter applied)
5. NO tabs - clean single-purpose page
6. Events display correctly:
   - Calendar icon (📅) shown
   - Company name displayed
   - Event type shown (Opens, Closes, Allotment Status, Lists)
   - Multiple events per day displayed
7. Event links navigate to respective IPO detail pages
8. Color coding applied:
   - Days with 2+ events highlighted (yellow background)
   - Regular days have white background
9. Holidays displayed correctly:
   - "Holiday - [name]" shown in calendar cell
10. Search functionality works:
    - Search box filters events by company name
    - "Clear Search" button resets filter
11. Descriptive header text explains the Mainboard IPO calendar
12. Page uses ISR with 5-minute revalidation
13. Responsive: calendar grid on desktop, list view on mobile
14. Empty state shows "No Mainboard IPO events in [month] [year]" message
15. Loading skeleton displays during data fetch
16. SEO metadata configured (title, description, keywords)
17. Navigation link added to "Mainboard IPOs" submenu
18. Default view shows current month
19. Performance: Calendar renders smoothly even with 20+ events per day

---

### Story 9.10a: Mainboard IPO Reviews & Analysis Page

**Description:** Create a comprehensive Mainboard IPO Reviews and Analysis page that provides access to expert Mainboard IPO reviews, analysis reports, and investment recommendations from SEBI registered analysts. This page helps investors make informed decisions by providing detailed Mainboard IPO analysis, company background, valuation, financial performance, risks & benefits, and expert recommendations.

**Key Work:**
- Create `app/mainboard-ipo-reviews/page.tsx` - Mainboard IPO Reviews page
- Create `components/reviews/MainboardIPOReviewsTable.tsx` - Table component with 5 columns:
  1. # (Row number/serial number)
  2. Review Title (clickable link to review detail page)
  3. Author (analyst/firm name)
  4. Recommendation (e.g., "May apply", "Subscribe", "Avoid")
  5. IPO (IPO company name, clickable link)
- Create `components/reviews/YearNavigation.tsx` - Year navigation component (Previous/Current/Next) - reusable
- Create `components/reviews/ColumnSearch.tsx` - Individual column search component - reusable
- Create `components/reviews/ReviewsHeader.tsx` - Educational header explaining IPO reviews - reusable
- Implement data fetching service:
  - `lib/services/mainboard-reviews-service.ts` with `getMainboardIPOReviews(year: number, filters?: ReviewFilters)`
  - Fetch from `ipoReviews` table joined with `ipos` table
  - Filter by category=MAINBOARD
  - Support filtering by year, author, recommendation
- Implement routing: `/mainboard-ipo-reviews`
- URL query params: `/mainboard-ipo-reviews?year=2025`
- NO tabs - shows only Mainboard IPO reviews
- Year navigation:
  - Previous year button ("<< Year 2024")
  - Current year display ("2025")
  - Next year button ("Year 2026 >>")
  - URL updates with year query param
- Column-level search functionality:
  - Search by Review Title (fuzzy search)
  - Search by Author name (dropdown or autocomplete)
  - Search by Recommendation (dropdown: All, May apply, Subscribe, Avoid, etc.)
  - Search by IPO company name (fuzzy search)
  - Real-time filtering without page reload
- Sortable columns:
  - Review Title (alphabetical)
  - Author (alphabetical)
  - Recommendation (alphabetical)
  - IPO (alphabetical)
  - Default sort: Most recent reviews first
- Total records count display (e.g., "Total Records: 748")
- Review title links:
  - Navigate to individual review detail page: `/ipo-reviews/[reviewId]`
  - Review detail page shows full analysis, recommendations, company details
- IPO links:
  - Navigate to respective IPO detail page: `/ipos/[slug]`
- Educational header:
  - Explains what IPO reviews are
  - Highlights benefits: "IPO forecast helps investors decide if the IPO is worth investing in"
  - Mentions content: "company background, offer detail, company valuation, capital structure, financial performance, strength, risks & benefits, peer comparison"
  - Target audience: "both short and long-term investors"
- Use ISR with 10-minute revalidation (reviews change less frequently)
- Add metadata for SEO
- Responsive design: table on desktop, cards/list on mobile
- Pagination: 50 records per page

**Technical Notes:**
- Requires `ipoReviews` table with fields:
  - `id` (primary key)
  - `reviewTitle` (string)
  - `reviewUrl` or `reviewContent` (text or URL to full review)
  - `author` (analyst/firm name)
  - `recommendation` (enum: "May apply", "Subscribe", "Avoid", "Not Recommended", etc.)
  - `ipoId` (foreign key to ipos table)
  - `publishedDate` (date)
  - `year` (integer, indexed for faster queries)
  - `category` (MAINBOARD, SME - derived from IPO or stored)
- Review detail page (`/ipo-reviews/[reviewId]`):
  - Full review content with sections:
    - Company Background
    - Offer Details
    - Company Valuation
    - Capital Structure
    - Financial Performance
    - Strengths & Risks
    - Peer Comparison
    - Analyst Recommendation
  - Can be implemented as separate story if needed
- Search uses PostgreSQL full-text search or fuzzy matching
- Author filter based on unique authors in database
- Recommendation values standardized across all reviews
- Consider adding rating system (stars) for reviews
- Consider adding "Featured Reviews" section

**Data Requirements:**
- Check if `ipoReviews` table exists
- May need to create table and populate with review data:
  - Manual entry for MVP
  - Future: Scrape from trusted sources (with permission)
  - Future: Allow analysts to submit reviews
- Verify relationship between reviews and IPOs (foreign key)
- Consider adding `reviewSummary` field for preview in table

**Acceptance Criteria:**
1. Mainboard IPO Reviews page accessible at `/mainboard-ipo-reviews`
2. Table displays all 5 columns with correct Mainboard IPO review data only
3. Total records count displays (e.g., "Total Records: 748")
4. Only Mainboard IPO reviews displayed (category=MAINBOARD filter applied)
5. NO tabs - clean single-purpose page
6. Year navigation works:
   - Previous year button functional ("<< Year 2024")
   - Next year button functional ("Year 2026 >>")
   - Current year displayed in center
   - URL updates with year query param
   - Default: Current year (2025)
7. Column-level search boxes functional:
   - Review Title search filters results (fuzzy)
   - Author search filters results (dropdown or autocomplete)
   - Recommendation search filters results (dropdown)
   - IPO search filters results (fuzzy)
   - All search filters work together (AND logic)
8. Sortable columns work correctly (all 4 data columns)
9. Review title links navigate to review detail pages
10. IPO links navigate to respective IPO detail pages
11. Search results update in real-time (debounced 300ms)
12. Educational header displays with clear explanation:
    - What Mainboard IPO reviews are
    - Benefits for investors
    - Content covered in reviews
13. Empty state shows "No Mainboard IPO reviews available for [year]" message
14. Loading skeleton displays during data fetch
15. Page uses ISR with 10-minute revalidation
16. Responsive: table on desktop, cards/list on mobile
17. Pagination works correctly (50 records per page)
18. SEO metadata configured (title, description, keywords)
19. Navigation link added to "Mainboard IPOs" submenu
20. Row numbers display correctly (#1, #2, etc.)
21. Reviews sorted by published date (descending - newest first)

---

### Story 9.11: SME IPO Performance Tracker Page

**Description:** Create an SME IPO Performance Tracker page mirroring the Mainboard version (Story 9.7a) but filtering exclusively for SME IPOs.

**Key Work:**
- Create `app/sme-ipo-performance-tracker/page.tsx`
- Create `components/performance/SMEPerformanceTrackerTable.tsx`
- Reuse: `components/performance/YearFilter.tsx`
- Implement `lib/services/sme-performance-service.ts` with `getSMEIPOPerformance(year?)`
- Filter: status=LISTED AND category=SME
- Routing: `/sme-ipo-performance-tracker`
- All other features identical to Story 9.7a

**Acceptance Criteria:**
1-21. Same as Story 9.7a, with "Mainboard" replaced by "SME" and URL `/sme-ipo-performance-tracker`
- Navigation link in "SME IPOs" submenu
- Empty state: "No SME IPOs listed in [year]"

---

### Story 9.12: SME IPO Prospectus PDF Download Page

**Description:** Create an SME IPO Prospectus page mirroring the Mainboard version (Story 9.8a) but filtering exclusively for SME IPOs.

**Key Work:**
- Create `app/sme-ipo-prospectus/page.tsx`
- Create `components/prospectus/SMEProspectusTable.tsx`
- Reuse: `components/prospectus/ColumnSearch.tsx`
- Implement `lib/services/sme-prospectus-service.ts` with `getSMEProspectusDocuments(filters?)`
- Filter: category=SME
- Routing: `/sme-ipo-prospectus`
- All other features identical to Story 9.8a

**Acceptance Criteria:**
1-17. Same as Story 9.8a, with "Mainboard" replaced by "SME" and URL `/sme-ipo-prospectus`
- Navigation link in "SME IPOs" submenu
- Empty state: "No SME prospectus documents available"

---

### Story 9.13: SME IPO Calendar Page

**Description:** Create an SME IPO Calendar page mirroring the Mainboard version (Story 9.9a) but filtering exclusively for SME IPOs.

**Key Work:**
- Create `app/sme-ipo-calendar/page.tsx`
- Create `components/calendar/SMEIPOCalendarGrid.tsx`
- Reuse: `components/calendar/CalendarEvent.tsx`, `MonthNavigation.tsx`, `EventSearch.tsx`
- Implement `lib/services/sme-calendar-service.ts` with `getSMEIPOEvents(month, year)`
- Filter: category=SME
- Routing: `/sme-ipo-calendar`
- All other features identical to Story 9.9a

**Acceptance Criteria:**
1-19. Same as Story 9.9a, with "Mainboard" replaced by "SME" and URL `/sme-ipo-calendar`
- Navigation link in "SME IPOs" submenu
- Empty state: "No SME IPO events in [month] [year]"
- Header text: "SME IPO calendar"

---

### Story 9.14: SME IPO Reviews & Analysis Page

**Description:** Create an SME IPO Reviews page mirroring the Mainboard version (Story 9.10a) but filtering exclusively for SME IPOs.

**Key Work:**
- Create `app/sme-ipo-reviews/page.tsx`
- Create `components/reviews/SMEIPOReviewsTable.tsx`
- Reuse: `components/reviews/YearNavigation.tsx`, `ColumnSearch.tsx`, `ReviewsHeader.tsx`
- Implement `lib/services/sme-reviews-service.ts` with `getSMEIPOReviews(year, filters?)`
- Filter: category=SME
- Routing: `/sme-ipo-reviews`
- All other features identical to Story 9.10a

**Acceptance Criteria:**
1-21. Same as Story 9.10a, with "Mainboard" replaced by "SME" and URL `/sme-ipo-reviews`
- Navigation link in "SME IPOs" submenu
- Empty state: "No SME IPO reviews available for [year]"
- Header text: "What SME IPO reviews are"

---

### Story 9.15: Mainboard IPOs Landing Page

**Description:** Create a comprehensive Mainboard IPOs landing page that serves as the central hub for all Mainboard IPO information. This page combines summary metrics, content sections in card/grid layout, navigation to dedicated pages, and a detailed IPO listing table.

**Key Work:**
- Create `app/mainboard-ipos/page.tsx` - Mainboard IPOs landing page
- Create `components/mainboard/MainboardSummaryMetrics.tsx` - 6 metric cards component:
  1. Total Mainboard IPOs
  2. IPOs Listed in Gain
  3. IPOs Listed in Loss
  4. Upcoming & OnGoing IPOs
  5. IPOs in Gain (AOT)
  6. IPOs in Loss (AOT)
- Create `components/mainboard/MainboardContentSections.tsx` - Card/grid layout for 6 sections:
  1. Current IPOs (card/grid)
  2. Upcoming IPOs (card/grid)
  3. Recently Listed IPOs (card/grid)
  4. Reviews (card/grid)
  5. Performance highlights - top gainers/losers (card/grid)
  6. Subscription status (card/grid)
- Create `components/mainboard/MainboardNavigationCards.tsx` - 4 navigation cards linking to:
  1. Mainboard IPO Performance Tracker (`/mainboard-ipo-performance-tracker`)
  2. Mainboard IPO Prospectus (`/mainboard-ipo-prospectus`)
  3. Mainboard IPO Calendar (`/mainboard-ipo-calendar`)
  4. Mainboard IPO Reviews (`/mainboard-ipo-reviews`)
- Create `components/mainboard/MainboardDetailedTable.tsx` - Full IPO listing table with:
  - Columns: Company, Opening Date, Closing Date, Listing Date, Issue Price, Total Issue Amount (incl.firm reservations), Listing at, Lead Manager, Compare
  - Minimize/Maximize toggle functionality
  - Column-level search (search boxes below each column header)
  - Year navigation (<<Year 2024, 2025, Year 2026>>)
  - Status indicators (Issue open, Issue close but not listed, Listing today)
  - Sortable columns
  - Total records count display
  - Color-coded rows (green for current, yellow for closing soon)
- Implement data fetching service:
  - `lib/services/mainboard-landing-service.ts` with functions:
    - `getMainboardSummaryMetrics()` - Calculate 6 metrics
    - `getMainboardCurrentIPOs()` - Fetch current IPOs
    - `getMainboardUpcomingIPOs()` - Fetch upcoming IPOs
    - `getMainboardRecentlyListedIPOs()` - Fetch recently listed IPOs
    - `getMainboardReviews()` - Fetch recent reviews
    - `getMainboardPerformanceHighlights()` - Fetch top gainers/losers
    - `getMainboardSubscriptionStatus()` - Fetch subscription data
    - `getMainboardDetailedList(year?, filters?)` - Fetch full IPO list
  - All functions filter by category=MAINBOARD
- Implement routing: `/mainboard-ipos`
- Educational content header explaining Mainboard IPOs
- Use ISR with 5-minute revalidation
- Add metadata for SEO
- Responsive design: All sections adapt to mobile/tablet/desktop

**Technical Notes:**
- Summary metrics calculated from IPO data:
  - Total: Count of all Mainboard IPOs
  - Listed in Gain: Count where currentPrice > issuePrice
  - Listed in Loss: Count where currentPrice < issuePrice
  - Upcoming & OnGoing: Count where status IN (UPCOMING, OPEN)
  - Gain AOT (All Over Time): Historical gain percentage
  - Loss AOT: Historical loss percentage
- Card/grid sections: Each shows 4-6 items with "View All" link
- Navigation cards: Prominent cards with icons and descriptions
- Detailed table: Collapsible section (default: maximized)
- Minimize/Maximize: Uses state management to toggle table visibility
- Year navigation updates URL query params: `/mainboard-ipos?year=2024`

**Design References:**
- Summary metrics dashboard design: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO MB Summary.png`
- Detailed table design: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO MB List.png`
- Page should match both reference designs

**Data Requirements:**
- IPO data with all fields for detailed table
- Performance data for gainers/losers
- Subscription data (may need new table/fields)
- Reviews data linked to Mainboard IPOs

**Acceptance Criteria:**
1. Mainboard IPOs landing page accessible at `/mainboard-ipos`
2. Navigation menu "Mainboard IPOs" is both clickable (goes to landing page) AND has dropdown on hover
3. Summary metrics section displays all 6 cards with correct calculated values
4. Six content sections displayed in card/grid layout:
   - Current IPOs (4-6 cards)
   - Upcoming IPOs (4-6 cards)
   - Recently Listed IPOs (4-6 cards)
   - Reviews (4-6 cards)
   - Performance highlights (4-6 cards showing top gainers/losers)
   - Subscription status (data cards)
5. Each content section has "View All" or appropriate navigation link
6. Four navigation cards displayed with links to dedicated pages
7. Detailed table section displays with minimize/maximize toggle
8. Detailed table shows all columns: Company, Opening Date, Closing Date, Listing Date, Issue Price, Total Issue Amount, Listing at, Lead Manager, Compare
9. Column-level search boxes functional
10. Year navigation works (<<Year 2024, 2025, Year 2026>>)
11. Year navigation updates URL query params
12. Status indicators displayed (Issue open, Issue close but not listed, Listing today)
13. Sortable columns work correctly
14. Total records count displays
15. Color-coded rows applied (green for current, yellow for closing soon)
16. Only Mainboard IPOs displayed (category=MAINBOARD filter applied throughout)
17. Minimize/maximize toggle works smoothly
18. Educational header explains Mainboard IPOs
19. Page uses ISR with 5-minute revalidation
20. Responsive: All sections adapt properly to mobile/tablet/desktop
21. Loading skeletons display during data fetch
22. SEO metadata configured (title, description, keywords)
23. Navigation link in main menu functions correctly

---

### Story 9.16: SME IPOs Landing Page

**Description:** Create a comprehensive SME IPOs landing page that serves as the central hub for all SME IPO information. This page mirrors the Mainboard landing page structure (Story 9.15) but filters exclusively for SME IPOs.

**Key Work:**
- Create `app/sme-ipos/page.tsx` - SME IPOs landing page
- Create `components/sme/SMESummaryMetrics.tsx` - 6 metric cards (SME-specific)
- Create `components/sme/SMEContentSections.tsx` - Card/grid layout for 6 sections (SME-specific)
- Create `components/sme/SMENavigationCards.tsx` - 4 navigation cards linking to SME pages
- Create `components/sme/SMEDetailedTable.tsx` - Full SME IPO listing table
- Implement `lib/services/sme-landing-service.ts` - Mirror of mainboard-landing-service with category=SME filter
- Implement routing: `/sme-ipos`
- All features identical to Story 9.15, filtered for SME category

**Design References:**
- Summary metrics dashboard design: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO SME Summary.png`
- Detailed table design: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO SME List.png`
- Page should match both reference designs

**Acceptance Criteria:**
1-23. Same as Story 9.15, with "Mainboard" replaced by "SME" and URL `/sme-ipos`
- Educational header explains SME IPOs and SME platform (BSE SME, NSE Emerge)
- Navigation cards link to SME-specific pages:
  - `/sme-ipo-performance-tracker`
  - `/sme-ipo-prospectus`
  - `/sme-ipo-calendar`
  - `/sme-ipo-reviews`
- Page matches reference designs from CG-IPO SME Summary.png and CG-IPO SME List.png

---

### Story 9.17: IPO Listings Pages (Mainboard, SME, FPO)

**Description:** Create three comprehensive IPO Listings pages that display post-listing performance data with extensive metrics including subscription data, GMP, listing performance, and current market prices. These pages serve as detailed performance tracking tables for investors to analyze IPO outcomes across Mainboard, SME, and FPO categories.

**Key Work:**
- Create `app/mainboard-ipo-listings/page.tsx` - Mainboard IPO Listings page
- Create `app/sme-ipo-listings/page.tsx` - SME IPO Listings page
- Create `app/fpo-listings/page.tsx` - FPO Listings page
- Create `components/listings/IPOListingsTable.tsx` - Comprehensive table component with 19 columns:
  1. Company Name (clickable link to `/ipos/[slug]`)
  2. Issue Open Date
  3. Issue Close Date
  4. Listing Date
  5. Issue Price (₹)
  6. Issue Size (Crores)
  7. Lot Size
  8. Subscription - Overall
  9. Subscription - QIB
  10. Subscription - NII
  11. Subscription - Retail
  12. GMP (Grey Market Premium) (₹)
  13. Allotment Date
  14. Listing Day Close Price (₹)
  15. Listing Day Gain/Loss (%)
  16. Current Price at BSE (₹)
  17. Current Price at NSE (₹)
  18. Current Gain/Loss (%)
  19. Market Cap (Crores)
- Create `components/listings/ListingCategoryTabs.tsx` - Tab navigation for cross-page navigation
- Create `components/listings/YearFilter.tsx` - Year dropdown component (2020-2026)
- Create `lib/services/ipo-listings-service.ts` with data fetching functions:
  - `fetchIPOListings(category, year, filters)` - Main data fetching function
  - `fetchAvailableYears()` - Get available years for filter
- Create `app/api/ipos/listings/route.ts` - API endpoint for listings data
- Implement routing:
  - `/mainboard-ipo-listings` - Mainboard category only
  - `/sme-ipo-listings` - SME category only
  - `/fpo-listings` - FPO category only
- Cross-navigation tabs on each page for quick switching between categories
- Year filter (dropdown): 2020, 2021, 2022, 2023, 2024, 2025, 2026 (default: 2025)
- Sortable columns (click column header to sort)
- NO search functionality - clean, simple interface
- Company name links to individual IPO detail page
- Color-coding for gain/loss percentages:
  - Green text: Positive gains
  - Red text: Negative losses
- Use ISR with 5-minute revalidation
- Add metadata for SEO
- Responsive design: horizontal scroll on mobile for wide table

**Design References:**
- Primary design reference: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Listing Date.png`
- Related features (future implementation):
  - Anchor Investors analytics: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Anchor Investors.png`
  - Allotment Status checker: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Allotment Status.png`

**Technical Notes:**
- Data fetched from multiple tables via JOIN:
  - `ipos` table: Company info, dates, issue details
  - `listingPerformance` table: Listing day performance, current prices
  - `subscriptions` table: Latest subscription data (all categories)
  - `gmpRecords` table: Latest GMP data
- Issue Price: Use `priceRangeMax` field from `ipos` table
- Current Price: Use `currentPrice` field from `listingPerformance` table
- Subscription data: Fetch latest snapshot per IPO
- GMP data: Fetch latest record per IPO
- Sorting: Implemented client-side for better UX (data pre-fetched)
- Year filter: Filters based on `listingDate` year
- Category filter: Pre-applied based on route (MAINBOARD, SME, or FPO)
- Pagination: 50 records per page (configurable)
- Performance calculations:
  - Listing Day Gain % = `((listingClose - issuePrice) / issuePrice) × 100`
  - Current Gain % = `((currentPrice - issuePrice) / issuePrice) × 100`

**Data Requirements:**
- `listingPerformance` table with `currentPrice` and `lastUpdated` fields
- Latest `subscriptions` snapshot for each IPO
- Latest `gmpRecords` for each IPO
- All IPOs with status = LISTED
- May need to add FPO as a category to `ipoCategoryEnum` if not exists

**Acceptance Criteria:**
1. Three separate pages accessible:
   - `/mainboard-ipo-listings` - Mainboard IPOs only
   - `/sme-ipo-listings` - SME IPOs only
   - `/fpo-listings` - FPO/Follow-on Public Offers only
2. Each page displays cross-navigation tabs:
   - Tab for Mainboard IPO Listings
   - Tab for SME IPO Listings
   - Tab for FPO Listings
   - Active tab highlighted
   - Clicking tab navigates to respective page
3. Table displays all 19 columns with correct data:
   - All date fields formatted (MMM DD, YYYY)
   - All currency fields show ₹ symbol
   - All percentage fields show % symbol
   - Subscription data shows "x" suffix (e.g., "2.45x")
4. Year dropdown filter works:
   - Shows years 2020-2026
   - Default: 2025 (current year)
   - Changing year filters data and updates URL query param
   - URL format: `/mainboard-ipo-listings?year=2024`
5. Sortable columns functional:
   - Click any column header to sort
   - First click: Descending order
   - Second click: Ascending order
   - Sort icon indicator shows current sort direction
   - Sortable columns: Company Name, Issue Open, Issue Close, Listing Date, Issue Size, Listing Day Gain %, Current Gain %
6. NO search functionality present
7. Company name is clickable:
   - Links to `/ipos/[slug]` (individual IPO detail page)
   - Hover shows underline
   - Opens in same tab
8. Color-coding applied to percentage columns:
   - Positive percentages: Green text, bold
   - Negative percentages: Red text, bold
   - Zero: Default text color
9. Each page filters correctly by category:
   - Mainboard page: category=MAINBOARD only
   - SME page: category=SME only
   - FPO page: category=FPO only
10. Category badge displayed next to company name
11. Page uses ISR with 5-minute revalidation
12. Responsive design:
    - Desktop: Full table visible
    - Mobile: Horizontal scroll enabled for wide table
    - Table remains usable on all screen sizes
13. Empty state handled:
    - "No Mainboard IPO listings found for [year]" (Mainboard page)
    - "No SME IPO listings found for [year]" (SME page)
    - "No FPO listings found for [year]" (FPO page)
14. Loading skeleton displays during data fetch
15. SEO metadata configured:
    - Mainboard: "Mainboard IPO Listings 2025 - Post-Listing Performance & Analysis"
    - SME: "SME IPO Listings 2025 - Post-Listing Performance & Analysis"
    - FPO: "FPO Listings 2025 - Follow-on Public Offer Performance"
16. Pagination works correctly (50 records per page)
17. Total records count displays (e.g., "Showing 1-50 of 147 listings")
18. Performance metrics meet targets:
    - LCP < 2 seconds
    - Table renders smoothly
    - Sorting is instant (client-side)
19. Data accuracy validated:
    - Subscription data matches latest snapshot
    - GMP data matches latest record
    - Listing performance calculations are correct
    - Current prices are up-to-date (within revalidation window)
20. No console errors or warnings
21. Design matches reference image: CG-IPO Listing Date.png
22. Navigation links added to header/menu:
    - "IPO Listings" dropdown or menu section
    - Links to all three pages
23. Page title and breadcrumbs correctly display category

---

## Compatibility Requirements

- [x] Existing APIs remain unchanged (`/api/ipos` endpoint not modified, only consumed)
- [ ] Database schema changes are backward compatible:
  - Stories 9.1-9.3: No schema changes required
  - Story 9.4: May require adding `recordDate` and `renunciationDate` fields to `ipos` table (backward compatible - nullable fields)
  - Story 9.5: May require adding `OFS` to `ipoCategoryEnum` and `nonRetailDate`/`retailDate` fields (backward compatible)
  - Story 9.6: No schema changes (NCD category already exists)
  - Stories 9.7a & 9.11: May require adding `currentPrice` and `lastUpdated` fields to `listingPerformance` table (backward compatible - nullable fields)
  - Stories 9.8a & 9.12: No schema changes (uses existing `documents` table)
  - Stories 9.9a & 9.13: No schema changes (uses existing date fields and `marketHolidays` table)
  - Stories 9.10a & 9.14: Requires new `ipoReviews` table (backward compatible - new table, doesn't affect existing functionality)
- [x] UI changes follow existing patterns (uses existing table components, Tailwind CSS, responsive design)
- [x] Performance impact is minimal (Redis caching, ISR with 5-min revalidation, data fetching on server-side)

## Risk Mitigation

**Primary Risk:**
Adding data fetching and rendering on the home page could impact page load performance and LCP metrics, potentially affecting SEO and user experience.

**Mitigation:**
- Use server-side rendering with ISR (5-minute revalidation) to pre-render content
- Implement Redis caching with 5-minute TTL to reduce database load
- Limit each table to 10 items maximum
- Add loading skeletons to prevent layout shift
- Monitor Lighthouse scores and Web Vitals during development
- If performance degrades, consider lazy-loading tables below the fold

**Rollback Plan:**
- Remove `<HomeIPOTablesSection>` component from `web/app/page.tsx`
- Delete newly added service functions and components
- Clear Redis cache keys for home page IPO data
- Redeploy previous version
- Database and API remain unchanged, so rollback is simple

## Definition of Done

### Stories 9.1-9.3: Home Page Tables
- [ ] All 3 stories (9.1, 9.2, 9.3) completed with acceptance criteria met
- [ ] All 4 IPO tables display correctly on home page with proper data
- [ ] Color-coding logic works correctly (green, yellow, white backgrounds)
- [ ] "More..." links navigate correctly to dashboard/dedicated pages
- [ ] Tables are fully responsive (mobile, tablet, desktop views tested)

### Stories 9.4-9.6: Standalone Pages
- [ ] All 3 standalone stories (9.4, 9.5, 9.6) completed with acceptance criteria met
- [ ] Rights Issue page functional at `/rights-issues` with tabs
- [ ] OFS page functional at `/ofs` with proper data
- [ ] NCD page functional at `/ncd` with proper data
- [ ] All standalone pages have educational banners

### Stories 9.7a-9.10a: Mainboard Category Pages
- [ ] All 4 Mainboard stories (9.7a, 9.8a, 9.9a, 9.10a) completed with acceptance criteria met
- [ ] Mainboard Performance Tracker functional at `/mainboard-ipo-performance-tracker` with year filter
- [ ] Mainboard Prospectus functional at `/mainboard-ipo-prospectus` with PDF downloads
- [ ] Mainboard Calendar functional at `/mainboard-ipo-calendar` with monthly grid view
- [ ] Mainboard Reviews functional at `/mainboard-ipo-reviews` with year navigation and column search
- [ ] All Mainboard pages filter correctly (category=MAINBOARD)
- [ ] NO tabs on Mainboard pages - clean single-purpose design
- [ ] Navigation links added to "Mainboard IPOs" submenu
- [ ] Performance calculations accurate on Mainboard tracker
- [ ] Color coding works correctly on Mainboard tracker (green/red)
- [ ] PDF download links functional on Mainboard prospectus
- [ ] Calendar grid displays Mainboard events correctly with month navigation
- [ ] Reviews page year navigation functional on Mainboard reviews
- [ ] Reviews page column-level search filters work correctly on Mainboard reviews
- [ ] Total records count displays on Mainboard reviews and prospectus pages

### Stories 9.11-9.14: SME Category Pages
- [ ] All 4 SME stories (9.11, 9.12, 9.13, 9.14) completed with acceptance criteria met
- [ ] SME Performance Tracker functional at `/sme-ipo-performance-tracker` with year filter
- [ ] SME Prospectus functional at `/sme-ipo-prospectus` with PDF downloads
- [ ] SME Calendar functional at `/sme-ipo-calendar` with monthly grid view
- [ ] SME Reviews functional at `/sme-ipo-reviews` with year navigation and column search
- [ ] All SME pages filter correctly (category=SME)
- [ ] NO tabs on SME pages - clean single-purpose design
- [ ] Navigation links added to "SME IPOs" submenu
- [ ] Performance calculations accurate on SME tracker
- [ ] Color coding works correctly on SME tracker (green/red)
- [ ] PDF download links functional on SME prospectus
- [ ] Calendar grid displays SME events correctly with month navigation
- [ ] Reviews page year navigation functional on SME reviews
- [ ] Reviews page column-level search filters work correctly on SME reviews
- [ ] Total records count displays on SME reviews and prospectus pages

### Stories 9.15-9.16: Landing Pages
- [ ] Both landing page stories (9.15, 9.16) completed with acceptance criteria met
- [ ] Mainboard IPOs landing page functional at `/mainboard-ipos`
- [ ] SME IPOs landing page functional at `/sme-ipos`
- [ ] Navigation menu items "Mainboard IPOs" and "SME IPOs" are both clickable AND have dropdown on hover
- [ ] Summary metrics dashboard displays 6 cards correctly on both landing pages
- [ ] Content sections display in card/grid layout (6 sections each):
  - Current IPOs
  - Upcoming IPOs
  - Recently Listed IPOs
  - Reviews
  - Performance highlights (top gainers/losers)
  - Subscription status
- [ ] Navigation cards (4 cards each) link correctly to dedicated pages
- [ ] Detailed table displays with all columns and features:
  - Minimize/maximize toggle works
  - Column-level search functional
  - Year navigation functional
  - Status indicators displayed
  - Sortable columns work
  - Total records count displays
  - Color-coded rows applied
- [ ] All data filtered correctly (Mainboard vs SME)
- [ ] Educational headers explain Mainboard/SME IPOs
- [ ] "View All" links in content sections navigate correctly

### Story 9.17: IPO Listings Pages
- [ ] Story 9.17 completed with acceptance criteria met
- [ ] Three IPO Listings pages functional:
  - `/mainboard-ipo-listings` - Mainboard only
  - `/sme-ipo-listings` - SME only
  - `/fpo-listings` - FPO only
- [ ] Cross-navigation tabs work on all three pages
- [ ] Year dropdown filter works (2020-2026, default: 2025)
- [ ] Table displays all 19 columns with correct data:
  - Company Name, Issue Open/Close, Listing Date
  - Issue Price, Issue Size, Lot Size
  - Subscriptions (Overall, QIB, NII, Retail)
  - GMP, Allotment Date
  - Listing Day Close Price, Listing Day Gain %
  - Current Price (BSE, NSE), Current Gain %
  - Market Cap
- [ ] Sortable columns functional (7 sortable columns)
- [ ] NO search functionality present
- [ ] Company name links to IPO detail pages
- [ ] Color-coding for percentages (green/red)
- [ ] Category filtering correct (Mainboard/SME/FPO)
- [ ] Category badge displayed next to company name
- [ ] Pagination works (50 records per page)
- [ ] Total records count displays
- [ ] Design matches reference image: CG-IPO Listing Date.png
- [ ] Navigation links added to header/menu
- [ ] SEO metadata configured for all three pages
- [ ] ISR with 5-minute revalidation
- [ ] Responsive design with horizontal scroll on mobile

### Performance & Quality
- [ ] Performance metrics meet targets for all pages:
  - Lighthouse Performance score ≥ 90
  - LCP < 2 seconds
  - CLS < 0.1
  - TTI < 3 seconds
- [ ] Schema migrations (if any) tested and backward compatible
- [ ] All pages use ISR with 5-minute revalidation
- [ ] SEO metadata configured for all new pages

### Integration & Testing
- [ ] Existing home page functionality verified through testing (Hero, Features, CTA sections unchanged)
- [ ] Integration points working correctly (API calls, data fetching, navigation)
- [ ] No regression in existing features:
  - Dashboard filtering still works
  - All existing pages load correctly
  - No console errors or warnings
- [ ] All tests pass (unit, integration, e2e)
- [ ] Code review completed
- [ ] Documentation updated:
  - Component README
  - API documentation (if new endpoints added)
  - Schema changes documented

### Deployment & Approval
- [ ] Deployed to staging and verified
- [ ] Product Owner approval obtained for all pages

---

## Reference

**Design References:**
- Home Page IPO Tables: `d:\Abhay\VibeCoding\IPODhan\img\CG-Home-IPO List.png`
- Rights/OFS/NCD Pages: `d:\Abhay\VibeCoding\IPODhan\img\CG-Home-Rights-OFS-NCD.png`
- IPO Performance Tracker: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Performance Tracker.png`
- IPO Prospectus: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Prospectus.png`
- IPO Calendar: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Calendar.png`
- IPO Reviews: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Reviews.png`
- Mainboard IPOs Landing Page (Summary): `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO MB Summary.png`
- Mainboard IPOs Landing Page (List): `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO MB List.png`
- SME IPOs Landing Page (Summary): `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO SME Summary.png`
- SME IPOs Landing Page (List): `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO SME List.png`
- IPO Listing Date (Post-Listing Performance): `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Listing Date.png`
- Anchor Investors Analytics: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Anchor Investors.png`
- IPO Allotment Status: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Allotment Status.png`

**Related Documentation:**
- Existing API: `web/app/api/ipos/route.ts`
- IPO Types: `web/lib/repositories/types.ts`
- Database Schema: `web/lib/db/schema.ts`
- Home Page: `web/app/page.tsx`
- Table Component: `web/components/ui/table.tsx`

**Dependencies:**
- No external dependencies required
- Uses existing API and infrastructure
- May require database schema migrations (Stories 9.4, 9.5, 9.7, 9.10)
- Story 9.7 depends on `listingPerformance` table existing (Epic 6 - Story 6.3)
- Story 9.10 requires `ipoReviews` table (may need to be created)

---

**Created:** 2025-10-11
**Updated:** 2025-10-11
  - Added Stories 9.4-9.6 for standalone pages (Rights, OFS, NCD)
  - Added Stories 9.7a-9.10a for Mainboard category pages (Performance Tracker, Prospectus, Calendar, Reviews)
  - Added Stories 9.11-9.14 for SME category pages (Performance Tracker, Prospectus, Calendar, Reviews)
  - Added Stories 9.15-9.16 for landing pages (Mainboard IPOs, SME IPOs)
  - Updated navigation structure: Mainboard IPOs and SME IPOs are clickable (landing pages) with dropdown submenus
  - Removed tabs from category-specific pages for cleaner UX
  - Updated URLs to SEO-optimized format (/mainboard-ipo-[feature], /sme-ipo-[feature], /mainboard-ipos, /sme-ipos)
**Epic ID:** epic-9
**Status:** Draft
**Estimated Effort:** 17 stories, ~100-122 hours total
**Story Breakdown:**
- Stories 9.1-9.3: Home Page Tables (~12-16 hours)
- Stories 9.4-9.6: Standalone Pages (Rights, OFS, NCD) (~12-14 hours)
- Stories 9.7a-9.10a: Mainboard Category Pages (~24-30 hours)
  - Story 9.7a: Mainboard Performance Tracker (~6-8 hours)
  - Story 9.8a: Mainboard Prospectus (~6-8 hours)
  - Story 9.9a: Mainboard Calendar (~6-7 hours)
  - Story 9.10a: Mainboard Reviews (~6-7 hours)
- Stories 9.11-9.14: SME Category Pages (~24-28 hours)
  - Story 9.11: SME Performance Tracker (~6-7 hours)
  - Story 9.12: SME Prospectus (~6-7 hours)
  - Story 9.13: SME Calendar (~6-7 hours)
  - Story 9.14: SME Reviews (~6-7 hours)
- Stories 9.15-9.16: Landing Pages (~16-20 hours)
  - Story 9.15: Mainboard IPOs Landing Page (~8-10 hours)
  - Story 9.16: SME IPOs Landing Page (~8-10 hours)
- Story 9.17: IPO Listings Pages (~12-14 hours)
  - Three pages with comprehensive 19-column tables
  - API endpoint, service layer, components
  - Cross-navigation tabs, year filter, sorting
