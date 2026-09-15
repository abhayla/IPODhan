import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { foldCompanyIdentity, IDENTITY_FOLD_FIXTURE, isoDay, daysBetween } from './company-identity-fold';

/**
 * Item 12 slice A. This module is an EXTRACTION, not a behaviour change: the
 * body moved here verbatim from `duplicate-ipo-merge.ts:26` (`foldCompanyName`),
 * which the `.mjs` repair invariant hand-copies as `foldName`. These tests pin
 * the behaviour so the extraction cannot drift, and so slice 12-B — which
 * changes the SEPARATE binding normaliser — cannot silently change what the
 * repair tool considers "the same company".
 */
describe('foldCompanyIdentity', () => {
  it('folds the ARCIL pair to one identity (the case this fold exists for, F-55)', () => {
    expect(foldCompanyIdentity('ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED')).toBe(
      foldCompanyIdentity('Asset Reconstruction Co.(India) Ltd.'),
    );
    expect(foldCompanyIdentity('Asset Reconstruction Co.(India) Ltd.')).toBe('assetreconstruction');
  });

  it('keeps genuinely different companies APART — the false-merge direction', () => {
    // A fold that is too aggressive merges two real companies and a repair tool
    // then deletes one of them. This is the assertion that stops that.
    expect(foldCompanyIdentity('Sun Pharmaceutical Industries Ltd')).not.toBe(
      foldCompanyIdentity('Sunrise Pharmaceutical Industries Ltd'),
    );
    expect(foldCompanyIdentity('Atharva Polyplast Limited')).not.toBe(
      foldCompanyIdentity('Atharva Polymers Limited'),
    );
  });

  it('strips corporate-form words only on a WORD boundary, never inside a word', () => {
    // "incorporated" contains "corp"; "Ultratech" contains no keyword but a
    // naive substring strip would maul names like "Coal India" -> "al".
    expect(foldCompanyIdentity('India Company Limited')).toBe('');
    expect(foldCompanyIdentity('Coal India Limited')).toBe('coal');
    expect(foldCompanyIdentity('Incorporated Systems')).toBe('systems');
  });

  it('is null/undefined/empty safe and returns a string every time', () => {
    expect(foldCompanyIdentity(null)).toBe('');
    expect(foldCompanyIdentity(undefined)).toBe('');
    expect(foldCompanyIdentity('')).toBe('');
    expect(foldCompanyIdentity('   ')).toBe('');
    expect(foldCompanyIdentity('.,()&\'"-')).toBe('');
  });

  it('ships a shared fixture the .mjs parity test can import (single source of names)', () => {
    expect(Array.isArray(IDENTITY_FOLD_FIXTURE)).toBe(true);
    expect(IDENTITY_FOLD_FIXTURE.length).toBeGreaterThanOrEqual(20);
    for (const name of IDENTITY_FOLD_FIXTURE) expect(typeof name).toBe('string');
  });
});

/**
 * Item 12 slice F. The scraper's listing-page discovery minted twin rows whose
 * company_name carries a trailing "(<Company> IPO)" tail, sometimes followed by
 * a 1-2 letter status token ("CT" / "LT" / "P"). Those twins folded to a
 * DIFFERENT identity than the clean row, so the duplicate-row invariant never
 * saw them as one company: staging carried 12 rows for 3 companies on
 * 2026-09-16 (read from ipodhan_staging, ids below).
 */
describe('foldCompanyIdentity — the bracketed IPO-name tail (item 12 slice F)', () => {
  const STAGING_TWINS_2026_09_16: ReadonlyArray<readonly [string, string]> = [
    ['G.V.Electricals Ltd.', '9cb00cd6'],
    ['G.V.Electricals Ltd. (G.V. Electricals IPO) CT', '2dfd8026'],
    ['G.V.Electricals Ltd. (G.V. Electricals IPO) LT', '97a5557b'],
    ['G.V.Electricals Ltd. (G.V. Electricals IPO) P', 'ef84a7f1'],
    ['H R Hygiene Products', '9450cd8d'],
    ['H.R.Hygiene Products Ltd.', 'e986b271'],
    ['H.R.Hygiene Products Ltd. (H.R. Hygiene Products IPO)', '708946b8'],
    ['H.R.Hygiene Products Ltd. (H.R. Hygiene Products IPO) CT', '37f19183'],
    ['Shree Balaji (Mala) Textiles Ltd.', '80a1a765'],
    ['Shree Balaji (Mala) Textiles Ltd. (Shree Balaji Mala IPO) CT', '6fc323b2'],
    ['Shree Balaji (Mala) Textiles Ltd. (Shree Balaji Mala IPO) P', 'f71bbd1b'],
    ['Shree Balaji Mala Textiles', 'b0344c53'],
  ];

  it('folds the 12 real staging rows to exactly 3 company identities', () => {
    const keys = new Set(STAGING_TWINS_2026_09_16.map(([name]) => foldCompanyIdentity(name)));
    expect([...keys].sort()).toEqual(['gvelectricals', 'hrhygieneproducts', 'shreebalajimalatextiles']);
  });

  it('strips the bracketed tail with and without a trailing status token', () => {
    const clean = foldCompanyIdentity('G.V.Electricals Ltd.');
    for (const tail of ['', ' CT', ' LT', ' P', ' ct']) {
      expect(foldCompanyIdentity(`G.V.Electricals Ltd. (G.V. Electricals IPO)${tail}`)).toBe(clean);
    }
  });

  it('does NOT strip a bare trailing 1-2 letter token without the bracketed tail', () => {
    // "Jay Bee Laminations Ltd. O" is a real fixture name; stripping a bare
    // trailing token would merge "Foo P" into "Foo" on nothing but a letter.
    expect(foldCompanyIdentity('Jay Bee Laminations Ltd. O')).not.toBe(
      foldCompanyIdentity('Jay Bee Laminations Ltd.'),
    );
  });

  it('does NOT strip a bracketed tail that is not an IPO-name tail', () => {
    // "(India)" is a real part of a name and is handled by the word strip, not here.
    expect(foldCompanyIdentity('Kwality Walls (India) Ltd')).toBe('kwalitywalls');
    // A bracketed tail whose text does not end in "IPO" stays.
    expect(foldCompanyIdentity('Acme Ltd (Demerged)')).toBe('acmedemerged');
  });
});


/**
 * Item 12 slice G, Tier A finding on #672: the Date branch of isoDay() was untested. node-pg
 * parses a bare Postgres `date` into a JS Date at LOCAL MIDNIGHT of that calendar day; on an IST
 * machine (UTC+5:30) that Date's UTC instant is 18:30 the PREVIOUS day. `new Date('2026-07-25T18:30:00.000Z')`
 * is exactly that shape: the local-midnight-in-IST representation of 2026-07-26. A UTC projection
 * (`.toISOString().slice(0, 10)`) reads this back as "2026-07-25" — the day BEFORE the one the
 * server actually sent (the F-104 class). isoDay() must read the LOCAL day, not the UTC day.
 */
describe('isoDay — the Date branch (F-104 class, Tier A finding on #672)', () => {
  // Same TZ-mutation pattern as scraper/tests/unit/scrapers/nse-date-tz.test.ts: isoDay() reads
  // getFullYear/getMonth/getDate, which are governed by process.env.TZ. Pin to Asia/Kolkata (IST,
  // UTC+5:30 — the prod scraper's zone) so this test is deterministic under a UTC CI runner, not
  // an accident of running on an IST laptop.
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'Asia/Kolkata';
  });
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it("reads node-pg's local-midnight-in-IST Date shape as the LOCAL calendar day, not the UTC day", () => {
    const nodePgShape = new Date('2026-07-25T18:30:00.000Z');
    expect(isoDay(nodePgShape)).toBe('2026-07-26');
  });

  it('daysBetween of two such Dates 3 calendar days apart is 3', () => {
    const day1 = isoDay(new Date('2026-07-25T18:30:00.000Z')); // local IST day: 2026-07-26
    const day2 = isoDay(new Date('2026-07-28T18:30:00.000Z')); // local IST day: 2026-07-29
    expect(day1).toBe('2026-07-26');
    expect(day2).toBe('2026-07-29');
    expect(daysBetween(day1!, day2!)).toBe(3);
  });

  it('a plain YYYY-MM-DD string (the shape this schema actually returns) reads unchanged', () => {
    expect(isoDay('2026-07-26')).toBe('2026-07-26');
  });

  it('is null-safe for missing/invalid values', () => {
    expect(isoDay(null)).toBeNull();
    expect(isoDay(undefined)).toBeNull();
    expect(isoDay(new Date('not-a-date'))).toBeNull();
  });
});
