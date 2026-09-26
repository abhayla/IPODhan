/**
 * W-79 — the data_conflicts write door refuses same-source rows.
 *
 * T-286/P1-2 found `source1 === source2` self-comparison rows made up 9,921
 * of 11,493 data_conflicts rows and flooded the alert channel. That invariant
 * lived only in callers' `if`s (documented in
 * `scraper/src/services/data-consolidation-service.ts` ~L1358-1369); the
 * W-14 pass reintroduced the shape because nothing in the repository itself
 * enforced it. This test proves the repository is now the enforcement point:
 * a same-source row is refused before any insert/update reaches the db, and
 * a genuine cross-source row still writes exactly as before.
 *
 * The db is a hand-rolled chainable mock (the drizzle query builder shape),
 * so this stays a unit test -- no Postgres, no Redis.
 */
import { describe, it, expect, vi } from 'vitest';
import { DataConflictsRepository } from './data-conflicts-repository';

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa9a93';

function makeDb(selectResult: any[] = []) {
  const whereArgs: any[] = [];
  const insertValues: any[] = [];
  const updateSets: any[] = [];

  const db: any = {
    select: vi.fn(() => {
      const chain: any = {
        from: () => chain,
        where: (w: any) => {
          whereArgs.push(w);
          return chain;
        },
        limit: () => Promise.resolve(selectResult),
        then: (resolve: any, reject: any) =>
          Promise.resolve(selectResult).then(resolve, reject),
      };
      return chain;
    }),
    insert: vi.fn(() => {
      const chain: any = {
        values: (v: any) => {
          insertValues.push(v);
          return chain;
        },
        returning: () => Promise.resolve([{ id: 'row-1', ...insertValues[insertValues.length - 1] }]),
      };
      return chain;
    }),
    update: vi.fn(() => {
      const chain: any = {
        set: (s: any) => {
          updateSets.push(s);
          return chain;
        },
        where: (w: any) => {
          whereArgs.push(w);
          return chain;
        },
        returning: () => Promise.resolve([{ id: 'row-1', ...updateSets[updateSets.length - 1] }]),
      };
      return chain;
    }),
  };

  return { db, whereArgs, insertValues, updateSets };
}

function makeRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
  } as any;
}

function makeRepo(selectResult: any[] = []) {
  const { db, whereArgs, insertValues, updateSets } = makeDb(selectResult);
  const redis = makeRedis();
  return { repo: new DataConflictsRepository(db, redis), db, whereArgs, insertValues, updateSets };
}

const baseInput = {
  ipoId: IPO_ID,
  tableName: 'ipos',
  fieldName: 'issueSize',
  value1: '100',
  value2: '200',
} as const;

describe('DataConflictsRepository.upsertConflict — same-source refusal (W-79)', () => {
  it('refuses a same-source row and never inserts or updates', async () => {
    const { repo, db } = makeRepo();

    const result = await repo.upsertConflict({
      ...baseInput,
      source1: 'NSE',
      source2: 'NSE',
    });

    expect(result).toEqual({ skipped: true, reason: 'same_source' });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('still inserts a genuine cross-source row (no existing open conflict)', async () => {
    const { repo, insertValues } = makeRepo([]);

    const result = await repo.upsertConflict({
      ...baseInput,
      source1: 'NSE',
      source2: 'BSE',
    });

    expect('skipped' in (result as any)).toBe(false);
    expect(insertValues).toHaveLength(1);
    expect(insertValues[0].source1).toBe('NSE');
    expect(insertValues[0].source2).toBe('BSE');
  });

  it('still updates the existing open conflict for a genuine cross-source row', async () => {
    const { repo, updateSets } = makeRepo([{ id: 'existing-row' }]);

    const result = await repo.upsertConflict({
      ...baseInput,
      source1: 'NSE',
      source2: 'BSE',
    });

    expect('skipped' in (result as any)).toBe(false);
    expect(updateSets).toHaveLength(1);
    expect(updateSets[0].source1).toBe('NSE');
    expect(updateSets[0].source2).toBe('BSE');
  });
});

describe('DataConflictsRepository.logConflict — same-source refusal (W-79)', () => {
  it('refuses a same-source row and never inserts', async () => {
    const { repo, db } = makeRepo();

    const result = await repo.logConflict({
      ...baseInput,
      source1: 'CHITTORGARH',
      source2: 'CHITTORGARH',
    });

    expect(result).toEqual({ skipped: true, reason: 'same_source' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('still inserts a genuine cross-source row', async () => {
    const { repo, insertValues } = makeRepo();

    const result = await repo.logConflict({
      ...baseInput,
      source1: 'CHITTORGARH',
      source2: 'MONEYCONTROL',
    });

    expect('skipped' in (result as any)).toBe(false);
    expect(insertValues).toHaveLength(1);
  });
});

describe('DataConflictsRepository — bookkeeping and unnamed fields are never a conflict (#818, F-181)', () => {
  // Staging 2026-09-23..25: lastScrapedAt / updatedAt DRHP-vs-DRHP rows (moneyview-ltd,
  // skyways-air-services-ltd, steamhouse-india-ltd, veegaland-developers-ltd).
  it.each(['lastScrapedAt', 'updatedAt', 'createdAt'])(
    'upsertConflict refuses %s (even as a cross-source row) and never touches the db',
    async (fieldName) => {
      const { repo, db } = makeRepo();
      const res = await repo.upsertConflict({
        ...baseInput,
        fieldName,
        source1: 'DRHP',
        source2: 'NSE',
        value1: '2026-09-23T10:00:00.000Z',
        value2: '2026-09-24T10:00:00.000Z',
      });
      expect(res).toEqual({ skipped: true, reason: 'bookkeeping_field' });
      expect(db.select).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    }
  );

  it('logConflict refuses a bookkeeping field under the OD-75 reason too', async () => {
    const { repo, db } = makeRepo();
    const res = await repo.logConflict({
      ...baseInput,
      fieldName: 'lastScrapedAt',
      source1: 'DRHP',
      source2: 'DRHP',
      resolutionReason: 'SOURCE_CHANGED_OWN_VALUE',
    });
    expect(res).toEqual({ skipped: true, reason: 'bookkeeping_field' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'UNKNOWN', '', '  '])('refuses an unnamed field %j', async (fieldName) => {
    const { repo, db } = makeRepo();
    const res = await repo.upsertConflict({ ...baseInput, fieldName, source1: 'DRHP', source2: 'NSE' });
    expect(res).toEqual({ skipped: true, reason: 'unnamed_field' });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('a genuine cross-source disagreement on a named field still inserts exactly one row', async () => {
    const { repo, db, insertValues } = makeRepo();
    await repo.upsertConflict({ ...baseInput, source1: 'CHITTORGARH', source2: 'BSE', value1: '428300000.00', value2: '420000000' });
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(insertValues[0]).toMatchObject({
      fieldName: 'issueSize',
      source1: 'CHITTORGARH',
      value1: '428300000.00',
      source2: 'BSE',
      value2: '420000000',
    });
  });
});
