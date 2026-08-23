/**
 * P2-4 DATA repair (round-5 review, T-300): add the four registrars whose
 * names appear in `ipos.registrar` free text but have no row in the 15-row
 * `registrars` reference table — Maashitla Securities (24 IPOs), Mudra RTA
 * Ventures (3), Adroit Corporate Services (1), MCS Share Transfer Agent (1).
 * Without a row, `resolveRegistrarId` can never match these names no matter
 * how the matcher is extended.
 *
 * Maashitla and Mudra had a LIVE-VERIFIED self-service allotment tool
 * (HTTP 200, confirmed PAN/App-No/DP-ID lookup form) as of 2026-08-23 —
 * see D:\Abhay\GetWorkDone\evidence\2026-08-23-T-300\01-url-verification.md.
 * Adroit's site (adroitcorporate.com) returned HTTP 503 on every attempt
 * during this task (genuinely down, re-checked with browser-like headers,
 * not a bot block); MCS's site (mcsregistrars.com) is live but has no public
 * allotment sub-page — only regional-office admin logins. Both are inserted
 * `active: false` with `allotmentCheckUrl: null` rather than a fabricated or
 * dead URL; the web layer's graceful-degrade hides their CTA.
 *
 * Idempotent: matches by exact `name`, skips (no insert) if a row with that
 * name already exists. dry-run by default; --apply writes.
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');

interface NewRegistrar {
  name: string;
  shortName: string;
  website: string;
  allotmentCheckUrl: string | null;
  active: boolean;
  verifiedNote: string;
}

const NEW_REGISTRARS: NewRegistrar[] = [
  {
    name: 'Maashitla Securities Private Limited',
    shortName: 'Maashitla',
    website: 'https://maashitla.com',
    allotmentCheckUrl: 'https://maashitla.com/allotment-status/public-issues',
    active: true,
    verifiedNote: 'live-verified 200, PAN/DP-ID/App-No public-issue allotment lookup confirmed on page',
  },
  {
    name: 'Mudra RTA Ventures Private Limited',
    shortName: 'Mudra RTA',
    website: 'https://mudrarta.com',
    allotmentCheckUrl: 'https://mudrarta.com/display_ipo_rightissue_allotment.php',
    active: true,
    verifiedNote: 'live-verified 200, combined IPO/rights-issue allotment lookup form (Company/DPID-Client-ID/CAF/PAN) confirmed on page',
  },
  {
    name: 'Adroit Corporate Services Private Limited',
    shortName: 'Adroit',
    website: 'https://www.adroitcorporate.com',
    allotmentCheckUrl: null,
    active: false,
    verifiedNote: 'adroitcorporate.com returned HTTP 503 on every attempt during this task (2026-08-23, re-checked with browser headers) — genuinely down, not fabricating a URL; deactivated pending a working site',
  },
  {
    name: 'MCS Share Transfer Agent Limited',
    shortName: 'MCS',
    website: 'https://www.mcsregistrars.com',
    allotmentCheckUrl: null,
    active: false,
    verifiedNote: 'mcsregistrars.com homepage is live (200) but has no public self-service allotment page — only regional-office admin logins; deactivated rather than linking the homepage as a fake CTA',
  },
];

async function main() {
  console.log('='.repeat(80));
  console.log(`ADD MISSING REGISTRARS (P2-4, T-300, round-5) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const existing = await db.select({ name: schema.registrars.name }).from(schema.registrars);
  const existingNames = new Set(existing.map((r) => r.name));

  let inserted = 0;
  for (const r of NEW_REGISTRARS) {
    if (existingNames.has(r.name)) {
      console.log(`  SKIP (already exists): ${r.name}`);
      continue;
    }
    console.log(`  ${APPLY ? 'INSERT' : 'would insert'}: ${r.name} (active=${r.active})`);
    console.log(`      verified: ${r.verifiedNote}`);
    if (APPLY) {
      await db.insert(schema.registrars).values({
        name: r.name,
        shortName: r.shortName,
        website: r.website,
        allotmentCheckUrl: r.allotmentCheckUrl,
        active: r.active,
      });
      logger.info({ name: r.name, active: r.active }, 'registrar added (T-300)');
      inserted++;
    }
  }

  console.log(`\ncandidates: ${NEW_REGISTRARS.length} | inserted: ${inserted}`);
  if (!APPLY) console.log('\nDRY-RUN: re-run with --apply to write.');
  console.log('='.repeat(80));
  process.exit(0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'add-missing-registrars crashed');
  console.error(e);
  process.exit(1);
});
