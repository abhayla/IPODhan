import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  transformActiveCategorySubscription,
  transformCurrentIssueSubscription,
} from '../../../src/scrapers/nse-subscription-parser.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', '..', 'fixtures', 'nse');
const load = (f: string) => JSON.parse(readFileSync(join(FIXTURES, f), 'utf-8'));

/**
 * T-266 — root-cause regression tests for the NSE subscription parser.
 *
 * These run against the REAL payloads captured from NSE on 2026-08-22
 * (see tests/fixtures/nse/README.md). Pre-fix, `nse-subscription-parser.ts`
 * does not exist and `transformSubscriptionData()` iterated a `bidDetails`
 * array that the live payload has never contained — so every NSE cycle
 * produced `totalSubscriptions: 0` and BSE's partial book was published as
 * the whole-market figure (T-264 P1-2).
 */
describe('T-266 NSE subscription parser (real live payloads)', () => {
  describe('the live /api/ipo-current-issue payload has no bidDetails', () => {
    it('confirms the field the old parser depended on is absent', () => {
      const rows = load('ipo-current-issue.live-2026-08-22.json');
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.bidDetails).toBeUndefined();
      }
    });
  });

  describe('transformActiveCategorySubscription — the consolidated figure', () => {
    it('extracts AUGMONT whole-market totals matching NSE exactly', () => {
      const sub = transformActiveCategorySubscription(
        load('ipo-active-category-AUGMONT.live-2026-08-22.json'),
        'AUGMONT',
        'Augmont Enterprises Limited'
      );
      expect(sub).not.toBeNull();
      expect(sub!.totalSubscription).toBeCloseTo(2.7401544505125, 6);
      expect(sub!.qibSubscription).toBeCloseTo(1.75741059034875, 6);
      expect(sub!.niiSubscription).toBeCloseTo(3.974320950060901, 6);
      expect(sub!.retailSubscription).toBeCloseTo(2.7913141457555373, 6);
      expect(sub!.employeeSubscription).toBeCloseTo(1.4096900605628786, 6);
      expect(sub!.bNIISubscription).toBeCloseTo(3.0511479746808847, 6);
      expect(sub!.sNIISubscription).toBeCloseTo(5.820668587496095, 6);
      expect(sub!.coverage).toBe('CONSOLIDATED');
      expect(sub!.ipoSymbol).toBe('AUGMONT');
    });

    it('extracts TEMPSENS whole-market totals matching NSE exactly', () => {
      const sub = transformActiveCategorySubscription(
        load('ipo-active-category-TEMPSENS.live-2026-08-22.json'),
        'TEMPSENS',
        'Tempsens Instruments (India) Limited'
      );
      expect(sub).not.toBeNull();
      expect(sub!.totalSubscription).toBeCloseTo(21.65620218122292, 6);
      expect(sub!.qibSubscription).toBeCloseTo(3.3138090450122624, 6);
      expect(sub!.niiSubscription).toBeCloseTo(52.97500385505012, 6);
      expect(sub!.retailSubscription).toBeCloseTo(18.6673273561117, 6);
      expect(sub!.coverage).toBe('CONSOLIDATED');
    });

    it('never mistakes "Individuals(Other than RIIs)" for Retail', () => {
      // srNo 2.1(b) is 92,940,700 shares bid with a BLANK noOfTotalMeant.
      // A naive category.includes('INDIVIDUAL') match would overwrite retail
      // with 0 (blank -> NaN -> 0) and silently zero the retail figure.
      const sub = transformActiveCategorySubscription(
        load('ipo-active-category-TEMPSENS.live-2026-08-22.json'),
        'TEMPSENS',
        'Tempsens Instruments (India) Limited'
      );
      expect(sub!.retailSubscription).toBeCloseTo(18.6673273561117, 6);
      expect(sub!.retailSubscription).toBeGreaterThan(0);
    });

    it('skips the header row (category === "Category")', () => {
      const sub = transformActiveCategorySubscription(
        load('ipo-active-category-AUGMONT.live-2026-08-22.json'),
        'AUGMONT',
        'Augmont Enterprises Limited'
      );
      // The header row's noOfTotalMeant is a sentence; if it were parsed the
      // numbers would be NaN or the whole record would be rejected.
      expect(Number.isFinite(sub!.totalSubscription)).toBe(true);
    });

    it('records share counts from scientific-notation strings', () => {
      const sub = transformActiveCategorySubscription(
        load('ipo-active-category-AUGMONT.live-2026-08-22.json'),
        'AUGMONT',
        'Augmont Enterprises Limited'
      );
      // Total row: noOfShareOffered "7715999.0", noOfSharesBid "2.1143029E7"
      expect(sub!.sharesOffered).toBe(7715999);
      expect(sub!.totalSharesBid).toBe(21143029);
    });

    it('returns null for an empty or malformed payload rather than a zero record', () => {
      expect(transformActiveCategorySubscription(null, 'X', 'X Ltd')).toBeNull();
      expect(transformActiveCategorySubscription({}, 'X', 'X Ltd')).toBeNull();
      expect(transformActiveCategorySubscription({ dataList: [] }, 'X', 'X Ltd')).toBeNull();
      // header row only -> no usable category -> null, NOT a 0x record
      expect(
        transformActiveCategorySubscription(
          { dataList: [{ category: 'Category', noOfTotalMeant: 'No. of times', srNo: 'Sr.No.' }] },
          'X',
          'X Ltd'
        )
      ).toBeNull();
    });
  });

  describe('transformCurrentIssueSubscription — the NSE-only fallback', () => {
    it('reads the exchange-only total from the current-issue row', () => {
      const rows = load('ipo-current-issue.live-2026-08-22.json');
      const augmont = rows.find((r: any) => r.symbol === 'AUGMONT');
      const sub = transformCurrentIssueSubscription(augmont);
      expect(sub).not.toBeNull();
      expect(sub!.totalSubscription).toBeCloseTo(1.7901764891364034, 6);
      expect(sub!.coverage).toBe('EXCHANGE_ONLY');
    });

    it('is strictly smaller than the consolidated figure (it is one book, not both)', () => {
      const rows = load('ipo-current-issue.live-2026-08-22.json');
      for (const symbol of ['AUGMONT', 'TEMPSENS']) {
        const only = transformCurrentIssueSubscription(rows.find((r: any) => r.symbol === symbol))!;
        const all = transformActiveCategorySubscription(
          load(`ipo-active-category-${symbol}.live-2026-08-22.json`),
          symbol,
          only.ipoCompanyName
        )!;
        expect(only.totalSubscription).toBeLessThan(all.totalSubscription);
      }
    });

    it('returns null when the row carries no usable multiple', () => {
      expect(transformCurrentIssueSubscription(null)).toBeNull();
      expect(transformCurrentIssueSubscription({ symbol: 'X', companyName: 'X Ltd' })).toBeNull();
      expect(
        transformCurrentIssueSubscription({ symbol: 'X', companyName: 'X Ltd', noOfTime: 'n/a' })
      ).toBeNull();
    });
  });
});
