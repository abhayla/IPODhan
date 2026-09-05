/**
 * W-142 — the anchor allocation report's route through the AUTOMATIC door.
 *
 * THE GAP THIS CLOSES. `filing-auto-persist.ts` only ever considered the four
 * doc types `scripts/extract_filing.py` understands, so every
 * `ANCHOR_ALLOCATION_REPORT` row — 7 SME and 7 MAINBOARD on production, all
 * `PENDING` — was dropped by `selectPendingFilings` as "not an extractable doc
 * type" before anything ran. The only way anchor data ever reached the database
 * was a human typing `scripts/persist-filing.ts --doc-type
 * ANCHOR_ALLOCATION_REPORT`, per IPO.
 *
 * WHAT THIS DOES NOT DO. It does NOT teach `extract_filing.py` to parse anchor
 * tables. Anchor extraction already exists and works
 * (`scripts/anchor_report_text.py`'s word-coordinate reconstruction ->
 * `anchor-report-parser.ts` -> `anchor-persister.ts`, with its arithmetic gates
 * and the W-81 garbled-name floor). This module is a THIN ROUTE to that same
 * path, wired with the same dependency set the CLI uses — one extraction path,
 * one write door, nothing duplicated.
 */

import { db, getRedisClient, filterProtectedFields } from '@ipodhan/shared';
import {
  persistAnchorReport,
  type AnchorPersistSummary,
} from './anchor-persister.js';
import {
  scrapeAnchorInvestorsDetailed,
  ANCHOR_EMPTY_PAGES_REASON,
  type AnchorScrapeFailureKind,
  type PinnedAnchorDocument,
} from '../scrapers/anchor-investors-scraper.js';
import { AnchorInvestorRepository } from '../repositories/anchor-investor-repository.js';
import type { FilingPersisterDeps } from './filing-persister.js';

/**
 * What the automatic door must do with this document afterwards.
 *
 *  - `persisted`      -> `documents.extraction_status = COMPLETED`
 *  - `manual_review`  -> MANUAL_REVIEW **with the reason** (a human has to look
 *                        at the scan; retrying changes nothing). Never FAILED,
 *                        never silent.
 *  - `hard_failure`   -> the W-137 path: FAILED, marked so the second such
 *                        failure widens the backoff to >= 24h.
 *  - `failed`         -> ordinary FAILED with the normal 2^n x 15 min backoff.
 */
export type AnchorAutoOutcome =
  | { kind: 'persisted'; reason: null; summary: AnchorPersistSummary }
  | { kind: 'manual_review'; reason: string; summary?: AnchorPersistSummary }
  | { kind: 'hard_failure'; reason: string }
  | { kind: 'failed'; reason: string; summary?: AnchorPersistSummary };

/**
 * The whole outcome mapping, as ONE pure function.
 *
 * Nothing here reads prose: the scrape reports a `kind`, the persister reports
 * a `refusedKind`, and this maps those two enumerations onto the four document
 * states. A refusal whose kind is unknown is treated as retryable FAILED — the
 * conservative direction, since MANUAL_REVIEW stops all further attempts.
 */
export function classifyAnchorAutoOutcome(input: {
  failure?: { kind: AnchorScrapeFailureKind; reason: string };
  summary?: AnchorPersistSummary;
}): AnchorAutoOutcome {
  const { failure, summary } = input;

  if (failure) {
    if (failure.kind === 'hard_failure') {
      return { kind: 'hard_failure', reason: `anchor: ${failure.reason}` };
    }
    if (failure.kind === 'empty_pages') {
      // W-139 shape: the letter is a scan, the text layer gave nothing and the
      // OCR heuristic did not fire. Retrying is guaranteed to do exactly this
      // again, so it goes to a human rather than round the backoff loop.
      return { kind: 'manual_review', reason: `anchor: ${ANCHOR_EMPTY_PAGES_REASON}`, summary };
    }
    return { kind: 'failed', reason: `anchor: ${failure.reason}`, summary };
  }

  if (!summary) {
    return { kind: 'failed', reason: 'anchor: persister returned no summary' };
  }
  if (summary.refusedReason === null) {
    return { kind: 'persisted', reason: null, summary };
  }
  // The W-81 garbled-name floor (and its all-blank-names sibling): the
  // arithmetic checked out but the NAME column did not read, so publishing
  // would show garbled investors. That is a scan-quality problem no retry
  // fixes — MANUAL_REVIEW with the persister's own reason, never a silent
  // FAILED that looks like a transient error.
  if (summary.refusedKind === 'name_quality' || summary.refusedKind === 'blank_names') {
    return { kind: 'manual_review', reason: `anchor: ${summary.refusedReason}`, summary };
  }
  return { kind: 'failed', reason: `anchor: ${summary.refusedReason}`, summary };
}

export interface AnchorAutoPersistArgs {
  ipoId: string;
  companyName: string;
  /**
   * MAJOR-1 (round 2): the document row the door SELECTED and the store path
   * it already proved exists. Required — without it the scrape would re-select
   * "the newest active anchor row" and could stamp a different row than the
   * one extracted, and could fall through to an HTTP download inside the
   * deadline-checked extract loop.
   */
  document: PinnedAnchorDocument;
}

/**
 * Run the anchor extraction + persist for one IPO and classify the outcome.
 *
 * `persisterDeps` is threaded in so this reuses the SAME `IPORepository` and
 * `protectionFilter` instances the filing door already built (the
 * s02-step-ledger-wiring test forbids a second `IPORepository` here), exactly
 * as `scripts/persist-filing.ts` does for the manual door.
 */
export async function runAnchorAutoPersist(
  args: AnchorAutoPersistArgs,
  persisterDeps: FilingPersisterDeps,
  redis: ReturnType<typeof getRedisClient> = getRedisClient()
): Promise<AnchorAutoOutcome> {
  let failure: { kind: AnchorScrapeFailureKind; reason: string } | undefined;
  const summary = await persistAnchorReport(
    args.ipoId,
    { companyName: args.companyName, apply: true },
    {
      scrapeAnchorReport: async (id, name) => {
        const outcome = await scrapeAnchorInvestorsDetailed(db, id, name, args.document);
        failure = outcome.failure;
        return outcome.data;
      },
      anchorInvestorRepository: new AnchorInvestorRepository(db),
      ipoRepository: persisterDeps.ipoRepository,
      protectionFilter:
        persisterDeps.protectionFilter ??
        ((id: string, table: string, data: Record<string, unknown>, scraperName: string) =>
          filterProtectedFields(id, table, data, scraperName, db, redis)),
    }
  );
  return classifyAnchorAutoOutcome({ failure, summary });
}
