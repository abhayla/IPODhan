/**
 * #993 repair: stamp `field_sources.data_lineage.documentId` on `ipos` provenance rows the filing
 * path wrote before the fix (source DRHP, no documentId).
 *
 * Why it is safe to name a document after the fact — the MATCHING RULE:
 *
 *   The filing path writes a document's `ipos` fields through `upsertIPO` and THEN stamps that
 *   document `extraction_status = 'COMPLETED', extracted_at = now()` (filing-auto-persist.ts). So a
 *   row that document wrote has `updated_at` a moment BEFORE the document's `extracted_at`.
 *   Measured on ipodhan_staging 2026-09-25 over the 331 DRHP-source `ipos` rows with no
 *   documentId: 221 rows sit 0.14 s to 4.6 s before a document's extracted_at; the next-nearest
 *   gap is 1,791 s. The window is therefore 10 s: `extracted_at` in [updated_at, updated_at + 10 s].
 *
 *   A row is stamped ONLY when exactly ONE document of the same IPO — of ANY status — has its
 *   extracted_at inside that window, and that one document is COMPLETED and of a type the filing
 *   path writes `ipos` from (RHP, DRHP, PROSPECTUS, PRICE_BAND_AD). Zero candidates (the row was
 *   re-stamped later, or its document was re-extracted) and two or more candidates (documents of
 *   one IPO completed seconds apart) are listed and LEFT ALONE: the rule never picks between
 *   documents, so it cannot pick the wrong one. The write re-checks `updated_at` and the missing
 *   documentId in its WHERE clause, so a row that changed after the read is skipped, and a second
 *   run finds nothing to do (idempotent).
 *
 *   `updated_at` is NOT bumped: this names the evidence of an existing write, it is not a new
 *   write (OD-73). The row also records `documentIdRepair` so the stamp is distinguishable from
 *   one the persister wrote itself.
 *
 * Usage (from scraper/):
 *   DATABASE_URL=... npx tsx scripts/repair-ipos-lineage-document-id.ts --expect-db ipodhan_staging        # dry run
 *   DATABASE_URL=... npx tsx scripts/repair-ipos-lineage-document-id.ts --expect-db ipodhan_test --apply
 *   Production additionally needs --allow-prod.
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import { sql } from 'drizzle-orm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRepairDb, queryCurrentDatabase, writeLedgerFile, type ExecuteLike } from './lib/repair-tool';

const TOOL = 'repair-ipos-lineage-document-id';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WINDOW_SECONDS = 10;
export const FILING_TYPES_WRITING_IPOS: ReadonlySet<string> = new Set(['RHP', 'DRHP', 'PROSPECTUS', 'PRICE_BAND_AD']);
export const REPAIR_MARKER = 'repair-993-extracted-at-window-10s';

export interface CandidateDocument {
  id: string;
  type: string;
  extractionStatus: string | null;
  extractedAt: string;
}

export interface CandidateRow {
  id: string;
  ipoId: string;
  slug: string;
  fieldName: string;
  updatedAt: string;
  documents: CandidateDocument[];
}

export type RowDecision =
  | { kind: 'stamp'; row: CandidateRow; documentId: string }
  | { kind: 'skip'; row: CandidateRow; reason: 'NO_CANDIDATE' | 'SEVERAL_CANDIDATES' | 'NOT_A_COMPLETED_FILING' };

/** The matching rule, pure: exactly one document in the window, and it is a COMPLETED filing. */
export function decideRow(row: CandidateRow): RowDecision {
  if (row.documents.length === 0) return { kind: 'skip', row, reason: 'NO_CANDIDATE' };
  if (row.documents.length > 1) return { kind: 'skip', row, reason: 'SEVERAL_CANDIDATES' };
  const only = row.documents[0];
  if (only.extractionStatus !== 'COMPLETED' || !FILING_TYPES_WRITING_IPOS.has(only.type)) {
    return { kind: 'skip', row, reason: 'NOT_A_COMPLETED_FILING' };
  }
  return { kind: 'stamp', row, documentId: only.id };
}

/** The drizzle surface the repair needs (the scraper's `db`, or a test's drizzle over ipodhan_test). */
export interface RepairDb {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
  transaction<T>(fn: (tx: { execute(query: ReturnType<typeof sql>): Promise<unknown> }) => Promise<T>): Promise<T>;
}

/** Reads every DRHP-source `ipos` row with no documentId and decides each one. Read-only. */
export async function planLineageRepair(dbx: RepairDb): Promise<{
  rows: CandidateRow[];
  toStamp: Array<Extract<RowDecision, { kind: 'stamp' }>>;
  skipped: Array<Extract<RowDecision, { kind: 'skip' }>>;
}> {
  // Every document of the IPO whose extracted_at falls in the window, of ANY status: a
  // non-COMPLETED document in the window still makes the row ambiguous.
  const res = await dbx.execute(sql`
    select fs.id::text as id, fs.ipo_id::text as "ipoId", i.slug as slug, fs.field_name as "fieldName",
           to_char(fs.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') as "updatedAt",
           coalesce((
             select json_agg(json_build_object(
                      'id', d.id::text, 'type', d.type::text, 'extractionStatus', d.extraction_status,
                      'extractedAt', to_char(d.extracted_at, 'YYYY-MM-DD"T"HH24:MI:SS.US'))
                    order by d.extracted_at)
               from documents d
              where d.ipo_id = fs.ipo_id
                and d.extracted_at between fs.updated_at and fs.updated_at + make_interval(secs => ${WINDOW_SECONDS})
           ), '[]'::json) as documents
      from field_sources fs
      join ipos i on i.id = fs.ipo_id
     where fs.table_name = 'ipos'
       and fs.source = 'DRHP'
       and (fs.data_lineage->>'documentId') is null
     order by i.slug, fs.field_name`);
  const rows = (res as unknown as { rows: CandidateRow[] }).rows;
  const decisions = rows.map(decideRow);
  const toStamp = decisions.filter((d): d is Extract<RowDecision, { kind: 'stamp' }> => d.kind === 'stamp');
  const skipped = decisions.filter((d): d is Extract<RowDecision, { kind: 'skip' }> => d.kind === 'skip');

  return { rows, toStamp, skipped };
}

/** Stamps each decided row, re-checking in the WHERE clause that it is still unstamped and unchanged. */
export async function applyStamps(
  dbx: RepairDb,
  toStamp: ReadonlyArray<Extract<RowDecision, { kind: 'stamp' }>>
): Promise<{ stampedIds: string[] }> {
  const stampedIds: string[] = [];
  if (toStamp.length > 0) {
    await dbx.transaction(async (tx) => {
      for (const d of toStamp) {
        const out = await tx.execute(sql`
          update field_sources
             set data_lineage = coalesce(data_lineage, '{}'::jsonb)
                   || jsonb_build_object('documentId', ${d.documentId}::text, 'documentIdRepair', ${REPAIR_MARKER}::text)
           where id = ${d.row.id}::uuid
             and (data_lineage->>'documentId') is null
             and to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') = ${d.row.updatedAt}
          returning id::text as id`);
        const hit = (out as unknown as { rows: Array<{ id: string }> }).rows;
        if (hit.length === 1) stampedIds.push(hit[0].id);
      }
    });
  }

  return { stampedIds };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cli = { apply: argv.includes('--apply'), allowProd: argv.includes('--allow-prod'), expectDb: valueAfter(argv, '--expect-db') };
  if (!cli.expectDb) {
    console.error(`${TOOL}: --expect-db <name> is required on every run (dry or applied); refusing to guess the target database.`);
    process.exit(1);
  }
  const actual = await queryCurrentDatabase(db as ExecuteLike);
  if (actual.toLowerCase() !== cli.expectDb.toLowerCase()) {
    console.error(`${TOOL}: --expect-db said "${cli.expectDb}" but this pool is connected to "${actual}" — refusing before any read or write.`);
    process.exit(1);
  }
  await openRepairDb(db as ExecuteLike, { apply: cli.apply, allowProd: cli.allowProd, toolName: TOOL });

  const { rows, toStamp, skipped } = await planLineageRepair(db as unknown as RepairDb);
  const byReason = new Map<string, number>();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);

  console.log(
    `${TOOL}: "${actual}" - ${rows.length} DRHP-source ipos field_sources row(s) with no documentId ` +
      `(${new Set(rows.map((r) => r.ipoId)).size} IPOs); window ${WINDOW_SECONDS}s. ` +
      `${toStamp.length} to stamp (${new Set(toStamp.map((d) => d.row.ipoId)).size} IPOs); ` +
      `left alone: ${[...byReason.entries()].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}.`
  );
  for (const d of toStamp) {
    const doc = d.row.documents[0];
    console.log(`  ${cli.apply ? 'STAMP' : 'would stamp'}: ${d.row.slug} ipos.${d.row.fieldName} row ${d.row.id} -> ${doc.type} ${doc.id} (written ${d.row.updatedAt}, extracted ${doc.extractedAt})`);
  }
  for (const s of skipped) {
    const docs = s.row.documents.map((x) => `${x.type}:${x.id}:${x.extractionStatus}`).join(' ') || '-';
    console.log(`  leave: ${s.row.slug} ipos.${s.row.fieldName} row ${s.row.id} ${s.reason} [${docs}]`);
  }

  const { stampedIds } = cli.apply ? await applyStamps(db as unknown as RepairDb, toStamp) : { stampedIds: [] as string[] };

  writeLedgerFile(path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${cli.apply ? 'applied' : 'dryrun'}-${Date.now()}.json`), {
    tool: TOOL,
    mode: cli.apply ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    changes: toStamp.map((d) => ({
      table: 'field_sources',
      rowKey: d.row.id,
      field: d.row.fieldName,
      before: null,
      after: d.documentId,
    })),
    database: actual,
    apply: cli.apply,
    at: new Date().toISOString(),
    windowSeconds: WINDOW_SECONDS,
    toStamp: toStamp.map((d) => ({ rowId: d.row.id, slug: d.row.slug, fieldName: d.row.fieldName, documentId: d.documentId })),
    skipped: skipped.map((s) => ({ rowId: s.row.id, slug: s.row.slug, fieldName: s.row.fieldName, reason: s.reason, documents: s.row.documents })),
    stampedIds,
  });
  console.log(
    cli.apply
      ? `${TOOL}: APPLIED - ${stampedIds.length} of ${toStamp.length} stamped (a row changed since the read is skipped).`
      : `${TOOL}: DRY RUN - re-run with --apply to write.`
  );
  process.exit(0);
}

function valueAfter(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`${TOOL}: crashed:`, error);
    process.exit(1);
  });
}
