/**
 * Unit test for the item 2 slice 3a fix round.
 *
 * companySubline() falls back to segment only when both sector and every
 * date field are absent -- an edge case that would otherwise never be
 * exercised by a normal full-render test with realistic fixtures. Testing
 * the exported pure function directly avoids the cost/fragility of mounting
 * the full ListingIndexClient tree (router/Link/many sibling components)
 * just to reach this one branch.
 */
import { describe, it, expect } from 'vitest';
import { companySubline } from '@/components/listing/ListingIndexClient';
import { mockIPO } from '@/lib/db/types';

describe('ListingIndexClient companySubline (item 2 slice 3a fix round)', () => {
  it('renders an em dash, never "Mainboard", when segment/sector/dates are all unknown', () => {
    const ipo = mockIPO({
      sector: null,
      listingDate: null,
      openDate: null,
      closeDate: null,
      segment: null as any,
    });

    expect(companySubline(ipo)).toBe('—');
  });

  it('still renders "Mainboard" for a genuine MAINBOARD segment under the same fallback conditions', () => {
    const ipo = mockIPO({
      sector: null,
      listingDate: null,
      openDate: null,
      closeDate: null,
      segment: 'MAINBOARD' as any,
    });

    expect(companySubline(ipo)).toBe('Mainboard');
  });

  it('still renders "SME" for a genuine SME segment under the same fallback conditions', () => {
    const ipo = mockIPO({
      sector: null,
      listingDate: null,
      openDate: null,
      closeDate: null,
      segment: 'SME' as any,
    });

    expect(companySubline(ipo)).toBe('SME');
  });
});
