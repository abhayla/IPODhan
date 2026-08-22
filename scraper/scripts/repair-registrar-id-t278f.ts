/**
 * Repair: registrar_id for the 9 rows now trivially matchable after extending
 * the matcher with `^address`-suffix stripping, glued-legal-suffix space
 * re-insertion, and an explicit typo alias (T-278F, checker finding #4).
 *
 * These 9 rows were left NULL by the P3-2 backfill (evidence/2026-08-22-T-278/
 * 06-registrar-id-unmatched.json — 37 NULL rows) because `resolveRegistrarId`
 * couldn't bridge "KFin TechnologiesLimited" (glued suffix), "Bigshare
 * Servies..." (typo), or the two `^address`-contaminated CAMEO/Skyline values.
 * The other 28 rows stay NULL — genuinely absent from the `registrars`
 * reference table (Maashitla, Mudra, MCS, Adroit) — never guessed at.
 *
 * Idempotent: only updates rows where `registrar_id IS NULL` and
 * `resolveRegistrarId` now returns a match; a re-run naturally converges to a
 * no-op once every matchable row is populated.
 *
 * dry-run by default; --apply writes.
 * Run from scraper/ with tunnel env exported (DATABASE_HOST=127.0.0.1 PORT=15432 + creds).
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { resolveRegistrarId } from '@ipodhan/shared/utils/registrar-matcher';
import { eq, isNull, isNotNull, and } from 'drizzle-orm';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log('='.repeat(80));
  console.log(`REGISTRAR_ID REPAIR (T-278F, matcher extension) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const registrars = await db
    .select({ id: schema.registrars.id, name: schema.registrars.name, shortName: schema.registrars.shortName })
    .from(schema.registrars);

  const unmatchedRows = await db
    .select({ id: schema.ipos.id, companyName: schema.ipos.companyName, registrar: schema.ipos.registrar })
    .from(schema.ipos)
    .where(and(isNull(schema.ipos.registrarId), isNotNull(schema.ipos.registrar)));

  let matched = 0, written = 0, stillUnmatched = 0;
  for (const row of unmatchedRows) {
    const registrarId = resolveRegistrarId(row.registrar, registrars);
    if (!registrarId) {
      stillUnmatched++;
      continue;
    }
    matched++;
    console.log(`  ${APPLY ? 'WRITE' : 'would write'}: ${row.companyName} | "${row.registrar}" -> ${registrarId}`);
    if (APPLY) {
      await db.update(schema.ipos).set({ registrarId }).where(eq(schema.ipos.id, row.id));
      logger.info({ ipoId: row.id, company: row.companyName, registrar: row.registrar, registrarId }, 'registrar_id repaired');
      written++;
    }
  }

  console.log(`\ncandidates: ${unmatchedRows.length} | newly matched: ${matched} | written: ${written} | still unmatched: ${stillUnmatched}`);
  if (!APPLY) console.log('\nDRY-RUN: re-run with --apply to write.');
  console.log('='.repeat(80));
  process.exit(0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'registrar_id repair crashed');
  console.error(e);
  process.exit(1);
});
