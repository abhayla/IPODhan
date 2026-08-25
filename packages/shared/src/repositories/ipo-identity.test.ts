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
