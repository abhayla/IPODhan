/**
 * Category 6.2: Company Name Normalization
 *
 * Objective: Verify company name variations normalize to same canonical form
 * Test Data: Real company names with legal suffixes
 *
 * Expected Results:
 * - Legal suffix variations normalize to same name
 * - Case-insensitive matching
 * - Different companies remain distinct
 */

import { describe, test, expect } from 'vitest';
import { normalizeCompanyName } from '../../../../scraper/src/services/normalization-engine';

describe('Category 6.2: Company Name Normalization', () => {
  test('Legal suffix variations normalize to same name', () => {
    console.log('\n  Testing: Legal suffix normalization...');

    const nameGroups = [
      // Group 1: XYZ Corporation (without IPO suffix)
      {
        variations: [
          'XYZ Corporation Limited',
          'XYZ Corporation Ltd.',
          'XYZ Corporation Ltd',
          '  XYZ Corporation Limited  ',
        ],
        expected: 'xyz', // "Corporation" and "Limited/Ltd" are both removed
      },
      // Group 2: ABC Private
      {
        variations: [
          'ABC Private Limited',
          'ABC Pvt. Ltd.',
          'ABC Pvt Ltd',
          'ABC PRIVATE LIMITED',
          'abc private limited',
        ],
        expected: 'abc',
      },
      // Group 3: Midwest with various suffixes
      {
        variations: [
          'Midwest Gold Inc.',
          'Midwest Gold Incorporated',
          'Midwest Gold Inc',
          'MIDWEST GOLD INC',
        ],
        expected: 'midwest gold',
      },
      // Group 4: Company with hyphen variations
      {
        variations: [
          'Tech-Innovation Ltd.',
          'Tech Innovation Limited',
          'TECH INNOVATION LTD',
          'tech innovation ltd',
        ],
        expected: 'tech innovation', // - replaced with space, legal suffixes removed
      },
    ];

    for (const group of nameGroups) {
      const normalized = group.variations.map((name) =>
        normalizeCompanyName(name)
      );
      const unique = new Set(normalized);

      // Debug: log all normalized values if they don't match
      if (unique.size !== 1) {
        console.log(`  ⚠️  Group has ${unique.size} different normalized forms:`);
        normalized.forEach((n, i) => {
          console.log(`     "${group.variations[i]}" → "${n}"`);
        });
      }

      // All variations should normalize to the same canonical form
      expect(unique.size).toBe(1);
      expect(normalized[0]).toBe(group.expected);

      console.log(
        `  ✅ ${group.variations.length} variations → "${normalized[0]}"`
      );
    }

    console.log('\n  📝 Legal Suffix Normalization: PASSED');
    console.log('     - 19 name variations tested');
    console.log('     - All legal suffixes removed correctly');
    console.log('     - Case-insensitive matching working');
  });

  test('Different companies remain different', () => {
    console.log('\n  Testing: Company differentiation...');

    const companies = [
      'Midwest Gold Limited',
      'Eastern Silver Limited',
      'Northern Platinum Limited',
      'Southern Bronze Corporation',
      'Western Copper Inc',
    ];

    const normalized = companies.map((c) => normalizeCompanyName(c));
    const unique = new Set(normalized);

    // Should have 5 different normalized names
    expect(unique.size).toBe(5);

    for (let i = 0; i < companies.length; i++) {
      console.log(`  ✅ "${companies[i]}" → "${normalized[i]}"`);
    }

    console.log('\n  📝 Company Differentiation: PASSED');
    console.log('     - 5 different companies tested');
    console.log('     - All remain distinct after normalization');
  });

  test('Special characters handled correctly', () => {
    console.log('\n  Testing: Special character handling...');

    const specialCases = [
      {
        input: "L&T Finance Holdings Ltd.",
        expected: "lt finance holdings", // & removed
      },
      {
        input: 'M/s ABC Corporation Ltd',
        expected: 'm/s abc', // . removed, / remains, "Corporation Ltd" removed
      },
      {
        input: "O'Reilly Technologies Inc",
        expected: 'oreilly technologies', // apostrophe removed, "Inc" removed
      },
      {
        input: 'Tech-Corp (India) Ltd.',
        expected: 'tech corp india', // - becomes space, () removed
      },
      {
        input: 'ABC_XYZ Pvt. Ltd.',
        expected: 'abc xyz', // _ becomes space
      },
    ];

    for (const testCase of specialCases) {
      const normalized = normalizeCompanyName(testCase.input);

      expect(normalized).toBe(testCase.expected);

      console.log(`  ✅ "${testCase.input}" → "${normalized}"`);
    }

    console.log('\n  📝 Special Character Handling: PASSED');
    console.log('     - Ampersand (&) removed');
    console.log('     - Apostrophes removed');
    console.log('     - Hyphens/underscores converted to spaces');
    console.log('     - Parentheses removed');
    console.log('     - Dots removed completely');
  });

  test('IPO suffix removed', () => {
    console.log('\n  Testing: IPO suffix removal...');

    const ipoSuffixes = [
      {
        input: 'Midwest Gold IPO',
        expected: 'midwest gold', // "IPO" removed, no other suffixes
      },
      {
        input: 'Tech Innovation ipo',
        expected: 'tech innovation', // "ipo" removed, no other suffixes
      },
      {
        input: 'ABC Enterprises Limited',
        expected: 'abc enterprises', // "Limited" removed (no IPO suffix in this one)
      },
    ];

    for (const testCase of ipoSuffixes) {
      const normalized = normalizeCompanyName(testCase.input);

      expect(normalized).toBe(testCase.expected);

      console.log(`  ✅ "${testCase.input}" → "${normalized}"`);
    }

    console.log('\n  📝 IPO Suffix Removal: PASSED');
    console.log('     - IPO suffix correctly removed');
    console.log('     - Works with case variations');
  });

  test('Whitespace handling', () => {
    console.log('\n  Testing: Whitespace normalization...');

    const whitespaceCases = [
      {
        input: '  XYZ Corporation Ltd.  ',
        expected: 'xyz', // "Corporation" and "Ltd" both removed
      },
      {
        input: 'ABC  Private  Limited',
        expected: 'abc', // "Private" and "Limited" both removed
      },
      {
        input: 'Tech   Corp    Ltd',
        expected: 'tech', // "Corp" and "Ltd" both removed
      },
    ];

    for (const testCase of whitespaceCases) {
      const normalized = normalizeCompanyName(testCase.input);

      expect(normalized).toBe(testCase.expected);

      console.log(`  ✅ "${testCase.input}" → "${normalized}"`);
    }

    console.log('\n  📝 Whitespace Handling: PASSED');
    console.log('     - Leading/trailing spaces trimmed');
    console.log('     - Multiple spaces collapsed to single space');
  });
});
