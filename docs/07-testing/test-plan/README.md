# IPODhan Testing Plan - Master Index

**Version:** 1.0
**Last Updated:** 2025-01-20
**Status:** Active

## 📋 Quick Start

This testing plan guides manual exploratory testing and data validation for the IPODhan platform before production deployment.

**Testing Approach:**
- **5 Sequential Phases**: Each phase builds on previous phase success
- **Loop Pattern**: Test ALL → Document → Fix ALL → Re-test → Verify → Gate Check
- **Production Database**: Testing on live VPS database (103.118.16.189:5432/ipodhan)
- **Approval-Gated**: All data modifications require explicit approval

## 🎯 Testing Phases Overview

### Phase 1: Data Quality & Scraping Validation
**Document:** [01-PHASE-1-DATA-QUALITY.md](01-PHASE-1-DATA-QUALITY.md)
**Estimated Time:** 3-5 days
**Focus:** Database integrity, scraper health, field coverage

**Key Tests:**
- ✅ 13 Enhancements including IPO Scoring, Peer Comparison, Repository Pattern
- Data existence and completeness validation
- Scraper success rate and data freshness
- Foreign key integrity and duplicate checks

**Success Criteria:** ≥150 IPOs, 100% critical field coverage, 0 consecutive scraper failures

---

### Phase 2: Core Pages Testing
**Document:** [02-PHASE-2-CORE-PAGES.md](02-PHASE-2-CORE-PAGES.md)
**Estimated Time:** 2-3 days
**Focus:** Homepage, dashboard, IPO details, historical pages

**Key Tests:**
- Dashboard filter combinations (status, category, sector)
- IPO detail sections (overview, subscription, GMP, financials)
- Search functionality and results accuracy
- Mobile responsiveness (375x667 viewport)

**Success Criteria:** All pages load <3s, zero console errors, all data displays correctly

---

### Phase 3: Tools & Features Testing
**Document:** [03-PHASE-3-TOOLS-FEATURES.md](03-PHASE-3-TOOLS-FEATURES.md)
**Estimated Time:** 1-2 days
**Focus:** Calculators, compare tool, registrars, holidays

**Key Tests:**
- Lot Calculator accuracy (investment → lots calculation)
- IPO Compare tool (2-5 IPO side-by-side comparison)
- Allotment Checker form validation
- Registrars contact information completeness

**Success Criteria:** All calculations accurate, all tools responsive, all forms validate correctly

---

### Phase 4: Category Pages Testing
**Document:** [04-PHASE-4-CATEGORY-PAGES.md](04-PHASE-4-CATEGORY-PAGES.md)
**Estimated Time:** 1-2 days
**Focus:** Mainboard/SME segregation, special categories

**Key Tests:**
- 6 Mainboard pages (landing, calendar, performance, prospectus, listings, reviews)
- 6 SME pages (same structure as mainboard)
- Special categories (OFS, NCD, Rights, FPO)

**Success Criteria:** Category filtering 100% accurate, no cross-contamination, all 14 pages functional

---

### Phase 5: Integration & Performance Testing
**Document:** [05-PHASE-5-INTEGRATION.md](05-PHASE-5-INTEGRATION.md)
**Estimated Time:** 3-4 days
**Focus:** API endpoints, caching, performance, fault tolerance

**Key Tests:**
- 23 API endpoint validation (including 12 missing endpoints)
- Performance targets (p95 < 500ms, p99 < 1000ms)
- Redis caching & fault tolerance (3 failure scenarios)
- User journey testing (4 critical flows)
- Database performance optimization

**Success Criteria:** All APIs meet performance targets, cache hit rate >80%, graceful degradation verified

---

## 📚 Critical Documents

### Setup & Safety
- **[00-TESTING-OVERVIEW.md](00-TESTING-OVERVIEW.md)** - Production safety protocol, git workflow, setup
  - 🔴 **READ FIRST**: Production database approval process
  - Git workflow (no test branches - simplified)
  - Auto-improvement trigger concept

### Reference Appendices
- **[APPENDIX-A-ENHANCEMENTS.md](APPENDIX-A-ENHANCEMENTS.md)** - All 28 enhancements detailed specifications
- **[APPENDIX-B-SQL-QUERIES.md](APPENDIX-B-SQL-QUERIES.md)** - All validation SQL queries
- **[APPENDIX-C-ARCHITECTURE-REFS.md](APPENDIX-C-ARCHITECTURE-REFS.md)** - Architecture document cross-references

---

## 📊 Progress Tracking

**Live Progress:** `TEST_PROGRESS.md` (root directory)
**Issue Tracking:** `TEST_ISSUES.json` (root directory)
**Coverage Report:** `SCRAPING_COVERAGE_REPORT.md` (Phase 1 output)

### Current Status Template

```markdown
## Testing Status

| Phase | Status | Completion | Issues | Last Updated |
|-------|--------|------------|--------|--------------|
| Phase 1: Data Quality | 🟡 In Progress | 60% | 5 open | 2025-01-20 |
| Phase 2: Core Pages | ⚪ Not Started | 0% | - | - |
| Phase 3: Tools | ⚪ Not Started | 0% | - | - |
| Phase 4: Categories | ⚪ Not Started | 0% | - | - |
| Phase 5: Integration | ⚪ Not Started | 0% | - | - |

**Legend:** 🟢 Complete | 🟡 In Progress | 🔴 Blocked | ⚪ Not Started
```

---

## 🔗 Quick Navigation

### By Enhancement Number
| # | Enhancement | Location |
|---|-------------|----------|
| #1-6 | Open/Upcoming/Closed IPOs, Search, Categories | [Phase 1](01-PHASE-1-DATA-QUALITY.md#iteration-1) |
| #7 | Dashboard Filter Combinations | [Phase 2](02-PHASE-2-CORE-PAGES.md#enhancement-7) |
| #8-12 | IPO Detail Sections | [Phase 2](02-PHASE-2-CORE-PAGES.md#iteration-1) |
| #13 | Repository Pattern Validation | [Phase 1](01-PHASE-1-DATA-QUALITY.md#enhancement-13) |
| #14 | Lot Calculator | [Phase 3](03-PHASE-3-TOOLS-FEATURES.md#enhancement-14) |
| #15 | IPO Compare Tool | [Phase 3](03-PHASE-3-TOOLS-FEATURES.md#enhancement-15) |
| #16 | Allotment Checker | [Phase 3](03-PHASE-3-TOOLS-FEATURES.md#enhancement-16) |
| #17 | Mainboard/SME Segregation | [Phase 4](04-PHASE-4-CATEGORY-PAGES.md#enhancement-17) |
| #19 | ISR Testing | [Phase 5](05-PHASE-5-INTEGRATION.md#enhancement-19) |
| #20 | API Endpoint Testing | [Phase 5](05-PHASE-5-INTEGRATION.md#enhancement-20) |
| #21 | Rating Calculation | [Phase 5](05-PHASE-5-INTEGRATION.md#enhancement-21) |
| #22 | Database Performance | [Phase 5](05-PHASE-5-INTEGRATION.md#enhancement-22) |
| #24 | Redis Caching & Fault Tolerance | [Phase 5](05-PHASE-5-INTEGRATION.md#enhancement-24) |
| #25 | Logging & Monitoring | [Phase 5](05-PHASE-5-INTEGRATION.md#enhancement-25) |
| #27 | Data Consistency | [Phase 5](05-PHASE-5-INTEGRATION.md#enhancement-27) |
| #28 | Security Tests | [Phase 5](05-PHASE-5-INTEGRATION.md#enhancement-28) |

### By Test Type
- **Data Validation**: Phase 1, Enhancement #13
- **UI Testing**: Phases 2, 3, 4
- **API Testing**: Phase 5, Enhancement #20
- **Performance Testing**: Phase 5, Enhancements #22, #24
- **Security Testing**: Phase 5, Enhancement #28

---

## 🛠️ Common Commands

### Database Testing
```bash
# Connect to production database (READ-ONLY recommended)
psql -h 103.118.16.189 -U postgres -d ipodhan

# Run field coverage analysis
psql -h 103.118.16.189 -U postgres -d ipodhan -f scripts/field-coverage.sql

# Check scraper health
psql -h 103.118.16.189 -U postgres -d ipodhan -c "SELECT * FROM scraper_logs ORDER BY start_time DESC LIMIT 5;"
```

### Application Testing
```bash
# Start dev server
cd web
npm run dev

# Run automated tests
npm run test              # All tests
npm run test:integration  # Integration tests (requires PostgreSQL + Redis)
npm run test:e2e          # E2E tests (Playwright)

# Database operations
npm run db:studio         # Open Drizzle Studio
npm run verify:seed       # Verify seed data integrity
```

### Cache Testing
```bash
# Monitor Redis
redis-cli MONITOR

# Check cache keys
redis-cli KEYS "ipo:*"

# Test Redis connection
redis-cli PING

# Check cache hit rate
redis-cli INFO stats | grep keyspace
```

---

## ⚠️ Important Warnings

### Production Database Safety

🔴 **CRITICAL**: You are testing against **LIVE PRODUCTION DATA**

**Before ANY data modification:**
1. STOP and request approval
2. Show exact operation (SQL or code)
3. Explain impact (tables, row count)
4. Wait for "APPROVED" response
5. Execute only after approval

**Read-Only Operations:** Data queries and validations are SAFE
**Write Operations:** INSERT/UPDATE/DELETE require approval

See full protocol: [00-TESTING-OVERVIEW.md#safety-protocol](00-TESTING-OVERVIEW.md#safety-protocol)

---

## 📖 How to Use This Documentation

### First Time Testing
1. **Read**: [00-TESTING-OVERVIEW.md](00-TESTING-OVERVIEW.md) - Understand safety & workflow
2. **Start**: [01-PHASE-1-DATA-QUALITY.md](01-PHASE-1-DATA-QUALITY.md) - Begin with data validation
3. **Track**: Update `TEST_PROGRESS.md` as you complete tests
4. **Document**: Log issues in `TEST_ISSUES.json`
5. **Proceed**: Only move to next phase after gate check passes

### Continuing Testing
1. Check current phase status in `TEST_PROGRESS.md`
2. Open relevant phase document
3. Resume from last completed test
4. Update progress after each test

### Finding Specific Tests
1. Use enhancement number (e.g., "Enhancement #13")
2. Use Ctrl+F in phase documents
3. Check enhancement index in [APPENDIX-A](APPENDIX-A-ENHANCEMENTS.md)

---

## 🤝 Contributing to Testing

### Reporting Issues
Format for `TEST_ISSUES.json`:
```json
{
  "id": "ISSUE-001",
  "phase": "Phase 1",
  "enhancement": "#13",
  "severity": "HIGH",
  "description": "Cache invalidation not working for IPO updates",
  "steps_to_reproduce": ["1. Update IPO status", "2. Check cache keys"],
  "expected": "Cache keys deleted",
  "actual": "Cache keys still exist",
  "status": "OPEN",
  "reported_by": "QA Team",
  "reported_date": "2025-01-20"
}
```

### Updating Progress
Update `TEST_PROGRESS.md` after completing:
- Each iteration within a phase
- Each enhancement validation
- Each gate check

---

## 📞 Support & Feedback

**Questions?** Check:
1. [00-TESTING-OVERVIEW.md](00-TESTING-OVERVIEW.md) - Setup & workflow
2. [APPENDIX-C-ARCHITECTURE-REFS.md](APPENDIX-C-ARCHITECTURE-REFS.md) - Architecture docs
3. Enhancement-specific sections in appendices

**Found Issues?** Report in `TEST_ISSUES.json`

**Suggestions?** Open GitHub issue at `https://github.com/yourusername/ipodhan/issues`

---

## 📜 Document Versions

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2025-01-20 | Initial split from monolithic TESTING_PLAN.md | System |

---

**Next Steps:** → [Read 00-TESTING-OVERVIEW.md](00-TESTING-OVERVIEW.md) → [Start Phase 1](01-PHASE-1-DATA-QUALITY.md)
