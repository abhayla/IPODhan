# Sprint 1 Assignment - Devin (Dev Agent)

**Sprint:** Sprint 1 - Foundation & Infrastructure
**Epic:** Epic 1
**Assigned To:** Devin (Development Agent)
**Assigned By:** Sarah (Product Owner)
**Date:** 2025-10-05
**Status:** 🚀 **READY TO START**

---

## Assignment Overview

You are assigned to complete **Epic 1: Foundation & Infrastructure** (Sprint 1).

### Sprint Goal
Establish complete development infrastructure before feature work begins.

### Success Criteria
- ✅ All developers can clone and run the project locally
- ✅ Database operational with connection verified
- ✅ All core dependencies installed and working
- ✅ UI component library ready to use
- ✅ Testing framework functional (unit + E2E)
- ✅ CI/CD pipeline running automated checks

---

## Your Stories (18 Points)

### ✅ Story 1.1: Next.js Project Setup (COMPLETE)
- **Status:** Already done
- **Points:** 2
- **No action needed** - Next.js 14 is running

### 🔜 Story 1.2: Database Infrastructure
- **Points:** 3
- **Priority:** 🔴 Critical
- **Estimated:** 3 hours
- **Day:** Week 1, Day 1 (Monday)
- **Dependencies:** None
- **Details:** See `docs/stories/SPRINT-1-PLAN.md` lines 35-57

**Quick Summary:**
1. Verify PostgreSQL 16 installed
2. Create database "ipodhan"
3. Create user "ipodhan_user"
4. Create `.env.local` with DATABASE_URL
5. Test connection with API route
6. Document setup

**Acceptance Criteria:**
- [ ] PostgreSQL 16 running
- [ ] Database "ipodhan" created
- [ ] Connection string in `.env.local` works
- [ ] Test API route returns database version
- [ ] No connection errors

**Files to Create:**
- `web/.env.local`
- `web/app/api/db-test/route.ts`

---

### 🔜 Story 1.3: Core Dependencies Installation
- **Points:** 2
- **Priority:** 🔴 Critical
- **Estimated:** 2 hours
- **Day:** Week 1, Day 2 (Tuesday)
- **Dependencies:** Story 1.1 ✅
- **Details:** See `docs/stories/SPRINT-1-PLAN.md` lines 60-84

**Quick Summary:**
1. Install Drizzle ORM, Zod, Pino, ioredis
2. Install Redis
3. Create logger config
4. Test Redis connection

**Acceptance Criteria:**
- [ ] All packages in package.json
- [ ] No dependency conflicts
- [ ] Redis running
- [ ] Logger outputs to console

**Files to Create:**
- `web/lib/logger.ts`
- `web/lib/redis-client.ts`

---

### 🔜 Story 1.4: shadcn/ui Component Library
- **Points:** 3
- **Priority:** 🟡 High
- **Estimated:** 3 hours
- **Day:** Week 1, Day 3 (Wednesday)
- **Dependencies:** Story 1.1 ✅
- **Details:** See `docs/stories/SPRINT-1-PLAN.md` lines 87-116

**Quick Summary:**
1. Install shadcn/ui CLI
2. Configure components.json
3. Install 6 base components (Button, Card, Dialog, Input, Select, Badge)
4. Create sample page
5. Verify responsive

**Acceptance Criteria:**
- [ ] components.json configured
- [ ] 6 base components installed
- [ ] Sample page renders correctly
- [ ] Theme matches PRD
- [ ] Responsive on mobile/desktop

**Files to Create:**
- `web/components.json`
- `web/app/components-test/page.tsx`
- `web/components/ui/` (shadcn components)

---

### 🔜 Story 1.5: Testing Infrastructure
- **Points:** 5
- **Priority:** 🔴 Critical (Blocking)
- **Estimated:** 6 hours (3h + 3h)
- **Day:** Week 1, Day 4-5 (Thursday-Friday)
- **Dependencies:** Story 1.1 ✅
- **Details:** See `docs/stories/SPRINT-1-PLAN.md` lines 119-162

**Quick Summary:**
- **Day 4:** Vitest + React Testing Library + first unit test
- **Day 5:** Playwright + first E2E test + coverage

**Acceptance Criteria:**
- [ ] Vitest installed and configured
- [ ] @testing-library/react installed
- [ ] At least 1 unit test passes
- [ ] Playwright installed and configured
- [ ] At least 1 E2E test passes
- [ ] Coverage reporting works

**Files to Create:**
- `web/vitest.config.ts`
- `web/vitest.setup.ts`
- `web/playwright.config.ts`
- `web/tests/unit/sample.test.tsx`
- `web/tests/e2e/homepage.spec.ts`
- `web/tests/setup/`

---

### 🔜 Story 1.6: CI/CD Pipeline
- **Points:** 3
- **Priority:** 🟡 High
- **Estimated:** 4 hours
- **Day:** Week 2, Day 1 (Monday)
- **Dependencies:** Story 1.5 (Testing)
- **Details:** See `docs/stories/SPRINT-1-PLAN.md` lines 167-200

**Quick Summary:**
1. Create GitHub Actions workflow
2. Configure: lint → type-check → test → build
3. Test with sample PR
4. Add README badge

**Acceptance Criteria:**
- [ ] .github/workflows/ci.yml exists
- [ ] Workflow runs on every PR
- [ ] All checks pass
- [ ] PR cannot merge if checks fail
- [ ] Workflow completes in <5 minutes

**Files to Create:**
- `.github/workflows/ci.yml`
- `.github/workflows/README.md`

---

## Workflow Instructions

### Before Starting Each Story
1. Read the story details in `SPRINT-1-PLAN.md`
2. Check `DEPENDENCY-MATRIX.md` for blockers
3. Verify all required stories are completed
4. Understand all acceptance criteria

### During Implementation
1. Update story status to `in_progress` (if using story files)
2. Create all files listed in the story
3. Write tests as you code (not after)
4. Commit frequently with clear messages
5. Push to feature branch (not main directly)

### Before Marking Complete
1. ✅ ALL acceptance criteria verified
2. ✅ All tests passing locally
3. ✅ Code pushed and CI passes (after Story 1.6)
4. ✅ README updated if needed
5. ✅ Notify PO (Sarah) story is done

---

## Git Workflow

### Branch Naming
```bash
feature/story-1.2-database-infrastructure
feature/story-1.3-core-dependencies
feature/story-1.4-shadcn-ui
feature/story-1.5-testing-infrastructure
feature/story-1.6-cicd-pipeline
```

### Commit Message Format
```
feat(story-1.2): Add PostgreSQL connection and test route

- Install PostgreSQL 16
- Create ipodhan database
- Add DATABASE_URL to .env.local
- Create /api/db-test route
- Test connection successfully

Story: 1.2
Points: 3
Status: Completed
```

### When to Merge
- After all acceptance criteria met
- After tests passing
- After PO review (if requested)

---

## Environment Setup Checklist

Before starting Story 1.2, ensure:
- [ ] Node.js 20 installed
- [ ] npm working
- [ ] Git configured
- [ ] Code editor ready
- [ ] PostgreSQL 16 available (or Docker)
- [ ] Redis available (or Docker)

---

## Key Resources

1. **Sprint Plan:** `docs/stories/SPRINT-1-PLAN.md`
2. **Epic Overview:** `docs/stories/epics/epic-1-foundation.md`
3. **Story Index:** `docs/stories/STORY-INDEX.md`
4. **Dependencies:** `docs/stories/DEPENDENCY-MATRIX.md`
5. **Architecture:** `docs/architecture.md`
6. **PRD:** `docs/PRD.md`

---

## Daily Standup Format

Report daily to Sarah (PO):

**Yesterday:**
- Completed: Story X.Y (status: completed)
- Progressed: Story A.B (50% done, on track)

**Today:**
- Will complete: Story A.B (remaining 50%)
- Will start: Story C.D (if A.B completes)

**Blockers:**
- [None] or [Specific issue]

---

## Sprint Risks (Be Aware)

### Risk 1: Database Setup Issues (Story 1.2)
- **If PostgreSQL install fails:** Use Docker PostgreSQL
- **If VPS issues:** Document and use local setup
- **Escalate if:** Blocked >2 hours

### Risk 2: Testing Config Delays (Story 1.5)
- **If config complex:** Use Next.js + Vitest templates
- **If E2E blocking:** Defer to Week 2, prioritize unit tests
- **Escalate if:** Config issues >1 hour

### Risk 3: CI/CD Errors (Story 1.6)
- **If workflow errors:** Test locally with `act` tool
- **If complex:** Start minimal, add steps incrementally
- **Fallback:** Manual testing acceptable for Sprint 1

---

## Definition of Done (Sprint 1)

Sprint complete when:
- ✅ All 6 stories marked `completed`
- ✅ All acceptance criteria verified
- ✅ All tests passing (unit + E2E)
- ✅ CI/CD pipeline operational
- ✅ No critical bugs
- ✅ README updated with setup instructions
- ✅ PO demo completed

---

## Sprint Demo (End of Week 2, Day 1)

You will demo to Sarah (PO) that:
1. Clone repo → works
2. `npm install` → succeeds
3. Setup database (follow README) → works
4. `npm run dev` → app runs
5. `npm run test:unit` → passes
6. `npm run build` → succeeds

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Velocity | 18 points completed |
| Quality | 0 critical bugs |
| Timeline | Complete by Week 2, Day 1 |
| Tests | 100% pass rate |
| CI/CD | <5 min workflow time |

---

## Questions or Blockers?

**Contact:** Sarah (Product Owner)

**Escalation Rules:**
- Blocked >2 hours on Story 1.2 (Database)
- Config issues >1 hour on Story 1.5 (Testing)
- Any critical path concerns

---

## 🚀 Ready to Start!

**Your first task:** Story 1.2 - Database Infrastructure (3 hours)

**Start by:**
1. Reading `docs/stories/SPRINT-1-PLAN.md` lines 35-57
2. Verifying PostgreSQL 16 availability
3. Creating feature branch: `feature/story-1.2-database-infrastructure`
4. Following the 7 implementation steps

**Good luck! Let's build a solid foundation!** 🏗️

---

**Sprint Start Date:** 2025-10-05
**Sprint End Date:** 2025-10-19 (+10 working days)
**PO:** Sarah
**Dev:** Devin
**Status:** ✅ **APPROVED - BEGIN DEVELOPMENT**
