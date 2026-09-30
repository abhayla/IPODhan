/**
 * §9.2 item 23 (OD-116 as corrected by OD-118): the ONE reader-visibility predicate for `ipos`.
 *
 * An admin hides a row instead of deleting it. A hidden row leaves every reader list, search and
 * the sitemap, and its address answers 410 Gone; its data stays for admins and unhide restores it.
 * Every public query that reads `ipos` applies `publicIpoVisible()`; the static test
 * `tests/unit/lib/repositories/public-ipo-visibility-sites.test.ts` fails when a new public query
 * omits it. Admin reads opt out explicitly (`includeHidden: true`).
 */
import { isNull, sql, type SQL } from 'drizzle-orm';
import { ipos } from '../db';

/** Drizzle condition: the row is visible to readers (`hidden_at IS NULL`). */
export function publicIpoVisible(): SQL {
  return isNull(ipos.hiddenAt);
}

/** Raw-SQL fragment for queries written as text against `ipos` (optionally aliased). */
export function publicIpoVisibleSql(alias?: string): SQL {
  return alias ? sql.raw(`${alias}.hidden_at IS NULL`) : sql.raw('hidden_at IS NULL');
}

/** True when a row (fresh or revived from the JSON cache) is hidden from readers. */
export function isIpoHidden(row: { hiddenAt?: Date | string | null } | null | undefined): boolean {
  return row?.hiddenAt != null;
}
