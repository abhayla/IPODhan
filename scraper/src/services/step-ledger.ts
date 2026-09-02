/**
 * Per-IPO pipeline step ledger writer (S-01).
 *
 * Thin wrapper the scrapers call to record "step X for IPO Y is now Z".
 *
 * Deliberately NEVER throws: the ledger is bookkeeping about a scrape, not
 * part of it. A Redis blip or a bad step id must not take down a run that
 * otherwise fetched and persisted real data — failures are logged at warn and
 * swallowed.
 *
 * Spec: docs/specs/per-ipo-due-step-pipeline.md sections 4.1 and 5.
 */

import {
  db,
  getRedisClient,
  IpoPipelineStepsRepository,
  type UpsertStepInput,
} from '@ipodhan/shared';
import logger from '../utils/logger.js';

export type RecordStepInput = UpsertStepInput;

/**
 * Record one step outcome. Returns true when the ledger row was written,
 * false when the write failed (already logged) — callers may ignore it.
 */
export async function recordStep(input: RecordStepInput): Promise<boolean> {
  try {
    const repo = new IpoPipelineStepsRepository(db, getRedisClient());
    await repo.upsertStep(input);
    return true;
  } catch (error) {
    logger.warn('[step-ledger] failed to record step (scrape continues)', {
      ipoId: input.ipoId,
      stepId: input.stepId,
      status: input.status,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Create the full catalogue of NOT_DUE rows for a newly discovered IPO.
 * Idempotent; same never-throw contract as recordStep.
 */
export async function initStepLedger(ipoId: string): Promise<boolean> {
  try {
    const repo = new IpoPipelineStepsRepository(db, getRedisClient());
    await repo.initForIpo(ipoId);
    return true;
  } catch (error) {
    logger.warn('[step-ledger] failed to initialise ledger (scrape continues)', {
      ipoId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
