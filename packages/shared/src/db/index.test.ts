import { describe, it, expect } from 'vitest';
import { resolvePgConnectionTimeoutMs } from './index';

// W-20 — over the dev SSH tunnel (ipodhan_test) a 52-row insert killed the
// pool at the 2000ms prod default unless PG_CONNECTION_TIMEOUT_MS=20000 was
// set by hand. Fix: 2000 stays for NODE_ENV=production (byte-for-byte
// unchanged); any other/unset NODE_ENV defaults to 20000. An explicit
// PG_CONNECTION_TIMEOUT_MS always wins.
describe('resolvePgConnectionTimeoutMs (W-20)', () => {
  it('defaults to 2000 in production with the env var unset', () => {
    expect(
      resolvePgConnectionTimeoutMs({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)
    ).toBe(2000);
  });

  it('defaults to 20000 in development/test/unset NODE_ENV with the env var unset', () => {
    expect(
      resolvePgConnectionTimeoutMs({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)
    ).toBe(20000);
    expect(resolvePgConnectionTimeoutMs({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(20000);
    expect(resolvePgConnectionTimeoutMs({} as NodeJS.ProcessEnv)).toBe(20000);
  });

  it('an explicit PG_CONNECTION_TIMEOUT_MS wins in production', () => {
    expect(
      resolvePgConnectionTimeoutMs({
        NODE_ENV: 'production',
        PG_CONNECTION_TIMEOUT_MS: '5000',
      } as NodeJS.ProcessEnv)
    ).toBe(5000);
  });

  it('an explicit PG_CONNECTION_TIMEOUT_MS wins in development', () => {
    expect(
      resolvePgConnectionTimeoutMs({
        NODE_ENV: 'development',
        PG_CONNECTION_TIMEOUT_MS: '5000',
      } as NodeJS.ProcessEnv)
    ).toBe(5000);
  });

  it('falls back to the env-appropriate default on a non-numeric PG_CONNECTION_TIMEOUT_MS', () => {
    expect(
      resolvePgConnectionTimeoutMs({
        NODE_ENV: 'production',
        PG_CONNECTION_TIMEOUT_MS: 'nope',
      } as NodeJS.ProcessEnv)
    ).toBe(2000);
    expect(
      resolvePgConnectionTimeoutMs({
        NODE_ENV: 'development',
        PG_CONNECTION_TIMEOUT_MS: 'nope',
      } as NodeJS.ProcessEnv)
    ).toBe(20000);
  });
});
