# Story 9.13: SME IPO Calendar Page

## Status
Ready

## Story

**As a** investor planning SME IPO applications,
**I want** to view an interactive SME IPO Calendar page with monthly grid view showing SME IPO-related events (open dates, close dates, allotment status, listing dates),
**so that** I can visualize SME IPO schedules and plan my applications with a clear timeline view, avoiding missed opportunities and scheduling conflicts.

## Acceptance Criteria

1. SME IPO Calendar page accessible at `/sme-ipo-calendar`
2. Monthly calendar grid displays correctly:
   - 7 columns (Sunday - Saturday)
   - Correct number of days for the month
   - Days of week header row (green background)
3. Month navigation works:
   - Previous month button functional
   - Next month button functional
   - URL updates with month/year query params
4. Only SME IPO events displayed (category=SME filter applied)
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
11. Descriptive header text explains the SME IPO calendar
12. Page uses ISR with 5-minute revalidation
13. Responsive: calendar grid on desktop, list view on mobile
14. Empty state shows "No SME IPO events in [month] [year]" message
15. Loading skeleton displays during data fetch
16. SEO metadata configured (title, description, keywords)
17. Navigation link added to "SME IPOs" submenu
18. Default view shows current month
19. Performance: Calendar renders smoothly even with 20+ events per day

## Tasks / Subtasks

### Phase 0: Prerequisites Verification

- [ ] Verify database schema supports IPO dates and holidays (AC: 2, 6, 9)
  - [ ] Check if `ipos` table has date fields: `openDate`, `closeDate`, `allotmentDate`, `listingDate`
  - [ ] Verify `ipos` table has `category` field with SME enum value
  - [ ] Check if `marketHolidays` table exists in database schema
  - [ ] Verify `marketHolidays` table has columns: `id`, `date`, `description`, `exchange`, `type`, `year`
  - [ ] If schema missing: Create migration for marketHolidays table before proceeding

- [ ] Verify API client supports required functionality (AC: 4)
  - [ ] Check `web/lib/api-client.ts` has `getIPOs()` function
  - [ ] Verify `getIPOs()` supports `category` filter parameter
  - [ ] Verify `getIPOs()` supports date range filtering
  - [ ] Test API endpoint: `GET /api/ipos?category=SME&month=10&year=2025`
  - [ ] If API missing functionality: Update API client and endpoint before proceeding

- [ ] Verify shared types exist (AC: 2, 4, 6)
  - [ ] Check `packages/shared/src/types/ipo.ts` exports `IPO` and `IPOCategory` types
  - [ ] Verify `IPOCategory.SME` enum value exists
  - [ ] Check `packages/shared/src/types/holiday.ts` exports `MarketHoliday` type
  - [ ] Verify IPO interface has all date fields (openDate, closeDate, allotmentDate, listingDate)
  - [ ] If types missing: Add to shared types package before proceeding

### Phase 1: Service Layer - SME Calendar Data Fetching (AC: 2, 4, 6, 9)

- [ ] Create SME Calendar service file (AC: 2, 4)
  - [ ] Create new file: `web/lib/services/sme-calendar-service.ts`
  - [ ] Import required types from shared package:
    ```typescript
    import { IPO, IPOCategory } from '@/types/ipo';
    import { MarketHoliday } from '@/types/holiday';
    import { apiClient } from '@/lib/api-client';
    ```
  - [ ] Add JSDoc comment explaining service purpose
  - [ ] Service fetches SME IPOs with event data for specified month/year

- [ ] Implement `getSMEIPOEvents` function (AC: 2, 4, 6)
  - [ ] Function signature:
    ```typescript
    export interface CalendarEvent {
      date: Date;
      eventType: 'OPENS' | 'CLOSES' | 'ALLOTMENT' | 'LISTS' | 'HOLIDAY';
      ipo?: IPO;
      description: string;
      slug?: string;
    }

    export interface CalendarDay {
      date: Date;
      events: CalendarEvent[];
      isCurrentMonth: boolean;
      isToday: boolean;
      isWeekend: boolean;
    }

    export async function getSMEIPOEvents(
      month: number,
      year: number
    ): Promise<CalendarDay[]>
    ```
  - [ ] Call API endpoint with SME filter and date range:
    ```typescript
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);

    const response = await apiClient.getIPOs({
      category: IPOCategory.SME,  // ⭐ SME filter
      // Filter IPOs where any date falls in current month
    });
    ```
  - [ ] Fetch market holidays for the month:
    ```typescript
    const holidays = await apiClient.getMarketHolidays({
      month,
      year
    });
    ```
  - [ ] Build calendar grid (7 columns × 5-6 rows):
    ```typescript
    const firstDayOfMonth = new Date(year, month - 1, 1);
    const lastDayOfMonth = new Date(year, month, 0);
    const daysInMonth = lastDayOfMonth.getDate();
    const firstDayOfWeek = firstDayOfMonth.getDay(); // 0=Sunday

    // Include previous month days to fill first week
    const startDate = new Date(firstDayOfMonth);
    startDate.setDate(startDate.getDate() - firstDayOfWeek);

    // Build 42-day grid (6 weeks × 7 days)
    const calendarDays: CalendarDay[] = [];
    for (let i = 0; i < 42; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + i);

      calendarDays.push({
        date: currentDate,
        events: [],
        isCurrentMonth: currentDate.getMonth() === month - 1,
        isToday: isSameDay(currentDate, new Date()),
        isWeekend: currentDate.getDay() === 0 || currentDate.getDay() === 6
      });
    }
    ```
  - [ ] Aggregate IPO events by date:
    ```typescript
    response.data.forEach((ipo) => {
      // Add "Opens" event
      if (ipo.dates.openDate && isSameMonth(ipo.dates.openDate, year, month)) {
        const dayIndex = findDayIndex(calendarDays, ipo.dates.openDate);
        calendarDays[dayIndex].events.push({
          date: ipo.dates.openDate,
          eventType: 'OPENS',
          ipo,
          description: `${ipo.companyName} IPO Opens`,
          slug: ipo.slug
        });
      }

      // Add "Closes" event
      if (ipo.dates.closeDate && isSameMonth(ipo.dates.closeDate, year, month)) {
        const dayIndex = findDayIndex(calendarDays, ipo.dates.closeDate);
        calendarDays[dayIndex].events.push({
          date: ipo.dates.closeDate,
          eventType: 'CLOSES',
          ipo,
          description: `${ipo.companyName} IPO Closes`,
          slug: ipo.slug
        });
      }

      // Add "Allotment" event
      if (ipo.dates.allotmentDate && isSameMonth(ipo.dates.allotmentDate, year, month)) {
        const dayIndex = findDayIndex(calendarDays, ipo.dates.allotmentDate);
        calendarDays[dayIndex].events.push({
          date: ipo.dates.allotmentDate,
          eventType: 'ALLOTMENT',
          ipo,
          description: `${ipo.companyName} IPO Allotment Status`,
          slug: ipo.slug
        });
      }

      // Add "Lists" event
      if (ipo.dates.listingDate && isSameMonth(ipo.dates.listingDate, year, month)) {
        const dayIndex = findDayIndex(calendarDays, ipo.dates.listingDate);
        calendarDays[dayIndex].events.push({
          date: ipo.dates.listingDate,
          eventType: 'LISTS',
          ipo,
          description: `${ipo.companyName} IPO Lists`,
          slug: ipo.slug
        });
      }
    });
    ```
  - [ ] Add holiday events (AC: 9):
    ```typescript
    holidays.forEach((holiday) => {
      const dayIndex = findDayIndex(calendarDays, holiday.date);
      if (dayIndex >= 0) {
        calendarDays[dayIndex].events.push({
          date: holiday.date,
          eventType: 'HOLIDAY',
          description: `Holiday - ${holiday.description}`,
        });
      }
    });
    ```
  - [ ] Add error handling:
    ```typescript
    try {
      // API calls and processing
    } catch (error) {
      console.error('Error fetching SME calendar events:', error);
      return []; // Graceful degradation - empty calendar
    }
    ```

- [ ] Add helper functions
  - [ ] `isSameDay(date1: Date, date2: Date): boolean`
  - [ ] `isSameMonth(date: Date, year: number, month: number): boolean`
  - [ ] `findDayIndex(calendarDays: CalendarDay[], targetDate: Date): number`
  - [ ] `getMonthName(month: number): string` (e.g., "October")

- [ ] Add TypeScript types and exports
  - [ ] Export interfaces: `export { CalendarEvent, CalendarDay }`
  - [ ] Export function: `export { getSMEIPOEvents }`
  - [ ] Ensure all types properly imported from shared types package
  - [ ] No TypeScript errors in file

### Phase 2: Calendar Grid Component (AC: 2, 6, 7, 8, 9, 13)

- [ ] Create SME calendar grid component file (AC: 2)
  - [ ] Create file: `web/components/calendar/SMEIPOCalendarGrid.tsx`
  - [ ] Mark as server component (default, no 'use client')
  - [ ] Component receives calendar data as props (presentational component)

- [ ] Define component interface and props (AC: 2)
  - [ ] Define props interface:
    ```typescript
    interface SMEIPOCalendarGridProps {
      calendarDays: CalendarDay[];
      currentMonth: number;
      currentYear: number;
      loading?: boolean;
    }
    ```
  - [ ] Component signature:
    ```typescript
    export function SMEIPOCalendarGrid({
      calendarDays,
      currentMonth,
      currentYear,
      loading = false
    }: SMEIPOCalendarGridProps)
    ```

- [ ] Implement calendar grid structure (AC: 2, 6, 7, 8, 9, 13)
  - [ ] Desktop layout (>= 768px): 7×6 grid
  - [ ] Days of week header row:
    ```typescript
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    <div className="grid grid-cols-7 bg-green-600 text-white">
      {daysOfWeek.map(day => (
        <div key={day} className="p-2 text-center font-semibold">
          {day}
        </div>
      ))}
    </div>
    ```
  - [ ] Calendar cells (6 weeks):
    ```typescript
    <div className="grid grid-cols-7 gap-1">
      {calendarDays.map((day, index) => (
        <div
          key={index}
          className={cn(
            'min-h-24 p-2 border rounded',
            !day.isCurrentMonth && 'bg-gray-100 text-gray-400',
            day.isToday && 'border-blue-500 border-2',
            day.isWeekend && 'bg-gray-50',
            day.events.length >= 2 && 'bg-yellow-100'  // Highlight days with 2+ events (AC: 8)
          )}
        >
          {/* Day number */}
          <div className="text-sm font-semibold mb-1">
            {day.date.getDate()}
          </div>

          {/* Events */}
          <div className="space-y-1">
            {day.events.map((event, eventIndex) => (
              <CalendarEvent
                key={eventIndex}
                event={event}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
    ```
  - [ ] Add responsive class: `<div className="hidden md:block">`

- [ ] Implement mobile list layout (AC: 13)
  - [ ] Mobile layout (< 768px): List view grouped by day
  - [ ] Import Card: `import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'`
  - [ ] Display events as list grouped by date
  - [ ] Only show days with events (filter out empty days)
  - [ ] Add class: `<div className="md:hidden space-y-4">`

- [ ] Implement empty state (AC: 14)
  - [ ] Add conditional rendering:
    ```typescript
    {calendarDays.every(day => day.events.length === 0) && !loading && (
      <div className="text-center py-12 text-muted-foreground">
        <p>No SME IPO events in {getMonthName(currentMonth)} {currentYear}</p>
        <p className="text-sm mt-2">Check other months for upcoming SME IPO events</p>
      </div>
    )}
    ```

- [ ] Implement loading skeleton (AC: 15)
  - [ ] Create skeleton UI:
    ```typescript
    {loading && (
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 42 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )}
    ```
  - [ ] Import Skeleton: `import { Skeleton } from '@/components/ui/skeleton'`

- [ ] Add JSDoc comments and exports
  - [ ] Document component purpose
  - [ ] Export component: `export { SMEIPOCalendarGrid }`

### Phase 3: Reusable Components (AC: 6, 7)

- [ ] Create CalendarEvent component (AC: 6, 7)
  - [ ] Create file: `web/components/calendar/CalendarEvent.tsx`
  - [ ] Component receives event as prop
  - [ ] Component signature:
    ```typescript
    interface CalendarEventProps {
      event: CalendarEvent;
    }

    export function CalendarEvent({ event }: CalendarEventProps)
    ```
  - [ ] Implement event display (AC: 6):
    ```typescript
    if (event.eventType === 'HOLIDAY') {
      return (
        <div className="text-xs text-gray-600 italic">
          {event.description}  {/* "Holiday - Diwali" */}
        </div>
      );
    }

    return (
      <Link
        href={`/ipos/${event.slug}`}
        className="flex items-start gap-1 text-xs hover:bg-gray-100 p-1 rounded"
      >
        <span className="text-sm">📅</span>  {/* Calendar icon (AC: 6) */}
        <div>
          <div className="font-medium text-blue-600 hover:underline">
            {event.ipo?.companyName}  {/* Company name (AC: 6) */}
          </div>
          <div className="text-gray-600">
            {event.eventType === 'OPENS' && 'Opens'}
            {event.eventType === 'CLOSES' && 'Closes'}
            {event.eventType === 'ALLOTMENT' && 'Allotment Status'}
            {event.eventType === 'LISTS' && 'Lists'}
          </div>
        </div>
      </Link>
    );
    ```
  - [ ] Import Link: `import Link from 'next/link'`
  - [ ] Event links navigate to IPO detail pages (AC: 7)

- [ ] Create MonthNavigation component
  - [ ] Create file: `web/components/calendar/MonthNavigation.tsx`
  - [ ] Mark as client component ('use client')
  - [ ] Component signature:
    ```typescript
    interface MonthNavigationProps {
      currentMonth: number;
      currentYear: number;
      onNavigate: (month: number, year: number) => void;
    }

    export function MonthNavigation({
      currentMonth,
      currentYear,
      onNavigate
    }: MonthNavigationProps)
    ```
  - [ ] Implement navigation buttons (AC: 3):
    ```typescript
    const handlePrevious = () => {
      const newMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const newYear = currentMonth === 1 ? currentYear - 1 : currentYear;
      onNavigate(newMonth, newYear);
    };

    const handleNext = () => {
      const newMonth = currentMonth === 12 ? 1 : currentMonth + 1;
      const newYear = currentMonth === 12 ? currentYear + 1 : currentYear;
      onNavigate(newMonth, newYear);
    };

    return (
      <div className="flex items-center justify-between mb-4">
        <Button onClick={handlePrevious} variant="outline">
          &lt;&lt; Previous
        </Button>
        <h2 className="text-xl font-semibold">
          {getMonthName(currentMonth)} {currentYear}
        </h2>
        <Button onClick={handleNext} variant="outline">
          Next &gt;&gt;
        </Button>
      </div>
    );
    ```

- [ ] Create EventSearch component (AC: 10)
  - [ ] Create file: `web/components/calendar/EventSearch.tsx`
  - [ ] Mark as client component ('use client')
  - [ ] Component signature:
    ```typescript
    interface EventSearchProps {
      value: string;
      onSearchChange: (value: string) => void;
      onClearSearch: () => void;
    }

    export function EventSearch({
      value,
      onSearchChange,
      onClearSearch
    }: EventSearchProps)
    ```
  - [ ] Implement search input:
    ```typescript
    <div className="flex gap-2 mb-4">
      <Input
        type="text"
        placeholder="Search by company name..."
        value={value}
        onChange={(e) => onSearchChange(e.target.value)}
        className="flex-1"
      />
      <Button onClick={onClearSearch} variant="outline">
        Clear Search
      </Button>
    </div>
    ```
  - [ ] Import Input and Button from shadcn/ui

### Phase 4: SME Calendar Page Implementation (AC: 1, 3, 10, 11, 12, 16, 17, 18)

- [ ] Create page file (AC: 1)
  - [ ] Create directory: `web/app/sme-ipo-calendar/`
  - [ ] Create file: `web/app/sme-ipo-calendar/page.tsx`
  - [ ] Server component (async) for data fetching

- [ ] Configure ISR revalidation (AC: 12)
  - [ ] Add revalidate export at top of file:
    ```typescript
    export const revalidate = 300; // 5 minutes in seconds
    ```

- [ ] Implement page metadata (AC: 16)
  - [ ] Add metadata export:
    ```typescript
    import type { Metadata } from 'next';

    export const metadata: Metadata = {
      title: 'SME IPO Calendar 2025 - Monthly Event Schedule | IPODhan',
      description: 'View SME IPO calendar with monthly grid showing opening dates, closing dates, allotment status, and listing dates. Plan your SME IPO applications.',
      keywords: 'sme ipo calendar, ipo events, ipo schedule, sme ipo dates, India',
      openGraph: {
        title: 'SME IPO Calendar 2025 - Monthly Event Schedule',
        description: 'View SME IPO calendar with monthly grid',
        type: 'website',
      }
    };
    ```

- [ ] Implement server-side month/year state handling (AC: 3, 18)
  - [ ] Page component receives searchParams
  - [ ] Parse month/year from URL query params:
    ```typescript
    const today = new Date();
    const currentMonth = parseInt(searchParams?.month || String(today.getMonth() + 1), 10);
    const currentYear = parseInt(searchParams?.year || String(today.getFullYear()), 10);
    ```
  - [ ] Default: Current month/year (AC: 18)

- [ ] Fetch SME Calendar data server-side (AC: 2, 4, 12)
  - [ ] Import service: `import { getSMEIPOEvents } from '@/lib/services/sme-calendar-service'`
  - [ ] Fetch data based on month/year
  - [ ] Error handling with graceful degradation

- [ ] Create client component wrapper for navigation and search (AC: 3, 10)
  - [ ] Create client component wrapper:
    ```typescript
    'use client';

    function CalendarControlsWrapper({
      defaultMonth,
      defaultYear,
      defaultSearch
    }: {
      defaultMonth: number;
      defaultYear: number;
      defaultSearch: string;
    }) {
      const router = useRouter();
      const pathname = usePathname();
      const [searchTerm, setSearchTerm] = useState(defaultSearch);

      const handleNavigate = (month: number, year: number) => {
        const params = new URLSearchParams();
        params.set('month', String(month));
        params.set('year', String(year));
        if (searchTerm) params.set('search', searchTerm);
        router.push(`${pathname}?${params.toString()}`);
      };

      const handleSearchChange = (value: string) => {
        setSearchTerm(value);
        const params = new URLSearchParams(window.location.search);
        if (value) {
          params.set('search', value);
        } else {
          params.delete('search');
        }
        router.push(`${pathname}?${params.toString()}`);
      };

      const handleClearSearch = () => {
        setSearchTerm('');
        const params = new URLSearchParams(window.location.search);
        params.delete('search');
        router.push(`${pathname}?${params.toString()}`);
      };

      return (
        <>
          <MonthNavigation
            currentMonth={defaultMonth}
            currentYear={defaultYear}
            onNavigate={handleNavigate}
          />
          <EventSearch
            value={searchTerm}
            onSearchChange={handleSearchChange}
            onClearSearch={handleClearSearch}
          />
        </>
      );
    }
    ```

- [ ] Apply search filter client-side (AC: 10)
  - [ ] Filter calendar events by company name:
    ```typescript
    const searchTerm = searchParams?.search || '';
    let filteredCalendarDays = calendarDays;

    if (searchTerm) {
      filteredCalendarDays = calendarDays.map(day => ({
        ...day,
        events: day.events.filter(event => {
          if (event.eventType === 'HOLIDAY') return true;
          return event.ipo?.companyName.toLowerCase().includes(searchTerm.toLowerCase());
        })
      }));
    }
    ```

- [ ] Render page layout (AC: 1, 2, 3, 10, 11, 13, 16)
  - [ ] Descriptive header (AC: 11):
    ```typescript
    <div className="mb-6">
      <h1 className="text-3xl font-bold mb-2">SME IPO Calendar</h1>
      <p className="text-gray-600">
        View SME IPO events including opening dates, closing dates, allotment status, and listing dates. Plan your SME IPO applications with our monthly event calendar.
      </p>
    </div>
    ```
  - [ ] Month navigation component
  - [ ] Event search component
  - [ ] SME calendar grid component
  - [ ] Mobile list view

- [ ] Add imports for all components
  - [ ] Import components: `SMEIPOCalendarGrid`, `MonthNavigation`, `EventSearch`, `CalendarEvent`
  - [ ] Import Next.js types and hooks
  - [ ] Import service function
  - [ ] Verify no TypeScript errors

### Phase 5: Navigation Integration (AC: 17)

- [ ] Add navigation link to "SME IPOs" submenu (AC: 17)
  - [ ] Check header component location: `web/components/layout/Header.tsx` or similar
  - [ ] Locate "SME IPOs" dropdown menu section
  - [ ] Add "SME IPO Calendar" link to submenu:
    ```typescript
    <DropdownMenuItem>
      <Link href="/sme-ipo-calendar">
        SME IPO Calendar
      </Link>
    </DropdownMenuItem>
    ```
  - [ ] Position in submenu: Third item in dropdown (after Prospectus)
  - [ ] Verify link works from all pages
  - [ ] Test dropdown hover/click functionality

- [ ] Verify navigation structure matches Epic 9 specification (AC: 17)
  - [ ] Check Epic 9 navigation structure:
    ```
    Main Navigation:
    ├── SME IPOs → /sme-ipos (clickable + dropdown on hover)
    │   ├── SME IPO Performance Tracker → /sme-ipo-performance-tracker
    │   ├── SME IPO Prospectus → /sme-ipo-prospectus
    │   ├── SME IPO Calendar → /sme-ipo-calendar
    │   └── SME IPO Reviews → /sme-ipo-reviews
    ```
  - [ ] Ensure "SME IPOs" is both clickable AND has dropdown on hover
  - [ ] Test navigation on desktop and mobile

### Phase 6: SEO Optimization (AC: 16)

- [ ] Add structured data for SME Calendar (AC: 16)
  - [ ] Check if `web/lib/seo/structured-data.ts` exists
  - [ ] **If structured data utilities exist**:
    - [ ] Add function `generateSMECalendarSchema(calendarDays: CalendarDay[])`:
      ```typescript
      export function generateSMECalendarSchema(calendarDays: CalendarDay[], month: number, year: number) {
        const events = calendarDays.flatMap(day => day.events.filter(e => e.eventType !== 'HOLIDAY'));

        return {
          "@context": "https://schema.org",
          "@type": "Event",
          "name": `SME IPO Calendar - ${getMonthName(month)} ${year}`,
          "description": "SME IPO events including opening dates, closing dates, allotment, and listing dates",
          "startDate": new Date(year, month - 1, 1).toISOString(),
          "endDate": new Date(year, month, 0).toISOString(),
          "eventStatus": "https://schema.org/EventScheduled",
          "eventAttendanceMode": "https://schema.org/OnlineEventAttendanceMode",
          "location": {
            "@type": "VirtualLocation",
            "url": `https://ipodhan.com/sme-ipo-calendar?month=${month}&year=${year}`
          },
          "subEvent": events.slice(0, 10).map(event => ({
            "@type": "Event",
            "name": event.description,
            "startDate": event.date.toISOString(),
            "url": `https://ipodhan.com/ipos/${event.slug}`
          }))
        };
      }
      ```
    - [ ] Add Script tag in page.tsx with structured data
  - [ ] **If no structured data utilities exist**:
    - [ ] Inline structured data in page.tsx

- [ ] Verify metadata completeness (AC: 16)
  - [ ] Title includes keywords (SME, calendar, IPO, events, schedule)
  - [ ] Description mentions key features (monthly grid, opening dates, closing dates, allotment, listing)
  - [ ] Keywords relevant to SME IPO calendar
  - [ ] Open Graph tags configured for social sharing

### Phase 7: Testing (AC: All)

- [ ] Create test data fixtures
  - [ ] Create file: `web/tests/fixtures/sme-calendar.fixture.ts`
  - [ ] Add sample SME IPO calendar data (10-15 events across different dates)
  - [ ] Include various event types (OPENS, CLOSES, ALLOTMENT, LISTS, HOLIDAY)
  - [ ] Export fixtures: `export { smeCalendarFixtures }`

- [ ] Write unit tests for service layer
  - [ ] Test file: `web/tests/unit/lib/services/sme-calendar-service.test.ts`
  - [ ] Test: `getSMEIPOEvents()` returns calendar days with events
  - [ ] Test: Calendar grid has 42 days (6 weeks)
  - [ ] Test: Events aggregated correctly by date
  - [ ] Test: Holidays included in calendar
  - [ ] Test: Only SME IPOs included (category filter)
  - [ ] Test: Error handling returns empty array
  - [ ] Mock API client with test fixtures

- [ ] Write unit tests for SMEIPOCalendarGrid component
  - [ ] Test file: `web/tests/unit/components/calendar/SMEIPOCalendarGrid.test.tsx`
  - [ ] Test: Renders calendar with 7 columns (days of week)
  - [ ] Test: Displays all calendar days
  - [ ] Test: Shows empty state when no events
  - [ ] Test: Shows loading skeleton when loading=true
  - [ ] Test: Highlights days with 2+ events (yellow background)
  - [ ] Test: Displays holidays correctly
  - [ ] Test: Responsive - grid on desktop, list on mobile

- [ ] Write unit tests for CalendarEvent component
  - [ ] Test file: `web/tests/unit/components/calendar/CalendarEvent.test.tsx`
  - [ ] Test: Renders event with calendar icon
  - [ ] Test: Displays company name and event type
  - [ ] Test: Event links navigate correctly
  - [ ] Test: Holiday events display correctly (no link)

- [ ] Write integration tests for SME Calendar page
  - [ ] Test file: `web/tests/integration/pages/sme-calendar.integration.test.tsx`
  - [ ] Test: Page renders successfully
  - [ ] Test: Page renders with month/year query params
  - [ ] Test: Data fetched and displayed
  - [ ] Test: Empty state shown when no events
  - [ ] Test: Error handling - page renders even if fetch fails
  - [ ] Test: Navigation changes update URL
  - [ ] Test: Search filters events
  - [ ] Mock service layer

- [ ] Write E2E tests
  - [ ] Test file: `web/tests/e2e/sme-calendar.spec.ts`
  - [ ] Test: Navigate to `/sme-ipo-calendar`
  - [ ] Test: Page loads successfully
  - [ ] Test: Default view shows current month
  - [ ] Test: Month navigation works (Previous/Next buttons)
  - [ ] Test: URL updates with month/year query params
  - [ ] Test: Calendar grid displays with 7 columns
  - [ ] Test: Events displayed correctly (company name, event type, icon)
  - [ ] Test: Click event link → navigates to IPO detail page
  - [ ] Test: Search filters events by company name
  - [ ] Test: Clear search button resets filter
  - [ ] Test: Days with 2+ events highlighted (yellow)
  - [ ] Test: Holidays displayed correctly
  - [ ] Test: Responsive - resize viewport to mobile → list layout
  - [ ] Test: Click "SME IPO Calendar" link in navigation → navigates to page

- [ ] Manual testing checklist
  - [ ] Navigate to `/sme-ipo-calendar` (AC: 1)
  - [ ] Verify page loads without errors
  - [ ] Verify default view shows current month (AC: 18)
  - [ ] Verify calendar grid has 7 columns (Sunday-Saturday) (AC: 2)
  - [ ] Verify days of week header has green background (AC: 2)
  - [ ] Verify only SME IPO events displayed (AC: 4, 5)
  - [ ] Click Previous button → URL updates with ?month=X&year=Y (AC: 3)
  - [ ] Click Next button → URL updates (AC: 3)
  - [ ] Refresh page with query params → correct month displayed
  - [ ] Verify events display correctly (AC: 6):
    - Calendar icon (📅) shown
    - Company name displayed
    - Event type shown (Opens, Closes, Allotment Status, Lists)
    - Multiple events per day displayed
  - [ ] Click event link → navigates to IPO detail page (AC: 7)
  - [ ] Verify days with 2+ events have yellow background (AC: 8)
  - [ ] Verify holidays displayed correctly (AC: 9)
  - [ ] Test search functionality (AC: 10):
    - Type company name in search → events filtered
    - URL updates with ?search=query
    - Click "Clear Search" → filter resets
  - [ ] Verify descriptive header text (AC: 11)
  - [ ] Verify ISR - check response headers for cache-control (AC: 12)
  - [ ] Resize to mobile (375px) → list layout visible (AC: 13)
  - [ ] Resize to desktop (1024px) → calendar grid visible (AC: 13)
  - [ ] Test empty state (navigate to future month with no events) → "No SME IPO events in [month] [year]" (AC: 14)
  - [ ] Test loading state (throttle network) → skeleton visible (AC: 15)
  - [ ] View page source → metadata tags present (AC: 16)
  - [ ] View page source → structured data JSON-LD present (AC: 16)
  - [ ] Verify navigation link in "SME IPOs" submenu (AC: 17)
  - [ ] Test performance with 20+ events per day → renders smoothly (AC: 19)
  - [ ] No console errors or warnings

### Phase 8: Documentation & Cleanup

- [ ] Update architecture documentation
  - [ ] Add SME Calendar page to `docs/architecture/frontend-architecture.md`
  - [ ] Document routing: `/sme-ipo-calendar` page
  - [ ] Document state management approach (URL query params for month/year)

- [ ] Add JSDoc comments to all new code
  - [ ] Service functions documented
  - [ ] Component props documented
  - [ ] Complex logic explained (calendar grid generation, event aggregation)

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

This story creates the **SME IPO Calendar Page** that filters exclusively for **SME IPOs** (category=SME). This calendar page displays IPO events in a monthly grid view with support for navigation and search.

**Key Implementation Details:**
- Category Filter: `category=SME` (filters for SME IPOs only)
- Service name: `sme-calendar-service.ts`
- Component name: `SMEIPOCalendarGrid`
- Page route: `/sme-ipo-calendar`
- Navigation: "SME IPOs" submenu (third item after Prospectus)
- Empty state message: "No SME IPO events in [month] [year]"

**New Components to Create:**
- `CalendarEvent.tsx` component - Individual event display with icon and link (reusable)
- `MonthNavigation.tsx` component - Previous/Next month navigation (reusable)
- `EventSearch.tsx` component - Search by company name (reusable)
- `SMEIPOCalendarGrid.tsx` component - Monthly calendar grid

**Reference Story:**
- Story 9.12 (SME IPO Prospectus) - Completed, provides SME-specific page pattern
- Epic 9 Story 9.9a (Mainboard IPO Calendar) - Provides calendar page structure (not yet implemented)

### Architecture Context

**Tech Stack** [Source: docs/architecture/tech-stack.md]:
- Next.js 14.2+ with TypeScript 5.3+
- React Server Components (default) and Client Components ('use client')
- shadcn/ui components (Card, Input, Button, Skeleton)
- ISR (Incremental Static Regeneration) with `export const revalidate = 300` (5 minutes)
- Vitest for unit/integration tests
- Playwright for E2E tests

**Project Structure** [Source: docs/architecture/unified-project-structure.md]:
- Pages: `web/app/sme-ipo-calendar/page.tsx` (App Router)
- Components: `web/components/calendar/SMEIPOCalendarGrid.tsx` (Calendar-specific components)
- Components (Reusable): `web/components/calendar/CalendarEvent.tsx`, `MonthNavigation.tsx`, `EventSearch.tsx`
- Services: `web/lib/services/sme-calendar-service.ts` (Data fetching layer)
- API: `web/app/api/ipos/route.ts` (Existing API endpoint)
- Tests: `web/tests/unit/`, `web/tests/integration/`, `web/tests/e2e/`

**Naming Conventions** [Source: docs/architecture/coding-standards.md]:
- Page files: `page.tsx` (Next.js convention)
- Component files: PascalCase (e.g., `SMEIPOCalendarGrid.tsx`)
- Service files: kebab-case (e.g., `sme-calendar-service.ts`)
- Functions: camelCase (e.g., `getSMEIPOEvents`)

### Data Model Context

**IPO Entity** [Source: docs/architecture/data-models.md]:
```typescript
export enum IPOCategory {
  MAINBOARD = 'MAINBOARD',
  SME = 'SME',            // ✅ Filter for this page
  RIGHTS = 'RIGHTS',
  NCD = 'NCD'
}

export interface IPODates {
  openDate: Date;
  closeDate: Date;
  allotmentDate: Date | null;
  listingDate: Date | null;
}

export interface IPO {
  id: string;
  companyName: string;
  slug: string;
  category: IPOCategory;  // Will be 'SME'
  dates: IPODates;        // Event dates for calendar
  // ... other fields
}
```

**MarketHoliday Entity** [Source: docs/architecture/data-models.md]:
```typescript
export enum Exchange {
  NSE = 'NSE',
  BSE = 'BSE',
  BOTH = 'BOTH'
}

export enum HolidayType {
  TRADING = 'TRADING',
  SETTLEMENT = 'SETTLEMENT',
  BOTH = 'BOTH'
}

export interface MarketHoliday {
  id: string;
  date: Date;
  description: string;       // e.g., "Republic Day", "Diwali"
  exchange: Exchange;        // NSE, BSE, or BOTH
  type: HolidayType;
  year: number;
  createdAt: Date;
  updatedAt: Date;
}
```

**Data Requirements**:
- IPO table with `category=SME`
- IPO dates: `openDate`, `closeDate`, `allotmentDate`, `listingDate`
- MarketHolidays table with date, description, exchange, year

### Calendar Grid Logic

**Calendar Grid Structure**:
- 7 columns (Sunday - Saturday)
- 6 rows (weeks) = 42 total cells
- Include previous/next month days to fill weeks
- Highlight current month days vs. other month days

**Date Calculations**:
```typescript
// Get first day of month (e.g., October 1, 2025)
const firstDayOfMonth = new Date(year, month - 1, 1);

// Get first day of week (0=Sunday, 6=Saturday)
const firstDayOfWeek = firstDayOfMonth.getDay();

// Calculate grid start date (may be in previous month)
const startDate = new Date(firstDayOfMonth);
startDate.setDate(startDate.getDate() - firstDayOfWeek);

// Build 42-day grid
for (let i = 0; i < 42; i++) {
  const currentDate = new Date(startDate);
  currentDate.setDate(currentDate.getDate() + i);
  // ... add to calendar grid
}
```

**Event Aggregation**:
- Group events by date
- Support multiple events per day
- Event types: OPENS, CLOSES, ALLOTMENT, LISTS, HOLIDAY
- Each event links to IPO detail page (except holidays)

### API Integration Context

**Existing API Endpoint**:
- Endpoint: `GET /api/ipos`
- Supports filters:
  - `category`: Filter by IPO type (MAINBOARD, SME, RIGHTS, NCD)
  - Date range filtering (custom implementation needed)
- Example query: `GET /api/ipos?category=SME&month=10&year=2025`
- Response: Array of IPO objects with dates
- Error handling: Returns 500 on error with error message

**Market Holidays API**:
- May need new endpoint: `GET /api/market-holidays`
- Query params: `month`, `year`
- Response: Array of MarketHoliday objects
- **If endpoint doesn't exist**: Create in Phase 0

**API Client**:
- Location: `web/lib/api-client.ts`
- Function: `getIPOs(params)` - Returns list of IPOs with filters
- May need: `getMarketHolidays(params)` - Returns list of holidays
- Type-safe APIError class for error handling

### Previous Story Context

**Story 9.12 (SME IPO Prospectus) Achievements**:
- Created SME IPO Prospectus page with comprehensive features
- Service layer pattern:
  - Service file in `lib/services/`
  - Export async functions with typed responses
  - Use API client for data fetching
  - Error handling with try-catch, return empty array/object
- Table component pattern:
  - Desktop: shadcn/ui Table component
  - Mobile: Card component for stacked layout
  - Loading skeleton, empty state
- Page component pattern:
  - `export const revalidate = 600` for ISR
  - Server component (async) for data fetching
  - URL query params for state (searchParams)
  - Client component wrapper for interactive elements
  - Metadata export for SEO
  - Structured data (JSON-LD)
- **ColumnSearch component created (reusable)**
- **ProspectusPagination component created (reusable)**

**Lessons Learned**:
- URL state management (query params) works well for filters
- Graceful degradation (empty array on error) provides better UX
- Client component wrappers needed only for interactive elements (search, navigation)
- Server components handle data fetching efficiently
- ISR provides good balance of performance and freshness
- Search components should use debouncing for text inputs (300ms)
- Month/year navigation should use URL query params for shareable/bookmarkable state

### Component Architecture

**Server vs Client Components**:
- **Page Component** (`page.tsx`): Server component (async)
  - Fetches SME calendar data server-side
  - Renders initial HTML with data
  - Handles searchParams for month/year/search state
  - Better SEO, faster initial load
- **Navigation/Search Components**: Client component ('use client')
  - Requires interactivity (onClick, onChange handlers)
  - Uses Next.js router for navigation
  - Manages client-side state (month, year, search)
- **Calendar Grid Component**: Server component (default)
  - Pure presentation, no interactivity
  - Receives data as props
  - Can be rendered on server
- **Calendar Event Component**: Server component (default)
  - Links to IPO detail pages (static)
  - No client-side interactivity

**State Management Strategy**:
- **Month/Year State**: URL query params (shareable, bookmarkable)
  - Default: `/sme-ipo-calendar` (current month)
  - With params: `/sme-ipo-calendar?month=10&year=2025`
  - Server reads from searchParams
  - Client updates via router.push()
- **Search State**: URL query params
  - Default: No search filter
  - With search: `/sme-ipo-calendar?month=10&year=2025&search=reliance`
  - Applied client-side (filter events)
- **Data State**: Server-side fetching (no client state)
  - Data fetched on server
  - Passed as props to components
  - No useState or useEffect needed
- **Loading State**: Server-side rendering (ISR pre-rendering)
  - Page is pre-rendered with ISR
  - Skeleton only shown during client navigation transitions

### Routing Context

**Next.js App Router**:
- File-based routing
- Page file: `app/sme-ipo-calendar/page.tsx`
- URL: `/sme-ipo-calendar`
- Query params: `?month=10&year=2025&search=query`
- Navigation:
  - Header link: "SME IPOs" dropdown → "SME IPO Calendar"
  - Direct link: `/sme-ipo-calendar`
  - Month change: Update URL with query params
  - Search: Update URL with search param

**Navigation Integration** [Source: Epic 9 Navigation Structure]:
- Add link to "SME IPOs" submenu
- Navigation structure:
  ```
  Main Navigation:
  ├── SME IPOs → /sme-ipos (clickable + dropdown on hover)
  │   ├── SME IPO Performance Tracker → /sme-ipo-performance-tracker
  │   ├── SME IPO Prospectus → /sme-ipo-prospectus
  │   ├── SME IPO Calendar → /sme-ipo-calendar ⭐ THIS PAGE
  │   └── SME IPO Reviews → /sme-ipo-reviews
  ```
- Position: Third item in "SME IPOs" submenu (after Prospectus)
- Link should be visible when hovering over "SME IPOs"

### Responsive Design Context

**Tailwind Breakpoints**:
- `sm`: 640px (small devices)
- `md`: 768px (medium devices - tablets)
- `lg`: 1024px (large devices - desktops)
- Mobile-first approach (default styles for mobile, add `md:` for desktop)

**Responsive Strategy for Calendar Page**:
- **Desktop (>= 768px)**: Calendar grid layout
  - 7 columns × 6 rows
  - Full calendar view
  - Class: `hidden md:block` on grid wrapper
- **Mobile (< 768px)**: List layout
  - Vertical list grouped by date
  - Only show days with events
  - Class: `md:hidden` on list wrapper
  - Compact event cards

### SEO Optimization Context

**Metadata Requirements**:
- Title: Include keywords (SME, calendar, IPO, events, schedule, dates)
- Description: Mention key features (monthly grid, opening dates, closing dates, allotment, listing)
- Keywords: Calendar-specific terms (sme ipo calendar, ipo events, ipo schedule, sme ipo dates)
- Open Graph: Social sharing tags
- Example:
  ```typescript
  export const metadata: Metadata = {
    title: 'SME IPO Calendar 2025 - Monthly Event Schedule | IPODhan',
    description: 'View SME IPO calendar with monthly grid showing opening dates, closing dates, allotment status, and listing dates. Plan your SME IPO applications.',
    keywords: 'sme ipo calendar, ipo events, ipo schedule, sme ipo dates, India',
    openGraph: { ... }
  };
  ```

**Structured Data for SME Calendar**:
- Schema.org type: Event with subEvents
- Include: Month/year, event list, event URLs
- Limit to 10 events for reasonable schema size

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
  - Fresh data (5-minute updates for event changes)
  - Low server load (caching)
  - SEO-friendly (static HTML)

### Error Handling Strategy

**Service Layer Error Handling**:
- **Never throw errors** from service functions
- Always return empty array on error
- Log errors to console (server-side)
- Graceful degradation (page still renders)
- Example:
  ```typescript
  export async function getSMEIPOEvents(month: number, year: number): Promise<CalendarDay[]> {
    try {
      const response = await apiClient.getIPOs({ ... });
      // Process and return data
    } catch (error) {
      console.error('Error fetching SME calendar events:', error);
      return []; // Empty result, not thrown error
    }
  }
  ```

**Component Error Handling**:
- Components handle empty arrays gracefully
- Show empty state message: "No SME IPO events in [month] [year]"
- No error boundaries needed (service never throws)
- Page always renders (header, navigation, search, empty state)

### UI Component Library

**shadcn/ui Components to Use**:
- **Card**: `@/components/ui/card` (Card, CardHeader, CardTitle, CardContent) - for mobile list view
- **Input**: `@/components/ui/input` (for search box)
- **Button**: `@/components/ui/button` (for navigation buttons)
- **Skeleton**: `@/components/ui/skeleton`

**Import Pattern**:
```typescript
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
```

### Color Coding

**Calendar Cell Colors**:
- **Default (white)**: Days with 0-1 events
- **Yellow background**: Days with 2+ events (highlighted)
- **Gray background**: Days not in current month
- **Blue border**: Today's date (current day indicator)
- **Gray background (light)**: Weekend days

**Implementation**:
```typescript
className={cn(
  'min-h-24 p-2 border rounded',
  !day.isCurrentMonth && 'bg-gray-100 text-gray-400',
  day.isToday && 'border-blue-500 border-2',
  day.isWeekend && 'bg-gray-50',
  day.events.length >= 2 && 'bg-yellow-100'  // Highlight
)}
```

### Event Display

**Event Types and Labels**:
- `OPENS` → "Opens"
- `CLOSES` → "Closes"
- `ALLOTMENT` → "Allotment Status"
- `LISTS` → "Lists"
- `HOLIDAY` → "Holiday - [description]"

**Event Rendering**:
- Calendar icon: 📅 (Unicode emoji)
- Company name: Clickable link to IPO detail page
- Event type: Descriptive text below company name
- Holidays: No link, just text with description

### Implementation Approach

**Recommended Implementation Order**:
1. **Phase 0**: Prerequisites verification (database schema, API client, shared types, market holidays API)
2. **Phase 1**: Service layer (data fetching, calendar grid generation, event aggregation)
3. **Phase 2**: Calendar grid component (core UI with event display)
4. **Phase 3**: Reusable components (CalendarEvent, MonthNavigation, EventSearch)
5. **Phase 4**: Page integration (assemble everything with ISR)
6. **Phase 5**: Navigation integration (add to "SME IPOs" submenu)
7. **Phase 6**: SEO optimization (metadata, structured data)
8. **Phase 7**: Testing (unit, integration, E2E tests)
9. **Phase 8**: Documentation (update architecture docs, add JSDoc)

**Implementation Notes**:
- Reusable components (CalendarEvent, MonthNavigation, EventSearch) can be shared with Mainboard Calendar (Story 9.9a)
- Follow patterns from Story 9.12 (SME IPO Prospectus) for page structure
- Use date-fns library for date calculations (already in project)
- Implement calendar grid generation carefully (42-day grid, previous/next month days)
- Handle edge cases (leap years, month boundaries, timezones)

### File Modifications Required

**Files to Create**:
1. `web/app/sme-ipo-calendar/page.tsx` - SME Calendar page (server component)
2. `web/components/calendar/SMEIPOCalendarGrid.tsx` - Calendar grid component (server component)
3. `web/components/calendar/CalendarEvent.tsx` - Event display component (server component, reusable)
4. `web/components/calendar/MonthNavigation.tsx` - Month navigation component (client component, reusable)
5. `web/components/calendar/EventSearch.tsx` - Search component (client component, reusable)
6. `web/lib/services/sme-calendar-service.ts` - Data fetching and calendar logic service
7. `web/tests/unit/lib/services/sme-calendar-service.test.ts` - Service tests
8. `web/tests/unit/components/calendar/SMEIPOCalendarGrid.test.tsx` - Grid tests
9. `web/tests/unit/components/calendar/CalendarEvent.test.tsx` - Event tests
10. `web/tests/integration/pages/sme-calendar.integration.test.tsx` - Integration tests
11. `web/tests/e2e/sme-calendar.spec.ts` - E2E tests
12. `web/tests/fixtures/sme-calendar.fixture.ts` - Test data fixtures

**Files to Modify**:
1. `web/components/layout/Header.tsx` (or navigation component) - Add "SME IPO Calendar" link to "SME IPOs" submenu
2. `web/lib/seo/structured-data.ts` (if exists) - Add `generateSMECalendarSchema()` function
3. `docs/architecture/frontend-architecture.md` - Document new page

**Files to Check**:
1. `packages/shared/src/types/ipo.ts` - Verify SME category exists, IPO dates exist
2. `packages/shared/src/types/holiday.ts` - Verify MarketHoliday type exists
3. `web/lib/db/schema.ts` - Verify schema supports ipos and marketHolidays tables
4. `web/app/api/ipos/route.ts` - Verify API supports category filter and date range
5. `web/app/api/market-holidays/route.ts` - Check if market holidays API exists (create if not)
6. `web/lib/api-client.ts` - Verify getIPOs() function signature, check getMarketHolidays()

### Known Limitations and Future Enhancements

**Current Limitations**:
1. **Market Holidays Data**:
   - Depends on marketHolidays table being populated
   - May need manual entry or scraper for holidays
   - **Future Enhancement**: Add admin UI for holiday management

2. **Event Details**:
   - Basic event display (company name, event type)
   - No additional details (subscription status, GMP, etc.)
   - **Future Enhancement**: Add tooltips with event details

3. **Calendar Customization**:
   - Fixed 7-day week starting Sunday
   - No customization for week start day (Monday vs Sunday)
   - **Future Enhancement**: Add user preference for week start day

4. **Multi-Month View**:
   - Single month view only
   - No 3-month or yearly view
   - **Future Enhancement**: Add quarterly or yearly calendar view

5. **Event Filtering**:
   - Only search by company name
   - No filter by event type (Opens, Closes, etc.)
   - **Future Enhancement**: Add event type filters

### Dependencies and Prerequisites

**Required Dependencies** (should already be installed):
- Next.js 14.2+ ✅
- TypeScript 5.3+ ✅
- React 19+ ✅
- shadcn/ui components ✅
- date-fns (for date calculations) ✅
- lucide-react (for icons) ✅
- Vitest (testing) ✅
- Playwright (E2E testing) ✅

**Required Prerequisites**:
- Story 9.12 (SME IPO Prospectus) completed ✅ (SME-specific page pattern, ISR, service pattern, SEO)
- API endpoint `/api/ipos` supports category filter ✅
- Database has SME category in IPO enum ✅
- IPO dates fields exist (openDate, closeDate, allotmentDate, listingDate) (verify in Phase 0)
- MarketHolidays table exists (verify in Phase 0)
- Market holidays API exists or can be created (verify in Phase 0)

**Potential Blockers**:
- If MarketHolidays table doesn't exist → Need to create table and migration in Phase 0
- If market holidays API doesn't exist → Need to create endpoint in Phase 0
- If IPO dates fields missing → Need to add fields to schema in Phase 0
- If no holiday data available → Graceful handling with empty holiday events

**No New Dependencies Needed**: This story uses existing tech stack

### Testing

**Testing Standards** [Source: docs/architecture/testing-strategy.md]:
- Unit tests: Vitest framework in `web/tests/unit/`
- Integration tests: Vitest in `web/tests/integration/pages/`
- E2E tests: Playwright in `web/tests/e2e/`
- Coverage target: >80% overall
- Service layer target: >90%
- Component target: >80%

**Unit Test Requirements**:
1. **Service layer**: Test `getSMEIPOEvents()` function
   - Test with different months/years
   - Test calendar grid generation (42 days)
   - Test event aggregation (opens, closes, allotment, listing)
   - Test holiday inclusion
   - Test SME category filter
   - Test error handling (return empty array)
   - Mock API client with test fixtures
2. **SMEIPOCalendarGrid component**: Test rendering and formatting
   - Test calendar grid with 7 columns
   - Test all calendar days displayed
   - Test empty state
   - Test loading skeleton
   - Test event display
   - Test day highlighting (2+ events = yellow)
   - Test holiday display
   - Test responsive layouts (grid on desktop, list on mobile)
3. **CalendarEvent component**: Test event display
   - Test event with icon
   - Test company name and event type
   - Test event link navigation
   - Test holiday event (no link)

**Integration Test Requirements**:
1. Page component: Test rendering with different states
   - Test with no month/year params (default current month)
   - Test with month/year query params
   - Test data fetching and display
   - Test empty state when no events
   - Test error handling (graceful degradation)
   - Test navigation changes update URL
   - Test search filters events
   - Mock service layer

**E2E Test Requirements**:
1. Navigation: Test accessing page from navigation menu
2. Month navigation: Test Previous/Next buttons
3. Search: Test company name search and clear
4. Events: Test event links navigate to IPO detail pages
5. Responsive: Test mobile and desktop layouts
6. Performance: Test page load speed and smooth rendering

**Manual Testing Checklist** (see Phase 7 for complete list):
- All 19 acceptance criteria verified
- Month navigation tested (Previous/Next buttons)
- Calendar grid displays correctly (7 columns, correct days)
- Only SME IPO events displayed (verify category filter)
- Events displayed correctly (icon, company name, event type)
- Event links tested (navigate to IPO detail pages)
- Search tested (company name filter, clear button)
- Color coding verified (yellow for 2+ events)
- Holidays verified
- Responsive tested (mobile/tablet/desktop)
- Empty state tested (no events in month)
- Performance tested (Lighthouse, LCP, CLS)

## Testing

[Source: docs/architecture/testing-strategy.md]

**Test File Locations:**
- Unit tests: `web/tests/unit/lib/services/sme-calendar-service.test.ts`
- Integration tests: `web/tests/integration/pages/sme-calendar.integration.test.tsx`
- E2E tests: `web/tests/e2e/sme-calendar.spec.ts`

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
| 2025-10-12 | 1.0 | Initial story draft created for Story 9.13 (SME IPO Calendar Page) based on Epic 9 lines 890-908, Story 9.9a as feature template, Story 9.12 as SME reference, architecture documentation, data models, and coding standards. Story mirrors 9.9a architecture with SME category filter. CalendarEvent, MonthNavigation, and EventSearch components created as reusable (will be shared with 9.9a). All acceptance criteria (19 total) derived from Epic 9 specification. | Bob (Scrum Master) |
| 2025-10-12 | 1.1 | Story validated and approved by Product Owner. Validation score: 9.5/10. Zero critical issues, zero should-fix issues. Four minor nice-to-have suggestions (accessibility, security, edge cases, documentation). Status changed from "Draft" to "Ready". Story is implementation-ready. | Sarah (Product Owner) |

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
