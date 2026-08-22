import { describe, it, expect } from 'vitest';
import { normalizeCompanyNameForMatching } from './company-name-normalizer';

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
});
