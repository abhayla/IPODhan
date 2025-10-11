# DataTable Component - Usage Examples

This document provides practical examples of using the enhanced DataTable component across different scenarios in Epic 9.

---

## Table of Contents

1. [Basic Usage (Home Page Tables)](#1-basic-usage-home-page-tables)
2. [IPO Listings Pages (Year Filter + Pagination)](#2-ipo-listings-pages-year-filter--pagination)
3. [Performance Tracker Pages](#3-performance-tracker-pages)
4. [Prospectus Pages (Full Features)](#4-prospectus-pages-full-features)
5. [Reviews Pages (Full Features)](#5-reviews-pages-full-features)
6. [Landing Page Detailed Table](#6-landing-page-detailed-table)
7. [Rights/OFS/NCD Pages](#7-rightsofsnd-pages)

---

## 1. Basic Usage (Home Page Tables)

**Use Case:** Simple tables with sorting only (Stories 9.1-9.3)

**Features Enabled:** ✅ Sorting only

```tsx
// web/app/page.tsx or components/home/HomeIPOTablesSection.tsx

import { DataTable, ColumnDef } from '@/components/shared/DataTable';

// Define columns
const columns: ColumnDef<IPO>[] = [
  {
    key: 'companyName',
    header: 'Issuer Company',
    sortable: true,
  },
  {
    key: 'openDate',
    header: 'Open',
    sortable: true,
    render: (value) => renderFunctions.date(value),
  },
  {
    key: 'closeDate',
    header: 'Close',
    sortable: true,
    render: (value) => renderFunctions.date(value),
  },
];

// Component
export function MainboardIPOTable({ data }: { data: IPO[] }) {
  return (
    <div className="border rounded-lg p-4">
      <h3 className="text-xl font-semibold mb-4">IPO 2025 List (Mainboard)</h3>

      {/* Simple table - sorting only */}
      <DataTable
        data={data}
        columns={columns}
        emptyMessage="No mainboard IPOs available"
      />

      <Link href="/dashboard?category=mainboard" className="text-primary hover:underline mt-4 inline-block">
        More Mainboard IPOs...
      </Link>
    </div>
  );
}
```

---

## 2. IPO Listings Pages (Year Filter + Pagination)

**Use Case:** Story 9.17 - Mainboard/SME/FPO Listings

**Features Enabled:** ✅ Sorting, ✅ Year Filter, ✅ Pagination

```tsx
// web/app/mainboard-ipo-listings/page.tsx

'use client';

import { useState } from 'react';
import { DataTable, ColumnDef, DEFAULT_IPO_YEARS_EXPORT, renderFunctions } from '@/components/shared/DataTable';
import { useRouter, useSearchParams } from 'next/navigation';

// Define 19 columns for IPO Listings
const columns: ColumnDef<IPOListing>[] = [
  {
    key: 'companyName',
    header: 'Company Name',
    render: (value, row) => (
      <Link href={`/ipos/${row.slug}`} className="text-primary hover:underline">
        {value}
      </Link>
    ),
  },
  { key: 'issueOpenDate', header: 'Issue Open', render: (v) => renderFunctions.date(v) },
  { key: 'issueCloseDate', header: 'Issue Close', render: (v) => renderFunctions.date(v) },
  { key: 'listingDate', header: 'Listing Date', render: (v) => renderFunctions.date(v) },
  { key: 'issuePrice', header: 'Issue Price', align: 'right', render: (v) => renderFunctions.currency(v) },
  { key: 'issueSize', header: 'Issue Size (Cr)', align: 'right', render: (v) => renderFunctions.number(v) },
  { key: 'lotSize', header: 'Lot Size', align: 'right', render: (v) => renderFunctions.number(v) },
  { key: 'subOverall', header: 'Sub - Overall', align: 'right', render: (v) => renderFunctions.subscription(v) },
  { key: 'subQIB', header: 'Sub - QIB', align: 'right', render: (v) => renderFunctions.subscription(v) },
  { key: 'subNII', header: 'Sub - NII', align: 'right', render: (v) => renderFunctions.subscription(v) },
  { key: 'subRetail', header: 'Sub - Retail', align: 'right', render: (v) => renderFunctions.subscription(v) },
  { key: 'gmp', header: 'GMP', align: 'right', render: (v) => renderFunctions.currency(v) },
  { key: 'allotmentDate', header: 'Allotment', render: (v) => renderFunctions.date(v) },
  { key: 'listingDayClose', header: 'Listing Day Close', align: 'right', render: (v) => renderFunctions.currency(v) },
  { key: 'listingDayGain', header: 'Listing Gain %', align: 'right', render: (v) => renderFunctions.percentWithColor(v) },
  { key: 'currentBSE', header: 'Current BSE', align: 'right', render: (v) => renderFunctions.currency(v) },
  { key: 'currentNSE', header: 'Current NSE', align: 'right', render: (v) => renderFunctions.currency(v) },
  { key: 'currentGain', header: 'Current Gain %', align: 'right', render: (v) => renderFunctions.percentWithColor(v) },
  { key: 'marketCap', header: 'Market Cap (Cr)', align: 'right', render: (v) => renderFunctions.number(v) },
];

export default function MainboardIPOListingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [year, setYear] = useState(searchParams.get('year') || '2025');
  const [page, setPage] = useState(1);
  const [listings, setListings] = useState<IPOListing[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const handleYearChange = (newYear: string) => {
    setYear(newYear);
    setPage(1);
    router.push(`/mainboard-ipo-listings?year=${newYear}`);
    // Fetch data for new year
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    // Fetch data for new page
  };

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Mainboard IPO Listings</h1>

      {/* Category Tabs */}
      <CategoryTabs />

      {/* Enhanced DataTable with Year Filter and Pagination */}
      <DataTable
        data={listings}
        columns={columns}
        emptyMessage="No IPO listings found for this year"

        // Enable features
        enableYearFilter={true}
        enablePagination={true}

        // Year filter configuration
        yearFilterConfig={{
          availableYears: DEFAULT_IPO_YEARS_EXPORT,
          selectedYear: year,
          onYearChange: handleYearChange,
        }}

        // Pagination configuration
        paginationConfig={{
          pageSize: 50,
          currentPage: page,
          totalRecords: totalCount,
          onPageChange: handlePageChange,
        }}
      />
    </div>
  );
}
```

---

## 3. Performance Tracker Pages

**Use Case:** Stories 9.7a, 9.11 - Mainboard/SME Performance Tracker

**Features Enabled:** ✅ Sorting, ✅ Year Filter, ✅ Pagination

```tsx
// web/app/mainboard-ipo-performance-tracker/page.tsx

'use client';

import { useState } from 'react';
import { DataTable, ColumnDef, renderFunctions } from '@/components/shared/DataTable';

const columns: ColumnDef<IPOPerformance>[] = [
  {
    key: 'companyName',
    header: 'Company Name',
    render: (value, row) => (
      <div className="space-y-1">
        <Link href={`/ipos/${row.slug}`} className="text-primary hover:underline">
          {value}
        </Link>
        <div className="text-xs text-gray-500">
          <a href={`/stock-quotes/${row.symbol}`} className="hover:underline">Stock Quotes</a>
        </div>
      </div>
    ),
  },
  { key: 'listedOn', header: 'Listed On', render: (v) => renderFunctions.date(v) },
  { key: 'issuePrice', header: 'Issue Price', align: 'right', render: (v) => renderFunctions.currency(v) },
  { key: 'listingDayClose', header: 'Listing Day Close', align: 'right', render: (v) => renderFunctions.currency(v) },
  { key: 'listingDayGain', header: 'Listing Day Gain', align: 'right', render: (v) => renderFunctions.percentWithColor(v) },
  { key: 'currentPrice', header: 'Current Price', align: 'right', render: (v) => renderFunctions.currency(v) },
  { key: 'profitLoss', header: 'Profit/Loss', align: 'right', render: (v) => renderFunctions.percentWithColor(v) },
];

export default function MainboardPerformanceTrackerPage() {
  const [year, setYear] = useState('2025');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<IPOPerformance[]>([]);

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Mainboard IPO Performance Tracker</h1>

      <DataTable
        data={data}
        columns={columns}
        emptyMessage={`No Mainboard IPOs listed in ${year}`}

        enableYearFilter={true}
        enablePagination={true}

        yearFilterConfig={{
          selectedYear: year,
          onYearChange: setYear,
        }}

        paginationConfig={{
          pageSize: 50,
          currentPage: page,
          onPageChange: setPage,
        }}
      />
    </div>
  );
}
```

---

## 4. Prospectus Pages (Full Features)

**Use Case:** Stories 9.8a, 9.12 - Mainboard/SME Prospectus

**Features Enabled:** ✅ Sorting, ✅ Column Search, ✅ Year Filter, ✅ Pagination

```tsx
// web/app/mainboard-ipo-prospectus/page.tsx

'use client';

import { useState } from 'react';
import { DataTable, ColumnDef } from '@/components/shared/DataTable';
import { ExternalLink } from 'lucide-react';

const columns: ColumnDef<ProspectusDoc>[] = [
  {
    key: 'companyName',
    header: 'Company Name',
    searchable: true,
    render: (value, row) => (
      <Link href={`/ipos/${row.slug}`} className="text-primary hover:underline">
        {value}
      </Link>
    ),
  },
  {
    key: 'exchange',
    header: 'Exchange',
    searchable: true,
    align: 'center',
  },
  {
    key: 'drhpUrl',
    header: 'DRHP PDF',
    align: 'center',
    render: (value) => value ? (
      <a href={value} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
        Download <ExternalLink className="h-3 w-3" />
      </a>
    ) : '-',
  },
  {
    key: 'rhpUrl',
    header: 'RHP PDF',
    align: 'center',
    render: (value) => value ? (
      <a href={value} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
        Download <ExternalLink className="h-3 w-3" />
      </a>
    ) : '-',
  },
];

export default function MainboardProspectusPage() {
  const [year, setYear] = useState('2025');
  const [page, setPage] = useState(1);
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [data, setData] = useState<ProspectusDoc[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const handleSearch = (newSearches: Record<string, string>) => {
    setSearches(newSearches);
    setPage(1);
    // Fetch filtered data
  };

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Mainboard IPO Prospectus</h1>

      <p className="text-gray-600 mb-6">
        Access Draft Red Herring Prospectus (DRHP) and Red Herring Prospectus (RHP) documents for Mainboard IPOs.
      </p>

      <DataTable
        data={data}
        columns={columns}
        emptyMessage="No prospectus documents available"

        // Enable all features except minimize toggle
        enableColumnSearch={true}
        enableYearFilter={true}
        enablePagination={true}

        yearFilterConfig={{
          selectedYear: year,
          onYearChange: setYear,
        }}

        paginationConfig={{
          pageSize: 50,
          currentPage: page,
          totalRecords: totalCount,
          onPageChange: setPage,
        }}

        columnSearchConfig={{
          onSearch: handleSearch,
          currentSearches: searches,
        }}
      />
    </div>
  );
}
```

---

## 5. Reviews Pages (Full Features)

**Use Case:** Stories 9.10a, 9.14 - Mainboard/SME Reviews

**Features Enabled:** ✅ Sorting, ✅ Column Search, ✅ Year Filter, ✅ Pagination

```tsx
// web/app/mainboard-ipo-reviews/page.tsx

'use client';

import { useState } from 'react';
import { DataTable, ColumnDef } from '@/components/shared/DataTable';

const columns: ColumnDef<IPOReview>[] = [
  {
    key: 'rowNumber',
    header: '#',
    sortable: false,
    searchable: false,
    align: 'center',
    render: (_, __, index) => index + 1,
  },
  {
    key: 'reviewTitle',
    header: 'Review Title',
    searchable: true,
    render: (value, row) => (
      <Link href={`/ipo-reviews/${row.id}`} className="text-primary hover:underline">
        {value}
      </Link>
    ),
  },
  {
    key: 'author',
    header: 'Author',
    searchable: true,
  },
  {
    key: 'recommendation',
    header: 'Recommendation',
    searchable: true,
    render: (value) => (
      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
        {value}
      </span>
    ),
  },
  {
    key: 'ipoName',
    header: 'IPO',
    searchable: true,
    render: (value, row) => (
      <Link href={`/ipos/${row.ipoSlug}`} className="text-primary hover:underline">
        {value}
      </Link>
    ),
  },
];

export default function MainboardIPOReviewsPage() {
  const [year, setYear] = useState('2025');
  const [page, setPage] = useState(1);
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [data, setData] = useState<IPOReview[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Mainboard IPO Reviews & Analysis</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h2 className="font-semibold mb-2">What are IPO Reviews?</h2>
        <p className="text-sm text-gray-700">
          IPO forecast helps investors decide if the IPO is worth investing in. Our analysis covers company background,
          offer details, valuation, financial performance, risks & benefits, and peer comparison for both short and long-term investors.
        </p>
      </div>

      <DataTable
        data={data}
        columns={columns}
        emptyMessage={`No Mainboard IPO reviews available for ${year}`}

        enableColumnSearch={true}
        enableYearFilter={true}
        enablePagination={true}

        yearFilterConfig={{
          selectedYear: year,
          onYearChange: setYear,
        }}

        paginationConfig={{
          pageSize: 50,
          currentPage: page,
          totalRecords: totalCount,
          onPageChange: setPage,
        }}

        columnSearchConfig={{
          onSearch: setSearches,
          currentSearches: searches,
        }}
      />
    </div>
  );
}
```

---

## 6. Landing Page Detailed Table

**Use Case:** Stories 9.15-9.16 - Mainboard/SME Landing Pages

**Features Enabled:** ✅ Sorting, ✅ Column Search, ✅ Year Filter, ✅ Minimize Toggle (NO Pagination)

```tsx
// web/app/mainboard-ipos/page.tsx

'use client';

import { useState } from 'react';
import { DataTable, ColumnDef, renderFunctions } from '@/components/shared/DataTable';

const detailedColumns: ColumnDef<IPODetailed>[] = [
  { key: 'company', header: 'Company', searchable: true },
  { key: 'openingDate', header: 'Opening Date', render: (v) => renderFunctions.date(v) },
  { key: 'closingDate', header: 'Closing Date', render: (v) => renderFunctions.date(v) },
  { key: 'listingDate', header: 'Listing Date', render: (v) => renderFunctions.date(v) },
  { key: 'issuePrice', header: 'Issue Price', align: 'right', render: (v) => renderFunctions.currency(v) },
  { key: 'totalIssueAmount', header: 'Total Issue Amount', align: 'right', render: (v) => renderFunctions.currency(v) },
  { key: 'listingAt', header: 'Listing At', searchable: true },
  { key: 'leadManager', header: 'Lead Manager', searchable: true },
  { key: 'compare', header: 'Compare', align: 'center' },
];

export default function MainboardIPOsLandingPage() {
  const [year, setYear] = useState('2025');
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [detailedData, setDetailedData] = useState<IPODetailed[]>([]);

  return (
    <div className="container mx-auto py-8">
      {/* Summary Metrics */}
      <MainboardSummaryMetrics />

      {/* Content Sections (6 card grids) */}
      <MainboardContentSections />

      {/* Navigation Cards */}
      <MainboardNavigationCards />

      {/* Detailed Table with Minimize/Maximize */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold mb-4">Detailed IPO Listings</h2>

        <DataTable
          data={detailedData}
          columns={detailedColumns}
          emptyMessage="No Mainboard IPOs for this year"

          // Enable column search, year filter, and minimize toggle
          enableColumnSearch={true}
          enableYearFilter={true}
          enableMinimizeToggle={true}  // Unique to landing pages

          yearFilterConfig={{
            selectedYear: year,
            onYearChange: setYear,
          }}

          columnSearchConfig={{
            onSearch: setSearches,
            currentSearches: searches,
          }}
        />
      </section>
    </div>
  );
}
```

---

## 7. Rights/OFS/NCD Pages

**Use Case:** Stories 9.4-9.6 - Rights Issues, OFS, NCD

**Features Enabled:** ✅ Sorting, ✅ Column Search, ✅ Year Filter, ✅ Pagination

```tsx
// web/app/rights-issues/page.tsx

'use client';

import { useState } from 'react';
import { DataTable, ColumnDef, renderFunctions } from '@/components/shared/DataTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const columns: ColumnDef<RightsIssue>[] = [
  {
    key: 'issuerCompany',
    header: 'Issuer Company',
    searchable: true,
    render: (value, row) => (
      <Link href={`/ipos/${row.slug}`} className="text-primary hover:underline">
        {value}
      </Link>
    ),
  },
  { key: 'recordDate', header: 'Record Date', render: (v) => renderFunctions.date(v) },
  { key: 'openDate', header: 'Open Date', render: (v) => renderFunctions.date(v) },
  { key: 'renunciationDate', header: 'Renunciation Date', render: (v) => renderFunctions.date(v) },
];

export default function RightsIssuesPage() {
  const [activeTab, setActiveTab] = useState('upcoming');
  const [year, setYear] = useState('2025');
  const [page, setPage] = useState(1);
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [data, setData] = useState<RightsIssue[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Rights Issues</h1>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h2 className="font-semibold mb-2">What are Rights Issues?</h2>
        <p className="text-sm text-gray-700">
          Rights issues allow existing shareholders to buy additional shares at a discounted price...
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
          <TabsTrigger value="live">Live</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab}>
          <DataTable
            data={data}
            columns={columns}
            emptyMessage={`No ${activeTab} rights issues`}

            // Enable all features
            enableColumnSearch={true}
            enableYearFilter={true}
            enablePagination={true}

            yearFilterConfig={{
              selectedYear: year,
              onYearChange: setYear,
            }}

            paginationConfig={{
              pageSize: 50,
              currentPage: page,
              totalRecords: totalCount,
              onPageChange: setPage,
            }}

            columnSearchConfig={{
              onSearch: setSearches,
              currentSearches: searches,
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

---

## Quick Reference: Feature Matrix

| Page Type | Sorting | Column Search | Year Filter | Pagination | Minimize |
|-----------|---------|---------------|-------------|------------|----------|
| Home page tables | ✅ | ❌ | ❌ | ❌ | ❌ |
| Landing - sections | ✅ | ❌ | ❌ | ❌ | ❌ |
| Landing - detailed | ✅ | ✅ | ✅ | ❌ | ✅ |
| IPO Listings | ✅ | ❌ | ✅ | ✅ | ❌ |
| Performance Tracker | ✅ | ❌ | ✅ | ✅ | ❌ |
| Prospectus | ✅ | ✅ | ✅ | ✅ | ❌ |
| Reviews | ✅ | ✅ | ✅ | ✅ | ❌ |
| Rights/OFS/NCD | ✅ | ✅ | ✅ | ✅ | ❌ |

---

## Common Patterns

### Server-Side Data Fetching

```tsx
// Use with Next.js Server Components
export default async function Page() {
  const data = await fetchIPOListings();

  return <DataTable data={data} columns={columns} />;
}
```

### Client-Side Filtering

```tsx
'use client';

export default function Page() {
  const [data, setData] = useState([]);

  useEffect(() => {
    async function loadData() {
      const result = await fetch('/api/ipos').then(r => r.json());
      setData(result);
    }
    loadData();
  }, []);

  return <DataTable data={data} columns={columns} />;
}
```

### Custom Render Functions

```tsx
const columns: ColumnDef<IPO>[] = [
  {
    key: 'status',
    header: 'Status',
    render: (value) => {
      const colorMap = {
        OPEN: 'bg-green-100 text-green-800',
        UPCOMING: 'bg-yellow-100 text-yellow-800',
        CLOSED: 'bg-gray-100 text-gray-800',
      };

      return (
        <span className={`px-2 py-1 rounded-full text-xs ${colorMap[value]}`}>
          {value}
        </span>
      );
    },
  },
];
```

---

**Last Updated:** 2025-10-11
**Version:** 1.0.0
