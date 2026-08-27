/**
 * T-339 (item 2) — identity quarantine: key beats name, and when they
 * disagree, NOTHING is written.
 *
 * `resolveIpoRow` throws `IdentityQuarantineError` when the natural-key tier
 * (ISIN / exchange symbol) and the name tier point at two DIFFERENT existing
 * `ipos` rows. One of them is wrong and we cannot tell which, so the scrape
 * for that company is refused. This module is what happens next:
 *
 *   1. HOLD the disagreement where a human will see it — an UNRESOLVED
 *      `data_conflicts` row. This deliberately REUSES the T-328 HOLD state
 *      (table + unresolved row + a `resolutionReason` string) rather than
 *      adding an `identity_quarantine` table, so it neither waits for nor
 *      conflicts with PR #233 (open, unmerged, adds no tables of its own).
 *      Both candidate ids, the source and the timestamp live on that row.
 *   2. PAGE the owner at P1 through the existing Notifier path
 *      (`notifyOwner`, the same channel AlertingService uses).
 *   3. Let the nightly detection-floor audit FAIL while a quarantine row is
 *      older than 24h (`k_identity_quarantine`), so an unattended quarantine
 *      cannot rot silently.
 *
 * Recording is best-effort (`non-fatal-side-effects.md`): the WRITE is
 * already refused by the throw, so a failure to record must never turn into
 * an exception that some caller "recovers" from by writing anyway.
 */
import type { DataConflictsRepository } from '@ipodhan/shared/repositories';
import type { IdentityQuarantineError } from '@ipodhan/shared/repositories';
import logger from '../utils/logger.js';
import { notifyOwner } from './owner-notify.js';

/**
 * The `resolutionReason` marker that makes a `data_conflicts` row an identity
 * quarantine. The nightly audit and any admin tooling MUST match on this
 * exact string — it is the join between the write path and the detector.
 */
export const IDENTITY_QUARANTINE_REASON = 'QUARANTINE_IDENTITY_CONFLICT';

/**
 * `data_conflicts.field_name` for a quarantine row. Not a real column of
 * `ipos` — the disagreement is about WHICH ROW, not which field — so it is
 * given a reserved, greppable pseudo-field name that can never collide with
 * a scraped field.
 */
export const IDENTITY_QUARANTINE_FIELD = '__identity__';

/** The `data_conflicts.source1/source2` enum. Anything outside it is stored as API_FALLBACK. */
const CONFLICT_SOURCES = ['ADMIN', 'DRHP', 'NSE', 'BSE', 'API_FALLBACK', 'MONEYCONTROL', 'CHITTORGARH'] as const;
type ConflictSource = (typeof CONFLICT_SOURCES)[number];

/**
 * `data_conflicts.source1/2` is a narrower enum than `ScraperSource` (it
 * predates INVESTORGAIN_GMP). Map anything outside the column's domain onto
 * API_FALLBACK rather than letting the insert fail — the true source name is
 * still carried verbatim in the P1 alert body and the log line.
 */
export function toConflictSource(source: string): ConflictSource {
  const upper = source.toUpperCase();
  return (CONFLICT_SOURCES as readonly string[]).includes(upper)
    ? (upper as ConflictSource)
    : 'API_FALLBACK';
}

export interface QuarantineDeps {
  dataConflictsRepository: Pick<DataConflictsRepository, 'upsertConflict'>;
  /** Injectable so tests do not fire a real notification. Defaults to the real Notifier path. */
  notify?: typeof notifyOwner;
}

export interface QuarantineOutcome {
  recorded: boolean;
  alerted: boolean;
  /** Present when recording succeeded. */
  conflictId?: string;
  /** Present when recording failed — the reason, for the caller's log line. */
  error?: string;
}

/**
 * Record an identity quarantine + page the owner. NEVER throws.
 *
 * The `data_conflicts` row is keyed on the KEY-tier candidate as `ipo_id`
 * (the higher-confidence of the two, and a real FK), with both candidate ids
 * stored in `value1`/`value2` so neither is lost. `upsertConflict` refreshes
 * the existing unresolved row for the same (ipo, table, field) instead of
 * piling up one row per 30-minute scrape cycle (T-286).
 */
export async function recordIdentityQuarantine(
  deps: QuarantineDeps,
  err: IdentityQuarantineError,
  scraperSource: string
): Promise<QuarantineOutcome> {
  const detectedAt = new Date().toISOString();
  const body = [
    `Company: ${err.companyName}`,
    `Key tier: ${err.keyTier} (isin=${err.isin ?? 'null'}, symbol=${err.symbol ?? 'null'})`,
    `Candidate A (key match): ${err.keyMatchId} "${err.keyMatchCompanyName}"`,
    `Candidate B (name match): ${err.nameMatchId} "${err.nameMatchCompanyName}"`,
    `Source: ${scraperSource}`,
    `Detected at: ${detectedAt}`,
    '',
    'The scrape for this company was REFUSED — no row was written. Decide which',
    'row is real, merge/correct it, then resolve the data_conflicts row.',
  ].join('\n');

  const outcome: QuarantineOutcome = { recorded: false, alerted: false };

  try {
    const row = await deps.dataConflictsRepository.upsertConflict({
      ipoId: err.keyMatchId,
      tableName: 'ipos',
      fieldName: IDENTITY_QUARANTINE_FIELD,
      source1: toConflictSource(scraperSource),
      value1: err.keyMatchId,
      source2: toConflictSource(scraperSource),
      value2: err.nameMatchId,
      resolutionReason: IDENTITY_QUARANTINE_REASON,
      severity: 'CRITICAL',
    });
    outcome.recorded = true;
    outcome.conflictId = row?.id;
    logger.error({
      companyName: err.companyName,
      source: scraperSource,
      keyTier: err.keyTier,
      keyMatchId: err.keyMatchId,
      nameMatchId: err.nameMatchId,
      conflictId: row?.id,
    }, 'identity_quarantine recorded — IPO skipped, nothing written');
  } catch (recordError) {
    outcome.error = recordError instanceof Error ? recordError.message : String(recordError);
    logger.error({
      companyName: err.companyName,
      source: scraperSource,
      keyMatchId: err.keyMatchId,
      nameMatchId: err.nameMatchId,
      error: outcome.error,
    }, 'identity_quarantine record FAILED (non-fatal) — the IPO is still skipped, but the HOLD row is missing');
  }

  // The page fires even when the HOLD row could not be written — that case is
  // strictly worse (a refused write with no durable record), so it must not
  // also be silent.
  try {
    (deps.notify ?? notifyOwner)('P1', `IPODhan: identity quarantine — ${err.companyName}`, {
      body: outcome.recorded ? body : `${body}\n\nWARNING: the data_conflicts HOLD row could NOT be written (${outcome.error}).`,
      type: 'identity-quarantine',
      // One page per disagreeing PAIR, not one per scrape cycle.
      dedupeKey: `identity-quarantine:${err.keyMatchId}:${err.nameMatchId}`,
    });
    outcome.alerted = true;
  } catch (notifyError) {
    logger.warn({
      companyName: err.companyName,
      error: notifyError instanceof Error ? notifyError.message : String(notifyError),
    }, 'identity_quarantine owner page failed (non-fatal)');
  }

  return outcome;
}
