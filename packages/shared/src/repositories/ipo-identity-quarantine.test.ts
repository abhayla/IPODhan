/**
 * T-339 item 2 — identity: KEY BEATS NAME, and a disagreement is quarantined
 * rather than silently resolved.
 *
 * Before this task, `resolveIpoRow` handled a key-vs-name disagreement by
 * logging a structured `identity_conflict` warning and RETURNING THE NAME
 * MATCH (ipo-identity.ts:154-171). That is the worst of the three options:
 *
 *   - The natural key (ISIN, or the NSE/BSE symbol) is the higher-confidence
 *     identifier — a 12-character code unique to the security — and it was
 *     the one being discarded.
 *   - The write then proceeded against the name-matched row, so a scrape of
 *     company A could land on company B's row, with only a log line as
 *     evidence, and nothing that fails.
 *
 * T-339: on disagreement the row is NOT written. `resolveIpoRow` throws
 * `IdentityQuarantineError` carrying BOTH candidate ids, so no caller — the
 * live scraper guard, the consolidation write path, or any backfill script —
 * can proceed to a write. The caller that can record it (the scraper) writes a
 * quarantine row and pages the owner; every other caller simply fails loudly.
 *
 * Fixtures cover BOTH disagreement directions, because they are genuinely
 * different shapes: an ISIN pointing at a different row than the name, and a
 * SYMBOL pointing at a different row than the name (the symbol tier only fires
 * when the ISIN tier missed, which is the ~23%-keyless reality of this table).
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveIpoRow, resolveIpoIdentity, IdentityQuarantineError } from './ipo-identity';
import type { IpoIdentity } from './ipo-identity';
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

// ---- Direction 1: ISIN disagrees with the name ------------------------------
const isinRow = makeIpo({ id: 'row-by-isin', companyName: 'Acme Ltd', isin: 'INE123A01011' });
const nameRowForIsin = makeIpo({ id: 'row-by-name', companyName: 'Acme Limited', slug: 'acme-ltd' });

function isinDisagreementRepo() {
  return makeRepo({
    findByIsin: vi.fn().mockResolvedValue(isinRow),
    findByNormalizedName: vi.fn().mockResolvedValue(nameRowForIsin),
  });
}

// ---- Direction 2: SYMBOL disagrees with the name (no ISIN in play) ----------
const symbolRow = makeIpo({ id: 'row-by-symbol', companyName: 'Acme Ltd', symbol: 'ACME' });
const nameRowForSymbol = makeIpo({ id: 'row-by-name-2', companyName: 'Acme Industries', slug: 'acme-ltd' });

function symbolDisagreementRepo() {
  return makeRepo({
    findByIsin: vi.fn().mockResolvedValue(null),
    findBySymbol: vi.fn().mockResolvedValue(symbolRow),
    findByNormalizedName: vi.fn().mockResolvedValue(nameRowForSymbol),
  });
}

describe('T-339 (2a) — resolveIpoRow THROWS on a key-vs-name disagreement (no write can follow)', () => {
  it('direction 1 — ISIN row A vs name row B: throws IdentityQuarantineError, never returns row B', async () => {
    await expect(
      resolveIpoRow(isinDisagreementRepo(), { ...baseIdentity, isin: 'INE123A01011' })
    ).rejects.toThrow(IdentityQuarantineError);
  });

  it('direction 2 — SYMBOL row A vs name row B: throws IdentityQuarantineError, never returns row B', async () => {
    await expect(
      resolveIpoRow(symbolDisagreementRepo(), { ...baseIdentity, symbol: 'ACME' })
    ).rejects.toThrow(IdentityQuarantineError);
  });

  it('the error carries BOTH candidate ids and which tier produced each (direction 1)', async () => {
    let caught: IdentityQuarantineError | undefined;
    try {
      await resolveIpoRow(isinDisagreementRepo(), { ...baseIdentity, isin: 'INE123A01011' });
    } catch (e) {
      caught = e as IdentityQuarantineError;
    }
    expect(caught).toBeInstanceOf(IdentityQuarantineError);
    expect(caught!.keyMatchId).toBe('row-by-isin');
    expect(caught!.nameMatchId).toBe('row-by-name');
    expect(caught!.keyTier).toBe('isin');
    expect(caught!.keyValue).toBe('INE123A01011');
    expect(caught!.companyName).toBe('Acme Ltd');
  });

  it('the error carries BOTH candidate ids and the symbol tier (direction 2)', async () => {
    let caught: IdentityQuarantineError | undefined;
    try {
      await resolveIpoRow(symbolDisagreementRepo(), { ...baseIdentity, symbol: 'ACME' });
    } catch (e) {
      caught = e as IdentityQuarantineError;
    }
    expect(caught).toBeInstanceOf(IdentityQuarantineError);
    expect(caught!.keyMatchId).toBe('row-by-symbol');
    expect(caught!.nameMatchId).toBe('row-by-name-2');
    expect(caught!.keyTier).toBe('symbol');
    expect(caught!.keyValue).toBe('ACME');
  });
});

describe('T-339 (2b) — resolveIpoIdentity returns the disagreement instead of throwing', () => {
  it('reports outcome QUARANTINE with both candidates (direction 1)', async () => {
    const out = await resolveIpoIdentity(isinDisagreementRepo(), {
      ...baseIdentity,
      isin: 'INE123A01011',
    });
    expect(out.outcome).toBe('QUARANTINE');
    if (out.outcome !== 'QUARANTINE') throw new Error('unreachable');
    expect(out.keyMatch.id).toBe('row-by-isin');
    expect(out.nameMatch.id).toBe('row-by-name');
    expect(out.keyTier).toBe('isin');
  });

  it('reports outcome QUARANTINE with both candidates (direction 2)', async () => {
    const out = await resolveIpoIdentity(symbolDisagreementRepo(), {
      ...baseIdentity,
      symbol: 'ACME',
    });
    expect(out.outcome).toBe('QUARANTINE');
    if (out.outcome !== 'QUARANTINE') throw new Error('unreachable');
    expect(out.keyMatch.id).toBe('row-by-symbol');
    expect(out.nameMatch.id).toBe('row-by-name-2');
    expect(out.keyTier).toBe('symbol');
  });
});

describe('T-339 (2c) — key BEATS name everywhere else (negative controls)', () => {
  it('key hit + no name hit -> the key row wins, no quarantine', async () => {
    const repo = makeRepo({ findByIsin: vi.fn().mockResolvedValue(isinRow) });
    await expect(
      resolveIpoRow(repo, { ...baseIdentity, isin: 'INE123A01011' })
    ).resolves.toEqual(isinRow);
  });

  it('key and name agree on the SAME row -> that row, no quarantine', async () => {
    const same = makeIpo({ id: 'row-1', isin: 'INE123A01011' });
    const repo = makeRepo({
      findByIsin: vi.fn().mockResolvedValue(same),
      findByNormalizedName: vi.fn().mockResolvedValue(same),
    });
    await expect(
      resolveIpoRow(repo, { ...baseIdentity, isin: 'INE123A01011' })
    ).resolves.toEqual(same);
  });

  it('no key present -> the name tier is authoritative (the ~23% of keyless rows), no quarantine', async () => {
    const nameOnly = makeIpo({ id: 'keyless-row' });
    const repo = makeRepo({ findByNormalizedName: vi.fn().mockResolvedValue(nameOnly) });
    await expect(resolveIpoRow(repo, baseIdentity)).resolves.toEqual(nameOnly);
  });

  it('key present but no key hit -> the name tier is authoritative, no quarantine', async () => {
    const nameOnly = makeIpo({ id: 'name-row' });
    const repo = makeRepo({ findByNormalizedName: vi.fn().mockResolvedValue(nameOnly) });
    await expect(
      resolveIpoRow(repo, { ...baseIdentity, isin: 'INE999Z01011' })
    ).resolves.toEqual(nameOnly);
  });

  it('nothing matches at all -> null (a create), no quarantine', async () => {
    await expect(resolveIpoRow(makeRepo(), baseIdentity)).resolves.toBeNull();
  });
});
