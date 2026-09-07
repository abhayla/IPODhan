/**
 * Repair: backfill `ipos.lead_managers` for every IPO the class in T-503 /
 * #416 hit — a BSE core-API payload that lists a lead manager, and a
 * `bse_payload_lead_manager_count` recorded for it, but `lead_managers` still
 * null/empty because `document-cycle.ts` used to discard the parsed names
 * after computing the count (fixed in `data-persister.ts`'s
 * `recordDiscoveredLeadManagers`, wired in `document-cycle.ts`). This repair
 * closes the gap for rows the fix landed too late to catch on their own next
 * cycle, and for IPOs that have since left the live document-discovery
 * window (CLOSED/LISTED beyond it) and would otherwise never get revisited.
 *
 * Class (all statuses/segments, prod + staging): every `ipos` row with
 * `bse_payload_lead_manager_count IS NOT NULL AND > 0` and
 * `(lead_managers IS NULL OR jsonb_array_length(lead_managers) = 0)`.
 *
 * Re-fetches BSE's core-API row live for each candidate (keyed by the
 * already-known `bse_ipo_no` — never re-resolves identity), applies the SAME
 * `parseBseParties` + `sanitizeLeadManagers` the write path uses, and writes
 * write-once (skips a row whose `lead_managers` was filled by ANYTHING
 * between the query and the write — read-modify-write is not atomic here by
 * design, since the write itself already re-checks emptiness is pointless
 * cheap insurance against a concurrent scraper cycle).
 *
 * Dry-run by default (`npx tsx scripts/repair-lead-managers-from-payload.ts`
 * with the tunnel env exported); `--apply` writes; `--allow-prod` required on
 * top of `--apply` against the `ipodhan` database (openRepairDb refuses
 * otherwise). Ledger written repo-relative to
 * `evidence/2026-09-08-T-503/lead-managers-repair-ledger.json` via
 * `repair-tool.ts`'s `writeLedgerFile`.
 */
import { Pool } from 'pg';
import { join } from 'node:path';
import { sanitizeLeadManagers } from '../src/utils/validators.js';
import { parseBseParties } from '../src/services/bse-party-parser.js';
import { recordDiscoveredLeadManagers } from '../src/services/data-persister.js';
import { db } from '@ipodhan/shared/db';
import { openRepairDb, writeLedgerFile, type ExecuteLike } from './lib/repair-tool.js';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Importing `db` above already runs `configureUtcTimestampParsing()` at
// module load (packages/shared/src/db/index.ts). Writes route through
// `recordDiscoveredLeadManagers` (data-persister.ts) — no IPORepository/redis
// needed here (that door owns its own field_sources + cache concerns).

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
// Repo-relative, not a hardcoded D:/ path (#417 round 2 MINOR): scripts/ ->
// repo root is two levels up.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LEDGER_PATH = join(REPO_ROOT, 'evidence', '2026-09-08-T-503', 'lead-managers-repair-ledger.json');

const BSE_API_BASE = 'https://api.bseindia.com/BseIndiaAPI/api/';
const BSE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Origin: 'https://www.bseindia.com',
  Referer: 'https://www.bseindia.com/',
  Accept: 'application/json',
};

const pool = new Pool({
  options: '-c timezone=UTC',
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME || 'ipodhan',
  user: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD,
});

// `db` (the shared drizzle handle, same DATABASE_HOST/PORT/NAME env as `pool`
// below) already implements ExecuteLike's `.execute(sql\`...\`)` natively —
// no raw-SQL forwarder needed for the guard.
const repairDbGuard: ExecuteLike = db;

async function fetchBseLeadManagers(ipoNo: number): Promise<string[] | null> {
  const url = `${BSE_API_BASE}GetMkt_ISSUE_BBS_IPO/w?IPO_NO=${ipoNo}`;
  const res = await fetch(url, { headers: BSE_HEADERS });
  if (!res.ok) {
    console.log(`  BSE fetch failed for IPO_NO=${ipoNo}: HTTP ${res.status}`);
    return null;
  }
  const body = (await res.json()) as { IPONO_0?: Array<Record<string, unknown>> };
  const row = body.IPONO_0?.[0];
  if (!row) return null;
  return parseBseParties(row as never).leadManagers;
}

async function main() {
  console.log('='.repeat(80));
  console.log(`LEAD MANAGERS FROM BSE PAYLOAD REPAIR (T-503 / #416) - ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('='.repeat(80));

  const ledger: unknown[] = [];

  const { dbName } = await openRepairDb(repairDbGuard, {
    apply: APPLY,
    allowProd: ALLOW_PROD,
    toolName: 'repair-lead-managers-from-payload',
  });

  const candidates = await pool.query(
    `select id, slug, company_name, status, segment, bse_ipo_no, lead_managers, bse_payload_lead_manager_count
       from ipos
      where bse_payload_lead_manager_count is not null
        and bse_payload_lead_manager_count > 0
        and (lead_managers is null or jsonb_array_length(lead_managers) = 0)
      order by company_name`
  );

  console.log(`DB=${dbName}. ${candidates.rows.length} candidate row(s) (class: BSE payload lists lead managers not stored).`);

  let wouldWrite = 0;
  let written = 0;
  let skippedNoIpoNo = 0;
  let skippedFetchFailed = 0;
  let skippedSanitizedEmpty = 0;

  for (const row of candidates.rows) {
    if (row.bse_ipo_no === null || row.bse_ipo_no === undefined) {
      console.log(`  SKIP ${row.slug}: no bse_ipo_no on file, cannot re-fetch the payload`);
      skippedNoIpoNo++;
      continue;
    }

    const rawNames = await fetchBseLeadManagers(Number(row.bse_ipo_no));
    if (rawNames === null) {
      skippedFetchFailed++;
      continue;
    }
    const sanitized = sanitizeLeadManagers(rawNames);
    if (!sanitized || sanitized.length === 0) {
      console.log(`  SKIP ${row.slug}: BSE payload re-fetch sanitized to nothing (raw: ${JSON.stringify(rawNames)})`);
      skippedSanitizedEmpty++;
      continue;
    }

    ledger.push({
      ipoId: row.id,
      slug: row.slug,
      companyName: row.company_name,
      status: row.status,
      segment: row.segment,
      bseIpoNo: row.bse_ipo_no,
      before: row.lead_managers,
      after: sanitized,
      bsePayloadLeadManagerCount: row.bse_payload_lead_manager_count,
    });
    wouldWrite++;
    console.log(`  ${APPLY ? 'UPDATE' : 'would update'}: ${row.slug} lead_managers -> ${JSON.stringify(sanitized)}`);

    if (APPLY) {
      // Sanctioned door: the SAME transactional, write-once, provenance-
      // tracking function the code fix added (data-persister.ts). Its WHERE
      // guard is evaluated by Postgres inside the UPDATE, so a concurrent
      // scraper cycle's write always wins over this repair — no separate
      // pre-read needed here.
      const { written: didWrite } = await recordDiscoveredLeadManagers(row.id, rawNames, 'BSE');
      if (didWrite) written++;
      else console.log(`    (no-op: ${row.slug}.lead_managers was filled concurrently — write-once guard held)`);
    }
  }

  console.log('-'.repeat(80));
  console.log(
    `Candidates: ${candidates.rows.length} | would-write/${APPLY ? 'written' : 'would-write'}: ${wouldWrite}${APPLY ? ` (${written} applied)` : ''} | ` +
      `skipped no bse_ipo_no: ${skippedNoIpoNo} | skipped fetch failed: ${skippedFetchFailed} | skipped sanitized empty: ${skippedSanitizedEmpty}`
  );

  writeLedgerFile(LEDGER_PATH, { apply: APPLY, dbName, generatedAt: new Date().toISOString(), ledger });
  console.log(`Ledger written: ${LEDGER_PATH}`);

  await pool.end();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
