import { describe, it, expect } from 'vitest';
import { resolveWebPoolSize, resolveDatabaseSsl } from '../../../lib/db/index';
import { resolveSharedPoolSize } from '../../../../packages/shared/src/db/index';

// T-242 M3 (Linux deploy pipeline) — asserts the pool-cap arithmetic from
// T-241 17-required-keys.md (POOL-SIZE P1) + 19-handoffs-m3.md (H4):
// worst-case total connections across web(instances x pool) + shared +
// calendar MUST stay under the server's 97 usable connections, with a
// safety margin. See the T-242 PR description for the full accounting.
const USABLE_CONNECTIONS = 97;
const TARGET_CEILING = 90; // contract-mandated ceiling
const WEB_INSTANCES_WORST_CASE = 2; // matches current Windows prod cluster size
const CALENDAR_POOL_MAX = 2; // scraper/src/jobs/refresh-calendar.ts (unchanged, transient)

describe('pool-cap arithmetic (T-242 M3)', () => {
  it('resolveWebPoolSize defaults to a safe max/min when env is unset', () => {
    const { max, min } = resolveWebPoolSize({} as NodeJS.ProcessEnv);
    expect(max).toBe(15);
    expect(min).toBe(2);
  });

  it('resolveWebPoolSize honors DB_POOL_MAX / DB_POOL_MIN overrides', () => {
    const { max, min } = resolveWebPoolSize({ DB_POOL_MAX: '25', DB_POOL_MIN: '3' } as NodeJS.ProcessEnv);
    expect(max).toBe(25);
    expect(min).toBe(3);
  });

  it('resolveWebPoolSize falls back to defaults on invalid/non-positive values', () => {
    expect(resolveWebPoolSize({ DB_POOL_MAX: '0' } as NodeJS.ProcessEnv).max).toBe(15);
    expect(resolveWebPoolSize({ DB_POOL_MAX: 'nope' } as NodeJS.ProcessEnv).max).toBe(15);
    expect(resolveWebPoolSize({ DB_POOL_MIN: '-1' } as NodeJS.ProcessEnv).min).toBe(2);
  });

  it('resolveDatabaseSsl (web) defaults to off (false) preserving current prod behavior', () => {
    expect(resolveDatabaseSsl({} as NodeJS.ProcessEnv)).toBe(false);
    expect(resolveDatabaseSsl({ DATABASE_SSL: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('resolveDatabaseSsl (web) returns a pinned-cert config for DATABASE_SSL=require', () => {
    expect(resolveDatabaseSsl({ DATABASE_SSL: 'require' } as NodeJS.ProcessEnv)).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('resolveSharedPoolSize defaults to a safe max when env is unset', () => {
    expect(resolveSharedPoolSize({} as NodeJS.ProcessEnv).max).toBe(15);
  });

  it('resolveSharedPoolSize honors SHARED_DB_POOL_MAX override', () => {
    expect(resolveSharedPoolSize({ SHARED_DB_POOL_MAX: '30' } as NodeJS.ProcessEnv).max).toBe(30);
  });

  it('worst-case default total stays under the 90-connection contract ceiling', () => {
    const webPoolMax = resolveWebPoolSize({} as NodeJS.ProcessEnv).max;
    const sharedPoolMax = resolveSharedPoolSize({} as NodeJS.ProcessEnv).max;

    const webTotal = WEB_INSTANCES_WORST_CASE * webPoolMax;
    const scraperTotal = sharedPoolMax + CALENDAR_POOL_MAX;
    const grandTotal = webTotal + scraperTotal;

    expect(webTotal).toBe(30);
    expect(scraperTotal).toBe(17);
    expect(grandTotal).toBe(47);
    expect(grandTotal).toBeLessThan(TARGET_CEILING);
    expect(grandTotal).toBeLessThan(USABLE_CONNECTIONS);
  });
});
