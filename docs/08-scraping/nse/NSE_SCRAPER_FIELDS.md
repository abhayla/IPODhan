# NSE Scraper - All Fields Being Scraped

**Last Updated:** October 29, 2025
**Scraper Version:** NSE Orchestrator V2 with API-first approach
**Sources:** NSE API + Browser Fallback

---

## Overview

The NSE scraper extracts IPO data from two sources:
1. **NSE Hidden API** (Primary method - 95% success rate)
2. **Browser Automation** (Fallback method when API fails)

---

## 📊 IPO Data Fields (17 fields)

### ✅ Core Fields (Always Attempted)

| Field | Type | Source | Description | Example | Population Rate |
|-------|------|--------|-------------|---------|----------------|
| **companyName** | string | API/Browser | Full company name | "Lenskart Solutions Limited" | 100% |
| **slug** | string | Generated | URL-friendly identifier | "lenskart-solutions-limited" | 100% (auto-generated) |
| **symbol** | string | API/Browser | Stock ticker symbol | "LENSKART" | 100% |
| **status** | enum | API/Browser | IPO status | "UPCOMING", "OPEN", "CLOSED", "LISTED" | 100% |
| **openDate** | date | API/Browser | Subscription open date | "2025-10-30" | 100% |
| **closeDate** | date | API/Browser | Subscription close date | "2025-11-03" | 100% |
| **listingExchange** | string | API/Browser | Listing exchange | "NSE" (always) | 100% |
| **faceValue** | integer | API/Browser | Par value per share | 10 (default) | 100% |

### ⚠️ Partially Populated Fields

| Field | Type | Source | Description | Example | Population Rate |
|-------|------|--------|-------------|---------|----------------|
| **priceRangeMin** | integer | API/Browser | Minimum issue price (₹) | 382 | 36% (4/11) |
| **priceRangeMax** | integer | API/Browser | Maximum issue price (₹) | 402 | 36% (4/11) |
| **issueSize** | numeric | API/Browser | Issue size (₹ Crores) | 183865848.00 | 36% (4/11) |
| **lotSize** | integer | API/Browser | Minimum application size | 1000 | 9% (1/11 valid) |
| **listingDate** | date | API/Browser | Expected listing date | "2025-11-05" | Variable |
| **sector** | string | API | Industry sector | "Technology" | 0% (API doesn't provide) |

### ❌ Not Populated by NSE Scraper

| Field | Type | Reason | Alternative Source |
|-------|------|--------|-------------------|
| **segment** | enum | API doesn't provide for RIGHTS/alternative offerings | Detected from offering type |
| **offeringType** | enum | Detected from endpoint category | "IPO", "RIGHTS", "FPO", etc. |
| **isin** | string | Not in NSE API response | BSE scraper |
| **allotmentDate** | date | Not in NSE API response | BSE/Moneycontrol |
| **registrar** | string | Not in NSE API response | BSE/Moneycontrol |
| **leadManagers** | array | Not in NSE API response | RHP documents |
| **companyDescription** | text | Not in NSE API response | Company website/RHP |
| **rating** | integer | Not in NSE API response | Calculated internally |

---

## 📈 Subscription Data Fields (10 fields)

### ✅ Core Subscription Fields

| Field | Type | Source | Description | Example | Population |
|-------|------|--------|-------------|---------|-----------|
| **ipoCompanyName** | string | Linked from IPO | Company name | "Lenskart Solutions Limited" | 100% when available |
| **ipoSymbol** | string | Linked from IPO | Stock symbol | "LENSKART" | 100% when available |
| **qibSubscription** | numeric | API/Browser | QIB subscription (times) | 5.23 | When IPO is OPEN |
| **niiSubscription** | numeric | API/Browser | NII subscription (times) | 3.45 | When IPO is OPEN |
| **retailSubscription** | numeric | API/Browser | Retail subscription (times) | 2.10 | When IPO is OPEN |
| **totalSubscription** | numeric | API/Browser | Overall subscription (times) | 5.23 (max of above) | When IPO is OPEN |
| **timestamp** | timestamp | Generated | Data capture time | "2025-10-29T02:58:29Z" | 100% |

### ⚠️ Optional Subscription Fields

| Field | Type | Source | Description | Population |
|-------|------|--------|-------------|-----------|
| **employeeSubscription** | numeric | API/Browser | Employee quota subscription | Rarely populated |
| **anchorInvestorSubscription** | numeric | API/Browser | Anchor investor subscription | Rarely populated |
| **bNIISubscription** | numeric | API/Browser | Big NII subscription | Rarely populated |
| **sNIISubscription** | numeric | API/Browser | Small NII subscription | Rarely populated |

---

## 🔄 Data Transformation Flow

### NSE API Response → Database Fields

```typescript
// Example NSE API Response
{
  "companyName": "Lenskart Solutions Limited",
  "symbol": "LENSKART",
  "issueStartDate": "30-Oct-2025",    // → openDate
  "issueEndDate": "03-Nov-2025",      // → closeDate
  "issuePrice": "Rs.382 to Rs.402",   // → priceRangeMin, priceRangeMax
  "issueSize": "183865848",           // → issueSize (in crores)
  "listingDate": "05-Nov-2025",       // → listingDate
  "status": "OPEN",                   // → status
  "series": "EQ",                     // → Used for segment detection
  "platform": "MAINBOARD",            // → Used for segment detection
  "sector": "",                       // → sector (often empty)
  "lotSize": "1000",                  // → lotSize
  "faceValue": "10"                   // → faceValue
}
```

### Browser Scraping → Database Fields

```typescript
// HTML Table Structure
// Company Name | Issue Type | Open Date | Close Date | Issue Size | Price Range | Listing Date | Status
// → Maps to same database fields as API response
```

---

## 📋 Field Mapping by Source

### NSE API Endpoints Used

**1. `/api/all-upcoming-issues?category=ipo`**
- Returns: Standard IPO offerings
- Fields: All core fields + partial financial data
- Typical response: 5-10 IPOs

**2. `/api/all-upcoming-issues?category=rights`**
- Returns: RIGHTS issues
- Fields: Core fields only (no segment, limited financial data)
- Typical response: 5-10 RIGHTS offerings

**3. `/api/ipo-current-issue`**
- Returns: Currently OPEN IPOs with live subscription data
- Fields: All core fields + subscription data
- Typical response: 1-3 active IPOs

---

## 🎯 Field Population Summary (Oct 29, 2025 Run)

### IPO Fields (11 IPOs analyzed)

**100% Populated (10 fields):**
- company_name, slug, status, symbol, listing_exchanges
- open_date, close_date, face_value
- updated_at, last_scraped_at

**Partially Populated (4 fields):**
- lot_size (valid): 9% (1/11)
- price_range_min: 36% (4/11)
- price_range_max: 36% (4/11)
- issue_size: 36% (4/11)

**0% Populated (9 fields):**
- segment, isin, sector, registrar_id
- allotment_date, listing_date
- rating, company_description, lead_managers

**Overall Completeness:** 52% (12 out of 23 fields)

### Subscription Fields

**Current Run Result:** 0 subscriptions captured
- **Reason:** Scraper ran at 8:28 AM IST (before market open)
- **Market Hours:** 9:15 AM - 3:30 PM IST
- **Recommendation:** Schedule scraper during market hours for OPEN IPOs

---

## 🔍 Field-Level Validation Rules

### Data Quality Checks Performed

**1. lot_size Validation:**
- **Rule:** `lot_size > 1`
- **Current Issue:** 91% have `lot_size = 1` (invalid default)
- **Impact:** Cannot calculate minimum investment
- **Fix:** Requires BSE scraper or RHP parsing

**2. Price Range Validation:**
- **Rule:** `price_range_min <= price_range_max`
- **Current:** All valid ranges pass
- **Missing:** 64% of IPOs have NULL price ranges

**3. Date Logic Validation:**
- **Rule:** `open_date <= close_date <= listing_date`
- **Current Issue:** 55% have same-day open/close (unusual)
- **Likely Cause:** RIGHTS offerings or data limitation

**4. Segment Validation:**
- **Rule:** Standard IPOs should have segment (MAINBOARD or SME)
- **Current Issue:** 100% have NULL segment
- **Reason:** NSE API doesn't provide segment for RIGHTS/alternative offerings

---

## 📊 Comparison: What Scraper Gets vs. Database Schema

### Fields Scraper DOES Populate

✅ **10 fields at 100%:**
1. company_name
2. slug (generated)
3. symbol
4. status
5. open_date
6. close_date
7. listing_exchanges (always "NSE")
8. face_value
9. updated_at (auto)
10. last_scraped_at (auto)

✅ **4 fields partially (9-36%):**
11. lot_size (9% valid)
12. price_range_min (36%)
13. price_range_max (36%)
14. issue_size (36%)

### Fields Scraper CANNOT Populate (Need Other Sources)

❌ **9 fields at 0%:**
1. **segment** - Requires BSE or offering type detection
2. **isin** - Only available from BSE
3. **sector** - Not in NSE API
4. **registrar_id** - Requires RHP or BSE
5. **allotment_date** - Not in NSE API
6. **listing_date** - Sometimes available, often missing
7. **rating** - Calculated internally
8. **company_description** - Requires company website/RHP
9. **lead_managers** - Requires RHP documents

---

## 🚀 Recommendations for Data Completeness

### Immediate (High Priority)

1. **Implement BSE Scraper** for:
   - `segment` (MAINBOARD/SME detection)
   - `isin` (ISIN codes)
   - `lot_size` (valid lot sizes)
   - RIGHTS offering details

2. **Add Offering Type Detection**:
   - Detect from API endpoint category
   - Infer segment from offering type
   - Handle NULL segments for RIGHTS/InvITs/REITs

3. **Schedule Subscription Scraping**:
   - Run every 30 minutes during market hours (9:30 AM - 3:00 PM IST)
   - Target OPEN IPOs only
   - Capture live bidding data

### Medium Priority

4. **Moneycontrol Scraper** for:
   - `sector` classification
   - `allotment_date`
   - `listing_date` confirmation
   - `company_description`

5. **RHP Document Parser** for:
   - `lead_managers`
   - `registrar` details
   - Detailed financial metrics

---

## 📚 Related Documentation

- **Scraper Architecture:** `scraper/README.md`
- **NSE API Discovery:** `scraper/docs/SCRAPING_STRATEGY.md`
- **Field Mapping:** `docs/16-database/screen-table-database-field-mapping.md`
- **Validation Results:** `docs/08-scraping/nse-scraping-results.md`
- **Database Schema:** `packages/shared/src/db/schema.ts`

---

**Document Version:** 1.0
**Last Validated:** October 29, 2025
**Scraper Run:** 11 IPOs processed, 100% success rate
**Data Source:** Live VPS production database
