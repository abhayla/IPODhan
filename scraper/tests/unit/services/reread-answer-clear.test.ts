// implements: #1420 -- spec §6 rule 4 answer-state table (OD-153, OD-158, OD-160): the pure decision per row.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/services/data-persister.js', () => ({ clearIpoColumnsForRereadAnswer: vi.fn(), REREAD_CLEARABLE_IPOS_COLUMNS: {} }));
vi.mock('../../../src/utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { decideRereadAnswer, isOlderReadOfSameDocument, REREAD_CLEARABLE_FIELDS, NOT_PRINTED_REASON } from '../../../src/services/reread-answer-clear.js';

describe('decideRereadAnswer: one row of the table per state', () => {
  it('REFUSED clears with the refusal as reason and carries refused_value (may be a list)', () => {
    const d = decideRereadAnswer({ value: null, state: 'REFUSED', refused_value: [1.54, 1.6], check: { passed: false, detail: 'basis mismatch' } });
    expect(d).toEqual({ action: 'CLEAR', state: 'REFUSED', reason: 'current reader refused: basis mismatch', refusedValue: [1.54, 1.6] });
  });
  it('STATED_NOT_PRINTED clears with "current reader: not printed"', () => {
    expect(decideRereadAnswer({ value: null, state: 'STATED_NOT_PRINTED' })).toMatchObject({ action: 'CLEAR', reason: NOT_PRINTED_REASON });
  });
  it.each([
    ['MISSED', { value: null, state: 'MISSED', check: { passed: true } }, 'MISSED'],
    ['MISSED with a failed check', { value: null, state: 'MISSED', check: { passed: false } }, 'MISSED'],
    ['LOW_CONFIDENCE_OCR', { value: 3, state: 'LOW_CONFIDENCE_OCR' }, 'LOW_CONFIDENCE_OCR'],
    ['VALUE', { value: 3, state: 'VALUE' }, 'VALUE'],
    ['no state (older output)', { value: null, check: { passed: false } }, 'NO_STATE'],
    ['unknown state', { value: null, state: 'NEW_STATE' }, 'UNKNOWN_STATE'],
  ] as const)('%s keeps', (_n, field, why) => {
    expect(decideRereadAnswer(field as never)).toMatchObject({ action: 'KEEP', why });
  });
  it('an absent field keeps', () => {
    expect(decideRereadAnswer(undefined)).toMatchObject({ action: 'KEEP', why: 'ABSENT' });
  });
  it('OD-160: a persister hold-back keeps, whatever state the envelope carries', () => {
    expect(decideRereadAnswer({ value: 260, state: 'VALUE' }, true)).toMatchObject({ action: 'KEEP', why: 'PERSISTER_HOLD_BACK' });
    expect(decideRereadAnswer({ value: null, state: 'REFUSED' }, true)).toMatchObject({ action: 'KEEP', why: 'PERSISTER_HOLD_BACK' });
  });
});

describe('isOlderReadOfSameDocument (fail closed)', () => {
  const doc = { documentId: 'd1', sourceSha: 's1', extractorVersion: 'v2' };
  it('same document, older version: true', () => {
    expect(isOlderReadOfSameDocument({ source: 'DRHP', dataLineage: { documentId: 'd1', extractorVersion: 'v1' } }, doc)).toBe(true);
  });
  it.each([
    ['no extractor version in lineage', { source: 'DRHP', dataLineage: { documentId: 'd1' } }],
    ['empty extractor version', { source: 'DRHP', dataLineage: { documentId: 'd1', extractorVersion: '' } }],
    ['same version', { source: 'DRHP', dataLineage: { documentId: 'd1', extractorVersion: 'v2' } }],
    ['different document', { source: 'DRHP', dataLineage: { documentId: 'd9', sourceSha: 's9', extractorVersion: 'v1' } }],
    ['not a document source', { source: 'NSE', dataLineage: { documentId: 'd1', extractorVersion: 'v1' } }],
  ])('%s: false', (_n, prov) => {
    expect(isOlderReadOfSameDocument(prov as never, doc)).toBe(false);
  });
  it('no provenance or no current version: false', () => {
    expect(isOlderReadOfSameDocument(null, doc)).toBe(false);
    expect(isOlderReadOfSameDocument({ source: 'DRHP', dataLineage: { documentId: 'd1', extractorVersion: 'v1' } }, { ...doc, extractorVersion: null })).toBe(false);
  });
});

describe('REREAD_CLEARABLE_FIELDS', () => {
  it('never lists a derived value (OD-160, §2.6)', () => {
    const cols = REREAD_CLEARABLE_FIELDS.map((f) => `${f.tableName}.${f.column}`);
    expect(cols).not.toContain('ipos.issueSize');
    expect(cols).not.toContain('financial_data.quickRatio');
  });
});
