# IPODhan Revised Implementation Roadmap

**Version:** 2.0 (Post-PO Validation)
**Date:** 2025-10-05
**Status:** ✅ Ready for Development

---

## ⚠️ Key Changes from Original Roadmap

### 🔴 Critical Fixes Applied:
1. **Testing infrastructure moved to Week 1** (was missing)
2. **CI/CD pipeline moved to Week 2** (was Week 12)
3. **Repository layer explicitly added to Week 2** (was missing)
4. **5 missing PRD features added** (FR-4, FR-8, FR-9, FR-10, FR-11)
5. **shadcn/ui installation added to Week 1** (was implicit)
6. **Dependencies explicitly sequenced** (prevents parallel work on blocked stories)

### 📊 Timeline Impact:
- **Original:** 12 weeks
- **Revised:** 14-15 weeks (realistic with all features)
- **Reason:** Proper dependency sequencing reveals 20-25% more work

---

## Phase 0: Prep Work (3-4 days) - NEW

**Goal:** Transform roadmap into executable epic/story structure

### Tasks
- [x] Create epic structure (Epic 1-8) - DONE
- [x] Write all stories with acceptance criteria - DONE
- [x] Map dependencies between stories - DONE
- [x] Create dependency matrix - DONE
- [x] Create story template - DONE
- [ ] PO review and approval

### Deliverables
- ✅ 8 epic overview files in `docs/stories/epics/`
- ✅ 40 story definitions with acceptance criteria
- ✅ Dependency matrix (DEPENDENCY-MATRIX.md)
- ✅ Story index (STORY-INDEX.md)
- ✅ Story template for future use

**Status:** ✅ COMPLETE - Ready for development

---

## Week 1-2: Epic 1 - Foundation & Infrastructure (18 points)

### Week 1, Day 1-2
**Story 1.1:** Next.js Project Setup ✅ **DONE**
- Already complete (web/ directory exists)

**Story 1.2:** Database Infrastructure (3 hours)
- Install PostgreSQL 16
- Create "ipodhan" database
- Create database user with permissions
- Test connection from Next.js

**Story 1.3:** Core Dependencies (2 hours)
- Install Drizzle ORM, Zod, Pino, ioredis
- Configure package.json
- Verify no dependency conflicts

**Story 1.4:** shadcn/ui Setup (3 hours) - ⚠️ NEW
- Install shadcn/ui CLI
- Configure components.json
- Install base components (Button, Card, Dialog, Input, Select, Badge)
- Configure theme from PRD color palette

### Week 1, Day 3-5
**Story 1.5:** Testing Infrastructure (6 hours) - 🔴 CRITICAL NEW
- Install Vitest and @testing-library/react
- Install Playwright for E2E
- Configure test scripts (test:unit, test:e2e, test:coverage)
- Write sample unit test (must pass)
- Write sample E2E test (must pass)
- Configure coverage reporting

### Week 2, Day 1-2
**Story 1.6:** CI/CD Pipeline (4 hours) - 🔴 MOVED FROM WEEK 12
- Create .github/workflows/ci.yml
- Workflow: lint → type-check → test → build
- Configure PR checks (must pass to merge)
- Test workflow with sample PR

---

## Week 2-3: Epic 2 - Data Layer (19 points)

### Week 2, Day 3-4
**Story 2.1:** Database Schema (6 hours)
- Create schema.sql with all tables (10 tables from Architecture)
- Add indexes (slug, status, company name trigram)
- Add constraints (foreign keys, unique)
- Document schema in Architecture.md if needed

**Story 2.2:** Drizzle Migrations (4 hours)
- Configure Drizzle migration system
- Create initial migration from schema
- Run migration successfully
- Test rollback procedure

### Week 2, Day 5 - Week 3, Day 1-2
**Story 2.3:** Repository Layer (10 hours) - 🔴 CRITICAL PATH
- Create IPORepository with cache-aside pattern
- Create SubscriptionRepository
- Create GMPRepository
- Create FinancialRepository
- Implement Redis caching (15min detail, 5min list)
- Unit tests >85% coverage
- Integration tests with real DB + Redis

⚠️ **BLOCKER ALERT:** This story blocks 8 downstream stories. MUST complete by end of Week 2.

### Week 3, Day 2
**Story 2.4:** Seed Data Script (4 hours)
- Create seed script with 20+ sample IPOs
- Include all relationships (financials, subscriptions, GMP)
- Verify data loads correctly
- Document seed data in README

---

## Week 3-4: Epic 3 - IPO Listing (34 points)

### Week 3, Day 3
**Story 3.1:** API Client Service (4 hours)
- Create lib/api-client.ts
- Methods: getIPOs, getIPOBySlug, search
- Error handling with APIError class
- Zod validation for responses

### Week 3, Day 4
**Story 3.2:** GET /api/ipos Route (6 hours)
- Create app/api/ipos/route.ts
- Query params: status, category, sector, search, page, limit
- Use IPORepository.findAll
- Return paginated response
- Cache with Redis (5 min TTL)

### Week 3, Day 5 - Week 4, Day 1
**Story 3.3:** IPO Card Component (8 hours)
- Create components/ipo/IPOCard.tsx
- Display: name, status, price range, dates, rating
- Responsive layout (mobile, tablet, desktop)
- Hover effects and click handling
- Unit tests

### Week 4, Day 2-3
**Story 3.4:** Dashboard Page (10 hours) - 🔴 CRITICAL PATH
- Create app/page.tsx (homepage)
- Server-side render with initial IPO data
- Use IPO Card grid (1/2/3 columns)
- Loading skeleton states
- Error boundary
- E2E test: user visits, sees IPOs

⚠️ **DEPENDENCY:** Requires 3.1, 3.2, 3.3 complete

### Week 4, Day 4
**Story 3.5:** Filter Logic (6 hours)
- Create FilterSidebar component
- Filters: Status, Category, Sector, Date range
- State management (React Context)
- Sync filters to URL query params
- Client-side filtering for MVP

**Story 3.6:** Search Implementation (6 hours)
- Create SearchBar component
- Debounced input (500ms)
- Dropdown with top 5 results
- Keyboard navigation
- "View all" link

### Week 4, Day 5
**Story 3.7:** Loading & Error States (4 hours)
- Loading skeletons for dashboard
- Error page component
- Empty state (no IPOs found)
- Retry logic for failed requests

---

## Week 5-6: Epic 4 - IPO Detail (33 points)

### Week 5, Day 1
**Story 4.1:** GET /api/ipos/[slug] Route (6 hours)
- Create app/api/ipos/[slug]/route.ts
- Fetch IPO with all relations (financials, docs, subscription, GMP, peers)
- Use IPORepository.findBySlug
- Cache with Redis (15 min TTL)
- Return 404 if not found

### Week 5, Day 2-4
**Story 4.2:** Detail Page Components (12 hours)
- KeyDetailsCard component (price, dates, lot size)
- TimelineComponent (visual dates)
- SubscriptionWidget (QIB/NII/Retail breakdown)
- GMPDisplay (current + 7-day trend chart)
- CompanyOverview (business model, risk factors)
- DocumentsSection (DRHP, RHP download links)
- All components responsive

### Week 5, Day 5 - Week 6, Day 1-2
**Story 4.3:** IPO Detail Page Assembly (10 hours) - 🔴 CRITICAL PATH
- Create app/ipos/[slug]/page.tsx
- Server-side render Tier 1 data
- Client-side lazy load Tier 2 (tabs)
- Integrate all components
- SEO: Meta tags, structured data (JSON-LD)
- Performance: LCP <2.5s

⚠️ **DEPENDENCY:** Requires 3.1, 4.1, 4.2

### Week 6, Day 3
**Story 4.4:** Rating System (6 hours)
- Implement rating algorithm (subscription 30%, promoter 20%, financials 20%, GMP 15%, peers 15%)
- Calculate 1-5 star rating
- Generate rationale text
- Display rating badge on detail page
- Admin override capability (Phase 2)

**Story 4.5:** Social Share (2 hours)
- Add share buttons (WhatsApp, Twitter, Copy Link)
- Open Graph meta tags
- Twitter Card meta tags
- Test sharing on mobile

### Week 6, Day 4
**Story 4.6:** Allotment Checker (6 hours) - ⚠️ NEW (FR-4)
- Display registrar information from database
- Link to registrar's allotment page
- Step-by-step guide to check status
- Registrar contact details (email, phone)

---

## Week 7: Epic 5 & 6 - Tools + Historical (32 points)

**Note:** Epics 5 and 6 can run in parallel (no blocking dependencies)

### Epic 5: Tools (19 points)

#### Week 7, Day 1
**Story 5.3:** Registrar Directory (4 hours) - ⚠️ NEW (FR-9)
- Create app/registrars/page.tsx
- List all registrars from database
- Search functionality
- Display: name, email, phone, website, allotment link
- Responsive table/card view

**Story 5.4:** Market Holidays (4 hours) - ⚠️ NEW (FR-8)
- Create app/market-holidays/page.tsx
- Calendar view (month/year filter)
- List view (upcoming holidays)
- Highlight NSE/BSE specific
- Filter by exchange

#### Week 7, Day 2
**Story 5.1:** Lot Calculator (4 hours) - ⚠️ NEW (FR-10)
- Create components/tools/LotCalculator.tsx
- Input: investment amount
- Calculate: lots, shares, total
- Embed in detail page
- Standalone page: /tools/lot-calculator

#### Week 7, Day 3
**Story 5.2:** IPO Comparison Tool (6 hours) - ⚠️ NEW (FR-11)
- Create app/tools/compare/page.tsx
- Select up to 3 IPOs (dropdown)
- Comparison table (price, subscription, GMP, financials, rating)
- Shareable URL: /tools/compare?ipos=slug1,slug2
- Responsive layout

#### Week 7, Day 4
**Story 5.5:** Broker Affiliates (6 hours)
- Create affiliate config (Zerodha, AngelOne links)
- BrokerButton component
- AffiliateCTA component
- Add to detail pages
- Click tracking (Google Analytics event)
- Affiliate disclosure in footer

### Epic 6: Historical (13 points)

#### Week 7, Day 1-2 (parallel with 5.3, 5.4)
**Story 6.1:** Historical IPOs API (4 hours)
- Create app/api/ipos/history/route.ts
- Query params: year, sector, performance, sort
- Use IPORepository with status=LISTED filter
- Return listing performance data

**Story 6.2:** History Page (6 hours)
- Create app/history/page.tsx
- Reuse IPO Card component (3.3)
- Filters: Year, Sector, Performance
- Sort: Listing date, gain %, subscription
- Pagination (20 per page)

#### Week 7, Day 3 (parallel with 5.2)
**Story 6.3:** Listing Performance (4 hours)
- Display listing gain % (color coded)
- Current price (if <1 year) - Phase 2
- Performance chart - Phase 2
- SEO: Structured data for historical IPO

---

## Week 8: Buffer & Responsive Polish

**Goal:** Catch up on any slipped stories, test responsiveness, fix bugs

### Tasks
- [ ] Complete any incomplete stories from Week 7
- [ ] End-to-end responsive testing (iPhone, iPad, Desktop)
- [ ] Fix layout issues on mobile
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge)
- [ ] Performance profiling (identify bottlenecks)
- [ ] Bug fixes from QA testing

### Deliverables
- All Epics 1-6 fully complete
- Zero critical bugs
- Responsive on all devices
- Performance baseline established

---

## Week 9-10: Epic 7 - Data Pipeline (27 points)

### Week 9, Day 1-3
**Story 7.1:** NSE Scraper (12 hours)
- Create scraper/src/scrapers/nse-scraper.ts
- Use Puppeteer for JavaScript-rendered pages
- Extract IPO data from NSE website
- Validate with Zod schemas
- Retry logic (3 attempts, exponential backoff)
- Unit tests with mock browser

**Story 7.2:** BSE Scraper (12 hours)
- Create scraper/src/scrapers/bse-scraper.ts
- Use Cheerio if static HTML (or Puppeteer if needed)
- Extract SME and mainboard IPOs
- Cross-reference with NSE data
- Unit tests

### Week 9, Day 4-5
**Story 7.3:** IPO Alerts API Fallback (4 hours)
- Create scraper/src/scrapers/ipo-alerts-api.ts
- Fallback when NSE/BSE scraping fails 3+ times
- Rate limit handling (100 req/hour)
- Data merging logic (prioritize exchange data)

### Week 10, Day 1-2
**Story 7.4:** Scheduler & Cache Invalidation (8 hours)
- Create scraper/src/services/scheduler.ts
- Node-cron: every 15min (market hours), 30min (after hours)
- On successful scrape:
  - Upsert data to database via repositories
  - Invalidate Redis cache keys
  - Update "Last Updated" timestamp
- Error logging to database table

### Week 10, Day 3
**Story 7.5:** Error Handling & Monitoring (4 hours)
- Implement retry logic with exponential backoff
- Alert on 3+ consecutive failures (email)
- Scraper logs in database (scraper_logs table)
- Daily summary report (success/failure stats)
- Graceful degradation (show last known data)

---

## Week 11-12: Epic 8 - Production Readiness (26 points)

### Week 11, Day 1-3
**Story 8.1:** Comprehensive Testing (12 hours)
- E2E tests for 5 critical user journeys:
  1. Browse → Filter → Detail
  2. Search → Detail → Share
  3. Historical research
  4. Calculator usage
  5. Comparison tool
- Cross-browser testing (Chrome, Firefox, Safari, Edge)
- Mobile testing (iOS Safari, Chrome Mobile)
- Load testing (Artillery: 1000 concurrent users)
- Fix all critical bugs

### Week 11, Day 4-5
**Story 8.2:** SEO Optimization (8 hours)
- Meta tags (title, description) for all pages
- Open Graph tags (social sharing)
- Structured data (JSON-LD):
  - Organization (homepage)
  - IPO entity (detail pages)
  - BreadcrumbList (navigation)
- XML sitemap generation (/sitemap.xml)
- Robots.txt configuration
- Image optimization (WebP, lazy loading)
- Internal linking strategy

**Story 8.3:** Performance Optimization (8 hours)
- Bundle optimization (code splitting, tree shaking)
- Database query optimization (add missing indexes)
- Redis caching tuning (hit rate >80%)
- Image optimization (next/image, WebP)
- Font optimization (next/font, preload)
- Cloudflare caching rules
- Target: Lighthouse Performance >90, LCP <2.5s

### Week 12, Day 1-2
**Story 8.4:** Production Deployment (8 hours)
- Build production bundles (web + scraper)
- Upload to Windows VPS via SCP
- Configure PM2:
  - ipodhan-web (2 instances, cluster mode)
  - ipodhan-scraper (1 instance, fork mode)
- Configure PostgreSQL + Redis on VPS
- Point DNS to VPS (Cloudflare)
- SSL/TLS: Full (strict) mode
- Test live site at https://ipodhan.com

### Week 12, Day 3
**Story 8.5:** Monitoring & Alerts (4 hours)
- UptimeRobot: Monitor /api/health every 5min
- Google Analytics 4 tracking setup
- PM2 monitoring dashboard
- Error logging (Pino, optional Sentry)
- Alert rules:
  - Site down 3+ min → Email + SMS
  - Error rate >5% → Email
  - Scraper failed 3+ times → Email
- Backup script (daily database backup)

---

## Week 13-14: Post-Launch (Phase 5)

### Week 13: Soft Launch
- [ ] Share with friends, family, colleagues
- [ ] Monitor Google Analytics (traffic, engagement)
- [ ] Track affiliate clicks
- [ ] Gather user feedback (form or email)
- [ ] Fix critical bugs within 24 hours
- [ ] Monitor scraper uptime (target 95%+)

### Week 14: SEO & Content
- [ ] Submit sitemap to Google Search Console
- [ ] Write 3 blog posts (educational):
  - "How to Apply for an IPO: Step-by-Step Guide"
  - "Understanding IPO Subscription Categories"
  - "What is Grey Market Premium (GMP)?"
- [ ] Share content on social media (Twitter, Reddit)
- [ ] Reach out to financial bloggers for backlinks
- [ ] Monitor search rankings for target keywords

---

## Post-MVP: Phase 2 Features (Months 4-6)

Deferred to Phase 2 (3-6 months after launch):
1. ✉️ Email Alert System (FR-7)
2. 📰 IPO News & Updates
3. 👤 User Accounts & Portfolios
4. 📊 SME IPO Coverage (expanded)
5. 🔍 Advanced Filtering
6. 📈 Enhanced Analytics
7. 💬 Community Features
8. 📱 Mobile App (PWA)

---

## Summary: Roadmap Comparison

| Metric | Original Roadmap | Revised Roadmap | Change |
|--------|------------------|-----------------|--------|
| **Duration** | 12 weeks | 14-15 weeks | +2-3 weeks |
| **Story Count** | ~30 (implicit) | 40 (explicit) | +10 stories |
| **Story Points** | ~140 (estimated) | 184 (calculated) | +44 points |
| **Testing Setup** | Week 11 (late) | Week 1 (early) | 🔴 Critical fix |
| **CI/CD Pipeline** | Week 12 | Week 2 | 🔴 Critical fix |
| **Repository Layer** | Implicit | Explicit (Week 2) | 🔴 Critical fix |
| **Missing Features** | 5 (FR-4,8,9,10,11) | 0 (all added) | ✅ Complete |
| **Dependency Mapping** | None | Full matrix | ✅ Complete |

---

## Next Steps

1. **✅ PO Approval** - Sarah reviews and approves revised roadmap
2. **Sprint Planning** - Break Week 1-2 into daily tasks
3. **Team Assignment** - Assign developers to critical path stories
4. **Kickoff Meeting** - Review epic structure, dependencies, definition of done
5. **Begin Development** - Start with Story 1.2 (Database Infrastructure)

---

**Roadmap Status:** ✅ Ready for Implementation
**Last Updated:** 2025-10-05
**Next Review:** End of Week 2 (validate velocity)
