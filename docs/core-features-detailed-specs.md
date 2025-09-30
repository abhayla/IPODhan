# IPODhan Core Features - Detailed Specifications

## Table of Contents
1. [IPO Information Module](#1-ipo-information-module)
2. [Live Subscription Tracking](#2-live-subscription-tracking)
3. [GMP System](#3-gmp-system)
4. [Document Management](#4-document-management)
5. [Allotment Checker](#5-allotment-checker)

---

## 1. IPO Information Module

### 1.1 Overview
Central module for displaying and managing all IPO-related information across different stages (upcoming, live, closed) for both Mainboard and SME segments.

### 1.2 Data Structure

```typescript
interface IPO {
  // Basic Information
  id: string;                          // Unique identifier
  symbol: string;                       // NSE/BSE symbol
  companyName: string;                  // Full company name
  category: 'Mainboard' | 'SME';       // IPO category
  exchange: 'NSE' | 'BSE' | 'Both';    // Listing exchange

  // Status Information
  status: 'Upcoming' | 'Live' | 'Closed' | 'Listed';
  subscriptionStatus: 'Not Started' | 'Open' | 'Closed' | 'Basis of Allotment' | 'Allotted';

  // Important Dates
  dates: {
    drhpDate?: Date;                   // Draft prospectus filing
    rhpDate?: Date;                    // Red herring prospectus
    openDate: Date;                    // IPO opens
    closeDate: Date;                   // IPO closes
    basisOfAllotmentDate?: Date;       // Allotment finalization
    refundInitiationDate?: Date;      // Refund starts
    creditSharesDate?: Date;           // Shares credited
    listingDate?: Date;                // Exchange listing
    relisting?: Date;                  // Re-listing if applicable
  };

  // Price Information
  pricing: {
    priceRange: {
      min: number;
      max: number;
    };
    finalPrice?: number;               // Fixed after book building
    discountToEmployees?: number;      // Employee discount if any
    discountToRetail?: number;         // Retail discount if any
    faceValue: number;                 // Face value per share
    lotSize: number;                   // Minimum shares to apply
    minInvestment: number;             // Minimum investment amount
    maxRetailInvestment: number;      // Max for retail (2L typically)
  };

  // Company Information
  company: {
    sector: string;                    // Industry sector
    industry: string;                  // Specific industry
    description: string;               // Brief description
    website?: string;                  // Company website
    headquarters: string;              // Company location
    founded?: number;                  // Year founded
    employees?: number;                // Employee count
    logo?: string;                     // Logo URL
  };

  // Issue Details
  issueDetails: {
    issueSize: number;                // Total issue size in Cr
    freshIssue: number;                // Fresh issue component
    offerForSale: number;              // OFS component
    totalShares: number;               // Total shares offered
    marketMakerPortion?: number;      // For SME IPOs
    reservations: {
      qib: number;                     // QIB percentage
      nii: number;                     // NII percentage
      retail: number;                  // Retail percentage
      employee?: number;               // Employee reservation
      shareholder?: number;            // Existing shareholder
      others?: Array<{
        category: string;
        percentage: number;
      }>;
    };
  };

  // Lead Managers & Registrar
  intermediaries: {
    leadManagers: Array<{
      name: string;
      type: 'BRLM' | 'BLM' | 'Co-Lead';
    }>;
    registrar: {
      name: string;
      website: string;
      phone: string;
      email: string;
    };
    marketMakers?: string[];           // For SME IPOs
  };

  // Financial Information
  financials: {
    revenue: {
      latest: number;                  // Latest FY
      previousYear: number;
      cagr3Year?: number;
    };
    profit: {
      latest: number;
      previousYear: number;
      cagr3Year?: number;
    };
    eps: number;                      // Earnings per share
    pe: number;                        // P/E ratio at issue price
    roe?: number;                      // Return on equity
    roce?: number;                     // Return on capital employed
    debtToEquity?: number;
    bookValue?: number;

    // Peer Comparison
    peerComparison?: Array<{
      companyName: string;
      pe: number;
      marketCap: number;
    }>;
  };

  // IPO Objectives
  objectives: {
    primary: string;                   // Main objective
    usageBreakdown: Array<{
      purpose: string;
      amount: number;
      percentage: number;
    }>;
  };

  // Promoter Holdings
  shareholding: {
    preIPO: {
      promoter: number;
      public: number;
      others: number;
    };
    postIPO: {
      promoter: number;
      public: number;
      others: number;
    };
  };

  // Risk Factors
  risks: {
    critical: string[];                // Critical risks
    business: string[];                // Business risks
    industry: string[];                // Industry risks
  };

  // Metadata
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    lastSyncAt: Date;
    dataSource: string[];              // NSE, BSE, SEBI, etc.
    isVerified: boolean;
    verifiedBy?: string;
    tags: string[];                    // For search/filter
  };
}
```

### 1.3 API Endpoints

```yaml
# Core IPO Endpoints
GET /api/v1/ipos
  Query Parameters:
    - status: upcoming | live | closed | listed
    - category: mainboard | sme | all
    - exchange: nse | bse | both
    - sector: string
    - dateFrom: ISO date
    - dateTo: ISO date
    - minSize: number (in Cr)
    - maxSize: number (in Cr)
    - search: string (company name/symbol)
    - page: number
    - limit: number
    - sort: openDate | closeDate | issueSize | companyName

GET /api/v1/ipos/{id}
  Returns: Complete IPO details

GET /api/v1/ipos/{id}/timeline
  Returns: Detailed timeline with all events

GET /api/v1/ipos/calendar
  Query Parameters:
    - month: number
    - year: number
  Returns: Calendar view of IPOs

GET /api/v1/ipos/statistics
  Returns: Market statistics and trends

POST /api/v1/ipos/{id}/track
  Body: { userId, notificationPreferences }
  Returns: Tracking confirmation

DELETE /api/v1/ipos/{id}/track
  Returns: Untrack confirmation
```

### 1.4 Data Sources & Integration

```yaml
Primary Sources:
  NSE:
    - URL: https://www.nseindia.com/products/dynaContent/equities/ipos/ipo_login.jsp
    - Method: Web scraping + API
    - Frequency: Every 30 minutes
    - Data: Live IPOs, subscription status

  BSE:
    - URL: https://www.bseindia.com/markets/PublicIssues/
    - Method: API + Web scraping
    - Frequency: Every 30 minutes
    - Data: IPO details, SME listings

  SEBI:
    - URL: https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes
    - Method: Document parsing
    - Frequency: Daily
    - Data: DRHP/RHP documents

Secondary Sources:
  - MoneyControl API
  - Screener.in
  - Company websites
  - Stock exchange announcements
```

### 1.5 UI Components

```typescript
// IPO Card Component
interface IPOCardProps {
  ipo: IPO;
  view: 'grid' | 'list';
  showActions: boolean;
  onTrack: () => void;
  onViewDetails: () => void;
}

// IPO List/Grid View
interface IPOListViewProps {
  ipos: IPO[];
  viewMode: 'grid' | 'list' | 'calendar';
  filters: FilterOptions;
  onFilterChange: (filters: FilterOptions) => void;
  onSort: (field: string, order: 'asc' | 'desc') => void;
  loading: boolean;
  pagination: PaginationProps;
}

// IPO Detail Page
interface IPODetailPageProps {
  ipo: IPO;
  subscriptionData: SubscriptionData;
  gmpData: GMPData;
  similarIPOs: IPO[];
  userTracking: boolean;
}

// IPO Calendar Component
interface IPOCalendarProps {
  month: number;
  year: number;
  ipos: IPO[];
  onDateSelect: (date: Date) => void;
  onIPOSelect: (ipo: IPO) => void;
}
```

### 1.6 Features & Functionality

1. **Smart Filtering**
   - Multi-parameter filtering
   - Saved filter presets
   - Quick filters (This Week, High Value, SME Only)

2. **Search & Discovery**
   - Full-text search
   - Autocomplete suggestions
   - Search history
   - Trending searches

3. **Sorting Options**
   - Opening date (earliest/latest)
   - Closing date
   - Issue size
   - Company name
   - Subscription status
   - Expected returns (with GMP)

4. **View Modes**
   - Grid view with cards
   - List view with tables
   - Calendar view
   - Timeline view
   - Comparison view

5. **Quick Actions**
   - Track/Untrack IPO
   - Set reminder
   - Share IPO details
   - Download prospectus
   - View subscription status
   - Check GMP

---

## 2. Live Subscription Tracking

### 2.1 Overview
Real-time tracking system for monitoring IPO subscription status across different investor categories with live updates and historical trends.

### 2.2 Data Structure

```typescript
interface SubscriptionData {
  ipoId: string;
  lastUpdated: Date;
  updateFrequency: number;              // in seconds
  isLive: boolean;

  // Overall Subscription
  overall: {
    sharesOffered: number;
    sharesSubscribed: number;
    timesSubscribed: number;
    amount: number;                     // in Cr
    applicationsReceived: number;
  };

  // Category-wise Subscription
  categories: {
    retail: CategorySubscription;
    nii: {
      small: CategorySubscription;       // sNII (< 10L)
      big: CategorySubscription;         // bNII (> 10L)
      total: CategorySubscription;
    };
    qib: CategorySubscription;
    employee?: CategorySubscription;
    shareholder?: CategorySubscription;
    others?: CategorySubscription[];
  };

  // Day-wise Trend
  dayWiseTrend: Array<{
    day: number;                        // Day 1, 2, 3
    date: Date;
    timestamp: Date;
    overall: number;                    // Times subscribed
    retail: number;
    nii: number;
    qib: number;
    cumulative: number;                 // Cumulative subscription
  }>;

  // Intraday Updates
  intradayUpdates: Array<{
    timestamp: Date;
    overall: number;
    retail: number;
    nii: number;
    qib: number;
    source: string;
  }>;

  // Historical Comparison
  comparison: {
    similarIPOs: Array<{
      companyName: string;
      category: string;
      finalSubscription: number;
      listingGain: number;
    }>;
    categoryAverage: {
      mainboard: number;
      sme: number;
    };
    sectorAverage: number;
  };
}

interface CategorySubscription {
  sharesOffered: number;
  sharesSubscribed: number;
  timesSubscribed: number;
  amount: number;
  applicationsReceived: number;
  percentageOfTotal: number;

  // Additional Analytics
  analytics?: {
    velocityPerHour: number;            // Subscription speed
    projectedFinal: number;             // ML prediction
    confidence: number;                 // Prediction confidence
    trend: 'increasing' | 'stable' | 'decreasing';
  };
}
```

### 2.3 Real-time Architecture

```yaml
WebSocket Implementation:
  Server:
    - Technology: Socket.io / Native WebSocket
    - Scaling: Redis Pub/Sub for horizontal scaling
    - Load Balancing: Sticky sessions with socket affinity

  Events:
    - subscription:update - Real-time subscription updates
    - subscription:dayEnd - End of day summary
    - subscription:alert - Milestone alerts (2x, 5x, 10x)
    - subscription:final - Final subscription data

  Client Subscription:
    - Subscribe: socket.emit('subscribe:ipo', {ipoId})
    - Unsubscribe: socket.emit('unsubscribe:ipo', {ipoId})
    - Batch: socket.emit('subscribe:multiple', {ipoIds: []})

Fallback Mechanism:
  - Primary: WebSocket for real-time
  - Fallback 1: Server-Sent Events (SSE)
  - Fallback 2: Long polling
  - Fallback 3: Regular polling (30 sec intervals)
```

### 2.4 Data Collection Pipeline

```python
# Data Collection Service (Python)
class SubscriptionCollector:
    def __init__(self):
        self.nse_scraper = NSEScraper()
        self.bse_scraper = BSEScraper()
        self.redis_client = Redis()
        self.db = Database()

    async def collect_subscription_data(self, ipo_id: str):
        """Collect subscription data from multiple sources"""

        # 1. Fetch from NSE
        nse_data = await self.nse_scraper.get_subscription(ipo_id)

        # 2. Fetch from BSE
        bse_data = await self.bse_scraper.get_subscription(ipo_id)

        # 3. Reconcile data
        subscription = self.reconcile_data(nse_data, bse_data)

        # 4. Calculate analytics
        subscription['analytics'] = self.calculate_analytics(subscription)

        # 5. Store in database
        await self.db.save_subscription(subscription)

        # 6. Publish to Redis for WebSocket
        await self.redis_client.publish(
            f'subscription:{ipo_id}',
            subscription
        )

        # 7. Check for alerts
        await self.check_alerts(ipo_id, subscription)

        return subscription

    def calculate_analytics(self, subscription):
        """Calculate subscription analytics and predictions"""
        return {
            'velocity': self.calculate_velocity(subscription),
            'projection': self.predict_final_subscription(subscription),
            'trend': self.analyze_trend(subscription),
            'anomalies': self.detect_anomalies(subscription)
        }
```

### 2.5 API Endpoints

```yaml
# Subscription Endpoints
GET /api/v1/subscriptions/{ipoId}/live
  Returns: Current live subscription data
  Headers:
    - X-Update-Frequency: seconds between updates

GET /api/v1/subscriptions/{ipoId}/history
  Query Parameters:
    - interval: 1h | 6h | 1d | all
  Returns: Historical subscription data

GET /api/v1/subscriptions/{ipoId}/trend
  Returns: Day-wise and intraday trends

GET /api/v1/subscriptions/{ipoId}/analytics
  Returns: Predictions and analytics

GET /api/v1/subscriptions/compare
  Query Parameters:
    - ipoIds: comma-separated IPO IDs
  Returns: Comparative subscription data

WebSocket /ws/subscriptions
  Events:
    - subscribe: {ipoId: string}
    - unsubscribe: {ipoId: string}
    - update: {ipoId: string, data: SubscriptionData}
```

### 2.6 UI Components

```typescript
// Live Subscription Widget
interface SubscriptionWidgetProps {
  ipoId: string;
  view: 'compact' | 'detailed' | 'chart';
  autoRefresh: boolean;
  refreshInterval: number;
  showPredictions: boolean;
  showAlerts: boolean;
}

// Subscription Chart
interface SubscriptionChartProps {
  data: SubscriptionData;
  chartType: 'bar' | 'line' | 'donut' | 'stacked';
  timeRange: '1d' | '2d' | '3d' | 'all';
  categories: ('retail' | 'nii' | 'qib')[];
  showProjection: boolean;
  interactive: boolean;
}

// Category Breakdown
interface CategoryBreakdownProps {
  subscription: CategorySubscription;
  category: string;
  showAnalytics: boolean;
  compareWith?: CategorySubscription;
}

// Subscription Alerts
interface SubscriptionAlertProps {
  ipoId: string;
  alertThresholds: {
    overall: number[];
    retail: number[];
    qib: number[];
  };
  onAlert: (alert: SubscriptionAlert) => void;
}
```

### 2.7 Features & Functionality

1. **Real-time Updates**
   - WebSocket connection for live data
   - Auto-reconnection on disconnect
   - Offline queue for missed updates
   - Update frequency indicator

2. **Visualizations**
   - Live updating charts
   - Category-wise pie charts
   - Day-wise trend lines
   - Heat maps for multiple IPOs
   - Subscription velocity gauge

3. **Predictive Analytics**
   - ML-based final subscription prediction
   - Confidence intervals
   - Historical pattern matching
   - Anomaly detection

4. **Alerts & Notifications**
   - Milestone alerts (1x, 2x, 5x, 10x)
   - Category-specific alerts
   - Sudden surge detection
   - Day-end summaries

5. **Comparative Analysis**
   - Side-by-side IPO comparison
   - Sector-wise benchmarking
   - Historical similar IPOs
   - Success probability score

---

## 3. GMP (Grey Market Premium) System

### 3.1 Overview
Comprehensive grey market premium tracking system with historical data, trend analysis, and predictive capabilities.

### 3.2 Data Structure

```typescript
interface GMPData {
  ipoId: string;
  lastUpdated: Date;
  currentGMP: {
    premium: number;                    // Absolute premium in Rs
    premiumPercentage: number;          // Percentage over issue price
    estimatedListingPrice: number;      // Issue price + GMP
    expectedGain: number;                // Expected profit/loss
    expectedGainPercentage: number;
    timestamp: Date;
    source: string[];                   // Data sources
    confidence: 'high' | 'medium' | 'low';
  };

  // Kostak Rates (for HNI/non-retail)
  kostak: {
    rate: number;                       // Per lot premium
    applicationAmount: number;          // Amount per application
    profit: number;                     // Expected profit
    lastUpdated: Date;
  };

  // Subject to Sauda (conditional trading)
  subjectToSauda: {
    rate: number;                       // Rate per share
    condition: string;                  // Conditions apply
    lastUpdated: Date;
  };

  // Historical GMP Trend
  history: Array<{
    date: Date;
    time: string;
    gmp: number;
    percentage: number;
    volume: 'high' | 'medium' | 'low';  // Trading volume
    source: string;
    event?: string;                     // Any specific event
  }>;

  // Daily Summary
  dailySummary: Array<{
    date: Date;
    openGMP: number;
    highGMP: number;
    lowGMP: number;
    closeGMP: number;
    avgGMP: number;
    volatility: number;
    trend: 'bullish' | 'bearish' | 'neutral';
  }>;

  // Analytics
  analytics: {
    trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
    momentum: number;                   // Rate of change
    support: number;                    // Support level
    resistance: number;                 // Resistance level
    volatility: number;                 // Price volatility index
    reliability: number;                // Data reliability score
    sentiment: 'positive' | 'negative' | 'neutral';
  };

  // Predictions
  predictions: {
    listingDayGMP: {
      value: number;
      confidence: number;
      range: {
        min: number;
        max: number;
      };
    };
    listingPrice: {
      value: number;
      confidence: number;
      range: {
        min: number;
        max: number;
      };
    };
    recommendation: 'strong buy' | 'buy' | 'hold' | 'avoid' | 'strong avoid';
    reasoning: string[];
  };

  // Comparison
  marketComparison: {
    averageGMPSector: number;
    averageGMPMarket: number;
    rank: number;                       // Rank among current IPOs
    totalIPOs: number;
    performance: 'above average' | 'average' | 'below average';
  };
}
```

### 3.3 Data Collection Strategy

```yaml
Data Sources:
  Primary Sources:
    InvestorGain:
      - Method: Web scraping
      - Frequency: Every 2 hours
      - Reliability: High

    IPOWatch:
      - Method: Web scraping
      - Frequency: Every 3 hours
      - Reliability: High

    Chittorgarh:
      - Method: Web scraping
      - Frequency: Every 4 hours
      - Reliability: High

  Secondary Sources:
    - Telegram channels (automated monitoring)
    - WhatsApp business API (dealer network)
    - Twitter sentiment analysis
    - Stock market forums

  Manual Sources:
    - Dealer network calls (2x daily)
    - Market maker inputs
    - Broker feedback

Data Reconciliation:
  - Weighted average based on source reliability
  - Outlier detection and removal
  - Confidence scoring based on convergence
  - Manual verification for high-variance data
```

### 3.4 Collection & Processing Pipeline

```python
# GMP Data Pipeline
class GMPCollector:
    def __init__(self):
        self.scrapers = {
            'investorgain': InvestorGainScraper(),
            'ipowatch': IPOWatchScraper(),
            'chittorgarh': ChittorgarhScraper()
        }
        self.ml_model = GMPPredictionModel()
        self.validator = GMPValidator()

    async def collect_gmp_data(self, ipo_id: str):
        """Collect and process GMP data"""

        # 1. Collect from all sources
        raw_data = {}
        for source, scraper in self.scrapers.items():
            try:
                raw_data[source] = await scraper.get_gmp(ipo_id)
            except Exception as e:
                logger.error(f"Failed to scrape {source}: {e}")

        # 2. Validate and clean data
        validated_data = self.validator.validate(raw_data)

        # 3. Calculate weighted average
        current_gmp = self.calculate_weighted_gmp(validated_data)

        # 4. Detect anomalies
        anomalies = self.detect_anomalies(current_gmp, historical_data)

        # 5. Update predictions
        predictions = await self.ml_model.predict(
            current_gmp,
            subscription_data,
            market_conditions
        )

        # 6. Calculate analytics
        analytics = self.calculate_analytics(
            current_gmp,
            historical_data,
            market_data
        )

        # 7. Store in database
        gmp_data = {
            'current': current_gmp,
            'predictions': predictions,
            'analytics': analytics,
            'anomalies': anomalies
        }

        await self.db.save_gmp(ipo_id, gmp_data)

        # 8. Send alerts if needed
        await self.check_gmp_alerts(ipo_id, gmp_data)

        return gmp_data

    def calculate_weighted_gmp(self, data: dict) -> float:
        """Calculate weighted average GMP"""
        weights = {
            'investorgain': 0.35,
            'ipowatch': 0.35,
            'chittorgarh': 0.30
        }

        weighted_sum = 0
        total_weight = 0

        for source, gmp_value in data.items():
            if source in weights and gmp_value is not None:
                weighted_sum += gmp_value * weights[source]
                total_weight += weights[source]

        return weighted_sum / total_weight if total_weight > 0 else 0
```

### 3.5 API Endpoints

```yaml
# GMP Endpoints
GET /api/v1/gmp/{ipoId}/current
  Returns: Current GMP data with confidence score

GET /api/v1/gmp/{ipoId}/history
  Query Parameters:
    - days: number (default 7)
    - interval: hourly | daily | all
  Returns: Historical GMP data

GET /api/v1/gmp/{ipoId}/trend
  Returns: GMP trend analysis and chart data

GET /api/v1/gmp/{ipoId}/prediction
  Returns: ML-based GMP and listing predictions

GET /api/v1/gmp/market
  Returns: Overall market GMP trends

GET /api/v1/gmp/compare
  Query Parameters:
    - ipoIds: comma-separated IPO IDs
  Returns: Comparative GMP analysis

POST /api/v1/gmp/{ipoId}/alert
  Body: {
    threshold: number,
    type: 'above' | 'below',
    userId: string
  }
  Returns: Alert configuration

WebSocket /ws/gmp
  Events:
    - subscribe: {ipoId: string}
    - update: {ipoId: string, gmp: GMPData}
    - alert: {ipoId: string, alert: GMPAlert}
```

### 3.6 UI Components

```typescript
// GMP Display Widget
interface GMPWidgetProps {
  ipoId: string;
  view: 'compact' | 'detailed' | 'chart';
  showPrediction: boolean;
  showKostak: boolean;
  autoRefresh: boolean;
  refreshInterval: number;
}

// GMP Trend Chart
interface GMPChartProps {
  data: GMPData;
  timeRange: '1d' | '3d' | '7d' | 'all';
  chartType: 'line' | 'candlestick' | 'area';
  showEvents: boolean;
  showPrediction: boolean;
  interactive: boolean;
}

// GMP Calculator
interface GMPCalculatorProps {
  ipo: IPO;
  currentGMP: number;
  onChange: (value: number) => void;
  showReturns: boolean;
  showComparison: boolean;
}

// GMP Alerts Manager
interface GMPAlertsProps {
  ipoId: string;
  currentAlerts: GMPAlert[];
  onAddAlert: (alert: GMPAlert) => void;
  onRemoveAlert: (alertId: string) => void;
}
```

### 3.7 Features & Functionality

1. **Real-time Tracking**
   - Multi-source data aggregation
   - Confidence scoring
   - Anomaly detection
   - Auto-refresh with indicators

2. **Historical Analysis**
   - Trend charts with annotations
   - Volatility analysis
   - Support/resistance levels
   - Pattern recognition

3. **Predictive Features**
   - ML-based listing prediction
   - Confidence intervals
   - Success probability
   - Risk assessment

4. **Calculators**
   - Expected returns calculator
   - Lot-wise profit calculator
   - Break-even analysis
   - Application strategy optimizer

5. **Market Intelligence**
   - Sector-wise GMP comparison
   - Market sentiment indicator
   - Dealer confidence index
   - Volume indicators

---

## 4. Document Management System

### 4.1 Overview
Comprehensive system for managing, storing, and analyzing IPO-related documents including DRHP, RHP, and other regulatory filings.

### 4.2 Data Structure

```typescript
interface IPODocument {
  id: string;
  ipoId: string;
  type: DocumentType;

  // Document Metadata
  metadata: {
    title: string;
    fileName: string;
    fileSize: number;                   // in bytes
    fileType: 'pdf' | 'html' | 'doc';
    pages: number;
    language: string;
    version: string;
    status: 'draft' | 'final' | 'amended';
  };

  // Document Dates
  dates: {
    filingDate: Date;
    approvalDate?: Date;
    uploadedAt: Date;
    lastModified: Date;
    expiryDate?: Date;
  };

  // Storage Information
  storage: {
    provider: 'aws' | 'gcp' | 'azure' | 'local';
    bucket: string;
    path: string;
    url: string;
    cdnUrl?: string;
    backupUrl?: string;
    checksums: {
      md5: string;
      sha256: string;
    };
  };

  // Document Sections
  sections: {
    riskFactors: DocumentSection;
    businessOverview: DocumentSection;
    financialStatements: DocumentSection;
    managementDiscussion: DocumentSection;
    corporateStructure: DocumentSection;
    objectsOfIssue: DocumentSection;
    industryOverview: DocumentSection;
    regulations: DocumentSection;
    outstandingLitigation: DocumentSection;
    promotersBackground: DocumentSection;
  };

  // AI Analysis Results
  analysis: {
    summary: {
      executive: string;                // Executive summary
      risks: string[];                  // Key risks
      strengths: string[];              // Key strengths
      financialHighlights: string[];    // Financial highlights
    };
    scores: {
      readability: number;              // Document clarity score
      transparency: number;             // Disclosure quality
      riskLevel: number;                // Overall risk score
      financialHealth: number;          // Financial strength
    };
    keywords: string[];                 // Extracted keywords
    entities: {                        // Named entities
      people: string[];
      organizations: string[];
      locations: string[];
      amounts: string[];
      dates: string[];
    };
    sentiment: {
      overall: 'positive' | 'neutral' | 'negative';
      sections: Record<string, string>;
    };
  };

  // Search Index
  searchIndex: {
    fullText: string;                   // Full searchable text
    headings: string[];                 // All headings
    tables: TableData[];                // Extracted tables
    charts: ChartData[];                // Extracted charts
    footnotes: string[];                // All footnotes
  };

  // User Interaction
  interaction: {
    views: number;
    downloads: number;
    shares: number;
    avgTimeSpent: number;               // in seconds
    highlights: UserHighlight[];        // User highlights
    notes: UserNote[];                  // User notes
    bookmarks: Bookmark[];
  };
}

enum DocumentType {
  DRHP = 'Draft Red Herring Prospectus',
  RHP = 'Red Herring Prospectus',
  PROSPECTUS = 'Prospectus',
  ABRIDGED_PROSPECTUS = 'Abridged Prospectus',
  LOF = 'Letter of Offer',
  CORRIGENDUM = 'Corrigendum',
  ADDENDUM = 'Addendum',
  POST_ISSUE_REPORT = 'Post Issue Report',
  BASIS_OF_ALLOTMENT = 'Basis of Allotment',
  OTHER = 'Other Document'
}

interface DocumentSection {
  title: string;
  pageStart: number;
  pageEnd: number;
  content: string;                      // Extracted text
  summary: string;                      // AI-generated summary
  keyPoints: string[];                  // Key points
  tables?: ExtractedTable[];
  charts?: ExtractedChart[];
}
```

### 4.3 Document Processing Pipeline

```python
# Document Processing Service
class DocumentProcessor:
    def __init__(self):
        self.ocr_engine = OCREngine()
        self.nlp_processor = NLPProcessor()
        self.ai_analyzer = DocumentAnalyzer()
        self.storage_service = StorageService()

    async def process_document(self, file_path: str, ipo_id: str):
        """Process IPO document through complete pipeline"""

        # 1. Upload to storage
        storage_info = await self.storage_service.upload(file_path)

        # 2. Extract text and structure
        extracted = await self.extract_content(file_path)

        # 3. Parse document structure
        sections = await self.parse_sections(extracted.text)

        # 4. Perform NLP analysis
        nlp_results = await self.nlp_processor.analyze(
            text=extracted.text,
            sections=sections
        )

        # 5. AI analysis using Grok
        ai_analysis = await self.ai_analyzer.analyze_document(
            text=extracted.text,
            sections=sections,
            metadata=metadata
        )

        # 6. Extract tables and charts
        tables = await self.extract_tables(file_path)
        charts = await self.extract_charts(file_path)

        # 7. Generate searchable index
        search_index = await self.create_search_index(
            text=extracted.text,
            tables=tables,
            sections=sections
        )

        # 8. Create document record
        document = {
            'ipoId': ipo_id,
            'metadata': metadata,
            'storage': storage_info,
            'sections': sections,
            'analysis': ai_analysis,
            'searchIndex': search_index,
            'tables': tables,
            'charts': charts
        }

        # 9. Save to database
        await self.db.save_document(document)

        # 10. Update search engine
        await self.search_engine.index_document(document)

        return document

    async def extract_content(self, file_path: str):
        """Extract text and metadata from document"""

        if file_path.endswith('.pdf'):
            # Use OCR for scanned PDFs
            text = await self.ocr_engine.extract_from_pdf(file_path)

            # Extract metadata
            metadata = PyPDF2.PdfFileReader(file_path).getDocumentInfo()

        elif file_path.endswith('.html'):
            # Parse HTML documents
            soup = BeautifulSoup(open(file_path), 'html.parser')
            text = soup.get_text()
            metadata = self.extract_html_metadata(soup)

        return {
            'text': text,
            'metadata': metadata
        }
```

### 4.4 API Endpoints

```yaml
# Document Management Endpoints
GET /api/v1/documents/{ipoId}
  Returns: List of all documents for an IPO

GET /api/v1/documents/{ipoId}/{documentId}
  Returns: Document metadata and analysis

GET /api/v1/documents/{ipoId}/{documentId}/download
  Returns: Document file (redirect to CDN)

GET /api/v1/documents/{ipoId}/{documentId}/section/{sectionName}
  Returns: Specific section content and analysis

POST /api/v1/documents/search
  Body: {
    query: string,
    ipoIds?: string[],
    documentTypes?: DocumentType[],
    sections?: string[]
  }
  Returns: Search results with highlights

GET /api/v1/documents/{ipoId}/{documentId}/summary
  Query Parameters:
    - type: executive | financial | risk | all
  Returns: AI-generated summaries

POST /api/v1/documents/{ipoId}/compare
  Body: {
    documentIds: string[],
    sections: string[]
  }
  Returns: Comparative analysis

POST /api/v1/documents/{ipoId}/{documentId}/highlight
  Body: {
    pageNumber: number,
    text: string,
    color: string,
    note?: string
  }
  Returns: Saved highlight

GET /api/v1/documents/{ipoId}/{documentId}/analytics
  Returns: Document interaction analytics
```

### 4.5 UI Components

```typescript
// Document Viewer
interface DocumentViewerProps {
  document: IPODocument;
  view: 'pdf' | 'text' | 'summary';
  enableHighlight: boolean;
  enableNotes: boolean;
  enableSearch: boolean;
  onHighlight: (highlight: UserHighlight) => void;
  onNote: (note: UserNote) => void;
}

// Document List
interface DocumentListProps {
  ipoId: string;
  documents: IPODocument[];
  view: 'grid' | 'list';
  onSelect: (document: IPODocument) => void;
  onDownload: (document: IPODocument) => void;
}

// Document Summary Card
interface DocumentSummaryProps {
  document: IPODocument;
  summaryType: 'executive' | 'financial' | 'risk';
  showAnalytics: boolean;
  showActions: boolean;
}

// Document Search
interface DocumentSearchProps {
  onSearch: (query: string, filters: SearchFilters) => void;
  searchResults: SearchResult[];
  loading: boolean;
}

// Document Comparison
interface DocumentComparisonProps {
  documents: IPODocument[];
  sections: string[];
  highlightDifferences: boolean;
  view: 'side-by-side' | 'unified';
}
```

### 4.6 Features & Functionality

1. **Document Processing**
   - Automatic OCR for scanned PDFs
   - Structure extraction
   - Table and chart extraction
   - Multi-language support

2. **AI-Powered Analysis**
   - Executive summaries
   - Risk assessment
   - Financial highlights
   - Sentiment analysis
   - Key entity extraction

3. **Smart Search**
   - Full-text search
   - Section-specific search
   - Semantic search using AI
   - Search within tables
   - Highlight search results

4. **Document Viewer**
   - Native PDF rendering
   - Text highlighting
   - Note-taking
   - Bookmarking
   - Section navigation
   - Table of contents

5. **Comparative Analysis**
   - Side-by-side comparison
   - Difference highlighting
   - Section comparison
   - Financial comparison
   - Timeline comparison

---

## 5. Allotment Checker System

### 5.1 Overview
Automated system for checking IPO allotment status across multiple registrars with support for various verification methods.

### 5.2 Data Structure

```typescript
interface AllotmentData {
  ipoId: string;
  applicantDetails: {
    name: string;
    panNumber: string;
    applicationNumber: string;
    dpId?: string;
    clientId?: string;
    bid?: {
      category: 'Retail' | 'HNI' | 'QIB' | 'Employee';
      quantity: number;
      price: number;
      amount: number;
      applicationDate: Date;
    };
  };

  // Allotment Result
  allotmentResult: {
    status: 'Allotted' | 'Not Allotted' | 'Partially Allotted' | 'Pending';
    sharesAllotted: number;
    amountBlocked: number;
    amountRefundable: number;
    allotmentDate: Date;
    allotmentPrice: number;

    // Category-wise details
    categoryDetails: {
      totalApplications: number;
      validApplications: number;
      sharesApplied: number;
      sharesAvailable: number;
      allotmentRatio: string;           // e.g., "1:5"
      probabilityOfAllotment: number;   // percentage
    };
  };

  // Refund Information
  refundDetails: {
    status: 'Initiated' | 'Processing' | 'Completed' | 'Failed';
    amount: number;
    initiatedDate?: Date;
    expectedDate?: Date;
    completedDate?: Date;
    mode: 'ASBA' | 'UPI' | 'Bank Transfer';
    referenceNumber?: string;
  };

  // Share Credit Information
  shareCredit: {
    status: 'Pending' | 'In Process' | 'Credited';
    quantity: number;
    creditDate?: Date;
    depository: 'CDSL' | 'NSDL';
    dpId: string;
    clientId: string;
    isin: string;
  };

  // Listing Information
  listingDetails: {
    listingDate: Date;
    listingPrice?: number;
    openingPrice?: number;
    currentPrice?: number;
    gain?: number;
    gainPercentage?: number;
    volume?: number;
  };

  // Query Metadata
  queryInfo: {
    queriedAt: Date;
    registrar: string;
    method: 'PAN' | 'Application' | 'DP_Client' | 'ASBA';
    responseTime: number;               // in ms
    success: boolean;
    errorMessage?: string;
  };
}

interface BasisOfAllotment {
  ipoId: string;
  publishedDate: Date;
  registrar: string;

  categories: Array<{
    name: string;
    subscriptionMultiple: number;
    totalApplicants: number;
    totalSharesApplied: number;
    totalSharesAvailable: number;

    allotmentPattern: Array<{
      sharesApplied: number;
      applicants: number;
      ratio: string;
      sharesAllotted: number;
      percentageOfApplicants: number;
    }>;

    drawOfLots: boolean;
    minimumAllotment: number;
  }>;

  statistics: {
    totalApplications: number;
    totalValidApplications: number;
    totalSharesAllotted: number;
    totalApplicantsAllotted: number;
    successRate: number;
  };
}
```

### 5.3 Registrar Integration

```yaml
Registrar APIs:
  Link Intime:
    - Base URL: https://linkintime.co.in/IPO/
    - Methods: PAN, Application Number, DP ID
    - Authentication: None (public)
    - Rate Limit: 100/minute

  KFintech (Karvy):
    - Base URL: https://ipo.kfintech.com/
    - Methods: PAN, Application, ASBA Account
    - Authentication: None (public)
    - Rate Limit: 100/minute

  Bigshare Services:
    - Base URL: https://ipo.bigshareonline.com/
    - Methods: PAN, Application Number
    - Authentication: None (public)
    - Rate Limit: 50/minute

  Skyline Financial:
    - Base URL: https://www.skylinerta.com/
    - Methods: PAN, DP ID + Client ID
    - Authentication: None (public)
    - Rate Limit: 50/minute

Integration Strategy:
  - Automatic registrar detection based on IPO
  - Parallel checking across methods
  - Fallback mechanisms
  - Result caching (15 minutes)
  - Rate limiting and retry logic
```

### 5.4 Allotment Checking Service

```python
# Allotment Checker Service
class AllotmentChecker:
    def __init__(self):
        self.registrars = {
            'linkintime': LinkIntimeAPI(),
            'kfintech': KFintechAPI(),
            'bigshare': BigshareAPI(),
            'skyline': SkylineAPI()
        }
        self.cache = RedisCache(ttl=900)  # 15 min cache

    async def check_allotment(
        self,
        ipo_id: str,
        pan: str = None,
        application_no: str = None,
        dp_client: str = None
    ):
        """Check allotment status using available identifiers"""

        # 1. Get IPO details and registrar
        ipo = await self.get_ipo_details(ipo_id)
        registrar = ipo.registrar.lower()

        # 2. Check cache
        cache_key = f"{ipo_id}:{pan or application_no or dp_client}"
        cached = await self.cache.get(cache_key)
        if cached:
            return cached

        # 3. Select appropriate API
        api = self.registrars.get(registrar)
        if not api:
            raise ValueError(f"Registrar {registrar} not supported")

        # 4. Try multiple methods
        result = None
        methods_tried = []

        # Try PAN first (most reliable)
        if pan:
            try:
                result = await api.check_by_pan(ipo_id, pan)
                methods_tried.append('PAN')
            except Exception as e:
                logger.error(f"PAN check failed: {e}")

        # Try Application Number
        if not result and application_no:
            try:
                result = await api.check_by_application(
                    ipo_id,
                    application_no
                )
                methods_tried.append('Application')
            except Exception as e:
                logger.error(f"Application check failed: {e}")

        # Try DP ID + Client ID
        if not result and dp_client:
            try:
                dp_id, client_id = dp_client.split('-')
                result = await api.check_by_dp(
                    ipo_id,
                    dp_id,
                    client_id
                )
                methods_tried.append('DP_Client')
            except Exception as e:
                logger.error(f"DP check failed: {e}")

        # 5. Process and enhance result
        if result:
            # Add additional information
            result['listingDetails'] = await self.get_listing_info(ipo_id)
            result['categoryDetails'] = await self.get_category_stats(
                ipo_id,
                result.get('category')
            )

            # Calculate gains if listed
            if result['listingDetails'].get('listingPrice'):
                result['gains'] = self.calculate_gains(result)

            # Cache the result
            await self.cache.set(cache_key, result)

        # 6. Log query for analytics
        await self.log_query({
            'ipo_id': ipo_id,
            'methods_tried': methods_tried,
            'success': bool(result),
            'registrar': registrar
        })

        return result

    async def bulk_check(self, checks: List[Dict]):
        """Check multiple allotments in parallel"""

        tasks = []
        for check in checks:
            task = self.check_allotment(
                ipo_id=check['ipo_id'],
                pan=check.get('pan'),
                application_no=check.get('application_no'),
                dp_client=check.get('dp_client')
            )
            tasks.append(task)

        results = await asyncio.gather(*tasks, return_exceptions=True)

        return [
            result if not isinstance(result, Exception) else {
                'error': str(result),
                'ipo_id': checks[i]['ipo_id']
            }
            for i, result in enumerate(results)
        ]
```

### 5.5 API Endpoints

```yaml
# Allotment Checker Endpoints
POST /api/v1/allotment/check
  Body: {
    ipoId: string,
    pan?: string,
    applicationNumber?: string,
    dpId?: string,
    clientId?: string
  }
  Returns: AllotmentData

POST /api/v1/allotment/bulk
  Body: {
    checks: Array<{
      ipoId: string,
      pan?: string,
      applicationNumber?: string
    }>
  }
  Returns: Array<AllotmentData>

GET /api/v1/allotment/{ipoId}/basis
  Returns: Basis of allotment document

GET /api/v1/allotment/{ipoId}/statistics
  Returns: Category-wise allotment statistics

GET /api/v1/allotment/history
  Query Parameters:
    - pan: string
    - limit: number
  Returns: Historical allotment records

POST /api/v1/allotment/notify
  Body: {
    ipoId: string,
    pan: string,
    notifyVia: ['email' | 'sms' | 'push']
  }
  Returns: Notification setup confirmation

WebSocket /ws/allotment
  Events:
    - check: {ipoId, pan, applicationNumber}
    - result: {allotmentData}
    - basis_published: {ipoId, basisData}
```

### 5.6 UI Components

```typescript
// Allotment Checker Form
interface AllotmentCheckerProps {
  ipoId?: string;
  onCheck: (data: AllotmentQuery) => void;
  onResult: (result: AllotmentData) => void;
  loading: boolean;
  allowBulkCheck: boolean;
}

// Allotment Result Display
interface AllotmentResultProps {
  result: AllotmentData;
  showDetails: boolean;
  showGains: boolean;
  showRefundStatus: boolean;
  showShareCredit: boolean;
}

// Basis of Allotment Table
interface BasisOfAllotmentProps {
  basisData: BasisOfAllotment;
  highlightCategory?: string;
  interactive: boolean;
  showStatistics: boolean;
}

// Allotment History
interface AllotmentHistoryProps {
  pan: string;
  history: AllotmentData[];
  onSelect: (allotment: AllotmentData) => void;
}

// Allotment Calculator
interface AllotmentCalculatorProps {
  ipo: IPO;
  basisData: BasisOfAllotment;
  category: string;
  lotsApplied: number;
  onChange: (lots: number) => void;
}
```

### 5.7 Features & Functionality

1. **Multi-Method Checking**
   - PAN-based checking
   - Application number
   - DP ID + Client ID
   - ASBA account number
   - Auto-retry with fallback

2. **Bulk Operations**
   - Check multiple IPOs
   - Multiple applicants
   - Family portfolio check
   - Export results

3. **Real-time Updates**
   - Live status checking
   - Push notifications
   - Email/SMS alerts
   - WebSocket updates

4. **Analytics & Insights**
   - Success rate tracking
   - Category-wise analysis
   - Historical performance
   - Allotment patterns

5. **User Features**
   - Save credentials securely
   - Quick check for saved PANs
   - Allotment history
   - Share results
   - Download certificates

---

## Implementation Priority & Timeline

### Phase 1: Foundation (Month 1-2)
1. **IPO Information Module** - Core data structure and display
2. **Basic API Integration** - NSE/BSE data feeds
3. **Database Schema** - PostgreSQL setup
4. **Basic UI** - List/Grid views

### Phase 2: Real-time Features (Month 2-3)
1. **Live Subscription Tracking** - WebSocket implementation
2. **GMP System** - Basic tracking
3. **Search & Filters** - Advanced filtering

### Phase 3: Documents & Allotment (Month 3-4)
1. **Document Management** - Upload and display
2. **Allotment Checker** - Basic checking
3. **User Accounts** - Registration/Login

### Phase 4: Analytics & Polish (Month 4-5)
1. **AI Integration** - Document analysis
2. **Predictive Features** - ML models
3. **Mobile Apps** - React Native
4. **Performance Optimization**

## Technical Architecture

### Backend Stack
```yaml
Core:
  - Node.js + TypeScript
  - Express.js / Fastify
  - PostgreSQL (primary)
  - Redis (cache + pub/sub)

Real-time:
  - Socket.io / Native WebSocket
  - Redis Pub/Sub
  - BullMQ (job queues)

Data Collection:
  - Python scrapers
  - Puppeteer/Playwright
  - Cheerio for parsing

AI/ML:
  - Grok API
  - TensorFlow.js
  - Python ML services
```

### Frontend Stack
```yaml
Web:
  - Next.js 14 (App Router)
  - TypeScript
  - Tailwind CSS
  - Shadcn/ui components
  - Recharts/D3.js

Mobile:
  - React Native
  - Expo (optional)
  - Native Base UI

State Management:
  - Zustand / Redux Toolkit
  - React Query / SWR
  - WebSocket hooks
```

### Infrastructure
```yaml
Deployment:
  - AWS/GCP/Azure
  - Kubernetes / Docker
  - CI/CD with GitHub Actions

CDN & Storage:
  - CloudFront/Cloudflare
  - S3 for documents
  - Image optimization

Monitoring:
  - New Relic / DataDog
  - Sentry for errors
  - Analytics with GA4
```

## Success Metrics

1. **Performance**
   - Page load < 2 seconds
   - Real-time updates < 500ms latency
   - 99.9% uptime

2. **Data Quality**
   - GMP accuracy > 90%
   - Subscription data delay < 5 minutes
   - Document processing < 30 seconds

3. **User Engagement**
   - Daily active users
   - Features per session
   - Return rate > 60%

4. **Business Metrics**
   - User acquisition cost
   - Conversion to broker accounts
   - Revenue per user

---

*This detailed specification provides the foundation for building IPODhan's core features with a focus on reliability, scalability, and superior user experience.*