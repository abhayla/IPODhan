---
name: web-api-routes
description: >
  Enforces the web app's API route conventions — response envelope, error shape,
  request-id tracing, pagination meta, and domain-error mapping — for all
  Next.js route handlers.
paths: ["web/app/api/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Web API Route Conventions

## Response envelope

Route handlers return `NextResponse.json()` with the project envelope:

```typescript
// ✅ Success
return NextResponse.json({ success: true, data: result });

// ✅ Error (no internals leaked)
return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
```

- MUST wrap handler bodies in try/catch; uncaught errors map to a generic 500 —
  MUST NOT leak stack traces, SQL, or internal messages to the client
- MUST NOT return raw `Response` constructors — use `NextResponse.json()`

## Data access from routes

Routes instantiate repositories directly (cache-aside via Redis), never an HTTP
client:

```typescript
const redis = getRedisClient();
const repo = new IPORepository(db, redis);
return NextResponse.json({ success: true, data: await repo.findAll() });
```

See `web-data-access.md` for the full repository/caching contract.

## Request-id tracing

Newer routes generate a request-scoped id `req_${timestamp}_${random}` and log
through a request-scoped logger so a failing request can be traced end-to-end.
New routes MUST follow this pattern; when touching an older route without it,
add it (Boy Scout) rather than propagating the gap.

## Domain errors

Domain-specific errors from `@ipodhan/shared` (e.g. `DatabaseError`,
`EntityNotFoundError`) MUST map to appropriate status codes at the route
boundary — `EntityNotFoundError` → 404, validation failures → 400, everything
unexpected → 500. MUST NOT let a domain error class serialize raw into the
response body.

## Pagination

List endpoints return pagination meta alongside data:

```typescript
return NextResponse.json({
  success: true,
  data: rows,
  meta: { total, page, limit },
});
```

Known deviation: some admin routes use offset-based params. New endpoints MUST
use the page/limit shape; do not introduce a third variant.

## CRITICAL RULES

- MUST return the `{ success: true, data }` envelope on success and a generic
  error message + correct status on failure (try/catch in every handler)
- MUST use repositories directly — never an HTTP api-client from a route
- MUST generate/log a request id on new routes
- MUST map domain errors to status codes at the boundary — never serialize
  internals to the client
