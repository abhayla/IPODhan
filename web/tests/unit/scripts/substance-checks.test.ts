// Unit tests for the pure substance-plausibility predicates used by
// scripts/audit-substance-plausibility.mjs. These are pure functions (no DB),
// so they are tested in isolation here. Each check asserts BOTH a passing case
// (returns null) and a failing case (returns a non-null reason string).
//
// The .mjs module lives at repo-root scripts/lib/ — imported relative to this
// test file (web/tests/unit/scripts/ → ../../../../scripts/lib/).
import { describe, it, expect } from 'vitest';
import {
  checkDateOrdering,
  checkLotSize,
  checkPriceBand,
  checkIssueSize,
  checkIsinFormat,
  checkNameQuality,
  checkListingPerformance,
  checkGmpSanity,
  SUBSTANCE_CHECKS,
} from '../../../../scripts/lib/substance-checks.mjs';

describe('checkDateOrdering (the #41 class)', () => {
  it('passes when open <= close < allotment < listing', () => {
    expect(
      checkDateOrdering({
        open_date: '2025-01-01',
        close_date: '2025-01-03',
        allotment_date: '2025-01-06',
        listing_date: '2025-01-09',
      })
    ).toBeNull();
  });

  it('passes when dates are null (not applicable)', () => {
    expect(
      checkDateOrdering({ open_date: null, close_date: null, allotment_date: null, listing_date: null })
    ).toBeNull();
  });

  it('passes on a partially-dated row where present pairs are ordered', () => {
    expect(checkDateOrdering({ open_date: '2025-01-01', close_date: '2025-01-03' })).toBeNull();
  });

  it('fails when allotment_date is before close_date', () => {
    const reason = checkDateOrdering({
      open_date: '2025-01-01',
      close_date: '2025-01-03',
      allotment_date: '2025-01-02',
      listing_date: '2025-01-09',
    });
    expect(reason).toMatch(/allotment_date/);
  });

  it('fails when listing_date precedes allotment_date (absurd backfill)', () => {
    expect(
      checkDateOrdering({ allotment_date: '2025-01-10', listing_date: '2025-01-05' })
    ).toMatch(/listing_date/);
  });

  it('fails when open_date is after close_date', () => {
    expect(checkDateOrdering({ open_date: '2025-02-01', close_date: '2025-01-01' })).toMatch(/open_date/);
  });
});

describe('checkLotSize', () => {
  it('passes for a plausible lot size', () => {
    expect(checkLotSize({ lot_size: 75 })).toBeNull();
  });

  it('passes when lot_size is null', () => {
    expect(checkLotSize({ lot_size: null })).toBeNull();
  });

  it('fails for zero lot size', () => {
    expect(checkLotSize({ lot_size: 0 })).toMatch(/lot_size/);
  });

  it('fails for an absurdly large lot size', () => {
    expect(checkLotSize({ lot_size: 500000 })).toMatch(/lot_size/);
  });
});

describe('checkPriceBand', () => {
  it('passes when min > 0 and min <= max', () => {
    expect(checkPriceBand({ price_range_min: 100, price_range_max: 105 })).toBeNull();
  });

  it('passes for a fixed-price issue (min only)', () => {
    expect(checkPriceBand({ price_range_min: 50, price_range_max: null })).toBeNull();
  });

  it('fails when min is zero', () => {
    expect(checkPriceBand({ price_range_min: 0, price_range_max: 100 })).toMatch(/must be > 0/);
  });

  it('fails when min exceeds max', () => {
    expect(checkPriceBand({ price_range_min: 200, price_range_max: 150 })).toMatch(/exceeds/);
  });
});

describe('checkIssueSize', () => {
  it('passes for a positive issue size', () => {
    expect(checkIssueSize({ issue_size: '1500000000.00' })).toBeNull();
  });

  it('passes when issue_size is null', () => {
    expect(checkIssueSize({ issue_size: null })).toBeNull();
  });

  it('fails for a non-positive issue size', () => {
    expect(checkIssueSize({ issue_size: 0 })).toMatch(/issue_size/);
  });
});

describe('checkIsinFormat', () => {
  it('passes for a valid Indian ISIN', () => {
    expect(checkIsinFormat({ isin: 'INE002A01018' })).toBeNull();
  });

  it('passes when isin is null', () => {
    expect(checkIsinFormat({ isin: null })).toBeNull();
  });

  it('fails for a malformed ISIN', () => {
    expect(checkIsinFormat({ isin: 'US1234567890' })).toMatch(/isin/);
  });

  it('fails for a too-short ISIN', () => {
    expect(checkIsinFormat({ isin: 'INE002A0' })).toMatch(/isin/);
  });
});

describe('checkNameQuality (the #42 class)', () => {
  it('passes for a clean company name', () => {
    expect(checkNameQuality({ company_name: 'Acme Industries Limited' })).toBeNull();
  });

  it('passes when company_name is null', () => {
    expect(checkNameQuality({ company_name: null })).toBeNull();
  });

  it('fails for a trailing status token after Limited', () => {
    expect(checkNameQuality({ company_name: 'Acme Industries Limited CT' })).toMatch(/trailing status-token/);
  });

  it('fails for a trailing token after Ltd.', () => {
    expect(checkNameQuality({ company_name: 'Foo Bar Ltd. P' })).toMatch(/trailing status-token/);
  });
});

describe('checkListingPerformance', () => {
  it('passes for positive price and an in-range gain', () => {
    expect(checkListingPerformance({ listing_price: 120, listing_gain_percent: '14.29' })).toBeNull();
  });

  it('passes when listing fields are null', () => {
    expect(checkListingPerformance({ listing_price: null, listing_gain_percent: null })).toBeNull();
  });

  it('fails for a non-positive listing price', () => {
    expect(checkListingPerformance({ listing_price: 0 })).toMatch(/listing_price/);
  });

  it('fails for an out-of-range listing gain', () => {
    expect(checkListingPerformance({ listing_gain_percent: 1500 })).toMatch(/listing_gain_percent/);
  });

  it('fails for an impossibly negative listing gain', () => {
    expect(checkListingPerformance({ listing_gain_percent: -99 })).toMatch(/listing_gain_percent/);
  });
});

describe('checkGmpSanity', () => {
  it('passes for a plausible GMP premium', () => {
    expect(checkGmpSanity({ gmp_value: 30, issue_price: 100 })).toBeNull(); // +30%
  });

  it('passes (not applicable) when GMP or issue price is missing', () => {
    expect(checkGmpSanity({ gmp_value: null, issue_price: 100 })).toBeNull();
    expect(checkGmpSanity({ gmp_value: 30, issue_price: null })).toBeNull();
  });

  it('guards division by zero (issue price 0 → not applicable)', () => {
    expect(checkGmpSanity({ gmp_value: 30, issue_price: 0 })).toBeNull();
  });

  it('fails for an implausibly high GMP premium', () => {
    expect(checkGmpSanity({ gmp_value: 500, issue_price: 100 })).toMatch(/outside/); // +500%
  });

  it('fails for an implausibly deep GMP discount', () => {
    expect(checkGmpSanity({ gmp_value: -80, issue_price: 100 })).toMatch(/outside/); // -80%
  });
});

describe('SUBSTANCE_CHECKS registry', () => {
  it('exposes one entry per predicate with key/name/predicate', () => {
    expect(SUBSTANCE_CHECKS).toHaveLength(9);
    for (const c of SUBSTANCE_CHECKS) {
      expect(typeof c.key).toBe('string');
      expect(typeof c.name).toBe('string');
      expect(typeof c.predicate).toBe('function');
    }
  });

  it('marks only gmp_sanity as optional', () => {
    const optional = SUBSTANCE_CHECKS.filter((c) => c.optional).map((c) => c.key);
    expect(optional).toEqual(['gmp_sanity']);
  });
});
