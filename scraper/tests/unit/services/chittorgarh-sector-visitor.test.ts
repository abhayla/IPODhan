import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * T-507/#394: the failing-test-first proof that the LIVE cycle path — not
 * just the pure extractor — writes ipos.sector. Drives the real
 * `runSectorVisit` orchestrator function against a REAL captured Chittorgarh
 * detail-page fixture (Ather Energy, `historical/ather-cg-detail.html`, same
 * fixture the extractor unit test uses), with only the DB query, the
 * discovery-map builder, and the network fetch mocked. Before this task
 * wired the write, `upsertIpoSector` had zero callers anywhere in the live
 * cycle (verified by repo-wide grep) — this test is red on that baseline and
 * green once `chittorgarh-orchestrator-v2.ts` calls `runSectorVisit()` after
 * the bulk scrape.
 *
 * RCA correction recorded here too: an earlier version of this visitor built
 * the detail URL from a slugified company name alone
 * (`https://www.chittorgarh.com/ipo/<slug>/`) — verified LIVE to 404 for
 * every company tried, Ather Energy included. The fix resolves slug+id from
 * Chittorgarh's own report-82 discovery feed first (`chittorgarh-detail-
 * url-resolver.ts`); this test mocks that resolver rather than a bare
 * slugifier so a future regression back to the guessed-slug shape fails it.
 */

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/historical/ather-cg-detail.html'
);

const { mockUpsert } = vi.hoisted(() => ({ mockUpsert: vi.fn() }));

vi.mock('@ipodhan/shared', () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => [{ ipoId: 'ipo-ather-1', companyName: 'Ather Energy' }],
  };
  return { db: chain };
});

vi.mock('@ipodhan/shared/db/schema', () => ({
  ipos: { id: 'ipos.id', companyName: 'ipos.company_name', sector: 'ipos.sector', updatedAt: 'ipos.updated_at' },
}));

vi.mock('@ipodhan/shared/utils/company-name-normalizer', () => ({
  normalizeCompanyNameForMatching: (s: string) => s.toLowerCase().trim(),
}));

vi.mock('../../../src/services/data-persister.js', () => ({
  upsertIpoSector: mockUpsert,
}));

const { mockBuildDiscoveryMap } = vi.hoisted(() => ({ mockBuildDiscoveryMap: vi.fn() }));

vi.mock('../../../src/services/chittorgarh-detail-url-resolver.js', () => ({
  buildChittorgarhDiscoveryMap: mockBuildDiscoveryMap,
  buildChittorgarhDetailUrlFromRef: (ref: { slug: string; id: string }) =>
    `https://www.chittorgarh.com/ipo/${ref.slug}/${ref.id}/`,
  currentFiscalYear: () => ({ year: 2025, range: '2025-26' }),
}));

import { runSectorVisit } from '../../../src/services/chittorgarh-sector-visitor.js';

describe('runSectorVisit (live-cycle orchestrator path, real fixture)', () => {
  const fixtureHtml = readFileSync(FIXTURE_PATH, 'utf-8');
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue(true);
    mockBuildDiscoveryMap.mockReset();
    mockBuildDiscoveryMap.mockResolvedValue(new Map([['ather energy', { slug: 'ather-energy-ipo', id: '2357' }]]));
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixtureHtml,
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resolves the candidate via the discovery map, fetches the slug+id detail URL ONCE, and upserts ipos.sector', async () => {
    const summary = await runSectorVisit(1);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://www.chittorgarh.com/ipo/ather-energy-ipo/2357/',
      expect.any(Object)
    );
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith('ipo-ather-1', 'Automobiles');
    expect(summary).toEqual({ candidates: 1, matched: 1, fetched: 1, extracted: 1, written: 1, fetchErrors: 0 });
  });

  it('never calls fetch/write for a candidate the discovery map has no entry for', async () => {
    mockBuildDiscoveryMap.mockResolvedValue(new Map());
    const summary = await runSectorVisit(1);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(summary).toEqual({ candidates: 1, matched: 0, fetched: 0, extracted: 0, written: 0, fetchErrors: 0 });
  });

  it('skips the write (no-op) when the page yields no recognizable sector', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '<p>no sector heading</p>' }) as unknown as typeof fetch;
    const summary = await runSectorVisit(1);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(summary.extracted).toBe(0);
    expect(summary.written).toBe(0);
  });

  it('never throws when the detail-page fetch fails — logs and continues', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(runSectorVisit(1)).resolves.toMatchObject({ fetchErrors: 1, written: 0 });
  });

  it('never throws when the discovery map build fails — logs and continues', async () => {
    mockBuildDiscoveryMap.mockRejectedValue(new Error('report 82 down'));
    await expect(runSectorVisit(1)).resolves.toMatchObject({ candidates: 1, matched: 0, written: 0 });
  });
});
