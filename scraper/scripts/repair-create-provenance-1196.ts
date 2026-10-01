/**
 * #1196 (OD-88): write the `field_sources` rows the live create door never wrote.
 *
 * RCA: `DataConsolidationOrchestrator.consolidatedUpsertIPO` consolidated a brand-new row with ipoId
 * 'new' (provenance is skipped for 'new') and created it without tracking, so every column no later
 * writer touched (companyName on 47 of 396 staging IPOs) has no provenance row. The write path is fixed
 * in the same change (create + provenance in one transaction); this tool repairs the rows written before.
 *
 * Class: every `ipos` row, any status / segment / offering type, holding a value in a column of
 * `scripts/lib/create-provenance-checks.mjs` CREATE_PROVENANCE_COLUMNS with no `field_sources` row for it
 * (the same query the nightly check `u_create_column_without_provenance` runs).
 *
 * Source: the row's RECORDED creating source - `ipo_source_keys.source` where `bound_via = 'CREATE'`
 * (OD-85: the create writes its source keys in the same transaction as the row). A later writer tracks
 * its own columns, so a column still missing a row was set by the create. When the creating source is
 * not recorded (no CREATE key, several different CREATE sources, a source that is not a scraper_source
 * value, or ADMIN) the row is NOT guessed: it is skipped and reported by identity.
 *
 * dry-run by default; --apply writes; --apply on production needs --allow-prod; --apply needs
 * --expect-db <name>. One transaction per IPO; a row that already has provenance is never overwritten.
 *
 * Run from scraper/ against ipodhan_test or staging only:
 *   npx tsx scripts/repair-create-provenance-1196.ts
 *   npx tsx scripts/repair-create-provenance-1196.ts --apply --expect-db ipodhan_test
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';
import {
  assertNoSchemaDrift,
  openRepairDb,
  readExpectDbFlag,
  readFieldSource,
  upsertFieldSource,
  writeLedgerFile,
  type RepairLedgerFieldChange,
} from './lib/repair-tool.js';
import {
  buildUnprovenancedColumnsSql,
  evaluateUnprovenancedColumns,
} from '../../scripts/lib/create-provenance-checks.mjs';

const TOOL = 'repair-create-provenance-1196';
const UPDATED_BY = 'SYSTEM_1196_CREATE_PROVENANCE_REPAIR';

export type CreateProvenanceAction =
  | 'write'
  | 'skip-no-creating-source'
  | 'skip-ambiguous-creating-source'
  | 'skip-unusable-creating-source';

export interface CreateProvenanceDecision {
  action: CreateProvenanceAction;
  source: string | null;
  reason: string;
}

interface Offender {
  id: string;
  slug: string;
  status: string;
  offeringType: string;
  fields: string[];
}

/**
 * Pure per-row decision: which source to record, or why not to guess. `creatingSources` are the
 * distinct `ipo_source_keys.source` values with bound_via='CREATE' for the row; `validSources` are the
 * scraper_source enum values.
 */
export function decideCreateProvenance(
  creatingSources: readonly string[],
  validSources: readonly string[]
): CreateProvenanceDecision {
  const distinct = [...new Set(creatingSources)];
  if (distinct.length === 0) {
    return {
      action: 'skip-no-creating-source',
      source: null,
      reason: 'no ipo_source_keys row with bound_via=CREATE - the creating source is not recorded, not guessed',
    };
  }
  if (distinct.length > 1) {
    return {
      action: 'skip-ambiguous-creating-source',
      source: null,
      reason: `CREATE keys name several sources (${distinct.sort().join(',')}) - not guessed`,
    };
  }
  const source = distinct[0];
  if (source === 'ADMIN' || !validSources.includes(source)) {
    const why = source === 'ADMIN' ? 'ADMIN (the admin path records its own provenance)' : 'not a scraper_source value';
    return { action: 'skip-unusable-creating-source', source: null, reason: `creating source '${source}' is ${why} - not guessed` };
  }
  return { action: 'write', source, reason: `creating source ${source} recorded by the CREATE source key of the row` };
}

export interface PlannedRow extends Offender {
  boundBy: string | null;
  decision: CreateProvenanceDecision;
}

/** Read-only: which rows lack provenance, and for each the source to record (or why not). */
export async function planCreateProvenanceRepair(
  database: typeof db
): Promise<{ plan: PlannedRow[]; verdict: ReturnType<typeof evaluateUnprovenancedColumns> }> {
  const res = await database.execute(buildUnprovenancedColumnsSql() as never);
  const rows = ((res as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as Array<{
    id: string;
    slug: string;
    status: string;
    offeringType: string;
    fieldName: string;
  }>;
  const verdict = evaluateUnprovenancedColumns(rows, Number.MAX_SAFE_INTEGER);
  const offenders = verdict.offenders as Offender[];
  const ids = offenders.map((o) => o.id);
  const keyRows = ids.length
    ? await database
        .select({ ipoId: schema.ipoSourceKeys.ipoId, source: schema.ipoSourceKeys.source, boundBy: schema.ipoSourceKeys.boundBy })
        .from(schema.ipoSourceKeys)
        .where(and(inArray(schema.ipoSourceKeys.ipoId, ids), eq(schema.ipoSourceKeys.boundVia, 'CREATE')))
    : [];
  const validSources: readonly string[] = schema.scraperSourceEnum.enumValues;
  const plan = offenders.map((o) => {
    const mine = keyRows.filter((k) => k.ipoId === o.id);
    return { ...o, boundBy: mine[0]?.boundBy ?? null, decision: decideCreateProvenance(mine.map((k) => k.source), validSources) };
  });
  return { plan, verdict };
}

/** Writes the planned rows: one transaction per IPO, never overwriting a row that appeared since the read. */
export async function applyCreateProvenanceRepair(
  database: typeof db,
  toWrite: readonly PlannedRow[]
): Promise<{ written: number; changes: RepairLedgerFieldChange[] }> {
  const changes: RepairLedgerFieldChange[] = [];
  let written = 0;
  for (const p of toWrite) {
    await database.transaction(async (tx) => {
      for (const field of p.fields) {
        if (await readFieldSource(tx as never, { ipoId: p.id, fieldName: field })) continue;
        const out = await upsertFieldSource(tx as never, {
          ipoId: p.id,
          fieldName: field,
          source: p.decision.source as string,
          confidence: 100,
          previousValue: null,
          dataLineage: { reason: p.decision.reason, repairedBy: UPDATED_BY, creatingKeyBoundBy: p.boundBy },
          updatedBy: UPDATED_BY,
        });
        changes.push(...out.changes);
        if (out.changes.length > 0) written += 1;
      }
    });
  }
  return { written, changes };
}

async function main() {
  const argv = process.argv;
  const APPLY = argv.includes('--apply');
  const ALLOW_PROD = argv.includes('--allow-prod');
  const expectDb = readExpectDbFlag(argv);
  console.log('='.repeat(80));
  console.log(`CREATE PROVENANCE REPAIR (#1196) - ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  await openRepairDb(db, { apply: APPLY, allowProd: ALLOW_PROD, toolName: TOOL, expectDb });
  if (APPLY && !expectDb) {
    console.error(`${TOOL}: --apply needs --expect-db <name>; refusing before any write.`);
    process.exit(2);
  }
  await assertNoSchemaDrift(db, { apply: APPLY, toolName: TOOL });

  const { plan, verdict } = await planCreateProvenanceRepair(db);
  console.log(`ipos rows with a value and no field_sources row: ${verdict.ipoCount} rows, ${verdict.columnCount} columns`);
  for (const p of plan) {
    const what = p.decision.action === 'write' ? `WOULD-WRITE ${p.decision.source}` : 'SKIPPED';
    console.log(`  - ${p.slug} [${p.status}/${p.offeringType}] ${what} for ${p.fields.join(',')}: ${p.decision.reason}`);
  }
  const toWrite = plan.filter((p) => p.decision.action === 'write');
  const skipped = plan.filter((p) => p.decision.action !== 'write');
  console.log(`\nrows that WOULD BE WRITTEN: ${toWrite.length} (${toWrite.reduce((n, p) => n + p.fields.length, 0)} field_sources rows)`);
  console.log(`rows SKIPPED, creating source not recorded or unusable (reported by identity, never guessed): ${skipped.length}`);
  for (const p of skipped) console.log(`    skipped: ${p.slug} (${p.id}) ${p.decision.action}`);

  if (!APPLY) {
    console.log('\nDRY-RUN: nothing written. Re-run with --apply --expect-db <name> (and --allow-prod against production).');
    process.exit(0);
  }
  if (toWrite.length === 0) {
    console.log('\nNothing to write.');
    process.exit(0);
  }

  const { written, changes } = await applyCreateProvenanceRepair(db, toWrite);
  console.log(`field_sources rows written: ${written}`);

  const ledgerPath = `evidence/${new Date().toISOString().slice(0, 10)}-1196-create-provenance/applied.json`;
  writeLedgerFile(ledgerPath, {
    tool: TOOL,
    mode: 'apply',
    generatedAt: new Date().toISOString(),
    changes,
    appliedAt: new Date().toISOString(),
    updatedBy: UPDATED_BY,
    written,
    skipped: skipped.map((p) => ({ id: p.id, slug: p.slug, action: p.decision.action })),
  });
  console.log(`ledger written: ${ledgerPath}`);
  console.log('\nAPPLY complete.');
  process.exit(0);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, `${TOOL} crashed`);
    console.error(e);
    process.exit(1);
  });
}
