/**
 * T-228 (part 3): the Investorgain GMP orchestrator called the shared field-
 * protection helpers with the WRONG ARITY.
 *
 * `isIPOLocked(ipoId, db, redis)` and `filterProtectedFields(ipoId, table,
 * data, scraperName, db, redis)` are legacy free functions that construct a
 * FieldProtectionService per call - they need `db` and `redis` threaded in.
 * The orchestrator called `isIPOLocked(ipoId)` with one argument, so `db` was
 * `undefined` and the service threw "Cannot read properties of undefined
 * (reading 'select')". The catch fails OPEN, so every GMP write logged
 * "Error checking GMP protection - allowing creation to be safe" and bypassed
 * protection entirely - an admin-locked IPO's GMP could be overwritten by the
 * scraper. It stayed invisible while the Investorgain source was dead (0 GMPs
 * written = 0 protection checks); reviving the source surfaced it 24x/cycle.
 *
 * The fix routes through `createFieldProtectionService(db, redis)` - the
 * pattern BaseScraperOrchestrator already uses, and the one required by
 * .claude/rules/admin-field-protection.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createFieldProtectionService,
  FieldProtectionService,
} from '@ipodhan/shared';

const here = dirname(fileURLToPath(import.meta.url));
const orchestratorSrc = readFileSync(
  join(here, '../../src/scrapers/investorgain-gmp-orchestrator-v2.ts'),
  'utf-8'
);

describe('T-228 / GMP protection is checked through the shared service', () => {
  it('does not call the legacy free functions that need db+redis threaded in', () => {
    expect(orchestratorSrc).not.toMatch(/await\s+isIPOLocked\(/);
    expect(orchestratorSrc).not.toMatch(/await\s+filterProtectedFields\(/);
  });

  it('builds the protection service from db + redis via the factory', () => {
    expect(orchestratorSrc).toContain('createFieldProtectionService(db, getRedisClient())');
    expect(orchestratorSrc).toContain('service.isIPOLocked(ipoId)');
    expect(orchestratorSrc).toContain('service.filterProtectedFields(');
  });

  it('reads the surviving fields off .filtered, not off the result object', () => {
    // filterProtectedFields returns FilterProtectedFieldsResult
    // ({ filtered, skipped, allFieldsProtected, ipoLocked }); counting keys on
    // the result itself would always be 4 and never detect protection.
    expect(orchestratorSrc).toContain('const filteredData = filterResult.filtered;');
  });

  it('the factory yields a service exposing both protection checks', () => {
    const service = createFieldProtectionService({} as never, null);
    expect(service).toBeInstanceOf(FieldProtectionService);
    expect(typeof service.isIPOLocked).toBe('function');
    expect(typeof service.filterProtectedFields).toBe('function');
  });
});
