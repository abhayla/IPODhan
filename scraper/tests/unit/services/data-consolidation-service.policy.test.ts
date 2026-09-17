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

// (xv) M3 mutation guard support: a hoisted switch that makes the REAL resolver's answer for
// `ipos.issue_size` additionally mark DOC incapable, so a DRHP write must be judged as DOC.
const policyTestState = vi.hoisted(() => ({ markDocIncapable: false }));

vi.mock('../../../src/config/field-source-policy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/field-source-policy.js')>();
  return {
    ...actual,
    resolveFieldSourcePolicy: (query: any, deps?: any) => {
      const policy = actual.resolveFieldSourcePolicy(query, deps);
      if (policyTestState.markDocIncapable && query.table === 'ipos' && query.column === 'issue_size') {
        return { ...policy, incapable: { ...policy.incapable, DOC: 'test: DOC marked incapable for this case' } };
      }
      return policy;
    },
  };
});

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

  // MINOR-2 (review round 1): this test documents the INTENDED outcome but does NOT discriminate
  // the policy path from the legacy path — CHITTORGARH is allowed to heal an untracked value under
  // BOTH the manifest policy and the legacy per-field matrix rule for issueSize (a 6-source list that
  // also ranks CHITTORGARH above the worst-listed source). Set `flipped: []` in switchover.json and this
  // test still passes. Tests (iv), (vii), (viii) and (ix) are the ones that discriminate.
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

  // MINOR-2 (review round 1): documents the intended outcome; does NOT discriminate the policy path
  // from the legacy path — DRHP/DOC outranks CHITTORGARH under both the manifest policy ([DOC,
  // CHITTORGARH], DOC first) and the legacy matrix (DRHP ranks above CHITTORGARH there too). Set
  // `flipped: []` and this test still passes. Tests (iv), (vii), (viii) and (ix) discriminate.
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

  // MINOR-2 (review round 1): documents the intended outcome; does NOT discriminate the policy path
  // from the legacy path — BSE is unranked/low-ranked for issueSize under BOTH the manifest policy
  // ([DOC, CHITTORGARH], BSE absent) and the legacy matrix (BSE ranks below CHITTORGARH there too).
  // Set `flipped: []` and this test still passes. Tests (iv), (vii), (viii) and (ix) discriminate.
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

  // Review round 1, MAJOR-1: prove `getSourcePriority` (both call sites) receives `tableName`
  // through the REAL orchestrator — the config-level test only calls the matrix function
  // directly. Discriminator, MEASURED: `ipo_details.fresh_issue` has NO explicit camelCase
  // entry in FIELD_PRIORITY_MATRIX (`freshIssue` matches neither `fresh_issue_size`'s snake_case
  // key nor any camelCase key), so `getFieldRules('freshIssue')` falls through to the DEFAULT
  // rule `['ADMIN','DRHP','NSE','BSE','MONEYCONTROL','CHITTORGARH','API_FALLBACK']` — NSE
  // (index 2) outranks BSE (index 3). The manifest POLICY for `ipo_details.fresh_issue`
  // MAINBOARD ranks `[DOC, BSE, CHITTORGARH]` — NSE is ABSENT (unranked, priority -1), BSE is
  // ranked (priority 1). So: stored NSE vs incoming BSE — under the LEGACY default list NSE
  // (ranked) beats BSE (also ranked, but worse) and the stored value survives; under the POLICY,
  // BSE (ranked) beats NSE (unranked) and the incoming value replaces it. The two paths give
  // OPPOSITE outcomes on this exact input, so reverting `tableName` at the getSourcePriority
  // call sites (which forces the one-arg `getFieldRules` fallback regardless of the flag/flip
  // state) must turn this test red.
  it('(viii) TRACKED vs TRACKED: stored NSE (legacy-default-ranked, POLICY-unranked) loses to incoming BSE through the real orchestrator', async () => {
    // NOTE: `fieldSourceRow()` hardcodes `tableName: 'ipos'` (it is used by every other test in
    // this file, all of which target `ipos.*`) — this field is `ipo_details.fresh_issue`, so the
    // tracked row is built inline with the correct tableName; otherwise the row-key match
    // (`fieldSource.tableName === input.tableName`) silently fails and the field reads as
    // untracked, masking the tracked-vs-tracked case this test exists to prove.
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      {
        ipoId: 'policy-test', tableName: 'ipo_details', fieldName: 'freshIssue', source: 'NSE', value: '1400000000',
        confidence: 100, dataLineage: null, previousValue: null, previousSource: null,
        updatedAt: new Date('2026-09-01T00:00:00Z'), createdAt: new Date('2026-09-01T00:00:00Z'),
      } as any,
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipo_details',
      incomingData: { freshIssue: 1500000000 },
      existingData: { segment: 'MAINBOARD' },
      source: 'BSE',
      confidence: 80,
    });

    // Policy ranks: [DOC, BSE, CHITTORGARH] -- NSE is UNRANKED (priority -1), BSE is ranked
    // (priority 1) -- BSE must win regardless of what the legacy DEFAULT list says about NSE.
    expect(Number(result.consolidatedData.freshIssue)).toBe(1500000000);
    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'freshIssue');
    expect(fieldResult?.chosenSource).toBe('BSE');
    expect(fieldResult?.conflictReason).toBe('SOURCE_PRIORITY');
  });

  // Review round 1, MAJOR-1: prove `allowsSameSourceRefresh` (:2365) receives `tableName` through
  // the REAL orchestrator. `ipos.lot_size` is in the flipped `issue-size` group (switchover.json),
  // has `sameSourceRefresh: true` in the legacy matrix (issueSize itself does NOT, so it cannot be
  // used here -- allowsSameSourceRefresh short-circuits false before reaching tableName/policy
  // logic when the field has no sameSourceRefresh flag at all). Legacy lotSize entry:
  // `sameSourceRefreshSources: ['DRHP']` only -- BSE is EXCLUDED from self-refresh. Manifest
  // policy MAINBOARD ranks `[DOC, BSE, NSE]` for ipos.lot_size -- BSE IS ranked. A same-source
  // BSE-vs-BSE conflict (newer BSE value replacing an older BSE value) must be REFUSED under the
  // legacy allow-list and ALLOWED under the policy allow-list -- the two answers differ, proving
  // this is a genuine behavioural discriminator, not a tableName-presence check in disguise.
  it('(ix) same-source refresh through the orchestrator: BSE-vs-BSE on ipos.lot_size — legacy refuses, policy allows', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('lotSize', 'BSE', '100', '2026-09-01T00:00:00Z'),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipos',
      incomingData: { lotSize: 150 },
      existingData: { segment: 'MAINBOARD' },
      source: 'BSE',
      confidence: 90,
      scrapedAt: new Date('2026-09-05T00:00:00Z'),
    } as any);

    // Policy allows BSE self-refresh for ipos.lot_size (BSE is ranked) -- the newer BSE value
    // (scrapedAt 09-05 > stored 09-01) replaces the older one via SAME_SOURCE_REFRESH.
    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'lotSize');
    expect(fieldResult?.finalValue).toBe(150);
    expect(fieldResult?.chosenSource).toBe('BSE');
    expect(fieldResult?.conflictReason).toBe('SAME_SOURCE_REFRESH');

    // Flag OFF: legacy allow-list excludes BSE from lotSize self-refresh (sameSourceRefreshSources:
    // ['DRHP'] only) -- same-source BSE-vs-BSE falls through to DEFAULT_KEEP_EXISTING, proving the
    // two paths genuinely disagree on this exact input.
    const featureFlags = await import('../../../src/config/feature-flags.js');
    (featureFlags.FEATURE_FLAGS as any).ENABLE_POLICY_WRITER = false;
    try {
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
        fieldSourceRow('lotSize', 'BSE', '100', '2026-09-01T00:00:00Z'),
      ]);
      const flagOffResult = await service.consolidateIPOData({
        ipoId: 'policy-test',
        tableName: 'ipos',
        incomingData: { lotSize: 150 },
        existingData: { segment: 'MAINBOARD' },
        source: 'BSE',
        confidence: 90,
        scrapedAt: new Date('2026-09-05T00:00:00Z'),
      } as any);
      const flagOffField = flagOffResult.fieldResults.find((f) => f.fieldName === 'lotSize');
      expect(Number(flagOffField?.finalValue)).toBe(100);
      expect(flagOffField?.conflictReason).not.toBe('SAME_SOURCE_REFRESH');
    } finally {
      (featureFlags.FEATURE_FLAGS as any).ENABLE_POLICY_WRITER = true;
    }
  });

  // ==================== Item 3 slice S1c: incapable sources are REFUSED ====================
  // A source the manifest marks `capability.<SRC>.capable === false` for a field must never be
  // written, no matter what is (or is not) already stored. This is strictly stronger than "not
  // ranked": an unranked-but-capable source merely loses a priority contest, and — crucially —
  // still WINS an empty slot (Case 1 accepts whoever arrives first). The #728 class (BSE issue
  // sizes measured 41-76% below the printed total on 6/6 live mainboard IPOs) reached the live
  // page exactly through that empty-slot door.
  it('(x) RED-FIRST: incoming BSE ipos.issue_size against an EMPTY stored value is REFUSED, not accepted into the empty slot', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipos',
      incomingData: { issueSize: 7000000084 },
      existingData: { segment: 'MAINBOARD' }, // no stored issue_size at all
      source: 'BSE',
      confidence: 80,
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'issueSize');
    expect(fieldResult?.conflictReason).toBe('REJECTED_INCAPABLE_SOURCE');
    // The empty slot stays empty — an incapable source never becomes the stored value.
    expect(fieldResult?.finalValue ?? null).toBeNull();
    expect(result.consolidatedData.issueSize ?? null).toBeNull();
    expect(fieldResult?.rejectedSources?.[0]).toMatchObject({
      source: 'BSE',
      reason: 'REJECTED_INCAPABLE_SOURCE',
    });
  });

  it('(xi) incoming BSE ipos.issue_size against a stored CHITTORGARH value is REFUSED for INCAPABILITY, not merely outranked', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([
      fieldSourceRow('issueSize', 'CHITTORGARH', '10000000000.00'),
    ]);

    const result = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipos',
      incomingData: { issueSize: 7000000084 },
      existingData: { segment: 'MAINBOARD' },
      source: 'BSE',
      confidence: 80,
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'issueSize');
    expect(Number(fieldResult?.finalValue)).toBe(10000000000);
    expect(fieldResult?.chosenSource).toBe('CHITTORGARH');
    // Test (iii) already proves BSE LOSES this contest on rank. The discriminating assertion is
    // the REASON: under S1c it is refused as incapable before any priority comparison runs.
    expect(fieldResult?.conflictReason).toBe('REJECTED_INCAPABLE_SOURCE');
  });

  it('(xii) incoming CHITTORGARH (CAPABLE) on the same field and same empty slot is UNAFFECTED — it still wins', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipos',
      incomingData: { issueSize: 10000000000 },
      existingData: { segment: 'MAINBOARD' },
      source: 'CHITTORGARH',
      confidence: 80,
    });

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'issueSize');
    expect(Number(fieldResult?.finalValue)).toBe(10000000000);
    expect(fieldResult?.chosenSource).toBe('CHITTORGARH');
    expect(fieldResult?.conflictReason).not.toBe('REJECTED_INCAPABLE_SOURCE');
  });

  it('(xiii) a NON-FLIPPED field with an incapable source keeps today behaviour — no refusal (the guard rides the S1b flag+flip path)', async () => {
    // financial_statements.revenue marks NSE capable:false in the manifest, but the field is in
    // NO switchover group, so `policyGoverns` is false and the legacy matrix decides, unchanged.
    // `ipos.registrar` stands in as the flag-off half of the same proof below.
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    const result = await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'financial_statements',
      incomingData: { revenue: 12345 },
      existingData: { segment: 'MAINBOARD' },
      source: 'NSE',
      confidence: 80,
    } as any);

    const fieldResult = result.fieldResults.find((f) => f.fieldName === 'revenue');
    expect(fieldResult?.conflictReason).not.toBe('REJECTED_INCAPABLE_SOURCE');

    // And with the FLAG OFF, even the flipped field falls back to today behaviour: BSE fills the
    // empty issue_size slot exactly as it does on origin/main.
    const featureFlags = await import('../../../src/config/feature-flags.js');
    (featureFlags.FEATURE_FLAGS as any).ENABLE_POLICY_WRITER = false;
    try {
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);
      const flagOff = await service.consolidateIPOData({
        ipoId: 'policy-test',
        tableName: 'ipos',
        incomingData: { issueSize: 7000000084 },
        existingData: { segment: 'MAINBOARD' },
        source: 'BSE',
        confidence: 80,
      });
      const flagOffField = flagOff.fieldResults.find((f) => f.fieldName === 'issueSize');
      expect(flagOffField?.conflictReason).not.toBe('REJECTED_INCAPABLE_SOURCE');
      expect(Number(flagOffField?.finalValue)).toBe(7000000084);
    } finally {
      (featureFlags.FEATURE_FLAGS as any).ENABLE_POLICY_WRITER = true;
    }
  });

  it('(xiv) the refusal is keyed on the MANIFEST code, not the raw writer string: a DRHP write (manifest DOC) on subscriptions.qib_subscription is refused while raw-string comparison would miss it', async () => {
    // subscriptions.qib_subscription marks DOC capable:false. The writer source is `DRHP`; the
    // manifest code is `DOC`. A guard comparing raw strings would look up `policy.incapable.DRHP`,
    // find nothing, and let the value through. This test dies on that mistake.
    const { resolveFieldSourcePolicy: resolve } = await import('../../../src/config/field-source-policy.js');
    const policy = resolve({ table: 'subscriptions', column: 'qib_subscription', ipoType: 'MAINBOARD' });
    expect(Object.keys(policy.incapable)).toContain('DOC');
    expect(Object.keys(policy.incapable)).not.toContain('DRHP');

    const { writerSourceToManifestCode } = await import('../../../src/config/field-source-codes.js');
    expect(writerSourceToManifestCode('DRHP')).toBe('DOC');
    expect(policy.incapable[writerSourceToManifestCode('DRHP')]).toBeTruthy();
  });

  it('(xv) M3 MUTATION GUARD: the writer looks the incoming source up by its MANIFEST code, so a DRHP write is judged as DOC — raw-string comparison lets the value through', async () => {
    // No flipped field marks a document code incapable in TODAY's manifest, so this drives the
    // real writer against the real resolver with ONE row's capability map extended: DOC incapable
    // for `ipos.issue_size`. The writer stores `DRHP` for every filing; the manifest word is
    // `DOC`. A guard comparing the raw writer string finds no `DRHP` key, lets the value through,
    // and fails this test. Everything else on the path (flag, flip, Case 1) is unchanged.
    policyTestState.markDocIncapable = true;
    try {
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);
      const result = await service.consolidateIPOData({
        ipoId: 'policy-test',
        tableName: 'ipos',
        incomingData: { issueSize: 10000000000 },
        existingData: { segment: 'MAINBOARD' },
        source: 'DRHP',
        confidence: 90,
      });

      const fieldResult = result.fieldResults.find((f) => f.fieldName === 'issueSize');
      expect(fieldResult?.conflictReason).toBe('REJECTED_INCAPABLE_SOURCE');
      expect(fieldResult?.finalValue ?? null).toBeNull();
    } finally {
      policyTestState.markDocIncapable = false;
    }
  });

  // Item 3 slice S1d: provenance names the configuration. RED on origin/main (20df246e):
  // trackFieldSource never passes `dataLineage` to trackFieldUpdate at all.
  it('(xvi) S1d: a policy-path write on ipos.issue_size carries policyOrigin in dataLineage', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipos',
      incomingData: { issueSize: 54210000000 },
      existingData: { issueSize: 30850000000, segment: 'MAINBOARD' },
      source: 'CHITTORGARH',
      confidence: 80,
    });

    const { loadFieldManifest } = await import('../../../src/config/field-manifest-loader.js');
    const manifest = loadFieldManifest();

    expect(mockFieldSourcesRepo.trackFieldUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'issueSize',
        dataLineage: { policyOrigin: `registry:${manifest.version}` },
      })
    );
  });

  it('(xvii) S1d: a field with NO manifest row (companyDescription\'s manifest key is ipos.company_description, so a synthetic row-less table proves this) carries no policyOrigin', async () => {
    vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

    // `ipo_financials.market_cap` (camelCase fieldName `marketCap`) has no manifest row at all
    // (measured 2026-09-18: ipo_financials is the orphaned table the S1d card's Known Gaps
    // section names) — not flipped either, so this exercises the shim path end-to-end, not just
    // the policyGoverns/delegatesToPolicy gate.
    await service.consolidateIPOData({
      ipoId: 'policy-test',
      tableName: 'ipo_financials',
      incomingData: { marketCap: 5000000 },
      existingData: { segment: 'MAINBOARD' },
      source: 'NSE',
      confidence: 80,
    });

    const call = vi.mocked(mockFieldSourcesRepo.trackFieldUpdate).mock.calls.find(
      (c) => c[0].fieldName === 'marketCap'
    );
    expect(call).toBeDefined();
    expect(call![0].dataLineage).toBeUndefined();
  });

  // CRITICAL-1 (Tier A review round on PR #753): flag OFF must be byte-identical to
  // origin/main for a field that DOES have a manifest row (issueSize) -- no manifest load, no
  // resolver call, no dataLineage key at all. RED before the fix: computePolicyOrigin ran
  // unconditionally (no ENABLE_POLICY_WRITER guard), so dataLineage was populated even with the
  // flag off.
  it('(xviii) CRITICAL-1: flag OFF carries no dataLineage/policyOrigin even for a manifest-row field (ipos.issue_size)', async () => {
    const featureFlags = await import('../../../src/config/feature-flags.js');
    (featureFlags.FEATURE_FLAGS as any).ENABLE_POLICY_WRITER = false;
    try {
      vi.mocked(mockFieldSourcesRepo.findByIPOId).mockResolvedValue([]);

      await service.consolidateIPOData({
        ipoId: 'policy-test',
        tableName: 'ipos',
        incomingData: { issueSize: 54210000000 },
        existingData: { issueSize: 30850000000, segment: 'MAINBOARD' },
        source: 'CHITTORGARH',
        confidence: 80,
      });

      const call = vi.mocked(mockFieldSourcesRepo.trackFieldUpdate).mock.calls.find(
        (c) => c[0].fieldName === 'issueSize'
      );
      expect(call).toBeDefined();
      // undefined, matching the pre-S1d call shape's effective value (drizzle/JSON both treat
      // an explicit `undefined` the same as an omitted key -- no manifest read, no resolver
      // call, nothing written to data_lineage).
      expect(call![0].dataLineage).toBeUndefined();
    } finally {
      (featureFlags.FEATURE_FLAGS as any).ENABLE_POLICY_WRITER = true;
    }
  });
});
