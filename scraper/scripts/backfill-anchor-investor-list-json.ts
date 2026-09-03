/**
 * W-52: `createAnchorInvestors` (scraper/src/services/data-persister.ts)
 * previously wrote `investorList: JSON.stringify(anchorData.investorList)`
 * into `anchor_investors.investor_list`, a jsonb column typed
 * `$type<IndividualInvestor[]>()`. Postgres therefore stored a JSON
 * STRING, not a jsonb array (`jsonb_typeof(investor_list) = 'string'`),
 * breaking `jsonb_array_elements()` and any consumer typed against the
 * array. The write path is fixed (this script does not touch it); this
 * script repairs rows that were already written with the string shape.
 *
 * For every row where `jsonb_typeof(investor_list) = 'string'`, re-cast the
 * stored JSON-string value back into a real jsonb array:
 *   UPDATE anchor_investors SET investor_list = (investor_list #>> '{}')::jsonb
 *
 * dry-run by default (reports affected rows, writes nothing); `--apply` writes.
 * Refuses to run against any database whose name does not end in `_test`
 * (fail-closed — this script must never touch production) UNLESS `--allow-prod`
 * is passed explicitly (section 6c, owner-approved production backfill).
 *
 * Usage (from scraper/, with the test-DB tunnel env exported):
 *   npx tsx scripts/backfill-anchor-investor-list-json.ts                         # dry-run
 *   npx tsx scripts/backfill-anchor-investor-list-json.ts --apply                 # writes (test DB)
 *   npx tsx scripts/backfill-anchor-investor-list-json.ts --allow-prod            # dry-run against prod
 *   npx tsx scripts/backfill-anchor-investor-list-json.ts --allow-prod --apply    # writes against prod
 */
import dotenv from 'dotenv';
dotenv.config();

import { db } from '@ipodhan/shared';
import { sql } from 'drizzle-orm';

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');

/**
 * Refuses to run against any database whose name does not end in `_test` —
 * this script writes rows and must never touch production (per
 * `feedback-no-new-databases` / `decision-authority.md` destructive-op gate) —
 * unless `allowProd` is explicitly true (section 6c owner-approved backfill),
 * in which case a non-_test database is permitted and reported.
 */
export function assertTestDatabase(allowProd: boolean): void {
  const raw = process.env.DATABASE_URL || '';
  const nameFromUrl = raw ? (() => {
    try {
      return new URL(raw).pathname.replace(/^\//, '');
    } catch {
      return '';
    }
  })() : '';
  const dbName = nameFromUrl || process.env.DATABASE_NAME || process.env.PGDATABASE || '';

  if (!/_test$/i.test(dbName)) {
    if (!allowProd) {
      throw new Error(
        `Refused: target database "${dbName || '(unresolved)'}" does not end in _test. ` +
          'This script writes rows; it will only ever run against an obvious test database.'
      );
    }
    console.log(
      `ALLOW-PROD: running against ${dbName || '(unresolved)'} (owner-approved production backfill, section 6c)`
    );
  }
}

async function main() {
  assertTestDatabase(ALLOW_PROD);

  console.log('='.repeat(80));
  console.log(`ANCHOR_INVESTORS.INVESTOR_LIST JSON-STRING BACKFILL (W-52) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const before = await db.execute(sql`
    SELECT id, jsonb_typeof(investor_list) AS type
    FROM anchor_investors
    WHERE jsonb_typeof(investor_list) = 'string'
  `);
  const affectedIds = (before.rows as Array<{ id: string; type: string }>).map((r) => r.id);
  console.log(`Rows with investor_list stored as a JSON string: ${affectedIds.length}`);
  for (const id of affectedIds) console.log(`  - ${id}`);

  if (APPLY && affectedIds.length > 0) {
    await db.execute(sql`
      UPDATE anchor_investors
      SET investor_list = (investor_list #>> '{}')::jsonb
      WHERE jsonb_typeof(investor_list) = 'string'
    `);
    console.log(`Applied: cast ${affectedIds.length} row(s) from JSON string to jsonb array.`);
  } else if (!APPLY) {
    console.log('\nDRY-RUN: no rows written. Re-run with --apply to write.');
  }

  console.log('='.repeat(80));
  process.exit(0);
}

/**
 * Only run when this file IS the entry point — importing `assertTestDatabase`
 * from a unit test must not launch a live run (same pattern as
 * `run-document-discovery.ts`'s `isEntryPoint` guard).
 */
const isEntryPoint = /backfill-anchor-investor-list-json[.]ts$/.test(
  String(process.argv[1] ?? '').split(/[/\\]/).pop() ?? ''
);

if (isEntryPoint) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
