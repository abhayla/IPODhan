// implements: R-158
/**
 * Item 1 slice s1 (row-key prep, F-74): `createPeerCompanies` in
 * `data-persister.ts` is the Moneycontrol peer-company write path — a
 * SEPARATE write site from the filing-persister peer_companies path already
 * covered by `filing-persister-normalized-name.test.ts`. Tier A review
 * (round 1) found the reviewer could delete the `normalizedName:` assignment
 * at this specific site and the entire scraper suite (259 files, 3284 tests)
 * stayed green — no test anywhere referenced `createPeerCompanies`. This
 * file closes that gap.
 */
import { describe, it, expect, vi } from 'vitest';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { createPeerCompanies } from '../../../src/services/data-persister.js';
import type { PeerCompanyRepository } from '../../../src/repositories/peer-company-repository.js';
import type { ScrapedPeerCompany } from '../../../src/scrapers/peer-companies-scraper.js';

function makeScrapedPeers(): ScrapedPeerCompany[] {
  return [
    {
      companyName: 'Alpha Industries Limited',
      symbol: 'ALPHA',
      sector: 'Manufacturing',
      isListed: true,
      peRatio: 18.2,
      eps: 12.5,
      dilutedEps: 12.1,
      ronw: 15.4,
      nav: 88.2,
      pbvRatio: 2.1,
      dataSource: 'MONEYCONTROL',
    },
    {
      companyName: 'Beta Enterprises Pvt Ltd',
      symbol: 'BETA',
      sector: 'Manufacturing',
      isListed: true,
      peRatio: 22.0,
      eps: 9.0,
      dilutedEps: 8.8,
      ronw: 11.0,
      nav: 60.0,
      pbvRatio: 1.7,
      dataSource: 'MONEYCONTROL',
    },
  ];
}

function makeRepo() {
  const deleteByIPOId = vi.fn(async () => 0);
  const batchCreate = vi.fn(async (rows: Array<Record<string, unknown>>) =>
    rows.map((r, i) => ({ id: `peer-${i}`, ...r }))
  );
  const repo = { deleteByIPOId, batchCreate } as unknown as PeerCompanyRepository;
  return { repo, deleteByIPOId, batchCreate };
}

describe('createPeerCompanies (Moneycontrol path, data-persister.ts) — normalized_name on every row (R-158)', () => {
  it('every row handed to batchCreate carries a non-empty normalizedName derived from companyName', async () => {
    const { repo, batchCreate } = makeRepo();
    const scrapedPeers = makeScrapedPeers();

    await createPeerCompanies(repo, 'ipo-1', scrapedPeers);

    expect(batchCreate).toHaveBeenCalledTimes(1);
    const rows = batchCreate.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.normalizedName).toBe(
        normalizeCompanyNameForMatching(row.companyName as string)
      );
      expect(row.normalizedName).not.toBe('');
    }
  });

  it('a whitespace-only peer name has no identity: it is skipped, the other peer in the batch still writes (Tier A round-2)', async () => {
    const { repo, batchCreate } = makeRepo();
    const scrapedPeers = [...makeScrapedPeers(), { ...makeScrapedPeers()[0], companyName: '   ' }];

    const created = await createPeerCompanies(repo, 'ipo-1', scrapedPeers);

    expect(batchCreate).toHaveBeenCalledTimes(1);
    const rows = batchCreate.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    expect(created).toBe(2);
    expect(rows.every((r) => typeof r.companyName === 'string' && (r.companyName as string).trim() !== '')).toBe(
      true
    );
  });
});
