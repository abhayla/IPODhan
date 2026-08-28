import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseBseBoard,
  resolveIpoNo,
  resolveBseBoardRow,
  extractBseCoreRow,
  BseBoardShapeError,
  IPO_ISSUE_FLAGS,
} from '../../../src/services/bse-ipo-board.js';

const FIXTURES = join(__dirname, '../../fixtures/documents');
const boardPayload = JSON.parse(readFileSync(join(FIXTURES, 'bse-ipo-homepage.json'), 'utf8'));

describe('parseBseBoard — corporate-action pollution (matrix F12)', () => {
  it('T16 drops every non-IPO row from the REAL board payload', () => {
    const total = boardPayload.Table.length;
    const rows = parseBseBoard(boardPayload);

    // The live board on 2026-08-28 carried 22 rows, ELEVEN of them corporate
    // actions: Takeover x5, Buyback - Tender Offer x1, BuyBack x2, Debt Issue x2,
    // RI x1. Only 11 rows are genuine Book Building / Fixed Price issues -- i.e.
    // HALF the board would have been treated as an IPO without the F12 filter.
    expect(total).toBe(22);
    expect(rows).toHaveLength(11);
    expect(total - rows.length).toBe(11);

    for (const row of rows) expect(IPO_ISSUE_FLAGS).toContain(row.issueFlag);
    const names = rows.map((r) => r.companyName);
    expect(names).not.toContain('RELIABLE VENTURES INDIA LTD'); // Takeover
    expect(names).not.toContain('GANDHI SPECIAL TUBES LTD'); // Buyback
    expect(names).not.toContain('KOSAMATTAM FINANCE LIMITED'); // Debt Issue
    expect(names).not.toContain('SI CAPITAL  FINANCIAL SERVICES LTD'); // RI
  });

  it('T16b keeps the parsed fields the runner needs', () => {
    const rows = parseBseBoard(boardPayload);
    const skyways = rows.find((r) => r.ipoNo === 7903);
    // Skyways closed on 27 Aug so it has already left the live board; ESDS is on it.
    const esds = rows.find((r) => r.ipoNo === 7916);
    expect(skyways ?? esds).toBeDefined();
    expect(esds).toMatchObject({
      ipoNo: 7916,
      scripCode: 4770,
      status: 'L',
      issueFlag: 'Book Building',
      startDate: '2026-08-28',
      endDate: '2026-09-01',
      isFixedPrice: false,
    });
  });
});

describe('resolveBseBoardRow / resolveIpoNo', () => {
  const rows = parseBseBoard(boardPayload);

  it('T17 resolves our stored company_name to the board IPO_NO across suffix forms', () => {
    // Our DB stores 'ESDS Software Solution Limited'; the board says the same.
    expect(resolveIpoNo(rows, 'ESDS Software Solution Limited')).toBe(7916);
    // Suffix variance must not matter: 'Ltd.' vs 'Limited', case, punctuation.
    expect(resolveIpoNo(rows, 'ESDS Software Solution Ltd.')).toBe(7916);
    expect(resolveIpoNo(rows, 'esds software solution ltd')).toBe(7916);
  });

  it('T18 resolves an upcoming (status F) issue — Deepa Jewellers Ltd.', () => {
    const row = resolveBseBoardRow(rows, 'Deepa Jewellers Ltd.');
    expect(row).toMatchObject({ ipoNo: 7922, status: 'F', issueFlag: 'Book Building' });
  });

  it('T19 returns null for a company not on the board (SME is F13, not a failure)', () => {
    // The mainboard board does not carry SME issues (matrix §0) — Madhur Knit is
    // an NSE Emerge issue, so "absent" is the normal, correct answer here.
    expect(resolveIpoNo(rows, 'Madhur Knit Crafts Ltd.')).toBeNull();
    expect(resolveIpoNo(rows, '')).toBeNull();
    expect(resolveIpoNo([], 'ESDS Software Solution Limited')).toBeNull();
  });

  it('T19b never resolves a company to a corporate-action row', () => {
    expect(resolveIpoNo(rows, 'RELIABLE VENTURES INDIA LTD')).toBeNull();
    expect(resolveIpoNo(rows, 'GANDHI SPECIAL TUBES LTD')).toBeNull();
  });

  it('T19c refuses an AMBIGUOUS match rather than guessing a wrong IPO_NO', () => {
    const dupes = [
      { ipoNo: 1, scripCode: null, companyName: 'Acme Ltd', status: 'L', issueFlag: 'Book Building', startDate: null, endDate: null, isFixedPrice: false },
      { ipoNo: 2, scripCode: null, companyName: 'Acme Limited', status: 'L', issueFlag: 'Book Building', startDate: null, endDate: null, isFixedPrice: false },
    ];
    expect(resolveIpoNo(dupes, 'Acme Ltd.')).toBeNull();
  });
});

describe('shape-change safety (matrix F18)', () => {
  it('T20 THROWS on a board payload with no Table array — never a silent []', () => {
    expect(() => parseBseBoard({ Data: [] })).toThrow(BseBoardShapeError);
    expect(() => parseBseBoard(null)).toThrow(BseBoardShapeError);
    expect(() => parseBseBoard('nope')).toThrow(BseBoardShapeError);
  });

  it('T20b THROWS on a core payload with no IPONO_0 key', () => {
    expect(() => extractBseCoreRow({ status: 'ok' })).toThrow(BseBoardShapeError);
  });

  it('T20c returns null (not a throw) for an EMPTY IPONO_0 — a real "no detail yet"', () => {
    expect(extractBseCoreRow({ IPONO_0: [] })).toBeNull();
  });

  it('T20d extracts the detail row from IPONO_0[0], not the top level', () => {
    const core = JSON.parse(readFileSync(join(FIXTURES, 'bse-skyways-core.json'), 'utf8'));
    expect(core.Prospectus_GID).toBeUndefined();
    const row = extractBseCoreRow(core)!;
    expect(row.IPO_NO).toBe('7903');
    expect(String(row.Prospectus_GID)).toContain('RHPSkyways');
  });
});
