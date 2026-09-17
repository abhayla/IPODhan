/**
 * Item 3 slice S1b — failing test first, on the REAL `DataConsolidationService.consolidateIPOData`
 * (never a re-implementation), proving the writer decides a FLIPPED field
 * (`ipos.issue_size`, group "issue-size") from `resolveFieldSourcePolicy(...).ranks` when
 * `ENABLE_POLICY_WRITER` is on, and leaves every decision byte-identical to today's matrix path
 * when the flag is off.
 *
 * RED on origin/main (0abf8a37): there is no `switchover.ts`, no `ENABLE_POLICY_WRITER` flag, and
 * `outranksUntrackedValue`/`getSourcePriority`/`isTimeBased`/`allowsSameSourceRefresh` take no
 * `tableName` — none of this file's table-scoped, resolver-driven decisions exist yet, so every
 * test below that exercises them is red until this slice's writer changes land. Test (i)
 * specifically proves the REDEFINED untracked-value rule (card finding 2): under the real
 * two-rank `ipos.issue_size` policy ([DOC, CHITTORGARH]), CHITTORGARH (the worst-ranked of the
 * two) must be able to heal an untracked stored value — the legacy per-field matrix rule
 * ("strictly better than the field's own worst-listed source") happens to also allow CHITTORGARH
 * for `issueSize` today (a 6-source legacy list), so the discriminating proof of the NEW rule is
 * test (vii): a source the legacy matrix ranks but the manifest policy does not (NSE).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DataConsolidationService } from '../../../src/services/data-consolidation-service.js';
import type { FieldSourcesRepository, DataConflictsRepository } from '@ipodhan/shared';

vi.mock('../../../src/config/feature-flags.js', () => ({
  FEATURE_FLAGS: {
    ENABLE_SOURCE_TRACKING: true,
    ENABLE_CONFLICT_DETECTION: true,
    ENABLE_DATA_CONSOLIDATION: true,
    ENABLE_POLICY_WRITER: true,
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
    ENABLE_FIELD_EXTRACTION_VALIDATION: false,
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
  resolveConflict: vi.fn(),
} as unknown as DataConflictsRepository;

function fieldSourceRow(fieldName: string, source: string, value: any, updatedAt = '2026-09-01T00:00:00Z') {
  return {
    ipoId: 'policy-test', tableName: 'ipos', fieldName, source, value,
    confidence: 100, dataLineage: null, previousValue: null, previousSource: null,
    updatedAt: new Date(updatedAt), createdAt: new Date(updatedAt),
  } as any;
}

describe('item 3 S1b: the writer decides a FLIPPED field from resolveFieldSourcePolicy', () => {
  let service: DataConsolidationService;

  beforeEach(() => {
    service = new DataConsolidationService(mockFieldSourcesRepo, mockConflictsRepo);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('(i) RED-FIRST: incoming CHITTORGARH beats an UNTRACKED stored ipos.issue_size under the real two-rank policy [DOC, CHITTORGARH]', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipos',
      incomingData: { issueSize: 54210000000 },
      existingData: { issueSize: 30850000000, segment: 'MAINBOARD' }, // untracked: no field_sources row
      source: 'CHITTORGARH',
      confidence: 80,
    });

    expect(result.consolidatedData.issueSize).toBe(54210000000);
    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'issueSize');
    expect(fieldResult?.chosenSource).toBe('CHITTORGARH');
  });

  it('(ii) incoming DOC (via DRHP write source) beats a tracked CHITTORGARH ipos.issue_size', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('issueSize', 'CHITTORGARH', '54210000000.00'),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipos',
      incomingData: { issueSize: 60000000000 },
      existingData: { segment: 'MAINBOARD' },
      source: 'DRHP',
      docType: 'PRICE_BAND_AD',
      confidence: 90,
    });

    expect(Number(result.consolidatedData.issueSize)).toBe(60000000000);
    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'issueSize');
    expect(fieldResult?.chosenSource).toBe('DRHP');
  });

  it('(iii) incoming BSE LOSES to a tracked CHITTORGARH ipos.issue_size — BSE is not in the manifest ranks for this field', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('issueSize', 'CHITTORGARH', '54210000000.00'),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipos',
      incomingData: { issueSize: 30000000000 },
      existingData: { segment: 'MAINBOARD' },
      source: 'BSE',
      confidence: 70,
    });

    expect(Number(result.consolidatedData.issueSize)).toBe(54210000000);
    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'issueSize');
    expect(fieldResult?.chosenSource).toBe('CHITTORGARH');
  });

  it('(iv) ipo_details.fresh_issue and ipos.issue_size (same flipped group, different tables) resolve to DIFFERENT rank lists — proves table is part of the resolver key', async () => {
    // ipo_details.fresh_issue (group issue-size, flipped) ranks [DOC,BSE,CHITTORGARH] MAINBOARD;
    // ipos.issue_size (same group) ranks [DOC,CHITTORGARH] MAINBOARD — BSE is capable for one
    // table's field and not the other's, proving the table dimension of the key actually reaches
    // the writer's decision (not just the column name).
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const freshIssueResult = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipo_details',
      incomingData: { freshIssue: 1500000000 },
      existingData: { freshIssue: 1400000000, segment: 'MAINBOARD' }, // untracked
      source: 'BSE',
      confidence: 80,
    });
    // BSE IS ranked for ipo_details.fresh_issue -> outranks the untracked value.
    expect(freshIssueResult.fieldResults.find((f) => f.fieldName === 'freshIssue')?.chosenSource).toBe('BSE');

    // Above the MAINBOARD issue-size floor (Rs10 Cr = 1e9) and a filing-total source (CHITTORGARH
    // is not in ISSUE_SIZE_FILING_TOTAL_SOURCES, but no shares/band data is supplied here so the
    // shares-x-band coherence branch never engages) so the value reaches the real untracked-value
    // decision instead of being rejected by the plausibility gate.
    const issueSizeResult = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipos',
      incomingData: { issueSize: 1500000000 },
      existingData: { issueSize: 1400000000, segment: 'MAINBOARD' }, // untracked
      source: 'BSE',
      confidence: 80,
    });
    // BSE is NOT ranked for ipos.issue_size -> cannot outrank the untracked value; kept (existing
    // value survives, source falls back to the incoming source per the untracked-keep contract,
    // but the VALUE must stay the stored one, not the incoming one).
    expect(issueSizeResult.fieldResults.find((f) => f.fieldName === 'issueSize')?.finalValue).toBe(1400000000);
  });

  it('(v) an E-1 field (ipos.open_date, class T, unflipped) never accepts a document value — unaffected by the flip', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('openDate', 'NSE', '2026-09-10'),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipos',
      incomingData: { openDate: '2026-09-15' },
      existingData: { segment: 'MAINBOARD' },
      source: 'DRHP',
      docType: 'PRICE_BAND_AD',
      confidence: 90,
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'openDate');
    expect(fieldResult?.chosenSource).not.toBe('DRHP');
  });

  it('(vi) a create with unknown segment resolves the flipped policy with the MAINBOARD rank list', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    // No segment anywhere (existingData/incomingData) — must not throw (a non-MAINBOARD
    // fallback for an SME-only field would throw NA on the manifest's SME_BSE/SME_NSE keys
    // for a field that has no rank entry there); MAINBOARD's [DOC, CHITTORGARH] must be used.
    const result = await service.consolidateIPOData({
      ipoId: 'new',
      tableName: 'ipos',
      incomingData: { issueSize: 1234 },
      source: 'CHITTORGARH',
      confidence: 80,
    });

    expect(result.errors).toEqual([]);
    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'issueSize');
    expect(fieldResult).toBeDefined();
  });

  it('(vii) flag OFF: decisions identical to the legacy matrix path — the discriminating case is a ' +
     'source the LEGACY matrix ranks but the POLICY does not (NSE for ipos.issue_size)', async () => {
    // Policy ranks (manifest): [DOC, CHITTORGARH] — NSE is not in this list at all.
    // Legacy matrix ranks (field-priority-matrix.ts's issueSize entry): [ADMIN, DRHP,
    // CHITTORGARH, NSE, BSE, MONEYCONTROL] — NSE IS ranked (index 3 of 5 worst), so under the
    // untracked-value rule it outranks an untracked stored value. Flag ON must refuse NSE here
    // (proven first); flag OFF must accept it, unchanged from origin/main.
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const flagOnResult = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipos',
      incomingData: { issueSize: 1500000000 },
      existingData: { issueSize: 1400000000, segment: 'MAINBOARD' }, // untracked
      source: 'NSE',
      confidence: 80,
    });
    expect(flagOnResult.fieldResults.find((f) => f.fieldName === 'issueSize')?.finalValue).toBe(1400000000);

    const featureFlags = await import('../../../src/config/feature-flags.js');
    (featureFlags.FEATURE_FLAGS as any).ENABLE_POLICY_WRITER = false;
    try {
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);
      const flagOffResult = await service.consolidateIPOData({
        ipoId: 'policy-test',
        tableName: 'ipos',
        incomingData: { issueSize: 1500000000 },
        existingData: { issueSize: 1400000000, segment: 'MAINBOARD' }, // untracked
        source: 'NSE',
        confidence: 80,
      });
      // Legacy rule: NSE ranks below the worst-listed source -> outranks the untracked value.
      expect(flagOffResult.fieldResults.find((f) => f.fieldName === 'issueSize')?.finalValue).toBe(1500000000);
    } finally {
      (featureFlags.FEATURE_FLAGS as any).ENABLE_POLICY_WRITER = true;
    }
  });
});
