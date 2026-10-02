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
import { decideIpoPurge, type IpoPurgeInputs, type StoredFileState } from '../../../src/services/document-store.js';

const NOW = new Date('2026-10-03T06:00:00Z');
// The purge's own inputs (decideIpoPurge): every document read and extracted unless overridden.
const inputs = (closeDate: string | null, latestExtractedAt: string | null, extra: Partial<IpoPurgeInputs> = {}): IpoPurgeInputs => ({
  closeDate, withdrawn: false, unreadCount: 0, textlessCount: 0, latestExtractedAt,
  documentCount: 1, unextractedCount: 0, eligible: true, ...extra,
});
const ipo = (id: string, closeDate: string | null, latestExtractedAt: string | null, extra: Partial<IpoPurgeInputs> = {}) => ({
  id, companyName: id, slug: id, segment: 'MAINBOARD', closeDate, purgeInputs: inputs(closeDate, latestExtractedAt, extra),
});
const doc = (ipoId: string, type: string, recordedVersion: string | null, extra: Partial<StoredReadDocument> = {}): StoredReadDocument => ({
  ipoId, type, extractionStatus: 'COMPLETED', purgedUnread: false, sha256: `${ipoId}-${type}`.padEnd(64, '0'), recordedVersion, ...extra,
});
const onDisk = (present: Set<string>) => (ipoId: string, type: string): StoredFileState =>
  present.has(`${ipoId}/${type}`) ? { kind: 'present' } : { kind: 'absent' };
const allPresent = (): StoredFileState => ({ kind: 'present' });

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
      now: NOW, retentionDays: 7, storeDir: '/s', fileState: onDisk(new Set(['live/RHP', 'nse/DRHP', 'nse/PRICE_BAND_AD'])),
    });
    expect(candidates.map((c) => c.id)).toEqual(['live', 'nse']);
    expect(skippedNoFile).toBe(0);
    // NSE closed 2026-09-21, last read 2026-09-29T04:57: the REAL purge decision first says purge on
    // the UTC day its extraction is more than 7 days old (decidePurge counts whole days).
    expect(candidates[1].purgeDueAt?.toISOString()).toBe('2026-10-07T00:00:00.000Z');
    // 'live' has not closed, but OD-32's clock is the last extraction (2026-10-02), not close.
    expect(candidates[0].purgeDueAt?.toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });

  it('a document already at the new version is not selected', () => {
    const atNew = new Map([['live', [doc('live', 'RHP', EXTRACTOR_VERSION)]]]);
    const { candidates } = selectRereadCandidates([ipos[0]], atNew, { now: NOW, storeDir: '/s', fileState: allPresent });
    expect(candidates).toEqual([]);
  });

  it('a purged file is skipped and counted, never selected (nothing to retry)', () => {
    const { candidates, skippedNoFile } = selectRereadCandidates(ipos, docs, {
      now: NOW, storeDir: '/s', fileState: onDisk(new Set(['live/RHP'])),
    });
    expect(candidates.map((c) => c.id)).toEqual(['live']);
    expect(skippedNoFile).toBe(2);
  });

  it('a directory that cannot be read is unknown (retried next cycle), not a purged file', () => {
    const sel = selectRereadCandidates(ipos, docs, {
      now: NOW, storeDir: '/s',
      fileState: (id): StoredFileState => (id === 'nse' ? { kind: 'unknown', cause: 'EACCES: denied' } : { kind: 'present' }),
    });
    expect(sel.candidates.map((c) => c.id)).toEqual(['live']);
    expect(sel.skippedNoFile).toBe(0);
    expect(sel.unknownFile).toBe(2);
    expect(sel.unknownFileCauses[0]).toContain('EACCES');
  });

  it('names the skipped document ids (signal-ownership R1)', () => {
    const named = new Map([['nse', [doc('nse', 'DRHP', null, { documentId: 'doc-42' })]]]);
    const sel = selectRereadCandidates([ipos[1]], named, { now: NOW, storeDir: '/s', fileState: onDisk(new Set()) });
    expect(sel.skippedNoFileIds).toEqual(['doc-42']);
  });

  it('purged-unread, not COMPLETED and hashless rows are not re-reads', () => {
    const odd = new Map([['live', [
      doc('live', 'RHP', null, { purgedUnread: true }),
      doc('live', 'DRHP', null, { extractionStatus: 'PENDING' }),
      doc('live', 'PROSPECTUS', null, { sha256: null }),
    ]]]);
    expect(selectRereadCandidates([ipos[0]], odd, { now: NOW, storeDir: '/s', fileState: allPresent }).candidates).toEqual([]);
  });
});

describe('PR #1472 r1 (MAJOR-2): purgeDueAt is the REAL purge decision projected forward', () => {
  const pick = (row: ReturnType<typeof ipo>) =>
    selectRereadCandidates([row], new Map([[row.id, [doc(row.id, 'RHP', null)]]]), { now: NOW, storeDir: '/s', fileState: allPresent })
      .candidates[0];

  it('an IPO holding a never-extracted document is not ranked as purging (s2b holds it forever)', () => {
    const held = ipo('held', '2026-08-01', '2026-08-10T00:00:00Z', { documentCount: 2, unextractedCount: 1 });
    expect(decideIpoPurge(held.purgeInputs, { now: NOW }).purge).toBe(false);
    expect(pick(held).purgeDueAt).toBeNull();
  });

  it('an UNCLOSED IPO past its last-extraction window is ranked as purging now', () => {
    const open = ipo('unclosed', null, '2026-09-20T00:00:00Z');
    expect(decideIpoPurge(open.purgeInputs, { now: NOW }).purge).toBe(true);
    expect(pick(open).purgeDueAt?.getTime()).toBe(NOW.getTime());
  });

  it('a textless document, an unread state row inside the hard cap and a non-candidate IPO all follow the purge', () => {
    expect(pick(ipo('textless', '2026-08-01', '2026-08-10T00:00:00Z', { textlessCount: 1 })).purgeDueAt).toBeNull();
    expect(pick(ipo('hidden', '2026-08-01', '2026-08-10T00:00:00Z', { eligible: false })).purgeDueAt).toBeNull();
    // Unread: kept past the soft window, purged at the 30-day hard cap from its last extraction.
    expect(pick(ipo('unread', '2026-09-01', '2026-09-20T00:00:00Z', { unreadCount: 1 })).purgeDueAt?.toISOString())
      .toBe('2026-10-21T00:00:00.000Z');
  });

  it('orders by the real date: unclosed-but-expired first, never-extracted hold after every purging IPO', () => {
    const rows = [
      ipo('held', '2026-08-01', '2026-08-10T00:00:00Z', { documentCount: 2, unextractedCount: 1 }),
      ipo('nse', '2026-09-21', '2026-09-29T04:57:46Z'),
      ipo('unclosed', null, '2026-09-20T00:00:00Z'),
    ];
    const docsBy = new Map(rows.map((r) => [r.id, [doc(r.id, 'RHP', null)]]));
    const { candidates } = selectRereadCandidates(rows, docsBy, { now: NOW, storeDir: '/s', fileState: allPresent });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    expect(orderForRereads(rows, byId).map((r) => r.id)).toEqual(['unclosed', 'nse', 'held']);
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

  it('a tie on the purge date goes to the most recently closed IPO first (OD-22)', () => {
    const tie = (id: string, close: string | null): RereadCandidate => ({ ...rc(id, '2026-10-05T00:00:00Z'), closeDate: close ? new Date(close) : null });
    const rereads = new Map([
      ['older', tie('older', '2026-09-01')], ['newer', tie('newer', '2026-09-25')], ['noClose', tie('noClose', null)],
    ]);
    expect(orderForRereads([{ id: 'noClose' }, { id: 'older' }, { id: 'newer' }], rereads).map((i) => i.id))
      .toEqual(['newer', 'older', 'noClose']);
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
