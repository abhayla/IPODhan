# Sprint 1: Foundation & Infrastructure

**Duration:** Weeks 1-2 (10 working days)
**Epic:** Epic 1 - Foundation
**Goal:** Establish complete development infrastructure before feature work
**Story Points:** 18

---

## Sprint Overview

This sprint sets up the foundational infrastructure required for all future development. Every story in this sprint is a prerequisite for subsequent feature work.

### Success Criteria
- ✅ All developers can clone and run the project locally
- ✅ Database operational with schema and seed data
- ✅ All core dependencies installed and working
- ✅ UI component library ready to use
- ✅ Testing framework functional (unit + E2E)
- ✅ CI/CD pipeline running automated checks

---

## Day-by-Day Plan

### Week 1

#### Day 1 (Monday)
**Story 1.1:** Next.js Project Setup ✅ **ALREADY DONE**
- Status: Complete
- Next.js 14 running at localhost:3000
- TypeScript configured
- Tailwind CSS working

**Story 1.2:** Database Infrastructure (3 hours)
- **Priority:** Critical
- **Assigned to:** Devin (dev agent)
- **Tasks:**
  1. Verify PostgreSQL 16 installed on VPS/local (30 min)
  2. Create database "ipodhan" (15 min)
  3. Create user "ipodhan_user" with password (15 min)
  4. Grant all privileges (15 min)
  5. Create `.env.local` with DATABASE_URL (30 min)
  6. Test connection from Next.js (API route that queries DB version) (45 min)
  7. Document setup in README (30 min)

**Acceptance Criteria:**
- [ ] PostgreSQL 16 running
- [ ] Database "ipodhan" created
- [ ] Connection string in `.env.local` works
- [ ] Test API route returns database version
- [ ] No connection errors

**Files to Create:**
- `web/.env.local` (if not exists)
- `web/app/api/db-test/route.ts` (connection test)

---

#### Day 2 (Tuesday)
**Story 1.3:** Core Dependencies Installation (2 hours)
- **Priority:** Critical
- **Assigned to:** Devin
- **Tasks:**
  1. Install Drizzle ORM: `npm install drizzle-orm drizzle-kit @types/pg pg` (15 min)
  2. Install Zod: `npm install zod` (5 min)
  3. Install Pino logger: `npm install pino pino-pretty` (5 min)
  4. Install ioredis: `npm install ioredis @types/ioredis` (10 min)
  5. Install Redis on VPS/local (30 min)
  6. Verify all packages in package.json (15 min)
  7. Run `npm install` - ensure no conflicts (15 min)
  8. Create basic logger config (20 min)
  9. Test Redis connection (20 min)

**Acceptance Criteria:**
- [ ] All packages installed (check package.json)
- [ ] No dependency conflicts (npm install succeeds)
- [ ] Redis running and accessible
- [ ] Logger outputs to console (test)

**Files to Create:**
- `web/lib/logger.ts` (Pino config)
- `web/lib/redis-client.ts` (Redis connection)

---

#### Day 3 (Wednesday)
**Story 1.4:** shadcn/ui Component Library (3 hours)
- **Priority:** High
- **Assigned to:** Devin
- **Tasks:**
  1. Install shadcn/ui CLI: `npx shadcn-ui@latest init` (20 min)
  2. Configure components.json (theme from PRD) (30 min)
  3. Install base components:
     - `npx shadcn-ui@latest add button` (5 min)
     - `npx shadcn-ui@latest add card` (5 min)
     - `npx shadcn-ui@latest add dialog` (5 min)
     - `npx shadcn-ui@latest add input` (5 min)
     - `npx shadcn-ui@latest add select` (5 min)
     - `npx shadcn-ui@latest add badge` (5 min)
  4. Create sample page using components (30 min)
  5. Verify responsive on mobile (20 min)
  6. Document component usage (30 min)

**Acceptance Criteria:**
- [ ] components.json configured
- [ ] 6 base components installed
- [ ] Sample page renders components correctly
- [ ] Theme matches PRD color palette
- [ ] Responsive on mobile/desktop

**Files to Create:**
- `web/components.json` (shadcn config)
- `web/app/components-test/page.tsx` (sample page)
- `web/components/ui/` (shadcn components)

---

#### Day 4-5 (Thursday-Friday)
**Story 1.5:** Testing Infrastructure (6 hours)
- **Priority:** Critical (Blocking)
- **Assigned to:** Devin
- **Tasks:**

**Day 4 (Thursday) - 3 hours:**
  1. Install Vitest: `npm install -D vitest @vitest/ui` (10 min)
  2. Install React Testing Library: `npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event` (10 min)
  3. Configure Vitest: Create `vitest.config.ts` (30 min)
  4. Create test setup file (20 min)
  5. Add test scripts to package.json:
     - `"test:unit": "vitest"`
     - `"test:coverage": "vitest --coverage"`
  6. Write first unit test (sample component test) (30 min)
  7. Verify unit test passes (20 min)

**Day 5 (Friday) - 3 hours:**
  8. Install Playwright: `npm install -D @playwright/test` (15 min)
  9. Initialize Playwright: `npx playwright install` (20 min)
  10. Configure Playwright: Create `playwright.config.ts` (30 min)
  11. Add E2E test script: `"test:e2e": "playwright test"` (10 min)
  12. Write first E2E test (homepage loads) (30 min)
  13. Verify E2E test passes (20 min)
  14. Configure coverage reporting (Istanbul) (30 min)
  15. Document testing guide in README (30 min)

**Acceptance Criteria:**
- [ ] Vitest installed and configured
- [ ] @testing-library/react installed
- [ ] At least 1 unit test passes
- [ ] Playwright installed and configured
- [ ] At least 1 E2E test passes
- [ ] Coverage reporting works
- [ ] Test scripts in package.json work

**Files to Create:**
- `web/vitest.config.ts`
- `web/vitest.setup.ts`
- `web/playwright.config.ts`
- `web/tests/unit/sample.test.tsx` (first unit test)
- `web/tests/e2e/homepage.spec.ts` (first E2E test)
- `web/tests/setup/` (test utilities)

---

### Week 2

#### Day 1 (Monday)
**Story 1.6:** CI/CD Pipeline (4 hours)
- **Priority:** High
- **Assigned to:** Devin
- **Tasks:**
  1. Create `.github/workflows/` directory (5 min)
  2. Create `ci.yml` workflow file (45 min)
  3. Configure workflow steps:
     - Checkout code
     - Setup Node.js 20
     - Install dependencies (cache)
     - Run lint: `npm run lint`
     - Run type-check: `tsc --noEmit`
     - Run unit tests: `npm run test:unit`
     - Run E2E tests: `npm run test:e2e`
     - Build: `npm run build`
  4. Configure PR checks (must pass to merge) (30 min)
  5. Test workflow with sample PR (30 min)
  6. Add status badge to README (15 min)
  7. Configure build caching for faster runs (30 min)
  8. Document CI/CD process (30 min)

**Acceptance Criteria:**
- [ ] .github/workflows/ci.yml exists
- [ ] Workflow runs on every PR
- [ ] All checks pass (lint, type-check, test, build)
- [ ] PR cannot merge if checks fail
- [ ] Workflow completes in <5 minutes
- [ ] Build artifacts cached

**Files to Create:**
- `.github/workflows/ci.yml`
- `.github/workflows/README.md` (workflow docs)

---

#### Day 2-5 (Tuesday-Friday)
**BUFFER & EPIC 2 START**

If Sprint 1 completes early (Day 2-3), begin Epic 2:
- Story 2.1: Database Schema Creation
- Story 2.2: Drizzle Migration Setup

If Sprint 1 runs late, use as buffer to complete Stories 1.5 or 1.6.

---

## Story Checklist

### Before Starting Each Story
- [ ] Read story file (if exists) or epic overview
- [ ] Check DEPENDENCY-MATRIX.md for blockers
- [ ] Verify all "REQUIRES" stories are completed
- [ ] Understand acceptance criteria
- [ ] Estimate time (confirm with story estimate)

### During Implementation
- [ ] Update story status to `in_progress`
- [ ] Create all files listed in story
- [ ] Write tests as you code (not after)
- [ ] Commit frequently with clear messages
- [ ] Push to branch (not main directly)

### Before Marking Complete
- [ ] ALL acceptance criteria verified (manual or automated)
- [ ] All tests passing locally
- [ ] Push code and verify CI passes
- [ ] Request code review (if team available)
- [ ] Update story status to `completed`
- [ ] Fill `actual_hours` in story file
- [ ] Notify team story is done (unblocks downstream)

---

## Daily Standup Format

**Time:** 9:00 AM (or start of day)
**Duration:** 15 minutes

**Each team member reports:**
1. **Yesterday:**
   - Completed: Story X.Y (status: completed)
   - Progressed: Story A.B (50% done, on track)

2. **Today:**
   - Will complete: Story A.B (remaining 50%)
   - Will start: Story C.D (if A.B completes)

3. **Blockers:**
   - Story C.D blocked by Story E.F (not done)
   - Need help with [specific issue]

**PO Focus:**
- Are we on track for 18 points this sprint?
- Any critical path concerns?
- Do we need to adjust scope?

---

## Sprint Risks & Mitigations

### Risk 1: Database Setup Issues (Story 1.2)
**Probability:** Medium
**Impact:** Blocks Story 2.1 (Schema)
**Mitigation:**
- Use Docker PostgreSQL if VPS setup fails
- Document VPS-specific issues for later
- Have SQL setup script ready

### Risk 2: Testing Framework Config Delays (Story 1.5)
**Probability:** Medium
**Impact:** Blocks CI/CD (Story 1.6)
**Mitigation:**
- Use standard Next.js + Vitest templates
- Defer E2E tests to Week 2 if needed (unit tests priority)
- Ask for help if config issues > 1 hour

### Risk 3: CI/CD Workflow Errors (Story 1.6)
**Probability:** Low
**Impact:** No automated testing
**Mitigation:**
- Test workflow locally with `act` tool
- Start with minimal workflow, add steps incrementally
- Manual testing acceptable for Sprint 1 if workflow blocks

---

## Definition of Done (Sprint 1)

Sprint is complete when:
- ✅ All 6 stories marked `completed`
- ✅ All acceptance criteria verified
- ✅ All tests passing (unit + E2E)
- ✅ CI/CD pipeline operational
- ✅ No critical bugs
- ✅ README updated with setup instructions
- ✅ PO demo completed (show working infrastructure)

**Sprint Demo:** Show that any developer can:
1. Clone repo
2. Run `npm install`
3. Setup database (follow README)
4. Run `npm run dev` - app works
5. Run `npm run test:unit` - tests pass
6. Run `npm run build` - builds successfully

---

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| **Velocity** | 18 points | All stories completed |
| **Quality** | 0 bugs | No issues in infrastructure |
| **Time** | 10 days | Complete by end of Week 2 Day 1 |
| **Tests** | 100% pass rate | All unit + E2E tests green |
| **CI/CD** | <5 min | Workflow execution time |

---

## Next Sprint Preview (Sprint 2: Epic 2)

**Week 2-3: Data Layer & Repository Pattern**
- Story 2.1: Database Schema (5 hours)
- Story 2.2: Drizzle Migrations (3 hours)
- Story 2.3: Repository Layer (8 hours) ⭐ Critical Path
- Story 2.4: Seed Data (3 hours)

**Total:** 19 points

---

## Resources

- **Epic Overview:** `docs/stories/epics/epic-1-foundation.md`
- **Story Index:** `docs/stories/STORY-INDEX.md`
- **Dependencies:** `docs/stories/DEPENDENCY-MATRIX.md`
- **Roadmap:** `docs/REVISED-IMPLEMENTATION-ROADMAP.md`
- **Developer Guide:** `docs/stories/README.md`

---

## Sprint Kickoff Checklist

- [ ] All team members read Epic 1 overview
- [ ] Stories assigned to developers
- [ ] Development environment ready (Node 20, PostgreSQL, Redis)
- [ ] Git workflow agreed (feature branches, PR process)
- [ ] Daily standup time confirmed
- [ ] Sprint goal understood by all
- [ ] Questions answered

---

**Let's build the foundation! 🚀**

**Sprint Start Date:** TBD (after PO approval)
**Sprint End Date:** +10 working days
**Sprint Demo:** End of Week 2, Day 1
