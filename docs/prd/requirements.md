# Requirements

### Functional Requirements

**Stage 1: Web Platform + API + WhatsApp MVP (Month 1-3)**

*Core Platform Features:*
- **FR1:** Web dashboard displaying Live/Upcoming/Closed IPOs with real-time updates from NSE/BSE feeds
- **FR2:** Calculate and display IPODhan Score (0-100) using comprehensive weighted algorithm
- **FR3:** IPO detail pages with score breakdown, subscription status, GMP tracking, and key financials
- **FR4:** Morning digest feature aggregating overnight changes, today's actions, market sentiment
- **FR5:** IPO watchlist for users to track selected IPOs with customizable alerts
- **FR6:** Basic search and filters (mainboard/SME, date range, sector, score range)

*WhatsApp Integration:*
- **FR7:** WhatsApp Business API integration for push notifications and alerts
- **FR8:** Daily broadcast with IPO verdicts: "[Name] ✅ Apply (Score: X/100)" or "❌ Skip"
- **FR9:** Subscription-based WhatsApp alerts (₹29-49/month) for GMP updates, deadlines

*API Infrastructure:*
- **FR10:** REST API endpoints for IPO scores, subscription data, GMP (B2B partnerships)
- **FR11:** API authentication with tiered access (₹10K-₹2L/month pricing tiers)
- **FR12:** Webhook support for real-time updates to partner platforms

**Stage 2: Full Platform Enhancement (Month 4-9)**

- **FR13:** IPO Report Cards with A-F grades analyzing post-listing performance
- **FR14:** Comprehensive broker comparison module with detailed fee structures
- **FR15:** Demat account opening facilitation through affiliate partnerships
- **FR16:** Allotment probability calculator based on historical data and current subscription
- **FR17:** ROI calculator for expected vs actual returns analysis
- **FR18:** In-app IPO application capability via broker APIs (Zerodha, Dhan, Upstox)
- **FR19:** Portfolio tracker for IPO investments with performance analytics
- **FR20:** Knowledge hub with guides, SEBI rules, educational content
- **FR21:** Community forums for IPO discussions (moderated)
- **FR22:** Mobile apps (iOS/Android) using React Native

### Non-Functional Requirements

**Performance & Scale**
- **NFR1:** Page load time <2 seconds with CDN optimization
- **NFR2:** Support 100,000 concurrent users from launch
- **NFR3:** API response time <100ms for 95th percentile
- **NFR4:** Real-time updates via WebSockets for subscription status

**Reliability & Operations**
- **NFR5:** 99.5% uptime with auto-scaling and redundancy
- **NFR6:** WhatsApp message delivery rate >95%
- **NFR7:** Daily automated backups with 30-day retention
- **NFR8:** Comprehensive error logging and monitoring

**Business Metrics**
- **NFR9:** Customer acquisition cost <₹50 for direct users
- **NFR10:** IPODhan Score accuracy >70% correlation with listing performance
- **NFR11:** Support tickets <1% of user base
- **NFR12:** Weekly Active Decision Makers as north star metric

**Security & Compliance**
- **NFR13:** SEBI regulatory compliance for all recommendations
- **NFR14:** HTTPS/TLS encryption for all communications
- **NFR15:** OAuth2 + 2FA for user authentication
- **NFR16:** Transparent affiliate disclosures
- **NFR17:** GDPR-compliant privacy practices

---
