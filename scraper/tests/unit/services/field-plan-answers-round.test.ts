/**
 * Item 42 (OD-163(a)+(b)): the answers-only round on the REAL `runAnswersOnlyRound`, with the real
 * `askEveryListedRank`, `mergeHeldWitnesses` and `computeVerdict`. Only the fetchers, the policy and
 * the two stores are fakes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { FEATURE_FLAGS } from '../../../src/config/feature-flags.js';
import {
  runAnswersOnlyRound,
  type AnswersRoundStore,
  type AnswersRoundCandidate,
} from '../../../src/services/field-plan-answers-round.js';
import type { FieldFetcher, FieldPlanWalkDeps } from '../../../src/services/field-plan-walk.js';

const IPO_ID = 'ipo-42';
const openBudget = () => ({ deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 });

type Row = { source: string; value: unknown; witnesses: unknown; verdict: string | null };

function setup(opts: { status?: string; roundAt?: Date | null; candidates?: AnswersRoundCandidate[] } = {}) {
  // One stored value written by SYSTEM (consolidation), with no other-source answers (F-226).
  const rows = new Map<string, Row>([
    ['ipos||issueSize', { source: 'CHITTORGARH', value: 1_000_000_000, witnesses: null, verdict: null }],
  ]);
  const ipoState = { status: opts.status ?? 'OPEN', answersRoundAt: opts.roundAt ?? null };
  const candidates = opts.candidates ?? [{ tableName: 'ipos', rowKey: '', fieldName: 'issue_size' }];
  const store: AnswersRoundStore & { stamps: number } = {
    stamps: 0,
    readIpo: vi.fn(async () => ({ ...ipoState })),
    // Mirrors the real store: a value with recorded answers is never listed again.
    listUnanswered: vi.fn(async () =>
      candidates.filter((c) => {
        const r = rows.get(`${c.tableName}|${c.rowKey}|issueSize`);
        return !!r && !(Array.isArray(r.witnesses) && r.witnesses.length > 0);
      })
    ),
    markRoundDone: vi.fn(async () => {
      if (ipoState.answersRoundAt) return false;
      ipoState.answersRoundAt = new Date('2026-10-02T10:00:00Z');
      store.stamps += 1;
      return true;
    }),
  };
  const nse = vi.fn<FieldFetcher>(async () => ({ outcome: 'SUPPLIED', value: 1_000_000_000 }));
  const bse = vi.fn<FieldFetcher>(async () => ({ outcome: 'NOT_PRINTED' }));
  const cg = vi.fn<FieldFetcher>(async () => {
    throw new Error('socket hang up');
  });
  const doc = vi.fn<FieldFetcher>(async () => ({
    outcome: 'SUPPLIED',
    value: 999,
    credited: 'DOCUMENT_VALUE_STORED',
    documentType: 'RHP',
  }) as never);
  const orchestrator = {
    consolidatedUpsertIPO: vi.fn(),
    consolidatedUpsertChildRows: vi.fn(),
  };
  const fieldPlanRepository = { recordOutcome: vi.fn(), claimNextDueField: vi.fn() };
  const onHeldFieldAnswers = vi.fn();
  const trackHeldFieldWitnesses = vi.fn(async (input: any) => {
    const r = rows.get(`${input.tableName}|${input.rowKey}|${input.fieldName}`);
    if (!r) return { updated: false };
    const next = input.merge(r.witnesses);
    if (!next) return { updated: false };
    r.witnesses = next.witnesses;
    r.verdict = next.verdict;
    return { updated: true };
  });
  const deps = {
    fieldPlanRepository: fieldPlanRepository as never,
    orchestrator: orchestrator as never,
    sourceFetchers: { DOC: doc, NSE: nse, BSE: bse, CHITTORGARH: cg } as never,
    ipoRepository: { findById: async () => ({ segment: 'MAINBOARD', listingExchanges: ['NSE', 'BSE'] }) } as never,
    resolvePolicy: async () => ({ ranks: ['DOC', 'NSE', 'BSE', 'CHITTORGARH'], origin: 'MANIFEST' }) as never,
    trackHeldFieldWitnesses,
    onHeldFieldAnswers,
  } as FieldPlanWalkDeps & { trackHeldFieldWitnesses: typeof trackHeldFieldWitnesses };
  return { rows, store, deps, nse, bse, cg, doc, orchestrator, fieldPlanRepository, onHeldFieldAnswers, ipoState };
}

describe('item 42: answers-only round (OD-163)', () => {
  afterEach(() => {
    FEATURE_FLAGS.ENABLE_VERDICT_WRITER = false;
  });

  it('records every listed source answer (OD-103 shape) on a SYSTEM-written value and changes no stored value', async () => {
    FEATURE_FLAGS.ENABLE_VERDICT_WRITER = true;
    const s = setup();
    const before = { ...s.rows.get('ipos||issueSize')! };

    const r = await runAnswersOnlyRound(IPO_ID, s.deps, s.store, openBudget(), { listedAllowed: false });

    expect(r).toMatchObject({ mode: 'ROUND', asked: 1, recorded: 1, notRecorded: 0, roundStamped: true });
    const row = s.rows.get('ipos||issueSize')!;
    // The page value, its source: untouched.
    expect(row.value).toBe(before.value);
    expect(row.source).toBe(before.source);
    expect(s.orchestrator.consolidatedUpsertIPO).not.toHaveBeenCalled();
    expect(s.orchestrator.consolidatedUpsertChildRows).not.toHaveBeenCalled();
    expect(s.fieldPlanRepository.recordOutcome).not.toHaveBeenCalled();
    // The held hook (OD-106 override = a value change) is never called by the round.
    expect(s.onHeldFieldAnswers).not.toHaveBeenCalled();
    const w = row.witnesses as any[];
    expect(w.map((x) => [x.source, x.outcome])).toEqual([
      ['DOC', 'SUPPLIED'],
      ['NSE', 'SUPPLIED'],
      ['BSE', 'NOT_PRINTED'],
      ['CHITTORGARH', 'FAILED'],
    ]);
    // Not SUPPLIED -> null value + cause; credited -> marker, null value.
    expect(w[2].value).toBeNull();
    expect(w[3].value).toBeNull();
    expect(w[3].cause).toMatch(/THROWN:socket hang up/);
    expect(w[0]).toMatchObject({ credited: 'DOCUMENT_VALUE_STORED', value: null });
    expect(w[1].value).toBe(1_000_000_000);
    // Each source asked exactly once, from its own record (held context).
    expect(s.nse).toHaveBeenCalledTimes(1);
    expect(s.nse).toHaveBeenCalledWith(IPO_ID, 'ipos', '', 'issue_size', { held: true });
  });

  it('a credited answer never votes: one SUPPLIED vote is not a disagreement with the credited 999', async () => {
    FEATURE_FLAGS.ENABLE_VERDICT_WRITER = true;
    const s = setup();
    s.nse.mockImplementation(async () => ({ outcome: 'SUPPLIED', value: 5 }));
    await runAnswersOnlyRound(IPO_ID, s.deps, s.store, openBudget(), { listedAllowed: false });
    // The only vote is NSE's; a credited DOC answer voting would make it a disagreement.
    expect(s.rows.get('ipos||issueSize')!.verdict).toBe('UNCONFIRMED');
  });

  it('runs once per IPO: the stamp is set, and a second call asks no source for the round', async () => {
    FEATURE_FLAGS.ENABLE_VERDICT_WRITER = true;
    const s = setup();
    await runAnswersOnlyRound(IPO_ID, s.deps, s.store, openBudget(), { listedAllowed: false });
    const second = await runAnswersOnlyRound(IPO_ID, s.deps, s.store, openBudget(), { listedAllowed: false });
    expect(second.mode).toBe('AFTER_ROUND');
    expect(second.asked).toBe(0);
    expect(s.store.stamps).toBe(1);
    expect(s.nse).toHaveBeenCalledTimes(1);
    // After the round, only values written after the stamp are listed (OD-163(a)).
    expect((s.store.listUnanswered as any).mock.calls[1][1]).toEqual(new Date('2026-10-02T10:00:00Z'));
  });

  it('a value whose every source failed is still recorded (failure causes), so it is not asked again', async () => {
    FEATURE_FLAGS.ENABLE_VERDICT_WRITER = true;
    const s = setup();
    for (const f of [s.doc, s.nse, s.bse]) f.mockImplementation(async () => { throw new Error('down'); });
    const r = await runAnswersOnlyRound(IPO_ID, s.deps, s.store, openBudget(), { listedAllowed: false });
    expect(r.recorded).toBe(1);
    expect((s.rows.get('ipos||issueSize')!.witnesses as any[]).every((x) => x.outcome === 'FAILED' && x.value === null)).toBe(true);
  });

  it('an answer that cannot be classified is FAILED with its cause, never SUPPLIED (fail closed)', async () => {
    FEATURE_FLAGS.ENABLE_VERDICT_WRITER = true;
    const s = setup();
    s.bse.mockImplementation(async () => ({ outcome: 'MAYBE' }) as never);
    await runAnswersOnlyRound(IPO_ID, s.deps, s.store, openBudget(), { listedAllowed: false });
    const bse = (s.rows.get('ipos||issueSize')!.witnesses as any[]).find((x) => x.source === 'BSE');
    expect(bse).toMatchObject({ outcome: 'FAILED', value: null });
    expect(bse.cause).toMatch(/UNCLASSIFIED_ANSWER:MAYBE/);
  });

  it('LISTED: skipped in the normal slots, runs only from the 22:00 closed-IPO job (listedAllowed)', async () => {
    FEATURE_FLAGS.ENABLE_VERDICT_WRITER = true;
    const s = setup({ status: 'LISTED' });
    const slot = await runAnswersOnlyRound(IPO_ID, s.deps, s.store, openBudget(), { listedAllowed: false });
    expect(slot.mode).toBe('SKIPPED');
    expect(s.nse).not.toHaveBeenCalled();
    expect(s.store.stamps).toBe(0);
    const job = await runAnswersOnlyRound(IPO_ID, s.deps, s.store, openBudget(), { listedAllowed: true });
    expect(job).toMatchObject({ mode: 'ROUND', recorded: 1, roundStamped: true });
  });

  it('stops at the shared deadline and does NOT stamp the round, so the rest resumes next time', async () => {
    FEATURE_FLAGS.ENABLE_VERDICT_WRITER = true;
    const s = setup();
    const r = await runAnswersOnlyRound(IPO_ID, s.deps, s.store, { deadlineMs: 0, now: () => 1 }, { listedAllowed: false });
    expect(r).toMatchObject({ stoppedAtDeadline: true, asked: 0, roundStamped: false });
    expect(s.nse).not.toHaveBeenCalled();
  });

  it('flag off: asks nothing and stamps nothing', async () => {
    const s = setup();
    const r = await runAnswersOnlyRound(IPO_ID, s.deps, s.store, openBudget(), { listedAllowed: true });
    expect(r.mode).toBe('SKIPPED');
    expect(s.nse).not.toHaveBeenCalled();
    expect(s.store.stamps).toBe(0);
  });
});
