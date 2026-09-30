/**
 * #1233 round 2 (OD-129, OD-30): the ONE listing-sentence order, shared by the write gate, the
 * write matrix and the nightly check. Prospectus > RHP > price band ad > DRHP; within a type the
 * later FILING date decides (never the later extraction); anything it cannot order fails closed.
 */
import { describe, it, expect } from 'vitest';
import {
  LISTING_SENTENCE_ORDER,
  compareListingDocuments,
  listingClaimOutranked,
  pickListingSentenceDocument,
} from '../../../config/listing-sentence-precedence.mjs';

const doc = (docType: string, filingDate: string | null, extra: Record<string, unknown> = {}) => ({
  id: `${docType}-${filingDate}`,
  docType,
  filingDate,
  ...extra,
});

describe('#1233 listing-sentence order (OD-129)', () => {
  it('orders Prospectus > RHP > price band ad > DRHP, and lists nothing else', () => {
    expect(Object.keys(LISTING_SENTENCE_ORDER).sort((a, b) => LISTING_SENTENCE_ORDER[b] - LISTING_SENTENCE_ORDER[a])).toEqual([
      'PROSPECTUS',
      'RHP',
      'PRICE_BAND_AD',
      'DRHP',
    ]);
    expect(compareListingDocuments(doc('PRICE_BAND_AD', '2026-09-20'), doc('RHP', '2026-09-01'))).toBe(-1);
    expect(compareListingDocuments(doc('PRICE_BAND_AD', '2026-01-01'), doc('DRHP', '2026-09-01'))).toBe(1);
  });

  it('OD-30: within one type the later filing date decides; equal dates tie; a missing date is unordered', () => {
    expect(compareListingDocuments(doc('RHP', '2026-09-10'), doc('RHP', '2026-09-01'))).toBe(1);
    expect(compareListingDocuments(doc('RHP', '2026-09-01'), doc('RHP', '2026-09-10'))).toBe(-1);
    expect(compareListingDocuments(doc('RHP', '2026-09-01'), doc('RHP', '2026-09-01'))).toBe(0);
    expect(compareListingDocuments(doc('RHP', null), doc('RHP', '2026-09-01'))).toBeNull();
    expect(compareListingDocuments(doc('CORRIGENDUM', '2026-09-01'), doc('RHP', '2026-09-01'))).toBeNull();
  });
});

describe('#1233 the write gate (listingClaimOutranked)', () => {
  it('MAJOR-1: an OLDER filing of the same type extracted later is refused', () => {
    const r = listingClaimOutranked(doc('RHP', '2026-08-01'), [doc('RHP', '2026-09-01')]);
    expect(r.outranked).toBe(true);
  });

  it('a NEWER filing of the same type replaces the older one', () => {
    expect(listingClaimOutranked(doc('RHP', '2026-09-01'), [doc('RHP', '2026-08-01')]).outranked).toBe(false);
  });

  it('MAJOR-1: a price band ad extracted after an RHP is refused (it ranks below RHP)', () => {
    expect(listingClaimOutranked(doc('PRICE_BAND_AD', '2026-09-20'), [doc('RHP', '2026-09-10')]).outranked).toBe(true);
  });

  it('an RHP after a price band ad claims; a DRHP after an ad is refused', () => {
    expect(listingClaimOutranked(doc('RHP', '2026-09-10'), [doc('PRICE_BAND_AD', '2026-09-20')]).outranked).toBe(false);
    expect(listingClaimOutranked(doc('DRHP', '2026-01-01'), [doc('PRICE_BAND_AD', '2026-09-20')]).outranked).toBe(true);
  });

  it('a Prospectus claims over everything; a lower type after a Prospectus is refused', () => {
    expect(listingClaimOutranked(doc('PROSPECTUS', '2026-09-25'), [doc('RHP', '2026-09-10'), doc('PRICE_BAND_AD', '2026-09-20')]).outranked).toBe(false);
    expect(listingClaimOutranked(doc('RHP', '2026-09-30'), [doc('PROSPECTUS', '2026-09-25')]).outranked).toBe(true);
  });

  it('same type, same filing date: the document being extracted now decides (the later extraction)', () => {
    expect(listingClaimOutranked(doc('RHP', '2026-09-01'), [doc('RHP', '2026-09-01')]).outranked).toBe(false);
  });

  it('(a) fails closed: an unordered same-type pair or an unlisted self type refuses the claim', () => {
    expect(listingClaimOutranked(doc('RHP', null), [doc('RHP', '2026-09-01')]).outranked).toBe(true);
    expect(listingClaimOutranked(doc('RHP', '2026-09-01'), [doc('RHP', null)]).outranked).toBe(true);
    expect(listingClaimOutranked(doc('CORRIGENDUM', '2026-09-01'), []).outranked).toBe(true);
  });

  it('no other document: the claim stands', () => {
    expect(listingClaimOutranked(doc('DRHP', null), []).outranked).toBe(false);
  });
});

describe('#1233 the check (pickListingSentenceDocument) uses the same order', () => {
  it('picks by type, then filing date, then extraction time; never by extraction time across dates', () => {
    const docs = [
      doc('RHP', '2026-09-10', { extractedAt: '2026-09-11 00:00:00' }),
      doc('RHP', '2026-08-01', { extractedAt: '2026-09-29 00:00:00' }), // older filing extracted later
      doc('DRHP', '2026-01-01', { extractedAt: '2026-09-30 00:00:00' }),
      doc('PRICE_BAND_AD', '2026-09-20', { extractedAt: '2026-09-30 00:00:00' }),
    ];
    expect(pickListingSentenceDocument(docs).doc?.filingDate).toBe('2026-09-10');
    const tie = [doc('RHP', '2026-09-10', { extractedAt: 'b' }), doc('RHP', '2026-09-10', { extractedAt: 'a' })];
    expect(pickListingSentenceDocument(tie).doc?.extractedAt).toBe('b');
  });

  it('reports unordered best candidates instead of guessing, and ignores unlisted types', () => {
    expect(pickListingSentenceDocument([doc('RHP', null), doc('RHP', '2026-09-01')])).toEqual({ doc: null, unordered: true });
    expect(pickListingSentenceDocument([doc('RHP', null), doc('RHP', '2026-09-01'), doc('PROSPECTUS', '2026-09-20')]).doc?.docType).toBe('PROSPECTUS');
    expect(pickListingSentenceDocument([doc('CORRIGENDUM', '2026-09-01')]).doc).toBeNull();
  });
});
