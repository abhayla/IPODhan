/**
 * Repair: price band, lot size and re-derived issue size for one row
 * created before its price band was published (#453).
 *
 * RCA: the write path fills whatever it can at row-creation time and
 * nothing re-derives the price-dependent fields (`lotSize`, `issueSize`,
 * and `priceRangeMin`/`priceRangeMax` when still null) once the band
 * lands later. Manika Plastech's row was created 2026-09-09 (before the
 * band was public); `issue_size` was frozen at a value computed against
 * the band FLOOR (fresh amount + OFS shares x band low) rather than the
 * market-convention headline figure (fresh amount + OFS shares x band
 * high), and `lot_size` was never written at all.
 *
 * Class: every IPO whose row is created before its price band is
 * published, on any slot (`docs/design/probes/fixtures/
 * nse-manika-plastech-2026-09-10.json` is the real NSE fixture for the
 * observed member; the loop's re-derivation trigger, not this tool, is the
 * class-level fix — see #453 "Fix" section 2). This tool repairs ONE named
 * row per invocation, explicitly, from operator-supplied values sourced
 * from NSE — it is not a scan-and-fix-all-matching-rows tool, because the
 * correct band/lot/OFS-share values are per-IPO facts that must be read
 * from a live source, not inferred.
 *
 * Values are supplied explicitly on the command line (never guessed) and
 * only the fields that differ from what is already stored are written —
 * an idempotent per-field diff, not a blind overwrite. Each written field
 * gets a `field_sources` provenance row (source ADMIN).
 *
 * dry-run by default; --apply writes (refused against production unless
 * --allow-prod is also given — see scripts/lib/repair-tool.ts).
 *
 * Usage (run from scraper/ with the tunnel env exported):
 *   npx tsx scripts/repair-price-band-lot-issue-size-t453.ts \
 *     --slug manika-plastech-ltd --band-low 40 --band-high 43 --lot 348 \
 *     --fresh-cr 92.5 --ofs-shares 7674418 [--apply] [--allow-prod]
 */
import { db, getRedisClient } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared/repositories';
import { eq } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';
import { openRepairDb, upsertFieldSource, writeLedgerFile } from './lib/repair-tool.js';

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
const UPDATED_BY = 'SYSTEM_T453_REPAIR';

/**
 * Pure derivation: total issue size in rupees = the fixed fresh-issue
 * rupee amount + (OFS share count x the price to convert those shares at).
 * Callers pass the band CAP for the corrected market-convention figure —
 * the band FLOOR reproduces the stale value that was frozen at draft stage
 * (see the unit test's regression case). Exported so the loop's future
 * re-derivation trigger can reuse this instead of re-deriving the
 * arithmetic from memory.
 */
export function deriveIssueSizeRupees(
  freshIssueRupees: number,
  ofsShares: number,
  priceAtWhichOfsIsValued: number
): number {
  if (!Number.isFinite(freshIssueRupees) || freshIssueRupees <= 0) {
    throw new Error(`deriveIssueSizeRupees: freshIssueRupees must be a positive finite number, got ${freshIssueRupees}`);
  }
  if (!Number.isFinite(ofsShares) || ofsShares <= 0) {
    throw new Error(`deriveIssueSizeRupees: ofsShares must be a positive finite number, got ${ofsShares}`);
  }
  if (!Number.isFinite(priceAtWhichOfsIsValued) || priceAtWhichOfsIsValued <= 0) {
    throw new Error(
      `deriveIssueSizeRupees: priceAtWhichOfsIsValued must be a positive finite number, got ${priceAtWhichOfsIsValued}`
    );
  }
  return freshIssueRupees + ofsShares * priceAtWhichOfsIsValued;
}

function readFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function requireNumberFlag(name: string): number {
  const raw = readFlag(name);
  const value = raw != null ? Number(raw) : NaN;
  if (raw == null || !Number.isFinite(value)) {
    console.error(`Usage: repair-price-band-lot-issue-size-t453.ts --slug <slug> --band-low <n> --band-high <n> --lot <n> --fresh-cr <n> --ofs-shares <n> [--apply] [--allow-prod]`);
    console.error(`  missing or non-numeric --${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  console.log('='.repeat(80));
  console.log(`PRICE BAND / LOT SIZE / ISSUE SIZE REPAIR (#453) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  await openRepairDb(db, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'repair-price-band-lot-issue-size-t453',
  });

  const slug = readFlag('slug');
  if (!slug) {
    console.error('Usage: repair-price-band-lot-issue-size-t453.ts --slug <slug> --band-low <n> --band-high <n> --lot <n> --fresh-cr <n> --ofs-shares <n> [--apply] [--allow-prod]');
    process.exit(1);
  }
  const bandLow = requireNumberFlag('band-low');
  const bandHigh = requireNumberFlag('band-high');
  const lot = requireNumberFlag('lot');
  const freshCr = requireNumberFlag('fresh-cr');
  const ofsShares = requireNumberFlag('ofs-shares');

  const freshIssueRupees = freshCr * 1_00_00_000; // 1 crore = 1,00,00,000 rupees
  const targetIssueSize = deriveIssueSizeRupees(freshIssueRupees, ofsShares, bandHigh);

  const [ipo] = await db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      slug: schema.ipos.slug,
      priceRangeMin: schema.ipos.priceRangeMin,
      priceRangeMax: schema.ipos.priceRangeMax,
      lotSize: schema.ipos.lotSize,
      issueSize: schema.ipos.issueSize,
    })
    .from(schema.ipos)
    .where(eq(schema.ipos.slug, slug))
    .limit(1);

  if (!ipo) {
    console.error(`no ipos row found for slug="${slug}"`);
    process.exit(1);
  }

  const targets: { field: 'priceRangeMin' | 'priceRangeMax' | 'lotSize' | 'issueSize'; from: string | number | null; to: number }[] = [];
  if (ipo.priceRangeMin !== bandLow) targets.push({ field: 'priceRangeMin', from: ipo.priceRangeMin, to: bandLow });
  if (ipo.priceRangeMax !== bandHigh) targets.push({ field: 'priceRangeMax', from: ipo.priceRangeMax, to: bandHigh });
  if (ipo.lotSize !== lot) targets.push({ field: 'lotSize', from: ipo.lotSize, to: lot });
  const currentIssueSize = ipo.issueSize == null ? null : Number(ipo.issueSize);
  if (currentIssueSize !== targetIssueSize) targets.push({ field: 'issueSize', from: ipo.issueSize, to: targetIssueSize });

  console.log(`row: ${ipo.companyName} (${ipo.slug}, id=${ipo.id})`);
  console.log(`derived issue size @ band cap ${bandHigh}: ${freshIssueRupees} (fresh) + ${ofsShares} (OFS shares) x ${bandHigh} = ${targetIssueSize}`);
  console.log(`fields to write (${targets.length}):`);
  for (const t of targets) {
    console.log(`  - ${t.field}: ${t.from ?? 'NULL'} -> ${t.to}`);
  }

  if (targets.length === 0) {
    console.log('\nNothing to write — row already matches the supplied values (idempotent no-op).');
    console.log('='.repeat(80));
    process.exit(0);
  }

  if (!APPLY) {
    console.log('\nDRY-RUN: re-run with --apply to write (requires --allow-prod against production).');
    console.log('='.repeat(80));
    process.exit(0);
  }

  const backupPath = `evidence/${new Date().toISOString().slice(0, 10)}-T453/before-${ipo.slug}.json`;
  writeLedgerFile(backupPath, { capturedAt: new Date().toISOString(), ipo });
  console.log(`backup written: ${backupPath}`);

  const repo = new IPORepository(db as any, getRedisClient());

  const updatePayload: Record<string, number> = {};
  for (const t of targets) updatePayload[t.field] = t.to;

  await db.transaction(async (tx) => {
    for (const t of targets) {
      await upsertFieldSource(tx as any, {
        ipoId: ipo.id,
        fieldName: t.field,
        source: 'ADMIN',
        confidence: 100,
        previousValue: t.from,
        dataLineage: {
          reason: '#453 band published after row creation',
          repairedBy: UPDATED_BY,
          repairedAt: new Date().toISOString(),
        },
        updatedBy: UPDATED_BY,
      });
    }
  });

  await repo.applyOfferTerms(ipo.id, updatePayload as any);

  const [after] = await db
    .select({
      id: schema.ipos.id,
      priceRangeMin: schema.ipos.priceRangeMin,
      priceRangeMax: schema.ipos.priceRangeMax,
      lotSize: schema.ipos.lotSize,
      issueSize: schema.ipos.issueSize,
      updatedAt: schema.ipos.updatedAt,
    })
    .from(schema.ipos)
    .where(eq(schema.ipos.id, ipo.id))
    .limit(1);

  console.log('\nread-back after write:');
  console.log(JSON.stringify(after, null, 1));

  const ledgerPath = `evidence/${new Date().toISOString().slice(0, 10)}-T453/applied-${ipo.slug}.json`;
  writeLedgerFile(ledgerPath, { appliedAt: new Date().toISOString(), ipo: after, targets });
  console.log(`ledger written: ${ledgerPath}`);

  console.log('\nAPPLY complete.');
  console.log('='.repeat(80));
  process.exit(0);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, 'repair-price-band-lot-issue-size-t453 crashed');
    console.error(e);
    process.exit(1);
  });
}
