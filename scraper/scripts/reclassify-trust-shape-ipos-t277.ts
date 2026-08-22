/**
 * One-off reclassification for P2-2 (T-277, round-2 review): three rows in
 * prod carry offering_type='IPO' despite being genuine InvIT/REIT trust
 * structures whose company name has no "InvIT"/"REIT" substring for Rule 2's
 * detector to match (the same gap the new NON_IPO_TRUST_SHAPE validation rule
 * closes for future scrapes — see data-validation.ts). This script corrects
 * the three EXISTING rows so they read correctly and drop off the Mainboard
 * IPO tracker (which filters `offeringType: ['IPO']`).
 *
 * Classification (verified by entity type, not name heuristic):
 *   - Cube Highways Trust                              -> INVITS (highway toll-road InvIT)
 *   - Raajmarg Infra Investment Trust                   -> INVITS (road infra InvIT)
 *   - Property Share Investment Trust-Propshare Celestia -> REITS (Property Share SM REIT scheme)
 *
 * Usage (tunnel: DATABASE_URL pointed at localhost:15432):
 *   npx tsx --tsconfig tsx.tsconfig.json scripts/reclassify-trust-shape-ipos-t277.ts
 */

import { db } from '@ipodhan/shared/db';
import { ipos } from '@ipodhan/shared/db/schema';
import { inArray, eq } from 'drizzle-orm';

const RECLASSIFY: Array<{ slug: string; to: 'INVITS' | 'REITS' }> = [
  { slug: 'cube-highways-trust', to: 'INVITS' },
  { slug: 'raajmarg-infra-investment-trust', to: 'INVITS' },
  { slug: 'property-share-investment-trust-propshare-celestia', to: 'REITS' },
];

async function main() {
  const slugs = RECLASSIFY.map((r) => r.slug);
  const before = await db
    .select({ id: ipos.id, slug: ipos.slug, companyName: ipos.companyName, offeringType: ipos.offeringType })
    .from(ipos)
    .where(inArray(ipos.slug, slugs));
  console.log('BEFORE:', before);

  if (before.length !== RECLASSIFY.length) {
    console.log(`Expected ${RECLASSIFY.length} rows, found ${before.length} — aborting, no writes.`);
    return;
  }

  for (const { slug, to } of RECLASSIFY) {
    const row = before.find((r) => r.slug === slug);
    if (!row) continue;
    if (row.offeringType !== 'IPO') {
      console.log(`SKIP ${slug} — already ${row.offeringType}, not IPO.`);
      continue;
    }
    await db.update(ipos).set({ offeringType: to }).where(eq(ipos.id, row.id));
    console.log(`RECLASSIFIED ${slug}: IPO -> ${to}`);
  }

  const after = await db
    .select({ id: ipos.id, slug: ipos.slug, offeringType: ipos.offeringType })
    .from(ipos)
    .where(inArray(ipos.slug, slugs));
  console.log('AFTER:', after);
  console.log('APPLIED — P2-2 trust-shape rows reclassified off the Mainboard IPO tracker.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('reclassify failed:', e?.message || e); process.exit(1); });
