/**
 * OD-129 / F-197 / #938: the listing sentence parser on REAL staging page text.
 *
 * Fixture: tests/fixtures/listing-sentence/staging-listing-sentences.json —
 * extractor page text (document_pages) of every offer document on staging whose
 * cover pages carry "proposed to be listed", with each IPO's stored
 * listing_exchanges and segment at capture time. F-197 is the oracle: 33 IPOs'
 * PROSPECTUS / RHP / DRHP name exchanges and board; 32 agree with the stored
 * value; national-stock-exchange-of-india-ltd (stored [BSE, NSE]) lists on BSE only.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseListingSentence,
  readListingClause,
  toScrapedListingExchange,
} from '../../../src/services/listing-sentence.js';

interface Entry {
  slug: string;
  docType: string;
  pageNumber: number;
  storedSegment: string | null;
  storedListingExchanges: string[] | null;
  excerpt: string;
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../fixtures/listing-sentence/staging-listing-sentences.json'), 'utf8')
) as { entries: Entry[] };

const OFFER_DOCS = new Set(['PROSPECTUS', 'RHP', 'DRHP']);
const RANK: Record<string, number> = { PROSPECTUS: 3, RHP: 2, DRHP: 1 };
const sorted = (xs: readonly string[] | null) => [...(xs ?? [])].sort();

// document_pages.page_number is 1-based; the extractor's page_texts index is 0-based.
const parse = (e: Entry) => parseListingSentence([[e.pageNumber - 1, e.excerpt]]);

describe('parseListingSentence on real staging offer documents (F-197 oracle)', () => {
  it('reads the exchanges and board from every PROSPECTUS / RHP / DRHP and matches F-197 on 32 of 33 IPOs', () => {
    const best = new Map<string, Entry>();
    for (const e of fixture.entries) {
      if (!OFFER_DOCS.has(e.docType)) continue;
      const prev = best.get(e.slug);
      if (!prev || RANK[e.docType] > RANK[prev.docType]) best.set(e.slug, e);
    }
    expect(best.size).toBe(33);

    const disagree: string[] = [];
    const boards = { MAIN_BOTH: 0, MAIN_BSE: 0, SME_NSE: 0, SME_BSE: 0 };
    for (const e of best.values()) {
      const r = parse(e);
      expect(r, `${e.slug} ${e.docType}`).not.toBeNull();
      if (!r) continue;
      expect(r.board, `${e.slug} board`).toBe(e.storedSegment === 'SME' ? 'SME' : 'MAINBOARD');
      if (r.board === 'MAINBOARD') boards[r.exchanges.length === 2 ? 'MAIN_BOTH' : 'MAIN_BSE']++;
      else boards[r.exchanges[0] === 'NSE' ? 'SME_NSE' : 'SME_BSE']++;
      if (JSON.stringify(r.exchanges) !== JSON.stringify(sorted(e.storedListingExchanges))) disagree.push(e.slug);
    }
    // F-197: main board BSE+NSE 19, main board BSE only 1, NSE Emerge 9, BSE SME 4.
    expect(boards).toEqual({ MAIN_BOTH: 19, MAIN_BSE: 1, SME_NSE: 9, SME_BSE: 4 });
    expect(disagree).toEqual(['national-stock-exchange-of-india-ltd']);
  });

  it('reads NSE\'s own RHP as BSE only (#938: stored [BSE, NSE] is the stored error)', () => {
    const e = fixture.entries.find((x) => x.slug === 'national-stock-exchange-of-india-ltd' && x.docType === 'RHP')!;
    const r = parse(e)!;
    expect(r.exchanges).toEqual(['BSE']);
    expect(r.board).toBe('MAINBOARD');
    expect(r.sentence).toMatch(/recognised stock exchange being BSE Limited/);
    expect(toScrapedListingExchange(r.exchanges)).toBe('BSE');
  });

  it('does not read the Designated Stock Exchange sentence that follows as a listing claim', () => {
    const e = fixture.entries.find((x) => x.slug === 'himalayan-solar-ltd' && x.docType === 'RHP')!;
    const r = parse(e)!;
    expect(r.exchanges).toEqual(['NSE']);
    expect(r.board).toBe('SME');
    expect(r.sentence).not.toMatch(/Designated/);
  });

  it('a price band advertisement that says only "the Stock Exchanges" names nothing', () => {
    for (const slug of ['hero-motors-ltd', 'lumino-industries-ltd', 'steamhouse-india-ltd']) {
      const e = fixture.entries.find((x) => x.slug === slug && x.docType === 'PRICE_BAND_AD')!;
      expect(parse(e), slug).toBeNull();
    }
  });

  it('a price band advertisement that names the exchanges counts', () => {
    const e = fixture.entries.find((x) => x.slug === 'jindal-supreme-india-ltd' && x.docType === 'PRICE_BAND_AD')!;
    expect(parse(e)?.exchanges).toEqual(['BSE', 'NSE']);
  });

  it('reads only cover pages (index <= 6), and nothing from null / missing text', () => {
    const e = fixture.entries.find((x) => x.slug === 'a-one-steels-india-ltd' && x.docType === 'RHP')!;
    expect(parseListingSentence([[40, e.excerpt]])).toBeNull();
    expect(parseListingSentence([[0, null]])).toBeNull();
    expect(parseListingSentence(null)).toBeNull();
  });

  it('readListingClause: SME platform wording decides the board', () => {
    expect(readListingClause('on the SME Platform of BSE Limited (BSE SME)')).toEqual({ exchanges: ['BSE'], board: 'SME' });
    expect(readListingClause('on the Stock Exchanges')).toBeNull();
  });
});
