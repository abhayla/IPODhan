# External APIs

## NSE/BSE Data API

- **Purpose:** Official IPO data including subscription status
- **Documentation:** Custom scraping required (no public API)
- **Base URL(s):** https://www.nseindia.com, https://www.bseindia.com
- **Authentication:** None (public data)
- **Rate Limits:** Respectful scraping - 1 request per 30 seconds

**Key Endpoints Used:**
- `GET /market-data/all-upcoming-issues-ipo` - Fetch upcoming IPOs
- `GET /api/ipo-subscription-status` - Get live subscription data

**Integration Notes:** Implement fallback scraping with Puppeteer if direct API fails

## WhatsApp Business API (Twilio)

- **Purpose:** Send IPO alerts and enable two-way communication
- **Documentation:** https://www.twilio.com/docs/whatsapp
- **Base URL(s):** https://api.twilio.com
- **Authentication:** Account SID + Auth Token
- **Rate Limits:** 1000 messages per second (business verified)

**Key Endpoints Used:**
- `POST /Messages` - Send WhatsApp messages
- `POST /Webhooks` - Receive incoming messages

**Integration Notes:** Template pre-approval required for broadcast messages

## IPOWatch GMP API

- **Purpose:** Grey Market Premium data collection
- **Documentation:** No official API - web scraping required
- **Base URL(s):** https://www.ipowatch.in
- **Authentication:** None
- **Rate Limits:** Every 30 minutes during market hours

**Key Endpoints Used:**
- Web scraping of GMP table page
- Historical GMP data extraction

**Integration Notes:** Implement multiple source fallbacks for reliability

## Broker APIs (Zerodha, Dhan, Upstox)

- **Purpose:** Enable in-app IPO applications (Phase 2)
- **Documentation:** Partner API documentation required
- **Base URL(s):** Various per broker
- **Authentication:** OAuth2 per broker
- **Rate Limits:** Varies by broker partnership

**Key Endpoints Used:**
- `POST /ipo/apply` - Submit IPO application
- `GET /ipo/status` - Check application status

**Integration Notes:** Requires partnership agreements and sandbox testing
