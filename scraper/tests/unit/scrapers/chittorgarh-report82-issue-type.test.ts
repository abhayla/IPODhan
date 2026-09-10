import { describe, it, expect } from 'vitest';
import {
  issueTypeFromPricingMethod,
  issueCategoryToSegment,
  collectIssueTypesFromReport,
} from '../../../src/scrapers/chittorgarh-report82-fields.js';
import fixture from '../../../../docs/design/probes/fixtures/chittorgarh/report-82-pricing-method.json' with { type: 'json' };

/**
 * Item 2 slice 7 — `ipo_details.issue_type` from Chittorgarh report 82.
 *
 * MEASURED 2026-09-11 against the live report (read-only) before this was written:
 *   Pricing Method   : Bookbuilding 206 / Fixed Price 25   (231 rows, FY2026-27)
 *   Issue Category   : SME 145 / Mainboard 86
 *   matching our rows: 194 of 277 production IPO rows by identity fold
 *   would FILL       : 183 rows whose issue_type is null, ZERO conflicts
 *
 * The vocabulary below is NOT typed from memory — every accepted string appears
 * in the committed fixture, which is a real capture from that endpoint.
 *
 * WHY THIS IS SOURCED AND NOT DERIVED. `filing-persister.ts` already has a
 * last-resort `floor === cap -> FIXED_PRICE` step, and
 * `checkDegenerateBookbuildingBand` exempts FIXED_PRICE. Deriving the type from
 * the band and then exempting on it makes that check permanently green on
 * exactly the rows it exists to catch. This slice takes the value from a field
 * the source states independently of the price, so that step becomes unnecessary
 * rather than duplicated.
 */

describe('issueTypeFromPricingMethod — only the vocabulary the source actually uses', () => {
  it('maps the two real values', () => {
    expect(issueTypeFromPricingMethod('Bookbuilding')).toBe('BOOK_BUILDING');
    expect(issueTypeFromPricingMethod('Fixed Price')).toBe('FIXED_PRICE');
  });

  it('every Pricing Method in the captured fixture maps to a real type', () => {
    const rows = (fixture as any).sampleRows as Array<Record<string, string>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(issueTypeFromPricingMethod(row['Pricing Method'])).not.toBeNull();
    }
  });

  it('the fixture covers BOTH values — a one-sided fixture proves half the mapping', () => {
    const seen = new Set(
      ((fixture as any).sampleRows as Array<Record<string, string>>)
        .map((r) => issueTypeFromPricingMethod(r['Pricing Method']))
    );
    expect(seen).toEqual(new Set(['BOOK_BUILDING', 'FIXED_PRICE']));
  });

  it('tolerates case and surrounding whitespace, which HTML cells carry', () => {
    expect(issueTypeFromPricingMethod('  bookbuilding ')).toBe('BOOK_BUILDING');
    expect(issueTypeFromPricingMethod('FIXED PRICE')).toBe('FIXED_PRICE');
  });

  it('REFUSES anything it has not seen — never guesses a third value', () => {
    for (const junk of ['', '   ', 'Book Building 100%', 'Hybrid', 'N/A', '-', 'Unknown']) {
      expect(issueTypeFromPricingMethod(junk), `must refuse ${JSON.stringify(junk)}`).toBeNull();
    }
  });

  it('refuses null and undefined rather than throwing', () => {
    expect(issueTypeFromPricingMethod(null as unknown as string)).toBeNull();
    expect(issueTypeFromPricingMethod(undefined as unknown as string)).toBeNull();
  });

  it('does NOT accept "Book Building" with a space — that spelling is not in the source', () => {
    // Guard against someone "helpfully" widening the mapping from memory. The
    // source writes it as one word; accepting a second spelling would hide the
    // day the source actually changes.
    expect(issueTypeFromPricingMethod('Book Building')).toBeNull();
  });
});

describe('issueCategoryToSegment — the same field carries the segment', () => {
  it('maps the two real values', () => {
    expect(issueCategoryToSegment('Mainboard')).toBe('MAINBOARD');
    expect(issueCategoryToSegment('SME')).toBe('SME');
  });

  it('every Issue Category in the fixture maps', () => {
    const rows = (fixture as any).sampleRows as Array<Record<string, string>>;
    for (const row of rows) {
      expect(issueCategoryToSegment(row['Issue Category'])).not.toBeNull();
    }
  });

  it('REFUSES "Mainline" — observed once on a different endpoint, never on this one', () => {
    // A real trap: Chittorgarh's DETAIL page uses "Mainline". Report 82 uses
    // "Mainboard". Accepting both here would silently paper over a source change.
    expect(issueCategoryToSegment('Mainline')).toBeNull();
    expect(issueCategoryToSegment('')).toBeNull();
  });
});

describe('collectIssueTypesFromReport — pure, and it drops what it cannot read', () => {
  const strip = (h: string) => String(h).replace(/<[^>]*>/g, '').trim();

  it('collects the readable rows from a real fixture payload', () => {
    const rows = (fixture as any).sampleRows as Array<Record<string, unknown>>;
    const got = collectIssueTypesFromReport(rows, strip);
    expect(got.length).toBe(rows.length);
    expect(got.every((r) => r.companyName.length > 0)).toBe(true);
    expect(new Set(got.map((r) => r.issueType))).toEqual(
      new Set(['BOOK_BUILDING', 'FIXED_PRICE'])
    );
  });

  it('a Pricing Method of "constructor" or "__proto__" yields null, not a prototype member', () => {
    // The lookup maps are plain objects unless built with Object.create(null),
    // and `?? null` only catches nullish - so `o['constructor']` returned a
    // FUNCTION and flowed on as an issueType. Round 1 of the review found it;
    // this test stops a refactor back to an object literal.
    for (const hostile of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(issueTypeFromPricingMethod(hostile)).toBeNull();
      expect(issueCategoryToSegment(hostile)).toBeNull();
    }
  });

  it('reads the open date WITHOUT reparsing it, so IST never shifts the day', () => {
    // `new Date('2026-09-18T00:00:00.000Z').toISOString().slice(0,10)` happens to
    // be right; `new Date('2026-09-18')` on a +05:30 machine is not. The first
    // version of openDateFromRecord used that chain and the repo's
    // date-tz-parse-ratchet test caught it. This reads the string, never a Date.
    const got = collectIssueTypesFromReport(
      [{
        Company: '<a href="/ipo/x/1/">Axiom Gas Engineering Ltd.</a>',
        'Pricing Method': 'Bookbuilding',
        '~Issue_Open_Date': '2026-09-18T00:00:00.000Z',
      }],
      strip
    );
    expect(got[0].openDate).toBe('2026-09-18');
  });

  it('refuses a date it cannot read literally, rather than guessing one', () => {
    const got = collectIssueTypesFromReport(
      [{ Company: 'A Ltd', 'Pricing Method': 'Bookbuilding', '~Issue_Open_Date': '18-Sep-2026' }],
      strip
    );
    expect(got[0].openDate).toBeNull();
  });

  it('strips the anchor markup the report wraps company names in', () => {
    const got = collectIssueTypesFromReport(
      [{ Company: '<a href="/ipo/x/1/">Axiom Gas Engineering Ltd.</a> ', 'Pricing Method': 'Bookbuilding' }],
      strip
    );
    expect(got).toEqual([
      { companyName: 'Axiom Gas Engineering Ltd.', issueType: 'BOOK_BUILDING', openDate: null },
    ]);
  });

  it('DROPS a row whose Pricing Method it cannot read — never defaults it', () => {
    // issue_type feeds a check that EXEMPTS FIXED_PRICE. Guessing here would
    // silence a real defect, so an unreadable row is skipped instead.
    const got = collectIssueTypesFromReport(
      [
        { Company: 'Readable Ltd', 'Pricing Method': 'Fixed Price' },
        { Company: 'Unreadable Ltd', 'Pricing Method': 'Something New' },
        { Company: 'Empty Ltd', 'Pricing Method': '' },
      ],
      strip
    );
    expect(got.map((r) => r.companyName)).toEqual(['Readable Ltd']);
  });

  it('drops a row with no company name rather than emitting a nameless pair', () => {
    const got = collectIssueTypesFromReport(
      [{ Company: '', 'Pricing Method': 'Bookbuilding' }, { 'Pricing Method': 'Bookbuilding' }],
      strip
    );
    expect(got).toEqual([]);
  });

  it('tolerates an empty or absent payload', () => {
    expect(collectIssueTypesFromReport([], strip)).toEqual([]);
    expect(collectIssueTypesFromReport(undefined as never, strip)).toEqual([]);
  });
});
