---
name: shared-package-build
description: >
  Enforces the @ipodhan/shared compile-before-build ordering, the dist verification
  ritual CI depends on, the monorepo's asymmetric quality gates (web strict,
  scraper permissive), and shared-package boundary direction.
paths: ["packages/shared/**/*.ts", "packages/shared/**/*.json", ".github/workflows/*.yml", "package.json", ".lintstagedrc.js"]
version: "1.0.0"
synthesized: true
private: false
---

# Shared Package Build Order & Monorepo Gates

## Compile shared FIRST — and verify dist

`@ipodhan/shared` is TypeScript with `composite: true` + `emitDeclarationOnly: true`
(types to `dist/`, source consumed via exports map). Web and scraper builds depend
on its declarations being fresh.

- MUST compile shared before building web or scraper: `cd packages/shared && npx tsc`
- CI (`.github/workflows/ci.yml`) builds shared as a separate step and then
  verifies `packages/shared/dist/db/schema.d.ts` exists — **exit 1 if missing**.
  `deploy.yml` repeats the same ordering. MUST NOT fold the shared compile into
  the web build step or remove the dist verification
- Symptom map: "types from `@ipodhan/shared` seem stale locally" → rebuild the
  shared package; do NOT chase phantom type errors in web/scraper first

## Boundary direction

- `packages/shared` MUST NOT import from `web/` or `scraper/` — dependency flow
  is strictly shared → consumers
- Code used by both web and scraper belongs IN shared (see `schema-imports.md`
  for the exports-map contract)

## Asymmetric quality gates (intentional design)

| Workspace | TS strict | Pre-commit gate | Notes |
|---|---|---|---|
| `web/` | `strict: true` | `npx tsc --noEmit --project web/tsconfig.json` via lint-staged (`.lintstagedrc.js`) | ESLint runs manually via `npm run lint`, not pre-commit |
| `scraper/` | `strict: false` | none | ESM, run via tsx; no pre-commit type gate |
| `packages/shared/` | composite, declarations only | none (CI verifies) | |

- MUST NOT assume scraper code was type-checked at commit time — verify scraper
  changes by running its tests, not by trusting the commit gate
- MUST NOT "fix" the asymmetry casually (e.g., adding scraper to lint-staged) —
  it is a deliberate trade-off; changing it is a project decision, not a cleanup

## Dependency pinning

- Zod is pinned globally via root `package.json` `"overrides": { "zod": "^4.1.11" }`
  (see `schema-imports.md`)
- Root `npm run build` / `test:unit` / `lint` proxy to workspaces — there is no
  root-level build artifact

## CRITICAL RULES

- MUST build `packages/shared` before web/scraper and keep the
  `dist/db/schema.d.ts` verification step intact in CI and deploy workflows
- MUST NOT import web/ or scraper/ code from packages/shared
- MUST NOT treat scraper code as type-gated at commit — it is not
- MUST NOT add workspace-local zod versions around the root override
