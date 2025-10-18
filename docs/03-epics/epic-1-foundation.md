# Epic 1: Project Foundation & Infrastructure Setup

**Duration:** Weeks 1-2
**Goal:** Establish development environment, database, and core utilities
**Business Value:** Enable all subsequent development
**Status:** In Progress

---

## Overview

This epic covers the foundational setup required before any feature development can begin. It includes project initialization, database configuration, testing infrastructure, and CI/CD pipeline setup.

## Success Criteria

- ✅ Next.js project running locally with TypeScript and Tailwind
- ✅ PostgreSQL database configured and accessible
- ✅ All core dependencies installed and working
- ✅ shadcn/ui component library ready to use
- ✅ Testing frameworks configured (Vitest + Playwright)
- ✅ CI/CD pipeline running automated tests

## Stories

| ID | Story | Priority | Points | Status | Dependencies |
|----|-------|----------|--------|--------|--------------|
| 1.1 | Next.js Project Setup | Critical | 2 | ✅ Done | None |
| 1.2 | Database Infrastructure | Critical | 3 | Pending | 1.1 |
| 1.3 | Core Dependencies Installation | Critical | 2 | Pending | 1.1 |
| 1.4 | shadcn/ui Component Library Setup | High | 3 | Pending | 1.1 |
| 1.5 | Testing Infrastructure | Critical | 5 | Pending | 1.1 |
| 1.6 | CI/CD Pipeline | High | 3 | Pending | 1.5 |

**Total Points:** 18
**Estimated Duration:** 1.5 weeks

---

## Dependencies

**This Epic Requires:**
- None (foundation epic)

**This Epic Blocks:**
- Epic 2: Data Layer (needs database and ORM)
- Epic 3: IPO Listing (needs UI components and testing)
- All other epics (foundational)

---

## Risks & Mitigation

**Risk 1: PostgreSQL setup issues on Windows VPS**
- Mitigation: Use Docker for local dev, document VPS setup steps clearly
- Contingency: Use SQLite for initial development if PostgreSQL blocks

**Risk 2: Testing framework configuration delays**
- Mitigation: Use standard Next.js + Vitest config templates
- Contingency: Defer E2E tests to Week 3 if needed, prioritize unit tests

---

## Definition of Done

- [ ] All 6 stories completed and merged
- [ ] Developer can clone repo and run `npm install && npm run dev` successfully
- [ ] Database connection verified with test query
- [ ] At least 1 passing unit test and 1 E2E test
- [ ] CI pipeline runs on every PR
- [ ] Documentation updated in README
