import { describe, it, expect } from 'vitest';
import { normalizeCompanyNameForMatching, compactCompanyNameKey } from './company-name-normalizer';

/**
 * P2-1 (round-2 review, T-277): 11 duplicate IPO pairs existed in prod because
 * `normalizeCompanyNameForMatching` (the JS half of the dedup identity key used
 * by `upsertIPO`'s `findByNormalizedName` lookup) didn't fold punctuation
 * variance — "&" vs "and", a period-joined suffix ("Engg.Ltd."), a redundant
 * trailing parenthetical ("Ltd. (Company Name IPO)"), or a mid-string
 * paren/hyphen ("(India)", "Indo-MIM" vs "INDO MIM") — so a re-scrape with a
 * differently-punctuated name minted a second identity instead of matching
 * the existing row. These are the real pairs pulled from prod (evidence:
 * D:\Abhay\GetWorkDone\evidence\2026-08-22-T-272\02-db-dupes2.txt).
 */
describe('normalizeCompanyNameForMatching — P2-1 duplicate-prevention pairs', () => {
  const convergingPairs: Array<[string, string, string]> = [
    ['Caliber Mining & Logistics Ltd.', 'Caliber Mining and Logistics', 'caliber mining and logistics'],
    ['Gulf Lloyds India', 'Gulf Lloyds (India) Ltd.', 'gulf lloyds india'],
    ['G V Electricals', 'G.V.Electricals Ltd. (G.V. Electricals IPO)', 'g v electricals'],
    ['H R Hygiene Products', 'H.R.Hygiene Products Ltd. (H.R. Hygiene Products IPO)', 'h r hygiene products'],
    ['INDO MIM Limited', 'Indo-MIM Ltd.', 'indo mim'],
    ['Laser Power & Infra Ltd.', 'Laser Power and Infra', 'laser power and infra'],
    ['Poojaa Precision Engg', 'Poojaa Precision Engg.Ltd.', 'poojaa precision engg'],
    ['Propshop Events and Exhibitions', 'Propshop Events & Exhibitions Ltd.', 'propshop events and exhibitions'],
    [
      'Shree Balaji (Mala) Textiles Limited',
      'Shree Balaji (Mala) Textiles Ltd. (Shree Balaji Mala IPO)',
      'shree balaji mala textiles',
    ],
    ['Silverstorm Parks and Resorts', 'Silverstorm Parks & Resorts Ltd.', 'silverstorm parks and resorts'],
  ];

  it.each(convergingPairs)('"%s" and "%s" converge to the same identity key', (a, b, expected) => {
    const normA = normalizeCompanyNameForMatching(a);
    const normB = normalizeCompanyNameForMatching(b);
    expect(normA).toBe(expected);
    expect(normB).toBe(expected);
    expect(normA).toBe(normB);
  });

  it('does not need "&" vs "and" to differ for the same company', () => {
    expect(normalizeCompanyNameForMatching('M&B Engineering Ltd')).toBe('m and b engineering');
  });

  it('folds a period-joined suffix ("Engg.Ltd.") the same as a spaced one', () => {
    expect(normalizeCompanyNameForMatching('Foo Engg.Ltd.')).toBe(normalizeCompanyNameForMatching('Foo Engg Ltd'));
  });

  it('folds a mid-string hyphen the same as a space ("Indo-MIM" vs "Indo MIM")', () => {
    expect(normalizeCompanyNameForMatching('Indo-MIM Ltd')).toBe(normalizeCompanyNameForMatching('Indo MIM Ltd'));
  });

  it('strips a redundant trailing parenthetical descriptor', () => {
    expect(normalizeCompanyNameForMatching('Foo Bar Ltd. (Foo Bar IPO)')).toBe('foo bar');
  });

  it('still preserves pre-existing legal-suffix + status-code stripping', () => {
    expect(normalizeCompanyNameForMatching('Midwest Ltd. IPO')).toBe('midwest');
    expect(normalizeCompanyNameForMatching('Acme Industries Private Limited')).toBe('acme industries');
    expect(normalizeCompanyNameForMatching('Jay Bee Laminations Ltd. O')).toBe('jay bee laminations');
  });

  /**
   * P3-1 (round-2 review, T-278): "X Ltd. (X IPO)" and "X Ltd. (X IPO) O" must
   * converge to the SAME identity key. Before this fix they did not — the
   * trailing 1-2 letter status code sits AFTER the closing paren, so neither
   * the ltd-anchored status-code strip nor the trailing-paren strip fired on
   * the suffixed variant, minting a second row every re-scrape (prod: 5
   * duplicate rows each for G.V. Electricals, H.R. Hygiene, Shree Balaji).
   */
  it('converges "X Ltd. (X IPO)" with "X Ltd. (X IPO) <status code>" (P3-1)', () => {
    const base = normalizeCompanyNameForMatching('G.V.Electricals Ltd. (G.V. Electricals IPO)');
    expect(base).toBe('g v electricals');
    for (const code of ['O', 'P', 'LT', 'CT']) {
      expect(normalizeCompanyNameForMatching(`G.V.Electricals Ltd. (G.V. Electricals IPO) ${code}`)).toBe(base);
    }
  });
});

/**
 * T-277F checker finding #1: a hyphenated compound ("Atharva Poly-Plast") and
 * its run-together sibling ("Atharva Polyplast") do NOT converge under
 * `normalizeCompanyNameForMatching` alone ('atharva poly plast' vs
 * 'atharva polyplast') because one has a word-break space and the other has
 * none. `compactCompanyNameKey` is the coarser, whitespace-stripped identity
 * used only as a duplicate-match fallback (see ipo-repository.ts
 * findByNormalizedName) — it folds this class WITHOUT changing the primary
 * spaced key any other consumer relies on.
 */
describe('compactCompanyNameKey — word-break fold (P2-1, T-277F)', () => {
  it('does NOT converge under the primary spaced normalizer (documents the gap being fixed)', () => {
    expect(normalizeCompanyNameForMatching('Atharva Poly-Plast')).toBe('atharva poly plast');
    expect(normalizeCompanyNameForMatching('Atharva Polyplast Ltd.')).toBe('atharva polyplast');
    expect(normalizeCompanyNameForMatching('Atharva Poly-Plast')).not.toBe(
      normalizeCompanyNameForMatching('Atharva Polyplast Ltd.')
    );
  });

  it('converges the Atharva pair under the compact fallback key', () => {
    expect(compactCompanyNameKey('Atharva Poly-Plast')).toBe('atharvapolyplast');
    expect(compactCompanyNameKey('Atharva Polyplast Ltd.')).toBe('atharvapolyplast');
    expect(compactCompanyNameKey('Atharva Poly-Plast')).toBe(compactCompanyNameKey('Atharva Polyplast Ltd.'));
  });

  it('still agrees on every already-converging P2-1 pair (exact match is a subset of compact match)', () => {
    const pairs: Array<[string, string]> = [
      ['Caliber Mining & Logistics Ltd.', 'Caliber Mining and Logistics'],
      ['G V Electricals', 'G.V.Electricals Ltd. (G.V. Electricals IPO)'],
      ['INDO MIM Limited', 'Indo-MIM Ltd.'],
    ];
    for (const [a, b] of pairs) {
      expect(compactCompanyNameKey(a)).toBe(compactCompanyNameKey(b));
    }
  });

  it('guard: does NOT over-merge genuinely different companies that merely share a name family', () => {
    // Same brand prefix, different actual company (Polyplast vs Polymers) —
    // the compact fold only removes whitespace, it never merges letters
    // across a real semantic boundary, so these must stay distinct.
    expect(compactCompanyNameKey('Atharva Poly-Plast')).not.toBe(
      compactCompanyNameKey('Atharva Polymers Ltd.')
    );
    // Two unrelated companies with similar shapes must also stay distinct.
    expect(compactCompanyNameKey('Sun Pharmaceutical Industries Ltd')).not.toBe(
      compactCompanyNameKey('Sunrise Pharmaceutical Industries Ltd')
    );
  });
});
