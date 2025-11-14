# Architecture Patterns Expert

**Purpose:** This skill provides expertise in the 3-layer architecture, critical design patterns, and architectural rules enforced in IPODhan. It covers service layer patterns, component boundaries, and ESLint architectural enforcement.

**When to invoke:** Use this skill when architecting new features, fixing architectural violations, conducting code reviews, debugging build errors, or understanding the correct data flow patterns.

---

## 3-Layer Architecture

IPODhan uses a strict 3-layer architecture for backend logic:

```
Layer 1: Presentation     → API Routes, Server Components, Client Components
Layer 2: Business Logic   → Services (orchestration, business rules)
Layer 3: Data Access      → Repositories (database + cache)
```

### Critical Rule: NEVER HTTP in Services

**❌ WRONG Pattern (Will Cause Production Failures):**

```typescript
// Service layer - NEVER DO THIS
import { apiClient } from '@/lib/api-client';

export async function getMainboardIPOs() {
  // ❌ HTTP call from service = ARCHITECTURAL VIOLATION
  const response = await apiClient.get('/api/ipos?segment=MAINBOARD');
  return response.data;
}
```

**✅ CORRECT Pattern:**

```typescript
// Service layer - Always use repositories
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

export async function getMainboardIPOs() {
  // ✅ Direct repository access
  const redis = getRedisClient();
  const ipoRepository = new IPORepository(db, redis);

  return ipoRepository.findAll({
    segment: ['MAINBOARD'],
    status: ['OPEN'],
  });
}
```

### Why This Matters

**History - November 1, 2025 Incident:**

- 9 files violated this pattern
- Used HTTP API calls in services/Server Components
- Caused "Network request failed" errors in production builds
- Server Components tried to fetch from non-existent API during build
- Emergency fix required: Replace all API calls with repositories
- ESLint rules added to prevent future violations

**Key Lesson:** HTTP APIs are for external clients (browser, mobile apps), not internal server-side code.

---

## Data Flow Patterns

### Pattern 1: Server Component → Repository

**Use Case:** Server Component needs data directly

```typescript
// app/ipos/page.tsx - Server Component
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

export default async function IPOsPage() {
  // Direct repository access in Server Component
  const redis = getRedisClient();
  const ipoRepository = new IPORepository(db, redis);

  const ipos = await ipoRepository.findAll({
    status: ['OPEN'],
  });

  return (
    <div>
      {ipos.map(ipo => (
        <IPOCard key={ipo.id} ipo={ipo} />
      ))}
    </div>
  );
}
```

### Pattern 2: Server Component → Service → Repository

**Use Case:** Complex business logic, multiple repositories

```typescript
// lib/services/ipo-service.ts
export async function getIPOWithRelatedData(slug: string) {
  const redis = getRedisClient();
  const ipoRepository = new IPORepository(db, redis);
  const subscriptionRepository = new SubscriptionRepository(db, redis);
  const gmpRepository = new GMPRepository(db, redis);

  // Orchestrate multiple repositories
  const ipo = await ipoRepository.findBySlug(slug);
  if (!ipo) return null;

  const [subscriptions, latestGMP] = await Promise.all([
    subscriptionRepository.findByIPO(ipo.id),
    gmpRepository.getLatest(ipo.id),
  ]);

  return {
    ipo,
    subscriptions,
    latestGMP,
  };
}

// app/ipos/[slug]/page.tsx - Server Component
import { getIPOWithRelatedData } from '@/lib/services/ipo-service';

export default async function IPODetailPage({ params }: { params: { slug: string } }) {
  const data = await getIPOWithRelatedData(params.slug);

  return <IPODetailView data={data} />;
}
```

### Pattern 3: Client Component → API Route → Repository

**Use Case:** Client-side interaction (mutations, dynamic fetches)

```typescript
// app/api/ipos/[id]/route.ts - API Route
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    const ipo = await ipoRepository.findById(params.id);

    if (!ipo) {
      return NextResponse.json(
        { error: 'IPO not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: ipo });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// components/IPOList.tsx - Client Component
'use client';

import { useState, useEffect } from 'react';

export function IPOList() {
  const [ipos, setIpos] = useState([]);

  useEffect(() => {
    // ✅ Client components CAN use HTTP (they run in browser)
    fetch('/api/ipos')
      .then(res => res.json())
      .then(data => setIpos(data.data));
  }, []);

  return (
    <div>
      {ipos.map(ipo => <IPOCard key={ipo.id} ipo={ipo} />)}
    </div>
  );
}
```

---

## Server vs Client Component Boundaries

### Server Components (Default in App Router)

**Characteristics:**
- Run on server only
- No useState, useEffect, event handlers
- Can access databases, file system, environment variables
- Don't send JavaScript to client

**When to Use:**
- Fetching data from database
- Rendering static content
- SEO-critical content
- Sensitive operations (API keys, database access)

**Example:**
```typescript
// Server Component (default)
export default async function IPOPage({ params }: { params: { slug: string } }) {
  // ✅ Direct database access
  const ipo = await getIPOBySlug(params.slug);

  return <IPODetailView ipo={ipo} />;
}
```

### Client Components

**Characteristics:**
- Run on client (browser)
- Can use useState, useEffect, event handlers
- Interactive elements
- Send JavaScript to client

**When to Use:**
- Interactive UI (buttons, forms, modals)
- Client state management
- Browser APIs (localStorage, geolocation)
- Event handlers (onClick, onChange)

**Example:**
```typescript
'use client'; // Mark as client component

import { useState } from 'react';

export function IPOCompareForm() {
  const [selectedIPOs, setSelectedIPOs] = useState<string[]>([]);

  // ✅ Event handlers work in client components
  const handleSelect = (ipoId: string) => {
    setSelectedIPOs(prev => [...prev, ipoId]);
  };

  return (
    <div>
      <button onClick={() => handleSelect('ipo-1')}>
        Compare
      </button>
    </div>
  );
}
```

### Boundary Rules

**✅ Server Component can import:**
- Other Server Components
- Client Components (as children)
- Repositories, services
- Database connections

**✅ Client Component can import:**
- Other Client Components
- API client utilities
- Browser-only libraries

**❌ Client Component CANNOT import:**
- Server-only code (db, repositories marked with 'server-only')
- Node.js built-ins (fs, path)
- Server environment variables

---

## ESLint Architectural Enforcement

IPODhan uses ESLint to automatically prevent architectural violations.

### Rule 1: No API Client in Services

```javascript
// .eslintrc.js
{
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['@/lib/api-client'],
        importNames: ['apiClient'],
        message: 'Services must use repositories directly, not HTTP API calls. Use IPORepository, SubscriptionRepository, etc.'
      }]
    }]
  }
}
```

**What This Does:**
- Prevents importing `@/lib/api-client` in service files
- Shows helpful error message with correction guidance
- Enforced at development and build time

### Rule 2: Server-Only Imports

```javascript
// Mark server-only modules
// web/lib/db/index.ts
import 'server-only';

export { db } from './connection';
export * from '@ipodhan/shared/db/schema';
```

**What This Does:**
- If Client Component tries to import db, build fails
- Error: "You're importing a component that needs 'server-only'"
- Prevents accidental server code in client bundles

### Rule 3: No Async Server Components Without Suspense

```javascript
{
  rules: {
    '@next/next/no-async-client-component': 'error'
  }
}
```

**What This Does:**
- Prevents `async` in Client Components (not supported)
- Ensures proper Suspense boundaries for Server Components

---

## Standard Response Formats

### API Route Success Response

```typescript
return NextResponse.json({
  success: true,
  data: results,
  meta: {
    page: 1,
    limit: 20,
    total: 100,
    hasNext: true,
    hasPrev: false
  }
}, { status: 200 });
```

### API Route Error Response

```typescript
return NextResponse.json({
  error: 'Error message',
  details: 'Additional context',
  code: 'ERROR_CODE'
}, { status: 400 });
```

### Service Layer Return Types

```typescript
// Services return data directly, not HTTP responses
export async function getIPOBySlug(slug: string): Promise<IPO | null> {
  // Returns data or null, not NextResponse
  return ipoRepository.findBySlug(slug);
}

// Services throw errors, don't return error objects
export async function updateIPO(id: string, updates: Partial<IPO>): Promise<IPO> {
  const ipo = await ipoRepository.findById(id);

  if (!ipo) {
    throw new Error('IPO not found'); // Throw, don't return error object
  }

  return ipoRepository.update(id, updates);
}
```

---

## Error Handling Patterns

### Repository Layer

```typescript
export class IPORepository extends BaseRepository {
  async findBySlug(slug: string): Promise<IPO | null> {
    try {
      return await this.getFromCache(
        getIPOBySlugKey(slug),
        async () => {
          const result = await this.db
            .select()
            .from(ipos)
            .where(eq(ipos.slug, slug))
            .limit(1);

          return result[0] || null;
        },
        CacheTTL.IPO_DETAIL
      );
    } catch (error) {
      // Log error with context
      console.error('Repository error:', {
        method: 'findBySlug',
        slug,
        error: error.message
      });

      // Re-throw with context
      throw new RepositoryError('Failed to fetch IPO by slug', { slug, cause: error });
    }
  }
}
```

### Service Layer

```typescript
export async function getIPOWithDetails(slug: string) {
  try {
    const ipo = await ipoRepository.findBySlug(slug);

    if (!ipo) {
      // Return null for not found (not an error)
      return null;
    }

    // Orchestrate multiple repositories
    const [financials, subscriptions] = await Promise.allSettled([
      financialRepository.findByIPO(ipo.id),
      subscriptionRepository.findByIPO(ipo.id)
    ]);

    return {
      ipo,
      financials: financials.status === 'fulfilled' ? financials.value : null,
      subscriptions: subscriptions.status === 'fulfilled' ? subscriptions.value : []
    };
  } catch (error) {
    // Log and re-throw
    console.error('Service error:', { slug, error });
    throw error;
  }
}
```

### API Route Layer

```typescript
export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const data = await getIPOWithDetails(params.slug);

    if (!data) {
      return NextResponse.json(
        { error: 'IPO not found', code: 'IPO_NOT_FOUND' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    // Log error with request context
    console.error('API error:', {
      method: 'GET',
      path: request.url,
      params,
      error: error.message,
      stack: error.stack
    });

    // Generic error response (don't leak internals)
    return NextResponse.json(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        requestId: generateRequestId() // For debugging
      },
      { status: 500 }
    );
  }
}
```

---

## Dependency Injection Pattern

### Repository Instantiation

```typescript
// ✅ Good: Create repository instances with dependencies
const redis = getRedisClient();
const ipoRepository = new IPORepository(db, redis);

// ❌ Bad: Global singleton repository
// Don't do this - makes testing harder
export const ipoRepository = new IPORepository(db, redis);
```

### Service Functions

```typescript
// Services as pure functions (stateless)
export async function getMainboardIPOs() {
  // Create dependencies on each call
  const redis = getRedisClient();
  const ipoRepository = new IPORepository(db, redis);

  return ipoRepository.findAll({ segment: ['MAINBOARD'] });
}

// Or accept dependencies as parameters (for testing)
export async function getMainboardIPOs(
  ipoRepository?: IPORepository
) {
  // Use provided or create default
  const repo = ipoRepository || new IPORepository(db, getRedisClient());

  return repo.findAll({ segment: ['MAINBOARD'] });
}
```

---

## Monorepo Module Boundaries

### Workspace Structure

```
IPODhan/
├── packages/shared/     # Shared utilities, DB schema
├── web/                 # Next.js app
└── scraper/             # Data scraping service
```

### Import Rules

**From Web Package:**

```typescript
// ✅ Can import from shared
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import * as schema from '@ipodhan/shared/db/schema';

// ❌ Cannot import from scraper
// import { scrapeNSE } from '@ipodhan/scraper'; // Wrong - separate service
```

**From Scraper Package:**

```typescript
// ✅ Can import from shared
import * as schema from '@ipodhan/shared/db/schema';

// ❌ Cannot import from web
// import { IPORepository } from '@ipodhan/web/lib/repositories'; // Wrong
```

**From Shared Package:**

```typescript
// ❌ Cannot import from web or scraper
// Shared should have no dependencies on other workspace packages
```

---

## Code Organization Principles

### 1. Separation of Concerns

```
repositories/  → Data access only (SELECT, INSERT, UPDATE, DELETE)
services/      → Business logic, orchestration, validation
api/           → HTTP handling, request/response formatting
components/    → UI rendering only
```

### 2. Single Responsibility

Each file has one clear purpose:

```typescript
// ✅ Good: Focused repository
export class IPORepository extends BaseRepository {
  async findBySlug(slug: string): Promise<IPO | null> { }
  async findById(id: string): Promise<IPO | null> { }
  async findAll(filters: IPOFilters): Promise<IPO[]> { }
  async create(data: NewIPO): Promise<IPO> { }
  async update(id: string, updates: Partial<IPO>): Promise<IPO> { }
  async delete(id: string): Promise<void> { }
}

// ❌ Bad: Mixed responsibilities
export class IPOService {
  async getIPO() { } // Data access (should be in repository)
  async formatIPOForDisplay() { } // Presentation (should be in component)
  async validateIPO() { } // Business logic (OK in service)
  async sendEmailNotification() { } // External service (separate module)
}
```

### 3. Explicit Dependencies

```typescript
// ✅ Good: Dependencies passed in
export async function processIPO(
  ipo: IPO,
  repository: IPORepository,
  emailService: EmailService
) {
  // Clear what this function needs
}

// ❌ Bad: Hidden global dependencies
import { globalRepository } from '@/lib/global';

export async function processIPO(ipo: IPO) {
  // Hidden dependency on globalRepository
}
```

---

## Common Anti-Patterns to Avoid

### Anti-Pattern 1: HTTP in Server Components

```typescript
// ❌ WRONG
export default async function IPOPage() {
  // Server Component making HTTP call to own API = circular!
  const response = await fetch('http://localhost:3000/api/ipos');
  const ipos = await response.json();

  return <div>{/* render */}</div>;
}

// ✅ CORRECT
export default async function IPOPage() {
  // Direct repository access
  const ipos = await ipoRepository.findAll();

  return <div>{/* render */}</div>;
}
```

### Anti-Pattern 2: Business Logic in Components

```typescript
// ❌ WRONG
export function IPOCard({ ipo }: { ipo: IPO }) {
  // Business logic in component
  const score = calculateIPOScore(ipo.financials, ipo.subscriptions, ipo.gmp);
  const rating = score > 7 ? 'Good' : 'Average';

  return <div>{rating}</div>;
}

// ✅ CORRECT
// Calculate in service layer, pass to component
export async function getIPOWithScore(slug: string) {
  const ipo = await ipoRepository.findBySlug(slug);
  const score = await calculateIPOScore(ipo.id);

  return { ipo, score };
}

export function IPOCard({ ipo, score }: { ipo: IPO, score: number }) {
  const rating = score > 7 ? 'Good' : 'Average';
  return <div>{rating}</div>;
}
```

### Anti-Pattern 3: Data Access in Services

```typescript
// ❌ WRONG
export async function getIPOService(slug: string) {
  // Direct SQL in service
  const result = await db.select().from(ipos).where(eq(ipos.slug, slug));
  return result[0];
}

// ✅ CORRECT
export async function getIPOService(slug: string) {
  // Use repository
  return ipoRepository.findBySlug(slug);
}
```

---

## Architectural Decision Records

### ADR-001: Single Source of Truth for Schema (2025-10-18)

**Decision:** All database schema in `packages/shared/src/db/schema.ts`

**Rationale:**
- Schema drift caused production failures
- Multiple schema files led to inconsistencies
- Type safety requires single schema definition

**Consequences:**
- All imports must use shared schema
- Web package re-exports for compatibility
- Migrations must be generated from shared schema

### ADR-002: No HTTP in Server-Side Code (2025-11-01)

**Decision:** Services and Server Components must use repositories directly

**Rationale:**
- HTTP calls from server to own API are circular and unnecessary
- Causes "Network request failed" in production builds
- Adds latency and complexity

**Consequences:**
- ESLint enforces this pattern
- Services instantiate repositories
- API routes only for external clients

---

## References

- **Backend Architecture:** `docs/02-architecture/backend-architecture.md`
- **Architectural Fixes:** `docs/07-testing/ui-tests/ARCHITECTURAL_FIXES_COMPLETE_NOV_1_2025.md`
- **Next.js App Router:** https://nextjs.org/docs/app
- **Server Components:** https://nextjs.org/docs/app/building-your-application/rendering/server-components

---

**Critical Reminder:** The 3-layer architecture (Presentation → Service → Repository) is enforced by ESLint and must be followed in all code. Server-side code NEVER makes HTTP calls to its own API routes.
