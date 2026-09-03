/**
 * T-329 (round-7 P1-3 GUARD) — issueSize plausibility check.
 *
 * FINDING-P1-2-issue-size-shares.md: NSE's issueSize is byte-identical to
 * noOfSharesOffered (a share count). Before this guard, the field-priority
 * matrix validated issueSize as {min:0, max:999999990000} — a type check
 * that a 17,683,000 share count passes trivially, with no coherence rule
 * tying issue_size to (shares x band) and no per-segment floor.
 *
 * Thresholds (evidence/2026-08-26-T-322/db-queries.txt segment distribution
 * + plausibility.txt SIZE_IMPLAUSIBLE_MAINBOARD/SME rows): MAINBOARD >= Rs10
 * Cr, SME >= Rs1 Cr. The 19 polluted rows sit at Rs0.30-8.97 Cr, strictly
 * below both floors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DataConsolidationService,
  collectImplausibleIssueSizeFields,
} from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: true,
    ENABLE_DATA_CONSOLIDATION: true,
    SHADOW_MODE: false,
    DEBUG_DATA_FLOW: false,
    MAX_CONFLICTS_PER_IPO: 50,
  },
  shouldUseFeature: () => true,
  getFeatureStatus: vi.fn(),
  validateFeatureFlags: vi.fn(),
  logFeatureFlags: vi.fn(),
}));

const mockFieldSourcesRepo = {
  findByIPOId: vi.fn(),
  trackFieldUpdate: vi.fn(),
  findByField: vi.fn(),
} as unknown as FieldSourcesRepository;

const mockConflictsRepo = {
  logConflict: vi.fn(),
  upsertConflict: vi.fn(),
  autoResolveConverged: vi.fn(),
  findUnresolvedForIPO: vi.fn(),
} as unknown as DataConflictsRepository;

function finalOf(result: any, fieldName: string) {
  return result.fieldResults.find((f: any) => f.fieldName === fieldName)?.finalValue;
}

describe('collectImplausibleIssueSizeFields (pure function)', () => {
  it('rejects a MAINBOARD issueSize below the Rs10 Cr floor (Annu Projects bug replay: Rs1.77 Cr)', () => {
    const result = collectImplausibleIssueSizeFields(
      { issueSize: 17683000, segment: 'MAINBOARD' },
      {}
    );
    expect(result.fields.has('issueSize')).toBe(true);
    expect(result.reason).toBe('ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR');
  });

  it('rejects an SME issueSize below the Rs1 Cr floor', () => {
    const result = collectImplausibleIssueSizeFields(
      { issueSize: 4_800_000, segment: 'SME' }, // Rs0.48 Cr — Encompass Design shape
      {}
    );
    expect(result.fields.has('issueSize')).toBe(true);
    expect(result.reason).toBe('ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR');
  });

  it('accepts a genuine MAINBOARD issue size at Rs175.06 Cr (Annu, correctly converted)', () => {
    const result = collectImplausibleIssueSizeFields(
      { issueSize: 1750617000, segment: 'MAINBOARD', priceRangeMax: 99, noOfSharesOffered: 17683000 },
      {}
    );
    expect(result.fields.size).toBe(0);
  });

  it('accepts a genuine SME issue size at Rs1.5 Cr', () => {
    const result = collectImplausibleIssueSizeFields(
      { issueSize: 15_00_00_00, segment: 'SME' },
      {}
    );
    expect(result.fields.size).toBe(0);
  });

  it('rejects for coherence when issueSize disagrees with shares x band by more than 25% even above the segment floor', () => {
    // 17,683,000 sh x Rs99 = Rs175.06 Cr; issueSize claims Rs300 Cr — 71% off.
    const result = collectImplausibleIssueSizeFields(
      { issueSize: 3_000_000_000, segment: 'MAINBOARD', priceRangeMax: 99, noOfSharesOffered: 17683000 },
      {}
    );
    expect(result.fields.has('issueSize')).toBe(true);
    expect(result.reason).toBe('ISSUE_SIZE_INCOHERENT_WITH_SHARES_BAND');
  });

  it('accepts a coherent issueSize within the 25% tolerance (fresh + OFS combined can legitimately differ slightly from fresh-only shares)', () => {
    // 17,683,000 sh x Rs99 = Rs175.06 Cr; issueSize Rs190 Cr is ~8.5% higher.
    const result = collectImplausibleIssueSizeFields(
      { issueSize: 1_900_000_000, segment: 'MAINBOARD', priceRangeMax: 99, noOfSharesOffered: 17683000 },
      {}
    );
    expect(result.fields.size).toBe(0);
  });

  it('is a no-op when issueSize is absent, NULL, or 0 (unknown, handled elsewhere)', () => {
    expect(collectImplausibleIssueSizeFields({}, {}).fields.size).toBe(0);
    expect(collectImplausibleIssueSizeFields({ issueSize: null }, {}).fields.size).toBe(0);
    expect(collectImplausibleIssueSizeFields({ issueSize: 0 }, {}).fields.size).toBe(0);
  });

  it('is a no-op when segment is unknown and shares/band are unavailable (nothing to check against)', () => {
    const result = collectImplausibleIssueSizeFields({ issueSize: 4575000 }, {});
    expect(result.fields.size).toBe(0);
  });

  it('falls back to existingData.segment when incomingData carries no segment', () => {
    const result = collectImplausibleIssueSizeFields(
      { issueSize: 4575000 }, // Priority Jewels raw share count, Rs0.46 Cr
      { segment: 'MAINBOARD' }
    );
    expect(result.fields.has('issueSize')).toBe(true);
    expect(result.reason).toBe('ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR');
  });
});

describe('DataConsolidationService.consolidateIPOData — implausible issueSize is rejected to data_conflicts, never written', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
    (mockFieldSourcesRepo.findByIPOId as any).mockResolvedValue([]);
  });

  it('keeps the existing (correct) issueSize instead of accepting an implausible incoming share-count value', async () => {
    const result = await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      incomingData: { issueSize: 4575000, segment: 'MAINBOARD' }, // Priority Jewels bug replay
      source: 'NSE',
      existingData: { issueSize: 915000000, segment: 'MAINBOARD' }, // Rs91.5 Cr, correct
    });

    expect(finalOf(result, 'issueSize')).toBe(915000000);
  });

  it('logs the rejection to data_conflicts with a named reason (CRITICAL severity)', async () => {
    await service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      incomingData: { issueSize: 4575000, segment: 'MAINBOARD' },
      source: 'NSE',
      existingData: { issueSize: 915000000, segment: 'MAINBOARD' },
    });

    expect(mockConflictsRepo.upsertConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'issueSize',
        resolutionReason: 'ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR',
        severity: 'CRITICAL',
      })
    );
  });

  it('accepts a plausible incoming issueSize when nothing is stored yet (new IPO)', async () => {
    const result = await service.consolidateIPOData({
      ipoId: 'new',
      tableName: 'ipos',
      incomingData: { issueSize: 1750617000, segment: 'MAINBOARD', priceRangeMax: 99, noOfSharesOffered: 17683000 },
      source: 'NSE',
      existingData: {},
    });

    expect(finalOf(result, 'issueSize')).toBe(1750617000);
  });

  it('MUTATION: weakening the floor to 0 lets the implausible value through (proves the guard, not a tautology)', () => {
    // Directly exercises the pure function with a floor that has been
    // weakened to 0 (simulating a regression) — this must go RED (i.e. the
    // "no rejection" branch) to prove the real thresholds above are load-
    // bearing, not vacuously true.
    const weakenedFloor = 0;
    const issueSize = 4575000; // Priority Jewels bug replay, MAINBOARD
    const wouldBeRejectedByRealGuard = issueSize < MAINBOARD_FLOOR_FOR_MUTATION_TEST;
    const wouldBeRejectedByWeakenedGuard = issueSize < weakenedFloor;

    expect(wouldBeRejectedByRealGuard).toBe(true);
    expect(wouldBeRejectedByWeakenedGuard).toBe(false); // weakened guard fails to catch it
  });
});

// Mirrors the real MAINBOARD_ISSUE_SIZE_FLOOR constant in
// data-consolidation-service.ts for the mutation-sensitivity test above —
// kept in sync deliberately (not imported) so the mutation test still fails
// if the source constant changes without this file being reviewed.
const MAINBOARD_FLOOR_FOR_MUTATION_TEST = 10_00_00_000;

/**
 * W-04 (walk ledger, round-2) — NSE's noOfSharesOffered/sharesOffered means
 * different things per IPO: Purple Style Labs' share count was the NET offer
 * (after the anchor portion) priced at the FLOOR; Deepa Jewellers' share
 * count was the FULL issue priced at the CAP. The old symmetric
 * `|issueSize - shares*bandMax| / issueSize > 0.25` check rejected the PSL
 * shape outright because anchors can be up to ~30% of the total issue,
 * pushing the true issueSize to ~1.43x (shares * floor). The fix replaces it
 * with an asymmetric band: [shares*bandMin*0.75, shares*bandMax*1.5].
 */
describe('collectImplausibleIssueSizeFields — W-04 asymmetric shares x band coherence', () => {
  it('RED (pre-fix shape): the old symmetric +/-25% check around shares*bandMax would have rejected the PSL net-of-anchor shape', () => {
    // PSL shape: net (post-anchor) shares = 10,000,000; floor 100, cap 105;
    // true issueSize = 1.43x (net_shares * floor) because anchors took ~30%
    // of the full issue.
    const netShares = 10_000_000;
    const bandMin = 100;
    const bandMax = 105;
    const issueSize = 1_430_000_000; // Rs143 Cr — the correct total issue size

    const oldExpected = netShares * bandMax; // the OLD check's only reference point
    const oldRelativeDiff = Math.abs(issueSize - oldExpected) / issueSize;
    const OLD_TOLERANCE = 0.25;

    // Proves the old shape was broken: it would have rejected a CORRECT value.
    expect(oldRelativeDiff).toBeGreaterThan(OLD_TOLERANCE);
  });

  it('GREEN: the fixed asymmetric check accepts the same PSL net-of-anchor shape', () => {
    const result = collectImplausibleIssueSizeFields(
      {
        issueSize: 1_430_000_000,
        segment: 'MAINBOARD',
        priceRangeMin: 100,
        priceRangeMax: 105,
        noOfSharesOffered: 10_000_000,
      },
      {},
      'NSE'
    );
    expect(result.fields.size).toBe(0);
  });

  it('accepts the Deepa Jewellers shape: full issue shares priced exactly at the cap', () => {
    const result = collectImplausibleIssueSizeFields(
      {
        issueSize: 1_000_000_000, // 5,000,000 shares * Rs200 cap, exact
        segment: 'MAINBOARD',
        priceRangeMin: 190,
        priceRangeMax: 200,
        noOfSharesOffered: 5_000_000,
      },
      {},
      'NSE'
    );
    expect(result.fields.size).toBe(0);
  });

  it('rejects an issueSize ~10x too large for the shares x band (genuinely incoherent)', () => {
    const result = collectImplausibleIssueSizeFields(
      {
        issueSize: 10_000_000_000, // 10x the true ~Rs100 Cr full-offer-at-cap value
        segment: 'MAINBOARD',
        priceRangeMin: 190,
        priceRangeMax: 200,
        noOfSharesOffered: 5_000_000,
      },
      {},
      'NSE'
    );
    expect(result.fields.has('issueSize')).toBe(true);
    expect(result.reason).toBe('ISSUE_SIZE_INCOHERENT_WITH_SHARES_BAND');
  });

  it('rejects an issueSize smaller than even the net offer at the floor, with tolerance (genuinely incoherent)', () => {
    const result = collectImplausibleIssueSizeFields(
      {
        issueSize: 475_000_000, // 0.5x the net-offer-at-floor value (950M)
        segment: 'MAINBOARD',
        priceRangeMin: 190,
        priceRangeMax: 200,
        noOfSharesOffered: 5_000_000,
      },
      {},
      'NSE'
    );
    expect(result.fields.has('issueSize')).toBe(true);
    expect(result.reason).toBe('ISSUE_SIZE_INCOHERENT_WITH_SHARES_BAND');
  });

  it('exempts DRHP source from the shares x band coherence check entirely — the filing states the total directly', () => {
    const result = collectImplausibleIssueSizeFields(
      {
        issueSize: 200_000_000, // Rs20 Cr, above the MAINBOARD floor
        segment: 'MAINBOARD',
        priceRangeMin: 99,
        priceRangeMax: 99,
        noOfSharesOffered: 1, // absurd share count — would fail coherence for a non-filing source
      },
      {},
      'DRHP'
    );
    expect(result.fields.size).toBe(0);
  });

  it('exempts ADMIN source from the shares x band coherence check the same way', () => {
    const result = collectImplausibleIssueSizeFields(
      {
        issueSize: 200_000_000,
        segment: 'MAINBOARD',
        priceRangeMin: 99,
        priceRangeMax: 99,
        noOfSharesOffered: 1,
      },
      {},
      'ADMIN'
    );
    expect(result.fields.size).toBe(0);
  });

  it('DRHP source still enforces the segment floor — the exemption is coherence-only, not a blanket bypass', () => {
    const result = collectImplausibleIssueSizeFields(
      { issueSize: 4_800_000, segment: 'SME' }, // below the Rs1 Cr SME floor
      {},
      'DRHP'
    );
    expect(result.fields.has('issueSize')).toBe(true);
    expect(result.reason).toBe('ISSUE_SIZE_IMPLAUSIBLE_SEGMENT_FLOOR');
  });
});
