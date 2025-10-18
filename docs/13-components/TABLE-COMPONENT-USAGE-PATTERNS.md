# DataTable Component Usage Patterns

This document outlines how the reusable `DataTable` component will be used in different page layouts.

---

## Pattern 1: Single Table Page (Simple)

**Use Case:** Pages with ONE main table
**Examples:** `/mainboard-ipo-listings`, `/sme-ipo-listings`, `/history`

### Page Structure
```
┌─────────────────────────────────────┐
│  Page Header / Title                │
├─────────────────────────────────────┤
│  Filters (Year, Category, etc.)     │
├─────────────────────────────────────┤
│                                     │
│         DataTable Component         │
│      (19 columns, sortable)         │
│                                     │
└─────────────────────────────────────┘
```

### Implementation Pattern

```tsx
// app/mainboard-ipo-listings/page.tsx

export default function MainboardIPOListingsPage({ searchParams }) {
  const year = searchParams.year || '2025';
  const data = await fetchIPOListings({ category: 'MAINBOARD', year });

  return (
    <div className="container mx-auto py-8">
      {/* Page Header */}
      <h1>Mainboard IPO Listings</h1>

      {/* Navigation Tabs */}
      <ListingCategoryTabs />

      {/* Filters */}
      <div className="flex gap-4 my-6">
        <YearFilter
          availableYears={DEFAULT_IPO_YEARS}
          selectedYear={year}
          onYearChange={handleYearChange}
        />
      </div>

      {/* Single Table */}
      <DataTable
        data={data}
        columns={IPO_LISTINGS_COLUMNS}
        emptyMessage="No IPO listings found for this year"
      />

      {/* Pagination */}
      <Pagination />
    </div>
  );
}
```

### Characteristics
✅ **Simple:** Direct use of DataTable
✅ **Clean:** One table, one purpose
✅ **Maintainable:** Straightforward logic

---

## Pattern 2: Multiple Tables Page (Home Page)

**Use Case:** Pages with MULTIPLE tables displayed together
**Examples:** Home page (4 IPO tables), Landing pages (multiple sections)

### Page Structure
```
┌─────────────────────────────────────┐
│  Hero Section                       │
├──────────────┬──────────────────────┤
│              │                      │
│  Table 1:    │    Table 2:          │
│  Mainboard   │    SME IPOs          │
│  IPOs        │                      │
│              │                      │
├──────────────┼──────────────────────┤
│              │                      │
│  Table 3:    │    Table 4:          │
│  Upcoming MB │    Upcoming SME      │
│              │                      │
└──────────────┴──────────────────────┘
```

### Approach A: Direct Multiple DataTable Components

**Best for:** Independent tables with different data/columns

```tsx
// app/page.tsx (Home Page)

export default async function HomePage() {
  // Fetch data for each table independently
  const mainboardIPOs = await fetchMainboardIPOs();
  const smeIPOs = await fetchSMEIPOs();
  const upcomingMainboard = await fetchUpcomingMainboard();
  const upcomingSME = await fetchUpcomingSME();

  return (
    <div>
      <Hero />

      {/* Multiple Tables Section */}
      <section className="py-12">
        <h2>IPO 2025 Lists</h2>

        {/* Two-column grid layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

          {/* Table 1: Mainboard */}
          <div className="border rounded-lg p-4">
            <h3>IPO 2025 List (Mainboard)</h3>
            <DataTable
              data={mainboardIPOs}
              columns={HOME_MAINBOARD_COLUMNS}
              emptyMessage="No mainboard IPOs"
            />
            <Link href="/dashboard?category=mainboard">
              More Mainboard IPOs...
            </Link>
          </div>

          {/* Table 2: SME */}
          <div className="border rounded-lg p-4">
            <h3>SME IPO 2025 List</h3>
            <DataTable
              data={smeIPOs}
              columns={HOME_SME_COLUMNS}
              emptyMessage="No SME IPOs"
            />
            <Link href="/dashboard?category=sme">
              More SME IPOs...
            </Link>
          </div>

          {/* Table 3: Upcoming Mainboard */}
          <div className="border rounded-lg p-4">
            <h3>Upcoming Mainboard IPOs</h3>
            <DataTable
              data={upcomingMainboard}
              columns={UPCOMING_COLUMNS}
              emptyMessage="No upcoming IPOs"
            />
            <Link href="/dashboard?category=mainboard&status=upcoming">
              More Upcoming...
            </Link>
          </div>

          {/* Table 4: Upcoming SME */}
          <div className="border rounded-lg p-4">
            <h3>Upcoming SME IPOs</h3>
            <DataTable
              data={upcomingSME}
              columns={UPCOMING_COLUMNS}
              emptyMessage="No upcoming IPOs"
            />
            <Link href="/dashboard?category=sme&status=upcoming">
              More Upcoming...
            </Link>
          </div>

        </div>
      </section>

      <Features />
      <CTA />
    </div>
  );
}
```

**Pros:**
✅ Full control over each table
✅ Independent data fetching
✅ Easy to customize per table
✅ No abstraction complexity

**Cons:**
❌ More code duplication
❌ Manual layout management

---

### Approach B: Wrapper Component for Multiple Tables

**Best for:** Similar tables with consistent layout pattern

Create a reusable wrapper component:

```tsx
// components/shared/TableGrid.tsx

interface TableCardConfig {
  title: string;
  data: any[];
  columns: ColumnDef<any>[];
  emptyMessage: string;
  moreLink?: {
    text: string;
    href: string;
  };
}

interface TableGridProps {
  tables: TableCardConfig[];
  layout?: '1col' | '2col' | '3col' | '2x2';
}

export function TableGrid({ tables, layout = '2col' }: TableGridProps) {
  const gridClass = {
    '1col': 'grid-cols-1',
    '2col': 'grid grid-cols-1 md:grid-cols-2 gap-8',
    '3col': 'grid grid-cols-1 md:grid-cols-3 gap-6',
    '2x2': 'grid grid-cols-1 md:grid-cols-2 gap-8'
  };

  return (
    <div className={gridClass[layout]}>
      {tables.map((table, index) => (
        <div key={index} className="border rounded-lg p-4">
          <h3 className="text-xl font-semibold mb-4">{table.title}</h3>

          <DataTable
            data={table.data}
            columns={table.columns}
            emptyMessage={table.emptyMessage}
          />

          {table.moreLink && (
            <Link
              href={table.moreLink.href}
              className="text-primary hover:underline mt-4 inline-block"
            >
              {table.moreLink.text}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
```

**Usage:**

```tsx
// app/page.tsx (Home Page) - Using wrapper

export default async function HomePage() {
  const [mainboardIPOs, smeIPOs, upcomingMB, upcomingSME] = await Promise.all([
    fetchMainboardIPOs(),
    fetchSMEIPOs(),
    fetchUpcomingMainboard(),
    fetchUpcomingSME()
  ]);

  const homePageTables: TableCardConfig[] = [
    {
      title: 'IPO 2025 List (Mainboard)',
      data: mainboardIPOs,
      columns: HOME_MAINBOARD_COLUMNS,
      emptyMessage: 'No mainboard IPOs',
      moreLink: { text: 'More Mainboard IPOs...', href: '/dashboard?category=mainboard' }
    },
    {
      title: 'SME IPO 2025 List',
      data: smeIPOs,
      columns: HOME_SME_COLUMNS,
      emptyMessage: 'No SME IPOs',
      moreLink: { text: 'More SME IPOs...', href: '/dashboard?category=sme' }
    },
    {
      title: 'Upcoming Mainboard IPOs',
      data: upcomingMB,
      columns: UPCOMING_COLUMNS,
      emptyMessage: 'No upcoming IPOs',
      moreLink: { text: 'More Upcoming...', href: '/dashboard?category=mainboard&status=upcoming' }
    },
    {
      title: 'Upcoming SME IPOs',
      data: upcomingSME,
      columns: UPCOMING_COLUMNS,
      emptyMessage: 'No upcoming IPOs',
      moreLink: { text: 'More Upcoming...', href: '/dashboard?category=sme&status=upcoming' }
    }
  ];

  return (
    <div>
      <Hero />

      <section className="py-12">
        <h2>IPO 2025 Lists</h2>
        <TableGrid tables={homePageTables} layout="2x2" />
      </section>

      <Features />
      <CTA />
    </div>
  );
}
```

**Pros:**
✅ Less code duplication
✅ Consistent layout automatically
✅ Easy to add/remove tables
✅ Configuration-based

**Cons:**
❌ Less flexibility per table
❌ Additional abstraction layer

---

## Pattern 3: Tabbed Multi-Table Page

**Use Case:** Multiple tables with tab navigation
**Examples:** Rights Issues page (Upcoming | Live tabs)

### Page Structure
```
┌─────────────────────────────────────┐
│  Page Title                         │
├─────────────────────────────────────┤
│  [Upcoming] [Live]  ← Tabs          │
├─────────────────────────────────────┤
│                                     │
│      DataTable Component            │
│    (Shows selected tab data)        │
│                                     │
└─────────────────────────────────────┘
```

### Implementation Pattern

```tsx
// app/rights-issues/page.tsx

export default function RightsIssuesPage({ searchParams }) {
  const activeTab = searchParams.tab || 'upcoming';
  const data = await fetchRightsIssues(activeTab);

  return (
    <div className="container mx-auto py-8">
      <h1>Rights Issues</h1>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="live">Live</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab}>
          {/* Single table - data changes based on tab */}
          <DataTable
            data={data}
            columns={RIGHTS_ISSUE_COLUMNS}
            emptyMessage={`No ${activeTab} rights issues`}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

**Characteristics:**
✅ **Single Table Instance:** Only one table rendered at a time
✅ **Dynamic Data:** Data changes based on tab
✅ **State Management:** Tab state in URL query params

---

## Pattern 4: Complex Landing Page (Mixed Content + Table)

**Use Case:** Landing pages with multiple content sections + detailed table
**Examples:** `/mainboard-ipos`, `/sme-ipos`

### Page Structure
```
┌─────────────────────────────────────┐
│  Summary Metrics (6 cards)          │
├─────────────────────────────────────┤
│  Content Sections (6 card grids)    │
├─────────────────────────────────────┤
│  Navigation Cards (4 cards)         │
├─────────────────────────────────────┤
│  [Minimize ▲] Detailed Table        │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  │      DataTable Component      │  │
│  │    (Full detailed listing)    │  │
│  │                               │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Implementation Pattern

```tsx
// app/mainboard-ipos/page.tsx

export default async function MainboardIPOsLandingPage({ searchParams }) {
  const year = searchParams.year || '2025';

  // Fetch different data for different sections
  const metrics = await getMainboardSummaryMetrics();
  const currentIPOs = await getMainboardCurrentIPOs();
  const upcomingIPOs = await getMainboardUpcomingIPOs();
  const recentlyListed = await getMainboardRecentlyListedIPOs();
  const detailedList = await getMainboardDetailedList(year);

  return (
    <div className="container mx-auto py-8">
      {/* Summary Metrics */}
      <MainboardSummaryMetrics data={metrics} />

      {/* Content Sections (Cards) */}
      <div className="grid grid-cols-3 gap-6 my-8">
        <ContentCard title="Current IPOs" data={currentIPOs} />
        <ContentCard title="Upcoming IPOs" data={upcomingIPOs} />
        <ContentCard title="Recently Listed" data={recentlyListed} />
      </div>

      {/* Navigation Cards */}
      <MainboardNavigationCards />

      {/* Collapsible Detailed Table Section */}
      <CollapsibleSection
        title="Detailed IPO Listings"
        defaultExpanded={true}
      >
        <div className="flex justify-between items-center mb-4">
          <YearFilter
            availableYears={DEFAULT_IPO_YEARS}
            selectedYear={year}
            onYearChange={handleYearChange}
          />
          <span className="text-sm text-gray-600">
            Total Records: {detailedList.length}
          </span>
        </div>

        {/* Main Detailed Table */}
        <DataTable
          data={detailedList}
          columns={MAINBOARD_DETAILED_COLUMNS}
          emptyMessage="No Mainboard IPOs for this year"
        />
      </CollapsibleSection>
    </div>
  );
}
```

**Characteristics:**
✅ **Mixed Layout:** Cards + Table together
✅ **Collapsible Table:** Can minimize/maximize
✅ **Rich Context:** Table is one part of comprehensive page

---

## Summary: When to Use Each Pattern

| Pattern | Use Case | Pages | Complexity |
|---------|----------|-------|------------|
| **Pattern 1: Single Table** | One main table on page | IPO Listings, History, Reviews | ⭐ Simple |
| **Pattern 2A: Multiple Direct** | Independent tables, different layouts | Home page | ⭐⭐ Moderate |
| **Pattern 2B: TableGrid Wrapper** | Multiple similar tables, consistent layout | Home page (cleaner) | ⭐⭐ Moderate |
| **Pattern 3: Tabbed** | Multiple datasets, one visible at a time | Rights Issues, OFS | ⭐⭐ Moderate |
| **Pattern 4: Complex Landing** | Rich content + detailed table | Landing pages | ⭐⭐⭐ Complex |

---

## Recommended Approach

### **For Story 9.17 (IPO Listings) - Pattern 1**
Use simple single table approach:
```tsx
<CategoryTabs />
<YearFilter />
<DataTable columns={19} />
<Pagination />
```

### **For Home Page (Story 9.1-9.3) - Pattern 2B**
Use TableGrid wrapper for consistency:
```tsx
<TableGrid tables={[table1Config, table2Config, table3Config, table4Config]} layout="2x2" />
```

### **For Landing Pages (Story 9.15-9.16) - Pattern 4**
Use complex layout with collapsible table:
```tsx
<Metrics />
<ContentSections />
<NavigationCards />
<CollapsibleSection>
  <DataTable />
</CollapsibleSection>
```

---

## Component Reusability Hierarchy

```
DataTable (Core)
    ↓
    ├── Used directly in Pattern 1 (Simple pages)
    ├── Wrapped by TableGrid in Pattern 2B (Home page)
    ├── Inside Tabs in Pattern 3 (Tabbed pages)
    └── Part of complex layout in Pattern 4 (Landing pages)
```

---

## Question for You

**Which pattern do you prefer for the Home Page (4 tables)?**

**A) Pattern 2A - Direct Multiple DataTables** (More control, more code)
**B) Pattern 2B - TableGrid Wrapper** (Cleaner, more consistent)

Let me know your preference and I'll document it as the standard!
