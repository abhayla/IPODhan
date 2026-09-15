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
 *   - the READ source is a SECOND, independent pool opened from
 *     `PROD_DATABASE_URL` (never from `DATABASE_URL`/`DATABASE_HOST`, which
 *     name the write target), opened with
 *     `-c default_transaction_read_only=on` on the CONNECTION itself (not
 *     merely "we only call .select() on it" — a session-level guard the
 *     server enforces, so an accidental write attempt through this pool
 *     fails at postgres, not just by code review), and refuses to proceed
 *     unless that pool's own `current_database()` is `ipodhan` — so a
 *     misconfigured env can't silently source "production" data from
 *     staging or a stray database.
 *   - the slug lookup on EITHER slot is a COUNT first, never a bare
 *     `.limit(1)`: 0 or >1 matching rows on either side refuses with the
 *     exact count, rather than silently picking an arbitrary row with no
 *     ORDER BY.
 *   - a field whose PRODUCTION value is null is never written and never
 *     gets a provenance row — refreshing "from production" cannot claim a
 *     source for a value production does not have either.
 *
 * dry-run by default (prints the before/after diff per field, writes
 * nothing); `--apply` writes ONLY when the write pool is `ipodhan_staging`.
 * Every changed field gets a `field_sources` row (source `ADMIN`, a dated
 * note) via the shared `upsertFieldSource`; a backup of the staging row is
 * written BEFORE the update and a ledger file after, via the shared
 * `writeLedgerFile` — both from `scripts/lib/repair-tool.ts`, not
 * reimplemented here. The whole write step (backup -> provenance ->
 * UPDATE) is `applyRefresh()`, one exported function taking the write/read
 * executors as parameters, so its call order and skip-when-empty behavior
 * are unit-testable against fakes without a database.
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
import { eq, sql } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';
import { openRepairDb, upsertFieldSource, writeLedgerFile, PRODUCTION_DATABASE_NAME } from './lib/repair-tool.js';

const UPDATED_BY = 'SYSTEM_LANEC_ITEM14_S6_REFRESH';
const TOOL_NAME = 'refresh-staging-row-from-prod';

/** Target database name this tool is EVER allowed to write to. No override exists. */
export const STAGING_DATABASE_NAME = 'ipodhan_staging';

/**
 * ipos columns this tool knows how to read/write, keyed by the SAME camelCase
 * name as the schema.ts drizzle property AND as `field_sources.field_name`
 * (the convention every other repair tool in this directory follows —
 * `backfill-band-provenance-t276.ts` and `repair-field-sources-price-band-
 * t276.ts` both hard-code 'priceRangeMin'/'priceRangeMax' as the literal
 * provenance field_name; there is no separate alias layer to translate
 * through). Deliberately NOT the T-276 dead price-band column pair from an
 * older schema (prod 2026-08-22: 328 rows, 0 non-null; see
 * `tests/unit/config/price-band-single-scheme.test.ts` for the exact banned
 * spellings) — a round-1 bug on this tool used that dead pair as the
 * CLI/provenance name (lane B / staging review 2026-09-16), which wrote a
 * provenance row under a name matching no live column, indistinguishable
 * from a hand-typo. `--fields` on the CLI takes these same camelCase names.
 */
export const IPOS_FIELD_COLUMNS = {
  priceRangeMin: schema.ipos.priceRangeMin,
  priceRangeMax: schema.ipos.priceRangeMax,
  issueSize: schema.ipos.issueSize,
  lotSize: schema.ipos.lotSize,
} as const;

export type RefreshableField = keyof typeof IPOS_FIELD_COLUMNS;

export const DEFAULT_FIELDS: RefreshableField[] = ['priceRangeMin', 'priceRangeMax', 'issueSize', 'lotSize'];

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

/**
 * The exact `pg.PoolConfig.options` string for the read-only production
 * pool. `default_transaction_read_only=on` is a SESSION-level Postgres
 * setting: any write statement issued over a connection carrying it fails
 * at the server, regardless of what this file's code happens to call — a
 * guard the database itself enforces, not just a code-review convention.
 * Exported so a test can assert the live pool config carries it (mutation:
 * delete the flag -> the pinning test goes red).
 */
export const PROD_POOL_OPTIONS = '-c timezone=UTC -c default_transaction_read_only=on';

function openProdReadPool(): { pool: Pool; db: NodePgDatabase<typeof schema> } {
  const url = process.env.PROD_DATABASE_URL;
  if (!url) {
    throw new Error(`${TOOL_NAME}: PROD_DATABASE_URL is not set — cannot open the read-only production pool.`);
  }
  const pool = new Pool({
    connectionString: url,
    max: 2,
    options: PROD_POOL_OPTIONS,
    connectionTimeoutMillis: 20000,
  });
  return { pool, db: drizzle(pool, { schema }) };
}

/** Minimal shape either executor (the staging `db` proxy or a fake) needs. */
export interface SelectableDb {
  select: (...args: any[]) => any;
}

export interface CountAndFetchResult<T> {
  count: number;
  row: T | null;
}

/**
 * COUNT rows matching the slug before trusting any single one of them.
 * Never a bare `.limit(1)` with no ORDER BY: 0 matches is "no such row", >1
 * matches is an ambiguous slug (a defect elsewhere) — both are refused by
 * the caller, neither is silently resolved by picking whichever row the
 * planner happened to return first.
 */
export async function countAndFetchBySlug<T>(
  dbLike: SelectableDb,
  selectCols: Record<string, unknown>,
  slug: string
): Promise<CountAndFetchResult<T>> {
  const countRows = await dbLike
    .select({ n: sql<number>`count(*)` })
    .from(schema.ipos)
    .where(eq(schema.ipos.slug, slug));
  const count = Number(countRows[0]?.n ?? 0);
  if (count !== 1) {
    return { count, row: null };
  }
  const [row] = await dbLike
    .select(selectCols as any)
    .from(schema.ipos)
    .where(eq(schema.ipos.slug, slug))
    .limit(1);
  return { count, row: (row as T) ?? null };
}

/** Minimal shape of the write-side executors `applyRefresh` needs — real (`db`) or fake. */
export interface RefreshWriteExecutors {
  /** Runs the provenance upserts + the ipos UPDATE inside one transaction. */
  transaction: (fn: (tx: unknown) => Promise<void>) => Promise<void>;
  /** Re-selects the row after the transaction commits, for the read-back log. */
  select: (...args: any[]) => any;
}

export interface ApplyRefreshInput {
  slug: string;
  stagingRow: { id: string } & Record<string, unknown>;
  toWrite: FieldDiff[];
  selectCols: Record<string, unknown>;
  stamp: string;
  writeBackup: (path: string, payload: unknown) => string;
  writeLedger: (path: string, payload: unknown) => string;
  upsert: typeof upsertFieldSource;
}

export interface ApplyRefreshResult {
  wrote: boolean;
  backupPath?: string;
  ledgerPath?: string;
  readBack?: unknown;
}

/**
 * The full write step: backup -> per-field provenance -> UPDATE, all inside
 * one transaction, then a read-back. Extracted from `main()` and taking its
 * DB access through `executors` so it is testable against fakes: call
 * order (backup before the transaction), one `upsertFieldSource` per
 * changed field, and the 0-differing-fields short-circuit (no UPDATE, no
 * backup, no provenance) are all assertable without a real database.
 */
export async function applyRefresh(
  executors: RefreshWriteExecutors,
  input: ApplyRefreshInput
): Promise<ApplyRefreshResult> {
  const { slug, stagingRow, toWrite, selectCols, stamp, writeBackup, writeLedger, upsert } = input;

  // A field whose production value is null is not a value to refresh FROM —
  // production has nothing to say about it either. Writing a field_sources
  // row that names ADMIN as the source of a null would claim provenance for
  // "no value", which is worse than no provenance row at all (round-1 bug on
  // this tool, lane B / staging review 2026-09-16). These fields are simply
  // dropped from the write set before anything else runs.
  const writable = toWrite.filter((d) => d.prodValue !== null);

  if (writable.length === 0) {
    // Zero writable fields (either nothing differed, or every differing
    // field's production value is null): no UPDATE, no backup, no provenance.
    return { wrote: false };
  }

  const dateDir = stamp.slice(0, 10);
  const backupPath = `evidence/${dateDir}-lane-c-item-14-s6-${slug}/before.json`;
  // Backup MUST be written before the transaction opens — asserted by call
  // order in the unit test (a mock recording invocation sequence).
  writeBackup(backupPath, { capturedAt: stamp, slug, row: stagingRow });

  await executors.transaction(async (tx) => {
    for (const d of writable) {
      await upsert(tx as any, {
        ipoId: stagingRow.id,
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
    await (tx as any)
      .update(schema.ipos)
      .set(Object.fromEntries(writable.map((d) => [d.field, d.prodValue])) as any)
      .where(eq(schema.ipos.id, stagingRow.id));
  });

  const [readBack] = await executors
    .select(selectCols as any)
    .from(schema.ipos)
    .where(eq(schema.ipos.slug, slug))
    .limit(1);

  const ledgerPath = `evidence/${dateDir}-lane-c-item-14-s6-${slug}/applied.json`;
  writeLedger(ledgerPath, {
    appliedAt: stamp,
    slug,
    written: writable.map((d) => ({ field: d.field, from: d.stagingValue, to: d.prodValue })),
  });

  return { wrote: true, backupPath, ledgerPath, readBack };
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

  // READ-source guard second (independent, read-only prod pool).
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

    const stagingLookup = await countAndFetchBySlug<{ id: string; companyName: string } & Record<string, unknown>>(
      db,
      selectCols,
      slug
    );
    if (stagingLookup.count !== 1) {
      console.error(
        `${TOOL_NAME}: staging has ${stagingLookup.count} ipos row(s) with slug "${slug}" — refusing (need exactly 1).`
      );
      process.exit(1);
      return;
    }
    const prodLookup = await countAndFetchBySlug<{ id: string; companyName: string } & Record<string, unknown>>(
      prodDb,
      selectCols,
      slug
    );
    if (prodLookup.count !== 1) {
      console.error(
        `${TOOL_NAME}: production has ${prodLookup.count} ipos row(s) with slug "${slug}" — refusing (need exactly 1).`
      );
      process.exit(1);
      return;
    }
    const stagingRow = stagingLookup.row!;
    const prodRow = prodLookup.row!;

    console.log(`staging row: ${stagingRow.companyName} (id ${stagingRow.id})`);
    console.log(`prod row:    ${prodRow.companyName} (id ${prodRow.id})`);

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

    const stamp = new Date().toISOString();
    const result = await applyRefresh(
      { transaction: (fn) => db.transaction(fn as any), select: (...args: any[]) => db.select(...args) },
      {
        slug,
        stagingRow,
        toWrite,
        selectCols,
        stamp,
        writeBackup: writeLedgerFile,
        writeLedger: writeLedgerFile,
        upsert: upsertFieldSource,
      }
    );

    if (!result.wrote) {
      console.log('\nNothing to write — staging already matches production for the named fields.');
      console.log('='.repeat(80));
      process.exit(0);
      return;
    }

    console.log(`backup written: ${result.backupPath}`);
    console.log('\nread-back after write:');
    console.log(JSON.stringify(result.readBack, null, 1));
    console.log(`ledger written: ${result.ledgerPath}`);

    console.log('\nAPPLY complete.');
    console.log('='.repeat(80));
    process.exit(0);
  } finally {
    if (prodPool) await prodPool.end();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, `${TOOL_NAME} crashed`);
    console.error(e);
    process.exit(2);
  });
}
