import { describe, it, expect } from 'vitest';
import { resolvePgConnectionTimeoutMs, resolveDiscreteDbParams } from './index';

// #640 — DATABASE_HOST + DATABASE_PASSWORD set but DATABASE_NAME/DATABASE_USER
// missing silently defaulted to the PRODUCTION database name ('ipodhan') and
// the superuser ('postgres'). A script or env that forgets either variable
// must fail loudly, naming which one, never connect to prod as postgres.
describe('resolveDiscreteDbParams (#640)', () => {
  const base = {
    DATABASE_HOST: 'db.example.internal',
    DATABASE_PASSWORD: 'secret',
  } as unknown as NodeJS.ProcessEnv;

  it('throws naming DATABASE_NAME when it is missing', () => {
    expect(() => resolveDiscreteDbParams(base)).toThrow(/DATABASE_NAME/);
  });

  it('throws naming DATABASE_USER when it is missing', () => {
    expect(() =>
      resolveDiscreteDbParams({ ...base, DATABASE_NAME: 'ipodhan_staging' } as NodeJS.ProcessEnv)
    ).toThrow(/DATABASE_USER/);
  });

  it('returns the params unchanged when everything is set', () => {
    const params = resolveDiscreteDbParams({
      ...base,
      DATABASE_NAME: 'ipodhan_staging',
      DATABASE_USER: 'ipodhan_app',
      DATABASE_PORT: '5433',
    } as NodeJS.ProcessEnv);
    expect(params).toEqual({
      host: 'db.example.internal',
      port: 5433,
      database: 'ipodhan_staging',
      user: 'ipodhan_app',
      password: 'secret',
    });
  });

  it('defaults the port to 5432 when unset', () => {
    const params = resolveDiscreteDbParams({
      ...base,
      DATABASE_NAME: 'ipodhan_staging',
      DATABASE_USER: 'ipodhan_app',
    } as NodeJS.ProcessEnv);
    expect(params.port).toBe(5432);
  });
});

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
