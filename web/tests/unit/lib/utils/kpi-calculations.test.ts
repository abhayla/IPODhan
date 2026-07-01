/**
 * Unit Tests for KPI Calculations
 * Story 11.11: Test all calculation functions
 */

import { describe, it, expect } from 'vitest';
import {
  calculateMarketCap,
  computeEquityDilution,
  calculatePreIPO_PE,
  calculatePostIPO_PE,
  calculateEPSChange,
  calculatePEChange,
  calculateRoNW,
  calculatePriceToBook,
  getChangeColorClass,
  getChangeTrend,
} from '@/lib/utils/kpi-calculations';

describe('calculateMarketCap', () => {
  it('should calculate market cap correctly', () => {
    const result = calculateMarketCap(100000000, 500); // 10 crore shares @ ₹500
    expect(result).toBe(5000); // ₹5000 crores
  });

  it('should return null for null shares', () => {
    expect(calculateMarketCap(null, 500)).toBeNull();
  });

  it('should return null for null price', () => {
    expect(calculateMarketCap(100000000, null)).toBeNull();
  });

  it('should return null for zero shares', () => {
    expect(calculateMarketCap(0, 500)).toBeNull();
  });

  it('should return null for negative shares', () => {
    expect(calculateMarketCap(-100000000, 500)).toBeNull();
  });
});

describe('calculatePreIPO_PE', () => {
  it('should calculate pre-IPO P/E correctly', () => {
    const result = calculatePreIPO_PE(500, 25); // ₹500 / ₹25 EPS
    expect(result).toBe(20);
  });

  it('should return null for null issue price', () => {
    expect(calculatePreIPO_PE(null, 25)).toBeNull();
  });

  it('should return null for null EPS', () => {
    expect(calculatePreIPO_PE(500, null)).toBeNull();
  });

  it('should return null for zero EPS', () => {
    expect(calculatePreIPO_PE(500, 0)).toBeNull();
  });

  it('should handle negative EPS', () => {
    const result = calculatePreIPO_PE(500, -25);
    expect(result).toBe(-20);
  });
});

describe('calculatePostIPO_PE', () => {
  it('should calculate post-IPO P/E correctly', () => {
    const result = calculatePostIPO_PE(500, 20); // ₹500 / ₹20 EPS
    expect(result).toBe(25);
  });

  it('should return null for null issue price', () => {
    expect(calculatePostIPO_PE(null, 20)).toBeNull();
  });

  it('should return null for null EPS', () => {
    expect(calculatePostIPO_PE(500, null)).toBeNull();
  });

  it('should return null for zero EPS', () => {
    expect(calculatePostIPO_PE(500, 0)).toBeNull();
  });
});

describe('calculateEPSChange', () => {
  it('should calculate positive EPS change correctly', () => {
    const result = calculateEPSChange(20, 25); // 20 → 25 = +25%
    expect(result).toBe(25);
  });

  it('should calculate negative EPS change correctly', () => {
    const result = calculateEPSChange(25, 20); // 25 → 20 = -20%
    expect(result).toBe(-20);
  });

  it('should return 0 for no change', () => {
    const result = calculateEPSChange(25, 25);
    expect(result).toBe(0);
  });

  it('should return null for null pre-EPS', () => {
    expect(calculateEPSChange(null, 25)).toBeNull();
  });

  it('should return null for null post-EPS', () => {
    expect(calculateEPSChange(25, null)).toBeNull();
  });

  it('should return null for zero pre-EPS', () => {
    expect(calculateEPSChange(0, 25)).toBeNull();
  });

  it('should handle negative pre-EPS correctly', () => {
    const result = calculateEPSChange(-20, 10);
    expect(result).toBe(150); // From -20 to +10 is 150% improvement
  });
});

describe('calculatePEChange', () => {
  it('should calculate positive P/E change correctly', () => {
    const result = calculatePEChange(20, 25); // 20 → 25 = +25%
    expect(result).toBe(25);
  });

  it('should calculate negative P/E change correctly', () => {
    const result = calculatePEChange(25, 20); // 25 → 20 = -20%
    expect(result).toBe(-20);
  });

  it('should return null for null pre-P/E', () => {
    expect(calculatePEChange(null, 25)).toBeNull();
  });

  it('should return null for null post-P/E', () => {
    expect(calculatePEChange(25, null)).toBeNull();
  });

  it('should return null for zero pre-P/E', () => {
    expect(calculatePEChange(0, 25)).toBeNull();
  });
});

describe('calculateRoNW', () => {
  it('should calculate RoNW correctly', () => {
    const result = calculateRoNW(500, 2500); // ₹500 Cr profit, ₹2500 Cr net worth = 20%
    expect(result).toBe(20);
  });

  it('should return null for null net profit', () => {
    expect(calculateRoNW(null, 2500)).toBeNull();
  });

  it('should return null for null net worth', () => {
    expect(calculateRoNW(500, null)).toBeNull();
  });

  it('should return null for zero net worth', () => {
    expect(calculateRoNW(500, 0)).toBeNull();
  });

  it('should handle negative net profit', () => {
    const result = calculateRoNW(-500, 2500);
    expect(result).toBe(-20);
  });
});

describe('calculatePriceToBook', () => {
  it('should calculate P/BV correctly', () => {
    const result = calculatePriceToBook(500, 2500, 10000000); // ₹500 price, ₹2500 Cr net worth, 1 Cr shares
    // Book value per share = (2500 * 10000000) / 10000000 = 2500
    // P/BV = 500 / 2500 = 0.2
    expect(result).toBeCloseTo(0.2, 2);
  });

  it('should return null for null issue price', () => {
    expect(calculatePriceToBook(null, 2500, 10000000)).toBeNull();
  });

  it('should return null for null net worth', () => {
    expect(calculatePriceToBook(500, null, 10000000)).toBeNull();
  });

  it('should return null for null total shares', () => {
    expect(calculatePriceToBook(500, 2500, null)).toBeNull();
  });

  it('should return null for zero total shares', () => {
    expect(calculatePriceToBook(500, 2500, 0)).toBeNull();
  });
});

describe('getChangeColorClass', () => {
  it('should return green for positive change', () => {
    expect(getChangeColorClass(10)).toBe('text-green-600');
  });

  it('should return red for negative change', () => {
    expect(getChangeColorClass(-10)).toBe('text-red-600');
  });

  it('should return muted for zero change', () => {
    expect(getChangeColorClass(0)).toBe('text-muted-foreground');
  });

  it('should return muted for null', () => {
    expect(getChangeColorClass(null)).toBe('text-muted-foreground');
  });
});

describe('getChangeTrend', () => {
  it('should return "up" for positive change', () => {
    expect(getChangeTrend(10)).toBe('up');
  });

  it('should return "down" for negative change', () => {
    expect(getChangeTrend(-10)).toBe('down');
  });

  it('should return "neutral" for zero change', () => {
    expect(getChangeTrend(0)).toBe('neutral');
  });

  it('should return "neutral" for null', () => {
    expect(getChangeTrend(null)).toBe('neutral');
  });
});

describe('computeEquityDilution — plausibility-guarded (blind-QA: exato showed 2152%)', () => {
  it('computes a sane dilution (pre - post) when both are valid percentages', () => {
    expect(computeEquityDilution(75, 55)).toBe(20);
    expect(computeEquityDilution(90, 86.5)).toBe(3.5);
  });
  it('returns null (→ N/A, not an absurd render) when inputs are not valid percentages', () => {
    // EXATO shape: stored values are not %, subtraction would give 2152 → must be rejected.
    expect(computeEquityDilution(2200, 48)).toBeNull();
    expect(computeEquityDilution(150, 20)).toBeNull(); // pre > 100
    expect(computeEquityDilution(80, -5)).toBeNull();   // post < 0
  });
  it('rejects a negative dilution (post > pre is impossible)', () => {
    expect(computeEquityDilution(40, 60)).toBeNull();
  });
  it('returns null for missing / non-finite inputs', () => {
    expect(computeEquityDilution(null, 55)).toBeNull();
    expect(computeEquityDilution(75, null)).toBeNull();
    expect(computeEquityDilution(NaN, 55)).toBeNull();
  });
  it('accepts a genuinely low dilution (0.10% is low but in-range, not absurd)', () => {
    expect(computeEquityDilution(74.1, 74)).toBeCloseTo(0.1, 2);
  });
});
