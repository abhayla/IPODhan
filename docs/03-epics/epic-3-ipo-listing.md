# Epic 3: IPO Listing & Discovery

**Duration:** Weeks 3-4
**Goal:** Browse current/upcoming IPOs with filtering and search
**Business Value:** Primary user entry point - see all IPOs at a glance
**Status:** Pending

---

## Overview

This epic implements the core dashboard experience where users discover IPOs. It includes the homepage, filtering system, search functionality, and the foundational IPO card component used throughout the app.

## Success Criteria

- ✅ Users can view current and upcoming IPOs on homepage
- ✅ Filtering by status, category, sector works smoothly
- ✅ Search returns relevant IPOs instantly
- ✅ Responsive on all devices (mobile-first)
- ✅ Page load <2 seconds (LCP <2.5s)

## Stories

| ID | Story | Priority | Points | Status | Dependencies |
|----|-------|----------|--------|--------|--------------|
| 3.1 | API Client Service | Critical | 3 | Pending | 1.3 |
| 3.2 | GET /api/ipos Route | Critical | 5 | Pending | 2.3 |
| 3.3 | IPO Card Component | Critical | 5 | Pending | 1.4 |
| 3.4 | Dashboard Page | Critical | 8 | Pending | 3.1, 3.2, 3.3 |
| 3.5 | Filter Logic | High | 5 | Pending | 3.4 |
| 3.6 | Search Implementation | High | 5 | Pending | 3.4 |
| 3.7 | Loading & Error States | Medium | 3 | Pending | 3.4 |

**Total Points:** 34
**Estimated Duration:** 1.5 weeks

---

## User Journey (Rahul - Primary Persona)

1. Rahul visits ipodhan.com
2. Sees grid of current IPOs immediately (no loading delay)
3. Filters to "Open" status to see only active IPOs
4. Searches for "tech" to find technology sector IPOs
5. Clicks on an IPO card to view details
6. Returns to dashboard with filters preserved

---

## Critical Path

**Story 3.4 (Dashboard Page) is the KEY DELIVERABLE:**
- First user-visible feature
- Integrates all prior work (repos, APIs, components)
- Demonstrates full stack working end-to-end

⚠️ **Dependency Chain:**
1. Story 3.1 (API Client) ← Foundation
2. Story 3.2 (API Route) ← Needs repositories
3. Story 3.3 (IPO Card) ← Needs shadcn/ui
4. Story 3.4 (Dashboard) ← Combines 3.1, 3.2, 3.3

**No parallelization possible for 3.1-3.4**

---

## Technical Details

### API Endpoint
```
GET /api/ipos
Query Params:
  - status: open|upcoming|closed|listed
  - category: mainboard|sme|rights|ncd
  - sector: string
  - search: string
  - page: number
  - limit: number

Response:
{
  data: IPO[],
  pagination: { page, limit, total, hasNext }
}
```

### Filter State Management
- Option A: React Context (chosen per Architecture)
- Option B: URL query params (for shareable links)
- **Decision needed in Story 3.5**

### Performance Targets
- Initial page load (SSR): <2s
- Filter apply: <100ms (client-side)
- Search results: <500ms (debounced)

---

## Dependencies

**This Epic Requires:**
- Epic 1: Story 1.4 (shadcn/ui for components)
- Epic 2: Story 2.3 (Repositories for API)
- Epic 2: Story 2.4 (Seed data for testing)

**This Epic Blocks:**
- Epic 4: Detail page (navigated from cards)
- Epic 6: Historical page (similar pattern)

---

## Risks & Mitigation

**Risk 1: Performance degradation with many IPOs**
- Mitigation: Pagination (20 per page), virtual scrolling if needed
- Contingency: Server-side filtering if client-side too slow

**Risk 2: Filter complexity overwhelming users**
- Mitigation: User testing with 3+ users, iterate on UX
- Contingency: Simplify to status-only filter for MVP

---

## Definition of Done

- [ ] Dashboard accessible at / (homepage)
- [ ] Shows real IPO data from database (not hardcoded)
- [ ] Filters work and sync to URL
- [ ] Search returns accurate results
- [ ] Responsive on mobile (tested on real device)
- [ ] Lighthouse: Performance >90, SEO >95
- [ ] E2E test: User visits, filters, searches, clicks card
- [ ] Demoed to PO (Sarah) and approved
