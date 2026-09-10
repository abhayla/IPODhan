import { describe, it, expect } from 'vitest';
import { foldCompanyIdentity, IDENTITY_FOLD_FIXTURE } from './company-identity-fold';

/**
 * Item 12 slice A. This module is an EXTRACTION, not a behaviour change: the
 * body moved here verbatim from `duplicate-ipo-merge.ts:26` (`foldCompanyName`),
 * which the `.mjs` repair invariant hand-copies as `foldName`. These tests pin
 * the behaviour so the extraction cannot drift, and so slice 12-B — which
 * changes the SEPARATE binding normaliser — cannot silently change what the
 * repair tool considers "the same company".
 */
describe('foldCompanyIdentity', () => {
  it('folds the ARCIL pair to one identity (the case this fold exists for, F-55)', () => {
    expect(foldCompanyIdentity('ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED')).toBe(
      foldCompanyIdentity('Asset Reconstruction Co.(India) Ltd.'),
    );
    expect(foldCompanyIdentity('Asset Reconstruction Co.(India) Ltd.')).toBe('assetreconstruction');
  });

  it('keeps genuinely different companies APART — the false-merge direction', () => {
    // A fold that is too aggressive merges two real companies and a repair tool
    // then deletes one of them. This is the assertion that stops that.
    expect(foldCompanyIdentity('Sun Pharmaceutical Industries Ltd')).not.toBe(
      foldCompanyIdentity('Sunrise Pharmaceutical Industries Ltd'),
    );
    expect(foldCompanyIdentity('Atharva Polyplast Limited')).not.toBe(
      foldCompanyIdentity('Atharva Polymers Limited'),
    );
  });

  it('strips corporate-form words only on a WORD boundary, never inside a word', () => {
    // "incorporated" contains "corp"; "Ultratech" contains no keyword but a
    // naive substring strip would maul names like "Coal India" -> "al".
    expect(foldCompanyIdentity('India Company Limited')).toBe('');
    expect(foldCompanyIdentity('Coal India Limited')).toBe('coal');
    expect(foldCompanyIdentity('Incorporated Systems')).toBe('systems');
  });

  it('is null/undefined/empty safe and returns a string every time', () => {
    expect(foldCompanyIdentity(null)).toBe('');
    expect(foldCompanyIdentity(undefined)).toBe('');
    expect(foldCompanyIdentity('')).toBe('');
    expect(foldCompanyIdentity('   ')).toBe('');
    expect(foldCompanyIdentity('.,()&\'"-')).toBe('');
  });

  it('ships a shared fixture the .mjs parity test can import (single source of names)', () => {
    expect(Array.isArray(IDENTITY_FOLD_FIXTURE)).toBe(true);
    expect(IDENTITY_FOLD_FIXTURE.length).toBeGreaterThanOrEqual(20);
    for (const name of IDENTITY_FOLD_FIXTURE) expect(typeof name).toBe('string');
  });
});
