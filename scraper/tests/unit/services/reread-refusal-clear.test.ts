// implements: OD-153 (spec §5.3 rule 4 on the stored value; #1247 item 3): a re-read of the SAME
// document by a newer extractor that REFUSES a stored value clears it with the refusal as its reason
// (OD-62) and reopens the plan row; admin-held values are never cleared.
import { describe, it, expect, vi } from 'vitest';
import {
  clearRefusedStoredValues,
  isOlderReadOfSameDocument,
  type RereadRefusalClearDeps,
  type RereadRefusalInput,
} from '../../../src/services/reread-refusal-clear.js';

const IPO = '00000000-0000-4000-8000-000000153001';
const DOC = '00000000-0000-4000-8000-000000153d0c';

function input(over: Partial<RereadRefusalInput> = {}): RereadRefusalInput {
  return {
    ipoId: IPO,
    docType: 'DRHP',
    documentId: DOC,
    sourceSha: 'a'.repeat(64),
    extractorVersion: 'v2',
    fields: { inventory_turnover: { value: 23.14, check: { passed: false, detail: 'ratio_latest_period_not_in_headings' } } },
    ...over,
  };
}

function deps(over: Partial<RereadRefusalClearDeps> = {}) {
  const d = {
    findProvenance: vi.fn(async () => ({ source: 'DRHP', dataLineage: { documentId: DOC, extractorVersion: 'v1' } })),
    readStored: vi.fn(async () => '23.14'),
    isHeld: vi.fn(async () => false),
    clear: vi.fn(async () => undefined),
    recordReason: vi.fn(async () => undefined),
    reopenPlanRows: vi.fn(async () => ['plan-1']),
    ...over,
  };
  return d;
}

describe('OD-153 clearRefusedStoredValues', () => {
  it('clears the German Green shape: older reader of the same DRHP stored 23.14, the newer reader refuses it', async () => {
    const d = deps();
    const r = await clearRefusedStoredValues(input(), d);
    expect(r.cleared).toEqual(['financial_data.inventoryTurnover']);
    expect(d.clear).toHaveBeenCalledWith(IPO, 'financial_data', 'inventoryTurnover');
    expect(d.recordReason).toHaveBeenCalledTimes(1);
    const reason = (d.recordReason.mock.calls[0] as unknown as [{ cause: string; fieldName: string }])[0];
    expect(reason.fieldName).toBe('inventoryTurnover');
    expect(reason.cause).toMatch(/^OD-153: DRHP re-read \(extractor v2\) refused inventory_turnover; stored 23\.14 from extractor v1 .*ratio_latest_period_not_in_headings$/);
    expect(d.reopenPlanRows).toHaveBeenCalledWith(IPO, DOC, [{ tableName: 'financial_data', column: 'inventoryTurnover' }], expect.stringMatching(/^OD-153/));
    expect(r.reopenedPlanRowIds).toEqual(['plan-1']);
  });

  it('never clears an admin-held value', async () => {
    const d = deps({ isHeld: vi.fn(async () => true) });
    const r = await clearRefusedStoredValues(input(), d);
    expect(r.held).toEqual(['financial_data.inventoryTurnover']);
    expect(d.clear).not.toHaveBeenCalled();
    expect(d.reopenPlanRows).not.toHaveBeenCalled();
  });

  it('a MISS (field absent, or present with a passing check) clears nothing', async () => {
    for (const fields of [{}, { inventory_turnover: { value: 5, check: { passed: true } } }, { inventory_turnover: { value: null } }]) {
      const d = deps();
      await clearRefusedStoredValues(input({ fields }), d);
      expect(d.clear).not.toHaveBeenCalled();
    }
  });

  it('keeps a value from a DIFFERENT document, another source, or the same extractor version', async () => {
    for (const prov of [
      { source: 'DRHP', dataLineage: { documentId: 'other-doc', sourceSha: 'b'.repeat(64), extractorVersion: 'v1' } },
      { source: 'CHITTORGARH', dataLineage: { documentId: DOC, extractorVersion: 'v1' } },
      { source: 'DRHP', dataLineage: { documentId: DOC, extractorVersion: 'v2' } },
      null,
    ]) {
      const d = deps({ findProvenance: vi.fn(async () => prov) });
      const r = await clearRefusedStoredValues(input(), d);
      expect(d.clear).not.toHaveBeenCalled();
      expect(r.kept).toEqual(['financial_data.inventoryTurnover']);
    }
  });

  it('same document by sha when the lineage has no document id; unknown current version fails closed', () => {
    const prov = { source: 'DRHP', dataLineage: { sourceSha: 'a'.repeat(64), extractorVersion: null } };
    expect(isOlderReadOfSameDocument(prov, { documentId: null, sourceSha: 'a'.repeat(64), extractorVersion: 'v2' })).toBe(true);
    expect(isOlderReadOfSameDocument(prov, { documentId: null, sourceSha: 'a'.repeat(64), extractorVersion: null })).toBe(false);
  });

  it('an already-empty stored value is not cleared again', async () => {
    const d = deps({ readStored: vi.fn(async () => null) });
    await clearRefusedStoredValues(input(), d);
    expect(d.clear).not.toHaveBeenCalled();
    expect(d.recordReason).not.toHaveBeenCalled();
  });
});
