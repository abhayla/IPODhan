import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseBseScripPayload,
  indexBseScrips,
  toOracleScrips,
  BSE_SCRIP_LIST_URL,
} from '../../../src/scrapers/bse-scrip-master.js';
import { resolveSegmentFromMasters } from '../../../src/scrapers/exchange-segment-oracle.js';

/**
 * Every test here runs against `docs/design/probes/fixtures/bse/ListofScripData.sample.json`
 * — 53 UNMODIFIED rows of BSE's real response, captured and trimmed by the probe in #651.
 * Nothing in this file is a shape typed from memory, which is the specific failure the
 * defect-fix contract forbids in a parser test.
 */
const FIXTURE = resolve(
  __dirname,
  '../../../../docs/design/probes/fixtures/bse/ListofScripData.sample.json',
);
const body = readFileSync(FIXTURE, 'utf8');

const EMPTY_NSE = { mainboard: [], sme: [] };

describe('parseBseScripPayload — against the real captured payload', () => {
  it('parses every row of the fixture, with the keys BSE actually sends', () => {
    const rows = parseBseScripPayload(body);
    expect(rows.length).toBe(53);
    // If BSE renames GROUP or ISIN_NUMBER, this is the assertion that goes red — those
    // two are the only fields the oracle joins on.
    expect(rows.every((r) => r.group.length > 0)).toBe(true);
    expect(rows.some((r) => r.isin.startsWith('INE'))).toBe(true);
  });

  it('carries the 15 distinct groups the live feed returns, not a subset', () => {
    const groups = new Set(parseBseScripPayload(body).map((r) => r.group));
    // The probe measured these against all 5155 live rows; the sample keeps up to three
    // per group precisely so this stays true of the committed fixture.
    expect([...groups].sort()).toEqual(
      ['A', 'B', 'IP', 'M', 'MS', 'MT', 'P', 'R', 'T', 'TS', 'X', 'XT', 'Y', 'Z', 'ZP'],
    );
  });

  it('survives the wrapper shapes this API has used, because an empty read is a lie', () => {
    const rows = parseBseScripPayload(body);
    const one = rows[0];
    const asRow = {
      SCRIP_CD: one.scripCode, Scrip_Name: one.name, ISIN_NUMBER: one.isin,
      GROUP: one.group, Status: one.status,
    };
    expect(parseBseScripPayload(JSON.stringify({ Table: [asRow] })).length).toBe(1);
    expect(parseBseScripPayload(JSON.stringify({ data: [asRow] })).length).toBe(1);
    expect(parseBseScripPayload(JSON.stringify([asRow])).length).toBe(1);
  });

  it('treats BSE\'s "NA" ISIN placeholder as ABSENCE, never as an identifier', () => {
    // Measured on the live feed 2026-09-16: 5152 real ISINs, one empty, and TWO rows
    // carrying the literal "NA" — Chase Bright Steel and Pushpsons Industries, two
    // unrelated companies in group Y. Indexing both under "NA" would let a lookup for
    // one return the OTHER company's board: a sourced-but-wrong answer arriving through
    // the join rather than the group mapping.
    const rows = parseBseScripPayload(JSON.stringify([
      { SCRIP_CD: '1', Scrip_Name: 'Chase Bright Steel Ltd', ISIN_NUMBER: 'NA', GROUP: 'Y' },
      { SCRIP_CD: '2', Scrip_Name: 'Pushpsons Industries Ltd', ISIN_NUMBER: 'NA', GROUP: 'M' },
    ]));
    expect(rows.map((r) => r.isin)).toEqual(['', '']);
    const { byIsin } = indexBseScrips(rows);
    expect(byIsin.has('NA')).toBe(false);
    expect(byIsin.size).toBe(0);

    // And the consequence that actually matters: asking the oracle for one of them by
    // that placeholder must NOT return the other's board.
    const r = resolveSegmentFromMasters(
      { isin: 'NA', companyName: 'something else entirely' },
      { nse: EMPTY_NSE, bse: toOracleScrips(indexBseScrips(rows)) },
    );
    expect(r.outcome).toBe('no-source');
  });

  it('keeps a real ISIN and rejects a malformed one', () => {
    const rows = parseBseScripPayload(JSON.stringify([
      { SCRIP_CD: '1', Scrip_Name: 'Real Co', ISIN_NUMBER: 'INE123A01011', GROUP: 'B' },
      { SCRIP_CD: '2', Scrip_Name: 'Short Co', ISIN_NUMBER: 'INE123', GROUP: 'B' },
    ]));
    expect(rows[0].isin).toBe('INE123A01011');
    expect(rows[1].isin).toBe('');
  });

  it('drops a row with neither ISIN nor name — it could not be joined to anything', () => {
    const rows = parseBseScripPayload(JSON.stringify([{ SCRIP_CD: '1', GROUP: 'B' }]));
    expect(rows.length).toBe(0);
  });

  it('points at the endpoint the probe proved, not the 404 CSV', () => {
    expect(BSE_SCRIP_LIST_URL).toContain('ListofScripData');
    expect(BSE_SCRIP_LIST_URL).toContain('status=Active');
    expect(BSE_SCRIP_LIST_URL).not.toContain('ListOfScrips.csv');
  });
});

describe('the fetcher feeds the oracle — end to end on real rows', () => {
  const master = indexBseScrips(parseBseScripPayload(body));
  const bse = toOracleScrips(master);

  it('resolves the SME companies the staging rows need, from BSE group M', () => {
    // These six are unsourceable via NSE (no ISIN, not in either NSE file) and are the
    // reason this slice exists. Measured against the fixture, not asserted from hope.
    for (const name of [
      'MARUTI INTERIOR PRODUCTS LTD',
      'SHIPWAVES ONLINE LIMITED',
      'STANBIK AGRO LIMITED',
      'WESTERN OVERSEAS STUDY ABROAD LIMITED',
      'TRAVELS  RENTALS LTD',
      'H R Hygiene Products',
    ]) {
      const r = resolveSegmentFromMasters({ isin: null, companyName: name }, { nse: EMPTY_NSE, bse });
      expect(r.outcome, `${name} should resolve`).toBe('resolved');
      expect(r.segment, `${name} should be SME`).toBe('SME');
      expect(r.via).toContain('group=M');
    }
  });

  it('REFUSES the two companies whose group has no evidenced meaning', () => {
    // NET PIX sits in group TS and SURYO FOODS in group X. Both are found — we know
    // exactly where they are — but neither group's meaning is evidenced, so the oracle
    // must report unresolved-group rather than guess. A guess here would publish a wrong
    // board, which is worse than publishing none.
    const netpix = resolveSegmentFromMasters(
      { isin: null, companyName: 'NET PIX SHORTS DIGITAL MEDIA LTD' }, { nse: EMPTY_NSE, bse },
    );
    expect(netpix.outcome).toBe('unresolved-group');
    expect(netpix.segment).toBeNull();
    expect(netpix.via).toContain('group=TS');

    const suryo = resolveSegmentFromMasters(
      { isin: null, companyName: 'SURYO FOODS  INDUSTRIES LTD' }, { nse: EMPTY_NSE, bse },
    );
    expect(suryo.outcome).toBe('unresolved-group');
    expect(suryo.via).toContain('group=X');
  });

  it('reports no-source for the never-listed offers, against a real master', () => {
    // The contract calls NIRBHAY and PIYUSH never-listed. Until now that was a claim
    // about an absent source; this asserts it against BSE's own register.
    for (const name of ['NIRBHAY COLOURS INDIA LTD', 'PIYUSH LIMITED']) {
      const r = resolveSegmentFromMasters({ isin: null, companyName: name }, { nse: EMPTY_NSE, bse });
      expect(r.outcome, `${name} must be absent from BSE too`).toBe('no-source');
      expect(r.segment).toBeNull();
    }
  });

  it('indexes by ISIN and by the ORACLE\'s name key, so both join paths agree', () => {
    const withIsin = master.rows.find((r) => r.isin.startsWith('INE'))!;
    expect(master.byIsin.get(withIsin.isin)).toBeTruthy();
    // A company reachable by name must resolve to the same scrip the ISIN reaches.
    const viaName = resolveSegmentFromMasters(
      { isin: null, companyName: withIsin.name }, { nse: EMPTY_NSE, bse },
    );
    const viaIsin = resolveSegmentFromMasters(
      { isin: withIsin.isin, companyName: 'nothing matches this' }, { nse: EMPTY_NSE, bse },
    );
    expect(viaName.segment).toBe(viaIsin.segment);
  });

  it('hands the group over VERBATIM and never maps it itself', () => {
    // The fetcher must not decide what a group means. If it ever started translating X
    // to MAINBOARD "helpfully", this goes red: every group string it emits must be one
    // BSE actually sent.
    const sent = new Set(parseBseScripPayload(body).map((r) => r.group));
    for (const s of toOracleScrips(master)) {
      expect(sent.has(s.group as string)).toBe(true);
      expect(['MAINBOARD', 'SME']).not.toContain(s.group);
    }
  });
});
