
# ipodhan.com - Detailed Design Requirement Document (DGD)

## 1. Project Overview
ipodhan.com will be a comprehensive **IPO-focused portal** for Indian retail investors.  
The platform provides real-time IPO updates, Grey Market Premium (GMP) tracking, calculators, knowledge hub, and broker comparisons.  
It aims to serve as a **one-stop solution for IPO investors** with a mix of free and premium features.

---

## 2. Target Audience
- Retail IPO investors in India
- First-time IPO applicants
- Active traders seeking GMP and allotment insights
- Investors comparing brokers for IPO applications

---

## 3. Core Features
### 3.1 IPO Section
- **Live IPOs**: Ongoing IPO details (price band, dates, issue size, subscription data, etc.).
- **Upcoming IPOs**: Calendar view of IPOs yet to open.
- **Recently Closed IPOs**: Performance summary with listing gains/losses.
- **IPO Dashboard**: Aggregated list with filters (sector, size, SME/mainboard, etc.).
- **Individual IPO Pages**:
  - Overview
  - Subscription status (auto-updated)
  - GMP Tracking
  - Review & Analysis (expert + community)
  - FAQs

### 3.2 GMP (Grey Market Premium)
- **GMP Dashboard** with current GMP trends.
- **Individual GMP Pages** with historical tracking charts.

### 3.3 Tools
- **Allotment Calculator**: Based on subscription data & retail quota.
- **ROI Calculator**: Expected vs actual listing returns.
- **Portfolio Tracker**: Track IPO investments (manual entry for now).

### 3.4 Knowledge Hub
- **IPO Basics**: Beginner-friendly guides.
- **Step-by-Step Guides**: How to apply for IPOs, check allotment, etc.
- **SEBI Rules**: Compliance and regulatory explanations.

### 3.5 Brokers
- **Broker Comparison**: Charges, IPO application process, etc.
- **Open Demat Account**: Affiliate integration with brokers.

### 3.6 Premium Features (Future Scope)
- Ad-Free Experience
- Advanced GMP & Allotment Probability Data
- Exclusive Research Reports

### 3.7 Blog / News
- **Market Insights**
- **IPO News**
- **Regulatory Updates**

---

## 4. Website Structure (Sitemap)
- **Home**
  - Live IPOs
  - Upcoming IPOs
  - Recently Closed IPOs
  - IPO Calendar
- **IPOs**
  - IPO Dashboard
  - Individual IPO Pages (Overview, Subscription, GMP, Reviews, FAQs)
- **GMP**
  - GMP Dashboard
  - Individual GMP Pages
- **Tools**
  - Allotment Calculator
  - ROI Calculator
  - Portfolio Tracker
- **Knowledge**
  - IPO Basics
  - Step-by-Step Guides
  - SEBI Rules
- **Brokers**
  - Broker Comparison
  - Open Demat Account
- **Premium**
  - Ad-Free
  - Advanced Data
  - Premium Tools
- **Blog**
  - Market Insights
  - IPO News
  - Regulatory Updates
- **About**
  - About Us
  - Compliance & SEBI Details
  - Privacy Policy
  - Contact Us

---

## 5. Technology Stack (Proposed)
- **Frontend**: React (Next.js) with Tailwind CSS
- **Backend**: Node.js + Express (or Django as an alternative)
- **Database**: PostgreSQL / MySQL
- **Hosting**: AWS / Vercel / Netlify
- **Analytics**: Google Analytics + Custom Tracking
- **SEO**: Server-Side Rendering (SSR) for IPO pages

---

## 6. Design Guidelines
- **UI/UX Principles**:
  - Clean, minimal, mobile-first design
  - IPO & GMP data emphasized visually (charts, highlights)
  - Light & dark mode toggle
- **Branding**:
  - Logo: "IPO Dhan" with financial/market theme
  - Colors: Blue (trust), Green (growth), White (clean UI)

---

## 7. Data Flow & Updates
- IPO Data: Fetched from NSE/BSE feeds or trusted APIs
- GMP Data: Manual + automated tracking from sources
- Allotment Data: Updated from registrar sites (manual initially)
- Blog & Knowledge: CMS-based (WordPress headless or custom)

---

## 8. Monetization Strategy
- Free + Premium Subscription model
- Google Ads + Affiliate Partnerships (Broker Demat Accounts)
- Sponsored IPO Reviews (with disclaimers)

---

## 9. Future Enhancements
- Multi-language support (starting with English, later Hindi & regional languages)
- AI-powered IPO prediction models
- Community forums for IPO discussions
- Mobile app (React Native / Flutter)

---

## 10. Compliance
- SEBI regulations to be followed for IPO content
- Privacy policy & disclaimer pages mandatory
- Transparent disclosure for affiliate partnerships

---

## 11. Deliverables
1. Interactive Sitemap (HTML) ✅
2. Design Requirement Document (this file) ✅
3. Wireframes (Next Step)
4. Prototype UI (Figma/Adobe XD)
5. Development Plan & Roadmap

---

**Prepared for:** ipodhan.com  
**Document Type:** Design Requirement Document (DGD)  
**Version:** 1.0  
**Date:** September 25, 2025  
