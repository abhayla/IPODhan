# Epic 11: IPO Detail Page Enhancements

**Epic ID:** 11
**Priority:** High
**Status:** In Progress
**Estimated Effort:** 32 Story Points
**Created:** 2025-10-27
**Last Modified:** 2025-10-27 20:00:00

---

## Epic Overview

Enhance the IPO Detail Page with comprehensive financial metrics, company information, fund utilization details, category-wise reservations, and investor recommendations to provide users with complete IPO analysis capabilities.

## Business Objective

Provide investors with a complete, data-rich IPO detail page that includes:
- Enhanced financial metrics with multi-period comparison
- Fund utilization breakdown and IPO objectives
- Company contact and compliance information
- Category-wise share reservation details
- Broker and expert recommendations summary

## Target Users

- Retail Investors researching IPO opportunities
- Institutional Investors performing due diligence
- Financial Analysts evaluating IPO quality
- New investors seeking expert guidance

## Success Metrics

- User engagement on detail page increases by 40%
- Average time on page increases to 4+ minutes
- Recommendation section drives 25%+ traffic to review pages
- Reduced bounce rate on detail page to <30%

---

## Stories in Epic 11

### Story 11.12: Enhanced Financial Metrics with EBITDA ✅
**Status:** Completed
**Priority:** High
**Estimated Effort:** 8 Story Points
**Completed:** 2025-10-26

**Description:**
Implement multi-period financial comparison table showing Revenue, Profit/Loss, EBITDA, and Total Income across FY2022-2024 with YoY growth calculations and financial ratios (Current Ratio, Quick Ratio, Inventory Turnover).

**Key Deliverables:**
- Multi-period comparison table (FY2022-2024)
- Year-over-year growth calculations
- Financial ratios section
- Database migration with 10 new columns
- EnhancedFinancialMetricsSection component

**Acceptance Criteria:** 12/12 completed (100%)

---

### Story 11.13: IPO Objectives Section ✅
**Status:** Completed
**Priority:** High
**Estimated Effort:** 5 Story Points
**Completed:** 2025-10-26

**Description:**
Display fund utilization breakdown showing how IPO proceeds will be used, with serial number, description, amount, and percentage calculations against total issue size.

**Key Deliverables:**
- Fund utilization table component
- Admin panel editor with dynamic add/remove
- IPOObjective interface update
- IPOObjectivesSection component

**Acceptance Criteria:** 8/8 completed (100%)

---

### Story 11.14: Company Contact Information ✅
**Status:** Completed
**Priority:** Medium
**Estimated Effort:** 3 Story Points
**Completed:** 2025-10-26

**Description:**
Add company contact section with complete address, phone, email, and compliance officer details with clickable links.

**Key Deliverables:**
- Database migration with 9 contact fields
- CompanyContactCard component
- CompanyContactSection component
- Clickable tel: and mailto: links

**Acceptance Criteria:** 60/60 completed (121%)

---

### Story 11.15: Category-wise Reservation Display ✅
**Status:** Completed
**Priority:** Medium
**Estimated Effort:** 2 Story Points
**Completed:** 2025-10-26

**Description:**
Display category breakdown showing share allocation for QIB, NII, Retail, Employee, and Anchor investors with percentage calculations.

**Key Deliverables:**
- Category reservation table
- Percentage calculations
- CategoryReservationSection component
- Database fields for 6 categories

**Acceptance Criteria:** 9/9 completed (100%)

---

### Story 11.16: IPO Recommendations Summary Section
**Status:** Planning
**Priority:** High
**Estimated Effort:** 8 Story Points

**Description:**
Display broker recommendations aggregation, average rating, review count, sentiment analysis, top Apply/Avoid reasons, and expert opinions summary with admin moderation capabilities.

**Key Requirements:**
- Broker recommendations aggregation (Apply/Avoid/Subscribe counts)
- Average rating display with star visualization (e.g., 4.2/5 stars)
- Review count (e.g., "Based on 47 broker reviews")
- Sentiment analysis (% positive vs negative)
- Top 3 reasons to Apply and Top 3 reasons to Avoid
- Expert analyst opinions summary
- Latest 3 sample reviews with "View All Reviews" link
- Admin moderation interface (approve/reject reviews)
- Card-style section layout for consistency
- Integration after Company Overview section
- Link to full reviews page (/mainboard-ipo-reviews or /sme-ipo-reviews)

**Technical Requirements:**
- Use existing `ipoReviews` table from database
- Add moderation fields if missing (isApproved, moderatedBy, moderatedAt)
- Create ReviewRepository with aggregation methods
- Create cache keys for review data (TTL: 15 minutes)
- Extend `/api/ipos/[slug]` endpoint to include review summary
- Create RecommendationSummarySection component
- Create admin review moderation API routes
- Create admin moderation interface
- Performance: <50ms cache hit, <200ms DB aggregation

**Acceptance Criteria:**
1. Recommendation aggregation displays Apply/Avoid/Subscribe percentages
2. Average rating shown with star visualization (★★★★☆ format)
3. Review count displayed prominently
4. Sentiment analysis shows positive/negative percentage split
5. Top 3 Apply reasons extracted and displayed
6. Top 3 Avoid reasons extracted and displayed
7. Latest 3 sample reviews shown with reviewer name and date
8. "View All Reviews" link navigates to appropriate reviews page
9. Admin can approve/reject reviews via moderation panel
10. Only approved reviews appear in public-facing summary
11. Section uses card-style layout matching other sections
12. Section appears after Company Overview on detail page
13. Cache invalidation works on review moderation
14. Unit tests: >85% coverage
15. Integration tests: API and repository tests passing
16. Performance: <50ms cache, <200ms aggregation

---

## Epic Progress

**Completed Stories:** 4/5 (80%)
**Completed Story Points:** 18/26 (69%)
**Remaining Story Points:** 8
**Estimated Completion:** 2025-10-28

---

## Epic Dependencies

### Database Tables:
- ✅ `financial_data` table (Stories 11.12)
- ✅ `ipo_details` table (Stories 11.14, 11.15)
- ✅ `ipos.objectives` JSONB field (Story 11.13)
- 🔄 `ipo_reviews` table (Story 11.16)

### Architecture Components:
- ✅ Repository pattern with caching
- ✅ BaseRepository cache-aside implementation
- ✅ Cache key conventions in `cache-keys.ts`
- ✅ API route structure `/api/ipos/[slug]`
- ✅ Component library (shadcn/ui)

### External Dependencies:
- PostgreSQL 16+ with Drizzle ORM
- Redis 7.2+ for caching
- Next.js 15.5.4 App Router
- React 19

---

## Technical Architecture

### Data Flow:
```
Database (financial_data, ipo_details, ipos, ipo_reviews)
  ↓
Repository Layer (IPORepository, ReviewRepository)
  ↓
Redis Cache (TTL: 15min for IPO, 15min for reviews)
  ↓
API Route /api/ipos/[slug]
  ↓
IPO Detail Page
  ↓
Section Components (Financial, Objectives, Contact, Reservation, Recommendations)
```

### Caching Strategy:
- IPO Detail: 15 minutes TTL
- Review Summary: 15 minutes TTL
- Invalidation on: IPO updates, review moderation

### Performance Targets:
- API Response (cached): <50ms
- API Response (DB): <200ms
- Page Load (LCP): <2.5s
- Component Render: <100ms

---

## Epic Changelog

### 2025-10-27 20:00:00
- Added Story 11.16: IPO Recommendations Summary Section
- Status: Planning
- Ready for detailed story drafting

### 2025-10-26 12:00:00
- Epic created retroactively for Stories 11.12-11.15
- All 4 stories completed and committed
- 18 story points completed
- Database migrations applied
- All components integrated into IPO detail page

---

## Related Documentation

- **Schema Management:** `docs/16-database/SCHEMA_MANAGEMENT.md`
- **Backend Architecture:** `docs/02-architecture/backend-architecture.md`
- **Caching Strategy:** `docs/05-caching/CACHING_STRATEGY.md`
- **Testing Strategy:** `docs/02-architecture/testing-strategy.md`
- **Implementation Summary:** `IMPLEMENTATION_SUMMARY.md`

---

**Epic Owner:** Product Owner (Sarah)
**Technical Lead:** Development Team
**Last Review:** 2025-10-27
