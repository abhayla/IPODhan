# Story 9.16: SME IPOs Landing Page

## Status
Ready

## Story

**As a** investor seeking comprehensive SME IPO information,
**I want** to access a dedicated SME IPOs landing page that serves as a central hub combining summary metrics, content sections, navigation to dedicated pages, and detailed IPO listings,
**so that** I can quickly understand the current state of SME IPO market, access all SME IPO features from one place, and make informed investment decisions with a complete overview of SME platform opportunities (BSE SME and NSE Emerge).

## Acceptance Criteria

1. SME IPOs landing page accessible at `/sme-ipos`
2. Navigation menu "SME IPOs" is both clickable (goes to landing page) AND has dropdown on hover
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
16. Only SME IPOs displayed (category=SME filter applied throughout)
17. Minimize/maximize toggle works smoothly
18. Educational header explains SME IPOs and SME platform (BSE SME, NSE Emerge)
19. Page uses ISR with 5-minute revalidation
20. Responsive: All sections adapt properly to mobile/tablet/desktop
21. Loading skeletons display during data fetch
22. SEO metadata configured (title, description, keywords)
23. Navigation link in main menu functions correctly

## Tasks / Subtasks

### Phase 0: Prerequisites Verification and Design Review

- [ ] Verify design reference images exist (AC: All)
  - [ ] Check `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO SME Summary.png` exists (summary metrics dashboard reference)
  - [ ] Check `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO SME List.png` exists (detailed table reference)
  - [ ] Review both images to understand layout requirements
  - [ ] Document any design clarifications needed

- [ ] Verify database schema supports landing page features (AC: 3, 4, 6, 8)
  - [ ] Confirm `ipos` table has all required fields: companyName, openDate, closeDate, listingDate, issuePrice, issueSize, leadManagers, category
  - [ ] Verify `listingPerformance` table exists with currentPrice field for performance metrics
  - [ ] Check `subscriptions` table supports latest subscription data fetching
  - [ ] Verify `ipoReviews` table exists for reviews section (created in 9.14)
  - [ ] Confirm category enum includes SME value
  - [ ] If any schema missing: Document blockers and notify team

- [ ] Verify shared types support landing page data (AC: 3, 4, 8)
  - [ ] Check `packages/shared/src/types/ipo.ts` exports IPO interface with all required fields
  - [ ] Verify IPOCategory.SME enum value exists
  - [ ] Check ListingPerformance interface includes currentPrice, listingGainPercent
  - [ ] Verify Subscription interface for subscription status section
  - [ ] Check IPOReview interface for reviews section
  - [ ] If types missing: Add to shared types package before proceeding

- [ ] Verify API supports landing page data fetching (AC: 3, 4, 8, 16)
  - [ ] Test `/api/ipos?category=SME` endpoint returns SME IPOs only
  - [ ] Verify `/api/ipos?category=SME&status=OPEN` for current IPOs
  - [ ] Verify `/api/ipos?category=SME&status=UPCOMING` for upcoming IPOs
  - [ ] Verify `/api/ipos?category=SME&status=LISTED` for recently listed
  - [ ] Check listing performance API endpoint availability
  - [ ] Check reviews API endpoint availability (created in 9.14)
  - [ ] If API endpoints missing: Create before proceeding

### Phase 1: Service Layer - Data Fetching Functions (AC: 3, 4, 16)

- [ ] Create SME landing service file (AC: 3, 4, 16)
  - [ ] Create file: `web/lib/services/sme-landing-service.ts`
  - [ ] Import required types from shared package:
    ```typescript
    import { IPO, IPOCategory, IPOStatus } from '@/types/ipo';
    import { ListingPerformance } from '@/types/listing';
    import { Subscription } from '@/types/subscription';
    import { IPOReview } from '@/types/review';
    import { apiClient } from '@/lib/api-client';
    ```
  - [ ] Add JSDoc comment explaining service purpose: "SME IPOs Landing Page data fetching service"

- [ ] Implement summary metrics calculation function (AC: 3, 16)
  - [ ] Function signature:
    ```typescript
    export interface SMESummaryMetrics {
      totalIPOs: number;
      listedInGain: number;
      listedInLoss: number;
      upcomingAndOngoing: number;
      gainAOT: number;        // All Over Time gain percentage
      lossAOT: number;        // All Over Time loss percentage
    }

    export async function getSMESummaryMetrics(): Promise<SMESummaryMetrics>
    ```
  - [ ] Fetch all SME IPOs: `apiClient.getIPOs({ category: IPOCategory.SME })`
  - [ ] Calculate totalIPOs: Count of all SME IPOs
  - [ ] Calculate listedInGain: Count where status=LISTED AND currentPrice > issuePrice
  - [ ] Calculate listedInLoss: Count where status=LISTED AND currentPrice < issuePrice
  - [ ] Calculate upcomingAndOngoing: Count where status IN (UPCOMING, OPEN)
  - [ ] Calculate gainAOT: Average gain % across all profitable listed IPOs
  - [ ] Calculate lossAOT: Average loss % across all loss-making listed IPOs
  - [ ] Add error handling with fallback zero values
  - [ ] Return typed metrics object

- [ ] Implement content sections data functions (AC: 4, 16)
  - [ ] Create `getSMECurrentIPOs()` function:
    ```typescript
    export async function getSMECurrentIPOs(): Promise<IPO[]>
    ```
    - Fetch IPOs with: category=SME, status=OPEN
    - Limit to 6 items
    - Sort by closeDate ascending (closing soonest first)
  - [ ] Create `getSMEUpcomingIPOs()` function:
    ```typescript
    export async function getSMEUpcomingIPOs(): Promise<IPO[]>
    ```
    - Fetch IPOs with: category=SME, status=UPCOMING
    - Limit to 6 items
    - Sort by openDate ascending (opening soonest first)
  - [ ] Create `getSMERecentlyListedIPOs()` function:
    ```typescript
    export async function getSMERecentlyListedIPOs(): Promise<IPO[]>
    ```
    - Fetch IPOs with: category=SME, status=LISTED
    - Limit to 6 items
    - Sort by listingDate descending (newest first)
  - [ ] Create `getSMEReviews()` function:
    ```typescript
    export interface ReviewWithIPO {
      review: IPOReview;
      ipo: IPO;
    }
    export async function getSMEReviews(): Promise<ReviewWithIPO[]>
    ```
    - Fetch reviews with: category=SME
    - Limit to 6 items
    - Sort by publishedDate descending (newest first)
  - [ ] Create `getSMEPerformanceHighlights()` function:
    ```typescript
    export interface PerformanceHighlight {
      ipo: IPO;
      performance: ListingPerformance;
      gainPercent: number;
    }
    export async function getSMEPerformanceHighlights(): Promise<{
      topGainers: PerformanceHighlight[];
      topLosers: PerformanceHighlight[];
    }>
    ```
    - Fetch listed SME IPOs with performance data
    - Calculate gain/loss percentages
    - Return top 3 gainers and top 3 losers
  - [ ] Create `getSMESubscriptionStatus()` function:
    ```typescript
    export interface SubscriptionStatusData {
      ipo: IPO;
      subscription: Subscription;
    }
    export async function getSMESubscriptionStatus(): Promise<SubscriptionStatusData[]>
    ```
    - Fetch current/recent SME IPOs with subscription data
    - Limit to 6 items
    - Include latest subscription snapshot per IPO

- [ ] Implement detailed table data function (AC: 8, 10, 11, 16)
  - [ ] Function signature:
    ```typescript
    export interface DetailedTableFilters {
      year?: number;
      companySearch?: string;
      leadManagerSearch?: string;
      sortColumn?: string;
      sortDirection?: 'asc' | 'desc';
    }

    export async function getSMEDetailedList(
      filters?: DetailedTableFilters
    ): Promise<{ data: IPO[], totalCount: number }>
    ```
  - [ ] Fetch all SME IPOs: category=SME
  - [ ] Apply year filter if provided (filter by openDate year)
  - [ ] Apply company search filter (fuzzy match on companyName)
  - [ ] Apply lead manager search filter (fuzzy match on leadManagers array)
  - [ ] Apply sorting based on sortColumn and sortDirection
  - [ ] Default sort: openDate descending (newest first)
  - [ ] Calculate total count for display
  - [ ] Return paginated data (consider pagination in future enhancement)

- [ ] Add error handling and exports
  - [ ] Wrap all functions in try-catch with console.error logging
  - [ ] Return empty arrays/zero values on error (graceful degradation)
  - [ ] Export all interfaces and functions
  - [ ] Verify no TypeScript errors

### Phase 2: Summary Metrics Component (AC: 3)

- [ ] Create summary metrics component file (AC: 3)
  - [ ] Create file: `web/components/sme/SMESummaryMetrics.tsx`
  - [ ] Server component (default, no 'use client')
  - [ ] Component receives metrics data as props

- [ ] Define component interface and implement layout (AC: 3)
  - [ ] Props interface:
    ```typescript
    interface SMESummaryMetricsProps {
      metrics: SMESummaryMetrics;
    }
    ```
  - [ ] Component structure:
    ```typescript
    export function SMESummaryMetrics({ metrics }: SMESummaryMetricsProps) {
      // 6 metric cards in responsive grid
    }
    ```
  - [ ] Grid layout: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`
  - [ ] Card component: Use shadcn/ui Card component

- [ ] Implement 6 metric cards (AC: 3)
  - [ ] Card 1: Total SME IPOs
    - Icon: 📊 or trending up icon
    - Value: `{metrics.totalIPOs}`
    - Label: "Total SME IPOs"
  - [ ] Card 2: IPOs Listed in Gain
    - Icon: ✅ or check circle icon
    - Value: `{metrics.listedInGain}` (green color)
    - Label: "Listed in Gain"
  - [ ] Card 3: IPOs Listed in Loss
    - Icon: ❌ or cross circle icon
    - Value: `{metrics.listedInLoss}` (red color)
    - Label: "Listed in Loss"
  - [ ] Card 4: Upcoming & OnGoing IPOs
    - Icon: 🔔 or bell icon
    - Value: `{metrics.upcomingAndOngoing}`
    - Label: "Upcoming & OnGoing"
  - [ ] Card 5: IPOs in Gain (AOT)
    - Icon: 📈 or trending up icon
    - Value: `{metrics.gainAOT}%` (green color)
    - Label: "Gain (All Over Time)"
  - [ ] Card 6: IPOs in Loss (AOT)
    - Icon: 📉 or trending down icon
    - Value: `{metrics.lossAOT}%` (red color)
    - Label: "Loss (All Over Time)"

- [ ] Add styling and responsive design (AC: 3, 20)
  - [ ] Cards have consistent height and padding
  - [ ] Icons positioned top-left or centered
  - [ ] Values in large font size (text-3xl or text-4xl)
  - [ ] Labels in smaller, muted text
  - [ ] Responsive: 1 column on mobile, 2 on tablet, 3 on desktop
  - [ ] Hover effect: subtle shadow or border highlight

### Phase 3: Content Sections Component (AC: 4, 5)

- [ ] Create content sections component file (AC: 4)
  - [ ] Create file: `web/components/sme/SMEContentSections.tsx`
  - [ ] Server component (default, no 'use client')
  - [ ] Component receives all content data as props

- [ ] Define component interface (AC: 4)
  - [ ] Props interface:
    ```typescript
    interface SMEContentSectionsProps {
      currentIPOs: IPO[];
      upcomingIPOs: IPO[];
      recentlyListedIPOs: IPO[];
      reviews: ReviewWithIPO[];
      performanceHighlights: {
        topGainers: PerformanceHighlight[];
        topLosers: PerformanceHighlight[];
      };
      subscriptionStatus: SubscriptionStatusData[];
    }
    ```

- [ ] Implement section 1: Current IPOs (AC: 4, 5)
  - [ ] Section title: "Current IPOs" with "View All" link → `/sme-ipos?filter=current`
  - [ ] Grid layout: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`
  - [ ] Display 4-6 IPO cards
  - [ ] Card content:
    - Company name (bold, link to `/ipos/[slug]`)
    - Open date, close date
    - Issue size
    - Subscription status (if available)
    - Badge: "OPEN" (green)
  - [ ] Empty state: "No current SME IPOs"

- [ ] Implement section 2: Upcoming IPOs (AC: 4, 5)
  - [ ] Section title: "Upcoming IPOs" with "View All" link → `/sme-ipos?filter=upcoming`
  - [ ] Grid layout: same as Current IPOs
  - [ ] Display 4-6 IPO cards
  - [ ] Card content:
    - Company name (bold, link to `/ipos/[slug]`)
    - Open date (highlighted)
    - Issue size
    - Badge: "UPCOMING" (blue)
  - [ ] Empty state: "No upcoming SME IPOs"

- [ ] Implement section 3: Recently Listed IPOs (AC: 4, 5)
  - [ ] Section title: "Recently Listed IPOs" with "View All" link → `/sme-ipos?filter=listed`
  - [ ] Grid layout: same as Current IPOs
  - [ ] Display 4-6 IPO cards
  - [ ] Card content:
    - Company name (bold, link to `/ipos/[slug]`)
    - Listing date
    - Listing price
    - Current price
    - Gain/loss % (color-coded: green/red)
    - Badge: "LISTED" (gray)
  - [ ] Empty state: "No recently listed SME IPOs"

- [ ] Implement section 4: Reviews (AC: 4, 5)
  - [ ] Section title: "IPO Reviews & Analysis" with "View All" link → `/sme-ipo-reviews`
  - [ ] Grid layout: same as above
  - [ ] Display 4-6 review cards
  - [ ] Card content:
    - Review title (bold, link to `/ipo-reviews/[reviewId]`)
    - IPO company name
    - Author name
    - Recommendation badge ("Subscribe", "May apply", "Avoid")
    - Published date
  - [ ] Empty state: "No SME IPO reviews available"

- [ ] Implement section 5: Performance Highlights (AC: 4, 5)
  - [ ] Section title: "Performance Highlights" with "View All" link → `/sme-ipo-performance-tracker`
  - [ ] Two subsections: "Top Gainers" and "Top Losers"
  - [ ] Grid layout for each: 3 columns
  - [ ] Top Gainers (3 cards):
    - Company name (link)
    - Gain % (green, bold)
    - Current price vs issue price
  - [ ] Top Losers (3 cards):
    - Company name (link)
    - Loss % (red, bold)
    - Current price vs issue price
  - [ ] Empty state: "No performance data available"

- [ ] Implement section 6: Subscription Status (AC: 4, 5)
  - [ ] Section title: "Subscription Status" with "View All" link → `/sme-ipos?filter=current`
  - [ ] Grid layout: same as above
  - [ ] Display 4-6 subscription cards
  - [ ] Card content:
    - Company name (link)
    - Total subscription (x times, e.g., "12.5x")
    - QIB subscription
    - NII subscription
    - Retail subscription
    - Color coding based on subscription level (>1x green, <1x red)
  - [ ] Empty state: "No subscription data available"

- [ ] Add responsive design and styling (AC: 20)
  - [ ] All sections have consistent spacing (mb-8 or mb-12)
  - [ ] Section titles: text-2xl, font-semibold
  - [ ] "View All" links: text-blue-600, hover:underline
  - [ ] Cards: consistent padding, shadow, hover effects
  - [ ] Mobile: single column, tablet: 2 columns, desktop: 3 columns

### Phase 4: Navigation Cards Component (AC: 6)

- [ ] Create navigation cards component file (AC: 6)
  - [ ] Create file: `web/components/sme/SMENavigationCards.tsx`
  - [ ] Server component (default, no 'use client')
  - [ ] No props needed (static navigation links)

- [ ] Implement 4 navigation cards (AC: 6)
  - [ ] Grid layout: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`
  - [ ] Card 1: SME IPO Performance Tracker
    - Icon: 📊 or chart icon
    - Title: "Performance Tracker"
    - Description: "Track post-listing performance of SME IPOs"
    - Link: `/sme-ipo-performance-tracker`
    - Hover effect: scale up slightly
  - [ ] Card 2: SME IPO Prospectus
    - Icon: 📄 or document icon
    - Title: "IPO Prospectus"
    - Description: "Download DRHP and RHP documents"
    - Link: `/sme-ipo-prospectus`
  - [ ] Card 3: SME IPO Calendar
    - Icon: 📅 or calendar icon
    - Title: "IPO Calendar"
    - Description: "View SME IPO events and timelines"
    - Link: `/sme-ipo-calendar`
  - [ ] Card 4: SME IPO Reviews
    - Icon: ⭐ or star icon
    - Title: "IPO Reviews & Analysis"
    - Description: "Expert recommendations and analysis"
    - Link: `/sme-ipo-reviews`

- [ ] Add card styling (AC: 6, 20)
  - [ ] Cards: border, rounded corners, padding
  - [ ] Icon: large size, centered or top-left
  - [ ] Title: text-xl, font-semibold
  - [ ] Description: text-sm, text-muted-foreground
  - [ ] Hover effect: shadow increase, border color change
  - [ ] Clickable: entire card is a link (use Next.js Link wrapper)
  - [ ] Responsive: 1 column on mobile, 2 on tablet, 4 on desktop

### Phase 5: Detailed Table Component (AC: 7, 8, 9, 13, 14, 15, 17)

- [ ] Create detailed table component file (AC: 8)
  - [ ] Create file: `web/components/sme/SMEDetailedTable.tsx`
  - [ ] Mark as client component: `'use client'` (for minimize/maximize toggle and sorting)
  - [ ] Component receives data and filter functions as props

- [ ] Define component interface (AC: 8)
  - [ ] Props interface:
    ```typescript
    interface SMEDetailedTableProps {
      ipoData: IPO[];
      totalCount: number;
      year: number;
      defaultMinimized?: boolean;
      onYearChange: (year: number) => void;
      onFilterChange: (filterName: string, value: string) => void;
      onSort: (column: string) => void;
    }
    ```

- [ ] Implement minimize/maximize toggle (AC: 7, 17)
  - [ ] State: `const [isMinimized, setIsMinimized] = useState(defaultMinimized || false);`
  - [ ] Toggle button in section header:
    ```typescript
    <Button
      variant="outline"
      onClick={() => setIsMinimized(!isMinimized)}
    >
      {isMinimized ? 'Maximize Table' : 'Minimize Table'}
    </Button>
    ```
  - [ ] Conditional rendering: Show table only if `!isMinimized`
  - [ ] Smooth transition: Use CSS transition or framer-motion

- [ ] Implement table structure with 9 columns (AC: 8, 16)
  - [ ] Use shadcn/ui Table component
  - [ ] Desktop layout (>= 768px): Full 9-column table
  - [ ] Columns:
    1. Company (clickable link to `/ipos/[slug]`)
    2. Opening Date (formatted: MMM DD, YYYY)
    3. Closing Date (formatted: MMM DD, YYYY)
    4. Listing Date (formatted: MMM DD, YYYY or "TBD")
    5. Issue Price (₹, formatted)
    6. Total Issue Amount (₹ Crores)
    7. Listing at (Exchange: NSE Emerge, BSE SME, or Both)
    8. Lead Manager (display first manager, tooltip for all)
    9. Compare (checkbox or button for comparison feature)
  - [ ] Add responsive class: `<div className="hidden md:block overflow-x-auto">`
  - [ ] Table row data filtered to show only SME category

- [ ] Implement column-level search (AC: 9)
  - [ ] Search row below header row
  - [ ] Company search input:
    ```typescript
    <Input
      type="text"
      placeholder="Search company..."
      onChange={(e) => onFilterChange('companySearch', e.target.value)}
    />
    ```
  - [ ] Lead Manager search input: similar to company search
  - [ ] Other columns: no search (keep clean)
  - [ ] Debounce search inputs: 300ms delay

- [ ] Implement status indicators (AC: 12)
  - [ ] Add status column or badge in Company cell
  - [ ] "Issue open" badge: Green, if status=OPEN and today between openDate and closeDate
  - [ ] "Issue close but not listed" badge: Yellow, if status=CLOSED and listingDate is null
  - [ ] "Listing today" badge: Blue, if listingDate = today
  - [ ] Conditional rendering based on IPO dates and status

- [ ] Implement sortable columns (AC: 13)
  - [ ] State:
    ```typescript
    const [sortColumn, setSortColumn] = useState<string>('openDate');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    ```
  - [ ] Sortable columns: Company, Opening Date, Closing Date, Listing Date, Issue Price, Total Issue Amount
  - [ ] Click handler on column headers:
    ```typescript
    const handleSort = (column: string) => {
      const newDirection = sortColumn === column && sortDirection === 'asc' ? 'desc' : 'asc';
      setSortColumn(column);
      setSortDirection(newDirection);
      onSort(column);
    };
    ```
  - [ ] Sort icon indicators (↑↓) in column headers
  - [ ] Default sort: Opening Date descending (newest first)

- [ ] Implement color-coded rows (AC: 15)
  - [ ] Green background: IPO currently open (today between openDate and closeDate)
  - [ ] Yellow background: IPO closing within 2 days (closeDate within 2 days from today)
  - [ ] White/default: All other IPOs
  - [ ] Apply row background color dynamically:
    ```typescript
    <TableRow className={getRowColor(ipo)}>
    ```
  - [ ] Function `getRowColor(ipo: IPO)`:
    - Check if today is between openDate and closeDate → return 'bg-green-50'
    - Check if closeDate is within 2 days → return 'bg-yellow-50'
    - Otherwise → return 'bg-white'

- [ ] Add total records count display (AC: 14)
  - [ ] Display above table: `Total Records: {totalCount}`
  - [ ] Style: text-sm, text-gray-600

- [ ] Implement mobile card layout (AC: 20)
  - [ ] Mobile layout (< 768px): Card-based layout
  - [ ] Import Card component
  - [ ] Display all 9 fields in compact card format
  - [ ] Add links for "Company" field
  - [ ] Add class: `<div className="md:hidden">`

### Phase 6: Year Navigation Component (AC: 10, 11)

- [ ] Create year navigation component file (AC: 10)
  - [ ] Create file: `web/components/sme/YearNavigation.tsx`
  - [ ] Mark as client component: `'use client'` (for interactivity)
  - [ ] Component receives current year and onChange handler

- [ ] Implement year navigation UI (AC: 10)
  - [ ] Props interface:
    ```typescript
    interface YearNavigationProps {
      currentYear: number;
      onYearChange: (year: number) => void;
    }
    ```
  - [ ] Layout:
    ```typescript
    <div className="flex items-center justify-between mb-4">
      <Button onClick={() => onYearChange(currentYear - 1)}>
        &lt;&lt; Year {currentYear - 1}
      </Button>
      <h2 className="text-xl font-semibold">{currentYear}</h2>
      <Button onClick={() => onYearChange(currentYear + 1)}>
        Year {currentYear + 1} &gt;&gt;
      </Button>
    </div>
    ```
  - [ ] Buttons: variant="outline"
  - [ ] Center year display prominently

- [ ] Implement URL update on year change (AC: 11)
  - [ ] Parent component handles URL update via router.push()
  - [ ] Year navigation component calls onYearChange callback
  - [ ] URL format: `/sme-ipos?year={year}`

### Phase 7: Landing Page Integration (AC: 1, 2, 18, 19, 20, 21, 22, 23)

- [ ] Create page file (AC: 1)
  - [ ] Create directory: `web/app/sme-ipos/`
  - [ ] Create file: `web/app/sme-ipos/page.tsx`
  - [ ] Server component (async) for data fetching

- [ ] Configure ISR revalidation (AC: 19)
  - [ ] Add revalidate export:
    ```typescript
    export const revalidate = 300; // 5 minutes in seconds
    ```

- [ ] Implement page metadata (AC: 22)
  - [ ] Add metadata export:
    ```typescript
    import type { Metadata } from 'next';

    export const metadata: Metadata = {
      title: 'SME IPOs 2025 - Complete Hub | IPODhan',
      description: 'Access comprehensive SME IPO information including current, upcoming, and listed IPOs on BSE SME and NSE Emerge platforms. View performance metrics, reviews, prospectus documents, and IPO calendar.',
      keywords: 'sme ipo, sme ipo 2025, bse sme, nse emerge, sme platform, ipo performance, ipo reviews, ipo calendar, India',
      openGraph: {
        title: 'SME IPOs 2025 - Complete Hub',
        description: 'Comprehensive SME IPO hub with metrics, reviews, and detailed listings',
        type: 'website',
      }
    };
    ```

- [ ] Implement server-side data fetching (AC: 3, 4, 16, 19)
  - [ ] Import all service functions from sme-landing-service
  - [ ] Fetch summary metrics: `const metrics = await getSMESummaryMetrics()`
  - [ ] Fetch content sections data:
    ```typescript
    const [currentIPOs, upcomingIPOs, recentlyListedIPOs, reviews, performanceHighlights, subscriptionStatus] = await Promise.all([
      getSMECurrentIPOs(),
      getSMEUpcomingIPOs(),
      getSMERecentlyListedIPOs(),
      getSMEReviews(),
      getSMEPerformanceHighlights(),
      getSMESubscriptionStatus(),
    ]);
    ```
  - [ ] Parse year and filters from searchParams:
    ```typescript
    const currentYear = parseInt(searchParams?.year || String(new Date().getFullYear()), 10);
    const companySearch = searchParams?.companySearch || '';
    const leadManagerSearch = searchParams?.leadManagerSearch || '';
    ```
  - [ ] Fetch detailed table data: `const { data: detailedIPOs, totalCount } = await getSMEDetailedList({ year: currentYear, companySearch, leadManagerSearch })`
  - [ ] Error handling with try-catch, graceful degradation

- [ ] Implement educational header (AC: 18)
  - [ ] Header section with title and explanation:
    ```typescript
    <div className="mb-6">
      <h1 className="text-3xl font-bold mb-2">SME IPOs</h1>
      <p className="text-gray-600">
        SME IPOs are Initial Public Offerings of Small and Medium Enterprises listed on BSE SME and NSE Emerge platforms. These are smaller companies with lower minimum investment requirements compared to Mainboard IPOs. The SME platforms provide growth capital for emerging businesses while offering investors early-stage investment opportunities. Access comprehensive information on current, upcoming, and listed SME IPOs including performance metrics, expert reviews, prospectus documents, and event calendar.
      </p>
    </div>
    ```

- [ ] Create client component wrapper for interactive elements (AC: 10, 11)
  - [ ] Create client component for year navigation and search:
    ```typescript
    'use client';

    function SMEControlsWrapper({
      defaultYear,
      defaultFilters
    }: {
      defaultYear: number;
      defaultFilters: any;
    }) {
      const router = useRouter();
      const pathname = usePathname();

      const handleYearChange = (year: number) => {
        const params = new URLSearchParams(window.location.search);
        params.set('year', String(year));
        router.push(`${pathname}?${params.toString()}`);
      };

      const handleFilterChange = (filterName: string, value: string) => {
        const params = new URLSearchParams(window.location.search);
        if (value) {
          params.set(filterName, value);
        } else {
          params.delete(filterName);
        }
        router.push(`${pathname}?${params.toString()}`);
      };

      return (
        <>
          <YearNavigation currentYear={defaultYear} onYearChange={handleYearChange} />
          {/* Column search inputs */}
        </>
      );
    }
    ```

- [ ] Render page layout (AC: 1, 3, 4, 6, 7, 18, 20)
  - [ ] Page structure:
    ```typescript
    export default async function SMEIPOsPage({ searchParams }: { searchParams: any }) {
      // Data fetching (above)

      return (
        <div className="container mx-auto px-4 py-8">
          {/* Educational Header */}
          <EducationalHeader />

          {/* Summary Metrics Section */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">SME IPO Metrics</h2>
            <SMESummaryMetrics metrics={metrics} />
          </section>

          {/* Content Sections */}
          <section className="mb-12">
            <SMEContentSections
              currentIPOs={currentIPOs}
              upcomingIPOs={upcomingIPOs}
              recentlyListedIPOs={recentlyListedIPOs}
              reviews={reviews}
              performanceHighlights={performanceHighlights}
              subscriptionStatus={subscriptionStatus}
            />
          </section>

          {/* Navigation Cards */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">Explore SME IPO Features</h2>
            <SMENavigationCards />
          </section>

          {/* Detailed Table */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">Detailed SME IPO Listings</h2>
            <SMEControlsWrapper defaultYear={currentYear} defaultFilters={{ companySearch, leadManagerSearch }} />
            <SMEDetailedTable
              ipoData={detailedIPOs}
              totalCount={totalCount}
              year={currentYear}
            />
          </section>
        </div>
      );
    }
    ```

- [ ] Add loading skeletons (AC: 21)
  - [ ] Import Skeleton: `import { Skeleton } from '@/components/ui/skeleton'`
  - [ ] Create loading.tsx file in same directory:
    ```typescript
    // web/app/sme-ipos/loading.tsx
    export default function Loading() {
      return (
        <div className="container mx-auto px-4 py-8">
          <Skeleton className="h-12 w-3/4 mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }
    ```

### Phase 8: Navigation Integration (AC: 2, 23)

- [ ] Add navigation link to main menu (AC: 2, 23)
  - [ ] Locate header component: `web/components/layout/Header.tsx` or similar
  - [ ] Find main navigation menu
  - [ ] Add "SME IPOs" menu item:
    ```typescript
    <NavigationMenu>
      <NavigationMenuItem>
        <Link href="/sme-ipos" className="nav-link">
          SME IPOs
        </Link>
        {/* Dropdown submenu on hover */}
        <NavigationMenuContent>
          <ul>
            <li><Link href="/sme-ipo-performance-tracker">Performance Tracker</Link></li>
            <li><Link href="/sme-ipo-prospectus">Prospectus</Link></li>
            <li><Link href="/sme-ipo-calendar">Calendar</Link></li>
            <li><Link href="/sme-ipo-reviews">Reviews</Link></li>
          </ul>
        </NavigationMenuContent>
      </NavigationMenuItem>
    </NavigationMenu>
    ```
  - [ ] Ensure "SME IPOs" is both clickable (navigates to landing page) AND has dropdown on hover
  - [ ] Test dropdown functionality on desktop and mobile
  - [ ] Verify navigation link styling matches existing menu items

- [ ] Verify navigation structure (AC: 2)
  - [ ] Check Epic 9 navigation structure:
    ```
    Main Navigation:
    ├── SME IPOs → /sme-ipos (clickable + dropdown on hover)
    │   ├── SME IPO Performance Tracker → /sme-ipo-performance-tracker
    │   ├── SME IPO Prospectus → /sme-ipo-prospectus
    │   ├── SME IPO Calendar → /sme-ipo-calendar
    │   └── SME IPO Reviews → /sme-ipo-reviews
    ```
  - [ ] Ensure all links functional from all pages
  - [ ] Test on desktop and mobile

### Phase 9: SEO Optimization (AC: 22)

- [ ] Add structured data for SME IPOs (AC: 22)
  - [ ] Check if `web/lib/seo/structured-data.ts` exists
  - [ ] **If structured data utilities exist**:
    - [ ] Add function `generateSMEIPOsLandingSchema()`:
      ```typescript
      export function generateSMEIPOsLandingSchema(metrics: SMESummaryMetrics, currentIPOs: IPO[]) {
        return {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "name": "SME IPOs 2025 - Complete Hub",
          "description": "Comprehensive SME IPO information hub with current, upcoming, and listed IPOs",
          "url": "https://ipodhan.com/sme-ipos",
          "mainEntity": {
            "@type": "ItemList",
            "numberOfItems": metrics.totalIPOs,
            "itemListElement": currentIPOs.slice(0, 10).map((ipo, index) => ({
              "@type": "ListItem",
              "position": index + 1,
              "item": {
                "@type": "FinancialProduct",
                "name": ipo.companyName + " IPO",
                "category": "SME IPO"
              }
            }))
          }
        };
      }
      ```
    - [ ] Add Script tag in page.tsx with structured data
  - [ ] **If no structured data utilities exist**:
    - [ ] Inline structured data in page.tsx

- [ ] Verify metadata completeness (AC: 22)
  - [ ] Title includes year (2025) and keywords
  - [ ] Description mentions key features and SME platforms (BSE SME, NSE Emerge)
  - [ ] Keywords relevant to SME IPOs
  - [ ] Open Graph tags configured for social sharing

### Phase 10: Testing (AC: All)

- [ ] Create test data fixtures
  - [ ] Create file: `web/tests/fixtures/sme-landing.fixture.ts`
  - [ ] Add sample SME IPO data (10-15 records)
  - [ ] Include various statuses (OPEN, UPCOMING, LISTED, CLOSED)
  - [ ] Export fixtures

- [ ] Write unit tests for service layer
  - [ ] Test file: `web/tests/unit/lib/services/sme-landing-service.test.ts`
  - [ ] Test: `getSMESummaryMetrics()` calculates correctly
  - [ ] Test: `getSMECurrentIPOs()` returns only OPEN SME IPOs
  - [ ] Test: `getSMEUpcomingIPOs()` returns only UPCOMING SME IPOs
  - [ ] Test: `getSMERecentlyListedIPOs()` returns only LISTED SME IPOs
  - [ ] Test: `getSMEReviews()` returns SME reviews only
  - [ ] Test: `getSMEPerformanceHighlights()` calculates top gainers/losers
  - [ ] Test: `getSMESubscriptionStatus()` returns subscription data
  - [ ] Test: `getSMEDetailedList()` filters by year
  - [ ] Test: `getSMEDetailedList()` filters by company search
  - [ ] Test: Error handling returns empty arrays and zero values
  - [ ] Mock API client with test fixtures

- [ ] Write unit tests for components
  - [ ] Test file: `web/tests/unit/components/sme/SMESummaryMetrics.test.tsx`
    - Test: Renders 6 metric cards
    - Test: Displays correct values from props
    - Test: Color coding applied (green/red for gains/losses)
  - [ ] Test file: `web/tests/unit/components/sme/SMEContentSections.test.tsx`
    - Test: Renders all 6 sections
    - Test: Displays correct number of cards in each section
    - Test: "View All" links navigate correctly
    - Test: Empty states shown when data arrays empty
  - [ ] Test file: `web/tests/unit/components/sme/SMENavigationCards.test.tsx`
    - Test: Renders 4 navigation cards
    - Test: Links navigate to correct URLs
  - [ ] Test file: `web/tests/unit/components/sme/SMEDetailedTable.test.tsx`
    - Test: Renders table with 9 columns
    - Test: Minimize/maximize toggle works
    - Test: Displays all IPO data
    - Test: Color-coded rows applied
    - Test: Status indicators displayed
    - Test: Sortable columns work
    - Test: Column search inputs functional
    - Test: Total records count displayed
    - Test: Responsive - table on desktop, cards on mobile

- [ ] Write integration tests for landing page
  - [ ] Test file: `web/tests/integration/pages/sme-landing.integration.test.tsx`
  - [ ] Test: Page renders successfully
  - [ ] Test: Page renders with year query param (?year=2024)
  - [ ] Test: All sections display with data
  - [ ] Test: Data fetched and displayed correctly
  - [ ] Test: Empty states shown when no data
  - [ ] Test: Error handling - page renders even if fetch fails
  - [ ] Test: Year navigation changes update URL
  - [ ] Test: Filter changes update URL
  - [ ] Mock service layer

- [ ] Write E2E tests
  - [ ] Test file: `web/tests/e2e/sme-landing.spec.ts`
  - [ ] Test: Navigate to `/sme-ipos`
  - [ ] Test: Page loads successfully
  - [ ] Test: Summary metrics section visible
  - [ ] Test: All 6 content sections visible
  - [ ] Test: All 4 navigation cards visible
  - [ ] Test: Detailed table visible
  - [ ] Test: Minimize/maximize toggle works
  - [ ] Test: Year navigation works (Previous/Next buttons)
  - [ ] Test: URL updates with year query param
  - [ ] Test: Column search filters table
  - [ ] Test: Sort columns by clicking headers
  - [ ] Test: Click "View All" links → navigates correctly
  - [ ] Test: Click navigation cards → navigates to dedicated pages
  - [ ] Test: Click company name → navigates to IPO detail
  - [ ] Test: Responsive - resize viewport to mobile → card layouts visible
  - [ ] Test: Click "SME IPOs" in navigation → navigates to landing page
  - [ ] Test: Hover over "SME IPOs" → dropdown submenu visible

- [ ] Manual testing checklist
  - [ ] Navigate to `/sme-ipos` (AC: 1)
  - [ ] Verify page loads without errors
  - [ ] Verify navigation menu "SME IPOs" is clickable and has dropdown (AC: 2)
  - [ ] Verify summary metrics section displays 6 cards (AC: 3):
    - Total SME IPOs
    - IPOs Listed in Gain
    - IPOs Listed in Loss
    - Upcoming & OnGoing IPOs
    - IPOs in Gain (AOT)
    - IPOs in Loss (AOT)
  - [ ] Verify 6 content sections displayed (AC: 4):
    - Current IPOs (4-6 cards)
    - Upcoming IPOs (4-6 cards)
    - Recently Listed IPOs (4-6 cards)
    - Reviews (4-6 cards)
    - Performance highlights (top gainers/losers)
    - Subscription status (data cards)
  - [ ] Verify each section has "View All" link (AC: 5)
  - [ ] Verify 4 navigation cards displayed (AC: 6):
    - Performance Tracker
    - Prospectus
    - Calendar
    - Reviews
  - [ ] Verify detailed table section displays (AC: 7)
  - [ ] Test minimize/maximize toggle (AC: 17)
  - [ ] Verify table shows all 9 columns (AC: 8):
    - Company
    - Opening Date
    - Closing Date
    - Listing Date
    - Issue Price
    - Total Issue Amount
    - Listing at (NSE Emerge, BSE SME)
    - Lead Manager
    - Compare
  - [ ] Test column-level search (AC: 9):
    - Company search filters results
    - Lead Manager search filters results
  - [ ] Test year navigation (AC: 10):
    - Click Previous button → URL updates with ?year=2024
    - Click Next button → URL updates with ?year=2026
  - [ ] Verify URL updates with year query param (AC: 11)
  - [ ] Verify status indicators displayed (AC: 12):
    - "Issue open" badge for current IPOs
    - "Issue close but not listed" badge
    - "Listing today" badge
  - [ ] Test sortable columns (AC: 13):
    - Click Company header → sorts alphabetically
    - Click Opening Date header → sorts by date
    - Click other sortable columns
  - [ ] Verify total records count displays (AC: 14)
  - [ ] Verify color-coded rows (AC: 15):
    - Green for current IPOs
    - Yellow for closing soon
    - White for others
  - [ ] Verify only SME IPOs displayed (AC: 16)
  - [ ] Verify educational header explains SME IPOs and SME platforms (AC: 18)
  - [ ] Verify ISR - check response headers for cache-control (AC: 19)
  - [ ] Resize to mobile (375px) → verify responsive layouts (AC: 20):
    - Summary metrics: 1 column
    - Content sections: 1 column
    - Navigation cards: 1 column
    - Detailed table: card layout
  - [ ] Resize to tablet (768px) → verify responsive layouts (AC: 20):
    - Summary metrics: 2 columns
    - Content sections: 2 columns
    - Navigation cards: 2 columns
    - Detailed table: table layout
  - [ ] Resize to desktop (1024px) → verify responsive layouts (AC: 20):
    - Summary metrics: 3 columns
    - Content sections: 3 columns
    - Navigation cards: 4 columns
    - Detailed table: full table
  - [ ] Test loading states (throttle network) → skeleton visible (AC: 21)
  - [ ] View page source → metadata tags present (AC: 22)
  - [ ] View page source → structured data JSON-LD present (AC: 22)
  - [ ] Verify navigation link in main menu (AC: 23)
  - [ ] No console errors or warnings

### Phase 11: Documentation & Cleanup

- [ ] Update architecture documentation
  - [ ] Add SME IPOs landing page to `docs/architecture/frontend-architecture.md`
  - [ ] Document routing: `/sme-ipos` page
  - [ ] Document component hierarchy
  - [ ] Document state management approach (URL query params for year/filters)

- [ ] Add JSDoc comments to all new code
  - [ ] Service functions documented
  - [ ] Component props documented
  - [ ] Complex logic explained

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
  - [ ] Performance optimizations applied (ISR, caching)

- [ ] Create completion summary
  - [ ] List all files created
  - [ ] List all files modified
  - [ ] Document any deviations from original plan
  - [ ] Note any assumptions made
  - [ ] Document any technical decisions

## Dev Notes

### Story Context

This story creates the **SME IPOs Landing Page** that serves as a comprehensive central hub for all SME IPO information. This is a major feature page combining multiple sections and components to provide investors with a complete overview and navigation center for SME IPO features. It mirrors Story 9.15 (Mainboard IPOs Landing Page) but filters exclusively for SME category IPOs.

**Key Implementation Details:**
- Category Filter: `category=SME` (filters for SME IPOs only throughout)
- Service name: `sme-landing-service.ts`
- Components:
  - `SMESummaryMetrics.tsx` - 6 metric cards
  - `SMEContentSections.tsx` - 6 content sections in card/grid layout
  - `SMENavigationCards.tsx` - 4 navigation cards to dedicated pages
  - `SMEDetailedTable.tsx` - Full IPO listing table with search/filter/sort
  - `YearNavigation.tsx` - Year selector for detailed table (reuse from Mainboard if applicable)
- Page route: `/sme-ipos`
- Navigation: Main menu "SME IPOs" (clickable + dropdown submenu)
- ISR: 5-minute revalidation
- Responsive: All sections adapt to mobile/tablet/desktop

**Design References:**
- Summary metrics dashboard: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO SME Summary.png`
- Detailed table: `d:\Abhay\VibeCoding\IPODhan\img\CG-IPO SME List.png`

**Reference Stories:**
- Story 9.15 (Mainboard IPOs Landing Page) - Primary reference for structure, patterns, and implementation approach
- Story 9.14 (SME IPO Reviews) - SME-specific patterns and category filtering

**SME Platform Context:**
- BSE SME: Small and Medium Enterprises platform on Bombay Stock Exchange
- NSE Emerge: SME platform on National Stock Exchange
- SME IPOs typically have smaller issue sizes and lower minimum investment compared to Mainboard
- Target audience: Investors interested in early-stage growth companies

### Architecture Context

**Tech Stack** [Source: docs/architecture/tech-stack.md]:
- Next.js 14.2+ with TypeScript 5.3+
- React Server Components (default) and Client Components ('use client')
- shadcn/ui components (Table, Card, Input, Select, Button, Skeleton)
- ISR (Incremental Static Regeneration) with `export const revalidate = 300` (5 minutes)
- Vitest for unit/integration tests
- Playwright for E2E tests

**Project Structure** [Source: docs/architecture/unified-project-structure.md]:
- Pages: `web/app/sme-ipos/page.tsx` (App Router)
- Components: `web/components/sme/` (SME-specific components)
  - `SMESummaryMetrics.tsx`
  - `SMEContentSections.tsx`
  - `SMENavigationCards.tsx`
  - `SMEDetailedTable.tsx`
  - `YearNavigation.tsx` (may reuse from mainboard or create SME-specific)
- Services: `web/lib/services/sme-landing-service.ts` (Data fetching layer)
- API: Existing `/api/ipos` endpoint (no new API needed)
- Tests: `web/tests/unit/`, `web/tests/integration/`, `web/tests/e2e/`

**Naming Conventions** [Source: docs/architecture/coding-standards.md]:
- Page files: `page.tsx` (Next.js convention)
- Component files: PascalCase (e.g., `SMESummaryMetrics.tsx`)
- Service files: kebab-case (e.g., `sme-landing-service.ts`)
- Functions: camelCase (e.g., `getSMESummaryMetrics`)

### Data Model Context

**IPO Entity** [Source: docs/architecture/data-models.md]:
```typescript
export enum IPOCategory {
  MAINBOARD = 'MAINBOARD',
  SME = 'SME',              // ✅ Filter for this page
  RIGHTS = 'RIGHTS',
  NCD = 'NCD'
}

export enum IPOStatus {
  UPCOMING = 'UPCOMING',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  LISTED = 'LISTED'
}

export interface IPO {
  id: string;
  companyName: string;
  slug: string;
  category: IPOCategory;      // Will be 'SME'
  sector: string;
  issueSize: number;          // Total issue amount in INR crores
  priceRange: PriceRange;
  lotSize: number;
  status: IPOStatus;
  dates: IPODates;            // openDate, closeDate, allotmentDate, listingDate
  companyDescription: string;
  faceValue: number;
  listingExchanges: ('NSE' | 'BSE')[];  // NSE Emerge, BSE SME
  registrar: string;
  leadManagers: string[];     // Array of lead manager names
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
  listingPrice: number;
  issuePrice: number;
  listingGainPercent: number;
  currentPrice: number | null;  // Used for summary metrics calculations
  currentGainPercent: number | null;
  lastUpdated: Date;
}
```

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
  // Granular breakdown fields...
}
```

**IPOReview Entity** (from Story 9.14):
```typescript
export interface IPOReview {
  id: string;
  ipoId: string;
  reviewTitle: string;
  reviewUrl: string | null;
  reviewContent: string | null;
  author: string;
  recommendation: string;    // "May apply", "Subscribe", "Avoid"
  publishedDate: Date;
  year: number;
  category: IPOCategory;     // MAINBOARD or SME
  createdAt: Date;
  updatedAt: Date;
}
```

**Data Requirements**:
- IPO table with `category=SME`
- ListingPerformance table with `currentPrice` for metrics calculations
- Subscription table for subscription status section
- IPOReviews table for reviews section (created in 9.14)

### API Integration Context

**API Endpoints** [Source: docs/architecture/api-specification.md]:
- Endpoint: `GET /api/ipos`
- Supports filters:
  - `category`: Filter by IPO type (MAINBOARD, SME, RIGHTS, NCD)
  - `status`: Filter by status (UPCOMING, OPEN, CLOSED, LISTED)
  - `year`: Filter by year (based on openDate)
  - `limit`: Limit number of results
  - `page`: Pagination page number
- Example queries:
  - `GET /api/ipos?category=SME&status=OPEN` - Current SME IPOs
  - `GET /api/ipos?category=SME&status=UPCOMING` - Upcoming SME IPOs
  - `GET /api/ipos?category=SME&status=LISTED` - Listed SME IPOs
- Response: Array of IPO objects with nested data
- Caching: 5 minutes (ISR revalidation)
- Error handling: Returns 500 on error with error message

**API Client** [Source: docs/architecture/frontend-architecture.md]:
- Location: `web/lib/api-client.ts`
- Function: `getIPOs(params)` - Returns list of IPOs with filters
- Type-safe APIError class for error handling
- Example usage:
  ```typescript
  import { apiClient } from '@/lib/api-client';
  const ipos = await apiClient.getIPOs({
    category: IPOCategory.SME,
    status: IPOStatus.OPEN,
    limit: 6
  });
  ```

### Component Architecture

**Server vs Client Components**:
- **Page Component** (`page.tsx`): Server component (async)
  - Fetches all landing page data server-side
  - Renders initial HTML with data
  - Handles searchParams for year and filter state
  - Better SEO, faster initial load
- **Summary Metrics Component**: Server component (default)
  - Pure presentation, receives data as props
  - No interactivity
- **Content Sections Component**: Server component (default)
  - Pure presentation, receives data as props
  - Links to other pages
- **Navigation Cards Component**: Server component (default)
  - Static navigation links
  - No interactivity
- **Detailed Table Component**: Client component ('use client')
  - Requires interactivity (minimize/maximize toggle, sorting, search)
  - Uses useState for toggle state and sort state
  - Receives data as props, manages UI state only
- **Year Navigation Component**: Client component ('use client')
  - Requires interactivity (onClick handlers)
  - Uses Next.js router for navigation
  - Updates URL query params

**State Management Strategy**:
- **Year State**: URL query params (shareable, bookmarkable)
  - Default: `/sme-ipos` (current year)
  - With year: `/sme-ipos?year=2024`
  - Server reads from searchParams
  - Client updates via router.push()
- **Filter State**: URL query params
  - Default: No filters
  - With filters: `/sme-ipos?year=2025&companySearch=abc&leadManagerSearch=xyz`
  - Applied server-side (filter in service layer)
- **Data State**: Server-side fetching (no client state)
  - Data fetched on server
  - Passed as props to components
  - No useState or useEffect needed
- **Loading State**: Server-side rendering (ISR pre-rendering)
  - Page is pre-rendered with ISR
  - Skeleton only shown during client navigation transitions
- **Minimize/Maximize State**: Client-side (useState)
  - Table section minimized/maximized
  - Persists during page navigation (localStorage optional)

### Routing Context

**Next.js App Router** [Source: docs/architecture/frontend-architecture.md]:
- File-based routing
- Page file: `app/sme-ipos/page.tsx`
- URL: `/sme-ipos`
- Query params: `?year=2025&companySearch=abc&leadManagerSearch=xyz`
- Navigation:
  - Header link: "SME IPOs" → `/sme-ipos` (also has dropdown submenu)
  - Direct link: `/sme-ipos`
  - Year change: Update URL with year param
  - Search: Update URL with filter params

**Navigation Integration** [Source: Epic 9 Navigation Structure]:
- Add "SME IPOs" to main navigation
- Must be both clickable (navigates to landing page) AND have dropdown on hover
- Navigation structure:
  ```
  Main Navigation:
  ├── SME IPOs → /sme-ipos (clickable + dropdown on hover)
  │   ├── SME IPO Performance Tracker → /sme-ipo-performance-tracker
  │   ├── SME IPO Prospectus → /sme-ipo-prospectus
  │   ├── SME IPO Calendar → /sme-ipo-calendar
  │   └── SME IPO Reviews → /sme-ipo-reviews
  ```

### Responsive Design Context

**Tailwind Breakpoints** [Source: docs/architecture/tech-stack.md]:
- `sm`: 640px (small devices)
- `md`: 768px (medium devices - tablets)
- `lg`: 1024px (large devices - desktops)
- Mobile-first approach (default styles for mobile, add `md:` for desktop)

**Responsive Strategy for Landing Page**:
- **Summary Metrics Section**:
  - Mobile (< 768px): 1 column grid
  - Tablet (768px - 1023px): 2 columns grid
  - Desktop (>= 1024px): 3 columns grid
  - Class: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`
- **Content Sections**:
  - Each section follows same pattern as summary metrics
  - Card grids: 1 column mobile, 2 columns tablet, 3 columns desktop
- **Navigation Cards**:
  - Mobile: 1 column
  - Tablet: 2 columns
  - Desktop: 4 columns
  - Class: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`
- **Detailed Table**:
  - Desktop (>= 768px): Full table layout with horizontal scroll
  - Mobile (< 768px): Card layout (stacked vertical cards)
  - Classes: `hidden md:block overflow-x-auto` (table), `md:hidden` (cards)

### SEO Optimization Context

**Metadata Requirements** [Source: docs/architecture/frontend-architecture.md]:
- Title: Include year (2025) and keywords (SME IPOs, hub, metrics, reviews, BSE SME, NSE Emerge)
- Description: Mention key features (summary metrics, content sections, navigation, SME platforms)
- Keywords: Landing-specific terms (sme ipo hub, sme ipo 2025, bse sme, nse emerge, ipo metrics)
- Open Graph: Social sharing tags
- Example:
  ```typescript
  export const metadata: Metadata = {
    title: 'SME IPOs 2025 - Complete Hub | IPODhan',
    description: 'Access comprehensive SME IPO information including current, upcoming, and listed IPOs on BSE SME and NSE Emerge platforms. View performance metrics, reviews, prospectus documents, and IPO calendar.',
    keywords: 'sme ipo, sme ipo 2025, bse sme, nse emerge, sme platform, ipo performance, ipo reviews, ipo calendar, India',
    openGraph: { ... }
  };
  ```

**Structured Data for Landing Page**:
- Schema.org type: CollectionPage with ItemList
- Include: Total IPOs count, list of current IPOs
- Limit to 10 items for reasonable schema size

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
  - Fresh data (5-minute updates for metrics, current IPOs)
  - Low server load (caching)
  - SEO-friendly (static HTML)
- Rationale for 5 minutes: Landing page shows current IPOs and metrics that change frequently (subscriptions, GMP updates)

### Error Handling Strategy

**Service Layer Error Handling** [Source: docs/architecture/coding-standards.md]:
- **Never throw errors** from service functions
- Always return empty array/object on error
- Log errors to console (server-side)
- Graceful degradation (page still renders)
- Example:
  ```typescript
  export async function getSMESummaryMetrics(): Promise<SMESummaryMetrics> {
    try {
      const ipos = await apiClient.getIPOs({ category: IPOCategory.SME });
      // Calculate metrics
      return metrics;
    } catch (error) {
      console.error('Error fetching SME summary metrics:', error);
      return {
        totalIPOs: 0,
        listedInGain: 0,
        listedInLoss: 0,
        upcomingAndOngoing: 0,
        gainAOT: 0,
        lossAOT: 0
      }; // Empty result, not thrown error
    }
  }
  ```

**Component Error Handling**:
- Components handle empty arrays gracefully
- Show empty state messages for each section
- No error boundaries needed (service never throws)
- Page always renders (header, navigation cards, empty states)

### UI Component Library

**shadcn/ui Components to Use** [Source: docs/architecture/tech-stack.md]:
- **Card**: `@/components/ui/card` (Card, CardHeader, CardTitle, CardContent, CardFooter)
- **Table**: `@/components/ui/table` (Table, TableHeader, TableBody, TableRow, TableCell)
- **Input**: `@/components/ui/input` (for search boxes)
- **Button**: `@/components/ui/button` (for year navigation, toggle, actions)
- **Skeleton**: `@/components/ui/skeleton` (for loading states)
- **Badge**: `@/components/ui/badge` (for status indicators, recommendations)

**Import Pattern**:
```typescript
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
```

### Summary Metrics Calculations

**Metric 1: Total SME IPOs**:
- Count: All SME IPOs (any status)
- Query: `category=SME`

**Metric 2: IPOs Listed in Gain**:
- Count: SME IPOs where `status=LISTED` AND `currentPrice > issuePrice`
- Requires: ListingPerformance table with currentPrice
- Color: Green

**Metric 3: IPOs Listed in Loss**:
- Count: SME IPOs where `status=LISTED` AND `currentPrice < issuePrice`
- Requires: ListingPerformance table with currentPrice
- Color: Red

**Metric 4: Upcoming & OnGoing IPOs**:
- Count: SME IPOs where `status IN (UPCOMING, OPEN)`
- Query: `category=SME&status=UPCOMING,OPEN`

**Metric 5: IPOs in Gain (AOT - All Over Time)**:
- Calculation: Average gain % across all profitable listed SME IPOs
- Formula: `SUM(currentGainPercent WHERE currentGainPercent > 0) / COUNT(listed IPOs with gain)`
- Display: Percentage with 2 decimal places
- Color: Green

**Metric 6: IPOs in Loss (AOT - All Over Time)**:
- Calculation: Average loss % across all loss-making listed SME IPOs
- Formula: `SUM(currentGainPercent WHERE currentGainPercent < 0) / COUNT(listed IPOs with loss)`
- Display: Percentage with 2 decimal places (absolute value)
- Color: Red

### Content Sections Implementation

**Section 1: Current IPOs (4-6 cards)**:
- Data: SME IPOs with status=OPEN
- Sort: By closeDate ascending (closing soonest first)
- Limit: 6 items
- Card content: Company name, open date, close date, issue size, subscription (if available)
- "View All" link: `/sme-ipos?filter=current` (could be custom filter or table view)

**Section 2: Upcoming IPOs (4-6 cards)**:
- Data: SME IPOs with status=UPCOMING
- Sort: By openDate ascending (opening soonest first)
- Limit: 6 items
- Card content: Company name, open date, issue size

**Section 3: Recently Listed IPOs (4-6 cards)**:
- Data: SME IPOs with status=LISTED
- Sort: By listingDate descending (newest first)
- Limit: 6 items
- Card content: Company name, listing date, listing price, current price, gain/loss %

**Section 4: Reviews (4-6 cards)**:
- Data: SME IPO reviews (from ipoReviews table)
- Sort: By publishedDate descending (newest first)
- Limit: 6 items
- Card content: Review title, IPO company name, author, recommendation
- "View All" link: `/sme-ipo-reviews`

**Section 5: Performance Highlights (6 cards total)**:
- Data: SME IPOs with listing performance
- Two subsections:
  - Top 3 Gainers: Highest gain % (green)
  - Top 3 Losers: Lowest gain % (red)
- Card content: Company name, gain/loss %, current vs issue price
- "View All" link: `/sme-ipo-performance-tracker`

**Section 6: Subscription Status (4-6 cards)**:
- Data: SME IPOs with latest subscription data (current/recent IPOs)
- Sort: By latest subscription timestamp
- Limit: 6 items
- Card content: Company name, total subscription, category-wise subscription (QIB, NII, Retail)
- "View All" link: Could link to current IPOs section in detailed table

### Detailed Table Features

**Table Columns (9 total)**:
1. **Company**: Clickable link to `/ipos/[slug]`, shows company name
2. **Opening Date**: Formatted as "MMM DD, YYYY" (e.g., "Jan 15, 2025")
3. **Closing Date**: Formatted as "MMM DD, 2025"
4. **Listing Date**: Formatted or "TBD" if null
5. **Issue Price**: ₹ symbol, formatted (e.g., "₹350")
6. **Total Issue Amount**: ₹ Crores (e.g., "₹50 Cr")
7. **Listing at**: Exchange - NSE Emerge, BSE SME, or "NSE Emerge, BSE SME"
8. **Lead Manager**: Display first manager, tooltip shows all if multiple
9. **Compare**: Checkbox or button for future comparison feature

**Column-Level Search**:
- Search inputs below header row
- Company search: Text input, fuzzy search, debounced 300ms
- Lead Manager search: Text input, fuzzy search, debounced 300ms
- Other columns: No search

**Status Indicators**:
- "Issue open" badge: Green, if status=OPEN and today is between openDate and closeDate
- "Issue close but not listed" badge: Yellow, if status=CLOSED and listingDate is null
- "Listing today" badge: Blue, if listingDate equals today

**Sortable Columns**:
- Company (alphabetical)
- Opening Date (chronological)
- Closing Date (chronological)
- Listing Date (chronological)
- Issue Price (numerical)
- Total Issue Amount (numerical)
- Default sort: Opening Date descending (newest first)

**Color-Coded Rows**:
- Green background: IPO currently open (today between openDate and closeDate)
- Yellow background: IPO closing within 2 days (closeDate within 2 days from today)
- White/default: All other IPOs

**Year Navigation**:
- Format: `<< Year 2024 | 2025 | Year 2026 >>`
- Previous button: Decreases year by 1
- Next button: Increases year by 1
- Current year displayed in center
- URL updates with year query param

**Total Records Count**:
- Display: "Total Records: {count}"
- Position: Above table or in table header
- Style: text-sm, text-gray-600

**Minimize/Maximize Toggle**:
- Toggle button in section header
- State: `useState(false)` (default: maximized)
- Conditional rendering: Show table only if not minimized
- Smooth transition: CSS or animation library

### Implementation Approach

**Recommended Implementation Order**:
1. **Phase 0**: Prerequisites verification (design images, database schema, API, shared types)
2. **Phase 1**: Service layer (all data fetching functions)
3. **Phase 2**: Summary Metrics component (6 metric cards)
4. **Phase 3**: Content Sections component (6 sections)
5. **Phase 4**: Navigation Cards component (4 cards)
6. **Phase 5**: Detailed Table component (table with features)
7. **Phase 6**: Year Navigation component (Previous/Next buttons)
8. **Phase 7**: Landing page integration (assemble everything with ISR)
9. **Phase 8**: Navigation integration (add to main menu)
10. **Phase 9**: SEO optimization (metadata, structured data)
11. **Phase 10**: Testing (unit, integration, E2E tests)
12. **Phase 11**: Documentation (update architecture docs, add JSDoc)

**Reusable Components from Story 9.15**:
- Consider reusing `YearNavigation.tsx` from Mainboard if it's generic enough
- Other components are SME-specific and need separate implementations
- Service layer is completely separate (different category filter)

### File Modifications Required

**Files to Create**:
1. `web/app/sme-ipos/page.tsx` - Landing page (server component)
2. `web/app/sme-ipos/loading.tsx` - Loading skeleton
3. `web/components/sme/SMESummaryMetrics.tsx` - Summary metrics section
4. `web/components/sme/SMEContentSections.tsx` - Content sections
5. `web/components/sme/SMENavigationCards.tsx` - Navigation cards
6. `web/components/sme/SMEDetailedTable.tsx` - Detailed table
7. `web/components/sme/YearNavigation.tsx` - Year selector (or reuse from mainboard)
8. `web/lib/services/sme-landing-service.ts` - Data fetching service
9. `web/tests/unit/lib/services/sme-landing-service.test.ts` - Service tests
10. `web/tests/unit/components/sme/SMESummaryMetrics.test.tsx` - Component tests
11. `web/tests/unit/components/sme/SMEContentSections.test.tsx` - Component tests
12. `web/tests/unit/components/sme/SMENavigationCards.test.tsx` - Component tests
13. `web/tests/unit/components/sme/SMEDetailedTable.test.tsx` - Component tests
14. `web/tests/integration/pages/sme-landing.integration.test.tsx` - Integration tests
15. `web/tests/e2e/sme-landing.spec.ts` - E2E tests
16. `web/tests/fixtures/sme-landing.fixture.ts` - Test data fixtures

**Files to Modify**:
1. `web/components/layout/Header.tsx` (or navigation component) - Add "SME IPOs" menu item (clickable + dropdown)
2. `web/lib/seo/structured-data.ts` (if exists) - Add `generateSMEIPOsLandingSchema()` function
3. `docs/architecture/frontend-architecture.md` - Document new landing page

**Files to Check**:
1. `packages/shared/src/types/ipo.ts` - Verify SME category exists
2. `packages/shared/src/types/listing.ts` - Verify ListingPerformance type exists
3. `packages/shared/src/types/subscription.ts` - Verify Subscription type exists
4. `packages/shared/src/types/review.ts` - Verify IPOReview type exists (created in 9.14)
5. `web/lib/db/schema.ts` - Verify schema supports all required fields
6. `web/app/api/ipos/route.ts` - Verify API endpoint supports category filter
7. `web/lib/api-client.ts` - Verify getIPOs() function signature

### Known Limitations and Future Enhancements

**Current Limitations**:
1. **Performance Metrics Data**:
   - Depends on ListingPerformance table with currentPrice field
   - Current price needs to be updated regularly (scraper or API)
   - **Future Enhancement**: Real-time price updates via WebSocket or polling

2. **Subscription Status Data**:
   - Shows latest subscription snapshot per IPO
   - May not reflect real-time subscription data during IPO period
   - **Future Enhancement**: Add real-time subscription updates

3. **Detailed Table Pagination**:
   - MVP shows all results (limited by year filter)
   - No pagination in MVP
   - **Future Enhancement**: Add pagination for large datasets (50 records per page)

4. **Compare Feature**:
   - Compare column placeholder in detailed table
   - No comparison functionality in MVP
   - **Future Enhancement**: Implement IPO comparison feature (Story 9.17 or separate)

5. **Advanced Filtering**:
   - Only company and lead manager search in MVP
   - No sector filter, issue size range filter, etc.
   - **Future Enhancement**: Add advanced filter options

6. **Empty State Handling**:
   - Basic empty state messages
   - No helpful suggestions or alternative actions
   - **Future Enhancement**: Add contextual suggestions ("View upcoming IPOs", "Browse all IPOs")

### Dependencies and Prerequisites

**Required Dependencies** (should already be installed):
- Next.js 14.2+ ✅
- TypeScript 5.3+ ✅
- React 19+ ✅
- shadcn/ui components ✅
- Vitest (testing) ✅
- Playwright (E2E testing) ✅

**Required Prerequisites**:
- API endpoint `/api/ipos` supports category filter ✅ (verify in Phase 0)
- Database has SME category in IPO enum ✅
- ListingPerformance table exists with currentPrice field (verify in Phase 0)
- Subscription table exists (verify in Phase 0)
- IPOReviews table exists (created in 9.14) ✅
- Stories 9.11-9.14 (SME dedicated pages) completed ✅ (for navigation links to work)
- Story 9.15 (Mainboard IPOs Landing Page) completed ✅ (reference for patterns)

**Potential Blockers**:
- If ListingPerformance table doesn't have currentPrice field → Need to add field and populate data
- If subscription data not available → Graceful handling with empty state
- If reviews data not available → Graceful handling with empty state
- Design reference images missing → Need to clarify layout requirements

**No New Dependencies Needed**: This story uses existing tech stack

## Testing

[Source: docs/architecture/testing-strategy.md]

**Test File Locations:**
- Unit tests: `web/tests/unit/lib/services/sme-landing-service.test.ts`
- Component tests: `web/tests/unit/components/sme/*.test.tsx`
- Integration tests: `web/tests/integration/pages/sme-landing.integration.test.tsx`
- E2E tests: `web/tests/e2e/sme-landing.spec.ts`

**Testing Frameworks:**
- Vitest for unit and integration tests (already configured in `web/vitest.config.ts`)
- Playwright for E2E tests (already configured in `web/playwright.config.ts`)

**Test Standards:**
- All service functions must have unit tests
- All components must have unit tests
- Landing page must have integration tests
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
| 2025-10-12 | 1.0 | Initial story draft created for Story 9.16 (SME IPOs Landing Page) based on Epic 9 lines 1041-1069, mirroring Story 9.15 structure but filtering exclusively for SME IPOs (category=SME). Story creates comprehensive landing page with 6 metric cards, 6 content sections, 4 navigation cards, and detailed table with search/filter/sort. All acceptance criteria (23 total) derived from Epic 9 specification. Components organized in web/components/sme/ directory. Service layer in web/lib/services/sme-landing-service.ts. Mirrors Story 9.15 (Mainboard IPOs Landing Page) architecture. ISR with 5-minute revalidation. Design references: CG-IPO SME Summary.png and CG-IPO SME List.png. | Bob (Scrum Master) |
| 2025-10-12 | 1.1 | Story validated and APPROVED by Product Owner. Validation score: 9.5/10. All 23 acceptance criteria verified. Template compliance excellent. Implementation readiness: HIGH. No critical issues found. Minor optional enhancements suggested (source tree visualization, YearNavigation component reuse clarification). Story mirrors Story 9.15 successfully with SME category filter (category=SME). Ready for dev agent implementation. Status updated to Ready. | Sarah (Product Owner) |

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
