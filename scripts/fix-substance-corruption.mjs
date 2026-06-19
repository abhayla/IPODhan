// CORRECTIVE de-corruption (Stage A.5). Removes domain-absurd values the substance
// gate flags — it does NOT fabricate: a wrong value becomes NULL ("unknown"), the
// only honest correction when the true value is unrecoverable without re-scraping.
//
//   node scripts/fix-substance-corruption.mjs            -> DRY RUN (counts only)
//   node scripts/fix-substance-corruption.mjs --execute  -> apply (additive/corrective, tunnel)
//
// Two corrections, mirroring the write-path guards now in validators.ts so existing
// rows match the going-forward contract:
//   1. issue_size = 0  -> NULL   (0 is "unknown", masquerades as 100% coverage)
//   2. open_date/close_date that do not strictly precede the allotment (else
//      listing) anchor -> NULL   (#41/#52 date-stomp: 2026 dates on a 2021 IPO),
//      plus an open>close inversion.
// SELECT/UPDATE only. No DDL. Loads web/.env.local (tunnel localhost:15432).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, '..', 'web', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const EXECUTE = process.argv.includes('--execute');
const pool = new pg.Pool({
  host: process.env.DATABASE_HOST, port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'ipodhan', user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD, ssl: false, max: 4,
});
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const REAL_IPO = `offering_type = 'IPO'`;

// Multi-signal date plausibility, mirroring sanitizeIpoDates() in validators.ts.
// Ordering: open<close<allotment<listing. listing disambiguates which field is the
// stomp: with listing present, open/close are corroborated and a bad allotment is the
// outlier; with listing absent, allotment is the stable original and open/close are
// the stomp. Per-column nulling expressions:
const NULL_CLOSE = `(close_date IS NOT NULL AND (
   (open_date IS NOT NULL AND open_date > close_date)
   OR (listing_date IS NOT NULL AND close_date >= listing_date)
   OR (listing_date IS NULL AND allotment_date IS NOT NULL AND close_date >= allotment_date)
 ))`;
const NULL_OPEN = `(open_date IS NOT NULL AND (
   (close_date IS NOT NULL AND open_date > close_date)
   OR (listing_date IS NOT NULL AND open_date >= listing_date)
   OR (listing_date IS NULL AND allotment_date IS NOT NULL AND open_date >= allotment_date)
 ))`;
const NULL_ALLOT = `(allotment_date IS NOT NULL AND listing_date IS NOT NULL AND (
   allotment_date > listing_date
   OR (COALESCE(close_date, open_date) IS NOT NULL AND allotment_date < COALESCE(close_date, open_date))
 ))`;
const DATE_CORRUPT_WHERE = `${REAL_IPO} AND (${NULL_CLOSE} OR ${NULL_OPEN} OR ${NULL_ALLOT})`;

async function main() {
  console.log(`\n=== Substance corruption fix (${EXECUTE ? 'EXECUTE' : 'DRY RUN'}) ===`);

  const [{ z }] = await q(`SELECT count(*)::int z FROM ipos WHERE ${REAL_IPO} AND issue_size = 0`);
  console.log(`issue_size = 0 rows: ${z}`);
  const regWhere = `${REAL_IPO} AND registrar IS NOT NULL AND (registrar ~ '[\\^\\t\\n\\r]' OR registrar ~* 'Tel\\.?:|E-?mail:|Phone:')`;
  const regRows = await q(`SELECT id, registrar FROM ipos WHERE ${regWhere}`);
  console.log(`registrar-pollution rows (#45): ${regRows.length}`);
  for (const r of regRows) console.log(`   ${JSON.stringify(r.registrar).slice(0, 70)}…`);
  const corrupt = await q(`SELECT company_name, open_date::text o, close_date::text c, allotment_date::text a, listing_date::text l FROM ipos WHERE ${DATE_CORRUPT_WHERE} ORDER BY company_name`);
  console.log(`date-stomp rows (open<close<allotment<listing violated): ${corrupt.length}`);
  for (const r of corrupt) console.log(`   ${r.company_name} | O ${r.o} C ${r.c} A ${r.a} L ${r.l}`);

  if (!EXECUTE) { console.log(`\nDRY RUN — re-run with --execute to apply.`); await pool.end(); return; }

  const r1 = await q(`UPDATE ipos SET issue_size = NULL, updated_at = now() WHERE ${REAL_IPO} AND issue_size = 0`);
  // Null only the implausible field(s), keep the rest of the row intact.
  const r2 = await q(`UPDATE ipos SET
       close_date      = CASE WHEN ${NULL_CLOSE} THEN NULL ELSE close_date END,
       open_date       = CASE WHEN ${NULL_OPEN}  THEN NULL ELSE open_date  END,
       allotment_date  = CASE WHEN ${NULL_ALLOT} THEN NULL ELSE allotment_date END,
       updated_at = now()
     WHERE ${DATE_CORRUPT_WHERE}`);
  // Registrar de-pollution (#45). Mirrors validators.sanitizeRegistrar (the going-forward
  // SSOT); ported here for this one-off corrective since this script is plain node+pg.
  const REG_KW = /(registrar|technolog|services|consultant|securities|share|investor|corporate|capital|bigshare|link\s*intime|cameo|kfin|karvy|maashitla|skyline|purva|integrated|beetal|alankit|\bmas\b)/i;
  const cleanReg = (value) => {
    if (!value) return null;
    const seg = String(value).split(/[\^\t\n\r]+/).map((s) => s.trim()).filter(Boolean);
    if (!seg.length) return null;
    const byAlpha = [...seg].sort((a, b) => b.replace(/[^a-z]/gi, '').length - a.replace(/[^a-z]/gi, '').length);
    let s = seg.find((x) => REG_KW.test(x)) ?? byAlpha[0];
    s = s.split(/\s*(?:Tel\.?:|E-?mail:|Phone:|,\s*\d)/i)[0].trim();
    s = s.replace(/([a-z])(Limited|Ltd\.?|Private\b)/g, '$1 $2').replace(/\s+/g, ' ').trim();
    return s || null;
  };
  let regFixed = 0;
  for (const r of regRows) {
    const cleaned = cleanReg(r.registrar);
    if (cleaned && cleaned !== r.registrar) { await q(`UPDATE ipos SET registrar=$1, updated_at=now() WHERE id=$2`, [cleaned, r.id]); regFixed++; }
  }
  console.log(`\nAPPLIED: issue_size 0->NULL rows=${r1.rowCount}; date-stomp rows nulled=${r2.rowCount}; registrar cleaned=${regFixed}`);

  // read-back (G-PERSIST)
  const [{ z2 }] = await q(`SELECT count(*)::int z2 FROM ipos WHERE ${REAL_IPO} AND issue_size = 0`);
  const left = await q(`SELECT count(*)::int n FROM ipos WHERE ${DATE_CORRUPT_WHERE}`);
  const regLeft = await q(`SELECT count(*)::int n FROM ipos WHERE ${regWhere}`);
  console.log(`read-back: issue_size=0 now ${z2}; date-stomp remaining ${left[0].n}; registrar-pollution remaining ${regLeft[0].n}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
