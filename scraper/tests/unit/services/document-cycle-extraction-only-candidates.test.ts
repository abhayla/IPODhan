// F-158/OD-90 follow-up (owner delegation 2026-09-24): PASS 2 (extraction)
// must pick up a stored, never-read document (PENDING, extractable type,
// purged_unread=false) even when its IPO is OUTSIDE the live window
// `loadCandidateIpos` gates discovery/fetching on — the Skyways class.
// Discovery/fetching stay live-window only; these tests are on the REAL
// selection function, never a re-implementation.
import { describe, it, expect } from 'vitest';
import {
  selectExtractionOnlyCandidates,
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

describe('selectExtractionOnlyCandidates', () => {
  it('(a) a LISTED IPO 24 days past listing holding a PENDING stored CORRIGENDUM is an extraction candidate', () => {
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'CORRIGENDUM', extractionStatus: 'PENDING', purgedUnread: false }]],
    ]);
    const selected = selectExtractionOnlyCandidates([SKYWAYS], docs, new Set());
    expect(selected).toEqual([SKYWAYS]);
  });

  it('(b) the same IPO with no PENDING stored document is not a candidate', () => {
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'CORRIGENDUM', extractionStatus: 'COMPLETED', purgedUnread: false }]],
    ]);
    const selected = selectExtractionOnlyCandidates([SKYWAYS], docs, new Set());
    expect(selected).toEqual([]);
  });

  it('(b2) an IPO with no documents row at all is not a candidate', () => {
    const selected = selectExtractionOnlyCandidates([SKYWAYS], new Map(), new Set());
    expect(selected).toEqual([]);
  });

  it('(d) an ADDENDUM PENDING row does not make it a candidate — ADDENDUM has no extractor', () => {
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'ADDENDUM', extractionStatus: 'PENDING', purgedUnread: false }]],
    ]);
    const selected = selectExtractionOnlyCandidates([SKYWAYS], docs, new Set());
    expect(selected).toEqual([]);
  });

  it('excludes an IPO already in the live-window candidate set — additive only, never a double dispatch', () => {
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'CORRIGENDUM', extractionStatus: 'PENDING', purgedUnread: false }]],
    ]);
    const selected = selectExtractionOnlyCandidates([SKYWAYS], docs, new Set(['skyways-id']));
    expect(selected).toEqual([]);
  });

  it('excludes a PENDING extractable document that has been purged unread — no bytes left to extract', () => {
    const docs = new Map<string, StoredDocumentForExtractionCandidacy[]>([
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'CORRIGENDUM', extractionStatus: 'PENDING', purgedUnread: true }]],
    ]);
    const selected = selectExtractionOnlyCandidates([SKYWAYS], docs, new Set());
    expect(selected).toEqual([]);
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
      ['skyways-id', [{ ipoId: 'skyways-id', type: 'CORRIGENDUM', extractionStatus: 'PENDING', purgedUnread: false }]],
    ]);
    expect(selectExtractionOnlyCandidates([SKYWAYS], docs, new Set())).toEqual([SKYWAYS]);
  });
});
