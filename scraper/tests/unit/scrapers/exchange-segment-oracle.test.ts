/**
 * Item 2 slice 3b2 — the exchange segment oracle.
 *
 * Every case here is built from a row measured on the real databases this session, so
 * the fixtures are not invented shapes: MARUTI INTERIOR really does trade on BSE under
 * the scrip id SPITZE; SI CAPITAL really is stored with the ampersand removed; NET PIX
 * really sits in BSE group TS; NIRBHAY and PIYUSH really are in neither master.
 *
 * No network. The oracle takes masters as arguments precisely so its logic is testable
 * without reaching the exchanges.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveSegmentFromMasters,
  normalizeCompanyName,
  bseGroupToSegment,
  BSE_GROUP_SME,
  BSE_GROUP_MAINBOARD,
} from '../../../src/scrapers/exchange-segment-oracle';

const masters = {
  nse: {
    mainboard: [
      { isin: 'INE002A01018', name: 'Reliance Industries Limited' },
      { isin: 'INE134E01011', name: 'Power Finance Corporation Limited' },
      { isin: 'INE0J1Y01018', name: 'CMS Info Systems Limited' },
    ],
    sme: [{ isin: 'INE0ABC01019', name: 'Some Emerge Company Limited' }],
  },
  bse: [
    { isin: 'INE002A01018', name: 'Reliance Industries Ltd', group: 'A' },
    // Maruti Interior's BSE scrip id is SPITZE - the reason symbol is never a join key.
    { isin: 'INE0XYZ01011', name: 'Maruti Interior Products Ltd', group: 'M' },
    { isin: 'INE0TS101011', name: 'Net Pix Shorts Digital Media Ltd', group: 'TS' },
    { isin: 'INE0X0101011', name: 'Suryo Foods & Industries Ltd', group: 'X' },
    { isin: 'INE0SI101011', name: 'SI Capital & Financial Services Ltd', group: 'XT' },
  ],
};

describe('normalizeCompanyName', () => {
  it('strips the ampersand on BOTH sides, because our stored names have it removed', () => {
    // Our row: "SI CAPITAL  FINANCIAL SERVICES" (double space where & was).
    // The master: "SI Capital & Financial Services Ltd".
    expect(normalizeCompanyName('SI CAPITAL  FINANCIAL SERVICES')).toBe(
      normalizeCompanyName('SI Capital & Financial Services Ltd'),
    );
  });

  it('strips parenthetical suffixes, which name the ISSUE and not the company', () => {
    expect(normalizeCompanyName('Power Finance Corporation Limited (Zero Coupon NCD)')).toBe(
      normalizeCompanyName('Power Finance Corporation Limited'),
    );
  });

  it('does not collapse two genuinely different companies', () => {
    // The normaliser drops a lot; prove it has not become a hash that maps everything
    // to the same bucket, which would make every assertion above pass vacuously.
    expect(normalizeCompanyName('Kwality Walls (India) Ltd')).not.toBe(
      normalizeCompanyName('Kwality Pharmaceuticals Ltd'),
    );
  });
});

describe('bseGroupToSegment — derived mapping only, never a guess', () => {
  it('maps the evidenced SME groups', () => {
    for (const g of BSE_GROUP_SME) expect(bseGroupToSegment(g)).toBe('SME');
  });

  it('maps the evidenced mainboard groups', () => {
    for (const g of BSE_GROUP_MAINBOARD) expect(bseGroupToSegment(g)).toBe('MAINBOARD');
  });

  it('refuses groups outside the evidence — X and TS are NOT guessed', () => {
    // An earlier draft assumed X meant MAINBOARD and inflated the sourceable count by
    // three rows. X and TS never appeared in the 187 independently-sourced rows the
    // mapping was derived from, so they have no sourced meaning.
    expect(bseGroupToSegment('X')).toBeNull();
    expect(bseGroupToSegment('TS')).toBeNull();
    expect(bseGroupToSegment('')).toBeNull();
    expect(bseGroupToSegment(null)).toBeNull();
  });

  it('the two evidenced sets do not overlap', () => {
    for (const g of BSE_GROUP_SME) expect(BSE_GROUP_MAINBOARD.has(g)).toBe(false);
  });
});

describe('resolveSegmentFromMasters', () => {
  it('resolves from NSE by ISIN', () => {
    const r = resolveSegmentFromMasters({ isin: 'INE002A01018', companyName: 'Reliance Industries Ltd' }, masters);
    expect(r.segment).toBe('MAINBOARD');
    expect(r.outcome).toBe('resolved');
    expect(r.via).toMatch(/NSE/);
  });

  it('resolves by NAME when the row carries no ISIN', () => {
    const r = resolveSegmentFromMasters({ isin: null, companyName: 'CMS Info Systems Limited' }, masters);
    expect(r.segment).toBe('MAINBOARD');
    expect(r.via).toBe('NSE/EQUITY_L/name');
  });

  it('matches a name whose suffix names the issue, not the company', () => {
    const r = resolveSegmentFromMasters(
      { isin: null, companyName: 'Power Finance Corporation Limited (Zero Coupon NCD)' },
      masters,
    );
    expect(r.segment).toBe('MAINBOARD');
  });

  it('resolves SME from a BSE group, for a company NSE does not list', () => {
    // Maruti Interior is BSE-only and its BSE scrip id (SPITZE) is not our symbol.
    const r = resolveSegmentFromMasters({ isin: null, companyName: 'MARUTI INTERIOR PRODUCTS LTD' }, masters);
    expect(r.segment).toBe('SME');
    expect(r.via).toBe('BSE/name/group=M');
  });

  it('returns unresolved-group — NOT no-source — for a group outside the evidence', () => {
    // This distinction is the point: we KNOW where Net Pix is. We have no sourced
    // meaning for group TS. Collapsing that into "not listed" would lose the fact that
    // the company was found, and would invite someone to treat it as never-listed.
    const r = resolveSegmentFromMasters({ isin: null, companyName: 'NET PIX SHORTS DIGITAL MEDIA LTD' }, masters);
    expect(r.segment).toBeNull();
    expect(r.outcome).toBe('unresolved-group');
    expect(r.via).toBe('BSE/name/group=TS');
    expect(r.reason).toMatch(/not guessed/);
  });

  it('also refuses group X, matching the ampersand-stripped stored name', () => {
    const r = resolveSegmentFromMasters({ isin: null, companyName: 'SURYO FOODS  INDUSTRIES LTD' }, masters);
    expect(r.outcome).toBe('unresolved-group');
    expect(r.via).toBe('BSE/name/group=X');
  });

  it('an ISIN hit into an unevidenced group STOPS — it does not fall through to a name match', () => {
    // A Tier B review asked what happens when the ISIN lands on a scrip whose group has
    // no sourced meaning, while a DIFFERENT scrip in an evidenced group matches by name.
    // The answer is deliberate: an ISIN identifies the security, so the ISIN hit wins and
    // we report unresolved-group. Falling through to the name match would resolve a
    // SECOND scrip and publish a sourced-but-wrong board — the exact class the BSE group
    // mapping comment says an earlier draft was corrected for.
    const twoScrips = {
      nse: { mainboard: [], sme: [] },
      bse: [
        { isin: 'INE000TEST01', name: 'Ambiguous Holdings Ltd', group: 'TS' },
        { isin: 'INE000OTHER9', name: 'Ambiguous Holdings Ltd', group: 'M' },
      ],
    };
    const r = resolveSegmentFromMasters(
      { isin: 'INE000TEST01', companyName: 'Ambiguous Holdings Ltd' },
      twoScrips,
    );
    expect(r.outcome).toBe('unresolved-group');
    expect(r.segment).toBeNull();
    expect(r.via).toBe('BSE/isin/group=TS');

    // Control: the same company WITHOUT the ISIN reaches the name path - and that path
    // now REFUSES, because this fixture is two DIFFERENT companies (two ISINs) sharing a
    // normalised name. It used to answer 'BSE/name/group=TS' on iteration order alone,
    // which is the first-wins defect #655's review found; the assertion above still
    // proves ISIN precedence, since only the ISIN path can answer this fixture at all.
    const byName = resolveSegmentFromMasters(
      { isin: null, companyName: 'Ambiguous Holdings Ltd' },
      twoScrips,
    );
    expect(byName.outcome).toBe('ambiguous-name');
    expect(byName.via).toBeNull();
  });

  it('returns no-source for a company in neither master (the never-listed case)', () => {
    // NIRBHAY and PIYUSH measured absent from NSE mainboard, NSE SME and BSE active.
    // This is why item 14's last slices cannot close from a listed-security master.
    const r = resolveSegmentFromMasters({ isin: null, companyName: 'NIRBHAY COLOURS INDIA LTD' }, masters);
    expect(r.segment).toBeNull();
    expect(r.outcome).toBe('no-source');
    expect(r.via).toBeNull();
    expect(r.reason).toMatch(/closed without listing/);
  });

  it('never resolves on an empty identity', () => {
    // A row with no ISIN and no name must not match the first master entry whose
    // normalised name is also empty - that would source a segment from nothing.
    const r = resolveSegmentFromMasters({ isin: null, companyName: null }, {
      nse: { mainboard: [{ isin: null, name: null }], sme: [] },
      bse: [{ isin: null, name: null, group: 'A' }],
    });
    expect(r.segment).toBeNull();
    expect(r.outcome).toBe('no-source');
  });

  it('always explains itself', () => {
    for (const name of ['Reliance Industries Ltd', 'NET PIX SHORTS DIGITAL MEDIA LTD', 'NIRBHAY COLOURS INDIA LTD']) {
      const r = resolveSegmentFromMasters({ isin: null, companyName: name }, masters);
      expect(r.reason.length).toBeGreaterThan(10);
    }
  });
});

/**
 * Ambiguous names (review finding on PR #655).
 *
 * The same sourced-but-wrong class the `cleanIsin` "NA" fix closed for ISINs, arriving
 * through the NAME join instead: a normalised name that matches MORE THAN ONE listed
 * scrip was resolved first-wins in three places, so a lookup could return another
 * company's board. First-wins is refused even when every candidate agrees on the board,
 * because agreement is a property of today's feed, not of the join.
 */
describe('resolveSegmentFromMasters — an ambiguous name is refused, never first-wins', () => {
  const EMPTY = { mainboard: [], sme: [] };

  it('refuses a name that is in NSE mainboard AND in a BSE M-group scrip', () => {
    const r = resolveSegmentFromMasters(
      { isin: null, companyName: 'Ambico Industries Limited' },
      {
        nse: { mainboard: [{ isin: 'INE111A01011', name: 'Ambico Industries Ltd' }], sme: [] },
        bse: [{ isin: 'INE222B01012', name: 'Ambico Industries Limited', group: 'M' }],
      },
    );
    expect(r.outcome).toBe('ambiguous-name');
    expect(r.segment).toBeNull();
    expect(r.via).toBeNull();
    expect(r.reason).toContain('2 candidates');
  });

  it('refuses even when every candidate would give the SAME segment', () => {
    const r = resolveSegmentFromMasters(
      { isin: null, companyName: 'Twinco Ltd' },
      {
        nse: EMPTY,
        bse: [
          { isin: 'INE333C01013', name: 'Twinco Limited', group: 'B' },
          { isin: 'INE444D01014', name: 'Twinco Ltd', group: 'A' },
        ],
      },
    );
    expect(r.outcome).toBe('ambiguous-name');
    expect(r.segment).toBeNull();
  });

  it('treats candidates WITHOUT an ISIN as each distinct', () => {
    const r = resolveSegmentFromMasters(
      { isin: null, companyName: 'Noisin Ltd' },
      {
        nse: EMPTY,
        bse: [
          { isin: '', name: 'Noisin Limited', group: 'B' },
          { isin: '', name: 'Noisin Ltd', group: 'B' },
        ],
      },
    );
    expect(r.outcome).toBe('ambiguous-name');
  });

  it('does NOT refuse the same company appearing in both masters under one ISIN', () => {
    const r = resolveSegmentFromMasters(
      { isin: null, companyName: 'Onecorp Limited' },
      {
        nse: { mainboard: [{ isin: 'INE555E01015', name: 'Onecorp Ltd' }], sme: [] },
        bse: [{ isin: 'INE555E01015', name: 'Onecorp Limited', group: 'B' }],
      },
    );
    expect(r.outcome).toBe('resolved');
    expect(r.segment).toBe('MAINBOARD');
  });

  it('positive control: a unique name still resolves exactly as before', () => {
    const r = resolveSegmentFromMasters(
      { isin: null, companyName: 'Maruti Interior Products Ltd' },
      masters,
    );
    expect(r.outcome).toBe('resolved');
    expect(r.segment).toBe('SME');
    expect(r.via).toBe('BSE/name/group=M');
  });

  it('positive control: the ISIN path is untouched by ambiguity of the name', () => {
    const r = resolveSegmentFromMasters(
      { isin: 'INE002A01018', companyName: 'Twinco Ltd' },
      {
        nse: masters.nse,
        bse: [
          { isin: 'INE333C01013', name: 'Twinco Limited', group: 'B' },
          { isin: 'INE444D01014', name: 'Twinco Ltd', group: 'A' },
        ],
      },
    );
    expect(r.outcome).toBe('resolved');
    expect(r.via).toBe('NSE/EQUITY_L/isin');
  });
});
