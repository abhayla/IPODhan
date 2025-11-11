# Continue IPODhan UX Transformation - Implementation Prompt V5

**Purpose:** Resume UX transformation with automatic status detection, TODO creation, and approval workflow.

**Source Plan:** `docs/19-ui/Plan-User-Experience-Transformation.md`

**Session Safe:** Can be used across multiple sessions to resume work.

**Current Status:** Phase 1 ✅ | Phase 2 ✅ | Phase 3 ✅ | Phase 4 ✅ | Phase 5 → Pending

---

## 🎯 Instructions for Claude

Execute these steps sequentially. **STOP at Step 5 and wait for user approval.**

---

## Step 1: Read Master Plan

Read the master UX transformation plan:

```bash
Read: docs/19-ui/Plan-User-Experience-Transformation.md
```

**Extract from plan:**
- All 5 phase requirements
- Success metrics and targets
- Performance budgets per phase
- Technical dependencies
- Integration points between phases

---

## Step 2: Read All Completion Reports

Read existing completion reports to understand what's already done:

```bash
Read: docs/19-ui/reports/PHASE-1-COMPLETE.md
Read: docs/19-ui/reports/PHASE-2-COMPLETE.md (if exists)
Read: docs/19-ui/reports/PHASE-3-COMPLETE.md
Read: docs/19-ui/reports/PHASE-4-COMPLETE.md (if exists)
```

**For each report, extract:**
- Completion date
- Features implemented
- Files created/modified
- Bundle impact
- Quality score
- Integration points
- Known issues

---

## Step 3: Comprehensive Implementation Status Check

Run detailed status checks for **ALL 5 phases**:

### Phase 1: Visual Identity Revolution

**Check for completion markers:**
- ✅ Already complete (check report exists)
- Skip detailed check if PHASE-1-COMPLETE.md exists

**If no report, check for:**
- `Grep: "IPODhan Gold Standard|--primary.*0f766e|--gradient-premium"` in globals.css
- `Glob: **/AnimatedScore.tsx`
- `Glob: **/GMPSparkline.tsx`
- `Glob: **/use-count-up.ts`
- `Glob: **/use-magnetic-hover.ts`
- Typography: `Grep: "Instrument_Serif|instrumentSerif"` in layout.tsx

**Calculate Progress:** X/19 tasks

---

### Phase 2: Data Intelligence Surface

**Check for completion markers:**
- ✅ Already complete (check report exists)
- ⚠️ Report missing but phase likely complete

**Check for implementation:**
- `Grep: "d3"` in package.json (D3.js installed?)
- `Glob: **/ScoreBreakdown*.tsx` (Radar chart)
- `Glob: **/SectorHeatMap*.tsx` (Heat map)
- `Glob: **/CorrelationMatrix*.tsx` (Scatter plot)
- `Glob: **/PredictiveMeter*.tsx` (Gauge)
- `Glob: **/TimeSeriesPlayback*.tsx` (Timeline)
- `Glob: **/ContextualTooltip.tsx`
- `Glob: **/ScoreRangeFilter.tsx`

**Calculate Progress:** X/15 tasks

---

### Phase 3: Real-Time Experience

**Check for completion markers:**
- ✅ Already complete (check report exists)
- Skip detailed check if PHASE-3-COMPLETE.md exists

**If no report, check for:**
- `Glob: **/websocket/client.ts` or `**/lib/websocket/*.ts`
- `Glob: **/api/live-updates/route.ts`
- `Glob: **/use-live-updates.ts`
- `Glob: **/LiveSubscriptionTracker.tsx`
- `Glob: **/LiveGMPTicker.tsx`
- `Glob: **/MarketPulse.tsx`
- `Glob: **/HotRightNow.tsx`
- `Glob: **/VisualFilterBuilder.tsx`
- `Glob: **/FilterPresets.tsx`

**Calculate Progress:** X/12 tasks

---

### Phase 4: Mobile Excellence

**Check for completion markers:**
- ✅ Already complete (check report exists)
- Skip detailed check if PHASE-4-COMPLETE.md exists

**If no report, check for:**
- `Grep: "@use-gesture/react|react-use-gesture"` in package.json
- `Glob: **/mobile/BottomNav.tsx`
- `Glob: **/use-gestures.ts`
- `Glob: **/Swipeable*.tsx`
- `Glob: **/PullToRefresh.tsx`
- `Glob: **/ZoomableChart.tsx`
- `Glob: **/LongPressMenu.tsx`
- `Read: web/public/manifest.json` (PWA manifest)
- `Glob: **/sw.js` or `**/service-worker*.js` (Service worker)
- `Grep: "min-height.*44px|touch-target"` in globals.css

**Calculate Progress:** X/10 tasks

---

### Phase 5: Personalization Engine

**Check for implementation:**

**1. User Profile & Behavior Tracking:**
- `Glob: **/personalization/user-profile.ts`
- `Glob: **/personalization/behavior-tracker.ts`
- `Grep: "localStorage.*preferences|localStorage.*userProfile"` in lib/ (check for localStorage usage)

**2. Recommendation System:**
- `Glob: **/intelligence/ForYouSection.tsx`
- `Glob: **/intelligence/SmartDefaults.tsx`
- `Glob: **/intelligence/SuggestedComparisons.tsx`
- Look for ML/recommendation logic

**3. Keyboard Shortcuts:**
- `Grep: "react-hotkeys-hook"` in package.json
- `Glob: **/use-keyboard-shortcuts.ts`
- `Grep: "useHotkeys|useKeyboardShortcut"` in hooks/

**4. Bulk Actions:**
- `Glob: **/MultiSelectCard.tsx`
- `Glob: **/BulkActions.tsx`
- `Glob: **/CSVExporter.tsx`
- `Glob: **/ExportButton.tsx`

**5. Testing & Privacy:**
- Check for localStorage schema documentation
- Check for privacy compliance documentation

**Calculate Progress:** X/14 tasks

---

## Step 4: Generate Comprehensive Status Report

Create a detailed status report:

```markdown
# IPODhan UX Transformation - Implementation Status

**Assessment Date:** [YYYY-MM-DD]
**Session:** [Session number based on git log]
**Total Progress:** XX/70 tasks (YY%) across 5 phases

---

## Overall Progress

**Phases:**
- Phase 1: [✅ COMPLETE / 🚧 IN_PROGRESS / ❌ NOT_STARTED] - XX% (YY/19 tasks)
- Phase 2: [✅ COMPLETE / 🚧 IN_PROGRESS / ❌ NOT_STARTED] - XX% (YY/15 tasks)
- Phase 3: [✅ COMPLETE / 🚧 IN_PROGRESS / ❌ NOT_STARTED] - XX% (YY/12 tasks)
- Phase 4: [✅ COMPLETE / 🚧 IN_PROGRESS / ❌ NOT_STARTED] - XX% (YY/10 tasks)
- Phase 5: [✅ COMPLETE / 🚧 IN_PROGRESS / ❌ NOT_STARTED] - XX% (YY/14 tasks)

**Next Recommended Phase:** [Phase X - Name]

---

## Phase-by-Phase Status

### Phase 1: Visual Identity Revolution
**Status:** [COMPLETE / IN_PROGRESS / NOT_STARTED]
**Progress:** XX/19 tasks (YY%)

**Completion Report:** [✅ docs/19-ui/reports/PHASE-1-COMPLETE.md / ❌ Missing]

**Completed Features:**
- [List completed features from report or status check]

**Pending Features:**
- [List pending features]

**Files Created:** XX files, ~YYY lines
**Bundle Impact:** +XXkb

---

### Phase 2: Data Intelligence Surface
**Status:** [COMPLETE / IN_PROGRESS / NOT_STARTED]
**Progress:** XX/15 tasks (YY%)

**Completion Report:** [✅ docs/19-ui/reports/PHASE-2-COMPLETE.md / ❌ Missing]

⚠️ **Action Required:** [If phase appears complete but report missing, note this]

**Completed Features:**
- [List from status check]

**Pending Features:**
- [List pending]

**Files Created:** ~XX files
**Bundle Impact:** ~+XXXkb

---

### Phase 3: Real-Time Experience
**Status:** [COMPLETE / IN_PROGRESS / NOT_STARTED]
**Progress:** XX/12 tasks (YY%)

**Completion Report:** [✅ docs/19-ui/reports/PHASE-3-COMPLETE.md / ❌ Missing]

**Completed Features:**
- [List from report]

**Pending Features:**
- [List pending]

---

### Phase 4: Mobile Excellence
**Status:** [COMPLETE / IN_PROGRESS / NOT_STARTED]
**Progress:** XX/10 tasks (YY%)

**Completion Report:** [✅ docs/19-ui/reports/PHASE-4-COMPLETE.md / ❌ Missing]

**Completed Features:**
- [List from report or status check]

**Pending Features:**
- [List pending]

---

### Phase 5: Personalization Engine
**Status:** [COMPLETE / IN_PROGRESS / NOT_STARTED]
**Progress:** XX/14 tasks (YY%)

**Components Found:**
- User Profile: [✅ / ❌]
- Behavior Tracker: [✅ / ❌]
- ForYouSection: [✅ / ❌]
- SmartDefaults: [✅ / ❌]
- SuggestedComparisons: [✅ / ❌]
- Keyboard Shortcuts Library: [✅ / ❌]
- Keyboard Shortcuts Hook: [✅ / ❌]
- MultiSelectCard: [✅ / ❌]
- CSVExporter: [✅ / ❌]
- Bulk Actions: [✅ / ❌]

**Pending Features:**
- [List all pending features]

---

## Performance Budget Analysis

**Total Budget:** 310KB
**Current Usage:** XXXkb (YY%)
**Remaining:** XXkb

**Breakdown:**
- Phase 1: +6KB ✅
- Phase 2: +200KB ✅
- Phase 3: +55KB ✅
- Phase 4: +XXkb [✅ / ⚠️ / ❌]
- Phase 5: [Not yet implemented / In progress]

**Phase 5 Budget:** ~XXkb available
**Status:** [✅ Sufficient / ⚠️ Tight / ❌ Over budget]

**Recommendations:**
- [Budget recommendations based on remaining capacity]

---

## Critical Issues & Blockers

**Missing Completion Reports:**
- [List any missing reports for completed phases]

**Incomplete Phases:**
- [List phases that are partially complete]

**Dependencies:**
- [List any missing dependencies]

**Budget Concerns:**
- [Any budget warnings]

---

## Recommendations

### Option 1: Continue with Next Incomplete Phase ✅ Recommended
**Target Phase:** Phase X - [Name]
**Rationale:** [Why this phase next]
**Estimated Duration:** X-Y hours
**Bundle Impact:** ~XXkb

### Option 2: Create Missing Completion Reports
**Missing Reports:** [List]
**Rationale:** Documentation completeness
**Estimated Duration:** 30-60 minutes per report

### Option 3: Optimize & Polish Existing Phases
**Focus Areas:**
- [List optimization opportunities]
**Estimated Duration:** X-Y hours

### Option 4: Custom Implementation
User specifies exactly what to implement.

---

**Ready for TODO Creation & User Approval**
```

---

## Step 5: Create Dynamic TODO List & Present for Approval

Based on the status report, create appropriate TODOs and present options to user.

### 5.1: If Missing Completion Reports

If any phase is complete but missing a report:

```markdown
⚠️ **Documentation Gap Detected**

The following phases appear complete but lack completion reports:
- Phase X: [Name] (XX/XX tasks complete)

**Recommendation:** Create completion reports before proceeding to maintain project documentation.

Would you like to:
1. Create missing completion report(s) first? ✅ Recommended
2. Skip documentation and continue with next phase?
3. Review documentation gaps and decide?
```

### 5.2: If Next Phase is Partially Complete

If the next phase has some features implemented:

```markdown
🚧 **Partial Implementation Detected**

Phase X appears to be partially complete:
- Completed: YY/ZZ tasks (XX%)
- Pending: [List pending tasks]

**Options:**
1. Resume Phase X implementation (continue where left off) ✅ Recommended
2. Start fresh (review existing code, then continue)
3. Skip Phase X and move to next phase
```

### 5.3: If Next Phase is Not Started

**Create complete TODO list for the phase.**

Example for **Phase 5: Personalization Engine:**

```typescript
TodoWrite({
  todos: [
    // Infrastructure (2 tasks)
    {
      content: "Create user profile schema (web/lib/personalization/user-profile.ts)",
      activeForm: "Creating user profile schema",
      status: "pending"
    },
    {
      content: "Implement behavior tracker (web/lib/personalization/behavior-tracker.ts)",
      activeForm: "Implementing behavior tracker",
      status: "pending"
    },

    // Recommendation System (4 tasks)
    {
      content: "Build ForYouSection component (web/components/intelligence/ForYouSection.tsx)",
      activeForm: "Building ForYouSection component",
      status: "pending"
    },
    {
      content: "Create ML recommendation algorithm (client-side, rule-based initially)",
      activeForm: "Creating recommendation algorithm",
      status: "pending"
    },
    {
      content: "Implement SmartDefaultFilters (web/components/intelligence/SmartDefaults.tsx)",
      activeForm: "Implementing SmartDefaultFilters",
      status: "pending"
    },
    {
      content: "Build SuggestedComparisons widget (web/components/intelligence/SuggestedComparisons.tsx)",
      activeForm: "Building SuggestedComparisons widget",
      status: "pending"
    },

    // Keyboard Shortcuts (3 tasks)
    {
      content: "Install react-hotkeys-hook library (npm install react-hotkeys-hook)",
      activeForm: "Installing keyboard shortcuts library",
      status: "pending"
    },
    {
      content: "Create use-keyboard-shortcuts hook (web/hooks/use-keyboard-shortcuts.ts)",
      activeForm: "Creating keyboard shortcuts hook",
      status: "pending"
    },
    {
      content: "Implement shortcuts: / (search), c (compare), s (save), f (filters), ? (help), arrows, Esc",
      activeForm: "Implementing keyboard shortcuts",
      status: "pending"
    },

    // Bulk Actions (3 tasks)
    {
      content: "Build MultiSelectCard component (web/components/ipo/MultiSelectCard.tsx)",
      activeForm: "Building MultiSelectCard component",
      status: "pending"
    },
    {
      content: "Create CSVExporter component (web/components/tools/CSVExporter.tsx)",
      activeForm: "Creating CSVExporter component",
      status: "pending"
    },
    {
      content: "Add bulk action handlers (compare multiple, export to CSV, share collection)",
      activeForm: "Adding bulk action handlers",
      status: "pending"
    },

    // Testing & Privacy (2 tasks)
    {
      content: "Test recommendation accuracy with sample user data",
      activeForm: "Testing recommendation accuracy",
      status: "pending"
    },
    {
      content: "Privacy compliance check: No PII storage, GDPR compliant, localStorage only",
      activeForm: "Checking privacy compliance",
      status: "pending"
    }
  ]
});
```

### 5.4: Present Complete Plan to User

```markdown
# 🎯 IPODhan UX Transformation - Ready to Continue

## Current Status Summary

**Overall Progress:** XX% (YY/70 tasks)

✅ **Phase 1:** Visual Identity Revolution - [COMPLETE / XX%]
✅ **Phase 2:** Data Intelligence Surface - [COMPLETE / XX%]
✅ **Phase 3:** Real-Time Experience - [COMPLETE / XX%]
✅ **Phase 4:** Mobile Excellence - [COMPLETE / XX%]
[Status] **Phase 5:** Personalization Engine - [COMPLETE / IN_PROGRESS / NOT_STARTED]

---

## Proposed Next Steps

**Recommendation:** [Based on analysis]

**Target:** Phase X - [Name]
**Status:** [Current status]
**Tasks Remaining:** XX tasks
**Estimated Duration:** X-Y hours
**Complexity:** [Low / Medium / High]
**Bundle Budget:** ~XXkb (YYkb remaining total)

---

## Key Features to Implement

**Phase X - [Name]:**
1. [Feature 1]
2. [Feature 2]
3. [Feature 3]
...

**Dependencies:**
- [Dependency 1]
- [Dependency 2]

**Integration Points:**
- Phase 1: [How it integrates]
- Phase 2: [How it integrates]
- Phase 3: [How it integrates]
- Phase 4: [How it integrates]

---

## TODO List Created

✅ TODO list with XX tasks:
- X tasks completed (from previous work)
- YY tasks pending
- Ordered by dependency

**Task Breakdown:**
1. Infrastructure: X tasks
2. Core Components: Y tasks
3. Features: Z tasks
4. Testing: A tasks

---

## Performance Considerations

**Current Bundle:** XXXkb / 310KB (YY% used)
**Phase X Budget:** ~XXkb
**Remaining After Phase X:** ~XXkb

**Status:** [✅ Within budget / ⚠️ Tight - need code splitting / ❌ Over budget - need optimization]

**Code Splitting Plan:** [If needed]
- [Component 1]: Lazy load
- [Component 2]: Dynamic import
- [Library X]: Code split

---

## Approval Options

### Option 1: Implement Phase X ✅ Recommended (if Phase X is next incomplete)

Proceed with full implementation of Phase X:
- Real-time TODO updates after each task
- Progress checkpoints every 3-5 tasks
- Integration with previous phases
- Comprehensive testing
- Completion report at end

**Benefits:**
- [Benefit 1]
- [Benefit 2]
- [Benefit 3]

**Estimated Time:** X-Y hours

---

### Option 2: Create Missing Completion Report(s) (if any missing)

Document already-completed phases:
- Phase X: Create PHASE-X-COMPLETE.md
- [List all missing reports]

**Benefits:**
- Complete project documentation
- Clear implementation history
- Easier onboarding for future developers
- Better project tracking

**Estimated Time:** 30-60 minutes per report

---

### Option 3: Resume Partial Phase (if applicable)

Continue Phase X from task #Y:
- Review existing implementation
- Complete remaining XX tasks
- Integration testing
- Create completion report

**Current Progress:** YY/ZZ tasks (XX%)
**Remaining:** ZZ tasks

---

### Option 4: Optimize Existing Phases

Polish and optimize Phases 1-X:
- Performance optimization
- Bundle size reduction
- Integration testing
- Cross-browser testing
- Accessibility audit
- Real device testing

**Focus Areas:** [List]

---

### Option 5: Custom Scope

Specify exactly what you want implemented:
- Example: "Just implement keyboard shortcuts from Phase 5"
- Example: "Create Phase 2 completion report only"
- Example: "Optimize bundle size across all phases"

---

## 🎯 APPROVAL REQUIRED

Please respond with:
- **"Approve Phase X"** to implement next phase ✅ Recommended
- **"Create missing reports"** to document completed phases
- **"Resume Phase X"** to continue partial implementation
- **"Optimize existing"** to polish completed phases
- **"Custom: [specify]"** for custom scope

Once approved, I will:
1. ✅ Mark first task as `in_progress`
2. 🔨 Implement following architectural patterns (CLAUDE.md)
3. ✅ Mark tasks `completed` immediately after finishing
4. ➡️ Move to next task with live status updates
5. 📊 Provide progress checkpoints every 3-5 tasks
6. 🧪 Run validation tests at the end
7. 📝 Create comprehensive completion report

---

## Implementation Standards

**Following IPODhan Patterns:**
- ✅ TypeScript strict mode
- ✅ Component reusability (variants: compact, default, detailed)
- ✅ Performance optimization (code splitting, lazy loading)
- ✅ WCAG AA accessibility
- ✅ Responsive design (6 breakpoints)
- ✅ Cross-browser compatibility (95%+)
- ✅ Repository pattern (if data access needed)
- ✅ Service layer (if business logic needed)
- ✅ Cache-aside pattern (if caching needed)

**Phase-Specific Standards:**
- [List standards specific to the phase being implemented]

---

**Ready to proceed upon your approval!** 🚀

**Estimated Time:**
- Phase X: ~X-Y hours
- Completion Report: ~30-60 minutes
- Optimization: ~X-Y hours (depends on scope)
```

⚠️ **STOP HERE - DO NOT IMPLEMENT WITHOUT APPROVAL** ⚠️

---

## Step 6: Implementation Execution (After Approval)

### 6.1: Task Execution Loop

**For each pending task:**

1. **Update TODO:** Mark as `in_progress`

2. **Read Context:**
   - Check for existing related files
   - Review integration points with Phases 1-4
   - Identify reusable components from previous phases

3. **Implement:**
   - Follow patterns from CLAUDE.md
   - Integrate with previous phases:
     - **Phase 1:** Use colors, typography, animations (AnimatedScore, GMPSparkline)
     - **Phase 2:** Integrate with D3.js visualizations
     - **Phase 3:** Connect to live updates, use FilterPresets
     - **Phase 4:** Mobile-optimized, gesture support, touch targets ≥44px
   - Maintain TypeScript strict mode
   - Follow naming conventions
   - Add comprehensive comments

4. **Validate:**
   - TypeScript compilation (only if critical error suspected)
   - Component API consistency
   - Performance check (bundle size estimate)
   - Accessibility (WCAG AA)

5. **Update TODO:** Mark as `completed` IMMEDIATELY

6. **Report Progress:**
   ```
   ✅ Task X/YY completed: [Description]

   **Files:**
   - Created: [file paths with line counts]
   - Modified: [file paths with changes]

   **Features:**
   - [Feature 1]
   - [Feature 2]

   **Integration:**
   - Phase 1: [Reused components]
   - Phase 2: [Integration points]
   - Phase 3: [Live data connections]
   - Phase 4: [Mobile support]

   **Performance:**
   - Bundle impact: ~+XXkb
   - Remaining budget: ~YYkb

   **Next:** Task X+1 - [Description]
   **Progress:** XX/YY (ZZ%)
   ```

7. **Move to next task**

### 6.2: Progress Checkpoints (Every 3-5 Tasks)

```markdown
📊 **Checkpoint: XX/YY tasks complete (ZZ%)**

**Time Elapsed:** ~X hours
**Bundle Impact:** ~+XXkb
**Remaining Budget:** ~YYkb

**Features Complete:**
- [Feature 1]
- [Feature 2]
- [Feature 3]

**Integration Points:**
- Phase 1: [Components reused]
- Phase 2: [Visualizations integrated]
- Phase 3: [Live updates connected]
- Phase 4: [Mobile optimizations applied]

**Quality:**
- TypeScript: ✅ No critical errors
- Accessibility: ✅ WCAG AA maintained
- Performance: ✅ Within budget

**Blockers:** [None / List any issues]

**Next Up:**
- Task X+1: [Description]
- Task X+2: [Description]
- Task X+3: [Description]
```

### 6.3: Handle Blockers

If blocked:

```markdown
⚠️ **Blocker Detected**

**Task:** [Task description]
**Issue:** [What's blocking]
**Impact:** [High / Medium / Low]
**Attempted:** [What solutions were tried]

**Options:**
1. [Alternative approach 1]
2. [Alternative approach 2]
3. Skip task and continue (mark as pending with blocker note)
4. Wait for user input

**Recommendation:** [Suggest best option]

**Need user input?** [Yes / No]
```

Wait for user decision if needed, then continue.

### 6.4: Phase Completion

After all tasks complete:

```markdown
# 🎉 Phase X: [Name] - COMPLETE!

**Completion Date:** YYYY-MM-DD
**Duration:** X hours
**Status:** ✅ **100% COMPLETE** - Production Ready

---

## Summary

**Tasks:** XX/XX (100%)
**Quality Score:** X.X/10
**Bundle Impact:** +XXkb (within YYkb budget)
**Files Created:** XX
**Files Modified:** YY
**Lines Added:** ~X,XXX

---

## What Was Built

### [Category 1]
- [Component 1] (XX lines) - [Description]
- [Component 2] (YY lines) - [Description]

### [Category 2]
- [Component 3] (ZZ lines) - [Description]

---

## Integration with Previous Phases

**Phase 1:** [List reused components and patterns]
**Phase 2:** [List visualization integrations]
**Phase 3:** [List live update connections]
**Phase 4:** [List mobile optimizations applied]

---

## Performance Metrics

**Bundle Size:** +XXkb / YYkb budget
**Status:** [✅ Within budget / ⚠️ Exceeded - needs optimization]

**Total Project:**
- Used: XXXkb / 310KB (YY%)
- Remaining: ZZkb

---

## Quality Metrics

**TypeScript:** ✅ Zero critical errors
**Accessibility:** ✅ WCAG AA compliant
**Performance:** ✅ 60fps animations maintained
**Cross-browser:** ✅ 95%+ coverage
**Mobile:** ✅ Touch targets ≥44px

---

## Next Steps

**Option 1:** Create Phase X completion report
**Option 2:** Proceed to Phase X+1
**Option 3:** Optimize and test Phase X
**Option 4:** Review and iterate

**Recommendation:** [Suggest next step]
```

---

## Step 7: Create Completion Report

Generate comprehensive completion report:

**File:** `docs/19-ui/reports/PHASE-X-COMPLETE.md`

Include:
- Completion date and duration
- All implemented features
- Files created/modified (with line counts)
- Integration points with other phases
- Performance metrics
- Bundle impact
- Quality scores
- Testing results (if applicable)
- Known issues
- Next steps
- Lessons learned

Use existing completion reports as templates (PHASE-1-COMPLETE.md, PHASE-3-COMPLETE.md, PHASE-4-COMPLETE.md).

---

## Best Practices

### DO:
- ✅ Read ALL completion reports before starting
- ✅ Check for existing implementations (avoid duplication)
- ✅ Reuse components from previous phases extensively
- ✅ Update TODO status after EACH task (not batched)
- ✅ Provide live progress updates
- ✅ Follow architectural patterns from CLAUDE.md
- ✅ Maintain accessibility (WCAG AA)
- ✅ Respect performance budgets
- ✅ Integrate with all previous phases
- ✅ Test incrementally
- ✅ Ask questions when uncertain
- ✅ Create completion report at end

### DON'T:
- ❌ Skip status detection (always check first)
- ❌ Start without approval (wait for Step 5)
- ❌ Batch TODO updates (update immediately)
- ❌ Duplicate existing functionality
- ❌ Ignore previous phase integrations
- ❌ Hardcode values
- ❌ Skip accessibility considerations
- ❌ Exceed performance budget without approval
- ❌ Break existing features
- ❌ Forget completion report

---

## Emergency Procedures

### If Build Fails
1. Check error message carefully
2. Fix critical errors immediately
3. Verify imports and types
4. Document issue if stuck
5. Ask user for help if needed

### If Budget Exceeded
1. Analyze bundle size
2. Implement code splitting
3. Use dynamic imports
4. Tree shake unused code
5. Report to user and request approval to continue

### If Dependency Missing
1. Document blocker clearly
2. Provide options (install, alternative, mock)
3. Wait for user decision
4. Continue with approved approach

### If Integration Issues
1. Re-read previous phase completion reports
2. Check component interfaces
3. Update code to match existing patterns
4. Test integration thoroughly
5. Ask user if breaking changes needed

---

## Success Criteria

Implementation successful when:
- ✅ Status accurately detected for all 5 phases
- ✅ TODO list matches actual work to be done
- ✅ User approved before implementation started
- ✅ All tasks completed or blocked with clear reason
- ✅ TODOs updated after each task
- ✅ Live progress updates provided
- ✅ TypeScript compiles (no critical errors)
- ✅ Performance budget maintained
- ✅ Accessibility preserved (WCAG AA)
- ✅ Integration with previous phases working
- ✅ Completion report created
- ✅ All questions answered

---

## Notes for Claude

1. **Always start with Steps 1-3** (read plan, reports, check status)
2. **Generate complete status report** (Step 4)
3. **Create appropriate TODOs** (Step 5)
4. **Wait for approval** (Step 5 - CRITICAL)
5. **Update TODO after EACH task** (not batched)
6. **Provide live updates** (after every task)
7. **Follow architectural patterns** (CLAUDE.md)
8. **Integrate extensively** (reuse Phases 1-4 components)
9. **Test incrementally** (don't wait until end)
10. **Ask when uncertain** (don't guess)
11. **Track performance** (report after each task)
12. **Maintain accessibility** (WCAG AA throughout)
13. **Check dependencies** (libraries, tools, etc.)
14. **Document blockers** (provide options)
15. **Create completion report** (every phase)
16. **Verify integration** (no conflicts with previous phases)

---

**This prompt is stateful and resumable across sessions.**

**Version:** 5.0
**Created:** November 2024
**Last Updated:** November 2024 (after Phase 4 completion)
**Purpose:** Multi-session UX implementation with automatic status detection and approval workflow
**Status Detection:** Comprehensive checks for all 5 phases
**Completion Reports:** Phases 1 ✅ | 2 ⚠️ Missing | 3 ✅ | 4 ✅ | 5 Pending
