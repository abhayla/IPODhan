# Story 9.17: IPO Listings Pages (Mainboard, SME, FPO)

## Status
Draft

## Story

**As a** investor tracking post-listing IPO performance,
**I want** to access three comprehensive IPO Listings pages (Mainboard, SME, FPO) displaying detailed performance data with 19 columns including subscription data, GMP, listing performance, and current market prices,
**so that** I can analyze IPO outcomes across different categories, compare post-listing performance metrics, and make informed investment decisions based on historical IPO performance patterns.

## Acceptance Criteria

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
   - **PREREQUISITE**: Story 9.17a must be completed first (FPO category and currentPriceBSE/currentPriceNSE schema fields)
   - All date fields formatted (MMM DD, YYYY)
   - All currency fields show ₹ symbol
   - All percentage fields show % symbol
   - Subscription data shows "x" suffix (e.g., "2.45x")
4. Year dropdown filter works:
   - Shows years 2020-2026
   - Default: Current year dynamically (new Date().getFullYear())
   - Changing year filters data and updates URL query param
   - URL format: `/mainboard-ipo-listings?year=2024`
5. Sortable columns functional:
   - Click any column header to sort
   - First click: Descending order
   - Second click: Ascending order
   - Sort icon indicator shows current sort direction
   - Sortable columns: Company Name, Issue Open, Issue Close, Listing Date, Issue Size, Listing Day Gain %, Current Gain %
   - **CLIENT-SIDE SORTING**: Sorting applies only to current page (50 records), not across all pages
   - Instant sorting with no page reload
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

## Tasks / Subtasks

### Phase 0: Prerequisites Verification and Design Review (AC: All) - BLOCKING PHASE

**⚠️ CRITICAL: This phase contains blocking checks. If any check fails, HALT development and resolve blockers first.**

- [ ] **BLOCKER CHECK**: Verify Story 9.17a completion status (AC: 3)
  - [ ] Confirm Story 9.17a is marked as COMPLETED
  - [ ] Verify FPO category exists in database: `SELECT unnest(enum_range(NULL::ipo_category))`
  - [ ] Verify currentPriceBSE and currentPriceNSE columns exist: `\d listing_performance`
  - [ ] **IF NOT COMPLETED**: HALT - Story 9.17a must be completed first
  - [ ] **IF FAILED**: Document blocker and notify Product Owner immediately

- [ ] Verify design reference image exists (AC: 21)
  - [ ] Check `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Listing Date.png` exists
  - [ ] Review image to understand 19-column table layout
  - [ ] Document column order, styling, and formatting requirements
  - [ ] Note any design clarifications needed
  - [ ] **IF MISSING**: Request design file from Product Owner - BLOCKER

- [ ] **BLOCKER CHECK**: Verify database schema supports 19-column data (AC: 3, 9, 19)
  - [ ] Confirm `ipos` table has fields: companyName, category, openDate, closeDate, listingDate, issuePrice, issueSize, lotSize
  - [ ] Verify `listingPerformance` table has: listingPrice, issuePrice, currentPriceBSE, currentPriceNSE, listingGainPercent, currentGainPercent, lastUpdated
  - [ ] Check `subscriptions` table supports: qibSubscription, niiSubscription, retailSubscription, totalSubscription
  - [ ] Verify `gmpRecords` table exists with: gmp field
  - [ ] Verify allotmentDate field exists in ipos table
  - [ ] Verify market cap calculation data available (issueSize for estimation)
  - [ ] **IF ANY MISSING**: HALT - Complete schema migration first (Story 9.17a)

- [ ] **BLOCKER CHECK**: Verify API supports FPO category (AC: 1, 9)
  - [ ] Test `/api/ipos?category=FPO` returns valid response (not 400 error)
  - [ ] Verify API validation includes 'FPO' in allowed categories
  - [ ] **IF FAILS**: HALT - Update API validation to include FPO category

- [ ] Verify shared types support listings data (AC: 3, 9)
  - [ ] Check `packages/shared/src/types/ipo.ts` exports IPO interface with all required fields
  - [ ] Verify IPOCategory includes MAINBOARD, SME, and FPO enum values
  - [ ] Check ListingPerformance interface includes: listingClose, currentPriceBSE, currentPriceNSE, listingGainPercent, currentGainPercent
  - [ ] Verify Subscription interface for subscription columns
  - [ ] Check GMPRecord interface for GMP column
  - [ ] If types missing: Add to shared types package before proceeding

- [ ] Verify API supports listings data fetching (AC: 1, 3, 9)
  - [ ] Test `/api/ipos?category=MAINBOARD&status=LISTED` returns Mainboard IPOs
  - [ ] Test `/api/ipos?category=SME&status=LISTED` returns SME IPOs
  - [ ] Test `/api/ipos?category=FPO&status=LISTED` returns FPO/Follow-on offers
  - [ ] Check if listing performance data is included in response or requires separate endpoint
  - [ ] Check if subscription data is included or requires JOIN query
  - [ ] Check if GMP data is included or requires separate query
  - [ ] If API endpoints missing: Create or enhance before proceeding

### Phase 1: Service Layer - Data Fetching Functions (AC: 1, 3, 9, 11, 19)

- [ ] Create IPO Listings service file (AC: 1, 3, 9, 11)
  - [ ] Create file: `web/lib/services/ipo-listings-service.ts`
  - [ ] Import required types from shared package:
    ```typescript
    import { IPO, IPOCategory, IPOStatus } from '@/types/ipo';
    import { ListingPerformance } from '@/types/listing';
    import { Subscription } from '@/types/subscription';
    import { GMPRecord } from '@/types/gmp';
    import { apiClient } from '@/lib/api-client';
    ```
  - [ ] Add JSDoc comment explaining service purpose: "IPO Listings Pages data fetching service for Mainboard, SME, and FPO categories"

- [ ] Define comprehensive listings data interface (AC: 3)
  - [ ] Create interface for 19-column data:
    ```typescript
    export interface IPOListingData {
      // Column 1-7: Basic IPO Info
      companyName: string;
      slug: string;
      category: IPOCategory;
      issueOpenDate: Date;
      issueCloseDate: Date;
      listingDate: Date | null;
      issuePrice: number;
      issueSize: number;
      lotSize: number;

      // Column 8-11: Subscription Data
      subscriptionOverall: number;
      subscriptionQIB: number;
      subscriptionNII: number;
      subscriptionRetail: number;

      // Column 12-13: GMP Data
      gmp: number | null;
      allotmentDate: Date | null;

      // Column 14-19: Listing Performance
      listingDayClosePrice: number | null;
      listingDayGainPercent: number | null;
      currentPriceBSE: number | null;
      currentPriceNSE: number | null;
      currentGainPercent: number | null;
      marketCap: number | null;
    }

    export interface ListingsFilters {
      category: IPOCategory;
      year?: number;
      sortColumn?: string;
      sortDirection?: 'asc' | 'desc';
      page?: number;
      limit?: number;
    }

    export interface ListingsResponse {
      data: IPOListingData[];
      totalCount: number;
      currentPage: number;
      totalPages: number;
    }
    ```

- [ ] Implement main listings data fetching function (AC: 1, 3, 4, 9, 16, 19)
  - [ ] Function signature:
    ```typescript
    export async function fetchIPOListings(
      filters: ListingsFilters
    ): Promise<ListingsResponse>
    ```
  - [ ] **USE EFFICIENT JOIN QUERIES** - Fetch all data in single query:
    ```sql
    -- Example JOIN query structure
    SELECT
      ipos.*,
      lp.listing_price,
      lp.current_price_bse,
      lp.current_price_nse,
      lp.listing_gain_percent,
      lp.current_gain_percent,
      s.qib_subscription,
      s.nii_subscription,
      s.retail_subscription,
      s.total_subscription,
      gmp.gmp
    FROM ipos
    LEFT JOIN listing_performance lp ON ipos.id = lp.ipo_id
    LEFT JOIN LATERAL (
      SELECT * FROM subscriptions
      WHERE ipo_id = ipos.id
      ORDER BY timestamp DESC
      LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT * FROM gmp_records
      WHERE ipo_id = ipos.id
      ORDER BY timestamp DESC
      LIMIT 1
    ) gmp ON true
    WHERE ipos.category = $1
      AND ipos.status = 'LISTED'
      AND EXTRACT(YEAR FROM ipos.listing_date) = $2
    ORDER BY ipos.listing_date DESC
    LIMIT 50 OFFSET $3
    ```
  - [ ] Apply year filter if provided (filter by listingDate year)
  - [ ] Calculate current gain percentage: `((currentPrice - issuePrice) / issuePrice) × 100`
  - [ ] Calculate listing day gain percentage: Pre-calculated in listing_performance.listing_gain_percent
  - [ ] Calculate market cap if currentPrice available: Estimate as `issueSize × (currentPrice / issuePrice)`
  - [ ] Verify market cap calculation accuracy with sample data
  - [ ] Apply sorting: Default to Listing Date descending (newest first)
  - [ ] **NOTE**: Sorting handled client-side in component, server returns default order
  - [ ] Apply pagination: limit 50 records per page (configurable)
  - [ ] Calculate totalPages: `Math.ceil(totalCount / limit)`
  - [ ] Add error handling with try-catch
  - [ ] Return empty data array on error (graceful degradation)
  - [ ] Log errors to console (server-side)

- [ ] Implement helper function for available years (AC: 4)
  - [ ] Function signature:
    ```typescript
    export async function fetchAvailableYears(): Promise<number[]>
    ```
  - [ ] Query database for distinct listing years
  - [ ] Return array of years sorted descending (2026, 2025, 2024, etc.)
  - [ ] Include current year dynamically: `new Date().getFullYear()`
  - [ ] Default to [2020, 2021, 2022, 2023, 2024, 2025, 2026, currentYear] if query fails

- [ ] Add service layer exports and error handling
  - [ ] Export all interfaces and functions
  - [ ] Verify no TypeScript errors
  - [ ] Add JSDoc comments for all public functions

### Phase 2: API Endpoint for Listings Data (AC: 3, 11, 19)

- [ ] Create API route file (AC: 3, 11)
  - [ ] Create file: `web/app/api/ipos/listings/route.ts`
  - [ ] Import service function: `import { fetchIPOListings } from '@/lib/services/ipo-listings-service';`
  - [ ] API route handler:
    ```typescript
    export async function GET(request: Request) {
      const { searchParams } = new URL(request.url);
      const category = searchParams.get('category');
      const year = searchParams.get('year');
      const sortColumn = searchParams.get('sortColumn');
      const sortDirection = searchParams.get('sortDirection');
      const page = searchParams.get('page');

      // Validate category
      if (!category || !['MAINBOARD', 'SME', 'FPO'].includes(category)) {
        return Response.json({ error: 'Invalid category' }, { status: 400 });
      }

      // Validate year parameter (security)
      if (year) {
        const yearInt = parseInt(year, 10);
        if (isNaN(yearInt) || yearInt < 2000 || yearInt > 2100) {
          return Response.json({ error: 'Invalid year parameter' }, { status: 400 });
        }
      }

      // Validate page parameter (security)
      if (page) {
        const pageInt = parseInt(page, 10);
        if (isNaN(pageInt) || pageInt < 1 || pageInt > 10000) {
          return Response.json({ error: 'Invalid page parameter' }, { status: 400 });
        }
      }

      // Build filters
      const filters = {
        category,
        year: year ? parseInt(year, 10) : undefined,
        sortColumn,
        sortDirection,
        page: page ? parseInt(page, 10) : 1,
        limit: 50
      };

      // Fetch data
      const result = await fetchIPOListings(filters);

      // Return response with caching headers
      return Response.json(result, {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
        }
      });
    }
    ```
  - [ ] Add error handling middleware
  - [ ] Add validation for query parameters (year range, page limits)

- [ ] Test API endpoint (AC: 3, 9, 19)
  - [ ] Test `/api/ipos/listings?category=MAINBOARD` returns Mainboard data
  - [ ] Test `/api/ipos/listings?category=SME` returns SME data
  - [ ] Test `/api/ipos/listings?category=FPO` returns FPO data
  - [ ] Test year filter: `/api/ipos/listings?category=MAINBOARD&year=2024`
  - [ ] Test sorting: `/api/ipos/listings?category=MAINBOARD&sortColumn=listingDate&sortDirection=desc`
  - [ ] Test pagination: `/api/ipos/listings?category=MAINBOARD&page=2`
  - [ ] Verify all 19 columns present in response
  - [ ] Verify calculations are accurate (gain percentages, market cap)
  - [ ] Verify response includes totalCount, currentPage, totalPages

### Phase 3: Comprehensive Listings Table Component (AC: 3, 5, 7, 8, 10, 12, 17)

- [ ] Create IPO Listings Table component file (AC: 3)
  - [ ] Create file: `web/components/listings/IPOListingsTable.tsx`
  - [ ] Mark as client component: `'use client'` (for sorting state)
  - [ ] Component receives listings data and handlers as props

- [ ] Define component interface (AC: 3, 5)
  - [ ] Props interface:
    ```typescript
    interface IPOListingsTableProps {
      data: IPOListingData[];
      totalCount: number;
      currentPage: number;
      totalPages: number;
      category: IPOCategory;
      onSort: (column: string) => void;
      sortColumn?: string;
      sortDirection?: 'asc' | 'desc';
    }
    ```

- [ ] Implement table structure with 19 columns (AC: 3, 7, 10, 12)
  - [ ] Use shadcn/ui Table component
  - [ ] Desktop layout (>= 1024px): Full 19-column table with horizontal scroll
  - [ ] Table columns (exact order from design):
    1. **Company Name** (clickable link, category badge)
    2. **Issue Open Date** (formatted: MMM DD, YYYY)
    3. **Issue Close Date** (formatted: MMM DD, YYYY)
    4. **Listing Date** (formatted: MMM DD, YYYY or "TBD")
    5. **Issue Price** (₹ symbol, 2 decimal places)
    6. **Issue Size** (₹ Crores)
    7. **Lot Size** (number)
    8. **Subscription - Overall** (e.g., "2.45x")
    9. **Subscription - QIB** (e.g., "12.5x")
    10. **Subscription - NII** (e.g., "3.8x")
    11. **Subscription - Retail** (e.g., "1.2x")
    12. **GMP (Grey Market Premium)** (₹ symbol)
    13. **Allotment Date** (formatted: MMM DD, YYYY)
    14. **Listing Day Close Price** (₹ symbol)
    15. **Listing Day Gain/Loss** (%, color-coded)
    16. **Current Price at BSE** (₹ symbol)
    17. **Current Price at NSE** (₹ symbol)
    18. **Current Gain/Loss** (%, color-coded)
    19. **Market Cap** (₹ Crores)
  - [ ] Add responsive class for horizontal scroll: `<div className="overflow-x-auto">`
  - [ ] Table has minimum width to accommodate all columns
  - [ ] All data filtered to show only specified category (AC: 9)

- [ ] Implement company name column with link and badge (AC: 7, 10)
  - [ ] Company name cell:
    ```typescript
    <TableCell>
      <div className="flex items-center gap-2">
        <Badge variant={getBadgeVariant(category)}>
          {category}
        </Badge>
        <Link
          href={`/ipos/${slug}`}
          className="hover:underline font-medium"
        >
          {companyName}
        </Link>
      </div>
    </TableCell>
    ```
  - [ ] Badge color: Blue for Mainboard, Green for SME, Purple for FPO
  - [ ] Link opens in same tab (default)

- [ ] Implement sortable columns (AC: 5)
  - [ ] Sortable columns: Company Name, Issue Open, Issue Close, Listing Date, Issue Size, Listing Day Gain %, Current Gain %
  - [ ] Click handler on sortable column headers:
    ```typescript
    const handleSort = (column: string) => {
      onSort(column);
    };
    ```
  - [ ] Sort icon indicators in column headers:
    - No icon: Column not sorted
    - ↑ icon: Ascending sort
    - ↓ icon: Descending sort
  - [ ] First click: Descending order
  - [ ] Second click: Ascending order
  - [ ] Third click: Remove sort (default to listing date desc)

- [ ] Implement color-coding for percentage columns (AC: 8)
  - [ ] Color-coding logic:
    ```typescript
    const getPercentageColor = (percent: number | null) => {
      if (percent === null) return 'text-gray-400';
      if (percent > 0) return 'text-green-600 font-bold';
      if (percent < 0) return 'text-red-600 font-bold';
      return 'text-gray-900';
    };
    ```
  - [ ] Apply to columns: Listing Day Gain/Loss (%), Current Gain/Loss (%)
  - [ ] Display with 2 decimal places: `{percent.toFixed(2)}%`

- [ ] Format all data fields correctly (AC: 3)
  - [ ] Date formatting: Use `date-fns` library
    ```typescript
    import { format } from 'date-fns';
    const formattedDate = format(new Date(date), 'MMM dd, yyyy');
    ```
  - [ ] Currency formatting: `₹${amount.toLocaleString('en-IN')}`
  - [ ] Percentage formatting: `${percent.toFixed(2)}%`
  - [ ] Subscription formatting: `${subscription.toFixed(2)}x`
  - [ ] Market Cap formatting: `₹${(marketCap / 100).toFixed(2)} Cr` (convert to crores)

- [ ] Add total records count display (AC: 17)
  - [ ] Display above table:
    ```typescript
    <p className="text-sm text-gray-600 mb-2">
      Showing {((currentPage - 1) * 50) + 1}-{Math.min(currentPage * 50, totalCount)} of {totalCount} listings
    </p>
    ```

- [ ] Implement mobile responsive layout (AC: 12)
  - [ ] Mobile (< 1024px): Table with horizontal scroll
  - [ ] Add wrapper: `<div className="overflow-x-auto">`
  - [ ] Table has fixed minimum width: `min-width: 2400px` (to fit all 19 columns)
  - [ ] Sticky first column (Company Name) for better mobile UX (optional enhancement)

### Phase 4: Category Tabs Navigation Component (AC: 2)

- [ ] Create category tabs component file (AC: 2)
  - [ ] Create file: `web/components/listings/ListingCategoryTabs.tsx`
  - [ ] Server component (default, no 'use client')
  - [ ] Component receives current category as prop

- [ ] Implement 3-tab navigation (AC: 2)
  - [ ] Props interface:
    ```typescript
    interface ListingCategoryTabsProps {
      activeCategory: 'MAINBOARD' | 'SME' | 'FPO';
    }
    ```
  - [ ] Tab layout:
    ```typescript
    <div className="border-b border-gray-200 mb-6">
      <nav className="flex space-x-8">
        <Link
          href="/mainboard-ipo-listings"
          className={cn(
            "py-4 px-1 border-b-2 font-medium text-sm",
            activeCategory === 'MAINBOARD'
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
          )}
        >
          Mainboard IPO Listings
        </Link>
        <Link
          href="/sme-ipo-listings"
          className={cn(...)}
        >
          SME IPO Listings
        </Link>
        <Link
          href="/fpo-listings"
          className={cn(...)}
        >
          FPO Listings
        </Link>
      </nav>
    </div>
    ```
  - [ ] Active tab highlighted with bottom border and color
  - [ ] Clicking tab navigates to respective page
  - [ ] Responsive: Stack vertically on mobile if needed

### Phase 5: Year Dropdown Filter Component (AC: 4)

- [ ] Create year filter component file (AC: 4)
  - [ ] Create file: `web/components/listings/YearFilter.tsx`
  - [ ] Mark as client component: `'use client'` (for dropdown interaction)
  - [ ] Component receives current year and onChange handler

- [ ] Implement year dropdown (AC: 4)
  - [ ] Props interface:
    ```typescript
    interface YearFilterProps {
      currentYear: number;
      availableYears: number[];
      onYearChange: (year: number) => void;
    }
    ```
  - [ ] Use shadcn/ui Select component:
    ```typescript
    <Select value={String(currentYear)} onValueChange={(value) => onYearChange(parseInt(value, 10))}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Select year" />
      </SelectTrigger>
      <SelectContent>
        {availableYears.map((year) => (
          <SelectItem key={year} value={String(year)}>
            {year}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    ```
  - [ ] Default: Current year dynamically (new Date().getFullYear())
  - [ ] Available years: 2020-2026 + current year if beyond 2026
  - [ ] Changing year calls onYearChange callback

### Phase 6: Pagination Component (AC: 16, 17)

- [ ] Create pagination component file (AC: 16)
  - [ ] Create file: `web/components/listings/ListingsPagination.tsx`
  - [ ] Mark as client component: `'use client'` (for page navigation)
  - [ ] Component receives pagination state and handlers

- [ ] Implement pagination UI (AC: 16, 17)
  - [ ] Props interface:
    ```typescript
    interface ListingsPaginationProps {
      currentPage: number;
      totalPages: number;
      onPageChange: (page: number) => void;
    }
    ```
  - [ ] Pagination layout:
    ```typescript
    <div className="flex items-center justify-between mt-6">
      <Button
        variant="outline"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
      >
        Previous
      </Button>
      <span className="text-sm text-gray-600">
        Page {currentPage} of {totalPages}
      </span>
      <Button
        variant="outline"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
      >
        Next
      </Button>
    </div>
    ```
  - [ ] Disabled state for buttons when at first/last page
  - [ ] Optional: Add page number buttons for direct navigation (1, 2, 3, ..., 10)

### Phase 7: Page Implementation - Mainboard IPO Listings (AC: 1, 4, 9, 11, 13, 14, 15, 18, 20, 21, 22, 23)

- [ ] Create Mainboard page file (AC: 1)
  - [ ] Create directory: `web/app/mainboard-ipo-listings/`
  - [ ] Create file: `web/app/mainboard-ipo-listings/page.tsx`
  - [ ] Server component (async) for data fetching

- [ ] Configure ISR revalidation (AC: 11)
  - [ ] Add revalidate export:
    ```typescript
    export const revalidate = 300; // 5 minutes in seconds
    ```

- [ ] Implement page metadata (AC: 15, 23)
  - [ ] Add metadata export:
    ```typescript
    import type { Metadata } from 'next';

    export const metadata: Metadata = {
      title: 'Mainboard IPO Listings 2025 - Post-Listing Performance & Analysis | IPODhan',
      description: 'Comprehensive Mainboard IPO listings with post-listing performance data including subscription, GMP, listing gains, current prices, and market cap. Track all listed Mainboard IPOs with detailed 19-column performance analysis.',
      keywords: 'mainboard ipo listings, ipo performance, post listing performance, ipo subscription data, ipo gmp, listing gains, current prices, market cap, India',
      openGraph: {
        title: 'Mainboard IPO Listings 2025 - Post-Listing Performance',
        description: 'Track post-listing performance of all Mainboard IPOs with detailed metrics',
        type: 'website',
      }
    };
    ```

- [ ] Implement server-side data fetching (AC: 1, 4, 9, 11)
  - [ ] Import service function: `import { fetchIPOListings, fetchAvailableYears } from '@/lib/services/ipo-listings-service';`
  - [ ] Parse year and page from searchParams with dynamic current year:
    ```typescript
    const currentYear = parseInt(searchParams?.year || String(new Date().getFullYear()), 10);
    const currentPage = parseInt(searchParams?.page || '1', 10);
    const sortColumn = searchParams?.sortColumn || 'listingDate';
    const sortDirection = searchParams?.sortDirection || 'desc';
    ```
  - [ ] Fetch listings data:
    ```typescript
    const { data, totalCount, totalPages } = await fetchIPOListings({
      category: 'MAINBOARD',
      year: currentYear,
      sortColumn,
      sortDirection,
      page: currentPage,
      limit: 50
    });
    ```
  - [ ] Fetch available years: `const availableYears = await fetchAvailableYears();`
  - [ ] Error handling with try-catch, graceful degradation
  - [ ] **NOTE**: Server fetches in default order, client-side sorting applies to current page only

- [ ] Create client component wrapper for interactive elements (AC: 4, 5, 16)
  - [ ] Create client component for year filter, sorting, and pagination:
    ```typescript
    'use client';

    function ListingsControlsWrapper({
      defaultYear,
      defaultPage,
      defaultSortColumn,
      defaultSortDirection,
      availableYears,
      totalPages
    }: {
      defaultYear: number;
      defaultPage: number;
      defaultSortColumn?: string;
      defaultSortDirection?: 'asc' | 'desc';
      availableYears: number[];
      totalPages: number;
    }) {
      const router = useRouter();
      const pathname = usePathname();

      const handleYearChange = (year: number) => {
        const params = new URLSearchParams(window.location.search);
        params.set('year', String(year));
        params.delete('page'); // Reset to page 1 on year change
        router.push(`${pathname}?${params.toString()}`);
      };

      const handleSort = (column: string) => {
        const params = new URLSearchParams(window.location.search);
        const currentSortColumn = params.get('sortColumn');
        const currentSortDirection = params.get('sortDirection');

        let newDirection: 'asc' | 'desc' = 'desc';
        if (currentSortColumn === column && currentSortDirection === 'desc') {
          newDirection = 'asc';
        }

        params.set('sortColumn', column);
        params.set('sortDirection', newDirection);
        router.push(`${pathname}?${params.toString()}`);
      };

      const handlePageChange = (page: number) => {
        const params = new URLSearchParams(window.location.search);
        params.set('page', String(page));
        router.push(`${pathname}?${params.toString()}`);
      };

      return (
        <>
          <YearFilter
            currentYear={defaultYear}
            availableYears={availableYears}
            onYearChange={handleYearChange}
          />
          {/* Sort and pagination handlers passed to table */}
        </>
      );
    }
    ```

- [ ] Render page layout (AC: 1, 2, 13, 14, 21, 23)
  - [ ] Page structure:
    ```typescript
    export default async function MainboardIPOListingsPage({ searchParams }: { searchParams: any }) {
      // Data fetching (above)

      return (
        <div className="container mx-auto px-4 py-8">
          {/* Page Title and Breadcrumbs */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-2">Mainboard IPO Listings</h1>
            <p className="text-gray-600">
              Track post-listing performance of all Mainboard IPOs with comprehensive data including subscription, GMP, listing gains, current market prices, and market capitalization.
            </p>
          </div>

          {/* Category Tabs Navigation */}
          <ListingCategoryTabs activeCategory="MAINBOARD" />

          {/* Year Filter */}
          <div className="flex justify-between items-center mb-4">
            <ListingsControlsWrapper
              defaultYear={currentYear}
              defaultPage={currentPage}
              defaultSortColumn={sortColumn}
              defaultSortDirection={sortDirection}
              availableYears={availableYears}
              totalPages={totalPages}
            />
          </div>

          {/* Listings Table */}
          {data.length > 0 ? (
            <>
              <IPOListingsTable
                data={data}
                totalCount={totalCount}
                currentPage={currentPage}
                totalPages={totalPages}
                category="MAINBOARD"
                onSort={handleSort}
                sortColumn={sortColumn}
                sortDirection={sortDirection}
              />
              <ListingsPagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            </>
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-500 text-lg">
                No Mainboard IPO listings found for {currentYear}
              </p>
            </div>
          )}
        </div>
      );
    }
    ```

- [ ] Add loading skeleton (AC: 14)
  - [ ] Create loading.tsx file in same directory:
    ```typescript
    // web/app/mainboard-ipo-listings/loading.tsx
    export default function Loading() {
      return (
        <div className="container mx-auto px-4 py-8">
          <Skeleton className="h-12 w-3/4 mb-6" />
          <Skeleton className="h-10 w-full mb-4" />
          <Skeleton className="h-96 w-full" />
        </div>
      );
    }
    ```

### Phase 8: Page Implementation - SME IPO Listings (AC: 1, 9, 13, 15)

- [ ] Create SME page file (AC: 1)
  - [ ] Create directory: `web/app/sme-ipo-listings/`
  - [ ] Create file: `web/app/sme-ipo-listings/page.tsx`
  - [ ] Server component (async) for data fetching

- [ ] Configure ISR revalidation (AC: 11)
  - [ ] Add revalidate export: `export const revalidate = 300;`

- [ ] Implement page metadata (AC: 15)
  - [ ] Add metadata export:
    ```typescript
    export const metadata: Metadata = {
      title: 'SME IPO Listings 2025 - Post-Listing Performance & Analysis | IPODhan',
      description: 'Comprehensive SME IPO listings with post-listing performance data including subscription, GMP, listing gains, current prices, and market cap. Track all listed SME IPOs on BSE SME and NSE Emerge platforms.',
      keywords: 'sme ipo listings, sme ipo performance, bse sme, nse emerge, post listing performance, ipo subscription data, ipo gmp, India',
      openGraph: {
        title: 'SME IPO Listings 2025 - Post-Listing Performance',
        description: 'Track post-listing performance of all SME IPOs with detailed metrics',
        type: 'website',
      }
    };
    ```

- [ ] Implement server-side data fetching (AC: 1, 9)
  - [ ] Same structure as Mainboard page
  - [ ] Category filter: `category: 'SME'`
  - [ ] All other features identical to Mainboard page

- [ ] Render page layout (AC: 1, 2, 9, 13)
  - [ ] Same structure as Mainboard page
  - [ ] Page title: "SME IPO Listings"
  - [ ] Category tabs: activeCategory="SME"
  - [ ] Description mentions BSE SME and NSE Emerge
  - [ ] Empty state: "No SME IPO listings found for {year}"

- [ ] Add loading skeleton (AC: 14)
  - [ ] Create loading.tsx file in same directory

### Phase 9: Page Implementation - FPO Listings (AC: 1, 9, 13, 15)

- [ ] Create FPO page file (AC: 1)
  - [ ] Create directory: `web/app/fpo-listings/`
  - [ ] Create file: `web/app/fpo-listings/page.tsx`
  - [ ] Server component (async) for data fetching

- [ ] Configure ISR revalidation (AC: 11)
  - [ ] Add revalidate export: `export const revalidate = 300;`

- [ ] Implement page metadata (AC: 15)
  - [ ] Add metadata export:
    ```typescript
    export const metadata: Metadata = {
      title: 'FPO Listings 2025 - Follow-on Public Offer Performance | IPODhan',
      description: 'Comprehensive FPO (Follow-on Public Offer) listings with post-listing performance data including subscription, GMP, listing gains, current prices, and market cap. Track all listed FPOs in India.',
      keywords: 'fpo listings, follow-on public offer, fpo performance, post listing performance, fpo subscription data, India',
      openGraph: {
        title: 'FPO Listings 2025 - Follow-on Public Offer Performance',
        description: 'Track post-listing performance of all FPOs with detailed metrics',
        type: 'website',
      }
    };
    ```

- [ ] Implement server-side data fetching (AC: 1, 9)
  - [ ] Same structure as Mainboard page
  - [ ] Category filter: `category: 'FPO'`
  - [ ] All other features identical to Mainboard page

- [ ] Render page layout (AC: 1, 2, 9, 13)
  - [ ] Same structure as Mainboard page
  - [ ] Page title: "FPO Listings"
  - [ ] Category tabs: activeCategory="FPO"
  - [ ] Description explains FPO (Follow-on Public Offer)
  - [ ] Empty state: "No FPO listings found for {year}"

- [ ] Add loading skeleton (AC: 14)
  - [ ] Create loading.tsx file in same directory

### Phase 10: Navigation Integration (AC: 22)

- [ ] Add navigation links to main menu (AC: 22)
  - [ ] Locate header component: `web/components/layout/Header.tsx` or similar
  - [ ] Find main navigation menu
  - [ ] Add "IPO Listings" dropdown menu item:
    ```typescript
    <NavigationMenu>
      <NavigationMenuItem>
        <NavigationMenuTrigger>IPO Listings</NavigationMenuTrigger>
        <NavigationMenuContent>
          <ul className="grid w-[400px] gap-3 p-4">
            <li>
              <Link href="/mainboard-ipo-listings">
                <div className="font-medium">Mainboard IPO Listings</div>
                <p className="text-sm text-muted-foreground">
                  Post-listing performance of Mainboard IPOs
                </p>
              </Link>
            </li>
            <li>
              <Link href="/sme-ipo-listings">
                <div className="font-medium">SME IPO Listings</div>
                <p className="text-sm text-muted-foreground">
                  Post-listing performance of SME IPOs
                </p>
              </Link>
            </li>
            <li>
              <Link href="/fpo-listings">
                <div className="font-medium">FPO Listings</div>
                <p className="text-sm text-muted-foreground">
                  Follow-on Public Offer performance
                </p>
              </Link>
            </li>
          </ul>
        </NavigationMenuContent>
      </NavigationMenuItem>
    </NavigationMenu>
    ```
  - [ ] Verify dropdown functionality on desktop and mobile
  - [ ] Verify navigation link styling matches existing menu items

### Phase 11: Testing (AC: All)

- [ ] Create test data fixtures
  - [ ] Create file: `web/tests/fixtures/ipo-listings.fixture.ts`
  - [ ] Add sample Mainboard IPO listings data (10-15 records)
  - [ ] Add sample SME IPO listings data (10-15 records)
  - [ ] Add sample FPO listings data (5-10 records)
  - [ ] Include all 19 columns with realistic data
  - [ ] Add edge case fixtures:
    - IPO with zero listing gain (flat listing)
    - IPO with negative listing gain (listing loss)
    - IPO with missing GMP data
    - IPO with missing subscription data
    - IPO with different BSE and NSE prices
    - IPO with missing allotment date
  - [ ] Export fixtures

- [ ] Write unit tests for service layer
  - [ ] Test file: `web/tests/unit/lib/services/ipo-listings-service.test.ts`
  - [ ] Test: `fetchIPOListings()` with category=MAINBOARD returns only Mainboard IPOs
  - [ ] Test: `fetchIPOListings()` with category=SME returns only SME IPOs
  - [ ] Test: `fetchIPOListings()` with category=FPO returns only FPO IPOs
  - [ ] Test: `fetchIPOListings()` with year filter returns only IPOs from that year
  - [ ] Test: `fetchIPOListings()` with sortColumn and sortDirection sorts correctly
  - [ ] Test: `fetchIPOListings()` pagination returns correct page and totalPages
  - [ ] Test: Listing day gain percentage calculated correctly
  - [ ] Test: Current gain percentage calculated correctly
  - [ ] Test: Market cap calculated correctly
  - [ ] Test: Error handling returns empty data array
  - [ ] Test: `fetchAvailableYears()` returns years array
  - [ ] Mock API client with test fixtures

- [ ] Write unit tests for components
  - [ ] Test file: `web/tests/unit/components/listings/IPOListingsTable.test.tsx`
    - Test: Renders table with 19 columns
    - Test: Displays all data correctly
    - Test: Company name links to IPO detail page
    - Test: Category badge displayed with correct color
    - Test: Color-coded percentages (green/red)
    - Test: Date formatting correct (MMM DD, YYYY)
    - Test: Currency formatting correct (₹ symbol)
    - Test: Percentage formatting correct (% symbol)
    - Test: Subscription formatting correct (x suffix)
    - Test: Sort icon indicators displayed
    - Test: Clicking sortable column calls onSort handler
    - Test: Total records count displayed
  - [ ] Test file: `web/tests/unit/components/listings/ListingCategoryTabs.test.tsx`
    - Test: Renders 3 tabs
    - Test: Active tab highlighted
    - Test: Links navigate to correct URLs
  - [ ] Test file: `web/tests/unit/components/listings/YearFilter.test.tsx`
    - Test: Renders dropdown with years
    - Test: Changing year calls onYearChange handler
  - [ ] Test file: `web/tests/unit/components/listings/ListingsPagination.test.tsx`
    - Test: Renders pagination controls
    - Test: Previous/Next buttons functional
    - Test: Previous button disabled on page 1
    - Test: Next button disabled on last page
    - Test: Clicking page buttons calls onPageChange handler

- [ ] Write integration tests for pages
  - [ ] Test file: `web/tests/integration/pages/mainboard-listings.integration.test.tsx`
  - [ ] Test: Page renders successfully
  - [ ] Test: Page renders with year query param (?year=2024)
  - [ ] Test: Page renders with page query param (?page=2)
  - [ ] Test: Data fetched and displayed correctly
  - [ ] Test: Empty state shown when no data
  - [ ] Test: Error handling - page renders even if fetch fails
  - [ ] Test: Year filter changes update URL
  - [ ] Test: Sort changes update URL
  - [ ] Test: Pagination changes update URL
  - [ ] Mock service layer

- [ ] Write E2E tests
  - [ ] Test file: `web/tests/e2e/ipo-listings.spec.ts`
  - [ ] Test: Navigate to `/mainboard-ipo-listings`
  - [ ] Test: Page loads successfully
  - [ ] Test: Table displays with 19 columns
  - [ ] Test: All 3 category tabs visible
  - [ ] Test: Click SME tab → navigates to `/sme-ipo-listings`
  - [ ] Test: Click FPO tab → navigates to `/fpo-listings`
  - [ ] Test: Year dropdown changes → URL updates with year param
  - [ ] Test: Click sortable column header → URL updates with sort params
  - [ ] Test: Click Next pagination button → URL updates with page param
  - [ ] Test: Click company name → navigates to IPO detail page
  - [ ] Test: Positive percentages displayed in green
  - [ ] Test: Negative percentages displayed in red
  - [ ] Test: Total records count displayed
  - [ ] Test: Responsive - resize viewport to mobile → horizontal scroll enabled
  - [ ] Test: Navigate to page with no data (e.g., ?year=2010) → empty state displayed
  - [ ] Test: Click "IPO Listings" in navigation → dropdown menu visible
  - [ ] Test: Click navigation link → navigates to page

- [ ] Manual testing checklist
  - [ ] Navigate to `/mainboard-ipo-listings` (AC: 1)
  - [ ] Verify page loads without errors
  - [ ] Verify 3 category tabs displayed (AC: 2):
    - Mainboard IPO Listings (active)
    - SME IPO Listings
    - FPO Listings
  - [ ] Click SME tab → navigates to `/sme-ipo-listings` (AC: 2)
  - [ ] Click FPO tab → navigates to `/fpo-listings` (AC: 2)
  - [ ] Verify table displays all 19 columns (AC: 3):
    - Company Name, Issue Open, Issue Close, Listing Date
    - Issue Price, Issue Size, Lot Size
    - Subscription (Overall, QIB, NII, Retail)
    - GMP, Allotment Date
    - Listing Day Close, Listing Day Gain %
    - Current Price BSE, Current Price NSE, Current Gain %
    - Market Cap
  - [ ] Verify all date fields formatted (MMM DD, YYYY) (AC: 3)
  - [ ] Verify all currency fields show ₹ symbol (AC: 3)
  - [ ] Verify all percentage fields show % symbol (AC: 3)
  - [ ] Verify subscription data shows "x" suffix (AC: 3)
  - [ ] Test year dropdown (AC: 4):
    - Dropdown shows years 2020-2026
    - Default: 2025 (current year)
    - Change year to 2024 → URL updates: `?year=2024`
    - Data filters to 2024 listings
  - [ ] Test sortable columns (AC: 5):
    - Click Company Name header → sorts alphabetically
    - Click again → reverses sort direction
    - Click Issue Open header → sorts by date
    - Click Listing Day Gain % header → sorts by percentage
    - Sort icon indicators show current sort direction
  - [ ] Verify NO search functionality present (AC: 6)
  - [ ] Test company name link (AC: 7):
    - Click company name → navigates to `/ipos/[slug]`
    - Hover → underline appears
    - Opens in same tab
  - [ ] Verify color-coding (AC: 8):
    - Positive percentages: Green text, bold
    - Negative percentages: Red text, bold
    - Zero: Default text color
  - [ ] Verify category filtering (AC: 9):
    - Mainboard page shows only Mainboard IPOs
    - SME page shows only SME IPOs
    - FPO page shows only FPO IPOs
  - [ ] Verify category badge displayed (AC: 10)
  - [ ] Verify ISR - check response headers for cache-control (AC: 11)
  - [ ] Resize to mobile (375px) → horizontal scroll enabled (AC: 12)
  - [ ] Navigate to page with no data (e.g., ?year=2010) → empty state displayed (AC: 13):
    - "No Mainboard IPO listings found for 2010"
    - "No SME IPO listings found for 2010"
    - "No FPO listings found for 2010"
  - [ ] Test loading states (throttle network) → skeleton visible (AC: 14)
  - [ ] View page source → metadata tags present (AC: 15):
    - Mainboard: "Mainboard IPO Listings 2025"
    - SME: "SME IPO Listings 2025"
    - FPO: "FPO Listings 2025"
  - [ ] Test pagination (AC: 16, 17):
    - Click Next button → navigates to page 2
    - URL updates: `?page=2`
    - Previous button disabled on page 1
    - Next button disabled on last page
    - Total records count displays: "Showing 1-50 of 147 listings"
  - [ ] Performance testing (AC: 18):
    - LCP < 2 seconds (measure with Lighthouse)
    - Table renders smoothly without lag
    - Sorting is instant (client-side)
  - [ ] Verify data accuracy (AC: 19):
    - Subscription data matches latest snapshot
    - GMP data matches latest record
    - Listing performance calculations correct
    - Current prices up-to-date
  - [ ] No console errors or warnings (AC: 20)
  - [ ] Compare page design to reference image (AC: 21):
    - `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Listing Date.png`
  - [ ] Verify navigation links in header/menu (AC: 22):
    - "IPO Listings" dropdown visible
    - Links to all three pages
  - [ ] Verify page title and breadcrumbs (AC: 23):
    - Mainboard page: "Mainboard IPO Listings"
    - SME page: "SME IPO Listings"
    - FPO page: "FPO Listings"

### Phase 12: Documentation & Cleanup

- [ ] Update architecture documentation
  - [ ] Add IPO Listings pages to `docs/architecture/frontend-architecture.md`
  - [ ] Document routing:
    - `/mainboard-ipo-listings` page
    - `/sme-ipo-listings` page
    - `/fpo-listings` page
  - [ ] Document component hierarchy
  - [ ] Document state management approach (URL query params for year, sort, pagination)

- [ ] Add JSDoc comments to all new code
  - [ ] Service functions documented
  - [ ] Component props documented
  - [ ] Complex logic explained
  - [ ] Calculations documented (gain %, market cap)

- [ ] Code review checklist
  - [ ] All TypeScript types correct
  - [ ] No console.log statements (except error logging)
  - [ ] Code follows project coding standards
  - [ ] Imports organized (React, Next.js, local, UI components)
  - [ ] No unused variables or imports
  - [ ] Error handling comprehensive
  - [ ] Loading states implemented
  - [ ] Empty states implemented
  - [ ] Responsive design verified
  - [ ] Accessibility considered
  - [ ] SEO optimizations applied
  - [ ] Performance optimizations applied (ISR, caching, client-side sorting)

- [ ] Create completion summary
  - [ ] List all files created
  - [ ] List all files modified
  - [ ] Document any deviations from original plan
  - [ ] Note any assumptions made
  - [ ] Document any technical decisions

## Dev Notes

### Story Context

This story creates **THREE comprehensive IPO Listings pages** that display post-listing performance data with extensive metrics. These pages serve as detailed performance tracking tables for investors to analyze IPO outcomes across Mainboard, SME, and FPO categories. Each page features a **19-column table** with cross-navigation tabs for easy switching between categories.

**Key Implementation Details:**
- Three pages: `/mainboard-ipo-listings`, `/sme-ipo-listings`, `/fpo-listings`
- Each page filters by category (MAINBOARD, SME, or FPO)
- 19 comprehensive columns covering entire IPO lifecycle
- Cross-navigation tabs on each page for quick category switching
- Year dropdown filter (2020-2026, default: 2025)
- Sortable columns (7 sortable fields)
- NO search functionality - clean, simple interface
- Pagination: 50 records per page
- ISR: 5-minute revalidation
- Responsive: Horizontal scroll on mobile for wide table

**Design Reference:**
- Primary design: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Listing Date.png`
- Related features (future):
  - Anchor Investors: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Anchor Investors.png`
  - Allotment Status: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO Allotment Status.png`

**19 Columns Breakdown:**
1-4: Basic Info (Company, Open, Close, Listing dates)
5-7: Issue Details (Price, Size, Lot)
8-11: Subscription (Overall, QIB, NII, Retail)
12-13: GMP & Allotment
14-15: Listing Performance (Close Price, Gain %)
16-18: Current Performance (BSE Price, NSE Price, Gain %)
19: Market Cap

### Architecture Context

**Tech Stack** [Source: docs/architecture/tech-stack.md]:
- Next.js 14.2+ with TypeScript 5.3+
- React Server Components (default) and Client Components ('use client')
- shadcn/ui components (Table, Select, Button, Badge, Skeleton, Tabs)
- ISR (Incremental Static Regeneration) with `export const revalidate = 300` (5 minutes)
- Vitest for unit/integration tests
- Playwright for E2E tests

**Project Structure** [Source: docs/architecture/unified-project-structure.md]:
- Pages:
  - `web/app/mainboard-ipo-listings/page.tsx` (App Router)
  - `web/app/sme-ipo-listings/page.tsx`
  - `web/app/fpo-listings/page.tsx`
- Components: `web/components/listings/` (Listings-specific components)
  - `IPOListingsTable.tsx` - Comprehensive 19-column table
  - `ListingCategoryTabs.tsx` - Cross-navigation tabs
  - `YearFilter.tsx` - Year dropdown component
  - `ListingsPagination.tsx` - Pagination controls
- Service: `web/lib/services/ipo-listings-service.ts` (Data fetching layer)
- API: `web/app/api/ipos/listings/route.ts` (API endpoint)
- Tests: `web/tests/unit/`, `web/tests/integration/`, `web/tests/e2e/`

**Naming Conventions** [Source: docs/architecture/coding-standards.md]:
- Page files: `page.tsx` (Next.js convention)
- Component files: PascalCase (e.g., `IPOListingsTable.tsx`)
- Service files: kebab-case (e.g., `ipo-listings-service.ts`)
- Functions: camelCase (e.g., `fetchIPOListings`)

### Data Model Context

**IPO Entity** [Source: docs/architecture/data-models.md]:
```typescript
export enum IPOCategory {
  MAINBOARD = 'MAINBOARD',
  SME = 'SME',
  RIGHTS = 'RIGHTS',
  NCD = 'NCD',
  FPO = 'FPO'  // NOTE: May need to be added to enum
}

export enum IPOStatus {
  UPCOMING = 'UPCOMING',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  LISTED = 'LISTED'  // Filter for this status
}

export interface IPO {
  id: string;
  companyName: string;
  slug: string;
  category: IPOCategory;
  sector: string;
  issueSize: number;          // Total issue amount in INR crores
  priceRange: PriceRange;
  lotSize: number;
  status: IPOStatus;
  dates: IPODates;            // openDate, closeDate, allotmentDate, listingDate
  companyDescription: string;
  faceValue: number;
  listingExchanges: ('NSE' | 'BSE')[];
  registrar: string;
  leadManagers: string[];
  rating: number | null;
  ratingRationale: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

**ListingPerformance Entity** [Source: docs/architecture/data-models.md]:
```typescript
export interface ListingPerformance {
  id: string;
  ipoId: string;
  listingPrice: number;       // Listing day close price
  issuePrice: number;
  listingGainPercent: number; // Listing day gain %
  currentPrice: number | null; // Current price (BSE or NSE - may need separate fields)
  currentGainPercent: number | null; // Current gain %
  lastUpdated: Date;
}
```

**IMPORTANT NOTE**: The design requires separate current prices for BSE and NSE. The current `ListingPerformance` interface has a single `currentPrice` field. This story may need to:
1. Add `currentPriceBSE` and `currentPriceNSE` fields to `ListingPerformance` table/interface, OR
2. Use a workaround where `currentPrice` represents the primary exchange price and add a new field for the secondary exchange

**Subscription Entity** [Source: docs/architecture/data-models.md]:
```typescript
export interface Subscription {
  id: string;
  ipoId: string;
  timestamp: Date;
  qibSubscription: number;
  niiSubscription: number;
  retailSubscription: number;
  totalSubscription: number;
  employeeSubscription: number;
  othersSubscription: number;
  // ... other fields
}
```

**GMPRecord Entity** [Source: docs/architecture/data-models.md]:
```typescript
export interface GMPRecord {
  id: string;
  ipoId: string;
  timestamp: Date;
  gmp: number;                // Grey Market Premium
  expectedListingPrice: number;
  subjectRate: number | null;
  kostakRate: number | null;
  saudaDetails: string | null;
  source: string;
}
```

**Data Requirements**:
- IPO table with `category=MAINBOARD`, `category=SME`, or `category=FPO`
- FPO category may need to be added to `ipoCategoryEnum`
- ListingPerformance table with current prices (possibly need separate BSE/NSE fields)
- Subscription table for subscription data
- GMPRecord table for GMP data
- All IPOs must have `status=LISTED` for these pages

### API Integration Context

**API Endpoints** [Source: docs/architecture/api-specification.md]:
- Endpoint: `GET /api/ipos`
- Supports filters:
  - `category`: Filter by IPO type (MAINBOARD, SME, RIGHTS, NCD, FPO)
  - `status`: Filter by status (UPCOMING, OPEN, CLOSED, LISTED)
  - `year`: Filter by year (based on listingDate)
  - `limit`: Limit number of results
  - `page`: Pagination page number
- Example queries:
  - `GET /api/ipos?category=MAINBOARD&status=LISTED` - Listed Mainboard IPOs
  - `GET /api/ipos?category=SME&status=LISTED` - Listed SME IPOs
  - `GET /api/ipos?category=FPO&status=LISTED` - Listed FPOs

**NEW API Endpoint (This Story)**:
- Endpoint: `GET /api/ipos/listings`
- Purpose: Dedicated endpoint for listings pages with all 19 columns of data
- Supports filters:
  - `category`: MAINBOARD | SME | FPO (required)
  - `year`: Filter by listing year (optional, default: current year)
  - `sortColumn`: Column to sort by (optional)
  - `sortDirection`: asc | desc (optional)
  - `page`: Page number (optional, default: 1)
- Response includes: IPO data + ListingPerformance + Subscription + GMP data (JOINed)
- Caching: 5 minutes (ISR revalidation)

**API Client** [Source: docs/architecture/frontend-architecture.md]:
- Location: `web/lib/api-client.ts`
- Function: `getIPOs(params)` - Returns list of IPOs with filters
- Type-safe APIError class for error handling
- Example usage:
  ```typescript
  import { apiClient } from '@/lib/api-client';
  const ipos = await apiClient.getIPOs({
    category: IPOCategory.MAINBOARD,
    status: IPOStatus.LISTED,
    limit: 50
  });
  ```

### Component Architecture

**Server vs Client Components**:
- **Page Components** (`page.tsx`): Server components (async)
  - Fetch all listings data server-side
  - Render initial HTML with data
  - Handle searchParams for year, sort, and page state
  - Better SEO, faster initial load
- **IPOListingsTable Component**: Client component ('use client')
  - Requires interactivity (sorting state)
  - Receives data as props, manages UI state only
  - Uses useState for sort column/direction (optional - could be server-side)
- **ListingCategoryTabs Component**: Server component (default)
  - Static navigation links
  - No interactivity needed
- **YearFilter Component**: Client component ('use client')
  - Requires interactivity (dropdown onChange handler)
  - Uses Next.js router for navigation
  - Updates URL query params
- **ListingsPagination Component**: Client component ('use client')
  - Requires interactivity (page navigation)
  - Uses Next.js router for navigation

**State Management Strategy**:
- **Year State**: URL query params (shareable, bookmarkable)
  - Default: `/mainboard-ipo-listings` (current year)
  - With year: `/mainboard-ipo-listings?year=2024`
  - Server reads from searchParams
  - Client updates via router.push()
- **Sort State**: URL query params
  - Default: No sort params (default to listingDate desc)
  - With sort: `/mainboard-ipo-listings?sortColumn=companyName&sortDirection=asc`
  - Applied server-side (sort in service layer) OR client-side (sort in component)
  - **Recommendation**: Client-side sorting for instant UX (data already fetched)
- **Page State**: URL query params
  - Default: `/mainboard-ipo-listings` (page 1)
  - With page: `/mainboard-ipo-listings?page=2`
  - Server-side pagination (fetch only 50 records per page)
- **Data State**: Server-side fetching (no client state)
  - Data fetched on server
  - Passed as props to components
  - No useState or useEffect needed
- **Loading State**: Server-side rendering (ISR pre-rendering)
  - Page is pre-rendered with ISR
  - Skeleton only shown during client navigation transitions

### Routing Context

**Next.js App Router** [Source: docs/architecture/frontend-architecture.md]:
- File-based routing
- Page files:
  - `app/mainboard-ipo-listings/page.tsx` → `/mainboard-ipo-listings`
  - `app/sme-ipo-listings/page.tsx` → `/sme-ipo-listings`
  - `app/fpo-listings/page.tsx` → `/fpo-listings`
- URL query params: `?year=2025&sortColumn=companyName&sortDirection=asc&page=2`
- Navigation:
  - Header dropdown: "IPO Listings" → submenu with links to all three pages
  - Category tabs: Click tab to switch between pages
  - Year change: Update URL with year param
  - Sort: Update URL with sort params
  - Pagination: Update URL with page param

### Responsive Design Context

**Tailwind Breakpoints** [Source: docs/architecture/tech-stack.md]:
- `sm`: 640px (small devices)
- `md`: 768px (medium devices - tablets)
- `lg`: 1024px (large devices - desktops)
- Mobile-first approach (default styles for mobile, add `md:` for desktop)

**Responsive Strategy for Listings Pages**:
- **Desktop (>= 1024px)**: Full 19-column table with horizontal scroll if needed
  - Table container: `<div className="overflow-x-auto">`
  - Table has minimum width to accommodate all columns (approx. 2400px)
- **Tablet (768px - 1023px)**: Same as desktop with horizontal scroll
- **Mobile (< 768px)**: Horizontal scroll enabled
  - Table is scrollable horizontally
  - First column (Company Name) could be sticky for better UX (optional)
  - Alternative: Could consider card layout for mobile (future enhancement)

**Note**: The design reference shows a wide table that will naturally require horizontal scrolling on smaller screens. This is acceptable for data-heavy tables.

### SEO Optimization Context

**Metadata Requirements** [Source: docs/architecture/frontend-architecture.md]:
- Title: Include year (2025), category (Mainboard/SME/FPO), and keywords
- Description: Mention key features (19 columns, post-listing performance, subscription data, GMP, current prices)
- Keywords: Listings-specific terms (ipo listings, post-listing performance, subscription data, gmp, current prices, market cap)
- Open Graph: Social sharing tags
- Examples provided in Phase 7-9 tasks

**Structured Data**:
- Schema.org type: CollectionPage with ItemList
- Include: Total listings count, list of IPOs (limited to 10 for schema size)
- Optional for MVP - can be added in future enhancement

### ISR Configuration

**Incremental Static Regeneration**:
- Enable with: `export const revalidate = 300;` (5 minutes)
- How it works:
  1. Page generated statically at build time
  2. First request serves cached page (instant)
  3. After 5 minutes, next request triggers background regeneration
  4. Stale page served while regenerating
  5. New page cached and served to subsequent requests
- Benefits:
  - Fast page loads (static serving)
  - Fresh data (5-minute updates for current prices, GMP)
  - Low server load (caching)
  - SEO-friendly (static HTML)
- Rationale for 5 minutes: Listings pages show current prices that may change frequently during market hours

### Error Handling Strategy

**Service Layer Error Handling** [Source: docs/architecture/coding-standards.md]:
- **Never throw errors** from service functions
- Always return empty data array on error
- Log errors to console (server-side)
- Graceful degradation (page still renders)
- Example:
  ```typescript
  export async function fetchIPOListings(filters: ListingsFilters): Promise<ListingsResponse> {
    try {
      const ipos = await apiClient.getIPOs({ category: filters.category, status: IPOStatus.LISTED });
      // Process data, JOIN with other tables
      return { data, totalCount, currentPage, totalPages };
    } catch (error) {
      console.error('Error fetching IPO listings:', error);
      return {
        data: [],
        totalCount: 0,
        currentPage: 1,
        totalPages: 0
      }; // Empty result, not thrown error
    }
  }
  ```

**Component Error Handling**:
- Components handle empty data arrays gracefully
- Show empty state messages for each page
- No error boundaries needed (service never throws)
- Page always renders (header, tabs, empty state)

### UI Component Library

**shadcn/ui Components to Use** [Source: docs/architecture/tech-stack.md]:
- **Table**: `@/components/ui/table` (Table, TableHeader, TableBody, TableRow, TableHead, TableCell)
- **Select**: `@/components/ui/select` (Select, SelectTrigger, SelectContent, SelectItem) - For year dropdown
- **Button**: `@/components/ui/button` - For pagination, sorting
- **Badge**: `@/components/ui/badge` - For category badges
- **Skeleton**: `@/components/ui/skeleton` - For loading states
- **Tabs**: `@/components/ui/tabs` (optional) - Alternative to custom tabs component

**Import Pattern**:
```typescript
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
```

### Data Fetching and JOIN Strategy

**Multi-Table Data Aggregation**:
- IPO Listings pages require data from 4 tables:
  1. `ipos` table - Base IPO info
  2. `listingPerformance` table - Listing and current performance
  3. `subscriptions` table - Subscription data
  4. `gmpRecords` table - GMP data

**Approach Options**:

**Option 1: Service Layer JOINs** (Recommended)
- Service function fetches from all 4 tables
- Uses database JOINs for efficiency (single query)
- Example:
  ```sql
  SELECT
    ipos.*,
    lp.listingPrice, lp.currentPrice, lp.listingGainPercent, lp.currentGainPercent,
    s.qibSubscription, s.niiSubscription, s.retailSubscription, s.totalSubscription,
    gmp.gmp
  FROM ipos
  LEFT JOIN listingPerformance lp ON ipos.id = lp.ipoId
  LEFT JOIN (
    SELECT DISTINCT ON (ipoId) * FROM subscriptions
    ORDER BY ipoId, timestamp DESC
  ) s ON ipos.id = s.ipoId
  LEFT JOIN (
    SELECT DISTINCT ON (ipoId) * FROM gmpRecords
    ORDER BY ipoId, timestamp DESC
  ) gmp ON ipos.id = gmp.ipoId
  WHERE ipos.category = $1 AND ipos.status = 'LISTED'
  ```
- Pros: Efficient, single database query
- Cons: More complex SQL, requires repository layer changes

**Option 2: API Client Aggregation**
- Service function fetches IPOs, then fetches related data for each IPO
- Multiple API calls (N+1 query pattern)
- Pros: Uses existing API endpoints, simpler implementation
- Cons: Less efficient (multiple queries), slower

**Recommendation**: Use Option 1 (Service Layer JOINs) for better performance

### Calculations and Formulas

**Listing Day Gain Percentage**:
- Formula: `((listingClose - issuePrice) / issuePrice) × 100`
- Example: Issue Price = ₹100, Listing Close = ₹150 → Gain = 50%
- Stored in `listingPerformance.listingGainPercent` (pre-calculated)

**Current Gain Percentage**:
- Formula: `((currentPrice - issuePrice) / issuePrice) × 100`
- Example: Issue Price = ₹100, Current Price = ₹180 → Gain = 80%
- Calculated in service layer or stored in `listingPerformance.currentGainPercent`

**Market Capitalization**:
- Formula: `currentPrice × totalShares`
- Example: Current Price = ₹150, Total Shares = 10 million → Market Cap = ₹1500 Cr
- Note: `totalShares` may need to be calculated from `issueSize` and `issuePrice`
- Simplification for MVP: Market Cap = `issueSize × (currentPrice / issuePrice)`

**Subscription Format**:
- Display: `{subscription.toFixed(2)}x`
- Example: 2.45 → "2.45x", 12.50 → "12.50x"

**Currency Format**:
- Display: `₹{amount.toLocaleString('en-IN')}`
- Example: 350 → "₹350", 1500 → "₹1,500"

**Date Format**:
- Display: `format(new Date(date), 'MMM dd, yyyy')` (using date-fns)
- Example: 2025-01-15 → "Jan 15, 2025"

### Sorting Strategy

**Client-Side vs Server-Side Sorting**:

**Client-Side Sorting** (Recommended):
- Data fetched once per page (50 records)
- Sorting done in browser using JavaScript
- Instant UX - no page reload
- Implementation:
  ```typescript
  const sortedData = useMemo(() => {
    if (!sortColumn) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortColumn];
      const bValue = b[sortColumn];

      if (sortDirection === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
  }, [data, sortColumn, sortDirection]);
  ```
- Pros: Fast, no network request, better UX
- Cons: Only sorts current page (not all data)

**Server-Side Sorting**:
- Sorting done in database query
- Requires page reload on sort change
- Pros: Sorts across all data (not just current page)
- Cons: Slower UX, additional server load

**Recommendation**: Use client-side sorting for better UX. Each page only has 50 records, which is easily sortable in browser.

### Pagination Strategy

**Server-Side Pagination** (Recommended):
- Fetch only 50 records per page from database
- Reduces data transfer and memory usage
- Implementation:
  - Calculate offset: `offset = (page - 1) × limit`
  - SQL: `LIMIT 50 OFFSET ${offset}`
  - Calculate totalPages: `totalPages = Math.ceil(totalCount / limit)`
- Navigation:
  - Previous button: `page - 1` (disabled on page 1)
  - Next button: `page + 1` (disabled on last page)
  - Page number display: "Page {page} of {totalPages}"
- URL updates: `?page=2`

**Client-Side Pagination**:
- Fetch all data, paginate in browser
- Pros: Instant navigation
- Cons: Large data transfer, memory usage
- Not recommended for listings pages (potentially hundreds of records)

### File Modifications Required

**Files to Create**:
1. `web/app/mainboard-ipo-listings/page.tsx` - Mainboard listings page
2. `web/app/mainboard-ipo-listings/loading.tsx` - Loading skeleton
3. `web/app/sme-ipo-listings/page.tsx` - SME listings page
4. `web/app/sme-ipo-listings/loading.tsx` - Loading skeleton
5. `web/app/fpo-listings/page.tsx` - FPO listings page
6. `web/app/fpo-listings/loading.tsx` - Loading skeleton
7. `web/app/api/ipos/listings/route.ts` - API endpoint for listings data
8. `web/components/listings/IPOListingsTable.tsx` - 19-column table component
9. `web/components/listings/ListingCategoryTabs.tsx` - Category tabs navigation
10. `web/components/listings/YearFilter.tsx` - Year dropdown component
11. `web/components/listings/ListingsPagination.tsx` - Pagination controls
12. `web/lib/services/ipo-listings-service.ts` - Data fetching service
13. `web/tests/unit/lib/services/ipo-listings-service.test.ts` - Service tests
14. `web/tests/unit/components/listings/IPOListingsTable.test.tsx` - Component tests
15. `web/tests/unit/components/listings/ListingCategoryTabs.test.tsx` - Component tests
16. `web/tests/unit/components/listings/YearFilter.test.tsx` - Component tests
17. `web/tests/unit/components/listings/ListingsPagination.test.tsx` - Component tests
18. `web/tests/integration/pages/mainboard-listings.integration.test.tsx` - Integration tests
19. `web/tests/e2e/ipo-listings.spec.ts` - E2E tests
20. `web/tests/fixtures/ipo-listings.fixture.ts` - Test data fixtures

**Files to Modify**:
1. `web/components/layout/Header.tsx` (or navigation component) - Add "IPO Listings" dropdown menu
2. `packages/shared/src/types/ipo.ts` - Add FPO to IPOCategory enum (if not exists)
3. `packages/shared/src/types/listing.ts` - Possibly add currentPriceBSE and currentPriceNSE fields
4. `docs/architecture/frontend-architecture.md` - Document new listings pages

**Files to Check**:
1. `web/lib/db/schema.ts` - Verify schema supports all required fields (especially FPO category, current prices)
2. `web/app/api/ipos/route.ts` - Verify API endpoint supports FPO category filter
3. `web/lib/api-client.ts` - Verify getIPOs() function signature

### Known Limitations and Future Enhancements

**Current Limitations**:

1. **BSE and NSE Current Prices**:
   - Design requires separate current prices for BSE and NSE
   - Current `ListingPerformance` interface may only have single `currentPrice` field
   - **MVP Approach**: Use primary exchange price for both columns, OR add separate fields to schema
   - **Future Enhancement**: Add `currentPriceBSE` and `currentPriceNSE` fields to `listingPerformance` table

2. **Market Cap Calculation**:
   - Requires `totalShares` which may not be directly available
   - **MVP Approach**: Estimate from `issueSize` and `issuePrice`
   - **Future Enhancement**: Add `totalShares` field to `ipos` table for accurate calculation

3. **Real-Time Data**:
   - Current prices updated by scraper, not real-time
   - 5-minute ISR revalidation means prices could be stale
   - **Future Enhancement**: Add real-time price updates via WebSocket or polling

4. **Advanced Filtering**:
   - MVP only has year filter
   - No sector filter, issue size range, subscription range, etc.
   - **Future Enhancement**: Add advanced filter options

5. **Sorting Across All Data**:
   - Client-side sorting only sorts current page (50 records)
   - **Future Enhancement**: Server-side sorting to sort across all pages

6. **Export Functionality**:
   - No CSV/Excel export in MVP
   - **Future Enhancement**: Add export button to download listings data

7. **Comparison Feature**:
   - No multi-IPO comparison in MVP
   - **Future Enhancement**: Add checkbox column to select IPOs for comparison

8. **Historical Price Charts**:
   - No price charts in listings table
   - **Future Enhancement**: Add mini charts showing price trend since listing

### Dependencies and Prerequisites

**Required Dependencies** (should already be installed):
- Next.js 14.2+ ✅
- TypeScript 5.3+ ✅
- React 19+ ✅
- shadcn/ui components ✅
- date-fns (date formatting) ✅
- Vitest (testing) ✅
- Playwright (E2E testing) ✅

**Required Prerequisites**:
- API endpoint `/api/ipos` supports category and status filters ✅ (verify in Phase 0)
- Database has MAINBOARD, SME, and FPO categories in IPO enum (verify FPO in Phase 0)
- ListingPerformance table exists with listing and current performance data (verify in Phase 0)
- Subscription table exists (verify in Phase 0)
- GMPRecord table exists (verify in Phase 0)
- IPOs have status=LISTED for these pages ✅

**Potential Blockers**:
- If FPO category doesn't exist in schema → Need to add to `ipoCategoryEnum` and run migration
- If ListingPerformance table doesn't have separate BSE/NSE price fields → Need to add fields or use workaround
- If current price data not available → Graceful handling with "N/A" or empty cells
- If subscription/GMP data not available → Graceful handling with "N/A"
- Design reference image missing → Need to clarify 19-column layout

**No New Dependencies Needed**: This story uses existing tech stack

## Testing

[Source: docs/architecture/testing-strategy.md]

**Test File Locations:**
- Unit tests:
  - Service: `web/tests/unit/lib/services/ipo-listings-service.test.ts`
  - Components: `web/tests/unit/components/listings/*.test.tsx`
- Integration tests: `web/tests/integration/pages/mainboard-listings.integration.test.tsx`
- E2E tests: `web/tests/e2e/ipo-listings.spec.ts`

**Testing Frameworks:**
- Vitest for unit and integration tests (already configured in `web/vitest.config.ts`)
- Playwright for E2E tests (already configured in `web/playwright.config.ts`)

**Test Standards:**
- All service functions must have unit tests
- All components must have unit tests
- All pages must have integration tests
- Critical user workflows must have E2E tests
- Tests must use TypeScript
- Mock external dependencies (API client) in unit tests
- Use test database for integration tests

**Coverage Targets:**
- Service Layer: >90% code coverage
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
| 2025-10-12 | 1.0 | Initial story draft created for Story 9.17 (IPO Listings Pages) based on Epic 9 lines 1072-1226. Story creates THREE comprehensive IPO Listings pages (Mainboard, SME, FPO) displaying post-listing performance data with 19 columns including subscription data, GMP, listing performance, and current market prices. Each page features cross-navigation tabs, year filter, sortable columns, pagination (50 records/page), and ISR with 5-minute revalidation. All acceptance criteria (23 total) derived from Epic 9 specification. Components organized in web/components/listings/ directory. Service layer in web/lib/services/ipo-listings-service.ts. API endpoint in web/app/api/ipos/listings/route.ts. Design reference: CG-IPO Listing Date.png. | Bob (Scrum Master) |
| 2025-10-12 | 2.0 | **PO REVIEW CRITICAL FIXES - YOLO MODE BATCH UPDATE**<br><br>**CRITICAL CHANGES:**<br>1. Created prerequisite Story 9.17a for schema migration (FPO category + currentPriceBSE/NSE fields)<br>2. Updated Phase 0 with explicit BLOCKER checks and HALT instructions (lines 91-121)<br>3. Added prerequisite note to AC 3 referencing Story 9.17a completion requirement (line 25)<br><br>**HIGH PRIORITY CHANGES:**<br>4. Added explicit JOIN query guidance in Phase 1 with SQL example using LATERAL joins (lines 212-246)<br>5. Clarified sorting + pagination conflict - client-side sorting on current page only (AC 5, line 41-42)<br>6. Updated year filter to use dynamic default: new Date().getFullYear() instead of hardcoded 2025 (AC 4, Phase 5, Phase 7)<br>7. Added market cap calculation verification step in Phase 1 (line 251)<br>8. Enhanced security validation - added URL parameter validation for year (2000-2100) and page (1-10000) ranges in API endpoint (lines 295-309)<br><br>**MEDIUM PRIORITY CHANGES:**<br>9. Added edge case test fixtures for Phase 11 (lines 920-926): zero gain, negative gain, missing data, different BSE/NSE prices<br><br>**STORY DEPENDENCIES:**<br>- Story 9.17 now BLOCKED by Story 9.17a (schema migration prerequisite)<br>- Story 9.17a created and ready for development<br>- Estimated effort for 9.17a: 3 hours<br>- Risk level: LOW (additive schema changes only)<br><br>All changes implemented per PO review feedback. Story updated and ready for approval pending Story 9.17a completion. | Bob (Scrum Master) |

## Dev Agent Record

### Agent Model Used
_To be filled by Dev agent during implementation_

### Debug Log References
_To be filled by Dev agent during implementation_

### Completion Notes List
_To be filled by Dev agent during implementation_

### File List
_To be filled by Dev agent during implementation_

## QA Results
_To be filled by QA agent after validation_
