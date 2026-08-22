/**
 * One-off merge for the 11th/11 P2-1 duplicate pair (T-277, round-2 review) —
 * "Atharva Poly-Plast" vs "Atharva Polyplast Ltd." — that the general
 * `merge-duplicate-ipos.ts` clustering (keyed on `normalizeCompanyNameForMatching`)
 * cannot converge: it is a genuine word-break variant ("Poly-Plast" vs
 * "Polyplast"), not a legal-suffix/punctuation difference, so folding it into
 * the shared identity key would risk false-merging unrelated companies whose
 * names differ only by spacing. Handled here as a targeted, evidenced,
 * single-transaction one-off instead.
 *
 * KEEP id=4c7e0757 (slug atharva-poly-plast-ltd) — richer: lot_size + registrar
 * populated, 328 subscriptions (real, non-rebuildable child data).
 * DELETE id=683cb329 (slug atharva-polyplast-ltd) — 71 gmp_records (repointed
 * before delete, same collision-skip rule as merge-duplicate-ipos.ts),
 * field_sources/listing_performance CASCADE (rebuildable by the scraper).
 *
 * Usage (tunnel: DATABASE_URL pointed at localhost:15432):
 *   npx tsx --tsconfig tsx.tsconfig.json scripts/merge-atharva-polyplast-t277.ts
 */

import { db } from '@ipodhan/shared/db';
import { ipos } from '@ipodhan/shared/db/schema';
import { sql, inArray, eq } from 'drizzle-orm';

const KEEP = '4c7e0757-5953-43be-b3d5-3f72abde9146';
const DUP = '683cb329-f12c-4a78-a532-403073099b09';

async function main() {
  const before = await db
    .select({ id: ipos.id, companyName: ipos.companyName, slug: ipos.slug })
    .from(ipos)
    .where(inArray(ipos.id, [KEEP, DUP]));
  console.log('BEFORE:', before);

  if (before.length !== 2) {
    console.log('Expected exactly 2 rows (already merged?) — aborting, no writes.');
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE subscriptions SET ipo_id = ${KEEP} WHERE ipo_id = ${DUP}`);
    await tx.execute(sql`
      DELETE FROM gmp_records d WHERE d.ipo_id = ${DUP} AND EXISTS (
        SELECT 1 FROM gmp_records k WHERE k.ipo_id = ${KEEP}
        AND k."timestamp" = d."timestamp" AND k.source = d.source)`);
    const repointed = await tx.execute(sql`UPDATE gmp_records SET ipo_id = ${KEEP} WHERE ipo_id = ${DUP}`);
    console.log('gmp_records repointed:', (repointed as any).rowCount ?? repointed);
    await tx.delete(ipos).where(eq(ipos.id, DUP));
  });

  console.log('APPLIED — atharvapolyplast pair merged (P2-1, 11th/11 residual pair).');
}

main().then(() => process.exit(0)).catch((e) => { console.error('merge failed:', e?.message || e); process.exit(1); });
