/**
 * The admin queue computed in the database (OD-63, OD-136, spec §9.4): counts by SQL aggregates and
 * one page of entries by a deterministic ORDER BY, so a request moves one page, not the whole queue
 * (measured 2026-09-29 on staging: loading every row into JS took ~12.8 s per request).
 *
 * The rules that need JavaScript stay in JavaScript, each in its one implementation, and reach the
 * SQL as inputs: the conflict rules (ruleFilterFor, run over the few conflicts SQL cannot classify),
 * the admin holds, the public-page field list and the shared field check (validateIPOData).
 * The ORDER BY keys are the same keys, in the same order, as compareItems (queue-order.ts), with
 * `COLLATE "C"` matching its code-unit string compare; an integration test asserts the two agree.
 */
import { sql, type SQL } from 'drizzle-orm';
import { BaseRepository } from './base-repository';
import { CacheTTL, getAdminQueueCountsKey, getAdminQueueSetupKey } from '@/lib/cache/cache-keys';
import { ADMIN_LIST_SUGGESTION } from '@ipodhan/shared/utils/conflict-reasons';
import { IPO_COLUMNS, type ConflictRow, type PlanRow } from './admin-queue-repository';

/** An unresolved conflict the SQL cannot classify alone (not OD-75 by source/reason, not F-181). */
export interface CandidateConflictRow {
  id: string;
  table_name: string;
  field_name: string;
  source1: string;
  source2: string;
  value1: string | null;
  value2: string | null;
  resolution_reason: string | null;
}

/** Inputs the page query takes from the JS-side checks. */
export interface QueueSqlInputs {
  /** OD-75 reason codes and F-181 bookkeeping columns (shared constants in conflict-reasons.ts). */
  od75Reasons: readonly string[];
  bookkeepingFields: readonly string[];
  /** Candidate conflicts the JS rule check classified as a rule: [conflict id, rule]. */
  classified: Array<[string, string]>;
  /** Admin-held fields: `ipoId|holdTable|camelField`. */
  heldKeys: string[];
  /** Fields the public IPO page shows: `table.camelField`. */
  publicFields: string[];
  /** Stored ipos values the shared field check refuses: [ipo id, camelField]. */
  flagged: Array<[string, string]>;
}

export type QueueSqlReason = { cat: string } | { reasonCode: string | null } | { failedValidation: true };

/** SQL view filters (the default view is everything). */
export interface QueueSqlView {
  group?: 1 | 2 | 3;
  kind?: 'disagreement' | 'missing' | 'flagged' | 'ruled';
  ipoSlug?: string;
  reason?: QueueSqlReason;
}

export interface QueueCountRow {
  tag: 'group' | 'reason';
  grp: number | null;
  cat: string | null;
  reason_code: string | null;
  has_flag: boolean | null;
  n: number;
  ipos: number | null;
}

export interface QueuePageRow {
  entry: 'item' | 'ipo';
  ord: number;
  total: number;
  id: string | null;
  ipo_id: string;
  table_name: string | null;
  field_name: string | null;
  row_key: string | null;
  cat: string | null;
  reason_code: string | null;
  has_flag: boolean | null;
  grp: number;
  /** The item's/summary's own IPO, carried live on every row (A4 fix: never read from a cached setup). */
  slug: string | null;
  company_name: string | null;
  status: string | null;
  open_date: string | null;
  close_date: string | null;
  listing_date: string | null;
  disagreements: number | null;
  missing: number | null;
  flagged: number | null;
  ruled: number | null;
}

/** A postgres text[] bound as ONE parameter (never interpolated into the SQL text). */
function textArray(xs: readonly string[]): SQL {
  return sql`${`{${xs.map((x) => `"${x.replace(/(["\\])/g, '\\$1')}"`).join(',')}}`}::text[]`;
}

/**
 * snake_case -> camelCase in SQL, the same result as snakeToCamel (admin-queue-service.ts) for
 * lower-case snake names: initcap upper-cases each word's first letter, the underscores go, and the
 * first letter is lower-cased again. One set-based expression, no per-row subquery.
 */
function camel(col: SQL): SQL {
  return sql`(lower(left(${col}, 1)) || substr(replace(initcap(${col}), '_', ''), 2))`;
}

/** Groups 1 and 2: compareItems' keys (IPO by nearest date, then slug; category; field; table; row; id). */
const ITEM_ORDER = sql`grp, nearest NULLS LAST, slug COLLATE "C", cat_rank, field_name COLLATE "C", table_name COLLATE "C", row_key COLLATE "C", id COLLATE "C"`;
/** One IPO opened: orderIpoItems' keys. */
const IPO_ITEM_ORDER = sql`cat_rank, field_name COLLATE "C", table_name COLLATE "C", row_key COLLATE "C", id COLLATE "C"`;

/**
 * The whole queue as one relation `q`: populations (a) (b) (c), group, category and sort keys.
 *
 * Query shape (measured 2026-09-29 on ipodhan_staging, EXPLAIN ANALYZE): each population joins `ipos`
 * as a base table (uuid = uuid, planned as a hash join from table statistics), and the admin-held
 * fields leave population (b) by a hash anti-join. The earlier shape filtered held fields with a
 * per-row string `= ANY(text[])`, which the planner estimated at 528 rows instead of 34,683; the
 * `ipos` join after it then ran as a nested loop over the materialized queue (397 x 21,147 rows,
 * 8.4 M rows removed by the join filter, 146k temp buffers), ~12 s for a reason view.
 */
function queueCte(inp: QueueSqlInputs): SQL {
  return sql`
    WITH cls AS (SELECT e->>0 AS id, e->>1 AS cat FROM jsonb_array_elements(${JSON.stringify(inp.classified)}::jsonb) e),
    fl AS (SELECT e->>0 AS ipo_id, e->>1 AS field_name FROM jsonb_array_elements(${JSON.stringify(inp.flagged)}::jsonb) e),
    held AS (SELECT split_part(k, '|', 1) AS ipo_id, split_part(k, '|', 2) AS hold_table, split_part(k, '|', 3) AS field_name
               FROM unnest(${textArray(inp.heldKeys)}) k),
    conf AS (
      SELECT 'conflict:' || c.id::text AS id, c.ipo_id::text AS ipo_id, c.table_name, c.field_name,
             coalesce(c.row_key, '') AS row_key,
             CASE WHEN c.resolution_reason = ${ADMIN_LIST_SUGGESTION} THEN 'OD-107'
                  WHEN c.source1::text = c.source2::text OR c.resolution_reason = ANY(${textArray(inp.od75Reasons)}) THEN 'OD-75'
                  WHEN c.field_name = ANY(${textArray(inp.bookkeepingFields)}) THEN 'F-181'
                  ELSE coalesce(cls.cat, 'disagreement') END AS cat,
             NULL::text AS reason_code, false AS has_flag,
             i.slug, i.company_name, i.status::text AS status, i.open_date, i.close_date, i.listing_date
        FROM data_conflicts c JOIN ipos i ON i.id = c.ipo_id LEFT JOIN cls ON cls.id = c.id::text
       WHERE c.resolved_at IS NULL),
    pl AS (
      SELECT p.id::text AS pid, p.ipo_id::text AS ipo_id, p.table_name, ${camel(sql`p.field_name`)} AS field_name,
             coalesce(p.row_key, '') AS row_key, p.reason_code,
             i.slug, i.company_name, i.status::text AS status, i.open_date, i.close_date, i.listing_date
        FROM ipo_field_plan p JOIN ipos i ON i.id = p.ipo_id
       WHERE p.state IN ('NOT_AVAILABLE_YET', 'CHECK_FAILED', 'EXHAUSTED')),
    plk AS (
      SELECT pl.* FROM pl
       WHERE NOT EXISTS (SELECT 1 FROM held h WHERE h.ipo_id = pl.ipo_id AND h.field_name = pl.field_name
                           AND h.hold_table = CASE WHEN pl.row_key = '' THEN pl.table_name ELSE pl.table_name || ':' || pl.row_key END)),
    items AS (
      SELECT id, ipo_id, table_name, field_name, row_key, cat, reason_code, has_flag,
             slug, company_name, status, open_date, close_date, listing_date FROM conf
      UNION ALL
      SELECT 'plan:' || plk.pid, plk.ipo_id, plk.table_name, plk.field_name, plk.row_key, 'missing', plk.reason_code,
             (plk.table_name = 'ipos' AND plk.row_key = ''
              AND EXISTS (SELECT 1 FROM fl WHERE fl.ipo_id = plk.ipo_id AND fl.field_name = plk.field_name)),
             plk.slug, plk.company_name, plk.status, plk.open_date, plk.close_date, plk.listing_date
        FROM plk
      UNION ALL
      SELECT 'flag:' || fl.ipo_id || ':' || fl.field_name, fl.ipo_id, 'ipos', fl.field_name, '', 'flagged', NULL, false,
             i.slug, i.company_name, i.status::text, i.open_date, i.close_date, i.listing_date
        FROM fl JOIN ipos i ON i.id::text = fl.ipo_id
       WHERE NOT EXISTS (SELECT 1 FROM plk WHERE plk.ipo_id = fl.ipo_id AND plk.table_name = 'ipos'
                           AND plk.row_key = '' AND plk.field_name = fl.field_name)),
    q AS (
      SELECT it.id, it.ipo_id, it.table_name, it.field_name, it.row_key, it.cat, it.reason_code, it.has_flag,
             it.slug, it.company_name, it.status, it.open_date::text AS open_date, it.close_date::text AS close_date,
             it.listing_date::text AS listing_date,
             CASE WHEN it.status NOT IN ('UPCOMING', 'OPEN', 'CLOSED') THEN 3
                  WHEN split_part(it.table_name, ':', 1) || '.' || it.field_name = ANY(${textArray(inp.publicFields)}) THEN 1
                  ELSE 2 END AS grp,
             CASE it.status WHEN 'UPCOMING' THEN coalesce(it.open_date, it.close_date)::text
                            WHEN 'OPEN' THEN coalesce(it.close_date, it.open_date)::text
                            WHEN 'CLOSED' THEN coalesce(it.listing_date, it.close_date)::text END AS nearest,
             CASE it.cat WHEN 'disagreement' THEN 0 WHEN 'missing' THEN 1 WHEN 'flagged' THEN 2 ELSE 3 END AS cat_rank,
             CASE WHEN it.cat IN ('disagreement', 'missing', 'flagged') THEN it.cat ELSE 'ruled' END AS kind
        FROM items it)`;
}

function viewWhere(v: QueueSqlView): SQL {
  const parts: SQL[] = [sql`true`];
  if (v.group) parts.push(sql`grp = ${v.group}`);
  if (v.kind) parts.push(sql`kind = ${v.kind}`);
  if (v.ipoSlug) parts.push(sql`slug = ${v.ipoSlug}`);
  const r = v.reason;
  if (r) {
    if ('cat' in r) parts.push(sql`cat = ${r.cat}`);
    else if ('failedValidation' in r) parts.push(sql`(cat = 'flagged' OR has_flag)`);
    else if (r.reasonCode === null) parts.push(sql`(cat = 'missing' AND reason_code IS NULL)`);
    else parts.push(sql`(cat = 'missing' AND reason_code = ${r.reasonCode})`);
  }
  return sql.join(parts, sql` AND `);
}

function idList(ids: string[]): SQL {
  return sql.join(ids.map((id) => sql`${id}`), sql`, `);
}

export class AdminQueuePageRepository extends BaseRepository {
  /** Conflicts SQL cannot classify alone, with their values, for the one JS rule check (ruleFilterFor). */
  async listCandidateConflicts(od75Reasons: readonly string[], bookkeepingFields: readonly string[]): Promise<CandidateConflictRow[]> {
    const r = await this.db.execute(sql`
      SELECT c.id::text AS id, c.table_name, c.field_name, c.source1::text AS source1, c.source2::text AS source2,
             c.value1, c.value2, c.resolution_reason
        FROM data_conflicts c
       WHERE c.resolved_at IS NULL AND c.source1::text <> c.source2::text
         AND (c.resolution_reason IS NULL OR NOT c.resolution_reason = ANY(${textArray(od75Reasons)}))
         AND NOT c.field_name = ANY(${textArray(bookkeepingFields)})`);
    return (r.rows ?? []) as unknown as CandidateConflictRow[];
  }

  /** The queue's JS-side setup data, cached for CacheTTL.ADMIN_QUEUE; every admin save drops the key. */
  async cachedSetup<T>(load: () => Promise<T>): Promise<T> {
    return this.getFromCache(getAdminQueueSetupKey(), load, CacheTTL.ADMIN_QUEUE);
  }

  /**
   * A4 fix: the cached setup (flagged values, rule classifications) can be up to
   * CacheTTL.ADMIN_QUEUE seconds behind a page whose SQL runs live. When a page row names a flag or
   * rule this cache does not yet know, the caller drops this key so the next `cachedSetup` reloads
   * fresh, rather than serving a stale reason for the whole TTL.
   */
  async dropSetupCache(): Promise<void> {
    try {
      await this.redis.del(getAdminQueueSetupKey());
    } catch (error) {
      console.warn('[AdminQueue] failed to drop the stale setup cache key:', error);
    }
  }

  /** counts(), cached for CacheTTL.ADMIN_QUEUE (view-independent); every admin save drops the key. */
  async cachedCounts(inp: QueueSqlInputs): Promise<QueueCountRow[]> {
    return this.getFromCache(getAdminQueueCountsKey(), () => this.counts(inp), CacheTTL.ADMIN_QUEUE);
  }

  /** Whole-queue counts: per group (items, IPOs) and per category / reason code / flag. */
  async counts(inp: QueueSqlInputs): Promise<QueueCountRow[]> {
    const r = await this.db.execute(sql`${queueCte(inp)}
      SELECT 'group' AS tag, grp, NULL::text AS cat, NULL::text AS reason_code, NULL::boolean AS has_flag,
             count(*)::int AS n, count(DISTINCT ipo_id)::int AS ipos
        FROM q GROUP BY grp
      UNION ALL
      SELECT 'reason', NULL, cat, reason_code, has_flag, count(*)::int, NULL FROM q GROUP BY cat, reason_code, has_flag`);
    return (r.rows ?? []) as unknown as QueueCountRow[];
  }

  /**
   * One page of entries in OD-136 order: group 1 then group 2 items, then group-3 IPOs collapsed
   * (newest listing first). `ord` is the 1-based position in the whole filtered queue, `total` its
   * length. With `ipoSlug`, that IPO's items only, in the within-IPO order.
   */
  async page(inp: QueueSqlInputs, view: QueueSqlView, offset: number, limit: number): Promise<QueuePageRow[]> {
    const body = view.ipoSlug
      ? sql`
      e AS (SELECT 'item' AS entry, row_number() OVER (ORDER BY ${IPO_ITEM_ORDER})::int AS ord, count(*) OVER ()::int AS total,
                   id, ipo_id, table_name, field_name, row_key, cat, reason_code, has_flag, grp,
                   slug, company_name, status, open_date, close_date, listing_date,
                   NULL::int AS disagreements, NULL::int AS missing, NULL::int AS flagged, NULL::int AS ruled
              FROM f)`
      : sql`
      it AS (SELECT row_number() OVER (ORDER BY ${ITEM_ORDER})::int AS o, f.* FROM f WHERE grp < 3),
      g3 AS (SELECT ipo_id, slug, company_name, status, open_date, close_date, listing_date,
                    count(*) FILTER (WHERE kind = 'disagreement')::int AS disagreements,
                    count(*) FILTER (WHERE kind = 'missing')::int AS missing,
                    count(*) FILTER (WHERE kind = 'flagged')::int AS flagged,
                    count(*) FILTER (WHERE kind = 'ruled')::int AS ruled
               FROM f WHERE grp = 3 GROUP BY ipo_id, slug, company_name, status, open_date, close_date, listing_date),
      g3o AS (SELECT row_number() OVER (ORDER BY listing_date DESC NULLS LAST, slug COLLATE "C")::int AS o, g3.* FROM g3),
      n AS (SELECT (SELECT count(*) FROM it)::int AS items, (SELECT count(*) FROM g3)::int AS ipos),
      e AS (
        SELECT 'item' AS entry, it.o AS ord, (SELECT items + ipos FROM n) AS total,
               id, ipo_id, table_name, field_name, row_key, cat, reason_code, has_flag, grp,
               slug, company_name, status, open_date, close_date, listing_date,
               NULL::int AS disagreements, NULL::int AS missing, NULL::int AS flagged, NULL::int AS ruled
          FROM it
        UNION ALL
        SELECT 'ipo', (SELECT items FROM n) + g3o.o, (SELECT items + ipos FROM n),
               NULL, ipo_id, NULL, NULL, NULL, NULL, NULL, NULL, 3,
               slug, company_name, status, open_date, close_date, listing_date,
               disagreements, missing, flagged, ruled
          FROM g3o)`;
    const r = await this.db.execute(sql`${queueCte(inp)},
      f AS (SELECT * FROM q WHERE ${viewWhere(view)}),
      ${body}
      SELECT * FROM e WHERE ord > ${offset} AND ord <= ${offset + limit}
      UNION ALL
      SELECT 'total', 0, (SELECT max(total) FROM e), NULL, '', NULL, NULL, NULL, NULL, NULL, NULL, 0,
             NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      ORDER BY 2`);
    return (r.rows ?? []) as unknown as QueuePageRow[];
  }

  /** The page's conflict rows: values and sources (admin-only, item 24). */
  async conflictDetails(ids: string[]): Promise<ConflictRow[]> {
    if (ids.length === 0) return [];
    const r = await this.db.execute(sql`
      SELECT c.id::text AS id, c.table_name, c.row_key, c.field_name, c.source1::text AS source1, c.value1,
             c.source2::text AS source2, c.value2, c.resolution_reason, c.document_id, c.evidence, ${IPO_COLUMNS}
        FROM data_conflicts c JOIN ipos i ON i.id = c.ipo_id
       WHERE c.id::text IN (${idList(ids)})`);
    return (r.rows ?? []) as unknown as ConflictRow[];
  }

  /** The page's plan rows: state and reason code. */
  async planDetails(ids: string[]): Promise<PlanRow[]> {
    if (ids.length === 0) return [];
    const r = await this.db.execute(sql`
      SELECT p.id::text AS id, p.table_name, p.row_key, p.field_name, p.state::text AS state, p.reason_code, ${IPO_COLUMNS}
        FROM ipo_field_plan p JOIN ipos i ON i.id = p.ipo_id
       WHERE p.id::text IN (${idList(ids)})`);
    return (r.rows ?? []) as unknown as PlanRow[];
  }
}
