import { describe, it, expect, beforeAll } from 'vitest';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import {
  detectBSEDetailPageType,
  validateBSEDetailData,
  parseDisplayIPOPage,
  parseACQDispPage,
  calculateIssueSize,
  type BSEDetailPageData,
  type BSEDetailPageType
} from '../../../src/scrapers/bse-detail-scraper.js';

/**
 * Unit Tests for BSE Detail Scraper
 *
 * Test Coverage:
 * - Page type detection (3 tests)
 * - ACQDisp parser - REGRESSION (4 tests)
 * - DisplayIPO parser - NEW (5 tests)
 * - Conditional validation (3 tests)
 *
 * Total: 15 test cases minimum
 */

// Load HTML fixtures
let rightsIssueHTML: string;
let debtIssueHTML: string;
let mainboardAcqDispHTML: string;

beforeAll(() => {
  const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures');

  rightsIssueHTML = fs.readFileSync(
    path.join(fixturesPath, 'bse-rights-issue-detail.html'),
    'utf-8'
  );

  debtIssueHTML = fs.readFileSync(
    path.join(fixturesPath, 'bse-debt-issue-detail.html'),
    'utf-8'
  );

  mainboardAcqDispHTML = fs.readFileSync(
    path.join(fixturesPath, 'bse-mainboard-acqdisp.html'),
    'utf-8'
  );
});

// ==================== PAGE TYPE DETECTION TESTS ====================

describe('detectBSEDetailPageType', () => {
  it('should detect ACQDisp.aspx URL correctly', () => {
    const url = 'https://www.bseindia.com/markets/PublicIssues/ACQDisp.aspx?id=543555&Type=OTB&IDType=1';
    const result = detectBSEDetailPageType(url);
    expect(result).toBe('ACQDisp');
  });

  it('should detect DisplayIPO.aspx URL correctly', () => {
    const url = 'https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id=535238&type=RI&idtype=1';
    const result = detectBSEDetailPageType(url);
    expect(result).toBe('DisplayIPO');
  });

  it('should default to ACQDisp for unknown URL patterns', () => {
    const url = 'https://www.bseindia.com/markets/unknown/page.aspx?id=123';
    const result = detectBSEDetailPageType(url);
    expect(result).toBe('ACQDisp');
  });

  it('should handle case-insensitive URL matching', () => {
    const url = 'https://www.bseindia.com/markets/publicissues/DISPLAYIPO.ASPX?id=123&type=RI';
    const result = detectBSEDetailPageType(url);
    expect(result).toBe('DisplayIPO');
  });
});

// ==================== ACQDISP PARSER REGRESSION TESTS ====================

describe('parseACQDispPage - REGRESSION (MAINBOARD/SME)', () => {
  it('should extract symbol from MAINBOARD page', () => {
    const $ = cheerio.load(mainboardAcqDispHTML);

    // Manual extraction to verify parser logic
    let symbol: string | null = null;
    $('table tr').each((_, row) => {
      const cells = $(row).find('td.TTRow_left');
      if (cells.length === 2) {
        const label = $(cells[0]).text().trim();
        if (label.toLowerCase().includes('symbol')) {
          symbol = $(cells[1]).text().trim();
        }
      }
    });

    expect(symbol).toBe('MIDWESTLTD');
  });

  it('should extract lead managers from MAINBOARD page', () => {
    const $ = cheerio.load(mainboardAcqDispHTML);

    let leadManagers: string | null = null;
    $('table tr').each((_, row) => {
      const cells = $(row).find('td.TTRow_left');
      if (cells.length === 2) {
        const label = $(cells[0]).text().trim();
        if (label.toLowerCase().includes('book running lead manager')) {
          leadManagers = $(cells[1]).text().trim();
        }
      }
    });

    expect(leadManagers).toBeTruthy();
    expect(leadManagers).toContain('Beeline Capital Advisors Pvt. Ltd.');
  });

  it('should extract all required fields from MAINBOARD page', () => {
    const $ = cheerio.load(mainboardAcqDispHTML);

    // Extract key fields
    const fields: Record<string, string | null> = {};

    $('table tr').each((_, row) => {
      const cells = $(row).find('td.TTRow_left');
      if (cells.length === 2) {
        const label = $(cells[0]).text().trim();
        const value = $(cells[1]).text().trim();

        if (label.toLowerCase().includes('symbol')) fields.symbol = value;
        if (label.toLowerCase().includes('issue period')) fields.issuePeriod = value;
        if (label.toLowerCase().includes('price band')) fields.priceBand = value;
        if (label.toLowerCase().includes('face value')) fields.faceValue = value;
        if (label.toLowerCase().includes('market lot')) fields.lotSize = value;
        if (label.toLowerCase().includes('registrar')) fields.registrar = value;
      }
    });

    // Verify all required fields are present
    expect(fields.symbol).toBe('MIDWESTLTD');
    expect(fields.issuePeriod).toBe('15 Oct 2025 to 17 Oct 2025');
    expect(fields.priceBand).toBe('1014.00-1065.00');
    expect(fields.faceValue).toBe('10');
    expect(fields.lotSize).toBe('14');
    expect(fields.registrar).toBe('Link Intime India Pvt. Ltd.');
  });

  it('should parse price band correctly (min-max format)', () => {
    const priceBand = '1014.00-1065.00';
    const parts = priceBand.split(/-/).map(p => p.trim());

    expect(parts.length).toBe(2);
    expect(parseFloat(parts[0])).toBe(1014.00);
    expect(parseFloat(parts[1])).toBe(1065.00);
  });

  // W-109 (round-8, Glass Wall Systems): the exchange's published share
  // count is the count AT THE FLOOR price ("up to N shares"). Multiplying
  // that count by the CAP price produces a total that appears nowhere in
  // the filing. calculateIssueSize() must be fed the band FLOOR.
  it('W-109: calculateIssueSize uses the floor price, never the cap', () => {
    // Glass Wall Systems: 23,702,094 sh, band 172-182.
    // Real filing total (floor): 23,702,094 x 172 = 4,076,760,168.
    expect(calculateIssueSize(23702094, 172)).toBe(4076760168);
    // The old bug: 23,702,094 x 182 (cap) = 4,313,781,108 — never published.
    expect(calculateIssueSize(23702094, 172)).not.toBe(4313781108);
  });

  it('W-109: a fixed-price IPO (floor === cap) is unchanged', () => {
    expect(calculateIssueSize(100000, 250)).toBe(25000000);
  });

  it('W-109: parseACQDispPage computes issueSize from the band FLOOR (MIDWESTLTD fixture: 1014-1065)', () => {
    const $ = cheerio.load(mainboardAcqDispHTML);
    const result = parseACQDispPage($);
    expect(result.priceRangeMin).toBe(1014);
    expect(result.priceRangeMax).toBe(1065);
    expect(result.issueShares).toBe(3117460);
    // Floor-priced total: 3,117,460 x 1,014 = 3,161,104,440.
    expect(result.issueSize).toBe(3161104440);
    // Never the cap-multiplied total (the pre-fix bug):
    // 3,117,460 x 1,065 = 3,320,094,900.
    expect(result.issueSize).not.toBe(3320094900);
  });
});

// ==================== DISPLAYIPO PARSER NEW TESTS ====================

describe('parseDisplayIPOPage - NEW (RIGHTS/NCD)', () => {
  it('should extract data from Rights Issue HTML fixture', () => {
    const $ = cheerio.load(rightsIssueHTML);

    const fields: Record<string, string | null> = {};

    $('table tr').each((_, row) => {
      const cells = $(row).find('td.TTRow_left');
      if (cells.length === 2) {
        const label = $(cells[0]).text().trim();
        const value = $(cells[1]).text().trim();

        if (label.toLowerCase().includes('symbol')) fields.symbol = value;
        if (label.toLowerCase().includes('issue period')) fields.issuePeriod = value;
        if (label.toLowerCase().includes('issue price')) fields.issuePrice = value;
        if (label.toLowerCase().includes('lot size')) fields.lotSize = value;
        if (label.toLowerCase().includes('face value')) fields.faceValue = value;
        if (label.toLowerCase().includes('registrar')) fields.registrar = value;
        if (label.toLowerCase().includes('lead manager')) fields.leadManagers = value;
      }
    });

    // Rights Issue specific validations
    expect(fields.issuePeriod).toBe('15 Jan 2024 to 22 Jan 2024');
    expect(fields.issuePrice).toBe('100.00');
    expect(fields.lotSize).toBe('150');
    expect(fields.faceValue).toBe('10');
    expect(fields.registrar).toBe('KFin Technologies Limited');

    // Symbol and Lead Managers can be null (not present in HTML)
    expect(fields.symbol).toBeUndefined(); // Field not in HTML
    expect(fields.leadManagers).toBeUndefined(); // Field not in HTML
  });

  it('should extract data from Debt Issue (NCD) HTML fixture', () => {
    const $ = cheerio.load(debtIssueHTML);

    const fields: Record<string, string | null> = {};

    $('table tr').each((_, row) => {
      const cells = $(row).find('td.TTRow_left');
      if (cells.length === 2) {
        const label = $(cells[0]).text().trim();
        const value = $(cells[1]).text().trim();

        if (label.toLowerCase().includes('symbol')) fields.symbol = value;
        if (label.toLowerCase().includes('issue period')) fields.issuePeriod = value;
        if (label.toLowerCase().includes('issue price')) fields.issuePrice = value;
        if (label.toLowerCase().includes('lot size')) fields.lotSize = value;
        if (label.toLowerCase().includes('face value')) fields.faceValue = value;
        if (label.toLowerCase().includes('registrar')) fields.registrar = value;
        if (label.toLowerCase().includes('lead manager')) fields.leadManagers = value;
      }
    });

    // NCD specific validations
    expect(fields.issuePeriod).toBe('10 Jan 2024 to 17 Jan 2024');
    expect(fields.issuePrice).toBe('1000.00');
    expect(fields.lotSize).toBe('10');
    expect(fields.faceValue).toBe('1000');
    expect(fields.registrar).toBe('Link Intime India Pvt. Ltd.');

    // Symbol and Lead Managers can be null
    expect(fields.symbol).toBeUndefined();
    expect(fields.leadManagers).toBeUndefined();
  });

  it('should handle missing symbol gracefully (return null)', () => {
    const $ = cheerio.load(rightsIssueHTML);

    let symbol: string | null = null;
    $('table tr').each((_, row) => {
      const cells = $(row).find('td.TTRow_left');
      if (cells.length === 2) {
        const label = $(cells[0]).text().trim();
        if (label.toLowerCase().includes('symbol')) {
          symbol = $(cells[1]).text().trim();
        }
      }
    });

    // Symbol field not present in Rights Issue HTML
    expect(symbol).toBeNull();
  });

  it('should handle missing lead managers gracefully (return null)', () => {
    const $ = cheerio.load(rightsIssueHTML);

    let leadManagers: string | null = null;
    $('table tr').each((_, row) => {
      const cells = $(row).find('td.TTRow_left');
      if (cells.length === 2) {
        const label = $(cells[0]).text().trim().toLowerCase();
        if (label.includes('lead manager') || label.includes('book running lead manager')) {
          leadManagers = $(cells[1]).text().trim();
        }
      }
    });

    // Lead Managers field not present in Rights Issue HTML
    expect(leadManagers).toBeNull();
  });

  // T-308 (round-6 P1, checker finding F1): the caller in bse-scraper.ts
  // documents DisplayIPO.aspx is used for BOTH RIGHTS/NCD AND "regular
  // IPOs" — writing the lone Issue Price into both priceRangeMin/Max
  // silently collapsed (or, via bse-scraper's merge guard, overwrote) a
  // real book-built band. parseDisplayIPOPage now leaves the band at 0 so
  // bse-scraper's `priceRangeMin > 0 && priceRangeMax > 0` merge guard
  // treats it as "no update"; issueSize is still computed from the real
  // lone price.
  it('T-308: parseDisplayIPOPage never collapses the lone Issue Price into priceRangeMin/Max', () => {
    const $ = cheerio.load(rightsIssueHTML);
    const result = parseDisplayIPOPage($);

    expect(result.priceRangeMin).toBe(0);
    expect(result.priceRangeMax).toBe(0);
    // issueSize is still computed from the real lone price + share count,
    // independent of the (intentionally zeroed) band fields.
    expect(result.issueSize).toBeGreaterThan(0);
  });
});

// ==================== CONDITIONAL VALIDATION TESTS ====================

describe('validateBSEDetailData - Conditional Validation', () => {
  it('should validate MAINBOARD data with all required fields', () => {
    const mainboardData: BSEDetailPageData = {
      symbol: 'MIDWESTLTD',
      openDate: '2025-10-15',
      closeDate: '2025-10-17',
      priceRangeMin: 1014,
      priceRangeMax: 1065,
      issueSize: 33200000,
      lotSize: 14,
      faceValue: 10,
      registrar: 'Link Intime India Pvt. Ltd.',
      leadManagers: ['Beeline Capital Advisors Pvt. Ltd.', 'Narnolia Financial Advisors Ltd.'],
      sponsorBanks: ['HDFC Bank Ltd.', 'ICICI Bank Ltd.'],
      issueShares: 3117460
    };

    const result = validateBSEDetailData(mainboardData);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should validate RIGHTS data with missing symbol and leadManagers', () => {
    const rightsData: BSEDetailPageData = {
      symbol: null, // Allowed for RIGHTS
      openDate: '2024-01-15',
      closeDate: '2024-01-22',
      priceRangeMin: 100,
      priceRangeMax: 100, // Same price for rights issue
      issueSize: 45000000,
      lotSize: 150,
      faceValue: 10,
      registrar: 'KFin Technologies Limited',
      leadManagers: null, // Allowed for RIGHTS
      sponsorBanks: ['HDFC Bank Ltd.', 'ICICI Bank Ltd.'],
      issueShares: 450000
    };

    const result = validateBSEDetailData(rightsData);

    // Base validation should pass (category-specific validation happens in orchestrator)
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should validate NCD data with missing symbol and leadManagers', () => {
    const ncdData: BSEDetailPageData = {
      symbol: null, // Allowed for NCD
      openDate: '2024-01-10',
      closeDate: '2024-01-17',
      priceRangeMin: 1000,
      priceRangeMax: 1000, // Same price for NCD
      issueSize: 50000000,
      lotSize: 10,
      faceValue: 1000,
      registrar: 'Link Intime India Pvt. Ltd.',
      leadManagers: null, // Allowed for NCD
      sponsorBanks: ['Axis Bank Ltd.', 'Kotak Mahindra Bank Ltd.'],
      issueShares: 50000
    };

    const result = validateBSEDetailData(ncdData);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail validation when openDate is missing', () => {
    const invalidData: BSEDetailPageData = {
      symbol: 'TESTIPO',
      openDate: null, // Missing required field
      closeDate: '2024-01-17',
      priceRangeMin: 100,
      priceRangeMax: 120,
      issueSize: 10000000,
      lotSize: 100,
      faceValue: 10,
      registrar: 'Test Registrar',
      leadManagers: ['Test Manager'],
      sponsorBanks: null,
      issueShares: 100000
    };

    const result = validateBSEDetailData(invalidData);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Missing required field: openDate');
  });

  it('should fail validation when closeDate is missing', () => {
    const invalidData: BSEDetailPageData = {
      symbol: 'TESTIPO',
      openDate: '2024-01-15',
      closeDate: null, // Missing required field
      priceRangeMin: 100,
      priceRangeMax: 120,
      issueSize: 10000000,
      lotSize: 100,
      faceValue: 10,
      registrar: 'Test Registrar',
      leadManagers: ['Test Manager'],
      sponsorBanks: null,
      issueShares: 100000
    };

    const result = validateBSEDetailData(invalidData);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Missing required field: closeDate');
  });

  it('should fail validation when price band is invalid (min > max)', () => {
    const invalidData: BSEDetailPageData = {
      symbol: 'TESTIPO',
      openDate: '2024-01-15',
      closeDate: '2024-01-17',
      priceRangeMin: 120,
      priceRangeMax: 100, // Invalid: min > max
      issueSize: 10000000,
      lotSize: 100,
      faceValue: 10,
      registrar: 'Test Registrar',
      leadManagers: ['Test Manager'],
      sponsorBanks: null,
      issueShares: 100000
    };

    const result = validateBSEDetailData(invalidData);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Invalid price band: min > max');
  });

  it('should fail validation when dates are invalid (open >= close)', () => {
    const invalidData: BSEDetailPageData = {
      symbol: 'TESTIPO',
      openDate: '2024-01-20',
      closeDate: '2024-01-15', // Invalid: close < open
      priceRangeMin: 100,
      priceRangeMax: 120,
      issueSize: 10000000,
      lotSize: 100,
      faceValue: 10,
      registrar: 'Test Registrar',
      leadManagers: ['Test Manager'],
      sponsorBanks: null,
      issueShares: 100000
    };

    const result = validateBSEDetailData(invalidData);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Invalid dates: open >= close');
  });

  it('should fail validation when lot size is invalid (zero or negative)', () => {
    const invalidData: BSEDetailPageData = {
      symbol: 'TESTIPO',
      openDate: '2024-01-15',
      closeDate: '2024-01-17',
      priceRangeMin: 100,
      priceRangeMax: 120,
      issueSize: 10000000,
      lotSize: 0, // Invalid: must be positive
      faceValue: 10,
      registrar: 'Test Registrar',
      leadManagers: ['Test Manager'],
      sponsorBanks: null,
      issueShares: 100000
    };

    const result = validateBSEDetailData(invalidData);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Invalid lot size: must be positive');
  });
});

// ==================== HELPER FUNCTIONS TESTS ====================

describe('Helper Functions', () => {
  it('should parse issue period correctly', () => {
    const issuePeriod = '15 Oct 2025 to 17 Oct 2025';
    const parts = issuePeriod.split(' to ').map(d => d.trim());

    expect(parts.length).toBe(2);

    const startDate = new Date(parts[0]);
    const endDate = new Date(parts[1]);

    // Verify dates are parsed (not checking exact ISO date due to timezone differences)
    expect(startDate.getTime()).toBeGreaterThan(0);
    expect(endDate.getTime()).toBeGreaterThan(0);
    expect(startDate.getTime()).toBeLessThan(endDate.getTime());

    // Verify month and year
    expect(startDate.getMonth()).toBe(9); // October (0-indexed)
    expect(startDate.getFullYear()).toBe(2025);
    expect(endDate.getMonth()).toBe(9);
    expect(endDate.getFullYear()).toBe(2025);
  });

  it('should parse share count with Indian number format', () => {
    const sharesStr = '31,17,460';
    const cleaned = sharesStr.replace(/,/g, '');
    const shares = parseInt(cleaned, 10);

    expect(shares).toBe(3117460);
  });

  it('should calculate issue size correctly', () => {
    const issueShares = 3117460;
    const priceMax = 1065;
    const issueSize = issueShares * priceMax;

    expect(issueSize).toBe(3320094900);
  });

  it('should parse comma-separated lead managers', () => {
    const leadManagersStr = 'Beeline Capital Advisors Pvt. Ltd., Narnolia Financial Advisors Ltd.';
    const leadManagers = leadManagersStr.split(',').map(item => item.trim());

    expect(leadManagers).toHaveLength(2);
    expect(leadManagers[0]).toBe('Beeline Capital Advisors Pvt. Ltd.');
    expect(leadManagers[1]).toBe('Narnolia Financial Advisors Ltd.');
  });
});
