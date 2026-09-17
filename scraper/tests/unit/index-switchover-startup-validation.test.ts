/**
 * Item 3 slice S1b — process-start validation for `switchover.json`, same shape and same reason
 * as `index-field-manifest-startup-validation.test.ts` (item 2 slice 4): a malformed switchover
 * file must stop the process at startup when `ENABLE_POLICY_WRITER` is on, never surface as a
 * wrong write-time decision.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import os from 'os';
import path from 'path';
import fs from 'fs';

import { validateSwitchoverAtStartup } from '../../src/index.js';
import { resetSwitchoverCache } from '../../src/config/switchover.js';
import logger from '../../src/utils/logger.js';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const REAL_SWITCHOVER_PATH = join(__dirname, '..', '..', 'config', 'switchover.json');

const tmpFiles: string[] = [];

function writeTmpSwitchover(content: unknown): string {
  const filePath = path.join(
    os.tmpdir(),
    `switchover-startup-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(content), 'utf-8');
  tmpFiles.push(filePath);
  return filePath;
}

// A "flipped" entry naming no group — fails the cross-check switchover.ts adds after the zod
// schema passes, exactly like field-manifest-startup's MALFORMED_MANIFEST fails schema.
const MALFORMED_SWITCHOVER = {
  version: 1,
  groups: { 'issue-size': ['ipos.issue_size'] },
  flipped: ['not-a-real-group'],
  identityFields: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  resetSwitchoverCache();
  while (tmpFiles.length) {
    const f = tmpFiles.pop()!;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

describe('validateSwitchoverAtStartup (item 3 slice S1b — process-start validation)', () => {
  it('flag OFF (default, no override passed): does nothing, does not throw, even with a malformed switchover', () => {
    const malformedPath = writeTmpSwitchover(MALFORMED_SWITCHOVER);
    expect(() => validateSwitchoverAtStartup(malformedPath)).not.toThrow();
  });

  it('flag OFF explicitly: still does nothing with a malformed switchover', () => {
    const malformedPath = writeTmpSwitchover(MALFORMED_SWITCHOVER);
    expect(() => validateSwitchoverAtStartup(malformedPath, false)).not.toThrow();
  });

  it('flag ON + malformed switchover: throws', () => {
    const malformedPath = writeTmpSwitchover(MALFORMED_SWITCHOVER);
    expect(() => validateSwitchoverAtStartup(malformedPath, true)).toThrow();
  });

  it('flag ON + valid switchover (the real checked-in one): does not throw', () => {
    expect(() => validateSwitchoverAtStartup(REAL_SWITCHOVER_PATH, true)).not.toThrow();
  });

  it('ordering: validateSwitchoverAtStartup throws BEFORE logger.info logs the cycle-start line, ' +
     'when run in the guard\'s own order', () => {
    const malformedPath = writeTmpSwitchover(MALFORMED_SWITCHOVER);
    const infoSpy = vi.spyOn(logger, 'info');

    let threw = false;
    try {
      validateSwitchoverAtStartup(malformedPath, true);
      logger.info({ source: 'all' }, 'IPO Scraper CLI started');
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    expect(infoSpy).not.toHaveBeenCalledWith(expect.anything(), 'IPO Scraper CLI started');
  });

  it('is actually WIRED into the CLI guard, AFTER validateFieldManifestAtStartup and BEFORE main() ' +
     '(wire-or-retire; a real source-order check, not a paper guard)', () => {
    const src = readFileSync(join(REPO_ROOT, 'scraper', 'src', 'index.ts'), 'utf8');
    const guardMarker = 'if (import.meta.url === pathToFileURL(process.argv[1]).href) {';
    const guardStart = src.indexOf(guardMarker);
    expect(guardStart).toBeGreaterThan(-1);
    const guardBody = src.slice(guardStart, src.indexOf('\n}', guardStart));

    const manifestCallIndex = guardBody.indexOf('validateFieldManifestAtStartup(');
    const switchoverCallIndex = guardBody.indexOf('validateSwitchoverAtStartup(');
    const mainCallIndex = guardBody.indexOf('main();');

    expect(manifestCallIndex).toBeGreaterThan(-1);
    expect(switchoverCallIndex).toBeGreaterThan(-1);
    expect(mainCallIndex).toBeGreaterThan(-1);
    expect(switchoverCallIndex).toBeGreaterThan(manifestCallIndex);
    expect(switchoverCallIndex).toBeLessThan(mainCallIndex);
  });
});
