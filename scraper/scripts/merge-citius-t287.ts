/**
 * One-off merge for the Citius Transnet Investment Trust duplicate pair
 * (T-287F3) — "Citius Transnet Investment Trust" vs the misspelled
 * "CITIUS TRANNET INVESTMENT TRUST" — that the general
 * `merge-duplicate-ipos.ts` clustering (keyed on `normalizeCompanyNameForMatching`)
 * cannot converge: "Trannet" vs "Transnet" is a genuine letter-level
 * misspelling, not a legal-suffix/punctuation/word-break difference (the
 * PR #168 compact-key fold only strips separators, never substitutes
 * letters), so folding it into the shared identity key would risk
 * false-merging unrelated companies whose names differ by a similar edit
 * distance. Handled here as a targeted, evidenced, single-transaction
 * one-off instead — same shape as merge-atharva-polyplast-t277.ts.
 *
 * KEEP id=40affeea (slug citius-transnet-investment-trust, correct spelling)
 * — NOT the field-completeness winner (DUP has lot_size + registrar
 * populated, KEEP does not), but the operationally-required survivor: the
 * scraper's write path (data-consolidation-orchestrator.ts
 * consolidatedUpsertIPO / data-persister.ts upsertIPO) resolves rows via
 * `findByNormalizedName(normalizeCompanyNameForMatching(scrapedTitle))`
 * first. Chittorgarh's raw title is always correctly spelled
 * ("Citius Transnet Investment Trust (Citius Transnet InvIT IPO)"), so its
 * normalized name only ever matches KEEP's spelling — DUP's misspelled row
 * is permanently unreachable by any future scrape regardless of which row
 * survives. Keeping DUP would silently create a THIRD row on the next cycle.
 * To honor field-completeness (T-287F3 instruction) without losing DUP's
 * data, this script COPIES DUP's lot_size/registrar onto KEEP wherever KEEP
 * is currently null, before deleting DUP. KEEP also carries the live
 * field-protection record for `segment` (T-287F repair) — DUP has none.
 *
 * DELETE id=215c71f4 (slug citius-trannet-investment-trust) — verified zero
 * real child rows (subscriptions/gmp_records/documents/financial_data/
 * ipo_details/listing_performance/peer_companies/anchor_investors/
 * ipo_reviews/user_watchlist all count=0; field_sources also empty) —
 * nothing to repoint, only the two column values above to preserve.
 *
 * Usage (tunnel: DATABASE_URL pointed at localhost:15432, or run directly
 * against prod from the VPS with its own .env):
 *   npx tsx --tsconfig tsx.tsconfig.json scripts/merge-citius-t287.ts
 */

import { db } from '@ipodhan/shared/db';
import { ipos } from '@ipodhan/shared/db/schema';
import { inArray, eq } from 'drizzle-orm';

const KEEP = '40affeea-6809-460c-896b-58c7dc57baa2';
const DUP = '215c71f4-81fb-48d3-a473-d7d0f4cc2342';

async function main() {
  const before = await db
    .select({
      id: ipos.id,
      companyName: ipos.companyName,
      slug: ipos.slug,
      lotSize: ipos.lotSize,
      registrar: ipos.registrar,
    })
    .from(ipos)
    .where(inArray(ipos.id, [KEEP, DUP]));
  console.log('BEFORE:', before);

  if (before.length !== 2) {
    console.log('Expected exactly 2 rows (already merged?) — aborting, no writes.');
    return;
  }

  const keepRow = before.find((r) => r.id === KEEP)!;
  const dupRow = before.find((r) => r.id === DUP)!;

  await db.transaction(async (tx) => {
    // Preserve DUP's field-completeness advantage onto KEEP (T-287F3
    // instruction) — only fill fields KEEP currently lacks, never overwrite.
    const fill: Partial<typeof ipos.$inferInsert> = {};
    if (keepRow.lotSize == null && dupRow.lotSize != null) fill.lotSize = dupRow.lotSize;
    if (!keepRow.registrar && dupRow.registrar) fill.registrar = dupRow.registrar;
    if (Object.keys(fill).length > 0) {
      await tx.update(ipos).set(fill).where(eq(ipos.id, KEEP));
      console.log('Filled onto KEEP:', fill);
    }
    // DUP has zero real child rows (verified) — CASCADE delete is safe.
    await tx.delete(ipos).where(eq(ipos.id, DUP));
  });

  console.log('APPLIED — Citius Transnet duplicate pair merged (T-287F3).');
}

main().then(() => process.exit(0)).catch((e) => { console.error('merge failed:', e?.message || e); process.exit(1); });
