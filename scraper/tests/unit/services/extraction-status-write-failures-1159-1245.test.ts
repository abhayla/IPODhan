import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * #1159 item 1 and #1245 item 1: an extraction-status write that fails is never silent, and an
 * attempt whose IN_PROGRESS stamp did not land is never run.
 *
 * Spec basis: data-sourcing-pull-model.md §1.8 (the `extraction_status` value set; every failed attempt's
 * cause kept in `document_extraction_attempts`), §2.2 (an unfinished read is bounded by a COUNT carried
 * on the row, #959), signal-ownership R6 (a failure carries its cause).
 *
 * Class: every extraction-status write `processPendingFilings` makes (filing loop and anchor loop) for
 * every document type: (a) a FAILED / MANUAL_REVIEW / COMPLETED / revert write whose transaction rolls back
 * leaves the row at its previous status, and before this fix nothing logged it; (b) an IN_PROGRESS stamp
 * that fails was followed by "extracting anyway", so the attempt was never counted toward the
 * unfinished-read cap and a repeated stamp failure plus a kill could loop without bound.
 */

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('../../../src/utils/low-priority-spawn.js', () => ({
  withLowPriority: (bin: string, args: string[]) => ({ bin, args }),
  EXTRACTOR_BUSY_EXIT_CODE: 75,
}));
const MOCK_FEATURE_FLAGS = vi.hoisted(() => ({
  ENABLE_FILING_AUTO_PERSIST: false,
  ENABLE_SME_FILING_AUTO_PERSIST: false,
}));
vi.mock('../../../src/config/feature-flags.js', () => ({ FEATURE_FLAGS: MOCK_FEATURE_FLAGS }));
vi.mock('../../../src/services/step-ledger-recorders.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, writeSteps: vi.fn(async (_i: string, w: unknown[]) => w.length), recordLiveStep: vi.fn(async () => 1) };
});

import logger from '../../../src/utils/logger.js';
import {
  processPendingFilings,
  EXTRACTOR_VERSION,
  ANCHOR_DOC_TYPE,
  type AutoPersistDeps,
  type CandidateDocument,
} from '../../../src/services/filing-auto-persist.js';

const SHA = 'c'.repeat(64);
const IPO = { id: 'ipo-1', companyName: 'Stamp Failure Ltd', slug: 'stamp-failure-ltd', segment: 'MAINBOARD' };
const doc = (o: Partial<CandidateDocument> = {}): CandidateDocument => ({
  id: 'doc-1',
  type: 'RHP',
  sha256: SHA,
  extractionStatus: 'PENDING',
  extractedAt: null,
  retryCount: 0,
  updatedAt: null,
  ...o,
});
function deps(overrides: Partial<AutoPersistDeps> = {}): AutoPersistDeps {
  return {
    loadDocuments: vi.fn(async () => [doc()]),
    loadStates: vi.fn(async () => [
      { id: 'state-1', docType: 'RHP', documentId: 'doc-1', extractedAt: null, extractorVersion: null },
    ]),
    runExtractor: vi.fn(() => ({ ok: false as const, error: 'extractor exited 1: parse error' })),
    persistFiling: vi.fn() as never,
    persisterDeps: { protectionFilter: vi.fn() } as never,
    setDocumentExtractionState: vi.fn(async () => undefined),
    setFetchStateExtracted: vi.fn(async () => undefined),
    invalidateCaches: vi.fn(async () => undefined),
    fileExists: () => true,
    storeDir: 'C:/store',
    version: EXTRACTOR_VERSION,
    ...overrides,
  };
}
function anchorDeps(overrides: Partial<AutoPersistDeps> = {}): AutoPersistDeps {
  return deps({
    loadDocuments: vi.fn(async () => [doc({ id: 'anchor-1', type: ANCHOR_DOC_TYPE })]),
    loadStates: vi.fn(async () => [
      { id: 'state-a', docType: ANCHOR_DOC_TYPE, documentId: 'anchor-1', extractedAt: null, extractorVersion: null },
    ]) as never,
    runAnchorPersist: vi.fn(async () => ({ kind: 'manual_review' as const, reason: 'scan unreadable' })) as never,
    ...overrides,
  });
}
const rejectWhen = (status: string, error: Error) =>
  vi.fn(async (w: { status: string }) => {
    if (w.status === status) throw error;
  });

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger as never);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('#1245 item 1: an IN_PROGRESS stamp that fails refuses the extraction (fail closed)', () => {
  it('filing loop: the extractor never runs, nothing is counted as spawned, and the skip names the cause', async () => {
    const d = deps({ setDocumentExtractionState: rejectWhen('IN_PROGRESS', new Error('connection reset')) as never });
    const r = await processPendingFilings(IPO, d);
    expect(d.runExtractor).not.toHaveBeenCalled();
    expect(r.spawned).toBe(0);
    expect(r.skipped.join('\n')).toMatch(/RHP: .*IN_PROGRESS.*connection reset/);
  });

  it('anchor loop: the anchor runner never runs and its spawn budget is not consumed', async () => {
    const budget = { remaining: 1 };
    const d = anchorDeps({
      setDocumentExtractionState: rejectWhen('IN_PROGRESS', new Error('connection reset')) as never,
      anchorSpawnBudget: budget,
    });
    const r = await processPendingFilings(IPO, d);
    expect(d.runAnchorPersist).not.toHaveBeenCalled();
    expect(r.spawned).toBe(0);
    expect(budget.remaining).toBe(1);
    expect(r.skipped.join('\n')).toMatch(new RegExp(`${ANCHOR_DOC_TYPE}: .*IN_PROGRESS.*connection reset`));
  });

  it('a stamp that lands still runs the extractor (control)', async () => {
    const d = deps();
    const r = await processPendingFilings(IPO, d);
    expect(d.runExtractor).toHaveBeenCalledTimes(1);
    expect(r.spawned).toBe(1);
  });
});

describe('#1159 item 1: a failed status write is logged with its cause, never swallowed', () => {
  it('filing loop: a FAILED write that rolls back logs the document, the status and the cause', async () => {
    const cause = new Error('new row violates check constraint "ck_document_extraction_attempts_outcome"');
    const d = deps({ setDocumentExtractionState: rejectWhen('FAILED', new Error('Failed query: insert into document_extraction_attempts', { cause })) as never });
    await processPendingFilings(IPO, d);
    const hit = errorSpy.mock.calls.find((c) => (c[0] as Record<string, unknown>)?.status === 'FAILED');
    expect(hit, 'a FAILED status write failure must be logged').toBeTruthy();
    expect(hit![0]).toMatchObject({ documentId: 'doc-1', status: 'FAILED' });
    expect(String((hit![0] as Record<string, unknown>).error)).toContain('insert into document_extraction_attempts');
    expect(String((hit![0] as Record<string, unknown>).cause)).toContain('ck_document_extraction_attempts_outcome');
  });

  it('anchor loop: a MANUAL_REVIEW write that rolls back is logged with its cause', async () => {
    const d = anchorDeps({ setDocumentExtractionState: rejectWhen('MANUAL_REVIEW', new Error('tx aborted', { cause: new Error('deadlock detected') })) as never });
    await processPendingFilings(IPO, d);
    const hit = errorSpy.mock.calls.find((c) => (c[0] as Record<string, unknown>)?.status === 'MANUAL_REVIEW');
    expect(hit, 'a MANUAL_REVIEW status write failure must be logged').toBeTruthy();
    expect(hit![0]).toMatchObject({ documentId: 'anchor-1', status: 'MANUAL_REVIEW', cause: 'deadlock detected' });
  });
});
