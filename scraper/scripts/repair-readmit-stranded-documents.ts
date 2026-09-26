/**
 * repair-readmit-stranded-documents.ts — F-158 / OD-90 follow-up.
 *
 * RCA: before #989, a stored CORRIGENDUM was admitted with
 * `documents.extraction_status = 'NOT_EXTRACTABLE'` (its type had no
 * extractor at admission time). #989 put CORRIGENDUM on
 * `AUTO_PERSIST_DOC_TYPES` (the extractable list, `config/document-admission-
 * status.ts`), so a document of that type discovered TODAY is admitted
 * PENDING and gets extracted. But nothing re-admits a row that was ALREADY
 * stamped NOT_EXTRACTABLE before the fix, and the document cycle only
 * revisits an IPO within its live window (`isInLiveWindow` /
 * `loadCandidateIpos`) — a row on a closed or long-listed IPO is never
 * looked at again to notice its status is now stale. Measured on
 * ipodhan_staging 2026-09-25: documents id 3b77bc3b-e44a-4d3d-9622-
 * edb71763e9e8 (skyways-air-services-ltd, CORRIGENDUM, NOT_EXTRACTABLE,
 * updated 2026-09-22) is stranded this way; the one post-fix corrigendum
 * (veegaland, 038eaf50) is COMPLETED and untouched by this tool.
 *
 * THE CLASS (defect-fix-contract.md item 2), as a data filter: every
 * `documents` row, on any IPO status/segment/slot, whose
 * `extraction_status = 'NOT_EXTRACTABLE'` while its `type` IS on
 * `AUTO_PERSIST_DOC_TYPES` today. Never hard-coded to CORRIGENDUM — the
 * selector reads `isExtractableDocType` (the single source of truth also
 * read by admission and by `selectPendingFilings`), so a type added to the
 * extractable list tomorrow is repaired by the same run with no code change.
 * ADDENDUM (and any other type still off the list) is explicitly excluded —
 * re-admitting a genuinely non-extractable row would recreate the PENDING-
 * means-two-things bug #869 fixed.
 *
 * RE-ADMISSION: `buildReadmitPatch` sets exactly what
 * `resolveAdmissionExtractionStatus` would set for an extractable type on
 * first discovery — `extraction_status = 'PENDING'` — and clears the
 * attempt-tracking fields (`extraction_error`, `retry_count`) so a stale
 * value from a PRE-admission-fix world cannot trip `documentExtractionBlocked`
 * on the very next cycle. `extracted_at` is left alone: a NOT_EXTRACTABLE row
 * was never extracted, so it is already null.
 *
 * Follows the shared repair-tool conventions (T-490, `lib/repair-tool.ts`):
 * dry run by default, `--expect-db <name>` required on every run,
 * `--allow-prod` gates a production `--apply`, UTC-safe pool
 * (`alias-preflight-auto.mjs` -> `@ipodhan/shared` -> `configureUtcTimestampParsing`
 * is wired at pool construction, same as every other repair script in this
 * directory), a printed per-row line, and a written ledger file.
 *
 * Usage (from scraper/):
 *   npx tsx scripts/repair-readmit-stranded-documents.ts --expect-db ipodhan_staging                 # dry run
 *   npx tsx scripts/repair-readmit-stranded-documents.ts --expect-db ipodhan_staging --apply
 * Prod is refused without --allow-prod (openRepairDb).
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import { sql } from 'drizzle-orm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRepairDb, queryCurrentDatabase, writeLedgerFile, type ExecuteLike } from './lib/repair-tool';
import { isExtractableDocType } from '../src/config/document-admission-status.js';
import { buildExtractionStatePatch } from '../src/services/extraction-state-patch.js';

const TOOL = 'repair-readmit-stranded-documents';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRANDED_STATUS = 'NOT_EXTRACTABLE';
const READMIT_STATUS = 'PENDING';

export interface StrandableDocumentRow {
  id: string;
  ipoId: string;
  slug: string | null;
  type: string;
  extractionStatus: string | null;
  /** Present on rows read from the DB; absent/undefined on hand-built test fixtures. */
  updatedAt?: string | Date | null;
}

/**
 * THE class filter. Pure, so the "ADDENDUM is never selected, CORRIGENDUM (and
 * anything the SSOT list grows to) always is" guarantee is testable without a
 * database. Reads `isExtractableDocType` — never a hard-coded 'CORRIGENDUM' —
 * so this selector and the admission/dispatch predicates cannot disagree.
 */
export function selectStrandedDocuments(rows: StrandableDocumentRow[]): StrandableDocumentRow[] {
  return rows.filter(
    (r) => r.extractionStatus === STRANDED_STATUS && isExtractableDocType(r.type)
  );
}

/**
 * The patch that re-admits one row: the same terminal-vs-queued distinction
 * `resolveAdmissionExtractionStatus` draws at discovery time, applied to a row
 * discovery already saw. Goes through `buildExtractionStatePatch` — THE single
 * function every extraction-status write in this codebase uses — rather than
 * a second hand-rolled patch shape.
 */
export function buildReadmitPatch(now: Date = new Date()): Record<string, unknown> {
  return buildExtractionStatePatch(READMIT_STATUS, { error: null, retryCount: 0 }, now);
}

interface Cli {
  apply: boolean;
  allowProd: boolean;
  expectDb: string | null;
}

function parseArgs(argv: readonly string[]): Cli {
  const at = argv.indexOf('--expect-db');
  return {
    apply: argv.includes('--apply'),
    allowProd: argv.includes('--allow-prod'),
    expectDb: at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null,
  };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
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

  const read = await db.execute(sql`
    SELECT d.id, d.ipo_id AS "ipoId", i.slug AS slug, d.type::text AS type,
           d.extraction_status AS "extractionStatus", d.updated_at AS "updatedAt"
    FROM documents d
    JOIN ipos i ON i.id = d.ipo_id
    WHERE d.extraction_status = ${STRANDED_STATUS}
  `);
  const rows = ((read as unknown as { rows?: StrandableDocumentRow[] }).rows ?? []) as StrandableDocumentRow[];
  const selected = selectStrandedDocuments(rows);

  console.log(
    `${TOOL}: ${rows.length} row(s) in ${STRANDED_STATUS} on "${actual}"; ${selected.length} match the class (type now on the extractable list):`
  );
  for (const r of selected) {
    console.log(`  ${r.id} ${r.slug ?? r.ipoId} ${r.type} (updated_at ${r.updatedAt ?? 'unknown'})`);
  }
  const excluded = rows.length - selected.length;
  if (excluded > 0) {
    console.log(`  (${excluded} other NOT_EXTRACTABLE row(s) left untouched — still no extractor for their type)`);
  }

  if (selected.length === 0) {
    console.log(`${TOOL}: nothing to do.`);
    return;
  }

  if (!cli.apply) {
    console.log(`\n${TOOL}: DRY RUN — nothing written. Re-run with --apply to set these ${selected.length} row(s) to ${READMIT_STATUS}.`);
  } else {
    const now = new Date();
    const patch = buildReadmitPatch(now);
    const ids = selected.map((r) => r.id);
    const updated = await db.execute(sql`
      UPDATE documents
      SET extraction_status = ${String(patch.extractionStatus)},
          extraction_error = NULL,
          retry_count = 0,
          updated_at = ${now.toISOString()}
      WHERE id = ANY(${sql.param(ids)}::uuid[])
    `);
    const changed = (updated as unknown as { rowCount?: number }).rowCount ?? 0;
    console.log(`\n${TOOL}: APPLIED — ${changed} row(s) set to ${READMIT_STATUS} on "${actual}".`);

    const verify = await db.execute(sql`
      SELECT count(*)::int AS n FROM documents
      WHERE id = ANY(${sql.param(ids)}::uuid[]) AND extraction_status = ${READMIT_STATUS}
    `);
    const held = ((verify as unknown as { rows?: { n: number }[] }).rows ?? [{ n: 0 }])[0].n;
    console.log(`${TOOL}: read-back: ${held} of ${ids.length} row(s) hold ${READMIT_STATUS}.`);
  }

  const ledgerPath = writeLedgerFile(
    path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${cli.apply ? 'applied' : 'dryrun'}-${Date.now()}.json`),
    {
      tool: TOOL,
      mode: cli.apply ? 'apply' : 'dry-run',
      generatedAt: new Date().toISOString(),
      changes: selected.map((r) => ({
        table: 'documents',
        rowKey: r.id,
        field: 'extraction_status',
        before: STRANDED_STATUS,
        after: READMIT_STATUS,
      })),
      database: actual,
      apply: cli.apply,
      at: new Date().toISOString(),
      class: `documents WHERE extraction_status = '${STRANDED_STATUS}' AND isExtractableDocType(type)`,
      totalNotExtractable: rows.length,
      matched: selected.length,
      rows: selected.map((r) => ({ id: r.id, ipoId: r.ipoId, slug: r.slug, type: r.type, updatedAtBefore: r.updatedAt })),
    }
  );
  console.log(`${TOOL}: ledger written to ${ledgerPath}`);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`${TOOL}: ${e?.message ?? e}`);
      process.exit(1);
    });
}
