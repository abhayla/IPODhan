/**
 * Repair: #180 F1 — SME rows stuck at offering_type='FPO'.
 *
 * CLASS (not a slug list): every row where `segment='SME' AND offering_type='FPO'`,
 * on whichever slot DATABASE_URL points at. A genuine SME "FPO" does not occur — the
 * BSE-SME / NSE-SME first-time-listing platform only ever carries first public
 * offers (guardSmeOfferingTypeAgainstFpo, scraper/src/utils/detect-offering-type.ts).
 * Three rows were named by the T-292 checker (western-overseas-study-abroad-ltd,
 * shipwaves-online-ltd, stanbik-agro-ltd — all Dec 2025 BSE SME rows, last_scraped_at
 * frozen, zero field_sources rows for offeringType), but this script queries the
 * class directly rather than hardcoding those three, so it also repairs any other
 * row already in the same state and stays re-runnable as a class-level tool.
 *
 * The persister-side guard extension (data-persister.ts, same PR) stops the class
 * recurring on writes going forward; this script fixes rows already stuck before
 * that guard existed.
 *
 * SAFETY: backup-first (pre-change row snapshot to evidence/), per-row logged,
 * idempotent (re-running after --apply finds 0 matching rows), dry-run by default,
 * DB-name guard (refuses DATABASE_NAME=ipodhan unless --allow-prod), corrected
 * field protected via markFieldAsManuallyEdited so the next scrape cannot silently
 * revert it (T-287 pattern, same as repair-source-trust-batch-t292.ts).
 *
 * Run from scraper/ with tunnel env exported:
 *   npx tsx scripts/repair-sme-fpo-180.ts                    # dry-run (staging)
 *   npx tsx scripts/repair-sme-fpo-180.ts --apply             # apply (staging)
 *   npx tsx scripts/repair-sme-fpo-180.ts --apply --allow-prod  # apply (prod, owner word only)
 */
import { db, getRedisClient } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { createFieldProtectionService } from '@ipodhan/shared/admin/field-protection-checker';
import { and, eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
const EVIDENCE_DIR = process.env.T180_EVIDENCE_DIR || 'D:/Abhay/GetWorkDone/evidence/2026-09-07-T-459-180';
const EDITED_BY = 'system:180-sme-fpo-repair';
const CITATION =
  'guardSmeOfferingTypeAgainstFpo class invariant (scraper/src/utils/detect-offering-type.ts): ' +
  'the BSE-SME / NSE-SME first-time-listing platform has no genuine FPO — segment=SME rows stored ' +
  'offering_type=FPO are a first public offer misclassified by a lower-trust source, not a real FPO ' +
  '(T-292 Mopshop Distribution shape; #180 named 3 sibling rows the update-path guard never reached).';

function assertNotProdUnlessAllowed() {
  const dbName = (process.env.DATABASE_NAME || '').toLowerCase();
  const urlName = (process.env.DATABASE_URL || '').toLowerCase();
  const looksProd =
    dbName === 'ipodhan' || (urlName.includes('/ipodhan') && !urlName.includes('ipodhan_staging') && !urlName.includes('ipodhan_test'));
  if (looksProd && !ALLOW_PROD) {
    console.error('Refusing to run against what looks like the PROD database without --allow-prod.');
    console.error(`  DATABASE_NAME=${process.env.DATABASE_NAME ?? '(unset)'}`);
    process.exit(1);
  }
}

async function main() {
  assertNotProdUnlessAllowed();

  console.log('='.repeat(80));
  console.log(`#180 F1 SME/FPO REPAIR — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const rows = await db
    .select()
    .from(schema.ipos)
    .where(and(eq(schema.ipos.segment, 'SME' as any), eq(schema.ipos.offeringType, 'FPO' as any)));

  console.log(`Class query (segment='SME' AND offering_type='FPO'): ${rows.length} row(s) found.`);
  rows.forEach((r) => console.log(`  - ${r.slug} (id=${r.id}, last_scraped_at=${r.lastScrapedAt})`));

  if (rows.length === 0) {
    console.log('\nNo matching rows — class already clean on this slot.');
    console.log('='.repeat(80));
    process.exit(0);
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const backupPath = path.join(EVIDENCE_DIR, `180-sme-fpo-backup-before-apply-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(rows, null, 1));
  console.log(`backup written: ${backupPath}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN: ${rows.length} row(s) WOULD be corrected offering_type FPO -> IPO. Re-run with --apply.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  const protectionService = createFieldProtectionService(db, getRedisClient());
  const ledger: Array<Record<string, unknown>> = [];
  let written = 0;
  const failures: string[] = [];

  for (const r of rows) {
    const result = await db
      .update(schema.ipos)
      .set({ offeringType: 'IPO' as any, updatedAt: new Date() })
      .where(eq(schema.ipos.id, r.id));
    const rowCount = (result as any).rowCount ?? 0;
    if (rowCount < 1) {
      const msg = `UPDATE matched 0 rows for ${r.slug} (id=${r.id}) — investigate before re-running`;
      failures.push(msg);
      logger.error({ slug: r.slug, id: r.id }, msg);
      console.error(`  FAILED (rowCount=0): ${r.slug}`);
      continue;
    }

    await protectionService.markFieldAsManuallyEdited(
      r.id,
      'ipos',
      'offeringType',
      EDITED_BY,
      `#180 F1 repair — ${CITATION}`,
      true
    );

    written++;
    ledger.push({ slug: r.slug, id: r.id, companyName: r.companyName, from: 'FPO', to: 'IPO', citation: CITATION });
    logger.info({ slug: r.slug }, '#180 F1 row corrected + protected (offeringType FPO -> IPO)');
  }

  const ledgerPath = path.join(EVIDENCE_DIR, `180-sme-fpo-applied-ledger-${Date.now()}.json`);
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1));
  console.log(`\nAPPLY complete: written=${written}, failed=${failures.length} (of ${rows.length} targeted rows)`);
  console.log(`ledger written: ${ledgerPath}`);
  if (failures.length > 0) {
    console.error('\nFAILURES:');
    failures.forEach((f) => console.error(`  - ${f}`));
  }
  console.log('='.repeat(80));
  process.exit(failures.length > 0 ? 1 : 0);
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, '#180 F1 SME/FPO repair crashed');
    console.error(e);
    process.exit(1);
  });
}
