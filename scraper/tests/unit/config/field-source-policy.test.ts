// implements: item 3 slice S1a -- the one resolver, read by the plan generator and the walk
import { describe, it, expect } from 'vitest';
import { resolveFieldSourcePolicy, policyOriginString } from '../../../src/config/field-source-policy.js';
import { loadFieldManifest } from '../../../src/config/field-manifest-loader.js';

// Against the REAL 190-row manifest -- no fixture, no re-implementation. A resolver whose test
// substitutes a fixture manifest would never catch a divergence between the resolver's reading
// of the schema and the manifest generator's actual output (defect-fix-contract.md).
const manifest = loadFieldManifest();

describe('resolveFieldSourcePolicy -- the real 190-row manifest', () => {
  it('worked example: ipos.issue_size / MAINBOARD', () => {
    const policy = resolveFieldSourcePolicy({ table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD' }, { manifest });

    expect(policy).toEqual({
      ranks: ['DOC', 'CHITTORGARH'],
      documentType: 'PRICE_BAND_AD',
      origin: { kind: 'registry', version: 2 },
      na: false,
    });
    expect(policyOriginString(policy.origin)).toBe('registry:2');
  });

  it('a row with no documentType yields undefined, never a thrown or defaulted value', () => {
    // ipos.company_name carries no documentType in the real manifest (measured 2026-09-17).
    expect(manifest.fields['ipos.company_name'].documentType).toBeUndefined();

    const policy = resolveFieldSourcePolicy({ table: 'ipos', column: 'company_name', ipoType: 'MAINBOARD' }, { manifest });

    expect(policy.documentType).toBeUndefined();
  });

  it('an IPO type the row does not rank -> na true, ranks empty (never falls back to MAINBOARD)', () => {
    // Find a real manifest row whose rank map has MAINBOARD but not some other real IPO-type-ish
    // key it never mentions -- 'RIGHTS' is named in the generator's own doc comment as a type the
    // manifest MAY add beyond MAINBOARD/SME_BSE/SME_NSE, and no row in the current manifest ranks
    // it, so this proves the "no entry" path on real data rather than a synthetic key.
    const anyEntry = manifest.fields['ipos.issue_size'];
    expect(anyEntry.rank.RIGHTS).toBeUndefined();

    const policy = resolveFieldSourcePolicy({ table: 'ipos', column: 'issue_size', ipoType: 'RIGHTS' }, { manifest });

    expect(policy.na).toBe(true);
    expect(policy.ranks).toEqual([]);
  });

  it('ipos.lot_size for SME_BSE never contains NSE (the class the generator/walk must never fall into)', () => {
    const entry = manifest.fields['ipos.lot_size'];
    expect(entry.rank.SME_BSE).toBeDefined();

    const policy = resolveFieldSourcePolicy({ table: 'ipos', column: 'lot_size', ipoType: 'SME_BSE' }, { manifest });

    expect(policy.ranks).not.toContain('NSE');
    expect(policy.ranks).toEqual(entry.rank.SME_BSE);
  });

  it('an unknown table.column throws', () => {
    expect(() =>
      resolveFieldSourcePolicy({ table: 'ipos', column: 'no_such_field_anywhere', ipoType: 'MAINBOARD' }, { manifest })
    ).toThrow(/unknown field/i);
  });

  it('defaults to loadFieldManifest() when no manifest dep is given', () => {
    // No `deps` argument at all -- proves the production default path (the generator/walk call
    // it with no manifest override) resolves against the real on-disk file, not a fixture.
    const policy = resolveFieldSourcePolicy({ table: 'ipos', column: 'issue_size', ipoType: 'MAINBOARD' });
    expect(policy.origin).toEqual({ kind: 'registry', version: manifest.version });
  });
});
