import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * #222: the failing-test-first proof that the LIVE cycle path — not just the
 * pure extractor — writes ipo_details.issue_type. Drives the real
 * `runIssueTypeVisit` orchestrator function against a REAL captured
 * Chittorgarh detail-page fixture (Ather Energy, `historical/ather-cg-detail.html`,
 * same fixture the extractor unit test uses), with only the DB query and the
 * network fetch mocked. Before this task wired the write, `upsertIpoDetailsIssueType`
 * had zero callers anywhere in the live cycle (verified by repo-wide grep) —
 * this test is red on that baseline and green once `chittorgarh-orchestrator-v2.ts`
 * calls `runIssueTypeVisit()` after the bulk scrape.
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
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => [{ ipoId: 'ipo-ather-1', companyName: 'Ather Energy' }],
  };
  return { db: chain };
});

vi.mock('@ipodhan/shared/db/schema', () => ({
  ipos: { id: 'ipos.id', companyName: 'ipos.company_name', updatedAt: 'ipos.updated_at' },
  ipoDetails: { ipoId: 'ipo_details.ipo_id', issueType: 'ipo_details.issue_type' },
}));

vi.mock('../../../src/services/data-persister.js', () => ({
  upsertIpoDetailsIssueType: mockUpsert,
}));

import { runIssueTypeVisit, buildChittorgarhDetailUrl } from '../../../src/services/chittorgarh-issue-type-visitor.js';

describe('runIssueTypeVisit (live-cycle orchestrator path, real fixture)', () => {
  const fixtureHtml = readFileSync(FIXTURE_PATH, 'utf-8');
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue(true);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => fixtureHtml,
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('fetches the candidate IPO detail page ONCE and upserts ipo_details.issue_type via the real write function', async () => {
    const summary = await runIssueTypeVisit(1);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      buildChittorgarhDetailUrl('Ather Energy'),
      expect.any(Object)
    );
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith('ipo-ather-1', 'BOOK_BUILDING');
    expect(summary).toEqual({ candidates: 1, fetched: 1, extracted: 1, written: 1, fetchErrors: 0 });
  });

  it('never calls the extractor/write path more than once per candidate (1-fetch budget)', async () => {
    await runIssueTypeVisit(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('skips the write (no-op) when the page yields no recognizable issue type', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '<p>no issue type row</p>' }) as unknown as typeof fetch;
    const summary = await runIssueTypeVisit(1);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(summary.extracted).toBe(0);
    expect(summary.written).toBe(0);
  });

  it('never throws when the detail-page fetch fails — logs and continues', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(runIssueTypeVisit(1)).resolves.toMatchObject({ fetchErrors: 1, written: 0 });
  });
});

describe('buildChittorgarhDetailUrl', () => {
  it('slugifies the company name the same way ipo-reviews-aggregator.ts does', () => {
    expect(buildChittorgarhDetailUrl('Ather Energy')).toBe('https://www.chittorgarh.com/ipo/ather-energy/');
  });
});
