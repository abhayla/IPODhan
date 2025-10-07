# Sprint 3 Plan: IPO Listing & Discovery

**Sprint Number:** 3
**Sprint Goal:** Build core IPO listing and discovery features with API routes, components, and dashboard
**Epic:** Epic 3 - IPO Listing & Discovery
**Duration:** 2 weeks (split from original 1-week estimate due to 34-point load)
**Story Points:** 34
**Status:** 🚀 IN PROGRESS (21/34 points complete, 62%)

---

## Sprint Progress Summary

**Updated:** 2025-10-06

### Current Status: 🚀 IN PROGRESS (Week 1+ Complete)

| Story | Points | Status | Quality | Notes |
|-------|--------|--------|---------|-------|
| 3.1 | 3 | ✅ COMPLETE | 9.5/10 | API Client Service |
| 3.2 | 5 | ✅ COMPLETE | 9.5/10 | GET /api/ipos Route |
| 3.3 | 5 | ✅ COMPLETE | 10/10 | IPO Card Component |
| 3.4 | 8 | ✅ COMPLETE | 9.5/10 | Dashboard Page (QA Approved) |
| 3.5 | 5 | ✅ APPROVED | 9.5/10 | Filter Logic (Ready for Dev) |
| 3.6 | 5 | ✅ APPROVED | 9.5/10 | Search Implementation (Ready for Dev) |
| 3.7 | 3 | 📝 PENDING | - | Loading & Error States |

**Points Complete:** 21/34 (62%)
**Stories Complete:** 4/7 (57%)
**Stories Approved:** 2/7 (29%) - Stories 3.5, 3.6 ready for dev
**Quality Average:** 9.5/10 (Exceptional)
**Velocity:** Ahead of target (21 pts in Week 1 vs 17 pts target)

### Achievements 🎉
- ✅ All critical path stories complete (3.1, 3.2, 3.3, 3.4)
- ✅ First user-facing feature delivered (Dashboard Page)
- ✅ Full-stack integration proven
- ✅ Story 3.5 approved with 9.5/10 quality score (matching Story 3.4 benchmark)
- ✅ Zero critical bugs across all completed stories
- ✅ 100% test coverage for all components
- ✅ Exceeded velocity target (21 pts vs 17 pts/week)

### Next Actions
1. **Implement Story 3.5 (Filter Logic)** - 5 points, approved and ready
2. **Draft Story 3.6 (Search Implementation)** - 5 points
3. **Draft Story 3.7 (Loading & Error States)** - 3 points
4. **Complete Sprint 3** - Target: 13 remaining points in Week 2

---

## Sprint Objective

Deliver the first user-facing features of IPODhan:
- API client service for data fetching
- GET /api/ipos route for IPO listings
- Reusable IPO card component
- Main dashboard page with listings
- Filter and search functionality
- Loading and error state handling

**Critical Path:** Story 3.4 (Dashboard Page) - First visible feature proving full stack works

---

## Stories in This Sprint

### Story 3.1: API Client Service
**Priority:** Critical
**Points:** 3
**Status:** ✅ COMPLETE
**Dependencies:** 1.3
**File:** `docs/stories/3.1.api-client-service.story.md`

**Description:**
Create client-side API service with proper error handling, loading states, and TypeScript types.

**Acceptance Criteria:**
- API client with fetch wrapper
- Error handling middleware
- Loading state management
- TypeScript types for all API responses
- Request/response interceptors
- Retry logic for failed requests

**Technical Requirements:**
- Base URL configuration
- Token management (future auth)
- Request cancellation support
- Cache headers handling

---

### Story 3.2: GET /api/ipos Route
**Priority:** Critical
**Points:** 5
**Status:** ✅ COMPLETE
**Dependencies:** 2.3
**File:** `docs/stories/3.2.api-ipos-route.story.md`

**Description:**
Implement Next.js API route for fetching IPO listings with filtering, pagination, and sorting.

**Acceptance Criteria:**
- GET /api/ipos endpoint implemented
- Query parameters: status, category, search, page, limit, sort
- Uses IPORepository from Story 2.3
- Proper error responses
- Response includes pagination metadata
- API documented with examples

**Sample Response:**
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "hasMore": true
  }
}
```

---

### Story 3.3: IPO Card Component
**Priority:** Critical
**Points:** 5
**Status:** ✅ COMPLETE
**Dependencies:** 1.4
**File:** `docs/stories/3.3.ipo-card-component.story.md`

**Description:**
Create reusable IPO card component for displaying IPO information in listings.

**Acceptance Criteria:**
- IPO card component with shadcn/ui
- Shows company name, sector, price range, dates
- Status badge (UPCOMING, OPEN, CLOSED, LISTED)
- Subscription indicator
- GMP indicator (if available)
- Responsive design
- Hover and click interactions
- Loading skeleton variant

**Component Props:**
- IPO data object
- onClick handler
- Loading state
- Compact/expanded variants

---

### Story 3.4: Dashboard Page ⭐
**Priority:** Critical
**Points:** 8
**Status:** ✅ COMPLETE (QA Approved 9.5/10)
**Dependencies:** 3.1, 3.2, 3.3
**File:** `docs/stories/3.4.dashboard-page.story.md`

**Description:**
Build main dashboard page showing IPO listings with grid/list view and basic navigation.

**Acceptance Criteria:**
- Dashboard page at /dashboard route
- Fetches IPOs using API client
- Displays IPO cards in grid layout
- Pagination controls
- View toggle (grid/list)
- Responsive design
- SEO metadata
- Performance optimized (lazy loading)

**Critical Path Story:** First visible feature - proves full stack integration works

**User Experience:**
- Initial load shows OPEN IPOs
- Smooth pagination
- Fast navigation
- Clear status indicators

---

### Story 3.5: Filter Logic
**Priority:** High
**Points:** 5
**Status:** ✅ APPROVED (PO Approved 9.5/10) - Ready for Implementation
**Dependencies:** 3.4 ✅
**File:** `docs/stories/3.5.filter-logic.story.md`
**Workflow Report:** `docs/stories/workflow-reports/story-3.5-creation-report.md`

**Description:**
Implement filtering functionality for IPO listings by status, category, and sector with URL state management.

**Acceptance Criteria:** (10 defined)
1. Filter bar component with status, category, and sector filters
2. Status filter: ALL, UPCOMING, OPEN, CLOSED, LISTED options
3. Category filter: ALL, MAINBOARD, SME, RIGHTS, NCD options
4. Sector filter: searchable dropdown from API
5. URL sync: ?status=OPEN&category=MAINBOARD&sector=Technology
6. Dashboard updates on filter change
7. Clear filters button (reset to defaults)
8. Filter state persists via URL params
9. Responsive UI (collapsible mobile, visible desktop)
10. Client-side navigation (no full page reload)

**Implementation Details:**
- 72 detailed tasks/subtasks defined
- 20 test scenarios (10 unit + 10 E2E)
- 1,315 lines of comprehensive documentation
- 98% self-contained (dev agent needs zero external doc reads)
- Zero critical blockers, LOW risk (1/10)

**PO Validation:**
- ✅ First-pass approval (zero correction iterations)
- ✅ Implementation readiness: 9.5/10 (HIGH confidence)
- ✅ All dependencies satisfied (Stories 3.1, 3.2, 3.4 complete)
- ✅ Epic 3 filter requirements fully addressed
- ✅ Ready for immediate implementation

---

### Story 3.6: Search Implementation
**Priority:** High
**Points:** 5
**Status:** ✅ APPROVED (PO Approved 9.5/10) - Ready for Implementation
**Dependencies:** 3.4 ✅
**File:** `docs/stories/3.6.search-implementation.story.md`
**Workflow Report:** `docs/stories/workflow-reports/story-3.6-creation-report.md`

**Description:**
Add search functionality for finding IPOs by company name or sector with debounced input and URL state management.

**Acceptance Criteria:** (10 defined)
1. Search input component integrated into dashboard header
2. Debounced search with 300ms delay to reduce API calls
3. Search by company name (case-insensitive, partial match)
4. Search by sector (case-insensitive, partial match)
5. Search highlights in results (highlight matching text in IPO cards)
6. Recent searches saved in localStorage (last 5 searches)
7. Clear search button (X icon) visible when search has text
8. No results state with helpful message when search returns empty
9. Search suggestions dropdown (future enhancement ready - optional for MVP)
10. Keyboard navigation support (Enter to search, Escape to clear)

**Implementation Details:**
- 14 major tasks with 89 subtasks defined
- 30 test scenarios (20 unit + 10 E2E)
- 1,266 lines of comprehensive documentation
- 98% self-contained (dev agent needs zero external doc reads)
- Zero critical blockers, LOW risk (2/10 minor issues)

**PO Validation:**
- ✅ First-pass approval (zero correction iterations)
- ✅ Implementation readiness: 9.5/10 (HIGH confidence)
- ✅ All dependencies satisfied (Stories 3.1, 3.2, 3.4 complete)
- ✅ Epic 3 search requirements fully addressed
- ✅ Ready for immediate implementation

**Search Features:**
- Instant search feedback
- Keyboard navigation
- Clear button
- Loading indicator

---

### Story 3.7: Loading & Error States
**Priority:** Medium
**Points:** 3
**Status:** ✅ APPROVED (PO Approved 9/10) - Ready for Implementation
**Dependencies:** 3.4 ✅
**File:** `docs/stories/3.7.loading-error-states.story.md`
**Workflow Report:** `docs/stories/workflow-reports/story-3.7-creation-report.md`

**Description:**
Implement comprehensive loading and error state handling for dashboard and components.

**Acceptance Criteria:**
- Loading skeletons for IPO cards
- Loading spinner for page transitions
- Error boundary component
- Network error handling
- Empty state component
- Retry mechanisms
- Toast notifications for errors
- Graceful degradation

**States to Handle:**
- Initial loading
- Pagination loading
- Filter/search loading
- Network errors
- Empty results
- Rate limiting errors

---

## Sprint Plan - Week Breakdown

### Week 1: API & Components Foundation
**Days 1-2:**
- Story 3.1: API Client Service (3 points)
- Story 3.2: GET /api/ipos Route (5 points)

**Days 3-5:**
- Story 3.3: IPO Card Component (5 points)
- Start Story 3.4: Dashboard Page (8 points)

**Week 1 Total:** 13 points

### Week 2: Dashboard Integration & Enhancement
**Days 6-8:**
- Complete Story 3.4: Dashboard Page (8 points)
- Story 3.7: Loading & Error States (3 points)

**Days 9-10:**
- Story 3.5: Filter Logic (5 points)
- Story 3.6: Search Implementation (5 points)

**Week 2 Total:** 21 points

**Sprint Total:** 34 points (over 2 weeks)

---

## Sprint Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Story Points | 34 | 21/34 (62%) | 🚀 In Progress |
| Stories | 7 | 4 complete, 1 approved, 2 pending | 🚀 On Track |
| Velocity | 17 pts/week | Week 1: 21 pts (ahead) | ✅ Exceeding |
| Test Coverage | >80% | 100% (Stories 3.1-3.4) | ✅ Excellent |
| Component Coverage | 100% | 100% | ✅ Met |
| Quality Score | ≥8/10 | 9.5/10 avg | ✅ Excellent |

---

## Technical Requirements

### API Routes
- Next.js App Router API routes
- Server-side data fetching
- Proper HTTP status codes
- Error response format standardized

### Components
- shadcn/ui for UI components
- Tailwind CSS for styling
- TypeScript for type safety
- Storybook for component documentation (future)

### State Management
- URL query parameters for filters
- React hooks for local state
- SWR or TanStack Query for server state (to be decided)

### Performance
- Code splitting for dashboard
- Lazy loading for images
- Debounced search
- Optimistic UI updates

---

## Dependencies

**Satisfied Dependencies:**
- ✅ Story 1.1: Next.js Project Setup
- ✅ Story 1.3: Core Dependencies
- ✅ Story 1.4: shadcn/ui Component Library
- ✅ Story 2.3: Repository Layer (CRITICAL)

**All dependencies met - Sprint can start immediately**

---

## Risk Assessment

### High Priority Risks
1. **34 points in one epic** - Mitigated by splitting into 2-week sprint
2. **First user-facing feature** - Requires careful UX validation
3. **API design decisions** - Need early consensus on patterns

### Medium Priority Risks
1. **Filter complexity** - May need iteration based on user feedback
2. **Search performance** - Database indexing critical

### Mitigation Strategies
- Split epic across 2 weeks (17 points/week target)
- Early UX review after Story 3.3 (IPO Card)
- Establish API patterns in Story 3.2 for consistency
- Performance testing after Story 3.4 (Dashboard)

---

## Definition of Done

Each story must meet:
- ✅ All acceptance criteria passed
- ✅ Unit tests written (>80% coverage)
- ✅ E2E tests for critical paths
- ✅ TypeScript compilation clean
- ✅ Linting passes
- ✅ Component responsive design tested
- ✅ Accessibility standards met
- ✅ Code reviewed
- ✅ Documentation updated

---

## Success Criteria

Sprint 3 is successful when:
1. Dashboard page is live and functional
2. Users can view, filter, and search IPOs
3. All 7 stories completed
4. Zero critical bugs
5. Performance metrics met (<3s initial load)
6. Mobile responsive design working

---

## Team Notes

**Epic 3 Importance:** First user-facing features - sets UX standards for entire app
**Critical Path:** Story 3.4 (Dashboard) proves full-stack integration
**Capacity Warning:** 34 points requires 2-week sprint (above 20-25 pt/week velocity)

**Next Epic:** Epic 4 - IPO Detail & Analysis (33 points, also requires 2 weeks)

---

**Sprint Starts:** Week 4
**Sprint Ends:** Week 5
**Next Sprint:** Sprint 4 - Epic 4 (IPO Detail & Analysis)
