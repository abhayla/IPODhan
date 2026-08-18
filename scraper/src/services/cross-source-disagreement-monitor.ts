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
 * Field-name keys (`price_band_min`, `open_date`, `gmp_price`, ...) match
 * `field-priority-matrix.ts`'s matrix keys, which is what
 * `data-consolidation-service.ts` writes into `data_conflicts.field_name`.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { dataConflicts, ipos } from '@ipodhan/shared/db/schema';
import { notifyOwner } from './owner-notify.js';
import logger from '../utils/logger.js';

/** Fields compared for OPEN IPOs, per DoD: price band, open/close dates, and GMP. */
export const COMPARED_FIELDS = [
  'price_band_min',
  'price_band_max',
  'open_date',
  'close_date',
  'gmp_price',
  'gmp_percentage',
] as const;

/**
 * A disagreement on one of these fields for an OPEN IPO is P1 (per DoD:
 * "a disagreement on a HIGH-value field (price band or dates)"). GMP fields
 * are compared too but stay at the P2 tier — the DoD names only price band
 * and dates as HIGH-value.
 */
export const HIGH_VALUE_FIELDS = new Set<string>(['price_band_min', 'price_band_max', 'open_date', 'close_date']);

export interface DisagreementRecord {
  ipoId: string;
  companyName: string;
  fieldName: string;
  source1: string;
  value1: string | null;
  source2: string;
  value2: string | null;
  severity: 'P1' | 'P2';
}

export interface DisagreementReport {
  openIpoCount: number;
  disagreements: DisagreementRecord[];
  highValueCount: number;
  otherCount: number;
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
        inArray(dataConflicts.fieldName, [...COMPARED_FIELDS])
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
  }));

  const highValue = disagreements.filter((d) => d.severity === 'P1');
  const other = disagreements.filter((d) => d.severity === 'P2');

  for (const d of highValue) {
    notifyOwner('P1', `Cross-source disagreement: ${d.companyName} — ${d.fieldName}`, {
      body: `${d.source1}="${d.value1}" vs ${d.source2}="${d.value2}" (open IPO, unresolved).`,
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
