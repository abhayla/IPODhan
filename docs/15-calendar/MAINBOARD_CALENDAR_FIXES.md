# Mainboard IPO Calendar - Implementation Documentation

**Date**: 2025-11-15
**Status**: Moved to Planning Folder

---

## 📋 Current Implementation Plan

This document has been migrated to the planning folder for better organization.

**Active Plan**: [`docs/01-planning/Plan-Calendar-Fixes-2025-11-15-v1.md`](../01-planning/Plan-Calendar-Fixes-2025-11-15-v1.md)

---

## Quick Summary

The Mainboard IPO Calendar has critical UX issues:
- Both desktop and mobile views rendering simultaneously
- 614 events in November 2025 all fully expanded (no event limiting)
- Calendar cells 500-800px tall (unusable)
- No event grouping or "+X more" buttons

**Priority**: P0 CRITICAL - Production Blocker
**Estimated Fix Time**: 1.75 hours

See the full implementation plan in the link above.

---

## Calendar Feature Documentation

For general calendar feature documentation, architecture, and implementation details, see:

- **Service Layer**: `web/lib/services/mainboard-calendar-service.ts`
- **Component**: `web/components/calendar/MainboardIPOCalendarGrid.tsx`
- **CSS Module**: `web/components/calendar/MainboardIPOCalendarGrid.module.css`
- **Repository Pattern**: `docs/02-architecture/backend-architecture.md`
- **Caching Strategy**: `docs/05-caching/CACHING_STRATEGY.md`

---

**Last Updated**: 2025-11-15
