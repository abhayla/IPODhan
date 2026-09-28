/**
 * P2-4 (T-300, round-5 review): `ipos.registrar_id` is never written at scrape
 * time (see registrar-reresolve.ts header) so a periodic re-resolve pass is
 * the only thing that ever backfills it for new rows. This proves
 * `reresolveRegistrarIds` actually matches + writes on a dry-run=false pass,
 * leaves genuinely-unmatched names alone, and never writes anything on a
 * dry-run pass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as schema from '@ipodhan/shared/db/schema';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const REGISTRARS = [
  { id: 'r-kfin', name: 'KFin Technologies Limited', shortName: 'KFin' },
  { id: 'r-maashitla', name: 'Maashitla Securities Private Limited', shortName: 'Maashitla' },
];

const NULL_ROWS = [
  { id: 'ipo-1', companyName: 'Alpha Ltd', registrar: 'Kfin Technologies Ltd.' }, // matches via matcher
  { id: 'ipo-2', companyName: 'Beta Ltd', registrar: 'Maashitla Securities Pvt. Ltd.' }, // matches via matcher
  { id: 'ipo-3', companyName: 'Gamma Ltd', registrar: 'Totally Unknown Registrar Pvt Ltd' }, // stays NULL
];

const updateSetMock = vi.fn().mockReturnThis();
const updateWhereMock = vi.fn().mockResolvedValue(undefined);
// §9.2 item 19: ipo ids whose registrarId an admin holds (field_protection_metadata rows).
const HELD = new Set<string>();
const holdDialect = new PgDialect();

vi.mock('@ipodhan/shared/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: (table: unknown) => {
        const data =
          table === schema.registrars ? REGISTRARS : table === schema.ipos ? NULL_ROWS : null;
        if (data === null) throw new Error('unexpected table in mocked select');
        // registrars is `select().from()` with no `.where()`; ipos is
        // `select().from().where()` — return something both awaitable
        // directly AND chainable with `.where()`.
        const thenable = Promise.resolve(data) as Promise<typeof data> & { where: () => Promise<typeof data> };
        thenable.where = () => Promise.resolve(data);
        return thenable;
      },
    })),
    update: vi.fn(() => ({
      set: (values: unknown) => {
        updateSetMock(values);
        return { where: updateWhereMock };
      },
    })),
    // item 19: the write runs in a transaction that locks the ipos row and re-reads the hold.
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const tx = {
        update: (this as unknown as { update: unknown }).update,
        execute: async (q: SQL) => {
          const { sql: text, params } = holdDialect.sqlToQuery(q);
          const id = params[0] as string;
          if (/FOR NO KEY UPDATE/.test(text)) return { rows: [{ id, scraper_locked: false }] };
          return { rows: HELD.has(id) ? [{ ipo_id: id, field_name: 'registrarId' }] : [] };
        },
      };
      return fn(tx);
    },
  },
}));

import { reresolveRegistrarIds } from '../../../src/services/registrar-reresolve';

describe('reresolveRegistrarIds', () => {
  beforeEach(() => {
    updateSetMock.mockClear();
    updateWhereMock.mockClear();
  });

  it('dry-run computes the match plan without writing', async () => {
    const result = await reresolveRegistrarIds({ dryRun: true });

    expect(result.candidates).toBe(3);
    expect(result.matched).toBe(2);
    expect(result.written).toBe(0);
    expect(result.unmatchedNames).toEqual(['Totally Unknown Registrar Pvt Ltd']);
    expect(updateWhereMock).not.toHaveBeenCalled();
  });

  it('apply (dryRun: false) writes registrar_id only for matched rows', async () => {
    const result = await reresolveRegistrarIds({ dryRun: false });

    expect(result.written).toBe(2);
    expect(updateWhereMock).toHaveBeenCalledTimes(2);
    expect(updateSetMock).toHaveBeenCalledWith({ registrarId: 'r-kfin' });
    expect(updateSetMock).toHaveBeenCalledWith({ registrarId: 'r-maashitla' });
  });

  it('item 19: an admin-held registrarId is not backfilled (re-read inside the write transaction)', async () => {
    HELD.add('ipo-1');
    try {
      const result = await reresolveRegistrarIds({ dryRun: false });
      expect(result.written).toBe(1);
      expect(updateSetMock).toHaveBeenCalledTimes(1);
      expect(updateSetMock).toHaveBeenCalledWith({ registrarId: 'r-maashitla' });
    } finally {
      HELD.clear();
    }
  });

  it('defaults to dry-run when no options are passed', async () => {
    const result = await reresolveRegistrarIds();
    expect(result.written).toBe(0);
    expect(updateWhereMock).not.toHaveBeenCalled();
  });
});
