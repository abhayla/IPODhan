/**
 * T-318 (IDENT — NULL-safe key-first identity resolution) tests.
 *
 * Covers the priority-order rewrite of resolveIpoRow: isin -> nse symbol
 * (own keyspace, never bse_scrip_code) -> normalizedName -> slug -> fuzzy.
 * Binding constraints under test (per this task's contract / T-314C /
 * T-316C findings): NULL is never a key value.
 *
 * T-339 (item 2) UPDATED the disagreement contract: a key-tier hit that
 * disagrees with the name tier no longer "falls back to the name-based row"
 * (which still WROTE, on the weaker tier's row) — it throws
 * IdentityQuarantineError so nothing is written at all. The fixtures below
 * cover BOTH disagreement directions (ISIN-key vs name, SYMBOL-key vs name)
 * plus the no-disagreement control.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveIpoRow, IdentityQuarantineError, isIdentityQuarantineError, type IpoIdentity } from './ipo-identity';
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

describe('resolveIpoRow — identity quarantine on key-vs-name disagreement (T-339 item 2)', () => {
  // Direction 1: the ISIN key tier resolves row A, the name tier resolves row B.
  it('ISIN key match (row A) vs name match (row B) -> throws IdentityQuarantineError, writes nothing', async () => {
    const rowA = makeIpo({ id: 'row-A', companyName: 'Acme Ltd', isin: 'INE123A01011' });
    const rowB = makeIpo({ id: 'row-B', companyName: 'Acme Limited', slug: 'acme-ltd' });
    const repo = makeRepo({
      findByIsin: vi.fn().mockResolvedValue(rowA),
      findByNormalizedName: vi.fn().mockResolvedValue(rowB),
    });

    const { logger } = await import('../logger');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as any);

    await expect(
      resolveIpoRow(repo, { ...baseIdentity, isin: 'INE123A01011' })
    ).rejects.toBeInstanceOf(IdentityQuarantineError);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ keyTier: 'ISIN', keyMatchId: 'row-A', nameMatchId: 'row-B' }),
      expect.stringContaining('identity_quarantine')
    );

    errorSpy.mockRestore();
  });

  it('the thrown error carries BOTH candidate ids, the key tier and the raw key values', async () => {
    const rowA = makeIpo({ id: 'row-A', companyName: 'Acme Ltd', isin: 'INE123A01011' });
    const rowB = makeIpo({ id: 'row-B', companyName: 'Acme Limited' });
    const repo = makeRepo({
      findByIsin: vi.fn().mockResolvedValue(rowA),
      findByNormalizedName: vi.fn().mockResolvedValue(rowB),
    });

    const { logger } = await import('../logger');
    vi.spyOn(logger, 'error').mockImplementation(() => undefined as any);

    const err = await resolveIpoRow(repo, { ...baseIdentity, isin: 'INE123A01011' }).catch((e) => e);

    expect(isIdentityQuarantineError(err)).toBe(true);
    expect(err.keyMatchId).toBe('row-A');
    expect(err.keyMatchCompanyName).toBe('Acme Ltd');
    expect(err.nameMatchId).toBe('row-B');
    expect(err.nameMatchCompanyName).toBe('Acme Limited');
    expect(err.keyTier).toBe('ISIN');
    expect(err.isin).toBe('INE123A01011');
    expect(err.symbol).toBeNull();
    expect(err.companyName).toBe('Acme Ltd');
  });

  // Direction 2: no ISIN at all — the SYMBOL key tier is the one that disagrees.
  it('SYMBOL key match (row C) vs name match (row D) -> throws, and reports keyTier SYMBOL', async () => {
    const rowC = makeIpo({ id: 'row-C', companyName: 'Acme Industries', symbol: 'ACME' });
    const rowD = makeIpo({ id: 'row-D', companyName: 'Acme Ltd' });
    const repo = makeRepo({
      findBySymbol: vi.fn().mockResolvedValue(rowC),
      findByNormalizedName: vi.fn().mockResolvedValue(rowD),
    });

    const { logger } = await import('../logger');
    vi.spyOn(logger, 'error').mockImplementation(() => undefined as any);

    const err = await resolveIpoRow(repo, { ...baseIdentity, isin: null, symbol: 'ACME' }).catch((e) => e);

    expect(isIdentityQuarantineError(err)).toBe(true);
    expect(err.keyTier).toBe('SYMBOL');
    expect(err.symbol).toBe('ACME');
    expect(err.keyMatchId).toBe('row-C');
    expect(err.nameMatchId).toBe('row-D');
  });

  it('also throws when the disagreeing name row came from the SLUG tier, not normalizedName', async () => {
    const rowA = makeIpo({ id: 'row-A', isin: 'INE123A01011' });
    const rowB = makeIpo({ id: 'row-B', slug: 'acme-ltd' });
    const repo = makeRepo({
      findByIsin: vi.fn().mockResolvedValue(rowA),
      findBySlug: vi.fn().mockResolvedValue(rowB),
    });

    const { logger } = await import('../logger');
    vi.spyOn(logger, 'error').mockImplementation(() => undefined as any);

    await expect(
      resolveIpoRow(repo, { ...baseIdentity, isin: 'INE123A01011' })
    ).rejects.toBeInstanceOf(IdentityQuarantineError);
  });

  // CONTROL: agreement must stay on the happy path — no throw, no error log.
  it('CONTROL: key match and name match on the SAME row -> resolves normally, no throw, no error log', async () => {
    const sameRow = makeIpo({ id: 'row-1', isin: 'INE123A01011' });
    const repo = makeRepo({
      findByIsin: vi.fn().mockResolvedValue(sameRow),
      findByNormalizedName: vi.fn().mockResolvedValue(sameRow),
    });

    const { logger } = await import('../logger');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as any);

    const result = await resolveIpoRow(repo, { ...baseIdentity, isin: 'INE123A01011' });

    expect(result).toEqual(sameRow);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('CONTROL: a key hit with NO name hit resolves to the key row (key beats name), no throw', async () => {
    const rowA = makeIpo({ id: 'row-A', isin: 'INE123A01011' });
    const repo = makeRepo({ findByIsin: vi.fn().mockResolvedValue(rowA) });

    const result = await resolveIpoRow(repo, { ...baseIdentity, isin: 'INE123A01011' });

    expect(result).toEqual(rowA);
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
