import { describe, it, expect } from 'vitest';
import { planRetype } from '../../../src/scripts/retype-misclassified-documents.js';
import {
  isMoreSpecificDocumentType,
  DOCUMENT_TYPE_REFINEMENTS,
} from '@ipodhan/shared/db/document-type-refinement';

/**
 * T-403 M6. The classifier fix was forward-only: upsertDocument dedups by URL and
 * never updated `type`, so every row already stored under the wrong type stayed
 * wrong, and a second type resolving to the same URL adopted the first type's row.
 */

describe('isMoreSpecificDocumentType — a closed, one-directional allowlist', () => {
  it('allows exactly the refinements the review found', () => {
    expect(isMoreSpecificDocumentType('RHP', 'PROSPECTUS')).toBe(true);
    expect(isMoreSpecificDocumentType('ADDENDUM', 'CORRIGENDUM')).toBe(true);
    expect(isMoreSpecificDocumentType('ADDENDUM', 'PRICE_BAND_AD')).toBe(true);
    expect(isMoreSpecificDocumentType('BASIS_OF_ALLOTMENT', 'BASIS_OF_ALLOTMENT_AD')).toBe(true);
  });

  it('NEVER degrades — a classifier regression cannot relabel the corpus', () => {
    expect(isMoreSpecificDocumentType('PROSPECTUS', 'RHP')).toBe(false);
    expect(isMoreSpecificDocumentType('CORRIGENDUM', 'ADDENDUM')).toBe(false);
    expect(isMoreSpecificDocumentType('PRICE_BAND_AD', 'ADDENDUM')).toBe(false);
  });

  it('refuses an unrelated pair, and a no-op', () => {
    expect(isMoreSpecificDocumentType('RHP', 'BIDDING_CENTERS')).toBe(false);
    expect(isMoreSpecificDocumentType('RHP', 'RHP')).toBe(false);
    expect(isMoreSpecificDocumentType('', 'RHP')).toBe(false);
  });

  it('every refinement target differs from its source', () => {
    for (const [from, tos] of Object.entries(DOCUMENT_TYPE_REFINEMENTS)) {
      for (const to of tos) expect(to).not.toBe(from);
    }
  });
});

describe('planRetype — what the one-off script would do to stored rows', () => {
  it('re-types a final Prospectus stored as RHP (the Skyways trap)', () => {
    const plan = planRetype({
      id: 'd1',
      url: 'https://listing.bseindia.com/Download/Prospectus_Skyways.pdf',
      title: 'Prospectus_GID',
      type: 'RHP',
    })!;
    expect(plan.suggestedType).toBe('PROSPECTUS');
    expect(plan.action).toBe('retype');
  });

  it('re-types a corrigendum and a price-band ad stored as ADDENDUM', () => {
    const corr = planRetype({
      id: 'd2',
      url: 'https://listing.bseindia.com/Download//PreAnchor/CorrigendumofRHPSkyways_1.pdf',
      title: 'Corrigendum',
      type: 'ADDENDUM',
    })!;
    expect(corr).toMatchObject({ suggestedType: 'CORRIGENDUM', action: 'retype' });

    const pba = planRetype({
      id: 'd3',
      url: 'https://listing.bseindia.com/Download//PreAnchor/PriceBandAdvertisementSkyways_1.pdf',
      title: 'Price Band Advertisement',
      type: 'ADDENDUM',
    })!;
    expect(pba).toMatchObject({ suggestedType: 'PRICE_BAND_AD', action: 'retype' });
  });

  it('leaves a correctly-typed row alone', () => {
    expect(
      planRetype({
        id: 'd4',
        url: 'https://nsearchives.nseindia.com/content/ipo/RHP_SKYWAYS.zip',
        title: 'Red Herring Prospectus',
        type: 'RHP',
      })
    ).toBeNull();
  });

  it('flags an UNRELATED reclassification for review instead of rewriting it', () => {
    // The source or the classifier changed. Rewriting silently would be worse
    // than saying so.
    const plan = planRetype({
      id: 'd5',
      url: 'https://nsearchives.nseindia.com/content/ipo/ANCHOR_X.zip',
      title: 'Anchor Allocation Report',
      type: 'RHP',
    })!;
    expect(plan.suggestedType).toBe('ANCHOR_ALLOCATION_REPORT');
    expect(plan.action).toBe('review');
  });

  it('prefers the FILE NAME over our stored title', () => {
    // Our own titles are sometimes just the BSE field name; the exchange's file
    // name is what the document actually is.
    const plan = planRetype({
      id: 'd6',
      url: 'https://x/CorrigendumofRHP.pdf',
      title: 'Addendum',
      type: 'ADDENDUM',
    })!;
    expect(plan.suggestedType).toBe('CORRIGENDUM');
  });
});
