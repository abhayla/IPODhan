/**
 * P1-2 DATA repair (round-5 review, T-300): refresh the 15-row `registrars`
 * table with LIVE-VERIFIED allotment-check URLs.
 *
 * Round-5 evidence: 13 of 15 URLs were dead (404/406/444/no-resolve),
 * including linkintime.co.in — Link Intime India rebranded to MUFG Intime
 * India in 2023 and now serves allotment checks from in.mpms.mufg.com.
 * Every replacement URL below was live-fetched (HTTP 200) and its page
 * content confirmed to be a real PAN/application-number/DP-ID allotment
 * lookup tool during this task — see
 * D:\Abhay\GetWorkDone\evidence\2026-08-23-T-300\01-url-verification.md
 * for the fetch log. Two registrars (Beacon Trusteeship, VCCIPL) and one of
 * the missing four (see add-missing-registrars-t300.ts: Adroit, MCS) had NO
 * live self-service allotment tool found — those are set `active: false`
 * rather than pointing users at a broken or non-existent portal; the web
 * layer's graceful-degrade (T-300) hides the CTA for inactive/unhealthy
 * registrars instead of rendering a dead link.
 *
 * MUST NOT rename the "Link Intime India Pvt Ltd" row to "MUFG Intime India"
 * — `registrar-matcher.ts`'s alias table maps NEW-name inputs onto the OLD
 * row name; renaming the row would break matching for historical scraped
 * rows still labeled "Link Intime" (see registrar-matcher.ts REGISTRAR_ALIASES).
 * Only the URL/website change; name and shortName stay as-is.
 *
 * Idempotent (matches by current name, upserts allotmentCheckUrl/website/
 * active only when they differ) and backup-first: writes the pre-image of
 * every touched row to evidence/registrars-backup-*.json before any UPDATE.
 *
 * dry-run by default; --apply writes. Run from scraper/ with tunnel env
 * exported (DATABASE_HOST=127.0.0.1 PORT=15432 ipodhan_app creds).
 */
import { db } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import logger from '../src/utils/logger.js';

const APPLY = process.argv.includes('--apply');
const EVIDENCE_DIR =
  process.env.T300_EVIDENCE_DIR ?? 'D:\\Abhay\\GetWorkDone\\evidence\\2026-08-23-T-300';

interface UrlRefresh {
  name: string; // must match registrars.name exactly (case-sensitive)
  allotmentCheckUrl: string | null; // null clears the CTA (graceful degrade)
  website?: string;
  active?: boolean;
  verifiedNote: string;
}

// Live-verified 2026-08-23 (see 01-url-verification.md for raw fetch evidence).
const REFRESHES: UrlRefresh[] = [
  {
    name: 'Abhipra Capital Limited',
    allotmentCheckUrl: 'https://www.abhipra.com/services/rta-services/running-ipo',
    verifiedNote: 'old /ipo-allotment path 404s; new RTA-services page confirmed live with a PAN/DP-ID/App-No allotment query tool',
  },
  {
    name: 'Alankit Assignments Limited',
    allotmentCheckUrl: 'https://ipo.alankit.com',
    verifiedNote: 'old /IPO/StatusCheck.aspx path 404s; ipo.alankit.com is the current public allotment portal (200)',
  },
  {
    name: 'Beacon Trusteeship Limited',
    allotmentCheckUrl: null,
    active: false,
    verifiedNote: 'old /ipo-allotment-status path 404s; beacontrustee.co.in is a debenture-trustee corporate site with NO allotment-check tool (Beacon Trusteeship IPO\'d itself in 2024 via registrar KFin) — 0 IPOs in ipos.registrar_id reference this row; deactivated rather than linking a fake CTA',
  },
  {
    name: 'Cameo Corporate Services Limited',
    allotmentCheckUrl: 'https://ipo.cameoindia.com/',
    verifiedNote: 'old /Ipoallotment.aspx path 404s (redirected to non-www); ipo.cameoindia.com is Cameo\'s current Angular "Cameo IPO Updates" app (200)',
  },
  {
    name: 'Integrated Registry Management Services Pvt Ltd',
    allotmentCheckUrl: 'https://ipostatus.integratedregistry.in/RegistrarsToSTANew.aspx',
    verifiedNote: 'old /ipo-status-check.aspx path 404s; ipostatus.integratedregistry.in confirmed live PAN/App-No/DP-ID IPO+debt allotment tool (200)',
  },
  {
    name: 'KFin Technologies Limited',
    allotmentCheckUrl: 'https://kosmic.kfintech.com/ipostatus/',
    verifiedNote: 'unchanged — live-verified 200',
  },
  {
    name: 'Link Intime India Pvt Ltd',
    allotmentCheckUrl: 'https://in.mpms.mufg.com/Initial_Offer/public-issues.html',
    website: 'https://in.mpms.mufg.com',
    verifiedNote: 'REBRAND: linkintime.co.in no longer resolves (Link Intime -> MUFG Intime India, 2023). New domain + allotment-status entry point confirmed live (200) with PAN/App-No/DP-ID lookup; row name/shortName intentionally left as "Link Intime" — see file header',
  },
  {
    name: 'Maheshwari Datamatics Pvt Ltd',
    allotmentCheckUrl: 'https://www.mdpl.in/ipo-allotment-status',
    verifiedNote: 'unchanged — live-verified 200',
  },
  {
    name: 'Mas Services Limited',
    allotmentCheckUrl: 'https://www.masserv.com/opt.asp',
    verifiedNote: 'old /ipo-status.aspx path 404s; /opt.asp confirmed live PAN/DP-ID allotment tool (200)',
  },
  {
    name: 'Niche Technologies Pvt Ltd',
    allotmentCheckUrl: null,
    active: false,
    verifiedNote: 'old /ipo_status.asp path 404s; nichetechpl.com has NO public self-service allotment tool — only a login-gated client portal (app.nichetechpl.com) requiring pre-existing credentials; deactivated rather than linking a login wall',
  },
  {
    name: 'Purva Sharegistry India Pvt Ltd',
    allotmentCheckUrl: 'https://www.purvashare.com/investor-service/ipo-query',
    verifiedNote: 'old /ipo-status path 404s; /investor-service/ipo-query confirmed live (200)',
  },
  {
    name: 'Satellite Corporate Services Pvt Ltd',
    allotmentCheckUrl: 'https://www.satellitecorporate.com/ipo-query.php',
    verifiedNote: 'old /ipo-status.aspx path 404d to an error page; /ipo-query.php confirmed live (200)',
  },
  {
    name: 'Skyline Financial Services Pvt Ltd',
    allotmentCheckUrl: 'https://www.skylinerta.com/display_ipo_rightissue_allotment.php',
    verifiedNote: 'old /ipo-status path 404s; /display_ipo_rightissue_allotment.php is the site\'s own "Check Allotment Status" link (200)',
  },
  {
    name: 'Venture Capital and Corporate Investments Pvt Ltd',
    allotmentCheckUrl: null,
    active: false,
    verifiedNote: 'old /ipo-allotment-status.php path 404s; vccipl.com has only a login-gated client portal (client.vccipl.com), no public self-service allotment tool — 0 IPOs reference this row; deactivated rather than linking a login wall',
  },
];

async function main() {
  console.log('='.repeat(80));
  console.log(`REGISTRAR URL REFRESH (P1-2, T-300, round-5) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const current = await db.select().from(schema.registrars);
  const byName = new Map(current.map((r) => [r.name, r]));

  const missing = REFRESHES.filter((r) => !byName.has(r.name));
  if (missing.length > 0) {
    console.error('FATAL: expected registrar rows not found (name mismatch?):');
    for (const m of missing) console.error(`  - ${m.name}`);
    process.exit(1);
  }

  const touched = REFRESHES.filter((r) => {
    const row = byName.get(r.name)!;
    return (
      row.allotmentCheckUrl !== r.allotmentCheckUrl ||
      (r.website !== undefined && row.website !== r.website) ||
      (r.active !== undefined && row.active !== r.active)
    );
  });

  if (touched.length > 0) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const backupPath = path.join(EVIDENCE_DIR, `registrars-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(current, null, 2));
    console.log(`Backup of all ${current.length} registrar rows written: ${backupPath}`);
  }

  let written = 0;
  for (const r of REFRESHES) {
    const row = byName.get(r.name)!;
    const changes: string[] = [];
    if (row.allotmentCheckUrl !== r.allotmentCheckUrl) {
      changes.push(`allotmentCheckUrl: "${row.allotmentCheckUrl}" -> "${r.allotmentCheckUrl}"`);
    }
    if (r.website !== undefined && row.website !== r.website) {
      changes.push(`website: "${row.website}" -> "${r.website}"`);
    }
    if (r.active !== undefined && row.active !== r.active) {
      changes.push(`active: ${row.active} -> ${r.active}`);
    }
    if (changes.length === 0) {
      console.log(`  OK (unchanged): ${r.name}`);
      continue;
    }
    console.log(`  ${APPLY ? 'WRITE' : 'would write'}: ${r.name}`);
    for (const c of changes) console.log(`      ${c}`);
    console.log(`      verified: ${r.verifiedNote}`);
    if (APPLY) {
      const update: Partial<typeof schema.registrars.$inferInsert> = {
        allotmentCheckUrl: r.allotmentCheckUrl,
        updatedAt: new Date(),
      };
      if (r.website !== undefined) update.website = r.website;
      if (r.active !== undefined) update.active = r.active;
      await db.update(schema.registrars).set(update).where(eq(schema.registrars.id, row.id));
      logger.info({ registrarId: row.id, name: r.name, changes }, 'registrar URL refreshed (T-300)');
      written++;
    }
  }

  console.log(`\ntouched: ${touched.length} | written: ${written}`);
  if (!APPLY) console.log('\nDRY-RUN: re-run with --apply to write.');
  console.log('='.repeat(80));
  process.exit(0);
}

main().catch((e) => {
  logger.error({ error: e instanceof Error ? e.message : String(e) }, 'registrar URL refresh crashed');
  console.error(e);
  process.exit(1);
});
