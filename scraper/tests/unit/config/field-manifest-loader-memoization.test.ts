/**
 * CRITICAL-2 (Tier A review round on PR #753): `loadFieldManifest` -> `loadValidatedConfig` did
 * `readFileSync` + `JSON.parse` + a full zod `safeParse` of the 190-row manifest on EVERY call,
 * with no memoization. `hasManifestRow` calls it, `resolveFieldSourcePolicy` calls it again --
 * every `trackFieldSource` write on a manifest-row field loaded+validated the file TWICE.
 * Measured ~4ms/write; a cycle writing thousands of rows does thousands of file reads.
 *
 * This must not break test isolation: the flags/manifest reload pattern used across this suite
 * relies on `vi.resetModules()` between tests (see field-priority-matrix-shim-and-shadow.test.ts's
 * own comment on this) -- a MODULE-LEVEL cache is fine specifically because resetModules() gives
 * each test a fresh module instance (fresh cache), matching "once per process" semantics within
 * each test's own process-lifetime assertion, never leaking across unrelated tests.
 *
 * Spies on JSON.parse (not fs.readFileSync -- Node's ESM `fs` binding cannot be redefined by
 * vi.spyOn) since loadValidatedConfig calls JSON.parse exactly once per actual disk read,
 * immediately after readFileSync, in the same function.
 *
 * RED on the review's HEAD (89690a4b): no cache exists, so JSON.parse is called once PER
 * `loadFieldManifest()` invocation, not once per unique path.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';

const REAL_MANIFEST_PATH = path.join(__dirname, '../../../config/field-manifest.json');
const REAL_MANIFEST_RAW = fs.readFileSync(REAL_MANIFEST_PATH, 'utf-8');

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CRITICAL-2: loadFieldManifest memoizes the parsed+validated manifest per path', () => {
  it('parses the file only ONCE across repeated loadFieldManifest() calls on the same path', async () => {
    const parseSpy = vi.spyOn(JSON, 'parse');

    const { loadFieldManifest } = await import('../../../src/config/field-manifest-loader');

    const first = loadFieldManifest(REAL_MANIFEST_PATH);
    const second = loadFieldManifest(REAL_MANIFEST_PATH);
    const third = loadFieldManifest(REAL_MANIFEST_PATH);

    const manifestParses = parseSpy.mock.calls.filter((c) => c[0] === REAL_MANIFEST_RAW);
    expect(manifestParses.length).toBe(1);
    // same parsed object, not just equal content -- proves it is the cached instance
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('resolveFieldSourcePolicy and hasManifestRow (two independent loadFieldManifest call sites) share ONE parse', async () => {
    const parseSpy = vi.spyOn(JSON, 'parse');

    const { hasManifestRow } = await import('../../../src/config/field-priority-matrix');
    const { resolveFieldSourcePolicy } = await import('../../../src/config/field-source-policy');

    hasManifestRow('lotSize', 'ipos');
    resolveFieldSourcePolicy({ table: 'ipos', column: 'lot_size', ipoType: 'MAINBOARD' });

    const manifestParses = parseSpy.mock.calls.filter((c) => c[0] === REAL_MANIFEST_RAW);
    expect(manifestParses.length).toBe(1);
  });

  it('a DIFFERENT path is still parsed on its own (cache is keyed by path, not a single global)', async () => {
    const os = await import('os');
    const filePath = path.join(
      os.tmpdir(),
      `field-manifest-memo-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    const tmpRaw = JSON.stringify({
      version: 1,
      generatedFrom: 'test-fixture',
      fields: {
        'ipos.some_field': {
          class: 'D',
          rank: { MAINBOARD: ['DOC'] },
          capability: { DOC: { capable: true, reason: 'r' } },
          unit: 'crore',
          // S3b step 1 (issue #775): comparisonFamily is required by the schema now.
          comparisonFamily: 'MONEY',
        },
      },
    });
    fs.writeFileSync(filePath, tmpRaw, 'utf-8');

    try {
      const parseSpy = vi.spyOn(JSON, 'parse');
      const { loadFieldManifest } = await import('../../../src/config/field-manifest-loader');

      loadFieldManifest(REAL_MANIFEST_PATH);
      loadFieldManifest(filePath);

      const realParses = parseSpy.mock.calls.filter((c) => c[0] === REAL_MANIFEST_RAW).length;
      const tmpParses = parseSpy.mock.calls.filter((c) => c[0] === tmpRaw).length;

      expect(realParses).toBe(1);
      expect(tmpParses).toBe(1);
    } finally {
      fs.unlinkSync(filePath);
    }
  });
});
