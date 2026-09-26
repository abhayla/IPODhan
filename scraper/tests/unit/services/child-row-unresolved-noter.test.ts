/**
 * #648 — a failed provenance-marker write is logged with its cause and counted.
 *
 * F-101 (#615) made `markChildRowsUnresolved` catch its own failure so the
 * write it interrupts can still finish. That catch also means: if the
 * sentinel write ITSELF fails, nothing records it, and the pair reads as
 * "writer not live" to `q_field_sources_row_key_coverage` — identical to the
 * flag being off. This test drives the REAL `createChildRowNoter` factory
 * (never a re-implementation) with a mocked `fieldSources` whose
 * `trackFieldUpdate` rejects, and asserts the two things #648 asks for:
 * (a) a structured error log named `provenance-marker-write-failed` carrying
 *     ipoId, tableName and the underlying cause (message + code), and
 * (b) a per-noter counter (`getMarkerWriteFailures`) that increments.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChildRowNoter, type UnresolvedNoterFieldSources } from '../../../src/services/child-row-unresolved-noter.js';
import logger from '../../../src/utils/logger.js';

const IPO_ID = '11111111-2222-3333-4444-555555555555';

describe('createChildRowNoter — #648 marker-write failure signal', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('logs the cause and increments the counter when trackFieldUpdate throws', async () => {
    const dbError = new Error('insert failed') as Error & { cause?: { message: string; code: string } };
    dbError.cause = { message: 'connection terminated', code: 'ECONNRESET' };
    const fieldSources: UnresolvedNoterFieldSources = {
      trackFieldUpdate: vi.fn().mockRejectedValue(dbError),
    };

    const noter = createChildRowNoter({
      apply: true,
      ipoId: IPO_ID,
      source: 'DRHP',
      lineage: () => ({ method: 'FILING_EXTRACTION' }),
      fieldSources,
      updatedBy: 'FILING_PERSISTER',
      logPrefix: '[FilingPersister]',
    });

    expect(noter.getMarkerWriteFailures()).toBe(0);

    await noter.markChildRowsUnresolved('promoters', 'no-consolidator-injected');

    expect(noter.getMarkerWriteFailures()).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'provenance-marker-write-failed',
        ipoId: IPO_ID,
        tableName: 'promoters',
        causeMessage: 'connection terminated',
        causeCode: 'ECONNRESET',
      }),
      expect.stringContaining('could not file the unresolved-row provenance marker')
    );
  });

  it('logs and counts when no fieldSources repository was injected', async () => {
    const noter = createChildRowNoter({
      apply: true,
      ipoId: IPO_ID,
      source: 'DRHP',
      lineage: () => ({ method: 'FILING_EXTRACTION' }),
      fieldSources: undefined,
      updatedBy: 'FILING_PERSISTER',
      logPrefix: '[FilingPersister]',
    });

    await noter.markChildRowsUnresolved('promoters', 'no-consolidator-injected');

    expect(noter.getMarkerWriteFailures()).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'provenance-marker-write-failed', ipoId: IPO_ID, tableName: 'promoters' }),
      expect.stringContaining('no fieldSources repository')
    );
  });

  it('does not count a successful marker write', async () => {
    const fieldSources: UnresolvedNoterFieldSources = {
      trackFieldUpdate: vi.fn().mockResolvedValue(undefined),
    };
    const noter = createChildRowNoter({
      apply: true,
      ipoId: IPO_ID,
      source: 'DRHP',
      lineage: () => ({ method: 'FILING_EXTRACTION' }),
      fieldSources,
      updatedBy: 'FILING_PERSISTER',
      logPrefix: '[FilingPersister]',
    });

    await noter.markChildRowsUnresolved('promoters', 'no-consolidator-injected');

    expect(noter.getMarkerWriteFailures()).toBe(0);
  });
});
