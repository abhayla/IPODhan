# URLs Tracker - IPODhan Data Sources

> **Single Source of Truth for all scraper URLs**
>
> **Last Updated:** 2025-10-13
> **Verified:** ✅ All URLs manually tested with Playwright
> **Status:** PRODUCTION READY

---

## 📌 How to Use This File

- **All scraper implementations MUST reference this file**
- **DO NOT hardcode URLs in scraper files**
- **When updating URLs, update ONLY this file**
- **All documentation (PRD, Stories, etc.) references this file**

---

## 🟢 Active Data Sources

### Chittorgarh (Primary Source)

#### Historical IPO Performance
```
URL: https://www.chittorgarh.com/ipo/ipo_perf_tracker.asp
Type: Mainboard & SME IPO Historical Data
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: HTML Table
Scraper: historical-ipo-scraper.ts
Notes: Returns historical listing performance for all IPOs
```

#### SME IPO Performance
```
URL: https://www.chittorgarh.com/ipo/ipo_perf_tracker.asp?exchange=sme
Type: SME IPO Historical Data
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: HTML Table
Scraper: historical-ipo-scraper.ts
Notes: Filter for SME exchange only
```

#### IPO Reviews - All
```
URL: https://www.chittorgarh.com/report/ipo-review/102/all/
Type: IPO Reviews & Ratings
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: HTML Table
Scraper: ipo-reviews-scraper.ts
Notes: Combined mainboard and SME reviews
```

#### IPO Reviews - Mainboard
```
URL: https://www.chittorgarh.com/report/ipo-review/102/mainboard/
Type: Mainboard IPO Reviews
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: HTML Table
Scraper: ipo-reviews-scraper.ts
Notes: Mainboard only filter
```

#### IPO Reviews - SME
```
URL: https://www.chittorgarh.com/report/ipo-review/102/sme/
Type: SME IPO Reviews
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: HTML Table
Scraper: ipo-reviews-scraper.ts
Notes: SME only filter
```

---

### BSE India (Exchange Source)

#### Public Issues
```
URL: https://www.bseindia.com/publicissue.html
Type: Live IPO Listings (Mainboard & SME)
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: HTML Table
Scraper: bse-scraper.ts
Notes: Real-time IPO data with offer details, dates, status
```

---

### NSE India (Exchange Source)

#### All Upcoming IPOs
```
URL: https://www.nseindia.com/market-data/all-upcoming-issues-ipo
Type: Current, Past, Upcoming IPOs
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: JavaScript-rendered HTML (Tabs)
Scraper: nse-scraper.ts
Notes: Has tabs: Current, Past Issues, Upcoming Issues
```

#### Market Holidays API
```
URL: https://www.nseindia.com/api/holiday-master?type=trading
Type: Market Trading Holidays
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: JSON API
Scraper: market-holidays-scraper.ts
Notes: Returns JSON array of holiday dates
```

---

### InvestorGain (GMP Data Source)

#### Live GMP - Mainboard
```
URL: https://www.investorgain.com/report/live-ipo-gmp/331/ipo/
Type: Grey Market Premium (Mainboard)
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: HTML Table
Scraper: gmp-scraper.ts
Notes: Live GMP data, updated hourly
```

#### Live GMP - All IPOs
```
URL: https://www.investorgain.com/report/live-ipo-gmp/331/all/
Type: Grey Market Premium (All)
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: HTML Table
Scraper: gmp-scraper.ts
Notes: Combined mainboard and SME GMP
```

#### Live GMP - SME
```
URL: https://www.investorgain.com/report/live-ipo-gmp/331/sme/
Type: Grey Market Premium (SME)
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: HTML Table
Scraper: gmp-scraper.ts
Notes: SME IPOs only
```

#### Live GMP - Active (Non-zero)
```
URL: https://www.investorgain.com/report/live-ipo-gmp/331/nonzero/
Type: Active GMP (Non-zero values)
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: HTML Table
Scraper: gmp-scraper.ts
Notes: Filters out IPOs with zero GMP
```

#### Live GMP - Open IPOs
```
URL: https://www.investorgain.com/report/live-ipo-gmp/331/open/
Type: Currently Open IPOs
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: HTML Table
Scraper: gmp-scraper.ts
Notes: Only IPOs currently accepting applications
```

#### Live GMP - Upcoming IPOs
```
URL: https://www.investorgain.com/report/live-ipo-gmp/331/current/
Type: Upcoming IPOs
Status: ✅ VERIFIED
Last Checked: 2025-10-13
Data Format: HTML Table
Scraper: gmp-scraper.ts
Notes: IPOs announced but not yet open
```

---

## 🔴 Deprecated URLs (DO NOT USE)

### Chittorgarh - OLD URLs

```
❌ https://www.chittorgarh.com/ipo/ipo-performance-tracker/
   Replaced by: https://www.chittorgarh.com/ipo/ipo_perf_tracker.asp
   Deprecated: 2025 (estimated)

❌ https://www.chittorgarh.com/ipo/sme-ipo-reviews/
   Replaced by: https://www.chittorgarh.com/report/ipo-review/102/sme/
   Deprecated: 2025 (estimated)

❌ https://www.chittorgarh.com/ipo/ipo_grey_market_premium.asp
   Replaced by: https://www.investorgain.com/report/live-ipo-gmp/331/ipo/
   Note: Chittorgarh redirects to InvestorGain for GMP data
   Deprecated: 2025 (estimated)
```

### NSE - OLD URLs

```
❌ https://www.nseindia.com/market-data/public-issues
   Replaced by: https://www.nseindia.com/market-data/all-upcoming-issues-ipo
   Deprecated: 2025 (estimated)

❌ https://www.nseindia.com/market-data/forthcoming-issues-ipo
   Replaced by: https://www.nseindia.com/market-data/all-upcoming-issues-ipo
   Deprecated: 2025 (estimated)
```

### BSE - OLD URLs

```
❌ https://www.bseindia.com/markets/PublicIssues/IPOIssueTracker.aspx
   Replaced by: https://www.bseindia.com/publicissue.html
   Deprecated: 2025 (estimated)

❌ https://www.bseindia.com/static/about/Market_Holidays.aspx
   Status: 404 - No replacement found yet
   Alternative: Use NSE holiday API
   Deprecated: 2025 (estimated)
```

---

## 🔄 Alternative Sources (Backup)

### IPOWATCH (Alternative GMP Source)
```
URL: https://www.ipowatch.in/
Type: GMP Tracking
Status: ⚠️ NOT YET VERIFIED
Scraper: Not implemented
Notes: Alternative if InvestorGain fails
```

### Moneycontrol (Alternative News/Data)
```
URL: https://www.moneycontrol.com/ipo/
Type: IPO News & Listings
Status: ⚠️ NOT YET VERIFIED
Scraper: Not implemented
Notes: Backup source for IPO data
```

---

## 📊 URL Health Status

| Source | Working URLs | Broken URLs | Last Verified |
|--------|--------------|-------------|---------------|
| Chittorgarh | 5/5 | 0 | 2025-10-13 |
| BSE | 1/1 | 0 | 2025-10-13 |
| NSE | 2/2 | 0 | 2025-10-13 |
| InvestorGain | 6/6 | 0 | 2025-10-13 |
| **TOTAL** | **14/14** | **0** | **100% Health** |

---

## 🛠️ URL Update Protocol

When a URL breaks or changes:

1. **Test the URL** manually using Playwright MCP (headed mode)
2. **Update this file** with new URL
3. **Move old URL** to "Deprecated URLs" section
4. **Update scraper code** to use new URL
5. **Test scraper** to ensure data flows correctly
6. **Update "Last Checked"** timestamp
7. **Commit changes** with descriptive message

**Example Commit Message:**
```
fix(urls): Update Chittorgarh historical IPO URL

- Old: /ipo-performance-tracker/
- New: /ipo/ipo_perf_tracker.asp
- Reason: Site restructure
- Verified: Playwright manual test
- Refs: URLs-Tracker.md
```

---

## 📝 URL Naming Conventions

### URL Parameters

| Parameter | Values | Usage |
|-----------|--------|-------|
| `exchange` | `sme`, `main` | Filter by exchange type |
| `type` | `trading`, `clearing` | Holiday type for NSE API |
| Category path | `all`, `mainboard`, `sme`, `ipo` | Filter IPO category |
| Status | `open`, `current`, `listed`, `nonzero` | Filter by IPO status |

### Path Patterns

```
Chittorgarh:
  - Reports: /report/{type}/{id}/{filter}/
  - IPO Data: /ipo/{filename}.asp

BSE:
  - Simple: /{page}.html

NSE:
  - Data: /market-data/{resource}
  - API: /api/{endpoint}?{params}

InvestorGain:
  - Reports: /report/{type}/{id}/{filter}/
```

---

## 🔍 Verification Tools

### Manual Testing
```bash
# Using Playwright MCP (headed mode)
# See: URL_INVESTIGATION_RESULTS.md for methodology
```

### Automated Testing
```bash
# Run URL health check
npm run scraper:health-check

# Test specific source
npm run scraper:test chittorgarh
npm run scraper:test bse
npm run scraper:test nse
npm run scraper:test investorgain
```

---

## 📚 Related Documentation

- **Investigation Report:** [URL_INVESTIGATION_RESULTS.md](../web/URL_INVESTIGATION_RESULTS.md)
- **Session Handoff:** [SESSION_HANDOFF.md](../web/SESSION_HANDOFF.md)
- **PRD Reference:** [PRD.md](./PRD.md) → See "Data Sources" section
- **Story Files:**
  - [7.1 NSE Scraper](./stories/7.1.nse-scraper.story.md)
  - [7.2 BSE Scraper](./stories/7.2.bse-scraper.story.md)

---

## ⚠️ Important Notes

1. **InvestorGain vs Chittorgarh:** Both owned by Chittorgarh Infotech Pvt Ltd. Use InvestorGain for GMP data, Chittorgarh for reviews/performance.

2. **NSE CORS:** NSE may require specific headers for API access. See scraper implementation for details.

3. **Rate Limiting:** Be respectful of source websites:
   - Max 1 request per second per source
   - Implement exponential backoff on failures
   - Cache data appropriately

4. **Data Freshness:**
   - GMP data: Updated hourly
   - IPO listings: Updated daily
   - Market holidays: Updated annually

---

**Maintained by:** Development Team
**Version:** 1.0.0
**Last Major Update:** 2025-10-13
