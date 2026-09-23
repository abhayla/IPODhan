/**
 * Item 12 remainder (part of #903) — OD-34 binding order, step 1: CIN.
 * Spec: docs/design/data-sourcing-pull-model.md §2.3.3.2 (the binding order table, OD-34),
 * OD-35 (one row is one offering), OD-69 (differing identifier never joins), OD-70/OD-71.
 *
 * Real CINs from ipodhan_staging (read 2026-09-23): Adroit Industries (India) Ltd.
 * U74999MH1995PLC084474, Elevate Campuses Ltd. U74994MH2005PLC339336, and the
 * Rays of Belief pair (two rows, ONE CIN U85110DL2017PLC322623 — the S1 duplicate).
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveIpoRow, type IpoIdentity } from './ipo-identity';
import type { IPORepository } from './ipo-repository';
import type { IPO } from './types';

const ADROIT_CIN = 'U74999MH1995PLC084474';
const ELEVATE_CIN = 'U74994MH2005PLC339336';
const RAYS_CIN = 'U85110DL2017PLC322623';

const ADROIT = {
  id: 'adroit',
  companyName: 'Adroit Industries (India) Ltd.',
  slug: 'adroit-industries-india-ltd',
  symbol: 'ADROITIND',
  cin: ADROIT_CIN,
  segment: 'SME',
  offeringType: 'IPO',
  status: 'OPEN',
  openDate: '2026-09-22',
  priceRangeMin: 95,
} as unknown as IPO;

function repo(overrides: Record<string, unknown> = {}) {
  return {
    findByCin: vi.fn().mockResolvedValue([]),
    findByIsin: vi.fn().mockResolvedValue(null),
    findBySymbol: vi.fn().mockResolvedValue(null),
    findByNormalizedName: vi.fn().mockResolvedValue(null),
    findByNormalizedNamePrefix: vi.fn().mockResolvedValue([]),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByFuzzyName: vi.fn().mockResolvedValue(null),
    findLiveByOpenDate: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as IPORepository & Record<string, ReturnType<typeof vi.fn>>;
}

const renamed: IpoIdentity = {
  // A name the stored row does not carry (a draft-vs-RHP rename shape): only the CIN can bind it.
  companyName: 'Adroit Infra Industries Limited',
  normalizedName: 'adroit infra industries',
  slug: 'adroit-infra-industries-ltd',
  cin: ADROIT_CIN,
};

describe('OD-34 step 1: CIN binds before symbol and name', () => {
  it('a record whose CIN matches binds to that row even though its name differs', async () => {
    const r = repo({ findByCin: vi.fn().mockResolvedValue([ADROIT]) });
    const result = await resolveIpoRow(r, renamed);
    expect(result?.id).toBe('adroit');
    expect(r.findByCin).toHaveBeenCalledWith(ADROIT_CIN);
  });

  it('CIN is normalised (spaces, lower case) before lookup, and an invalid CIN is treated as absent', async () => {
    const r = repo({ findByCin: vi.fn().mockResolvedValue([ADROIT]) });
    await resolveIpoRow(r, { ...renamed, cin: ' u74999mh1995plc084474 ' });
    expect(r.findByCin).toHaveBeenCalledWith(ADROIT_CIN);

    const r2 = repo();
    await resolveIpoRow(r2, { ...renamed, cin: 'U7499' });
    expect(r2.findByCin).not.toHaveBeenCalled();
  });

  it('CIN beats symbol: the symbol points at another row, the CIN row wins and symbol is never asked', async () => {
    const other = { ...ADROIT, id: 'other', cin: null, symbol: 'ADROITIND' } as unknown as IPO;
    const r = repo({
      findByCin: vi.fn().mockResolvedValue([ADROIT]),
      findBySymbol: vi.fn().mockResolvedValue(other),
    });
    const result = await resolveIpoRow(r, { ...renamed, symbol: 'ADROITIND' });
    expect(result?.id).toBe('adroit');
    expect(r.findBySymbol).not.toHaveBeenCalled();
    expect(r.findByNormalizedName).not.toHaveBeenCalled();
  });

  it('missing CIN falls through to the next step unchanged (findByCin is never asked)', async () => {
    const r = repo({ findBySymbol: vi.fn().mockResolvedValue(ADROIT) });
    const result = await resolveIpoRow(r, { ...renamed, cin: null, symbol: 'ADROITIND' });
    expect(result?.id).toBe('adroit');
    expect(r.findByCin).not.toHaveBeenCalled();
  });

  it('a CIN with no row falls through to symbol/name', async () => {
    const r = repo({ findByNormalizedName: vi.fn().mockResolvedValue({ ...ADROIT, cin: null }) });
    const result = await resolveIpoRow(r, { ...renamed, normalizedName: 'adroit industries india' });
    expect(result?.id).toBe('adroit');
  });

  it('a repository without findByCin (older double) still resolves by the later steps', async () => {
    const r = repo({ findBySymbol: vi.fn().mockResolvedValue(ADROIT) });
    delete (r as Record<string, unknown>).findByCin;
    const result = await resolveIpoRow(r, { ...renamed, symbol: 'ADROITIND' });
    expect(result?.id).toBe('adroit');
  });
});

describe('OD-35 / OD-70 / OD-71: a CIN names the company, not the offering', () => {
  it('a CIN row that is WITHDRAWN is not bound (OD-71: a refiling is a new offering)', async () => {
    const withdrawn = { ...ADROIT, status: 'WITHDRAWN' } as unknown as IPO;
    const r = repo({ findByCin: vi.fn().mockResolvedValue([withdrawn]) });
    const result = await resolveIpoRow(r, renamed);
    expect(result).toBeNull();
  });

  it('a CIN row whose open date is more than 180 days away is not bound (OD-35: new offering)', async () => {
    const r = repo({ findByCin: vi.fn().mockResolvedValue([ADROIT]) });
    const result = await resolveIpoRow(r, { ...renamed, openDate: '2027-06-01' });
    expect(result).toBeNull();
  });

  it('a later event of another type (RIGHTS) never binds to the company IPO row by CIN (OD-70)', async () => {
    const r = repo({ findByCin: vi.fn().mockResolvedValue([ADROIT]) });
    const result = await resolveIpoRow(r, { ...renamed, offeringType: 'RIGHTS' });
    expect(result).toBeNull();
  });

  it('an FPO of the same company never binds to the IPO row by CIN either (OD-35: IPO -> FPO is a new row, no reclassification exception on the CIN step)', async () => {
    const r = repo({ findByCin: vi.fn().mockResolvedValue([ADROIT]) });
    const result = await resolveIpoRow(r, { ...renamed, offeringType: 'FPO' });
    expect(result).toBeNull();
  });

  it('among the company rows, the one of the incoming offering type is chosen (IPO + OFS share a CIN)', async () => {
    const ofs = { ...ADROIT, id: 'adroit-ofs', offeringType: 'OFS', slug: 'adroit-ofs-2026' } as unknown as IPO;
    const r = repo({ findByCin: vi.fn().mockResolvedValue([ADROIT, ofs]) });
    expect((await resolveIpoRow(r, { ...renamed, offeringType: 'OFS' }))?.id).toBe('adroit-ofs');
    expect((await resolveIpoRow(r, { ...renamed, offeringType: 'IPO' }))?.id).toBe('adroit');
  });

  it('a CIN row of a different segment (SME vs MAINBOARD) is not bound by CIN (an SME and a mainboard offering of the same company are two offerings)', async () => {
    const r = repo({ findByCin: vi.fn().mockResolvedValue([{ ...ADROIT, segment: 'SME' }]) });
    const result = await resolveIpoRow(r, { ...renamed, segment: 'MAINBOARD' });
    expect(result).toBeNull();
  });

  it('two eligible rows on one CIN (the real Rays of Belief pair) is ambiguous: no CIN bind, later steps decide', async () => {
    const a = { ...ADROIT, id: 'rays', cin: RAYS_CIN, companyName: 'Rays of Belief Ltd.', slug: 'rays-of-belief-ltd', segment: 'MAINBOARD', status: 'LISTED', openDate: null } as unknown as IPO;
    const b = { ...a, id: 'rays-o', slug: 'rays-of-belief-ltd-o' } as unknown as IPO;
    const r = repo({
      findByCin: vi.fn().mockResolvedValue([a, b]),
      findBySlug: vi.fn().mockResolvedValue(a),
    });
    const result = await resolveIpoRow(r, {
      companyName: 'Rays of Belief Ltd.', normalizedName: 'rays of belief', slug: 'rays-of-belief-ltd', cin: RAYS_CIN,
    });
    expect(result?.id).toBe('rays');
    expect(r.findBySlug).toHaveBeenCalled();
  });
});

describe('OD-69: a differing CIN never joins, whatever else matches', () => {
  it('a same-name row whose CIN DIFFERS is never bound', async () => {
    const sameName = { ...ADROIT, cin: ELEVATE_CIN } as unknown as IPO;
    const r = repo({ findByNormalizedName: vi.fn().mockResolvedValue(sameName) });
    const result = await resolveIpoRow(r, {
      companyName: 'Adroit Industries (India) Ltd.', normalizedName: 'adroit industries india', slug: 'adroit-industries-india-ltd', cin: ADROIT_CIN,
    });
    expect(result).toBeNull();
  });

  it('a symbol row whose CIN DIFFERS is never bound (a symbol is reused across time)', async () => {
    const reused = { ...ADROIT, cin: ELEVATE_CIN } as unknown as IPO;
    const r = repo({ findBySymbol: vi.fn().mockResolvedValue(reused) });
    const result = await resolveIpoRow(r, { ...renamed, symbol: 'ADROITIND' });
    expect(result).toBeNull();
  });

  it('a slug / fold row whose CIN differs is never bound either', async () => {
    const slugRow = { ...ADROIT, cin: ELEVATE_CIN } as unknown as IPO;
    const r = repo({
      findBySlug: vi.fn().mockResolvedValue(slugRow),
      findLiveByOpenDate: vi.fn().mockResolvedValue([slugRow]),
    });
    const result = await resolveIpoRow(r, {
      companyName: 'Adroit Industries (India) Ltd.', normalizedName: 'x', slug: 'adroit-industries-india-ltd', cin: ADROIT_CIN, openDate: '2026-09-22',
    });
    expect(result).toBeNull();
  });

  it('a name row with NO stored CIN still binds (an absent CIN neither proves nor refutes)', async () => {
    const r = repo({ findByNormalizedName: vi.fn().mockResolvedValue({ ...ADROIT, cin: null }) });
    const result = await resolveIpoRow(r, {
      companyName: 'Adroit Industries (India) Ltd.', normalizedName: 'adroit industries india', slug: 'adroit-industries-india-ltd', cin: ADROIT_CIN,
    });
    expect(result?.id).toBe('adroit');
  });
});
