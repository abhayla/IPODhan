/**
 * Selector-degradation detector (T-195) — the #1 silent-failure mode: a
 * source's HTML/JSON shape changes, the scraper's selectors stop matching,
 * and it keeps "succeeding" (HTTP 200, non-fatal parse) while silently
 * writing zero rows or mostly-blank fields. Neither the freshness monitor
 * (a "the process ran" signal) nor the existing coverage/plausibility audit
 * scripts (`scripts/audit-*.mjs`, which check the CONSOLIDATED DB, not a
 * single source's per-scrape output) catch this class.
 *
 * Design: per scrape, compute a row-count + blank-field-rate sample for the
 * source (`computeBlankFieldStats`), compare it against a 7-day rolling
 * history persisted in Redis, and alert P1 on:
 *   (a) zero rows scraped where the 7-day median row count is non-zero, or
 *   (b) blank-field rate exceeding the 7-day median by more than
 *       BLANK_RATE_ALERT_MARGIN.
 *
 * Cold start: history accrues silently until a source has at least 7 days
 * of recorded samples (tracked via a `first-seen` timestamp, NOT a sample
 * COUNT — a source that scrapes on a slower cadence must still get the full
 * 7 calendar days before baselines are trusted). No alert fires during
 * cold start, regardless of how the sample looks — this is what prevents a
 * fresh deploy / empty Redis from alert-storming on day one.
 */
import type Redis from 'ioredis';
import logger from '../utils/logger.js';
import { notifyOwner } from './owner-notify.js';

export interface ScrapeSample {
  rowCount: number;
  /** 0..1 fraction of all scanned field values across all rows that were blank. */
  blankFieldRate: number;
}

interface StoredSample extends ScrapeSample {
  timestamp: number;
}

export interface DegradationEvaluation {
  source: string;
  sample: ScrapeSample;
  coldStart: boolean;
  historySize: number;
  medianRowCount: number | null;
  medianBlankRate: number | null;
  alerted: boolean;
  reasons: string[];
}

const HISTORY_KEY_PREFIX = 'watchdog:degradation:history:';
const FIRST_SEEN_KEY_PREFIX = 'watchdog:degradation:first-seen:';
const ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — DoD-specified baseline window
/** ~7 days of samples at the measured 30-min cadence (48/day) + margin. */
const MAX_HISTORY_ENTRIES = 400;
/**
 * A source's blank-field rate must exceed its own 7-day median by more than
 * this many percentage points to page. 15 points was chosen to tolerate
 * normal day-to-day variance (an IPO with genuinely fewer populated optional
 * fields) while still catching a selector break, which typically blanks
 * most or all of a source's fields at once (a much larger jump than 15pp).
 */
const BLANK_RATE_ALERT_MARGIN = 0.15;

function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (typeof value === 'number' && Number.isNaN(value)) return true;
  return false;
}

/** Pure function: compute {rowCount, blankFieldRate} from a scrape's raw record array. */
export function computeBlankFieldStats(records: Array<Record<string, unknown>>): ScrapeSample {
  const rowCount = records.length;
  if (rowCount === 0) {
    return { rowCount: 0, blankFieldRate: 0 };
  }

  let blankCount = 0;
  let totalFieldCount = 0;
  for (const record of records) {
    for (const value of Object.values(record)) {
      totalFieldCount++;
      if (isBlankValue(value)) blankCount++;
    }
  }

  return {
    rowCount,
    blankFieldRate: totalFieldCount > 0 ? blankCount / totalFieldCount : 0,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Record this scrape's sample and evaluate it against the 7-day rolling
 * history. Never throws — a Redis failure degrades to "treat as cold start,
 * skip this cycle's evaluation" (fail-open, per redis-best-effort-fail-open.md).
 */
export async function evaluateAndRecordDegradation(
  redis: Pick<Redis, 'get' | 'set' | 'lrange' | 'lpush' | 'ltrim'>,
  source: string,
  sample: ScrapeSample,
  now: Date = new Date()
): Promise<DegradationEvaluation> {
  const historyKey = `${HISTORY_KEY_PREFIX}${source}`;
  const firstSeenKey = `${FIRST_SEEN_KEY_PREFIX}${source}`;
  const reasons: string[] = [];

  let coldStart = true;
  let history: StoredSample[] = [];

  try {
    let firstSeenRaw = await redis.get(firstSeenKey);
    if (!firstSeenRaw) {
      firstSeenRaw = String(now.getTime());
      await redis.set(firstSeenKey, firstSeenRaw);
    }
    coldStart = now.getTime() - Number(firstSeenRaw) < ROLLING_WINDOW_MS;

    const historyRaw = await redis.lrange(historyKey, 0, MAX_HISTORY_ENTRIES - 1);
    history = historyRaw
      .map((raw) => {
        try {
          return JSON.parse(raw) as StoredSample;
        } catch {
          return null;
        }
      })
      .filter((s): s is StoredSample => s !== null && now.getTime() - s.timestamp <= ROLLING_WINDOW_MS);
  } catch (error) {
    logger.warn(
      { source, error: error instanceof Error ? error.message : String(error) },
      'Selector-degradation history read failed (non-fatal, treated as cold-start this cycle)'
    );
    coldStart = true;
    history = [];
  }

  const medianRowCount = coldStart || history.length === 0 ? null : median(history.map((s) => s.rowCount));
  const medianBlankRate = coldStart || history.length === 0 ? null : median(history.map((s) => s.blankFieldRate));

  let alerted = false;

  if (!coldStart) {
    if (sample.rowCount === 0 && (medianRowCount ?? 0) > 0) {
      reasons.push(`zero rows scraped; 7-day median row count is ${medianRowCount}`);
    }
    if (medianBlankRate !== null && sample.blankFieldRate > medianBlankRate + BLANK_RATE_ALERT_MARGIN) {
      reasons.push(
        `blank-field rate ${(sample.blankFieldRate * 100).toFixed(1)}% exceeds 7-day median ${(medianBlankRate * 100).toFixed(1)}% by more than ${(BLANK_RATE_ALERT_MARGIN * 100).toFixed(0)} points`
      );
    }

    if (reasons.length > 0) {
      alerted = true;
      notifyOwner('P1', `Possible selector degradation: ${source}`, {
        body: reasons.join('; '),
        type: 'selector-degradation',
        // Hourly dedupe bucket so a run of consecutive bad cycles pages once/hour, not once/cycle.
        dedupeKey: `degradation:${source}:${now.toISOString().slice(0, 13)}`,
      });
      logger.error(
        { source, sample, medianRowCount, medianBlankRate, reasons },
        'Selector degradation detected'
      );
    }
  } else {
    logger.debug(
      { source, historySize: history.length },
      'Selector-degradation baseline still warming up (cold start, < 7 days of history) — not alerting'
    );
  }

  // Best-effort write of this sample into history — never fatal.
  try {
    await redis.lpush(historyKey, JSON.stringify({ ...sample, timestamp: now.getTime() } satisfies StoredSample));
    await redis.ltrim(historyKey, 0, MAX_HISTORY_ENTRIES - 1);
  } catch (error) {
    logger.warn(
      { source, error: error instanceof Error ? error.message : String(error) },
      'Selector-degradation history write failed (non-fatal)'
    );
  }

  return {
    source,
    sample,
    coldStart,
    historySize: history.length,
    medianRowCount,
    medianBlankRate,
    alerted,
    reasons,
  };
}
