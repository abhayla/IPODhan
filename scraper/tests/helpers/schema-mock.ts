/**
 * Shared @ipodhan/shared/db/schema mock pieces for scraper unit tests that
 * hand-write a PARTIAL `vi.mock('@ipodhan/shared/db/schema', () => ({...}))`
 * factory (i.e. do not merge over `importOriginal()`).
 *
 * `ipo-pipeline-steps-repository.ts` reads `ipoStatusEnum.enumValues` at
 * module load time (`export const PIPELINE_STAGES = ipoStatusEnum.enumValues`),
 * and that repository is pulled in transitively through
 * `packages/shared/src/repositories/index.ts` by `scraper/src/index.ts`. Any
 * partial mock of the schema module that omits `ipoStatusEnum` makes vitest
 * throw "No ipoStatusEnum export is defined on the ... mock" the moment
 * `src/index.ts` (or anything importing the shared repositories barrel) is
 * loaded — before a single test body runs.
 *
 * Import `ipoStatusEnumMock` into a test file's `vi.mock('@ipodhan/shared/db/schema', ...)`
 * factory and spread it alongside the file's own partial mock fields.
 */
export const ipoStatusEnumMock = {
  enumValues: ['UPCOMING', 'OPEN', 'CLOSED', 'LISTED', 'WITHDRAWN', 'POSTPONED'] as const,
};
