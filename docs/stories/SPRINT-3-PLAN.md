# Sprint 3 Plan: IPO Listing & Discovery

**Sprint Number:** 3
**Sprint Goal:** Build core IPO listing and discovery features with API routes, components, and dashboard
**Epic:** Epic 3 - IPO Listing & Discovery
**Duration:** 2 weeks (split from original 1-week estimate due to 34-point load)
**Story Points:** 34
**Status:** 📝 READY TO START

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
**Status:** 📝 Ready
**Dependencies:** 1.3
**File:** To be created

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
**Status:** 📝 Ready
**Dependencies:** 2.3
**File:** To be created

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
**Status:** 📝 Ready
**Dependencies:** 1.4
**File:** To be created

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
**Status:** 📝 Ready
**Dependencies:** 3.1, 3.2, 3.3
**File:** To be created

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
**Status:** 📝 Ready
**Dependencies:** 3.4
**File:** To be created

**Description:**
Implement filtering functionality for IPO listings by status, category, and date range.

**Acceptance Criteria:**
- Filter UI component
- Status filter (UPCOMING, OPEN, CLOSED, LISTED, ALL)
- Category filter (MAINBOARD, SME, RIGHTS, NCD, ALL)
- Date range filter
- Filter state management
- URL query parameter sync
- Clear filters button
- Filter count badges

**Filters:**
- Status: Multi-select or tabs
- Category: Dropdown or chips
- Date range: Date picker
- Clear all filters action

---

### Story 3.6: Search Implementation
**Priority:** High
**Points:** 5
**Status:** 📝 Ready
**Dependencies:** 3.4
**File:** To be created

**Description:**
Add search functionality for finding IPOs by company name or sector.

**Acceptance Criteria:**
- Search input component
- Debounced search (300ms)
- Search by company name and sector
- Search highlights in results
- Recent searches saved (localStorage)
- Clear search button
- No results state
- Search suggestions (future enhancement ready)

**Search Features:**
- Instant search feedback
- Keyboard navigation
- Clear button
- Loading indicator

---

### Story 3.7: Loading & Error States
**Priority:** Medium
**Points:** 3
**Status:** 📝 Ready
**Dependencies:** 3.4
**File:** To be created

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

| Metric | Target | Status |
|--------|--------|--------|
| Story Points | 34 | 📝 Planned |
| Stories | 7 | 📝 Planned |
| Velocity | 17 pts/week | 📝 Target |
| Test Coverage | >80% | 📝 Target |
| Component Coverage | 100% | 📝 Target |

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
