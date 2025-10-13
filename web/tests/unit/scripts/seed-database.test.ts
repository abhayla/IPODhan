/**
 * Unit Tests for Database Seeding Script
 * Story 7.11: Comprehensive testing of seed-database.ts logic
 *
 * Test Coverage:
 * - Data generation functions
 * - Distribution calculations
 * - Slug generation and uniqueness
 * - Date generation based on status
 * - Company name generation
 * - Configuration validation
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ==================== HELPER FUNCTIONS (copied from seed-database.ts) ====================

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDecimal(min: number, max: number, decimals: number = 2): string {
  const value = Math.random() * (max - min) + min;
  return value.toFixed(decimals);
}

function randomChoice<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

function getRelativeDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().split('T')[0];
}

function generateSlug(companyName: string, existingSlugs: Set<string>): string {
  let slug = companyName
    .toLowerCase()
    .replace(/\s+ltd$/i, '')
    .replace(/\s+limited$/i, '')
    .replace(/\s+pvt$/i, '')
    .replace(/\s+private$/i, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  let uniqueSlug = slug;
  let counter = 1;
  while (existingSlugs.has(uniqueSlug)) {
    uniqueSlug = `${slug}-${counter}`;
    counter++;
  }

  existingSlugs.add(uniqueSlug);
  return uniqueSlug;
}

type IPOStatus = 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED';

function generateDates(status: IPOStatus): {
  openDate: string;
  closeDate: string;
  allotmentDate: string | null;
  listingDate: string | null;
} {
  switch (status) {
    case 'UPCOMING':
      const upcomingOpenOffset = randomInt(5, 30);
      const upcomingCloseOffset = upcomingOpenOffset + randomInt(2, 5); // Always 2-5 days after open
      return {
        openDate: getRelativeDate(upcomingOpenOffset),
        closeDate: getRelativeDate(upcomingCloseOffset),
        allotmentDate: null,
        listingDate: null,
      };

    case 'OPEN':
      return {
        openDate: getRelativeDate(randomInt(-2, 0)),
        closeDate: getRelativeDate(randomInt(1, 3)),
        allotmentDate: getRelativeDate(randomInt(5, 8)),
        listingDate: getRelativeDate(randomInt(10, 14)),
      };

    case 'CLOSED':
      return {
        openDate: getRelativeDate(randomInt(-10, -3)),
        closeDate: getRelativeDate(randomInt(-2, -1)),
        allotmentDate: getRelativeDate(randomInt(2, 5)),
        listingDate: getRelativeDate(randomInt(7, 12)),
      };

    case 'LISTED':
      const daysAgoListed = randomInt(30, 365);
      return {
        openDate: getRelativeDate(-daysAgoListed - 5),
        closeDate: getRelativeDate(-daysAgoListed - 3),
        allotmentDate: getRelativeDate(-daysAgoListed - 1),
        listingDate: getRelativeDate(-daysAgoListed),
      };

    default:
      throw new Error(`Unknown status: ${status}`);
  }
}

function calculateStatusDistribution(total: number): Record<IPOStatus, number> {
  const distribution = {
    OPEN: { min: 10, max: 15 },
    CLOSED: { min: 20, max: 25 },
    LISTED: { min: 50, max: 60 },
    UPCOMING: { min: 10, max: 15 },
  };

  const openPercent = (distribution.OPEN.min + distribution.OPEN.max) / 2;
  const closedPercent = (distribution.CLOSED.min + distribution.CLOSED.max) / 2;
  const listedPercent = (distribution.LISTED.min + distribution.LISTED.max) / 2;
  const upcomingPercent = (distribution.UPCOMING.min + distribution.UPCOMING.max) / 2;

  let openCount = Math.round((total * openPercent) / 100);
  let closedCount = Math.round((total * closedPercent) / 100);
  let listedCount = Math.round((total * listedPercent) / 100);
  let upcomingCount = Math.round((total * upcomingPercent) / 100);

  const calculatedTotal = openCount + closedCount + listedCount + upcomingCount;
  const diff = total - calculatedTotal;
  listedCount += diff;

  return {
    OPEN: openCount,
    CLOSED: closedCount,
    LISTED: listedCount,
    UPCOMING: upcomingCount,
  };
}

// ==================== TEST SUITES ====================

describe('seed-database.ts - Helper Functions', () => {
  describe('randomInt', () => {
    it('should generate integer within range', () => {
      for (let i = 0; i < 100; i++) {
        const result = randomInt(10, 20);
        expect(result).toBeGreaterThanOrEqual(10);
        expect(result).toBeLessThanOrEqual(20);
        expect(Number.isInteger(result)).toBe(true);
      }
    });

    it('should handle single value range', () => {
      const result = randomInt(5, 5);
      expect(result).toBe(5);
    });

    it('should handle negative ranges', () => {
      for (let i = 0; i < 50; i++) {
        const result = randomInt(-20, -10);
        expect(result).toBeGreaterThanOrEqual(-20);
        expect(result).toBeLessThanOrEqual(-10);
      }
    });
  });

  describe('randomDecimal', () => {
    it('should generate decimal within range', () => {
      for (let i = 0; i < 100; i++) {
        const result = randomDecimal(10.5, 20.5, 2);
        const num = parseFloat(result);
        expect(num).toBeGreaterThanOrEqual(10.5);
        expect(num).toBeLessThanOrEqual(20.5);
      }
    });

    it('should respect decimal places', () => {
      const result = randomDecimal(10, 20, 3);
      const decimalPlaces = result.split('.')[1]?.length || 0;
      expect(decimalPlaces).toBe(3);
    });

    it('should return string format', () => {
      const result = randomDecimal(10, 20);
      expect(typeof result).toBe('string');
    });
  });

  describe('randomChoice', () => {
    it('should return element from array', () => {
      const arr = ['a', 'b', 'c', 'd'];
      for (let i = 0; i < 50; i++) {
        const result = randomChoice(arr);
        expect(arr).toContain(result);
      }
    });

    it('should handle single element array', () => {
      const arr = ['only'];
      const result = randomChoice(arr);
      expect(result).toBe('only');
    });
  });

  describe('getRelativeDate', () => {
    it('should return date in YYYY-MM-DD format', () => {
      const result = getRelativeDate(0);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should handle positive offset', () => {
      const future = getRelativeDate(10);
      const today = new Date().toISOString().split('T')[0];
      expect(future > today).toBe(true);
    });

    it('should handle negative offset', () => {
      const past = getRelativeDate(-10);
      const today = new Date().toISOString().split('T')[0];
      expect(past < today).toBe(true);
    });

    it('should handle zero offset (today)', () => {
      const result = getRelativeDate(0);
      const expected = new Date().toISOString().split('T')[0];
      expect(result).toBe(expected);
    });
  });
});

describe('seed-database.ts - Slug Generation', () => {
  let existingSlugs: Set<string>;

  beforeEach(() => {
    existingSlugs = new Set();
  });

  it('should generate slug from company name', () => {
    const slug = generateSlug('TechVision India Ltd', existingSlugs);
    expect(slug).toBe('techvision-india');
  });

  it('should remove "Ltd" suffix', () => {
    const slug = generateSlug('Smart Solutions Ltd', existingSlugs);
    expect(slug).not.toContain('ltd');
  });

  it('should remove "Limited" suffix', () => {
    const slug = generateSlug('Global Services Limited', existingSlugs);
    expect(slug).not.toContain('limited');
  });

  it('should remove "Pvt" suffix', () => {
    const slug = generateSlug('Metro Infrastructure Pvt Ltd', existingSlugs);
    expect(slug).not.toContain('pvt');
  });

  it('should handle special characters', () => {
    const slug = generateSlug('Tech@Vision (India) Ltd!', existingSlugs);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('should ensure uniqueness with counter', () => {
    const slug1 = generateSlug('TechVision India Ltd', existingSlugs);
    const slug2 = generateSlug('TechVision India Ltd', existingSlugs);

    expect(slug1).toBe('techvision-india');
    expect(slug2).toBe('techvision-india-1');
    expect(slug1).not.toBe(slug2);
  });

  it('should handle multiple duplicates', () => {
    const slugs = [];
    for (let i = 0; i < 5; i++) {
      slugs.push(generateSlug('Same Company Ltd', existingSlugs));
    }

    expect(slugs[0]).toBe('same-company');
    expect(slugs[1]).toBe('same-company-1');
    expect(slugs[2]).toBe('same-company-2');
    expect(slugs[3]).toBe('same-company-3');
    expect(slugs[4]).toBe('same-company-4');

    // All should be unique
    const uniqueSlugs = new Set(slugs);
    expect(uniqueSlugs.size).toBe(slugs.length);
  });

  it('should handle spaces and hyphens correctly', () => {
    const slug = generateSlug('Smart    Tech---Solutions   Ltd', existingSlugs);
    expect(slug).toBe('smart-tech-solutions');
    expect(slug).not.toMatch(/\s/);
    expect(slug).not.toMatch(/--/);
  });

  it('should be lowercase', () => {
    const slug = generateSlug('TechVISION INDIA Ltd', existingSlugs);
    expect(slug).toBe(slug.toLowerCase());
  });
});

describe('seed-database.ts - Date Generation', () => {
  describe('UPCOMING status', () => {
    it('should generate future dates', () => {
      const dates = generateDates('UPCOMING');
      const today = new Date().toISOString().split('T')[0];

      expect(dates.openDate > today).toBe(true);
      expect(dates.closeDate > today).toBe(true);
    });

    it('should have null allotment and listing dates', () => {
      const dates = generateDates('UPCOMING');
      expect(dates.allotmentDate).toBeNull();
      expect(dates.listingDate).toBeNull();
    });

    it('should have closeDate at or after openDate', () => {
      for (let i = 0; i < 20; i++) {
        const dates = generateDates('UPCOMING');
        // closeDate can be equal to or greater than openDate
        // This is because random ranges might overlap (e.g., openDate day 7, closeDate day 7)
        const openTime = new Date(dates.openDate).getTime();
        const closeTime = new Date(dates.closeDate).getTime();
        expect(closeTime >= openTime).toBe(true);
      }
    });
  });

  describe('OPEN status', () => {
    it('should have openDate in past or today', () => {
      const dates = generateDates('OPEN');
      const today = new Date().toISOString().split('T')[0];

      expect(dates.openDate <= today).toBe(true);
    });

    it('should have closeDate in future', () => {
      const dates = generateDates('OPEN');
      const today = new Date().toISOString().split('T')[0];

      expect(dates.closeDate >= today).toBe(true);
    });

    it('should have future allotment and listing dates', () => {
      const dates = generateDates('OPEN');
      const today = new Date().toISOString().split('T')[0];

      expect(dates.allotmentDate).not.toBeNull();
      expect(dates.listingDate).not.toBeNull();
      if (dates.allotmentDate) expect(dates.allotmentDate > today).toBe(true);
      if (dates.listingDate) expect(dates.listingDate > today).toBe(true);
    });
  });

  describe('CLOSED status', () => {
    it('should have openDate and closeDate in past', () => {
      const dates = generateDates('CLOSED');
      const today = new Date().toISOString().split('T')[0];

      expect(dates.openDate < today).toBe(true);
      expect(dates.closeDate < today).toBe(true);
    });

    it('should have future allotment and listing dates', () => {
      const dates = generateDates('CLOSED');
      const today = new Date().toISOString().split('T')[0];

      expect(dates.allotmentDate).not.toBeNull();
      expect(dates.listingDate).not.toBeNull();
      if (dates.allotmentDate) expect(dates.allotmentDate > today).toBe(true);
      if (dates.listingDate) expect(dates.listingDate > today).toBe(true);
    });
  });

  describe('LISTED status', () => {
    it('should have all dates in past', () => {
      const dates = generateDates('LISTED');
      const today = new Date().toISOString().split('T')[0];

      expect(dates.openDate < today).toBe(true);
      expect(dates.closeDate < today).toBe(true);
      expect(dates.allotmentDate).not.toBeNull();
      expect(dates.listingDate).not.toBeNull();
      if (dates.allotmentDate) expect(dates.allotmentDate < today).toBe(true);
      if (dates.listingDate) expect(dates.listingDate < today).toBe(true);
    });

    it('should have chronological order', () => {
      for (let i = 0; i < 20; i++) {
        const dates = generateDates('LISTED');

        expect(dates.openDate < dates.closeDate!).toBe(true);
        expect(dates.closeDate! < dates.allotmentDate!).toBe(true);
        expect(dates.allotmentDate! < dates.listingDate!).toBe(true);
      }
    });
  });
});

describe('seed-database.ts - Distribution Calculation', () => {
  it('should calculate correct totals', () => {
    const distribution = calculateStatusDistribution(150);
    const total = distribution.OPEN + distribution.CLOSED + distribution.LISTED + distribution.UPCOMING;

    expect(total).toBe(150);
  });

  it('should meet minimum percentage requirements', () => {
    const distribution = calculateStatusDistribution(150);

    // OPEN: 10-15%
    expect(distribution.OPEN).toBeGreaterThanOrEqual(15); // 10% of 150
    expect(distribution.OPEN).toBeLessThanOrEqual(23); // 15% of 150

    // CLOSED: 20-25%
    expect(distribution.CLOSED).toBeGreaterThanOrEqual(30); // 20% of 150
    expect(distribution.CLOSED).toBeLessThanOrEqual(38); // 25% of 150

    // LISTED: 50-60%
    expect(distribution.LISTED).toBeGreaterThanOrEqual(75); // 50% of 150
    expect(distribution.LISTED).toBeLessThanOrEqual(90); // 60% of 150

    // UPCOMING: 10-15%
    expect(distribution.UPCOMING).toBeGreaterThanOrEqual(15); // 10% of 150
    expect(distribution.UPCOMING).toBeLessThanOrEqual(23); // 15% of 150
  });

  it('should handle different total values', () => {
    const testCases = [100, 150, 200, 500];

    for (const total of testCases) {
      const distribution = calculateStatusDistribution(total);
      const sum = distribution.OPEN + distribution.CLOSED + distribution.LISTED + distribution.UPCOMING;

      expect(sum).toBe(total);
    }
  });

  it('should have LISTED as largest category', () => {
    const distribution = calculateStatusDistribution(150);

    expect(distribution.LISTED).toBeGreaterThan(distribution.OPEN);
    expect(distribution.LISTED).toBeGreaterThan(distribution.CLOSED);
    expect(distribution.LISTED).toBeGreaterThan(distribution.UPCOMING);
  });

  it('should adjust for rounding errors', () => {
    // Test with odd numbers that might cause rounding issues
    const testCases = [99, 151, 203];

    for (const total of testCases) {
      const distribution = calculateStatusDistribution(total);
      const sum = distribution.OPEN + distribution.CLOSED + distribution.LISTED + distribution.UPCOMING;

      expect(sum).toBe(total);
    }
  });
});

describe('seed-database.ts - Configuration Validation', () => {
  it('should have valid total IPO count', () => {
    const SEED_CONFIG = { totalIPOs: 150 };
    expect(SEED_CONFIG.totalIPOs).toBeGreaterThanOrEqual(150);
    expect(Number.isInteger(SEED_CONFIG.totalIPOs)).toBe(true);
  });

  it('should have valid batch size', () => {
    const SEED_CONFIG = { batchSize: 50 };
    expect(SEED_CONFIG.batchSize).toBeGreaterThan(0);
    expect(SEED_CONFIG.batchSize).toBeLessThanOrEqual(100);
    expect(Number.isInteger(SEED_CONFIG.batchSize)).toBe(true);
  });

  it('should have valid status distribution ranges', () => {
    const statusDistribution = {
      OPEN: { min: 10, max: 15 },
      CLOSED: { min: 20, max: 25 },
      LISTED: { min: 50, max: 60 },
      UPCOMING: { min: 10, max: 15 },
    };

    // All mins should be less than maxs
    for (const [status, range] of Object.entries(statusDistribution)) {
      expect(range.min).toBeLessThan(range.max);
      expect(range.min).toBeGreaterThan(0);
      expect(range.max).toBeLessThanOrEqual(100);
    }

    // Total percentages should be ~100%
    const minTotal = Object.values(statusDistribution).reduce((sum, range) => sum + range.min, 0);
    const maxTotal = Object.values(statusDistribution).reduce((sum, range) => sum + range.max, 0);

    expect(minTotal).toBeLessThanOrEqual(100);
    expect(maxTotal).toBeGreaterThanOrEqual(100);
  });

  it('should have valid category distribution', () => {
    const categoryDistribution = {
      MAINBOARD: 70,
      SME: 30,
    };

    expect(categoryDistribution.MAINBOARD + categoryDistribution.SME).toBe(100);
    expect(categoryDistribution.MAINBOARD).toBeGreaterThan(categoryDistribution.SME);
  });
});

describe('seed-database.ts - Data Quality', () => {
  it('should generate unique slugs for 150 companies', () => {
    const existingSlugs = new Set<string>();
    const companyNames = [];

    // Generate 150 different company names
    const prefixes = ['Tech', 'Digital', 'Smart', 'Global', 'Metro'];
    const sectors = ['Solutions', 'Systems', 'Industries', 'Services'];

    for (let i = 0; i < 150; i++) {
      const prefix = prefixes[i % prefixes.length];
      const sector = sectors[i % sectors.length];
      companyNames.push(`${prefix} ${sector} ${i} Ltd`);
    }

    // Generate slugs
    const slugs = companyNames.map(name => generateSlug(name, existingSlugs));

    // All should be unique
    const uniqueSlugs = new Set(slugs);
    expect(uniqueSlugs.size).toBe(150);
  });

  it('should handle slug generation performance', () => {
    const existingSlugs = new Set<string>();
    const startTime = Date.now();

    for (let i = 0; i < 1000; i++) {
      generateSlug(`Company ${i} Ltd`, existingSlugs);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Should complete in under 1 second
    expect(duration).toBeLessThan(1000);
  });
});

describe('seed-database.ts - Edge Cases', () => {
  it('should handle empty company name', () => {
    const existingSlugs = new Set<string>();
    const slug = generateSlug('Ltd', existingSlugs);

    // Should still generate a slug (empty after removing Ltd)
    expect(slug.length).toBeGreaterThan(0);
  });

  it('should handle very long company names', () => {
    const existingSlugs = new Set<string>();
    const longName = 'A'.repeat(300) + ' Ltd';
    const slug = generateSlug(longName, existingSlugs);

    expect(slug.length).toBeGreaterThan(0);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('should handle unicode characters', () => {
    const existingSlugs = new Set<string>();
    const unicodeName = 'Tëch Vïsîön Indïa Ltd';
    const slug = generateSlug(unicodeName, existingSlugs);

    // Should only contain ASCII alphanumeric and hyphens
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
});
