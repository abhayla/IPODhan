---
name: admin-route-auth
description: >
  Enforces the admin API auth contract — every admin route is wrapped with
  withAdminAuth(), which gates on ADMIN_PANEL_ENABLED + a Bearer ADMIN_AUTH_TOKEN
  and injects an AdminAuthContext used for audit attribution.
paths: ["web/app/api/admin/**/*.ts", "web/lib/middleware/admin-auth.ts"]
version: "1.0.0"
synthesized: true
private: true
---

# Admin Route Authentication

Every handler under `web/app/api/admin/` MUST be wrapped with `withAdminAuth()`
from `web/lib/middleware/admin-auth.ts`. An admin route that reads
`request.headers` and checks the token by hand is a bug — it bypasses the
`ADMIN_PANEL_ENABLED` kill switch and the uniform 401 shape.

## The wrapper injects context

`withAdminAuth(handler)` runs `verifyAdminAuth()` first; on success it calls the
handler with an `AdminAuthContext` as the **second** argument:

```typescript
import { withAdminAuth, type AdminAuthContext } from '@/lib/middleware/admin-auth';

export const PATCH = withAdminAuth(
  async (request: NextRequest, admin: AdminAuthContext, { params }) => {
    // admin.adminId / admin.adminName are trusted here — auth already passed
    return NextResponse.json({ success: true, data });
  }
);
```

- MUST take `AdminAuthContext` as the second handler param and use
  `admin.adminName` / `admin.adminId` for audit attribution (e.g. the `editedBy`
  argument to `markFieldAsManuallyEdited` — see `admin-field-protection.md`)
- MUST NOT call `verifyAdminAuth()` ad hoc inside a handler to re-derive identity;
  the wrapper already validated and passed it
- MUST NOT return a custom 401 — the wrapper emits the canonical
  `{ error: 'Unauthorized', message: 'Admin authentication required' }` at 401

## Auth is gated by environment

Auth depends on two env vars (`web/lib/middleware/admin-auth.ts`):

- `ADMIN_PANEL_ENABLED` — when not `'true'`, **all** admin auth fails closed
  (returns `null`), disabling the admin surface entirely
- `ADMIN_AUTH_TOKEN` — the Bearer token; an empty token rejects every request

- MUST NOT log, echo, or return `ADMIN_AUTH_TOKEN`, and MUST NOT hardcode it —
  it is read from the environment only
- Client callers send it via the admin API client (Bearer header); server-side
  routes never need to read it directly beyond the middleware
