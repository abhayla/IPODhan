# Free IPO Data Sources Analysis - Competitor Research

**Date:** 2025-10-01
**Focus:** How do Chittorgarh, InvestorGain, and IPOWatch get FREE IPO data?

---

## 🎯 Key Finding: All Competitors Use Web Scraping from Public Sources

After extensive research, **there is NO free IPO API available**. Your competitors (Chittorgarh, InvestorGain, IPOWatch) all use the same approach you're implementing:

### **Web Scraping from Public Data Sources**

---

## 📊 Public Data Sources (FREE)

### 1. NSE India (Primary Source) ⭐⭐⭐⭐⭐

**URL:** https://www.nseindia.com/market-data/all-upcoming-issues-ipo

**What Data is Available:**
- Company Name
- Issue Open Date
- Issue Close Date
- Price Band
- Issue Size
- Lot Size
- Listing Date
- Status (Upcoming/Live/Closed)

**Format:** HTML tables on web page

**Competitors Using This:**
- ✅ Chittorgarh.com (confirmed - cites NSE as source)
- ✅ InvestorGain.com (confirmed - cites NSE as source)
- ✅ IPOWatch.in (likely)

**How They Access:**
- Web scraping with Playwright/Selenium
- Anti-bot bypasses (User-Agent, session management)
- Regular polling (hourly/daily)

**Your Status:**
- ✅ Anti-bot bypasses implemented
- ⚠️ Page structure analysis needed (currently getting 0 records)

---

### 2. BSE India (Primary Source) ⭐⭐⭐⭐⭐

**URL:** https://www.bseindia.com/publicissue.html

**What Data is Available:**
- IPO listings (Mainboard & SME)
- Public issue details
- Corporate announcements
- Issue documents

**Format:** HTML tables

**Competitors Using This:**
- ✅ All competitors cite BSE as source

**Your Status:**
- ✅ Anti-bot bypasses implemented
- ⚠️ Page structure analysis needed (0 records)

---

### 3. SEBI Public Filings (Official Source) ⭐⭐⭐⭐

**URL:** https://www.sebi.gov.in/filings/public-issues.html

**What Data is Available:**
- Draft Offer Documents (DRHP)
- Red Herring Prospectus (RHP)
- Final Offer Documents
- Complete IPO details from official filings

**Data Format:**
- HTML listings linking to PDF documents
- **NOT structured data** (no JSON/CSV/XML)

**Pros:**
- ✅ Most authoritative source
- ✅ Completely free
- ✅ Comprehensive data
- ✅ Legally compliant

**Cons:**
- ❌ Data in PDF format (hard to parse)
- ❌ Requires PDF extraction
- ❌ Manual company names (not standardized)
- ❌ Slower to update than exchanges

**Use Case:**
- Detailed company information
- Financial data extraction
- Prospectus analysis
- Backup/verification source

**Implementation:**
```python
# Pseudo-code for SEBI scraper
1. Scrape SEBI filings page
2. Get list of recent DRHP/RHP PDFs
3. Download PDFs
4. Extract text using PyPDF2/pdfplumber
5. Parse key fields (dates, prices, sizes)
6. Store in database
```

---

### 4. BSE SME IPO Page (SME Focus) ⭐⭐⭐

**URL:** https://www.bsesme.com/PublicIssues/SMEIPODRHP.aspx

**What Data is Available:**
- SME IPO DRHPs
- SME-specific issue details

**Your Status:** Not yet implemented

---

### 5. Stock Exchange APIs (Indirect Sources) ⭐⭐

**NSE API (Unofficial):**
- GitHub projects exist (stock-nse-india, stock-market-india)
- ❌ No IPO-specific endpoints found
- Focus on stock quotes, not IPOs

**BSE API (Unofficial):**
- GitHub: BseIndiaApi, python-bseindia
- ❌ No IPO-specific endpoints found
- Focus on stock data, announcements

**Verdict:** Not useful for IPO data

---

## 🏆 How Competitors Get Their Data

### Chittorgarh.com Strategy

**Primary Sources:**
1. NSE/BSE real-time IPO subscription data (live scraping)
2. SEBI DRHP/RHP filings
3. Registrar websites (for allotment status)
4. Manual data entry/curation

**Data Collection:**
- ✅ Automated scrapers for NSE/BSE
- ✅ SEBI document parsing
- ✅ Registrar website scraping
- ✅ Manual verification team

**Features:**
- Real-time IPO subscription tracking
- IPO reviews (manual content)
- Performance analysis
- Historical data

---

### InvestorGain.com Strategy

**Primary Sources:**
1. NSE/BSE exchange data
2. Grey Market Premium (GMP) - **Manual sources**
3. Broker networks (unofficial)

**Data Collection:**
- ✅ Automated scrapers
- ✅ Manual GMP data entry (from market sources)
- ✅ Community contributions

**Unique Aspect:**
- GMP data is **NOT from any official API**
- GMP comes from "publicly available sources" and "market perception"
- Likely manual data entry from brokers/traders

---

### IPOWatch.in Strategy

**Primary Sources:**
1. NSE/BSE official data
2. Manual curation
3. Registrar websites

**Data Collection:**
- ✅ Web scraping
- ✅ Manual updates
- ✅ Community-driven

---

## 💡 Key Insights

### 1. No Official Free API Exists ❌

**Confirmed:**
- NSE does not provide free IPO API
- BSE does not provide free IPO API
- SEBI provides documents, not structured data
- All "APIs" found are either:
  - Paid services (IPO Alerts, Global Datafeeds)
  - Unofficial scrapers (GitHub projects)
  - Broker APIs (require accounts, limited IPO data)

### 2. Web Scraping is Industry Standard ✅

**All competitors use web scraping:**
- Chittorgarh scrapes NSE/BSE/SEBI
- InvestorGain scrapes NSE/BSE
- IPOWatch scrapes NSE/BSE

**This is your best approach too!**

### 3. Grey Market Premium (GMP) is Manual 📝

**Important Discovery:**
- GMP data is **NOT available from any official source**
- GMP is collected from:
  - Manual market sources (brokers, traders)
  - Unofficial grey market operators
  - Community contributions
  - Market perception/estimates

**Your InvestorGain GMP scraper works because:**
- InvestorGain manually collects GMP from market
- They publish it on their website
- You scrape their published data

**Implication:**
- You can't get GMP from NSE/BSE/SEBI
- You must scrape from aggregators (InvestorGain, Chittorgarh)
- OR build your own network of market sources (not feasible initially)

---

## 🚀 Recommended Implementation Strategy

### Phase 1: Fix Current Scrapers (RECOMMENDED) ⭐⭐⭐⭐⭐

**Why:** This is what all competitors do. No better free alternative exists.

**Action Items:**

#### 1. Debug NSE Scraper (HIGH PRIORITY)
**Problem:** Anti-bot bypasses working, but getting 0 records

**Solution Steps:**
```python
# Add debugging to understand page structure
1. Take screenshot of loaded page
2. Save page HTML to file
3. Inspect actual table structure
4. Check if data loads via JavaScript/AJAX
5. Intercept network requests to find hidden API calls
```

**Implementation:**
```python
# In nse_scraper.py - add debugging
await page.screenshot(path='debug_nse_page.png')
html_content = await page.content()
with open('debug_nse_page.html', 'w', encoding='utf-8') as f:
    f.write(html_content)

# Check for AJAX/API calls
page.on('response', lambda response:
    print(f'API Call: {response.url}') if 'api' in response.url else None
)
```

#### 2. Add SEBI Scraper (MEDIUM PRIORITY)
**Purpose:** Most authoritative free source

**Implementation:**
```python
# New file: scrapers/sebi_scraper.py

class SEBIScraper(BaseScraper):
    def __init__(self):
        super().__init__("SEBI")
        self.url = "https://www.sebi.gov.in/filings/public-issues.html"

    async def scrape(self):
        # 1. Scrape SEBI filings list
        # 2. Get recent DRHPs (last 30 days)
        # 3. Extract company names, filing dates
        # 4. Match with NSE/BSE data for enrichment
        pass
```

**Libraries Needed:**
- PyPDF2 or pdfplumber (for PDF parsing)
- regex (for text extraction)

#### 3. Improve Chittorgarh Scraper (LOW PRIORITY)
**Current Status:** 0 records

**Action:** Debug page structure, similar to NSE

#### 4. Keep InvestorGain GMP Scraper (WORKING) ✅
**Status:** Working perfectly (65 records)
**Action:** No changes needed, keep as-is

---

### Phase 2: Implement Data Enrichment

**Strategy:** Combine data from multiple sources

```
NSE/BSE (Basic IPO data)
    ↓
SEBI (Detailed company info, financials)
    ↓
InvestorGain (GMP data)
    ↓
Chittorgarh (Subscription status, reviews)
    ↓
Final Enriched Database
```

---

### Phase 3: Manual Curation (Like Competitors)

**What Competitors Do:**
- Manual review teams
- Verify scraped data accuracy
- Add editorial content (reviews, analysis)
- Update GMP from market sources
- Correct errors

**Your Approach:**
1. Start with automated scraping (Phase 1)
2. Add manual verification later
3. Build editorial team when scaling
4. Add user-generated content features

---

## 📋 Comparison: Free vs Paid Options

| Approach | Cost | Reliability | Maintenance | Legal | Recommended |
|----------|------|-------------|-------------|-------|-------------|
| **NSE/BSE Scraping** | Free | ⭐⭐⭐⭐ | ⭐⭐ | ⚠️ Gray | ✅ YES (all competitors do this) |
| **SEBI Scraping** | Free | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ✅ Public data | ✅ YES (backup source) |
| **InvestorGain GMP** | Free | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⚠️ Gray | ✅ YES (already working) |
| **IPO Alerts API** | $99+/month | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ Clear | ❌ NO (too expensive) |
| **Global Datafeeds** | $$$$ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ✅ Clear | ❌ NO (enterprise pricing) |
| **Broker APIs** | Free | ⭐⭐⭐ | ⭐⭐⭐ | ✅ Clear | ❌ NO (no IPO focus) |

---

## 🎯 Final Recommendation

### ✅ DO THIS (Follow Competitor Strategy):

1. **Fix NSE/BSE scrapers** (add debugging, analyze page structure)
2. **Add SEBI scraper** (for enriched data)
3. **Keep InvestorGain GMP scraper** (already working)
4. **Improve Chittorgarh scraper** (backup source)
5. **Add data validation layer** (cross-check sources)
6. **Implement caching** (reduce scraping frequency)

### ❌ DON'T DO THIS:

1. ❌ Pay for IPO Alerts API ($99+/month unnecessary)
2. ❌ Wait for official free API (doesn't exist)
3. ❌ Use broker APIs (no IPO data)
4. ❌ Manual data entry (not scalable)

---

## 🔨 Immediate Action Plan (Next 2-4 Hours)

### Step 1: Debug NSE Scraper (1 hour)
```bash
# Add debugging code to nse_scraper.py
cd ipodhan-data-pipeline
# Edit scrapers/nse_scraper.py
# Add: screenshot, HTML dump, console logs
# Run: python main.py run-ipo
# Analyze: debug_nse_page.html and debug_nse_page.png
```

### Step 2: Inspect Page Structure (30 min)
- Open saved HTML in browser
- Identify table structure
- Check if data is in JavaScript variables
- Look for hidden API calls

### Step 3: Fix Parser Logic (1 hour)
- Update `_extract_ipo_data()` method
- Match actual table structure
- Test with real page

### Step 4: Repeat for BSE (1 hour)
- Same debugging approach
- Fix BSE scraper

### Total Time: 3.5 hours to working IPO scrapers

---

## 📈 Expected Results After Fix

**Database:**
- 20-50 IPO records from NSE
- 30-80 IPO records from BSE (including SME)
- 65 GMP records from InvestorGain
- All GMP records will link to IPO records ✅

**Pipeline:**
- Hourly scraping during market hours
- Daily scraping off-hours
- Data freshness indicators
- Health monitoring

---

## 🎓 Lessons Learned

1. **No Free Lunch:** No free IPO API exists, all competitors scrape
2. **Web Scraping is Standard:** Chittorgarh, InvestorGain, IPOWatch all use scraping
3. **GMP is Manual:** Grey market data comes from brokers, not official sources
4. **SEBI is Gold:** Most authoritative but requires PDF parsing
5. **Your Approach is Correct:** Multi-source scraping is industry standard

---

## 📞 Quick Reference

### Working Data Sources:
- ✅ InvestorGain GMP (65 records)
- ⚠️ NSE (connection works, need to fix parser)
- ⚠️ BSE (connection works, need to fix parser)

### Not Working:
- ❌ Chittorgarh (0 records)
- ❌ IPOWatch (timeouts)

### Next Implementation:
- 🔨 Debug NSE/BSE parsers
- 🔨 Add SEBI scraper
- 🔨 Improve Chittorgarh/IPOWatch

---

**Conclusion:** Your current strategy (web scraping) is **exactly what competitors do**. Focus on fixing the parsers, not finding alternative APIs (they don't exist for free).

**Status:** Ready to debug and fix scrapers
**Last Updated:** 2025-10-01
