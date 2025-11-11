# Continue IPODhan UX Transformation - Implementation Prompt V2

**Purpose:** Resume UX transformation implementation with automatic status detection and approval workflow.

**Source Plan:** `docs/19-ui/Plan-User-Experience-Transformation.md`

**Session Safe:** This prompt can be used across multiple sessions to resume work.

---

## 🎯 Instructions for Claude

Execute the following steps in order. **DO NOT start implementation until user approval is received in Step 4.**

---

## Step 1: Read Source Plan & Prior Status

### 1.1 Read Master Plan
```bash
Read: docs/19-ui/Plan-User-Experience-Transformation.md
```

**Extract:**
- All 5 phases with requirements
- Phase-specific features and components
- Success metrics and targets
- Technical dependencies
- Performance budgets

---

### 1.2 Read Previous Session Status (If Exists)

**Check for existing completion reports:**
```bash
Glob: docs/19-ui/reports/PHASE-*-COMPLETE.md
```

**If found:** Parse completion status
**If not found:** Assume starting from Phase 1

---

## Step 2: Comprehensive Status Detection

Run status checks for ALL 5 phases to determine where to resume:

### Phase 1: Visual Identity Revolution

**Check for existence (use Glob):**
- `**/globals.css` → Check for IPODhan colors, gradients
- `**/layout.tsx` → Check for Instrument Serif, Inter, JetBrains Mono
- `**/IPOCardEnhanced.tsx` → Check for Layer 1 + Layer 2
- `**/AnimatedScore.tsx`
- `**/GMPSparkline.tsx`
- `**/CompactSubscriptionBreakdown.tsx`
- `**/QuickStatsGrid.tsx`
- `**/use-count-up.ts`
- `**/use-magnetic-hover.ts`

**Check content (use Grep in globals.css):**
- `--primary.*oklch` → IPODhan Gold Standard colors
- `--gradient-premium|--gradient-dark|--gradient-shimmer` → Gradient system
- `animate-shimmer|@keyframes shimmer` → Micro-interactions

**Test Reports (use Glob):**
- `docs/19-ui/reports/phase-1-color-contrast-wcag-aa-test.md`
- `docs/19-ui/reports/phase-1-responsive-typography-validation.md`
- `docs/19-ui/reports/phase-1-animation-performance-test.md`
- `docs/19-ui/reports/phase-1-cross-browser-testing.md`

**Calculate Phase 1 Progress:** X/19 tasks complete

---

### Phase 2: Data Intelligence Surface

**Check for existence:**
- D3.js installation: `Grep: "d3"|"@types/d3"` in `package.json`
- `**/ScoreBreakdown.tsx` or `**/IPOScoreBreakdown.tsx`
- `**/visualization/SectorHeatMap.tsx`
- `**/visualization/CorrelationMatrix.tsx`
- `**/visualization/PredictiveMeter.tsx`
- `**/visualization/TimeSeriesPlayback.tsx`
- `**/ScoreRangeFilter.tsx` or `**/ScoreSlider.tsx`

**Check D3.js config:**
- `next.config.js` → Check for code splitting config

**Calculate Phase 2 Progress:** X/8 tasks complete

---

### Phase 3: Real-Time Experience

**Check for existence:**
- `**/websocket*.ts` or `**/lib/websocket/**` (exclude node_modules)
- `**/use-live-updates.ts` or `**/hooks/use-websocket.ts`
- `**/LiveSubscriptionTracker.tsx`
- `**/LiveGMPTicker.tsx`
- `**/ViewerCount.tsx`
- `**/MarketPulse.tsx` or `**/dashboard/MarketPulse.tsx`
- `**/HotRightNow.tsx`
- `**/SmartFilters.tsx` or `**/VisualFilterBuilder.tsx`

**Calculate Phase 3 Progress:** X/8 tasks complete

---

### Phase 4: Mobile Excellence

**Check for existence:**
- `**/BottomNav*.tsx` or `**/mobile/BottomNav.tsx`
- Gesture library: `Grep: "@use-gesture/react|react-use-gesture"` in `package.json`
- `**/use-gestures.ts` or `**/hooks/use-touch-gestures.ts`
- PWA: `public/manifest.json` (use Read to check if exists)
- Service worker: `**/sw.ts` or `**/service-worker.ts`

**Check globals.css for mobile optimizations:**
- `Grep: "min-height.*44px|touch-target"` in globals.css

**Calculate Phase 4 Progress:** X/8 tasks complete

---

### Phase 5: Personalization Engine

**Check for existence:**
- `**/personalization/user-profile.ts`
- `**/personalization/behavior-tracker.ts`
- `**/ForYouSection.tsx` or `**/intelligence/ForYouSection.tsx`
- `**/SmartFilters.tsx` or `**/intelligence/SmartDefaults.tsx`
- `**/SuggestedComparisons.tsx`
- `**/use-keyboard-shortcuts.ts` or `**/hooks/use-hotkeys.ts`
- `**/MultiSelectCard.tsx` or `**/BulkActions.tsx`
- `**/CSVExporter.tsx` or `**/ExportButton.tsx`

**Calculate Phase 5 Progress:** X/8 tasks complete

---

## Step 3: Generate Comprehensive Status Report

Create a detailed status report in markdown:

```markdown
# IPODhan UX Transformation - Current Implementation Status

**Assessment Date:** [YYYY-MM-DD]
**Last Session:** [Get from git log or previous reports]
**Total Progress:** XX/51 tasks (YY%) across 5 phases

---

## Overall Progress

**Phases:**
- Phase 1: [COMPLETE / IN_PROGRESS / NOT_STARTED] - XX%
- Phase 2: [COMPLETE / IN_PROGRESS / NOT_STARTED] - XX%
- Phase 3: [COMPLETE / IN_PROGRESS / NOT_STARTED] - XX%
- Phase 4: [COMPLETE / IN_PROGRESS / NOT_STARTED] - XX%
- Phase 5: [COMPLETE / IN_PROGRESS / NOT_STARTED] - XX%

**Next Milestone:** [Identify next incomplete phase]

---

## Phase 1: Visual Identity Revolution (Weeks 1-2)
**Status:** [COMPLETE / IN_PROGRESS / NOT_STARTED]
**Progress:** XX/19 tasks (XX%)

### ✅ Completed:
[List with file paths and line counts]

### 🚧 In Progress:
[List partially complete tasks]

### ❌ Not Started:
[List tasks not yet begun]

**Files Created:** X
**Files Modified:** Y
**Lines Added:** +XXX

**Quality Metrics:**
- Bundle size: +XXkb (target: <50KB) [✅/⚠️/❌]
- WCAG AA: [✅/⚠️/❌]
- Performance: [✅/⚠️/❌]
- Cross-browser: [✅/⚠️/❌]

---

## Phase 2: Data Intelligence Surface (Weeks 3-5)
[Same structure]

---

## Phase 3: Real-Time Experience (Weeks 6-7)
[Same structure]

---

## Phase 4: Mobile Excellence (Weeks 8-9)
[Same structure]

---

## Phase 5: Personalization Engine (Weeks 10-12)
[Same structure]

---

## Critical Blockers

[List any blocking issues discovered]

---

## Recommendations

1. [Next steps based on status]
2. [Any architectural concerns]
3. [Performance considerations]

---

**Status Report Generated by:** Claude Code
**Ready for:** TODO Creation & User Approval
```

---

## Step 4: Create Dynamic TODO List

**⚠️ CRITICAL: Identify the NEXT INCOMPLETE PHASE only**

### Rules:
1. **Focus on ONE phase at a time** - Don't create TODOs for all phases
2. **Mark completed tasks as "completed"** based on status check
3. **Order by dependency** (foundational → advanced → testing)
4. **Include file paths and estimates**
5. **If all phases complete:** Suggest next steps (optimization, Phase 6 planning)

### TODO Template:

```typescript
TodoWrite({
  todos: [
    {
      content: "[Task description with file path]",
      activeForm: "[Present continuous form]",
      status: "completed" | "pending"
    },
    // ... all tasks for current phase

    // Always end with testing tasks
    {
      content: "Test [feature] across browsers",
      activeForm: "Testing [feature]",
      status: "pending"
    }
  ]
});
```

### Phase-Specific TODO Lists

#### Phase 1: Visual Identity (19 tasks)
1. Implement color palette in globals.css
2. Add gradient system
3. Configure Instrument Serif font
4. Configure Inter font
5. Configure JetBrains Mono font
6. Implement typography scale
7. Create IPOCardEnhanced Layer 1
8. Add status dot indicators
9. Create mini progress bar
10. Implement Layer 2 hover state
11. Add magnetic cursor hover
12. Implement card lift animation
13. Create shimmer effect
14. Build AnimatedScore component
15. Create GMPSparkline component
16. Build CompactSubscriptionBreakdown
17. Create QuickStatsGrid
18. Add use-count-up hook
19. Create use-magnetic-hover hook
20. Test color contrast (WCAG AA)
21. Validate responsive typography
22. Performance test animations (60fps)
23. Cross-browser testing

#### Phase 2: Data Intelligence (15 tasks)
1. Install D3.js and @types/d3
2. Configure code splitting in next.config.js
3. Create ScoreBreakdown radar chart component
4. Build SectorHeatMap (D3.js)
5. Implement CorrelationMatrix (D3.js scatter plot)
6. Create PredictiveMeter gauge (D3.js arc)
7. Build TimeSeriesPlayback with controls
8. Implement contextual tooltips system
9. Add sector average comparisons
10. Create percentile ranking badges
11. Build score range filter slider (7-10)
12. Add confidence badge with explanations
13. Test D3.js performance (<500ms render)
14. Verify chart interactivity (click, hover, zoom)
15. Cross-browser test D3.js rendering

#### Phase 3: Real-Time Experience (12 tasks)
1. Create WebSocket client service
2. Implement reconnection logic (exponential backoff)
3. Create use-live-updates React hook
4. Build LiveSubscriptionTracker widget
5. Create LiveGMPTicker component
6. Implement ViewerCount widget ("X investors viewing")
7. Build MarketPulse dashboard (4 live metrics)
8. Create HotRightNow algorithm section
9. Implement VisualFilterBuilder (chips, sliders)
10. Add saved filter presets (localStorage)
11. Test WebSocket stability (connection drops)
12. Performance test (handle 100+ concurrent updates)

#### Phase 4: Mobile Excellence (10 tasks)
1. Install @use-gesture/react library
2. Create BottomNav component (5 tabs)
3. Implement use-gestures hook
4. Add swipe left/right handlers
5. Create pull-to-refresh gesture
6. Implement pinch-to-zoom for charts
7. Add long-press context menu
8. Create PWA manifest.json (icons, theme)
9. Build service worker (sw.ts) with offline support
10. Validate touch targets (all ≥44px)

#### Phase 5: Personalization (14 tasks)
1. Create user-profile.ts (localStorage schema)
2. Implement behavior-tracker.ts (view tracking)
3. Build ForYouSection component
4. Create ML recommendation algorithm
5. Implement SmartDefaultFilters
6. Build SuggestedComparisons widget
7. Install react-hotkeys-hook library
8. Create use-keyboard-shortcuts hook
9. Implement shortcuts (/, c, s, f, ?, Esc)
10. Build MultiSelectCard component
11. Create CSVExporter component
12. Add bulk action handlers
13. Test recommendation accuracy
14. Privacy compliance check (GDPR, no PII)

---

## Step 5: Present Plan & Wait for Approval

**⚠️ STOP HERE - DO NOT IMPLEMENT ⚠️**

Present this to the user:

```markdown
# IPODhan UX Transformation - Ready to Resume

## Current Status Summary

[Paste key findings from Step 3]

**Overall Progress:** XX% (YY/51 tasks)
**Current Phase:** Phase X ([PHASE_NAME])
**Completion:** [COMPLETE / IN_PROGRESS / NOT_STARTED]

---

## Proposed Next Steps

**Target:** Phase X - [PHASE_NAME]
**Tasks Remaining:** XX tasks
**Estimated Duration:** X hours/days
**Complexity:** [Low/Medium/High]

**Key Features:**
- [Feature 1]
- [Feature 2]
- [Feature 3]

---

## TODO List Created

✅ TODO list with XX tasks:
- XX tasks marked as completed
- YY tasks pending
- Ordered by dependency

---

## Approval Options

### Option 1: Continue with Phase X ✅ Recommended
Implement all pending tasks in Phase X, with:
- Real-time TODO updates
- Progress reports after each task
- Testing and validation

**Benefits:**
- [Benefit 1]
- [Benefit 2]

### Option 2: Skip to Different Phase
Specify which phase to prioritize:
- Phase 1: Visual Identity
- Phase 2: Data Intelligence
- Phase 3: Real-Time Experience
- Phase 4: Mobile Excellence
- Phase 5: Personalization

### Option 3: Custom Scope
Specify custom tasks:
- Example: "Only implement D3.js visualizations from Phase 2"
- Example: "Add PWA support from Phase 4"

### Option 4: Review Only
- Generate status report only
- No implementation

---

## 🎯 APPROVAL REQUIRED

Please respond with:
- **"Approve Phase X"** to start (recommended)
- **"Skip to Phase Y"** to change focus
- **"Custom: [specify]"** for custom scope
- **"Review only"** for no implementation

Once approved, I will:
1. ✅ Mark first task as in_progress
2. 🔨 Implement following architectural patterns
3. ✅ Mark as completed immediately after finishing
4. ➡️ Move to next task
5. 📊 Provide progress updates throughout
6. 🧪 Run tests at the end

---

**Performance Budget Tracking:**
- Current: [+XXkb]
- Phase Budget: [XXkb]
- Total Budget: 310KB (5 phases)
- Remaining: [XXXkb]

---

**Ready to proceed upon your approval!** 🚀
```

---

## Step 6: Implementation Execution (After Approval)

### 6.1 Task Execution Loop

**For each pending task:**

1. **Update TODO:** Mark current task as `in_progress`

2. **Implement:**
   - Read relevant existing files
   - Make changes following patterns:
     - Repository: Extend BaseRepository, use cache-aside
     - Service: Use repositories directly, never HTTP
     - Components: TypeScript, proper typing
     - Hooks: Custom hooks for reusable logic
     - Styles: Use CSS variables, OKLCH colors
   - Follow architectural rules from CLAUDE.md

3. **Verify:**
   - TypeScript check: `npx tsc --noEmit` (for critical errors only)
   - ESLint check (if relevant)
   - Visual verification (if UI component)

4. **Update TODO:** Mark task as `completed` IMMEDIATELY

5. **Report Progress:**
   ```
   ✅ Task X completed: [Description]
   - Files: [List files and line counts]
   - Next: Task X+1
   - Progress: XX/YY (ZZ%)
   ```

6. **Move to next task**

### 6.2 Progress Checkpoints

**Every 5 tasks:**
```
📊 Checkpoint: XX/YY tasks (ZZ%)
⏱️ Time: X hours elapsed
📦 Bundle: +XXkb
⚠️ Blockers: None / [List]
```

**On Errors:**
```
⚠️ Blocker: [Description]
Impact: [High/Medium/Low]
Attempted: [What was tried]
Need: [User input / Alternative approach]
```

### 6.3 Phase Completion

After all tasks complete:

```markdown
## Phase X Complete! 🎉

**Duration:** X hours
**Tasks:** XX/XX (100%)
**Files Created:** X
**Files Modified:** Y
**Lines Added:** +XXX

**Achievements:**
- [Achievement 1]
- [Achievement 2]

**Performance:**
- Bundle: +XXkb ✅ Within budget
- LCP: X.Xs ✅ Target <2.5s
- Animations: 60fps ✅

**Quality:**
- WCAG AA: ✅
- Responsive: ✅
- Cross-browser: ✅
- Tests: ✅

**Next:** Phase X+1 - [NAME]
```

---

## Step 7: Quality Assurance

After phase completion:

### Build Check
```bash
cd web && npx tsc --noEmit 2>&1 | head -50
```

**Look for:**
- New errors in implemented files
- Type errors
- Import errors

**If errors found:**
- Fix critical errors
- Document non-critical warnings

### Lint Check (Optional)
```bash
cd web && npm run lint 2>&1 | grep -E "(error|warn)" | head -20
```

### Performance Check

**Bundle Size:**
```bash
# Check if build succeeds
cd web && npm run build 2>&1 | tail -20
```

**Visual Verification:**
- If dev server running: Verify at http://localhost:3000
- Check implemented features visually
- Test interactions (hover, click, animations)

---

## Step 8: Documentation

Create implementation report:

**File:** `docs/19-ui/reports/phase-X-implementation-report.md`

```markdown
# Phase X Implementation Report

**Completion Date:** YYYY-MM-DD
**Duration:** X hours
**Quality Score:** X/10

## Implemented Features
1. [Feature] - [Files] - [Description]
2. [Feature] - [Files] - [Description]

## Technical Details
- Dependencies added: [List]
- Bundle impact: +XXkb
- Performance: [Metrics]

## Testing Results
- [Test type]: ✅/❌
- [Test type]: ✅/❌

## Known Issues
- [Issue 1]
- [Issue 2]

## Next Steps
- [Prerequisite for next phase]
```

---

## Emergency Procedures

### If Build Fails

1. **Check error message:**
   - TypeScript error → Fix types
   - Import error → Check paths
   - Dependency error → Install missing

2. **Revert if needed:**
   ```bash
   git status
   git diff [file]
   git restore [file] # Only if necessary
   ```

3. **Document blocker:**
   - Update TODO (mark as blocked)
   - Ask user for guidance
   - Provide error details

4. **Continue with non-blocked tasks** (if possible)

---

## Best Practices

### DO:
- ✅ Read existing files before modifying
- ✅ Follow architectural patterns from CLAUDE.md
- ✅ Update TODO status religiously
- ✅ Test incrementally
- ✅ Provide live status updates
- ✅ Ask questions when unclear
- ✅ Use cache key generators
- ✅ Extend BaseRepository
- ✅ Use OKLCH colors
- ✅ Validate TypeScript compiles

### DON'T:
- ❌ Skip status detection (Step 2)
- ❌ Start without approval (Step 5)
- ❌ Batch TODO updates (update after each task)
- ❌ Hardcode cache keys
- ❌ Use HTTP calls in services
- ❌ Skip testing
- ❌ Ignore accessibility
- ❌ Forget to update documentation

---

## Usage Examples

### Example 1: Starting Fresh
```
User: "Continue UX transformation"
Claude:
  → Runs status check
  → Finds: Phase 1 not started
  → Creates Phase 1 TODO (19 tasks)
  → Presents plan
  → Waits for: "Approve Phase 1"
  → Begins implementation
```

### Example 2: Resuming Phase 1 (50% done)
```
User: "Continue where we left off"
Claude:
  → Runs status check
  → Finds: Phase 1 at 10/19 tasks
  → Creates TODO with 10 completed, 9 pending
  → Presents: "Resume Phase 1 (9 tasks remaining)"
  → Waits for approval
```

### Example 3: Phase 1 Complete, Start Phase 2
```
User: "Continue"
Claude:
  → Runs status check
  → Finds: Phase 1 100%, Phase 2 0%
  → Creates Phase 2 TODO (15 tasks)
  → Presents: "Phase 1 ✅ Complete. Start Phase 2?"
  → Waits for approval
```

### Example 4: All Phases Complete
```
User: "Continue"
Claude:
  → Runs status check
  → Finds: All phases 100%
  → Reports: "All 5 phases complete! 🎉"
  → Suggests: Optimizations, Phase 6 planning, deployment
```

---

## Success Criteria

Implementation successful when:

- ✅ Status accurately detected
- ✅ TODO list matches actual remaining work
- ✅ All tasks completed or blocked with reason
- ✅ TypeScript compiles (no critical errors)
- ✅ Performance budget maintained
- ✅ Accessibility preserved (WCAG AA)
- ✅ Documentation updated
- ✅ User approved before starting
- ✅ Real-time progress updates provided

---

## Notes for Claude

1. **Always start with Step 1-2** (status detection)
2. **Never skip Step 5** (user approval required)
3. **Update TODO after EACH task** (not batched)
4. **Provide live updates** (every task)
5. **Follow architectural patterns** (CLAUDE.md)
6. **Test incrementally** (don't wait until end)
7. **Ask when uncertain** (don't guess)
8. **Track performance budget** (report on each update)
9. **Maintain accessibility** (WCAG AA throughout)
10. **Document as you go** (reports after phase)

---

**This prompt is stateful and resumable across sessions.**

**Version:** 2.0
**Created:** November 2024
**Last Updated:** November 2024
**Purpose:** Multi-session UX implementation with approval workflow
