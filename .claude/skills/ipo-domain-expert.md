# IPO Domain Expert

**Purpose:** This skill provides comprehensive knowledge of the Indian IPO (Initial Public Offering) market, including terminology, regulations, processes, and financial metrics specific to IPO investing in India.

**When to invoke:** Use this skill when working on IPO data models, user-facing content, financial calculations, scraping IPO information, or implementing IPO scoring algorithms.

---

## Core IPO Terminology

### IPO Lifecycle Stages

Indian IPOs go through several distinct stages, each with specific characteristics:

1. **UPCOMING** (Filed with SEBI)
   - Company has filed DRHP (Draft Red Herring Prospectus) with SEBI
   - Price band not yet announced
   - Open/close dates tentative or not announced
   - Status may remain for weeks/months pending SEBI approval

2. **OPEN** (Bidding Period Active)
   - IPO is accepting bids from investors
   - Typically 3 business days (can be extended)
   - Price band is finalized
   - Real-time subscription data available
   - Most critical period for data updates (refresh every 3 minutes)

3. **CLOSED** (Subscription Closed, Pre-Listing)
   - Bidding period ended
   - Awaiting basis of allotment
   - Final subscription numbers available
   - GMP (Grey Market Premium) actively traded
   - Allotment date and listing date announced

4. **LISTED** (Trading Commenced)
   - Shares listed on NSE/BSE
   - Listing gains/losses calculated
   - Historical data for analysis
   - Regular price updates from exchange

### IPO Categories & Types

**Primary Categories:**

1. **MAINBOARD IPOs**
   - Listed on main NSE/BSE exchanges
   - Larger companies with established track record
   - Higher minimum issue size (₹10 crore+)
   - Stricter SEBI regulations
   - Three-year track record typically required

2. **SME IPOs** (Small and Medium Enterprises)
   - Listed on NSE SME or BSE SME platforms
   - Smaller companies, growth stage
   - Lower minimum issue size (₹3-10 crore)
   - Relaxed listing requirements
   - Higher risk, potentially higher returns
   - Limited trading (fewer buyers/sellers)

**Other Offering Types:**

3. **RIGHTS ISSUES**
   - Existing shareholders get right to buy additional shares
   - Below market price typically
   - Not a pure IPO (existing company)
   - In IPODhan: `segment` field is `null`, check `offeringType = 'RIGHTS'`

4. **FPO** (Follow-on Public Offering)
   - Already listed company raises more capital
   - Similar to IPO but company is known quantity
   - `segment = null`, `offeringType = 'FPO'`

5. **InvITs** (Infrastructure Investment Trusts)
   - Investment vehicles for infrastructure assets
   - Toll roads, power transmission, etc.
   - Regular dividend payouts
   - `segment = null`, `offeringType = 'InvIT'`

6. **REITs** (Real Estate Investment Trusts)
   - Investment in commercial real estate
   - Malls, offices, warehouses
   - Rental income distribution
   - `segment = null`, `offeringType = 'REIT'`

---

## Subscription Categories

Indian IPOs have quota-based allocation across different investor types:

### 1. **QIB** (Qualified Institutional Buyers)
- **Quota:** 50% of issue size (can be up to 60% for certain issues)
- **Who:** Mutual funds, insurance companies, FIIs, banks
- **Significance:** Quality indicator - high QIB subscription suggests institutional confidence
- **Minimum investment:** ₹2 lakh minimum
- **Allotment:** Proportional basis (pro-rata)
- **IPO Scoring Weight:** High (QIB subscription >1x is strong positive signal)

### 2. **NII/HNI** (Non-Institutional Investors / High Net Worth Individuals)
- **Quota:** 15% of issue size
- **Who:** Individuals, HUFs investing >₹2 lakh
- **Significance:** Shows HNI interest and appetite
- **Allotment:** Proportional basis
- **Oversubscription:** Often 50x-100x in hot IPOs
- **IPO Scoring Weight:** Medium

### 3. **Retail** (Retail Individual Investors - RII)
- **Quota:** 35% of issue size (can be up to 45%)
- **Who:** Individual investors investing <₹2 lakh
- **Significance:** Mass market appeal indicator
- **Minimum:** 1 lot (varies by IPO)
- **Maximum:** ₹2 lakh
- **Allotment:** Lottery basis if oversubscribed
- **IPO Scoring Weight:** Medium (retail oversubscription shows mass appeal)

### 4. **Anchor Investors**
- **Quota:** Up to 60% of QIB portion (30% of total issue)
- **Who:** Large institutional investors
- **Timing:** 1 day before IPO opens to public
- **Lock-in:** 30 days minimum
- **Price:** At or above price band floor
- **Significance:** Pre-IPO validation, strong anchor book = positive signal

### 5. **Employee Quota**
- **Quota:** Varies (typically small, e.g., ₹5-10 crore)
- **Who:** Company employees
- **Discount:** Often 5-10% discount to issue price
- **Significance:** Shows company confidence

---

## Key Financial Metrics

### 1. **GMP** (Grey Market Premium)
- **Definition:** Unofficial premium at which IPO shares trade before listing
- **Example:** Issue price ₹100, GMP ₹50 → Expected listing price ₹150
- **Calculation:** `GMP Premium % = (GMP / Issue Price) * 100`
- **Sources:** Chittorgarh, Investorgain (unofficial dealers)
- **Reliability:** 60-70% accurate, not guaranteed
- **IPO Scoring:** GMP >30% = strong positive, GMP <0% = avoid
- **Database:** `gmpRecords` table with time-series data

### 2. **Lot Size**
- **Definition:** Minimum number of shares that must be applied for
- **Purpose:** Ensures retail investors can participate
- **Calculation:** Lot size × Issue price ≈ ₹10,000-15,000 typically
- **Example:** Issue price ₹500 → Lot size = 30 shares
- **Database Field:** `lotSize` in `ipos` table
- **Data Quality:** CRITICAL - lot size errors impact application calculations

### 3. **Subscription Ratio**
- **Definition:** Total applications received vs. shares available
- **Format:** Expressed as "times" (e.g., 10x oversubscribed)
- **Calculation:** `(Total Bid Quantity / Total Shares Available)`
- **Example:** 100 cr shares available, 1000 cr bids = 10x subscription
- **Category-wise:** QIB 5x, NII 50x, Retail 3x = Overall ~10x
- **IPO Scoring:** >10x overall = strong demand, <1x = under-subscribed (red flag)
- **Database:** `subscriptions` table with category-wise breakdown

### 4. **Price Band**
- **Definition:** Minimum and maximum price at which IPO is offered
- **Format:** Floor price to Cap price (e.g., ₹90-₹95)
- **Flexibility:** SEBI allows 20% band
- **Common Pattern:** Most IPOs price at upper band (cap price)
- **Database Fields:** `priceRangeLow`, `priceRangeHigh` in `ipos` table

### 5. **Issue Size**
- **Definition:** Total capital being raised
- **Calculation:** `Issue Size = Number of Shares × Issue Price`
- **Categories:**
  - Small cap: <₹100 crore
  - Mid cap: ₹100-500 crore
  - Large cap: >₹500 crore
- **Database Field:** `issueSize` in `ipos` table

### 6. **P/E Ratio** (Price-to-Earnings)
- **Definition:** Share price relative to earnings per share
- **Calculation:** `P/E = Issue Price / EPS`
- **Comparison:** Compare with industry average P/E
- **Interpretation:**
  - P/E < Industry average = undervalued
  - P/E > Industry average = premium pricing
  - Very high P/E (>50) = growth stock or overvalued
- **IPO Scoring:** P/E significantly below industry = positive signal

### 7. **Market Cap**
- **Definition:** Total value of company post-IPO
- **Calculation:** `Market Cap = Total Shares Outstanding × Issue Price`
- **Database Field:** `marketCap` in `financialData` table

### 8. **Listing Gains/Losses**
- **Definition:** % change from issue price to listing day close price
- **Calculation:** `((Listing Price - Issue Price) / Issue Price) × 100`
- **Example:** Issue ₹100, Listed ₹125 → +25% listing gain
- **Average:** Historical average is 10-20% for good IPOs
- **Database:** `listingPerformance` table with `listingGainLoss` field

---

## Valuation & Financial Analysis

### Revenue & Profitability Metrics

1. **Revenue Growth**
   - **Formula:** `((Current Year Revenue - Previous Year Revenue) / Previous Year Revenue) × 100`
   - **Good:** >20% YoY growth
   - **Average:** 10-20% growth
   - **Red Flag:** Negative or <5% growth

2. **Profit Margin**
   - **Formula:** `(Net Profit / Revenue) × 100`
   - **Healthy:** >10% for most industries
   - **Software/Tech:** 15-25% expected
   - **Manufacturing:** 5-15% typical

3. **ROE** (Return on Equity)
   - **Formula:** `(Net Profit / Shareholders' Equity) × 100`
   - **Excellent:** >20%
   - **Good:** 15-20%
   - **Average:** 10-15%
   - **Poor:** <10%

4. **Debt-to-Equity Ratio**
   - **Formula:** `Total Debt / Shareholders' Equity`
   - **Low Risk:** <0.5
   - **Moderate:** 0.5-1.0
   - **High Risk:** >1.0
   - **Red Flag:** >2.0

### IPO Scoring Components (Real-time Algorithm)

IPODhan uses a 5-component scoring methodology (0-10 scale):

1. **Financial Strength (3 points)**
   - Revenue growth (1 pt): >20% = 1.0, 10-20% = 0.5, <10% = 0
   - Profitability (1 pt): Profit margin >10% = 1.0, 5-10% = 0.5, <5% = 0
   - ROE (1 pt): >20% = 1.0, 15-20% = 0.7, 10-15% = 0.4, <10% = 0

2. **Valuation (2 points)**
   - P/E vs Industry (1 pt): <Industry = 1.0, Within 10% = 0.7, >10% = 0.4
   - Price-to-Book (1 pt): <3 = 1.0, 3-5 = 0.7, >5 = 0.4

3. **Subscription Demand (2 points)**
   - Overall subscription (1 pt): >10x = 1.0, 5-10x = 0.7, 1-5x = 0.4, <1x = 0
   - QIB subscription (1 pt): >5x = 1.0, 2-5x = 0.7, 1-2x = 0.4, <1x = 0

4. **Market Performance (2 points)**
   - GMP premium (1 pt): >30% = 1.0, 15-30% = 0.7, 0-15% = 0.4, <0% = 0
   - Listing gains (1 pt): >20% = 1.0, 10-20% = 0.7, 0-10% = 0.4, <0% = 0

5. **Company Fundamentals (1 point)**
   - Issue size (0.5 pt): >₹500 cr = 0.5, ₹100-500 cr = 0.3, <₹100 cr = 0.1
   - Company age (0.5 pt): >10 years = 0.5, 5-10 years = 0.3, <5 years = 0.1

**Rating Scale:**
- 9.0-10.0: Exceptional (Invest) ⭐⭐⭐⭐⭐
- 7.5-8.9: Strong (Consider) ⭐⭐⭐⭐
- 6.0-7.4: Good (Moderate) ⭐⭐⭐
- 4.5-5.9: Average (Neutral) ⭐⭐
- 3.0-4.4: Below Average (Caution) ⭐
- 0.0-2.9: Poor (Avoid)

**Confidence Score:** Calculated based on data completeness (0-100%)

---

## SEBI Regulations & Documentation

### Key Documents

1. **DRHP** (Draft Red Herring Prospectus)
   - First public document filed with SEBI
   - Contains business details, financials, risk factors
   - Subject to SEBI review and modifications
   - Most reliable source for financial data
   - Database: `documents` table with `documentType = 'DRHP'`

2. **RHP** (Red Herring Prospectus)
   - Final prospectus after SEBI approval
   - Price band added (not in DRHP)
   - Basis for IPO launch
   - Database: `documents` table with `documentType = 'RHP'`

3. **Prospectus**
   - Final document with exact issue price
   - Published after price finalization
   - Database: `documents` table with `documentType = 'PROSPECTUS'`

4. **Basis of Allotment**
   - Details of share allocation
   - Published 7-10 days after IPO close
   - Shows who got how many shares
   - Database: `documents` table with `documentType = 'BASIS_OF_ALLOTMENT'`

### SEBI Requirements

- **Track Record:** 3 years of audited financials (can be relaxed for tech/research companies)
- **Minimum Issue Size:** ₹10 crore for Mainboard, ₹3 crore for SME
- **Minimum Public Shareholding:** 25% post-IPO
- **Lock-in Period:**
  - Promoter shares: 3 years (for companies <3 years old)
  - Anchor investors: 30 days
  - Pre-IPO investors: 1 year typically

---

## Registrars & Allotment Process

### Major Registrars in India

1. **Link Intime India**
2. **KFin Technologies** (formerly Karvy)
3. **NSDL (National Securities Depository Limited)**
4. **CDSL (Central Depository Services Limited)**
5. **Bigshare Services**

**Database:** `registrars` table with contact details, website, etc.

### Allotment Process

1. **Application** (Day 1-3 of IPO)
   - Apply through UPI/ASBA
   - Amount blocked in bank account

2. **Basis of Allotment** (T+6 days typically)
   - Registrar publishes allotment results
   - Check on registrar website or NSE/BSE

3. **Refund Initiation** (T+7 days)
   - Non-allotted funds unblocked
   - Partial allotment = partial refund

4. **Credit to Demat** (T+8 days)
   - Allotted shares credited to demat account

5. **Listing** (T+10 days typically)
   - Shares start trading on exchange

### UPI Mandate System

- **Max Amount:** ₹5 lakh per application via UPI
- **Above ₹5 lakh:** ASBA (Application Supported by Blocked Amount)
- **UPI Handle:** 6 major apps (Google Pay, PhonePe, Paytm, BHIM, etc.)
- **Blocking:** Amount blocked till allotment
- **Auto-debit:** Only allotted amount debited

---

## Data Source Priorities

When multiple sources provide conflicting data, use this priority order:

1. **ADMIN** - Manual edits (highest priority, verified by team)
2. **DRHP** - Official prospectus documents (most authoritative for financials)
3. **NSE** - Primary exchange data (real-time subscription, official dates)
4. **BSE** - Secondary exchange data (backup to NSE)
5. **Moneycontrol** - Financial news site (good for upcoming IPOs)
6. **Chittorgarh** - GMP specialist (best for grey market data)
7. **API_FALLBACK** - Backup scraping service

**Database Field:** `dataSource` in `ipos` table

---

## Common IPO Patterns & Rules

### Pricing Patterns

- **90%+ IPOs price at upper band** (cap price) - shows high demand
- **Pricing at floor price** is rare, indicates weak demand
- **Discount offerings** (below band) are very rare, major red flag

### Subscription Patterns

- **Day 1:** Usually slow, 0.1x-0.5x
- **Day 2:** Picks up, 1x-3x if good response
- **Day 3:** Final rush, 5x-50x depending on demand
- **QIB subscription on Day 3** is critical indicator

### Listing Day Patterns

- **Strong GMP + High subscription** → Usually positive listing
- **Weak GMP + Low subscription** → Risk of listing loss
- **Market conditions matter** → Bull market = better listings
- **First hour volatility** → Wait 15-30 min for price stabilization

### Red Flags

- Under-subscription (<1x) in any category
- QIB subscription <1x (institutions avoiding)
- Negative or very low GMP
- Very high P/E vs industry (>2x industry average)
- Frequent DRHP amendments (regulatory issues)
- Small promoter stake post-IPO (<40%)
- High debt-to-equity ratio (>2.0)
- Negative cash flow from operations

---

## Database Schema Mapping

### Primary Table: `ipos`
- `segment`: 'MAINBOARD' | 'SME' | null (null for RIGHTS/InvIT/REIT)
- `offeringType`: 'IPO' | 'RIGHTS' | 'FPO' | 'InvIT' | 'REIT'
- `status`: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED'
- `lotSize`: Critical field for retail calculations
- `priceRangeLow`, `priceRangeHigh`: Price band
- `issueSize`: Total capital raised

### Related Tables
- `subscriptions`: Time-series subscription data (QIB, NII, Retail)
- `gmpRecords`: Historical GMP tracking
- `financialData`: Financial metrics, ratios, valuations
- `documents`: DRHP, RHP, Prospectus PDFs
- `listingPerformance`: Listing day data, gains/losses
- `peerCompanies`: Industry comparisons
- `registrars`: Registrar contact information

---

## Practical Examples

### Example 1: Calculating IPO Score

```typescript
// For an OPEN IPO with real-time data
const ipoScore = {
  financial: {
    revenueGrowth: 25, // 25% YoY → 1.0 point
    profitMargin: 12,  // 12% → 1.0 point
    roe: 18,           // 18% → 0.7 point
    total: 2.7
  },
  valuation: {
    peRatio: 25,       // vs Industry 30 → 1.0 point
    priceToBook: 4,    // → 0.7 point
    total: 1.7
  },
  subscription: {
    overall: 15,       // 15x → 1.0 point
    qib: 6,            // 6x → 1.0 point
    total: 2.0
  },
  market: {
    gmp: 35,           // 35% → 1.0 point
    listing: null,     // Not yet listed → 0 point
    total: 1.0
  },
  fundamentals: {
    issueSize: 300,    // ₹300 cr → 0.3 point
    companyAge: 8,     // 8 years → 0.3 point
    total: 0.6
  },
  finalScore: 8.0,     // Strong (Consider) ⭐⭐⭐⭐
  confidence: 85       // 85% data completeness
};
```

### Example 2: Subscription Status Display

```typescript
// UI display for subscription data
const subscriptionDisplay = {
  qib: { times: 5.2, shares: '52,000,000', available: '10,000,000' },
  nii: { times: 48.5, shares: '145,500,000', available: '3,000,000' },
  retail: { times: 3.8, shares: '133,000,000', available: '35,000,000' },
  overall: { times: 12.5, shares: '330,500,000', available: '48,000,000' }
};

// Status indicator
const status = subscriptionDisplay.overall.times >= 10 ? 'strong' :
               subscriptionDisplay.overall.times >= 5 ? 'good' :
               subscriptionDisplay.overall.times >= 1 ? 'moderate' : 'weak';
```

---

## References

- **NSE IPOs:** https://www.nseindia.com/market-data/ipo-current-issues
- **BSE IPOs:** https://www.bseindia.com/corporates/Forth_Coming.aspx
- **SEBI Regulations:** https://www.sebi.gov.in/
- **Chittorgarh GMP:** https://www.chittorgarh.com/ipo/ipo_grey_market_premium.asp
- **Moneycontrol IPOs:** https://www.moneycontrol.com/ipo/

---

**Note:** This domain knowledge is critical for building IPO-related features. Always validate financial calculations against authoritative sources (DRHP, official prospectus).
