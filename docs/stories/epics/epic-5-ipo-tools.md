# Epic 5: IPO Tools & Calculators

**Duration:** Week 7
**Goal:** Practical utilities to assist investment decisions
**Business Value:** Differentiation from competitors, increase user engagement
**Status:** Pending

---

## Overview

This epic delivers the utility tools that help users make informed investment decisions: lot size calculator, IPO comparison tool, registrar directory, and market holidays calendar. These features address gaps in competitor platforms.

## Success Criteria

- ✅ Lot calculator accurately computes lots for any investment amount
- ✅ Comparison tool allows side-by-side IPO analysis
- ✅ Registrar directory provides allotment checking links
- ✅ Market holidays calendar prevents application errors
- ✅ All tools mobile-friendly and fast (<1s response)

## Stories

| ID | Story | Priority | Points | Status | Dependencies |
|----|-------|----------|--------|--------|--------------|
| 5.1 | Lot Size Calculator | High | 3 | Pending | 4.3 |
| 5.2 | IPO Comparison Tool | High | 5 | Pending | 4.3 |
| 5.3 | Registrar Directory | High | 3 | Pending | 2.3 |
| 5.4 | Market Holidays Calendar | Medium | 3 | Pending | 2.3 |
| 5.5 | Broker Affiliate Integration | High | 5 | Pending | 4.3 |

**Total Points:** 19
**Estimated Duration:** 1 week

---

## Feature Details

### 5.1 Lot Size Calculator (FR-10)
**User Story:** As Priya (newcomer), I want to know how many lots I can buy with ₹15,000, so I can plan my application.

**Implementation:**
- Embedded widget on detail page
- Standalone page at /tools/lot-calculator
- Input: Investment amount
- Output: Lots, shares, total amount
- Formula: `lots = floor(amount / (lotSize * pricePerShare))`

### 5.2 IPO Comparison Tool (FR-11)
**User Story:** As Rahul (active investor), I want to compare 2-3 IPOs side-by-side, so I can choose the best investment.

**Implementation:**
- Page at /tools/compare
- Select up to 3 IPOs (dropdown search)
- Comparison table:
  - Price range, lot size
  - Subscription status
  - GMP
  - Financial metrics (P/E, ROE, Revenue growth)
  - Rating
- Shareable URL: `/tools/compare?ipos=slug1,slug2,slug3`

### 5.3 Registrar Directory (FR-9)
**User Story:** As an investor, I want to find my IPO's registrar contact info, so I can check allotment status.

**Implementation:**
- Page at /registrars
- Searchable directory (all registrars)
- Each entry shows:
  - Registrar name
  - Contact email, phone
  - Website link
  - Allotment check URL (if available)
- Link from IPO detail page

### 5.4 Market Holidays Calendar (FR-8)
**User Story:** As an investor, I want to see market holidays, so I don't plan IPO applications on closed days.

**Implementation:**
- Page at /market-holidays
- Calendar view (month/year filter)
- List view (upcoming holidays)
- Highlights NSE/BSE specific holidays
- Export as iCal (Phase 2)

### 5.5 Broker Affiliate Integration (FR-6)
**User Story:** As a user, I want to easily open a Demat account, so I can apply for IPOs.

**Implementation:**
- Affiliate buttons on detail pages
- Zerodha and AngelOne (MVP)
- Click tracking (Google Analytics event)
- Affiliate disclosure in footer

---

## Technical Details

### API Endpoints
```
POST /api/tools/lot-calculator
  Body: { ipoSlug, investmentAmount }
  Response: { lots, totalShares, totalAmount }

POST /api/tools/compare
  Body: { ipoSlugs: string[] }
  Response: { comparison: IPOComparison[] }

GET /api/registrars
  Query: ?search=link+intime
  Response: { registrars: Registrar[] }

GET /api/holidays
  Query: ?year=2025&exchange=NSE
  Response: { holidays: MarketHoliday[] }

POST /api/affiliate/track
  Body: { brokerName, ipoSlug, source }
  Response: { success: true }
```

---

## Dependencies

**This Epic Requires:**
- Epic 2: Story 2.3 (Repositories for registrar, holidays data)
- Epic 4: Story 4.3 (Detail page to embed calculator)

**This Epic Blocks:**
- None (standalone tools)

---

## Risks & Mitigation

**Risk 1: Comparison tool too complex for MVP**
- Mitigation: Start with 2 IPOs, basic metrics only
- Contingency: Defer to Phase 2 if time constrained

**Risk 2: Affiliate click tracking unreliable**
- Mitigation: Use Google Analytics events (proven)
- Contingency: Manual tracking via broker dashboards

---

## Definition of Done

- [ ] All 5 tools accessible and functional
- [ ] Tools embedded in relevant pages (calculator in detail)
- [ ] Standalone pages for each tool
- [ ] Mobile responsive (tested on real devices)
- [ ] Analytics tracking configured
- [ ] User testing with 3+ users (usability validation)
- [ ] PO approval
