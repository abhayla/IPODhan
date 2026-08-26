/**
 * Cross-source disagreement report (T-195) — the genuine gap identified by
 * T-177's inventory: coverage + plausibility checks already exist
 * (`scripts/audit-*.mjs`, run against the CONSOLIDATED `ipos` table), but
 * nothing surfaces when two scraper SOURCES currently disagree on the same
 * field for an OPEN IPO.
 *
 * This EXTENDS the existing conflict-detection subsystem rather than
 * duplicating it: `data-consolidation-service.ts` already logs a
 * `data_conflicts` row (via `DataConflictsRepository.logConflict`) every time
 * an incoming scrape disagrees with the currently-stored value for a field
 * (gated by `FEATURE_FLAGS.ENABLE_CONFLICT_DETECTION` /
 * `ENABLE_DATA_CONSOLIDATION` — see `.claude/rules/owner-gated-feature-flags.md`;
 * both default OFF, so this report is silent until an owner enables them —
 * see this PR's body). This module reads THOSE existing rows for OPEN IPOs
 * and reports/alerts on the ones that matter most.
 *
 * Field-name keys MUST be the keys consolidation actually writes into
 * `data_conflicts.field_name` — i.e. the camelCase property names on the
 * payload `data-persister.ts` / `data-consolidation-orchestrator.ts` hand to
 * `consolidateIPOData` (`priceRangeMin`, `openDate`, ...), NOT the snake_case
 * names some `field-priority-matrix.ts` entries still use.
 *
 * T-276: they were snake_case here, so the `inArray(fieldName, ...)` filter
 * matched nothing and the price-band alert could never fire — while prod
 * `data_conflicts` was full of `priceRangeMin` NSE-vs-NSE rows. Verified
 * against prod: every row in `data_conflicts` and every row in
 * `field_sources` uses the camelCase names.
 */
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { dataConflicts, ipos } from '@ipodhan/shared/db/schema';
import { notifyOwner } from './owner-notify.js';
import logger from '../utils/logger.js';

/** Fields compared for OPEN IPOs, per DoD: price band, open/close dates, and GMP. */
export const COMPARED_FIELDS = [
  'priceRangeMin',
  'priceRangeMax',
  'openDate',
  'closeDate',
  // GMP is not consolidated today — `consolidateIPOData` is only ever called
  // with `tableName: 'ipos'`, so no GMP conflict row exists under ANY key.
  // Listed so the report picks them up the moment a GMP consolidation path
  // lands; until then these two contribute nothing (T-276).
  'gmpPrice',
  'gmpPercentage',
] as const;

/**
 * A disagreement on one of these fields for an OPEN IPO is P1 (per DoD:
 * "a disagreement on a HIGH-value field (price band or dates)"). GMP fields
 * are compared too but stay at the P2 tier — the DoD names only price band
 * and dates as HIGH-value.
 */
export const HIGH_VALUE_FIELDS = new Set<string>(['priceRangeMin', 'priceRangeMax', 'openDate', 'closeDate']);

export interface DisagreementRecord {
  ipoId: string;
  companyName: string;
  fieldName: string;
  source1: string;
  value1: string | null;
  source2: string;
  value2: string | null;
  severity: 'P1' | 'P2';
  resolutionReason: string | null;
  resolvedSource: string | null;
}

export interface DisagreementReport {
  openIpoCount: number;
  disagreements: DisagreementRecord[];
  highValueCount: number;
  otherCount: number;
}

/**
 * T-328: state what the system DID about a HIGH_VALUE disagreement, not just
 * the raw disagreeing values — an alert that only reports "wrong value
 * published" is the pre-HOLD behaviour. Reads the SAME
 * `data_conflicts.resolutionReason`/`resolvedSource` that
 * `data-consolidation-service.ts::resolveConflict` now writes (no schema
 * change; these columns already existed).
 *
 * - `HELD_DISPUTED_HIGH_VALUE_LIVE` -> HOLD fired: the previously-published
 *   value stayed live, nothing was asserted one-sided.
 * - `TZ_SIGNATURE_TIEBREAK_PREFER_NON_NSE` -> the interim T-327 tie-break
 *   resolved it by preferring the non-NSE source.
 * - Anything else (or no resolution recorded, e.g. detection ran independently
 *   of a consolidation cycle) falls back to the raw-values description so the
 *   alert never silently omits the disagreement itself.
 */
export function buildDisagreementActionBody(d: DisagreementRecord): string {
  if (d.resolutionReason === 'HELD_DISPUTED_HIGH_VALUE_LIVE') {
    const publishedValue = d.resolvedSource === d.source1 ? d.value1 : d.value2;
    const publishedSource = d.resolvedSource ?? d.source1;
    return `HELD — no value published change; ${publishedValue} (${publishedSource}) stays live. (${d.source1}="${d.value1}" vs ${d.source2}="${d.value2}")`;
  }

  if (d.resolutionReason === 'TZ_SIGNATURE_TIEBREAK_PREFER_NON_NSE') {
    const chosenValue = d.resolvedSource === d.source1 ? d.value1 : d.value2;
    const nonNseSource = d.resolvedSource ?? (d.source1 === 'NSE' ? d.source2 : d.source1);
    return `TIE-BROKEN — preferred ${nonNseSource} (${chosenValue}) over NSE per the T-327 TZ-signature interim rule.`;
  }

  return `${d.source1}="${d.value1}" vs ${d.source2}="${d.value2}" (open IPO, unresolved).`;
}

/**
 * Query unresolved data_conflicts for OPEN IPOs, restricted to the compared
 * fields, and fire owner alerts: one P1 per (ipoId, fieldName) for
 * HIGH_VALUE_FIELDS, and a single aggregated P2 summary for the rest (so N
 * simultaneous GMP disagreements page once, not N times).
 *
 * Empty-data-safe by construction: zero OPEN IPOs or zero conflict rows both
 * fall through to an empty report with no notify calls — no special-casing
 * needed for a fresh/empty database.
 */
export async function checkCrossSourceDisagreements(
  db: NodePgDatabase<typeof schema>,
  now: Date = new Date()
): Promise<DisagreementReport> {
  const openIpos = await db
    .select({ id: ipos.id, companyName: ipos.companyName })
    .from(ipos)
    .where(eq(ipos.status, 'OPEN'));

  if (openIpos.length === 0) {
    return { openIpoCount: 0, disagreements: [], highValueCount: 0, otherCount: 0 };
  }

  const openIpoIds = openIpos.map((ipo) => ipo.id);
  const nameById = new Map(openIpos.map((ipo) => [ipo.id, ipo.companyName]));

  const conflictRows = await db
    .select()
    .from(dataConflicts)
    .where(
      and(
        isNull(dataConflicts.resolvedAt),
        inArray(dataConflicts.ipoId, openIpoIds),
        inArray(dataConflicts.fieldName, [...COMPARED_FIELDS]),
        // T-286 (P1-2 defense-in-depth): a row where source1 === source2 is a
        // same-source refresh, not a cross-source disagreement -- the write
        // path (data-consolidation-service.ts) now excludes these at the
        // source, but this filter guards the report against any stale rows
        // or a future regression in that write path.
        ne(dataConflicts.source1, dataConflicts.source2)
      )
    );

  const disagreements: DisagreementRecord[] = conflictRows.map((row) => ({
    ipoId: row.ipoId,
    companyName: nameById.get(row.ipoId) ?? row.ipoId,
    fieldName: row.fieldName,
    source1: row.source1,
    value1: row.value1,
    source2: row.source2,
    value2: row.value2,
    severity: HIGH_VALUE_FIELDS.has(row.fieldName) ? 'P1' : 'P2',
    resolutionReason: row.resolutionReason ?? null,
    resolvedSource: row.resolvedSource ?? null,
  }));

  const highValue = disagreements.filter((d) => d.severity === 'P1');
  const other = disagreements.filter((d) => d.severity === 'P2');

  for (const d of highValue) {
    notifyOwner('P1', `Cross-source disagreement: ${d.companyName} — ${d.fieldName}`, {
      body: buildDisagreementActionBody(d),
      type: 'cross-source-disagreement',
      dedupeKey: `disagreement:${d.ipoId}:${d.fieldName}:${now.toISOString().slice(0, 10)}`,
    });
  }

  if (other.length > 0) {
    notifyOwner('P2', `Cross-source GMP disagreement report: ${other.length} open IPO field(s)`, {
      body: other
        .map((d) => `${d.companyName} (${d.fieldName}): ${d.source1}="${d.value1}" vs ${d.source2}="${d.value2}"`)
        .join('; '),
      type: 'cross-source-disagreement-summary',
      dedupeKey: `disagreement-summary:${now.toISOString().slice(0, 10)}`,
    });
  }

  if (disagreements.length > 0) {
    logger.warn(
      { openIpoCount: openIpos.length, highValueCount: highValue.length, otherCount: other.length },
      'Cross-source disagreements detected for open IPOs'
    );
  }

  return {
    openIpoCount: openIpos.length,
    disagreements,
    highValueCount: highValue.length,
    otherCount: other.length,
  };
}
