# Icon Migration Mapping: React-Icons → Lucide-React

**Date**: 2025-11-13
**Session**: 5
**Status**: COMPLETE ✅

---

## Context

Migrating from `react-icons` (Heroicons v2 via `hi2` package) to `lucide-react` due to:
- react-icons 5.5.0 incompatible with Next.js 15.5.4 webpack bundler
- react-icons 4.x requires complete icon name mapping (Heroicons v1 vs v2)
- lucide-react is better supported, smaller bundle, used by shadcn/ui

---

## Icon Name Mapping

| React-Icons (hi2) | Lucide-React | Notes |
|-------------------|--------------|-------|
| `HiArrowRight` | `ArrowRight` | ✅ Direct match |
| `HiArrowPath` | `RotateCw` or `RefreshCw` | Circular arrow |
| `HiExclamationTriangle` | `AlertTriangle` | ✅ Direct match |
| `HiHome` | `Home` | ✅ Direct match |
| `HiFunnel` | `Filter` | Funnel/filter icon |
| `HiMagnifyingGlass` | `Search` | Search icon |
| `HiXMark` | `X` | Close icon |
| `HiCursorArrowRays` | `MousePointerClick` | ⚠️ NOT CursorArrowRays |
| `HiUsers` | `Users` | ✅ Direct match |
| `HiCheck` | `Check` | ✅ Direct match |
| `HiClock` | `Clock` | ✅ Direct match |
| `HiBuildingOffice2` | `Building2` or `Building` | Office building |
| `HiArrowTrendingUp` | `TrendingUp` | ✅ Direct match |
| `HiArrowTrendingDown` | `TrendingDown` | ✅ Direct match |
| `HiEllipsisHorizontal` | `MoreHorizontal` | Three dots horizontal |
| `HiSquares2X2` | `Grid2x2` or `LayoutGrid` | Grid view icon |
| `HiListBullet` | `List` | List view icon |
| `HiInbox` | `Inbox` | ✅ Direct match |
| `HiChevronLeft` | `ChevronLeft` | ✅ Direct match |
| `HiChevronRight` | `ChevronRight` | ✅ Direct match |
| `HiChevronDown` | `ChevronDown` | ✅ Direct match |
| `HiChevronUp` | `ChevronUp` | ✅ Direct match |
| `HiCalendar` | `Calendar` | ✅ Direct match |
| `HiCheckCircle` | `CheckCircle2` or `CircleCheck` | Check mark in circle |
| `HiXCircle` | `XCircle` or `CircleX` | X in circle |
| `HiInformationCircle` | `Info` | Info icon |
| `HiExclamationCircle` | `AlertCircle` | Exclamation in circle |

---

## Import Pattern Changes

### Before (React-Icons)
```typescript
import { HiArrowRight, HiMagnifyingGlass } from 'react-icons/hi2';

<HiArrowRight className="h-4 w-4" />
```

### After (Lucide-React)
```typescript
import { ArrowRight, Search } from 'lucide-react';

<ArrowRight className="h-4 w-4" />
```

---

## Migration Strategy

### Phase 1: Homepage Components (Priority)
- [x] `web/components/home/IPOListTable.tsx` - HiArrowRight → ArrowRight
- [x] `web/components/home/UpcomingIPOTable.tsx` - HiArrowRight → ArrowRight

### Phase 2: Bulk Migration (Automated)
- [x] Migrated 122+ files using automated script
- [x] All Hi* icons replaced with lucide-react equivalents
- [x] Import statements updated from react-icons to lucide-react

### Phase 3: Manual Fixes
- [x] `web/components/layout/Footer.tsx` - HiScale → Scale
- [x] `web/components/ipo-detail/IPOObjectivesSection.tsx` - CursorArrowRays → MousePointerClick
- [x] `web/app/about/page.tsx` - CursorArrowRays → MousePointerClick
- [x] Fixed incorrect icon mappings that don't exist in lucide-react

### Phase 4: Cleanup & Verification
- [x] Removed react-icons dependency from package.json
- [x] Verified 0 react-icons imports remaining
- [x] Tested homepage - all icons rendering correctly
- [x] Clean build with no webpack errors

---

## Progress Tracking

- **Total Files**: 122+
- **Completed**: 122+ ✅
- **In Progress**: 0
- **Remaining**: 0

---

## Bulk Migration Script

For remaining files after manual critical path:

```bash
# Backup first
git commit -am "Backup before bulk icon migration"

# Replace common patterns
find web -type f \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i \
  -e "s/from 'react-icons\/hi'/from 'lucide-react'/g" \
  -e "s/from \"react-icons\/hi\"/from \"lucide-react\"/g" \
  -e "s/HiArrowRight/ArrowRight/g" \
  -e "s/HiArrowPath/RotateCw/g" \
  -e "s/HiMagnifyingGlass/Search/g" \
  -e "s/HiXMark/X/g" \
  -e "s/HiExclamationTriangle/AlertTriangle/g" \
  {} +
```

---

**Last Updated**: 2025-11-13
**Migration Complete**: All 122+ files successfully migrated to lucide-react
**react-icons dependency**: Removed from package.json ✅
