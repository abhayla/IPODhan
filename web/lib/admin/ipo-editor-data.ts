/**
 * Server data for the IPO page editor (spec §9.2 items 2, 5, 7, 17, 18, 20; §9.3; OD-103, OD-106,
 * OD-137). Admin-only: returned by GET /api/admin/ipos/[id]/editor, never by the public page
 * (item 24: source values never reach a reader, its payload or its cache keys).
 *
 * Every editable field carries the version token and the current value read TOGETHER through the
 * ONE admin write's own reader (`readAdminFieldVersion`), never a cached public value: an editor that
 * shows a cached value with a fresh token would let a save silently undo a newer change (item 20).
 * The token is read before the value, so a change landing in between makes the save refuse with the
 * newer value (409), never overwrite it.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getTableColumns } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@ipodhan/shared/db/schema';
import { readAdminFieldVersion } from '@ipodhan/shared/services/admin-field-write';
import {
  E1_RULE_TEXT,
  PLAN_REBUILD_NOTICE,
  editorFieldCatalog,
  ipoTypeKey,
  type EditorFieldSpec,
  type EditorTable,
  isEditorFieldApplicable,
} from './ipo-editor-fields';

type Db = NodePgDatabase<typeof schema>;

const TABLES: Record<EditorTable, PgTable> = {
  ipos: schema.ipos,
  ipo_details: schema.ipoDetails,
  financial_data: schema.financialData,
  listing_performance: schema.listingPerformance,
};

/** The document labels a witness may carry for the manifest's `DOC` rank (the offer document, best type). */
const DOC_LABELS = new Set(['DOC', 'DRHP', 'RHP', 'PROSPECTUS', 'CORRIGENDUM', 'PRICE_BAND_AD']);
const SOURCE_ALIASES: Record<string, Set<string>> = {
  DOC: DOC_LABELS,
  CHITTORGARH: new Set(['CHITTORGARH', 'CG']),
};

export function labelMatchesRank(label: unknown, rank: string): boolean {
  if (typeof label !== 'string') return false;
  const l = label.trim().toUpperCase();
  return (SOURCE_ALIASES[rank] ?? new Set([rank])).has(l);
}

/**
 * One ranked source's answer (§9.3): the value it gave, that it abstained (OD-60), the cause it
 * failed with, or that it was never asked (an IPO whose round ran before OD-103).
 */
export interface SourceWitness {
  rank: number;
  /** The Appendix A label (DOC, NSE, BSE, CHITTORGARH). */
  source: string;
  status: 'value' | 'abstained' | 'failed' | 'never_asked';
  value: unknown;
  cause: string | null;
  /** When the source was read (text as stored, UTC). */
  readAt: string | null;
  /** The document type for a DOC answer (RHP, PROSPECTUS, ...). */
  docType: string | null;
  /** The exact label a pick must send (the stored witness's own label); null when there is nothing to pick. */
  pickLabel: string | null;
  /** This source supplies the value the page shows now. */
  current: boolean;
}

export interface EditorField extends Omit<EditorFieldSpec, 'tableName'> {
  tableName: EditorTable;
  /** The drizzle property name the write takes (camelCase). */
  fieldName: string;
  rowKey: string;
  currentValue: unknown;
  /** Present for panel/setting fields: the token the save must carry (item 20). */
  version: string | null;
  setBy: string | null;
  setAt: string | null;
  /** field_sources.source for the value shown now (ADMIN, NSE, RHP, ...), or null. */
  currentSource: string | null;
  /** When the value is an admin value: how it was set. */
  admin: { mode: 'pick' | 'typed' | null; sourceLabel: string | null; empty: boolean } | null;
  witnesses: SourceWitness[];
  e1Rule: string | null;
  /** §2.8 / §9.2 item 18: the notice shown before saving a plan-invalidating field, else null. */
  planRebuildNotice: string | null;
  notApplicable: boolean;
}

export interface EditorPayload {
  ipo: { id: string; slug: string; companyName: string; status: string | null; offeringType: string | null; typeKey: string };
  fields: EditorField[];
}

interface StoredAnswer {
  source?: unknown;
  value?: unknown;
  at?: unknown;
  docType?: unknown;
  outcome?: unknown;
  cause?: unknown;
}

function statusOf(outcome: unknown): SourceWitness['status'] {
  if (outcome === undefined || outcome === null || outcome === 'SUPPLIED') return 'value';
  if (outcome === 'NOT_PRINTED' || outcome === 'NOT_AVAILABLE_YET') return 'abstained';
  return 'failed';
}

/**
 * Build the per-source rows for one field (§9.3). Order of evidence, the same as
 * loadStoredSourceAnswer in the ONE write: the field_sources witnesses; the stored value itself when
 * that source supplied it before witnesses existed; the plan row's answers (OD-137, a field whose
 * last pass stored no value).
 */
export function buildWitnesses(args: {
  ranks: string[];
  witnesses: unknown;
  planAnswers: unknown;
  fsSource: string | null;
  fsAt: string | null;
  currentValue: unknown;
}): SourceWitness[] {
  const lists = [args.witnesses, args.planAnswers].map((l) => (Array.isArray(l) ? (l as StoredAnswer[]) : []));
  return args.ranks.map((rank, i) => {
    const current = args.fsSource !== null && args.fsSource !== 'ADMIN' && labelMatchesRank(args.fsSource, rank);
    for (const list of lists) {
      const w = list.find((x) => x && labelMatchesRank(x.source, rank));
      if (!w) continue;
      const status = statusOf(w.outcome);
      const hasValue = status === 'value' && w.value !== null && w.value !== undefined;
      return {
        rank: i + 1,
        source: rank,
        status: status === 'value' && !hasValue ? 'abstained' : status,
        value: hasValue ? w.value : null,
        cause: typeof w.cause === 'string' ? w.cause : null,
        readAt: typeof w.at === 'string' ? w.at : null,
        docType: typeof w.docType === 'string' ? w.docType : null,
        pickLabel: hasValue ? String(w.source) : null,
        current,
      };
    }
    if (current && args.currentValue !== null && args.currentValue !== undefined) {
      return {
        rank: i + 1,
        source: rank,
        status: 'value',
        value: args.currentValue,
        cause: null,
        readAt: args.fsAt,
        docType: DOC_LABELS.has(String(args.fsSource)) ? String(args.fsSource) : null,
        pickLabel: String(args.fsSource),
        current,
      };
    }
    return { rank: i + 1, source: rank, status: 'never_asked', value: null, cause: null, readAt: null, docType: null, pickLabel: null, current };
  });
}

function camelNameFor(table: PgTable, sqlName: string): string | null {
  const cols = getTableColumns(table) as Record<string, { name: string }>;
  for (const [prop, col] of Object.entries(cols)) if (col.name === sqlName) return prop;
  return null;
}

function lineageOf(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** The editor payload for one IPO, or null when the IPO does not exist. Any status (item 17). */
export async function loadIpoEditor(db: Db, ipoId: string): Promise<EditorPayload | null> {
  const [ipo] = await db
    .select({
      id: schema.ipos.id,
      slug: schema.ipos.slug,
      companyName: schema.ipos.companyName,
      status: schema.ipos.status,
      offeringType: schema.ipos.offeringType,
      segment: schema.ipos.segment,
      listingExchanges: schema.ipos.listingExchanges,
    })
    .from(schema.ipos)
    .where(eq(schema.ipos.id, ipoId))
    .limit(1);
  if (!ipo) return null;
  const typeKey = ipoTypeKey({ segment: ipo.segment as string | null, listingExchanges: ipo.listingExchanges as string[] | null });

  const [fsRows, planRows, rows] = await Promise.all([
    db
      .select({
        tableName: schema.fieldSources.tableName,
        fieldName: schema.fieldSources.fieldName,
        source: schema.fieldSources.source,
        witnesses: schema.fieldSources.witnesses,
        dataLineage: schema.fieldSources.dataLineage,
        at: sql<string>`${schema.fieldSources.updatedAt}::text`,
      })
      .from(schema.fieldSources)
      .where(and(eq(schema.fieldSources.ipoId, ipoId), eq(schema.fieldSources.rowKey, ''))),
    db
      .select({ tableName: schema.ipoFieldPlan.tableName, fieldName: schema.ipoFieldPlan.fieldName, answers: schema.ipoFieldPlan.answers })
      .from(schema.ipoFieldPlan)
      .where(and(eq(schema.ipoFieldPlan.ipoId, ipoId), eq(schema.ipoFieldPlan.rowKey, ''))),
    Promise.all(
      (Object.entries(TABLES) as Array<[EditorTable, PgTable]>).map(async ([name, table]) => {
        const cols = getTableColumns(table) as unknown as Record<string, never>;
        const where = name === 'ipos' ? eq(cols.id, ipoId) : eq(cols.ipoId, ipoId);
        const found = (await db.select().from(table as never).where(where).limit(1)) as Array<Record<string, unknown>>;
        return [name, found[0] ?? null] as const;
      })
    ),
  ]);
  const rowByTable = Object.fromEntries(rows) as Record<EditorTable, Record<string, unknown> | null>;
  // field_sources.field_name is the camelCase property; ipo_field_plan.field_name is the SQL name.
  const fsByKey = new Map(fsRows.map((r) => [`${r.tableName}.${r.fieldName}`, r]));
  const planByKey = new Map(planRows.map((r) => [`${r.tableName}.${r.fieldName}`, r]));

  const specs = editorFieldCatalog(typeKey)
    .map((spec) => ({ spec, fieldName: camelNameFor(TABLES[spec.tableName], spec.column) }))
    // a manifest column with no schema column cannot be shown or written
    .filter((x): x is { spec: EditorFieldSpec; fieldName: string } => x.fieldName !== null);
  const tokens = await mapLimited(specs, 8, ({ spec, fieldName }) =>
    spec.mode === 'panel' || spec.mode === 'setting'
      ? readAdminFieldVersion(db as never, ipoId, spec.tableName, fieldName)
      : Promise.resolve(null)
  );

  const fields: EditorField[] = [];
  for (const [i, { spec, fieldName }] of specs.entries()) {
    const fs = fsByKey.get(`${spec.tableName}.${fieldName}`) ?? null;
    const plan = planByKey.get(`${spec.tableName}.${spec.column}`) ?? null;
    let version: string | null = null;
    let setBy: string | null = null;
    let setAt: string | null = null;
    let currentValue: unknown = rowByTable[spec.tableName]?.[fieldName] ?? null;
    {
      const v = tokens[i];
      if (v) {
        version = v.version;
        setBy = v.setBy;
        setAt = v.setAt;
        currentValue = v.currentValue;
      }
    }
    const lineage = lineageOf(fs?.dataLineage);
    const isAdmin = fs?.source === 'ADMIN';
    fields.push({
      ...spec,
      fieldName,
      rowKey: '',
      currentValue,
      version,
      setBy,
      setAt,
      currentSource: fs?.source ?? null,
      admin: isAdmin
        ? {
            mode: lineage.mode === 'pick' || lineage.mode === 'typed' ? lineage.mode : null,
            sourceLabel: typeof lineage.sourceLabel === 'string' ? lineage.sourceLabel : null,
            empty: currentValue === null && lineage.adminEmpty === true,
          }
        : null,
      witnesses:
        spec.mode === 'panel'
          ? buildWitnesses({
              ranks: spec.sources,
              witnesses: fs?.witnesses,
              planAnswers: plan?.answers,
              fsSource: fs?.source ?? null,
              fsAt: fs?.at ?? null,
              currentValue,
            })
          : [],
      e1Rule: spec.e1 && spec.mode === 'panel' ? E1_RULE_TEXT : null,
      planRebuildNotice: spec.planRebuild ? PLAN_REBUILD_NOTICE : null,
      notApplicable: !isEditorFieldApplicable(spec.key, {
        segment: ipo.segment as string | null,
        listingExchanges: ipo.listingExchanges as string[] | null,
        offeringType: (ipo.offeringType as string | null) ?? null,
      }),
    });
  }

  return {
    ipo: {
      id: ipo.id,
      slug: ipo.slug,
      companyName: ipo.companyName,
      status: (ipo.status as string | null) ?? null,
      offeringType: (ipo.offeringType as string | null) ?? null,
      typeKey,
    },
    fields,
  };
}
