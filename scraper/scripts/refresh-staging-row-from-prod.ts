/**
 * Repair: refresh one stale `ipos` row on staging from production's read
 * path (lane C item 14, slice 6).
 *
 * RCA: `ipodhan_staging` was seeded from an old production copy. A row
 * seeded that way can sit stale for months — nothing re-syncs it — so a
 * staging-only floor check (e.g. `c_issue_size_floor`) can fire on the
 * staleness of the COPY, not on a real defect. Measured 2026-09-16:
 * `stallion-india-fluorochemicals-ltd` on staging carries `price_range_min/
 * max = 10/10` and `issue_size = Rs4,33,20,000`, last written 2026-07-01;
 * the same row on production carries `85/90` and `Rs1,99,00,00,000`, last
 * written 2026-09-06 — a real listing whose staging copy predates it.
 *
 * Class: any `ipos` row present on BOTH slots (same `slug`, which is
 * immutable and shared — the row's `id` is also shared because staging was
 * seeded from a prod snapshot, but slug is the operator-facing key this
 * tool is invoked with) whose named fields differ between the two. Not
 * scoped to one company: `--slug` + `--fields` are both operator inputs so
 * the SAME tool re-runs for any stale row this class produces next.
 *
 * Guardrails (deliberately narrower than every other repair tool in this
 * directory):
 *   - the WRITE target must be `ipodhan_staging` — refused for every other
 *     database name, including production, with NO override flag. There is
 *     no `--allow-prod` here: this tool can never write to production by
 *     design, not just by default.
 *   - the READ source is a SECOND, independent, read-only pool opened from
 *     `PROD_DATABASE_URL` (never from `DATABASE_URL`/`DATABASE_HOST`, which
 *     name the write target) and refuses to start unless that pool's own
 *     `current_database()` is `ipodhan` — so a misconfigured env can't
 *     silently source "production" data from staging or a stray database.
 *
 * dry-run by default (prints the before/after diff per field, writes
 * nothing); `--apply` writes ONLY when the write pool is `ipodhan_staging`.
 * Every changed field gets a `field_sources` row (source `ADMIN`, a dated
 * note) via the shared `upsertFieldSource`; a backup of the staging row is
 * written before the update and a ledger file after, via the shared
 * `writeLedgerFile` — both from `scripts/lib/repair-tool.ts`, not
 * reimplemented here.
 *
 * Run from scraper/ with the write pool pointed at staging (tunnel env) AND
 * PROD_DATABASE_URL set to the read-only production connection string:
 *   DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432 DATABASE_USER=ipodhan_app \
 *   DATABASE_PASSWORD=... DATABASE_NAME=ipodhan_staging \
 *   PROD_DATABASE_URL=postgresql://ipodhan_app:...@localhost:15432/ipodhan \
 *     npx tsx scripts/refresh-staging-row-from-prod.ts --slug <slug>                # dry-run
 *     npx tsx scripts/refresh-staging-row-from-prod.ts --slug <slug> --apply        # writes staging
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';
import { openRepairDb, upsertFieldSource, writeLedgerFile, PRODUCTION_DATABASE_NAME } from './lib/repair-tool.js';

const UPDATED_BY = 'SYSTEM_LANEC_ITEM14_S6_REFRESH';
const TOOL_NAME = 'refresh-staging-row-from-prod';

/** Target database name this tool is EVER allowed to write to. No override exists. */
export const STAGING_DATABASE_NAME = 'ipodhan_staging';

/** ipos columns this tool knows how to read/write, keyed by CLI field name. */
export const IPOS_FIELD_COLUMNS = {
  price_band_low: schema.ipos.priceRangeMin,
  price_band_high: schema.ipos.priceRangeMax,
  issue_size: schema.ipos.issueSize,
  lot_size: schema.ipos.lotSize,
} as const;

export type RefreshableField = keyof typeof IPOS_FIELD_COLUMNS;

export const DEFAULT_FIELDS: RefreshableField[] = ['price_band_low', 'price_band_high', 'issue_size', 'lot_size'];

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const slugIdx = argv.indexOf('--slug');
  const slug = slugIdx >= 0 ? argv[slugIdx + 1] : undefined;
  const fieldsIdx = argv.indexOf('--fields');
  const fieldsArg = fieldsIdx >= 0 ? argv[fieldsIdx + 1] : undefined;
  const fields = (fieldsArg ? fieldsArg.split(',').map((f) => f.trim()) : DEFAULT_FIELDS) as RefreshableField[];
  return { apply, slug, fields };
}

export interface FieldDiff {
  field: RefreshableField;
  stagingValue: string | number | null;
  prodValue: string | number | null;
  differs: boolean;
}

/** Pure diff computation — no DB, unit-testable in isolation. */
export function computeFieldDiffs(
  fields: RefreshableField[],
  stagingRow: Record<string, string | number | null>,
  prodRow: Record<string, string | number | null>
): FieldDiff[] {
  return fields.map((field) => {
    const stagingValue = stagingRow[field] ?? null;
    const prodValue = prodRow[field] ?? null;
    return {
      field,
      stagingValue,
      prodValue,
      // Compare as strings so numeric("43320000.00") vs "43320000.00" and
      // integer 10 vs 10 both compare correctly without a type-specific rule
      // per column.
      differs: String(stagingValue) !== String(prodValue),
    };
  });
}

/** Refuse to start unless the PROD pool's own current_database() really is 'ipodhan'. */
export function decideProdReadRefusal(prodDbName: string): { refuse: boolean; reason?: string } {
  if ((prodDbName ?? '').toLowerCase() !== PRODUCTION_DATABASE_NAME) {
    return {
      refuse: true,
      reason:
        `${TOOL_NAME}: PROD_DATABASE_URL's current_database() is "${prodDbName}", not ` +
        `"${PRODUCTION_DATABASE_NAME}" — refusing to read from it as a production source.`,
    };
  }
  return { refuse: false };
}

/** Refuse --apply unless the WRITE pool's own current_database() is exactly ipodhan_staging. No override. */
export function decideStagingWriteRefusal(input: {
  apply: boolean;
  dbName: string;
}): { refuse: boolean; reason?: string } {
  if (!input.apply) return { refuse: false };
  const isStaging = (input.dbName ?? '').toLowerCase() === STAGING_DATABASE_NAME;
  if (!isStaging) {
    return {
      refuse: true,
      reason:
        `${TOOL_NAME}: refusing to APPLY — the write target's current_database() is ` +
        `"${input.dbName}", not "${STAGING_DATABASE_NAME}". This tool has NO override flag; ` +
        `it can only ever write to staging.`,
    };
  }
  return { refuse: false };
}

function openProdReadPool(): { pool: Pool; db: NodePgDatabase<typeof schema> } {
  const url = process.env.PROD_DATABASE_URL;
  if (!url) {
    throw new Error(`${TOOL_NAME}: PROD_DATABASE_URL is not set — cannot open the read-only production pool.`);
  }
  const pool = new Pool({ connectionString: url, max: 2, options: '-c timezone=UTC', connectionTimeoutMillis: 20000 });
  return { pool, db: drizzle(pool, { schema }) };
}

async function main() {
  const { apply, slug, fields } = parseArgs(process.argv.slice(2));
  console.log('='.repeat(80));
  console.log(`REFRESH STAGING ROW FROM PROD (lane C item 14 slice 6) — ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  if (!slug) {
    console.error(`${TOOL_NAME}: --slug <slug> is required.`);
    process.exit(1);
    return;
  }
  const badFields = fields.filter((f) => !(f in IPOS_FIELD_COLUMNS));
  if (badFields.length > 0) {
    console.error(`${TOOL_NAME}: unknown field(s): ${badFields.join(', ')} (known: ${Object.keys(IPOS_FIELD_COLUMNS).join(', ')})`);
    process.exit(1);
    return;
  }

  // WRITE-target guard first (staging db proxy) — never writes on refusal.
  const { dbName: writeDbName } = await openRepairDb(db, {
    apply,
    allowProd: false,
    toolName: TOOL_NAME,
  });
  const writeDecision = decideStagingWriteRefusal({ apply, dbName: writeDbName });
  if (writeDecision.refuse) {
    console.error(writeDecision.reason);
    process.exit(1);
    return;
  }

  // READ-source guard second (independent prod pool).
  let prodPool: Pool | undefined;
  let prodDb: NodePgDatabase<typeof schema> | undefined;
  try {
    const opened = openProdReadPool();
    prodPool = opened.pool;
    prodDb = opened.db;
    const [{ name: prodDbName }] = (
      (await prodPool.query('SELECT current_database() AS name')) as { rows: { name: string }[] }
    ).rows;
    console.log(`prod read pool current_database(): ${prodDbName}`);
    const readDecision = decideProdReadRefusal(prodDbName);
    if (readDecision.refuse) {
      console.error(readDecision.reason);
      process.exit(1);
      return;
    }

    const selectCols = Object.fromEntries([
      ['id', schema.ipos.id],
      ['slug', schema.ipos.slug],
      ['companyName', schema.ipos.companyName],
      ...fields.map((f) => [f, IPOS_FIELD_COLUMNS[f]]),
    ]) as Record<string, unknown>;

    const [stagingRow] = await db
      .select(selectCols as any)
      .from(schema.ipos)
      .where(eq(schema.ipos.slug, slug))
      .limit(1);
    if (!stagingRow) {
      console.error(`${TOOL_NAME}: no ipos row on staging with slug "${slug}".`);
      process.exit(1);
      return;
    }
    const [prodRow] = await prodDb
      .select(selectCols as any)
      .from(schema.ipos)
      .where(eq(schema.ipos.slug, slug))
      .limit(1);
    if (!prodRow) {
      console.error(`${TOOL_NAME}: no ipos row on production with slug "${slug}" — nothing to refresh from.`);
      process.exit(1);
      return;
    }

    console.log(`staging row: ${(stagingRow as any).companyName} (id ${(stagingRow as any).id})`);
    console.log(`prod row:    ${(prodRow as any).companyName} (id ${(prodRow as any).id})`);

    const diffs = computeFieldDiffs(fields, stagingRow as any, prodRow as any);
    for (const d of diffs) {
      const label = d.differs ? 'DIFFERS' : 'same';
      console.log(`  - ${d.field}: staging=${JSON.stringify(d.stagingValue)} -> prod=${JSON.stringify(d.prodValue)} (${label})`);
    }
    const toWrite = diffs.filter((d) => d.differs);
    console.log(`\nfields differing: ${toWrite.length} of ${diffs.length}`);

    if (!apply) {
      console.log(`\nDRY-RUN: ${toWrite.length} field(s) would be refreshed from production. Re-run with --apply.`);
      console.log('='.repeat(80));
      process.exit(0);
      return;
    }

    if (toWrite.length === 0) {
      console.log('\nNothing to write — staging already matches production for the named fields.');
      console.log('='.repeat(80));
      process.exit(0);
      return;
    }

    const stamp = new Date().toISOString();
    const dateDir = stamp.slice(0, 10);
    const backupPath = `evidence/${dateDir}-lane-c-item-14-s6-${slug}/before.json`;
    writeLedgerFile(backupPath, { capturedAt: stamp, slug, row: stagingRow });
    console.log(`backup written: ${backupPath}`);

    await db.transaction(async (tx) => {
      for (const d of toWrite) {
        await upsertFieldSource(tx as any, {
          ipoId: (stagingRow as any).id,
          fieldName: d.field,
          source: 'ADMIN',
          confidence: 100,
          previousValue: d.stagingValue,
          dataLineage: {
            reason: `refreshed from production read path ${stamp}`,
            tool: TOOL_NAME,
            slug,
          },
          updatedBy: UPDATED_BY,
        });
      }
      await tx
        .update(schema.ipos)
        .set(
          Object.fromEntries(toWrite.map((d) => [columnKeyFor(d.field), d.prodValue])) as any
        )
        .where(eq(schema.ipos.id, (stagingRow as any).id));
    });

    const [readBack] = await db
      .select(selectCols as any)
      .from(schema.ipos)
      .where(eq(schema.ipos.slug, slug))
      .limit(1);
    console.log('\nread-back after write:');
    console.log(JSON.stringify(readBack, null, 1));

    const ledgerPath = `evidence/${dateDir}-lane-c-item-14-s6-${slug}/applied.json`;
    writeLedgerFile(ledgerPath, {
      appliedAt: stamp,
      slug,
      written: toWrite.map((d) => ({ field: d.field, from: d.stagingValue, to: d.prodValue })),
    });
    console.log(`ledger written: ${ledgerPath}`);

    console.log('\nAPPLY complete.');
    console.log('='.repeat(80));
    process.exit(0);
  } finally {
    if (prodPool) await prodPool.end();
  }
}

/** Map a CLI field name to its drizzle table-property key (not its DB column name). */
function columnKeyFor(field: RefreshableField): string {
  const map: Record<RefreshableField, string> = {
    price_band_low: 'priceRangeMin',
    price_band_high: 'priceRangeMax',
    issue_size: 'issueSize',
    lot_size: 'lotSize',
  };
  return map[field];
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, `${TOOL_NAME} crashed`);
    console.error(e);
    process.exit(2);
  });
}
