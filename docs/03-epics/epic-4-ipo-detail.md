# Epic 4: IPO Detail & Analysis

**Duration:** Weeks 5-6
**Goal:** Deep-dive into individual IPO with all decision-making data
**Business Value:** Core information hub for investment decisions
**Status:** Pending

---

## Overview

This epic delivers the comprehensive IPO detail page where users analyze a specific IPO before investing. It includes all data tiers (key details, financials, subscription, GMP, documents) and interactive features like rating system and social sharing.

## Success Criteria

- ✅ Complete IPO detail page with all sections from PRD
- ✅ Real-time subscription data display
- ✅ GMP trend visualization
- ✅ Financial data in tabbed interface
- ✅ Rating algorithm functional
- ✅ Page load <2 seconds, SEO optimized

## Stories

| ID | Story | Priority | Points | Status | Dependencies |
|----|-------|----------|--------|--------|--------------|
| 4.1 | GET /api/ipos/[slug] Route | Critical | 5 | Pending | 2.3 |
| 4.2 | Detail Page Components | Critical | 8 | Pending | 1.4 |
| 4.3 | IPO Detail Page Assembly | Critical | 8 | Pending | 3.1, 4.1, 4.2 |
| 4.4 | Rating System Implementation | High | 5 | Pending | 4.3 |
| 4.5 | Social Share Integration | Medium | 2 | Pending | 4.3 |
| 4.6 | Allotment Status Checker | High | 5 | Pending | 4.3 |

**Total Points:** 33
**Estimated Duration:** 1.5 weeks

---

## User Journey (Rahul - Primary Persona)

1. Rahul clicks IPO card from dashboard
2. Lands on detail page, sees key info immediately (Tier 1 data)
3. Scrolls to subscription status - sees real-time numbers
4. Checks GMP trend chart - visualizes 7-day history
5. Tabs to financials - reviews revenue, profit, P/E ratio
6. Reads company overview and risk factors
7. Downloads DRHP document
8. Sees 4-star rating with rationale
9. Shares IPO link on WhatsApp with friends

---

## Page Sections (from PRD FR-2)

### Tier 1 Data (Above Fold, SSR)
- Company name & logo
- IPO status badge
- Price range & lot size
- Open/close dates
- Rating (1-5 stars)
- Key metrics cards (issue size, subscription, GMP)

### Tier 2 Data (Lazy Loaded, Tabs)
- Subscription breakdown (QIB, NII, Retail)
- GMP history chart (7 days)
- Financial highlights (3-year trend)
- Peer comparison table
- Documents (DRHP, RHP, Prospectus)
- Company overview (business model, risk factors)

### Interactive Features
- Allotment status checker (registrar lookup)
- Lot size calculator (embedded)
- Social share (WhatsApp, Twitter, Copy Link)
- Broker affiliate CTAs

---

## Technical Details

### API Endpoint
```
GET /api/ipos/[slug]

Response:
{
  ipo: IPO,
  financial: FinancialData,
  documents: Document[],
  latestSubscription: Subscription,
  gmpHistory: GMPRecord[], // last 7 days
  peers: PeerCompany[],
  registrar: Registrar
}
```

### Rating Algorithm (Story 4.4)
Factors (from PRD FR-5):
- Subscription level (30%)
- Promoter holding (20%)
- Financial growth (20%)
- GMP (15%)
- Peer P/E comparison (15%)

Output: 1-5 stars + rationale text

### Performance
- SSR for above-fold content
- Client-side data fetching for tabs
- Progressive loading: Tier 1 → Tier 2
- Target: <2s initial load, <500ms tab switch

---

## Dependencies

**This Epic Requires:**
- Epic 2: Story 2.3 (Repositories for data)
- Epic 3: Story 3.1 (API client)
- Epic 1: Story 1.4 (shadcn/ui components)

**This Epic Blocks:**
- Epic 5: Tools (lot calculator embedded in detail page)

---

## Risks & Mitigation

**Risk 1: Page complexity causes slow load**
- Mitigation: Progressive loading, lazy tabs, SSR for critical path
- Contingency: Remove non-essential sections (peer comparison optional)

**Risk 2: Rating algorithm controversial**
- Mitigation: Clear methodology disclosure, admin override
- Contingency: Make rating optional, hide if data insufficient

---

## Definition of Done

- [ ] Detail page accessible at /ipos/[slug]
- [ ] All PRD sections implemented and visible
- [ ] Rating displays for IPOs with sufficient data
- [ ] Social sharing works (tested on mobile)
- [ ] Allotment checker redirects to registrar
- [ ] Lighthouse: Performance >90, SEO >95
- [ ] Structured data (JSON-LD) for IPO entity
- [ ] E2E test: Navigate from dashboard, view all tabs, share link
- [ ] PO approval after demo
