import { describe, it, expect } from 'vitest';
import {
  generateIPOSlug,
  validateSlug,
  generateUniqueSlug,
  slugToCompanyName,
  normalizeCompanyName,
  type SlugOptions,
} from './slug';

describe('generateIPOSlug', () => {
  describe('basic transformations', () => {
    it('converts to lowercase and replaces spaces', () => {
      expect(generateIPOSlug('Company Name')).toBe('company-name');
      expect(generateIPOSlug('UPPERCASE COMPANY')).toBe('uppercase-company');
      expect(generateIPOSlug('MiXeD CaSe')).toBe('mixed-case');
    });

    it('trims leading and trailing whitespace', () => {
      expect(generateIPOSlug('  Company  ')).toBe('company');
      expect(generateIPOSlug('\tCompany\t')).toBe('company');
      expect(generateIPOSlug('\n Company \n')).toBe('company');
    });

    it('handles single word company names', () => {
      expect(generateIPOSlug('Amazon')).toBe('amazon');
      expect(generateIPOSlug('Google')).toBe('google');
    });
  });

  describe('legal entity normalization', () => {
    it('normalizes Ltd.', () => {
      expect(generateIPOSlug('Company Ltd.')).toBe('company-ltd');
      expect(generateIPOSlug('Company Ltd')).toBe('company-ltd');
      expect(generateIPOSlug('Company LTD')).toBe('company-ltd');
    });

    it('normalizes Limited', () => {
      expect(generateIPOSlug('Company Limited')).toBe('company-ltd');
      expect(generateIPOSlug('Company LIMITED')).toBe('company-ltd');
    });

    it('normalizes Pvt. Ltd.', () => {
      expect(generateIPOSlug('Company Pvt. Ltd.')).toBe('company-pvt-ltd');
      expect(generateIPOSlug('Company Pvt Ltd')).toBe('company-pvt-ltd');
      expect(generateIPOSlug('Company PVT LTD')).toBe('company-pvt-ltd');
    });

    it('normalizes Private Limited', () => {
      expect(generateIPOSlug('Company Private Limited')).toBe('company-private-ltd');
      expect(generateIPOSlug('Company PRIVATE LIMITED')).toBe('company-private-ltd');
    });

    it('normalizes Inc.', () => {
      expect(generateIPOSlug('Company Inc.')).toBe('company-inc');
      expect(generateIPOSlug('Company Inc')).toBe('company-inc');
      expect(generateIPOSlug('Company INC')).toBe('company-inc');
    });

    it('normalizes Incorporated', () => {
      expect(generateIPOSlug('Company Incorporated')).toBe('company-incorporated');
    });

    it('normalizes Corp.', () => {
      expect(generateIPOSlug('Company Corp.')).toBe('company-corp');
      expect(generateIPOSlug('Company Corp')).toBe('company-corp');
    });

    it('normalizes Corporation', () => {
      expect(generateIPOSlug('Company Corporation')).toBe('company-corporation');
    });

    it('normalizes LLC, LLP, PLC', () => {
      expect(generateIPOSlug('Company LLC')).toBe('company-llc');
      expect(generateIPOSlug('Company LLP')).toBe('company-llp');
      expect(generateIPOSlug('Company PLC')).toBe('company-plc');
    });
  });

  describe('special character handling', () => {
    it('replaces ampersand with "and"', () => {
      expect(generateIPOSlug('A & B Company')).toBe('a-and-b-company');
      expect(generateIPOSlug('Smith & Jones')).toBe('smith-and-jones');
    });

    it('replaces plus with "plus"', () => {
      expect(generateIPOSlug('A + B Company')).toBe('a-plus-b-company');
      expect(generateIPOSlug('C++')).toBe('c-plus-plus');
    });

    it('replaces @ with "at"', () => {
      expect(generateIPOSlug('Company @ 123')).toBe('company-at-123');
    });

    it('replaces % with "percent"', () => {
      expect(generateIPOSlug('50% Company')).toBe('50-percent-company');
      expect(generateIPOSlug('100%')).toBe('100-percent');
    });

    it('replaces currency symbols', () => {
      expect(generateIPOSlug('₹100 Company')).toBe('rs-100-company');
      expect(generateIPOSlug('$100 Company')).toBe('dollar-100-company');
      expect(generateIPOSlug('€100 Company')).toBe('euro-100-company');
      expect(generateIPOSlug('£100 Company')).toBe('pound-100-company');
    });

    it('removes other special characters', () => {
      expect(generateIPOSlug('Company!@#$%^&*()')).toBe('company-at-dollar-percent-and');
      expect(generateIPOSlug('Company [Test]')).toBe('company-test');
      expect(generateIPOSlug('Company (India)')).toBe('company-india');
    });
  });

  describe('hyphen handling', () => {
    it('removes consecutive hyphens', () => {
      expect(generateIPOSlug('A - B - C')).toBe('a-b-c');
      expect(generateIPOSlug('A -- B')).toBe('a-b');
      expect(generateIPOSlug('A --- B')).toBe('a-b');
    });

    it('removes leading hyphens', () => {
      expect(generateIPOSlug('-Company')).toBe('company');
      expect(generateIPOSlug('--Company')).toBe('company');
    });

    it('removes trailing hyphens', () => {
      expect(generateIPOSlug('Company-')).toBe('company');
      expect(generateIPOSlug('Company--')).toBe('company');
    });

    it('removes leading and trailing hyphens together', () => {
      expect(generateIPOSlug('-Company-')).toBe('company');
      expect(generateIPOSlug('--Company--')).toBe('company');
    });
  });

  describe('suffix option', () => {
    it('adds suffix when provided', () => {
      expect(generateIPOSlug('Company', { suffix: '-ipo' })).toBe('company-ipo');
      expect(generateIPOSlug('Test Inc.', { suffix: '-ipo' })).toBe('test-inc-ipo');
    });

    it('handles empty suffix', () => {
      expect(generateIPOSlug('Company', { suffix: '' })).toBe('company');
    });

    it('does not add suffix when not provided', () => {
      expect(generateIPOSlug('Company')).toBe('company');
      expect(generateIPOSlug('Company', {})).toBe('company');
    });
  });

  describe('maxLength option', () => {
    it('enforces max length', () => {
      const longName = 'A'.repeat(150);
      const slug = generateIPOSlug(longName, { maxLength: 100 });
      expect(slug.length).toBeLessThanOrEqual(100);
    });

    it('uses default max length of 100', () => {
      const longName = 'A'.repeat(150);
      const slug = generateIPOSlug(longName);
      expect(slug.length).toBeLessThanOrEqual(100);
    });

    it('does not truncate short names', () => {
      expect(generateIPOSlug('Short Company', { maxLength: 100 })).toBe('short-company');
    });

    it('removes trailing hyphens after truncation', () => {
      const slug = generateIPOSlug('Company Name Very Long Test', { maxLength: 15 });
      expect(slug).not.toMatch(/-$/);
    });

    it('respects custom max length', () => {
      const slug = generateIPOSlug('Company Name', { maxLength: 10 });
      expect(slug.length).toBeLessThanOrEqual(10);
      expect(slug).toBe('company-na');
    });
  });

  describe('real-world company names', () => {
    it('handles Indian company names', () => {
      expect(generateIPOSlug('Tata Consultancy Services Ltd.')).toBe('tata-consultancy-services-ltd');
      expect(generateIPOSlug('Reliance Industries Limited')).toBe('reliance-industries-ltd');
      expect(generateIPOSlug('HDFC Bank Ltd.')).toBe('hdfc-bank-ltd');
    });

    it('handles names with numbers', () => {
      expect(generateIPOSlug('24x7 Learning Pvt. Ltd.')).toBe('24x7-learning-pvt-ltd');
      expect(generateIPOSlug('5Paisa Capital Ltd.')).toBe('5paisa-capital-ltd');
    });

    it('handles names with special characters', () => {
      expect(generateIPOSlug('Café Coffee Day')).toBe('caf-coffee-day');
      expect(generateIPOSlug('H&M India')).toBe('h-and-m-india');
    });

    it('handles complex real-world examples', () => {
      expect(generateIPOSlug('Bharat Heavy Electricals Limited')).toBe('bharat-heavy-electricals-ltd');
      expect(generateIPOSlug('State Bank of India')).toBe('state-bank-of-india');
      expect(generateIPOSlug('Oil & Natural Gas Corporation Ltd.')).toBe('oil-and-natural-gas-corporation-ltd');
    });
  });
});

describe('validateSlug', () => {
  describe('valid slugs', () => {
    it('accepts lowercase alphanumeric slugs', () => {
      expect(validateSlug('company')).toBe(true);
      expect(validateSlug('company123')).toBe(true);
      expect(validateSlug('123company')).toBe(true);
    });

    it('accepts slugs with hyphens', () => {
      expect(validateSlug('company-name')).toBe(true);
      expect(validateSlug('a-b-c')).toBe(true);
      expect(validateSlug('company-123')).toBe(true);
    });

    it('accepts complex valid slugs', () => {
      expect(validateSlug('tata-consultancy-services-ltd')).toBe(true);
      expect(validateSlug('24x7-learning-pvt-ltd')).toBe(true);
    });
  });

  describe('invalid slugs', () => {
    it('rejects uppercase characters', () => {
      expect(validateSlug('Company')).toBe(false);
      expect(validateSlug('Company-Name')).toBe(false);
      expect(validateSlug('COMPANY')).toBe(false);
    });

    it('rejects leading hyphens', () => {
      expect(validateSlug('-company')).toBe(false);
      expect(validateSlug('--company')).toBe(false);
    });

    it('rejects trailing hyphens', () => {
      expect(validateSlug('company-')).toBe(false);
      expect(validateSlug('company--')).toBe(false);
    });

    it('rejects consecutive hyphens', () => {
      expect(validateSlug('company--name')).toBe(false);
      expect(validateSlug('a---b')).toBe(false);
    });

    it('rejects underscores', () => {
      expect(validateSlug('company_name')).toBe(false);
      expect(validateSlug('_company')).toBe(false);
    });

    it('rejects spaces', () => {
      expect(validateSlug('company name')).toBe(false);
      expect(validateSlug('company ')).toBe(false);
    });

    it('rejects special characters', () => {
      expect(validateSlug('company@name')).toBe(false);
      expect(validateSlug('company.name')).toBe(false);
      expect(validateSlug('company/name')).toBe(false);
    });

    it('rejects empty strings', () => {
      expect(validateSlug('')).toBe(false);
    });
  });
});

describe('generateUniqueSlug', () => {
  it('returns base slug if unique', () => {
    const slug = generateUniqueSlug('Company', []);
    expect(slug).toBe('company');
  });

  it('returns base slug if not in existing list', () => {
    const slug = generateUniqueSlug('Company', ['other-company', 'different-company']);
    expect(slug).toBe('company');
  });

  it('appends -2 for first duplicate', () => {
    const slug = generateUniqueSlug('Company', ['company']);
    expect(slug).toBe('company-2');
  });

  it('appends -3 for second duplicate', () => {
    const slug = generateUniqueSlug('Company', ['company', 'company-2']);
    expect(slug).toBe('company-3');
  });

  it('increments counter until unique', () => {
    const existingSlugs = ['company', 'company-2', 'company-3', 'company-4'];
    const slug = generateUniqueSlug('Company', existingSlugs);
    expect(slug).toBe('company-5');
  });

  it('handles gaps in counter sequence', () => {
    const existingSlugs = ['company', 'company-3', 'company-5'];
    const slug = generateUniqueSlug('Company', existingSlugs);
    expect(slug).toBe('company-2'); // Uses first available number
  });

  it('works with suffix option', () => {
    const slug = generateUniqueSlug('Company', ['company-ipo'], { suffix: '-ipo' });
    expect(slug).toBe('company-ipo-2');
  });

  it('works with maxLength option', () => {
    const slug = generateUniqueSlug('Very Long Company Name', [], { maxLength: 15 });
    expect(slug.length).toBeLessThanOrEqual(15);
  });

  it('throws error after 1000 attempts', () => {
    const existingSlugs = Array.from({ length: 1001 }, (_, i) =>
      i === 0 ? 'company' : `company-${i + 1}`
    );

    expect(() => generateUniqueSlug('Company', existingSlugs)).toThrow(
      'Unable to generate unique slug for "Company" after 1000 attempts'
    );
  });
});

describe('slugToCompanyName', () => {
  describe('basic transformations', () => {
    it('capitalizes words', () => {
      expect(slugToCompanyName('company-name')).toBe('Company Name');
      expect(slugToCompanyName('test')).toBe('Test');
    });

    it('handles single word slugs', () => {
      expect(slugToCompanyName('amazon')).toBe('Amazon');
      expect(slugToCompanyName('google')).toBe('Google');
    });
  });

  describe('legal entity restoration', () => {
    it('restores Ltd.', () => {
      expect(slugToCompanyName('company-ltd')).toBe('Company Ltd.');
    });

    it('restores Pvt. Ltd.', () => {
      expect(slugToCompanyName('company-pvt-ltd')).toBe('Company Pvt. Ltd.');
    });

    it('restores Inc.', () => {
      expect(slugToCompanyName('company-inc')).toBe('Company Inc.');
    });

    it('restores Corp.', () => {
      expect(slugToCompanyName('company-corp')).toBe('Company Corp.');
    });

    it('restores LLC, LLP, PLC', () => {
      expect(slugToCompanyName('company-llc')).toBe('Company LLC');
      expect(slugToCompanyName('company-llp')).toBe('Company LLP');
      expect(slugToCompanyName('company-plc')).toBe('Company PLC');
    });
  });

  describe('special character restoration', () => {
    it('restores ampersand', () => {
      expect(slugToCompanyName('a-and-b-company')).toBe('A & B Company');
    });

    it('restores @ symbol', () => {
      expect(slugToCompanyName('company-at-123')).toBe('Company @ 123');
    });

    it('restores + symbol', () => {
      expect(slugToCompanyName('a-plus-b')).toBe('A + B');
    });

    it('restores % symbol', () => {
      expect(slugToCompanyName('50-percent-company')).toBe('50 % Company');
    });
  });

  describe('suffix handling', () => {
    it('removes -ipo suffix', () => {
      expect(slugToCompanyName('company-ipo')).toBe('Company');
      expect(slugToCompanyName('test-company-ipo')).toBe('Test Company');
    });

    it('preserves -ipo in middle of name', () => {
      expect(slugToCompanyName('ipo-company')).toBe('Ipo Company');
    });
  });

  describe('real-world examples', () => {
    it('restores Indian company names', () => {
      expect(slugToCompanyName('tata-consultancy-services-ltd')).toBe('Tata Consultancy Services Ltd.');
      expect(slugToCompanyName('hdfc-bank-ltd')).toBe('Hdfc Bank Ltd.');
    });

    it('handles complex names', () => {
      expect(slugToCompanyName('oil-and-natural-gas-corporation-ltd')).toBe('Oil & Natural Gas Corporation Ltd.');
    });
  });
});

describe('normalizeCompanyName', () => {
  describe('legal entity removal', () => {
    it('removes Ltd.', () => {
      expect(normalizeCompanyName('Company Ltd.')).toBe('company');
      expect(normalizeCompanyName('Company Ltd')).toBe('company');
    });

    it('removes Limited', () => {
      expect(normalizeCompanyName('Company Limited')).toBe('company');
    });

    it('removes Pvt. Ltd.', () => {
      expect(normalizeCompanyName('Company Pvt. Ltd.')).toBe('company');
      expect(normalizeCompanyName('Company Pvt Ltd')).toBe('company');
    });

    it('removes Private Limited', () => {
      expect(normalizeCompanyName('Company Private Limited')).toBe('company');
    });

    it('removes Inc., Corp., LLC, LLP, PLC', () => {
      expect(normalizeCompanyName('Company Inc.')).toBe('company');
      expect(normalizeCompanyName('Company Corp.')).toBe('company');
      expect(normalizeCompanyName('Company LLC')).toBe('company');
      expect(normalizeCompanyName('Company LLP')).toBe('company');
      expect(normalizeCompanyName('Company PLC')).toBe('company');
    });
  });

  describe('special character normalization', () => {
    it('normalizes ampersand to "and"', () => {
      expect(normalizeCompanyName('A & B Company')).toBe('a and b company');
    });

    it('removes other special characters', () => {
      expect(normalizeCompanyName('Company@123')).toBe('company 123');
      expect(normalizeCompanyName('Company (India)')).toBe('company india');
    });
  });

  describe('whitespace handling', () => {
    it('trims whitespace', () => {
      expect(normalizeCompanyName('  Company  ')).toBe('company');
    });

    it('collapses multiple spaces', () => {
      expect(normalizeCompanyName('Company   Name')).toBe('company name');
    });
  });

  describe('case conversion', () => {
    it('converts to lowercase', () => {
      expect(normalizeCompanyName('COMPANY')).toBe('company');
      expect(normalizeCompanyName('Company Name')).toBe('company name');
    });
  });

  describe('real-world examples', () => {
    it('normalizes for comparison', () => {
      expect(normalizeCompanyName('Tata Consultancy Services Ltd.')).toBe('tata consultancy services');
      expect(normalizeCompanyName('Tata Consultancy Services Limited')).toBe('tata consultancy services');
      expect(normalizeCompanyName('TATA CONSULTANCY SERVICES')).toBe('tata consultancy services');
    });

    it('enables fuzzy matching', () => {
      const name1 = normalizeCompanyName('HDFC Bank Ltd.');
      const name2 = normalizeCompanyName('HDFC Bank Limited');
      const name3 = normalizeCompanyName('hdfc bank');

      expect(name1).toBe('hdfc bank');
      expect(name2).toBe('hdfc bank');
      expect(name3).toBe('hdfc bank');
    });
  });
});
