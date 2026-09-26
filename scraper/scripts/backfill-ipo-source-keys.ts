/**
 * OD-85 backfill (docs/design/data-sourcing-pull-model.md §2.3.3.2 "Source record keys", scenario 19):
 * seed `ipo_source_keys` from what existing rows already carry — `ipos.bse_ipo_no` (BSE_IPO_NO) and
 * the Chittorgarh page id inside `ipos.verifier_url` (CG_PAGE_ID; slug ignored, F-148). Rows of an
 * ended offering (WITHDRAWN / DELISTED / LAPSED) are skipped: their keys would be RELEASED anyway.
 *
 * Two rows claiming one key -> NEITHER is inserted and the pair is reported by name (that pair is a
 * duplicate for a human or the merge tool, never a guess). A value already bound to a DIFFERENT row
 * is reported the same way. Idempotent: a key already on its row is skipped.
 *
 * NSE_ISSUE keys are not backfilled: `ipos.symbol` carries no series, and a symbol without its
 * series cannot tell an IPO from a later OFS (scenario 9). The next NSE cycle writes them.
 *
 * Usage (from scraper/):
 *   npx tsx scripts/backfill-ipo-source-keys.ts --expect-db ipodhan_staging            # dry run
 *   npx tsx scripts/backfill-ipo-source-keys.ts --expect-db ipodhan_staging --apply
 * Prod is refused without --allow-prod (openRepairDb).
 */
import '../../scripts/lib/alias-preflight-auto.mjs';
import { db, ipoSourceKeys } from '@ipodhan/shared';
import { chittorgarhPageId, normalizeSourceKeyValue, ENDED_STATUSES, type SourceKeyType } from '@ipodhan/shared/repositories';
import { sql } from 'drizzle-orm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRepairDb, queryCurrentDatabase, writeLedgerFile, type ExecuteLike } from './lib/repair-tool';

const TOOL = 'backfill-ipo-source-keys';
const SCRAPER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface BackfillRow {
  id: string;
  slug: string;
  companyName: string;
  status: string;
  bseIpoNo: number | string | null;
  verifierUrl: string | null;
  openDate: string | null;
}
export interface ExistingKey { ipoId: string; source: string; keyType: string; bindingValue: string | null }
export interface PlannedKey { ipoId: string; source: string; keyType: SourceKeyType; keyValue: string; recordOpenDate: string | null }
export interface Collision {
  source: string;
  keyType: string;
  keyValue: string;
  rows: { id: string; slug: string; companyName: string }[];
  reason: string;
}

/** Pure: which keys to insert and which collide. Never picks a winner between two rows. */
export function planSourceKeyBackfill(
  rows: readonly BackfillRow[],
  existing: readonly ExistingKey[]
): { insert: PlannedKey[]; collisions: Collision[]; skippedEnded: number } {
  const candidates = new Map<string, { key: PlannedKey; rows: BackfillRow[] }>();
  let skippedEnded = 0;
  for (const row of rows) {
    if (ENDED_STATUSES.includes(String(row.status))) {
      skippedEnded++;
      continue;
    }
    const found: [string, SourceKeyType, string | null][] = [
      ['BSE', 'BSE_IPO_NO', row.bseIpoNo != null ? normalizeSourceKeyValue(row.bseIpoNo) : null],
      ['CHITTORGARH', 'CG_PAGE_ID', chittorgarhPageId(row.verifierUrl)],
    ];
    for (const [source, keyType, value] of found) {
      if (!value) continue;
      const id = `${source}|${keyType}|${value}`;
      const entry = candidates.get(id) ?? {
        key: { ipoId: row.id, source, keyType, keyValue: value, recordOpenDate: row.openDate },
        rows: [],
      };
      entry.rows.push(row);
      candidates.set(id, entry);
    }
  }
  const insert: PlannedKey[] = [];
  const collisions: Collision[] = [];
  const view = (r: BackfillRow) => ({ id: r.id, slug: r.slug, companyName: r.companyName });
  for (const { key, rows: claimants } of candidates.values()) {
    if (claimants.length > 1) {
      collisions.push({ source: key.source, keyType: key.keyType, keyValue: key.keyValue, rows: claimants.map(view), reason: 'two rows claim this key - neither inserted' });
      continue;
    }
    const bound = existing.find((e) => e.source === key.source && e.keyType === key.keyType && e.bindingValue === key.keyValue);
    if (bound && bound.ipoId === key.ipoId) continue;
    if (bound) {
      collisions.push({ source: key.source, keyType: key.keyType, keyValue: key.keyValue, rows: [view(claimants[0])], reason: `already bound to another row ${bound.ipoId}` });
      continue;
    }
    insert.push(key);
  }
  return { insert, collisions, skippedEnded };
}

function valueAfter(argv: readonly string[], flag: string): string | null {
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : null;
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

  const rowsRes = await db.execute(sql`
    select id::text as id, slug, company_name as "companyName", status::text as status,
           bse_ipo_no as "bseIpoNo", verifier_url as "verifierUrl", open_date::text as "openDate"
      from ipos
     where bse_ipo_no is not null or verifier_url like '%chittorgarh.com/ipo/%'`);
  const existingRes = await db.execute(sql`
    select ipo_id::text as "ipoId", source, key_type::text as "keyType", binding_value as "bindingValue"
      from ipo_source_keys
     where binding_value is not null`);
  const rows = (rowsRes as unknown as { rows: BackfillRow[] }).rows;
  const existing = (existingRes as unknown as { rows: ExistingKey[] }).rows;
  const plan = planSourceKeyBackfill(rows, existing);

  console.log(
    `${TOOL}: "${actual}" - ${rows.length} candidate rows, ${plan.insert.length} keys to insert, ` +
      `${plan.collisions.length} collisions, ${plan.skippedEnded} ended rows skipped.`
  );
  for (const c of plan.collisions) {
    console.log(`  COLLISION ${c.source} ${c.keyType} ${c.keyValue}: ${c.rows.map((r) => `${r.companyName} (${r.slug})`).join(' <-> ')} - ${c.reason}`);
  }
  let insertedIds: string[] = [];
  if (cli.apply && plan.insert.length > 0) {
    insertedIds = await db.transaction(async (tx) => {
      const out = await tx
        .insert(ipoSourceKeys)
        .values(
          plan.insert.map((k) => ({
            ipoId: k.ipoId,
            source: k.source,
            keyType: k.keyType,
            keyValue: k.keyValue,
            bindingValue: k.keyValue,
            state: 'ACTIVE' as const,
            recordOpenDate: k.recordOpenDate,
            boundVia: 'BACKFILL',
            boundBy: TOOL,
          }))
        )
        .returning({ id: ipoSourceKeys.id });
      return out.map((r) => r.id);
    });
  }
  writeLedgerFile(path.join(SCRAPER_ROOT, 'evidence', `${TOOL}-${cli.apply ? 'applied' : 'dryrun'}-${Date.now()}.json`), {
    tool: TOOL,
    mode: cli.apply ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    // Inserts only — `before` is null (no prior row); rollback is deleting the id.
    changes: plan.insert.map((k, i) => ({
      table: 'ipo_source_keys',
      rowKey: insertedIds[i] ?? `pending:${k.ipoId}:${k.source}:${k.keyType}`,
      field: '(row)',
      before: null,
      after: { ipoId: k.ipoId, source: k.source, keyType: k.keyType, keyValue: k.keyValue },
    })),
    database: actual,
    apply: cli.apply,
    at: new Date().toISOString(),
    planned: plan.insert,
    collisions: plan.collisions,
    insertedIds,
  });
  console.log(cli.apply ? `${TOOL}: APPLIED - ${insertedIds.length} keys inserted.` : `${TOOL}: DRY RUN - re-run with --apply to insert.`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`${TOOL}: failed -`, error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
