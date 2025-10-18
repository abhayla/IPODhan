# Reusable Components Requirements

This document outlines the requirements for reusable components across the IPODhan web application. These components should be generic, flexible, and usable in multiple contexts.

---

## 1. Enhanced Generic Data Table Component

**Component Name:** `DataTable`

**Location:** `web/components/shared/DataTable.tsx`

**Status:** ✅ **APPROVED - Single Enhanced Component Architecture**

### Purpose
A flexible, reusable table component for displaying tabular data with **optional advanced features** including sorting, filtering, pagination, column search, and year filtering. **ONE component serves all table use cases** across the application.

### Architecture Decision
**✅ Option A Selected:** Create ONE enhanced DataTable component with optional features (controlled by props)
- Simple tables: Enable only basic features (sorting)
- Full-page tables: Enable all advanced features (column search, year filter, pagination, etc.)
- Features show/hide based on prop configuration

### Requirements

#### Core Functional Requirements
1. **Display Data**
   - Accept generic data array of any type
   - Display data in rows and columns
   - Support dynamic column configuration

2. **Column Configuration**
   - Define columns with custom headers
   - Specify column data keys
   - Support custom rendering per column
   - Allow column alignment (left, center, right)
   - Set minimum width per column

3. **Sorting** (ALWAYS AVAILABLE)
   - Click column header to sort
   - Toggle between ascending/descending
   - Visual indicator for active sort (up/down arrow)
   - Optional: Disable sorting on specific columns
   - Callback function for external sort handling

4. **Empty State**
   - Display custom message when no data
   - Customizable empty state component

5. **Styling**
   - Responsive (horizontal scroll on mobile)
   - Alternating row colors (optional)
   - Hover effects on rows
   - Custom className support per column
   - Border and rounded corners

#### Optional Advanced Features

6. **Column-Level Search** (OPTIONAL)
   - Search box below each column header
   - Real-time filtering (debounced 300ms)
   - Independent search per column
   - "Clear" button to reset search
   - Controlled via `enableColumnSearch` prop

7. **Year Filter** (OPTIONAL)
   - Dropdown year selector
   - Pre-defined year ranges (2020-2026)
   - URL query param integration
   - Controlled via `enableYearFilter` prop

8. **Pagination** (OPTIONAL)
   - 50 records per page (configurable)
   - "Previous" and "Next" buttons
   - Page number indicators
   - Total records count display
   - Controlled via `enablePagination` prop

9. **Minimize/Maximize Toggle** (OPTIONAL)
   - Collapsible table section
   - Toggle button with icon
   - Smooth expand/collapse animation
   - Controlled via `enableMinimizeToggle` prop

### Complete Props Interface
```typescript
interface DataTableProps<T> {
  // ===== BASIC PROPS (ALWAYS REQUIRED) =====
  data: T[];                                    // Data array
  columns: ColumnDef<T>[];                      // Column definitions

  // ===== OPTIONAL CORE PROPS =====
  emptyMessage?: string;                        // Empty state message
  keyExtractor?: (row: T) => string | number;   // Unique key for each row
  className?: string;                           // Custom table className

  // ===== SORTING (ALWAYS ENABLED) =====
  onSort?: (field: string, order: 'asc' | 'desc') => void;  // Sort handler
  currentSort?: { field: string; order: 'asc' | 'desc' };   // Current sort state

  // ===== OPTIONAL ADVANCED FEATURES =====
  enableColumnSearch?: boolean;                 // Enable column-level search (default: false)
  enableYearFilter?: boolean;                   // Enable year filter dropdown (default: false)
  enablePagination?: boolean;                   // Enable pagination (default: false)
  enableMinimizeToggle?: boolean;               // Enable minimize/maximize (default: false)

  // ===== FEATURE CONFIGURATION =====
  yearFilterConfig?: {
    availableYears?: string[];                  // Year options (default: 2020-2026)
    selectedYear?: string;                      // Current year
    onYearChange?: (year: string) => void;      // Year change handler
  };

  paginationConfig?: {
    pageSize?: number;                          // Records per page (default: 50)
    currentPage?: number;                       // Current page number
    totalRecords?: number;                      // Total records count
    onPageChange?: (page: number) => void;      // Page change handler
  };

  columnSearchConfig?: {
    onSearch?: (searches: Record<string, string>) => void;  // Search handler
    currentSearches?: Record<string, string>;   // Current search values
  };
}

interface ColumnDef<T> {
  key: string;                                  // Data key
  header: string;                               // Column header text
  sortable?: boolean;                           // Enable sorting (default: true)
  searchable?: boolean;                         // Enable column search (default: false)
  className?: string;                           // Column className
  render?: (value: any, row: T) => React.ReactNode;  // Custom render function
  align?: 'left' | 'center' | 'right';         // Text alignment
  minWidth?: string;                            // Minimum column width
}
```

### Feature Matrix by Page Type (Epic 9)

**✅ APPROVED CONFIGURATION**

| **Page Type** | **Story** | **Sorting** | **Column Search** | **Year Filter** | **Pagination** | **Minimize Toggle** |
|---------------|-----------|-------------|-------------------|-----------------|----------------|---------------------|
| **Home page tables** | 9.1-9.3 | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Landing - 6 content sections** | 9.15-9.16 | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Landing - Detailed table** | 9.15-9.16 | ✅ | ✅ | ✅ | ❌ | ✅ |
| **Rights/OFS/NCD pages** | 9.4-9.6 | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Performance Tracker** | 9.7a, 9.11 | ✅ | ❌ | ✅ | ✅ | ❌ |
| **Prospectus pages** | 9.8a, 9.12 | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Reviews pages** | 9.10a, 9.14 | ✅ | ✅ | ✅ | ✅ | ❌ |
| **IPO Listings pages** | 9.17 | ✅ | ❌ | ✅ | ✅ | ❌ |

### Usage Examples

#### Example 1: Simple Table (Home Page)
```tsx
// Home page tables - sorting only
<DataTable
  data={mainboardIPOs}
  columns={HOME_MAINBOARD_COLUMNS}
  emptyMessage="No mainboard IPOs"
  // No optional features enabled - just sorting
/>
```

#### Example 2: Full-Featured Table (Reviews Page)
```tsx
// Reviews page - all features except minimize toggle
<DataTable
  data={reviews}
  columns={REVIEWS_COLUMNS}
  emptyMessage="No reviews available"

  // Enable advanced features
  enableColumnSearch={true}
  enableYearFilter={true}
  enablePagination={true}

  // Feature configurations
  yearFilterConfig={{
    availableYears: DEFAULT_IPO_YEARS,
    selectedYear: year,
    onYearChange: handleYearChange
  }}

  paginationConfig={{
    pageSize: 50,
    currentPage: page,
    totalRecords: totalCount,
    onPageChange: handlePageChange
  }}

  columnSearchConfig={{
    onSearch: handleSearch,
    currentSearches: searches
  }}
/>
```

#### Example 3: Landing Page Detailed Table
```tsx
// Landing page - with minimize/maximize toggle
<DataTable
  data={detailedList}
  columns={MAINBOARD_DETAILED_COLUMNS}
  emptyMessage="No Mainboard IPOs for this year"

  // Enable features
  enableColumnSearch={true}
  enableYearFilter={true}
  enableMinimizeToggle={true}  // Unique to landing pages

  yearFilterConfig={{
    availableYears: DEFAULT_IPO_YEARS,
    selectedYear: year,
    onYearChange: handleYearChange
  }}

  columnSearchConfig={{
    onSearch: handleSearch,
    currentSearches: searches
  }}
/>
```

#### Example 4: IPO Listings Table
```tsx
// IPO Listings - year filter and pagination, NO search
<DataTable
  data={listings}
  columns={IPO_LISTINGS_COLUMNS}
  emptyMessage="No IPO listings found"

  // Enable year filter and pagination only
  enableYearFilter={true}
  enablePagination={true}

  yearFilterConfig={{
    availableYears: DEFAULT_IPO_YEARS,
    selectedYear: year,
    onYearChange: handleYearChange
  }}

  paginationConfig={{
    pageSize: 50,
    currentPage: page,
    totalRecords: totalCount,
    onPageChange: handlePageChange
  }}
/>
```

### Technical Notes
- Use shadcn/ui `Table` components as base
- Support client-side and server-side sorting
- Maintain sort state internally or externally
- Accessible with proper ARIA labels
- All advanced features are opt-in via props
- Features gracefully hide when not enabled
- Consistent styling across all feature combinations

### Component Hierarchy
```
DataTable (Enhanced)
    ├── TableHeader
    │   ├── SortIcons (always present)
    │   └── ColumnSearchBoxes (if enableColumnSearch=true)
    ├── TableBody
    ├── YearFilter (if enableYearFilter=true)
    ├── Pagination (if enablePagination=true)
    └── MinimizeToggle (if enableMinimizeToggle=true)
```

### Separate Components (NOT using DataTable)
- **Calendar Component** - For Calendar pages (Stories 9.9a, 9.13)
  - Monthly grid view with events
  - Not a table structure
  - Separate specialized component

---

## 2. Category Navigation Tabs Component

**Component Name:** `CategoryTabs`

**Location:** `web/components/shared/CategoryTabs.tsx`

### Purpose
A reusable tab navigation component for switching between different category pages.

### Requirements

#### Functional Requirements
1. **Display Tabs**
   - Render list of tabs horizontally
   - Highlight active tab based on current route
   - Support custom tab names and URLs

2. **Navigation**
   - Click tab to navigate to respective page
   - Active tab indicated by border/color
   - Smooth hover effects

3. **Customization**
   - Support optional icons per tab
   - Custom ARIA label
   - Responsive design (scroll on mobile if many tabs)

4. **Active State Detection**
   - Automatically detect active tab from URL pathname
   - Support custom active state logic

#### Props Interface
```typescript
interface CategoryTab {
  name: string;          // Tab display name
  href: string;          // Navigation URL
  value: string;         // Unique identifier
  icon?: React.ReactNode; // Optional icon
}

interface CategoryTabsProps {
  tabs: CategoryTab[];    // Tab definitions
  ariaLabel?: string;     // Accessibility label
  className?: string;     // Custom className
}
```

#### Pre-configured Variants
```typescript
// Export pre-configured tab sets for common use cases
export const IPO_LISTING_TABS: CategoryTab[];
export const IPO_CATEGORY_TABS: CategoryTab[];
export const MARKET_TABS: CategoryTab[];
```

#### Usage Examples
```tsx
// Example 1: IPO Listings tabs
<CategoryTabs tabs={IPO_LISTING_TABS} ariaLabel="IPO Listing Categories" />

// Example 2: Custom tabs
<CategoryTabs
  tabs={[
    { name: 'Mainboard', href: '/mainboard', value: 'mainboard' },
    { name: 'SME', href: '/sme', value: 'sme' }
  ]}
/>
```

### Technical Notes
- Use Next.js `Link` for navigation
- Use `usePathname` hook for active detection
- Accessible with ARIA attributes

---

## 3. Year Filter Component

**Component Name:** `YearFilter`

**Location:** `web/components/shared/YearFilter.tsx`

### Purpose
A reusable dropdown selector for filtering data by year.

### Requirements

#### Functional Requirements
1. **Year Selection**
   - Display dropdown with year options
   - Show selected year
   - Handle year change events

2. **Year Range**
   - Accept array of year strings
   - Support utility function to generate year ranges

3. **Customization**
   - Optional label text
   - Optional placeholder
   - Custom dropdown width
   - Custom ID for label association

4. **Default Configurations**
   - Pre-defined year ranges (e.g., 2020-2026 for IPOs)
   - Current year constant

#### Props Interface
```typescript
interface YearFilterProps {
  availableYears: string[];           // Year options
  selectedYear: string;               // Current selected year
  onYearChange: (year: string) => void; // Change handler
  label?: string;                     // Label text (default: "Year:")
  placeholder?: string;               // Placeholder (default: "Select year")
  className?: string;                 // Dropdown className (default: "w-[180px]")
  id?: string;                        // Input ID (default: "year-filter")
}
```

#### Utility Functions
```typescript
// Generate year range
generateYearRange(startYear: number, endYear: number): string[]

// Constants
DEFAULT_IPO_YEARS: string[]  // 2020-2026
CURRENT_YEAR: string         // Current year
```

#### Usage Examples
```tsx
// Example 1: Default IPO years
<YearFilter
  availableYears={DEFAULT_IPO_YEARS}
  selectedYear={selectedYear}
  onYearChange={handleYearChange}
/>

// Example 2: Custom configuration
<YearFilter
  availableYears={generateYearRange(2015, 2025)}
  selectedYear={year}
  onYearChange={setYear}
  label="Filter by Year:"
  className="w-[200px]"
/>
```

### Technical Notes
- Use shadcn/ui `Select` component
- Support controlled component pattern
- Accessible with proper labels

---

## 4. Common Render Functions

**Module Name:** `tableRenderFunctions`

**Location:** `web/lib/utils/tableRenderFunctions.ts`

### Purpose
A collection of reusable render functions for common data formatting in tables.

### Requirements

#### Function List

1. **Date Formatter**
   ```typescript
   renderDate(date: string | null, format?: string): string
   // Default format: "MMM dd, yyyy"
   // Returns "-" if null
   ```

2. **Number Formatter**
   ```typescript
   renderNumber(num: number | null): string
   // Format: Indian locale (1,23,456)
   // Returns "-" if null
   ```

3. **Currency Formatter**
   ```typescript
   renderCurrency(num: number | null, symbol?: string): string
   // Default symbol: "₹"
   // Format: ₹1,23,456
   // Returns "-" if null
   ```

4. **Percentage with Color**
   ```typescript
   renderPercentWithColor(percent: number | null): React.ReactNode
   // Green if positive, red if negative
   // Format: +12.34% or -5.67%
   // Returns "-" if null
   ```

5. **Subscription Multiplier**
   ```typescript
   renderSubscription(value: number | null): string
   // Format: 2.45x
   // Returns "-" if null
   ```

6. **Link Renderer**
   ```typescript
   renderLink(text: string, href: string, className?: string): React.ReactNode
   // Returns Next.js Link component
   ```

7. **Badge Renderer**
   ```typescript
   renderBadge(text: string, variant?: BadgeVariant): React.ReactNode
   // Returns shadcn Badge component
   ```

#### Usage Example
```tsx
import { renderFunctions } from '@/lib/utils/tableRenderFunctions';

const columns = [
  {
    key: 'listingDate',
    header: 'Listing Date',
    render: (value) => renderFunctions.date(value)
  },
  {
    key: 'issueSize',
    header: 'Size',
    render: (value) => renderFunctions.currency(value)
  },
  {
    key: 'gainPercent',
    header: 'Gain %',
    render: (value) => renderFunctions.percentWithColor(value)
  }
];
```

---

## 5. IPO Listings Table (Specialized)

**Component Name:** `IPOListingsTable`

**Location:** `web/components/listings/IPOListingsTable.tsx`

### Purpose
Specialized table component for IPO Listings pages, using the generic DataTable component.

### Requirements

#### Functional Requirements
1. **Use Generic DataTable**
   - Build on top of `DataTable` component
   - Pre-configure columns for IPO listings

2. **19 Columns Configuration**
   - Company Name (with link and badge)
   - Issue Open/Close/Listing Dates
   - Issue Price, Size, Lot Size
   - Subscriptions (Overall, QIB, NII, Retail)
   - GMP, Allotment Date
   - Listing Day Close Price, Gain %
   - Current Prices (BSE, NSE), Current Gain %
   - Market Cap

3. **Custom Rendering**
   - Use common render functions
   - Link company name to detail page
   - Show category badge
   - Color-code gain/loss percentages

4. **Sorting**
   - Support sorting on key columns
   - Pass sort events to parent

#### Props Interface
```typescript
interface IPOListingsTableProps {
  data: IPOListingData[];
  category: 'MAINBOARD' | 'SME' | 'FPO';
  onSort?: (field: string, order: 'asc' | 'desc') => void;
  currentSort?: { field: string; order: 'asc' | 'desc' };
}
```

---

## Implementation Priority

1. ✅ **Story 9.17 Created** - Requirements documented in Epic 9
2. ✅ **Image References Added** - All three images linked
3. ✅ **DataTable Architecture Decided** - Enhanced single component with optional features (2025-10-11)
4. **Next Steps:**
   - Enhance existing `DataTable.tsx` with optional advanced features
   - Create supporting components (YearFilter, ColumnSearch, Pagination)
   - Implement feature toggling via props
   - Begin implementation for Epic 9 stories

---

## Architecture Decision Log

### 2025-10-11: Enhanced DataTable Component Architecture

**Decision:** Use ONE enhanced DataTable component with optional features (Option A)

**Rationale:**
- Single component to maintain and test
- Consistent behavior and styling across all tables
- Features can be enabled/disabled via props
- Existing `DataTable.tsx` is 80% complete, just needs enhancement
- Reduces code duplication compared to multiple separate components

**Alternatives Considered:**
- Option B: Two separate components (SimpleDataTable and AdvancedDataTable) - Rejected due to maintenance overhead
- Option C: Wrapper components for different use cases - Rejected due to unnecessary abstraction

**Feature Matrix Approved:**
- All tables have sorting enabled
- Advanced features (column search, year filter, pagination, minimize toggle) are opt-in
- Feature configuration documented in matrix above

**Status:** ✅ Approved and ready for implementation

---

## Questions for Clarification

### ✅ RESOLVED

1. **DataTable Component:**
   - ✅ Pagination: Built into table as optional feature (`enablePagination` prop)
   - ✅ Column hiding/showing: Not required for MVP
   - ✅ Row selection/checkboxes: Not required for MVP

2. **CategoryTabs Component:**
   - Pending: Should tabs support dropdown submenus?
   - Pending: Do we need vertical tab layout option?

3. **YearFilter Component:**
   - Pending: Should we support date range (From-To)?
   - Pending: Do we need month/quarter filters too?

4. **General:**
   - Pending: Do we need print/export functionality?
   - Pending: Should components support dark mode?
   - Pending: Do we need loading states built-in?
