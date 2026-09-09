// implements: R-158
/**
 * Item 1 slice s1 (row-key prep, F-74, docs/design/build-cards/
 * item-01-child-table-consolidated-writer.md — Schema table). The future
 * row-key for `promoters` and `peer_companies` is `normalizeCompanyNameForMatching(name)`;
 * for `ipo_intermediaries` it is `role:normalizedName`. That composite key
 * cannot be computed, and the `(ipoId, normalizedName)` unique constraint
 * (slice s2) cannot be added, until every insert path for these three
 * tables populates a `normalizedName` column at write time — otherwise every
 * row minted between this slice and slice s2 lands with the empty-string
 * default and slice s2's constraint collides on the first IPO with more than
 * one promoter/peer/intermediary.
 *
 * RED on origin/main (before this slice): none of the three write paths
 * (`replacePromoters`, `intermediaries.replaceForIpo`,
 * `peerCompanies.batchCreate`) puts a `normalizedName` key on the row it
 * writes — asserted against the repository call's insert payload, not a
 * live DB (that column does not exist yet on origin/main), per the builder
 * brief for this slice.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';

vi.mock('../../../src/services/data-persister.js', () => ({
  upsertIPO: vi.fn(async () => 'ipo-id'),
}));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa9a93';

const ORACLE = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../../../docs/reviews/fixtures/deepa-jewellers-expected.json'),
    'utf8'
  )
) as Record<string, Record<string, unknown>>;

function extractionFromOracle(): FilingExtraction {
  const fields: FilingExtraction['fields'] = {};
  for (const [k, v] of Object.entries(ORACLE.PRICE_BAND_AD)) {
    if (k.startsWith('_')) continue;
    fields[k] = { value: v, page: 1, check: { name: `${k}_check`, passed: true } };
  }
  return {
    doc_type: 'PRICE_BAND_AD',
    source_doc: 'fixture.pdf',
    pages: 4,
    extraction_status: 'OK',
    unit: 'millions',
    fiscal_years: [2026, 2025, 2024],
    fields,
  };
}

function makeDeps() {
  const replacePromoters = vi.fn(async () => []);
  const replaceIntermediaries = vi.fn(async () => []);
  const peerDelete = vi.fn(async () => 0);
  const peerCreate = vi.fn(async () => []);
  const trackField = vi.fn(async () => ({}));

  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Deepa Jewellers Limited',
        slug: 'deepa-jewellers-ltd',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'OPEN',
        listingExchanges: ['NSE', 'BSE'],
        openDate: new Date('2026-09-01'),
        closeDate: new Date('2026-09-03'),
        registrar: 'Bigshare Services Private Limited',
        leadManagers: [
          'Emkay Global Financial Services Limited',
          'Valmiki Leela Capital Private Limited',
        ],
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: {
      replacePromoters,
      replaceAcquisitionRanges: vi.fn(async () => []),
    },
    intermediaries: { replaceForIpo: replaceIntermediaries },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { deleteByIPOId: peerDelete, batchCreate: peerCreate },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: {
      findByField: vi.fn(async () => null),
      trackFieldUpdate: trackField,
    },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
  } as unknown as FilingPersisterDeps;

  return { deps, replacePromoters, replaceIntermediaries, peerCreate };
}

describe('filing-persister — normalized_name on every child-table insert (item 1 slice s1, R-158)', () => {
  it('promoters: every row replacePromoters writes carries a non-empty normalizedName matching the normaliser', async () => {
    const s = makeDeps();
    await persistFilingExtraction(IPO_ID, extractionFromOracle(), { docType: 'PRICE_BAND_AD', apply: true }, s.deps);
    const rows = s.replacePromoters.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.normalizedName).toBe(normalizeCompanyNameForMatching(row.name as string));
      expect(row.normalizedName).not.toBe('');
    }
  });

  it('ipo_intermediaries: every row replaceForIpo writes carries a non-empty normalizedName matching the normaliser', async () => {
    const s = makeDeps();
    await persistFilingExtraction(IPO_ID, extractionFromOracle(), { docType: 'PRICE_BAND_AD', apply: true }, s.deps);
    const rows = s.replaceIntermediaries.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.normalizedName).toBe(normalizeCompanyNameForMatching(row.name as string));
      expect(row.normalizedName).not.toBe('');
    }
  });

  it('peer_companies: every row batchCreate writes carries a non-empty normalizedName matching the normaliser', async () => {
    const s = makeDeps();
    await persistFilingExtraction(IPO_ID, extractionFromOracle(), { docType: 'PRICE_BAND_AD', apply: true }, s.deps);
    const rows = s.peerCreate.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.normalizedName).toBe(normalizeCompanyNameForMatching(row.companyName as string));
      expect(row.normalizedName).not.toBe('');
    }
  });
});
