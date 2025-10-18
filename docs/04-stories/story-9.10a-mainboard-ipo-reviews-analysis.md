# Story 9.10a: Mainboard IPO Reviews & Analysis Page

## Status
Done ✅

**Created Date:** 2025-10-12 15:00:00
**Last Updated:** 2025-10-16 22:17:00
**Approved By:** Sarah (Product Owner)
**Approved Date:** 2025-10-12 15:30:00
**Implementation Date:** 2025-10-12
**Merged to Main:** 2025-10-12 (commit: 768fcfb)
**Workflow:** automated-story-creation-workflow-sm-po-new

**Implementation Status:** Complete ✅
**Testing Status:** QA Validated ✅ (All 21 AC passed)
**Deployment Status:** Deployed to Main ✅

## Story

**As a** investor evaluating Mainboard IPO investment opportunities,
**I want** to view a comprehensive Mainboard IPO Reviews and Analysis page with expert reviews, recommendations, and analysis from SEBI registered analysts, including year navigation and column-level search functionality,
**so that** I can make informed investment decisions based on detailed Mainboard IPO analysis covering company background, valuation, financial performance, risks & benefits, and expert recommendations.

## Acceptance Criteria

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

## Tasks / Subtasks

- [ ] **Task 1: Create Database Schema for IPO Reviews** (AC: 2, 4, 21)
  - [ ] Review existing database schema in `web/lib/db/schema.ts`
  - [ ] Create `ipoReviews` table with Drizzle ORM schema:
    - `id` (UUID, primary key)
    - `reviewTitle` (string, not null)
    - `author` (string, not null)
    - `recommendation` (enum: "May apply", "Subscribe", "Avoid", "Not Recommended")
    - `ipoId` (UUID, foreign key to ipos table)
    - `publishedDate` (timestamp, not null)
    - `year` (integer, indexed for fast queries)
    - `category` (enum: MAINBOARD, SME - for filtering)
    - `reviewUrl` (string, nullable - link to full review)
    - `createdAt` (timestamp)
    - `updatedAt` (timestamp)
  - [ ] Add foreign key relationship to `ipos` table
  - [ ] Create database migration file in `web/drizzle/migrations/`
  - [ ] Run migration: `npm run db:migrate`
  - [ ] Verify table creation in PostgreSQL

- [ ] **Task 2: Create Data Fetching Service** (AC: 2, 4, 6, 7, 21)
  - [ ] Create `web/lib/services/mainboard-reviews-service.ts`
  - [ ] Implement `getMainboardIPOReviews(year: number, filters?: ReviewFilters)` function:
    - Query `ipoReviews` table joined with `ipos` table
    - Filter by `category = 'MAINBOARD'`
    - Filter by year parameter
    - Apply optional filters: reviewTitle, author, recommendation, ipoName
    - Sort by `publishedDate DESC` (newest first)
    - Paginate results (50 records per page)
  - [ ] Define `ReviewFilters` TypeScript interface:
    - `reviewTitle?: string`
    - `author?: string`
    - `recommendation?: string`
    - `ipoName?: string`
    - `page?: number`
  - [ ] Implement Redis caching with 10-minute TTL
  - [ ] Add error handling with try-catch blocks
  - [ ] Return type-safe response with TypeScript interface

- [ ] **Task 3: Create Reusable YearNavigation Component** (AC: 6)
  - [ ] Create `web/components/reviews/YearNavigation.tsx`
  - [ ] Implement year navigation UI:
    - Previous year button: "<< Year {year-1}"
    - Current year display (center): "{year}"
    - Next year button: "Year {year+1} >>"
  - [ ] Add click handlers to update URL query param: `?year={year}`
  - [ ] Use Next.js `useRouter` and `useSearchParams` for URL management
  - [ ] Style with Tailwind CSS (responsive, accessible buttons)
  - [ ] Add prop types: `currentYear: number`, `onYearChange: (year: number) => void`
  - [ ] Make component reusable for other pages (SME reviews, performance trackers)

- [ ] **Task 4: Create Reusable ColumnSearch Component** (AC: 7, 11)
  - [ ] Create `web/components/reviews/ColumnSearch.tsx`
  - [ ] Implement column-level search input with:
    - Text input for fuzzy search (Review Title, IPO Name)
    - Dropdown for Author filter (fetch unique authors from DB)
    - Dropdown for Recommendation filter (predefined enum values)
  - [ ] Add debounced search (300ms) using `useDebounce` hook
  - [ ] Update URL query params on search: `?reviewTitle={query}&author={author}&recommendation={rec}&ipoName={query}`
  - [ ] Style search inputs with Tailwind CSS
  - [ ] Add clear/reset button for each search field
  - [ ] Prop types: `columnName: string`, `filterType: 'text' | 'dropdown'`, `options?: string[]`, `onFilterChange: (value: string) => void`

- [ ] **Task 5: Create Reusable ReviewsHeader Component** (AC: 12)
  - [ ] Create `web/components/reviews/ReviewsHeader.tsx`
  - [ ] Implement educational header explaining Mainboard IPO reviews:
    - Title: "Mainboard IPO Reviews & Analysis"
    - Description: "IPO forecast helps investors decide if the IPO is worth investing in"
    - Content covered: "company background, offer detail, company valuation, capital structure, financial performance, strength, risks & benefits, peer comparison"
    - Target audience: "both short and long-term investors"
  - [ ] Style with Tailwind CSS (prominent banner, readable typography)
  - [ ] Add info icon with tooltip for additional context
  - [ ] Make component reusable with prop: `category: 'MAINBOARD' | 'SME'`

- [ ] **Task 6: Create MainboardIPOReviewsTable Component** (AC: 2, 8, 9, 10, 20)
  - [ ] Create `web/components/reviews/MainboardIPOReviewsTable.tsx`
  - [ ] Implement table with 5 columns:
    - Column 1: # (Row number - serial number starting from 1)
    - Column 2: Review Title (clickable link to `/ipo-reviews/[reviewId]`)
    - Column 3: Author (analyst/firm name)
    - Column 4: Recommendation (e.g., "May apply", "Subscribe", "Avoid")
    - Column 5: IPO (company name, clickable link to `/ipos/[slug]`)
  - [ ] Use shadcn/ui `Table` component from `web/components/ui/table.tsx`
  - [ ] Implement sortable columns for Review Title, Author, Recommendation, IPO (click header to sort)
  - [ ] Add sort indicators (up/down arrows) in column headers
  - [ ] Calculate row numbers based on pagination: `(page - 1) * 50 + index + 1`
  - [ ] Style Review Title and IPO Name as clickable links (blue text, underline on hover)
  - [ ] Add responsive design: table on desktop, cards on mobile
  - [ ] Prop types: `reviews: Review[]`, `onSort: (column: string) => void`, `currentPage: number`

- [ ] **Task 7: Create Mainboard IPO Reviews Page** (AC: 1, 3, 5, 6, 13, 14, 15, 16, 17, 18, 19)
  - [ ] Create `web/app/mainboard-ipo-reviews/page.tsx`
  - [ ] Implement Server Component with ISR:
    - Add `export const revalidate = 600` (10-minute revalidation)
  - [ ] Fetch reviews data using `getMainboardIPOReviews()` service
  - [ ] Extract URL query params: `year`, `reviewTitle`, `author`, `recommendation`, `ipoName`, `page`
  - [ ] Default year to current year (2025) if not specified
  - [ ] Pass data to client components via props
  - [ ] Render page layout:
    - `<ReviewsHeader category="MAINBOARD" />`
    - `<YearNavigation currentYear={year} />`
    - `<ColumnSearch />` for each filterable column
    - Total records count: "Total Records: {count}"
    - `<MainboardIPOReviewsTable reviews={reviews} />`
    - Pagination component (50 records per page)
  - [ ] Implement empty state: "No Mainboard IPO reviews available for {year}"
  - [ ] Add loading skeleton using Suspense and loading.tsx
  - [ ] Configure SEO metadata:
    - Title: "Mainboard IPO Reviews & Analysis 2025 | Expert Investment Recommendations"
    - Description: "Access expert Mainboard IPO reviews, analysis, and investment recommendations from SEBI registered analysts"
    - Keywords: "mainboard ipo reviews, ipo analysis, investment recommendations"
  - [ ] Ensure responsive design (mobile, tablet, desktop)

- [ ] **Task 8: Add Navigation Link to Mainboard IPOs Submenu** (AC: 19)
  - [ ] Update navigation component (likely in `web/components/layout/Header.tsx` or similar)
  - [ ] Add "Mainboard IPO Reviews" link to "Mainboard IPOs" submenu dropdown
  - [ ] Link to `/mainboard-ipo-reviews`
  - [ ] Verify submenu styling and hover states

- [ ] **Task 9: Implement Pagination Component** (AC: 17)
  - [ ] Create `web/components/reviews/ReviewsPagination.tsx` (or reuse existing pagination component)
  - [ ] Display pagination controls: Previous | 1 2 3 ... | Next
  - [ ] Update URL query param on page change: `?page={pageNumber}`
  - [ ] Show current page indicator
  - [ ] Disable Previous button on first page, disable Next button on last page
  - [ ] Calculate total pages: `Math.ceil(totalRecords / 50)`

- [ ] **Task 10: Create Review Detail Page (Placeholder)** (AC: 9)
  - [ ] Create `web/app/ipo-reviews/[reviewId]/page.tsx` (basic structure)
  - [ ] Fetch review data by `reviewId`
  - [ ] Display full review content (placeholder for now):
    - Company Background
    - Offer Details
    - Company Valuation
    - Capital Structure
    - Financial Performance
    - Strengths & Risks
    - Peer Comparison
    - Analyst Recommendation
  - [ ] Note: Full review detail page can be enhanced in future stories

- [ ] **Task 11: Add Unit Tests for Service Layer** (Testing: AC 2, 4, 6, 7)
  - [ ] Create `web/tests/unit/lib/services/mainboard-reviews-service.test.ts`
  - [ ] Test `getMainboardIPOReviews()` function:
    - Test filtering by year
    - Test filtering by category (MAINBOARD only)
    - Test fuzzy search on Review Title and IPO Name
    - Test author dropdown filter
    - Test recommendation dropdown filter
    - Test combined filters (AND logic)
    - Test sorting by published date (descending)
    - Test pagination (50 records per page)
  - [ ] Mock Drizzle ORM queries
  - [ ] Mock Redis cache
  - [ ] Verify correct SQL queries generated
  - [ ] Target >85% code coverage for service layer

- [ ] **Task 12: Add Integration Tests for API and Page** (Testing: AC 1, 15)
  - [ ] Create `web/tests/integration/app/mainboard-ipo-reviews.test.ts`
  - [ ] Test page route `/mainboard-ipo-reviews`:
    - Test page renders successfully
    - Test ISR with 10-minute revalidation
    - Test URL query params (year, filters, page)
  - [ ] Test data fetching with real database connection (test DB)
  - [ ] Test empty state rendering
  - [ ] Test loading skeleton display
  - [ ] Verify SEO metadata injection

- [ ] **Task 13: Add E2E Tests for User Workflows** (Testing: AC 6, 7, 8, 9, 10, 11, 17)
  - [ ] Create `web/tests/e2e/mainboard-ipo-reviews.spec.ts`
  - [ ] Test year navigation:
    - Click Previous year button, verify URL update and data refresh
    - Click Next year button, verify URL update and data refresh
  - [ ] Test column-level search:
    - Enter text in Review Title search, verify filtered results
    - Select author from dropdown, verify filtered results
    - Select recommendation from dropdown, verify filtered results
    - Enter text in IPO Name search, verify filtered results
    - Verify debounced search (300ms delay)
  - [ ] Test sorting:
    - Click Review Title column header, verify sort order
    - Click Author column header, verify sort order
    - Click Recommendation column header, verify sort order
    - Click IPO column header, verify sort order
  - [ ] Test links:
    - Click Review Title link, verify navigation to review detail page
    - Click IPO Name link, verify navigation to IPO detail page
  - [ ] Test pagination:
    - Click Next page, verify URL update and new data
    - Click Previous page, verify navigation
  - [ ] Use Playwright for E2E tests

- [ ] **Task 14: Manual Testing and QA Checklist**
  - [ ] Verify all 21 Acceptance Criteria manually
  - [ ] Test on multiple browsers (Chrome, Firefox, Safari)
  - [ ] Test responsive design (mobile, tablet, desktop)
  - [ ] Verify accessibility (keyboard navigation, screen reader support)
  - [ ] Test performance (Lighthouse score >90)
  - [ ] Verify ISR revalidation behavior
  - [ ] Check for console errors or warnings

## Dev Notes

### Previous Story Insights

**From Story 9.9a (Mainboard IPO Calendar Page):**
- Reusable components pattern established for calendar features
- `MonthNavigation.tsx` and `EventSearch.tsx` components created for calendar page
- ISR with 5-minute revalidation working well for dynamic data
- Category filtering (category=MAINBOARD) applied consistently
- NO tabs approach confirmed for clean, single-purpose pages
- Navigation link added to "Mainboard IPOs" submenu successfully
- Performance considerations: Calendar renders smoothly even with 20+ events per day

**Key Learnings:**
- Reusable components should be placed in feature-specific folders (e.g., `components/reviews/`, `components/calendar/`)
- URL query params used consistently for year navigation and filtering
- Educational headers improve user understanding and engagement
- Loading skeletons and empty states essential for good UX
- ISR with appropriate revalidation time (5-10 minutes) balances freshness and performance

### Data Models

**IPO Review Data Model (NEW - needs to be created):**
[Source: epic-9-enhancements.md#Story 9.10a Technical Notes]

The `ipoReviews` table needs to be created with the following fields:
- `id` (UUID, primary key)
- `reviewTitle` (string) - Title of the review article
- `author` (string) - Analyst or firm name (e.g., "SEBI Registered Analyst XYZ")
- `recommendation` (enum) - Values: "May apply", "Subscribe", "Avoid", "Not Recommended"
- `ipoId` (UUID, foreign key) - Links to the IPO in `ipos` table
- `publishedDate` (timestamp) - When the review was published
- `year` (integer, indexed) - Year extracted from publishedDate for fast filtering
- `category` (enum: MAINBOARD, SME) - Derived from IPO or stored directly
- `reviewUrl` (string, nullable) - URL to full review content
- `reviewContent` (text, nullable) - Full review content if stored internally
- `createdAt`, `updatedAt` (timestamps)

**Relationship:**
- `ipoReviews.ipoId` → `ipos.id` (many-to-one)
- One IPO can have multiple reviews from different analysts

**Indexing Strategy:**
- Primary index on `id`
- Foreign key index on `ipoId`
- Index on `year` for fast year-based filtering
- Index on `category` for Mainboard/SME filtering
- Composite index on `(category, year, publishedDate DESC)` for optimal query performance

[Source: docs/architecture/data-models.md]

**Existing IPO Data Model:**
```typescript
export interface IPO {
  id: string;
  companyName: string;
  slug: string;
  category: IPOCategory; // MAINBOARD | SME | RIGHTS | NCD
  // ... other fields
}
```

### API Specifications

**New Service Layer Function:**
[Source: epic-9-enhancements.md#Story 9.10a Key Work]

`lib/services/mainboard-reviews-service.ts`:
```typescript
export async function getMainboardIPOReviews(
  year: number,
  filters?: ReviewFilters
): Promise<{ reviews: Review[], totalCount: number }> {
  // Query ipoReviews table joined with ipos table
  // Filter by category=MAINBOARD
  // Apply year filter
  // Apply optional filters (reviewTitle, author, recommendation, ipoName)
  // Sort by publishedDate DESC
  // Paginate (50 records per page)
  // Return reviews array and total count
}

export interface ReviewFilters {
  reviewTitle?: string;  // Fuzzy search on review title
  author?: string;       // Exact match on author
  recommendation?: string; // Exact match on recommendation
  ipoName?: string;      // Fuzzy search on IPO company name
  page?: number;         // Pagination page number
}

export interface Review {
  id: string;
  reviewTitle: string;
  author: string;
  recommendation: string;
  ipoId: string;
  ipoName: string;      // Joined from ipos table
  ipoSlug: string;      // Joined from ipos table
  publishedDate: Date;
  year: number;
  reviewUrl?: string;
}
```

[Source: docs/architecture/backend-architecture.md#Repository Pattern]

**Repository Pattern:**
- All database queries MUST go through Repository layer
- Use Drizzle ORM for type-safe queries
- Implement cache-aside pattern with Redis

**Cache Strategy:**
[Source: docs/architecture/api-specification.md#Caching Strategy]
- Cache TTL: 10 minutes (600 seconds) for reviews data
- Redis key pattern: `reviews:mainboard:{year}:{filters_hash}`
- Invalidate cache when new reviews are added (future scraper integration)

### Component Specifications

**Reusable Components Pattern:**
[Source: docs/architecture/frontend-architecture.md#Component Organization]

Component structure:
```
web/components/
├── reviews/
│   ├── YearNavigation.tsx       (Reusable for reviews and performance pages)
│   ├── ColumnSearch.tsx         (Reusable for any table with column filters)
│   ├── ReviewsHeader.tsx        (Reusable with category prop)
│   └── MainboardIPOReviewsTable.tsx
```

**YearNavigation Component:**
```typescript
interface YearNavigationProps {
  currentYear: number;
  onYearChange: (year: number) => void;
}
```

**ColumnSearch Component:**
```typescript
interface ColumnSearchProps {
  columnName: string;
  filterType: 'text' | 'dropdown';
  options?: string[];           // For dropdown filters
  placeholder?: string;
  value: string;
  onFilterChange: (value: string) => void;
  debounceMs?: number;          // Default: 300ms
}
```

**ReviewsHeader Component:**
```typescript
interface ReviewsHeaderProps {
  category: 'MAINBOARD' | 'SME';
}
```

**MainboardIPOReviewsTable Component:**
```typescript
interface MainboardIPOReviewsTableProps {
  reviews: Review[];
  onSort: (column: string, direction: 'asc' | 'desc') => void;
  currentPage: number;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}
```

[Source: docs/architecture/components.md#Frontend Application]

**UI Component Library:**
- Use shadcn/ui components from `web/components/ui/`
- Table component: `web/components/ui/table.tsx`
- Button component: `web/components/ui/button.tsx`
- Input component: `web/components/ui/input.tsx`
- Select component: `web/components/ui/select.tsx`

### File Locations

[Source: docs/architecture/unified-project-structure.md]

**New Files to Create:**
```
web/
├── app/
│   ├── mainboard-ipo-reviews/
│   │   ├── page.tsx                 (Main page - Server Component with ISR)
│   │   └── loading.tsx              (Loading skeleton)
│   └── ipo-reviews/
│       └── [reviewId]/
│           └── page.tsx             (Review detail page - placeholder)
├── components/
│   └── reviews/
│       ├── YearNavigation.tsx       (Reusable year navigation)
│       ├── ColumnSearch.tsx         (Reusable column search)
│       ├── ReviewsHeader.tsx        (Reusable educational header)
│       ├── MainboardIPOReviewsTable.tsx (Table component)
│       └── ReviewsPagination.tsx    (Pagination component)
├── lib/
│   ├── db/
│   │   └── schema.ts                (Add ipoReviews table schema)
│   └── services/
│       └── mainboard-reviews-service.ts (Data fetching service)
├── drizzle/
│   └── migrations/
│       └── 000X_add_ipo_reviews_table.sql (Migration file)
└── tests/
    ├── unit/
    │   └── lib/
    │       └── services/
    │           └── mainboard-reviews-service.test.ts
    ├── integration/
    │   └── app/
    │       └── mainboard-ipo-reviews.test.ts
    └── e2e/
        └── mainboard-ipo-reviews.spec.ts
```

**Naming Conventions:**
[Source: docs/architecture/coding-standards.md]
- Components: PascalCase (e.g., `YearNavigation.tsx`)
- Services: camelCase (e.g., `mainboard-reviews-service.ts`)
- API Routes: kebab-case (e.g., `/mainboard-ipo-reviews`)
- Database Tables: snake_case (e.g., `ipo_reviews`)

### Testing Requirements

[Source: docs/architecture/testing-strategy.md]

**Testing Pyramid:**
- Unit Tests (70%): Service layer, utility functions
- Integration Tests (20%): API routes with real DB
- E2E Tests (10%): Critical user flows

**Test Organization:**
- Unit tests: `tests/unit/lib/services/mainboard-reviews-service.test.ts`
- Integration tests: `tests/integration/app/mainboard-ipo-reviews.test.ts`
- E2E tests: `tests/e2e/mainboard-ipo-reviews.spec.ts`

**Testing Framework:**
- Unit/Integration: Vitest (already configured)
- E2E: Playwright (already configured)

**Coverage Targets:**
- Service Layer: >90%
- API Routes: >85%
- React Components: >80%
- Overall: >80%

**Key Test Scenarios:**
1. **Service Layer Tests:**
   - Year filtering returns correct data
   - Category filtering (MAINBOARD only)
   - Fuzzy search on Review Title
   - Author dropdown filter
   - Recommendation dropdown filter
   - Combined filters (AND logic)
   - Sorting by published date (DESC)
   - Pagination (50 records per page)

2. **Integration Tests:**
   - Page route renders successfully
   - ISR with 10-minute revalidation
   - URL query params work correctly
   - Empty state handling
   - Loading skeleton display

3. **E2E Tests:**
   - Year navigation clicks and URL updates
   - Column-level search filters results
   - Debounced search (300ms)
   - Sorting columns
   - Review Title link navigation
   - IPO Name link navigation
   - Pagination navigation

### Technical Constraints

[Source: docs/architecture/tech-stack.md]

**Tech Stack:**
- Frontend: Next.js 14.2+ with App Router, React Server Components
- UI Library: shadcn/ui with Tailwind CSS
- Database: PostgreSQL 16+ with Drizzle ORM
- Cache: Redis 7.2+ with 10-minute TTL
- Testing: Vitest (unit/integration), Playwright (E2E)

**Performance Requirements:**
- ISR Revalidation: 10 minutes (600 seconds)
- Debounced Search: 300ms delay
- Pagination: 50 records per page
- Page Load: LCP < 2 seconds
- Lighthouse Score: >90

**Security Requirements:**
- Input Validation: Use Zod schemas for all user inputs
- SQL Injection Prevention: Use Drizzle ORM parameterized queries
- XSS Prevention: React auto-escapes all rendered content

**Accessibility Requirements:**
- Keyboard navigation support (tab through table, search inputs)
- ARIA labels for buttons and inputs
- Screen reader support for table structure
- Color contrast ratios meet WCAG AA standards

### Project Structure Notes

**Database Schema Alignment:**
[Source: docs/architecture/database-schema.md]

The `ipoReviews` table is a new addition to the schema. It must be created via Drizzle ORM migration:

1. Define schema in `web/lib/db/schema.ts`
2. Generate migration: `npm run db:generate`
3. Review migration SQL in `web/drizzle/migrations/`
4. Apply migration: `npm run db:migrate`
5. Verify table in PostgreSQL

**Foreign Key Constraint:**
- `ipoReviews.ipoId` must reference `ipos.id`
- Use `ON DELETE CASCADE` to remove reviews when IPO is deleted
- Use `ON UPDATE CASCADE` to update reviews when IPO ID changes

**No Conflicts Identified:**
- New table does not affect existing functionality
- Follows existing naming conventions (snake_case for tables)
- Compatible with existing Drizzle ORM setup

### Testing

[Source: docs/architecture/testing-strategy.md]

**Test File Locations:**
- Unit tests: `web/tests/unit/lib/services/mainboard-reviews-service.test.ts`
- Integration tests: `web/tests/integration/app/mainboard-ipo-reviews.test.ts`
- E2E tests: `web/tests/e2e/mainboard-ipo-reviews.spec.ts`

**Testing Frameworks:**
- Vitest for unit and integration tests (already configured in `web/vitest.config.ts`)
- Playwright for E2E tests (already configured in `web/playwright.config.ts`)

**Test Standards:**
- All service functions must have unit tests
- API routes must have integration tests with real database connections
- Critical user workflows must have E2E tests
- Tests must use TypeScript
- Mock external dependencies (Redis, database) in unit tests
- Use test database for integration tests

**Coverage Targets:**
- Service Layer: >90% code coverage
- API Routes: >85% code coverage
- React Components: >80% code coverage
- Overall: >80% code coverage

**Test Execution:**
- Run unit tests: `npm run test:unit`
- Run integration tests: `npm run test:integration`
- Run E2E tests: `npm run test:e2e`
- Run all tests: `npm run test`

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2025-10-12 15:00:00 | 1.0 | Initial story created for Story 9.10a (Mainboard IPO Reviews & Analysis Page) | Bob (Scrum Master) |
| 2025-10-12 15:15:00 | 1.1 | Story validated and approved by Product Owner (Implementation Readiness Score: 9.5/10) | Sarah (Product Owner) |
| 2025-10-12 15:30:00 | 1.2 | Story status updated to "Ready" - approved for development | Workflow Automation |

## Dev Agent Record

*(This section will be populated by the development agent during implementation)*

### Agent Model Used

*(To be filled by Dev Agent)*

### Debug Log References

*(To be filled by Dev Agent)*

### Completion Notes

*(To be filled by Dev Agent)*

### File List

*(To be filled by Dev Agent)*

## QA Results

*(This section will be populated by the QA Agent after story implementation)*
