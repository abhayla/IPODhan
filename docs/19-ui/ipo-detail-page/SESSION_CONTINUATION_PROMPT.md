# Session Continuation Prompt - IPO Details Page UI/UX Enhancement

## Copy and paste this prompt to continue work in any new session:

---

# Continue IPO Details Page UI/UX Enhancement

I need to continue working on the IPO Details Page UI/UX enhancement for the IPODhan project. The comprehensive plan and documentation are already created in `docs/19-ui/ipo-detail-page/`.

## Project Context
- **Location**: `web/app/ipos/[slug]/page.tsx`
- **Objective**: Transform the current 17+ section page into a modern dashboard with visual data representations
- **Approach**: Hybrid layout with sticky visual dashboard + scrollable detailed content
- **Tech Stack**: Next.js 15.5.4, React 19, Tailwind CSS 4, Recharts for visualizations

## Documentation Files (Already Created)
1. `docs/19-ui/ipo-detail-page/IPO_DETAILS_ENHANCEMENT_PLAN.md` - Main strategic plan with 5 phases
2. `docs/19-ui/ipo-detail-page/IMPLEMENTATION_TRACKER.md` - Progress tracking dashboard
3. `docs/19-ui/ipo-detail-page/UPDATE_PROCESS.md` - Guide for updating documentation
4. `docs/19-ui/ipo-detail-page/GETTING_STARTED.md` - Quick start guide

## Current Status
First, please check the current status by:
1. Reading `IMPLEMENTATION_TRACKER.md` to see which phase we're in
2. Checking the todo list for pending tasks
3. Looking at the most recent phase completion report (if any exist)

## Implementation Phases
- **Phase 1**: Core Infrastructure (Recharts setup, chart components)
- **Phase 2**: Sticky Dashboard (Timeline, key metrics, mini charts)
- **Phase 3**: Main Visualizations (Financial, subscription, performance charts)
- **Phase 4**: Progressive Disclosure (Expand/collapse, data density controls)
- **Phase 5**: Polish & Optimization (Loading states, mobile, performance)

## Key Requirements
1. **Visual Enhancements**:
   - IPO Timeline Widget showing lifecycle stages
   - Financial performance charts (Revenue, Profit, EBITDA trends)
   - Subscription analytics dashboard with category breakdown
   - Post-listing performance charts
   - Demand distribution graph

2. **Data Integration**:
   - Display 80+ currently unmapped database fields
   - Focus on historical performance data (Story 7.10)
   - Advanced subscription breakdowns

3. **UX Improvements**:
   - Reduce visible sections from 17 to 5-7
   - Progressive disclosure for all investor types
   - Mobile-optimized with <50% scroll depth
   - Maintain performance targets (LCP < 2.5s)

## Working Instructions
Please continue from where we left off:
1. Check the current phase status in the tracker
2. Complete any pending tasks from the todo list
3. After completing each component, update the tracker
4. After completing each phase, create a phase report and update the main plan
5. Use the iterative approach - show me the changes after each major step

## Important Architecture Rules
- Use repository pattern (no HTTP API calls from services)
- Database schema only in `packages/shared/src/db/schema.ts`
- Use cache key generators from `web/lib/cache/cache-keys.ts`
- Maintain 3-layer architecture (enforced by ESLint)

## Development Commands
```bash
# Start development server
cd web && npm run dev

# Run tests
npm run test

# Check build
npm run build

# View the IPO details page
# Navigate to: http://localhost:3000/ipos/[any-ipo-slug]
```

## Questions to Answer Before Continuing
1. What phase are we currently in?
2. What was the last completed task?
3. Are there any blockers noted in the tracker?
4. Should we continue with the current phase or start the next one?

Please review the documentation and continue implementation following the established plan. Show me visual updates after each significant change and update the documentation according to the iterative approach defined in `UPDATE_PROCESS.md`.

---

## Additional Context for Claude Code

### File Locations
- **Target Component**: `web/app/ipos/[slug]/page.tsx`
- **New Chart Components**: Create in `web/components/ipo/charts/`
- **Documentation**: `docs/19-ui/ipo-detail-page/`
- **Database Schema**: `packages/shared/src/db/schema.ts`

### Performance Monitoring
After each phase, check:
- Bundle size increase (target: <100KB total)
- LCP (target: <2.5s)
- Component render time (target: <200ms for charts)

### Testing Requirements
- Unit tests for each new chart component
- Integration tests for data transformations
- Visual regression tests for UI changes

### Git Workflow
```bash
# Create feature branch
git checkout -b feature/ipo-details-ui-enhancement-phase-X

# Commit after each component
git add .
git commit -m "feat(ui): add [component-name] to IPO details page"

# After phase completion
git commit -m "feat(ui): complete Phase X - [phase-name]"
```

Please start by checking the current status and then continue with the implementation.