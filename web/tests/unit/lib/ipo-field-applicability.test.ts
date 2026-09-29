import { describe, it, expect } from 'vitest';
import { hideNotApplicableFields, notApplicableFieldKeys } from '@/lib/ipo-field-applicability';
import { isEditorFieldApplicable } from '@/lib/admin/ipo-editor-fields';
import { ruleFilterFor, RULE_FILTER_LABELS } from '@/lib/admin/queue/conflict-rule-filter';
import { SOURCE_NO_LONGER_FIRST } from '@ipodhan/shared/utils/conflict-reasons';

const base = {
  segment: 'MAINBOARD',
  listingExchanges: ['NSE', 'BSE'],
  lotSize: 100,
  priceRangeMax: '100',
  faceValue: '10',
  ipoDetails: { freshIssue: '5', ofsIssue: '6' },
  financialData: { revenueFy2024: '9', eps: '1' },
  peerCompanies: [{ peRatio: '10', eps: '2' }],
};

describe('§9.2 item 18 / §1.11: not-applicable fields leave the reader payload (one rule)', () => {
  it('an IPO keeps every field', () => {
    const ipo = { ...base, offeringType: 'IPO' };
    expect(notApplicableFieldKeys(ipo)).toEqual([]);
    expect(hideNotApplicableFields(ipo)).toBe(ipo);
  });

  it('a BUYBACK loses lot size, price band, fresh issue, financials and peers; keeps face value; input untouched', () => {
    const ipo = { ...base, offeringType: 'BUYBACK' };
    const out = hideNotApplicableFields(ipo);
    expect(out).toMatchObject({ lotSize: null, priceRangeMax: null, faceValue: '10' });
    expect(out.ipoDetails).toEqual({ freshIssue: null, ofsIssue: '6' });
    expect(out.financialData).toEqual({ revenueFy2024: null, eps: null });
    expect(out.peerCompanies).toEqual([{ peRatio: null, eps: null }]);
    expect(ipo.lotSize).toBe(100);
    expect(ipo.ipoDetails.freshIssue).toBe('5');
  });

  it('an INVITS loses segment, but the rest is judged by the type BEFORE blanking', () => {
    const out = hideNotApplicableFields({ ...base, offeringType: 'INVITS' });
    expect(out.segment).toBeNull();
    expect(out.faceValue).toBeNull();
    expect(out.priceRangeMax).toBe('100');
  });

  it('the editor and the payload ask the same rule', () => {
    for (const offeringType of ['IPO', 'BUYBACK', 'NCD', 'INVITS', 'RIGHTS', 'OFS', 'TENDER', 'REITS']) {
      const hidden = new Set(notApplicableFieldKeys({ ...base, offeringType }));
      for (const key of ['ipos.lot_size', 'ipos.segment', 'ipos.face_value', 'financial_data.eps', 'ipo_details.ofs_issue']) {
        expect(isEditorFieldApplicable(key, { ...base, offeringType }), `${offeringType} ${key}`).toBe(!hidden.has(key));
      }
    }
  });
});

describe('OD-142: the "source no longer first" queue item is its own rule, never a disagreement', () => {
  it('classifies by the marker even though value2 is empty (would otherwise read as an OD-60 abstention)', () => {
    const r = ruleFilterFor({ fieldName: 'openDate', source1: 'NSE', source2: 'BSE', value1: '2026-10-05', value2: null, resolutionReason: SOURCE_NO_LONGER_FIRST });
    expect(r).toBe('OD-142');
    expect(RULE_FILTER_LABELS['OD-142']).toContain('source no longer first');
  });
});
