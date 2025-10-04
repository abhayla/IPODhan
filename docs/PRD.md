# Product Requirements Document (PRD): IPODhan

**Version:** 1.1
**Date:** January 2025
**Status:** Draft
**Owner:** Development Team

---

## Table of Contents

1. [Product Overview](#product-overview)
2. [Goals & Success Metrics](#goals--success-metrics)
3. [User Personas & Use Cases](#user-personas--use-cases)
4. [Functional Requirements](#functional-requirements)
5. [Non-Functional Requirements](#non-functional-requirements)
6. [Technical Architecture](#technical-architecture)
7. [Data Requirements](#data-requirements)
8. [User Interface Specifications](#user-interface-specifications)
9. [Implementation Roadmap](#implementation-roadmap)
10. [Risk Management](#risk-management)
11. [Appendices](#appendices)

---

## Product Overview

### Executive Summary

IPODhan is a high-performance, self-hosted web platform that provides Indian retail investors with comprehensive, real-time tracking and analysis of IPOs, SME IPOs, Rights Issues, and NCDs (Non-Convertible Debentures). Built on modern web technologies (Next.js, PostgreSQL), the platform addresses critical gaps in the current investment information landscape by delivering fast, reliable, and consolidated data across multiple investment categories in a clean, user-friendly interface.

### Problem Statement

Indian retail investors face significant challenges when researching IPO opportunities:

- **Fragmented Information**: IPO data scattered across NSE, BSE, news sites, and broker platforms
- **Poor User Experience**: Existing platforms (Chittorgarh, InvestorGain) suffer from slow load times, cluttered interfaces, and excessive advertisements
- **Unreliable Access**: Competitor sites experience frequent downtime during high-traffic IPO periods
- **Analysis Difficulty**: Novice investors struggle to interpret DRHP documents and subscription data without accessible guidance
- **Missed Opportunities**: Tight IPO timelines (3-5 days) combined with late information discovery lead to missed investment opportunities

### Product Vision

IPODhan will become the trusted, go-to platform for Indian retail IPO investors—known for exceptional reliability, speed, and comprehensive data. The platform empowers both novice and experienced investors to make informed IPO decisions through consolidated information, intuitive analysis tools, and timely alerts.

### Key Differentiators

1. **Performance-First Architecture**: Sub-2-second page loads via Next.js SSR/SSG and optimized database queries
2. **Clean User Experience**: Distraction-free interface with non-intrusive broker affiliate links (Zerodha, AngelOne)
3. **Reliable Infrastructure**: Self-hosted on dedicated VPS with 99.5%+ uptime target
4. **Modern Technology Stack**: Next.js 14+ and PostgreSQL for scalability and maintainability
5. **Consolidated Data**: Single source for Mainboard IPOs, SME IPOs, Rights Issues, NCDs, subscription status, GMP, and historical performance
6. **Mobile-First Design**: Optimized for mobile users representing 50%+ of target audience
7. **Multi-Category Coverage**: Comprehensive tracking of IPOs, SME IPOs, Rights Issues, and NCD issues in one platform

---

## Goals & Success Metrics

### Business Objectives

| Objective | Target | Timeline |
|-----------|--------|----------|
| Launch MVP | Core IPO tracking features live | 3 months |
| Monthly Active Users | 1,000 MAU | 6 months post-launch |
| User Growth Rate | 20% month-over-month | Ongoing |
| Email Subscribers | 5,000+ subscribers | 6 months post-launch |
| Broker Affiliate Integration | Zerodha & AngelOne partnerships live | 3 months post-launch |
| Affiliate Conversion Rate | 5%+ of users click affiliate links | 6 months post-launch |

### User Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time to Information | < 30 seconds to find key IPO details | User testing, analytics |
| Return Visitor Rate | 60%+ users return | Google Analytics |
| Mobile Usage | 50%+ traffic from mobile | Google Analytics |
| Session Duration | > 3 minutes average | Google Analytics |
| Alert Signup Rate | 30%+ visitors subscribe | Conversion tracking |

### Key Performance Indicators (KPIs)

| KPI | Target | Baseline (Competitors) |
|-----|--------|----------------------|
| Page Load Time | < 2 seconds | 5-10 seconds |
| Uptime | 99.5%+ during IPO periods | Variable |
| Data Freshness | Updated within 15 minutes | 30-60 minutes |
| Search Ranking | Page 1 for "upcoming IPO India" | N/A |
| User Acquisition Cost | $0 (organic only) | N/A |

---

## User Personas & Use Cases

### Primary Persona: Active Retail IPO Investor (Rahul)

**Demographics:**
- Age: 32 years
- Location: Pune, India
- Occupation: Software Engineer
- Income: ₹12 LPA
- Investment Experience: 3 years in stock market
- IPO Participation: Applies to 5-8 IPOs per year

**Behaviors:**
- Checks IPO updates during commute and lunch breaks (mobile-heavy)
- Monitors financial news sites and WhatsApp groups for IPO announcements
- Spends 1-2 hours researching each IPO before applying
- Cross-references Chittorgarh, Moneycontrol, and broker apps
- Values speed and accuracy over extensive editorial content

**Pain Points:**
- Wastes time aggregating data from 3-4 different sources
- Frustrated by slow-loading, ad-heavy competitor websites on mobile
- Sometimes misses IPO closing deadlines due to poor tracking
- Uncertain about interpreting subscription numbers and GMP trends

**Goals:**
- Quickly identify which upcoming IPOs are worth detailed research
- Access reliable, real-time subscription status and GMP data
- Make informed application decisions within tight timelines
- Track allotment status and listing performance efficiently

**IPODhan Use Cases:**

1. **Morning IPO Check**
   - Opens IPODhan on mobile during commute
   - Views dashboard with current/upcoming IPOs at a glance
   - Checks subscription status for IPO closing today
   - Sets alert for listing date of recently closed IPO

2. **IPO Research**
   - Discovers new IPO announcement on social media
   - Searches for company name on IPODhan
   - Reviews comprehensive IPO page: company overview, issue details, timeline, GMP trend
   - Checks IPODhan's scoring/rating for quick guidance
   - Compares against similar historical IPOs in same sector
   - Decides to apply and saves IPO to personal watchlist (Phase 2 feature)

3. **Pre-Closing Day Check**
   - Receives email alert that favorite IPO is closing tomorrow
   - Opens IPODhan to check final subscription numbers
   - Reviews updated GMP and listing estimate
   - Makes final decision on application quantity

### Secondary Persona: IPO Newcomer (Priya)

**Demographics:**
- Age: 26 years
- Location: Bangalore, India
- Occupation: Marketing Manager
- Income: ₹7 LPA
- Investment Experience: 6 months (new to stock market)
- IPO Participation: Applied to first IPO recently

**Behaviors:**
- Learned about IPO investing through YouTube and social media
- Overwhelmed by financial jargon and complex processes
- Seeks simple, clear guidance on "should I apply?"
- Prefers educational content explaining concepts
- Uses mobile primarily for all online activities

**Pain Points:**
- Doesn't understand terms like DRHP, GMP, QIB, NII, anchor investors
- Unclear how to evaluate if an IPO is "good" or "risky"
- Confused by conflicting opinions on social media
- Intimidated by dense, technical competitor websites

**Goals:**
- Learn IPO basics in simple, accessible language
- Get straightforward recommendations on popular IPOs
- Understand the IPO application process step-by-step
- Build confidence in IPO investing decisions

**IPODhan Use Cases:**

1. **Learning About IPOs**
   - Hears about upcoming IPO from colleague
   - Googles "upcoming IPO India" and finds IPODhan
   - Lands on clean, fast-loading homepage
   - Clicks on educational section explaining IPO basics
   - Reads guide on "How to Apply for an IPO" with screenshots
   - Bookmarks IPODhan for future reference

2. **First IPO Evaluation**
   - Opens IPODhan to research trending IPO
   - Views IPO detail page with clear, organized information
   - Sees IPODhan rating: "⭐⭐⭐⭐ - Strong Demand" with simple explanation
   - Reads tooltip explaining what "Subscription: 5.2x" means
   - Checks "Should You Apply?" section with pros/cons in plain language
   - Gains confidence to apply through her broker

3. **Tracking Application**
   - Subscribes to email alerts for allotment and listing dates
   - Receives timely alert when allotment date is announced
   - Returns to IPODhan to check listing date and expected performance
   - Becomes a repeat user for future IPO research

---

## Functional Requirements

### FR-1: IPO Listings Dashboard

**Priority:** P0 (Must Have for MVP)

**Description:**
Display a comprehensive, filterable dashboard of all IPOs categorized by status (Current, Upcoming, Closed).

**User Stories:**
- As a user, I want to see all current IPOs at a glance so I can quickly identify opportunities closing soon
- As a user, I want to filter by investment category (IPO/SME/Rights/NCD), status, and sector so I can focus on relevant opportunities
- As a user, I want to search for IPOs by company name so I can quickly find specific offerings

**Acceptance Criteria:**
- Dashboard displays IPO cards/rows with key information:
  - Company name and logo (if available)
  - IPO status (Current, Upcoming, Closed) with color-coded badges
  - Price band (₹X - ₹Y)
  - Open and close dates
  - Subscription status (for current IPOs)
  - GMP (Grey Market Premium) if available
  - Quick action: "View Details" button
- Default view shows Current IPOs first, then Upcoming, then Closed
- Filters available:
  - Category: All, Mainboard IPO, SME IPO, Rights Issue, NCD Issue, Upcoming (SEBI Filed)
  - Status: All, Current, Upcoming, Closed
  - Sector: All, Technology, Manufacturing, Finance, Healthcare, etc.
- Search bar allows real-time search by company name (client-side filtering initially)
- Page loads in < 2 seconds
- Mobile-responsive: cards stack vertically, filters accessible via dropdown
- Empty states handled gracefully: "No IPOs found matching your criteria"

**Data Requirements:**
- Fetch from PostgreSQL `ipos` table
- Columns needed: company_name, status, open_date, close_date, price_min, price_max, subscription_times, gmp_current, sector, type

**Technical Notes:**
- Use Next.js Server-Side Rendering (SSR) or Static Site Generation (SSG) with Incremental Static Regeneration (ISR)
- Implement debounced search to avoid performance issues
- Cache filter results client-side to improve UX

---

### FR-2: Detailed IPO Page

**Priority:** P0 (Must Have for MVP)

**Description:**
Provide comprehensive, well-organized information about a specific IPO on a dedicated page.

**User Stories:**
- As a user, I want to see all essential details about an IPO on one page so I don't need to visit multiple sites
- As a user, I want to understand the company's business in simple terms so I can evaluate investment potential
- As a user, I want to see real-time subscription status so I can gauge market demand
- As a user, I want to access official documents (DRHP, RHP) so I can do deeper research

**Acceptance Criteria:**

**Page Sections:**

1. **Header Section**
   - Company name and logo
   - IPO status badge (Open, Upcoming, Closed, Listed)
   - IPO rating/score (1-5 stars) with brief explanation
   - Social share buttons (WhatsApp, Twitter, LinkedIn)

2. **Key Details Card**
   - Price band: ₹X - ₹Y
   - Lot size: X shares
   - Minimum investment: ₹Y (calculated)
   - Issue size: ₹X Cr
   - Issue type: Book Built / Fixed Price
   - Listing on: NSE, BSE, or both

3. **Timeline Card**
   - IPO open date
   - IPO close date
   - Basis of allotment date (if announced)
   - Allotment finalization date (if announced)
   - Refund initiation date (if announced)
   - Listing date (if announced)
   - Visual timeline indicator showing current stage

4. **Subscription Status** (for Current/Closed IPOs)
   - Overall subscription: X.Xx times
   - Category-wise subscription:
     - Qualified Institutional Buyers (QIB): X.Xx times
     - Non-Institutional Investors (NII): X.Xx times
     - Retail Individual Investors (RII): X.Xx times
   - Visual progress bars for each category
   - Last updated timestamp
   - Auto-refresh option (refresh data without page reload)

5. **Grey Market Premium (GMP)**
   - Current GMP: ₹X (updated date/time)
   - Estimated listing price: ₹Y (issue price + GMP)
   - Expected listing gain: X% (if positive)
   - GMP trend chart (last 7 days, if data available)
   - Disclaimer: "GMP is unofficial and for informational purposes only"

6. **Company Overview**
   - Company description (plain language, 2-3 paragraphs)
   - Sector/Industry
   - Headquarters location
   - Year founded
   - Website link
   - Key products/services

7. **Financial Highlights** (MVP: basic; Phase 2: enhanced)
   - Revenue (last 3 years if available in DRHP summary)
   - Profit/Loss (last 3 years)
   - Key financial ratios:
     - EPS (Basic and Diluted)
     - P/E Ratio
     - NAV per share (Net Asset Value)
     - RoNW (Return on Net Worth) %
     - P/BV Ratio (Price to Book Value)
     - Financial statement type (Consolidated/Standalone)
   - Objects of the issue (use of proceeds)

8. **Promoter & Shareholding**
   - Promoter holding (pre-issue, post-issue %)
   - Major investors/anchor investors (if announced)

9. **IPO Peer Comparison**
   - Comparison table showing IPO company vs 5-7 peer companies from same sector
   - Metrics displayed:
     - EPS (Basic and Diluted)
     - NAV per share
     - P/E Ratio
     - RoNW (Return on Net Worth) %
     - P/BV Ratio (Price to Book Value)
     - Financial statement type
   - Visual indicators showing if IPO metrics are better/worse than peer average
   - Color coding: Green (better), Red (worse), Gray (data unavailable)
   - Tooltips explaining each financial metric
   - Responsive: Full table on desktop, card-based collapsible layout on mobile
   - Data source attribution

10. **Official Documents**
   - Links to DRHP (Draft Red Herring Prospectus)
   - Links to RHP (Red Herring Prospectus)
   - Links to NSE/BSE IPO pages
   - All links open in new tab with external link icon

11. **IPODhan Rating & Analysis**
    - Star rating (1-5) with color coding
    - Recommendation: Subscribe, Avoid, Risky
    - Key strengths (bullet points)
    - Key concerns/risks (bullet points)
    - Simple, jargon-free language targeting novice investors

12. **IPO News & Updates**
    - Chronological feed of news, updates, and announcements for the IPO
    - News types: Announcements, Updates, Analysis, Allotment, Listing
    - Display: Title, content excerpt, timestamp, source
    - Link to full article (if external source)
    - IPODhan team can add editorial analysis and insights
    - Auto-update when new announcements from NSE/BSE/Registrar

13. **Enhanced GMP Details**
    - Current GMP (₹)
    - Subject rate (unofficial grey market lot rate)
    - Kostak rate (selling allotment rights rate)
    - GMP trend chart (last 7 days)
    - Sauda details/grey market trading info (if available)
    - Disclaimer about unofficial nature of GMP data

14. **Company Operational Metrics**
    - Active products count (e.g., "72 active ANDA/NDA products")
    - Commercialized products count
    - Revenue growth % (year-over-year)
    - PAT (Profit After Tax) growth %
    - Key markets revenue breakdown (e.g., "US: $195M, India: $120M")
    - Lead manager details
    - Registrar details with contact email and website link

**Performance Requirements:**
- Page load time < 2 seconds
- Images lazy-loaded
- Subscription data cached for 15 minutes with refresh option
- GMP data cached for 30 minutes with refresh option

**Technical Notes:**
- Use Next.js Dynamic Routes: `/ipo/[slug]` (slug = company-name-kebab-case)
- SSR for SEO benefits and fresh data
- API route: `/api/ipo/[id]` to fetch data from PostgreSQL
- Implement `/api/ipo/[id]/subscription` for on-demand subscription refresh

---

### FR-3: Historical IPO Database

**Priority:** P0 (Must Have for MVP)

**Description:**
Searchable archive of past IPOs with listing performance and current market status.

**User Stories:**
- As a user, I want to see how past IPOs performed so I can learn from historical trends
- As a user, I want to compare current IPOs against similar historical IPOs so I can make informed decisions
- As a user, I want to filter historical IPOs by sector, year, and performance so I can analyze patterns

**Acceptance Criteria:**
- Table/card view of closed IPOs displaying:
  - Company name
  - Listing date
  - Issue price
  - Listing day price (open, high, close)
  - Listing day gain/loss % (color-coded: green for gain, red for loss)
  - Current market price (if listed and data available - Phase 2 feature)
  - Current return % vs issue price (Phase 2)
  - Subscription at closure (overall and by category)
  - Sector
- Filters:
  - Year: 2020, 2021, 2022, 2023, 2024, 2025, All
  - Sector: Technology, Finance, Healthcare, etc.
  - Listing Performance: All, Positive (gains), Negative (losses)
- Search by company name
- Sortable columns: Listing Date, Listing Gain %, Subscription
- Pagination: 20 IPOs per page (for MVP; infinite scroll in Phase 2)
- Click on any IPO to view full detail page

**Data Requirements:**
- Historical IPO data in PostgreSQL `ipos` table
- Fields: company_name, listing_date, issue_price, listing_open, listing_high, listing_close, subscription_qib, subscription_nii, subscription_rii, subscription_overall, sector, year

**Technical Notes:**
- Route: `/history`
- Use SSG with ISR (revalidate every 24 hours)
- Client-side filtering and sorting for better UX
- Seed database with last 2-3 years of IPO data for MVP (manual entry or scraping)

---

### FR-4: Allotment Status Checker

**Priority:** P1 (Should Have for MVP)

**Description:**
Allow users to check their IPO allotment status by entering PAN, Application Number, or DP/Client ID.

**User Stories:**
- As an IPO applicant, I want to check my allotment status so I know if I received shares
- As a user, I want multiple ways to check status (PAN/App No/DP ID) for convenience
- As a user, I want direct links to registrar's official allotment pages

**Acceptance Criteria:**
- Allotment Status section on IPO detail page (visible after close date)
- Input fields for:
  - PAN Number
  - Application Number
  - DP/Client ID
- "Check Status" button that:
  - Option 1: Opens registrar's official allotment page in new tab (easier to implement)
  - Option 2: Fetches status via API if registrar provides it (Phase 2)
- Display registrar contact details:
  - Registrar name
  - Registrar email (e.g., rubicon.ipo@linkintime.co.in)
  - Link to registrar's IPO page
- Step-by-step guide on how to check status
- Show "Allotment Status Available" only after allotment date
- Before allotment date: Show "Allotment date: [Date]" with countdown

**Technical Notes:**
- Store `registrar`, `registrar_email`, `registrar_website` in `ipos` table
- Link format: `{registrar_website}?pan={PAN}` (customize per registrar)
- Phase 2: Integrate with registrar APIs if available

---

### FR-5: Basis of Allotment Data

**Priority:** P1 (Should Have for MVP)

**Description:**
Display basis of allotment data showing category-wise allotment ratios and application statistics.

**User Stories:**
- As a user, I want to see allotment ratios (e.g., 1:3) so I understand my chances
- As a user, I want to see category-wise application data to gauge demand
- As a retail investor, I want to know lot-wise allotment probability

**Acceptance Criteria:**
- Basis of Allotment section on IPO detail page (visible after allotment finalization)
- Display for each category (RII, sNII, bNII, QIB):
  - Total applications received
  - Total shares applied for
  - Total shares allotted
  - Allotment ratio (e.g., "1:3" - 1 share for every 3 applied)
  - Allotment percentage (e.g., 33.33%)
- For Retail category, show lot-wise breakdown:
  - Applications at 1 lot, 2 lots, etc.
  - Allotment probability % for each lot size
- Table format on desktop, cards on mobile
- Data source attribution (e.g., "Source: Registrar, BSE")
- Show "Basis of allotment will be available after [date]" before finalization

**Data Requirements:**
- Store in `basis_of_allotment` table
- Scrape from registrar websites or manual entry (MVP)
- Phase 2: Automate scraping from registrar pages

**Technical Notes:**
- Route: Same IPO detail page, section appears after allotment
- API: `/api/ipo/[id]/allotment-basis`

---

### FR-6: Search & Filter Functionality

**Priority:** P0 (Must Have for MVP)

**Description:**
Global search and advanced filtering across all IPOs.

**User Stories:**
- As a user, I want to search for an IPO by company name from anywhere on the site
- As a user, I want to filter IPOs by multiple criteria simultaneously
- As a user, I want search results to appear instantly without page reload

**Acceptance Criteria:**
- Global search bar in site header
- Search triggered on typing (debounced, 300ms delay)
- Search scope: Company name (MVP); expand to sector, description keywords (Phase 2)
- Search results dropdown showing:
  - Top 5 matching IPOs
  - Company name, status, dates
  - "View all results" link if > 5 matches
- Filters (on dashboard and history pages):
  - Status, Type, Sector (as specified in FR-1 and FR-3)
  - Multiple filters can be active simultaneously
  - Filter state persists in URL query params for shareability
- "Clear filters" button visible when filters are active
- Results count displayed: "Showing X IPOs"

**Technical Notes:**
- Client-side search using Fuse.js or similar for fuzzy matching
- For larger datasets (Phase 2), implement server-side search via API route
- Use Next.js router query params for filter persistence

---

### FR-5: Basic IPO Scoring System

**Priority:** P1 (Should Have for MVP)

**Description:**
Simple, objective rating system to guide users on IPO quality.

**User Stories:**
- As a novice investor, I want to see a simple rating so I can quickly understand if an IPO is worth considering
- As a user, I want to understand the rationale behind the rating so I can learn to evaluate IPOs myself

**Acceptance Criteria:**

**Rating Display:**
- Star rating: 1-5 stars (half-stars allowed: 3.5 stars, etc.)
- Textual recommendation: "Strong Subscribe", "Subscribe", "Neutral", "Avoid", "High Risk"
- Color coding: Green (4-5 stars), Yellow (2.5-3.5 stars), Red (1-2 stars)
- Displayed prominently on IPO detail page header

**Rating Criteria (Objective, Automated):**

Scoring algorithm based on:

1. **Subscription Demand (30% weight)**
   - > 10x overall: 5 points
   - 5-10x: 4 points
   - 2-5x: 3 points
   - 1-2x: 2 points
   - < 1x: 1 point

2. **Grey Market Premium (25% weight)**
   - GMP > 20% of issue price: 5 points
   - GMP 10-20%: 4 points
   - GMP 0-10%: 3 points
   - GMP negative but > -10%: 2 points
   - GMP < -10%: 1 point

3. **Valuation Metrics (20% weight)**
   - P/E ratio compared to industry average:
     - Below average: 5 points (undervalued)
     - Near average (±10%): 3 points (fair)
     - Above average: 1 point (overvalued)
   - If P/E not available, use P/B or other relevant metric

4. **Company Fundamentals (15% weight)**
   - Profit in last 2 years: 5 points
   - Profit in 1 of last 2 years: 3 points
   - Losses in last 2 years: 1 point

5. **Issue Structure (10% weight)**
   - Fresh issue (capital raising): 5 points
   - Mixed (fresh + OFS): 3 points
   - Offer for Sale only (promoter exit): 1 point

**Rating Explanation:**
- "Why this rating?" section on IPO detail page
- Breakdown of score by category with visual indicators
- Tooltips explaining each criterion
- Disclaimer: "This rating is based on objective data and does not constitute financial advice. Investors should conduct their own research."

**Data Requirements:**
- Subscription data, GMP, financial metrics, issue structure
- Industry average P/E stored in `sectors` table

**Technical Notes:**
- Rating calculated via API route: `/api/ipo/[id]/calculate-rating`
- Cached for 1 hour, recalculated on demand
- Admin interface to manually override rating if needed (Phase 2)

---

### FR-6: Broker Affiliate Integration

**Priority:** P1 (Should Have for MVP - can be added in Week 8-9)

**Description:**
Integrate affiliate links and referral buttons for Zerodha and AngelOne brokers to enable users to apply for IPOs while generating affiliate revenue for IPODhan.

**User Stories:**
- As a user, I want a quick way to apply for an IPO through my preferred broker
- As a user, I want to open a demat account with a trusted broker if I don't have one
- As IPODhan, I want to earn affiliate revenue from broker referrals without compromising user experience

**Acceptance Criteria:**

**Affiliate Link Placement:**

1. **IPO Detail Page - Primary CTA**
   - Prominent "Apply for this IPO" button section below key details
   - Two broker options displayed:
     ```
     ┌─────────────────────────────────────────────┐
     │ Apply for this IPO                          │
     ├─────────────────────────────────────────────┤
     │ [Zerodha Logo] Apply via Zerodha       [→]  │
     │ [AngelOne Logo] Apply via AngelOne     [→]  │
     └─────────────────────────────────────────────┘
     ```
   - Buttons styled prominently but not overly aggressive
   - Affiliate links tagged with IPODhan referral codes

2. **Homepage/Dashboard**
   - Small banner/card: "New to IPO investing? Open a free demat account"
   - Links to Zerodha and AngelOne with brief value props
   - Dismissible (hide for 7 days if user closes)

3. **Email Alerts**
   - Footer section in new IPO alerts and closing reminders
   - Text: "Apply for this IPO through: [Zerodha] [AngelOne]"
   - Links tagged with email-specific tracking

**Affiliate Link Implementation:**

- **Zerodha Referral Link**:
  - URL: `https://signup.zerodha.com/?c=ZMPHZC`
  - Stored in environment variable: `ZERODHA_AFFILIATE_LINK`
  - Track clicks via UTM tags and internal tracking

- **AngelOne Affiliate Link**:
  - URL: `https://tinyurl.com/2d98g2qe`
  - Stored in environment variable: `ANGELONE_AFFILIATE_LINK`
  - Track clicks similarly

**Centralized Configuration:**
- Affiliate links stored in environment variables (`.env.local`)
- Fallback configuration in `lib/config/affiliate-links.js`
- Easy to update without code changes
- Support for adding more brokers in future

**Tracking & Analytics:**
- Log all affiliate link clicks to database (`affiliate_clicks` table)
- Track: IPO ID, broker name, click timestamp, user IP/session (anonymized)
- Dashboard for admin to view click-through rates
- Integration with Google Analytics events (Event: "affiliate_click", Broker: "zerodha"|"angelone")

**Disclosure & Transparency:**
- Footer disclaimer on every page:
  - "IPODhan may earn a commission if you open an account through our affiliate links. This does not affect the information we provide."
- Non-intrusive, compliant with advertising guidelines

**Data Requirements:**
- New table: `affiliate_clicks`
  ```sql
  CREATE TABLE affiliate_clicks (
    id SERIAL PRIMARY KEY,
    ipo_id INT REFERENCES ipos(id),
    broker VARCHAR(50), -- 'zerodha', 'angelone'
    source VARCHAR(100), -- 'ipo_detail_page', 'homepage_banner', 'email_alert'
    clicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_session VARCHAR(255), -- anonymized session identifier
    converted BOOLEAN DEFAULT FALSE -- Phase 2: track actual conversions if broker provides API
  );
  ```

**Technical Notes:**
- Affiliate links open in new tab (`target="_blank" rel="noopener"`)
- Use Next.js Link component with tracking event onClick
- API route: `POST /api/affiliate/track` to log clicks
- Admin dashboard route: `/admin/affiliate-stats` (Phase 2)

**Centralized Configuration File Structure:**

Create `lib/config/affiliate-links.js`:
```javascript
// lib/config/affiliate-links.js
export const affiliateConfig = {
  brokers: [
    {
      id: 'zerodha',
      name: 'Zerodha',
      displayName: 'Zerodha',
      link: process.env.ZERODHA_AFFILIATE_LINK || 'https://signup.zerodha.com/?c=ZMPHZC',
      logo: '/logos/zerodha.png',
      description: 'India\'s largest broker',
      cta: 'Apply via Zerodha',
      enabled: true
    },
    {
      id: 'angelone',
      name: 'AngelOne',
      displayName: 'Angel One',
      link: process.env.ANGELONE_AFFILIATE_LINK || 'https://tinyurl.com/2d98g2qe',
      logo: '/logos/angelone.png',
      description: 'Fast & easy account opening',
      cta: 'Apply via Angel One',
      enabled: true
    }
    // Future brokers can be added here (Groww, Upstox, etc.)
  ],

  // Get only enabled brokers
  getEnabledBrokers: function() {
    return this.brokers.filter(broker => broker.enabled);
  },

  // Get broker by ID
  getBrokerById: function(id) {
    return this.brokers.find(broker => broker.id === id);
  }
};
```

**Usage in Components:**
```javascript
import { affiliateConfig } from '@/lib/config/affiliate-links';

// In React component
const enabledBrokers = affiliateConfig.getEnabledBrokers();

enabledBrokers.map(broker => (
  <BrokerButton
    key={broker.id}
    broker={broker}
    onClick={() => trackAffiliateClick(broker.id)}
  />
));
```

**Benefits:**
- Single source of truth for all affiliate configuration
- Easy to enable/disable brokers without code changes
- Simple to add new brokers (just add to array)
- Environment variables for security-sensitive links
- Fallback values for development
- Centralized branding (logos, CTAs, descriptions)

**Phase 2 Enhancements:**
- Direct IPO application flow integration (if brokers provide APIs)
- Conversion tracking via broker affiliate dashboards
- A/B testing different CTA placements and messaging
- Additional broker partnerships (Groww, Upstox)

---

### FR-7: Broker Reviews & Comparison

**Priority:** P1 (Should Have for MVP)

**Description:**
Comprehensive broker reviews, ratings, and comparison tools to help users choose the right broker for IPO investing.

**User Stories:**
- As a new investor, I want to compare brokers so I can choose the right one for IPO applications
- As a user, I want to see detailed brokerage charges so I can understand costs
- As a user, I want to read user reviews and ratings before selecting a broker

**Acceptance Criteria:**

**Broker Review Page:**
- Dedicated page for each broker (e.g., `/brokers/zerodha`)
- Sections displayed:
  1. **Overview**
     - Broker type (Discount/Full-service)
     - Founded year, headquarters
     - SEBI registration number
     - Active clients count
     - Overall rating (1-5 stars)

  2. **Brokerage Charges**
     - Table showing charges for:
       - Equity Delivery (e.g., "₹0 per trade")
       - Equity Intraday (e.g., "₹20 or 0.03% per trade")
       - F&O - Futures (e.g., "₹20 or 0.03% per trade")
       - F&O - Options (e.g., "₹20 per trade")
       - Currency, Commodity charges
     - Account opening charges
     - AMC (Annual Maintenance Charges)
     - DP charges (Demat charges)

  3. **Ratings & Reviews**
     - Overall rating with breakdown:
       - Fees & Charges (1-5 stars)
       - Brokerage (1-5 stars)
       - Usability/Platform (1-5 stars)
       - Customer Service (1-5 stars)
       - Research & Tools (1-5 stars)
     - User reviews section (Phase 2: allow users to submit)
     - Review count and average rating

  4. **Features & Platforms**
     - Trading platforms (Web, Mobile, Desktop apps)
     - Research tools availability
     - IPO application facility (Yes/No, process)
     - Margin exposure limits
     - Partner products (if any)

  5. **Pros & Cons**
     - Bulleted list of advantages
     - Bulleted list of disadvantages
     - Based on user feedback and editorial review

  6. **FAQs**
     - Common questions specific to that broker
     - "How to apply for IPO via [Broker]?"
     - "What documents needed for account opening?"

  7. **Apply Now CTA**
     - Affiliate link button at bottom
     - "Open Account with [Broker]" with referral tracking

**Broker Comparison Tool:**
- Route: `/brokers/compare`
- **Default View: All Brokers Comparison Table**
  - Compare 30+ brokers in a comprehensive table
  - Columns:
    1. Broker Name & Logo
    2. Type (Discount/Full-Service)
    3. Account Opening Charges
    4. Demat AMC (Annual Maintenance)
    5. Equity Delivery Brokerage
    6. Equity Intraday Brokerage
    7. F&O Brokerage
    8. Overall Rating (stars)
    9. Number of Clients
    10. Features (3-in-1, Margin Trading, API, MF, Lifetime Free AMC)
    11. Apply Now (Affiliate link)

- **Filters & Sorting:**
  - Filter by:
    - Broker Type: All, Discount, Full-Service
    - Features: 3-in-1 Account, Trading API, Direct MF, Lifetime Free AMC
    - Account Opening: Free, Paid
    - Number of Clients: 1M+, 5M+, 10M+
  - Sort by:
    - Rating (High to Low)
    - Account Opening Charges (Low to High)
    - AMC Charges (Low to High)
    - Number of Clients (High to Low)
    - Broker Name (A-Z)

- **Side-by-Side Comparison (Select Mode):**
  - Select 2-4 brokers from table using checkboxes
  - "Compare Selected" button opens detailed comparison
  - Shows expanded details for selected brokers only
  - Includes: All charges, features, pros/cons, ratings breakdown

- **Best Broker Recommendations:**
  - Section at top showing:
    - "Best Overall Broker" (highest rating)
    - "Best for Beginners" (lowest charges, easy platform)
    - "Best for Active Traders" (API, low intraday charges)
    - "Best for IPO Investing" (good IPO facility, low delivery charges)

- **Export & Share:**
  - Export comparison table to PDF/Excel
  - Share comparison via link (selected brokers saved in URL)
  - "Add to Compare" button on broker cards throughout site

- **Responsive Design:**
  - Desktop: Full comparison table with horizontal scroll
  - Tablet: Collapsible columns with key metrics visible
  - Mobile: Card-based comparison (swipe between brokers)

**Broker Listing Page:**
- Route: `/brokers`
- List all reviewed brokers in cards
- Filter by:
  - Type: All, Discount Brokers, Full-Service Brokers
  - Rating: 4+ stars, 3+ stars, All
- Sort by: Rating, Name, Brokerage (Low to High)
- Each card shows:
  - Broker logo and name
  - Type (Discount/Full-service)
  - Overall rating
  - Key USP (e.g., "Zero brokerage on delivery")
  - "View Details" and "Apply Now" buttons

**Data Requirements:**
- New `brokers` table with:
  - name, slug, type, logo_url
  - founded_year, headquarters, sebi_registration
  - active_clients_count
  - overall_rating, ratings breakdown
  - brokerage charges (JSON or separate table)
  - features, platforms, pros, cons
  - affiliate_link
- New `broker_reviews` table (Phase 2):
  - broker_id, user_id, rating, review_text, verified

**Technical Notes:**
- Routes: `/brokers`, `/brokers/[slug]`, `/brokers/compare`
- API: `/api/brokers`, `/api/brokers/[id]`
- Comparison state managed in localStorage
- Affiliate link clicks tracked same as IPO affiliate integration

**Navigation:**
- Add "Brokers" to main navigation menu
- Link from IPO detail page: "Need a demat account? Compare brokers →"

---

### FR-8: SME IPO Tracking

**Priority:** P0 (Must Have for MVP)

**Description:**
Track and display SME (Small and Medium Enterprise) IPOs separately from mainboard IPOs with SME-specific risk warnings and data fields.

**User Stories:**
- As an investor, I want to see SME IPOs separately so I can evaluate smaller investment opportunities
- As a user, I want clear risk warnings for SME IPOs so I understand the higher risk profile
- As a user, I want to filter and search SME IPOs independently

**Acceptance Criteria:**
- Separate SME IPO section accessible from main navigation
- SME IPO cards display:
  - "SME IPO" badge prominently displayed
  - Exchange (BSE SME / NSE Emerge)
  - Minimum lot size (often higher than mainboard)
  - Risk warning indicator
- Dashboard filter: "Category: SME IPO" shows only SME IPOs
- SME-specific detail page with:
  - Risk disclaimer: "SME IPOs carry higher risk. Invest cautiously."
  - Exchange platform (BSE SME / NSE Emerge)
  - Listing requirements met
  - Post-listing lock-in period (if applicable)
- All existing IPO features available for SME IPOs:
  - Subscription tracking, GMP (if available), Financial data
  - Peer comparison, News & updates, Allotment status

**Data Requirements:**
- `ipo_type` field: 'mainboard' or 'sme'
- `exchange` field includes SME platforms

**Technical Notes:**
- Route: `/sme-ipos`, Filter: `?category=sme`, API: `/api/ipos?type=sme`

---

### FR-8: Upcoming IPOs (SEBI Filed)

**Priority:** P0 (Must Have for MVP)

**Description:**
Track IPOs that have filed DRHP with SEBI but haven't opened yet.

**User Stories:**
- As an investor, I want to see which IPOs are in the pipeline so I can plan ahead
- As a user, I want to know filing status and expected timeline

**Acceptance Criteria:**
- "Upcoming (SEBI Filed)" category shows filed but not-yet-open IPOs
- Display: Filing date, DRHP link, expected opening month
- Status progression: DRHP Filed → RHP Filed → Dates Announced → Opens
- Once dates announced, moves to "Upcoming" status

**Data Requirements:**
- `filing_status`, `filing_date`, `expected_open_month` fields

**Technical Notes:**
- Route: `/upcoming-ipos`, API: `/api/ipos?filing_status=drhp_filed`

---

### FR-9: Rights Issues Tracking

**Priority:** P0 (Must Have for MVP)

**Description:**
Track rights issues for existing shareholders.

**User Stories:**
- As a shareholder, I want to see rights issues for companies I own
- As an investor, I want to understand rights issue terms and pricing

**Acceptance Criteria:**
- Separate "Rights Issues" section
- Display: Rights ratio (e.g., 1:5), rights price, discount %, record date
- Calculator: Entitlement calculation based on shares owned
- Renunciation details if allowed

**Data Requirements:**
- New `rights_issues` table with ratio, price, dates, renunciation details

**Technical Notes:**
- Route: `/rights-issues`, API: `/api/rights-issues`

---

### FR-10: NCD Tracking

**Priority:** P0 (Must Have for MVP)

**Description:**
Track NCD public issues with interest rates and credit ratings.

**User Stories:**
- As a fixed-income investor, I want to see available NCD issues
- As a user, I want to compare interest rates and credit ratings

**Acceptance Criteria:**
- Separate "NCD Issues" section
- Display: Issuer, credit rating, interest rate range, tenure options
- Multiple series/tranches with rates and payment frequencies
- Interest calculator for returns

**Data Requirements:**
- New `ncd_issues` and `ncd_series` tables

**Technical Notes:**
- Route: `/ncd-issues`, API: `/api/ncd-issues`

---

### FR-11: IPO Calendar View

**Priority:** P0 (Must Have for MVP)

**Description:**
Visual calendar displaying IPO dates for easy timeline tracking.

**User Stories:**
- As a user, I want a calendar view to see all IPO dates visually
- As a user, I want to export calendar to Google Calendar

**Acceptance Criteria:**
- Monthly calendar view with color-coded markers for dates
- Click on date shows all events, click on IPO navigates to detail
- Filters: Event type (open/close/allotment/listing), Category
- Export: .ics file, Google Calendar, Outlook links
- Mobile: List view; Tablet+: Calendar view

**Technical Notes:**
- Route: `/calendar`, API: `/api/calendar?month=2025-01`
- Use React Calendar library

---

### FR-12: Responsive Design

**Priority:** P0 (Must Have for MVP)

**Description:**
Mobile-first, fully responsive design that works seamlessly across all device sizes.

**User Stories:**
- As a mobile user, I want the site to load quickly and be easy to navigate on my phone
- As a desktop user, I want to take advantage of larger screen space for side-by-side comparisons

**Acceptance Criteria:**

**Mobile (< 768px):**
- Single-column layout
- Touch-friendly UI elements (min 44x44px tap targets)
- Hamburger menu for navigation
- Collapsible sections on IPO detail page
- Horizontal scroll for tables (with visual indicator)
- Bottom navigation bar for quick access (Home, Search, Alerts)
- Filters accessible via modal/drawer

**Tablet (768px - 1024px):**
- Two-column layout where applicable
- Side navigation visible
- Tables fully visible without horizontal scroll
- Cards displayed in grid (2 columns)

**Desktop (> 1024px):**
- Three-column layouts for maximum information density
- Sticky header and navigation
- Side-by-side comparison views (Phase 2)
- Hover states for interactive elements

**Performance:**
- Responsive images: srcset with multiple resolutions
- CSS breakpoints at 640px, 768px, 1024px, 1280px
- Tailwind CSS for responsive utility classes

**Testing:**
- Tested on Chrome DevTools device emulation
- Tested on real devices: iPhone (iOS), Samsung (Android), iPad

**Technical Notes:**
- Use Tailwind CSS responsive prefixes (sm:, md:, lg:, xl:)
- Next.js Image component for optimized images
- Mobile-first CSS approach (default styles for mobile, override for larger screens)

---

### ~~FR-8: Email Alert System~~ ❌ **REMOVED FROM MVP**

**Priority:** ~~P1~~ → **Moved to Phase 2**

**Reason for Removal:** Simplify MVP, launch faster. Email alerts will be added in Phase 2 after initial launch.

**Original Description:**
Allow users to subscribe to email notifications for IPO events.

**User Stories:**
- As a user, I want to receive email alerts when new IPOs are announced so I don't miss opportunities
- As a user, I want to be reminded when an IPO is about to close so I can make a timely decision
- As a user, I want to be notified about allotment and listing dates for IPOs I'm interested in

**Acceptance Criteria:**

**Subscription Types:**

1. **General IPO Alerts** (no login required):
   - New IPO announcements
   - IPO opening reminders (1 day before)
   - IPO closing reminders (on closing day, morning)
   - Weekly digest of upcoming IPOs

2. **Specific IPO Alerts** (Phase 2 - requires user account):
   - Watchlist IPOs: allotment date, listing date
   - Subscription milestone (e.g., "IPO you're watching is 5x subscribed")

**Email Subscription Flow:**
- Email input field on homepage and IPO detail pages
- Label: "Get IPO Alerts"
- Placeholder: "Enter your email"
- Submit button: "Subscribe"
- On submit:
  - Validate email format
  - Send verification email with confirmation link
  - Show success message: "Check your email to confirm subscription"
- Confirmation page: "You're subscribed! You'll receive IPO alerts at [email]"
- Double opt-in required (GDPR compliance)

**Unsubscribe:**
- Every email includes "Unsubscribe" link in footer
- Unsubscribe page: "You've been unsubscribed. We're sorry to see you go!"
- Option to re-subscribe on unsubscribe page

**Email Content (MVP):**
- Plain text + simple HTML templates
- Subject lines:
  - "New IPO Alert: [Company Name] opens on [Date]"
  - "Reminder: [Company Name] IPO closes today!"
  - "Weekly IPO Digest: 5 IPOs opening this week"
- Content includes:
  - Company name, price band, dates
  - Quick summary (1-2 lines)
  - Link to IPODhan IPO detail page
  - Unsubscribe link in footer

**Email Frequency:**
- New IPO announcements: Immediate (within 1 hour of adding to database)
- Closing reminders: Sent at 9 AM on closing day
- Weekly digest: Sent every Sunday at 6 PM

**Data Requirements:**
- `email_subscriptions` table: id, email, confirmed (boolean), confirmation_token, subscription_types (array), created_at, unsubscribed_at

**Technical Notes:**
- **Email service options:**
  - **Mailgun** (Recommended): Free tier 5,000 emails/month
  - **AWS SES**: $0.10 per 1,000 emails (cheapest for scale)
  - **SendGrid**: Free tier 100 emails/day (limited)
- API route: `/api/email/subscribe`, `/api/email/confirm`, `/api/email/unsubscribe`
- Background job to send scheduled emails: `scripts/send-email-alerts.js`
- **Scheduling:** Windows Task Scheduler (native, reliable) runs script hourly
- Email templates stored in `/email-templates/` directory

---

**Note:** This feature is documented here for Phase 2 reference but will NOT be built in MVP.

---

### FR-8: Admin Interface (Internal)

**Priority:** P2 (Nice to Have for MVP, but useful for data management)

**Description:**
Simple admin panel for managing IPO data manually (CRUD operations).

**User Stories:**
- As an admin, I want to manually add new IPO data when automated scraping fails
- As an admin, I want to update GMP data quickly without database access
- As an admin, I want to correct errors in IPO information reported by users

**Acceptance Criteria:**
- Password-protected admin route: `/admin` (basic authentication for MVP)
- Admin dashboard showing:
  - Recent IPOs (last 10)
  - Quick actions: Add New IPO, Edit IPO, Delete IPO
  - Data sync status (last successful scrape time)
- Forms to:
  - Add new IPO: All fields from `ipos` table
  - Edit existing IPO: All fields editable
  - Update GMP: Quick form for company_id, gmp_value, gmp_date
  - Update subscription data: Quick form for subscription figures
- Form validation (required fields, data types)
- Success/error messages after actions
- No complex UI needed (functional > beautiful for MVP)

**Security:**
- Environment variable `ADMIN_PASSWORD` for basic auth
- HTTPS required (enforce in middleware)
- Rate limiting on admin routes

**Technical Notes:**
- Use Next.js API routes for CRUD operations
- Simple form UI with Tailwind CSS
- Consider using a library like `next-auth` for better authentication in Phase 2

---

## Non-Functional Requirements

### NFR-1: Performance

**Requirements:**

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time to First Byte (TTFB) | < 500ms | Lighthouse, WebPageTest |
| Largest Contentful Paint (LCP) | < 2.5s | Lighthouse, Core Web Vitals |
| First Input Delay (FID) | < 100ms | Lighthouse, Core Web Vitals |
| Cumulative Layout Shift (CLS) | < 0.1 | Lighthouse, Core Web Vitals |
| Total Page Size | < 500KB (initial load) | Browser DevTools |
| Database Query Time | < 100ms (95th percentile) | PostgreSQL logs, monitoring |

**Strategies:**
- Next.js Server-Side Rendering (SSR) for dynamic content
- Static Site Generation (SSG) with Incremental Static Regeneration (ISR) for semi-static pages
- Image optimization with Next.js Image component (WebP format, lazy loading)
- Minify and compress CSS/JS (built-in with Next.js)
- Database indexing on frequently queried columns (company_name, status, listing_date)
- Implement caching layer (Redis for Phase 2; in-memory caching for MVP)
- Cloudflare CDN for static assets
- Code splitting and lazy loading for JavaScript

---

### NFR-2: Scalability

**Requirements:**
- Support 10,000 monthly visitors initially
- Scale to 100,000 monthly visitors within 12 months
- Handle traffic spikes during popular IPO launches (5x normal traffic)

**Strategies:**
- Horizontal scaling: Design stateless Next.js app for multi-instance deployment (Phase 2)
- Database connection pooling (PgBouncer or Node.js pool)
- Cloudflare caching for static pages and assets
- Optimize database queries (avoid N+1 queries, use joins and indexed searches)
- Monitor resource usage (CPU, RAM, bandwidth) on VPS
- Migration plan to dedicated server or cloud if VPS resources insufficient

---

### NFR-3: Reliability & Uptime

**Requirements:**
- 99.5% uptime during market hours (9 AM - 5 PM IST, Monday-Friday)
- 99% uptime overall
- Automated error monitoring and alerting
- Data backup and recovery plan

**Strategies:**
- **Uptime Monitoring**: Use UptimeRobot or similar service to ping site every 5 minutes
- **Error Tracking**: Implement Sentry or similar for JavaScript error monitoring
- **Logging**: Structured logging with Winston or Pino, logs stored in `/logs/` directory
- **Database Backups**:
  - Automated daily backups of PostgreSQL database (pg_dump)
  - Backup retention: 7 daily backups, 4 weekly backups
  - Store backups on separate storage location (external drive or cloud storage)
- **Disaster Recovery**:
  - Document database restoration process
  - Test restore procedure monthly
  - Keep recent backup locally for quick recovery
- **Graceful Degradation**:
  - If database connection fails, show cached data with warning banner
  - If scraper fails, fallback to manual updates via admin panel

---

### NFR-4: Security

**Requirements:**
- HTTPS enforced across entire site
- Protection against common web vulnerabilities (XSS, SQL Injection, CSRF)
- Rate limiting to prevent abuse
- Data privacy compliance (GDPR for email subscriptions)

**Strategies:**
- **HTTPS**: SSL certificate via Let's Encrypt, enforce HTTPS in Cloudflare settings
- **Input Validation**: Sanitize all user inputs (email addresses, search queries)
  - Use libraries like `validator.js` for email validation
  - Escape HTML in user-generated content (if any, e.g., future comments)
- **SQL Injection Prevention**: Use parameterized queries (PostgreSQL prepared statements)
- **CSRF Protection**: Next.js API routes with CSRF tokens (built-in with next-auth or custom middleware)
- **Rate Limiting**:
  - API routes: Max 100 requests per 15 minutes per IP (use `express-rate-limit` or custom middleware)
  - Admin routes: Max 10 requests per 15 minutes per IP
- **Data Privacy**:
  - Privacy policy page outlining data collection (email addresses only for MVP)
  - Unsubscribe mechanism for email alerts (double opt-in, easy opt-out)
  - No cookies except essential (session for admin auth)
  - Display cookie consent banner if using analytics cookies (Phase 2)
- **Dependency Security**: Regularly update npm packages, use `npm audit` to check vulnerabilities
- **Environment Variables**: Store sensitive data (DB credentials, API keys, admin password) in `.env.local`, never commit to Git

---

### NFR-5: SEO & Discoverability

**Requirements:**
- Rank on Page 1 of Google for "upcoming IPO India" within 6 months
- High search visibility for individual IPO names
- Structured data for rich snippets in search results

**Strategies:**
- **On-Page SEO**:
  - Unique, descriptive page titles: `[Company Name] IPO - Price, Dates, GMP, Subscription | IPODhan`
  - Meta descriptions: 150-160 characters summarizing page content
  - H1, H2, H3 hierarchy for content structure
  - Alt text for all images
  - Semantic HTML (header, nav, main, article, footer)
- **Technical SEO**:
  - XML sitemap generated and submitted to Google Search Console
  - Robots.txt configured to allow crawling
  - Canonical URLs to prevent duplicate content
  - Next.js SSR/SSG for crawlable HTML (no client-side rendering for critical content)
- **Structured Data (Schema.org)**:
  - JSON-LD for IPO pages:
    - Organization schema for company info
    - FinancialProduct schema for IPO details
    - Event schema for IPO dates (open, close, listing)
  - Test with Google Rich Results Test
- **Content Strategy**:
  - Educational blog posts: "How to Apply for IPO", "Understanding IPO Subscription", etc. (Phase 2)
  - IPO glossary page (Phase 2)
  - Internal linking between related IPOs, sectors, historical data
- **Backlinks**: Share content on relevant forums, social media, financial communities
- **Performance**: Fast page loads improve SEO ranking (NFR-1)

---

### NFR-6: Accessibility

**Requirements:**
- WCAG 2.1 Level AA compliance (target)
- Keyboard navigable
- Screen reader friendly

**Strategies:**
- **Semantic HTML**: Use appropriate tags (button, nav, article, etc.)
- **ARIA Labels**: Add aria-labels for icon-only buttons, form fields
- **Keyboard Navigation**:
  - All interactive elements accessible via Tab key
  - Focus indicators visible (outline on focused elements)
  - Logical tab order
- **Color Contrast**: Minimum 4.5:1 ratio for text (use WebAIM Contrast Checker)
- **Alternative Text**: All images have descriptive alt attributes
- **Form Labels**: All form fields have associated labels
- **Skip Links**: "Skip to main content" link for keyboard/screen reader users
- **Testing**: Use axe DevTools or WAVE browser extension to check accessibility

---

### NFR-7: Maintainability

**Requirements:**
- Clean, well-documented codebase for solo developer
- Modular architecture for easy feature additions
- Comprehensive error handling and logging

**Strategies:**
- **Code Organization**:
  - Folder structure: `/pages`, `/components`, `/lib`, `/api`, `/styles`, `/public`, `/scripts`
  - Separate concerns: UI components, business logic, data access
- **Documentation**:
  - README.md with setup instructions, deployment steps
  - Inline comments for complex logic
  - API route documentation (request/response formats)
- **Version Control**:
  - Git repository with meaningful commit messages
  - Branching strategy: `main` (production), `develop` (staging), feature branches
- **Testing** (Phase 2 priority, basic for MVP):
  - Unit tests for utility functions (e.g., rating calculation)
  - Integration tests for API routes
  - Use Jest and React Testing Library
- **Error Handling**:
  - Try-catch blocks for all async operations
  - User-friendly error messages (avoid exposing stack traces)
  - Log errors to file with context (timestamp, user IP, request details)
- **Linting**: ESLint with Next.js config, Prettier for code formatting

---

## Technical Architecture

### System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Devices                            │
│              (Desktop, Mobile, Tablet Browsers)                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Cloudflare CDN                             │
│          (DNS, SSL, Caching, DDoS Protection)                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│               Windows Server 2022 VPS                           │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │         Next.js Application (Node.js Runtime)             │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │  Frontend (React Components, Pages, UI)            │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │  API Routes (Next.js /api/*)                        │  │ │
│  │  │    - /api/ipo/[id]                                  │  │ │
│  │  │    - /api/ipo/[id]/subscription                     │  │ │
│  │  │    - /api/email/subscribe                           │  │ │
│  │  │    - /api/admin/* (CRUD operations)                 │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  │           Process Manager: PM2                             │ │
│  └───────────────────────┬───────────────────────────────────┘ │
│                          │                                      │
│  ┌───────────────────────▼───────────────────────────────────┐ │
│  │         PostgreSQL 16 Database (ipodhan)                  │ │
│  │  Tables: ipos, email_subscriptions, sectors, etc.         │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │     Data Pipeline Scripts (Node.js)                       │ │
│  │  - scrapers/nse-scraper.js (Puppeteer)                    │ │
│  │  - scrapers/bse-scraper.js (Puppeteer)                    │ │
│  │  - scrapers/gmp-scraper.js (Chittorgarh/InvestorGain)     │ │
│  │  - scrapers/historical-data-scraper.js (one-time)         │ │
│  │  - jobs/send-email-alerts.js                              │ │
│  │  Scheduler: Windows Task Scheduler (hourly)               │ │
│  │  Alert System: Telegram bot (scraper failure alerts)      │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   External Services                             │
│  - NSE/BSE Websites (Data Source - Web Scraping)                │
│  - Chittorgarh/InvestorGain (GMP Data Source)                   │
│  - IPO Alerts API (Backup Data Source)                          │
│  - UptimeRobot (External Uptime Monitoring)                     │
│  - Google Analytics (Web Analytics)                             │
│  - Cloudflare Free (CDN, SSL, DNS)                              │
│  - Telegram Bot API (Scraper Failure Alerts)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

### Technology Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| **Frontend Framework** | Next.js | 14+ | React framework with SSR/SSG, routing, API routes |
| **UI Library** | React | 18+ | Component-based UI |
| **Styling** | Tailwind CSS | 3+ | Utility-first CSS framework |
| **Language** | TypeScript | 5+ | Type-safe JavaScript for better long-term maintainability |
| **Database** | PostgreSQL | 16 | Shared instance - database name: `ipodhan` |
| **ORM/Database Client** | node-postgres (pg) | 8+ | PostgreSQL client for Node.js |
| **Process Manager** | PM2 | Latest | Direct binding to port (no IIS reverse proxy) |
| ~~**Email Service**~~ | ~~Mailgun or AWS SES~~ | ~~Latest~~ | ❌ **Removed from MVP** - Phase 2 feature |
| **Web Scraping** | Puppeteer | Latest | FREE (Apache 2.0) - Headless browser for NSE/BSE |
| **Scheduling** | Windows Task Scheduler | Native | Windows Server 2022 built-in task scheduler |
| **HTTP Client** | Axios | Latest | API requests to external services |
| **Validation** | Validator.js | Latest | Email and input validation |
| **Logging** | Winston or Pino | Latest | Structured logging to files + Windows Event Viewer |
| **CDN & SSL** | Cloudflare | Free Plan | CDN, DNS, SSL, caching, DDoS protection |
| **Monitoring (Uptime)** | UptimeRobot | Free Plan | External website uptime monitoring |
| **Monitoring (System)** | Windows PerfMon | Native | CPU, RAM, disk monitoring on Windows Server |
| **Analytics** | Google Analytics | Free (GA4) | Web traffic and user behavior analytics |
| **Alerts** | Telegram Bot API | Free | Scraper failure alerts (3+ consecutive failures) |

---

### Database Schema

**Complete schema with relationships - See full SQL in implementation section**

**Entity Relationship Diagram:**

```
┌─────────────────┐
│    sectors      │
│─────────────────│
│ id (PK)         │
│ sector_name     │
│ avg_pe_ratio    │
└────────┬────────┘
         │ 1
         │ Many
         ▼
┌────────────────────────────────────────────────────────┐
│                     ipos                               │
│────────────────────────────────────────────────────────│
│ id (PK)                                                │
│ sector_id (FK) -> sectors.id                          │
│ company_name, slug, status, face_value                 │
│ dates (open, close, allotment, demat, listing, upi)    │
│ pricing (price_min/max, lot_size, issue_size)          │
│ shares (total, fresh, ofs, pre/post issue)             │
│ subscription (qib, nii, rii), gmp, rating               │
│ financials, promoter_holding, employee_discount        │
└────────┬───────────────────┬───────────────────────────┘
         │ 1                 │ 1
         │ Many              │ Many
         ▼                   ▼
┌────────────────────┐  ┌──────────────────────────────┐
│ affiliate_clicks   │  │    ipo_reservations          │
│────────────────────│  │──────────────────────────────│
│ id (PK)            │  │ id (PK)                      │
│ ipo_id (FK)        │  │ ipo_id (FK) -> ipos.id       │
│ broker, source     │  │ qib/retail/nii percentages   │
│ clicked_at         │  │ investment limits (retail,   │
└────────────────────┘  │ snii, bnii)                  │
                        │ lot sizes, cutoff flags      │
         │ 1            └──────────────────────────────┘
         │ Many
         ▼
┌────────────────────────────────┐
│       ipo_promoters            │
│────────────────────────────────│
│ id (PK)                        │
│ ipo_id (FK) -> ipos.id        │
│ promoter_name, type, is_selling│
└────────────────────────────────┘

┌────────────────────────────────┐
│     scraper_logs               │ (No FK - standalone)
│────────────────────────────────│
│ id (PK), scraper_name, status  │
│ consecutive_failures           │
└────────────────────────────────┘
```

**Key Tables:**

#### Table: `ipos`

Primary table storing all IPO information.

```sql
CREATE TABLE ipos (
  id SERIAL PRIMARY KEY,

  -- Basic Info
  company_name VARCHAR(255) NOT NULL,
  company_slug VARCHAR(255) UNIQUE NOT NULL,
  company_description TEXT,
  company_logo_url VARCHAR(500),
  sector_id INT REFERENCES sectors(id) ON DELETE SET NULL,
  website_url VARCHAR(500),
  headquarters VARCHAR(255),
  founded_year INT,

  -- Company Operational Metrics
  active_products_count INT, -- e.g., 72 active ANDA/NDA products
  commercialized_products_count INT, -- e.g., 66 commercialized products
  revenue_growth_percent DECIMAL(5, 2), -- e.g., 49% revenue growth
  pat_growth_percent DECIMAL(5, 2), -- Profit After Tax growth %
  key_markets_revenue TEXT, -- JSON: {"US": "195", "India": "120"} in millions
  lead_manager VARCHAR(255), -- e.g., 'Axis Capital Ltd.'
  registrar VARCHAR(255), -- e.g., 'MUFG Intime India Pvt.Ltd.'
  registrar_email VARCHAR(255), -- e.g., 'rubicon.ipo@linkintime.co.in'
  registrar_website VARCHAR(500), -- Link to registrar IPO page

  -- IPO Details
  status VARCHAR(50) NOT NULL, -- 'upcoming', 'current', 'closed', 'listed'
  filing_status VARCHAR(50), -- 'drhp_filed', 'rhp_filed', 'dates_announced', 'open' (for tracking SEBI filed IPOs)
  filing_date DATE, -- Date when DRHP/RHP was filed with SEBI
  expected_open_month VARCHAR(20), -- e.g., 'January 2025', 'Q2 2025' for filed but not-yet-open IPOs
  ipo_type VARCHAR(50), -- 'mainboard', 'sme'
  exchange VARCHAR(50), -- 'NSE', 'BSE', 'NSE & BSE', 'BSE SME', 'NSE Emerge'
  risk_level VARCHAR(20), -- 'Standard', 'High' (for SME IPOs)
  issue_type VARCHAR(50), -- 'Book Built', 'Fixed Price'
  face_value DECIMAL(10, 2), -- Face value per share (e.g., 1.00, 10.00)

  -- Pricing
  price_min DECIMAL(10, 2),
  price_max DECIMAL(10, 2),
  lot_size INT,
  min_investment DECIMAL(12, 2), -- calculated: lot_size * price_max
  issue_size_cr DECIMAL(10, 2), -- in Crores
  total_issue_shares BIGINT, -- Total shares in issue
  fresh_issue_cr DECIMAL(10, 2),
  fresh_issue_shares BIGINT, -- Fresh issue shares count
  ofs_cr DECIMAL(10, 2), -- Offer for Sale
  ofs_shares BIGINT, -- Offer for sale shares count
  employee_discount DECIMAL(10, 2), -- Employee discount amount in ₹

  -- Dates
  open_date DATE,
  close_date DATE,
  allotment_date DATE,
  refund_date DATE,
  demat_credit_date DATE, -- Credit of shares to demat account
  listing_date DATE,
  upi_cutoff_time TIMESTAMP, -- UPI mandate confirmation cutoff (e.g., "5 PM on close date")

  -- Subscription Data
  subscription_overall DECIMAL(5, 2), -- e.g., 5.24 for 5.24x
  subscription_qib DECIMAL(5, 2),
  subscription_nii DECIMAL(5, 2),
  subscription_rii DECIMAL(5, 2),
  subscription_updated_at TIMESTAMP,

  -- Grey Market Premium
  gmp_current DECIMAL(10, 2), -- in ₹
  gmp_updated_at TIMESTAMP,
  estimated_listing_price DECIMAL(10, 2), -- calculated: price_max + gmp_current
  gmp_subject_rate DECIMAL(10, 2), -- Subject rate (unofficial grey market lot rate)
  gmp_kostak_rate DECIMAL(10, 2), -- Kostak rate (selling allotment rights rate)
  gmp_sauda_details TEXT, -- Grey market trading details (text/JSON)

  -- Listing Performance
  listing_open DECIMAL(10, 2),
  listing_high DECIMAL(10, 2),
  listing_close DECIMAL(10, 2),
  listing_gain_percent DECIMAL(5, 2), -- calculated: ((listing_close - price_max) / price_max) * 100

  -- Current Market (Phase 2)
  current_market_price DECIMAL(10, 2),
  current_return_percent DECIMAL(5, 2),

  -- Financial Highlights
  revenue_last_year DECIMAL(10, 2), -- in Crores
  revenue_2_years_ago DECIMAL(10, 2),
  profit_last_year DECIMAL(10, 2),
  profit_2_years_ago DECIMAL(10, 2),
  pe_ratio DECIMAL(5, 2),
  eps_basic DECIMAL(5, 2), -- Basic EPS
  eps_diluted DECIMAL(5, 2), -- Diluted EPS
  nav_per_share DECIMAL(10, 2), -- Net Asset Value per share (in Rs)
  ronw DECIMAL(5, 2), -- Return on Net Worth (%)
  pb_ratio DECIMAL(5, 2), -- Price to Book Value ratio
  financial_statement_type VARCHAR(20), -- 'Consolidated' or 'Standalone'

  -- Shareholding
  promoter_holding_pre DECIMAL(5, 2), -- percentage
  promoter_holding_post DECIMAL(5, 2), -- percentage
  pre_issue_shares BIGINT, -- Pre-issue shareholding in shares
  post_issue_shares BIGINT, -- Post-issue shareholding in shares

  -- Documents
  drhp_url VARCHAR(500),
  rhp_url VARCHAR(500),
  nse_url VARCHAR(500),
  bse_url VARCHAR(500),

  -- Rating
  ipodhan_rating DECIMAL(2, 1), -- 1.0 to 5.0
  ipodhan_recommendation VARCHAR(50), -- 'Strong Subscribe', 'Subscribe', 'Neutral', 'Avoid', 'High Risk'
  rating_updated_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  data_last_scraped_at TIMESTAMP, -- Last time scrapers updated this IPO

  -- Indexes
  INDEX idx_status (status),
  INDEX idx_sector (sector),
  INDEX idx_open_date (open_date),
  INDEX idx_listing_date (listing_date),
  INDEX idx_company_slug (company_slug)
);
```

#### ~~Table: `email_subscriptions`~~ ❌ **Removed from MVP**

**Reason:** Email alerts feature moved to Phase 2.

~~Stores email subscribers for alerts.~~

#### Table: `sectors`

Reference table for sector-wise averages (used for rating calculation).

```sql
CREATE TABLE sectors (
  id SERIAL PRIMARY KEY,
  sector_name VARCHAR(100) UNIQUE NOT NULL,
  avg_pe_ratio DECIMAL(5, 2),
  avg_listing_gain DECIMAL(5, 2),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Table: `peer_companies`

Stores peer company comparison data for IPO analysis.

```sql
CREATE TABLE peer_companies (
  id SERIAL PRIMARY KEY,
  ipo_id INT REFERENCES ipos(id) ON DELETE CASCADE,

  -- Company Info
  company_name VARCHAR(200) NOT NULL,
  is_listed BOOLEAN DEFAULT true,

  -- Financial Metrics (for comparison)
  eps_basic DECIMAL(5, 2),
  eps_diluted DECIMAL(5, 2),
  nav_per_share DECIMAL(10, 2),
  pe_ratio DECIMAL(5, 2),
  ronw DECIMAL(5, 2), -- Return on Net Worth (%)
  pb_ratio DECIMAL(5, 2), -- Price to Book Value
  financial_statement_type VARCHAR(20), -- 'Consolidated' or 'Standalone'

  -- Market Data
  current_market_price DECIMAL(10, 2),
  market_cap DECIMAL(15, 2), -- in Crores

  -- Metadata
  data_source VARCHAR(100), -- e.g., 'NSE', 'BSE', 'Manual'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_ipo_id (ipo_id)
);
```

#### Table: `ipo_news`

Stores news, updates, and announcements for each IPO.

```sql
CREATE TABLE ipo_news (
  id SERIAL PRIMARY KEY,
  ipo_id INT REFERENCES ipos(id) ON DELETE CASCADE,

  -- News Details
  title VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  news_type VARCHAR(50), -- 'announcement', 'update', 'analysis', 'allotment', 'listing'
  source VARCHAR(255), -- e.g., 'NSE', 'BSE', 'Company PR', 'IPODhan Team'
  source_url VARCHAR(500), -- Link to original news source

  -- Metadata
  published_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_ipo_id (ipo_id),
  INDEX idx_published_at (published_at),
  INDEX idx_news_type (news_type)
);
```

#### Table: `basis_of_allotment`

Stores basis of allotment data (allotment ratios, application statistics).

```sql
CREATE TABLE basis_of_allotment (
  id SERIAL PRIMARY KEY,
  ipo_id INT REFERENCES ipos(id) ON DELETE CASCADE,

  -- Category-wise Allotment Details
  category VARCHAR(50) NOT NULL, -- 'RII', 'sNII', 'bNII', 'QIB'
  total_applications BIGINT, -- Total applications received
  total_shares_applied BIGINT, -- Total shares applied for
  total_shares_allotted BIGINT, -- Total shares allotted
  allotment_ratio VARCHAR(50), -- e.g., '1:3' (1 share for every 3 applied)
  allotment_percentage DECIMAL(5, 2), -- e.g., 33.33 for 1:3 ratio

  -- Lot-wise Breakdown (for retail)
  lot_size INT, -- e.g., 1 lot, 2 lots, etc.
  applications_at_lot INT, -- Number of applications at this lot size
  allotment_probability DECIMAL(5, 2), -- Probability % of getting allotment

  -- Metadata
  data_source VARCHAR(100), -- e.g., 'Registrar', 'BSE', 'NSE'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_ipo_id (ipo_id),
  INDEX idx_category (category)
);
```

#### Table: `rights_issues`

Stores rights issue data for existing shareholders.

```sql
CREATE TABLE rights_issues (
  id SERIAL PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  company_slug VARCHAR(255) UNIQUE NOT NULL,
  sector_id INT REFERENCES sectors(id) ON DELETE SET NULL,

  -- Rights Issue Details
  status VARCHAR(50) NOT NULL, -- 'upcoming', 'current', 'closed'
  rights_ratio VARCHAR(20), -- e.g., '1:5' (1 new share for every 5 held)
  rights_price DECIMAL(10, 2), -- Price per rights share
  market_price DECIMAL(10, 2), -- Current market price for comparison
  discount_percent DECIMAL(5, 2), -- Discount vs market price

  -- Dates
  announcement_date DATE,
  record_date DATE, -- Eligibility date
  issue_open_date DATE,
  issue_close_date DATE,
  renunciation_start DATE,
  renunciation_end DATE,
  listing_date DATE,

  -- Issue Details
  issue_size_cr DECIMAL(10, 2),
  renunciation_allowed BOOLEAN DEFAULT false,
  purpose TEXT, -- Use of proceeds

  -- Subscription Data
  subscription_overall DECIMAL(5, 2),
  subscription_updated_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_status (status),
  INDEX idx_record_date (record_date)
);
```

#### Table: `ncd_issues`

Stores NCD (Non-Convertible Debentures) public issue data.

```sql
CREATE TABLE ncd_issues (
  id SERIAL PRIMARY KEY,
  issuer_name VARCHAR(255) NOT NULL,
  issuer_slug VARCHAR(255) UNIQUE NOT NULL,
  sector VARCHAR(100), -- NBFC, Finance, Manufacturing, etc.

  -- NCD Details
  status VARCHAR(50) NOT NULL, -- 'upcoming', 'current', 'closed'
  issue_size_cr DECIMAL(10, 2),
  minimum_investment DECIMAL(12, 2),

  -- Credit Rating
  credit_rating VARCHAR(50), -- e.g., 'AA+', 'A-'
  rating_agency VARCHAR(100), -- e.g., 'CRISIL', 'ICRA', 'CARE'
  rating_outlook VARCHAR(50), -- 'Stable', 'Positive', 'Negative'

  -- Security
  security_type VARCHAR(50), -- 'Secured', 'Unsecured'

  -- Dates
  open_date DATE,
  close_date DATE,
  allotment_date DATE,
  listing_date DATE,

  -- Issuer Info
  company_description TEXT,
  purpose TEXT, -- Use of proceeds

  -- Subscription Data
  subscription_overall DECIMAL(5, 2),
  subscription_updated_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_status (status),
  INDEX idx_credit_rating (credit_rating)
);
```

#### Table: `ncd_series`

Stores individual series/tranches for each NCD issue.

```sql
CREATE TABLE ncd_series (
  id SERIAL PRIMARY KEY,
  ncd_id INT REFERENCES ncd_issues(id) ON DELETE CASCADE,

  -- Series Details
  series_name VARCHAR(50), -- 'Series I', 'Series II', etc.
  tenure_months INT, -- Tenure in months (36, 60, 84, etc.)
  interest_rate DECIMAL(5, 2), -- Interest rate % per annum
  payment_frequency VARCHAR(50), -- 'Monthly', 'Quarterly', 'Annual', 'Cumulative'
  effective_yield DECIMAL(5, 2), -- Effective IRR/Yield

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_ncd_id (ncd_id)
);
```

#### Table: `brokers`

Stores broker information for reviews and comparison.

```sql
CREATE TABLE brokers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  logo_url VARCHAR(500),

  -- Broker Details
  broker_type VARCHAR(50), -- 'Discount', 'Full-Service'
  founded_year INT,
  headquarters VARCHAR(255),
  sebi_registration VARCHAR(100),
  active_clients_count INT,

  -- Ratings
  overall_rating DECIMAL(2, 1), -- 1.0 to 5.0
  rating_fees DECIMAL(2, 1),
  rating_brokerage DECIMAL(2, 1),
  rating_usability DECIMAL(2, 1),
  rating_customer_service DECIMAL(2, 1),
  rating_research DECIMAL(2, 1),
  review_count INT DEFAULT 0,

  -- Charges (stored as JSON for flexibility)
  brokerage_charges JSON, -- {"equity_delivery": "0", "equity_intraday": "20", ...}
  account_opening_charges DECIMAL(10, 2),
  amc_charges DECIMAL(10, 2), -- Annual Maintenance Charges
  dp_charges JSON, -- {"per_debit": "15.93", ...}

  -- Features (for comparison table)
  trading_platforms TEXT, -- "Kite Web, Kite Mobile, Kite Desktop"
  ipo_facility BOOLEAN DEFAULT true,
  research_tools TEXT, -- List of research tools
  margin_exposure TEXT, -- e.g., "Up to 20x on equity intraday"
  partner_products TEXT, -- e.g., "Smallcase, Streak, Sensibull"

  -- Feature Flags (for filtering)
  has_3in1_account BOOLEAN DEFAULT false,
  has_margin_trading BOOLEAN DEFAULT false,
  has_trading_api BOOLEAN DEFAULT false,
  has_direct_mf BOOLEAN DEFAULT false,
  has_lifetime_free_amc BOOLEAN DEFAULT false,

  -- Brokerage Charges (specific fields for comparison)
  equity_delivery_brokerage VARCHAR(100), -- e.g., "₹0" or "0.50%"
  equity_intraday_brokerage VARCHAR(100), -- e.g., "₹20 or 0.03%"
  fo_futures_brokerage VARCHAR(100),
  fo_options_brokerage VARCHAR(100),
  currency_brokerage VARCHAR(100),
  commodity_brokerage VARCHAR(100),

  -- Editorial Content
  pros TEXT, -- JSON array of pros
  cons TEXT, -- JSON array of cons
  key_usp VARCHAR(500), -- Key Unique Selling Point
  description TEXT,

  -- Affiliate
  affiliate_link VARCHAR(500),

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_broker_type (broker_type),
  INDEX idx_overall_rating (overall_rating)
);
```

#### Table: `broker_faqs`

Stores FAQs for each broker.

```sql
CREATE TABLE broker_faqs (
  id SERIAL PRIMARY KEY,
  broker_id INT REFERENCES brokers(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_broker_id (broker_id)
);
```

#### Table: `broker_reviews` (Phase 2)

Stores user reviews for brokers.

```sql
CREATE TABLE broker_reviews (
  id SERIAL PRIMARY KEY,
  broker_id INT REFERENCES brokers(id) ON DELETE CASCADE,
  user_id INT, -- Reference to users table (Phase 2)

  -- Review Details
  overall_rating DECIMAL(2, 1),
  rating_fees DECIMAL(2, 1),
  rating_brokerage DECIMAL(2, 1),
  rating_usability DECIMAL(2, 1),
  rating_customer_service DECIMAL(2, 1),
  rating_research DECIMAL(2, 1),

  review_title VARCHAR(255),
  review_text TEXT,
  verified BOOLEAN DEFAULT false, -- Verified customer

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_broker_id (broker_id),
  INDEX idx_verified (verified)
);
```

#### Table: `scraper_logs`

Logs scraper runs for debugging, monitoring, and failure tracking.

```sql
CREATE TABLE scraper_logs (
  id SERIAL PRIMARY KEY,
  scraper_name VARCHAR(100), -- 'nse', 'bse', 'gmp', 'historical'
  status VARCHAR(50), -- 'success', 'error', 'warning'
  records_updated INT,
  error_message TEXT,
  consecutive_failures INT DEFAULT 0, -- Track consecutive failures for alerting
  run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_scraper_status (scraper_name, status),
  INDEX idx_run_at (run_at)
);
```

**Failure Tracking Logic:**
- If `status = 'error'`, increment `consecutive_failures` for that scraper
- If `status = 'success'`, reset `consecutive_failures` to 0
- If `consecutive_failures >= 3`, trigger Telegram alert

#### Table: `ipo_reservations`

Stores IPO reservation details (investor category limits, lot sizes, reservation percentages).

```sql
CREATE TABLE ipo_reservations (
  id SERIAL PRIMARY KEY,
  ipo_id INT REFERENCES ipos(id) ON DELETE CASCADE,

  -- Reservation percentages
  qib_percentage DECIMAL(5, 2), -- e.g., 75.00 for "Not less than 75%"
  qib_percentage_type VARCHAR(20), -- 'at_least', 'at_most', 'exactly'
  retail_percentage DECIMAL(5, 2), -- e.g., 10.00
  retail_percentage_type VARCHAR(20),
  nii_percentage DECIMAL(5, 2), -- e.g., 15.00
  nii_percentage_type VARCHAR(20),

  -- Investor category limits (in ₹)
  retail_max_investment DECIMAL(12, 2), -- e.g., 200000 for Rs 2 Lakhs
  snii_min_investment DECIMAL(12, 2), -- Small HNI min (e.g., 200000)
  snii_max_investment DECIMAL(12, 2), -- Small HNI max (e.g., 1000000)
  bnii_min_investment DECIMAL(12, 2), -- Big HNI min (e.g., 1000000)

  -- Lot size details
  retail_min_lots INT, -- Usually 1
  retail_max_lots INT, -- e.g., 13 lots
  snii_min_lots INT, -- e.g., 14 lots
  snii_max_lots INT, -- e.g., 68 lots
  bnii_min_lots INT, -- e.g., 69 lots

  -- Cutoff price allowed per category
  retail_cutoff_allowed BOOLEAN DEFAULT true,
  snii_cutoff_allowed BOOLEAN DEFAULT false,
  bnii_cutoff_allowed BOOLEAN DEFAULT false,
  employee_cutoff_allowed BOOLEAN DEFAULT true,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(ipo_id)
);
```

**Purpose:** Complete IPO application guide for different investor categories

#### Table: `ipo_promoters`

Stores promoter/selling shareholder names for each IPO.

```sql
CREATE TABLE ipo_promoters (
  id SERIAL PRIMARY KEY,
  ipo_id INT REFERENCES ipos(id) ON DELETE CASCADE,
  promoter_name VARCHAR(255) NOT NULL,
  promoter_type VARCHAR(50), -- 'Individual', 'Company', 'Trust', 'HUF'
  is_selling BOOLEAN DEFAULT false, -- True if part of OFS
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_ipo_id (ipo_id)
);
```

**Purpose:** Show promoter details and OFS participants

---

### Data Management & Scraping Strategy

#### Scraping Frequency

| Scraper | Frequency | Scheduler | Priority |
|---------|-----------|-----------|----------|
| NSE IPO Data | Every 1 hour | Windows Task Scheduler | High |
| BSE IPO Data | Every 1 hour | Windows Task Scheduler | High |
| GMP Data (Chittorgarh/InvestorGain) | Every 1 hour | Windows Task Scheduler | Medium |
| Subscription Data (NSE/BSE) | Every 1 hour | Windows Task Scheduler | High |
| Historical Data Scraper | One-time (manual trigger) | Manual execution | Low |

**Rationale for 1-hour frequency:**
- Balances data freshness with server load
- Subscription data updates hourly during IPO periods
- GMP changes frequently but hourly updates are sufficient
- Avoids rate-limiting issues with source websites

#### Data Sources

| Data Type | Primary Source | Backup Source | Scraping Method |
|-----------|---------------|---------------|-----------------|
| IPO Details | NSE Website | BSE Website | Puppeteer (headless browser) |
| Subscription Data | NSE/BSE | IPO Alerts API | Puppeteer |
| GMP (Grey Market Premium) | Chittorgarh | InvestorGain | Puppeteer |
| Historical Performance | Chittorgarh | Manual entry | Puppeteer (one-time script) |

#### Data Validation & Quality Control

**Validation Rules:**
1. **Required Fields Check:**
   - Company name, open/close dates, price range, lot size must be present
   - If missing, log warning and flag in admin panel

2. **Data Consistency:**
   - `min_investment = lot_size × price_max`
   - `estimated_listing_price = price_max + gmp_current`
   - `listing_gain_percent = ((listing_close - price_max) / price_max) × 100`

3. **Date Validation:**
   - `open_date < close_date < allotment_date < listing_date`
   - If dates are illogical, show **warning in admin panel** for manual review

4. **Price Validation:**
   - `price_min <= price_max`
   - GMP should not exceed 2× price band (if it does, flag for review)

5. **Admin Panel Warnings:**
   - Display validation warnings with **yellow highlight**
   - Allow admin to override/correct data manually
   - Log all manual corrections for audit trail

#### Historical Data Strategy

**Option Selected: One-time scrape from Chittorgarh**

**Implementation:**
1. Write `scripts/scrapers/historical-data-scraper.js`
2. Scrape past 2-3 years of IPO data (company name, dates, pricing, listing performance)
3. Run once during initial setup
4. Store in same `ipos` table with `status = 'listed'`
5. Future IPOs will be added via regular scrapers

**Alternative (if needed):**
- Start empty, launch with only new IPOs
- Historical data accumulates organically over time
- Add historical data later via manual CSV import

#### Data Retention Policy

**Policy: Keep all IPOs forever**

**Rationale:**
- Historical data is valuable for analysis (avg listing gains, sector trends)
- Database storage is cheap (PostgreSQL handles millions of records easily)
- Enables future features: "Similar IPOs in this sector", "Historical performance charts"
- Clean data without deletions maintains data integrity

**Data Archival (Future Phase):**
- IPOs older than 2 years: Keep full data
- No archival/deletion needed for MVP

#### Backup Strategy for Scrapers

**Failure Handling:**

1. **Automatic Retries:**
   - If scraper fails, retry after 5 minutes (max 2 retries)
   - Log each failure in `scraper_logs` table

2. **Consecutive Failure Tracking:**
   - Track consecutive failures in `scraper_logs.consecutive_failures`
   - If scraper fails **3 times in a row**:
     - Send **Telegram alert** to admin
     - Log critical error in Windows Event Viewer
     - Continue trying on next scheduled run (don't stop)

3. **Telegram Alert Format:**
   ```
   🚨 IPODhan Scraper Alert
   Scraper: NSE IPO Data
   Consecutive Failures: 3
   Last Error: "Connection timeout to NSE website"
   Last Success: 2 hours ago
   Action: Please investigate manually
   ```

4. **Fallback to Backup Sources:**
   - If NSE scraper fails 3+ times, automatically try BSE scraper
   - If both fail, fall back to IPO Alerts API (if available)
   - Manual intervention required if all sources fail

5. **Recovery:**
   - Once scraper succeeds, reset `consecutive_failures` to 0
   - Send recovery confirmation via Telegram:
     ```
     ✅ IPODhan Scraper Recovered
     Scraper: NSE IPO Data
     Status: Back online
     Records Updated: 15 IPOs
     ```

#### Data Freshness Indicators

**User-Facing Timestamps:**

Display "Last updated" timestamp on:
1. **IPO Detail Pages:**
   - "Subscription data updated: 15 minutes ago"
   - "GMP updated: 45 minutes ago"

2. **IPO List Pages:**
   - Global indicator: "Data refreshed: 30 minutes ago"

3. **Implementation:**
   - Store `updated_at` timestamp in `ipos` table for each data type
   - Frontend calculates relative time (e.g., "15 minutes ago", "2 hours ago")
   - Use JavaScript library like `date-fns` or `dayjs` for formatting

4. **Staleness Warning:**
   - If data is older than 2 hours, show warning: ⚠️ "Data may be stale. Last update: 3 hours ago"
   - Helps users trust data freshness

---

### API Routes

| Route | Method | Description | Auth | Request Body | Response |
|-------|--------|-------------|------|--------------|----------|
| `/api/ipo` | GET | Get all IPOs with filters | None | Query params: `status`, `sector`, `type` | Array of IPO objects |
| `/api/ipo/[id]` | GET | Get single IPO by ID or slug | None | None | IPO object |
| `/api/ipo/[id]/subscription` | GET | Get latest subscription data | None | None | Subscription object |
| `/api/ipo/[id]/rating` | GET | Calculate rating for IPO | None | None | Rating object |
| `/api/admin/ipo` | POST | Create new IPO | Admin | IPO object | Created IPO object |
| `/api/admin/ipo/[id]` | PUT | Update IPO | Admin | Partial IPO object | Updated IPO object |
| `/api/admin/ipo/[id]` | DELETE | Delete IPO | Admin | None | `{ success, message }` |
| `/api/admin/gmp/[id]` | PUT | Update GMP for IPO | Admin | `{ gmp, date }` | `{ success, message }` |
| `/api/affiliate/track` | POST | Track affiliate link click | None | `{ ipo_id, broker, source }` | `{ success }` |

---

### Deployment Architecture

**Environment:** Windows Server 2022 VPS (Shared Hosting)

**Deployment Steps:**

1. **Repository Setup:**
   - Git repository initialized: `D:\Abhay\VibeCoding\IPODhan\`
   - `.gitignore` includes: `node_modules/`, `.env.local`, `.next/`, `logs/`

2. **Database Setup:**
   - PostgreSQL 16 database `ipodhan` created
   - Run migrations: `psql -U postgres -d ipodhan -f database/schema.sql`
   - Seed initial data: `node scripts/seed-data.js`

3. **Environment Variables:**
   - Create `.env.local` file in project root:
     ```env
     DATABASE_URL=postgresql://user:password@localhost:5432/ipodhan
     ADMIN_PASSWORD=your_secure_password
     NEXT_PUBLIC_BASE_URL=https://ipodhan.com
     ZERODHA_AFFILIATE_LINK=https://signup.zerodha.com/?c=ZMPHZC
     ANGELONE_AFFILIATE_LINK=https://tinyurl.com/2d98g2qe
     TELEGRAM_BOT_TOKEN=your_telegram_bot_token
     TELEGRAM_CHAT_ID=your_telegram_chat_id
     NODE_ENV=production
     ```

4. **Build Next.js App:**
   - Install dependencies: `npm install`
   - Build production bundle: `npm run build`
   - Test locally: `npm run start`

5. **Process Manager (PM2) & Task Scheduler:**
   - Install PM2 globally: `npm install -g pm2`
   - Start app: `pm2 start npm --name "ipodhan" -- start`
   - Configure auto-restart: `pm2 startup`, `pm2 save`
   - **Windows Task Scheduler Setup:**
     - Create task: "IPODhan NSE Scraper" - Run `node scripts/scrapers/nse-scraper.js` every hour
     - Create task: "IPODhan BSE Scraper" - Run `node scripts/scrapers/bse-scraper.js` every hour
     - Create task: "IPODhan GMP Scraper" - Run `node scripts/scrapers/gmp-scraper.js` every hour
     - All tasks offset by 5 minutes to avoid overlap (e.g., :00, :05, :10)

6. **Web Server Configuration:**
   - **Option 1: IIS Reverse Proxy**
     - Install IISNode
     - Configure IIS site pointing to Next.js app on port 3000
     - Set up reverse proxy rules
   - **Option 2: PM2 Direct Binding**
     - Run Next.js on port 80/443 directly (requires admin privileges)
     - Configure Windows Firewall to allow traffic

7. **Domain & SSL:**
   - Point IPODhan.com DNS A record to VPS IP via Cloudflare
   - Enable Cloudflare SSL (Full or Full Strict mode)
   - Force HTTPS redirects in Cloudflare Page Rules

8. **Monitoring:**
   - Add site to UptimeRobot: Check every 5 minutes
   - Configure PM2 monitoring: `pm2 install pm2-logrotate`
   - Set up log rotation for application logs

9. **Backup Automation:**
   - Create backup script: `scripts/backup-db.bat`
   - Schedule daily backup via Windows Task Scheduler (3 AM daily)

---

## Data Requirements

### Data Sources

#### Primary Source: NSE/BSE Websites (Web Scraping)

**NSE India:**
- URL: `https://www.nseindia.com/market-data/forthcoming-issues-ipo`
- Data Available:
  - Company name
  - Open and close dates
  - Issue size
  - Price band
  - Links to DRHP/RHP
- Scraping Approach:
  - Use Puppeteer (headless browser) to handle dynamic content
  - Extract data from HTML tables or JSON responses (inspect network tab)
  - Handle session cookies and headers (NSE requires user-agent, referer)
- Frequency: Every 1 hour (hourly)
- Error Handling: Log failures, fallback to BSE scraper, send Telegram alert after 3+ failures

**BSE India:**
- URL: `https://www.bseindia.com/publicissue.html`
- Similar approach to NSE
- Cross-reference data between NSE and BSE for accuracy

**Subscription Data:**
- NSE subscription status page (URL TBD - requires inspection)
- BSE subscription status page
- Parse category-wise subscription figures (QIB, NII, RII)
- Update database every 1 hour

#### Secondary Source: Chittorgarh/InvestorGain (Grey Market Premium)

- **Chittorgarh:** `https://www.chittorgarh.com/ipo/ipo_grey_market_premium.asp`
- **InvestorGain:** `https://www.investorgain.com/report/live-ipo-gmp/331/`
- Scrape GMP data using Puppeteer
- Frequency: Every 1 hour
- Update via `scripts/scrapers/gmp-scraper.js`
- Manual override available via admin panel: `/admin/gmp/[id]`

#### Tertiary Source: Manual Admin Entry

- Admin panel for manual data entry/correction
- Use for edge cases, data validation failures, or when scrapers fail
- Historical data entry (if needed)
- Community reporting: Allow users to report data errors (Phase 2)

---

### Broker Data Collection Strategy

#### Data Sources for Broker Information

**1. Broker Official Websites (Primary Source)**
- Each broker's official website for accurate charges
- Typical URLs:
  - Zerodha: `https://zerodha.com/charges`
  - AngelOne: `https://www.angelone.in/charges`
  - Groww: `https://groww.in/pricing`
  - Upstox: `https://upstox.com/pricing/`
  - ICICI Direct: `https://www.icicidirect.com/pricing`
- Data to collect:
  - Account opening charges
  - AMC (Annual Maintenance Charges)
  - Brokerage rates (Equity Delivery, Intraday, F&O, Currency, Commodity)
  - DP charges
  - Trading platforms available
  - Features (3-in-1, API, Direct MF, etc.)

**2. SEBI Website (Regulatory Data)**
- URL: `https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListingAll=yes`
- Data: SEBI registration numbers, broker status
- Verify broker legitimacy

**3. Broker Review Websites (Reference)**
- Chittorgarh: For cross-verification of charges
- Trustpilot, Google Reviews: For user sentiment
- Use as reference, NOT primary source

**4. Company Annual Reports/Filings**
- Active client count
- Revenue data (if publicly listed)
- Founded year, headquarters

#### Broker Data Collection Checklist

**Phase 1: Priority Brokers (MVP - 10 brokers)**

**Pre-populated (Day 1 - Already have affiliate partnerships):**
- [x] Zerodha (Discount) - **REQUIRED: Complete data from launch**
  - Affiliate link: Already configured in FR-6 (`ZERODHA_AFFILIATE_LINK`)
  - Use existing partnership for referral tracking
- [x] AngelOne (Discount) - **REQUIRED: Complete data from launch**
  - Affiliate link: Already configured in FR-6 (`ANGELONE_AFFILIATE_LINK`)
  - Use existing partnership for referral tracking

**Note:** Since Zerodha and AngelOne are our affiliate partners (FR-6), their complete broker profiles MUST be ready from Day 1. This enables:
- Broker comparison page to work immediately
- Users to compare Zerodha vs AngelOne
- Seamless integration between affiliate links and broker reviews
- Consistent brand presence across IPO detail pages and broker pages

**To be collected (Weeks 1-4):**
- [ ] Groww (Discount)
- [ ] Upstox (Discount)
- [ ] 5paisa (Discount)
- [ ] ICICI Direct (Full-Service)
- [ ] HDFC Securities (Full-Service)
- [ ] Kotak Securities (Full-Service)
- [ ] Sharekhan (Full-Service)
- [ ] Motilal Oswal (Full-Service)

**For each broker, collect:**
- [ ] Basic Info:
  - [ ] Name, slug, logo URL
  - [ ] Broker type (Discount/Full-Service)
  - [ ] Founded year
  - [ ] Headquarters
  - [ ] SEBI registration number
  - [ ] Active clients count (approximate)

- [ ] Brokerage Charges:
  - [ ] Account opening charges (₹)
  - [ ] AMC (Annual Maintenance Charges) (₹)
  - [ ] Equity Delivery brokerage (₹ or %)
  - [ ] Equity Intraday brokerage (₹ or %)
  - [ ] F&O Futures brokerage (₹ or %)
  - [ ] F&O Options brokerage (₹ or %)
  - [ ] Currency brokerage (₹ or %)
  - [ ] Commodity brokerage (₹ or %)
  - [ ] DP charges (per debit) (₹)

- [ ] Features (Yes/No):
  - [ ] 3-in-1 Account
  - [ ] Margin Trading
  - [ ] Trading API
  - [ ] Direct Mutual Funds
  - [ ] Lifetime Free AMC

- [ ] Platforms:
  - [ ] Trading platforms (Web, Mobile, Desktop - list names)
  - [ ] Research tools available
  - [ ] Partner products (if any)

- [ ] Content:
  - [ ] Description (2-3 sentences)
  - [ ] Key USP (1 line)
  - [ ] Pros (3-5 bullet points)
  - [ ] Cons (3-5 bullet points)
  - [ ] FAQs (5-10 common questions with answers)

- [ ] Ratings (Initial editorial ratings):
  - [ ] Overall Rating (1-5 stars)
  - [ ] Fees & Charges Rating (1-5)
  - [ ] Brokerage Rating (1-5)
  - [ ] Usability Rating (1-5)
  - [ ] Customer Service Rating (1-5)
  - [ ] Research & Tools Rating (1-5)

- [ ] Affiliate Link:
  - [ ] Obtain affiliate link from broker
  - [ ] Test link functionality

**Phase 2: Extended Coverage (20+ additional brokers)**
- [ ] Fyers
- [ ] Paytm Money
- [ ] Alice Blue
- [ ] ProStocks
- [ ] IIFL Securities
- [ ] Axis Direct
- [ ] SBI Securities
- [ ] Edelweiss
- [ ] Religare
- [ ] SMC Global
- [ ] ... (add more as needed)

#### Data Collection Process

**Step 0: Pre-Launch Setup (CRITICAL - Before Week 1)**
**Action Item: Collect Zerodha & AngelOne data BEFORE project setup**

For both Zerodha and AngelOne, collect immediately:
1. Visit official websites:
   - Zerodha: https://zerodha.com/charges, https://zerodha.com/about
   - AngelOne: https://www.angelone.in/charges, https://www.angelone.in/about-us
2. Collect all data as per checklist (charges, features, ratings, FAQs)
3. Prepare SQL INSERT statements for `brokers` and `broker_faqs` tables
4. Have data ready to populate database in Week 2

**Step 1: Manual Research (Weeks 1-4 for remaining 8 brokers)**
1. Visit each broker's official website
2. Navigate to pricing/charges page
3. Take screenshots for reference
4. Copy data to Excel/Google Sheets template
5. Cross-verify with SEBI website for registration

**Step 2: Data Entry to Database (Week 3)**
1. Create SQL INSERT scripts for `brokers` table
2. Populate broker data
3. Create entries in `broker_faqs` table
4. Validate data integrity

**Step 3: Content Creation (Week 4)**
1. Write pros/cons for each broker (based on research + user feedback)
2. Assign editorial ratings
3. Write FAQs specific to each broker
4. Get affiliate links from broker programs

**Step 4: Automation (Phase 2)**
1. Identify if brokers provide API for charges
2. Create scraper for broker websites (if allowed)
3. Schedule quarterly updates for charges
4. Set up alerts for major charge changes

#### Automated Scraper for Broker Data (Phase 2)

**File: `scripts/scrapers/broker-scraper.js`**
- Scrape broker pricing pages
- Update charges quarterly
- Detect changes and log them
- Alert admin if charges change by >10%

**Scraping Strategy:**
- Use Puppeteer for dynamic pages
- Parse static HTML for simple pages
- Store raw HTML snapshots for audit trail
- Compare with previous version to detect changes

#### Data Maintenance Schedule

**Weekly:**
- Monitor user feedback on broker reviews
- Update ratings if significant user reviews received

**Monthly:**
- Verify affiliate links are working
- Check for new broker launches

**Quarterly:**
- Update all brokerage charges (manual or automated)
- Verify active client counts
- Update pros/cons based on recent developments

**Annually:**
- Comprehensive audit of all broker data
- Update SEBI registration status
- Refresh screenshots and documentation

---

### Data Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────┐
│         Windows Task Scheduler (Hourly Tasks)                │
└──────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ NSE Scraper  │  │ BSE Scraper  │  │ GMP Scraper  │
│ (Puppeteer)  │  │ (Puppeteer)  │  │ (Puppeteer)  │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                  │
       └─────────────────┼──────────────────┘
                         ▼
                ┌────────────────┐
                │ Data Validator │
                │ & Normalizer   │
                └────────┬───────┘
                         ▼
                ┌────────────────┐
                │   PostgreSQL   │
                │  (ipos table)  │
                └────────────────┘
                         │
                         ▼
                ┌────────────────┐
                │ Scraper Logs & │
                │ Telegram Alert │
                └────────────────┘
```

**Data Pipeline Scripts:**

1. **`scripts/scrapers/nse-scraper.js`**
   - Scrapes NSE website for IPO list
   - Extracts: company name, dates, price band, documents
   - Upserts data to `ipos` table (INSERT ON CONFLICT UPDATE)
   - Logs results to `scraper_logs` table

2. **`scripts/scrapers/bse-scraper.js`**
   - Similar to NSE scraper
   - Cross-references with existing data
   - Updates missing fields

3. **`scripts/scrapers/gmp-scraper.js`**
   - Scrapes GMP data from Chittorgarh/InvestorGain
   - Updates `gmp_current`, `estimated_listing_price`
   - Sets `gmp_updated_at` timestamp

4. **`scripts/scrapers/subscription-scraper.js`** (Integrated with NSE/BSE scrapers)
   - Scrapes real-time subscription data from NSE/BSE
   - Updates `subscription_overall`, `subscription_qib`, etc.
   - Sets `subscription_updated_at` timestamp

5. **`scripts/scrapers/historical-data-scraper.js`** (One-time execution)
   - Scrapes 2-3 years of historical IPO data from Chittorgarh
   - Populates `ipos` table with past IPO performance
   - Run manually during initial setup

6. **`scripts/jobs/calculate-ratings.js`**
   - Runs daily or on-demand
   - Calculates IPODhan rating for all current IPOs
   - Updates `ipodhan_rating`, `ipodhan_recommendation` fields

7. ~~**`scripts/jobs/send-email-alerts.js`**~~ ❌ **Removed from MVP** (Phase 2 feature)

**Scheduler Configuration (Windows Task Scheduler):**

**Setup Instructions:**

1. Open Windows Task Scheduler (`taskschd.msc`)
2. Create new tasks with the following configuration:

**Task 1: NSE IPO Scraper**
- Name: `IPODhan - NSE Scraper`
- Trigger: Daily, repeat every 1 hour
- Action: `node D:\Abhay\VibeCoding\IPODhan\scripts\scrapers\nse-scraper.js`
- Start time: 00:00 (runs at :00 of every hour)

**Task 2: BSE IPO Scraper**
- Name: `IPODhan - BSE Scraper`
- Trigger: Daily, repeat every 1 hour
- Action: `node D:\Abhay\VibeCoding\IPODhan\scripts\scrapers\bse-scraper.js`
- Start time: 00:05 (runs at :05 of every hour, offset 5 min from NSE)

**Task 3: GMP Scraper**
- Name: `IPODhan - GMP Scraper`
- Trigger: Daily, repeat every 1 hour
- Action: `node D:\Abhay\VibeCoding\IPODhan\scripts\scrapers\gmp-scraper.js`
- Start time: 00:10 (runs at :10 of every hour, offset 10 min from NSE)

**Task 4: Rating Calculation**
- Name: `IPODhan - Rating Calculator`
- Trigger: Daily at 2:00 AM
- Action: `node D:\Abhay\VibeCoding\IPODhan\scripts\jobs\calculate-ratings.js`

**Common Settings for All Tasks:**
- Run whether user is logged on or not
- Run with highest privileges
- Configure for: Windows Server 2022
- Start in directory: `D:\Abhay\VibeCoding\IPODhan\`
- If task fails, restart every: 10 minutes
- Attempt to restart up to: 3 times

**PowerShell Script to Create All Tasks (Alternative):**

```powershell
# scripts/setup-windows-tasks.ps1
# Run this script once to create all scheduled tasks

$action1 = New-ScheduledTaskAction -Execute "node" -Argument "D:\Abhay\VibeCoding\IPODhan\scripts\scrapers\nse-scraper.js" -WorkingDirectory "D:\Abhay\VibeCoding\IPODhan"
$trigger1 = New-ScheduledTaskTrigger -Daily -At "00:00" -RepetitionInterval (New-TimeSpan -Hours 1)
Register-ScheduledTask -Action $action1 -Trigger $trigger1 -TaskName "IPODhan - NSE Scraper" -Description "Scrapes NSE website for IPO data every hour"

# Repeat for other tasks...
```

---

## User Interface Specifications

### Design Principles

**Core Philosophy: Clean, Fast, Visual**

IPODhan's UI is designed to address critical gaps in competitor platforms (Chittorgarh, InvestorGain, IPOWatch):
- ❌ **Competitor Issue:** Ad-heavy, cluttered interfaces with poor visual hierarchy
- ✅ **IPODhan Solution:** Clean, distraction-free design with non-intrusive broker affiliates

**Design Principles:**

1. **Clarity Over Cleverness**: Prioritize clear information hierarchy over flashy design
   - *Competitors use table-heavy layouts; we use visual components (cards, charts, progress bars)*

2. **Speed is a Feature**: Fast load times are more important than heavy animations
   - *Target: <2s page load (vs competitors' 5-10s)*

3. **Mobile-First**: Design for mobile screens first, scale up for desktop
   - *Competitors are desktop-first with poor mobile UX*

4. **Visual Over Tabular**: Use charts, timelines, and progress bars instead of text-heavy tables
   - *Competitors lack GMP charts, subscription visualizations, and timeline components*

5. **Data Freshness Transparency**: Always show "Last updated" timestamps
   - *Competitors don't indicate data freshness*

6. **Accessibility**: Ensure all users can access information regardless of ability

7. **Consistency**: Maintain consistent patterns for navigation, buttons, colors across site

---

### Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Primary Blue | `#2563eb` | Buttons, links, active states |
| Dark Blue | `#1e40af` | Hover states, headers |
| Success Green | `#10b981` | Positive gains, success messages, "Subscribe" ratings |
| Warning Yellow | `#f59e0b` | Neutral ratings, warnings |
| Danger Red | `#ef4444` | Losses, errors, "Avoid" ratings |
| Light Gray | `#f3f4f6` | Backgrounds, cards |
| Dark Gray | `#1f2937` | Text, headings |
| Medium Gray | `#6b7280` | Secondary text |

---

### Typography

- **Font Family**: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- **Headings**:
  - H1: 2.5rem (40px), font-weight 700
  - H2: 2rem (32px), font-weight 600
  - H3: 1.5rem (24px), font-weight 600
- **Body Text**: 1rem (16px), font-weight 400
- **Small Text** (metadata, timestamps): 0.875rem (14px), font-weight 400

---

### Component Specifications

#### 1. IPO Card (Dashboard)

**Mobile:**
```
┌────────────────────────────────────┐
│ [Logo] Company Name         [Badge]│
│ Sector Name                        │
│ ₹100 - ₹120  |  Opens: 15 Jan     │
│ Subscription: 5.2x  |  GMP: ₹25   │
│              [View Details]        │
└────────────────────────────────────┘
```

**Desktop:**
```
┌──────────────────────────────────────────────────────────────┐
│ [Logo] Company Name                          [Status Badge]  │
│        Sector Name                                           │
│ Price: ₹100-₹120 | Dates: 15-17 Jan | Subs: 5.2x | GMP: ₹25│
│                                              [View Details]   │
└──────────────────────────────────────────────────────────────┘
```

**Elements:**
- Logo: 48x48px circle, fallback to company initials
- Status Badge: Rounded pill, color-coded (green=open, blue=upcoming, gray=closed)
- Hover effect: Subtle shadow, scale 1.02
- Button: Primary blue, rounded

---

#### 1a. SME IPO Card

**Mobile & Desktop (same as IPO Card with additions):**
```
┌────────────────────────────────────┐
│ 🔸 SME  Company Name        [Badge]│
│ BSE SME | Sector Name              │
│ ₹50 - ₹60  |  Opens: 20 Jan       │
│ Lot: 2000 shares | Risk: High     │
│              [View Details]        │
└────────────────────────────────────┘
```

**Elements:**
- "SME" badge with orange/yellow color
- Exchange shown (BSE SME / NSE Emerge)
- Risk indicator: "Risk: High" in red/orange
- All other elements same as regular IPO card

---

#### 1b. Rights Issue Card

```
┌────────────────────────────────────┐
│ 📑 RIGHTS  Company Name      [Open]│
│ Technology Sector                  │
│ Ratio: 1:5 | Price: ₹200          │
│ Discount: 15% | Record: 10 Jan    │
│              [View Details]        │
└────────────────────────────────────┘
```

**Elements:**
- "RIGHTS" badge with purple color
- Rights ratio prominently displayed
- Discount percentage in green (if positive discount)
- Record date shown
- Calculator icon/button

---

#### 1c. NCD Issue Card

```
┌────────────────────────────────────┐
│ 💰 NCD  Issuer Name          [Open]│
│ NBFC | Rating: AA+/Stable         │
│ Interest: 8.5%-9.25% p.a.         │
│ Tenure: 3Y, 5Y, 7Y | Min: ₹10L    │
│              [View Details]        │
└────────────────────────────────────┘
```

**Elements:**
- "NCD" badge with green/teal color
- Credit rating prominently shown with agency
- Interest rate range highlighted
- Tenure options listed
- Minimum investment amount

---

#### 1d. Upcoming (SEBI Filed) IPO Card

```
┌────────────────────────────────────┐
│ 📋 FILED  Company Name              │
│ Technology Sector                  │
│ DRHP Filed: 15 Dec 2024           │
│ Expected: January 2025 | TBA      │
│           [Subscribe to Alert]     │
└────────────────────────────────────┘
```

**Elements:**
- "FILED" or "DRHP" badge with gray/blue color
- Filing date shown
- Expected opening month (if known)
- "Subscribe to Alert" CTA instead of "View Details"
- Price shows "TBA" if not announced

---

#### 1e. Broker Comparison Table Component

**Desktop View:**
```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Compare 30+ Brokers                                    Filter: [Type ▼] [Features ▼] [Clients ▼]       │
│ ──────────────────────────────────────────────────────────────────────────────────────────────────────│
│ Best Picks:  🏆 Best Overall: Zerodha   👶 Best for Beginners: Groww   📈 Best for IPO: AngelOne      │
│ ──────────────────────────────────────────────────────────────────────────────────────────────────────│
│ ☐ | Broker        | Type     | Opening | AMC    | Delivery | Intraday | F&O   | Rating | Clients | Apply│
│ ──────────────────────────────────────────────────────────────────────────────────────────────────────│
│ ☐ | Zerodha       | Discount | ₹200    | ₹300   | ₹0       | ₹20      | ₹20   | ⭐4.5  | 12M+   | [→]  │
│ ☐ | AngelOne      | Discount | Free    | ₹240   | ₹0       | ₹20      | ₹20   | ⭐4.3  | 8M+    | [→]  │
│ ☐ | ICICI Direct  | Full-Srv | ₹975    | ₹750   | 0.55%    | 0.05%    | 0.05% | ⭐4.0  | 5M+    | [→]  │
│ ☐ | Groww         | Discount | Free    | Free   | ₹0       | ₹20      | ₹20   | ⭐4.2  | 10M+   | [→]  │
│ ... (30+ brokers total)                                                                                │
│                                                                                                        │
│ [Compare Selected (3)] [Export to PDF] [Export to Excel]                                              │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Mobile View:**
```
┌────────────────────────────────────┐
│ Compare Brokers                    │
│ Filter: [All ▼] Sort: [Rating ▼]  │
│ ──────────────────────────────── │
│ 🏆 Best Overall: Zerodha          │
│ ──────────────────────────────── │
│ ☐ Zerodha | Discount | ⭐4.5     │
│ Opening: ₹200 | AMC: ₹300        │
│ Delivery: ₹0 | Intraday: ₹20     │
│ Clients: 12M+ | [Apply →]        │
│ ──────────────────────────────── │
│ ☐ AngelOne | Discount | ⭐4.3    │
│ Opening: Free | AMC: ₹240        │
│ Delivery: ₹0 | Intraday: ₹20     │
│ Clients: 8M+ | [Apply →]         │
│ ──────────────────────────────── │
│ [Swipe for more →]                │
│                                    │
│ [Compare Selected (2)]            │
└────────────────────────────────────┘
```

**Elements:**
- Checkbox to select brokers for detailed comparison (max 4)
- Sortable column headers
- Color coding: Green (lowest charges), Yellow (medium), Red (highest)
- Rating displayed with stars
- Feature icons: ✓ (has feature), ✗ (doesn't have)
- "Compare Selected" button (disabled until 2+ selected)
- Export buttons (PDF/Excel)
- "Best Picks" recommendations at top
- Affiliate "Apply" links tracked per broker

**Detailed Comparison Modal (when "Compare Selected" clicked):**
```
┌────────────────────────────────────────────────────────────┐
│ Detailed Comparison: Zerodha vs AngelOne vs Groww    [✕]  │
│ ────────────────────────────────────────────────────────── │
│ Parameter           | Zerodha      | AngelOne     | Groww  │
│ ────────────────────────────────────────────────────────── │
│ Account Opening     | ₹200         | Free         | Free   │
│ AMC                 | ₹300         | ₹240         | Free   │
│ Equity Delivery     | ₹0           | ₹0           | ₹0     │
│ Equity Intraday     | ₹20/0.03%    | ₹20/0.025%   | ₹20    │
│ F&O Futures         | ₹20/0.03%    | ₹20/0.025%   | ₹20    │
│ F&O Options         | ₹20          | ₹20          | ₹20    │
│ ────────────────────────────────────────────────────────── │
│ 3-in-1 Account      | ✗            | ✓            | ✗      │
│ Trading API         | ✓            | ✓            | ✗      │
│ Direct MF           | ✓            | ✓            | ✓      │
│ Margin Trading      | ✓            | ✓            | ✓      │
│ ────────────────────────────────────────────────────────── │
│ Overall Rating      | ⭐⭐⭐⭐☆    | ⭐⭐⭐⭐☆    | ⭐⭐⭐⭐☆│
│ Customer Service    | ⭐⭐⭐⭐☆    | ⭐⭐⭐⭐☆    | ⭐⭐⭐⭐☆│
│ Platform Usability  | ⭐⭐⭐⭐⭐    | ⭐⭐⭐⭐☆    | ⭐⭐⭐⭐☆│
│ ────────────────────────────────────────────────────────── │
│ [Apply via Zerodha] [Apply via AngelOne] [Apply via Groww]│
│ [Share Comparison Link] [Download PDF]                     │
└────────────────────────────────────────────────────────────┘
```

**Data Handling:**
- Fetch all brokers from `brokers` table
- Client-side filtering and sorting for performance
- Selected brokers stored in localStorage
- Comparison shareable via URL parameters: `/brokers/compare?ids=1,2,3`

---

#### 2. IPO Detail Page Header

```
┌──────────────────────────────────────────────────────────────┐
│ [Logo]  Company Name                    [Open Badge]         │
│         Technology Sector                                    │
│         ⭐⭐⭐⭐ Strong Subscribe                            │
│                                                              │
│ [Share on WhatsApp] [Share on Twitter]                      │
└──────────────────────────────────────────────────────────────┘
```

---

#### 3. Subscription Status Widget

```
┌──────────────────────────────────────────────────────────────┐
│ Subscription Status                    Last Updated: 2:30 PM │
│                                                   [Refresh ↻] │
│ ──────────────────────────────────────────────────────────── │
│ Overall: 5.24x     ████████████████░░░░░░░░  (524%)         │
│ QIB:     8.52x     ████████████████████████  (852%)         │
│ NII:     3.12x     ██████████░░░░░░░░░░░░░░  (312%)         │
│ Retail:  2.08x     ██████░░░░░░░░░░░░░░░░░░  (208%)         │
└──────────────────────────────────────────────────────────────┘
```

**Color Coding:**
- > 5x: Green
- 2x - 5x: Yellow
- < 2x: Red
- Progress bars filled proportionally

---

#### 4. GMP Chart (Simple Line Chart)

```
₹
│         ╱──╲
│       ╱      ╲
│     ╱          ─╲
│   ╱              ╲
│ ╱                  ╲
└────────────────────────► Days
 -7  -5  -3  -1  Today
```

- Y-axis: GMP value (₹)
- X-axis: Last 7 days
- Tooltip on hover showing exact value and date
- Use Chart.js or Recharts library

---

#### 5. Timeline Component

```
Open Date        Close Date      Allotment      Listing
15 Jan 2025      17 Jan 2025     22 Jan 2025    24 Jan 2025
    ●────────────────●───────────────●──────────────●
    └─ Today
```

- Active stage highlighted in blue
- Completed stages in green with checkmark
- Future stages in gray

---

#### 6. Official Documents Section

**Desktop & Mobile:**
```
┌──────────────────────────────────────────────────────────┐
│ Official Documents                                        │
│ ──────────────────────────────────────────────────────── │
│ 📄 DRHP (Draft Red Herring Prospectus)              [↗]  │
│    Filed: 15 Dec 2024                                    │
│                                                           │
│ 📄 RHP (Red Herring Prospectus)                      [↗]  │
│    Filed: 10 Jan 2025                                    │
└──────────────────────────────────────────────────────────┘
```

**Elements:**
- Document icon: 📄 (or PDF icon SVG)
- Document name with full form in parentheses for clarity
- Filed date displayed below each document (if available)
- External link icon [↗] indicating it opens in new tab
- Links open SEBI/NSE/BSE official document URLs
- Hover effect: Subtle background highlight on document row
- If document not available: Show "Not available yet" in gray text
- Mobile: Same layout, full-width links for easy tapping

**Data Handling:**
- Display DRHP if `drhp_url` exists in database
- Display RHP if `rhp_url` exists in database
- Show filing dates if available in scraped data
- If both unavailable: Show message "Official documents will be available soon"

---

#### 7. Peer Comparison Table

**Desktop:**
```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ IPO Peer Comparison                                                                        │
│ ────────────────────────────────────────────────────────────────────────────────────────── │
│ Company Name          | EPS (₹) | EPS (₹) | NAV    | P/E  | RoNW  | P/BV | Financials    │
│                       | Basic   | Diluted | (₹)    | (x)  | (%)   |      |               │
│ ────────────────────────────────────────────────────────────────────────────────────────── │
│ 🔵 Rubicon Research   | 8.82    | 8.68    | 35.53  | 29.02| -     | -    | Consolidated  │
│    (This IPO)         |         |         |        |      |       |      |               │
│ ────────────────────────────────────────────────────────────────────────────────────────── │
│ Sun Pharma            | 45.60   | 45.60   | 300.99 | 34.98| 16.16 | 5.31 | Consolidated  │
│ Aurobindo Pharma      | 65.20   | 65.20   | 425.30 | 28.50| 18.20 | 4.80 | Consolidated  │
│ Zydus Lifesciences    | 32.10   | 32.10   | 215.40 | 32.10| 15.80 | 5.10 | Consolidated  │
│ Dr. Reddy's Labs      | 78.90   | 78.90   | 510.20 | 26.30| 19.50 | 4.20 | Consolidated  │
│ Lupin                 | 52.40   | 52.40   | 380.50 | 30.20| 17.30 | 4.60 | Consolidated  │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Mobile:**
```
┌──────────────────────────────────────────┐
│ IPO Peer Comparison                      │
│ ──────────────────────────────────────── │
│ 🔵 Rubicon Research (This IPO)           │
│ EPS: ₹8.82 (Basic) | ₹8.68 (Diluted)    │
│ NAV: ₹35.53 | P/E: 29.02               │
│ RoNW: - | P/BV: -                       │
│ Financials: Consolidated                 │
│ ──────────────────────────────────────── │
│ Sun Pharmaceutical Industries            │
│ EPS: ₹45.60 (Basic) | ₹45.60 (Diluted)  │
│ NAV: ₹300.99 | P/E: 34.98              │
│ RoNW: 16.16% | P/BV: 5.31              │
│ Financials: Consolidated                 │
│ ──────────────────────────────────────── │
│ [+ 4 more peers...]                      │
│ [Expand All]                             │
└──────────────────────────────────────────┘
```

**Elements:**
- IPO company highlighted with 🔵 indicator and "(This IPO)" label
- Table headers with clear abbreviations and units
- Desktop: Full table with horizontal scroll if needed
- Mobile: Card-based layout, collapsible (show top 2-3 peers, expand to see all)
- Color coding:
  - Green text: IPO's metric is better than peer average
  - Red text: IPO's metric is worse than peer average
  - Gray text: Data not available (-)
- Tooltip on hover for abbreviation explanations:
  - EPS: "Earnings Per Share"
  - NAV: "Net Asset Value per share"
  - P/E: "Price to Earnings ratio"
  - RoNW: "Return on Net Worth"
  - P/BV: "Price to Book Value ratio"
- Responsive table: Converts to cards on mobile
- Data source note at bottom: "Source: Company filings, BSE/NSE data"

**Data Handling:**
- Fetch peer companies from `peer_companies` table where `ipo_id` matches
- Display top 5-7 peer companies from same sector
- If no peer data available: Show message "Peer comparison data coming soon"
- Sort peers by market cap (largest first)

---

#### 8. IPO News & Updates Feed

**Desktop & Mobile:**
```
┌──────────────────────────────────────────────────────────┐
│ IPO News & Updates                                        │
│ ──────────────────────────────────────────────────────── │
│ 📢 Allotment finalized - Check status now                │
│    IPODhan Team • 2 hours ago                            │
│    Allotment for Rubicon Research IPO has been...        │
│    [Read More]                                           │
│ ──────────────────────────────────────────────────────── │
│ 📰 Subscription closes at 8.5x                           │
│    NSE Official • 1 day ago                              │
│    Final subscription stands at QIB: 12x, Retail...      │
│    [Read More]                                           │
│ ──────────────────────────────────────────────────────── │
│ 💡 IPODhan Analysis: Strong fundamentals                 │
│    IPODhan Team • 2 days ago                             │
│    Our analysis suggests strong fundamentals with...     │
│    [Read More]                                           │
│ ──────────────────────────────────────────────────────── │
│                    [Load More News]                      │
└──────────────────────────────────────────────────────────┘
```

**Elements:**
- News type icons: 📢 (announcement), 📰 (news), 💡 (analysis), ✅ (allotment), 📈 (listing)
- Title: Bold, clickable
- Source and timestamp: Gray text, small font
- Content excerpt: 2-3 lines max, truncated with ellipsis
- "Read More" expands inline or opens modal with full content
- Chronological order (newest first)
- Load more button (show 5 initially, load 5 more on click)
- If no news: "No updates yet. Check back soon!"
- Mobile: Same layout, full width

**Data Handling:**
- Fetch from `ipo_news` table where `ipo_id` matches
- Filter by `news_type` if needed
- Auto-refresh every 30 minutes if page is open

---

#### 9. Enhanced GMP Widget

Update the existing GMP component to include Subject/Kostak rates:

```
┌──────────────────────────────────────────────────────────┐
│ Grey Market Premium (GMP)              Last Updated: 2 PM │
│ ──────────────────────────────────────────────────────── │
│ Current GMP: ₹25 (+5.15%)                                │
│ Estimated Listing Price: ₹510                            │
│                                                           │
│ Subject Rate: ₹45 per lot    Kostak Rate: ₹20 per lot   │
│                                                           │
│ [7-Day GMP Trend Chart]                                  │
│                                                           │
│ ⚠️ Disclaimer: GMP is unofficial and subject to change   │
└──────────────────────────────────────────────────────────┘
```

**Elements:**
- GMP displayed prominently with percentage gain
- Subject & Kostak rates shown if available (hide if null)
- Existing 7-day trend chart below
- Disclaimer always visible
- Mobile: Stack subject/kostak vertically

---

#### 10. Allotment Status Checker

**Desktop & Mobile:**
```
┌──────────────────────────────────────────────────────────┐
│ Check Allotment Status                                    │
│ ──────────────────────────────────────────────────────── │
│ Select Method:                                           │
│ ○ PAN Number    ○ Application Number    ○ DP/Client ID  │
│                                                           │
│ Enter PAN: [________________]                            │
│                                                           │
│            [Check Status on Registrar Site]              │
│                                                           │
│ Registrar: MUFG Intime India Pvt.Ltd.                    │
│ Email: rubicon.ipo@linkintime.co.in                      │
│ Website: [linkintime.co.in]                              │
│                                                           │
│ How to Check:                                            │
│ 1. Click "Check Status" button above                     │
│ 2. You'll be redirected to the registrar's website       │
│ 3. Your PAN/App No will be pre-filled                    │
│ 4. View your allotment status                            │
└──────────────────────────────────────────────────────────┘
```

**Visibility Rules:**
- Show this section only after IPO close date
- Before allotment date: Show "Allotment date: [Date]" with countdown
- After allotment date: Show full checker

**Elements:**
- Radio buttons for selection method
- Input field changes based on selection (PAN/App No/DP ID)
- Button opens registrar website in new tab with pre-filled data
- Registrar contact info for support
- Step-by-step guide
- Mobile: Stack radio buttons vertically

---

#### 11. Basis of Allotment Table

**Desktop:**
```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ Basis of Allotment                                    Source: Registrar, BSE       │
│ ──────────────────────────────────────────────────────────────────────────────── │
│ Category | Applications | Shares Applied | Shares Allotted | Ratio | Allotment % │
│ ──────────────────────────────────────────────────────────────────────────────── │
│ Retail   | 1,25,000     | 37,50,000      | 12,50,000       | 1:3   | 33.33%      │
│ sNII     | 850          | 51,00,000      | 17,00,000       | 1:3   | 33.33%      │
│ bNII     | 420          | 84,00,000      | 28,00,000       | 1:3   | 33.33%      │
│ QIB      | 125          | 2,25,00,000    | 2,25,00,000     | 1:1   | 100%        │
│ ──────────────────────────────────────────────────────────────────────────────── │
│                                                                                    │
│ Retail Lot-wise Breakdown:                                                        │
│ ──────────────────────────────────────────────────────────────────────────────── │
│ Lot Size     | Applications | Allotment Probability                               │
│ ──────────────────────────────────────────────────────────────────────────────── │
│ 1 Lot        | 45,000       | 33% (1 in 3 applications)                          │
│ 2 Lots       | 30,000       | 33% (1 in 3 applications)                          │
│ 3 Lots       | 25,000       | 33% (1 in 3 applications)                          │
│ 4+ Lots      | 25,000       | 33% (1 in 3 applications)                          │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Mobile:**
```
┌──────────────────────────────────────────┐
│ Basis of Allotment                       │
│ Source: Registrar, BSE                   │
│ ──────────────────────────────────────── │
│ Retail (RII)                             │
│ Applications: 1,25,000                   │
│ Shares Applied: 37,50,000                │
│ Shares Allotted: 12,50,000               │
│ Ratio: 1:3 | Allotment: 33.33%          │
│ ──────────────────────────────────────── │
│ Small NII (sNII)                         │
│ Applications: 850                        │
│ Shares Applied: 51,00,000                │
│ [...]                                    │
└──────────────────────────────────────────┘
```

**Visibility Rules:**
- Show only after allotment finalization date
- Before finalization: "Basis of allotment will be available after [date]"

**Elements:**
- Category-wise table with all metrics
- Allotment ratio prominently displayed (e.g., "1:3")
- Color coding: Green for 1:1 ratio, Yellow for 1:2-1:5, Red for worse
- Retail lot-wise breakdown table
- Data source attribution
- Mobile: Card-based layout

---

### Page Layouts

#### Homepage

**Navigation (Header):**
- Logo: IPODhan
- Main Menu:
  - Mainboard IPOs
  - SME IPOs
  - Rights Issues
  - NCD Issues
  - Brokers (Reviews & Comparison)
  - Calendar
  - History
- Search bar (global)
- Mobile: Hamburger menu

**Sections:**
1. **Hero Section**
   - H1: "Track Every IPO, Rights Issue & NCD in India"
   - Subtitle: "Real-time data for Mainboard IPOs, SME IPOs, Rights Issues, and NCDs—all in one place"
   - Category tabs: All | Mainboard IPO | SME IPO | Rights | NCD | Calendar
2. **Current Issues** (Dynamic based on selected tab)
   - All: Mixed cards from all categories with category badges
   - Mainboard IPO: Current mainboard IPOs only
   - SME IPO: Current SME IPOs with risk indicator
   - Rights: Current rights issues with ratio display
   - NCD: Current NCD issues with interest rate
3. **Upcoming Issues** (Same tab-based filtering)
4. **SEBI Filed IPOs** (Pipeline view showing filed but not-yet-open)
5. **Recent Listings** (Table or Cards with listing performance)
6. **Footer** (Links: About, Contact, Privacy Policy, Disclaimer, Glossary)

#### IPO Detail Page

**Layout (Desktop):**
```
┌──────────────────────────────────────────────────────────────┐
│ [Header]                                                     │
├──────────────────────────────────────────────────────────────┤
│ ┌──────────────────────┐  ┌──────────────────────────────┐  │
│ │ Key Details Card     │  │ Timeline Card                │  │
│ └──────────────────────┘  └──────────────────────────────┘  │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Subscription Status Widget                               │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────┐  ┌──────────────────────────────┐  │
│ │ GMP Trend Chart      │  │ IPODhan Rating & Analysis    │  │
│ └──────────────────────┘  └──────────────────────────────┘  │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Company Overview (Expandable)                            │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Financial Highlights (Expandable)                        │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ IPO Peer Comparison (Table)                              │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ IPO News & Updates (Feed)                                │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Allotment Status Checker (Form - after close date)      │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Basis of Allotment (Table - after allotment)            │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Official Documents (Links)                               │ │
│ └──────────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Apply for this IPO (Broker Affiliate Links)             │ │
│ │  [Zerodha Logo] Apply via Zerodha                   [→]  │ │
│ │  [AngelOne Logo] Apply via AngelOne                 [→]  │ │
│ └──────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ [Footer]                                                     │
└──────────────────────────────────────────────────────────────┘
```

**Mobile:** Single column, cards stack vertically, expandable sections collapsed by default

---

### Competitive UI Analysis

**Comparison with Chittorgarh.com, InvestorGain.com, and IPOWatch.in**

| Feature | Chittorgarh | InvestorGain | IPOWatch | IPODhan |
|---------|-------------|--------------|----------|---------|
| **Homepage Load Time** | 5-10s (heavy ads) | 4-7s (broker ads) | N/A | <2s ✅ |
| **Ad Clutter** | ❌ Heavy (sidebar, inline, banners) | ❌ Moderate (broker cards) | N/A | ✅ None (clean) |
| **Mobile Experience** | ❌ Desktop-first, tables | ❌ Poor responsive | N/A | ✅ Mobile-first, cards |
| **Subscription Visualization** | ❌ Text only (no progress bars) | ❌ Tables only | N/A | ✅ Live progress bars with color coding |
| **GMP Visualization** | ❌ Tables only | ❌ Tables with 🔥 icons | N/A | ✅ 7-day trend chart (Chart.js) |
| **Timeline Component** | ❌ Dates in table | ❌ Dates in table | N/A | ✅ Visual timeline with stages |
| **Data Freshness Indicators** | ❌ None | ❌ None | N/A | ✅ "Last updated: X min ago" |
| **IPO Cards** | ❌ Long tables (50+ rows) | ❌ Tables | N/A | ✅ Card-based UI |
| **Expandable Sections** | ❌ All visible (long scroll) | ❌ All visible | N/A | ✅ Collapsible (mobile) |
| **Broker Affiliate Placement** | ❌ Everywhere (intrusive) | ❌ Top, sidebar, bottom | N/A | ✅ Bottom only (non-intrusive) |
| **Visual Hierarchy** | ❌ Poor (everything fights for attention) | ❌ Moderate | N/A | ✅ Clear hierarchy |
| **Peer Comparison** | ✅ Table with 7-8 peers, all metrics | ❌ Not available | N/A | ✅ Enhanced table with visual indicators and tooltips |
| **IPO News/Updates** | ✅ Dedicated news page | ❌ Not available | N/A | ✅ Integrated news feed on detail page |
| **Allotment Status Checker** | ✅ PAN/App No/DP lookup with guide | ❌ Not available | N/A | ✅ Integrated checker with registrar contact |
| **Basis of Allotment** | ✅ Detailed table with ratios | ❌ Not available | N/A | ✅ Enhanced table with lot-wise breakdown |
| **GMP Subject/Kostak** | ❌ GMP only | ✅ Subject rate shown | N/A | ✅ GMP + Subject + Kostak rates |
| **Company Metrics** | ✅ Products, revenue breakdown | ❌ Basic only | N/A | ✅ Enhanced with growth % and market data |

**Key IPODhan Differentiators:**

1. **Visual Components vs Tables:**
   - Competitors: All data in HTML tables
   - IPODhan: Charts (GMP trend), progress bars (subscription), timeline (IPO stages), cards (IPO list)

2. **Performance:**
   - Competitors: 5-10 second load times due to heavy ads and scripts
   - IPODhan: <2 second load via Next.js SSR/SSG optimization

3. **Mobile Experience:**
   - Competitors: Desktop-first with poor mobile responsiveness
   - IPODhan: Mobile-first design with cards, collapsible sections, touch-optimized

4. **Data Transparency:**
   - Competitors: No indication of data freshness
   - IPODhan: "Last updated: X minutes ago" on all live data

5. **Clean Design:**
   - Competitors: Ad-heavy (broker ads, display ads, banners)
   - IPODhan: Clean interface with affiliate links only at bottom of detail pages

**User Pain Points Addressed:**

| User Pain Point | Competitor Behavior | IPODhan Solution |
|-----------------|---------------------|------------------|
| "Site is slow to load" | Heavy ads, unoptimized scripts | Next.js SSR/SSG, optimized assets, no ads |
| "Can't find subscription data easily" | Buried in tables, no visual | Prominent subscription widget with live progress bars |
| "GMP data is just numbers" | Tables with static numbers | Interactive 7-day GMP trend chart |
| "Mobile site is hard to use" | Desktop tables don't scale | Card-based UI, expandable sections, mobile-first |
| "Don't know if data is fresh" | No timestamps | "Last updated: 15 min ago" on all live data |
| "Too many ads and distractions" | Ads everywhere | Clean design, affiliates at bottom only |

---

## Implementation Roadmap

### Phase 0: Setup & Foundation (Weeks 1-2)

**Week 1:**
- [ ] Initialize Git repository
- [ ] Set up Next.js 14 project with TypeScript
- [ ] Configure Tailwind CSS
- [ ] Set up PostgreSQL database and create schema
- [ ] Configure environment variables
- [ ] Create basic project structure (`/components`, `/pages`, `/lib`, `/api`, `/scripts`)

**Week 2:**
- [ ] Design and implement database schema (create `schema.sql`)
- [ ] Write database seed script (`seed-data.js`) with 10-20 sample IPOs
- [ ] **Add Zerodha & AngelOne broker data to `brokers` table** (complete profile with charges, ratings, FAQs)
- [ ] Set up PM2 for process management
- [ ] Configure basic Next.js API routes for database connection testing
- [ ] Create basic homepage layout (Header, Footer, placeholder content)

**Deliverables:**
- Working Next.js app running on localhost
- Database populated with sample IPO data
- **Zerodha & AngelOne broker profiles fully populated** (ready for broker comparison)
- Basic UI components (Header, Footer, Button, Card)

---

### Phase 1: MVP Core Features (Weeks 3-8)

**Week 3-4: IPO Listings Dashboard (FR-1)**
- [ ] Create `/pages/index.js` (Homepage/Dashboard)
- [ ] Implement IPO Card component
- [ ] Build API route: `GET /api/ipo` (fetch all IPOs with filters)
- [ ] Implement filters: Status, Sector (client-side filtering)
- [ ] Implement search bar (client-side search)
- [ ] Add loading states and error handling
- [ ] Test on mobile and desktop

**Week 5-6: Detailed IPO Page (FR-2)**
- [ ] Create `/pages/ipo/[slug].js` dynamic route
- [ ] Build API route: `GET /api/ipo/[slug]`
- [ ] Implement all page sections:
  - Header with rating
  - Key Details Card
  - Timeline Component
  - Subscription Status Widget (static data for now)
  - GMP display (static for now)
  - Company Overview
  - Documents section
- [ ] Implement rating calculation logic (FR-5)
- [ ] Build API route: `GET /api/ipo/[slug]/rating`
- [ ] Add social share buttons (WhatsApp, Twitter)
- [ ] Test page load performance (target < 2 seconds)

**Week 7: Historical IPO Database (FR-3)**
- [ ] Create `/pages/history.js`
- [ ] Build historical IPOs table/card view
- [ ] Implement filters (Year, Sector, Performance)
- [ ] Implement sorting (by Listing Date, Listing Gain %)
- [ ] Add pagination (20 per page)
- [ ] Link to individual IPO detail pages

**Week 8: Responsive Design & Polish (FR-7)**
- [ ] Review all pages on mobile, tablet, desktop
- [ ] Implement mobile-specific navigation (hamburger menu, bottom nav)
- [ ] Fix responsive issues (collapsible sections, horizontal scroll tables)
- [ ] Optimize images (use Next.js Image component)
- [ ] Test on real devices (iOS, Android)
- [ ] Improve loading states and transitions

**Week 8.5: Broker Affiliate Integration (FR-6)** *(can be done in parallel with Week 8)*
- [ ] Verify Zerodha and AngelOne affiliate links are active
- [ ] Create `affiliate_clicks` table in database
- [ ] Create centralized config: `lib/config/affiliate-links.js`
- [ ] Add affiliate links to `.env.local`:
  - `ZERODHA_AFFILIATE_LINK=https://signup.zerodha.com/?c=ZMPHZC`
  - `ANGELONE_AFFILIATE_LINK=https://tinyurl.com/2d98g2qe`
- [ ] Download and add broker logos to `/public/logos/`
- [ ] Build API route: `POST /api/affiliate/track`
- [ ] Create reusable `BrokerButton` component
- [ ] Create `AffiliateCTA` component using affiliate config
- [ ] Add affiliate section to IPO detail pages
- [ ] Add dismissible banner to homepage
- [ ] Add affiliate links to email templates
- [ ] Implement click tracking and analytics (Google Analytics events)
- [ ] Add affiliate disclosure to footer
- [ ] Test all affiliate links and tracking

**Deliverables:**
- Functional dashboard showing sample IPOs
- Detailed IPO pages with all information sections
- Historical IPO archive with filters
- Fully responsive design
- Broker affiliate integration with click tracking

---

### Phase 2: Data Integration (Weeks 9-10)

**Week 9: Data Scraping Scripts**
- [ ] Build `scripts/scrapers/nse-scraper.js` (Puppeteer)
- [ ] Build `scripts/scrapers/bse-scraper.js`
- [ ] Test scrapers and verify data accuracy
- [ ] Implement error handling and logging (`scraper_logs` table)
- [ ] Create data normalization/validation functions
- [ ] Set up fallback to IPO Alerts API when scraping fails

**Week 10: Automated Data Pipeline**
- [ ] Set up Node-cron scheduler (`scripts/scheduler.js`)
- [ ] Configure scraping jobs (every 30 minutes)
- [ ] Build subscription scraper (`subscription-scraper.js`)
- [ ] Implement live subscription data updates in UI
- [ ] Add "Last Updated" timestamps and refresh buttons
- [ ] Test data freshness and accuracy

**Deliverables:**
- Automated data pipeline scraping NSE/BSE every 30 minutes
- Live IPO data on site (no more sample data)
- Real-time subscription status updates

---

### Phase 3: Admin Interface & Optimization (Weeks 11-12)

**Week 11: Admin Interface (FR-8)** *(Optional for MVP)*
- [ ] Create `/pages/admin/index.js` (password-protected)
- [ ] Implement basic authentication middleware
- [ ] Build admin dashboard:
  - View recent IPOs
  - Add new IPO form
  - Edit IPO form
  - Update GMP quick form
  - Update subscription quick form
- [ ] Build admin API routes:
  - `POST /api/admin/ipo`
  - `PUT /api/admin/ipo/[id]`
  - `DELETE /api/admin/ipo/[id]`
  - `PUT /api/admin/gmp/[id]`
- [ ] Test CRUD operations
- [ ] Add security measures (rate limiting, HTTPS enforcement)

**Week 12: Performance Optimization & Bug Fixes**
- [ ] Review all pages for performance optimization
- [ ] Optimize database queries (add missing indexes)
- [ ] Implement caching strategies (in-memory for MVP)
- [ ] Fix any bugs discovered during testing
- [ ] Lighthouse score optimization (target > 90)
- [ ] Security review (input validation, SQL injection prevention)

**Deliverables:**
- Admin panel for manual data management (optional)
- Performance-optimized site
- Bug-free core functionality

---

### Phase 4: Testing & Launch (~~Weeks 13-14~~ → **Weeks 11-12**)

**Week 11: Testing & Bug Fixes** *(Was Week 13)*
- [ ] End-to-end testing of all features
- [ ] Test on multiple browsers (Chrome, Firefox, Safari, Edge)
- [ ] Test on multiple devices (iPhone, Android, iPad, Desktop)
- [ ] Load testing (simulate 1000 concurrent users with Artillery or similar)
- [ ] Fix bugs and performance issues
- [ ] Test data scraping reliability over 1 week period

**Week 12: SEO, Deployment & Launch** *(Was Week 14)*
- [ ] Implement SEO best practices:
  - Add meta tags (title, description) to all pages
  - Create XML sitemap
  - Add robots.txt
  - Implement structured data (JSON-LD)
  - Optimize images (WebP format, compression)
- [ ] Performance optimization:
  - Enable Next.js SSR/SSG where appropriate
  - Optimize database queries (add indexes, use EXPLAIN)
  - Implement Cloudflare caching rules
  - Minify CSS/JS (automatic with Next.js production build)
- [ ] Set up monitoring:
  - Add site to UptimeRobot
  - Configure error tracking (Sentry optional)
  - Set up log rotation (PM2 log rotate)
- [ ] Deployment:
  - Build production bundle (`npm run build`)
  - Deploy to VPS with PM2
  - Configure IIS reverse proxy (or direct binding)
  - Point domain DNS to VPS IP
  - Enable Cloudflare SSL
  - Test live site
- [ ] Create backup script and schedule daily backups
- [ ] Document deployment process in README

**Deliverables:**
- Production-ready IPODhan platform
- Site live at ipodhan.com
- Monitoring and backups configured
- Documentation complete

---

### Phase 5: Post-Launch (~~Weeks 15-16~~ → **Weeks 13-14**)

**Week 13: Soft Launch & User Feedback** *(Was Week 15)*
- [ ] Share site with friends, family, colleagues for feedback
- [ ] Monitor analytics (Google Analytics or self-hosted)
- [ ] Track KPIs: page load times, user engagement, affiliate clicks
- [ ] Gather user feedback via simple feedback form or email
- [ ] Fix any critical bugs reported

**Week 14: Content & SEO** *(Was Week 16)*
- [ ] Write initial blog posts (educational content):
  - "How to Apply for an IPO: Step-by-Step Guide"
  - "Understanding IPO Subscription Categories: QIB, NII, RII"
  - "What is Grey Market Premium (GMP)?"
- [ ] Submit sitemap to Google Search Console
- [ ] Share content on social media, relevant forums (Reddit, Twitter)
- [ ] Reach out to financial bloggers/communities for backlinks
- [ ] Monitor search rankings for target keywords

**Deliverables:**
- Initial user base (target: 100+ weekly visitors)
- Positive user feedback
- SEO foundation established

---

### Post-MVP: Phase 2 Features (Months 4-6)

**Priority Features:**
1. **Email Alert System** ✉️ **(MOVED FROM MVP)**
   - Email subscription (no login required)
   - New IPO announcements
   - IPO closing reminders
   - Weekly digest of upcoming IPOs
   - Allotment and listing date alerts
   - Double opt-in, easy unsubscribe
   - Email service: Mailgun (5K/month free) or AWS SES ($0.10/1K)

2. **User Accounts & Portfolios**
   - User registration and login
   - Personal IPO watchlists
   - Track applied IPOs and allotment status
   - Portfolio performance tracking

3. **SME IPO Coverage**
   - Expand database to include SME IPOs
   - Add SME-specific risk warnings
   - Separate SME section on dashboard

4. **Advanced Filtering & Comparison**
   - Side-by-side IPO comparison tool
   - Custom filter builder
   - Save filter preferences

5. **Enhanced Analytics**
   - Sector-wise IPO performance trends
   - Subscription pattern insights
   - Historical comparison charts

6. **Community Features**
   - User ratings and reviews (moderated)
   - Discussion forum or comments
   - Sentiment tracking

7. **Mobile App (PWA)**
   - Convert to Progressive Web App
   - Offline data access
   - Push notifications for alerts

---

## Risk Management

### Risk 1: Data Source Reliability

**Risk:** NSE/BSE websites change structure, breaking scrapers.

**Impact:** High - Site shows outdated/no data, users lose trust.

**Probability:** Medium - Exchanges update sites periodically.

**Mitigation:**
- Build modular scrapers with easy-to-update selectors
- Implement fallback to IPO Alerts API when scraping fails
- Set up monitoring to alert on scraper failures
- Maintain manual update capability via admin panel
- Document scraper logic for quick fixes

**Contingency:**
- If scraper breaks, switch to manual updates via admin panel
- Fix scraper within 24 hours (dedicated time)
- Consider paid data API if scraping becomes unsustainable

---

### Risk 2: Legal/Compliance Issues

**Risk:** Providing IPO analysis may have regulatory implications (SEBI).

**Impact:** High - Legal action, site shutdown.

**Probability:** Low - Similar sites exist, positioned as informational.

**Mitigation:**
- Display prominent disclaimers on every page:
  - "IPODhan provides information for educational purposes only. This is not financial advice. Investors should conduct their own research and consult with financial advisors."
- Avoid language suggesting guaranteed returns or specific investment advice
- Position ratings as "objective data-based analysis" not "recommendations to buy"
- If site gains significant traction (100K+ users), consult legal expert on compliance

**Contingency:**
- If contacted by SEBI or regulators, immediately consult lawyer
- Adjust disclaimers and rating language as advised
- Remove rating feature if legally required (focus on data only)

---

### Risk 3: Scalability Limits on Shared VPS

**Risk:** Traffic spikes during popular IPOs overwhelm shared VPS resources.

**Impact:** Medium - Site slowdowns or downtime, poor user experience.

**Probability:** Medium - IPO hype can drive 5-10x normal traffic.

**Mitigation:**
- Implement aggressive caching (Cloudflare, in-memory caching)
- Optimize database queries and indexes
- Monitor VPS resource usage (CPU, RAM, bandwidth)
- Use Next.js SSG/ISR to serve static pages where possible
- Load test site before launch (target: 1000 concurrent users)

**Contingency:**
- If VPS struggles, activate Cloudflare "Under Attack" mode (challenge for bots)
- Temporarily disable heavy features (live subscription refresh, charts)
- Upgrade VPS plan or migrate to dedicated server
- Long-term: migrate to cloud (Vercel, AWS, DigitalOcean) with auto-scaling

---

### Risk 4: Low User Adoption

**Risk:** Site doesn't attract users, traffic remains low.

**Impact:** Medium - Business objectives not met, wasted effort.

**Probability:** Medium - SEO and word-of-mouth are uncertain.

**Mitigation:**
- Focus on SEO from day 1 (structured data, fast load times, quality content)
- Create shareable content (blog posts, social media posts)
- Leverage personal networks for initial users
- Participate in financial forums, Reddit (r/IndianStockMarket), Twitter
- Ensure site provides clear value: faster, cleaner, more reliable than competitors
- Collect email subscribers early for re-engagement

**Contingency:**
- If organic growth is slow, consider:
  - Paid ads (Google Ads, Facebook) with small budget ($50-100/month)
  - Partnerships with financial bloggers/YouTubers for mentions
  - Focus on niche: target specific investor communities (e.g., tech IPOs, SME IPOs)
- Pivot messaging or features based on user feedback

---

### Risk 5: Data Accuracy Issues

**Risk:** Incorrect IPO data displayed, damaging user trust.

**Impact:** High - Loss of credibility, users abandon site.

**Probability:** Low-Medium - Scraping errors, data source errors possible.

**Mitigation:**
- Cross-reference data from multiple sources (NSE, BSE, IPO Alerts API)
- Implement data validation (e.g., check date ranges, subscription figures < 100x)
- Display "Last Updated" timestamps for all dynamic data
- Allow users to report errors (feedback form or email)
- Monitor scraper logs daily for errors
- Manually verify critical data (GMP, subscription) for high-profile IPOs

**Contingency:**
- If error reported, fix immediately (< 1 hour)
- Post correction notice if error was visible for extended period
- Investigate root cause and improve validation logic
- In extreme case of repeated errors, temporarily pause automated updates and switch to manual mode

---

## Appendices

### Appendix A: Glossary of IPO Terms

*(To be included on site as `/glossary` page in Phase 2)*

- **IPO (Initial Public Offering)**: First sale of stock by a company to the public.
- **DRHP (Draft Red Herring Prospectus)**: Preliminary document filed with SEBI containing company details.
- **RHP (Red Herring Prospectus)**: Final prospectus filed before IPO opens.
- **GMP (Grey Market Premium)**: Unofficial premium at which IPO shares trade before listing.
- **QIB (Qualified Institutional Buyers)**: Large institutional investors (mutual funds, insurance).
- **NII (Non-Institutional Investors)**: HNIs and corporate investors.
- **RII (Retail Individual Investors)**: Individual investors applying for < ₹2 lakhs.
- **Lot Size**: Minimum number of shares that can be applied for.
- **Subscription**: Number of times IPO is oversubscribed (e.g., 5x = applications for 5x available shares).
- **Listing Day**: First day IPO shares trade on stock exchange.
- **Book Building**: Process of price discovery based on investor demand.

---

### Appendix B: Competitor Feature Matrix

| Feature | Chittorgarh.com | InvestorGain.com | IPODhan (MVP) | IPODhan (Phase 2) |
|---------|----------------|------------------|---------------|-------------------|
| Current IPO Listings | ✅ | ✅ | ✅ | ✅ |
| Upcoming IPO Listings | ✅ | ✅ | ✅ | ✅ |
| Historical IPO Data | ✅ | ✅ | ✅ | ✅ |
| Subscription Status | ✅ | ✅ | ✅ | ✅ |
| GMP Tracking | ✅ | ✅ | ✅ (manual) | ✅ (automated) |
| IPO Rating/Score | ✅ | ✅ | ✅ | ✅ |
| Email Alerts | ✅ | ✅ | ✅ | ✅ |
| Mobile App | ✅ | ✅ | ❌ | ✅ (PWA) |
| Page Load Speed | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| User Interface | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Ad Density | Heavy | Medium | Minimal/None | Minimal |
| SME IPO Coverage | ✅ | ✅ | ❌ | ✅ |
| User Accounts | ❌ | ❌ | ❌ | ✅ |
| IPO Comparison Tool | ✅ | ✅ | ❌ | ✅ |
| Educational Content | ✅ | ✅ | ❌ | ✅ |
| Broker Integration | ✅ | ✅ | ✅ (Zerodha, AngelOne) | ✅ (expanded) |

---

### Appendix C: Sample Email Templates

**New IPO Alert Email:**

```
Subject: New IPO Alert: [Company Name] opens on [Date]

Hi there,

A new IPO has been announced and is opening soon!

Company: [Company Name]
Sector: [Sector]
Price Band: ₹[Min] - ₹[Max]
IPO Opens: [Open Date]
IPO Closes: [Close Date]

[2-3 line company description]

View full details and IPODhan rating:
[Link to IPO Detail Page]

Apply for this IPO:
→ Zerodha: https://signup.zerodha.com/?c=ZMPHZC
→ Angel One: https://tinyurl.com/2d98g2qe

---
You're receiving this because you subscribed to IPO alerts at IPODhan.com.
IPODhan may earn a commission if you open an account through our links.
Unsubscribe: [Unsubscribe Link]
```

**IPO Closing Reminder Email:**

```
Subject: Reminder: [Company Name] IPO closes today!

Hi there,

Don't miss out—this IPO is closing today!

Company: [Company Name]
IPO Closes: [Close Date] (Today!)
Current Subscription: [X.Xx times]
GMP: ₹[GMP] ([+/- %])

Make your decision and apply before the deadline.

View latest subscription status and details:
[Link to IPO Detail Page]

Apply now:
→ Zerodha: https://signup.zerodha.com/?c=ZMPHZC
→ Angel One: https://tinyurl.com/2d98g2qe

---
IPODhan may earn a commission if you open an account through our links.
Unsubscribe: [Unsubscribe Link]
```

---

### Appendix D: Database Backup & Recovery Plan

**Backup Strategy:**

1. **Automated Daily Backups**
   - Script: `scripts/backup-db.bat`
   - Schedule: Daily at 3:00 AM IST (Windows Task Scheduler)
   - Command: `pg_dump -U postgres -d ipodhan -F c -f "D:\Backups\ipodhan_backup_%date:~-4,4%%date:~-10,2%%date:~-7,2%.dump"`
   - Retention: Keep 7 daily backups (delete older than 7 days)

2. **Weekly Backups**
   - Every Sunday, copy latest daily backup to separate "Weekly" folder
   - Retention: Keep 4 weekly backups (1 month)

3. **Backup Storage**
   - Local: `D:\Backups\ipodhan\`
   - External (optional): Copy to external drive or cloud storage (Dropbox, Google Drive) weekly

**Recovery Procedure:**

1. **Identify Latest Backup**
   - Navigate to `D:\Backups\ipodhan\`
   - Identify most recent `.dump` file

2. **Restore Database**
   ```bash
   # Drop existing database (CAUTION: DATA LOSS)
   dropdb -U postgres ipodhan

   # Create fresh database
   createdb -U postgres ipodhan

   # Restore from backup
   pg_restore -U postgres -d ipodhan "D:\Backups\ipodhan\ipodhan_backup_20250115.dump"
   ```

3. **Verify Restoration**
   - Connect to database: `psql -U postgres -d ipodhan`
   - Check table counts: `SELECT COUNT(*) FROM ipos;`
   - Verify recent data present

4. **Restart Application**
   - `pm2 restart ipodhan`
   - Test site functionality

**Testing:**
- Test restore procedure monthly to ensure backups are valid
- Document any issues and update recovery procedure

---

### Appendix E: Deployment Checklist

**Pre-Deployment:**
- [ ] All MVP features implemented and tested
- [ ] Database schema finalized and populated with data
- [ ] Environment variables configured (`.env.local`)
- [ ] Production build successful (`npm run build`)
- [ ] Performance targets met (page load < 2s)
- [ ] Mobile responsiveness verified
- [ ] SEO meta tags and sitemap implemented
- [ ] Security review completed (input validation, HTTPS, etc.)

**Deployment:**
- [ ] Code pushed to Git repository
- [ ] VPS access verified (SSH or RDP)
- [ ] Node.js and PostgreSQL installed on VPS
- [ ] Database created and schema applied
- [ ] Application files transferred to VPS
- [ ] Dependencies installed (`npm install --production`)
- [ ] PM2 configured and application started
- [ ] Web server (IIS or direct binding) configured
- [ ] Domain DNS pointed to VPS IP
- [ ] Cloudflare SSL enabled and tested
- [ ] Firewall rules configured (allow HTTP/HTTPS)

**Post-Deployment:**
- [ ] Site accessible at ipodhan.com
- [ ] HTTPS working (no mixed content warnings)
- [ ] All pages loading correctly
- [ ] Database connections working
- [ ] Email alerts sending successfully
- [ ] Affiliate links working (Zerodha, AngelOne)
- [ ] Affiliate click tracking functioning
- [ ] Admin panel accessible and functional
- [ ] Monitoring tools configured (UptimeRobot, logs)
- [ ] Backup script scheduled and tested
- [ ] Performance verified (Lighthouse score > 90)

**Launch:**
- [ ] Announce launch on social media
- [ ] Share with personal network
- [ ] Submit to Google Search Console
- [ ] Post on relevant forums/communities
- [ ] Monitor traffic and errors closely for first 48 hours

---

### Appendix F: Affiliate Link Management Guide

**Current Active Affiliate Links:**

| Broker | Affiliate Link | Status | Added Date |
|--------|---------------|--------|------------|
| Zerodha | `https://signup.zerodha.com/?c=ZMPHZC` | ✅ Active | Jan 2025 |
| Angel One | `https://tinyurl.com/2d98g2qe` | ✅ Active | Jan 2025 |

**Configuration Locations:**

1. **Environment Variables (`.env.local`)**
   ```env
   ZERODHA_AFFILIATE_LINK=https://signup.zerodha.com/?c=ZMPHZC
   ANGELONE_AFFILIATE_LINK=https://tinyurl.com/2d98g2qe
   ```

2. **Centralized Config File (`lib/config/affiliate-links.js`)**
   - Contains broker metadata (name, logo, description, CTA)
   - Reads links from environment variables
   - Provides helper functions for components
   - See FR-6 for full code structure

**How to Update Affiliate Links:**

**Option 1: Update Environment Variables (Recommended)**
1. Edit `.env.local` file on server
2. Update the specific broker's link
3. Restart PM2 process: `pm2 restart ipodhan`
4. Verify link works by testing on site

**Option 2: Update Config File (For metadata changes)**
1. Edit `lib/config/affiliate-links.js`
2. Update broker name, description, CTA, or logo path
3. Deploy updated code
4. Restart application

**Adding New Brokers:**

1. **Get affiliate link** from new broker (e.g., Groww, Upstox)
2. **Add to environment variables**:
   ```env
   GROWW_AFFILIATE_LINK=https://groww.in/refer?code=IPODHAN
   ```
3. **Update config file** (`lib/config/affiliate-links.js`):
   ```javascript
   {
     id: 'groww',
     name: 'Groww',
     displayName: 'Groww',
     link: process.env.GROWW_AFFILIATE_LINK || 'https://groww.in/refer?code=IPODHAN',
     logo: '/logos/groww.png',
     description: 'Simple & easy investing',
     cta: 'Apply via Groww',
     enabled: true
   }
   ```
4. **Add broker logo** to `/public/logos/groww.png`
5. **Deploy and test**

**Disabling a Broker Temporarily:**

In `lib/config/affiliate-links.js`, set `enabled: false`:
```javascript
{
  id: 'angelone',
  name: 'AngelOne',
  // ... other fields
  enabled: false  // This will hide AngelOne from UI
}
```

**Monitoring Affiliate Performance:**

1. **Database Query** to check clicks:
   ```sql
   SELECT broker, COUNT(*) as clicks, DATE(clicked_at) as date
   FROM affiliate_clicks
   WHERE clicked_at > NOW() - INTERVAL '30 days'
   GROUP BY broker, DATE(clicked_at)
   ORDER BY date DESC, clicks DESC;
   ```

2. **Admin Dashboard** (Phase 2):
   - View at `/admin/affiliate-stats`
   - See click-through rates by broker
   - See click sources (detail page, homepage, email)

3. **Google Analytics**:
   - Events: `affiliate_click`
   - Event parameters: `broker` (zerodha, angelone)
   - Check in GA4 Events dashboard

**Best Practices:**

- Test affiliate links monthly to ensure they're still active
- Keep environment variables backed up securely
- Monitor click-through rates to optimize placement
- Ensure affiliate disclosures are always visible
- Update broker logos if they rebrand
- Track conversion rates via broker affiliate dashboards (if available)

---

## Approval & Sign-Off

This PRD is a living document and will be updated as the project evolves.

**Version History:**
- v1.0 (January 2025): Initial PRD created based on Project Brief and research findings
- v1.1 (January 2025): Added broker affiliate integration (Zerodha, AngelOne) with centralized configuration management
- v1.2 (January 2025): Interactive review completed for Sections 8-19, PRD finalized and approved

**Status:** ✅ **FINALIZED** - Ready for Implementation

**Approval:**
- [x] Product Requirements Reviewed
- [x] Technical Feasibility Confirmed
- [x] Implementation Roadmap Validated
- [x] Risk Assessment Complete
- [x] Appendices & Documentation Complete

**Next Steps:**
1. ✅ **PRD Finalized** - Complete
2. **Begin Phase 0: Setup & Foundation**
   - Initialize Git repository
   - Set up Next.js 14 + TypeScript + Tailwind CSS
   - Configure PostgreSQL database
   - Create project structure
3. **Kick off Development** - Follow Implementation Roadmap (Weeks 1-14)

**Key Deliverables Summary:**
- **MVP Timeline:** 12-14 weeks
- **Core Features:** IPO Listings, Detail Pages, Historical Data, Rating System, Broker Affiliates, Responsive Design
- **Technology Stack:** Next.js 14, PostgreSQL, Tailwind CSS, Chart.js
- **Performance Target:** <2s page load, Lighthouse score >90
- **Differentiators:** Mobile-first, clean UI, visual components, real-time data with timestamps

**Success Metrics (First 3 Months Post-Launch):**
- 100+ weekly active users
- <2s average page load time
- 10+ affiliate clicks per week
- 90+ Lighthouse performance score
- Zero data accuracy incidents

---

**End of Product Requirements Document**
