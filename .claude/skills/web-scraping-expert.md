# Web Scraping Expert

**Purpose:** This skill provides expertise in data acquisition from NSE, BSE, Moneycontrol, and Chittorgarh for IPO information. It covers NSE API usage, Puppeteer fallback strategies, multi-source data merging, and the priority system.

**When to invoke:** Use this skill when building scrapers, debugging data acquisition, implementing fallback logic, resolving data conflicts, or understanding the scraper architecture.

---

## Data Source Priority System

When multiple sources provide conflicting data, IPODhan uses a priority-based system:

### Priority Levels (Highest to Lowest)

1. **ADMIN** (Manual Edits)
   - **Priority:** Highest
   - **Source:** Manual data entry by team
   - **Use Case:** Corrections, verified data, special cases
   - **Database Field:** `dataSource = 'ADMIN'`
   - **Trust Level:** 100% (authoritative)

2. **DRHP** (Draft Red Herring Prospectus)
   - **Priority:** Very High
   - **Source:** Official SEBI filings, PDF documents
   - **Use Case:** Financial data, company details, official dates
   - **Database Field:** `dataSource = 'DRHP'`
   - **Trust Level:** 95% (official document)

3. **NSE** (National Stock Exchange)
   - **Priority:** High
   - **Source:** NSE APIs and website
   - **Use Case:** Real-time subscription, current IPOs, dates
   - **Database Field:** `dataSource = 'NSE'`
   - **Trust Level:** 90% (primary exchange)

4. **BSE** (Bombay Stock Exchange)
   - **Priority:** Medium-High
   - **Source:** BSE website scraping
   - **Use Case:** SME IPOs, backup to NSE data
   - **Database Field:** `dataSource = 'BSE'`
   - **Trust Level:** 85% (secondary exchange)

5. **Moneycontrol**
   - **Priority:** Medium
   - **Source:** Moneycontrol.com scraping
   - **Use Case:** Upcoming IPOs, news, general info
   - **Database Field:** `dataSource = 'MONEYCONTROL'`
   - **Trust Level:** 75% (media source)

6. **Chittorgarh**
   - **Priority:** Medium-Low
   - **Source:** Chittorgarh.com scraping
   - **Use Case:** GMP (Grey Market Premium) data
   - **Database Field:** `dataSource = 'CHITTORGARH'`
   - **Trust Level:** 70% (unofficial, but GMP specialist)

7. **API_FALLBACK**
   - **Priority:** Lowest
   - **Source:** Backup scraping service
   - **Use Case:** When primary sources fail
   - **Database Field:** `dataSource = 'API_FALLBACK'`
   - **Trust Level:** 60% (last resort)

### Conflict Resolution Algorithm

```typescript
function resolveConflict(field: string, sources: DataSource[]): any {
  // Sort sources by priority
  const priorityOrder = ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH', 'API_FALLBACK'];

  const sortedSources = sources.sort((a, b) => {
    return priorityOrder.indexOf(a.source) - priorityOrder.indexOf(b.source);
  });

  // Return value from highest priority source
  for (const source of sortedSources) {
    if (source.data[field] !== null && source.data[field] !== undefined) {
      return {
        value: source.data[field],
        source: source.source,
        confidence: getConfidenceScore(source.source)
      };
    }
  }

  return null;
}
```

---

## NSE Scraping

### NSE Hidden API Endpoints

NSE provides unofficial JSON APIs with 95%+ success rate.

#### Endpoint 1: Current Issues (Active IPOs)

```
URL: https://www.nseindia.com/api/ipo-current-issue
Method: GET
Success Rate: 98%
```

**Request Headers (CRITICAL):**
```http
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
Accept: application/json
Accept-Language: en-US,en;q=0.9
Referer: https://www.nseindia.com/market-data/ipo-current-issues
Accept-Encoding: gzip, deflate, br
Connection: keep-alive
```

**Session Management:**
1. Visit https://www.nseindia.com first to get cookies
2. Store `nsit`, `nseappid` cookies
3. Include cookies in API requests
4. Cookies valid for 30 minutes

**Example Code:**
```typescript
import axios from 'axios';

async function scrapeNSECurrentIssues() {
  // Step 1: Get session cookies
  const sessionResponse = await axios.get('https://www.nseindia.com', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  const cookies = sessionResponse.headers['set-cookie'];

  // Step 2: Call API with cookies
  const response = await axios.get('https://www.nseindia.com/api/ipo-current-issue', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.nseindia.com/market-data/ipo-current-issues',
      'Cookie': cookies.join('; ')
    }
  });

  return response.data;
}
```

**Response Structure:**
```json
{
  "data": [
    {
      "symbol": "XYZIPO",
      "companyName": "XYZ Corporation Limited",
      "issueStartDate": "05-Jan-2025",
      "issueEndDate": "09-Jan-2025",
      "issuePrice": "350-370",
      "issueSize": "500",
      "lotSize": "40",
      "isinNumber": "INE12AB01234",
      "status": "OPEN",
      "subscriptionStatus": {
        "qib": "5.23",
        "nii": "12.45",
        "retail": "3.67",
        "total": "6.89"
      }
    }
  ]
}
```

#### Endpoint 2: All Upcoming Issues

```
URL: https://www.nseindia.com/api/all-upcoming-issues?category=ipo
Method: GET
Success Rate: 95%
```

**Query Parameters:**
- `category=ipo` - IPOs only
- `category=sme` - SME IPOs
- `category=all` - All types

**Response:** Similar to current-issue but includes UPCOMING status IPOs

#### Endpoint 3: Subscription Data

```
URL: https://www.nseindia.com/api/ipo-subscription-detail?issueId={SYMBOL}
Method: GET
Success Rate: 92%
```

**Real-time Updates:** Available during IPO open period, updates every 15 minutes

**Response:**
```json
{
  "categoryWiseSubscription": [
    {
      "category": "QIB",
      "sharesOffered": 10000000,
      "sharesBid": 52300000,
      "timesSubscribed": 5.23
    },
    {
      "category": "NII",
      "sharesOffered": 3000000,
      "sharesBid": 37350000,
      "timesSubscribed": 12.45
    }
  ]
}
```

### NSE Session Management

**Cookie Lifecycle:**
1. Visit homepage → Get session cookies
2. Cookies valid for 30 minutes
3. After 30 minutes → Get new cookies
4. API calls without valid cookies → 401 Unauthorized

**Rate Limiting:**
- Max 10 requests per minute per IP
- Exceeded rate → 429 Too Many Requests
- Wait 60 seconds before retrying

**Retry Strategy:**
```typescript
async function fetchWithRetry(url: string, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, { headers, timeout: 10000 });
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        // Refresh session
        await refreshNSESession();
        continue;
      }

      if (error.response?.status === 429) {
        // Rate limited
        const waitTime = attempt * 60000; // 1 min, 2 min, 3 min
        await sleep(waitTime);
        continue;
      }

      if (attempt === maxRetries) throw error;

      // Exponential backoff
      await sleep(attempt * 1000);
    }
  }
}
```

---

## Puppeteer Fallback Strategy

When NSE API fails, use Puppeteer for browser automation.

### When to Use Puppeteer

1. **NSE API Returns 403/401** - Session management failed
2. **NSE API Down** - Server unavailable
3. **Cloudflare Challenge** - Bot detection triggered
4. **Data Not Available in API** - Some fields only on webpage

### Puppeteer Setup

```typescript
import puppeteer from 'puppeteer';

async function scrapeNSEWithPuppeteer() {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // Important for low memory VPS
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();

  // Set user agent
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

  // Set viewport
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    // Navigate with timeout
    await page.goto('https://www.nseindia.com/market-data/ipo-current-issues', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // Wait for data to load
    await page.waitForSelector('.ipo-table', { timeout: 10000 });

    // Extract data
    const data = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.ipo-table tbody tr'));
      return rows.map(row => {
        const cells = row.querySelectorAll('td');
        return {
          companyName: cells[0]?.textContent?.trim(),
          symbol: cells[1]?.textContent?.trim(),
          issuePrice: cells[2]?.textContent?.trim(),
          // ... extract other fields
        };
      });
    });

    return data;
  } finally {
    await browser.close();
  }
}
```

### Handling Cloudflare

```typescript
async function bypassCloudflare(page: Page) {
  // Wait for Cloudflare challenge
  const cloudflareSelector = '#cf-challenge-running';

  try {
    await page.waitForSelector(cloudflareSelector, { timeout: 5000 });

    // Wait for challenge to complete (max 10 seconds)
    await page.waitForSelector(cloudflareSelector, {
      hidden: true,
      timeout: 10000
    });

    console.log('Cloudflare challenge bypassed');
  } catch {
    // No Cloudflare challenge or already bypassed
  }
}
```

### Stealth Techniques

```typescript
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

// Randomize fingerprint
await page.evaluateOnNewDocument(() => {
  // Override navigator properties
  Object.defineProperty(navigator, 'webdriver', { get: () => false });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
});

// Random delays between actions
await page.waitForTimeout(Math.random() * 2000 + 1000);
```

---

## BSE Scraping

BSE requires HTML scraping as no public API exists.

### BSE IPO Page

```
URL: https://www.bseindia.com/corporates/Forth_Coming.aspx
Method: GET (HTML scraping)
Success Rate: 85%
```

### Challenges

1. **ASP.NET ViewState**
   - BSE uses ASP.NET with ViewState
   - Must parse and include `__VIEWSTATE` and `__EVENTVALIDATION` in POST requests
   - ViewState changes on every page load

2. **Session Cookies**
   - Session expires after 20 minutes
   - Must refresh session periodically

3. **Table Structure**
   - HTML table with inconsistent structure
   - Some cells span multiple columns
   - Empty cells need handling

### BSE Scraping Code

```typescript
import axios from 'axios';
import * as cheerio from 'cheerio';

async function scrapeBSEUpcomingIPOs() {
  const url = 'https://www.bseindia.com/corporates/Forth_Coming.aspx';

  // Get initial page
  const response = await axios.get(url);
  const $ = cheerio.load(response.data);

  // Extract data from table
  const ipos: any[] = [];

  $('table.tableDataPro tbody tr').each((index, row) => {
    const cells = $(row).find('td');

    if (cells.length < 6) return; // Skip header/empty rows

    const ipo = {
      companyName: $(cells[0]).text().trim(),
      isinNumber: $(cells[1]).text().trim(),
      openDate: parseDate($(cells[2]).text().trim()),
      closeDate: parseDate($(cells[3]).text().trim()),
      issuePrice: $(cells[4]).text().trim(),
      issueSize: $(cells[5]).text().trim(),
      dataSource: 'BSE'
    };

    ipos.push(ipo);
  });

  return ipos;
}

function parseDate(dateStr: string): Date | null {
  // BSE format: "05 Jan 2025" or "05-Jan-2025"
  try {
    return new Date(dateStr);
  } catch {
    return null;
  }
}
```

### BSE PDF Documents

BSE hosts IPO documents as PDFs:

```typescript
async function downloadBSEDocument(isin: string, docType: 'DRHP' | 'RHP') {
  const url = `https://www.bseindia.com/downloads/prospectus/${isin}_${docType}.pdf`;

  const response = await axios.get(url, { responseType: 'stream' });

  const filename = `${isin}_${docType}.pdf`;
  const writer = fs.createWriteStream(`./documents/${filename}`);

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(filename));
    writer.on('error', reject);
  });
}
```

---

## Moneycontrol Scraping

Moneycontrol is good for discovering upcoming IPOs early.

### Moneycontrol IPO Page

```
URL: https://www.moneycontrol.com/ipo/ipo-snapshot/upcoming
Method: GET (HTML scraping)
Success Rate: 80%
```

### Data Available

- Company name
- Expected open/close dates (tentative)
- Issue size
- Price band (if announced)
- Lead managers
- News and updates

### Scraping Code

```typescript
async function scrapeMoneycontrolIPOs() {
  const url = 'https://www.moneycontrol.com/ipo/ipo-snapshot/upcoming';
  const response = await axios.get(url);
  const $ = cheerio.load(response.data);

  const ipos: any[] = [];

  $('.tbl_brdr tbody tr').each((index, row) => {
    const cells = $(row).find('td');

    const ipo = {
      companyName: $(cells[0]).find('a').text().trim(),
      openDate: parseDate($(cells[1]).text().trim()),
      closeDate: parseDate($(cells[2]).text().trim()),
      issueSize: $(cells[3]).text().trim(),
      priceRange: $(cells[4]).text().trim(),
      dataSource: 'MONEYCONTROL'
    };

    ipos.push(ipo);
  });

  return ipos;
}
```

---

## Chittorgarh GMP Scraping

Chittorgarh specializes in Grey Market Premium data.

### Chittorgarh GMP Page

```
URL: https://www.chittorgarh.com/ipo/ipo_grey_market_premium.asp
Method: GET (HTML scraping)
Success Rate: 90%
```

### GMP Data Fields

- Company name
- IPO price
- GMP value (₹)
- GMP premium (%)
- Expected listing price
- Last updated timestamp

### Scraping Code

```typescript
async function scrapeChittorgarhGMP() {
  const url = 'https://www.chittorgarh.com/ipo/ipo_grey_market_premium.asp';
  const response = await axios.get(url);
  const $ = cheerio.load(response.data);

  const gmpData: any[] = [];

  $('table.table tbody tr').each((index, row) => {
    const cells = $(row).find('td');

    if (cells.length < 7) return;

    const gmp = {
      companyName: $(cells[0]).text().trim(),
      ipoPrice: parseFloat($(cells[1]).text().replace(/[^0-9.]/g, '')),
      gmpValue: parseFloat($(cells[2]).text().replace(/[^0-9.]/g, '')),
      gmpPremium: parseFloat($(cells[3]).text().replace(/[^0-9.]/g, '')),
      expectedListing: parseFloat($(cells[4]).text().replace(/[^0-9.]/g, '')),
      lastUpdated: new Date($(cells[6]).text().trim()),
      dataSource: 'CHITTORGARH'
    };

    gmpData.push(gmp);
  });

  return gmpData;
}
```

---

## Data Validation with Zod

All scraped data is validated with Zod schemas before database insertion.

### IPO Validation Schema

```typescript
import { z } from 'zod';

const IPOSchema = z.object({
  companyName: z.string().min(1, 'Company name required'),
  slug: z.string().min(1),
  segment: z.enum(['MAINBOARD', 'SME']).nullable(),
  offeringType: z.enum(['IPO', 'RIGHTS', 'FPO', 'InvIT', 'REIT']),
  status: z.enum(['UPCOMING', 'OPEN', 'CLOSED', 'LISTED']),

  // Dates
  openDate: z.date().nullable(),
  closeDate: z.date().nullable(),
  listingDate: z.date().nullable(),

  // Pricing
  priceRangeLow: z.number().positive().nullable(),
  priceRangeHigh: z.number().positive().nullable(),
  lotSize: z.number().int().positive().nullable(),

  // Size
  issueSize: z.number().positive().nullable(),

  // Source
  dataSource: z.enum(['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH', 'API_FALLBACK']),
});

// Validate before insert
function validateAndInsert(data: any) {
  try {
    const validated = IPOSchema.parse(data);
    return insertIPO(validated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Validation failed:', error.errors);
      // Log for manual review
      logValidationError(data, error);
    }
    throw error;
  }
}
```

### Subscription Validation Schema

```typescript
const SubscriptionSchema = z.object({
  ipoId: z.string().uuid(),
  category: z.enum(['QIB', 'NII', 'RETAIL', 'EMPLOYEE', 'OTHERS', 'TOTAL']),
  timesSubscribed: z.number().nonnegative(),
  sharesBid: z.number().nonnegative().nullable(),
  sharesOffered: z.number().nonnegative().nullable(),
  applicationsReceived: z.number().int().nonnegative().nullable(),
  recordDate: z.date(),
  dataSource: z.string(),
});
```

---

## Multi-Source Data Merging

When multiple sources provide data for the same IPO:

### Merge Algorithm

```typescript
function mergeIPOData(sources: Array<{source: string, data: Partial<IPO>}>): IPO {
  const merged: Partial<IPO> = {};

  // Define priority order
  const priorityOrder = ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH'];

  // For each field, use highest priority source
  const fields = [
    'companyName', 'slug', 'segment', 'status',
    'openDate', 'closeDate', 'listingDate',
    'priceRangeLow', 'priceRangeHigh', 'lotSize',
    'issueSize', 'isinNumber', 'registrar'
  ];

  for (const field of fields) {
    for (const priority of priorityOrder) {
      const source = sources.find(s => s.source === priority);
      if (source && source.data[field] !== null && source.data[field] !== undefined) {
        merged[field] = source.data[field];
        merged[`${field}Source`] = priority; // Track source per field
        break;
      }
    }
  }

  return merged as IPO;
}
```

### Field-Level Tracking

Store which source provided each field:

```typescript
// Example merged IPO
{
  companyName: 'XYZ Corp',
  companyNameSource: 'NSE',

  priceRangeLow: 350,
  priceRangeLowSource: 'DRHP', // DRHP overrode NSE

  lotSize: 40,
  lotSizeSource: 'NSE',

  // ... other fields
}
```

---

## Error Handling & Retry Logic

### Retry Configuration

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000,     // 1 second
  maxDelay: 10000,        // 10 seconds
  multiplier: 2,          // Exponential backoff
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'],
};

async function scrapeWithRetry(scraper: () => Promise<any>) {
  let lastError: Error;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await scraper();
    } catch (error) {
      lastError = error;

      // Check if retryable
      const isRetryable =
        RETRY_CONFIG.retryableStatuses.includes(error.response?.status) ||
        RETRY_CONFIG.retryableErrors.includes(error.code);

      if (!isRetryable || attempt === RETRY_CONFIG.maxRetries) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        RETRY_CONFIG.initialDelay * Math.pow(RETRY_CONFIG.multiplier, attempt - 1),
        RETRY_CONFIG.maxDelay
      );

      console.log(`Retry attempt ${attempt}/${RETRY_CONFIG.maxRetries} after ${delay}ms`);
      await sleep(delay);
    }
  }

  throw lastError!;
}
```

### Logging & Monitoring

```typescript
// Log all scraper runs
async function logScraperRun(source: string, success: boolean, error?: Error) {
  await db.insert(scraperLogs).values({
    source,
    success,
    errorMessage: error?.message,
    errorStack: error?.stack,
    timestamp: new Date(),
  });
}

// Usage
try {
  const data = await scrapeNSE();
  await logScraperRun('NSE', true);
  return data;
} catch (error) {
  await logScraperRun('NSE', false, error);
  throw error;
}
```

---

## Scraper Scheduling

Scrapers run on a schedule using cron patterns.

### Cron Configuration

```typescript
// Location: scraper/src/scheduler/cron-config.ts

const SCRAPER_SCHEDULE = {
  // Real-time during market hours (9:15 AM - 3:30 PM IST)
  subscriptionUpdates: '*/3 9-15 * * 1-5',  // Every 3 minutes, Mon-Fri, 9 AM-3 PM

  // Multiple times daily
  nseCurrentIssues: '0 */6 * * *',          // Every 6 hours
  bseUpcoming: '0 8,14,20 * * *',           // 8 AM, 2 PM, 8 PM
  gmpUpdates: '0 */4 * * *',                // Every 4 hours

  // Once daily
  moneycontrolUpcoming: '0 7 * * *',        // 7 AM daily
  documentDownload: '0 2 * * *',            // 2 AM daily (low traffic)

  // Weekly
  dataQualityCheck: '0 3 * * 0',            // 3 AM Sunday
};
```

---

## Best Practices

### 1. Always Use User-Agent

```typescript
// ✅ Good
headers: {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

// ❌ Bad (will be blocked)
headers: {} // Default axios user-agent = blocked
```

### 2. Respect Rate Limits

```typescript
// Wait between requests
await sleep(Math.random() * 2000 + 1000); // 1-3 seconds

// Use queue for multiple requests
const queue = new PQueue({ concurrency: 1, interval: 2000 });
```

### 3. Handle Partial Failures

```typescript
// Continue even if one IPO fails
for (const ipoData of scrapedData) {
  try {
    await processIPO(ipoData);
  } catch (error) {
    console.error(`Failed to process ${ipoData.companyName}:`, error);
    // Log and continue
  }
}
```

### 4. Validate Before Insert

```typescript
// Always validate with Zod
const validated = IPOSchema.parse(data);
await insertIPO(validated);
```

### 5. Track Data Sources

```typescript
// Always set dataSource
await db.insert(ipos).values({
  ...ipoData,
  dataSource: 'NSE',
  scrapedAt: new Date()
});
```

---

## References

- **Scraper Architecture:** `scraper/README.md`
- **Scraping Strategy:** `scraper/docs/SCRAPING_STRATEGY.md`
- **NSE API Guide:** `scraper/docs/NSE_API_GUIDE.md`
- **Data Quality:** `scraper/docs/LOT_SIZE_EXECUTIVE_SUMMARY.md`

---

**Note:** Web scraping requires careful error handling, rate limiting, and respect for website terms of service. Always have fallback strategies and never scrape more aggressively than necessary.
