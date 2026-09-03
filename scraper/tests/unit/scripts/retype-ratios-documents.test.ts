import { describe, it, expect, vi } from 'vitest';

// The script also imports DB/Redis/repository modules that need a live
// shared-package build to resolve -- irrelevant to this pure-predicate test,
// so they are mocked out (same pattern as backfill-step-ledger.test.ts).
// vi.mock calls are hoisted above imports by vitest's transform regardless of
// source position.
vi.mock('@ipodhan/shared/db', () => ({ db: {} }));
vi.mock('@ipodhan/shared/db/schema', () => ({ documents: {}, ipos: {} }));
vi.mock('@ipodhan/shared', () => ({ DocumentRepository: vi.fn() }));
vi.mock('@ipodhan/shared/cache/redis-client', () => ({ getRedisClient: () => ({}) }));
vi.mock('../../../src/services/cache-invalidator.js', () => ({ invalidateIPOCaches: vi.fn() }));

import { isRetypeCandidate, RATIOS_URL_PATTERN } from '../../../scripts/retype-ratios-documents.js';

describe('isRetypeCandidate — W-90 backfill predicate', () => {
  it('matches a PRICE_BAND_AD row whose url is NSE\'s RATIOS_<SYMBOL>.zip', () => {
    expect(
      isRetypeCandidate(
        'https://nsearchives.nseindia.com/content/ipo/RATIOS_DEEPA.zip',
        'PRICE_BAND_AD'
      )
    ).toBe(true);
  });

  it('is case-insensitive on the RATIOS_ marker', () => {
    expect(isRetypeCandidate('https://x/ratios_deepa.zip', 'PRICE_BAND_AD')).toBe(true);
  });

  it('rejects a row already typed RATIOS_BASIS_ISSUE_PRICE', () => {
    expect(
      isRetypeCandidate(
        'https://nsearchives.nseindia.com/content/ipo/RATIOS_DEEPA.zip',
        'RATIOS_BASIS_ISSUE_PRICE'
      )
    ).toBe(false);
  });

  it('rejects a genuine BSE price-band ad (no RATIOS_ marker in the url)', () => {
    expect(
      isRetypeCandidate('https://listing.bseindia.com/Price_Band_Advertisement.zip', 'PRICE_BAND_AD')
    ).toBe(false);
  });

  it('rejects null/undefined/empty urls and types', () => {
    expect(isRetypeCandidate(null, 'PRICE_BAND_AD')).toBe(false);
    expect(isRetypeCandidate(undefined, 'PRICE_BAND_AD')).toBe(false);
    expect(isRetypeCandidate('', 'PRICE_BAND_AD')).toBe(false);
    expect(isRetypeCandidate('https://x/RATIOS_DEEPA.zip', null)).toBe(false);
  });

  it('RATIOS_URL_PATTERN is exported for reuse and matches the real url', () => {
    expect(RATIOS_URL_PATTERN.test('https://nsearchives.nseindia.com/content/ipo/RATIOS_DEEPA.zip')).toBe(
      true
    );
  });
});
