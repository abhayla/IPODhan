/**
 * OD-68 (§2.3.3.2 S1/S2/S3/S6) on the real `resolveIpoRow` with a stub repository.
 * The real-Postgres proof is scraper/tests/integration/identity-matching-od68.integration.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveIpoRow } from './ipo-identity';
import type { IPORepository } from './ipo-repository';
import type { IPO } from './types';
import {
  normalizeIdentityCompanyName,
  stripIdentityNameDecoration,
  stripIdentitySlugSuffix,
} from '../utils/identity-decoration';

const RAYS = {
  id: 'rays',
  companyName: 'Rays of Belief Limited- For Profit Social Enterprise',
  slug: 'rays-of-belief-ltd',
  segment: 'MAINBOARD',
  offeringType: 'IPO',
  openDate: '2026-09-01',
  priceRangeMin: 227,
} as unknown as IPO;

function repo(overrides: Record<string, unknown> = {}) {
  return {
    findByIsin: vi.fn().mockResolvedValue(null),
    findBySymbol: vi.fn().mockResolvedValue(null),
    findByNormalizedName: vi.fn().mockResolvedValue(null),
    findByNormalizedNamePrefix: vi.fn().mockResolvedValue([]),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByFuzzyName: vi.fn().mockResolvedValue(null),
    findLiveByOpenDate: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as IPORepository;
}

describe('identity decoration (OD-68 S1/S3)', () => {
  it('strips page-status suffixes from a slug, never an OFS year', () => {
    expect(stripIdentitySlugSuffix('rays-of-belief-ltd-o')).toBe('rays-of-belief-ltd');
    expect(stripIdentitySlugSuffix('x-ltd-lt')).toBe('x-ltd');
    expect(stripIdentitySlugSuffix('x-ltd-ct')).toBe('x-ltd');
    expect(stripIdentitySlugSuffix('x-ltd-p')).toBe('x-ltd');
    expect(stripIdentitySlugSuffix('acme-ofs-2026')).toBe('acme-ofs-2026');
  });

  it('strips page-title text and status tokens from a name, keeping real hyphens', () => {
    expect(stripIdentityNameDecoration('Rays of Belief Limited- For Profit Social Enterprise')).toBe('Rays of Belief Limited');
    expect(stripIdentityNameDecoration('Rays of Belief Ltd. O')).toBe('Rays of Belief Ltd.');
    expect(stripIdentityNameDecoration("Purple Style Labs Ltd - Pernia's Pop-Up Studio IPO")).toBe('Purple Style Labs Ltd');
    expect(stripIdentityNameDecoration('National Stock Exchange of India Ltd (NSE IPO)')).toBe('National Stock Exchange of India Ltd');
    expect(stripIdentityNameDecoration('Indo-MIM Ltd')).toBe('Indo-MIM Ltd');
  });

  it('folds the Rays of Belief pair together and keeps both look-alike pairs apart (S6)', () => {
    expect(normalizeIdentityCompanyName('Rays of Belief Ltd. O')).toBe(
      normalizeIdentityCompanyName('Rays of Belief Limited- For Profit Social Enterprise')
    );
    expect(normalizeIdentityCompanyName('Himalayan Solar Limited')).not.toBe(
      normalizeIdentityCompanyName('Himalaya Nutravedics India Limited')
    );
    expect(normalizeIdentityCompanyName('Technocraft Ventures Ltd.')).not.toBe(
      normalizeIdentityCompanyName('Technocrats Plasma Systems Ltd.')
    );
    expect(normalizeIdentityCompanyName('G.V. Electricals Ltd. O')).toBe(normalizeIdentityCompanyName('G.V.Electricals Ltd.'));
  });
});

describe('#553 / S2: the real staging ARCIL pair binds the BSE-bound row, never a second unbound row', () => {
  // ipodhan_staging 2026-09-11 (#553): 0ef10ead (BSE IPO_NO 7950, created 09-06) and
  // 5677e1e9 (no BSE id, created 09-09), same open 2026-09-09 / close 2026-09-11, MAINBOARD.
  const ARCIL_BSE = {
    id: '0ef10ead',
    companyName: 'ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED',
    slug: 'asset-reconstruction-company-india-limited',
    segment: 'MAINBOARD',
    offeringType: 'IPO',
    status: 'OPEN',
    openDate: '2026-09-09',
    priceRangeMin: null,
    bseIpoNo: 7950,
  } as unknown as IPO;
  const incoming = {
    companyName: 'Asset Reconstruction Co.(India) Ltd.',
    normalizedName: 'asset reconstruction india',
    slug: 'asset-reconstruction-co-india-ltd',
    segment: 'MAINBOARD' as const,
    openDate: '2026-09-09',
    priceRangeMin: null,
  };

  it('with the name/slug tiers all missing, the strict identity fold + same open date binds 0ef10ead', async () => {
    const r = repo({ findLiveByOpenDate: vi.fn().mockResolvedValue([ARCIL_BSE]) });
    await expect(resolveIpoRow(r, incoming)).resolves.toMatchObject({ id: '0ef10ead' });
  });

  it('a known differing price band on the same day still refuses the bind (S2 corroboration stands)', async () => {
    const r = repo({ findLiveByOpenDate: vi.fn().mockResolvedValue([{ ...ARCIL_BSE, priceRangeMin: 100 }]) });
    await expect(resolveIpoRow(r, { ...incoming, priceRangeMin: 120 })).resolves.toBeNull();
  });
});

describe('resolveIpoRow — OD-68 matching', () => {
  it('S1: a decorated slug is stripped before the slug tier (rays-of-belief-ltd-o finds rays-of-belief-ltd)', async () => {
    const findBySlug = vi.fn(async (slug: string) => (slug === 'rays-of-belief-ltd' ? RAYS : null));
    const got = await resolveIpoRow(repo({ findBySlug }), {
      companyName: 'Rays of Belief Ltd. O',
      normalizedName: 'rays of belief',
      slug: 'rays-of-belief-ltd-o',
      openDate: '2026-09-01',
      segment: 'MAINBOARD',
    });
    expect(got?.id).toBe('rays');
    expect(findBySlug).toHaveBeenCalledWith('rays-of-belief-ltd');
  });

  it('MAJOR-1 postponement: an EXACT name match whose open date moved within 180 days binds (same offering, OD-35)', async () => {
    const r = repo({ findByNormalizedName: vi.fn().mockResolvedValue(RAYS), findBySlug: vi.fn().mockResolvedValue(RAYS) });
    const got = await resolveIpoRow(r, {
      companyName: 'Rays of Belief Ltd.',
      normalizedName: 'rays of belief',
      slug: 'rays-of-belief-ltd',
      openDate: '2026-09-15',
      priceRangeMin: 227,
      segment: 'MAINBOARD',
    });
    expect(got?.id).toBe('rays');
  });

  it('MAJOR-1: an open date more than 180 days away is a NEW offering - not bound (OD-35)', async () => {
    const got = await resolveIpoRow(repo({ findByNormalizedName: vi.fn().mockResolvedValue(RAYS) }), {
      companyName: 'Rays of Belief Ltd.',
      normalizedName: 'rays of belief',
      slug: 'rays-of-belief-ltd',
      openDate: '2027-04-01',
      priceRangeMin: null,
      segment: 'MAINBOARD',
    });
    expect(got).toBeNull();
  });

  it('MAJOR-1: a FUZZY (typo) name match may not also absorb a moved open date (OD-69 look-alikes)', async () => {
    const solar = { ...RAYS, id: 'solar', companyName: 'Himalayan Solar Ltd.', slug: 'himalayan-solar-ltd', segment: 'SME', openDate: '2026-09-25', priceRangeMin: null };
    const got = await resolveIpoRow(repo({ findByFuzzyName: vi.fn().mockResolvedValue(solar) }), {
      companyName: 'Himalaya Solar Ltd.',
      normalizedName: 'himalaya solar',
      slug: 'himalaya-solar-ltd',
      openDate: '2026-09-22',
      segment: 'SME',
    });
    expect(got).toBeNull();
  });

  it('S2: a name match whose KNOWN price band differs is declined', async () => {
    const got = await resolveIpoRow(repo({ findByNormalizedName: vi.fn().mockResolvedValue(RAYS) }), {
      companyName: 'Rays of Belief Ltd.',
      normalizedName: 'rays of belief',
      slug: 'rays-of-belief-ltd',
      openDate: '2026-09-01',
      priceRangeMin: 300,
      segment: 'MAINBOARD',
    });
    expect(got).toBeNull();
  });

  it('an unknown date or band (null / 0) neither proves nor refutes — the name match stands', async () => {
    const got = await resolveIpoRow(repo({ findByNormalizedName: vi.fn().mockResolvedValue(RAYS) }), {
      companyName: 'Rays of Belief Ltd.',
      normalizedName: 'rays of belief',
      slug: 'rays-of-belief-ltd',
      openDate: null,
      priceRangeMin: 0,
      segment: 'MAINBOARD',
    });
    expect(got?.id).toBe('rays');
  });

  it('S3: the identity fold + the SAME open date binds a title-polluted stored name', async () => {
    const got = await resolveIpoRow(repo({ findLiveByOpenDate: vi.fn().mockResolvedValue([RAYS]) }), {
      companyName: 'Rays of Belief Limited',
      normalizedName: 'rays of belief',
      slug: 'rays-of-belief-limited',
      openDate: '2026-09-01',
      priceRangeMin: null,
      segment: 'MAINBOARD',
    });
    expect(got?.id).toBe('rays');
  });

  it('S6: the fold tier never joins look-alikes on the same day', async () => {
    const solar = { ...RAYS, id: 'solar', companyName: 'Himalayan Solar Ltd.', slug: 'himalayan-solar-ltd', segment: 'SME', openDate: '2026-09-22' };
    const got = await resolveIpoRow(repo({ findLiveByOpenDate: vi.fn().mockResolvedValue([solar]) }), {
      companyName: 'Himalaya Nutravedics India Limited',
      normalizedName: 'himalaya nutravedics',
      slug: 'himalaya-nutravedics-india-limited',
      openDate: '2026-09-22',
      segment: 'SME',
    });
    expect(got).toBeNull();
  });

  it('MAJOR-3: the fold tier uses the STRICT fold - "Laxmi India Finance" never binds "Laxmi Finance" on the same day', async () => {
    const laxmi = { ...RAYS, id: 'laxmi', companyName: 'Laxmi India Finance Ltd', slug: 'laxmi-india-finance-ltd', openDate: '2026-09-01', priceRangeMin: null };
    const got = await resolveIpoRow(repo({ findLiveByOpenDate: vi.fn().mockResolvedValue([laxmi]) }), {
      companyName: 'Laxmi Finance Ltd',
      normalizedName: 'laxmi finance',
      slug: 'laxmi-finance-ltd',
      openDate: '2026-09-01',
      segment: 'MAINBOARD',
    });
    expect(got).toBeNull();
  });

  it('OD-71: a WITHDRAWN row never binds a refiling by name - it is a new offering', async () => {
    const withdrawn = { ...RAYS, id: 'rays-withdrawn', status: 'WITHDRAWN' };
    const got = await resolveIpoRow(
      repo({ findByNormalizedName: vi.fn().mockResolvedValue(withdrawn), findBySlug: vi.fn().mockResolvedValue(withdrawn) }),
      {
        companyName: 'Rays of Belief Ltd.',
        normalizedName: 'rays of belief',
        slug: 'rays-of-belief-ltd',
        openDate: null,
        priceRangeMin: null,
        segment: 'MAINBOARD',
      }
    );
    expect(got).toBeNull();
  });

  it('the fold tier declines when two rows share the fold and the day (ambiguous)', async () => {
    const twin = { ...RAYS, id: 'rays-2', slug: 'rays-of-belief-ltd-o' };
    const got = await resolveIpoRow(repo({ findLiveByOpenDate: vi.fn().mockResolvedValue([RAYS, twin]) }), {
      companyName: 'Rays of Belief Limited',
      normalizedName: 'rays of belief',
      slug: 'rays-of-belief-limited',
      openDate: '2026-09-01',
      segment: 'MAINBOARD',
    });
    expect(got).toBeNull();
  });
});
