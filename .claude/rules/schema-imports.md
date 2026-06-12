---
name: schema-imports
description: >
  Enforces the database schema single source of truth (packages/shared/src/db/schema.ts)
  and the @ipodhan/shared exports whitelist. Prevents imports of the stale legacy schema
  copy and deep src/ imports that bypass the package's public API.
globs: ["web/**/*.ts", "web/**/*.tsx", "scraper/**/*.ts", "packages/shared/src/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Schema & Shared-Package Imports

## Schema Single Source of Truth

All database schema lives in `packages/shared/src/db/schema.ts` (24 tables). It is
re-exported to the web app via `web/lib/db/index.ts`.

- MUST edit ONLY `packages/shared/src/db/schema.ts` for any schema change
- MUST NOT import or edit `web/lib/db/schema.ts` — it is a STALE legacy duplicate
  kept only for historical reasons. Editing it silently does nothing; importing it
  yields outdated types
- Schema change workflow: edit `schema.ts` → `npm run db:generate` (from `web/`) →
  review generated SQL in `web/drizzle/` → `npm run db:migrate`

```typescript
// ✅ Correct
import { ipos, ipoStatusEnum } from '@/lib/db';
import * as schema from '@ipodhan/shared/db/schema';

// ❌ Wrong — stale legacy duplicate
import { ipos } from '@/lib/db/schema';
```

## Exports Whitelist — never deep-import src/

`packages/shared/package.json` defines an explicit `exports` map. These are the ONLY
valid entry points for `@ipodhan/shared`:

| Export path | Resolves to |
|---|---|
| `@ipodhan/shared` | `src/index.ts` (repositories, utils, types) |
| `@ipodhan/shared/db` | `src/db/index.ts` |
| `@ipodhan/shared/db/schema` | `src/db/schema.ts` |
| `@ipodhan/shared/repositories` | `src/repositories/index.ts` |
| `@ipodhan/shared/repositories/data-conflicts-repository` | dedicated export |
| `@ipodhan/shared/repositories/field-sources-repository` | dedicated export |
| `@ipodhan/shared/cache` | `src/cache/index.ts` |
| `@ipodhan/shared/types` | `src/types/index.ts` |
| `@ipodhan/shared/utils/slug` | `src/utils/slug.ts` |

- MUST NOT import `@ipodhan/shared/src/...` or traverse relatively into
  `../packages/shared/src/...` from web or scraper code (the single sanctioned
  exception is the re-export shim `web/lib/db/index.ts` itself)
- Modules not in the exports map are INTERNAL to the shared package — if you need
  one from web/scraper, add it to the exports map deliberately, do not bypass it
- New code shared by BOTH web and scraper belongs in `packages/shared/src/`, exposed
  through the exports map — not duplicated into each workspace

## Zod version

Zod is pinned via the root `package.json` `"overrides": { "zod": "^4.1.11" }`.
MUST NOT add a workspace-local zod dependency at a different version — the override
exists precisely to prevent multi-version conflicts in shared validators.

## CRITICAL RULES

- MUST edit only `packages/shared/src/db/schema.ts` for schema changes
- MUST NOT import or edit `web/lib/db/schema.ts` (stale legacy copy)
- MUST import `@ipodhan/shared` only through its exports-map paths — never `src/` deep imports
- MUST place new web+scraper-shared code in `packages/shared`, not in either workspace
