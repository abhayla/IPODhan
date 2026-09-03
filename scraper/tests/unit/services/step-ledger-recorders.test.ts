import { describe, it, expect } from 'vitest';
import {
  planDiscoverySteps,
  planDocumentRunSteps,
  planExtractionSteps,
  planExtractionFailureSteps,
  planPersistSteps,
  planLifecycleSteps,
  backoffNextDueAt,
  BACKOFF_CAP_MS,
} from '../../../src/services/step-ledger-recorders.js';
import { isPipelineStepId } from '@ipodhan/shared';
import type { IpoRunResult } from '../../../src/services/document-discovery-runner.js';
import type { FilingExtraction, PersistFilingSummary } from '../../../src/services/filing-persister.js';

/**
 * S-02. These are the mappers that decide what the ledger SAYS a run did. If one
 * of them is wrong the ledger lies confidently, which is worse than the empty
 * ledger S-01 shipped — so every mapper is tested as a pure function, with no
 * database, no Redis and no network.
 */

const byId = (writes: { stepId: string }[]) => new Map(writes.map((w) => [w.stepId, w as never]));

describe('planDiscoverySteps — B and F from one upsertIPO', () => {
  const base = {
    source: 'NSE',
    created: true,
    fields: ['companyName', 'slug', 'issueSize'],
    offeringType: 'IPO',
    consolidated: false,
    fieldSourcesWritten: true,
    companyName: 'Rays Of Belief Ltd',
  };

  it('records B2 for an NSE write and B1 for a BSE write, never both', () => {
    expect(byId(planDiscoverySteps(base)).has('B2')).toBe(true);
    expect(byId(planDiscoverySteps(base)).has('B1')).toBe(false);
    const bse = byId(planDiscoverySteps({ ...base, source: 'BSE' }));
    expect(bse.has('B1')).toBe(true);
    expect(bse.has('B2')).toBe(false);
  });

  it('records B3..B7 on every write, and marks B6/B7 as insert vs update', () => {
    const created = byId(planDiscoverySteps(base));
    for (const id of ['B3', 'B4', 'B5', 'B6', 'B7']) {
      expect(created.get(id).status).toBe('DONE');
    }
    expect(created.get('B6').evidence).toEqual({ matched: 'new' });
    expect(created.get('B7').evidence).toEqual({ path: 'insert' });

    const updated = byId(planDiscoverySteps({ ...base, created: false }));
    expect(updated.get('B6').evidence).toEqual({ matched: 'existing' });
    expect(updated.get('B7').evidence).toEqual({ path: 'update' });
  });

  it('B4 is NOT_AVAILABLE_YET when the source supplied no offering type', () => {
    const w = byId(planDiscoverySteps({ ...base, offeringType: null }));
    expect(w.get('B4').status).toBe('NOT_AVAILABLE_YET');
  });

  it('maps aggregator sources to their F step', () => {
    expect(byId(planDiscoverySteps({ ...base, source: 'CHITTORGARH' })).has('F1')).toBe(true);
    expect(byId(planDiscoverySteps({ ...base, source: 'MONEYCONTROL' })).has('F2')).toBe(true);
    expect(byId(planDiscoverySteps({ ...base, source: 'INVESTORGAIN_GMP' })).has('F3')).toBe(true);
  });

  it('claims F4/F5 ONLY when consolidation actually ran', () => {
    const noConsolidation = byId(planDiscoverySteps({ ...base, consolidated: false }));
    expect(noConsolidation.has('F4')).toBe(false);
    expect(noConsolidation.has('F5')).toBe(false);

    const consolidated = byId(
      planDiscoverySteps({
        ...base,
        consolidated: true,
        conflictsDetected: 2,
        conflictsBySeverity: { CRITICAL: 1, WARNING: 1 },
      })
    );
    expect(consolidated.get('F4').status).toBe('DONE');
    expect(consolidated.get('F5').evidence).toMatchObject({ conflictsDetected: 2 });
  });

  it('zero conflicts is a DONE F5 with count 0 — the comparison ran, it found nothing', () => {
    const w = byId(planDiscoverySteps({ ...base, consolidated: true, conflictsDetected: 0 }));
    expect(w.get('F5').status).toBe('DONE');
    expect(w.get('F5').evidence).toMatchObject({ conflictsDetected: 0 });
  });

  it('skips F6 when no provenance rows were written', () => {
    expect(byId(planDiscoverySteps({ ...base, fieldSourcesWritten: false })).has('F6')).toBe(false);
  });

  it('emits only ids that exist in the catalogue', () => {
    for (const w of planDiscoverySteps({ ...base, consolidated: true })) {
      expect(isPipelineStepId(w.stepId)).toBe(true);
    }
  });
});

function runResult(overrides: Partial<IpoRunResult> = {}): IpoRunResult {
  return {
    ipoId: 'ipo-1',
    companyName: 'Rays Of Belief Ltd',
    stage: 'OPEN',
    skipped: false,
    skipReason: '',
    due: [],
    found: [],
    notYetFiled: [],
    notFound: [],
    blocked: [],
    notApplicable: [],
    superseded: [],
    leadManagers: [],
    attempts: [],
    networkCalls: 0,
    ...overrides,
  } as IpoRunResult;
}

describe('planDocumentRunSteps — C, D, I3, I4 from the attempt log', () => {
  it('a rung that produced a document is DONE; one that answered with nothing is NOT_AVAILABLE_YET', () => {
    const w = byId(
      planDocumentRunSteps(
        runResult({
          networkCalls: 3,
          found: ['RHP'] as never,
          attempts: [
            { source: 'BSE', http: 200, ms: 10, outcome: 'downloaded (cover_check: ok)', sha256: 'a'.repeat(64) },
            { source: 'NSE', http: 200, ms: 10, outcome: 'no_pdf_on_detail_page' },
          ] as never,
        })
      )
    );
    expect(w.get('C1').status).toBe('DONE');
    expect(w.get('C2').status).toBe('NOT_AVAILABLE_YET');
  });

  it('a rung whose every attempt failed transport is FAILED, with the outcomes as the error', () => {
    const w = byId(
      planDocumentRunSteps(
        runResult({
          networkCalls: 1,
          attempts: [{ source: 'SEBI', http: 0, ms: 5, outcome: 'timeout:try1of3' }] as never,
        })
      )
    );
    expect(w.get('C3').status).toBe('FAILED');
    expect(w.get('C3').error).toContain('timeout');
  });

  it('writes NOTHING for a rung that was not tried this cycle — a DONE from an earlier cycle survives', () => {
    const w = byId(planDocumentRunSteps(runResult({ attempts: [] as never })));
    for (const id of ['C1', 'C2', 'C3', 'C4']) expect(w.has(id)).toBe(false);
  });

  it('D2 treats a non-PDF rejection as the guard WORKING, not as a failure', () => {
    const w = byId(
      planDocumentRunSteps(
        runResult({
          networkCalls: 1,
          attempts: [{ source: 'NSE', http: 200, ms: 4, outcome: 'rejected:html_body' }] as never,
        })
      )
    );
    expect(w.get('D2').status).toBe('DONE');
    expect(w.get('D2').evidence).toMatchObject({ rejected: 1 });
  });

  it('D3 fires on a sha256 dedup, D4 on a stored document', () => {
    const w = byId(
      planDocumentRunSteps(
        runResult({
          networkCalls: 2,
          found: ['PRICE_BAND_AD'] as never,
          attempts: [
            { source: 'BSE', http: 200, ms: 9, outcome: 'downloaded (cover_check: ok)', sha256: 'b'.repeat(64) },
            { source: 'NSE', http: 200, ms: 0, outcome: 'deduped_by_sha256_to:RHP', sha256: 'b'.repeat(64) },
          ] as never,
        })
      )
    );
    expect(w.get('D3').status).toBe('DONE');
    expect(w.get('D4').status).toBe('DONE');
    expect(w.get('D4').inputRef).toBe('b'.repeat(64));
  });

  it('D5 is claimed only on a genuine zero-call cycle', () => {
    expect(byId(planDocumentRunSteps(runResult({ networkCalls: 0 }))).has('D5')).toBe(true);
    expect(byId(planDocumentRunSteps(runResult({ networkCalls: 4 }))).has('D5')).toBe(false);
  });

  it('never downgrades a DONE rung when a later cycle cannot reach the source', () => {
    const failingRun = runResult({
      networkCalls: 1,
      attempts: [{ source: 'BSE', http: 0, ms: 5, outcome: 'timeout:try1of3' }] as never,
    });

    // Without the existing map (the fallback), the FAILED is written.
    expect(byId(planDocumentRunSteps(failingRun)).get('C1').status).toBe('FAILED');

    // With it, a C1 that an earlier cycle earned is left alone: the document is
    // stored, so today's network weather is not evidence it was never found.
    const w = byId(planDocumentRunSteps(failingRun, { existing: { C1: { status: 'DONE' } } }));
    expect(w.has('C1')).toBe(false);
  });

  it('still UPGRADES to DONE over any earlier status', () => {
    const goodRun = runResult({
      networkCalls: 1,
      found: ['RHP'] as never,
      attempts: [
        { source: 'BSE', http: 200, ms: 8, outcome: 'downloaded (cover_check: ok)', sha256: 'a'.repeat(64) },
      ] as never,
    });
    const w = byId(planDocumentRunSteps(goodRun, { existing: { C1: { status: 'FAILED' }, D4: { status: 'DONE' } } }));
    expect(w.get('C1').status).toBe('DONE');
    expect(w.get('D4').status).toBe('DONE');
  });

  it('I3 on supersession, I4 only when the caller says the issue is withdrawn', () => {
    expect(byId(planDocumentRunSteps(runResult({ superseded: ['DRHP'] as never }))).has('I3')).toBe(true);
    expect(byId(planDocumentRunSteps(runResult())).has('I4')).toBe(false);
    expect(byId(planDocumentRunSteps(runResult(), { withdrawn: true })).has('I4')).toBe(true);
  });
});

function extraction(fields: Record<string, unknown>, status = 'OK'): FilingExtraction {
  return {
    doc_type: 'RHP',
    extraction_status: status,
    unit: 'MILLION',
    fiscal_years: [2024],
    fields: fields as never,
  };
}
const ok = (value: unknown) => ({ value, page: 1, check: { name: 'c', passed: true, detail: 'ok' } });
const nulled = (detail: string) => ({ value: null, page: null, check: { name: 'not_extractable', passed: true, detail } });
const failedCheck = () => ({ value: null, page: null, check: { name: 'c', passed: false, detail: 'check_failed: x' } });

describe('planExtractionSteps — E1..E10 and D6', () => {
  const opts = { docType: 'RHP', documentId: 'doc-1', sourceSha: 'c'.repeat(64), version: 'v1' };

  it('a section with at least one real value is DONE', () => {
    const w = byId(planExtractionSteps(extraction({ price_band_floor: ok(100), qib_pct: ok(50) }), opts));
    expect(w.get('E1').status).toBe('DONE');
    expect(w.get('E2').status).toBe('DONE');
  });

  it('a section present but entirely null is NOT_AVAILABLE_YET with the reasons, not DONE', () => {
    const w = byId(planExtractionSteps(extraction({ peer_companies: nulled('peer_comparison_table_not_in_document') }), opts));
    expect(w.get('E6').status).toBe('NOT_AVAILABLE_YET');
    expect(w.get('E6').evidence).toMatchObject({ fieldsWithValue: 0 });
  });

  it('a section this doc type does not carry at all is NOT_AVAILABLE_YET, never FAILED', () => {
    const w = byId(planExtractionSteps(extraction({ price_band_floor: ok(100) }), opts));
    expect(w.get('E8').status).toBe('NOT_AVAILABLE_YET');
    expect(w.get('E8').evidence).toMatchObject({ reason: 'RHP_does_not_carry_this_section' });
  });

  it('E3 picks up the *_by_fy financial series by suffix', () => {
    const w = byId(planExtractionSteps(extraction({ revenue_by_fy: ok([1, 2, 3]) }), opts));
    expect(w.get('E3').status).toBe('DONE');
  });

  it('E9 reports the arithmetic checks that failed', () => {
    const w = byId(planExtractionSteps(extraction({ price_band_floor: ok(100), shares_monotonic: failedCheck() }), opts));
    expect(w.get('E9').status).toBe('DONE');
    expect(w.get('E9').evidence).toMatchObject({ checksFailed: 1, failedFields: ['shares_monotonic'] });
  });

  it('E10 counts unresolved [•] placeholders', () => {
    const w = byId(planExtractionSteps(extraction({ issue_price: nulled('not_priced_yet') }), opts));
    expect(w.get('E10').evidence).toMatchObject({ placeholderFields: 1, fields: ['issue_price'] });
  });

  it('D6 is DONE when the OCR route ran and FAILED when the document has no text layer', () => {
    expect(byId(planExtractionSteps(extraction({}, 'OK_OCR'), opts)).get('D6').status).toBe('DONE');
    expect(byId(planExtractionSteps(extraction({}, 'NEEDS_OCR'), opts)).get('D6').status).toBe('FAILED');
    expect(byId(planExtractionSteps(extraction({}, 'OK'), opts)).has('D6')).toBe(false);
  });

  it('stamps every E row with the extractor version and the document sha', () => {
    for (const w of planExtractionSteps(extraction({ price_band_floor: ok(1) }), opts)) {
      expect(w.version).toBe('v1');
      expect(w.inputRef).toBe('c'.repeat(64));
    }
  });
});

describe('planExtractionFailureSteps — a failed extractor is loud, not silent', () => {
  it('marks every E step FAILED with the error and a backoff', () => {
    const now = new Date('2026-09-03T10:00:00Z');
    const writes = planExtractionFailureSteps('extractor exited 1: boom', {
      docType: 'RHP',
      version: 'v1',
      attemptsBefore: 0,
      now,
    });
    expect(writes).toHaveLength(10);
    for (const w of writes) {
      expect(w.status).toBe('FAILED');
      expect(w.error).toContain('boom');
      expect(w.nextDueAt.getTime()).toBe(now.getTime() + 15 * 60 * 1000);
    }
  });

  it('backoff doubles per attempt and caps at 6 hours (spec section 5)', () => {
    const now = new Date('2026-09-03T10:00:00Z');
    expect(backoffNextDueAt(0, now).getTime() - now.getTime()).toBe(15 * 60 * 1000);
    expect(backoffNextDueAt(1, now).getTime() - now.getTime()).toBe(30 * 60 * 1000);
    expect(backoffNextDueAt(4, now).getTime() - now.getTime()).toBe(4 * 60 * 60 * 1000);
    expect(backoffNextDueAt(20, now).getTime() - now.getTime()).toBe(BACKOFF_CAP_MS);
  });

  it('MAJOR-2: attempts 0/1/5/10 produce 15min/30min/6h(cap)/6h(cap) offsets', () => {
    const now = new Date('2026-09-03T10:00:00Z');
    expect(backoffNextDueAt(0, now).getTime() - now.getTime()).toBe(15 * 60 * 1000);
    expect(backoffNextDueAt(1, now).getTime() - now.getTime()).toBe(30 * 60 * 1000);
    expect(backoffNextDueAt(5, now).getTime() - now.getTime()).toBe(BACKOFF_CAP_MS);
    expect(backoffNextDueAt(10, now).getTime() - now.getTime()).toBe(BACKOFF_CAP_MS);
  });
});

describe('planPersistSteps — G1..G5 project the persister summary', () => {
  const summary = (o: Partial<PersistFilingSummary> = {}): PersistFilingSummary => ({
    written: {},
    skipped_protected: [],
    skipped_cross_document_disagreement: [],
    skipped_failed_check: [],
    skipped_no_column: [],
    skipped_no_unit: [],
    skipped_unit_mismatch: [],
    ipos_fields: [],
    applied: true,
    ...o,
  });
  const opts = { docType: 'RHP', documentId: 'doc-1', sourceSha: null, version: 'v1' };

  it('G3 is NOT_AVAILABLE_YET when nothing reached ipos, DONE when something did', () => {
    expect(byId(planPersistSteps(summary(), opts)).get('G3').status).toBe('NOT_AVAILABLE_YET');
    expect(byId(planPersistSteps(summary({ ipos_fields: ['issueSize'] }), opts)).get('G3').status).toBe('DONE');
  });

  it('G4 is DONE only when a child table actually took rows', () => {
    expect(byId(planPersistSteps(summary({ written: { promoters: 0 } }), opts)).get('G4').status).toBe(
      'NOT_AVAILABLE_YET'
    );
    const w = byId(planPersistSteps(summary({ written: { promoters: 3, peer_companies: 5 } }), opts));
    expect(w.get('G4').status).toBe('DONE');
    expect(w.get('G4').evidence).toMatchObject({ written: { promoters: 3, peer_companies: 5 } });
  });

  it('G2 carries what the admin lock withheld — the audit trail for a protected field', () => {
    const w = byId(planPersistSteps(summary({ skipped_protected: ['ipos.issue_size'] }), opts));
    expect(w.get('G2').evidence).toMatchObject({ withheldByAdminLock: ['ipos.issue_size'] });
  });
});

describe('planLifecycleSteps — I1/I2 and DUE that never downgrades', () => {
  it('never overwrites a DONE step with DUE', () => {
    const w = byId(
      planLifecycleSteps({
        stage: 'OPEN',
        dueStepIds: ['H1', 'H2'],
        existing: { H1: { status: 'DONE' }, H2: { status: 'NOT_DUE' } },
      })
    );
    expect(w.has('H1')).toBe(false);
    expect(w.get('H2').status).toBe('DUE');
    expect(w.get('I2').evidence).toMatchObject({ dueSteps: ['H1', 'H2'], markedDue: ['H2'] });
  });

  it('re-dues a FAILED step only once its backoff has expired', () => {
    const now = new Date('2026-09-03T12:00:00Z');
    const later = new Date('2026-09-03T13:00:00Z');
    const earlier = new Date('2026-09-03T11:00:00Z');
    expect(
      byId(planLifecycleSteps({ stage: 'OPEN', dueStepIds: ['E3'], existing: { E3: { status: 'FAILED', nextDueAt: later } }, now })).has('E3')
    ).toBe(false);
    expect(
      byId(planLifecycleSteps({ stage: 'OPEN', dueStepIds: ['E3'], existing: { E3: { status: 'FAILED', nextDueAt: earlier } }, now })).get('E3').status
    ).toBe('DUE');
  });

  it('marks a step with no row at all DUE — initStepLedger has not run yet', () => {
    const w = byId(planLifecycleSteps({ stage: 'OPEN', dueStepIds: ['H4'], existing: {} }));
    expect(w.get('H4').status).toBe('DUE');
  });

  it('always records I1 and I2 as DONE with the derived stage', () => {
    const w = byId(planLifecycleSteps({ stage: 'CLOSED', dueStepIds: [] }));
    expect(w.get('I1').status).toBe('DONE');
    expect(w.get('I1').evidence).toEqual({ stage: 'CLOSED' });
    expect(w.get('I2').status).toBe('DONE');
  });
});
