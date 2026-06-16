/**
 * Corrective backfill: strip the trailing scrape status-code (#16) from stored
 * company_name on genuine IPOs ("…Ltd. P", "…Ltd. CT" → "…Ltd.").
 *
 * This is an ADMIN data correction (not scraped-data ingestion), so — like
 * reclassify-corporate-actions.ts — it issues a direct, audited UPDATE and stamps
 * last_manual_edit_at so the cron consolidation treats company_name as protected.
 * The going-forward root cause is sanitizeCompanyName() (validators.ts), which now
 * strips the code on every create.
 *
 * Slug is left UNCHANGED on purpose: generateIPOSlug already dropped the trailing
 * code, so the cleaned name re-derives to the SAME slug — no URL/FK churn. A row
 * whose cleaned name would change the slug is SKIPPED and reported (never silently
 * re-slugged).
 *
 * Dry-run by default. Pass --apply to write. Tunnel: DATABASE_HOST/PORT must point
 * at localhost:15432.
 *
 *   npx tsx --tsconfig tsx.tsconfig.json src/scripts/backfill-clean-company-names.ts          # dry-run
 *   DATABASE_HOST=localhost DATABASE_PORT=15432 npx tsx ... src/scripts/backfill-clean-company-names.ts --apply
 */
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { sanitizeCompanyName } from '../utils/validators.js';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import logger from '../utils/logger.js';

// Load web/.env.local (same discrete-param creds the audit/app use) without clobbering
// an explicitly-exported DATABASE_HOST/PORT (the tunnel override).
function loadEnv() {
  try {
    for (const line of readFileSync(new URL('../../../web/.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* env may already be exported */ }
}

async function main() {
  const apply = process.argv.includes('--apply');
  loadEnv();
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'ipodhan',
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: false,
  });
  await client.connect();
  console.log(`\n[clean-company-names] mode=${apply ? 'APPLY' : 'DRY-RUN'} host=${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}\n`);

  // Candidate genuine IPOs whose stored name carries a trailing status-code artifact.
  const { rows } = await client.query(
    `SELECT id, company_name, slug FROM ipos
     WHERE offering_type = 'IPO'
       AND (company_name ~ '(Ltd\\.?|Limited)\\s+[A-Za-z]{1,2}$')`
  );

  let updated = 0, skipped = 0, unchanged = 0;
  for (const r of rows) {
    const cleaned = sanitizeCompanyName(r.company_name);
    if (cleaned === r.company_name) { unchanged++; continue; }
    const newSlug = generateIPOSlug(cleaned);
    if (newSlug !== r.slug) {
      // Re-slugging would break URLs/FKs — out of scope for this correction.
      console.log(`  SKIP (slug would change ${r.slug} -> ${newSlug}): "${r.company_name}"`);
      logger.warn({ ipoId: r.id, oldSlug: r.slug, newSlug }, 'clean-company-names: slug change skipped');
      skipped++;
      continue;
    }
    console.log(`  ${apply ? 'UPDATE' : 'would update'}: "${r.company_name}" -> "${cleaned}" (slug ${r.slug} unchanged)`);
    if (apply) {
      await client.query(
        `UPDATE ipos SET company_name = $1, last_manual_edit_at = now(), updated_at = now() WHERE id = $2`,
        [cleaned, r.id]
      );
      logger.info({ ipoId: r.id, from: r.company_name, to: cleaned }, 'clean-company-names: corrected');
    }
    updated++;
  }

  // Read-back (G-PERSIST): re-query the candidates and confirm none still carry the artifact.
  if (apply) {
    const { rows: residual } = await client.query(
      `SELECT count(*)::int n FROM ipos WHERE offering_type='IPO' AND company_name ~ '(Ltd\\.?|Limited)\\s+[A-Za-z]{1,2}$'`
    );
    console.log(`\n  read-back: residual artifact rows = ${residual[0].n} (expect 0 unless slug-skipped)`);
  }

  console.log(`\n[clean-company-names] candidates=${rows.length} ${apply ? 'updated' : 'would-update'}=${updated} skipped(slug)=${skipped} already-clean=${unchanged}\n`);
  await client.end();
}

main().catch((e) => { logger.error({ err: e }, 'clean-company-names failed'); console.error(e); process.exit(1); });
