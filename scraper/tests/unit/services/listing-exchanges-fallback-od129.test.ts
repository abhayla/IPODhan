/**
 * OD-129 (#938), review round 1 MINOR 2 + 3: the consolidation-failure fallback
 * door (`mergeListingExchangesForSource`) makes the SAME document-first decision
 * as the consolidation door: a document replaces the set; a set a document holds
 * is never widened by a feed; an unknown stored provenance keeps the stored set.
 */
import { describe, it, expect } from 'vitest';
import { mergeListingExchangesForSource, STORED_SOURCE_UNKNOWN } from '../../../src/services/data-persister';

describe('fallback door: listingExchanges under OD-129', () => {
  it('a document REPLACES the stored set (#938: [BSE, NSE] -> [BSE]), never unions', () => {
    expect(mergeListingExchangesForSource(['BSE', 'NSE'], 'DRHP', 'BSE', 'MAINBOARD', 'NSE')).toEqual(['BSE']);
  });

  it('a document replaces even with no stored provenance', () => {
    expect(mergeListingExchangesForSource(['NSE'], 'DRHP', 'BSE', 'SME', null)).toEqual(['BSE']);
  });

  it('an NSE feed does NOT widen a document-held [BSE]', () => {
    expect(mergeListingExchangesForSource(['BSE'], 'NSE', undefined, 'MAINBOARD', 'DRHP')).toEqual(['BSE']);
  });

  it('CG naming both does not widen a document-held [NSE]', () => {
    expect(mergeListingExchangesForSource(['NSE'], 'CHITTORGARH', 'BOTH', 'SME', 'DRHP')).toEqual(['NSE']);
  });

  it('a failed provenance lookup keeps the stored set for a feed', () => {
    expect(mergeListingExchangesForSource(['BSE'], 'NSE', undefined, 'MAINBOARD', STORED_SOURCE_UNKNOWN)).toEqual(['BSE']);
  });

  it('with no document read, the feed union still applies (OD-129 fallback order)', () => {
    expect(mergeListingExchangesForSource(['BSE'], 'NSE', undefined, 'MAINBOARD', 'BSE')).toEqual(['BSE', 'NSE']);
  });

  it('a document does not replace an ADMIN-held set', () => {
    expect(mergeListingExchangesForSource(['BSE', 'NSE'], 'DRHP', 'BSE', 'MAINBOARD', 'ADMIN')).toEqual(['BSE', 'NSE']);
  });
});
