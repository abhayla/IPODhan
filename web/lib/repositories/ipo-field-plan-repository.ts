/**
 * The read side of `ipo_field_plan` (lane A's item 5) — item 21 slice 4, OD-39.
 *
 * This repository answers one reader-facing question per field: who said this
 * number, and when was it last confirmed. It writes nothing. The walk that
 * fills the plan lives in the scraper workspace
 * (`scraper/src/services/field-plan-repository.ts`) and is not importable from
 * `web/`; this is a small read-only twin, not a reuse of that one.
 *
 * STALE IS `now > verify_due_at`, PER FIELD. Not a global "stale after N days"
 * constant — the card closed that fork after measuring what a constant would
 * do: at three days a LISTED IPO's issue price reads "being rechecked" forever,
 * three days after listing, because nothing re-reads a final price and nothing
 * should. Whatever sets `verify_due_at` already knows a GMP is due in hours and
 * a settled issue price is never due again, so a NULL due date means settled,
 * not stale.
 *
 * THE CONFIRMATION DATE IS PROVISIONAL, and that is a known gap, not an
 * oversight. `ipo_field_plan` has no column meaning "the date this value was
 * last reconfirmed correct" as distinct from `updated_at`, which any write to
 * the row bumps — a failed re-attempt, an unrelated verify_state change. So the
 * date shown can drift forward on churn the row itself would not call a
 * reconfirmation. The fix is a `chosen_confirmed_at` column in item 5's schema,
 * not a guess here.
 */

import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Redis } from 'ioredis';
import * as schema from '@ipodhan/shared/db/schema';
import { ipoFieldPlan } from '@ipodhan/shared/db/schema';
import { BaseRepository } from './base-repository';

export interface FieldProvenance {
  /** `table.column` — the manifest's key and the plan row's own key. */
  key: string;
  tableName: string;
  fieldName: string;
  /** A `scraperSourceEnum`-shaped value, e.g. 'DOC', 'BSE'. */
  chosenSource: string | null;
  /** A `documentTypeEnum`-shaped value, e.g. 'RHP'. Null when the source is not a document. */
  chosenDocumentType: string | null;
  /** PROVISIONAL — see the file header. Null when the row has never been written. */
  confirmedAt: Date | null;
  /** `now > verify_due_at`. A null due date is settled, never stale. */
  isStale: boolean;
}

/** Set by summariseFieldGroup when a block's fields do not share one source. */
export const MULTIPLE_SOURCES = 'MULTIPLE';

function provenanceCacheKey(ipoId: string): string {
  return `ipo:fieldplan:provenance:${ipoId}`;
}

export class IpoFieldPlanRepository extends BaseRepository {
  constructor(
    protected db: NodePgDatabase<typeof schema>,
    protected redis: Redis
  ) {
    super(db, redis);
  }

  /**
   * Every field this IPO's plan can speak for, keyed `table.column`.
   *
   * A field the plan has not supplied is left out rather than returned with
   * nulls. There is nothing truthful to say about it yet, and an entry with a
   * null source would reach the page as a line that names no source.
   *
   * `now` is a parameter so the staleness comparison is testable without
   * faking the clock.
   */
  async getIPOProvenanceMap(
    ipoId: string,
    now: Date = new Date()
  ): Promise<Record<string, FieldProvenance>> {
    const rows = await this.getFromCache(
      provenanceCacheKey(ipoId),
      async () =>
        this.db
          .select({
            tableName: ipoFieldPlan.tableName,
            fieldName: ipoFieldPlan.fieldName,
            state: ipoFieldPlan.state,
            chosenSource: ipoFieldPlan.chosenSource,
            chosenDocumentType: ipoFieldPlan.chosenDocumentType,
            verifyDueAt: ipoFieldPlan.verifyDueAt,
            updatedAt: ipoFieldPlan.updatedAt,
          })
          .from(ipoFieldPlan)
          .where(eq(ipoFieldPlan.ipoId, ipoId)),
      900
    );

    const out: Record<string, FieldProvenance> = {};
    for (const row of rows ?? []) {
      if (!row.chosenSource) continue;
      const key = `${row.tableName}.${row.fieldName}`;
      const due = row.verifyDueAt ? new Date(row.verifyDueAt) : null;
      out[key] = {
        key,
        tableName: row.tableName,
        fieldName: row.fieldName,
        chosenSource: row.chosenSource,
        chosenDocumentType: row.chosenDocumentType ?? null,
        confirmedAt: row.updatedAt ? new Date(row.updatedAt) : null,
        isStale: due !== null && now.getTime() > due.getTime(),
      };
    }
    return out;
  }
}

/**
 * One line for a block that shows several fields.
 *
 * The block is only as good as its weakest member, so: the OLDEST confirmation
 * date wins, and one stale field makes the whole line stale. The source is
 * named only when every field in the block agrees — a block whose issue size
 * came from the offer document and whose OFS came from BSE must not tell the
 * reader "from the offer document", which would be false about half of what
 * they are looking at.
 */
export function summariseFieldGroup(
  map: Record<string, FieldProvenance>,
  keys: readonly string[]
): FieldProvenance | null {
  const present = keys.map((key) => map[key]).filter(Boolean);
  if (present.length === 0) return null;

  const sources = new Set(present.map((p) => p.chosenSource));
  const unanimous = sources.size === 1;
  const oldest = present.reduce<Date | null>((acc, p) => {
    if (!p.confirmedAt) return acc;
    if (!acc) return p.confirmedAt;
    return p.confirmedAt.getTime() < acc.getTime() ? p.confirmedAt : acc;
  }, null);

  return {
    key: present.map((p) => p.key).join('+'),
    tableName: unanimous ? present[0].tableName : '',
    fieldName: unanimous ? present[0].fieldName : '',
    chosenSource: unanimous ? present[0].chosenSource : MULTIPLE_SOURCES,
    chosenDocumentType: unanimous ? present[0].chosenDocumentType : null,
    confirmedAt: oldest,
    isStale: present.some((p) => p.isStale),
  };
}
