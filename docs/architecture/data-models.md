# Data Models

Based on the PRD and front-end spec, the following TypeScript interfaces will be shared between frontend and backend via the `packages/shared` package.

## IPO (Core Entity)

**Purpose:** Represents an Initial Public Offering with all associated details including company information, issue details, timeline, and performance metrics.

**Key Attributes:**
- `id`: string (UUID) - Unique identifier
- `companyName`: string - Company/issuer name
- `slug`: string - URL-friendly identifier
- `category`: enum - IPO type (MAINBOARD | SME | RIGHTS | NCD)
- `sector`: string - Industry sector
- `issueSize`: number - Total issue size in INR crores
- `priceRange`: object - Min and max price per share
- `lotSize`: number - Minimum application quantity
- `status`: enum - Current status (UPCOMING | OPEN | CLOSED | LISTED)
- `dates`: object - Timeline (open, close, allotment, listing dates)
- `rating`: number | null - IPODhan rating (1-5 stars)

**Relationships:**
- Has many `Subscription` records
- Has many `GMPRecord` entries
- Has one `FinancialData` record
- Has many `Document` records
- Has one `ListingPerformance` record (if listed)

### TypeScript Interface

```typescript
// packages/shared/src/types/ipo.ts

export enum IPOCategory {
  MAINBOARD = 'MAINBOARD',
  SME = 'SME',
  RIGHTS = 'RIGHTS',
  NCD = 'NCD'
}

export enum IPOStatus {
  UPCOMING = 'UPCOMING',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  LISTED = 'LISTED'
}

export interface PriceRange {
  min: number;
  max: number;
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
  category: IPOCategory;
  sector: string;
  issueSize: number;
  priceRange: PriceRange;
  lotSize: number;
  status: IPOStatus;
  dates: IPODates;
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

## Subscription

**Purpose:** Tracks detailed category-wise subscription data with granular breakdown matching NSE/BSE reporting format.

**Key Attributes:**
- High-level categories: QIB, NII, Retail, Employee, Others, Total
- Granular breakdown: Anchor Investors, Retail HNI, Retail Others, bNII, sNII
- Additional metrics: Total applications, total shares bid, shares offered

### TypeScript Interface

```typescript
// packages/shared/src/types/subscription.ts

export interface Subscription {
  id: string;
  ipoId: string;
  timestamp: Date;

  // High-level categories
  qibSubscription: number;
  niiSubscription: number;
  retailSubscription: number;
  totalSubscription: number;
  employeeSubscription: number;
  othersSubscription: number;

  // Granular breakdown
  anchorInvestorSubscription: number;
  retailHNISubscription: number;
  retailOthersSubscription: number;
  bNIISubscription: number;
  sNIISubscription: number;

  // Additional metrics
  totalApplications: number;
  totalSharesBid: number;
  sharesOffered: number;
}
```

## GMPRecord 🔵 **MVP**

**Purpose:** Grey Market Premium historical tracking for trend visualization with enhanced grey market data.

**Key Attributes:**
- Current GMP and estimated listing price
- Subject rate (unofficial grey market lot rate)
- Kostak rate (selling allotment rights rate)
- Sauda details (grey market trading information)
- Historical tracking for 7-day trend charts

### TypeScript Interface

```typescript
// packages/shared/src/types/gmp.ts

export interface GMPRecord {
  id: string;
  ipoId: string;
  timestamp: Date;

  // Core GMP data
  gmp: number;
  expectedListingPrice: number;

  // Enhanced grey market data 🔵 MVP
  subjectRate: number | null;        // Subject/Safalya rate
  kostakRate: number | null;         // Kostak rate (allotment rights)
  saudaDetails: string | null;       // Additional grey market trading info

  // Metadata
  source: string;                    // Data source attribution
}
```

## FinancialData

**Purpose:** Company financial metrics for IPO evaluation.

### TypeScript Interface

```typescript
// packages/shared/src/types/financial.ts

export interface YearlyFinancial {
  fy2022: number;
  fy2023: number;
  fy2024: number;
}

export interface FinancialData {
  id: string;
  ipoId: string;
  revenue: YearlyFinancial;
  profit: YearlyFinancial;
  netWorth: number;
  peRatio: number | null;
  eps: number | null;
  roe: number | null;
  debtToEquity: number | null;
  reservesAndSurplus: number;
  totalAssets: number;
  totalBorrowing: number;
}
```

## ListingPerformance

**Purpose:** Post-listing performance metrics.

### TypeScript Interface

```typescript
// packages/shared/src/types/listing.ts

export interface ListingPerformance {
  id: string;
  ipoId: string;
  listingPrice: number;
  issuePrice: number;
  listingGainPercent: number;
  currentPrice: number | null;
  currentGainPercent: number | null;
  lastUpdated: Date;
}
```

## Document

**Purpose:** DRHP, RHP, prospectus, and other IPO documents.

### TypeScript Interface

```typescript
// packages/shared/src/types/document.ts

export enum DocumentType {
  DRHP = 'DRHP',
  RHP = 'RHP',
  PROSPECTUS = 'PROSPECTUS',
  ADDENDUM = 'ADDENDUM'
}

export interface Document {
  id: string;
  ipoId: string;
  type: DocumentType;
  title: string;
  url: string;
  fileSize: number | null;
  uploadedAt: Date;
}
```

## EmailSubscriber 🟢 **Phase 2**

**Purpose:** Email alert subscriptions for IPO notifications (deferred to Phase 2).

### TypeScript Interface

```typescript
// packages/shared/src/types/subscriber.ts

export interface AlertPreferences {
  newIPOs: boolean;
  closingSoon: boolean;
  allotment: boolean;
  listing: boolean;
}

export interface EmailSubscriber {
  id: string;
  email: string;
  isVerified: boolean;
  preferences: AlertPreferences;
  subscribedAt: Date;
  unsubscribedAt: Date | null;
}
```

## MarketHoliday 🔵 **MVP**

**Purpose:** Store NSE/BSE trading holidays for IPO calendar and timeline calculations.

**Key Attributes:**
- Holiday date and description
- Exchange applicability (NSE, BSE, or both)
- Holiday type (trading, settlement)

### TypeScript Interface

```typescript
// packages/shared/src/types/holiday.ts

export enum Exchange {
  NSE = 'NSE',
  BSE = 'BSE',
  BOTH = 'BOTH'
}

export enum HolidayType {
  TRADING = 'TRADING',           // No trading on this day
  SETTLEMENT = 'SETTLEMENT',     // Settlement holiday only
  BOTH = 'BOTH'                  // Both trading and settlement
}

export interface MarketHoliday {
  id: string;
  date: Date;
  description: string;             // e.g., "Republic Day", "Diwali"
  exchange: Exchange;              // NSE, BSE, or BOTH
  type: HolidayType;
  year: number;                    // For filtering by year
  createdAt: Date;
  updatedAt: Date;
}
```

## Registrar 🔵 **MVP**

**Purpose:** Store IPO registrar contact information for allotment checking and investor queries.

**Key Attributes:**
- Registrar company details
- Contact information (email, phone, website)
- Allotment check URL pattern

### TypeScript Interface

```typescript
// packages/shared/src/types/registrar.ts

export interface Registrar {
  id: string;
  name: string;                    // e.g., "Link Intime India Pvt Ltd"
  shortName: string;               // e.g., "Link Intime"
  email: string;                   // Contact email for IPO queries
  phone: string | null;
  website: string;
  allotmentCheckUrl: string | null; // URL pattern for allotment status
  address: string | null;
  logoUrl: string | null;
  active: boolean;                 // Is registrar currently active?
  createdAt: Date;
  updatedAt: Date;
}
```

## PeerCompany 🔵 **MVP** (Full Metrics)

**Purpose:** Store peer company financial data for IPO comparison analysis.

**Key Attributes:**
- Company identification and sector
- Full financial metrics for comprehensive comparison (MVP decision: include all metrics)

### TypeScript Interface

```typescript
// packages/shared/src/types/peer.ts

export interface PeerCompany {
  id: string;
  ipoId: string;                   // Associated IPO for comparison
  companyName: string;
  sector: string;
  isListed: boolean;

  // 🔵 MVP - Full financial metrics for comprehensive peer comparison
  peRatio: number | null;          // Price-to-Earnings ratio
  eps: number | null;              // Earnings Per Share (Basic)
  dilutedEps: number | null;       // Diluted EPS
  ronw: number | null;             // Return on Net Worth %
  nav: number | null;              // Net Asset Value per share
  pbvRatio: number | null;         // Price-to-Book Value ratio
  financialStatementType: 'CONSOLIDATED' | 'STANDALONE' | null;

  // Metadata
  dataSource: string;              // Source of peer data
  lastUpdated: Date;
  createdAt: Date;
}
```

## BrokerAffiliate 🔵 **MVP** (Simple Links - No Tracking)

**Purpose:** Store broker affiliate partnership information for IPO application links.

**Key Attributes:**
- Broker details and affiliate URL
- Phase 2 will add click tracking and conversion analytics

### TypeScript Interface

```typescript
// packages/shared/src/types/affiliate.ts

export interface BrokerAffiliate {
  id: string;
  brokerName: string;              // e.g., "Zerodha", "AngelOne"
  brokerLogo: string | null;
  affiliateUrl: string;            // Affiliate link URL
  displayText: string;             // CTA text (e.g., "Open Demat Account")
  active: boolean;
  displayOrder: number;            // Order in UI

  // 🟢 Phase 2 - Analytics
  // clickCount: number;
  // conversionCount: number;
  // lastClickedAt: Date;

  createdAt: Date;
  updatedAt: Date;
}
```

## IPONews 🟢 **Phase 2** (Post-MVP)

**Purpose:** Store IPO-specific news, updates, and announcements.

**Key Attributes:**
- News content and metadata
- Association with specific IPO
- News categorization (Announcement, Update, Allotment, Listing)

### TypeScript Interface

```typescript
// packages/shared/src/types/news.ts

export enum NewsType {
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  UPDATE = 'UPDATE',
  ANALYSIS = 'ANALYSIS',
  ALLOTMENT = 'ALLOTMENT',
  LISTING = 'LISTING'
}

export interface IPONews {
  id: string;
  ipoId: string;
  title: string;
  content: string;                 // Full news content (markdown supported)
  excerpt: string;                 // Short summary for listing
  type: NewsType;
  source: string;                  // Source attribution (e.g., "NSE", "IPODhan Editorial")
  externalUrl: string | null;      // Link to original article if external
  publishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

---
