---
name: admin-route-auth
description: >
  Enforces the admin API auth contract — every admin route is wrapped with
  withAdminAuth(), which gates on ADMIN_PANEL_ENABLED, accepts a named admin's
  session cookie (Origin-checked on mutations) or the machine Bearer token
  (identity system:token), and injects an AdminAuthContext for attribution.
paths: ["web/app/api/admin/**/*.ts", "web/lib/middleware/admin-auth.ts", "web/lib/auth/admin-auth.ts", "web/lib/admin-accounts/**"]
version: "2.0.0"
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
  `admin.adminId` (the stable `admin_users.id`; `system:token` for the machine token) as
  the attribution key, `admin.adminName` only for display (e.g. the `editedBy`
  argument to `markFieldAsManuallyEdited` — see `admin-field-protection.md`)
- MUST NOT call `verifyAdminAuth()` ad hoc inside a handler to re-derive identity;
  the wrapper already validated and passed it
- MUST NOT return a custom 401 — the wrapper emits the canonical
  `{ error: 'Unauthorized', message: 'Admin authentication required' }` at 401

## Two ways in (spec §9.2 item 6; OD-104, OD-113, OD-114)

`verifyAdminAuth()` accepts, in this order:

1. **A named admin's session cookie** (`ipodhan_admin_session`): a random token whose SHA-256 is
   the `admin_sessions.id`. The database is read on every request, so a removed (disabled) admin is
   refused at once. Sessions slide in 14-day steps but end 30 days after sign-in however active.
   Context: `{ adminId: admin_users.id, adminName, isOwner, authMethod: 'session' }`.
2. **The machine Bearer token** (`ADMIN_AUTH_TOKEN`; `ADMIN_API_TOKEN` on the `requireAdminAuth`
   path) for non-human callers only (scraper revalidation/status, `scripts/audit-prod.mjs`). Its
   identity is the fixed `system:token` (`MACHINE_TOKEN_IDENTITY`), never a person, never an owner.
   Context: `authMethod: 'token'`.

## CSRF: cookie mutations must come from the site's own origin

The cookie is `SameSite=Lax`, which is not enough on its own. For a cookie-authenticated
POST/PUT/PATCH/DELETE, `withAdminAuth` (and the cookie branch of `requireAdminAuth`) allow the
request only when it is same-origin BY CONSTRUCTION: the `Origin` header's host equals the request's
own host (`Host`, or the `X-Forwarded-Host` nginx passes on). No env var is needed — staging and prod
set neither `NEXT_PUBLIC_BASE_URL` nor `ADMIN_ALLOWED_ORIGINS`, and an env-only allow-list refused
every browser mutation there. `ADMIN_ALLOWED_ORIGINS` (comma-separated) and the public-URL env vars
can still add origins. With no `Origin`, only `Sec-Fetch-Site: same-origin` passes; anything else is 403.
Bearer (machine) calls carry no cookie and are exempt. Logic: `web/lib/admin-accounts/request-origin.ts`.

## Owner-only account routes

`/api/admin/accounts/**` (list, add, remove, reset password) call `requireOwner(admin)` first and
answer 403 to any non-owner, including the machine token (OD-113). The one owner is created only by
`web/scripts/create-owner-admin.ts` (dry run by default; `--apply` only on `ipodhan_staging`,
`ipodhan_test`, or `ipodhan` with `--allow-prod`), and the database allows at most one owner
(partial unique index `uq_admin_users_single_owner`). `/api/admin/auth/login` is the only public
admin route; it is rate-limited per trusted client IP (CF-Connecting-IP / X-Real-IP, never the
first X-Forwarded-For entry) and per email alone, with an in-process fallback when Redis is down.

## Auth is gated by environment

Auth depends on two env vars (`web/lib/middleware/admin-auth.ts`):

- `ADMIN_PANEL_ENABLED` — when not `'true'`, **all** admin auth fails closed: session cookies AND
  both machine tokens (`ADMIN_AUTH_TOKEN` via `verifyAdminAuth`, `ADMIN_API_TOKEN` via
  `requireAdminAuth`), disabling the admin surface entirely
- `ADMIN_AUTH_TOKEN` — the Bearer token; an empty token rejects every request

- MUST NOT log, echo, or return `ADMIN_AUTH_TOKEN`, and MUST NOT hardcode it —
  it is read from the environment only
- Client callers send it via the admin API client (Bearer header); server-side
  routes never need to read it directly beyond the middleware
