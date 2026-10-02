/**
 * Item 45 (OD-164(g), spec §2.5.6 item 7): the extractor-version re-read selection on the REAL
 * functions — version filter from EXTRACTOR_VERSION_CHANGES, purged files skipped (never retried),
 * soonest-purged first, and the out-of-window cap.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@ipodhan/shared', () => ({ db: { execute: vi.fn() } }));

import {
  selectRereadCandidates,
  orderForRereads,
  planRereadPasses,
  EXTRACTION_ONLY_PER_CYCLE,
  type StoredReadDocument,
  type RereadCandidate,
} from '../../../src/services/document-cycle.js';
import { EXTRACTOR_VERSION, EXTRACTOR_VERSION_CHANGES } from '../../../src/services/filing-auto-persist.js';

const NOW = new Date('2026-10-03T06:00:00Z');
const ipo = (id: string, closeDate: string | null, latestExtractedAt: string | null) => ({
  id, companyName: id, slug: id, segment: 'MAINBOARD', closeDate, latestExtractedAt,
});
const doc = (ipoId: string, type: string, recordedVersion: string | null, extra: Partial<StoredReadDocument> = {}): StoredReadDocument => ({
  ipoId, type, extractionStatus: 'COMPLETED', purgedUnread: false, sha256: `${ipoId}-${type}`.padEnd(64, '0'), recordedVersion, ...extra,
});
const onDisk = (present: Set<string>) => (ipoId: string, type: string) => present.has(`${ipoId}/${type}`);

describe('item 45: the @2026-10-03 bump', () => {
  it('re-opens the prospectus family and the price-band ad, and nothing else', () => {
    expect(EXTRACTOR_VERSION).toBe('extract_filing.py@2026-10-03');
    expect([...EXTRACTOR_VERSION_CHANGES[EXTRACTOR_VERSION]].sort()).toEqual(['DRHP', 'PRICE_BAND_AD', 'PROSPECTUS', 'RHP']);
  });
});

describe('item 45: selectRereadCandidates', () => {
  const ipos = [ipo('live', null, '2026-10-02T00:00:00Z'), ipo('nse', '2026-09-21', '2026-09-29T04:57:46Z')];
  const docs = new Map<string, StoredReadDocument[]>([
    ['live', [
      doc('live', 'RHP', 'extract_filing.py@2026-10-02'), // read before items 39/40/44/46: re-read
      doc('live', 'ANCHOR_ALLOCATION_REPORT', 'extract_filing.py@2026-09-03'), // not re-opened by this bump
    ]],
    ['nse', [
      doc('nse', 'DRHP', 'extract_filing.py@2026-09-27'),
      doc('nse', 'PRICE_BAND_AD', null), // never versioned: below every floor
    ]],
  ]);

  it('selects documents below the new floor whose file is on disk', () => {
    const { candidates, skippedNoFile } = selectRereadCandidates(ipos, docs, {
      now: NOW, retentionDays: 7, storeDir: '/s', hasStoredFile: onDisk(new Set(['live/RHP', 'nse/DRHP', 'nse/PRICE_BAND_AD'])),
    });
    expect(candidates.map((c) => c.id)).toEqual(['live', 'nse']);
    expect(skippedNoFile).toBe(0);
    // NSE closed 2026-09-21, last read 2026-09-29T04:57 -> purgeable 7 days later.
    expect(candidates[1].purgeDueAt?.toISOString()).toBe('2026-10-06T04:57:46.000Z');
    expect(candidates[0].purgeDueAt).toBeNull();
  });

  it('a document already at the new version is not selected', () => {
    const atNew = new Map([['live', [doc('live', 'RHP', EXTRACTOR_VERSION)]]]);
    const { candidates } = selectRereadCandidates([ipos[0]], atNew, { now: NOW, storeDir: '/s', hasStoredFile: () => true });
    expect(candidates).toEqual([]);
  });

  it('a purged file is skipped and counted, never selected (nothing to retry)', () => {
    const { candidates, skippedNoFile } = selectRereadCandidates(ipos, docs, {
      now: NOW, storeDir: '/s', hasStoredFile: onDisk(new Set(['live/RHP'])),
    });
    expect(candidates.map((c) => c.id)).toEqual(['live']);
    expect(skippedNoFile).toBe(2);
  });

  it('purged-unread, not COMPLETED and hashless rows are not re-reads', () => {
    const odd = new Map([['live', [
      doc('live', 'RHP', null, { purgedUnread: true }),
      doc('live', 'DRHP', null, { extractionStatus: 'PENDING' }),
      doc('live', 'PROSPECTUS', null, { sha256: null }),
    ]]]);
    expect(selectRereadCandidates([ipos[0]], odd, { now: NOW, storeDir: '/s', hasStoredFile: () => true }).candidates).toEqual([]);
  });
});

describe('item 45: ordering and cap', () => {
  const rc = (id: string, due: string | null): RereadCandidate => ({ id, companyName: id, slug: id, segment: 'SME', purgeDueAt: due ? new Date(due) : null });

  it('soonest-purged first, then re-reads with no purge clock, then the rest in lifecycle order', () => {
    const lifecycle = [{ id: 'open' }, { id: 'upcoming' }, { id: 'listedOld' }, { id: 'listedNew' }];
    const rereads = new Map([
      ['upcoming', rc('upcoming', null)],
      ['listedOld', rc('listedOld', '2026-10-04T00:00:00Z')],
      ['listedNew', rc('listedNew', '2026-10-09T00:00:00Z')],
    ]);
    expect(orderForRereads(lifecycle, rereads).map((i) => i.id)).toEqual(['listedOld', 'listedNew', 'upcoming', 'open']);
  });

  it('adds at most EXTRACTION_ONLY_PER_CYCLE out-of-window IPOs, soonest-purged first, defers the rest', () => {
    const cycle = [{ id: 'open', companyName: 'open', slug: 'open', segment: 'MAINBOARD' }];
    const outside = Array.from({ length: EXTRACTION_ONLY_PER_CYCLE + 2 }, (_, k) => rc(`o${k}`, `2026-10-${String(10 - k).padStart(2, '0')}T00:00:00Z`));
    const plan = planRereadPasses(cycle, [rc('open', null), ...outside]);
    expect(plan.outOfWindow.map((c) => c.id)).toEqual(['o4', 'o3', 'o2'].slice(0, EXTRACTION_ONLY_PER_CYCLE));
    expect(plan.outOfWindowDeferred).toBe(2);
    expect(plan.order.map((c) => c.id)).toEqual([...plan.outOfWindow.map((c) => c.id), 'open']);
    expect(plan.order.some((c) => 'purgeDueAt' in c)).toBe(false);
  });
});
