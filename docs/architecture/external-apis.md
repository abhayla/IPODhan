# External APIs

## IPO Alerts API

- **Purpose:** Fallback/supplementary data source for IPO listings
- **Documentation:** https://api.ipoalerts.in/docs
- **Base URL:** `https://api.ipoalerts.in`
- **Rate Limits:** Assumed 100 requests/hour (verify with provider)
- **Key Endpoints:**
  - `GET /ipos?status=open` - Fetch currently open IPOs
  - `GET /ipos?status=upcoming` - Fetch upcoming IPOs
  - `GET /ipos/{id}` - Get detailed IPO information

**Integration Notes:** Use as secondary source; NSE/BSE scraping is primary. Cross-reference data to detect discrepancies. Handle API downtime gracefully.

## NSE India Website (Web Scraping)

- **Purpose:** Primary source for real-time subscription data and IPO announcements
- **Base URL:** `https://www.nseindia.com/`
- **Authentication:** None (public website), requires proper headers
- **Key Endpoints:**
  - `/market-data/public-issues` - Current and upcoming IPO listings

**Integration Notes:** Use Puppeteer for JavaScript-heavy pages. Implement stealth plugin to avoid detection. Exponential backoff on errors. Fallback to IPO Alerts API if scraping fails 3+ consecutive times.

## BSE India Website (Web Scraping)

- **Purpose:** Primary source for BSE-listed IPOs and SME IPO coverage
- **Base URL:** `https://www.bseindia.com/`
- **Key Endpoints:**
  - `/publicissue.html` - IPO listings with subscription status

**Integration Notes:** BSE critical for SME IPO coverage. May use Cheerio for static pages to improve performance.

## Resend API

- **Purpose:** Transactional email delivery
- **Documentation:** https://resend.com/docs
- **Base URL:** `https://api.resend.com`
- **Authentication:** API key (header: `Authorization: Bearer <key>`)
- **Rate Limits:** Free tier: 3,000 emails/month, 100 emails/day

**Integration Notes:** Use React Email for templating. Non-blocking error handling. Monitor bounce rate and spam complaints.

## Google Analytics 4 (GA4)

- **Purpose:** Web analytics, user behavior tracking
- **Documentation:** https://developers.google.com/analytics/devguides/collection/ga4
- **Authentication:** Measurement ID

**Integration Notes:** Track pageviews, events (IPO card clicks, tab switches), custom dimensions (IPO status, category, sector). Implement cookie consent banner for GDPR compliance.

---
