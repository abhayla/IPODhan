// Fixture for scripts/tests/issue-392-shared-db-subpath-resolution.test.mjs (#392).
//
// A STATIC named import of `configureUtcTimestampParsing` from the
// `@ipodhan/shared/db` subpath specifier, run with `npx tsx` from `scraper/`
// (the exact way every `scraper/scripts/*.ts` file is invoked in production
// and in the runbooks). No DB connection is made — importing `db/index.ts`
// only constructs lazy Proxy objects.
//
// Class (#392): under the scraper's tsconfig `paths` mapping
// (`"@ipodhan/shared/*": ["../packages/shared/src/*"]`), tsx's bundler-style
// module resolution for the extensionless subpath `@ipodhan/shared/db`
// prefers the sibling FILE `packages/shared/src/db.ts` over the directory
// `packages/shared/src/db/index.ts` -- even though package.json's `exports`
// map points `./db` at `./db/index.ts`. Any name that db.ts does not
// re-export (at the time of writing: `configureUtcTimestampParsing`,
// `resolveDiscreteDbParams`) throws
// `SyntaxError: The requested module '@ipodhan/shared/db' does not provide
// an export named '...'` -- even importing it ALONE, with no second
// `@ipodhan/shared/*` import involved (the "dual-entry-point" framing in
// #392 is about db.ts vs db/index.ts, not about needing a second import).
import { configureUtcTimestampParsing } from '@ipodhan/shared/db';

console.log('ISSUE-392-OK', typeof configureUtcTimestampParsing);
