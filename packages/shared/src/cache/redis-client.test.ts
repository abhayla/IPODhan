/**
 * #719 round 3 (Tier A review, parity finding) — `resolveRedisUrlPassword`
 * is the pure precedence rule getRedisClient() uses when a REDIS_URL is set:
 * a password already embedded in the URL always wins; REDIS_PASSWORD fills
 * a password the URL does not carry. No behaviour change when the URL
 * already has the password.
 */
import { describe, it, expect } from 'vitest';
import { resolveRedisUrlPassword } from './redis-client';

describe('resolveRedisUrlPassword', () => {
  it('fills in REDIS_PASSWORD when the URL carries no password', () => {
    expect(
      resolveRedisUrlPassword('redis://127.0.0.1:6379/1', 's3cr3t-pw')
    ).toBe('s3cr3t-pw');
  });

  it('lets a password already embedded in the URL win — REDIS_PASSWORD is ignored', () => {
    expect(
      resolveRedisUrlPassword('redis://:url-pw@127.0.0.1:6379/1', 's3cr3t-pw')
    ).toBeUndefined();
  });

  it('returns undefined when REDIS_PASSWORD is not set, regardless of the URL', () => {
    expect(resolveRedisUrlPassword('redis://127.0.0.1:6379/1', undefined)).toBeUndefined();
    expect(
      resolveRedisUrlPassword('redis://:url-pw@127.0.0.1:6379/1', undefined)
    ).toBeUndefined();
  });

  it('returns undefined when REDIS_PASSWORD is the empty string', () => {
    expect(resolveRedisUrlPassword('redis://127.0.0.1:6379/1', '')).toBeUndefined();
  });

  it('falls through to REDIS_PASSWORD on an unparsable URL rather than dropping it', () => {
    expect(resolveRedisUrlPassword('not-a-valid-url', 's3cr3t-pw')).toBe('s3cr3t-pw');
  });
});
