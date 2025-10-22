# Cache Management Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ADMIN SETTINGS PAGE                          │
│                   (/admin/settings/page.tsx)                        │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ HTTP Requests
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     CACHE MANAGEMENT API                            │
│               (/api/admin/cache/clear/route.ts)                     │
│                                                                     │
│  ┌─────────────────┐          ┌─────────────────┐                 │
│  │   GET Handler   │          │  POST Handler   │                 │
│  │                 │          │                 │                 │
│  │ - Statistics    │          │ - Clear Pattern │                 │
│  │ - Memory Usage  │          │ - Clear All     │                 │
│  └─────────────────┘          └─────────────────┘                 │
│           │                            │                           │
│           └────────────┬───────────────┘                           │
│                        │                                           │
│                ┌───────▼────────┐                                  │
│                │ withAdminAuth  │                                  │
│                │  Middleware    │                                  │
│                └───────┬────────┘                                  │
│                        │                                           │
└────────────────────────┼───────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       REDIS CLIENT SINGLETON                        │
│                  (/lib/cache/redis-client.ts)                       │
│                                                                     │
│  getRedisClient() → Returns Redis instance                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                         │
                         │ Redis Commands
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           REDIS SERVER                              │
│                                                                     │
│  Cache Storage (Key-Value Store)                                   │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │ protection:field:123   → { isProtected: true }           │     │
│  │ protection:ipo:456     → { scraperLocked: true }         │     │
│  │ ipo:slug:xyz           → { id: "1", name: "XYZ Corp" }   │     │
│  │ ipo:id:123             → { ... }                         │     │
│  │ subscription:latest:1  → { overall: 2.5 }                │     │
│  │ gmp:latest:1           → { gmp: 50 }                     │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Request Flow

### 1. Get Cache Statistics (GET)

```
User clicks "Refresh Stats"
         │
         ▼
┌────────────────────────────────┐
│ Frontend (React)               │
│ - fetchCacheStats()            │
│ - setIsLoadingStats(true)      │
└────────────────────────────────┘
         │
         │ fetch('/api/admin/cache/clear', {
         │   headers: { Authorization: 'Bearer TOKEN' }
         │ })
         ▼
┌────────────────────────────────┐
│ API Route Handler (GET)        │
│ 1. withAdminAuth middleware    │
│    - Verify token              │
│    - Extract admin context     │
│ 2. getRedisClient()            │
│ 3. Execute Redis commands:     │
│    - DBSIZE                    │
│    - INFO memory               │
│    - KEYS protection:*         │
│    - KEYS ipo:*                │
│    - KEYS subscription:*       │
│    - KEYS gmp:*                │
│ 4. Calculate breakdown         │
│ 5. Log operation               │
└────────────────────────────────┘
         │
         │ Return JSON
         ▼
┌────────────────────────────────┐
│ Frontend (React)               │
│ - setCacheStats(data)          │
│ - setIsLoadingStats(false)     │
│ - Render statistics            │
└────────────────────────────────┘
```

### 2. Clear Cache (POST)

```
User clicks "Clear IPO Caches"
         │
         ▼
┌────────────────────────────────┐
│ Frontend (React)               │
│ - openConfirmDialog()          │
│   - title: "Clear IPO Caches"  │
│   - pattern: "ipo:*"           │
│   - keyCount: 890              │
└────────────────────────────────┘
         │
User clicks "Clear Cache" button
         │
         ▼
┌────────────────────────────────┐
│ Frontend (React)               │
│ - handleClearCache()           │
│ - setIsClearing(true)          │
└────────────────────────────────┘
         │
         │ fetch('/api/admin/cache/clear', {
         │   method: 'POST',
         │   body: JSON.stringify({ pattern: "ipo:*" })
         │ })
         ▼
┌────────────────────────────────┐
│ API Route Handler (POST)       │
│ 1. withAdminAuth middleware    │
│ 2. Validate request body       │
│    - pattern OR clearAll       │
│ 3. getRedisClient()            │
│ 4. Find matching keys:         │
│    - redis.keys(pattern)       │
│ 5. Delete keys:                │
│    - redis.del(...keys)        │
│ 6. Log operation with count    │
└────────────────────────────────┘
         │
         │ Return JSON
         │ { success: true, keysCleared: 890 }
         ▼
┌────────────────────────────────┐
│ Frontend (React)               │
│ - showNotification('success')  │
│ - closeConfirmDialog()         │
│ - fetchCacheStats() [refresh]  │
│ - setIsClearing(false)         │
└────────────────────────────────┘
```

## Component Structure

```
AdminSettingsPage
│
├── State
│   ├── cacheStats: CacheStats | null
│   ├── isLoadingStats: boolean
│   ├── isClearing: boolean
│   ├── notification: { type, message } | null
│   └── confirmDialog: { isOpen, title, message, pattern, clearAll }
│
├── Effects
│   └── useEffect(() => fetchCacheStats(), [])
│
├── Functions
│   ├── fetchCacheStats()      → GET /api/admin/cache/clear
│   ├── handleClearCache()     → POST /api/admin/cache/clear
│   ├── openConfirmDialog()    → Set dialog state
│   ├── closeConfirmDialog()   → Reset dialog state
│   └── showNotification()     → Toast with auto-hide
│
└── UI Components
    ├── Header
    ├── Notification Toast (conditional)
    ├── Confirm Dialog (conditional)
    └── Cache Management Section
        ├── Statistics Dashboard
        │   ├── Total Keys (large number)
        │   ├── Memory Usage (formatted)
        │   └── Key Breakdown Table
        │       ├── Protection count
        │       ├── IPO count
        │       ├── Subscription count
        │       ├── GMP count
        │       └── Other count
        └── Cache Actions (3 cards)
            ├── Clear Protection
            │   └── Button → openConfirmDialog('protection:*')
            ├── Clear IPO
            │   └── Button → openConfirmDialog('ipo:*')
            └── Clear All
                └── Button → openConfirmDialog(clearAll: true)
```

## Data Flow Diagram

```
┌─────────────┐
│  Component  │
│   Mount     │
└──────┬──────┘
       │
       │ useEffect
       ▼
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│ Fetch Stats │─────▶│  API Route   │─────▶│   Redis     │
│             │◀─────│  (GET)       │◀─────│   Server    │
└─────────────┘      └──────────────┘      └─────────────┘
       │
       │ Update State
       ▼
┌─────────────┐
│   Render    │
│ Statistics  │
└─────────────┘
       │
       │ User Action
       ▼
┌─────────────┐
│   Show      │
│ Confirm     │
│  Dialog     │
└──────┬──────┘
       │
       │ User Confirms
       ▼
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│ Clear Cache │─────▶│  API Route   │─────▶│   Redis     │
│   Request   │      │  (POST)      │      │   Server    │
│             │      │  - Find Keys │      │  - Delete   │
│             │◀─────│  - Delete    │◀─────│   Keys      │
└─────────────┘      └──────────────┘      └─────────────┘
       │
       │ Success Response
       ▼
┌─────────────┐      ┌──────────────┐
│   Show      │      │   Refresh    │
│ Notification│      │  Statistics  │
└─────────────┘      └──────────────┘
```

## Cache Key Patterns

```
Redis Key Namespace Hierarchy

root (*)
├── protection:*
│   ├── protection:field:{ipoId}:{tableName}:{fieldName}
│   ├── protection:ipo:{ipoId}
│   └── protection:fields:{ipoId}
│
├── ipo:*
│   ├── ipo:slug:{slug}
│   ├── ipo:id:{id}
│   ├── ipo:detail:{slug}
│   ├── ipo:list:{filterHash}
│   ├── ipo:search:{queryHash}
│   └── ipo:fuzzy:{queryHash}
│
├── subscription:*
│   ├── subscription:latest:{ipoId}
│   └── subscription:history:{ipoId}:{days}
│
├── gmp:*
│   ├── gmp:latest:{ipoId}
│   └── gmp:history:{ipoId}:{days}
│
└── other:*
    ├── score:{ipoId}
    ├── peers:{ipoId}
    ├── financial:{ipoId}
    ├── documents:{ipoId}
    ├── listing:{ipoId}
    └── calendar:*
```

## Security Flow

```
┌──────────────┐
│   Request    │
│ with Bearer  │
│    Token     │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────┐
│   withAdminAuth Middleware   │
│                              │
│  1. Check ADMIN_PANEL_ENABLED│
│  2. Extract token from header│
│  3. Verify against env token │
│  4. Create admin context     │
└──────┬───────────────────────┘
       │
       ├─── Valid Token ───▶ Continue to Handler
       │
       └─── Invalid ───▶ Return 401 Unauthorized
```

## Error Handling Flow

```
API Request
    │
    ▼
Try {
    │
    ├─ Authenticate ──────────▶ 401 if fails
    │
    ├─ Validate Input ────────▶ 400 if invalid
    │
    ├─ Execute Redis Command
    │       │
    │       ├─ Connection Error ──▶ 500 with details
    │       │
    │       └─ Success ────────────▶ Continue
    │
    └─ Return Response
}
Catch {
    │
    └─ Log Error ──────────────▶ 500 Generic Error
}
```

## Performance Optimization

```
┌───────────────┐
│  User Request │
└───────┬───────┘
        │
        ▼
┌───────────────────────────────┐
│   API Route Handler           │
│                               │
│   OPTIMIZATION POINTS:        │
│                               │
│   1. Redis Connection Pool    │
│      - Singleton pattern      │
│      - Reuse connections      │
│                               │
│   2. Efficient Commands       │
│      - DBSIZE (O(1))         │
│      - INFO (O(1))           │
│      - KEYS (O(n)) ⚠️        │
│      - DEL (O(n))            │
│                               │
│   3. Batch Operations         │
│      - del(...keys) not loop  │
│                               │
│   4. Logging                  │
│      - Async, non-blocking    │
└───────────────────────────────┘
```

## Testing Architecture

```
Integration Test Suite
├── GET Endpoint Tests
│   ├── Returns statistics when authenticated
│   ├── Rejects unauthenticated requests
│   └── Validates response structure
│
├── POST Endpoint Tests
│   ├── Clears by pattern
│   ├── Clears all when clearAll=true
│   ├── Validates request body
│   ├── Handles empty results
│   └── Rejects unauthenticated requests
│
└── Integration Scenarios
    └── Statistics reflect changes after clear
```

---

**Last Updated:** 2025-10-22
**Status:** ✅ Production Ready
