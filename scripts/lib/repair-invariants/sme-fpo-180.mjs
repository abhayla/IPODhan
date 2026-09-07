// Class invariant for scripts/assert-repair-held.mjs (#180 F1, T-459): the
// #180 repair (repair-sme-fpo-180.ts) corrected every row where
// `segment='SME' AND offering_type='FPO'` to offering_type='IPO'. The class
// invariant is that this population is EMPTY going forward — any row that
// reappears here is either a new scrape re-introducing the bug (the
// data-persister.ts guard extension in the same PR should prevent this) or a
// genuinely new SME row a source has misclassified, in which case the
// guard/detection needs a second look, not a manual patch.
//
// Two call shapes, same contract as issue-size-t451.mjs:
//   1. Module form (preferred): `export default async function(pool)`
//      returning { count, details }.
//   2. CLI form: prints the violation count as the LAST line of stdout.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { createUtcPool, installUtcTimestampParsing } from '../pg-utc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @param {import('pg').Pool} pool
 * @returns {Promise<{count: number, details: Array<{slug: string, id: string, offeringType: string}>}>}
 */
export default async function smeFpoInvariant(pool) {
  const { rows } = await pool.query(
    `SELECT slug, id, offering_type AS "offeringType" FROM ipos WHERE segment = 'SME' AND offering_type = 'FPO'`
  );
  return { count: rows.length, details: rows };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const envPath = join(__dirname, '..', '..', '..', 'web', '.env.local');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  installUtcTimestampParsing();
  const pool = createUtcPool(
    process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD
      ? {
          host: process.env.DATABASE_HOST,
          port: parseInt(process.env.DATABASE_PORT || '5432'),
          database: process.env.DATABASE_NAME || 'ipodhan',
          user: process.env.DATABASE_USER || 'postgres',
          password: process.env.DATABASE_PASSWORD,
          ssl: false,
          max: 2,
        }
      : { connectionString: process.env.DATABASE_URL, ssl: false, max: 2 }
  );
  try {
    const { count, details } = await smeFpoInvariant(pool);
    for (const d of details) {
      console.error(`  VIOLATION: ${d.slug} (id=${d.id}) offering_type=${d.offeringType}`);
    }
    console.log(String(count));
    process.exit(0);
  } catch (err) {
    console.error(`FATAL: sme-fpo-180 invariant crashed: ${err.message}`);
    process.exit(2);
  } finally {
    await pool.end();
  }
}
