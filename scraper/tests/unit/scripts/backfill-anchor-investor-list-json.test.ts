import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { assertTestDatabase } from '../../../scripts/backfill-anchor-investor-list-json.js';

/**
 * W-52 production backfill prerequisite (ledger section 6c step 4c).
 *
 * `assertTestDatabase` refuses any non-`_test` database by default; an
 * explicit `--allow-prod` flag (surfaced here as `allowProd: true`) lets it
 * proceed against production for the owner-approved section 6c backfill,
 * printing a clear `ALLOW-PROD:` line so the run is visible in logs.
 */
describe('assertTestDatabase (W-52 --allow-prod)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_NAME;
    delete process.env.PGDATABASE;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('refuses a non-_test database by default (no --allow-prod)', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@host:5432/ipodhan';
    expect(() => assertTestDatabase(false)).toThrow(/does not end in _test/);
  });

  it('proceeds against a non-_test database when allowProd is true, and logs the ALLOW-PROD line', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@host:5432/ipodhan';
    const logSpy: string[] = [];
    const originalLog = console.log;
    console.log = (msg?: unknown) => {
      logSpy.push(String(msg));
    };
    try {
      expect(() => assertTestDatabase(true)).not.toThrow();
    } finally {
      console.log = originalLog;
    }
    expect(logSpy.some((line) => /^ALLOW-PROD: running against ipodhan \(owner-approved production backfill, section 6c\)$/.test(line))).toBe(true);
  });

  it('still proceeds for a _test database when allowProd is false (unchanged default behaviour)', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@host:5432/ipodhan_test';
    expect(() => assertTestDatabase(false)).not.toThrow();
  });
});
