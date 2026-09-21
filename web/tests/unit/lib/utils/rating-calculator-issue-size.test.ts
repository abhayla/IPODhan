/**
 * F-77 (item 11 / OD-20) — the identical defect as F-95, in the other file.
 *
 * `calculateMarketScore` compares `ipo.issueSize` against 1000 / 500 / 100.
 * Those are CRORE figures; `ipos.issue_size` is stored in RUPEES. Measured on
 * staging 2026-09-21, 314 of 366 rows hold a rupee-shaped value (>= 1e7), so
 * every real IPO cleared ">= 1000" and took the full +10 — the term ranked
 * nothing.
 *
 * This file exists because F-77 previously had NO test at all, which is
 * precisely why it stayed "documented but unfixed" while its twin was tracked.
 * `calculateIPORating` is reached from a live API route
 * (`app/api/ipos/[slug]/rating/route.ts`) and `scripts/calculate-ratings.ts`.
 */
import { describe, it, expect } from 'vitest';
import { calculateMarketScore } from '@/lib/utils/rating-calculator';
import type { IPO } from '@/lib/db/types';

const ipoWith = (issueSize: number, segment: string | null = null): IPO =>
  ({ issueSize, segment, sector: null } as unknown as IPO);

describe('F-77: rating-calculator market score vs a rupee-denominated issue_size', () => {
  it('gives the large-issue bonus only to a genuinely large issue', () => {
    // NSE, the largest on staging: Rs26,579.64 Cr -> +10 over the base 60.
    expect(calculateMarketScore(ipoWith(265_796_400_000))).toBe(70);
  });

  it('penalises a genuinely small issue instead of rewarding it', () => {
    // PIYUSH: Rs0.70 Cr, well under the Rs100 Cr floor -> -10.
    expect(calculateMarketScore(ipoWith(7_007_320))).toBe(50);
  });

  it('gives a mid-sized issue the middle bonus', () => {
    // Rs700 Cr: >= 500, < 1000 -> +5.
    expect(calculateMarketScore(ipoWith(7_000_000_000))).toBe(65);
  });

  it('gives no bonus and no penalty in the Rs100-500 Cr band', () => {
    // Rs300 Cr: above the penalty floor, below the +5 band -> base only.
    expect(calculateMarketScore(ipoWith(3_000_000_000))).toBe(60);
  });

  it('separates a large issue from a small one', () => {
    // The whole point of the term. Before the fix both returned 70.
    expect(calculateMarketScore(ipoWith(265_796_400_000)))
      .toBeGreaterThan(calculateMarketScore(ipoWith(7_007_320)));
  });
});
