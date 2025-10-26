/**
 * Unit Tests for KPI Formatters
 * Story 11.11: Test all formatter functions
 */

import { describe, it, expect } from 'vitest';
import {
  formatMarketCap,
  formatPercentage,
  formatRatio,
  formatCurrency,
  formatChange,
  formatCompactNumber,
  formatIndianNumber,
  formatEPS,
  formatPE,
  formatROE,
} from '@/lib/utils/kpi-formatters';

describe('formatMarketCap', () => {
  it('should format market cap in crores', () => {
    expect(formatMarketCap(5000)).toBe('₹5,000 Cr');
  });

  it('should format decimal market cap', () => {
    expect(formatMarketCap(1234.56)).toBe('₹1,234.56 Cr');
  });

  it('should return N/A for null', () => {
    expect(formatMarketCap(null)).toBe('N/A');
  });

  it('should return N/A for undefined', () => {
    expect(formatMarketCap(undefined)).toBe('N/A');
  });
});

describe('formatPercentage', () => {
  it('should format percentage with 1 decimal by default', () => {
    expect(formatPercentage(18.5)).toBe('18.5%');
  });

  it('should format percentage with 2 decimals', () => {
    expect(formatPercentage(18.56, 2)).toBe('18.56%');
  });

  it('should return N/A for null', () => {
    expect(formatPercentage(null)).toBe('N/A');
  });

  it('should handle zero percentage', () => {
    expect(formatPercentage(0)).toBe('0.0%');
  });
});

describe('formatRatio', () => {
  it('should format ratio with 2 decimals by default', () => {
    expect(formatRatio(3.25)).toBe('3.25x');
  });

  it('should format ratio with 1 decimal', () => {
    expect(formatRatio(12.5, 1)).toBe('12.5x');
  });

  it('should return N/A for null', () => {
    expect(formatRatio(null)).toBe('N/A');
  });
});

describe('formatCurrency', () => {
  it('should format currency with rupee symbol', () => {
    expect(formatCurrency(45.20)).toBe('₹45.20');
  });

  it('should format whole numbers with 2 decimals', () => {
    expect(formatCurrency(100)).toBe('₹100.00');
  });

  it('should return N/A for null', () => {
    expect(formatCurrency(null)).toBe('N/A');
  });
});

describe('formatChange', () => {
  it('should format positive change with + sign', () => {
    expect(formatChange(12.5)).toBe('+12.5%');
  });

  it('should format negative change', () => {
    expect(formatChange(-8.3)).toBe('-8.3%');
  });

  it('should format zero change', () => {
    expect(formatChange(0)).toBe('0.0%');
  });

  it('should return N/A for null', () => {
    expect(formatChange(null)).toBe('N/A');
  });
});

describe('formatCompactNumber', () => {
  it('should format crores', () => {
    expect(formatCompactNumber(15000000)).toBe('1.50 Cr');
  });

  it('should format lakhs', () => {
    expect(formatCompactNumber(1500000)).toBe('15.00 Lakh');
  });

  it('should format thousands', () => {
    expect(formatCompactNumber(1500)).toBe('1.5K');
  });

  it('should format small numbers', () => {
    expect(formatCompactNumber(500)).toBe('500');
  });

  it('should return N/A for null', () => {
    expect(formatCompactNumber(null)).toBe('N/A');
  });
});

describe('formatIndianNumber', () => {
  it('should format number with Indian number system', () => {
    expect(formatIndianNumber(123456)).toBe('1,23,456');
  });

  it('should format large number', () => {
    expect(formatIndianNumber(1234567)).toBe('12,34,567');
  });

  it('should return N/A for null', () => {
    expect(formatIndianNumber(null)).toBe('N/A');
  });
});

describe('formatEPS', () => {
  it('should format EPS as currency', () => {
    expect(formatEPS(45.20)).toBe('₹45.20');
  });

  it('should return N/A for null', () => {
    expect(formatEPS(null)).toBe('N/A');
  });
});

describe('formatPE', () => {
  it('should format P/E as ratio', () => {
    expect(formatPE(25.5)).toBe('25.50x');
  });

  it('should return N/A for null', () => {
    expect(formatPE(null)).toBe('N/A');
  });
});

describe('formatROE', () => {
  it('should format ROE as percentage', () => {
    expect(formatROE(18.5)).toBe('18.5%');
  });

  it('should return N/A for null', () => {
    expect(formatROE(null)).toBe('N/A');
  });
});
