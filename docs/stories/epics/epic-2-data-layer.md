# Epic 2: Data Layer & Repository Pattern

**Duration:** Week 2-3
**Goal:** Implement database schema, migrations, and data access layer
**Business Value:** Provide type-safe data access for all features
**Status:** Pending

---

## Overview

This epic establishes the data persistence layer using Drizzle ORM and implements the Repository Pattern for clean data access abstraction. It includes schema creation, migration setup, and repository implementations with caching.

## Success Criteria

- ✅ Complete database schema matching Architecture spec
- ✅ Migration system functional (create, run, rollback)
- ✅ All repositories implemented with cache-aside pattern
- ✅ Seed data available for development
- ✅ >85% test coverage on repository layer

## Stories

| ID | Story | Priority | Points | Status | Dependencies |
|----|-------|----------|--------|--------|--------------|
| 2.1 | Database Schema Creation | Critical | 5 | Pending | 1.2, 1.3 |
| 2.2 | Drizzle Migration Setup | Critical | 3 | Pending | 2.1 |
| 2.3 | Repository Layer Implementation | Critical | 8 | Pending | 2.2 |
| 2.4 | Seed Data Script | High | 3 | Pending | 2.3 |

**Total Points:** 19
**Estimated Duration:** 1 week

---

## Critical Path

**Story 2.3 (Repository Layer) is on the CRITICAL PATH:**
- Blocks ALL API route development
- Blocks scraper implementation
- Without this, no data access is possible

⚠️ **Priority:** Ensure this completes by end of Week 2

---

## Technical Details

### Schema Coverage
- ✅ ipos table (core entity)
- ✅ subscriptions table (historical snapshots)
- ✅ gmp_records table (grey market premium tracking)
- ✅ financial_data table (company financials)
- ✅ documents table (DRHP, RHP, prospectus)
- ✅ listing_performance table (post-listing metrics)
- ✅ market_holidays table (NSE/BSE holidays)
- ✅ registrars table (registrar directory)
- ✅ peer_companies table (peer comparison)
- ✅ broker_affiliates table (affiliate links)

### Repository Interfaces
```typescript
IPORepository:
  - findAll(filters) -> IPO[]
  - findBySlug(slug) -> IPO | null
  - search(query) -> IPO[]
  - create(data) -> IPO
  - update(id, data) -> IPO

SubscriptionRepository:
  - findByIPO(ipoId) -> Subscription[]
  - findLatest(ipoId) -> Subscription | null
  - createSnapshot(ipoId, data) -> Subscription

GMPRepository:
  - findByIPO(ipoId, days?) -> GMPRecord[]
  - findLatest(ipoId) -> GMPRecord | null
  - create(ipoId, data) -> GMPRecord
```

---

## Dependencies

**This Epic Requires:**
- Epic 1: Story 1.2 (Database setup)
- Epic 1: Story 1.3 (Drizzle ORM installed)

**This Epic Blocks:**
- Epic 3: Story 3.2 (API routes need repositories)
- Epic 4: Story 4.1 (Detail API needs IPORepository)
- Epic 7: All scraper stories (need repositories to save data)

---

## Risks & Mitigation

**Risk 1: Schema changes during development**
- Mitigation: Use migrations from day 1, never manual SQL
- Contingency: Migration rollback procedure documented

**Risk 2: Cache invalidation bugs**
- Mitigation: Explicit invalidation methods, comprehensive tests
- Contingency: Disable Redis caching if causing data inconsistency

---

## Definition of Done

- [ ] All tables created via migration (no manual SQL)
- [ ] All repositories have unit tests >85% coverage
- [ ] Integration tests with real DB + Redis passing
- [ ] Seed script populates 20+ sample IPOs
- [ ] Performance benchmarks met (<100ms queries)
- [ ] Code reviewed and merged to main
