/**
 * Repair: `ipos.segment` hygiene (T-287 P3-6).
 *
 * WHY / SCOPE DECISION (documented — the T-285 review's headline counts
 * ("2 NCD rows segment=NULL" + "9 non-IPO rows segment=MAINBOARD") do not
 * match this DB's current state; a live count found 53 non-IPO rows with
 * segment='MAINBOARD', not 9. Blindly "correcting" all 53 would be WRONG:
 * `segment` is the EXCHANGE segment (MAINBOARD | SME), independent of
 * offering_type — a RIGHTS/OFS/TENDER/BUYBACK/NCD issue from a company that
 * genuinely trades on the mainboard exchange (e.g. WIPRO buyback, COAL INDIA
 * OFS, IIFL/KOSAMATTAM NCDs) correctly carries segment='MAINBOARD'; that is
 * accurate data, not hygiene debt. The ONLY offering types where the schema
 * itself documents MAINBOARD/SME as inapplicable are INvITs/REITs (see
 * `packages/shared/src/db/schema.ts` — "segment ... nullable for
 * RIGHTS/InvITs/REITs"), because a business-trust structure isn't classified
 * on the equity mainboard/SME axis at all. So this repair is scoped to:
 *
 *   1. NCD rows with segment=NULL -> 'MAINBOARD' (2 rows: Power Finance
 *      Corporation Zero Coupon NCD, IIFL Finance Limited). Consistent with
 *      the 5 other NCD rows already correctly carrying segment='MAINBOARD'
 *      in this DB (Indel Money, Prachay Capital, ICL Fincorp, Kosamattam
 *      Finance, KLM Axiva Finvest) — these ARE mainboard-exchange NCDs.
 *   2. INVITS/REITS rows with segment='MAINBOARD' -> NULL (6 rows: Cube
 *      Highways Trust, Raajmarg Infra Investment Trust, Citius Transnet
 *      Investment Trust x2 name variants, Property Share Investment Trust,
 *      Bagmane Prime Office REIT) — corrected to the schema-documented
 *      nullable state for business trusts.
 *   3. (T-287F) INDIGRID INFRASTRUCTURE TRUST — a business trust stored with
 *      offering_type='OFS' (not INVITS/REITS), so it is invisible to the
 *      offeringType-based query above. Same class, hardcoded by id because
 *      an offering_type match can't reach it; verified against NSE (INFRA
 *      InvIT structure, not equity mainboard/SME).
 *
 * Any RIGHTS/OFS/TENDER/BUYBACK/NCD row with a genuinely correct
 * segment='MAINBOARD' is intentionally left untouched.
 *
 * SAFETY: backup-first (writes the pre-change row snapshot to evidence/),
 * per-row logged, idempotent (`segment IS DISTINCT FROM <target>` guard —
 * safe to re-run). dry-run by default; --apply writes.
 *
 * ROWCOUNT + DURABILITY (T-287F fix — checker T-287C found this class of bug):
 * the original version of this script assigned the UPDATE result and never
 * read it, so `written++`/`'segment corrected'` fired unconditionally even
 * when the UPDATE matched 0 rows (error-handling.md "No Silent Failures").
 * `applyGuardedUpdate()` below now checks `result.rowCount` and treats 0 as
 * an ERROR, not a success. Root cause of the 3 real 0-row matches: `segment`
 * has NO entry in `field-priority-matrix.ts` and is unconditionally
 * defaulted to 'MAINBOARD' by chittorgarh-scraper.ts for any row it scrapes
 * (it doesn't know about the InvIT/REIT nullable-segment rule) — so the
 * live prod scraper (still on `main`, running every 30 min) was re-writing
 * these 3 rows back to 'MAINBOARD' between/after this script's runs. Fixing
 * `written` accounting alone does not make the repair durable: without
 * protection, the very next scrape cycle can flip it back. So on a
 * successful --apply write this script now also calls
 * `markFieldAsManuallyEdited(ipoId, 'ipos', 'segment', ..., autoProtect=true)`
 * (the SSOT admin-field-protection path — see
 * `.claude/rules/admin-field-protection.md`) so `data-persister.ts`'s
 * `filterProtectedFields()` blocks the scraper from overwriting `segment`
 * on these rows again.
 *
 * Run from scraper/ with tunnel env (DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432 ...):
 *   npx tsx scripts/repair-segment-hygiene-t287.ts          # dry-run
 *   npx tsx scripts/repair-segment-hygiene-t287.ts --apply
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { createFieldProtectionService } from '@ipodhan/shared/admin/field-protection-checker';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const EVIDENCE_DIR = process.env.T287_EVIDENCE_DIR || 'D:/Abhay/GetWorkDone/evidence/2026-08-23-T-287';
const EDITED_BY = 'system:T-287F-segment-repair';

// (T-287F) InvIT/REIT rows the offeringType-based query can't reach because
// their offering_type is mis-scraped as something else (see WHY/SCOPE #3).
const KNOWN_MISCLASSIFIED_TRUST_IDS = ['89293fd2-db3a-4172-80f8-d47ab5ee88a4']; // INDIGRID INFRASTRUCTURE TRUST (offering_type='OFS')

export interface RowResult {
  rowCount: number | null | undefined;
}

/**
 * Pure guard: an UPDATE that matched 0 rows is an ERROR, never a silent
 * success. Returns the error message to log/throw, or null if the write
 * genuinely landed. Kept pure (no I/O) so it's unit-testable without a DB.
 */
export function checkUpdateApplied(
  result: RowResult,
  context: { id: string; companyName: string; field: string }
): string | null {
  const rowCount = result.rowCount ?? 0;
  if (rowCount < 1) {
    return `UPDATE matched 0 rows for ${context.field} on "${context.companyName}" (id=${context.id}) — row missing, id stale, or a concurrent write already changed it; NOT counted as applied`;
  }
  return null;
}

async function main() {
  console.log('='.repeat(80));
  console.log(`SEGMENT HYGIENE REPAIR (T-287 P3-6, fix round T-287F) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const ncdNullSegment = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName, offeringType: schema.ipos.offeringType, segment: schema.ipos.segment })
    .from(schema.ipos)
    .where(and(eq(schema.ipos.offeringType, 'NCD'), isNull(schema.ipos.segment)));

  const invitReitMainboard = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName, offeringType: schema.ipos.offeringType, segment: schema.ipos.segment })
    .from(schema.ipos)
    .where(and(inArray(schema.ipos.offeringType, ['INVITS', 'REITS']), eq(schema.ipos.segment, 'MAINBOARD')));

  const misclassifiedTrusts = KNOWN_MISCLASSIFIED_TRUST_IDS.length
    ? await db
        .select({ id: schema.ipos.id, companyName: schema.ipos.companyName, offeringType: schema.ipos.offeringType, segment: schema.ipos.segment })
        .from(schema.ipos)
        .where(and(inArray(schema.ipos.id, KNOWN_MISCLASSIFIED_TRUST_IDS), eq(schema.ipos.segment, 'MAINBOARD')))
    : [];

  console.log(`NCD rows with segment=NULL (-> MAINBOARD): ${ncdNullSegment.length}`);
  console.log(`INVITS/REITS rows with segment=MAINBOARD (-> NULL): ${invitReitMainboard.length}`);
  console.log(`Known misclassified trusts (offering_type != INVITS/REITS) with segment=MAINBOARD (-> NULL): ${misclassifiedTrusts.length}`);

  const allTargets = [
    ...ncdNullSegment.map((r) => ({ ...r, target: 'MAINBOARD' as const })),
    ...invitReitMainboard.map((r) => ({ ...r, target: null })),
    ...misclassifiedTrusts.map((r) => ({ ...r, target: null })),
  ];

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const backupPath = path.join(EVIDENCE_DIR, 'p3-6-segment-backup-before-fixround.json');
  fs.writeFileSync(backupPath, JSON.stringify(allTargets, null, 1));
  console.log(`backup written: ${backupPath} (${allTargets.length} rows)`);

  for (const t of allTargets) {
    console.log(`  - ${t.companyName} [${t.offeringType}] segment: ${t.segment ?? 'NULL'} -> ${t.target ?? 'NULL'}`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN: ${allTargets.length} segment values WOULD be corrected. Re-run with --apply.`);
    console.log('='.repeat(80));
    process.exit(0);
  }

  const protectionService = createFieldProtectionService(db, null);

  let written = 0;
  const failures: string[] = [];
  for (const t of allTargets) {
    const result = await db
      .update(schema.ipos)
      .set({ segment: t.target as any })
      .where(and(
        eq(schema.ipos.id, t.id),
        t.target === null
          ? eq(schema.ipos.segment, 'MAINBOARD')
          : isNull(schema.ipos.segment),
      ));

    const error = checkUpdateApplied(result, { id: t.id, companyName: t.companyName, field: 'segment' });
    if (error) {
      failures.push(error);
      logger.error({ id: t.id, company: t.companyName, offeringType: t.offeringType, from: t.segment, to: t.target }, error);
      console.error(`  FAILED (rowCount=0): ${t.companyName} (id=${t.id})`);
      continue;
    }

    // Durability: protect the field so the scraper (chittorgarh-scraper
    // defaults segment='MAINBOARD' unconditionally, and `segment` has no
    // field-priority-matrix entry) cannot silently revert this write.
    await protectionService.markFieldAsManuallyEdited(
      t.id,
      'ipos',
      'segment',
      EDITED_BY,
      'T-287 P3-6 InvIT/REIT/NCD segment hygiene repair — protected against scraper re-defaulting segment on business trusts',
      true
    );

    written++;
    logger.info({ company: t.companyName, offeringType: t.offeringType, from: t.segment, to: t.target }, 'segment corrected + protected');
  }

  console.log(`\nAPPLY complete: written=${written}, failed=${failures.length} (of ${allTargets.length} targeted)`);
  if (failures.length > 0) {
    console.error('\nFAILURES (rowCount=0 — investigate before re-running):');
    failures.forEach((f) => console.error(`  - ${f}`));
  }
  console.log('='.repeat(80));
  process.exit(failures.length > 0 ? 1 : 0);
}

// Guard so `checkUpdateApplied` can be imported by unit tests without
// executing `main()` (which touches the real DB) as an import side effect.
// MUST use pathToFileURL, not a hand-rolled `file://${argv[1]}` template —
// that pattern silently never matches on Windows (T-223 / PR #116).
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  main().catch((e) => {
    logger.error({ error: e instanceof Error ? e.message : String(e) }, 'segment hygiene repair crashed');
    console.error(e);
    process.exit(1);
  });
}
