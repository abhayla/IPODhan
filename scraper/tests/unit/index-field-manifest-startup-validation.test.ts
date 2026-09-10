/**
 * Item 2 slice 4 (design build card `docs/design/build-cards/item-02-field-manifest-and-priority-config.md`,
 * plan row 2-S3 in `docs/contracts/plans/lane-c-items-12-2-3.md`) — validate the field manifest at
 * process start, BEFORE main() runs.
 *
 * Class: configuration that is read at runtime but never validated, so a malformed file is
 * discovered by a wrong result rather than a loud failure. `field-manifest.json` (2-S1/2-S2, on
 * main) is a case in point — nothing reads it yet, but once item 3 wires it in, a malformed file
 * must stop the process at startup, not surface as a wrong field value three steps into a cycle.
 *
 * `ENABLE_FIELD_MANIFEST` default is FALSE in every slot (design card, "Default `false` in every
 * slot until item 3 lands"; plain `process.env.X === 'true'` pattern, matching
 * `ENABLE_DATA_CONSOLIDATION` per the card's own text) — this item alone adds only the loader and
 * the file, nothing consumes it yet.
 *
 * The ordering assertion (not just the exit code): `validateFieldManifestAtStartup()` must be
 * called in the CLI guard BEFORE `main()`, and it throws SYNCHRONOUSLY when the flag is on and the
 * manifest is malformed. Node's guard block has no try/catch, so a synchronous throw there means
 * `main()` — and therefore its very first log line (`'IPO Scraper CLI started'`) — is never
 * reached. This is proven two ways, matching the existing pattern in
 * `index-env-assert.test.ts` ("is actually WIRED into main() before any post-scrape step runs"):
 *   (1) a source-order check that the call to `validateFieldManifestAtStartup(` appears BEFORE the
 *       `main();` call inside the CLI guard block — this is exactly what mutation (a) in the task
 *       brief (move the validation call to AFTER main()) breaks.
 *   (2) a behavioral check that `validateFieldManifestAtStartup()` — the exact function wired into
 *       the guard — throws before `logger.info` is ever called with the cycle-start message, by
 *       spying on the real logger and running the two calls in the guard's own order.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import os from 'os';
import path from 'path';
import fs from 'fs';

import { validateFieldManifestAtStartup } from '../../src/index.js';
import logger from '../../src/utils/logger.js';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const REAL_MANIFEST_PATH = join(__dirname, '..', '..', 'config', 'field-manifest.json');

const tmpFiles: string[] = [];

function writeTmpManifest(content: unknown): string {
  const filePath = path.join(
    os.tmpdir(),
    `field-manifest-startup-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(content), 'utf-8');
  tmpFiles.push(filePath);
  return filePath;
}

// Deliberately missing `generatedFrom` (required) and every required field
// under `fields['ipos.issue_size']` (rank/capability/unit), plus an
// out-of-enum `class` — fails schema validation on multiple axes at once,
// exactly like field-manifest-loader.test.ts's own malformed fixtures.
const MALFORMED_MANIFEST = { version: 1, fields: { 'ipos.issue_size': { class: 'NOT_A_REAL_CLASS' } } };

afterEach(() => {
  vi.restoreAllMocks();
  while (tmpFiles.length) {
    const f = tmpFiles.pop()!;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

// `enabled` is passed EXPLICITLY in every test below (never via
// process.env.ENABLE_FIELD_MANIFEST) because `FEATURE_FLAGS` is a plain
// object literal evaluated ONCE at module import — mutating process.env
// after import does not change it. `validateFieldManifestAtStartup`'s
// `enabled` param exists precisely so tests don't need `vi.resetModules()`
// to exercise both branches (see the function's doc comment in index.ts).
describe('validateFieldManifestAtStartup (item 2 slice 4 — process-start validation)', () => {
  it('flag OFF (default, no override passed): does nothing, does not throw, even with a deliberately malformed manifest', () => {
    const malformedPath = writeTmpManifest(MALFORMED_MANIFEST);
    // No third arg -> uses the real FEATURE_FLAGS.ENABLE_FIELD_MANIFEST,
    // which is false in this process (ENABLE_FIELD_MANIFEST is unset).
    expect(() => validateFieldManifestAtStartup(malformedPath)).not.toThrow();
  });

  it('flag OFF explicitly: still does nothing with a malformed manifest', () => {
    const malformedPath = writeTmpManifest(MALFORMED_MANIFEST);
    expect(() => validateFieldManifestAtStartup(malformedPath, false)).not.toThrow();
  });

  it('flag ON + malformed manifest: throws', () => {
    const malformedPath = writeTmpManifest(MALFORMED_MANIFEST);
    expect(() => validateFieldManifestAtStartup(malformedPath, true)).toThrow();
  });

  it('flag ON + valid manifest (the real checked-in one): does not throw', () => {
    expect(() => validateFieldManifestAtStartup(REAL_MANIFEST_PATH, true)).not.toThrow();
  });

  it('ordering: validateFieldManifestAtStartup throws BEFORE logger.info logs the cycle-start line, ' +
     'when run in the guard\'s own order — proves the failure precedes any cycle-start log line, ' +
     'not just that the process eventually exits non-zero', () => {
    const malformedPath = writeTmpManifest(MALFORMED_MANIFEST);
    const infoSpy = vi.spyOn(logger, 'info');

    // Exactly the CLI guard's own sequence: validate, THEN (would-be) main().
    let threw = false;
    try {
      validateFieldManifestAtStartup(malformedPath, true);
      // Unreachable when the manifest is malformed — if this line executes,
      // the ordering guarantee has already been broken and the test below
      // (no cycle-start log call) will also fail.
      logger.info({ source: 'all' }, 'IPO Scraper CLI started');
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    expect(infoSpy).not.toHaveBeenCalledWith(expect.anything(), 'IPO Scraper CLI started');
  });

  it('is actually WIRED into the CLI guard BEFORE main() — a real source-order check, not a paper guard ' +
     '(wire-or-retire; mutation (a): moving the call after main() must fail this test)', () => {
    const src = readFileSync(join(REPO_ROOT, 'scraper', 'src', 'index.ts'), 'utf8');
    const guardMarker = 'if (import.meta.url === pathToFileURL(process.argv[1]).href) {';
    const guardStart = src.indexOf(guardMarker);
    expect(guardStart).toBeGreaterThan(-1);
    const guardBody = src.slice(guardStart, src.indexOf('\n}', guardStart));

    const validateCallIndex = guardBody.indexOf('validateFieldManifestAtStartup(');
    const mainCallIndex = guardBody.indexOf('main();');

    expect(validateCallIndex).toBeGreaterThan(-1);
    expect(mainCallIndex).toBeGreaterThan(-1);
    expect(validateCallIndex).toBeLessThan(mainCallIndex);
  });
});
