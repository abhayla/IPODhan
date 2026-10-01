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

  it('a type no version changed keeps the default floor (no needless re-read of price-band ads)', () => {
    const changed = new Set(Object.values(changes!).flat());
    for (const type of ['PRICE_BAND_AD', 'ANCHOR_ALLOCATION_REPORT', 'CORRIGENDUM']) {
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
