# Data Models

## IPO Model

**Purpose:** Core entity representing an Initial Public Offering

**Key Attributes:**
- id: UUID - Unique identifier
- symbol: string - NSE/BSE trading symbol
- companyName: string - Full company name
- issueSize: number - Total issue size in crores
- priceBandLow: number - Lower price band
- priceBandHigh: number - Upper price band
- lotSize: number - Minimum lot size
- openDate: Date - IPO opening date
- closeDate: Date - IPO closing date
- listingDate: Date - Expected listing date
- status: enum - UPCOMING | LIVE | CLOSED | LISTED
- category: enum - MAINBOARD | SME

### TypeScript Interface
```typescript
interface IPO {
  id: string;
  symbol: string;
  companyName: string;
  issueSize: number;
  priceBand: {
    low: number;
    high: number;
  };
  lotSize: number;
  dates: {
    open: Date;
    close: Date;
    listing: Date;
  };
  status: 'UPCOMING' | 'LIVE' | 'CLOSED' | 'LISTED';
  category: 'MAINBOARD' | 'SME';
  createdAt: Date;
  updatedAt: Date;
}
```

### Relationships
- Has many IPOScores
- Has many GMPHistory records
- Has many SubscriptionData records
- Has many UserWatchlist entries

## IPOScore Model

**Purpose:** Calculated intelligence score for IPO investment decision

**Key Attributes:**
- id: UUID - Unique identifier
- ipoId: UUID - Reference to IPO
- totalScore: number - Overall score (0-100)
- fundamentalScore: number - Company fundamentals (0-25)
- sentimentScore: number - Market sentiment (0-25)
- subscriptionScore: number - Subscription strength (0-25)
- sectorScore: number - Sector performance (0-25)
- verdict: enum - APPLY | CONSIDER | SKIP
- confidence: enum - HIGH | MEDIUM | LOW

### TypeScript Interface
```typescript
interface IPOScore {
  id: string;
  ipoId: string;
  totalScore: number;
  components: {
    fundamental: number;
    sentiment: number;
    subscription: number;
    sector: number;
  };
  verdict: 'APPLY' | 'CONSIDER' | 'SKIP';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning: string;
  calculatedAt: Date;
}
```

### Relationships
- Belongs to IPO
- Referenced by API responses
- Cached in Redis for performance

## User Model

**Purpose:** Registered users for personalization and premium features

**Key Attributes:**
- id: UUID - Unique identifier
- email: string - Primary email
- phone: string - WhatsApp number
- subscriptionTier: enum - FREE | BASIC | PREMIUM
- preferences: JSON - Notification preferences
- createdAt: Date - Registration date

### TypeScript Interface
```typescript
interface User {
  id: string;
  email?: string;
  phone: string;
  subscriptionTier: 'FREE' | 'BASIC' | 'PREMIUM';
  preferences: {
    notifications: {
      whatsapp: boolean;
      email: boolean;
      sms: boolean;
    };
    sectors: string[];
    riskProfile: 'CONSERVATIVE' | 'MODERATE' | 'AGGRESSIVE';
  };
  metadata: {
    source: string;
    referralCode?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

### Relationships
- Has many Watchlist entries
- Has many Notifications
- Has one Subscription

## GMPHistory Model

**Purpose:** Track Grey Market Premium trends over time

**Key Attributes:**
- id: UUID - Unique identifier
- ipoId: UUID - Reference to IPO
- gmpValue: number - Absolute GMP in rupees
- gmpPercentage: number - GMP as percentage
- source: string - Data source
- recordedAt: Date - Timestamp

### TypeScript Interface
```typescript
interface GMPHistory {
  id: string;
  ipoId: string;
  gmp: {
    absolute: number;
    percentage: number;
  };
  kostakRate?: number;
  source: 'IPOWATCH' | 'INVESTORGAIN' | 'CHITTORGARH';
  recordedAt: Date;
}
```

### Relationships
- Belongs to IPO
- Time-series data for trend analysis

## SubscriptionData Model

**Purpose:** Real-time IPO subscription status by category

**Key Attributes:**
- id: UUID - Unique identifier
- ipoId: UUID - Reference to IPO
- category: enum - QIB | NII | RETAIL | EMPLOYEE
- subscriptionTimes: number - Oversubscription multiplier
- sharesOffered: bigint - Total shares in category
- sharesBid: bigint - Total shares bid for

### TypeScript Interface
```typescript
interface SubscriptionData {
  id: string;
  ipoId: string;
  category: 'QIB' | 'NII' | 'RETAIL' | 'EMPLOYEE';
  subscription: {
    times: number;
    sharesOffered: bigint;
    sharesBid: bigint;
  };
  recordedAt: Date;
}
```

### Relationships
- Belongs to IPO
- Updated every 15 minutes during market hours
