# Next.js 15 App Router Expert

**Purpose:** This skill provides deep expertise in Next.js 15 App Router patterns, conventions, and best practices specific to the IPODhan implementation. It covers routing, rendering, data fetching, and App Router-specific features.

**When to invoke:** Use this skill when working with Next.js App Router features, debugging routing issues, implementing Server Actions, optimizing rendering strategies, or understanding metadata/streaming patterns.

---

## Core App Router Concepts

### File-Based Routing Conventions

Next.js 15 uses file-system routing with special file names:

```
app/
├── layout.tsx          # Root layout (required)
├── page.tsx            # Homepage route
├── loading.tsx         # Loading UI (Suspense boundary)
├── error.tsx           # Error boundary
├── not-found.tsx       # 404 page
├── global-error.tsx    # Global error boundary
│
├── ipos/
│   ├── page.tsx        # /ipos route
│   ├── layout.tsx      # Shared layout for /ipos/*
│   ├── loading.tsx     # Loading state for /ipos
│   │
│   ├── [slug]/
│   │   ├── page.tsx    # /ipos/[slug] dynamic route
│   │   ├── loading.tsx # Loading state for detail page
│   │   └── error.tsx   # Error boundary for detail page
│   │
│   └── compare/
│       └── page.tsx    # /ipos/compare route
│
└── api/
    └── ipos/
        └── route.ts    # API route handler
```

### Special Files Priority

1. **layout.tsx** - Wraps children, persists across navigations
2. **template.tsx** - Similar to layout but re-mounts on navigation
3. **error.tsx** - Catches errors in route segment
4. **loading.tsx** - Shows while page is loading (automatic Suspense)
5. **not-found.tsx** - 404 UI for this route segment
6. **page.tsx** - The actual route content

---

## Server Components vs Client Components

### Server Components (Default)

**Characteristics:**
```typescript
// No 'use client' directive = Server Component by default
export default async function IPODetailPage({ params }: { params: { slug: string } }) {
  // ✅ Can directly access database
  const ipo = await getIPOBySlug(params.slug);

  // ✅ Can use async/await
  // ✅ No JavaScript sent to client
  // ✅ Can use server-only packages

  return <IPODetail ipo={ipo} />;
}
```

**When to Use:**
- Fetching data from database
- Accessing backend resources
- Keeping sensitive information on server
- Reducing client bundle size
- SEO-critical content

**Limitations:**
- ❌ Cannot use useState, useEffect, event handlers
- ❌ Cannot use browser APIs
- ❌ Cannot use React hooks

### Client Components

**Characteristics:**
```typescript
'use client'; // Required directive at top of file

import { useState } from 'react';

export function IPOCompareForm() {
  // ✅ Can use React hooks
  const [selected, setSelected] = useState<string[]>([]);

  // ✅ Can handle events
  const handleSelect = (id: string) => {
    setSelected(prev => [...prev, id]);
  };

  // ✅ Can use browser APIs
  useEffect(() => {
    localStorage.setItem('selected', JSON.stringify(selected));
  }, [selected]);

  return (
    <button onClick={() => handleSelect('ipo-1')}>
      Select IPO
    </button>
  );
}
```

**When to Use:**
- Interactive UI (buttons, forms, modals)
- React hooks (useState, useEffect, useContext)
- Browser APIs (localStorage, geolocation)
- Event handlers
- Real-time updates

### Component Boundary Rules

**✅ Server Component Can:**
- Import and render other Server Components
- Import and render Client Components
- Pass Server Components as children to Client Components

```typescript
// Server Component
export default async function Page() {
  const data = await fetchData();

  return (
    <ClientComponentWrapper>
      {/* Server Component passed as children */}
      <ServerRenderedChart data={data} />
    </ClientComponentWrapper>
  );
}
```

**❌ Client Component CANNOT:**
- Import Server Components directly
- Use async/await in component body
- Access server-only resources

```typescript
'use client';

// ❌ WRONG - Cannot import Server Component
import ServerComponent from './server-component';

// ✅ CORRECT - Receive as prop/children
export function ClientWrapper({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
```

---

## Async Params Pattern (React 19 / Next.js 15)

Next.js 15 with React 19 introduces async params:

### Old Pattern (Next.js 14)
```typescript
export default function Page({ params }: { params: { slug: string } }) {
  // params is synchronous
}
```

### New Pattern (Next.js 15)
```typescript
export default async function Page({
  params
}: {
  params: Promise<{ slug: string }>
}) {
  // params is now a Promise
  const { slug } = await params;

  const ipo = await getIPOBySlug(slug);
  return <IPODetail ipo={ipo} />;
}
```

### SearchParams Also Async

```typescript
export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ segment?: string; status?: string }>
}) {
  const { segment, status } = await searchParams;

  const ipos = await getIPOs({ segment, status });
  return <IPOList ipos={ipos} />;
}
```

**Why the Change:**
- Enables better Partial Prerendering
- Allows streaming of route parameters
- Improves performance for dynamic routes

---

## Metadata API

### Static Metadata

```typescript
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'IPO List | IPODhan',
  description: 'Browse all upcoming and open IPOs in India',
  openGraph: {
    title: 'IPO List | IPODhan',
    description: 'Browse all upcoming and open IPOs in India',
    images: ['/og-image.jpg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'IPO List | IPODhan',
    description: 'Browse all upcoming and open IPOs in India',
  },
};

export default function IPOListPage() {
  return <div>IPO List</div>;
}
```

### Dynamic Metadata (generateMetadata)

```typescript
export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params;
  const ipo = await getIPOBySlug(slug);

  if (!ipo) {
    return {
      title: 'IPO Not Found | IPODhan',
    };
  }

  return {
    title: `${ipo.companyName} IPO | IPODhan`,
    description: `${ipo.companyName} IPO opens on ${ipo.openDate}. Price band: ₹${ipo.priceRangeLow}-₹${ipo.priceRangeHigh}. Lot size: ${ipo.lotSize} shares.`,
    openGraph: {
      title: `${ipo.companyName} IPO`,
      description: `Opens ${ipo.openDate} | Price: ₹${ipo.priceRangeLow}-₹${ipo.priceRangeHigh}`,
      images: [
        {
          url: `/api/og?ipo=${slug}`,
          width: 1200,
          height: 630,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${ipo.companyName} IPO`,
      description: `Opens ${ipo.openDate}`,
    },
  };
}
```

### Metadata Inheritance

Child routes inherit and can override parent metadata:

```typescript
// app/layout.tsx
export const metadata: Metadata = {
  title: {
    default: 'IPODhan',
    template: '%s | IPODhan', // Child routes fill %s
  },
};

// app/ipos/page.tsx
export const metadata: Metadata = {
  title: 'IPO List', // Becomes "IPO List | IPODhan"
};
```

---

## Loading States & Suspense

### Automatic Loading UI

```typescript
// app/ipos/loading.tsx
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 bg-gray-200 animate-pulse rounded" />
      <div className="h-64 bg-gray-200 animate-pulse rounded" />
    </div>
  );
}

// app/ipos/page.tsx
export default async function IPOListPage() {
  // While this async function runs, loading.tsx shows
  const ipos = await getIPOs();
  return <IPOList ipos={ipos} />;
}
```

### Manual Suspense Boundaries

```typescript
import { Suspense } from 'react';

export default function Page() {
  return (
    <div>
      <h1>IPO Detail</h1>

      {/* This loads immediately */}
      <IPOBasicInfo />

      {/* This streams in when ready */}
      <Suspense fallback={<SubscriptionSkeleton />}>
        <SubscriptionData />
      </Suspense>

      {/* This streams in separately */}
      <Suspense fallback={<GMPSkeleton />}>
        <GMPData />
      </Suspense>
    </div>
  );
}

async function SubscriptionData() {
  const data = await fetchSubscriptionData();
  return <SubscriptionChart data={data} />;
}

async function GMPData() {
  const data = await fetchGMPData();
  return <GMPChart data={data} />;
}
```

**Benefits:**
- Faster Time to First Byte
- Progressive rendering
- Better perceived performance
- Each Suspense boundary loads independently

---

## Error Boundaries

### Route Error Boundaries

```typescript
// app/ipos/[slug]/error.tsx
'use client'; // Error boundaries must be Client Components

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to monitoring service
    console.error('IPO detail error:', error);
  }, [error]);

  return (
    <div className="p-8 text-center">
      <h2 className="text-2xl font-bold mb-4">
        Failed to load IPO details
      </h2>
      <p className="text-gray-600 mb-4">
        {error.message}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        Try again
      </button>
    </div>
  );
}
```

### Not Found Handling

```typescript
// app/ipos/[slug]/page.tsx
import { notFound } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ipo = await getIPOBySlug(slug);

  if (!ipo) {
    notFound(); // Triggers not-found.tsx
  }

  return <IPODetail ipo={ipo} />;
}

// app/ipos/[slug]/not-found.tsx
export default function NotFound() {
  return (
    <div className="p-8 text-center">
      <h2 className="text-2xl font-bold">IPO Not Found</h2>
      <p className="text-gray-600 mt-2">
        The IPO you're looking for doesn't exist.
      </p>
      <Link href="/ipos" className="text-blue-500 mt-4 inline-block">
        Browse all IPOs
      </Link>
    </div>
  );
}
```

---

## Route Handlers (API Routes)

### Basic Route Handler

```typescript
// app/api/ipos/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const segment = searchParams.get('segment');

    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    const ipos = await ipoRepository.findAll({
      segment: segment ? [segment] : undefined,
    });

    return NextResponse.json({
      success: true,
      data: ipos,
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate and create IPO
    // ...

    return NextResponse.json(
      { success: true, data: newIPO },
      { status: 201 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    );
  }
}
```

### Dynamic Route Handlers

```typescript
// app/api/ipos/[id]/route.ts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const ipo = await ipoRepository.findById(id);

  if (!ipo) {
    return NextResponse.json(
      { error: 'IPO not found' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: ipo });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const updates = await request.json();

  const updated = await ipoRepository.update(id, updates);

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  await ipoRepository.delete(id);

  return new NextResponse(null, { status: 204 });
}
```

### Route Handler vs Server Component

**Use Route Handler When:**
- Building REST API for external clients
- Webhooks from third parties
- Client Components need to fetch data
- Need specific HTTP methods (POST, PUT, DELETE)

**Use Server Component When:**
- Rendering pages
- SEO is important
- Want to colocate data fetching with UI
- Simpler code (no HTTP overhead)

---

## Server Actions

Server Actions allow Client Components to call server functions directly.

### Defining Server Actions

```typescript
// app/actions/ipo-actions.ts
'use server'; // Marks all exports as Server Actions

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function createIPO(formData: FormData) {
  const companyName = formData.get('companyName') as string;
  const priceRangeLow = Number(formData.get('priceRangeLow'));

  // Validate
  if (!companyName || !priceRangeLow) {
    return { error: 'Missing required fields' };
  }

  // Create IPO
  const ipo = await ipoRepository.create({
    companyName,
    priceRangeLow,
    // ... other fields
  });

  // Revalidate cached page
  revalidatePath('/ipos');

  // Redirect to new IPO
  redirect(`/ipos/${ipo.slug}`);
}

export async function updateIPO(id: string, updates: Partial<IPO>) {
  const updated = await ipoRepository.update(id, updates);

  // Revalidate specific IPO page
  revalidatePath(`/ipos/${updated.slug}`);

  return { success: true, data: updated };
}
```

### Using Server Actions in Forms

```typescript
'use client';

import { createIPO } from '@/app/actions/ipo-actions';
import { useFormStatus } from 'react-dom';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Creating...' : 'Create IPO'}
    </button>
  );
}

export function CreateIPOForm() {
  return (
    <form action={createIPO}>
      <input type="text" name="companyName" required />
      <input type="number" name="priceRangeLow" required />
      <SubmitButton />
    </form>
  );
}
```

### Using Server Actions with useTransition

```typescript
'use client';

import { useTransition } from 'react';
import { updateIPO } from '@/app/actions/ipo-actions';

export function UpdateIPOButton({ ipoId }: { ipoId: string }) {
  const [isPending, startTransition] = useTransition();

  const handleUpdate = () => {
    startTransition(async () => {
      const result = await updateIPO(ipoId, {
        status: 'OPEN',
      });

      if (result.error) {
        alert(result.error);
      }
    });
  };

  return (
    <button onClick={handleUpdate} disabled={isPending}>
      {isPending ? 'Updating...' : 'Mark as Open'}
    </button>
  );
}
```

---

## Static vs Dynamic Rendering

### Force Static Rendering

```typescript
// This page will be statically generated at build time
export const dynamic = 'force-static';

export default async function Page() {
  const ipos = await getIPOs();
  return <IPOList ipos={ipos} />;
}
```

### Force Dynamic Rendering

```typescript
// This page will be rendered on every request
export const dynamic = 'force-dynamic';

export default async function Page() {
  const ipos = await getIPOs();
  return <IPOList ipos={ipos} />;
}
```

### Revalidation

```typescript
// Revalidate every 60 seconds
export const revalidate = 60;

export default async function Page() {
  const ipos = await getIPOs();
  return <IPOList ipos={ipos} />;
}
```

### Per-Request Revalidation

```typescript
import { revalidateTag } from 'next/cache';

// Tag data during fetch
export async function getIPOs() {
  const data = await fetch('https://api.example.com/ipos', {
    next: { tags: ['ipos'] },
  });
  return data.json();
}

// Revalidate all requests tagged with 'ipos'
export async function POST(request: NextRequest) {
  // ... create new IPO

  revalidateTag('ipos');

  return NextResponse.json({ success: true });
}
```

---

## Route Groups

Organize routes without affecting URL structure:

```
app/
├── (marketing)/
│   ├── layout.tsx      # Marketing layout
│   ├── page.tsx        # Homepage (/)
│   └── about/
│       └── page.tsx    # /about
│
└── (dashboard)/
    ├── layout.tsx      # Dashboard layout
    ├── ipos/
    │   └── page.tsx    # /ipos
    └── analytics/
        └── page.tsx    # /analytics
```

**Benefits:**
- Different layouts for different sections
- Organizational structure doesn't affect URLs
- Can have multiple root layouts

---

## Parallel Routes

Render multiple pages in the same layout simultaneously:

```
app/
└── dashboard/
    ├── layout.tsx
    ├── @analytics/
    │   └── page.tsx
    ├── @notifications/
    │   └── page.tsx
    └── page.tsx
```

```typescript
// app/dashboard/layout.tsx
export default function DashboardLayout({
  children,
  analytics,
  notifications,
}: {
  children: React.ReactNode;
  analytics: React.ReactNode;
  notifications: React.ReactNode;
}) {
  return (
    <div>
      <div>{children}</div>
      <div className="grid grid-cols-2 gap-4">
        <div>{analytics}</div>
        <div>{notifications}</div>
      </div>
    </div>
  );
}
```

---

## Intercepting Routes

Intercept routes to show different UI without navigation:

```
app/
├── ipos/
│   ├── page.tsx
│   └── [slug]/
│       └── page.tsx
│
└── @modal/
    └── (.)ipos/
        └── [slug]/
            └── page.tsx  # Modal version
```

**Use Case:** Show IPO detail in modal on /ipos, full page on direct visit

---

## Best Practices

### 1. Colocate Data Fetching

```typescript
// ✅ Good: Data fetching in same file
export default async function IPOPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ipo = await getIPOBySlug(slug);

  return <IPODetail ipo={ipo} />;
}

// ❌ Bad: Data fetching in separate API call
export default function IPOPage() {
  // Client-side fetch = worse performance
}
```

### 2. Use Loading States

Always provide loading.tsx for async routes:

```
app/ipos/
├── page.tsx        # Async data fetching
└── loading.tsx     # Loading UI (required!)
```

### 3. Minimize Client Components

```typescript
// ✅ Good: Only interactive part is Client Component
export default async function Page() {
  const ipos = await getIPOs(); // Server Component

  return (
    <div>
      <IPOList ipos={ipos} /> {/* Server Component */}
      <InteractiveFilter /> {/* Client Component only for filter */}
    </div>
  );
}

// ❌ Bad: Entire page is Client Component
'use client';
export default function Page() {
  const [ipos, setIPOs] = useState([]);
  // ... fetch on client
}
```

### 4. Use Suspense for Streaming

```typescript
export default function Page() {
  return (
    <>
      <Suspense fallback={<HeaderSkeleton />}>
        <Header />
      </Suspense>

      <Suspense fallback={<ContentSkeleton />}>
        <Content />
      </Suspense>
    </>
  );
}
```

---

## Common Issues & Solutions

### Issue: Hydration Mismatch

**Symptom:** "Text content does not match server-rendered HTML"

**Cause:** Server and client render differently

**Solution:**
```typescript
// ❌ Wrong: Using Date.now() causes mismatch
export default function Component() {
  return <div>{Date.now()}</div>;
}

// ✅ Correct: Only render on client
'use client';
import { useEffect, useState } from 'react';

export default function Component() {
  const [time, setTime] = useState<number | null>(null);

  useEffect(() => {
    setTime(Date.now());
  }, []);

  return <div>{time ?? 'Loading...'}</div>;
}
```

### Issue: Async Params Not Awaited

**Symptom:** TypeScript error or runtime error

**Solution:**
```typescript
// ❌ Wrong
export default async function Page({ params }: { params: { slug: string } }) {
  const ipo = await getIPOBySlug(params.slug); // Error!
}

// ✅ Correct
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ipo = await getIPOBySlug(slug);
}
```

---

## References

- **Next.js App Router Docs:** https://nextjs.org/docs/app
- **Server Components:** https://nextjs.org/docs/app/building-your-application/rendering/server-components
- **Server Actions:** https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations
- **Metadata API:** https://nextjs.org/docs/app/building-your-application/optimizing/metadata

---

**Note:** Next.js 15 App Router represents a significant shift from Pages Router. Understanding Server Components, async params, and proper component boundaries is critical for building performant, type-safe applications.
