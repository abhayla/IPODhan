/**
 * Repair: field_sources provenance for the 87 price-band rows the T-276
 * backfill wrote directly (T-278 P3-7, GitHub #165 F1).
 *
 * WHY: backfill-price-bands.ts writes `priceRangeMin`/`priceRangeMax` via a
 * direct `db.update(ipos)` — the fast path used by one-off repair scripts —
 * which never calls the consolidation service's `trackFieldSource()`. So
 * field_sources for these 87 rows still credits whatever source (CHITTORGARH/
 * MONEYCONTROL/NSE) last wrote the field BEFORE the correction, even though
 * the corrected value came from NSE's own API (confirmed: every UPDATED row
 * in the applied ledger has sourceEndpoint = /api/all-upcoming-issues or
 * /api/public-past-issues). Left stale, this is a live risk: T-276's own P3-7
 * sibling fix bounds `sameSourceRefresh` to NSE/BSE only, but a stale
 * MONEYCONTROL-credited field_sources row means the NEXT genuine NSE update
 * for that IPO would look like a CROSS-source conflict (MONEYCONTROL vs NSE)
 * rather than a same-source refresh — contesting priority correctly, but
 * against a provenance record that no longer reflects reality.
 *
 * Source: evidence/2026-08-22-T-276/33-applied-ledger.csv, filtered to
 * action=UPDATED (87 rows) — matched to the current ipos table by slug.
 * Idempotent: `trackFieldUpdate` upserts on (ipoId, tableName, fieldName), so
 * a re-run is safe.
 *
 * dry-run by default; --apply writes.
 * Run from scraper/ with tunnel env exported (DATABASE_HOST=127.0.0.1 PORT=15432 + creds).
 */
import { db } from '@ipodhan/shared';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { FieldSourcesRepository } from '@ipodhan/shared/repositories';
import * as schema from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const csvIdx = process.argv.indexOf('--csv');
const CSV_PATH = csvIdx >= 0 ? process.argv[csvIdx + 1] : undefined;

if (!CSV_PATH) {
  console.error('Usage: repair-field-sources-price-band-t276.ts --csv <path-to-33-applied-ledger.csv> [--apply]');
  process.exit(1);
}

// Minimal CSV split — the ledger has no embedded commas/quotes in these columns.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

async function main() {
  console.log('='.repeat(80));
  console.log(`FIELD_SOURCES REPAIR — price band provenance to NSE (T-276 ledger) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const rows = parseCsv(readFileSync(CSV_PATH!, 'utf-8')).filter((r) => r.action === 'UPDATED');
  console.log(`ledger rows with action=UPDATED: ${rows.length}`);

  const repo = new FieldSourcesRepository(db as any, getRedisClient());

  let matched = 0, unmatched = 0, written = 0, skipped = 0;
  for (const row of rows) {
    const [ipo] = await db
      .select({ id: schema.ipos.id, companyName: schema.ipos.companyName })
      .from(schema.ipos)
      .where(eq(schema.ipos.slug, row.slug))
      .limit(1);

    if (!ipo) {
      unmatched++;
      logger.warn({ slug: row.slug }, 'no current ipos row for this slug (renamed/merged since T-276 backfill?)');
      continue;
    }
    matched++;

    if (!APPLY) {
      console.log(`  would repair: ${ipo.companyName} (${row.slug}) -> priceRangeMin/Max = NSE`);
      continue;
    }

    try {
      await repo.trackFieldUpdate({
        ipoId: ipo.id,
        tableName: 'ipos',
        fieldName: 'priceRangeMin',
        source: 'NSE',
        confidence: 90,
        updatedBy: 'SYSTEM_T278_P3-7_REPAIR',
      });
      await repo.trackFieldUpdate({
        ipoId: ipo.id,
        tableName: 'ipos',
        fieldName: 'priceRangeMax',
        source: 'NSE',
        confidence: 90,
        updatedBy: 'SYSTEM_T278_P3-7_REPAIR',
      });
      written++;
      logger.info({ company: ipo.companyName, slug: row.slug }, 'field_sources repaired to NSE');
    } catch (err) {
      skipped++;
      logger.error({ slug: row.slug, error: err instanceof Error ? err.message : String(err) }, 'field_sources repair failed');
    }
  }

  console.log(`\nmatched: ${matched} | unmatched (skipped): ${unmatched} | written: ${written} | failed: ${skipped}`);
  if (!APPLY) {
    console.log('\nDRY-RUN: re-run with --apply to write.');
  }
  console.log('='.repeat(80));
  process.exit(skipped > 0 && skipped >= written ? 1 : 0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'field_sources repair crashed');
  console.error(e);
  process.exit(1);
});
