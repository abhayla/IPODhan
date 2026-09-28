import { describe, it, expect } from 'vitest';
import { writeAdminFieldValue, coerceForColumn, type AdminFieldWriteInput } from './admin-field-write';

const untouchable = new Proxy({}, { get: () => { throw new Error('db touched before validation finished'); } }) as never;
const base: AdminFieldWriteInput = {
  ipoId: 'i', tableName: 'ipos', fieldName: 'registrar', value: 'X',
  mode: { kind: 'typed', sourceNote: 'RHP p1' }, expectedVersion: 'v', actor: { name: 'a', adminId: 'admin-t1' }, entryPoint: 't',
};

describe('writeAdminFieldValue refuses before opening a transaction', () => {
  it.each([
    [{ tableName: 'subscriptions' }, 'not admin-writable'],
    [{ fieldName: 'nope' }, 'has no field nope'],
    [{ fieldName: 'scraperLocked' }, 'not editable'],
    [{ expectedVersion: '' }, 'stale editor, reload'],
    [{ mode: { kind: 'typed', sourceNote: '' } }, 'source note'],
    [{ mode: { kind: 'pick', sourceLabel: '' } }, 'source label'],
    [{ mode: { kind: 'storedPick', sourceLabel: '', readDate: null, value: 'x' } }, 'source label'],
    [{ fieldName: 'lotSize', mode: { kind: 'storedPick', sourceLabel: 'DOC', readDate: null, value: 'twelve' } }, 'expected a whole number'],
    [{ empty: { reason: '' } }, 'needs a reason'],
    [{ fieldName: 'lotSize', value: 'twelve' }, 'expected a whole number'],
    [{ actor: { name: 'a', adminId: '' } }, 'admin id is required'],
    [{ actor: { name: 'a', adminId: null } }, 'admin id is required'],
    [{ tableName: 'anchor_investors', fieldName: 'investorName' }, 'not admin-writable'],
    [{ tableName: 'peer_companies', fieldName: 'peRatio' }, 'name the row'],
    [{ row: { recordId: 'r' } }, 'one row per IPO'],
    [{ tableName: 'peer_companies', row: { recordId: 'r' }, fieldName: 'normalizedName' }, 'not editable'],
    [{ mode: { kind: 'holdShown' }, empty: { reason: 'x' } }, 'cannot also delete'],
  ] as const)('%o -> INVALID (%s)', async (over, text) => {
    const r = await writeAdminFieldValue(untouchable, { ...base, ...(over as object) } as AdminFieldWriteInput);
    expect(r.kind).toBe('INVALID');
    expect((r as { reason: string }).reason).toContain(text);
  });

  it('OD-108: a typed value failing the check is refused without an override reason', async () => {
    const r = await writeAdminFieldValue(untouchable, base, () => 'outside the SEBI window');
    expect(r).toEqual({ kind: 'INVALID', reason: 'ipos.registrar fails its check: outside the SEBI window. Save again with a written reason to keep it.' });
  });
});

describe('coerceForColumn (ist-timezone: timestamp() takes a Date, date/numeric take strings)', () => {
  it('maps each column type exactly', () => {
    expect(coerceForColumn('PgInteger', '12')).toEqual({ ok: true, value: 12 });
    expect(coerceForColumn('PgNumeric', 875000000)).toEqual({ ok: true, value: '875000000' });
    expect(coerceForColumn('PgDateString', '2026-09-28')).toEqual({ ok: true, value: '2026-09-28' });
    const ts = coerceForColumn('PgTimestamp', '2026-09-28T05:00:00Z');
    expect(ts.ok && (ts.value as Date).toISOString()).toBe('2026-09-28T05:00:00.000Z');
    expect(coerceForColumn('PgBoolean', 'yes').ok).toBe(false);
    expect(coerceForColumn('PgDateString', '28/09/2026').ok).toBe(false);
    expect(coerceForColumn('PgInteger', null)).toEqual({ ok: true, value: null });
  });
});
