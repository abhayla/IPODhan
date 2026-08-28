/**
 * One-off re-type of `documents` rows the old classifier got wrong (T-403 M6).
 *
 * The classifier fix only applies to documents discovered AFTER it shipped.
 * Everything already stored keeps the old, wrong type: a final Prospectus filed
 * as RHP, and both corrigenda and price-band advertisements filed as ADDENDUM.
 * Those rows are what the page renders and what WP C will extract from, so
 * leaving them is not neutral.
 *
 * Safety, in order:
 *  - DRY RUN by default. `--execute` is required to write anything.
 *  - Only re-types along the closed, one-directional allowlist in
 *    `document-type-refinement.ts`. A row whose URL now classifies as a wholly
 *    different type is REPORTED, never rewritten — that means the classifier or
 *    the source changed and a human should look.
 *  - Classification uses the same `classifyByTitle` the live path uses, applied
 *    to the file name first and the stored title second, so this script cannot
 *    drift from production behaviour.
 *  - Requires migration 0035 (the new enum values must exist); it checks and
 *    refuses rather than failing mid-update.
 *
 * Run (from scraper/):
 *   npx tsx src/scripts/retype-misclassified-documents.ts             # dry run
 *   npx tsx src/scripts/retype-misclassified-documents.ts --execute
 */

import { sql } from 'drizzle-orm';
import { db } from '@ipodhan/shared';
import { isMoreSpecificDocumentType } from '@ipodhan/shared/db/document-type-refinement';
import logger from '../utils/logger.js';
import { classifyByTitle, fileNameFromUrl } from '../services/document-classifier.js';

export interface RetypeCandidate {
  id: string;
  url: string;
  title: string;
  currentType: string;
  suggestedType: string;
  action: 'retype' | 'review';
}

/**
 * Decide what should happen to one stored row. PURE — unit-tested without a DB.
 *
 * The file name is classified first because it is what the exchange actually
 * named the document; the stored title is a fallback (our own titles are
 * sometimes just the BSE field name).
 */
export function planRetype(row: {
  id: string;
  url: string;
  title: string;
  type: string;
}): RetypeCandidate | null {
  const fromName = classifyByTitle(fileNameFromUrl(row.url));
  const fromTitle = classifyByTitle(row.title);
  const suggested = fromName ?? fromTitle;
  if (!suggested || suggested === row.type) return null;

  return {
    id: row.id,
    url: row.url,
    title: row.title,
    currentType: row.type,
    suggestedType: suggested,
    action: isMoreSpecificDocumentType(row.type, suggested) ? 'retype' : 'review',
  };
}

export async function runRetype(
  opts: { execute?: boolean } = {}
): Promise<{ scanned: number; retyped: number; review: number; candidates: RetypeCandidate[] }> {
  const execute = opts.execute === true;

  const enumCheck = await db.execute(sql`
    SELECT count(*)::int AS n
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'document_type' AND e.enumlabel = 'CORRIGENDUM'
  `);
  const enumRows = ((enumCheck as unknown as { rows?: { n: number }[] }).rows ?? []);
  if ((enumRows[0]?.n ?? 0) === 0) {
    throw new Error(
      'migration 0035 is not applied on this database (document_type has no CORRIGENDUM) — refusing to run'
    );
  }

  const result = await db.execute(sql`SELECT id, url, title, type::text AS type FROM documents`);
  const rows = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []);

  const candidates: RetypeCandidate[] = [];
  for (const r of rows) {
    const plan = planRetype({
      id: String(r.id),
      url: String(r.url ?? ''),
      title: String(r.title ?? ''),
      type: String(r.type ?? ''),
    });
    if (plan) candidates.push(plan);
  }

  const toRetype = candidates.filter((c) => c.action === 'retype');
  const toReview = candidates.filter((c) => c.action === 'review');

  logger.info(
    { execute, scanned: rows.length, retype: toRetype.length, review: toReview.length },
    `[retype-documents] ${execute ? 'EXECUTE' : 'DRY RUN'}`
  );
  for (const c of candidates) {
    logger.info(
      { id: c.id, from: c.currentType, to: c.suggestedType, action: c.action, url: c.url },
      `[retype-documents] ${c.action}`
    );
  }

  if (execute) {
    for (const c of toRetype) {
      await db.execute(
        sql`UPDATE documents SET type = ${c.suggestedType}::document_type, updated_at = now() WHERE id = ${c.id}::uuid`
      );
    }
    logger.info({ retyped: toRetype.length }, '[retype-documents] applied');
  }

  return {
    scanned: rows.length,
    retyped: execute ? toRetype.length : 0,
    review: toReview.length,
    candidates,
  };
}

// Direct invocation only; importing this module must not run it.
if (process.argv[1] && process.argv[1].includes('retype-misclassified-documents')) {
  runRetype({ execute: process.argv.includes('--execute') })
    .then((r) => {
      // eslint-disable-next-line no-console -- CLI summary; operational events go through pino above.
      process.stdout.write(
        `scanned=${r.scanned} retype=${r.candidates.filter((c) => c.action === 'retype').length} review=${r.review} applied=${r.retyped}\n`
      );
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, '[retype-documents] failed');
      process.exit(1);
    });
}
