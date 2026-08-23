/**
 * Repair: the 3 date-incoherent rows (T-296 P2-7) and the 1 lead_managers
 * pollution row (T-296 P2-8) named in the T-299 contract.
 *
 * Backup-first: every touched row is read and dumped to a per-row JSON
 * ledger (evidence/2026-08-23-T-299/dates-leadmanagers-repair-ledger.json)
 * BEFORE any UPDATE, with the corroboration/reasoning for each change.
 *
 * Uses a raw `pg` Pool (see repair-subscription-regressions-t299.ts for why:
 * this box's local timezone makes any date-literal client-side comparison or
 * print fragile; every value here is read/written as a plain 'YYYY-MM-DD'
 * date string, matched against the exact values the T-296 review evidence
 * captured via psql - never re-derived through a JS Date object).
 *
 * Dates (P2-7):
 *  - anawil-wire-and-engineering-ltd: allotment_date 2025-08-06 -> 2026-08-06.
 *    CORROBORATED: close=2026-08-05, listing=2026-08-10; 2026-08-06 is T+1
 *    after close and sits inside the (close, listing) window exactly like
 *    every other mainboard/SME IPO in this dataset - only the YEAR digit was
 *    corrupted (2025 instead of 2026), the day-of-month already matched the
 *    T+1 pattern. High-confidence single-field fix.
 *  - kwality-walls-india-ltd: listing_date 2026-02-16 -> NULL. open
 *    (2026-04-23) and close (2026-05-07) are mutually coherent (14-day
 *    window); listing precedes BOTH of them, so it is the outlier, not
 *    open/close. No corroborating external source for the true listing date
 *    was available in this repair pass, so the incoherent field is nulled
 *    (matches what the write-path guard - sanitizeIpoDates - does going
 *    forward: never persist an impossible value) rather than guessed at.
 *  - twinkle-papers-ltd: allotment_date 2026-07-02 -> NULL. Precedes close
 *    (2026-07-03) by one day; no corroborating source available for the true
 *    allotment date, so nulled rather than guessed at.
 *
 * Lead managers (P2-8):
 *  - tempsens-instruments-india-ltd: lead_managers run through
 *    sanitizeLeadManagers() (the same parser fix landing in this PR),
 *    stripping the tab-split compliance-contact block down to the one real
 *    BRLM name.
 *
 * Run from scraper/ with tunnel env exported (DATABASE_HOST=127.0.0.1
 * DATABASE_PORT=15432 + creds), dry-run by default, --apply writes.
 */
import { Pool } from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';
import { sanitizeLeadManagers } from '../src/utils/validators.js';

const APPLY = process.argv.includes('--apply');
const LEDGER_DIR = 'D:/Abhay/GetWorkDone/evidence/2026-08-23-T-299';
const LEDGER_PATH = `${LEDGER_DIR}/dates-leadmanagers-repair-ledger.json`;

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'ipodhan',
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD,
});

async function main() {
  console.log('='.repeat(80));
  console.log(`DATES + LEAD_MANAGERS REPAIR (T-299 P2-7/P2-8) - ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  mkdirSync(LEDGER_DIR, { recursive: true });
  const ledger: any[] = [];

  const dateFixes: Array<{
    slug: string;
    field: 'allotment_date' | 'listing_date';
    newValue: string | null;
    reason: string;
  }> = [
    {
      slug: 'anawil-wire-and-engineering-ltd',
      field: 'allotment_date',
      newValue: '2026-08-06',
      reason:
        'close=2026-08-05, listing=2026-08-10; 2026-08-06 is T+1 after close, matches every sibling IPO pattern - only the year digit (2025) was corrupted',
    },
    {
      slug: 'kwality-walls-india-ltd',
      field: 'listing_date',
      newValue: null,
      reason:
        'open (2026-04-23) and close (2026-05-07) are mutually coherent; listing (2026-02-16) precedes both - it is the outlier, no corroborating source found, nulled per the write-path guard behavior',
    },
    {
      slug: 'twinkle-papers-ltd',
      field: 'allotment_date',
      newValue: null,
      reason:
        'allotment (2026-07-02) precedes close (2026-07-03) by one day; no corroborating source found, nulled per the write-path guard behavior',
    },
  ];

  for (const fix of dateFixes) {
    const before = await pool.query(
      `select id, slug, open_date, close_date, allotment_date, listing_date from ipos where slug = $1`,
      [fix.slug]
    );
    if (before.rows.length === 0) {
      console.log(`  SKIP ${fix.slug}: not found`);
      continue;
    }
    const row = before.rows[0];
    ledger.push({ case: 'date-repair', slug: fix.slug, field: fix.field, before: row, newValue: fix.newValue, reason: fix.reason });
    console.log(`  ${APPLY ? 'UPDATE' : 'would update'}: ${fix.slug}.${fix.field} -> ${fix.newValue} (${fix.reason})`);
    if (APPLY) {
      await pool.query(`update ipos set ${fix.field} = $1, updated_at = now() where id = $2`, [fix.newValue, row.id]);
    }
  }

  // --- Lead managers (P2-8) ---
  {
    const slug = 'tempsens-instruments-india-ltd';
    const before = await pool.query(`select id, slug, lead_managers from ipos where slug = $1`, [slug]);
    if (before.rows.length > 0) {
      const row = before.rows[0];
      const cleaned = sanitizeLeadManagers(row.lead_managers);
      ledger.push({
        case: 'lead-managers-repair',
        slug,
        before: row.lead_managers,
        after: cleaned,
        reason: 'sanitizeLeadManagers strips the tab-split compliance-contact block, keeping the one real BRLM name',
      });
      console.log(`  ${APPLY ? 'UPDATE' : 'would update'}: ${slug}.lead_managers -> ${JSON.stringify(cleaned)}`);
      if (APPLY) {
        await pool.query(`update ipos set lead_managers = $1::jsonb, updated_at = now() where id = $2`, [
          JSON.stringify(cleaned),
          row.id,
        ]);
      }
    } else {
      console.log(`  SKIP ${slug}: not found`);
    }
  }

  writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
  console.log(`\nledger written: ${LEDGER_PATH} (${ledger.length} entries)`);
  if (!APPLY) console.log('\nDRY-RUN: re-run with --apply to write.');

  console.log('='.repeat(80));
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error('dates/lead_managers repair crashed:', e);
  process.exit(1);
});
