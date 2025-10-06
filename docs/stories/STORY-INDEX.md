# IPODhan Story Index

**Total Stories:** 40
**Total Story Points:** 184
**Estimated Duration:** 12 weeks

---

## Epic 1: Project Foundation & Infrastructure Setup (18 points)

| ID | Story | Priority | Points | Dependencies | Status |
|----|-------|----------|--------|--------------|--------|
| 1.1 | Next.js Project Setup | Critical | 2 | None | ✅ Done |
| 1.2 | Database Infrastructure | Critical | 3 | 1.1 | ✅ Done |
| 1.3 | Core Dependencies Installation | Critical | 2 | 1.1 | ✅ Done |
| 1.4 | shadcn/ui Component Library | High | 3 | 1.1 | ✅ Done |
| 1.5 | Testing Infrastructure | Critical | 5 | 1.1 | ✅ Done |
| 1.6 | CI/CD Pipeline | High | 3 | 1.5 | ✅ Done |

**Week:** 1-2

---

## Epic 2: Data Layer & Repository Pattern (19 points)

| ID | Story | Priority | Points | Dependencies | Status |
|----|-------|----------|--------|--------------|--------|
| 2.1 | Database Schema Creation | Critical | 5 | 1.2, 1.3 | ✅ Done |
| 2.2 | Drizzle Migration Setup | Critical | 3 | 2.1 | ✅ Done |
| 2.3 | Repository Layer ⭐ | Critical | 8 | 2.2 | ✅ Done |
| 2.4 | Seed Data Script | High | 3 | 2.3 | ✅ Done |

**Week:** 2-3
**⭐ Critical Path Story**

---

## Epic 3: IPO Listing & Discovery (34 points)

| ID | Story | Priority | Points | Dependencies | Status |
|----|-------|----------|--------|--------------|--------|
| 3.1 | API Client Service | Critical | 3 | 1.3 | 📝 Ready |
| 3.2 | GET /api/ipos Route | Critical | 5 | 2.3 | Pending |
| 3.3 | IPO Card Component | Critical | 5 | 1.4 | Pending |
| 3.4 | Dashboard Page ⭐ | Critical | 8 | 3.1, 3.2, 3.3 | Pending |
| 3.5 | Filter Logic | High | 5 | 3.4 | Pending |
| 3.6 | Search Implementation | High | 5 | 3.4 | Pending |
| 3.7 | Loading & Error States | Medium | 3 | 3.4 | Pending |

**Week:** 3-4
**⭐ Critical Path Story**

---

## Epic 4: IPO Detail & Analysis (33 points)

| ID | Story | Priority | Points | Dependencies | Status |
|----|-------|----------|--------|--------------|--------|
| 4.1 | GET /api/ipos/[slug] Route | Critical | 5 | 2.3 | Pending |
| 4.2 | Detail Page Components | Critical | 8 | 1.4 | Pending |
| 4.3 | IPO Detail Page ⭐ | Critical | 8 | 3.1, 4.1, 4.2 | Pending |
| 4.4 | Rating System | High | 5 | 4.3 | Pending |
| 4.5 | Social Share | Medium | 2 | 4.3 | Pending |
| 4.6 | Allotment Checker (FR-4) | High | 5 | 4.3 | Pending |

**Week:** 5-6
**⭐ Critical Path Story**

---

## Epic 5: IPO Tools & Calculators (19 points)

| ID | Story | Priority | Points | Dependencies | Status |
|----|-------|----------|--------|--------------|--------|
| 5.1 | Lot Calculator (FR-10) | High | 3 | 4.3 | Pending |
| 5.2 | IPO Comparison (FR-11) | High | 5 | 4.3 | Pending |
| 5.3 | Registrar Directory (FR-9) | High | 3 | 2.3 | Pending |
| 5.4 | Market Holidays (FR-8) | Medium | 3 | 2.3 | Pending |
| 5.5 | Broker Affiliates (FR-6) | High | 5 | 4.3 | Pending |

**Week:** 7

---

## Epic 6: Historical IPO Database (13 points)

| ID | Story | Priority | Points | Dependencies | Status |
|----|-------|----------|--------|--------------|--------|
| 6.1 | Historical IPOs API (FR-3) | High | 3 | 2.3 | Pending |
| 6.2 | History Page with Filters | High | 5 | 6.1, 3.3 | Pending |
| 6.3 | Listing Performance | Medium | 5 | 6.1 | Pending |

**Week:** 7 (parallel with Epic 5)

---

## Epic 7: Data Pipeline & Automation (27 points)

| ID | Story | Priority | Points | Dependencies | Status |
|----|-------|----------|--------|--------------|--------|
| 7.1 | NSE Scraper | Critical | 8 | 2.3 | Pending |
| 7.2 | BSE Scraper | Critical | 8 | 2.3 | Pending |
| 7.3 | IPO Alerts API Fallback | High | 3 | 7.1, 7.2 | Pending |
| 7.4 | Scheduler & Cache Invalidation | Critical | 5 | 7.1, 7.2 | Pending |
| 7.5 | Error Handling & Monitoring | High | 3 | 7.4 | Pending |

**Week:** 9-10

---

## Epic 8: Production Readiness & Launch (26 points)

| ID | Story | Priority | Points | Dependencies | Status |
|----|-------|----------|--------|--------------|--------|
| 8.1 | Comprehensive Testing | Critical | 8 | All epics | Pending |
| 8.2 | SEO Optimization | Critical | 5 | All epics | Pending |
| 8.3 | Performance Optimization | Critical | 5 | All epics | Pending |
| 8.4 | Production Deployment | Critical | 5 | 8.1, 8.2, 8.3 | Pending |
| 8.5 | Monitoring & Alerts | High | 3 | 8.4 | Pending |

**Week:** 11-12

---

## Critical Path Stories (Must Complete on Time)

These stories block multiple downstream stories and define the project timeline:

1. **Story 2.3: Repository Layer** (Week 2)
   - Blocks: 3.2, 4.1, 7.1, 7.2, 6.1, 5.3, 5.4
   - Impact: Without this, NO API routes can be built

2. **Story 3.4: Dashboard Page** (Week 3-4)
   - Blocks: User-facing features, navigation to detail
   - Impact: First visible feature, proves full stack works

3. **Story 4.3: IPO Detail Page** (Week 5-6)
   - Blocks: 5.1, 5.2, 5.5 (tools that embed in detail)
   - Impact: Core user destination, highest value page

4. **Story 7.4: Scheduler & Cache Invalidation** (Week 9-10)
   - Blocks: Real-time data updates
   - Impact: Transition from static to live data

---

## Stories Added from Missing PRD Features

These stories were NOT in the original roadmap but ARE in the PRD:

- ✅ **Story 4.6:** Allotment Status Checker (FR-4)
- ✅ **Story 5.1:** Lot Size Calculator (FR-10)
- ✅ **Story 5.2:** IPO Comparison Tool (FR-11)
- ✅ **Story 5.3:** Registrar Directory (FR-9)
- ✅ **Story 5.4:** Market Holidays Calendar (FR-8)

**Impact:** +19 story points, +3-4 days to schedule

---

## Story Status Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Done | 10 | 25% |
| 🟡 In Progress | 0 | 0% |
| ⏳ Pending | 30 | 75% |
| **Total** | **40** | **100%** |

---

## Velocity Planning

**Assumed Team Velocity:** 20-25 points per week (1 full-time developer)

**Week Breakdown:**
- Week 1-2: 18 points (Epic 1) ✅ Achievable
- Week 2-3: 19 points (Epic 2) ✅ Achievable
- Week 3-4: 34 points (Epic 3) ⚠️ **Over capacity** - split to 2 weeks
- Week 5-6: 33 points (Epic 4) ⚠️ **Over capacity** - split to 2 weeks
- Week 7: 32 points (Epics 5+6 parallel) ⚠️ **Over capacity** - need 1.5 weeks
- Week 9-10: 27 points (Epic 7) ⚠️ **Tight** - may need buffer
- Week 11-12: 26 points (Epic 8) ⚠️ **Tight** - testing often overruns

**Recommendation:** Plan for 14-15 weeks instead of 12 weeks for realistic delivery

---

## Next Steps

1. **Review this story index** with team
2. **Prioritize** any story swaps or deferrals
3. **Create individual story YAML files** for each story (use template)
4. **Update roadmap** with corrected week assignments
5. **Begin Sprint 1** (Week 1-2: Epic 1)
