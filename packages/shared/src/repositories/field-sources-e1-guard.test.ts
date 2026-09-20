/**
 * #862: 79 E-1 (exchange-stated) fields were written from the DRHP on staging —
 * 22 timetable dates and 8 IPO statuses, from a DRAFT prospectus that cannot
 * contain final dates at all.
 *
 * The ten E-1 fields (manifest class `T`) are the exchange's to state: open,
 * close, listing, allotment, refund and credit dates, plus status and
 * listing_exchanges. A document may PRINT an intended date; only the exchange's
 * own page says what it IS.
 *
 * The rule existed only as manifest capability metadata and as a validator on
 * ADMIN OVERRIDES (field-source-override-validation.ts:80). Nothing guarded the
 * write itself, which is how 79 of them landed. This drives the REAL method
 * with a stub db, in the same shape as field-sources-conflict-target.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { FieldSourcesRepository } from './field-sources-repository';

function makeStubDb() {
  const returning = vi.fn().mockResolvedValue([{ id: 'row-1', rowKey: '' }]);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  const db = { insert, select: vi.fn(), update: vi.fn(), delete: vi.fn(), execute: vi.fn() } as unknown as never;
  return { db, insert, values };
}

const stubRedis = {
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  del: vi.fn().mockResolvedValue(0),
  keys: vi.fn().mockResolvedValue([]),
} as unknown as never;

const base = { ipoId: '11111111-1111-1111-1111-111111111111', tableName: 'ipos', rowKey: '' };

describe('FieldSourcesRepository.trackFieldUpdate — E-1 fields reject document sources (#862)', () => {
  // The eight field/source pairs measured on staging, plus the two E-1 fields
  // that happened not to be hit. The class is every E-1 field, not the sample.
  const E1_CAMEL = [
    'openDate', 'closeDate', 'listingDate', 'status', 'listingExchanges',
    'allotmentDate', 'basisOfAllotmentDate', 'initiationOfRefundsDate',
    'creditOfSharesDate', 'bidDate',
  ];

  for (const fieldName of E1_CAMEL) {
    it(`refuses a DRHP write to ${fieldName}`, async () => {
      const { db, insert } = makeStubDb();
      const repo = new FieldSourcesRepository(db, stubRedis);
      await expect(
        repo.trackFieldUpdate({ ...base, fieldName, source: 'DRHP' as never })
      ).rejects.toThrow(/E-1/);
      expect(insert).not.toHaveBeenCalled();
    });
  }

  it('refuses DOC as well as DRHP — the class is the document PATH, not one document type', async () => {
    const { db, insert } = makeStubDb();
    const repo = new FieldSourcesRepository(db, stubRedis);
    await expect(
      repo.trackFieldUpdate({ ...base, fieldName: 'openDate', source: 'DOC' as never })
    ).rejects.toThrow(/E-1/);
    expect(insert).not.toHaveBeenCalled();
  });

  it('ALLOWS the exchange to write an E-1 field — the guard must not break the legitimate path', async () => {
    const { db, insert } = makeStubDb();
    const repo = new FieldSourcesRepository(db, stubRedis);
    await repo.trackFieldUpdate({ ...base, fieldName: 'openDate', source: 'NSE' as never });
    expect(insert).toHaveBeenCalled();
  });

  it('ALLOWS a document to write a NON-E-1 field — 162 of the 190 fields are document-sourced', async () => {
    const { db, insert } = makeStubDb();
    const repo = new FieldSourcesRepository(db, stubRedis);
    await repo.trackFieldUpdate({ ...base, fieldName: 'issueSize', source: 'DRHP' as never });
    expect(insert).toHaveBeenCalled();
  });

  it('ALLOWS ADMIN to write an E-1 field — a human override is not the document path', async () => {
    const { db, insert } = makeStubDb();
    const repo = new FieldSourcesRepository(db, stubRedis);
    await repo.trackFieldUpdate({ ...base, fieldName: 'status', source: 'ADMIN' as never });
    expect(insert).toHaveBeenCalled();
  });
});
