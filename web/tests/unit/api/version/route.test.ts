import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '../../../../app/api/version/route';

describe('GET /api/version (T-242 M3 deployed-SHA endpoint)', () => {
  const originalSha = process.env.NEXT_PUBLIC_BUILD_SHA;
  const originalBuiltAt = process.env.NEXT_PUBLIC_BUILT_AT;

  afterEach(() => {
    if (originalSha === undefined) delete process.env.NEXT_PUBLIC_BUILD_SHA;
    else process.env.NEXT_PUBLIC_BUILD_SHA = originalSha;
    if (originalBuiltAt === undefined) delete process.env.NEXT_PUBLIC_BUILT_AT;
    else process.env.NEXT_PUBLIC_BUILT_AT = originalBuiltAt;
  });

  it('returns the baked SHA + build timestamp when set', async () => {
    process.env.NEXT_PUBLIC_BUILD_SHA = 'abc1234';
    process.env.NEXT_PUBLIC_BUILT_AT = '2026-08-21T04:00:00Z';

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: { sha: 'abc1234', builtAt: '2026-08-21T04:00:00Z' },
    });
  });

  it('falls back to "unknown"/null when not baked (e.g. local dev build)', async () => {
    delete process.env.NEXT_PUBLIC_BUILD_SHA;
    delete process.env.NEXT_PUBLIC_BUILT_AT;

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { sha: 'unknown', builtAt: null } });
  });
});
