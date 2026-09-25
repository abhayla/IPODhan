// F-158/OD-90 follow-up (owner delegation 2026-09-24): PASS 2 (extraction)
// must pick up a stored, never-read document (PENDING, extractable type,
// purged_unread=false) even when its IPO is OUTSIDE the live window
// `loadCandidateIpos` gates discovery/fetching on — the Skyways class.
// Discovery/fetching stay live-window only; these tests are on the REAL
// selection function, never a re-implementation.
import { describe, it, expect } from 'vitest';
import {
  selectExtractionOnlyCandidates,
  capExtractionOnlyCandidates,
  EXTRACTION_ONLY_PER_CYCLE,
  type ExtractionOnlyCandidate,
  type StoredDocumentForExtractionCandidacy,
} from '../../../src/services/document-cycle.js';
import { isInLiveWindow, LIVE_WINDOW_DAYS_AFTER_LISTING } from '../../../src/services/document-state-machine.js';

const SKYWAYS: ExtractionOnlyCandidate = {
  id: 'skyways-id',
  companyName: 'Skyways Air Services Ltd',
  slug: 'skyways-air-services-ltd',
  segment: 'MAINBOARD',
};

const STORED_SHA = '3b77bc3b'.padEnd(64, '0');
// Injectable stand-in for `hasStoredFile` — true only for the exact
// (ipoId, docType, sha256) triple a test marks as actually on disk.
const fileExistsFor = (storedFor: Set<string>) => (ipoId: string, docType: string, _storeDir: string, sha256?: string | null) =>
  !!sha256 && storedFor.has(`${ipoId}:${docType}:${sha256}`);

describe('selectExtractionOnlyCandidates', () => {
  it('(a) a LISTED IPO 24 days past listing holding a PENDING STORED CORRIGENDUM (sha256 + file exists) is an extraction candidate', () => {
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'CORRIGENDUM', extractionStatus: 'PENDING', purgedUnread: false, sha256: STORED_SHA }]],
    ]);
    const selected = selectExtractionOnlyCandidates([SKYWAYS], docs, new Set(), {
      hasStoredFile: fileExistsFor(new Set([`skyways-id:CORRIGENDUM:${STORED_SHA}`])),
    });
    expect(selected).toEqual([SKYWAYS]);
  });

  it('(b) the same IPO with no PENDING stored document is not a candidate', () => {
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'CORRIGENDUM', extractionStatus: 'COMPLETED', purgedUnread: false, sha256: STORED_SHA }]],
    ]);
    const selected = selectExtractionOnlyCandidates([SKYWAYS], docs, new Set(), {
      hasStoredFile: fileExistsFor(new Set([`skyways-id:CORRIGENDUM:${STORED_SHA}`])),
    });
    expect(selected).toEqual([]);
  });

  it('(b2) an IPO with no documents row at all is not a candidate', () => {
    const selected = selectExtractionOnlyCandidates([SKYWAYS], new Map(), new Set());
    expect(selected).toEqual([]);
  });

  it('(d) an ADDENDUM PENDING row does not make it a candidate — ADDENDUM has no extractor', () => {
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'ADDENDUM', extractionStatus: 'PENDING', purgedUnread: false, sha256: STORED_SHA }]],
    ]);
    const selected = selectExtractionOnlyCandidates([SKYWAYS], docs, new Set(), {
      hasStoredFile: fileExistsFor(new Set([`skyways-id:ADDENDUM:${STORED_SHA}`])),
    });
    expect(selected).toEqual([]);
  });

  it('excludes an IPO already in the live-window candidate set — additive only, never a double dispatch', () => {
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'CORRIGENDUM', extractionStatus: 'PENDING', purgedUnread: false, sha256: STORED_SHA }]],
    ]);
    const selected = selectExtractionOnlyCandidates([SKYWAYS], docs, new Set(['skyways-id']), {
      hasStoredFile: fileExistsFor(new Set([`skyways-id:CORRIGENDUM:${STORED_SHA}`])),
    });
    expect(selected).toEqual([]);
  });

  it('excludes a PENDING extractable document that has been purged unread — no bytes left to extract', () => {
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'CORRIGENDUM', extractionStatus: 'PENDING', purgedUnread: true, sha256: STORED_SHA }]],
    ]);
    const selected = selectExtractionOnlyCandidates([SKYWAYS], docs, new Set(), {
      hasStoredFile: fileExistsFor(new Set([`skyways-id:CORRIGENDUM:${STORED_SHA}`])),
    });
    expect(selected).toEqual([]);
  });

  // The RCA case (measured on staging 2026-09-25): a PENDING, not-purged
  // extractable row with NO sha256 is a discovered-but-never-downloaded link,
  // not a stored document — it must never become a candidate, regardless of
  // what `hasStoredFile` would say (it is never even asked: no hash means no
  // known file name).
  it('an IPO whose only PENDING document has sha256 NULL is NOT a candidate', () => {
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'CORRIGENDUM', extractionStatus: 'PENDING', purgedUnread: false, sha256: null }]],
    ]);
    const selected = selectExtractionOnlyCandidates([SKYWAYS], docs, new Set(), {
      // Even a fileExists stub that says "yes" must not matter — sha256 gates first.
      hasStoredFile: () => true,
    });
    expect(selected).toEqual([]);
  });

  // The head-of-line-blocking class this fix closes: 5 unstored older rows
  // (no sha256) plus 1 stored newer row across 6 IPOs — the cap of 3 must
  // select the one that is actually stored, never spend its 3 slots on
  // rows `selectPendingFilings` will just skip.
  it('with 5 unstored older rows and 1 stored newer row, the cap of 3 selects the stored one', () => {
    const ipos: ExtractionOnlyCandidate[] = [
      { id: 'unstored-1', companyName: 'Unstored 1', slug: 'unstored-1', segment: 'MAINBOARD' },
      { id: 'unstored-2', companyName: 'Unstored 2', slug: 'unstored-2', segment: 'MAINBOARD' },
      { id: 'unstored-3', companyName: 'Unstored 3', slug: 'unstored-3', segment: 'MAINBOARD' },
      { id: 'unstored-4', companyName: 'Unstored 4', slug: 'unstored-4', segment: 'MAINBOARD' },
      { id: 'unstored-5', companyName: 'Unstored 5', slug: 'unstored-5', segment: 'MAINBOARD' },
      SKYWAYS,
    ];
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['unstored-1', [{ ipoId: 'unstored-1', type: 'PROSPECTUS', extractionStatus: 'PENDING', purgedUnread: false, sha256: null, uploadedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) }]],
      ['unstored-2', [{ ipoId: 'unstored-2', type: 'PROSPECTUS', extractionStatus: 'PENDING', purgedUnread: false, sha256: null, uploadedAt: new Date(Date.now() - 19 * 24 * 60 * 60 * 1000) }]],
      ['unstored-3', [{ ipoId: 'unstored-3', type: 'PROSPECTUS', extractionStatus: 'PENDING', purgedUnread: false, sha256: null, uploadedAt: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000) }]],
      ['unstored-4', [{ ipoId: 'unstored-4', type: 'PROSPECTUS', extractionStatus: 'PENDING', purgedUnread: false, sha256: null, uploadedAt: new Date(Date.now() - 17 * 24 * 60 * 60 * 1000) }]],
      ['unstored-5', [{ ipoId: 'unstored-5', type: 'PROSPECTUS', extractionStatus: 'PENDING', purgedUnread: false, sha256: null, uploadedAt: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000) }]],
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'CORRIGENDUM', extractionStatus: 'PENDING', purgedUnread: false, sha256: STORED_SHA, uploadedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) }]],
    ]);
    const eligible = selectExtractionOnlyCandidates(ipos, docs, new Set(), {
      hasStoredFile: fileExistsFor(new Set([`skyways-id:CORRIGENDUM:${STORED_SHA}`])),
    });
    // Only the stored one is even eligible — the 5 unstored rows never reach the cap at all.
    expect(eligible.map((c) => c.id)).toEqual(['skyways-id']);
    const { selected, deferred } = capExtractionOnlyCandidates(eligible, 3);
    expect(selected.map((c) => c.id)).toEqual(['skyways-id']);
    expect(deferred).toBe(0);
  });

  // (c) discovery is not run for it. Discovery (PASS 1) iterates ONLY
  // `loadCandidateIpos`'s output, which is gated on `isInLiveWindow` — the
  // SAME real predicate document-cycle.ts's discovery candidate selection
  // uses, never a re-implementation. Skyways (LISTED, 24 days past listing,
  // LIVE_WINDOW_DAYS_AFTER_LISTING=10) fails that gate, so it is excluded from
  // discovery's candidate list by construction: 0 discovery/fetcher calls,
  // because discovery's loop body never runs for an id not in that list.
  it('(c) Skyways (LISTED, 24 days past listing) fails the live-window gate that decides discovery — 0 discovery calls follow by construction', () => {
    expect(LIVE_WINDOW_DAYS_AFTER_LISTING).toBe(10);
    const listedTwentyFourDaysAgo = new Date(Date.now() - 24 * 24 * 60 * 60 * 1000);
    const inWindow = isInLiveWindow({ status: 'LISTED', listingDate: listedTwentyFourDaysAgo });
    expect(inWindow).toBe(false);
    // Yet it IS still an extraction candidate via the extraction-only path —
    // proving PASS 2 alone widens, discovery does not.
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'CORRIGENDUM', extractionStatus: 'PENDING', purgedUnread: false, sha256: STORED_SHA }]],
    ]);
    expect(
      selectExtractionOnlyCandidates([SKYWAYS], docs, new Set(), {
        hasStoredFile: fileExistsFor(new Set([`skyways-id:CORRIGENDUM:${STORED_SHA}`])),
      })
    ).toEqual([SKYWAYS]);
  });
});

// Supervisor review round 3: measured on staging, 95 PENDING/not-purged
// documents already sit outside the live window. Uncapped, the first wake
// after deploy would add all 95 to PASS 2 in one cycle -- the per-cycle cap
// (zip-member-pass pattern) bounds it, oldest eligible document first.
describe('capExtractionOnlyCandidates', () => {
  const candidate = (id: string, daysOld: number): ExtractionOnlyCandidate => ({
    id,
    companyName: id,
    slug: id,
    segment: 'MAINBOARD',
    oldestEligibleDocumentAt: new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000),
  });

  it('5 eligible IPOs with cap 3 -> exactly 3 selected, the 3 oldest; 2 deferred', () => {
    const five = [candidate('a', 1), candidate('b', 5), candidate('c', 3), candidate('d', 10), candidate('e', 2)];
    const { selected, deferred } = capExtractionOnlyCandidates(five, 3);
    expect(selected.map((c) => c.id)).toEqual(['d', 'b', 'c']); // oldest (10d) -> 5d -> 3d
    expect(deferred).toBe(2);
  });

  it('the next cycle takes the rest — capping the deferred set alone yields the remaining 2, oldest first', () => {
    const five = [candidate('a', 1), candidate('b', 5), candidate('c', 3), candidate('d', 10), candidate('e', 2)];
    const first = capExtractionOnlyCandidates(five, 3);
    const remaining = five.filter((c) => !first.selected.some((s) => s.id === c.id));
    const second = capExtractionOnlyCandidates(remaining, 3);
    expect(second.selected.map((c) => c.id)).toEqual(['e', 'a']); // e (2d old) is older than a (1d old)
    expect(second.deferred).toBe(0);
  });

  it('defaults to EXTRACTION_ONLY_PER_CYCLE (3) when no cap is passed', () => {
    expect(EXTRACTION_ONLY_PER_CYCLE).toBe(3);
    const five = [candidate('a', 1), candidate('b', 2), candidate('c', 3), candidate('d', 4), candidate('e', 5)];
    const { selected, deferred } = capExtractionOnlyCandidates(five);
    expect(selected).toHaveLength(3);
    expect(deferred).toBe(2);
  });

  it('fewer eligible than the cap selects all of them, defers 0', () => {
    const two = [candidate('a', 1), candidate('b', 2)];
    const { selected, deferred } = capExtractionOnlyCandidates(two, 3);
    expect(selected).toHaveLength(2);
    expect(deferred).toBe(0);
  });
});
