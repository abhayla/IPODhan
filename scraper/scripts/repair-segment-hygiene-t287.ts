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
 *
 * Any RIGHTS/OFS/TENDER/BUYBACK/NCD row with a genuinely correct
 * segment='MAINBOARD' is intentionally left untouched.
 *
 * SAFETY: backup-first (writes the pre-change row snapshot to evidence/),
 * per-row logged, idempotent (`segment IS DISTINCT FROM <target>` guard —
 * safe to re-run). dry-run by default; --apply writes.
 *
 * Run from scraper/ with tunnel env (DATABASE_HOST=127.0.0.1 DATABASE_PORT=15432 ...):
 *   npx tsx scripts/repair-segment-hygiene-t287.ts          # dry-run
 *   npx tsx scripts/repair-segment-hygiene-t287.ts --apply
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { and, eq, isNull, inArray, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const EVIDENCE_DIR = process.env.T287_EVIDENCE_DIR || 'D:/Abhay/GetWorkDone/evidence/2026-08-23-T-287';

async function main() {
  console.log('='.repeat(80));
  console.log(`SEGMENT HYGIENE REPAIR (T-287 P3-6) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const ncdNullSegment = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName, offeringType: schema.ipos.offeringType, segment: schema.ipos.segment })
    .from(schema.ipos)
    .where(and(eq(schema.ipos.offeringType, 'NCD'), isNull(schema.ipos.segment)));

  const invitReitMainboard = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName, offeringType: schema.ipos.offeringType, segment: schema.ipos.segment })
    .from(schema.ipos)
    .where(and(inArray(schema.ipos.offeringType, ['INVITS', 'REITS']), eq(schema.ipos.segment, 'MAINBOARD')));

  console.log(`NCD rows with segment=NULL (-> MAINBOARD): ${ncdNullSegment.length}`);
  console.log(`INVITS/REITS rows with segment=MAINBOARD (-> NULL): ${invitReitMainboard.length}`);

  const allTargets = [
    ...ncdNullSegment.map((r) => ({ ...r, target: 'MAINBOARD' as const })),
    ...invitReitMainboard.map((r) => ({ ...r, target: null })),
  ];

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const backupPath = path.join(EVIDENCE_DIR, 'p3-6-segment-backup-before.json');
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

  let written = 0;
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
    written++;
    logger.info({ company: t.companyName, offeringType: t.offeringType, from: t.segment, to: t.target }, 'segment corrected');
  }

  console.log(`\nAPPLY complete: written=${written}`);
  console.log('='.repeat(80));
  process.exit(0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'segment hygiene repair crashed');
  console.error(e);
  process.exit(1);
});
