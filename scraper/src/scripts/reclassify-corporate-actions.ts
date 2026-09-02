/**
 * Reclassify corporate actions misclassified as IPOs (de-pollute IPO listings)
 *
 * Root cause: sources like Moneycontrol/Chittorgarh/fallback default `offering_type`
 * to 'IPO' without checking. BSE's public-issues JSON API (`IPO_HomePageDetail/w`)
 * is the AUTHORITATIVE classifier via `IR_flag`: takeover open offers (OTB/Takeover),
 * buybacks (OTB/Buyback), debt (DPI), and rights (RI) are NOT IPOs. Today ~12 of 14
 * current BSE "issues" (SARDA PROTEINS, WIPRO, RESTAURANT BRANDS, …) are corporate
 * actions polluting the IPO calendar.
 *
 * This script matches our OPEN/UPCOMING IPOs to the live BSE IR_flag (by normalized
 * name) and corrects `offering_type` so non-IPO corporate actions drop out of IPO
 * listings (the listing services filter `offeringType IN ('IPO')`). `last_manual_edit_at`
 * is stamped so the authoritative correction is protected from being re-polluted.
 *
 * NOTE: this is an ADMIN-tier classification correction (a one-field authoritative fix),
 * not scraped-data ingestion — so it writes a direct, audited UPDATE rather than going
 * through the scraper consolidation path. Dry-run by default; `--execute` to write.
 *
 * Run against prod via tunnel:
 *   cd scraper && DATABASE_URL='postgresql://...@localhost:15432/ipodhan' npx tsx src/scripts/reclassify-corporate-actions.ts            # dry-run
 *   cd scraper && DATABASE_URL='postgresql://...@localhost:15432/ipodhan' npx tsx src/scripts/reclassify-corporate-actions.ts --execute  # write
 */

import { Client } from 'pg';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { detectOfferingTypeFromBSEIRFlag, NON_IPO_UNMAPPED_SENTINEL } from '../utils/detect-offering-type.js';
import logger from '../utils/logger.js';

const BSE_API = 'https://api.bseindia.com/BseIndiaAPI/api/IPO_HomePageDetail/w';
const BSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
  Origin: 'https://www.bseindia.com',
  Referer: 'https://www.bseindia.com/',
};

interface BSEPublicIssueRow {
  Scrip_name: string;
  IR_flag: string;
  IR_FLAG_FULL: string;
  Scrip_cd: number;
}

async function fetchBSEPublicIssues(): Promise<BSEPublicIssueRow[]> {
  const res = await fetch(BSE_API, { headers: BSE_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`BSE API HTTP ${res.status}`);
  const json = (await res.json()) as { Table?: BSEPublicIssueRow[] };
  return json.Table ?? [];
}

async function main() {
  const execute = process.argv.includes('--execute');
  console.log(`\n=== Reclassify corporate-actions (${execute ? 'EXECUTE' : 'DRY-RUN'}) ===\n`);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required (point it at the tunnel: localhost:15432)');
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  await client.connect();

  try {
    const bseRows = await fetchBSEPublicIssues();
    logger.info({ count: bseRows.length }, 'Fetched BSE public-issues board');

    const byName = new Map<string, BSEPublicIssueRow>();
    for (const r of bseRows) byName.set(normalizeCompanyNameForMatching(r.Scrip_name), r);

    const { rows: candidates } = await client.query<{ id: string; company_name: string }>(
      `SELECT id, company_name FROM ipos
         WHERE status IN ('OPEN','UPCOMING') AND offering_type = 'IPO'`
    );

    const planned: Array<{ name: string; to: string; flag: string }> = [];
    const unknown: Array<{ name: string; flag: string }> = [];
    let unmatched = 0;

    for (const ipo of candidates) {
      const match = byName.get(normalizeCompanyNameForMatching(ipo.company_name));
      if (!match) {
        unmatched++;
        continue;
      }
      const correct = detectOfferingTypeFromBSEIRFlag(match.IR_flag, match.IR_FLAG_FULL);
      if (correct === NON_IPO_UNMAPPED_SENTINEL) {
        // Confirmed non-IPO (e.g. CMN — Call Money Notice) but no matching enum
        // value to write — flag for manual review rather than guessing a category.
        unknown.push({ name: ipo.company_name, flag: `${match.IR_flag}/${match.IR_FLAG_FULL}` });
        continue;
      }
      if (correct !== 'IPO') {
        planned.push({ name: ipo.company_name, to: correct, flag: `${match.IR_flag}/${match.IR_FLAG_FULL}` });
        if (execute) {
          await client.query(
            `UPDATE ipos SET offering_type = $1, last_manual_edit_at = now(), updated_at = now() WHERE id = $2`,
            [correct, ipo.id]
          );
          logger.info({ ipoId: ipo.id, name: ipo.company_name, to: correct }, 'Reclassified corporate action out of IPO listings');
        }
      }
    }

    console.log(`Candidates (offering_type=IPO, current): ${candidates.length}`);
    console.log(`Unmatched on BSE board: ${unmatched}`);
    console.log(`\nReclassifications ${execute ? 'APPLIED' : 'PLANNED'} (${planned.length}):`);
    for (const p of planned) console.log(`  ${p.name.padEnd(34)} IPO -> ${p.to.padEnd(8)} [BSE ${p.flag}]`);
    if (unknown.length) {
      console.log(`\nUNKNOWN BSE flag (left unchanged, NEEDS REVIEW) (${unknown.length}):`);
      for (const u of unknown) console.log(`  ${u.name.padEnd(34)} [BSE ${u.flag}]`);
    }
    console.log(`\n${execute ? 'Done — corrections written.' : 'Dry-run only. Re-run with --execute to apply.'}\n`);
  } finally {
    await client.end().catch(() => {});
  }
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'reclassify-corporate-actions failed');
  process.exit(1);
});
