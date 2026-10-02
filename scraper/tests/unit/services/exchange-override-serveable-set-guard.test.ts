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

  // OD-145 revisit done 2026-10-02 (PR #1466): BSE's previously unmapped fields answered
  // CHECK_FAILED (UNKNOWN, the fetcher's NO_MAPPING gap), never NOT_PRINTED, so no null baseline was
  // ever recorded for a BSE date; the first SUPPLIED BSE answer is judged against a known or unknown
  // baseline as usual. Release stays gated by the E-1 list (EXCHANGE_OVERRIDE_FIELDS): of the fields
  // below only openDate and closeDate can release an admin hold, and only when BSE is the
  // highest-ranked exchange that states them (OD-141). Pinned by exchange-override-bse-dates.test.ts.
  it('BSE serves exactly the 11 mapped fields', () => {
    const fields = [...BSE_SERVEABLE_FIELDS].sort();
    const expected = [
      'ipos.closeDate',
      'ipos.companyName',
      'ipos.faceValue',
      'ipos.issueSize',
      'ipos.leadManagers',
      'ipos.lotSize',
      'ipos.openDate',
      'ipos.priceRangeMax',
      'ipos.priceRangeMin',
      'ipos.registrar',
      'ipos.symbol',
    ];
    const added = fields.filter((f) => !expected.includes(f));
    expect(
      fields,
      `BSE now serves ${added.join(', ') || 'a different set'}: revisit OD-145 baseline handling for NOT_PRINTED (a null baseline would let a restated pre-save date release an admin hold) before updating this list`,
    ).toEqual(expected);
  });
});
