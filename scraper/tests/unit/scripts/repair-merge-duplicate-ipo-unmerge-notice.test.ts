import { describe, it, expect } from 'vitest';
import { unmergeNotice } from '../../../scripts/repair-merge-duplicate-ipo';

// Item 19 / OD-92, spec §2.3.3.3 "a live merge is announced": the unmerge of a merge touching an
// OPEN or UPCOMING IPO is announced the same way; anything else is not.
const base = {
  mergeId: 'm1',
  keepId: 'k',
  dropId: 'd',
  keepSlug: 'acme-ltd',
  dropSlug: 'acme-ltd-o',
  keepStatus: 'CLOSED',
  dropStatus: 'CLOSED',
  partial: false,
  missing: [],
  drift: [],
  restoredRows: [{ table: 'gmp_records', count: 3 }],
  repointedBack: [],
  applied: true,
};

describe('unmergeNotice', () => {
  it('announces when either IPO is OPEN or UPCOMING', () => {
    expect(unmergeNotice({ ...base, keepStatus: 'OPEN' })?.title).toBe('IPO unmerge: /acme-ltd-o restored from /acme-ltd');
    expect(unmergeNotice({ ...base, dropStatus: 'UPCOMING' })?.body).toMatch(/gmp_records 3/);
  });
  it('stays silent for CLOSED / LISTED pairs', () => {
    expect(unmergeNotice(base)).toBeNull();
    expect(unmergeNotice({ ...base, keepStatus: 'LISTED' })).toBeNull();
  });
  it('says PARTIAL and what is missing for a pre-OD-92 entry', () => {
    expect(unmergeNotice({ ...base, keepStatus: 'OPEN', partial: true, missing: ['gmp_records: 3 deleted row(s) logged as a count only'] })?.body).toMatch(
      /PARTIAL: gmp_records: 3/
    );
  });
});
