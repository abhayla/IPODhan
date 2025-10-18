# IPODhan Stories & Epics - README

**Created:** 2025-10-05
**Status:** ✅ Ready for Development
**Total Stories:** 40
**Total Points:** 184
**Estimated Duration:** 14-15 weeks

---

## 📁 Directory Structure

```
docs/stories/
├── README.md (this file)
├── STORY-INDEX.md (master list of all stories)
├── DEPENDENCY-MATRIX.md (dependency mapping & critical path)
├── STORY-TEMPLATE.yaml (template for new stories)
├── epics/
│   ├── epic-1-foundation.md
│   ├── epic-2-data-layer.md
│   ├── epic-3-ipo-listing.md
│   ├── epic-4-ipo-detail.md
│   ├── epic-5-ipo-tools.md
│   ├── epic-6-historical-data.md
│   ├── epic-7-data-pipeline.md
│   └── epic-8-production-readiness.md
└── story-2.3-repository-layer.yaml (example story)
```

---

## 📋 Quick Start Guide

### For Product Owner (Sarah):

1. **Review Epic Overview**
   - Read each epic file in `epics/` folder
   - Understand business value and success criteria
   - Approve or request changes

2. **Review Story Index**
   - Open `STORY-INDEX.md`
   - Verify all PRD features are covered
   - Check story point estimates (realistic?)

3. **Review Dependencies**
   - Open `DEPENDENCY-MATRIX.md`
   - Understand critical path stories (red markers)
   - Identify parallelization opportunities

4. **Approve Roadmap**
   - Open `docs/REVISED-IMPLEMENTATION-ROADMAP.md`
   - Confirm 14-15 week timeline acceptable
   - Sign off for development start

### For Developers (Devin):

1. **Read This README** ✅ You are here

2. **Understand Epic Structure**
   - Each epic is a major feature area
   - Epics contain 3-8 related stories
   - Epics deliver business value when complete

3. **Understand Stories**
   - Each story is a single unit of work
   - Story = User value + Acceptance criteria + Tests
   - Stories are estimated in points (Fibonacci: 1,2,3,5,8,13)

4. **Check Dependencies BEFORE Starting**
   - Open `DEPENDENCY-MATRIX.md`
   - Find your assigned story
   - Verify all "REQUIRES" stories are completed
   - DO NOT start if blocked

5. **Use Story Template**
   - Copy `STORY-TEMPLATE.yaml`
   - Fill in all sections
   - Commit to this folder

6. **Update Story Status**
   - When starting: Change status to `in_progress`
   - When blocked: Change status to `blocked`, add note
   - When done: Change status to `completed`, fill `actual_hours`

---

## 🔴 Critical Path Stories (MUST NOT SLIP)

| Story | Week | Impact if Delayed |
|-------|------|-------------------|
| **2.3: Repository Layer** | Week 2 | Blocks 8 stories, delays project 1+ weeks |
| **3.4: Dashboard Page** | Week 3-4 | First visible feature, affects morale |
| **4.3: IPO Detail Page** | Week 5-6 | Blocks 5 tool features |
| **7.4: Scheduler** | Week 9-10 | No real-time data |

**Rule:** If a critical path story slips by 2+ days, escalate immediately to PO.

---

## 📊 Epic Overview

| Epic | Stories | Points | Duration | Status |
|------|---------|--------|----------|--------|
| Epic 1: Foundation | 6 | 18 | Weeks 1-2 | In Progress (1.1 done) |
| Epic 2: Data Layer | 4 | 19 | Weeks 2-3 | Pending |
| Epic 3: IPO Listing | 7 | 34 | Weeks 3-4 | Pending |
| Epic 4: IPO Detail | 6 | 33 | Weeks 5-6 | Pending |
| Epic 5: IPO Tools | 5 | 19 | Week 7 | Pending |
| Epic 6: Historical | 3 | 13 | Week 7 | Pending |
| Epic 7: Data Pipeline | 5 | 27 | Weeks 9-10 | Pending |
| Epic 8: Production | 5 | 26 | Weeks 11-12 | Pending |
| **TOTAL** | **40** | **184** | **14-15 weeks** | **2.5% done** |

---

## ✅ Definition of Done (All Stories)

A story is ONLY complete when:
- ✅ All acceptance criteria verified
- ✅ Code reviewed and approved
- ✅ Tests passing (unit + integration)
- ✅ No TypeScript errors (strict mode)
- ✅ Documentation updated
- ✅ Merged to main branch
- ✅ PO acceptance (if user-facing)

**Never mark a story complete unless ALL criteria met.**

---

## 🎯 How to Use Story Files

### Creating a New Story

1. Copy `STORY-TEMPLATE.yaml`
2. Rename to `story-{epic}.{number}-{short-name}.yaml`
3. Fill in all sections (delete comments)
4. Add to appropriate week in roadmap
5. Update `STORY-INDEX.md`
6. Commit and push

### Working on a Story

1. **Before starting:**
   - Check `DEPENDENCY-MATRIX.md` for blockers
   - Ensure all "REQUIRES" stories are completed
   - Read acceptance criteria thoroughly

2. **During implementation:**
   - Update status to `in_progress`
   - Follow implementation notes
   - Create all files listed in `files_to_create`
   - Write tests as you code (not after)

3. **Before marking complete:**
   - Verify ALL acceptance criteria
   - Run all tests locally
   - Push and ensure CI passes
   - Request code review
   - Update `actual_hours`
   - Change status to `completed`

4. **If blocked:**
   - Change status to `blocked`
   - Add note explaining blocker
   - Notify team immediately
   - Work on parallel story if available

---

## 🔄 Workflow Example

**Scenario:** Developer working on Story 3.2 (GET /api/ipos Route)

1. **Check Dependencies**
   ```bash
   # Open DEPENDENCY-MATRIX.md
   # Story 3.2 REQUIRES: Story 2.3 (Repository Layer)
   # Verify 2.3 status = completed ✅
   ```

2. **Read Story**
   ```bash
   # Open story-3.2-api-ipos-route.yaml (if exists)
   # Read user story, acceptance criteria, implementation notes
   ```

3. **Start Work**
   ```yaml
   # Update story file:
   status: in_progress
   assigned_to: devin
   notes: |
     - Started: 2025-10-15
   ```

4. **Implement**
   ```bash
   # Create app/api/ipos/route.ts
   # Implement GET handler
   # Add query param parsing
   # Use IPORepository.findAll
   # Add Redis caching
   # Write unit tests
   # Write integration tests
   ```

5. **Verify**
   ```bash
   # Run tests
   npm run test:unit
   npm run test:integration

   # Check TypeScript
   npm run type-check

   # Check lint
   npm run lint
   ```

6. **Complete**
   ```yaml
   # Update story file:
   status: completed
   actual_hours: 6
   notes: |
     - Started: 2025-10-15
     - Completed: 2025-10-15
     - Tests passing, code reviewed by Sarah
   ```

7. **Unblock Downstream**
   ```bash
   # Story 3.4 (Dashboard) now unblocked (required 3.2)
   # Notify team Story 3.2 is done
   ```

---

## 📈 Tracking Progress

### Daily Standup Format
- **Yesterday:** Completed Story X.Y, progressed on Story A.B
- **Today:** Will complete Story A.B, start Story C.D
- **Blockers:** Story C.D blocked by Story E.F (not done yet)

### Weekly Review
- **Stories Completed:** X / Y planned
- **Velocity:** Z points completed (compare to 20-25 target)
- **Blockers:** List any impediments
- **Next Week:** Planned stories from roadmap

### Epic Completion Criteria
An epic is complete when:
- All stories in epic are `completed`
- Epic's "Definition of Done" met
- PO has demoed and approved
- No critical bugs in epic features

---

## 🚨 Escalation Process

### If a Story Slips:
- **< 1 day:** Continue, adjust daily plan
- **1-2 days:** Notify team, reassess week plan
- **2+ days (Critical Path):** 🚨 Escalate to PO immediately
- **> 5 days:** Consider story too large, split into smaller stories

### If Blocked:
1. Mark story status as `blocked`
2. Add blocker description to notes
3. Notify team in standup
4. Work on parallel non-blocked story
5. Escalate if blocker not resolved in 24 hours

---

## 📚 Additional Resources

- **PRD:** `docs/prd.md` (Product requirements)
- **Architecture:** `docs/architecture.md` (Technical decisions)
- **Roadmap:** `docs/REVISED-IMPLEMENTATION-ROADMAP.md` (Week-by-week plan)
- **Validation Report:** `docs/stories/PO-VALIDATION-REPORT.md` (PO checklist results)

---

## 🎉 Let's Build IPODhan!

You now have:
- ✅ 8 epic overviews with business value
- ✅ 40 story definitions with acceptance criteria
- ✅ Complete dependency mapping
- ✅ Revised 14-15 week roadmap
- ✅ Story template for future work

**Next Step:** PO approval, then start Epic 1 (Foundation)!

**Questions?** Ask Sarah (Product Owner) or refer to docs.

---

**Last Updated:** 2025-10-05
**Status:** ✅ Ready to Code
