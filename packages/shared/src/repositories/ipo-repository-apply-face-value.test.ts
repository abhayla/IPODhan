/**
 * Lane C item 2 slice 6: `IPORepository.applyFaceValue` must update ONLY the
 * `face_value` column (never `price_range_min`/`price_range_max`/anything
 * else), mirroring `applyOfferTerms`'s scoped-write guarantee. This test
 * exercises the REAL `update()` transaction body against a fake `db` that
 * records exactly which columns were passed to `.set()`.
 */
import { describe, it, expect } from 'vitest';
import { IPORepository } from './ipo-repository';

const IPO_ID = '33333333-3333-3333-3333-333333333333';

function buildFakeDb() {
  const setCalls: Record<string, unknown>[] = [];
  const row = { id: IPO_ID, slug: 'stanbik-agro-ltd', faceValue: 10 };
  const db = {
    update: () => ({
      set: (data: Record<string, unknown>) => {
        setCalls.push(data);
        return {
          where: () => ({
            returning: async () => [{ ...row, ...data }],
          }),
        };
      },
    }),
  };
  return { db, setCalls };
}

describe('IPORepository.applyFaceValue', () => {
  it('updates only faceValue (plus updatedAt) — no priceRangeMin/Max, no issueSize, no lotSize', async () => {
    const { db, setCalls } = buildFakeDb();
    const repo = new IPORepository(db as never, { del: async () => undefined } as never);

    const result = await repo.applyFaceValue(IPO_ID, 10);

    expect(setCalls).toHaveLength(1);
    const written = setCalls[0];
    const keys = Object.keys(written).sort();
    expect(keys).toEqual(['faceValue', 'updatedAt'].sort());
    expect(written.faceValue).toBe(10);
    expect(result.faceValue).toBe(10);
  });
});
