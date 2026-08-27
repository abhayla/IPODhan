import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/calendar/materialized/[category]/route';

describe('GET /api/calendar/materialized/[category] (T-330 P2-3: retired route)', () => {
  it('returns 410 Gone instead of a 500, since calendar_view was never created in any real database', async () => {
    const res = await GET();

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error.code).toBe('ENDPOINT_RETIRED');
    expect(body.error.message).toMatch(/\/api\/calendar\/\[category\]/);
  });
});
