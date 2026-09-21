/**
 * OD-66 — a document write is adjudicated on ITS OWN fields only.
 *
 * Owner, 2026-09-21: "if there are 10 fields, 5 provided by the previous
 * document and 5 by the new document ... you should only care about the new
 * set of fields from the new document, ignore the mismatch of fields from the
 * previous document."
 *
 * THE DEFECT. `filing-persister.ts:1228-1242` seeds its payload with five
 * identity fields READ OFF THE STORED ROW (companyName, segment,
 * offeringType, status, listingExchange), plus openDate/closeDate fallbacks
 * at 1289-1303, because `computeIpoIdentitySlug` needs them to resolve the
 * row. Those are CONTEXT — facts the writer needs in order to judge — not
 * values the document is asserting.
 *
 * But `consolidateIPOData` iterates `Object.keys(incomingData)`
 * (data-consolidation-service.ts:1068-1073) and treats every key as a claim
 * by this write's source. A field the document genuinely did not supply
 * arrives `undefined` and IS correctly skipped (guard at 1427-1444). The
 * re-asserted five are NOT undefined: they pass the guard, enter resolution
 * as `DRHP` claims, and on an equal value reach `autoResolveConverged`
 * (1903-1912) — closing open conflicts about fields the document never read.
 * The value never moves; the provenance and the conflict state do.
 *
 * MEASURED on staging 2026-09-21: of 31,755 auto-resolved conflicts, only 23
 * involve `DRHP` on either side, 11 of those on the re-asserted fields
 * (9 companyName, 2 status). Small because the document path is young — it
 * grows with extraction. (A first count of 18,583 was wrong: it counted every
 * auto-resolution on those FIELD NAMES, but the bulk are website-vs-website,
 * e.g. NSE/MONEYCONTROL 3,209 on openDate — genuine convergence.)
 *
 * PRECEDENT. The field-plan walk hit this identical shape in its review round
 * 3 and fixed it: `field-plan-walk.ts:225` names it "fabricated provenance for
 * fields the walk never fetched" and passes `onlyFields: [camelField]`. The
 * filing path never got that fix. These tests are the missing half.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

vi.mock('../../../src/config/feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/config/feature-flags.js')>()),
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: true,
    ENABLE_DATA_CONSOLIDATION: true,
    SHADOW_MODE: false,
    DEBUG_DATA_FLOW: false,
    ENABLE_EARLY_DETECTION: false,
    SOURCE_TRACKING_PERCENTAGE: 100,
    CONFLICT_DETECTION_PERCENTAGE: 100,
    CONSOLIDATION_PERCENTAGE: 100,
    MAX_CONFLICTS_PER_IPO: 50,
    SOURCE_TRACKING_BATCH_SIZE: 100,
    ENABLED_SCRAPERS: [],
    ENABLED_IPO_IDS: [],
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

const STATUS_FROM_NSE = 'OPEN';

function row(fieldName: string, source: string, value: unknown) {
  return {
    ipoId: 'ipo-1', tableName: 'ipos', fieldName, source, value,
    confidence: 100, dataLineage: null, previousValue: null, previousSource: null,
    updatedAt: new Date('2026-09-01T00:00:00Z'), createdAt: new Date('2026-09-01T00:00:00Z'),
  } as any;
}

describe('OD-66: a document resolves only the fields it supplied', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      row('status', 'NSE', STATUS_FROM_NSE),
    ]);
  });

  /** The corrigendum supplies ONE field. `status` rides along as context. */
  const corrigendumWrite = (contextOnly: string[] | undefined) =>
    service.consolidateIPOData({
      ipoId: 'ipo-1',
      tableName: 'ipos',
      // issueSize is the document's OWN claim; status was read off the stored
      // row so the slug could be computed — exactly filing-persister's shape.
      incomingData: { issueSize: 5_00_00_00_000, status: STATUS_FROM_NSE },
      source: 'DRHP',
      existingData: { status: STATUS_FROM_NSE } as any,
      contextFields: contextOnly,
    } as any);

  it('does not resolve a field the document only carried as context', async () => {
    const result = await corrigendumWrite(['status']);
    const fields = result.fieldResults.map((f: any) => f.fieldName);
    expect(fields).toContain('issueSize');
    expect(fields).not.toContain('status');
  });

  it('does not close an open conflict about a field the document never read', async () => {
    await corrigendumWrite(['status']);
    // autoResolveConverged on `status` is the audit-trail damage: a document
    // that never looked at status marking a real disagreement settled.
    const statusCalls = vi.mocked(mockConflictsRepo.autoResolveConverged).mock.calls
      .filter((c: any[]) => c.includes('status'));
    expect(statusCalls).toHaveLength(0);
  });

  it('still resolves every field when no context is declared (unchanged default)', async () => {
    // Callers that assert everything they pass keep today's behaviour exactly.
    const result = await corrigendumWrite(undefined);
    const fields = result.fieldResults.map((f: any) => f.fieldName);
    expect(fields).toContain('issueSize');
    expect(fields).toContain('status');
  });
});
