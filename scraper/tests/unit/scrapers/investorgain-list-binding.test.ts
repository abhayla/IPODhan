import { describe, it, expect } from 'vitest';
import { chooseListBinding } from '../../../src/scrapers/investorgain-gmp-orchestrator-v2.js';

/**
 * Item 12 slice E — how a GMP list row binds to an IPO row.
 *
 * MEASURED BEFORE THIS WAS BUILT (read-only, real data):
 *
 *  - The similarity path is NOT an edge case. It only runs when two IPOs share
 *    BOTH dates, and that is the norm: 194 of 333 production rows (58%) sit in a
 *    shared open+close window, because SME issues routinely run the same dates.
 *
 *  - The InvestorGain source provides NEITHER a symbol NOR an ISIN — every field
 *    it returns was listed. So the card's "symbol -> ISIN -> exact name" chain
 *    has only its last tier available here. Two of three fallbacks are fiction.
 *
 *  - Against the 29 real records in the captured fixture: 24 bind to exactly ONE
 *    row by exact name, ZERO are ambiguous, 5 match nothing. The zero is the
 *    point — exact name is already UNIQUE wherever it matches, so the 0.6
 *    threshold is doing worse work than a strict key.
 *
 *  - The cost, by name: Jindal Supreme, Steamhouse, Asset Reconstruction and
 *    Glass Wall Systems stop showing GMP until their names align, because the
 *    source stores a shorter name than we do. That is 4 of 28 real records.
 *
 * NOT FIXED BY WIDENING THE KEY. Binding on `foldCompanyIdentity` would match all
 * four — and would be wrong. That key deliberately strips "india" and belongs to
 * a repair that DELETES rows; widening the binding key to it would merge
 * companies differing only by a country word.
 */
const arcil = { id: 'arcil', companyName: 'ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED' };
const manipal = { id: 'manipal', companyName: 'Manipal Health Enterprises Ltd.' };
const hrh = { id: 'hrh', companyName: 'H.R.Hygiene Products Ltd.' };

describe('chooseListBinding — a single candidate needs no name at all', () => {
  it('BINDS when exactly one IPO shares the dates, strict or not', () => {
    for (const strict of [false, true]) {
      const r = chooseListBinding([manipal], 'Manipal Health Enterprises', strict);
      expect(r.outcome).toBe('BOUND');
      expect(r.outcome === 'BOUND' && r.ipoId).toBe('manipal');
      expect(r.outcome === 'BOUND' && r.via).toBe('single-candidate');
    }
  });

  it('is UNBOUND when nothing shares the dates — not an error', () => {
    for (const strict of [false, true]) {
      expect(chooseListBinding([], 'Whatever Ltd', strict).outcome).toBe('UNBOUND');
    }
  });
});

describe('chooseListBinding — STRICT: exact name or nothing', () => {
  it('binds the one candidate whose normalized name matches exactly', () => {
    const r = chooseListBinding([hrh, manipal], 'Manipal Health Enterprises', true);
    expect(r.outcome).toBe('BOUND');
    expect(r.outcome === 'BOUND' && r.ipoId).toBe('manipal');
    expect(r.outcome === 'BOUND' && r.via).toBe('exact-name');
  });

  it('is AMBIGUOUS and names BOTH candidates when no name matches exactly', () => {
    // The measured cost case: the source says "Asset Reconstruction", we store
    // "ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED". Under strict binding that
    // writes NOTHING rather than guessing — and says which rows it could not
    // choose between (signal-ownership R1: identities, never a bare count).
    const r = chooseListBinding([arcil, manipal], 'Asset Reconstruction', true);
    expect(r.outcome).toBe('AMBIGUOUS');
    expect(r.outcome === 'AMBIGUOUS' && r.candidates.map((c) => c.id)).toEqual(
      expect.arrayContaining(['arcil', 'manipal'])
    );
  });

  it('is AMBIGUOUS when TWO candidates both match the name exactly — never picks one', () => {
    const twinA = { id: 'a', companyName: 'H.R.Hygiene Products Ltd.' };
    const twinB = { id: 'b', companyName: 'H.R.Hygiene Products Limited' };
    const r = chooseListBinding([twinA, twinB], 'H.R.Hygiene Products', true);
    expect(r.outcome).toBe('AMBIGUOUS');
  });

  it('NEVER binds on mere similarity — the 0.61 guess is gone', () => {
    // "Sunrise Pharmaceutical" vs "Sun Pharmaceutical" scores high on character
    // similarity and is a different company. Strict binding refuses.
    const sun = { id: 'sun', companyName: 'Sun Pharmaceutical Industries Ltd' };
    const other = { id: 'oth', companyName: 'Zenith Metals Ltd' };
    const r = chooseListBinding([sun, other], 'Sunrise Pharmaceutical Industries', true);
    expect(r.outcome).toBe('AMBIGUOUS');
  });
});

describe('chooseListBinding — flag OFF keeps the legacy behaviour exactly', () => {
  it('still binds the most similar candidate above 0.6, as today', () => {
    const r = chooseListBinding([hrh, manipal], 'Manipal Health Enterprises', false);
    expect(r.outcome).toBe('BOUND');
    expect(r.outcome === 'BOUND' && r.ipoId).toBe('manipal');
  });

  it('still refuses when the best similarity is below the threshold, as today', () => {
    const a = { id: 'a', companyName: 'Zenith Metals Ltd' };
    const b = { id: 'b', companyName: 'Orbit Textiles Ltd' };
    expect(chooseListBinding([a, b], 'Quantum Foods', false).outcome).toBe('AMBIGUOUS');
  });

  it('the legacy path can bind a merely-similar name — which is why strict exists', () => {
    // Pinning the behaviour the flag replaces, so the difference is visible in
    // the diff rather than argued about: with the flag OFF a close-but-wrong
    // name still wins, and with it ON the same input is refused.
    const sun = { id: 'sun', companyName: 'Sun Pharmaceutical Industries Ltd' };
    const other = { id: 'oth', companyName: 'Zenith Metals Ltd' };
    const loose = chooseListBinding([sun, other], 'Sunrise Pharmaceutical Industries', false);
    const strict = chooseListBinding([sun, other], 'Sunrise Pharmaceutical Industries', true);
    expect(loose.outcome).toBe('BOUND');
    expect(strict.outcome).toBe('AMBIGUOUS');
  });
});
