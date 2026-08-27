---
name: shared-package-source-imports
description: >
  @ipodhan/shared is consumed as TypeScript SOURCE, not compiled JS — every package.json exports key
  maps to ./src/*.ts, tsc emits only .d.ts, and relative imports inside the package MUST be
  extensionless. A new deep-import entry point requires BOTH an exports key AND the file.
paths: ["packages/shared/**/*.ts", "packages/shared/package.json"]
version: "1.0.0"
synthesized: true
private: false
---

# @ipodhan/shared Is Consumed As TypeScript Source

> Distinct from `shared-package-build` (which governs compile-before-build / dist verification
> ORDERING). This rule governs HOW the package is resolved and imported: directly as `.ts` source.

## Exports/main resolve to ./src/*.ts, and tsc emits only declarations
In `packages/shared/package.json` the `main` is `./src/index.ts` and EVERY key in `exports`
resolves to a `./src/*.ts` file, never to `dist`:
`"."` → `./src/index.ts`, `"./db"` → `./src/db/index.ts`,
`"./db/schema"` → `./src/db/schema.ts`, `"./repositories"` → `./src/repositories/index.ts`,
`"./cache"` → `./src/cache/index.ts`, `"./types"` → `./src/types/index.ts`,
`"./utils/slug"` → `./src/utils/slug.ts`, plus the other `./utils/*`, `./admin/*`, and
`./repositories/*` entries. Consumers (web, scraper) compile this `.ts` source through their own
bundler/transpiler — so the package's `tsconfig.json` sets `emitDeclarationOnly: true` (tsc emits
ONLY `.d.ts` type declarations into `dist`, never `.js`). Do not "fix" a consumer by pointing it at
`dist/*.js` — that JS does not exist by design.

## Relative imports inside shared MUST be extensionless
Because the source is the artifact and consumers resolve via bundler module resolution, every
relative import INSIDE `packages/shared/src/**` MUST be extensionless:
`import ... from '../db/schema'` — NOT `'../db/schema.js'` and NOT `'.ts'`.
`packages/shared/fix-imports.cjs` is the enforcement tool: it walks `src/`, strips `.js` extensions
from relative/local imports (`from '../x.js'` → `from '../x'`), and is the canonical fix when a `.js`
extension creeps in. If you see `.js` on a relative import, run `fix-imports.cjs` rather than editing
by hand or switching the import to point at `dist`.

## A new deep-import entry point needs TWO changes
Exposing a new sub-path (e.g. `@ipodhan/shared/utils/foo`) requires BOTH: (1) the file
`packages/shared/src/utils/foo.ts`, AND (2) a matching `exports` key in `package.json` mapping it to
that `./src/...` path. Adding only the file leaves the import unresolvable; adding only the key
breaks at runtime. They MUST land together.

## CRITICAL RULES
- MUST keep every `package.json` `exports`/`main` value pointing at `./src/*.ts`; MUST NOT repoint any entry to `dist/*.js`.
- MUST keep `emitDeclarationOnly: true` in `packages/shared/tsconfig.json` — the package ships `.ts` source + `.d.ts`, never compiled `.js`.
- MUST write extensionless relative imports inside `packages/shared/src/**` (`'../db/schema'`, never `'.js'`/`'.ts'`); run `fix-imports.cjs` to repair stray `.js` extensions.
- A new deep-import entry point MUST add BOTH the `exports` key AND the source file in the same change.
- MUST NOT diagnose a consumer resolution error by assuming compiled output exists — there is no `.js` in `dist`.
