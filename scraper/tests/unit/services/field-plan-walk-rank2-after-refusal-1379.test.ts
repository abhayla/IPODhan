// implements: #1379 -- spec data-sourcing-pull-model.md §5.3 rule 4 (OD-21): "The pull loop then asks rank 2
// for the dropped field (§2.5), and if that fails too the field is written null with a reason (§2.8)";
// §5.3 rule 5 "never on a backoff timer"; OD-62 FAILED_VALIDATION = the extractor needs fixing (not "ask
// again"); OD-56 / OD-66 a stage change or a new document is the event that re-asks.
// Class: every plan row whose rank-N value is REFUSED at the write (a per-field validation rule,
// VALIDATION_RULE_FAILED:<rule>, or the merged-record date rule, #1229) while a lower rank exists -- every
// table, every IPO type (today: ipos.face_value DOC/BSE/NSE and ipos.listing_date NSE/BSE/CHITTORGARH).
// The answer-state table these tests pin is in the PR body (#1379).
import { describe, it, expect, vi } from 'vitest';
import { walkFieldPlanForIPO, type FieldFetcher, type FieldPlanWalkDeps } from '../../../src/services/field-plan-walk.js';
import {
  buildFieldPlanIpoGapKeys,
  fieldPlanClaimGapKeys,
  fieldPlanValidationKeyFor,
} from '../../../src/services/field-plan-gap-keys.js';
import { consolidatedUpsertResultFixture, fieldResult } from '../../helpers/consolidation-result-fixture.js';
import {
  WRITE_REFUSAL_REASONS,
  PRIORITY_LOSS_REASONS,
  VALIDATION_RULE_REFUSAL_PREFIX,
  isPriorityLossReason,
} from '../../../src/services/data-consolidation-service.js';

const IPO_ID = '00000000-0000-4000-8000-000000001379';
const RULE = 'face_value_equity_enum';

const MANIFEST = {
  'ipos.face_value': { rank: { MAINBOARD: ['NSE', 'BSE', 'CHITTORGARH'] }, documentType: 'PRICE_BAND_AD' },
} as never;

function gapKeys(stage = 'UPCOMING', docs: Array<{ id: string; type: string }> = [], rules = 'rules-v1') {
  return buildFieldPlanIpoGapKeys({
    manifestFields: MANIFEST,
    coverageFingerprint: 'cov',
    extractorVersion: 'x1',
    documents: docs.map((d) => ({ ...d, extractionStatus: 'COMPLETED', isActive: true })),
    stage,
    validationRulesFingerprint: rules,
  });
}

function planRow(over: Record<string, unknown> = {}) {
  return {
    id: 'plan-1379',
    ipoId: IPO_ID,
    tableName: 'ipos',
    rowKey: '',
    fieldName: 'face_value',
    rank1Source: 'NSE',
    rank2Source: 'BSE',
    rank3Source: null,
    state: 'PENDING' as const,
    chosenSource: null,
    chosenRank: null,
    attempts: 0,
    cause: null,
    claimToken: 'tok-1379',
    manifestVersion: 2,
    policyOrigin: 'registry:2',
    reopenedUnderPolicy: null,
    ...over,
  };
}

/** Refuses any value not in `valid` the way the consolidator's OD-21 gate does; accepts the rest. */
function refusingOrchestrator(valid: ReadonlySet<unknown>) {
  return {
    consolidatedUpsertIPO: vi.fn(async (scraped: any, source: any) =>
      consolidatedUpsertResultFixture({
        ipoId: IPO_ID,
        fieldResults: [
          valid.has(scraped.faceValue)
            ? fieldResult('faceValue', scraped.faceValue, source)
            : fieldResult('faceValue', null, source, {
                rejectedSources: [{ source, value: scraped.faceValue, reason: `VALIDATION_RULE_FAILED:${RULE}` }],
              }),
        ],
      })
    ),
    consolidatedUpsertChildRows: vi.fn(),
  };
}

type Answer = Awaited<ReturnType<FieldFetcher>>;
const supplied = (value: unknown): Answer => ({ outcome: 'SUPPLIED', value, documentType: undefined, page: undefined }) as Answer;

function setup(opts: {
  row?: Record<string, unknown>;
  ranks?: string[];
  answers: Record<string, Answer | (() => Promise<Answer>)>;
  valid?: unknown[];
  keys?: ReturnType<typeof gapKeys> | null;
}) {
  const recorded: any[] = [];
  const orchestrator = refusingOrchestrator(new Set(opts.valid ?? [10]));
  const fetchers: Record<string, FieldFetcher> = {};
  for (const [src, a] of Object.entries(opts.answers)) {
    fetchers[src] = vi.fn(async () => (typeof a === 'function' ? a() : a)) as FieldFetcher;
  }
  const queue = [planRow(opts.row)];
  const d = {
    fieldPlanRepository: {
      claimNextDueField: vi.fn(async () => queue.shift() ?? null),
      recordOutcome: vi.fn(async (p: any) => {
        recorded.push(p);
        return { written: true };
      }),
      releaseClaimUnrecorded: vi.fn(async () => ({ released: true })),
      restoreSettledAfterReopen: vi.fn(async () => ({ restored: true })),
    } as any,
    orchestrator: orchestrator as any,
    sourceFetchers: fetchers as any,
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID, companyName: 'Refusal Rank Two Ltd', symbol: 'RRT', isin: 'INE000A01379',
        offeringType: 'IPO', openDate: '2026-10-10', segment: 'MAINBOARD', listingExchanges: ['NSE', 'BSE'],
      })),
    } as any,
    resolvePolicy: () => ({
      ranks: opts.ranks ?? ['NSE', 'BSE'],
      documentType: undefined,
      origin: { kind: 'registry', version: 2 },
      na: false,
      incapable: {},
    }),
    ...(opts.keys === null ? {} : { gapKeys: { forIpo: async () => opts.keys ?? gapKeys() } }),
  } as unknown as FieldPlanWalkDeps;
  return { d, recorded, orchestrator, fetchers };
}

const budget = () => ({ deadlineMs: 1_000_000, now: () => 0 });
const writtenSources = (o: ReturnType<typeof refusingOrchestrator>) =>
  o.consolidatedUpsertIPO.mock.calls.map((c: any[]) => `${c[1]}=${c[0].faceValue}`);
const validationKey = (keys = gapKeys()) => fieldPlanValidationKeyFor(keys, 'ipos', 'face_value');

describe('#1379 a value refused at the write moves to rank 2 in the same pass (§5.3 rule 4)', () => {
  it('state 1: rank 2 answers a valid value -> rank 2 is WRITTEN in the same pass, row SUPPLIED from rank 2', async () => {
    const { d, recorded, orchestrator } = setup({ answers: { NSE: supplied(3), BSE: supplied(10) } });
    const result = await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(writtenSources(orchestrator)).toEqual(['NSE=3', 'BSE=10']);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ state: 'SUPPLIED', chosen: { source: 'BSE', rank: 2 } });
    expect(result.fieldsSupplied).toBe(1);
    expect(result.fieldsCheckFailed).toBe(0);
  });

  it('state 2: rank 2 is refused too -> CHECK_FAILED / FAILED_VALIDATION, both refusals in the cause, parked under the validation key (no slot re-ask)', async () => {
    const { d, recorded, orchestrator } = setup({ answers: { NSE: supplied(3), BSE: supplied(4) } });
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(writtenSources(orchestrator)).toEqual(['NSE=3', 'BSE=4']);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'FAILED_VALIDATION', gapKey: validationKey() });
    expect(recorded[0].cause).toContain(`rank1:NSE:VALIDATION_REFUSED:VALIDATION_RULE_FAILED:${RULE}`);
    expect(recorded[0].cause).toContain(`rank2:BSE:VALIDATION_REFUSED:VALIDATION_RULE_FAILED:${RULE}`);
  });

  it('state 3a: rank 2 does not print the field -> CHECK_FAILED / FAILED_VALIDATION under the validation key', async () => {
    const { d, recorded } = setup({ answers: { NSE: supplied(3), BSE: { outcome: 'NOT_PRINTED' } as Answer } });
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'FAILED_VALIDATION', gapKey: validationKey() });
  });

  it('state 3b: rank 2 has not published yet -> parked under the validation key (the stage part reopens it, OD-62)', async () => {
    const { d, recorded } = setup({ answers: { NSE: supplied(3), BSE: { outcome: 'NOT_AVAILABLE_YET' } as Answer } });
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'FAILED_VALIDATION', gapKey: validationKey() });
  });

  it('state 4: rank 2 FAILED transiently -> CHECK_FAILED / FAILED_VALIDATION, NOT parked (next data slot), the refusal token kept in the cause', async () => {
    const { d, recorded } = setup({
      answers: { NSE: supplied(3), BSE: async () => { throw new Error('socket hang up'); } },
    });
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'FAILED_VALIDATION' });
    expect(recorded[0].gapKey).toBeUndefined();
    expect(recorded[0].cause).toMatch(/rank1:NSE:VALIDATION_REFUSED:.*\[refused:[0-9a-f]{12}\]/);
    expect(recorded[0].cause).toContain('rank2:BSE:THROWN:socket hang up');
  });

  it('state 4, next slot: rank 1 answers the SAME bytes under the same key -> its write is NOT repeated; rank 2 is asked again', async () => {
    const first = setup({ answers: { NSE: supplied(3), BSE: async () => { throw new Error('socket hang up'); } } });
    await walkFieldPlanForIPO(IPO_ID, first.d, budget());
    const second = setup({
      row: { state: 'CHECK_FAILED', cause: first.recorded[0].cause, attempts: 1 },
      answers: { NSE: supplied(3), BSE: supplied(10) },
    });
    await walkFieldPlanForIPO(IPO_ID, second.d, budget());
    expect(writtenSources(second.orchestrator)).toEqual(['BSE=10']);
    expect(second.recorded[0]).toMatchObject({ state: 'SUPPLIED', chosen: { source: 'BSE', rank: 2 } });
  });

  it('state 4, next slot: rank 1 answers DIFFERENT bytes -> it is written (validated) again', async () => {
    const first = setup({ answers: { NSE: supplied(3), BSE: async () => { throw new Error('timeout'); } } });
    await walkFieldPlanForIPO(IPO_ID, first.d, budget());
    const second = setup({
      row: { state: 'CHECK_FAILED', cause: first.recorded[0].cause, attempts: 1 },
      answers: { NSE: supplied(5), BSE: supplied(10) },
      valid: [5, 10],
    });
    await walkFieldPlanForIPO(IPO_ID, second.d, budget());
    expect(writtenSources(second.orchestrator)).toEqual(['NSE=5']);
    expect(second.recorded[0]).toMatchObject({ state: 'SUPPLIED', chosen: { source: 'NSE', rank: 1 } });
  });

  it('state 5: no rank 2 exists -> CHECK_FAILED / FAILED_VALIDATION under the validation key', async () => {
    const { d, recorded, orchestrator } = setup({ ranks: ['NSE'], answers: { NSE: supplied(3) } });
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(writtenSources(orchestrator)).toEqual(['NSE=3']);
    expect(recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'FAILED_VALIDATION', gapKey: validationKey() });
  });

  it('state 6: a new document (or a stage change) changes the key, so the same refused bytes are validated again (not skipped)', async () => {
    const first = setup({ ranks: ['NSE'], answers: { NSE: supplied(3) } });
    await walkFieldPlanForIPO(IPO_ID, first.d, budget());
    const newKeys = gapKeys('UPCOMING', [{ id: 'doc-2', type: 'PRICE_BAND_AD' }]);
    const second = setup({
      ranks: ['NSE'],
      row: { state: 'CHECK_FAILED', cause: `[gap-key:${validationKey()}] ${first.recorded[0].cause}` },
      answers: { NSE: supplied(3) },
      keys: newKeys,
    });
    await walkFieldPlanForIPO(IPO_ID, second.d, budget());
    expect(writtenSources(second.orchestrator)).toEqual(['NSE=3']);
    expect(second.recorded[0]).toMatchObject({ gapKey: validationKey(newKeys) });
  });

  it('no gap keys for this IPO -> charged CHECK_FAILED (no gapKey, bounded by the attempts cap), and rank 1 is NOT skipped next time (no key to compare)', async () => {
    const first = setup({ ranks: ['NSE'], answers: { NSE: supplied(3) }, keys: null });
    await walkFieldPlanForIPO(IPO_ID, first.d, budget());
    expect(first.recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'FAILED_VALIDATION' });
    expect(first.recorded[0].gapKey).toBeUndefined();
    const second = setup({ ranks: ['NSE'], row: { cause: first.recorded[0].cause }, answers: { NSE: supplied(3) }, keys: null });
    await walkFieldPlanForIPO(IPO_ID, second.d, budget());
    expect(writtenSources(second.orchestrator)).toEqual(['NSE=3']);
  });

  it('control: a PRIORITY loss on rank 1 is not a refusal -> unchanged LOST_TO_HIGHER_PRIORITY, rank 2 never written', async () => {
    const { d, recorded } = setup({ answers: { NSE: supplied(3), BSE: supplied(10) } });
    (d.orchestrator as any).consolidatedUpsertIPO = vi.fn(async () =>
      consolidatedUpsertResultFixture({ ipoId: IPO_ID, fieldResults: [fieldResult('faceValue', 5, 'DRHP')] })
    );
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect((d.orchestrator as any).consolidatedUpsertIPO).toHaveBeenCalledTimes(1);
    expect(recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'LOST_TO_HIGHER_PRIORITY' });
  });

  it('fail closed: a rejectedSources entry for a DIFFERENT source is not this write\'s refusal (no rank-2 write on it)', async () => {
    const { d, recorded } = setup({ answers: { NSE: supplied(3), BSE: supplied(10) } });
    (d.orchestrator as any).consolidatedUpsertIPO = vi.fn(async () =>
      consolidatedUpsertResultFixture({
        ipoId: IPO_ID,
        fieldResults: [
          fieldResult('faceValue', 5, 'DRHP', {
            rejectedSources: [{ source: 'CHITTORGARH', value: 7, reason: `VALIDATION_RULE_FAILED:${RULE}` }],
          }),
        ],
      })
    );
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect((d.orchestrator as any).consolidatedUpsertIPO).toHaveBeenCalledTimes(1);
    expect(recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'LOST_TO_HIGHER_PRIORITY' });
  });

  it('provisional path: rank 1 not published yet, rank 2 refused -> rank 3 becomes the provisional value; the refusal token rides on the cause', async () => {
    const { d, recorded, orchestrator } = setup({
      ranks: ['NSE', 'BSE', 'CHITTORGARH'],
      answers: { NSE: { outcome: 'NOT_AVAILABLE_YET' } as Answer, BSE: supplied(4), CHITTORGARH: supplied(10) },
    });
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(writtenSources(orchestrator)).toEqual(['BSE=4', 'CHITTORGARH=10']);
    expect(recorded[0]).toMatchObject({ state: 'NOT_AVAILABLE_YET' });
    expect(recorded[0].cause).toMatch(/rank2:BSE:VALIDATION_REFUSED:.*\[refused:[0-9a-f]{12}\]/);
  });

  it('provisional path, next slot: the same refused rank-2 bytes are not written again', async () => {
    const answers = { NSE: { outcome: 'NOT_AVAILABLE_YET' } as Answer, BSE: supplied(4) };
    const first = setup({ answers });
    await walkFieldPlanForIPO(IPO_ID, first.d, budget());
    const second = setup({ row: { state: 'NOT_AVAILABLE_YET', cause: first.recorded[0].cause }, answers });
    await walkFieldPlanForIPO(IPO_ID, second.d, budget());
    expect(writtenSources(second.orchestrator)).toEqual([]);
  });
});

describe('#1379 the validation key: changes on exactly the events that justify a re-ask', () => {
  const base = validationKey(gapKeys('UPCOMING', [], 'r1'));
  it('a stage change (OD-56) changes it', () => expect(validationKey(gapKeys('OPEN', [], 'r1'))).not.toBe(base));
  it('a new COMPLETED document in the field family (OD-66, §5.3 rule 5) changes it', () =>
    expect(validationKey(gapKeys('UPCOMING', [{ id: 'd1', type: 'PRICE_BAND_AD' }], 'r1'))).not.toBe(base));
  it('a corrected validation rule (§5.3 "rules are configuration") changes it', () =>
    expect(validationKey(gapKeys('UPCOMING', [], 'r2'))).not.toBe(base));
  it('nothing new -> the same key (no re-ask)', () => expect(validationKey(gapKeys('UPCOMING', [], 'r1'))).toBe(base));
  it('the claim query offers a row stamped with the current key as NOT due (key listed)', () =>
    expect(fieldPlanClaimGapKeys(gapKeys('UPCOMING', [], 'r1'))['ipos.face_value']).toContain(base));
});

// Round 2 (Tier A MAJOR): EVERY write-time refusal the consolidator can return for this write's source is a
// refusal, not a priority loss. Codes come from the consolidator's own exported constants (never retyped).
describe('#1379 round 2: every write-time refusal code moves to rank 2; only a priority loss is LOST_TO_HIGHER_PRIORITY', () => {
  /** Rank 1 (NSE=3) comes back as the stored value 5 (source DRHP) with `reason` rejecting NSE; rank 2 (BSE=10) lands. */
  function withRank1Rejection(reason: string) {
    const ctx = setup({ answers: { NSE: supplied(3), BSE: supplied(10) } });
    (ctx.d.orchestrator as any).consolidatedUpsertIPO = vi.fn(async (scraped: any, source: any) =>
      consolidatedUpsertResultFixture({
        ipoId: IPO_ID,
        fieldResults: [
          scraped.faceValue === 10
            ? fieldResult('faceValue', 10, source)
            : fieldResult('faceValue', 5, 'DRHP', { rejectedSources: [{ source, value: scraped.faceValue, reason }] }),
        ],
      })
    );
    return ctx;
  }
  const written = (d: any) => d.orchestrator.consolidatedUpsertIPO.mock.calls.map((c: any[]) => `${c[1]}=${c[0].faceValue}`);

  const refusalCodes = [...WRITE_REFUSAL_REASONS, `${VALIDATION_RULE_REFUSAL_PREFIX}${RULE}`, 'SOME_FUTURE_REFUSAL_CODE'];

  it('the list is non-empty and includes VALIDATION_FAILED (matrix bounds, incl. the #1368 NaN case)', () => {
    expect(WRITE_REFUSAL_REASONS.has('VALIDATION_FAILED')).toBe(true);
    expect(WRITE_REFUSAL_REASONS.size).toBeGreaterThanOrEqual(7);
  });

  it.each(refusalCodes)('refusal %s: rank 2 is written in the same pass (SUPPLIED from BSE)', async (reason) => {
    const { d, recorded } = withRank1Rejection(reason);
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(written(d)).toEqual(['NSE=3', 'BSE=10']);
    expect(recorded[0]).toMatchObject({ state: 'SUPPLIED', chosen: { source: 'BSE', rank: 2 } });
  });

  it('an UNKNOWN code is a refusal (fail closed), never a priority loss', () => {
    expect(isPriorityLossReason('SOME_FUTURE_REFUSAL_CODE')).toBe(false);
    expect(isPriorityLossReason(undefined)).toBe(false);
  });

  it.each([...PRIORITY_LOSS_REASONS])('priority loss %s stays LOST_TO_HIGHER_PRIORITY, rank 2 never written', async (reason) => {
    const { d, recorded } = withRank1Rejection(reason);
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(written(d)).toEqual(['NSE=3']);
    expect(recorded[0]).toMatchObject({ state: 'CHECK_FAILED', reasonCode: 'LOST_TO_HIGHER_PRIORITY' });
  });

  it('a same-source WIN whose rejection entry names the old value is not a refusal', async () => {
    const { d, recorded } = setup({ answers: { NSE: supplied(3) } });
    (d.orchestrator as any).consolidatedUpsertIPO = vi.fn(async (_s: any, source: any) =>
      consolidatedUpsertResultFixture({
        ipoId: IPO_ID,
        fieldResults: [fieldResult('faceValue', 3, source, { rejectedSources: [{ source, value: 2, reason: 'SAME_SOURCE_REFRESH' }] })],
      })
    );
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(recorded[0]).toMatchObject({ state: 'SUPPLIED', chosen: { source: 'NSE', rank: 1 } });
  });
});

// Round 2 (MINOR 2): a date-refused row is judged against the STORED dates the rules read, so the key it is parked
// under includes them: a corrected open_date unparks a refused listing_date; a non-date field is unaffected.
describe('#1379 round 2: the validation key of a date field includes the stored date inputs', () => {
  const DATES_MANIFEST = {
    'ipos.listing_date': { rank: { MAINBOARD: ['NSE', 'BSE'] }, documentType: 'PRICE_BAND_AD' },
    'ipos.face_value': { rank: { MAINBOARD: ['NSE', 'BSE'] }, documentType: 'PRICE_BAND_AD' },
  } as never;
  const keysWith = (dates: Record<string, string | null> | null) =>
    buildFieldPlanIpoGapKeys({
      manifestFields: DATES_MANIFEST,
      coverageFingerprint: 'cov',
      extractorVersion: 'x1',
      documents: [],
      stage: 'UPCOMING',
      validationRulesFingerprint: 'r1',
      storedDateInputs: dates,
    });
  const stored = { openDate: '2026-10-10', closeDate: '2026-10-14', allotmentDate: null, listingDate: null };

  it('a corrected open_date changes the listing_date key (the refused row is re-asked)', () =>
    expect(fieldPlanValidationKeyFor(keysWith({ ...stored, openDate: '2026-10-01' }), 'ipos', 'listing_date')).not.toBe(
      fieldPlanValidationKeyFor(keysWith(stored), 'ipos', 'listing_date')
    ));
  it('the same stored dates -> the same key (no re-ask)', () =>
    expect(fieldPlanValidationKeyFor(keysWith({ ...stored }), 'ipos', 'listing_date')).toBe(
      fieldPlanValidationKeyFor(keysWith(stored), 'ipos', 'listing_date')
    ));
  it('a non-date field (face_value) key does not move when a date is corrected', () =>
    expect(fieldPlanValidationKeyFor(keysWith({ ...stored, openDate: '2026-10-01' }), 'ipos', 'face_value')).toBe(
      fieldPlanValidationKeyFor(keysWith(stored), 'ipos', 'face_value')
    ));
});
