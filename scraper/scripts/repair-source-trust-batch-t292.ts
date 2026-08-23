/**
 * Repair: T-292 round-4 source-trust batch (P1-1, P2-5, P3-9).
 *
 * Four rows, each corrected against externally-corroborated sources with
 * URL + date citations below. Fixed independently of the code-side guards
 * landed in the same PR (guardSmeOfferingTypeAgainstFpo,
 * isAuthoritativeForHardDatesOnCreate) — those stop the CLASS from
 * recurring on future writes; this script fixes the FOUR rows already live
 * with bad data.
 *
 * --- P1-1: Mopshop Distribution Ltd. (slug=mopshop-distribution-ltd) ---
 * Real BSE SME fixed-price IPO, stored offering_type=FPO -> 404 site-wide.
 * Corroborated by TWO independent sources (2026-08-23):
 *   - chittorgarh.com/ipo/mopshop-distribution-ipo (cached evidence,
 *     D:\Abhay\GetWorkDone\evidence\2026-08-22-T-291\cg_mopshop.html):
 *     Issue Type = Fixed Price IPO, Listing At = BSE SME, IPO Date =
 *     19 to 21 Aug 2026, Lot Size = 1,000, tentative listing Aug 26, 2026.
 *   - ipowatch.in/mopshop-distribution-ipo (same evidence dir, iw_mopshop-
 *     distribution.html): BSE SME, Rs 138, 19-21 Aug, listing 26 Aug.
 * DB currently: offering_type=FPO, open=2026-08-15 IST, close=2026-08-22 IST,
 * listing=2026-08-26 IST (already correct — untouched), lot_size=NULL.
 * FIX: offering_type->IPO, open_date->2026-08-19, close_date->2026-08-21,
 * lot_size->1000. listing_date and price (138/138) already correct.
 *
 * --- P2-5: Priority Jewels Ltd. (slug=priority-jewels-ltd) ---
 * MAINBOARD/UPCOMING row created 2026-08-23 08:35:49, ZERO field_sources
 * rows (no provenance at all) — a single uncorroborated source asserted
 * Dec 2026 open/close dates as fact. ipowatch.in/priority-jewels-ipo (same
 * evidence dir, iw_priority.html) shows open/close/listing as UNANNOUNCED
 * ("= 2026" placeholders, band "Rs [.]").
 * FIX: open_date -> NULL, close_date -> NULL (renders TBA, matches every
 * other unknown field on that page — the honest default this codebase
 * already uses everywhere else).
 *
 * --- P3-9: SURYO FOODS & INDUSTRIES LTD + TRAVELS & RENTALS LTD ---
 * Byte-identical figures (open/close dates, price 15/15, lot 3000, issue
 * size Rs 16,80,40,275.00) despite being two unrelated companies. ROOT
 * CAUSE (confirmed via `git log -S "BSE SHORT CODES"`, commit f5bb349e,
 * 2026-07-02, PR #92): BOTH rows were created BEFORE the BSE short-code
 * ('RI' -> RIGHTS) classifier fix landed — TRAVELS created 2026-02-03,
 * SURYO created 2026-02-25, the fix landed 2026-07-02. Neither row has
 * been re-scraped since creation (last_scraped_at == created_at for both),
 * so the fix never got a chance to correct them. BOTH are genuine BSE
 * rights issues, not IPOs — confirmed externally (2026-08-23):
 *   - TRAVELS: chittorgarh.com/rights-issue/travels-rentals-rights-issue-2026/501/
 *     — Issue Size 1,12,02,685 shares @ Rs 15 = Rs 16.80 Cr (EXACT match to
 *     the DB's existing issue_size 168040275.00 = 1,12,02,685 x 15), open
 *     Feb 5 close Mar 6 listing Mar 11, 2026. TRAVELS' own stored numbers
 *     are correct; only offering_type, open/close (off by 1 day vs source),
 *     and the missing listing_date needed fixing.
 *   - SURYO: chittorgarh.com/rights-issue/suryo-foods-industries-rights-issue-feb-2026/510/
 *     — Issue Size 29,70,000 shares @ Rs 20 = Rs 5.94 Cr (NOT Rs 16.80 Cr —
 *     SURYO's row was carrying TRAVELS' cloned figures), open Feb 19 close
 *     Mar 6 listing Mar 11, 2026, ratio 3:4.
 * Neither chittorgarh rights-issue page lists a "lot size" (rights issues
 * are allotted by entitlement ratio against existing holding, not by
 * IPO-style lots) — lot_size=3000 on both rows is inapplicable, not a
 * real value; corrected to NULL rather than perpetuated.
 * MECHANISM STATUS (see repair log + GitHub issue filed alongside this
 * script): the offering_type classification miss is CONFIRMED CLOSED (the
 * 2026-07-02 fix already prevents new RI rows being marked IPO). The
 * cross-company numeric clone (SURYO inheriting TRAVELS' exact figures) is
 * UNRESOLVED — scraper_logs retention is 30 days (see
 * non-fatal-side-effects.md), so the Feb 2026 run that produced it cannot
 * be inspected. Filed as a tracked issue rather than guessed at.
 * FIX: offering_type IPO->RIGHTS on both; SURYO's price/issue_size/dates
 * corrected to its OWN verified figures; TRAVELS' open/close/listing dates
 * aligned to the source; lot_size->NULL on both.
 *
 * SAFETY: backup-first (writes the pre-change row snapshot to evidence/),
 * per-row logged, idempotent guard (skips a field already at target),
 * dry-run by default; --apply writes. Corrected offering_type/hard-date
 * fields are protected via markFieldAsManuallyEdited so the scraper cannot
 * silently revert them on the next cycle (T-287 pattern).
 *
 * Run from scraper/ with tunnel env exported (DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432 + creds):
 *   npx tsx scripts/repair-source-trust-batch-t292.ts          # dry-run
 *   npx tsx scripts/repair-source-trust-batch-t292.ts --apply
 */
import { db, getRedisClient } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { createFieldProtectionService } from '@ipodhan/shared/admin/field-protection-checker';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const EVIDENCE_DIR = process.env.T292_EVIDENCE_DIR || 'D:/Abhay/GetWorkDone/evidence/2026-08-23-T-292';
const EDITED_BY = 'system:T-292-source-trust-repair';

interface FieldChange {
  field: keyof typeof schema.ipos.$inferInsert;
  from: unknown;
  to: unknown;
}

interface RowRepair {
  slug: string;
  id: string;
  companyName: string;
  changes: FieldChange[];
  citation: string;
}

async function loadRow(slug: string) {
  const rows = await db.select().from(schema.ipos).where(eq(schema.ipos.slug, slug));
  if (rows.length !== 1) {
    throw new Error(`Expected exactly 1 row for slug=${slug}, found ${rows.length}`);
  }
  return rows[0];
}

async function main() {
  console.log('='.repeat(80));
  console.log(`T-292 SOURCE-TRUST BATCH REPAIR — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const mopshop = await loadRow('mopshop-distribution-ltd');
  const priorityJewels = await loadRow('priority-jewels-ltd');
  const suryo = await loadRow('suryo-foods-industries-ltd');
  const travels = await loadRow('travels-rentals-ltd');

  const repairs: RowRepair[] = [];

  // --- P1-1: Mopshop Distribution Ltd. ---
  {
    const changes: FieldChange[] = [];
    if (mopshop.offeringType !== 'IPO') changes.push({ field: 'offeringType', from: mopshop.offeringType, to: 'IPO' });
    const targetOpen = '2026-08-19';
    const targetClose = '2026-08-21';
    if (mopshop.openDate !== targetOpen) changes.push({ field: 'openDate', from: mopshop.openDate, to: targetOpen });
    if (mopshop.closeDate !== targetClose) changes.push({ field: 'closeDate', from: mopshop.closeDate, to: targetClose });
    if (mopshop.lotSize !== 1000) changes.push({ field: 'lotSize', from: mopshop.lotSize, to: 1000 });
    if (changes.length > 0) {
      repairs.push({
        slug: 'mopshop-distribution-ltd', id: mopshop.id, companyName: mopshop.companyName, changes,
        citation: 'chittorgarh.com/ipo/mopshop-distribution-ipo + ipowatch.in/mopshop-distribution-ipo (2026-08-23): BSE SME Fixed Price IPO, 19-21 Aug 2026, lot 1000',
      });
    }
  }

  // --- P2-5: Priority Jewels Ltd. ---
  {
    const changes: FieldChange[] = [];
    if (priorityJewels.openDate !== null) changes.push({ field: 'openDate', from: priorityJewels.openDate, to: null });
    if (priorityJewels.closeDate !== null) changes.push({ field: 'closeDate', from: priorityJewels.closeDate, to: null });
    if (changes.length > 0) {
      repairs.push({
        slug: 'priority-jewels-ltd', id: priorityJewels.id, companyName: priorityJewels.companyName, changes,
        citation: 'ipowatch.in/priority-jewels-ipo (2026-08-23): open/close/listing shown as unannounced; row has zero field_sources provenance — single uncorroborated source, render TBA',
      });
    }
  }

  // --- P3-9: SURYO FOODS & INDUSTRIES LTD (was carrying TRAVELS' figures) ---
  {
    const changes: FieldChange[] = [];
    if (suryo.offeringType !== 'RIGHTS') changes.push({ field: 'offeringType', from: suryo.offeringType, to: 'RIGHTS' });
    const targetOpen = '2026-02-19';
    const targetClose = '2026-03-06';
    const targetListing = '2026-03-11';
    if (suryo.openDate !== targetOpen) changes.push({ field: 'openDate', from: suryo.openDate, to: targetOpen });
    if (suryo.closeDate !== targetClose) changes.push({ field: 'closeDate', from: suryo.closeDate, to: targetClose });
    if (suryo.listingDate !== targetListing) changes.push({ field: 'listingDate', from: suryo.listingDate, to: targetListing });
    if (suryo.priceRangeMin !== 20) changes.push({ field: 'priceRangeMin', from: suryo.priceRangeMin, to: 20 });
    if (suryo.priceRangeMax !== 20) changes.push({ field: 'priceRangeMax', from: suryo.priceRangeMax, to: 20 });
    if (suryo.issueSize !== '59400000.00') changes.push({ field: 'issueSize', from: suryo.issueSize, to: '59400000.00' });
    if (suryo.lotSize !== null) changes.push({ field: 'lotSize', from: suryo.lotSize, to: null });
    if (changes.length > 0) {
      repairs.push({
        slug: 'suryo-foods-industries-ltd', id: suryo.id, companyName: suryo.companyName, changes,
        citation: 'chittorgarh.com/rights-issue/suryo-foods-industries-rights-issue-feb-2026/510/ (2026-08-23): Rights Issue, ratio 3:4, 29,70,000 sh @ Rs 20 = Rs 5.94 Cr, open 19 Feb, close 6 Mar, listing 11 Mar 2026',
      });
    }
  }

  // --- P3-9: TRAVELS & RENTALS LTD (own figures were already correct) ---
  {
    const changes: FieldChange[] = [];
    if (travels.offeringType !== 'RIGHTS') changes.push({ field: 'offeringType', from: travels.offeringType, to: 'RIGHTS' });
    const targetOpen = '2026-02-05';
    const targetClose = '2026-03-06';
    const targetListing = '2026-03-11';
    if (travels.openDate !== targetOpen) changes.push({ field: 'openDate', from: travels.openDate, to: targetOpen });
    if (travels.closeDate !== targetClose) changes.push({ field: 'closeDate', from: travels.closeDate, to: targetClose });
    if (travels.listingDate !== targetListing) changes.push({ field: 'listingDate', from: travels.listingDate, to: targetListing });
    if (travels.lotSize !== null) changes.push({ field: 'lotSize', from: travels.lotSize, to: null });
    if (changes.length > 0) {
      repairs.push({
        slug: 'travels-rentals-ltd', id: travels.id, companyName: travels.companyName, changes,
        citation: 'chittorgarh.com/rights-issue/travels-rentals-rights-issue-2026/501/ (2026-08-23): Rights Issue, 1,12,02,685 sh @ Rs 15 = Rs 16.80 Cr (matches existing issue_size exactly), open 5 Feb, close 6 Mar, listing 11 Mar 2026',
      });
    }
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const backupPath = path.join(EVIDENCE_DIR, 't292-source-trust-backup-before-apply.json');
  fs.writeFileSync(backupPath, JSON.stringify({ mopshop, priorityJewels, suryo, travels }, null, 1));
  console.log(`backup written: ${backupPath}`);

  for (const r of repairs) {
    console.log(`\n${r.companyName} (${r.slug}):`);
    for (const c of r.changes) {
      console.log(`  - ${c.field}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
    }
    console.log(`  citation: ${r.citation}`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN: ${repairs.length} rows WOULD be corrected (${repairs.reduce((n, r) => n + r.changes.length, 0)} field changes). Re-run with --apply.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  const protectionService = createFieldProtectionService(db, getRedisClient());
  const ledger: Array<Record<string, unknown>> = [];
  let written = 0;
  const failures: string[] = [];

  for (const r of repairs) {
    const setClause: Record<string, unknown> = {};
    for (const c of r.changes) setClause[c.field] = c.to;

    const result = await db.update(schema.ipos).set(setClause).where(eq(schema.ipos.id, r.id));
    const rowCount = (result as any).rowCount ?? 0;
    if (rowCount < 1) {
      const msg = `UPDATE matched 0 rows for ${r.slug} (id=${r.id}) — investigate before re-running`;
      failures.push(msg);
      logger.error({ slug: r.slug, id: r.id }, msg);
      console.error(`  FAILED (rowCount=0): ${r.companyName}`);
      continue;
    }

    for (const c of r.changes) {
      await protectionService.markFieldAsManuallyEdited(
        r.id,
        'ipos',
        c.field as string,
        EDITED_BY,
        `T-292 source-trust repair — ${r.citation}`,
        true
      );
    }

    written++;
    ledger.push({ slug: r.slug, id: r.id, companyName: r.companyName, changes: r.changes, citation: r.citation });
    logger.info({ slug: r.slug, changes: r.changes }, 'T-292 row corrected + protected');
  }

  const ledgerPath = path.join(EVIDENCE_DIR, 't292-source-trust-applied-ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1));
  console.log(`\nAPPLY complete: written=${written}, failed=${failures.length} (of ${repairs.length} targeted rows)`);
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
    logger.error({ error: e instanceof Error ? e.message : String(e) }, 'T-292 source-trust repair crashed');
    console.error(e);
    process.exit(1);
  });
}
