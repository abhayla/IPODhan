// Self-test for scripts/ci/require-repair-tool-module.mjs's filename pattern.
// Tier A review (PR #666): the pattern was `^(repair|backfill)-.*\.ts$` and
// never matched `refresh-*.ts` tools, so `refresh-staging-row-from-prod.ts`
// (and the pre-existing `refresh-registrar-urls-t300.ts`, surfaced once the
// pattern widened) could carry no prod-write guard and the lint would stay
// silent. Pinned here so a future narrowing of the pattern back to
// (repair|backfill) turns this test red instead of silently losing coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_FILENAME_PATTERN } from '../ci/require-repair-tool-module.mjs';

test('TOOL_FILENAME_PATTERN matches refresh-*.ts alongside repair-*.ts and backfill-*.ts', () => {
  assert.equal(TOOL_FILENAME_PATTERN.test('refresh-staging-row-from-prod.ts'), true);
  assert.equal(TOOL_FILENAME_PATTERN.test('refresh-registrar-urls-t300.ts'), true);
  assert.equal(TOOL_FILENAME_PATTERN.test('repair-segment-provenance.ts'), true);
  assert.equal(TOOL_FILENAME_PATTERN.test('backfill-price-bands.ts'), true);
});

// Review round 3, MINOR-1: requeue-exhausted-plan-rows.ts (like the earlier
// requeue-anchor-zero-rows.ts) resets rows to PENDING for another pass — the
// SAME class of write this gate exists to catch (--expect-db, dry-run
// default, prod refused without --allow-prod). "requeue" was missing from
// the pattern, so a requeue-*.ts tool could carry no guard and the lint
// would stay silent.
test('TOOL_FILENAME_PATTERN matches requeue-*.ts', () => {
  assert.equal(TOOL_FILENAME_PATTERN.test('requeue-exhausted-plan-rows.ts'), true);
  assert.equal(TOOL_FILENAME_PATTERN.test('requeue-anchor-zero-rows.ts'), true);
});

test('TOOL_FILENAME_PATTERN does not match unrelated scripts', () => {
  assert.equal(TOOL_FILENAME_PATTERN.test('add-missing-registrars-t300.ts'), false);
  assert.equal(TOOL_FILENAME_PATTERN.test('index.ts'), false);
  assert.equal(TOOL_FILENAME_PATTERN.test('refresh-calendar.js'), false); // wrong extension
});
