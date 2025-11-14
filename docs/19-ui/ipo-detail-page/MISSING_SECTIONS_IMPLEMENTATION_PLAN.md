# IPO Detail Page - Missing Sections Implementation Plan

**Created**: 2025-01-14
**Status**: Ready for Implementation
**Estimated Time**: 4-5 hours

---

## Executive Summary

Investigation revealed that most required data EXISTS in the database but isn't being displayed due to:
- **50% of issues**: Components exist but receive hardcoded `null` props instead of actual data
- **25% of issues**: Components exist but aren't imported/added to the page
- **25% of issues**: Components don't exist yet and need to be created

All database fields required for these sections are already populated via the repository layer.

---

## Current State Analysis

### ✅ WORKING SECTIONS (Already on Page)

1. **KPI Highlights Section** - ROE, RoNW, P/BV, EPS, P/E ratios
2. **Promoter Holding Section** - Pre/post issue shareholding
3. **Anchor Investors Section** - Anchor investor details
4. **Financial Performance Charts** - Revenue, EBITDA, profitability
5. **Subscription Dashboard** - Category-wise subscription
6. **GMP History Chart** - Grey market premium trends
7. **Peer Comparison** - Competitor analysis
8. **Listing Performance Charts** - For listed IPOs

### ⚠️ BROKEN SECTIONS (On Page but No Data)

9. **IPO Objectives Section** (Line 328)
   - **Issue**: Hardcoded `objectives={null}`
   - **Fix**: Pass `ipo.objectives` from database
   - **Data Source**: `ipos.objectives` JSONB field

10. **Company Contact Section** (Line 422-436)
    - **Issue**: All 10 fields hardcoded to `null`
    - **Fix**: Pass `ipoDetails` contact fields
    - **Data Source**: `ipoDetails` table (11 fields: companyAddress, companyPhone, companyEmail, companyCity, companyState, companyPincode, complianceOfficer, complianceOfficerPhone, complianceOfficerEmail)

### 🔨 MISSING COMPONENTS (Exist but Not on Page)

11. **Category Reservation Section**
    - **Component**: `web/components/ipo-detail/CategoryReservationSection.tsx` EXISTS
    - **Issue**: Not imported or used in page.tsx
    - **Data Source**: `ipoDetails` table (qibSharesOffered, niiSharesOffered, retailSharesOffered, employeeSharesOffered, anchorSharesOffered, retailMaxAllottees)

### ❌ COMPONENTS TO CREATE

12. **Lot Details Section** - Not implemented
13. **Listing Details Section** - Not implemented
14. **Lead Manager Section** - Not implemented
15. **IPO Details Table** - Not implemented
16. **Important Dates Section** - Not implemented

---

## Database Schema Verification

### Data Availability ✅

All required fields exist in database schema (`packages/shared/src/db/schema.ts`):

**ipos table (lines 135-214):**
- ✅ `objectives` (JSONB, line 200) - Array of `IPOObjective[]`
- ✅ `lotSize` (INTEGER, line 149)
- ✅ `priceRangeMin/Max` (INTEGER, lines 147-148)
- ✅ `faceValue` (INTEGER, line 156)
- ✅ `listingDate` (DATE, line 154)
- ✅ `symbol` (VARCHAR, line 141)

**ipoDetails table (lines 806-886):**
- ✅ `leadManagers` (text array, line 829)
- ✅ `basisOfAllotmentDate` (DATE, line 826)
- ✅ `initiationOfRefundsDate` (DATE, line 827)
- ✅ `creditOfSharesDate` (DATE, line 828)
- ✅ Company contact fields (lines 836-844): companyAddress, companyPhone, companyEmail, companyCity, companyState, companyPincode, complianceOfficer, complianceOfficerPhone, complianceOfficerEmail
- ✅ Category reservation fields (lines 847-852): qibSharesOffered, niiSharesOffered, retailSharesOffered, employeeSharesOffered, anchorSharesOffered, retailMaxAllottees

**listingPerformance table (lines 521-546):**
- ✅ `listingPrice` (INTEGER, line 529)
- ✅ `issuePrice` (INTEGER, line 530)
- ✅ `listingGainPercent` (NUMERIC, line 531)

**Repository Verification:**
- IPORepository `findBySlug()` method (lines 230-348) DOES fetch all required relations:
  - `financialData` ✅
  - `ipoFinancials` ✅
  - `ipoDetails` ✅ (contains contact info + category reservation + lead managers)
  - `anchorInvestor` ✅
  - `subscriptions`, `gmpRecords`, `documents`, `listingPerformance`, `peerCompanies` ✅

---

## Implementation Plan

### **PHASE 1: Quick Fixes (30 minutes)** 🚀

#### Task 1.1: Fix IPO Objectives Section
**File**: `web/app/ipos/[slug]/page.tsx` (line 328)

**Current Code:**
```tsx
{ipo.objectives && (
  <IPOObjectivesSection objectives={null} />
)}
```

**Fix:**
```tsx
{ipo.objectives && (
  <IPOObjectivesSection objectives={ipo.objectives} />
)}
```

**Test**: Verify objectives table displays with 3-4 rows showing sno, description, and amount.

---

#### Task 1.2: Fix Company Contact Section
**File**: `web/app/ipos/[slug]/page.tsx` (lines 422-436)

**Current Code:**
```tsx
<CompanyContactSection
  companyName={null}
  companyAddress={null}
  companyPhone={null}
  companyEmail={null}
  companyCity={null}
  companyState={null}
  companyPincode={null}
  complianceOfficer={null}
  complianceOfficerPhone={null}
  complianceOfficerEmail={null}
/>
```

**Fix:**
```tsx
<CompanyContactSection
  companyName={ipo.companyName}
  companyAddress={data.ipoDetails?.companyAddress ?? null}
  companyPhone={data.ipoDetails?.companyPhone ?? null}
  companyEmail={data.ipoDetails?.companyEmail ?? null}
  companyCity={data.ipoDetails?.companyCity ?? null}
  companyState={data.ipoDetails?.companyState ?? null}
  companyPincode={data.ipoDetails?.companyPincode ?? null}
  complianceOfficer={data.ipoDetails?.complianceOfficer ?? null}
  complianceOfficerPhone={data.ipoDetails?.complianceOfficerPhone ?? null}
  complianceOfficerEmail={data.ipoDetails?.complianceOfficerEmail ?? null}
/>
```

**Test**: Verify contact card shows company address, phone, email and compliance officer details.

---

#### Task 1.3: Add Category Reservation Section
**File**: `web/app/ipos/[slug]/page.tsx`

**Steps:**
1. Import existing component at top of file:
```tsx
import { CategoryReservationSection } from '@/components/ipo-detail/CategoryReservationSection';
```

2. Add section after Promoter Holding (around line 340):
```tsx
{/* Category Reservations */}
{data.ipoDetails && (
  <CategoryReservationSection
    qibSharesOffered={data.ipoDetails.qibSharesOffered}
    niiSharesOffered={data.ipoDetails.niiSharesOffered}
    retailSharesOffered={data.ipoDetails.retailSharesOffered}
    employeeSharesOffered={data.ipoDetails.employeeSharesOffered}
    anchorSharesOffered={data.ipoDetails.anchorSharesOffered}
    retailMaxAllottees={data.ipoDetails.retailMaxAllottees}
    totalSharesOffered={ipo.issueSize} // From ipos table
  />
)}
```

**Test**: Verify category reservation table shows 6 categories with share counts and percentages.

---

### **PHASE 2: Create Missing Components (2-3 hours)** 🔨

#### Task 2.1: Create Lot Details Section

**New File**: `web/components/ipo-detail/LotDetailsSection.tsx`

**Component Structure:**
```tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency, formatNumber } from '@/lib/utils/format';

interface LotDetailsSectionProps {
  lotSize: number | null;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  faceValue: number | null;
  minBidQuantity?: number | null;
}

export function LotDetailsSection({
  lotSize,
  priceRangeMin,
  priceRangeMax,
  faceValue,
  minBidQuantity
}: LotDetailsSectionProps) {
  if (!lotSize || !priceRangeMin || !priceRangeMax) return null;

  const minInvestment = lotSize * priceRangeMin;
  const maxInvestment = lotSize * priceRangeMax;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lot Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Lot Size</p>
            <p className="text-lg font-semibold">{formatNumber(lotSize)} shares</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Price Range</p>
            <p className="text-lg font-semibold">
              ₹{formatNumber(priceRangeMin)} - ₹{formatNumber(priceRangeMax)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Min Investment</p>
            <p className="text-lg font-semibold">{formatCurrency(minInvestment)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Max Investment</p>
            <p className="text-lg font-semibold">{formatCurrency(maxInvestment)}</p>
          </div>
          {faceValue && (
            <div>
              <p className="text-sm text-muted-foreground">Face Value</p>
              <p className="text-lg font-semibold">₹{formatNumber(faceValue)}</p>
            </div>
          )}
          {minBidQuantity && (
            <div>
              <p className="text-sm text-muted-foreground">Min Bid Quantity</p>
              <p className="text-lg font-semibold">{formatNumber(minBidQuantity)} shares</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

**Add to Page** (`web/app/ipos/[slug]/page.tsx`):
```tsx
import { LotDetailsSection } from '@/components/ipo-detail/LotDetailsSection';

// Add after KPI section (around line 360)
<LotDetailsSection
  lotSize={ipo.lotSize}
  priceRangeMin={ipo.priceRangeMin}
  priceRangeMax={ipo.priceRangeMax}
  faceValue={ipo.faceValue}
  minBidQuantity={ipo.minBidQuantity}
/>
```

**Test**: Verify displays lot size, price range, investment amounts, face value.

---

#### Task 2.2: Create Listing Details Section

**New File**: `web/components/ipo-detail/ListingDetailsSection.tsx`

**Component Structure:**
```tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatCurrency, formatPercent } from '@/lib/utils/format';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface ListingDetailsSectionProps {
  listingDate: string | null;
  symbol: string | null;
  issuePrice: number | null;
  listingPrice: number | null;
  listingGainPercent: number | null;
  listingGainAmount?: number | null;
}

export function ListingDetailsSection({
  listingDate,
  symbol,
  issuePrice,
  listingPrice,
  listingGainPercent,
  listingGainAmount
}: ListingDetailsSectionProps) {
  if (!listingDate && !listingPrice) return null;

  const isPositiveGain = listingGainPercent && listingGainPercent > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Listing Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {listingDate && (
            <div>
              <p className="text-sm text-muted-foreground">Listing Date</p>
              <p className="text-lg font-semibold">{formatDate(listingDate)}</p>
            </div>
          )}
          {symbol && (
            <div>
              <p className="text-sm text-muted-foreground">Symbol</p>
              <p className="text-lg font-semibold">{symbol}</p>
            </div>
          )}
          {issuePrice && (
            <div>
              <p className="text-sm text-muted-foreground">Issue Price</p>
              <p className="text-lg font-semibold">{formatCurrency(issuePrice)}</p>
            </div>
          )}
          {listingPrice && (
            <div>
              <p className="text-sm text-muted-foreground">Listing Price</p>
              <p className="text-lg font-semibold">{formatCurrency(listingPrice)}</p>
            </div>
          )}
          {listingGainPercent !== null && (
            <div>
              <p className="text-sm text-muted-foreground">Listing Gain</p>
              <div className="flex items-center gap-1">
                <p className={`text-lg font-semibold ${isPositiveGain ? 'text-green-600' : 'text-red-600'}`}>
                  {formatPercent(listingGainPercent)}
                </p>
                {isPositiveGain ? (
                  <TrendingUp className="h-5 w-5 text-green-600" />
                ) : (
                  <TrendingDown className="h-5 w-5 text-red-600" />
                )}
              </div>
            </div>
          )}
          {listingGainAmount && (
            <div>
              <p className="text-sm text-muted-foreground">Gain Amount</p>
              <p className={`text-lg font-semibold ${listingGainAmount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(Math.abs(listingGainAmount))}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
```

**Add to Page** (`web/app/ipos/[slug]/page.tsx`):
```tsx
import { ListingDetailsSection } from '@/components/ipo-detail/ListingDetailsSection';

// Add after listing performance charts (around line 390)
{ipo.status === 'LISTED' && data.listingPerformance && (
  <ListingDetailsSection
    listingDate={ipo.listingDate}
    symbol={ipo.symbol}
    issuePrice={data.listingPerformance.issuePrice}
    listingPrice={data.listingPerformance.listingPrice}
    listingGainPercent={data.listingPerformance.listingGainPercent}
    listingGainAmount={data.listingPerformance.listingGainAmount}
  />
)}
```

**Test**: Verify shows listing date, symbol, prices, and gain (only for LISTED IPOs).

---

#### Task 2.3: Create Lead Manager Section

**New File**: `web/components/ipo-detail/LeadManagerSection.tsx`

**Component Structure:**
```tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2 } from 'lucide-react';

interface LeadManagerSectionProps {
  leadManagers: string[] | null;
}

export function LeadManagerSection({ leadManagers }: LeadManagerSectionProps) {
  if (!leadManagers || leadManagers.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Lead Managers
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {leadManagers.map((manager, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-3 border rounded-lg hover:bg-accent/50 transition-colors"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
                {index + 1}
              </div>
              <div className="flex-1">
                <p className="font-medium">{manager}</p>
              </div>
            </div>
          ))}
        </div>
        {leadManagers.length === 0 && (
          <p className="text-sm text-muted-foreground">No lead managers information available</p>
        )}
      </CardContent>
    </Card>
  );
}
```

**Add to Page** (`web/app/ipos/[slug]/page.tsx`):
```tsx
import { LeadManagerSection } from '@/components/ipo-detail/LeadManagerSection';

// Add after IPO Details Table or before Promoter Holding (around line 345)
{data.ipoDetails?.leadManagers && (
  <LeadManagerSection leadManagers={data.ipoDetails.leadManagers} />
)}
```

**Test**: Verify displays numbered list of lead managers from `ipoDetails.leadManagers` array.

---

#### Task 2.4: Create IPO Details Table Section

**New File**: `web/components/ipo-detail/IPODetailsTable.tsx`

**Component Structure:**
```tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate, formatCurrency, formatNumber } from '@/lib/utils/format';

interface IPODetailsTableProps {
  issueSize: number | null;
  issueType: string | null;
  openDate: string | null;
  closeDate: string | null;
  allotmentDate: string | null;
  listingDate: string | null;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  lotSize: number | null;
  minBidQuantity: number | null;
  faceValue: number | null;
  freshIssueSize: number | null;
  offerForSaleSize: number | null;
}

export function IPODetailsTable({
  issueSize,
  issueType,
  openDate,
  closeDate,
  allotmentDate,
  listingDate,
  priceRangeMin,
  priceRangeMax,
  lotSize,
  minBidQuantity,
  faceValue,
  freshIssueSize,
  offerForSaleSize
}: IPODetailsTableProps) {
  const details = [
    { label: 'Issue Size', value: issueSize ? formatCurrency(issueSize) : '-' },
    { label: 'Issue Type', value: issueType || '-' },
    { label: 'Fresh Issue', value: freshIssueSize ? formatCurrency(freshIssueSize) : '-' },
    { label: 'Offer for Sale', value: offerForSaleSize ? formatCurrency(offerForSaleSize) : '-' },
    { label: 'Price Band', value: priceRangeMin && priceRangeMax ? `₹${formatNumber(priceRangeMin)} - ₹${formatNumber(priceRangeMax)}` : '-' },
    { label: 'Face Value', value: faceValue ? `₹${formatNumber(faceValue)}` : '-' },
    { label: 'Lot Size', value: lotSize ? `${formatNumber(lotSize)} shares` : '-' },
    { label: 'Min Bid Quantity', value: minBidQuantity ? `${formatNumber(minBidQuantity)} shares` : '-' },
    { label: 'Open Date', value: openDate ? formatDate(openDate) : '-' },
    { label: 'Close Date', value: closeDate ? formatDate(closeDate) : '-' },
    { label: 'Allotment Date', value: allotmentDate ? formatDate(allotmentDate) : '-' },
    { label: 'Listing Date', value: listingDate ? formatDate(listingDate) : '-' },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>IPO Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          {details.map((detail, index) => (
            <div key={index} className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">{detail.label}</span>
              <span className="font-medium text-right">{detail.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

**Add to Page** (`web/app/ipos/[slug]/page.tsx`):
```tsx
import { IPODetailsTable } from '@/components/ipo-detail/IPODetailsTable';

// Add early in the page (around line 280, after Key Metrics)
<IPODetailsTable
  issueSize={ipo.issueSize}
  issueType={ipo.issueType}
  openDate={ipo.openDate}
  closeDate={ipo.closeDate}
  allotmentDate={ipo.allotmentDate}
  listingDate={ipo.listingDate}
  priceRangeMin={ipo.priceRangeMin}
  priceRangeMax={ipo.priceRangeMax}
  lotSize={ipo.lotSize}
  minBidQuantity={ipo.minBidQuantity}
  faceValue={ipo.faceValue}
  freshIssueSize={ipo.freshIssueSize}
  offerForSaleSize={ipo.offerForSaleSize}
/>
```

**Test**: Verify comprehensive table with 12 rows of IPO details.

---

### **PHASE 3: Data Enhancement (1 hour)** ✨

#### Task 3.1: Create Important Dates Section

**New File**: `web/components/ipo-detail/ImportantDatesSection.tsx`

**Component Structure:**
```tsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Calendar } from 'lucide-react';
import { formatDate } from '@/lib/utils/format';

interface ImportantDatesSectionProps {
  openDate: string | null;
  closeDate: string | null;
  allotmentDate: string | null;
  basisOfAllotmentDate: string | null;
  initiationOfRefundsDate: string | null;
  creditOfSharesDate: string | null;
  listingDate: string | null;
}

export function ImportantDatesSection({
  openDate,
  closeDate,
  allotmentDate,
  basisOfAllotmentDate,
  initiationOfRefundsDate,
  creditOfSharesDate,
  listingDate
}: ImportantDatesSectionProps) {
  const dates = [
    { label: 'Open Date', date: openDate, icon: '📅' },
    { label: 'Close Date', date: closeDate, icon: '📅' },
    { label: 'Basis of Allotment', date: basisOfAllotmentDate, icon: '📊' },
    { label: 'Initiation of Refunds', date: initiationOfRefundsDate, icon: '💰' },
    { label: 'Credit of Shares', date: creditOfSharesDate, icon: '📈' },
    { label: 'Allotment Date', date: allotmentDate, icon: '✅' },
    { label: 'Listing Date', date: listingDate, icon: '🎯' }
  ].filter(item => item.date); // Only show dates that exist

  if (dates.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" />
          Important Dates
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {dates.map((item, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </div>
              <span className="text-muted-foreground">{formatDate(item.date!)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

**Add to Page** (`web/app/ipos/[slug]/page.tsx`):
```tsx
import { ImportantDatesSection } from '@/components/ipo-detail/ImportantDatesSection';

// Add after IPO Timeline Widget or before tabs (around line 270)
<ImportantDatesSection
  openDate={ipo.openDate}
  closeDate={ipo.closeDate}
  allotmentDate={ipo.allotmentDate}
  basisOfAllotmentDate={data.ipoDetails?.basisOfAllotmentDate ?? null}
  initiationOfRefundsDate={data.ipoDetails?.initiationOfRefundsDate ?? null}
  creditOfSharesDate={data.ipoDetails?.creditOfSharesDate ?? null}
  listingDate={ipo.listingDate}
/>
```

**Test**: Verify displays timeline of important dates with icons.

---

#### Task 3.2: Enhance Company Financials with Table View

**Modify Existing**: `web/components/ipo-detail/FinancialPerformanceCharts.tsx`

**Add TabView** with two tabs:
1. **Charts** (existing visualization)
2. **Table** (new tabular view)

**Table Structure:**
- Columns: Metric | FY2022 | FY2023 | FY2024 | Growth %
- Rows: Revenue, EBITDA, Net Profit, EPS, ROE, RoNW, Debt/Equity

**Implementation**: Add to existing FinancialPerformanceCharts component:
```tsx
// Inside FinancialPerformanceCharts.tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Add tabs wrapper around existing charts
<Tabs defaultValue="charts">
  <TabsList>
    <TabsTrigger value="charts">Charts</TabsTrigger>
    <TabsTrigger value="table">Table View</TabsTrigger>
  </TabsList>

  <TabsContent value="charts">
    {/* Existing chart components */}
  </TabsContent>

  <TabsContent value="table">
    <FinancialDataTable financials={financials} />
  </TabsContent>
</Tabs>
```

**Test**: Verify can switch between chart and table views of financial data.

---

### **PHASE 4: Layout Organization (30 minutes)** 📐

#### Task 4.1: Reorganize Page Section Order

**Target Order** (matching user screenshots):

1. IPO Header & Status
2. IPO Timeline Widget
3. Key Metrics Cards
4. **IPO Details Table** (comprehensive overview)
5. **Lot Details** (bidding info)
6. Important Dates
7. IPO Objectives (uses of funds)
8. **Category Reservations** (investor category allocations)
9. **Lead Managers** (book-running lead managers)
10. Promoter Holding
11. Anchor Investors
12. KPI Highlights (financial ratios)
13. Company Financials (charts + table)
14. Subscription Dashboard
15. GMP History
16. Peer Comparison
17. **Listing Details** (for listed IPOs only)
18. Listing Performance Charts (for listed IPOs only)
19. Company Contact Details
20. Affiliate Section
21. Lot Calculator
22. Allotment Checker

**Implementation:**
- Rearrange JSX in `web/app/ipos/[slug]/page.tsx`
- Ensure conditional rendering logic is preserved
- Add proper spacing between sections

---

### **PHASE 5: Polish & Testing (30 minutes)** ✅

#### Task 5.1: Add Loading States

For each new component, add skeleton loading:
```tsx
import { Skeleton } from '@/components/ui/skeleton';

if (isLoading) {
  return <Skeleton className="h-48 w-full" />;
}
```

#### Task 5.2: Add Empty States

For components with no data:
```tsx
if (!data) {
  return (
    <Card>
      <CardContent className="p-8 text-center">
        <p className="text-muted-foreground">No data available</p>
      </CardContent>
    </Card>
  );
}
```

#### Task 5.3: Responsive Design Check

- Test all new components on mobile (< 640px)
- Ensure grid layouts collapse properly
- Verify touch targets are ≥ 44px

#### Task 5.4: TypeScript Validation

Run type check:
```bash
cd web && npm run type-check
```

Fix any type errors in new components.

#### Task 5.5: Component Testing

**Manual Test Checklist:**
- [ ] IPO Objectives displays correctly with data
- [ ] Company Contact shows all 10 fields
- [ ] Category Reservations shows percentage breakdown
- [ ] Lot Details calculates investment amounts correctly
- [ ] Listing Details only shows for LISTED IPOs
- [ ] Lead Managers displays numbered list
- [ ] IPO Details Table shows all 12 fields
- [ ] Important Dates filters null dates
- [ ] Financial table view matches chart data
- [ ] All sections are mobile-responsive

---

## Data Flow Verification

### Current Data Fetching (Already Working) ✅

**File**: `web/app/ipos/[slug]/page.tsx` (lines 97-166)

```typescript
const data = await ipoRepository.findBySlug(params.slug);

// Returns object with:
{
  ...ipo,                    // All ipos table fields
  financialData: {...},      // financialData table
  ipoFinancials: {...},      // ipoFinancials table (multi-period)
  ipoDetails: {...},         // ipoDetails table (NEW: contact, category reservations, lead managers)
  anchorInvestor: [...],     // anchorInvestor table
  subscriptions: [...],      // subscriptions table
  gmpRecords: [...],         // gmpRecords table
  documents: [...],          // documents table
  listingPerformance: {...}, // listingPerformance table
  peerCompanies: [...]       // peerCompanies table
}
```

All required data IS being fetched. No repository changes needed.

---

## Testing Strategy

### Unit Tests (Optional - Future)

Create tests for new components:
- `LotDetailsSection.test.tsx`
- `ListingDetailsSection.test.tsx`
- `LeadManagerSection.test.tsx`
- `IPODetailsTable.test.tsx`
- `ImportantDatesSection.test.tsx`

### Integration Testing

**Manual Testing Protocol:**

1. **Test with UPCOMING IPO:**
   - Verify lot details, objectives, category reservations display
   - Confirm listing details and listing charts are hidden
   - Check important dates show open/close/allotment dates

2. **Test with OPEN IPO:**
   - Verify subscription dashboard updates
   - Check GMP history displays
   - Ensure all sections render

3. **Test with LISTED IPO:**
   - Verify listing details section appears
   - Check listing performance charts display
   - Confirm listing gain % is color-coded correctly

4. **Test with IPO missing optional data:**
   - Verify graceful handling of null values
   - Ensure sections hide when no data available
   - Check no console errors

### Browser Testing

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

---

## Performance Considerations

### Bundle Size Impact

**Estimated Component Sizes:**
- LotDetailsSection: ~2KB
- ListingDetailsSection: ~3KB
- LeadManagerSection: ~2KB
- IPODetailsTable: ~3KB
- ImportantDatesSection: ~3KB

**Total Added**: ~13KB (minified + gzipped)

**Optimization:**
- All components use shared UI primitives (Card, CardHeader, etc.)
- No new external dependencies
- Reuse existing utility functions (formatCurrency, formatDate, formatPercent)

### Runtime Performance

**Expected Impact**: Minimal (< 5ms render time per component)

All components are:
- Pure functional components
- No complex state management
- No expensive computations
- Data is pre-fetched server-side

---

## Rollback Plan

If issues arise during implementation:

### Phase 1 Rollback (Quick Fixes)
```bash
git checkout web/app/ipos/[slug]/page.tsx
```

### Phase 2 Rollback (New Components)
```bash
git rm web/components/ipo-detail/LotDetailsSection.tsx
git rm web/components/ipo-detail/ListingDetailsSection.tsx
git rm web/components/ipo-detail/LeadManagerSection.tsx
git rm web/components/ipo-detail/IPODetailsTable.tsx
git checkout web/app/ipos/[slug]/page.tsx
```

### Full Rollback
```bash
git reset --hard HEAD~1
```

---

## Success Criteria

✅ **Implementation Complete When:**

1. All 15 sections display with correct data
2. No TypeScript errors
3. No console errors or warnings
4. All sections mobile-responsive
5. Graceful handling of null/missing data
6. Page load time < 2s (LCP target)
7. No layout shift (CLS < 0.1)
8. Manual testing passed for all IPO statuses

---

## Post-Implementation Tasks

1. **Update Documentation**
   - Update `docs/19-ui/ipo-detail-page/README.md`
   - Document new components in component library
   - Update screen-to-database field mapping if changed

2. **User Feedback**
   - Monitor user engagement with new sections
   - Track which sections are most viewed
   - Collect feedback on data accuracy

3. **Data Quality Check**
   - Verify scrapers are populating all new fields
   - Check for null values in production database
   - Run data backfill scripts if needed

4. **Performance Monitoring**
   - Monitor page load times
   - Check bundle size impact
   - Ensure cache hit rates remain > 80%

---

## Related Documentation

- Database Schema: `packages/shared/src/db/schema.ts`
- Screen Mapping: `docs/16-database/screen-table-database-field-mapping.md`
- Repository Pattern: `docs/02-architecture/backend-architecture.md`
- UI Components: `web/components/ipo-detail/`
- IPO Detail Page: `web/app/ipos/[slug]/page.tsx`

---

## Timeline & Effort Estimate

| Phase | Tasks | Estimated Time | Priority |
|-------|-------|---------------|----------|
| Phase 1: Quick Fixes | 3 tasks | 30 minutes | HIGH |
| Phase 2: Create Components | 4 tasks | 2-3 hours | HIGH |
| Phase 3: Data Enhancement | 2 tasks | 1 hour | MEDIUM |
| Phase 4: Layout Organization | 1 task | 30 minutes | MEDIUM |
| Phase 5: Polish & Testing | 5 tasks | 30 minutes | HIGH |
| **TOTAL** | **15 tasks** | **4.5-5.5 hours** | - |

**Recommended Approach**:
- Day 1: Complete Phase 1 + Phase 2 (3.5 hours)
- Day 2: Complete Phase 3 + Phase 4 + Phase 5 (2 hours)

---

**Next Steps**:
1. Review and approve this plan
2. Create feature branch: `feature/ipo-detail-missing-sections`
3. Execute Phase 1 (Quick Wins)
4. Test and verify Phase 1 before proceeding
5. Execute remaining phases sequentially
6. Final testing and documentation update
7. Create PR for review

---

**Document Version**: 1.0
**Last Updated**: 2025-01-14
**Author**: Claude Code Analysis
**Status**: Ready for Implementation
