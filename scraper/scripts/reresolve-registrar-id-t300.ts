/**
 * P2-4 one-shot repair (round-5 review, T-300): run the shared
 * `reresolveRegistrarIds()` pass (src/services/registrar-reresolve.ts) once,
 * now, over every `ipos.registrar_id IS NULL` row — including the ~29 rows
 * the existing matcher can already resolve (Kfin/Bigshare/Cameo/Skyline/
 * MUFG-Intime/Alankit/Purva/Integrated-Registry name-format variants) and
 * the ~24 Maashitla + a few Mudra/Adroit/MCS rows unblocked by
 * `add-missing-registrars-t300.ts` adding those four rows to the reference
 * table. Genuinely unmatchable names stay NULL (never guessed).
 *
 * dry-run by default; --apply writes. Run from scraper/ with tunnel env
 * exported (DATABASE_HOST=127.0.0.1 PORT=15432 ipodhan_app creds).
 */
import { reresolveRegistrarIds } from '../src/services/registrar-reresolve.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log('='.repeat(80));
  console.log(`REGISTRAR_ID RE-RESOLVE (P2-4, T-300, round-5) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const result = await reresolveRegistrarIds({ dryRun: !APPLY });

  console.log(`candidates: ${result.candidates}`);
  console.log(`matched: ${result.matched}`);
  console.log(`written: ${result.written}`);
  console.log(`still unmatched (${result.unmatchedNames.length} distinct names):`);
  for (const n of result.unmatchedNames) console.log(`  - ${n}`);
  if (!APPLY) console.log('\nDRY-RUN: re-run with --apply to write.');
  console.log('='.repeat(80));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
