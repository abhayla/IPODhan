/**
 * requireAdminAuth must never log a bare token from a malformed Authorization
 * header.
 *
 * RCA: the malformed-header warn line logs `scheme="${parts[0]}"`. When a
 * client sends a header with no space (a bare token, no "Bearer " prefix),
 * `authorization.split(' ')` returns a single element and parts[0] IS the
 * token itself, so the full secret was written to the server log.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let currentHeaders = new Headers();
vi.mock('next/headers', () => ({ headers: async () => currentHeaders }));

describe('requireAdminAuth never logs a bare token from a malformed header', () => {
  const saved = { ...process.env };
  const BARE_TOKEN = 'a'.repeat(40);

  beforeEach(() => {
    process.env.ADMIN_API_TOKEN = 'b'.repeat(64);
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('does not print the token string in any console.warn argument', async () => {
    vi.resetModules();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      currentHeaders = new Headers({ authorization: BARE_TOKEN });
      const { requireAdminAuth } = await import('@/lib/auth/admin-auth');
      const res = await requireAdminAuth();

      expect(res).not.toBeNull();
      expect(res!.status).toBe(401);

      for (const call of warnSpy.mock.calls) {
        for (const arg of call) {
          const text = typeof arg === 'string' ? arg : JSON.stringify(arg);
          expect(text).not.toContain(BARE_TOKEN);
        }
      }
    } finally {
      warnSpy.mockRestore();
    }
  });
});
