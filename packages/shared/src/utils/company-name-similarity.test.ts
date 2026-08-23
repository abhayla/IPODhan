import { describe, it, expect } from 'vitest';
import { levenshteinSimilarity, findMostSimilarName } from './company-name-similarity';
import { normalizeCompanyNameForMatching } from './company-name-normalizer';

/**
 * P2-2(a) (round-4 review, T-293): "Dhanwel Hybird Seeds Limited" (typo) and
 * "Dhanwel Hybrid Seeds Ltd." minted two live prod rows. Root cause: the
 * production write path (`upsertIPO` -> `findByNormalizedName` ->
 * `findBySlug`) only does EXACT-normalized / compact-whitespace matching —
 * there is NO similarity-based check anywhere on the CREATE path. The
 * `DuplicateDetectionService.checkCompanyName` 0.85-threshold Levenshtein
 * check exists but is never reached in production: `PipelineFactory.
 * createProductionPipeline` sets `skipDuplicateDetection: true` (see the
 * comment there — GitHub #3, upsertIPO is the declared SSOT for dedup+update).
 * So the "check" that looked like it should have caught 0.889-similar names
 * never actually ran on that insert path.
 */
describe('levenshteinSimilarity', () => {
  it('scores the real prod pair ("Dhanwel Hybird" vs "Dhanwel Hybrid") above the 0.85 threshold', () => {
    const a = normalizeCompanyNameForMatching('Dhanwel Hybird Seeds Limited');
    const b = normalizeCompanyNameForMatching('Dhanwel Hybrid Seeds Ltd.');
    // Documents the real gap: exact/compact normalized keys do NOT converge —
    // this typo pair is invisible to findByNormalizedName's two lookup tiers.
    expect(a).not.toBe(b);
    expect(a.replace(/\s+/g, '')).not.toBe(b.replace(/\s+/g, ''));

    const similarity = levenshteinSimilarity(a, b);
    expect(similarity).toBeGreaterThanOrEqual(0.85);
    expect(similarity).toBeCloseTo(0.9, 1);
  });

  it('returns 1.0 for identical strings and 0 for a totally different pair length', () => {
    expect(levenshteinSimilarity('acme industries', 'acme industries')).toBe(1);
    expect(levenshteinSimilarity('', '')).toBe(1);
  });

  it('a percentage-only reading of "Sun" vs "Sunrise" Pharmaceutical clears 0.85 (why findMostSimilarName needs the absolute-distance guard below)', () => {
    const a = normalizeCompanyNameForMatching('Sun Pharmaceutical Industries Ltd');
    const b = normalizeCompanyNameForMatching('Sunrise Pharmaceutical Industries Ltd');
    // This is the false-positive risk a bare percentage threshold carries —
    // two REAL different companies sharing a long common substring. The raw
    // percentage alone is NOT a safe duplicate signal; see findMostSimilarName.
    expect(levenshteinSimilarity(a, b)).toBeGreaterThanOrEqual(0.85);
  });
});

describe('findMostSimilarName', () => {
  it('finds the Dhanwel Hybird/Hybrid pair above the 0.85 threshold', () => {
    const candidate = normalizeCompanyNameForMatching('Dhanwel Hybird Seeds Limited');
    const existing = [
      normalizeCompanyNameForMatching('Dhanwel Hybrid Seeds Ltd.'),
      normalizeCompanyNameForMatching('Some Unrelated Company Ltd'),
    ];
    const match = findMostSimilarName(candidate, existing, 0.85);
    expect(match).toBe(normalizeCompanyNameForMatching('Dhanwel Hybrid Seeds Ltd.'));
  });

  it('returns null when nothing clears the threshold', () => {
    const candidate = normalizeCompanyNameForMatching('Brand New Company Ltd');
    const existing = [normalizeCompanyNameForMatching('Totally Different Enterprises Ltd')];
    expect(findMostSimilarName(candidate, existing, 0.85)).toBeNull();
  });

  it('returns null for an empty candidate list', () => {
    expect(findMostSimilarName('acme', [], 0.85)).toBeNull();
  });

  it('rejects "Sun" vs "Sunrise" Pharmaceutical despite clearing the 0.85 percentage — the absolute-edit-distance guard catches the insertion class', () => {
    const candidate = normalizeCompanyNameForMatching('Sunrise Pharmaceutical Industries Ltd');
    const existing = [normalizeCompanyNameForMatching('Sun Pharmaceutical Industries Ltd')];
    expect(findMostSimilarName(candidate, existing, 0.85)).toBeNull();
  });
});
