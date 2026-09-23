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

  it('S2: a name match whose KNOWN open date differs is declined (never written into that row)', async () => {
    const r = repo({ findByNormalizedName: vi.fn().mockResolvedValue(RAYS), findBySlug: vi.fn().mockResolvedValue(RAYS) });
    const got = await resolveIpoRow(r, {
      companyName: 'Rays of Belief Ltd.',
      normalizedName: 'rays of belief',
      slug: 'rays-of-belief-ltd',
      openDate: '2026-09-15',
      priceRangeMin: 227,
      segment: 'MAINBOARD',
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
