# Sprint 1 Plan: Foundation & Infrastructure

**Sprint Number:** 1
**Sprint Goal:** Establish complete development infrastructure before feature work begins
**Epic:** Epic 1 - Foundation & Infrastructure
**Duration:** 2 weeks (10 working days)
**Story Points:** 18
**Status:**  COMPLETE

---

## Sprint Objective

Build the foundational infrastructure for the IPODhan application, including:
- Next.js 14 project setup with TypeScript
- PostgreSQL database infrastructure
- Core dependencies (Drizzle ORM, Redis, Zod, Pino)
- shadcn/ui component library
- Testing framework (Vitest + Playwright)
- CI/CD pipeline with GitHub Actions
- Enable all future feature development

**Critical Path:** All stories must complete before Sprint 2 can begin

---

## Stories in This Sprint

### Story 1.1: Next.js Project Setup
**Priority:** Critical
**Points:** 2
**Status:**  Done
**Dependencies:** None
**File:** `docs/stories/1.1.next-js-setup.story.md`

**Description:**
Initialize Next.js 14 project with TypeScript, ESLint, Tailwind CSS, and App Router.

**Acceptance Criteria:**
- Next.js 14+ installed with TypeScript
- App Router configured
- Tailwind CSS working
- ESLint configured
- Development server runs on port 3000

**Key Files:**
- `web/package.json`
- `web/tsconfig.json`
- `web/tailwind.config.ts`
- `web/app/layout.tsx`
- `web/app/page.tsx`

---

### Story 1.2: Database Infrastructure
**Priority:** Critical
**Points:** 3
**Status:**  Done
**Dependencies:** 1.1
**File:** `docs/stories/1.2.database-infrastructure.story.md`

**Description:**
Set up PostgreSQL 16 database with connection verification and environment configuration.

**Acceptance Criteria:**
- PostgreSQL 16 running
- Database "ipodhan" created
- Connection string in `.env.local` works
- Test API route returns database version
- No connection errors

**Key Setup:**
1. PostgreSQL 16 installed
2. Database: `ipodhan`
3. User: `ipodhan_user`
4. Environment: `DATABASE_URL` in `.env.local`
5. Test route: `/api/db-test`

**Files Created:**
- `web/.env.local`
- `web/app/api/db-test/route.ts`

---

### Story 1.3: Core Dependencies Installation
**Priority:** Critical
**Points:** 2
**Status:**  Done
**Dependencies:** 1.1
**File:** `docs/stories/1.3.core-dependencies.story.md`

**Description:**
Install and configure core application dependencies including Drizzle ORM, Zod, Pino logger, and Redis.

**Acceptance Criteria:**
- All packages in package.json
- No dependency conflicts
- Redis running and connected
- Logger outputs to console
- All imports working

**Dependencies Installed:**
- **Drizzle ORM** (0.36+) - Database ORM
- **Zod** (3.22+) - Schema validation
- **Pino** (Latest) - Structured logging
- **ioredis** (5.4+) - Redis client
- Redis server running

**Files Created:**
- `web/lib/logger.ts`
- `web/lib/redis-client.ts`

---

### Story 1.4: shadcn/ui Component Library
**Priority:** High
**Points:** 3
**Status:**  Done
**Dependencies:** 1.1
**File:** `docs/stories/1.4.shadcn-ui-setup.story.md`

**Description:**
Install and configure shadcn/ui component library with base components for UI development.

**Acceptance Criteria:**
- components.json configured
- 6 base components installed (Button, Card, Dialog, Input, Select, Badge)
- Sample page renders correctly
- Theme matches PRD design system
- Responsive on mobile/desktop

**Components Installed:**
1. Button
2. Card
3. Dialog
4. Input
5. Select
6. Badge

**Files Created:**
- `web/components.json`
- `web/app/components-test/page.tsx`
- `web/components/ui/` (shadcn components)

---

### Story 1.5: Testing Infrastructure
**Priority:** Critical (Blocking)
**Points:** 5
**Status:**  Done
**Dependencies:** 1.1
**File:** `docs/stories/1.5.testing-infrastructure.story.md`

**Description:**
Set up comprehensive testing infrastructure with Vitest for unit tests and Playwright for E2E tests.

**Acceptance Criteria:**
- Vitest installed and configured
- @testing-library/react installed
- At least 1 unit test passes
- Playwright installed and configured
- At least 1 E2E test passes
- Coverage reporting works

**Testing Stack:**
- **Vitest** (1.3+) - Unit test runner
- **React Testing Library** - Component testing
- **Playwright** (Latest) - E2E testing
- **@vitest/coverage-v8** - Coverage reporting

**Test Commands:**
- `npm run test:unit` - Run unit tests
- `npm run test:e2e` - Run E2E tests
- `npm run test:coverage` - Generate coverage report

**Files Created:**
- `web/vitest.config.ts`
- `web/vitest.setup.ts`
- `web/playwright.config.ts`
- `web/tests/unit/sample.test.tsx`
- `web/tests/e2e/homepage.spec.ts`
- `web/tests/setup/`

---

### Story 1.6: CI/CD Pipeline
**Priority:** High
**Points:** 3
**Status:**  Done
**Dependencies:** 1.5 (Testing)
**File:** `docs/stories/1.6.ci-cd-pipeline.story.md`

**Description:**
Create GitHub Actions workflow for automated testing, linting, type-checking, and building on every pull request.

**Acceptance Criteria:**
- .github/workflows/ci.yml exists
- Workflow runs on every PR
- All checks pass (lint ’ type-check ’ test ’ build)
- PR cannot merge if checks fail
- Workflow completes in <5 minutes

**CI/CD Pipeline:**
1. Lint check (ESLint)
2. Type check (TypeScript)
3. Unit tests (Vitest)
4. E2E tests (Playwright)
5. Production build (Next.js)

**Files Created:**
- `.github/workflows/ci.yml`
- `.github/workflows/README.md`

---

## Sprint Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Story Points | 18 | 18 |  Met |
| Stories Completed | 6 | 6 |  100% |
| Velocity | 18 pts/sprint | 18 pts/sprint |  On track |
| Defects Found | 0 | 0 |  Excellent |
| Setup Time | <2 weeks | 2 weeks |  On time |

---

## Sprint Retrospective

### What Went Well 
- All foundation stories completed successfully
- Clean project structure established
- Comprehensive testing infrastructure (unit + E2E)
- CI/CD pipeline operational from day one
- Zero technical debt introduced
- Team can clone and run project in <10 minutes

### Challenges Overcome =ª
- **Story 1.2:** PostgreSQL setup on different environments (local, Docker, VPS)
- **Story 1.5:** Vitest + Next.js 14 App Router configuration
- **Story 1.6:** GitHub Actions workflow optimization for speed

### What Could Improve =
- Document environment setup steps more thoroughly
- Create automated setup script for new developers
- Add more example tests for future reference

### Action Items =Ë
-  Epic 1 COMPLETE - Infrastructure foundation established
- Proceed to Epic 2 (Data Layer & Repository Pattern)
- Maintain testing standards for all future stories
- Keep CI/CD pipeline fast (<5 minutes)

---

## Technical Achievements

### Architecture
- **Next.js 14 App Router:** Modern React Server Components
- **TypeScript:** Full type safety across the application
- **Tailwind CSS:** Utility-first CSS framework
- **shadcn/ui:** Beautiful, accessible component library

### Developer Experience
- **Fast Setup:** Clone ’ npm install ’ npm run dev (<5 minutes)
- **Hot Reload:** Instant feedback during development
- **Type Safety:** TypeScript catches errors before runtime
- **Testing:** Comprehensive test coverage from day one
- **CI/CD:** Automated quality checks on every PR

### Quality Metrics
- **ESLint:** 0 errors, 0 warnings
- **TypeScript:** 0 type errors
- **Build:** Successful production builds
- **Tests:** All passing (unit + E2E)

---

## Dependencies for Next Sprint

Sprint 2 (Epic 2) depends on:
-  Story 1.1: Next.js Project Setup (CRITICAL)
-  Story 1.2: Database Infrastructure (CRITICAL)
-  Story 1.3: Core Dependencies (CRITICAL - Drizzle ORM, Redis)
-  Story 1.4: shadcn/ui Component Library (HIGH)
-  Story 1.5: Testing Infrastructure (CRITICAL)

**All dependencies satisfied - Sprint 2 ready to begin**

---

## Epic Progress

**Epic 1 Status:** 100% Complete (6/6 stories)

| Story | Points | Status |
|-------|--------|--------|
| 1.1: Next.js Project Setup | 2 |  Done |
| 1.2: Database Infrastructure | 3 |  Done |
| 1.3: Core Dependencies | 2 |  Done |
| 1.4: shadcn/ui Component Library | 3 |  Done |
| 1.5: Testing Infrastructure | 5 |  Done |
| 1.6: CI/CD Pipeline | 3 |  Done |
| **Total** | **18** | **100%** |

---

## Team Notes

**Velocity Established:** 18 story points delivered in Sprint 1
**Cumulative Velocity:** 18 points (Sprint 1)
**Project Progress:** 6/40 stories complete (15%)
**Next Epic:** Epic 2 - Data Layer & Repository Pattern (19 points, 4 stories)

**Critical Milestone:** Infrastructure foundation complete - feature development can begin

---

## Environment Setup Checklist

For new developers joining the project:

### Prerequisites
- [ ] Node.js 20+ installed
- [ ] PostgreSQL 16 installed (or Docker)
- [ ] Redis installed (or Docker)
- [ ] Git configured

### Quick Start
```bash
# Clone repository
git clone https://github.com/abhayla/IPODhan.git
cd IPODhan/web

# Install dependencies
npm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL and REDIS_URL

# Run database migrations
npm run db:migrate

# Start development server
npm run dev

# Visit http://localhost:3000
```

### Verify Setup
- [ ] `npm run dev` - Dev server runs without errors
- [ ] `npm run lint` - No ESLint errors
- [ ] `npx tsc --noEmit` - No TypeScript errors
- [ ] `npm run test:unit` - All unit tests pass
- [ ] `npm run build` - Production build succeeds

---

## Commands Reference

### Development
```bash
npm run dev              # Start development server
npm run build           # Production build
npm run start           # Start production server
npm run lint            # Run ESLint
npm run lint:fix        # Fix ESLint errors
```

### Database
```bash
npm run db:generate     # Generate migrations
npm run db:migrate      # Apply migrations
npm run db:studio       # Open Drizzle Studio
```

### Testing
```bash
npm run test:unit       # Run unit tests
npm run test:e2e        # Run E2E tests
npm run test:coverage   # Generate coverage report
```

---

**Sprint Completed:** Week 1-2 (October 2025)
**Next Sprint:** Sprint 2 - Epic 2 (Data Layer & Repository Pattern)
**Sprint Review Date:** End of Week 2
**Sprint Retrospective:** Completed with action items documented
