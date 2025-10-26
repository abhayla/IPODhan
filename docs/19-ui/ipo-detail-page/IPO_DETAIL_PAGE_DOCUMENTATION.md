# IPO Detail Page - Complete UI Documentation

**Route**: `/ipos/[slug]`
**File**: `web/app/ipos/[slug]/page.tsx`
**Type**: Server-Side Rendered (SSR) with Client-Side Tabs
**Last Updated**: 2025-10-26

---

## Page Overview

The IPO Detail Page is the most comprehensive screen in the IPODhan platform, displaying all available information about a specific IPO. It uses a hybrid rendering strategy with SSR for above-the-fold content and client-side loading for tabbed data.

**Key Features**:
- Server-side rendering for core IPO information (fast initial load)
- Progressive loading for tabs (below-the-fold content)
- Dynamic SEO with Open Graph and JSON-LD structured data
- Breadcrumb navigation
- Error boundary protection
- Mobile-responsive design

**Example URL**: `http://localhost:3000/ipos/cool-caps-industries-limited`

---

## Page Structure

### 1. Header Section (IPOHeader Component)

**Location**: Top of page, below breadcrumbs
**Component**: `@/components/ipo/IPOHeader`
**Rendering**: Server-Side (SSR)

**Elements**:
- **Company Logo/Icon**: Default icon if no logo available
- **Company Name**: H1 heading (e.g., "Cool Caps Industries Limited")
- **Status Badge**: Live status indicator
  - "Open Now" (green) - IPO currently accepting applications
  - "Upcoming" (blue) - IPO not yet open
  - "Closed" (gray) - Bidding period ended
  - "Listed" (purple) - IPO listed on exchanges
- **Stock Symbol**: Exchange symbol (e.g., "COOLCAPSR (NSE)")
- **Category Badges**:
  - Segment: MAINBOARD or SME
  - Type: IPO
- **IPODhan Rating**: Platform's proprietary rating (if available)
- **Add to Compare Button**: Adds IPO to comparison list

**Data Source**:
- `ipo` object from API (`/api/ipos/[slug]`)
- Fields: `companyName`, `symbol`, `status`, `segment`, `category`

**Empty State**:
- Logo: Default document icon
- Rating: "Not Rated" (gray text)

---

### 2. Key Metrics Cards (KeyMetricsCards Component)

**Location**: Below header, above-the-fold
**Component**: `@/components/ipo/KeyMetricsCards`
**Rendering**: Server-Side (SSR)
**Layout**: 3-column grid (responsive: stacks on mobile)

#### Card 1: Issue Size
- **Icon**: Currency/money icon
- **Value**: Total issue size in Crores (e.g., "₹500 Crores")
- **Label**: "Total Issue Size"
- **Empty State**: "₹0 Crores" or "Not available"
- **Data Source**: `ipo.issueSize`

#### Card 2: Subscription
- **Icon**: Chart/graph icon
- **Value**: Subscription multiplier (e.g., "12.5x" or "N/A")
- **Label**: "Not available" if no data
- **Trend Indicator**: Up/Down arrow based on subscription trend
- **Empty State**: "N/A - Not available"
- **Data Source**: `subscriptions[0].totalSubscription` (latest)

#### Card 3: Grey Market Premium (GMP)
- **Icon**: Trending icon
- **Value**: GMP amount + percentage (e.g., "₹50 (10%)")
- **Label**: "Not available" if no data
- **Empty State**: "N/A - Not available"
- **Data Source**: `gmpRecords[0].gmp` (latest)

**Calculation Logic**:
```typescript
const subscriptionValue = latestSubscription?.totalSubscription ?? null;
const gmpValue = latestGMP?.gmp ?? null;
const gmpPercent = latestGMP && ipo.priceRangeMax
  ? (latestGMP.gmp / ipo.priceRangeMax) * 100
  : null;
```

---

### 3. Issue Structure Section (IssueStructureSection Component)

**Location**: Below key metrics
**Component**: `@/components/ipo/IssueStructureSection`
**Rendering**: Server-Side (SSR)

**Purpose**: Displays allocation breakdown by investor category

**Elements**:
- **Section Title**: "Issue Structure"
- **Data Table**: Category-wise allocation (if available)
  - Retail Investors: Allocation percentage
  - HNI (Non-Institutional): Allocation percentage
  - QIB (Qualified Institutional): Allocation percentage
  - Employee Reservation: Allocation percentage (if applicable)
- **Empty State**: "Issue structure data not available"

**Data Source**: `ipoDetails` object (if exists)

---

### 4. IPO Details Section (InfoSection Component)

**Location**: Below issue structure
**Component**: `@/components/ipo/InfoSection`
**Rendering**: Server-Side (SSR)
**Layout**: 2-column grid

#### Left Column (Timeline Information)
1. **Open Date**:
   - Format: "20 Oct 2025"
   - Relative time: "6 days ago"
   - Empty: "TBA"

2. **Close Date**:
   - Format: Same as open date
   - Empty: "TBA"

3. **Allotment Date**:
   - Format: Same as above
   - Empty: "TBA"

4. **Listing Date**:
   - Format: Same as above
   - Empty: "TBA"

5. **Price Range**:
   - Format: "₹100 - ₹120"
   - Empty: "N/A - N/A"

6. **Face Value**:
   - Format: "₹10.00"
   - Default: ₹10 if not specified

#### Right Column (Issue Information)
1. **Lot Size**:
   - Format: "150 shares"
   - Empty: "1 shares" (default/placeholder)

2. **Issue Size**:
   - Format: "₹500 Crores"
   - Empty: "₹null Crores" (indicates missing data)

3. **ISIN**:
   - Format: "INE123A01012"
   - Empty: "Not assigned"

4. **Listing Exchanges**:
   - Format: "NSE, BSE" or "NSE"
   - Empty: "N/A"

5. **Registrar**:
   - Format: Company name
   - Empty: "N/A"

6. **Lead Managers**:
   - Format: Comma-separated list
   - Empty: "N/A"

**Data Source**:
- `ipo` object fields: `openDate`, `closeDate`, `allotmentDate`, `listingDate`, `priceRangeMin`, `priceRangeMax`, `faceValue`, `lotSize`, `issueSize`, `isin`, `listingExchange`, `registrar`, `leadManagers`

---

### 5. IPO Score Section (IPOScoreSection Component)

**Location**: Below IPO details
**Component**: `@/components/ipo/IPOScoreSection`
**Rendering**: Server-Side (SSR)
**Status**: ⚠️ **IMPLEMENTATION ISSUE** - Shows dummy data instead of real-time scoring

**Current State** (as seen in screenshot):
- **Score**: 93/100 (hardcoded dummy data)
- **Verdict**: "Apply" (should be dynamically calculated)
- **Confidence**: "HIGH" (hardcoded)

**What it SHOULD display** (based on real-time scoring system):
- **Score**: 0-10 scale from `ipoScore` API endpoint
- **Verdict**:
  - 9.0-10.0: "Exceptional (Invest)" ⭐⭐⭐⭐⭐
  - 7.5-8.9: "Strong (Consider)" ⭐⭐⭐⭐
  - 6.0-7.4: "Good (Moderate)" ⭐⭐⭐
  - 4.5-5.9: "Average (Neutral)" ⭐⭐
  - 3.0-4.4: "Below Average (Caution)" ⭐
  - 0.0-2.9: "Poor (Avoid)"
- **Confidence**: 0-100% based on data completeness

**Score Breakdown** (Current - Dummy):
- Fundamental Score: 23/25
- Sentiment Score: 19/25
- Subscription Score: 20/25
- Sector Score: 23/25

**Score Breakdown** (Should be - Real):
- Financial Strength: 0-3 points
- Valuation: 0-2 points
- Subscription Demand: 0-2 points
- Market Performance: 0-2 points
- Company Fundamentals: 0-1 point

**Analysis**:
- Current: "Strong fundamentals with healthy revenue growth..." (dummy text)
- Should be: AI-generated analysis based on actual score components

**Timestamp**:
- Shows calculation date and algorithm version
- Format: "Calculated: Oct 20, 2025 19:10 • Algorithm v1.0.0"

**Data Source**:
- Should use: `ipoScore` from `/api/ipos/[slug]/score`
- Currently using: Hardcoded dummy data in component

**Issue Reference**: See `docs/10-issues/PROJECT_FEATURES_AND_ISSUES_INVENTORY.md` - Issue #25 (Feature-UI Gap)

---

### 6. Peer Comparison Section (PeerComparisonSection Component)

**Location**: Below IPO score
**Component**: `@/components/ipo/PeerComparisonSection`
**Rendering**: Server-Side (SSR)
**Conditional**: Only renders if `peerCompanies` array has data

**Elements**:
- **Section Title**: "Peer Comparison"
- **Description**: "Compare [Company Name] with industry peers based on financial metrics"
- **Data Table**: Peer company financial comparison

**Table Columns**:
1. **Company**: Peer company name (highlighted row for current company)
2. **PE Ratio**: Price-to-Earnings ratio
3. **EPS (₹)**: Earnings Per Share
4. **RONW (%)**: Return on Net Worth percentage
5. **NAV (₹)**: Net Asset Value
6. **PBV Ratio**: Price-to-Book Value ratio
7. **Listed**: Yes/No indicator

**Example Data** (from screenshot):
| Company | PE Ratio | EPS (₹) | RONW (%) | NAV (₹) | PBV Ratio | Listed |
|---------|----------|---------|----------|---------|-----------|--------|
| Infosys | 40.23 | ₹79.93 | 24.69% | ₹142.05 | 1.15 | Yes |
| Reliance Industries | 46.81 | ₹37.84 | 17.37% | ₹290.14 | 2.8 | Yes |
| TCS | 24.79 | ₹81.57 | 6.59% | ₹156.9 | 1.38 | Yes |

**Tooltips/Legend**:
- PE Ratio: Price-to-Earnings Ratio
- EPS: Earnings Per Share
- RONW: Return on Net Worth
- NAV: Net Asset Value
- PBV: Price-to-Book Value Ratio

**Data Source**:
- `peerCompanies` array from API
- Each peer has: `companyName`, `peRatio`, `eps`, `ronw`, `nav`, `pbvRatio`, `isListed`

**Empty State**: Section doesn't render if no peer data

---

### 7. Listing Performance Section (ListingPerformance Component)

**Location**: Below peer comparison
**Component**: `@/components/ipo/ListingPerformance`
**Rendering**: Server-Side (SSR)
**Conditional**: Only for LISTED status IPOs with listing data

**Elements**:
- **Listing Price**: Opening price on listing day
- **Listing High**: Highest price on listing day
- **Listing Close**: Closing price on listing day
- **Listing Gain %**: Percentage gain from issue price
- **Listing Date**: Date of listing with relative time

**Sub-component**: SectorAverageComparison
- Compares IPO's listing gain with sector average
- Shows if IPO performed better/worse than sector
- Only displays for LISTED IPOs

**Data Source**:
- `listingPerformance` object: `issuePrice`, `listingPrice`, `listingGainPercent`
- `ipo.listingDate`
- `sectorAverageGain` calculated from sector data

**Conditional Logic**:
```typescript
{ipo.status === 'LISTED' &&
  ipo.listingDate &&
  listingPerformance &&
  listingPerformance.issuePrice &&
  listingPerformance.listingPrice && (
    // Render listing performance
  )}
```

**Empty State**: Doesn't render for non-listed IPOs

---

### 8. Apply for this IPO Section (AffiliateSection Component)

**Location**: Below IPO score/peer comparison
**Component**: `@/components/affiliate/AffiliateSection`
**Rendering**: Server-Side (SSR)
**Conditional**: Only for OPEN or UPCOMING status IPOs

**Elements**:
- **Section Title**: "Apply for this IPO"
- **Description**: "Open a demat account or apply through your existing broker"
- **Broker Buttons**: 2 prominent call-to-action buttons
  - **Zerodha**: Blue button with Zerodha logo
  - **Angel One**: Blue button with Angel One logo
- **Disclosure**: "We may earn a commission on sign-ups through affiliate links."

**Button Format**:
- Logo on left
- Text: "Apply via [Broker Name]"
- External link icon on right
- Full-width on mobile, side-by-side on desktop

**Tracking**:
- Click events tracked via `/api/affiliate/track`
- Passes `ipoId` and `companyName` for analytics

**Data Source**:
- Broker links from `brokerAffiliates` table
- Currently using hardcoded links in component

**Conditional Logic**:
```typescript
{(ipo.status === 'OPEN' || ipo.status === 'UPCOMING') && (
  <AffiliateSection ipoId={ipo.id} companyName={ipo.companyName} />
)}
```

**Empty State**: Doesn't render for CLOSED or LISTED IPOs

---

### 9. Lot Size Calculator (LotCalculator Component)

**Location**: Below affiliate section (if applicable)
**Component**: `@/components/tools/LotCalculator`
**Mode**: Embedded (inline mode, not standalone tool page)
**Conditional**: Only if `priceRangeMax` and `lotSize` are available

**Elements**:
- **Section Title**: "Calculate Your Investment"
- **Description**: "Find out how many lots you can buy with your investment amount"
- **Input Field**: Investment amount in ₹
- **Calculation Display**:
  - Number of lots you can buy
  - Total investment amount
  - Amount per lot
- **Example Calculations**: Pre-filled buttons for common amounts

**Calculation Logic**:
```typescript
const amountPerLot = priceRangeMax * lotSize;
const numberOfLots = Math.floor(investmentAmount / amountPerLot);
const totalInvestment = numberOfLots * amountPerLot;
```

**Data Source**:
- `ipo.priceRangeMax`: Upper price band
- `ipo.lotSize`: Minimum shares per application

**Conditional Logic**:
```typescript
{ipo.priceRangeMax && ipo.lotSize && (
  <LotCalculator
    mode="embedded"
    ipoData={{ id, companyName, slug, priceRangeMax, lotSize }}
  />
)}
```

**Empty State**: Doesn't render if price range or lot size missing

---

### 10. Allotment Status Checker (AllotmentCheckerCard Component)

**Location**: Below lot calculator
**Component**: `@/components/ipo/AllotmentCheckerCard`
**Conditional**: Only for CLOSED or LISTED status IPOs

**Elements**:
- **Section Title**: "Check Allotment Status"
- **Registrar Name**: Name of the registrar handling allotment
- **Check Status Button**: Links to registrar's allotment status page
- **Instructions**: How to check allotment

**Button States**:
- If `registrarUrl` exists: Direct link to registrar site
- If no URL: Displays registrar name only with manual instructions

**Data Source**:
- `ipo.registrarRelation.shortName`: Registrar name
- `ipo.registrarRelation.allotmentCheckUrl`: Link to status page
- Fallback: `ipo.registrar` (string field)

**Conditional Logic**:
```typescript
{(ipo.status === 'CLOSED' || ipo.status === 'LISTED') && (
  <AllotmentCheckerCard
    status={ipo.status}
    registrar={ipo.registrarRelation?.shortName || ipo.registrar || 'Registrar'}
    registrarUrl={ipo.registrarRelation?.allotmentCheckUrl || null}
  />
)}
```

**Empty State**: Doesn't render for OPEN or UPCOMING IPOs

---

### 11. IPO Detail Tabs (IPODetailTabs Component)

**Location**: Bottom section of page (below-the-fold)
**Component**: `@/components/ipo/IPODetailTabs`
**Rendering**: Client-Side (progressive loading)
**Type**: Tabbed interface with 6 tabs

**Tab Navigation**:
- Overview (default)
- Financials
- Peers
- Subscription
- GMP
- Documents

**URL Parameter**: `?tab=overview` (query parameter for deep linking)

---

#### Tab 1: Overview

**Elements**:

**Company Overview Section**:
- **Business Model**:
  - Heading: "Business Model"
  - Content: Company description and business operations
  - Empty State: "No description available."
- **Risk Factors**:
  - Heading: "Risk Factors"
  - Content: Investment risks from DRHP
  - Empty State: "Risk factors will be added after DRHP analysis"

**IPODhan Rating**:
- Platform's editorial rating
- Empty State: "Not Rated"

**Share Buttons**:
- WhatsApp: Share IPO on WhatsApp
- Twitter: Share IPO on Twitter
- Copy Link: Copy page URL to clipboard

**Data Source**:
- `ipo.description`: Business model text
- `ipo.riskFactors`: Risk factors text (if available)

---

#### Tab 2: Financials

**Purpose**: Display financial metrics and ratios

**Elements** (based on code, not visible in current screenshot):
- Revenue trends (FY2021, FY2022, FY2023)
- Profit/Loss statements
- Financial ratios:
  - P/E Ratio
  - EPS
  - ROE (Return on Equity)
  - Debt-to-Equity
  - Net Worth
- Charts/graphs for visualization

**Data Source**:
- `financialData` object from API
- Fields: `revenue_fy2023`, `profit_fy2023`, `pe_ratio`, `eps`, `roe`, etc.

**Empty State**: "Financial data not available for this IPO"

**Known Issue**: ~70% of IPOs missing financial data (see Issue #2 in project inventory)

---

#### Tab 3: Peers

**Purpose**: Extended peer comparison (more detailed than main section)

**Elements**:
- Detailed peer comparison table
- Additional financial metrics
- Industry averages
- Sector benchmarks

**Data Source**:
- `peerCompanies` array
- Sector average data

**Empty State**: "No peer data available"

---

#### Tab 4: Subscription

**Purpose**: Time-series subscription tracking

**Elements**:
- Subscription timeline chart
- Category-wise breakdown over time:
  - Retail Investor subscriptions
  - HNI (Non-Institutional) subscriptions
  - QIB (Qualified Institutional) subscriptions
  - Employee subscriptions (if applicable)
- Latest subscription snapshot
- Historical trends

**Data Source**:
- `subscriptions` array (time-series data)
- Each record: `timestamp`, `retailSubscription`, `hniSubscription`, `qibSubscription`, `totalSubscription`

**Empty State**: "No subscription data available"

**Known Issue**: ~60% of IPOs have no subscription snapshots (see Issue #3 in project inventory)

---

#### Tab 5: GMP (Grey Market Premium)

**Purpose**: GMP price tracking over time

**Elements**:
- GMP timeline chart
- Latest GMP value and percentage
- Historical GMP trends
- GMP sources (Chittorgarh, Moneycontrol)
- Estimated listing gain based on GMP

**Data Source**:
- `gmpRecords` array (time-series data)
- Each record: `timestamp`, `gmp`, `gmpPercent`, `source`

**Empty State**: "No GMP data available"

**Known Issue**: ~65% of IPOs have no GMP records (see Issue #4 in project inventory)

---

#### Tab 6: Documents

**Purpose**: Access IPO documents and prospectus

**Elements**:
- Document list with download links:
  - DRHP (Draft Red Herring Prospectus)
  - RHP (Red Herring Prospectus)
  - Prospectus
  - Addendum (if any)
- Document metadata:
  - Upload date
  - File size
  - Document type
- External links to SEBI, NSE, BSE

**Data Source**:
- `documents` array from API
- Each document: `title`, `type`, `url`, `uploadDate`, `size`

**Empty State**: "No documents available for this IPO"

**Known Issue**: ~80% of IPOs have no documents tracked (see Issue #5 in project inventory)

---

## Data Flow Architecture

### Server-Side Rendering (SSR)

1. **Request**: User navigates to `/ipos/[slug]`
2. **Metadata Generation**: `generateMetadata()` function runs
   - Fetches IPO data via `apiClient.getIPOBySlug(slug)`
   - Generates SEO metadata (title, description, OG tags)
3. **Page Component**: `IPODetailPage()` function runs
   - Fetches full IPO data via `apiClient.getIPOBySlug(slug)`
   - Calculates derived metrics (subscription trend, GMP %)
   - Fetches sector averages if applicable
   - Renders above-the-fold components with data
4. **Response**: HTML sent to browser with populated data

### Client-Side Loading

1. **Tabs Component**: `IPODetailTabs` mounts on client
2. **Tab Navigation**: User clicks tab
3. **Data Fetching**: Client makes API call to `/api/ipos/[slug]` for tab-specific data
4. **Rendering**: Tab content updates with fetched data

### Caching Strategy

- **API Cache**: 15 minutes TTL for IPO detail endpoint
- **Redis Cache Key**: `ipo:slug:{slug}`
- **Cache Invalidation**: On IPO data mutations via admin

---

## SEO & Structured Data

### Metadata Generation

**Title Format**: `{Company Name} IPO - Live Subscription, GMP, Analysis | IPODhan`

**Description Format**: Dynamic based on IPO status and data availability

**Open Graph Tags**:
- `og:title`, `og:description`, `og:image`, `og:url`
- `og:type`: "website"

### JSON-LD Structured Data

**1. Financial Product Schema**:
```json
{
  "@context": "https://schema.org",
  "@type": "FinancialProduct",
  "name": "Cool Caps Industries Limited IPO",
  "description": "...",
  "provider": {
    "@type": "Organization",
    "name": "Cool Caps Industries Limited"
  }
}
```

**2. Breadcrumb Schema**:
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "/" },
    { "@type": "ListItem", "position": 2, "name": "IPOs", "item": "/dashboard" },
    { "@type": "ListItem", "position": 3, "name": "Cool Caps...", "item": "/ipos/..." }
  ]
}
```

---

## Component Tree

```
IPODetailPage (Server Component)
├── Breadcrumbs
├── IPOHeader (SSR)
├── KeyMetricsCards (SSR)
│   ├── IssueSizeCard
│   ├── SubscriptionCard
│   └── GMPCard
├── IssueStructureSection (SSR)
├── InfoSection (SSR)
├── IPOScoreSection (SSR) ⚠️ Using dummy data
├── PeerComparisonSection (SSR, conditional)
├── ListingPerformance (SSR, conditional)
│   └── SectorAverageComparison (SSR, conditional)
├── AffiliateSection (SSR, conditional)
├── LotCalculator (SSR, conditional)
├── AllotmentCheckerCard (SSR, conditional)
└── IPODetailTabs (Client Component)
    ├── OverviewTab
    ├── FinancialsTab
    ├── PeersTab
    ├── SubscriptionTab
    ├── GMPTab
    └── DocumentsTab
```

---

## Performance Metrics

**Target Metrics** (from architecture docs):
- **LCP (Largest Contentful Paint)**: < 2.5s
- **FID (First Input Delay)**: < 100ms
- **CLS (Cumulative Layout Shift)**: < 0.1
- **TTFB (Time to First Byte)**: < 600ms

**API Response Time**:
- **p95**: < 150ms (with cache hit)
- **p99**: < 500ms (with cache miss)

**Current Performance** (from logs):
- Cache hit: ~35ms (excellent)
- Cache miss: ~650ms (needs optimization)

---

## Known Issues & Limitations

### 1. IPO Score Displaying Dummy Data (CRITICAL)

**Issue**: IPOScoreSection shows hardcoded dummy data instead of real-time scoring
- **Score**: Always shows 93/100 (fake)
- **Verdict**: Always shows "Apply" (incorrect)
- **Breakdown**: Shows fake percentages (23/25, 19/25, etc.)

**Root Cause**:
- Real-time scoring system fully implemented (`/api/ipos/[slug]/score`)
- Component not connected to API
- Using dummy props instead of actual `ipoScore` data

**Fix Required**:
- Update `IPOScoreSection` to accept `ipoScore` prop
- Pass `ipoScore` from page component to section
- Remove hardcoded dummy data

**Impact**: Users see misleading scores, platform credibility affected

**Reference**: Issue #25 in `docs/10-issues/PROJECT_FEATURES_AND_ISSUES_INVENTORY.md`

---

### 2. Missing Data for Most IPOs

**Affected Sections**:
- **Financial Data**: 70% of IPOs missing (Tab 2 empty)
- **Subscription Data**: 60% of IPOs missing (Tab 4, Key Metric card empty)
- **GMP Data**: 65% of IPOs missing (Tab 5, Key Metric card empty)
- **Documents**: 80% of IPOs missing (Tab 6 empty)

**Root Cause**:
- NSE API provides incomplete data
- Manual data entry not scaled
- DRHP PDF parsing not implemented

**Workaround**: Empty states display "Not available" messages

**Reference**: Issues #2-5 in project inventory

---

### 3. Lot Size Data Incorrect

**Issue**: Many IPOs show `lotSize = 1` (incorrect)

**Status**: ✅ FIXED (68.89% bad data corrected)

**Fix Applied**:
- Scraper validation added
- Database migration ran
- Lot size validator utility implemented

**Reference**: `scraper/docs/LOT_SIZE_EXECUTIVE_SUMMARY.md`

---

### 4. Issue Size Shows "₹null Crores"

**Issue**: When `issueSize` is null, displays "₹null Crores" instead of proper fallback

**Expected**: "Not available" or "TBA"

**Location**: InfoSection, right column

**Fix Required**: Update InfoSection to handle null values gracefully

---

### 5. Price Range Shows "N/A - N/A"

**Issue**: When price range not available, shows "N/A - N/A" (redundant)

**Expected**: Single "Not available" or "Price band not announced"

**Location**: InfoSection, left column

**Fix Required**: Better empty state messaging

---

### 6. Peer Comparison Always Shows Same 3 Companies

**Issue**: Peer table shows Infosys, Reliance, TCS regardless of actual IPO sector

**Root Cause**: Likely dummy/seed data in `peerCompanies` table

**Expected**: Actual sector-specific peers

**Fix Required**:
- Verify peer data is correctly populated
- Implement peer scraper for real data
- Filter peers by sector

**Reference**: Issue #25 (unmapped `peer_companies` table)

---

### 7. No Loading States

**Issue**: No skeleton loaders or loading indicators during client-side tab navigation

**Impact**: Appears unresponsive when fetching tab data

**Fix Required**: Add skeleton loaders for tabs

---

### 8. Mobile Responsiveness Issues

**Known Issues**:
- 3-column key metrics cards don't stack optimally on small screens
- Peer comparison table horizontal scroll not smooth
- Affiliate buttons too large on mobile

**Fix Required**: Responsive design improvements

---

## Future Enhancements

### Planned Features

1. **Real-time Score Integration** (Priority 1)
   - Connect IPOScoreSection to `/api/ipos/[slug]/score`
   - Display actual calculated scores
   - Show confidence percentage

2. **Data Completeness Indicator** (Priority 2)
   - Show % of fields populated
   - Visual indicator (progress bar or badge)
   - Help users understand data quality

3. **Stock Symbol Display** (Priority 3)
   - Add BSE symbol, NSE symbol prominently
   - Display ISIN code in header (not just details)

4. **Enhanced Financial Visualizations** (Priority 4)
   - Revenue/profit trend charts
   - Financial ratio comparison charts
   - Interactive visualizations

5. **Subscription Live Updates** (Priority 5)
   - Auto-refresh subscription data every 5 minutes for OPEN IPOs
   - Notification when subscription crosses thresholds (1x, 5x, 10x)

6. **GMP Tracking Alerts** (Priority 6)
   - Email/push notifications for GMP changes
   - User watchlist feature

7. **Document Preview** (Priority 7)
   - In-browser PDF viewer for DRHP/RHP
   - Highlight key sections (financials, risk factors)

8. **AI-Powered Analysis** (Priority 8)
   - NLP analysis of DRHP text
   - Risk factor extraction and scoring
   - Management quality assessment

---

## API Endpoints Used

| Endpoint | Purpose | Cache TTL | Performance Target |
|----------|---------|-----------|-------------------|
| `GET /api/ipos/[slug]` | Main IPO data + related entities | 15 min | p95 < 150ms |
| `GET /api/ipos/[slug]/score` | Real-time IPO scoring | 1h (OPEN), 24h (LISTED) | p95 < 200ms |
| `GET /api/ipos/[slug]/financials` | Financial metrics | 15 min | p95 < 100ms |
| `GET /api/ipos/[slug]/subscriptions/latest` | Latest subscription | 3 min | p95 < 100ms |
| `GET /api/ipos/[slug]/gmp/latest` | Latest GMP | 15 min | p95 < 100ms |
| `GET /api/ipos/[slug]/documents` | Document list | 1 day | p95 < 100ms |
| `GET /api/subscription/history/[ipoId]` | Subscription time-series | 15 min | p95 < 200ms |
| `GET /api/gmp/history/[ipoId]` | GMP time-series | 15 min | p95 < 200ms |

---

## Testing Checklist

### Manual Testing

**Page Load**:
- [ ] Page loads within 3 seconds
- [ ] All SSR content visible immediately
- [ ] No console errors

**Data Display**:
- [ ] Company name and header info correct
- [ ] Status badge shows correct status
- [ ] Key metrics cards show real data (or proper empty state)
- [ ] IPO details section complete
- [ ] All dates formatted correctly

**Conditional Sections**:
- [ ] Affiliate section shows for OPEN/UPCOMING only
- [ ] Allotment checker shows for CLOSED/LISTED only
- [ ] Listing performance shows for LISTED only
- [ ] Lot calculator shows when price range + lot size available

**Tabs**:
- [ ] All 6 tabs clickable
- [ ] Tab content loads correctly
- [ ] Deep linking works (`?tab=financials`)
- [ ] Empty states display properly

**Mobile**:
- [ ] Layout responsive on mobile (375px width)
- [ ] Cards stack vertically
- [ ] Tables scroll horizontally
- [ ] Buttons appropriately sized

**SEO**:
- [ ] Page title correct in browser tab
- [ ] Meta description present
- [ ] Open Graph tags in HTML
- [ ] JSON-LD structured data valid

### Automated Testing

**E2E Tests** (Playwright):
```bash
npx playwright test tests/e2e/ipo-detail-page.spec.ts
```

**Integration Tests** (Vitest):
```bash
npm run test:integration -- ipo-detail
```

**Performance Tests** (Lighthouse):
```bash
lhci autorun --url=http://localhost:3000/ipos/[slug]
```

---

## File References

**Page Component**: `web/app/ipos/[slug]/page.tsx` (269 lines)

**Child Components**:
- `web/components/ipo/IPOHeader.tsx`
- `web/components/ipo/KeyMetricsCards.tsx`
- `web/components/ipo/InfoSection.tsx`
- `web/components/ipo/IssueStructureSection.tsx`
- `web/components/ipo/IPODetailTabs.tsx`
- `web/components/ipo/IPOScoreSection.tsx`
- `web/components/ipo/PeerComparisonSection.tsx`
- `web/components/ipo/ListingPerformance.tsx`
- `web/components/ipo/SectorAverageComparison.tsx`
- `web/components/ipo/AllotmentCheckerCard.tsx`
- `web/components/affiliate/AffiliateSection.tsx`
- `web/components/tools/LotCalculator.tsx`
- `web/components/layout/Breadcrumbs.tsx`

**API Routes**:
- `web/app/api/ipos/[slug]/route.ts`
- `web/app/api/ipos/[slug]/score/route.ts`
- `web/app/api/ipos/[slug]/financials/route.ts`
- `web/app/api/ipos/[slug]/subscriptions/latest/route.ts`
- `web/app/api/ipos/[slug]/gmp/latest/route.ts`
- `web/app/api/subscription/history/[ipoId]/route.ts`
- `web/app/api/gmp/history/[ipoId]/route.ts`

**SEO Utilities**:
- `web/lib/seo/metadata.ts`
- `web/lib/seo/structured-data.ts`

**API Client**:
- `web/lib/api-client.ts`

---

## Changelog

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-10-26 | 1.0 | Initial documentation created | Claude Code |

---

## Screenshots

**Full Page**: See `.playwright-mcp/ipo-detail-page-full.png`

**Error State** (before cache clear): See `.playwright-mcp/ipo-detail-error-state.png`

---

**End of Documentation**
