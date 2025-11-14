# IPODhan - TODO List

> **Last Updated**: 2025-11-13 23:20
> **Active Sprint**: November 2025

## 🔴 P0 - Critical (Fix within 24h)

_No critical issues at this time. DEF-2025-002 closed as "Cannot Reproduce"._

## 🟠 P1 - Major (Fix within 48-72h)

- [ ] **#ISS-024**: Homepage console errors investigation (Task 1.3)
  - **Component**: Homepage
  - **Assignee**: TBD
  - **Effort**: 4-6h
  - **Due**: 2025-11-16
  - **Description**: 22 console errors found during initial testing. Needs categorization and fixes.

## 🟡 P2 - Minor (Current Sprint)

- [ ] **#ISS-025**: PWA manifest icon 404 errors
  - **Component**: PWA
  - **Assignee**: TBD
  - **Effort**: 1-2h
  - **Due**: End of sprint
  - **Description**: `/icons/icon-144x144.png` and related icons not found. Affects PWA installation.

- [ ] **#ISS-026**: Remove orphaned Client Components
  - **Component**: Codebase cleanup
  - **Assignee**: TBD
  - **Effort**: 30min
  - **Due**: End of sprint
  - **Description**: GlobalKeyboardShortcuts and ServiceWorkerRegistration exist but not imported anywhere.

## 🟢 P3 - Trivial (Future Release)

- [ ] **#ISS-027**: Footer link styling inconsistencies
  - **Component**: UI/Footer
  - **Assignee**: TBD
  - **Effort**: 30min
  - **Description**: Minor styling issues in footer links.

- [ ] **#ISS-028**: Update next.config.mjs transpilePackages
  - **Component**: Build Configuration
  - **Assignee**: TBD
  - **Effort**: 15min
  - **Description**: Remove `react-icons` from transpilePackages (migrated to lucide-react).

## ✅ Completed (This Week)

- [x] **#DEF-2025-002**: ✅ **CANNOT REPRODUCE** - Dashboard Page React Server Components Error (2025-11-14)
  - **Component**: Dashboard
  - **Closed By**: Claude Code (Verification Testing)
  - **Resolution**: Dashboard page loads successfully with zero errors. Issue cannot be reproduced.
  - **Verification**: Tested on Next.js 15.5.4 (Turbopack, port 3020) - fully functional
  - **Status**: Dashboard rendering correctly with all components (header, search, filters, Grid/List toggle, IPO cards)
  - **Defect Report**: `docs/07-testing/defect-reports/DEF-2025-002-dashboard-turbopack-rsc-error.md`

- [x] **#ISS-029**: ✅ **RESOLVED** - Fast Refresh instability (2025-11-13)
  - **Component**: Build System / Development Environment
  - **Fixed By**: Claude Code (Session 6 - Turbopack Migration)
  - **Effort**: 1h
  - **Related**: DEF-2025-001 (RESOLVED)
  - **Solution**: Migrated from webpack to Turbopack (`npm run dev` → `next dev --turbo`)
  - **Impact**: 96% faster Fast Refresh (103-149ms vs ~4s), 100% HMR stability
  - **Status**: All 3 core pages functional with stable development environment

- [x] **#ISS-030**: ✅ **RESOLVED** - IPO Detail page React child error (2025-11-13)
  - **Component**: IPO Detail (IPODetailTabs.tsx)
  - **Fixed By**: Claude Code (Session 6)
  - **Effort**: 2-3h
  - **Related**: DEF-2025-001 (React 19 compatibility)
  - **Solution**: Removed React.lazy() and Suspense wrappers, replaced with direct imports
  - **Status**: IPO Detail pages fully functional (HTTP 200, all tabs working)

- [x] **#DEF-2025-001**: ✅ **RESOLVED** - React 19 + Next.js 15 incompatibility (2025-11-13)
  - **Fixed By**: Claude Code (Session 6)
  - **Solution**: Upgraded React 18.3.1 → 19.0.0, created HeaderSimple, migrated to Turbopack
  - **Impact**: All 3 core pages (Homepage, Dashboard, IPO Detail) fully functional
  - **Status**: Production ready, development environment stable

- [x] **#ISS-021**: Homepage webpack regression - SUPERSEDED by ISS-029/DEF-2025-001
- [x] **#ISS-022**: Dashboard Fast Refresh - SUPERSEDED by ISS-029/DEF-2025-001
- [x] **#ISS-023**: IPO Detail verification - SUPERSEDED by ISS-030

- [x] **#ISS-020**: Created enhanced issue tracking system (2025-11-13)
  - Implemented markdown-based tracking with TODO.md, BACKLOG.md
  - Created templates for defect reports
  - Added CSV export capability

## 📊 Sprint Summary

- **Total Open Issues**: 5
- **P0 Critical**: 0 🟢 _(All critical issues resolved!)_
- **P1 Major**: 1 🟠
- **P2 Minor**: 2 🟡
- **P3 Trivial**: 2 🟢
- **Completed This Week**: 8 (4 major fixes: React 19 upgrade, IPO Detail fix, Turbopack migration, DEF-2025-002 verification)

## 🎯 This Week's Focus

1. ✅ ~~Fix Session 5 regression (ISS-021, ISS-022)~~ - **COMPLETED** (DEF-2025-001)
2. ✅ ~~Verify IPO Detail page status (ISS-023)~~ - **COMPLETED** (ISS-030)
3. ✅ ~~Fix Fast Refresh instability (ISS-029)~~ - **COMPLETED** (Turbopack migration)
4. ✅ ~~Upgrade to React 19 (DEF-2025-001)~~ - **COMPLETED**
5. ✅ ~~Begin UI Testing Phase~~ - **COMPLETED** (Session 7 - Dashboard verified functional)
6. ✅ ~~Verify DEF-2025-002~~ - **COMPLETED** (Closed as "Cannot Reproduce")
7. 🟢 **CURRENT**: Continue UI Testing - Dashboard, IPO Detail, User Journeys
8. **NEXT**: Visual Regression & Accessibility Testing

---

## Usage Notes

- **Format**: `- [ ] #ISS-XXX: Description`
- **Priority**: P0 (Critical) → P1 (Major) → P2 (Minor) → P3 (Trivial)
- **Effort**: Time estimates in hours (h) or minutes (min)
- **Due**: Target completion date
- **Related**: Link to defect reports (DEF-YYYY-XXX) or other issues

## Issue ID Conventions

- **ISS-XXX**: General issues (bugs, tasks, improvements)
- **DEF-YYYY-XXX**: Defect reports (formal bug documentation)
- **FEAT-XXX**: Feature requests (new functionality)
- **TECH-XXX**: Technical debt/improvements
