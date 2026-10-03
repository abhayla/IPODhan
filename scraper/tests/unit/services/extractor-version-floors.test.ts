import { describe, it, expect } from 'vitest';
import * as persist from '../../../src/services/filing-auto-persist.js';

/**
 * #1247 item 2: the per-type re-read floors were a second version system kept
 * only in a code comment, so a future EXTRACTOR_VERSION bump for a price-band ad
 * or anchor change would silently re-read nothing of that type. The floors are
 * now DERIVED from one changelog (EXTRACTOR_VERSION_CHANGES: version -> the
 * document types whose extraction it changed). These tests make an undeclared
 * bump fail.
 */
describe('#1247 extractor version floors are derived from one changelog', () => {
  const changes = (persist as Record<string, unknown>).EXTRACTOR_VERSION_CHANGES as
    | Readonly<Record<string, readonly string[]>>
    | undefined;

  it('the current EXTRACTOR_VERSION is declared in the changelog with the types it changed', () => {
    expect(changes).toBeDefined();
    const affected = changes![persist.EXTRACTOR_VERSION];
    expect(Array.isArray(affected) && affected.length > 0).toBe(true);
  });

  it('every type a version changed re-reads at that version or later (no silent floor)', () => {
    for (const [version, types] of Object.entries(changes!)) {
      for (const type of types) {
        expect(persist.versionAtLeast(persist.rereadSinceFor(type), version)).toBe(true);
      }
    }
  });

  it('a type no version changed keeps the default floor (no needless re-read of anchors or corrigenda)', () => {
    const changed = new Set(Object.values(changes!).flat());
    for (const type of ['ANCHOR_ALLOCATION_REPORT', 'CORRIGENDUM']) {
      expect(changed.has(type)).toBe(false);
      expect(persist.rereadSinceFor(type)).toBe(persist.REREAD_SINCE_DEFAULT);
    }
  });

  it('keeps today\'s floors exactly (prospectus family at the current version)', () => {
    for (const type of ['RHP', 'DRHP', 'PROSPECTUS']) {
      expect(persist.rereadSinceFor(type)).toBe(persist.EXTRACTOR_VERSION);
    }
  });
});

/**
 * OD-171 amended (#1498 follow-up): the fetcher-change input the claim query reads. The marker is the
 * 13:30 IST staging window that first served #1504's DOC fetcher, and every type's floor is the floor the
 * DOC fetcher judges a record current by (rereadSinceFor).
 */
describe('DOC_FETCHER_LOGIC_SINCE / buildDocFetcherChangeReask', () => {
  it('the marker is the #1504 staging window (2026-10-03 13:30 IST = 08:00 UTC)', async () => {
    const floors = await import('../../../src/services/extractor-version-floors.js');
    expect(floors.DOC_FETCHER_LOGIC_SINCE).toBe('2026-10-03T08:00:00Z');
    expect(floors.buildDocFetcherChangeReask({}).since.toISOString()).toBe('2026-10-03T08:00:00.000Z');
  });

  it('a floor per document type the DOC rank reads, upper-cased, equal to rereadSinceFor; nothing else', async () => {
    const floors = await import('../../../src/services/extractor-version-floors.js');
    const built = floors.buildDocFetcherChangeReask({ 'ipos.objectives': ['RHP', 'drhp'], 'ipos.lot_size': ['PRICE_BAND_AD'] });
    expect(built.currentVersionFloors).toEqual({
      RHP: floors.rereadSinceFor('RHP'),
      DRHP: floors.rereadSinceFor('DRHP'),
      PRICE_BAND_AD: floors.rereadSinceFor('PRICE_BAND_AD'),
    });
  });

  it('refuses a marker that is not an ISO instant (fail closed, never a silent Invalid Date)', async () => {
    const floors = await import('../../../src/services/extractor-version-floors.js');
    expect(() => floors.buildDocFetcherChangeReask({}, 'not-a-date')).toThrow(/not an ISO instant/);
  });
});
