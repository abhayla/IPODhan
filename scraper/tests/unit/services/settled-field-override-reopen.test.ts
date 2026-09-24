// implements: #968 (spec §2.3.5, OD-73, OD-95) -- an override reopens a SETTLED plan row only on a
// real order change, the narrowing holds, a lower-ranked source never overwrites, expiry restores.
import { describe, it, expect, vi } from 'vitest';
import {
  decideSettledOverride,
  narrowRanksForReopen,
  sourcesAbove,
  type SettledPlanRowView,
} from '../../../../packages/shared/src/utils/settled-field-override-reopen';
import {
  walkFieldPlanForIPO,
  type FieldFetcher,
  type FieldPlanWalkDeps,
} from '../../../src/services/field-plan-walk.js';
import { fieldResult, consolidatedUpsertResultFixture } from '../../helpers/consolidation-result-fixture.js';

/**
 * The 24 SUPPLIED rows on ipodhan_staging (read-only, 2026-09-24) whose chosen source is not
 * rank 1 -- the rows #967's "chosen_source is rank 2/3" condition reopened on every data slot
 * with NO override present. Shapes and counts copied from the staging query, one entry per
 * distinct (field, chosen, ranks, policy_origin).
 */
const STAGING_24: Array<{ n: number; row: SettledPlanRowView; field: string }> = [
  {
    n: 9,
    field: 'ipos.issue_size',
    row: supplied('CHITTORGARH', ['DOC', 'CHITTORGARH', null], 'registry:2'),
  },
  {
    n: 8,
    field: 'ipos.issue_size',
    row: supplied('CHITTORGARH', ['DOC', 'BSE', 'CHITTORGARH'], null),
  },
  {
    n: 4,
    field: 'ipos.symbol',
    row: supplied('NSE', ['DOC', 'NSE', 'CHITTORGARH'], 'registry:2'),
  },
  {
    n: 2,
    field: 'ipos.symbol',
    row: supplied('NSE', ['DOC', 'NSE', 'BSE'], 'registry:2'),
  },
  {
    n: 1,
    field: 'ipos.company_name',
    row: supplied('NSE', ['DOC', 'NSE', 'CHITTORGARH'], 'registry:2'),
  },
];

function supplied(
  chosen: string,
  ranks: [string | null, string | null, string | null],
  policyOrigin: string | null,
  reopenedUnderPolicy: string | null = null,
  state = 'SUPPLIED'
): SettledPlanRowView {
  return {
    state,
    chosenSource: chosen,
    rank1Source: ranks[0],
    rank2Source: ranks[1],
    rank3Source: ranks[2],
    policyOrigin,
    reopenedUnderPolicy,
  };
}

const order = (r: SettledPlanRowView) => ({
  rank1Source: r.rank1Source,
  rank2Source: r.rank2Source,
  rank3Source: r.rank3Source,
});

describe('#968 the rule -- no override reopens nothing', () => {
  it('no-override-reopens-nothing: the 24 staging rows re-planned with the registry order decide NONE, twice', () => {
    expect(STAGING_24.reduce((s, x) => s + x.n, 0)).toBe(24);
    for (const { row } of STAGING_24) {
      for (let pass = 0; pass < 2; pass++) {
        expect(
          decideSettledOverride(row, {
            ...order(row),
            policyOrigin: 'registry:2',
          })
        ).toEqual({ action: 'NONE' });
      }
    }
  });

  it('a registry order CHANGE (manifest bump) still never reopens a SUPPLIED row -- only an override does', () => {
    const row = supplied('CHITTORGARH', ['DOC', 'CHITTORGARH', null], 'registry:2');
    const bumped = {
      rank1Source: 'BSE',
      rank2Source: 'DOC',
      rank3Source: 'CHITTORGARH',
      policyOrigin: 'registry:3',
    };
    expect(decideSettledOverride(row, bumped)).toEqual({ action: 'NONE' });
  });

  it('an override that ranks NO new source above the settling one does not reopen', () => {
    // CHITTORGARH settled; the override only swaps the order BELOW it or keeps DOC above it.
    const row = supplied('CHITTORGARH', ['DOC', 'CHITTORGARH', null], 'registry:2');
    const same = {
      rank1Source: 'DOC',
      rank2Source: 'CHITTORGARH',
      rank3Source: null,
      policyOrigin: 'override:a',
    };
    const promoted = {
      rank1Source: 'CHITTORGARH',
      rank2Source: 'DOC',
      rank3Source: null,
      policyOrigin: 'override:b',
    };
    expect(decideSettledOverride(row, same)).toEqual({ action: 'NONE' });
    expect(decideSettledOverride(row, promoted)).toEqual({ action: 'NONE' });
  });

  it('the Swap Test override (CHITTORGARH over DOC) reopens a DOC-settled row, once, under that override', () => {
    const row = supplied('DOC', ['DOC', 'BSE', 'CHITTORGARH'], 'registry:2');
    const swap = {
      rank1Source: 'CHITTORGARH',
      rank2Source: 'DOC',
      rank3Source: null,
      policyOrigin: 'override:swap',
    };
    expect(decideSettledOverride(row, swap)).toEqual({
      action: 'REOPEN',
      underPolicy: 'override:swap',
    });
    // The next pass reads the reopened row: same override -> nothing more.
    const reopened = {
      ...row,
      state: 'PENDING',
      reopenedUnderPolicy: 'override:swap',
    };
    expect(decideSettledOverride(reopened, swap)).toEqual({ action: 'NONE' });
  });

  it('an ADMIN-settled row is never reopened by an override (layer 3)', () => {
    const row = supplied('ADMIN', ['DOC', 'BSE', null], 'registry:2');
    const ov = {
      rank1Source: 'BSE',
      rank2Source: 'DOC',
      rank3Source: null,
      policyOrigin: 'override:x',
    };
    expect(decideSettledOverride(row, ov)).toEqual({ action: 'NONE' });
  });
});

describe('#968 the rule -- expiry and replacement, no flip-flop', () => {
  const reopened = supplied('DOC', ['DOC', 'BSE', null], 'registry:2', 'override:swap', 'PENDING');

  it('override-expiry-no-flip-flop: expired before re-supply -> RESTORE, then the restored row stays NONE', () => {
    const registry = {
      rank1Source: 'DOC',
      rank2Source: 'BSE',
      rank3Source: null,
      policyOrigin: 'registry:2',
    };
    expect(decideSettledOverride(reopened, registry)).toEqual({
      action: 'RESTORE',
    });
    const restored = {
      ...reopened,
      state: 'SUPPLIED',
      reopenedUnderPolicy: null,
    };
    for (let pass = 0; pass < 3; pass++)
      expect(decideSettledOverride(restored, registry)).toEqual({
        action: 'NONE',
      });
  });

  it('a row re-supplied under the override keeps its new value after expiry (never reopened by the registry)', () => {
    const resupplied = supplied('CHITTORGARH', ['DOC', 'BSE', null], 'override:swap');
    const registry = {
      rank1Source: 'DOC',
      rank2Source: 'BSE',
      rank3Source: null,
      policyOrigin: 'registry:2',
    };
    expect(decideSettledOverride(resupplied, registry)).toEqual({
      action: 'NONE',
    });
  });

  it('a replacing override that still outranks the settling source RETARGETs; one that does not RESTOREs', () => {
    const stillAbove = {
      rank1Source: 'NSE',
      rank2Source: 'DOC',
      rank3Source: null,
      policyOrigin: 'override:y',
    };
    const notAbove = {
      rank1Source: 'DOC',
      rank2Source: 'BSE',
      rank3Source: null,
      policyOrigin: 'override:z',
    };
    expect(decideSettledOverride(reopened, stillAbove)).toEqual({
      action: 'RETARGET',
      underPolicy: 'override:y',
    });
    expect(decideSettledOverride(reopened, notAbove)).toEqual({
      action: 'RESTORE',
    });
  });
});

describe('#968 the narrowing', () => {
  it('is the prefix above the settling source; an unranked settling source is outranked by all', () => {
    expect(narrowRanksForReopen(['CHITTORGARH', 'DOC', 'BSE'], 'DOC')).toEqual(['CHITTORGARH']);
    expect(narrowRanksForReopen(['CHITTORGARH', 'DOC'], 'CHITTORGARH')).toEqual([]);
    expect(narrowRanksForReopen(['NSE', 'BSE'], 'DOC')).toEqual(['NSE', 'BSE']);
    expect(sourcesAbove(['DOC', null, 'BSE'], 'BSE')).toEqual(['DOC']);
  });
});

// ------------------------------------------------------------------ the walk ---

const IPO_ID = '00000000-0000-4000-8000-000000968a01';

function reopenedRow(over: Record<string, unknown> = {}) {
  return {
    id: 'plan-968',
    ipoId: IPO_ID,
    tableName: 'ipos',
    rowKey: '',
    fieldName: 'issue_size',
    rank1Source: 'DOC',
    rank2Source: 'BSE',
    rank3Source: null,
    state: 'PENDING' as const,
    chosenSource: 'DOC',
    chosenRank: 1,
    attempts: 3,
    claimToken: 'tok-968',
    manifestVersion: 2,
    policyOrigin: 'registry:2',
    reopenedUnderPolicy: 'override:swap',
    ...over,
  };
}

function makeRepo(row: any) {
  const queue = [row];
  return {
    recorded: [] as any[],
    restored: [] as any[],
    claimNextDueField: vi.fn(async () => queue.shift() ?? null),
    recordOutcome: vi.fn(async function (this: any, p: any) {
      repoRef.recorded.push(p);
      return { written: true };
    }),
    releaseClaimUnrecorded: vi.fn(async () => ({ released: true })),
    restoreSettledAfterReopen: vi.fn(async (p: any) => {
      repoRef.restored.push(p);
      return { restored: true };
    }),
  };
}
let repoRef: ReturnType<typeof makeRepo>;

function walkDeps(row: any, fetchers: Record<string, FieldFetcher>, policyRanks: string[], origin: string) {
  repoRef = makeRepo(row);
  const orchestrator = {
    consolidatedUpsertIPO: vi.fn(async (scraped: any, source: any, _c?: any, _p?: any, only?: string[]) =>
      consolidatedUpsertResultFixture({
        ipoId: IPO_ID,
        fieldResults: only?.[0] ? [fieldResult(only[0], scraped[only[0]], source)] : [],
      })
    ),
    consolidatedUpsertChildRows: vi.fn(),
  };
  const [kind, id] = origin.split(':');
  const d = {
    fieldPlanRepository: repoRef as any,
    orchestrator: orchestrator as any,
    sourceFetchers: fetchers as any,
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Reopen Test Ltd',
        symbol: 'RTL',
        isin: 'INE000A00968',
        offeringType: 'IPO',
        openDate: '2026-09-01',
        segment: 'MAINBOARD',
        listingExchanges: ['NSE', 'BSE'],
      })),
    } as any,
    resolvePolicy: () => ({
      ranks: policyRanks,
      documentType: undefined,
      origin:
        kind === 'override'
          ? { kind: 'override', id, expiresAt: '2026-10-24T00:00:00Z' }
          : { kind: 'registry', version: Number(id) },
      na: false,
      incapable: {},
    }),
  } as unknown as FieldPlanWalkDeps;
  return { d, orchestrator };
}

const budget = () => ({ deadlineMs: 1_000_000, now: () => 0 });
const answers = (value: number): FieldFetcher =>
  vi.fn(async () => ({ outcome: 'SUPPLIED', value, documentType: 'RHP', page: 3 }) as any);
const notPrinted: FieldFetcher = vi.fn(async () => ({ outcome: 'NOT_PRINTED' }) as any);

describe('#968 the walk honours the stored narrowing', () => {
  it('lower-rank-never-overwrites: only sources above the settling DOC are asked; none answers -> restored, nothing written', async () => {
    const doc = answers(111);
    const bse = answers(222);
    const { d, orchestrator } = walkDeps(
      reopenedRow(),
      { CHITTORGARH: notPrinted, DOC: doc, BSE: bse },
      ['CHITTORGARH', 'DOC', 'BSE'],
      'override:swap'
    );
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(notPrinted).toHaveBeenCalledTimes(1);
    expect(doc).not.toHaveBeenCalled();
    expect(bse).not.toHaveBeenCalled();
    expect(orchestrator.consolidatedUpsertIPO).not.toHaveBeenCalled();
    expect(repoRef.recorded).toHaveLength(0);
    expect(repoRef.restored).toHaveLength(1);
    expect(repoRef.restored[0].cause).toMatch(/^OVERRIDE_RESTORED: no source above DOC/);
  });

  it('lower-rank-never-overwrites: NOT_AVAILABLE_YET above never falls to a provisional value from DOC or BSE', async () => {
    const nay: FieldFetcher = vi.fn(async () => ({ outcome: 'NOT_AVAILABLE_YET' }) as any);
    const doc = answers(111);
    const bse = answers(222);
    const { d, orchestrator } = walkDeps(
      reopenedRow(),
      { CHITTORGARH: nay, DOC: doc, BSE: bse },
      ['CHITTORGARH', 'DOC', 'BSE'],
      'override:swap'
    );
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(doc).not.toHaveBeenCalled();
    expect(bse).not.toHaveBeenCalled();
    expect(orchestrator.consolidatedUpsertIPO).not.toHaveBeenCalled();
    expect(repoRef.recorded[0].state).toBe('NOT_AVAILABLE_YET');
    expect(repoRef.restored).toHaveLength(0);
  });

  it('a higher source that answers replaces the value: SUPPLIED with its rank in the override order', async () => {
    const cg = answers(333);
    const { d, orchestrator } = walkDeps(
      reopenedRow(),
      { CHITTORGARH: cg, DOC: answers(111) },
      ['CHITTORGARH', 'DOC'],
      'override:swap'
    );
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(orchestrator.consolidatedUpsertIPO).toHaveBeenCalledTimes(1);
    expect(repoRef.recorded[0].state).toBe('SUPPLIED');
    expect(repoRef.recorded[0].chosen.source).toBe('CHITTORGARH');
    expect(repoRef.recorded[0].chosen.rank).toBe(1);
  });

  it('a transient failure above keeps the row open and narrowed (CHECK_FAILED), never restored or overwritten', async () => {
    const boom: FieldFetcher = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    });
    const doc = answers(111);
    const { d } = walkDeps(reopenedRow(), { CHITTORGARH: boom, DOC: doc }, ['CHITTORGARH', 'DOC'], 'override:swap');
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(doc).not.toHaveBeenCalled();
    expect(repoRef.recorded[0].state).toBe('CHECK_FAILED');
    expect(repoRef.restored).toHaveLength(0);
  });

  it('override-expiry-no-flip-flop at walk time: the effective order is the registry again -> restored, nothing asked', async () => {
    const cg = answers(333);
    const doc = answers(111);
    const { d } = walkDeps(reopenedRow(), { CHITTORGARH: cg, DOC: doc }, ['DOC', 'BSE'], 'registry:2');
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(cg).not.toHaveBeenCalled();
    expect(doc).not.toHaveBeenCalled();
    expect(repoRef.recorded).toHaveLength(0);
    expect(repoRef.restored[0].cause).toMatch(/no longer the effective order \(now registry:2\)/);
  });

  it('a row with no narrowing walks exactly as before (all ranks, rank 1 wins)', async () => {
    const doc = answers(111);
    const { d } = walkDeps(
      reopenedRow({
        reopenedUnderPolicy: null,
        chosenSource: null,
        chosenRank: null,
      }),
      { DOC: doc, BSE: answers(2) },
      ['DOC', 'BSE'],
      'registry:2'
    );
    await walkFieldPlanForIPO(IPO_ID, d, budget());
    expect(doc).toHaveBeenCalledTimes(1);
    expect(repoRef.recorded[0].chosen.source).toBe('DOC');
    expect(repoRef.restored).toHaveLength(0);
  });
});
