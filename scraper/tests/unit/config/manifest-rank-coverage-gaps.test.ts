// #884 detection (CI half): the manifest may not gain a rank the walk cannot ask.
// Today's gaps are committed as a SHRINK-ONLY baseline — fixing the ranks is
// spec/owner work — so a NEW gap fails here, and a fixed one must be removed.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('@ipodhan/shared', () => ({
  db: {},
  getRedisClient: () => ({}),
  IPORepository: vi.fn().mockImplementation(() => ({})),
  FieldSourcesRepository: vi.fn().mockImplementation(() => ({})),
  DataConflictsRepository: vi.fn().mockImplementation(() => ({})),
  DocumentRepository: vi.fn().mockImplementation(() => ({})),
}));
vi.mock('@ipodhan/shared/repositories/listing-performance-repository', () => ({
  ListingPerformanceRepository: vi.fn().mockImplementation(() => ({})),
}));

import { buildFieldPlanWalkFetchers } from '../../../src/services/field-plan-walk-deps.js';
import { BSE_SERVEABLE_FIELDS } from '../../../src/services/field-plan-walk-bse-fetcher.js';
import { NSE_SERVEABLE_FIELDS } from '../../../src/services/field-plan-walk-nse-fetcher.js';
import { CHITTORGARH_SERVEABLE_FIELDS } from '../../../src/services/field-plan-walk-chittorgarh-fetcher.js';
import { DOC_READABLE_TABLES } from '../../../src/services/field-plan-walk-doc-fetcher.js';
import { listManifestRankCoverageGaps } from '../../../src/config/manifest-rank-coverage-gaps.js';

const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MANIFEST = JSON.parse(readFileSync(path.join(SCRAPER_ROOT, 'config', 'field-manifest.json'), 'utf8'));
const BASELINE_PATH = path.join(SCRAPER_ROOT, 'config', 'manifest-rank-coverage-gaps.baseline.json');

function currentGaps(manifest = MANIFEST, registered = Object.keys(buildFieldPlanWalkFetchers({} as never))) {
  return listManifestRankCoverageGaps(manifest, registered, {
    BSE: BSE_SERVEABLE_FIELDS,
    NSE: new Set(NSE_SERVEABLE_FIELDS.keys()),
    CHITTORGARH: CHITTORGARH_SERVEABLE_FIELDS,
  }, DOC_READABLE_TABLES);
}

describe('manifest rank coverage gaps (#884, shrink-only baseline)', () => {
  if (process.env.WRITE_MANIFEST_GAP_BASELINE === '1') {
    writeFileSync(BASELINE_PATH, JSON.stringify({ issue: '#884', gaps: currentGaps() }, null, 2) + '\n');
  }
  const baseline: string[] = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).gaps;

  it('no NEW gap: every manifest rank the walk cannot ask is already in the baseline', () => {
    const added = currentGaps().filter((g) => !baseline.includes(g));
    expect(added, 'a manifest rank names a source the walk cannot ask for this field — map it, or fix the rank (spec)').toEqual([]);
  });

  it('shrink-only: a gap that no longer exists is removed from the baseline', () => {
    const now = new Set(currentGaps());
    const stale = baseline.filter((g) => !now.has(g));
    expect(stale, 'remove these fixed gaps from manifest-rank-coverage-gaps.baseline.json').toEqual([]);
  });

  it('detects each gap kind (mutation: a synthetic manifest must produce all four)', () => {
    const synthetic = {
      fields: {
        'ipos.isin': {
          documentType: null,
          rank: { MAINBOARD: ['DOC', 'CHITTORGARH', 'INVESTORGAIN_GMP'] },
          capability: { DOC: { capable: true }, CHITTORGARH: { capable: true } },
        },
        'ipos.issue_size': {
          documentType: 'RHP',
          rank: { MAINBOARD: ['DOC', 'CHITTORGARH', 'BSE'] },
          capability: { DOC: { capable: true }, CHITTORGARH: { capable: true }, BSE: { capable: false } },
        },
        'financial_statements.revenue': {
          documentType: 'RHP',
          rank: { MAINBOARD: ['DOC'] },
          capability: { DOC: { capable: true } },
        },
      },
    };
    expect(currentGaps(synthetic as never, ['DOC', 'CHITTORGARH', 'BSE', 'NSE'])).toEqual([
      'financial_statements.revenue DOC NO_COLUMN_READ',
      'ipos.isin CHITTORGARH NO_MAPPING',
      'ipos.isin DOC NO_DOCTYPE',
      'ipos.isin INVESTORGAIN_GMP NO_FETCHER',
    ]);
  });
});
