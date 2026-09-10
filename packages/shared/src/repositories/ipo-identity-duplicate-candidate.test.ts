import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveIpoRow, type IpoIdentity } from './ipo-identity';
import type { IPORepository } from './ipo-repository';
import type { IPO } from './types';
import { logger } from '../logger';

/**
 * Item 12 slice D part 1 — duplicate candidates at identity time.
 *
 * FLAG-GATED and OBSERVE-ONLY. It never merges, never writes, and never changes
 * which row `resolveIpoRow` returns. It logs that two live rows look like one
 * company so a human can decide.
 *
 * Sized before it was built (read-only, both slots): staging has 13 candidate
 * groups over ~30 rows; production has ZERO among 333 live rows. On prod this is
 * PREVENTIVE — anyone reading only a prod run would wrongly conclude it does
 * nothing, and anyone reading only staging would think the estate is full of
 * duplicates. Both readings are wrong.
 *
 * The scan is filtered by open_date rather than walking every live row: a
 * same-day query returns a handful of rows, where a full live scan would cost an
 * O(n) fold on EVERY identity resolution.
 */
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
    findByNormalizedNamePrefix: vi.fn().mockResolvedValue([]),
    findBySlug: vi.fn().mockResolvedValue(null),
    findByFuzzyName: vi.fn().mockResolvedValue(null),
    findLiveByOpenDate: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as IPORepository;
}

const FLAG = 'ENABLE_DISCOVERY_DUPLICATE_CHECK';
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never);
});
afterEach(() => {
  delete process.env[FLAG];
  warnSpy.mockRestore();
});

const arcilA = makeIpo({
  id: 'a',
  companyName: 'ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED',
  slug: 'arcil-a',
});
const arcilB = makeIpo({
  id: 'b',
  companyName: 'Asset Reconstruction Co.(India) Ltd.',
  slug: 'arcil-b',
});

const identity: IpoIdentity = {
  companyName: 'ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED',
  normalizedName: 'asset reconstruction india',
  slug: 'arcil-a',
  openDate: '2026-09-09',
};

const dupCalls = () =>
  warnSpy.mock.calls.filter((c) => String(c[1] ?? '').includes('duplicate_candidate'));

describe('duplicate candidate at discovery — OFF by default', () => {
  it('does not even query when the flag is unset', async () => {
    const repo = makeRepo({ findByNormalizedName: vi.fn().mockResolvedValue(arcilA) });
    await resolveIpoRow(repo, identity);
    expect((repo as any).findLiveByOpenDate).not.toHaveBeenCalled();
  });

  it('stays OFF in staging — DEPLOY_SLOT must not turn it on', async () => {
    // slotAwareFlagDefault() returns true in staging when unset. This flag must
    // NOT use it: the card says default false in EVERY slot, and an
    // observe-only feature that silently switches itself on in one slot is how
    // a "why is this logging" mystery starts.
    const prev = process.env.DEPLOY_SLOT;
    process.env.DEPLOY_SLOT = 'staging';
    try {
      const repo = makeRepo({ findByNormalizedName: vi.fn().mockResolvedValue(arcilA) });
      await resolveIpoRow(repo, identity);
      expect((repo as any).findLiveByOpenDate).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env.DEPLOY_SLOT;
      else process.env.DEPLOY_SLOT = prev;
    }
  });
});

describe('duplicate candidate at discovery — flag ON', () => {
  beforeEach(() => {
    process.env[FLAG] = 'true';
  });

  it('logs ONE duplicate_candidate naming BOTH slugs', async () => {
    const repo = makeRepo({
      findByNormalizedName: vi.fn().mockResolvedValue(arcilA),
      findLiveByOpenDate: vi.fn().mockResolvedValue([arcilA, arcilB]),
    });
    await resolveIpoRow(repo, identity);
    expect(dupCalls()).toHaveLength(1);
    const payload = dupCalls()[0][0] as Record<string, unknown>;
    expect(payload.slugs).toEqual(expect.arrayContaining(['arcil-a', 'arcil-b']));
  });

  it('RETURNS THE SAME ROW as with the flag off — observe-only', async () => {
    const on = makeRepo({
      findByNormalizedName: vi.fn().mockResolvedValue(arcilA),
      findLiveByOpenDate: vi.fn().mockResolvedValue([arcilA, arcilB]),
    });
    const resultOn = await resolveIpoRow(on, identity);
    delete process.env[FLAG];
    const off = makeRepo({ findByNormalizedName: vi.fn().mockResolvedValue(arcilA) });
    const resultOff = await resolveIpoRow(off, identity);
    expect(resultOn).toEqual(resultOff);
  });

  it('does NOT log when only one live row shares the date', async () => {
    const repo = makeRepo({
      findByNormalizedName: vi.fn().mockResolvedValue(arcilA),
      findLiveByOpenDate: vi.fn().mockResolvedValue([arcilA]),
    });
    await resolveIpoRow(repo, identity);
    expect(dupCalls()).toHaveLength(0);
  });

  it('does NOT log two different companies that merely share a date', async () => {
    const sun = makeIpo({ id: 's', companyName: 'Sun Pharmaceutical Industries Ltd', slug: 'sun' });
    const sunrise = makeIpo({
      id: 'r',
      companyName: 'Sunrise Pharmaceutical Industries Ltd',
      slug: 'sunrise',
    });
    const repo = makeRepo({
      findByNormalizedName: vi.fn().mockResolvedValue(sun),
      findLiveByOpenDate: vi.fn().mockResolvedValue([sun, sunrise]),
    });
    await resolveIpoRow(repo, {
      ...identity,
      companyName: 'Sun Pharmaceutical Industries Ltd',
      normalizedName: 'sun pharmaceutical industries',
      slug: 'sun',
    });
    expect(dupCalls()).toHaveLength(0);
  });

  it('skips the scan when the identity has no open date', async () => {
    const repo = makeRepo({ findByNormalizedName: vi.fn().mockResolvedValue(arcilA) });
    const { openDate, ...noDate } = identity;
    await resolveIpoRow(repo, noDate);
    expect((repo as any).findLiveByOpenDate).not.toHaveBeenCalled();
  });

  it('a THROWING scan never breaks identity resolution', async () => {
    // The single most important guard: this feature only OBSERVES, so a fault
    // inside it must never propagate into the resolution every scraper write
    // depends on.
    const repo = makeRepo({
      findByNormalizedName: vi.fn().mockResolvedValue(arcilA),
      findLiveByOpenDate: vi.fn().mockRejectedValue(new Error('boom')),
    });
    expect(await resolveIpoRow(repo, identity)).toEqual(arcilA);
  });

  it('a repository WITHOUT findLiveByOpenDate is tolerated', async () => {
    const repo = makeRepo({ findByNormalizedName: vi.fn().mockResolvedValue(arcilA) });
    delete (repo as any).findLiveByOpenDate;
    expect(await resolveIpoRow(repo, identity)).toEqual(arcilA);
  });
});
