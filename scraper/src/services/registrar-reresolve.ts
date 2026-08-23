/**
 * Registrar re-resolve core (P2-4, T-300, round-5 review).
 *
 * `ipos.registrar_id` is NEVER written by any scraper write path (see
 * `@ipodhan/shared/utils/registrar-matcher`'s file header) — only backfill
 * scripts populate it. That means every IPO created after the last backfill
 * run sits at `registrar_id IS NULL` forever unless something re-resolves
 * it. This module is that "something": a single, reusable pass over every
 * NULL-registrar_id row, shared by the one-shot repair script
 * (`scripts/reresolve-registrar-id-t300.ts`) and the periodic piggyback on
 * the hourly `statusUpdater` cron job (`scheduler/jobs/update-statuses.ts`)
 * — so future NULL rows (new IPOs, or a name only resolvable after a new
 * registrar/alias lands) get retried as the table grows, per DRY
 * (`design-principles.md`) rather than duplicating the matching loop.
 *
 * Never guesses: `resolveRegistrarId` only returns a match for an
 * unambiguous exact/compact-normalized hit; anything else stays NULL with
 * no side effect, so an unrecognized registrar name is silently left for a
 * human/future registrar-table update rather than wrongly linked.
 */
import { db } from '@ipodhan/shared/db';
import * as schema from '@ipodhan/shared/db/schema';
import { resolveRegistrarId } from '@ipodhan/shared/utils/registrar-matcher';
import { eq, isNull, isNotNull, and } from 'drizzle-orm';
import logger from '../utils/logger.js';

export interface RegistrarReresolveResult {
  candidates: number;
  matched: number;
  written: number;
  unmatchedNames: string[];
}

/**
 * Run one re-resolve pass. dryRun (default true) computes + logs the plan
 * only. Set `dryRun: false` to actually write `registrar_id`.
 */
export async function reresolveRegistrarIds(
  opts: { dryRun?: boolean } = {}
): Promise<RegistrarReresolveResult> {
  const dryRun = opts.dryRun !== false;

  const registrars = await db
    .select({ id: schema.registrars.id, name: schema.registrars.name, shortName: schema.registrars.shortName })
    .from(schema.registrars);

  const unmatchedRows = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName, registrar: schema.ipos.registrar })
    .from(schema.ipos)
    .where(and(isNull(schema.ipos.registrarId), isNotNull(schema.ipos.registrar)));

  let matched = 0;
  let written = 0;
  const unmatchedNames: string[] = [];

  for (const row of unmatchedRows) {
    const registrarId = resolveRegistrarId(row.registrar, registrars);
    if (!registrarId) {
      if (row.registrar) unmatchedNames.push(row.registrar);
      continue;
    }
    matched++;
    if (!dryRun) {
      await db.update(schema.ipos).set({ registrarId }).where(eq(schema.ipos.id, row.id));
      logger.info(
        { ipoId: row.id, company: row.companyName, registrar: row.registrar, registrarId },
        '[registrar-reresolve] registrar_id backfilled'
      );
      written++;
    }
  }

  const result: RegistrarReresolveResult = {
    candidates: unmatchedRows.length,
    matched,
    written,
    unmatchedNames: [...new Set(unmatchedNames)],
  };
  logger.info(
    { candidates: result.candidates, matched: result.matched, written: result.written, dryRun },
    '[registrar-reresolve] pass complete'
  );
  return result;
}
