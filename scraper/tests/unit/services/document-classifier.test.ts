import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyByTitle,
  classifyBseField,
  fileNameFromUrl,
  BSE_DOCUMENT_FIELDS,
} from '../../../src/services/document-classifier.js';
import { extractBseCoreRow } from '../../../src/services/bse-ipo-board.js';

const FIXTURES = join(__dirname, '../../fixtures/documents');
const readFixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));

describe('classifyByTitle — the E14 / Skyways-trap fixes', () => {
  it('T1 types a FINAL Prospectus as PROSPECTUS, not RHP (the Skyways trap)', () => {
    expect(classifyByTitle('Prospectus')).toBe('PROSPECTUS');
    expect(classifyByTitle('ProspectusSkyways_20260901120000.pdf')).toBe('PROSPECTUS');
  });

  it('T1b still types a Red Herring Prospectus as RHP', () => {
    expect(classifyByTitle('Red Herring Prospectus')).toBe('RHP');
    expect(classifyByTitle('RHPSkyways_20260818181315.pdf')).toBe('RHP');
  });

  it('T2 types a DRAFT red herring prospectus as DRHP', () => {
    expect(classifyByTitle('Draft Red Herring Prospectus')).toBe('DRHP');
    expect(classifyByTitle('DRHP_ACME.pdf')).toBe('DRHP');
  });

  it('T3 types a price band advertisement as PRICE_BAND_AD, not ADDENDUM', () => {
    expect(classifyByTitle('Price Band Advertisement')).toBe('PRICE_BAND_AD');
    expect(classifyByTitle('PriceBandAdvertisementSkyways_20260818181316.pdf')).toBe('PRICE_BAND_AD');
  });

  it('T4 types a corrigendum as CORRIGENDUM even when its filename says RHP', () => {
    expect(classifyByTitle('CorrigendumofRHPSkyways_20260818181316.pdf')).toBe('CORRIGENDUM');
  });

  it('T5 types an addendum as ADDENDUM', () => {
    expect(classifyByTitle('Addendum to RHP_250820261220.zip')).toBe('ADDENDUM');
  });

  it('T6 defaults a BARE "Security Parameters" to PRE_ANCHOR (matrix F11)', () => {
    // The live MADHURKNIT title is literally 'Security Parameters ' — trailing space,
    // no '(Pre Anchor)' qualifier.
    expect(classifyByTitle('Security Parameters ')).toBe('SECURITY_PARAMS_PRE_ANCHOR');
    expect(classifyByTitle('Security Parameters (Pre Anchor)')).toBe('SECURITY_PARAMS_PRE_ANCHOR');
  });

  it('T7 types "(Post Anchor)" security parameters as POST_ANCHOR', () => {
    expect(classifyByTitle('Security Parameters (Post Anchor)')).toBe('SECURITY_PARAMS_POST_ANCHOR');
  });

  it('T8 types the anchor allocation report as ANCHOR_ALLOCATION_REPORT', () => {
    expect(classifyByTitle('Anchor Allocation Report')).toBe('ANCHOR_ALLOCATION_REPORT');
  });

  it('T8b types the basis-of-allotment advertisement distinctly from basis of issue price', () => {
    expect(classifyByTitle('Basis of Allotment')).toBe('BASIS_OF_ALLOTMENT_AD');
    expect(classifyByTitle('Ratios / Basis of Issue Price')).toBe('RATIOS_BASIS_ISSUE_PRICE');
  });

  it('T9 returns null for titles that are not tracked documents', () => {
    for (const title of ['Issue Period', 'Sponsor Bank', 'e-form link', '', '   ']) {
      expect(classifyByTitle(title)).toBeNull();
    }
    expect(classifyByTitle(null)).toBeNull();
    expect(classifyByTitle(undefined)).toBeNull();
  });
});

describe('fileNameFromUrl', () => {
  it('decodes and lower-cases the last path segment, dropping the query', () => {
    expect(fileNameFromUrl('https://x/Download//PreAnchor/RHPSkyways_1.pdf?a=1')).toBe('rhpskyways_1.pdf');
    expect(fileNameFromUrl('https://x/ipo/Addendum%20to%20RHP.zip')).toBe('addendum to rhp.zip');
  });

  it('returns empty string for non-URLs', () => {
    expect(fileNameFromUrl('')).toBe('');
    expect(fileNameFromUrl(null)).toBe('');
  });
});

describe('classifyBseField — against the REAL Skyways core payload', () => {
  const row = extractBseCoreRow(readFixture('bse-skyways-core.json')) as Record<string, string>;

  it('types Prospectus_GID by FILENAME (RHP today, Prospectus after close)', () => {
    expect(classifyBseField('Prospectus_GID', row.Prospectus_GID)).toBe('RHP');
    // The same field serves the FINAL prospectus after close (lifecycle-plan S4).
    expect(
      classifyBseField('Prospectus_GID', 'https://listing.bseindia.com/Download/Prospectus_Skyways.pdf')
    ).toBe('PROSPECTUS');
  });

  it('types Corrigendum / Addendum / Price_Band_Advertisement distinctly', () => {
    expect(classifyBseField('Corrigendum', row.Corrigendum)).toBe('CORRIGENDUM');
    expect(classifyBseField('Addendum', row.Addendum)).toBe('ADDENDUM');
    expect(classifyBseField('Price_Band_Advertisement', row.Price_Band_Advertisement)).toBe('PRICE_BAND_AD');
  });

  it('falls back to the field default when the filename says nothing', () => {
    expect(classifyBseField('Anchor_Details', 'https://x/anchor_20260821.pdf')).toBe(
      'ANCHOR_ALLOCATION_REPORT'
    );
    expect(classifyBseField('Corrigendum', 'https://x/12345.pdf')).toBe('CORRIGENDUM');
  });

  it('returns null for fields that are not document fields', () => {
    expect(classifyBseField('Registrar', 'https://x/a.pdf')).toBeNull();
    expect(classifyBseField('Bank_ASBA_Form', 'https://x/a.pdf')).toBeNull();
  });

  it('every BSE document field maps to a real document type', () => {
    expect(Object.keys(BSE_DOCUMENT_FIELDS)).toEqual([
      'Prospectus_GID',
      'Corrigendum',
      'Addendum',
      'Price_Band_Advertisement',
      'Anchor_Details',
    ]);
  });
});
