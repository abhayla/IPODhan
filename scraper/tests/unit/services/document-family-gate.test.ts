// implements: R-234
/**
 * OD-96 (#993 round 1): a document writes a field only when the field's manifest document family
 * contains the document's type — the SAME family the DOC fetcher credits with (plan-supersession-rule).
 */
import { describe, it, expect } from 'vitest';
import { documentMayWriteField } from '../../../src/services/document-family-gate';
import { familyForField } from '../../../config/plan-supersession-rule.mjs';
import { loadFieldManifest } from '../../../src/config/field-manifest-loader';

describe('OD-96 documentMayWriteField', () => {
  it('refuses a price-band advertisement on an RHP-family field (camel or snake column)', () => {
    expect(documentMayWriteField('ipos', 'companyDescription', 'PRICE_BAND_AD')).toBe(false);
    expect(documentMayWriteField('ipos', 'company_description', 'PRICE_BAND_AD')).toBe(false);
    expect(documentMayWriteField('ipos', 'cin', 'PRICE_BAND_AD')).toBe(false);
  });

  it('allows every offer document on an RHP-family field', () => {
    for (const t of ['RHP', 'DRHP', 'PROSPECTUS']) expect(documentMayWriteField('ipos', 'cin', t)).toBe(true);
  });

  it('allows the advertisement on its own family (the price band)', () => {
    expect(documentMayWriteField('ipos', 'priceRangeMax', 'PRICE_BAND_AD')).toBe(true);
  });

  it('allows a field the manifest gives no documentType (the shared rule: own type is the family)', () => {
    expect(documentMayWriteField('ipos', 'registrarId', 'PRICE_BAND_AD')).toBe(true);
    expect(documentMayWriteField('ipos', 'no_such_column_anywhere', 'RHP')).toBe(true);
  });

  it('agrees with the fetcher family for every manifest field and document type', () => {
    const fields = loadFieldManifest().fields;
    for (const [key, entry] of Object.entries(fields)) {
      const [table, column] = key.split('.');
      for (const t of ['RHP', 'DRHP', 'PROSPECTUS', 'PRICE_BAND_AD']) {
        expect(documentMayWriteField(table, column, t)).toBe(
          (familyForField(entry.documentType, t) as readonly string[]).includes(t)
        );
      }
    }
  });
});
