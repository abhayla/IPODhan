/**
 * T-318 (IDENT — NULL-safe key-first identity resolution) tests.
 *
 * Covers the priority-order rewrite of resolveIpoRow: isin -> nse symbol
 * (own keyspace, never bse_scrip_code) -> normalizedName -> slug -> fuzzy.
 * Binding constraints under test (per this task's contract / T-314C /
 * T-316C findings): NULL is never a key value; a key-tier hit that
 * disagrees with the name tier logs a structured warning and falls back to
 * the name-based row rather than silently picking either.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveIpoRow, type IpoIdentity } from './ipo-identity';
import type { IPORepository } from './ipo-repository';
import type { IPO } from './types';

function makeIpo(overrides: Partial<IPO> = {}): IPO {
  return {
    id: 'default-id',
    companyName: 'Default Co',
    slug: 'default-co',
    symbol: null,
    isin: null,
    ...overrides,
  } as IPO;
}

/** Minimal repository mock — every lookup defaults to "not found" (null). */
function makeRepo(overrides: Partial<Record<keyof IPORepository, any>> = {}) {
  return {
    findByIsin: vi.fn().mockResolvedValue(null),
    findBySymbol: vi.fn().mockResolvedValue(null),
    findByNormalizedName: vi.fn().mockResolvedValue(null),
    findByNormalizedNamePrefix: vi.fn().mockResolvedValue([]),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByFuzzyName: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as IPORepository;
}

const baseIdentity: IpoIdentity = {
  companyName: 'Acme Ltd',
  normalizedName: 'acme',
  slug: 'acme-ltd',
};

describe('resolveIpoRow — NULL-safety', () => {
  it('never queries findByIsin when isin is absent/null/empty, and never matches a NULL-isin row via that tier', async () => {
    const repo = makeRepo();
    const result = await resolveIpoRow(repo, { ...baseIdentity, isin: null });

    expect(repo.findByIsin).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('never queries findBySymbol when symbol is absent/null/empty', async () => {
    const repo = makeRepo();
    const result = await resolveIpoRow(repo, { ...baseIdentity, symbol: undefined });

    expect(repo.findBySymbol).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('an incoming identity with no isin/symbol resolves via name tiers only (keyless-row tail-of-chain behavior)', async () => {
    const existing = makeIpo({ id: 'row-1', companyName: 'Acme Ltd', slug: 'acme-ltd' });
    const repo = makeRepo({ findByNormalizedName: vi.fn().mockResolvedValue(existing) });

    const result = await resolveIpoRow(repo, { ...baseIdentity, isin: null, symbol: null });

    expect(result).toEqual(existing);
    expect(repo.findByIsin).not.toHaveBeenCalled();
    expect(repo.findBySymbol).not.toHaveBeenCalled();
  });
});

describe('resolveIpoRow — key-first priority', () => {
  it('a key hit (isin) beats a fuzzy name match — key tier wins when name tiers find nothing', async () => {
    const keyRow = makeIpo({ id: 'row-isin', companyName: 'Acme Ltd', isin: 'INE123A01011' });
    const repo = makeRepo({
      findByIsin: vi.fn().mockResolvedValue(keyRow),
      // name tiers all miss
    });

    const result = await resolveIpoRow(repo, { ...baseIdentity, isin: 'INE123A01011' });

    expect(result).toEqual(keyRow);
    expect(repo.findBySymbol).not.toHaveBeenCalled(); // isin hit short-circuits symbol tier
  });

  it('a key hit (symbol) is used when isin is absent', async () => {
    const keyRow = makeIpo({ id: 'row-symbol', companyName: 'Acme Ltd', symbol: 'ACME' });
    const repo = makeRepo({
      findBySymbol: vi.fn().mockResolvedValue(keyRow),
    });

    const result = await resolveIpoRow(repo, { ...baseIdentity, isin: null, symbol: 'ACME' });

    expect(result).toEqual(keyRow);
    expect(repo.findByIsin).not.toHaveBeenCalled();
  });

  it('isin tier is tried before symbol tier — symbol lookup is skipped once isin hits', async () => {
    const keyRow = makeIpo({ id: 'row-isin', isin: 'INE123A01011' });
    const repo = makeRepo({ findByIsin: vi.fn().mockResolvedValue(keyRow) });

    await resolveIpoRow(repo, { ...baseIdentity, isin: 'INE123A01011', symbol: 'ACME' });

    expect(repo.findBySymbol).not.toHaveBeenCalled();
  });

  it('falls through to name tiers when both isin and symbol tiers miss', async () => {
    const nameRow = makeIpo({ id: 'row-name' });
    const repo = makeRepo({
      findByNormalizedName: vi.fn().mockResolvedValue(nameRow),
    });

    const result = await resolveIpoRow(repo, { ...baseIdentity, isin: 'INE000000000', symbol: 'NOPE' });

    expect(result).toEqual(nameRow);
  });
});

describe('resolveIpoRow — bse_scrip_code is a separate keyspace', () => {
  it('findBySymbol is called with the raw symbol only — the resolver never reads/compares bseScripCode', async () => {
    // The resolver itself must not introduce a bseScripCode comparison. This
    // is enforced at the call-site level: resolveIpoRow only ever calls
    // ipoRepository.findBySymbol(identity.symbol) — it has no code path that
    // reads identity.bseScripCode or passes a scrip code into findBySymbol.
    const repo = makeRepo();
    await resolveIpoRow(repo, { ...baseIdentity, isin: null, symbol: '543320' });

    expect(repo.findBySymbol).toHaveBeenCalledWith('543320');
    expect(repo.findBySymbol).not.toHaveBeenCalledWith(expect.anything(), expect.anything());
  });
});

describe('resolveIpoRow — conflict detection', () => {
  it('when a key match (row A) and a name match (row B, different id) disagree, logs identity_conflict and falls back to the name-based row', async () => {
    const rowA = makeIpo({ id: 'row-A', companyName: 'Acme Ltd', isin: 'INE123A01011' });
    const rowB = makeIpo({ id: 'row-B', companyName: 'Acme Limited', slug: 'acme-ltd' });
    const repo = makeRepo({
      findByIsin: vi.fn().mockResolvedValue(rowA),
      findByNormalizedName: vi.fn().mockResolvedValue(rowB),
    });

    const { logger } = await import('../logger');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);

    const result = await resolveIpoRow(repo, { ...baseIdentity, isin: 'INE123A01011' });

    expect(result).toEqual(rowB); // falls back to name-based row, not the key match
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        keyMatchId: 'row-A',
        nameMatchId: 'row-B',
      }),
      expect.stringContaining('identity_conflict')
    );

    warnSpy.mockRestore();
  });

  it('does NOT log a conflict when the key match and name match resolve to the SAME row', async () => {
    const sameRow = makeIpo({ id: 'row-1', isin: 'INE123A01011' });
    const repo = makeRepo({
      findByIsin: vi.fn().mockResolvedValue(sameRow),
      findByNormalizedName: vi.fn().mockResolvedValue(sameRow),
    });

    const { logger } = await import('../logger');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);

    const result = await resolveIpoRow(repo, { ...baseIdentity, isin: 'INE123A01011' });

    expect(result).toEqual(sameRow);
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('resolveIpoRow — tier 3b: prefix-name matching with corroboration (W-108)', () => {
  const raysIncoming: IpoIdentity = {
    companyName: 'Rays of Belief Limited',
    normalizedName: 'rays of belief',
    slug: 'rays-of-belief-ltd',
    isin: null,
    symbol: null,
    openDate: '2026-09-01',
    priceRangeMin: 227,
  };

  it('(a) matches the existing longer-name row when open_date corroborates (the live W-108 case)', async () => {
    const existing = makeIpo({
      id: 'row-rays',
      companyName: 'Rays of Belief Limited- For Profit Social Enterprise',
      symbol: 'MOMSBELIEF',
      slug: 'rays-of-belief-limited-for-profit-social-enterprise',
      openDate: '2026-09-01',
      priceRangeMin: 227,
    } as Partial<IPO>);
    const repo = makeRepo({
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([existing]),
    });

    const result = await resolveIpoRow(repo, raysIncoming);

    expect(result).toEqual(existing);
    expect(repo.findByNormalizedNamePrefix).toHaveBeenCalledWith('rays of belief');
  });

  it('(a2) matches on price_range_min corroboration alone when open_date is absent', async () => {
    const existing = makeIpo({
      id: 'row-rays',
      companyName: 'Rays of Belief Limited- For Profit Social Enterprise',
      openDate: '2026-09-05', // deliberately different — must not be required
      priceRangeMin: 227,
    } as Partial<IPO>);
    const repo = makeRepo({
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([existing]),
    });

    const result = await resolveIpoRow(repo, { ...raysIncoming, openDate: null });

    expect(result).toEqual(existing);
  });

  it('(b) does NOT match when the candidate has NO corroborating key (open_date and price differ)', async () => {
    const existing = makeIpo({
      id: 'row-rays',
      companyName: 'Rays of Belief Limited- For Profit Social Enterprise',
      openDate: '2026-09-15',
      priceRangeMin: 999,
    } as Partial<IPO>);
    const repo = makeRepo({
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([existing]),
    });

    const result = await resolveIpoRow(repo, raysIncoming);

    expect(result).toBeNull();
  });

  it('(c) declines to match when two candidates BOTH corroborate (ambiguous)', async () => {
    const candidateA = makeIpo({
      id: 'row-A',
      companyName: 'Rays of Belief Limited- For Profit Social Enterprise',
      openDate: '2026-09-01',
    } as Partial<IPO>);
    const candidateB = makeIpo({
      id: 'row-B',
      companyName: 'Rays of Belief Limited- Another Branch',
      priceRangeMin: 227,
    } as Partial<IPO>);
    const repo = makeRepo({
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([candidateA, candidateB]),
    });

    const { logger } = await import('../logger');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);

    const result = await resolveIpoRow(repo, raysIncoming);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ candidateIds: ['row-A', 'row-B'] }),
      expect.stringContaining('[W-108]')
    );

    warnSpy.mockRestore();
  });

  it('(d) a genuinely different company sharing a prefix does not match, even with corroboration, when the repo read correctly excludes it', async () => {
    // "Rays of Hope Limited" is NOT a word-boundary prefix match of
    // "Rays of Belief Limited" (they diverge at "belief" vs "hope") — the
    // real IPORepository.findByNormalizedNamePrefix would never return it
    // as a candidate. This test locks that resolveIpoRow trusts the repo's
    // candidate set and applies ONLY the corroboration/ambiguity rules on
    // top of it, so an empty candidate list (the correct real-world result
    // for two different companies) falls through to "no match".
    const repo = makeRepo({
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([]),
    });

    const result = await resolveIpoRow(repo, raysIncoming);

    expect(result).toBeNull();
    expect(repo.findBySlug).toHaveBeenCalled(); // falls through to tier 4
  });

  it('a fuzzy-tier-catchable typo pair is unaffected: tier 3b is skipped when tier 3 (exact/compact name) already hit', async () => {
    const existing = makeIpo({ id: 'row-1', companyName: 'Acme Ltd' });
    const repo = makeRepo({ findByNormalizedName: vi.fn().mockResolvedValue(existing) });

    const result = await resolveIpoRow(repo, baseIdentity);

    expect(result).toEqual(existing);
    expect(repo.findByNormalizedNamePrefix).not.toHaveBeenCalled();
  });

  it('a tier 3b lookup failure is non-fatal and resolution falls through to the remaining tiers', async () => {
    const existing = makeIpo({ id: 'row-slug' });
    const repo = makeRepo({
      findByNormalizedNamePrefix: vi.fn().mockRejectedValue(new Error('connection reset')),
      findBySlug: vi.fn().mockResolvedValue(existing),
    });

    const result = await resolveIpoRow(repo, raysIncoming);

    expect(result).toEqual(existing);
  });

  // W-108b: openDate corroboration must be type-safe across the shapes a
  // live caller can hand in (a JS Date object) and the shapes a candidate
  // row can carry (a bare YYYY-MM-DD string) — same calendar day, either
  // representation, must corroborate.
  it('(e) matches when the candidate row is a Date object and the incoming openDate is a bare date string', async () => {
    const existing = makeIpo({
      id: 'row-rays',
      companyName: 'Rays of Belief Limited- For Profit Social Enterprise',
      openDate: new Date('2026-09-01T00:00:00.000Z') as unknown as string,
      priceRangeMin: null,
    } as Partial<IPO>);
    const repo = makeRepo({
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([existing]),
    });

    const result = await resolveIpoRow(repo, { ...raysIncoming, openDate: '2026-09-01', priceRangeMin: null });

    expect(result).toEqual(existing);
  });

  // W-108b: an ISO datetime string and a bare date string that name the
  // same UTC calendar day must corroborate — this is the codebase's
  // UTC-date convention (see the module doc comment), not a coincidence.
  it('(f) matches when one side is an ISO datetime string and the other a bare date string naming the same UTC day', async () => {
    const existing = makeIpo({
      id: 'row-rays',
      companyName: 'Rays of Belief Limited- For Profit Social Enterprise',
      openDate: '2026-09-01T18:30:00.000Z',
      priceRangeMin: null,
    } as Partial<IPO>);
    const repo = makeRepo({
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([existing]),
    });

    const result = await resolveIpoRow(repo, { ...raysIncoming, openDate: '2026-09-01', priceRangeMin: null });

    expect(result).toEqual(existing);
  });
});

// T-403 Tier-A review item 2: a WHITESPACE-separated extension ("Rays of
// Belief Limited" -> "Rays of Belief Limited Holdings") is a weaker signal
// than a punctuation-separated one — "Holdings" reads as a different legal
// entity, not the same company under a longer name — so it needs BOTH
// corroborating keys, not either.
describe('resolveIpoRow — tier 3b: whitespace-boundary extensions require BOTH corroborating keys (T-403 item 2)', () => {
  const raysIncomingWhitespace: IpoIdentity = {
    companyName: 'Rays of Belief Limited',
    normalizedName: 'rays of belief',
    slug: 'rays-of-belief-ltd',
    isin: null,
    symbol: null,
    openDate: '2026-09-01',
    priceRangeMin: 227,
  };

  it('matches when BOTH open_date AND price_range_min corroborate a whitespace-boundary extension', async () => {
    const existing = makeIpo({
      id: 'row-holdings',
      companyName: 'Rays of Belief Limited Holdings',
      openDate: '2026-09-01',
      priceRangeMin: 227,
    } as Partial<IPO>);
    const repo = makeRepo({
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([existing]),
    });

    const result = await resolveIpoRow(repo, raysIncomingWhitespace);

    expect(result).toEqual(existing);
  });

  it('does NOT match a whitespace-boundary extension when only ONE key corroborates (a different legal entity)', async () => {
    const existing = makeIpo({
      id: 'row-holdings',
      companyName: 'Rays of Belief Limited Holdings',
      openDate: '2026-09-01', // matches
      priceRangeMin: 999, // does NOT match
    } as Partial<IPO>);
    const repo = makeRepo({
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([existing]),
    });

    const result = await resolveIpoRow(repo, raysIncomingWhitespace);

    expect(result).toBeNull();
  });
});

// T-403 Tier-A review item 3: an SME and a MAINBOARD offering of the same
// name (or a shared name prefix) must never merge on a shared corroborating
// key alone — they are different listings.
describe('resolveIpoRow — segment guard (T-403 item 3)', () => {
  it('declines a tier 3 (exact normalized-name) match when segments disagree', async () => {
    const smeExisting = makeIpo({ id: 'row-sme', companyName: 'Acme Ltd', segment: 'SME' } as Partial<IPO>);
    const repo = makeRepo({
      findByNormalizedName: vi.fn().mockResolvedValue(smeExisting),
    });

    const result = await resolveIpoRow(repo, { ...baseIdentity, segment: 'MAINBOARD' });

    expect(result).toBeNull();
  });

  it('accepts a tier 3 match when segments agree', async () => {
    const smeExisting = makeIpo({ id: 'row-sme', companyName: 'Acme Ltd', segment: 'SME' } as Partial<IPO>);
    const repo = makeRepo({
      findByNormalizedName: vi.fn().mockResolvedValue(smeExisting),
    });

    const result = await resolveIpoRow(repo, { ...baseIdentity, segment: 'SME' });

    expect(result).toEqual(smeExisting);
  });

  it('accepts a tier 3 match when the incoming identity has no segment opinion (never excludes on missing info)', async () => {
    const smeExisting = makeIpo({ id: 'row-sme', companyName: 'Acme Ltd', segment: 'SME' } as Partial<IPO>);
    const repo = makeRepo({
      findByNormalizedName: vi.fn().mockResolvedValue(smeExisting),
    });

    const result = await resolveIpoRow(repo, { ...baseIdentity, segment: null });

    expect(result).toEqual(smeExisting);
  });

  it('excludes a segment-mismatched candidate from tier 3b corroboration, even though it would otherwise corroborate', async () => {
    const raysIncoming: IpoIdentity = {
      companyName: 'Rays of Belief Limited',
      normalizedName: 'rays of belief',
      slug: 'rays-of-belief-ltd',
      isin: null,
      symbol: null,
      openDate: '2026-09-01',
      priceRangeMin: 227,
      segment: 'MAINBOARD',
    };
    const wrongSegment = makeIpo({
      id: 'row-sme',
      companyName: 'Rays of Belief Limited- For Profit Social Enterprise',
      openDate: '2026-09-01',
      priceRangeMin: 227,
      segment: 'SME',
    } as Partial<IPO>);
    const repo = makeRepo({
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([wrongSegment]),
    });

    const result = await resolveIpoRow(repo, raysIncoming);

    expect(result).toBeNull();
  });
});

// T-403 Tier-A review item 4: when the key tier (isin/symbol) and the name
// tier disagree, WHICH row wins now depends on how weak the name match is.
describe('resolveIpoRow — key/name conflict resolution by name-match tier (T-403 item 4)', () => {
  it('prefers the KEY match over a tier 3b (prefix + corroboration) name match', async () => {
    const keyRow = makeIpo({ id: 'row-key', companyName: 'Rays of Belief Ltd', isin: 'INE123A01011' });
    const tier3bRow = makeIpo({
      id: 'row-3b',
      companyName: 'Rays of Belief Limited- For Profit Social Enterprise',
      openDate: '2026-09-01',
      priceRangeMin: 227,
    } as Partial<IPO>);
    const repo = makeRepo({
      findByIsin: vi.fn().mockResolvedValue(keyRow),
      findByNormalizedNamePrefix: vi.fn().mockResolvedValue([tier3bRow]),
    });

    const { logger } = await import('../logger');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);

    const result = await resolveIpoRow(repo, {
      companyName: 'Rays of Belief Limited',
      normalizedName: 'rays of belief',
      slug: 'rays-of-belief-ltd',
      isin: 'INE123A01011',
      openDate: '2026-09-01',
      priceRangeMin: 227,
    });

    expect(result).toEqual(keyRow); // key match wins — tier 3b is the weaker signal
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ keyMatchId: 'row-key', nameMatchId: 'row-3b', resolution: 'key-match' }),
      expect.stringContaining('identity_conflict')
    );

    warnSpy.mockRestore();
  });

  it('still prefers the NAME match (tier 3, exact) over the key match — pre-T-318 behavior unchanged', async () => {
    // Regression lock for the order the OTHER way round: an exact-name (tier
    // 3) conflict is NOT downgraded by T-403 item 4 — only tier 3b is.
    const keyRow = makeIpo({ id: 'row-A', companyName: 'Acme Ltd', isin: 'INE123A01011' });
    const exactNameRow = makeIpo({ id: 'row-B', companyName: 'Acme Limited', slug: 'acme-ltd' });
    const repo = makeRepo({
      findByIsin: vi.fn().mockResolvedValue(keyRow),
      findByNormalizedName: vi.fn().mockResolvedValue(exactNameRow),
    });

    const { logger } = await import('../logger');
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);

    const result = await resolveIpoRow(repo, { ...baseIdentity, isin: 'INE123A01011' });

    expect(result).toEqual(exactNameRow);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: 'name-match' }),
      expect.stringContaining('identity_conflict')
    );

    warnSpy.mockRestore();
  });
});

describe('resolveIpoRow — existing behavior preserved (regression coverage)', () => {
  it('normalizedName tier still resolves when no key present', async () => {
    const existing = makeIpo({ id: 'row-1' });
    const repo = makeRepo({ findByNormalizedName: vi.fn().mockResolvedValue(existing) });

    const result = await resolveIpoRow(repo, baseIdentity);

    expect(result).toEqual(existing);
  });

  it('slug tier still resolves when normalizedName misses', async () => {
    const existing = makeIpo({ id: 'row-1' });
    const repo = makeRepo({ findBySlug: vi.fn().mockResolvedValue(existing) });

    const result = await resolveIpoRow(repo, baseIdentity);

    expect(result).toEqual(existing);
  });

  it('fuzzy tier still resolves when all exact tiers miss', async () => {
    const existing = makeIpo({ id: 'row-1', companyName: 'Acme Hybird Ltd' });
    const repo = makeRepo({ findByFuzzyName: vi.fn().mockResolvedValue(existing) });

    const result = await resolveIpoRow(repo, baseIdentity);

    expect(result).toEqual(existing);
  });

  it('returns null when every tier misses', async () => {
    const repo = makeRepo();
    const result = await resolveIpoRow(repo, baseIdentity);

    expect(result).toBeNull();
  });

  it('a fuzzy-match failure is non-fatal and resolution falls through to null', async () => {
    const repo = makeRepo({
      findByFuzzyName: vi.fn().mockRejectedValue(new Error('connection reset')),
    });

    const result = await resolveIpoRow(repo, baseIdentity);

    expect(result).toBeNull();
  });
});
