// OD-141/OD-145 guard (Tier A round-5 MINOR-1): the exchange-override rule
// records a NOT_PRINTED answer as a null baseline. That is only safe while the
// exchanges cannot serve a date field later. If the serveable set changes, a
// human must revisit the baseline handling before this list is updated.
import { describe, it, expect } from 'vitest';
import { NSE_SERVEABLE_FIELDS } from '../../../src/services/field-plan-walk-nse-fetcher.js';
import { BSE_SERVEABLE_FIELDS } from '../../../src/services/field-plan-walk-bse-fetcher.js';

describe('exchange serveable sets (manifest-flip guard)', () => {
  it('NSE serves exactly the E-1 date fields {openDate, closeDate}', () => {
    const dateFields = [...NSE_SERVEABLE_FIELDS.keys()]
      .filter((k) => k.startsWith('ipos.') && k.endsWith('Date'))
      .sort();
    const expected = ['ipos.closeDate', 'ipos.openDate'];
    const added = dateFields.filter((f) => !expected.includes(f));
    expect(
      dateFields,
      `NSE now serves ${added.join(', ') || 'a different date set'}: revisit OD-145 baseline handling for NOT_PRINTED (a null baseline would let a restated pre-save date release an admin hold) before updating this list`,
    ).toEqual(expected);
  });

  it('BSE serves exactly {issueSize}', () => {
    const fields = [...BSE_SERVEABLE_FIELDS].sort();
    const added = fields.filter((f) => f !== 'ipos.issueSize');
    expect(
      fields,
      `BSE now serves ${added.join(', ') || 'a different set'}: revisit OD-145 baseline handling for NOT_PRINTED (a null baseline would let a restated pre-save date release an admin hold) before updating this list`,
    ).toEqual(['ipos.issueSize']);
  });
});
