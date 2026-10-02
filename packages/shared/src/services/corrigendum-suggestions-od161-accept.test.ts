/**
 * PR #1463 fix round (item 41, OD-161): accepting an OD-161 document listing for ANY field the document
 * outranks a website on (lotSize, priceRangeMax, ...) writes the document value through the ONE admin write
 * (writeAdminFieldValue: §2.7 rules, OD-73 no-op, ADMIN-held behaviour) instead of returning
 * "suggestion names no writable field". A corrigendum row still routes through its own three-field map.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { acceptCorrigendumSuggestion, isDocumentOwnRecordListing } from './corrigendum-suggestions';
import * as adminFieldWrite from './admin-field-write';

const writeSpy = vi.spyOn(adminFieldWrite, 'writeAdminFieldValue');

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'set', 'returning']) c[m] = vi.fn(() => c);
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return c;
}
function stubDb(openRow: Record<string, unknown>) {
  const select = vi.fn(() => chain([openRow]));
  const update = vi.fn(() => chain([{ id: openRow.id }]));
  const tx = { select, update };
  const transaction = vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb(tx));
  return { select, transaction } as unknown as never;
}
const base = { id: 'c1', ipoId: '00000000-0000-4000-8000-000000000001', tableName: 'ipos', rowKey: '', documentId: 'doc-1', value2: '2400', source1: 'NSE', value1: '1200' };
const od161 = { rule: 'OD-161', origin: 'OD161_DOCUMENT_DIFFERENCE_KEPT', documentType: 'RHP' };

describe('acceptCorrigendumSuggestion on OD-161 listings', () => {
  beforeEach(() => {
    writeSpy.mockReset();
    writeSpy.mockResolvedValue({ kind: 'OK' } as never);
  });

  it.each([['lotSize', '2400'], ['priceRangeMax', '305']])('accepts a %s listing through the admin write', async (fieldName, v) => {
    const d = await acceptCorrigendumSuggestion(stubDb({ ...base, fieldName, value2: v, evidence: od161 }), 'c1', 'a', undefined, 'tok', 'adm');
    expect(d.ok).toBe(true);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0][1]).toMatchObject({
      ipoId: base.ipoId,
      tableName: 'ipos',
      fieldName,
      mode: { kind: 'storedPick', sourceLabel: 'DOC', value: v },
      expectedVersion: 'tok',
    });
  });

  it('passes the admin write refusal through (e.g. ADMIN-held / no-op rules stay the write path\'s)', async () => {
    writeSpy.mockResolvedValue({ kind: 'REFUSED', reason: 'held' } as never);
    const d = await acceptCorrigendumSuggestion(stubDb({ ...base, fieldName: 'lotSize', evidence: od161 }), 'c1', 'a', undefined, 'tok', 'adm');
    expect(d.ok).toBe(false);
    expect(d.error).toContain('REFUSED');
  });

  const failing = { ...od161, reasonCode: 'FAILED_VALIDATION', check: 'lot rule' };

  it('a FAILED_VALIDATION accept without a written reason is refused and writes nothing', async () => {
    for (const note of [undefined, '', '   ']) {
      const db = stubDb({ ...base, fieldName: 'lotSize', value2: '-5', evidence: failing });
      const d = await acceptCorrigendumSuggestion(db, 'c1', 'a', note, 'tok', 'adm');
      expect(d.ok).toBe(false);
      expect(d.error).toContain('written reason');
      expect(writeSpy).not.toHaveBeenCalled();
      expect((db as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction).not.toHaveBeenCalled();
    }
  });

  it('a FAILED_VALIDATION accept with a written reason saves through the CHECKED (typed) path with that reason (OD-108)', async () => {
    const d = await acceptCorrigendumSuggestion(stubDb({ ...base, fieldName: 'lotSize', value2: '-5', evidence: failing }), 'c1', 'a', 'RHP page 12 prints -5 lots', 'tok', 'adm');
    expect(d.ok).toBe(true);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const input = writeSpy.mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(input).toMatchObject({ value: '-5', overrideReason: 'RHP page 12 prints -5 lots', mode: { kind: 'typed' } });
  });

  it('KEPT and REPLACED OD-161 rows keep the storedPick path and need no reason', async () => {
    for (const origin of ['OD161_DOCUMENT_DIFFERENCE_KEPT', 'OD161_DOCUMENT_REPLACED_WEBSITE_VALUE']) {
      writeSpy.mockClear();
      const d = await acceptCorrigendumSuggestion(stubDb({ ...base, fieldName: 'lotSize', evidence: { ...od161, origin } }), 'c1', 'a', undefined, 'tok', 'adm');
      expect(d.ok).toBe(true);
      expect((writeSpy.mock.calls[0][1] as unknown as { mode: { kind: string } }).mode.kind).toBe('storedPick');
    }
  });

  it('a corrigendum row is unaffected by the reason rule (no OD-161 rule, even with a reasonCode)', async () => {
    const d = await acceptCorrigendumSuggestion(stubDb({ ...base, fieldName: 'closeDate', evidence: { reasonCode: 'FAILED_VALIDATION' } }), 'c1', 'a', undefined, 'tok', 'adm');
    expect(d.ok).toBe(true);
    expect((writeSpy.mock.calls[0][1] as unknown as { mode: { kind: string } }).mode.kind).toBe('storedPick');
  });

  it('the check the accept runs does fail a bad lot size (ipoFieldCheckFailure, the write own check)', () => {
    expect(adminFieldWrite.ipoFieldCheckFailure({ priceRangeMin: 100, priceRangeMax: 110 }, 'lotSize', -5)).not.toBeNull();
  });

  it('a corrigendum row still routes through its own field map (closeDate ok, lotSize refused)', async () => {
    const ok = await acceptCorrigendumSuggestion(stubDb({ ...base, fieldName: 'closeDate', evidence: {} }), 'c1', 'a', undefined, 'tok', 'adm');
    expect(ok.ok).toBe(true);
    writeSpy.mockClear();
    const no = await acceptCorrigendumSuggestion(stubDb({ ...base, fieldName: 'lotSize', evidence: {} }), 'c1', 'a', undefined, 'tok', 'adm');
    expect(no.ok).toBe(false);
    expect(no.error).toContain('no writable field');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('predicate keys on evidence.rule', () => {
    expect(isDocumentOwnRecordListing({ evidence: od161 })).toBe(true);
    expect(isDocumentOwnRecordListing({ evidence: { origin: 'NEWER_DOCUMENT' } })).toBe(false);
  });
});
