---
name: admin-field-protection
description: >
  Enforces the field-protection lifecycle — admin edits call
  markFieldAsManuallyEdited() to auto-protect a field, which the scraper write
  path then filters out. The shared FieldProtectionService is the SSOT; web wraps it.
paths: ["web/app/api/admin/**/*.ts", "web/lib/admin/field-protection-checker.ts", "packages/shared/src/admin/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Admin Field Protection Lifecycle

IPODhan reconciles many scraper sources against manual admin edits. The contract
that makes manual edits "stick" is field protection: a manually edited field is
locked so later scraper runs cannot overwrite it. This rule covers the **write
(admin) side**; `scraper-write-path.md` covers the **read (filter) side**.

## Shared service is the SSOT

The protection logic lives in `@ipodhan/shared/admin/field-protection-checker`
(`FieldProtectionService`). `web/lib/admin/field-protection-checker.ts` is a thin
web adapter that injects the web `db`, Redis, and notification service — it
re-exports the same functions for backward compatibility.

- MUST go through `createFieldProtectionService(...)` / the web wrapper — MUST NOT
  reimplement protection checks or write the `fieldSources` / protection tables
  directly from a route

## Admin mutations auto-protect the edited field

Any admin route that writes an IPO field a scraper also populates MUST record the
edit through the service so the field is protected and attributed:

```typescript
import { markFieldAsManuallyEdited } from '@/lib/admin/field-protection-checker';

// after persisting the admin's value:
await markFieldAsManuallyEdited(
  ipoId, tableName, fieldName,
  admin.adminName,      // from AdminAuthContext — see admin-route-auth.md
  editNote,             // optional reason for the audit trail
  /* autoProtect */ true
);
```

- MUST pass the admin identity (`AdminAuthContext.adminName`) as `editedBy` — the
  protection record is also the audit trail
- MUST keep `autoProtect = true` for fields scrapers populate; without it the next
  scraper run silently reverts the admin's edit
- To lock an entire record use `isIPOLocked` semantics (the `scraper_locked` flag),
  not per-field marking

## Reading protection state

- Use `isFieldProtected()` / `filterProtectedFields()` (read-only) to check or
  strip protected fields — the scraper write path already does this via
  `data-persister.ts`; admin dashboards surface blocked attempts via
  `getBlockedUpdateNotifications()`
- MUST invalidate the protection cache (`invalidateProtectionCache()`) after
  changing protection state — the service caches status in Redis
