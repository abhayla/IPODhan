# IPO Data Sources Research - 2025

**Date:** 2025-10-01
**Research Purpose:** Find reliable IPO data sources for IPODhan platform

---

## ✅ Current Status

### Working Data Sources
1. **InvestorGain GMP Scraper** ✅
   - Status: Working perfectly
   - Data: 65 GMP records scraped successfully
   - URL: https://www.investorgain.com/report/live-ipo-gmp/331/all/
   - Reliability: High

2. **NSE India Web Scraper** ✅ (Anti-bot fixed)
   - Status: Connection successful, 0 records (page may be empty or structure changed)
   - URL: https://www.nseindia.com/market-data/all-upcoming-issues-ipo
   - Issue: Page loads but no IPO data extracted

3. **BSE India Web Scraper** ✅ (Connection successful)
   - Status: Connection successful, 0 records
   - URL: https://www.bseindia.com/markets/PublicIssues/IPOIssues.aspx
   - Issue: No tables found on page

### Partially Working
4. **IPOWatch Scraper** ⚠️
   - Status: Intermittent timeouts
   - Data: 0 records (when successful)
   - URL: https://www.ipowatch.in/p/ipo-grey-market-premium-latest-live-gmp.html

5. **Chittorgarh Scraper** ⚠️
   - Status: Needs improvement
   - Data: 0 records
   - URL: https://www.chittorgarh.com/ipo/ipo_dashboard.asp

---

## 📊 Alternative Data Sources Discovered

### 1. IPO Alerts API (RECOMMENDED) ⭐⭐⭐⭐⭐

**Provider:** https://ipoalerts.in/

**Features:**
- ✅ Dedicated IPO API service
- ✅ Real-time IPO data for NSE and BSE
- ✅ Free tier available
- ✅ Easy integration (< 2 minutes)
- ✅ SDKs provided
- ✅ Hourly updates

**API Endpoint:**
```
GET https://api.ipoalerts.in/ipos?status=open
GET https://api.ipoalerts.in/ipos?status=upcoming
GET https://api.ipoalerts.in/ipos?status=closed
```

**Data Fields (Expected):**
- Company name
- Symbol
- Open/Close dates
- Issue price/price band
- Issue size
- Lot size
- Status (Open, Upcoming, Closed)
- Exchange (NSE/BSE)

**Pricing:**
- Free tier available
- Details: Need to sign up for full pricing info

**Pros:**
- Purpose-built for IPO data
- Reliable and maintained
- No scraping needed
- Legal and compliant
- Structured JSON responses

**Cons:**
- May have rate limits
- Free tier limitations unknown
- Requires API key/authentication

**Implementation Effort:** 2-4 hours

---

### 2. Broker APIs (Moderate Complexity)

#### A. ICICI Direct Breeze API
**URL:** https://www.icicidirect.com/futures-and-options/api/breeze

**Features:**
- Free trading API
- May include IPO data
- Real-time market data

**Pros:**
- Free
- Reputable source
- Official broker API

**Cons:**
- Requires ICICI Direct account
- May not have comprehensive IPO data
- Focus on trading, not IPOs

---

#### B. Upstox Uplink API
**URL:** https://upstox.com/uplink/

**Features:**
- Free API suite
- Real-time data
- Market data access

**Pros:**
- Free
- Official broker API
- Well-documented

**Cons:**
- Requires Upstox account
- Primary focus on trading
- IPO data coverage unknown

**Implementation Effort:** 4-8 hours (account setup + integration)

---

### 3. Third-Party Market Data Providers

#### Global Datafeeds (GFDL)
**URL:** https://globaldatafeeds.in/

**Features:**
- Authorized NSE/BSE data vendor since 2010
- Real-time market data APIs
- Professional-grade service

**Pros:**
- Official authorization
- Comprehensive data
- Reliable infrastructure

**Cons:**
- ❌ Paid service (likely expensive)
- Requires commercial subscription
- Overkill for IPO-only data

**Not recommended** for early-stage startup due to cost.

---

### 4. Open Source GitHub Projects

#### A. stock-market-india
**URL:** https://github.com/maanavshah/stock-market-india

**Description:** API for Indian Stock Market's NSE and BSE

**Pros:**
- Open source
- Free
- Community maintained

**Cons:**
- May not be up-to-date
- No guarantee of reliability
- Limited IPO focus

---

#### B. stock-nse-india
**URL:** https://github.com/hi-imcodeman/stock-nse-india

**Description:** API for National Stock Exchange of India

**Pros:**
- Open source
- Free
- NSE focused

**Cons:**
- Maintenance status unknown
- Limited documentation
- IPO data availability uncertain

**Implementation Effort:** 2-4 hours (evaluation + integration)

---

### 5. Web Scraping Platforms (Continue Current Approach)

#### Current Strategy: Multi-source scraping
- ✅ InvestorGain (GMP data working)
- ⚠️ Chittorgarh (needs improvement)
- ⚠️ IPOWatch (intermittent)
- ❌ NSE/BSE (0 records - needs investigation)

**Pros:**
- No API costs
- Multiple sources for redundancy
- Already partially implemented

**Cons:**
- Brittle (sites can change anytime)
- Anti-bot detection challenges
- Legal gray area
- Maintenance overhead

---

## 🎯 Recommendations

### Option 1: IPO Alerts API (RECOMMENDED) ⭐

**Why:**
- Purpose-built for IPO data
- Free tier available
- Most reliable long-term solution
- Legal and compliant
- Low maintenance

**Next Steps:**
1. Sign up at https://ipoalerts.in/
2. Get API key
3. Review free tier limits
4. Create new scraper: `ipoalerts_api_scraper.py`
5. Replace NSE/BSE scrapers with API calls
6. Keep InvestorGain for GMP data (as backup)

**Implementation Plan:**
```python
# New file: scrapers/ipoalerts_api_scraper.py
import requests

class IPOAlertsAPIScraper(BaseScraper):
    def __init__(self, api_key: str):
        super().__init__("IPOALERTS_API")
        self.api_key = api_key
        self.base_url = "https://api.ipoalerts.in"

    async def scrape(self) -> List[Dict[str, Any]]:
        # Fetch open IPOs
        open_ipos = self._fetch_ipos("open")
        upcoming_ipos = self._fetch_ipos("upcoming")
        closed_ipos = self._fetch_ipos("closed")

        return open_ipos + upcoming_ipos + closed_ipos

    def _fetch_ipos(self, status: str) -> List[Dict]:
        response = requests.get(
            f"{self.base_url}/ipos",
            params={"status": status},
            headers={"Authorization": f"Bearer {self.api_key}"}
        )
        return response.json()
```

**Estimated Time:** 2-4 hours
**Cost:** Free tier initially, may need paid plan later

---

### Option 2: Hybrid Approach (BALANCED) ⭐⭐

**Strategy:**
- Use IPO Alerts API for base IPO data (Open, Upcoming, Closed)
- Keep InvestorGain scraper for GMP data
- Keep Chittorgarh/IPOWatch as backup sources

**Why:**
- Best of both worlds
- Redundancy if API fails
- GMP data from scrapers
- Official IPO data from API

**Next Steps:**
1. Implement IPO Alerts API integration
2. Keep existing GMP scrapers
3. Make NSE/BSE scrapers optional fallback
4. Add data source priority logic

**Estimated Time:** 4-6 hours

---

### Option 3: Fix Current Scrapers (CONTINUE AS-IS)

**Strategy:**
- Debug why NSE/BSE return 0 records
- Improve Chittorgarh/IPOWatch scrapers
- Continue multi-source scraping approach

**Why:**
- No API dependencies
- No costs
- Full control

**Next Steps:**
1. Inspect NSE page HTML to understand structure
2. Check if NSE loads data via JavaScript/XHR
3. Improve table parsing logic
4. Add API call interception for dynamic data

**Challenges:**
- Time-consuming
- Fragile solution
- Anti-bot ongoing issue
- Maintenance burden

**Estimated Time:** 8-12 hours

---

## 📋 Decision Matrix

| Solution | Cost | Reliability | Maintenance | Legal | Time to Implement |
|----------|------|-------------|-------------|-------|-------------------|
| IPO Alerts API | Free/Paid | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ Clear | 2-4 hours |
| Hybrid (API + Scrapers) | Free/Paid | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ✅ Mostly | 4-6 hours |
| Broker APIs | Free | ⭐⭐⭐ | ⭐⭐⭐ | ✅ Clear | 4-8 hours |
| Continue Scraping | Free | ⭐⭐ | ⭐⭐ | ⚠️ Gray | 8-12 hours |
| Global Datafeeds | $$$ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ Clear | 2-4 hours |

---

## 🚀 Recommended Path Forward

### Phase 1: Quick Win (This Week)
1. **Sign up for IPO Alerts API** (30 minutes)
2. **Test API endpoints** (1 hour)
3. **Implement IPO Alerts scraper** (2-3 hours)
4. **Test end-to-end pipeline** (1 hour)

**Total Time:** 4-5 hours
**Result:** Working IPO data pipeline with 100+ IPOs

### Phase 2: Redundancy (Next Week)
1. **Keep InvestorGain GMP scraper** (already working)
2. **Add Chittorgarh as backup** (improve scraper)
3. **Implement data source priority logic**

### Phase 3: Optimization (Future)
1. **Evaluate API free tier limits**
2. **Decide on paid plan if needed**
3. **Add broker APIs as alternative**
4. **Remove unreliable scrapers**

---

## 🔍 Technical Notes

### Why NSE/BSE Scrapers Return 0 Records

**Possible Reasons:**
1. **Dynamic Content Loading**
   - Data loaded via JavaScript/XHR after page load
   - Tables populated by AJAX calls
   - Need to intercept API calls

2. **Page Structure Changed**
   - NSE/BSE redesigned their pages
   - Table selectors no longer valid
   - Need to update parsing logic

3. **No IPOs Listed**
   - Market conditions (no current IPOs)
   - Off-season for IPOs
   - Unlikely but possible

4. **Anti-Bot Detection Working**
   - Even with bypasses, still detected
   - Serving different content to bots
   - Need advanced techniques (residential proxies)

**Debug Steps:**
1. Take screenshot of loaded page
2. Inspect page HTML structure
3. Check browser Network tab for XHR/API calls
4. Compare with manual browser visit

---

## 📝 Summary

**Current State:**
- ✅ GMP scrapers working (65 records from InvestorGain)
- ❌ IPO base data missing (0 records from NSE/BSE)
- ✅ Database and pipeline infrastructure ready

**Recommendation:**
- **Use IPO Alerts API** for base IPO data
- **Keep InvestorGain** for GMP data
- **Phase out NSE/BSE scrapers** (or make them fallback)

**Action Required:**
1. Sign up at https://ipoalerts.in/
2. Get API key
3. Implement new scraper
4. Test with production database
5. Monitor data quality

**Expected Outcome:**
- 100+ IPO records in database
- 65 GMP records linked correctly
- Reliable, maintainable solution
- Legal compliance

---

**Last Updated:** 2025-10-01
**Status:** Ready for Implementation
