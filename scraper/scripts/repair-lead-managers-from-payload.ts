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
 * otherwise). Ledger written to
 * `D:/Abhay/GetWorkDone/evidence/2026-09-08-T-503/lead-managers-repair-ledger.json`.
 */
import { Pool } from 'pg';
import { writeFileSync, mkdirSync } from 'node:fs';
import { sanitizeLeadManagers } from '../src/utils/validators.js';
import { parseBseParties } from '../src/services/bse-party-parser.js';
// T-503: `@ipodhan/shared/db` (the aggregator) conflicts with repair-tool.js's
// own `@ipodhan/shared/db/schema` import in this tsx/esbuild module graph —
// reproduced with repair-dates-and-leadmanagers-t299.ts too (pre-existing,
// not introduced here): "does not provide an export named
// configureUtcTimestampParsing" even though the export exists. The deep
// import below resolves straight to the same file without going through the
// aggregator and sidesteps it.
import { configureUtcTimestampParsing } from '@ipodhan/shared/db/timezone-config';
import { openRepairDb, type ExecuteLike } from './lib/repair-tool.js';
import { pathToFileURL } from 'node:url';

configureUtcTimestampParsing();

const APPLY = process.argv.includes('--apply');
const ALLOW_PROD = process.argv.includes('--allow-prod');
const LEDGER_DIR = 'D:/Abhay/GetWorkDone/evidence/2026-09-08-T-503';
const LEDGER_PATH = `${LEDGER_DIR}/lead-managers-repair-ledger.json`;

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

// Same drizzle-sql -> pg.query forwarder as repair-dates-and-leadmanagers-t299.ts
// (see that file's header for why a raw pg Pool is used here).
function mapSqlToPgQuery(query: unknown): { text: string; params: unknown[] } {
  const q = query as { queryChunks?: unknown[] } | undefined;
  if (!q || !Array.isArray(q.queryChunks)) {
    throw new Error(
      'repair-lead-managers-from-payload: cannot forward this query to pool.query() — expected a drizzle-orm sql`` object with .queryChunks, got: ' +
        JSON.stringify(query)
    );
  }
  let text = '';
  const params: unknown[] = [];
  for (const chunk of q.queryChunks) {
    if (typeof chunk === 'string') {
      text += chunk;
      continue;
    }
    const c = chunk as { value?: unknown } | undefined;
    if (c && Array.isArray(c.value)) {
      // drizzle-orm StringChunk: a raw SQL fragment, not a bound parameter.
      text += c.value.join('');
    } else if (c && 'value' in c) {
      // drizzle-orm Param: a bound parameter.
      params.push(c.value);
      text += `$${params.length}`;
    } else {
      throw new Error(
        `repair-lead-managers-from-payload: cannot forward unsupported SQL chunk to pool.query(): ${JSON.stringify(chunk)}`
      );
    }
  }
  return { text, params };
}

const repairDbGuard: ExecuteLike = {
  execute: async (query: unknown) => {
    const { text, params } = mapSqlToPgQuery(query);
    const result = await pool.query(text, params);
    return { rows: result.rows };
  },
};

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

  mkdirSync(LEDGER_DIR, { recursive: true });
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
      // Write-once, mirroring recordDiscoveredLeadManagers: re-check emptiness
      // at write time so a concurrent scraper cycle's write always wins.
      const result = await pool.query(
        `update ipos set lead_managers = $1::jsonb, updated_at = now()
          where id = $2 and (lead_managers is null or jsonb_array_length(lead_managers) = 0)`,
        [JSON.stringify(sanitized), row.id]
      );
      if (result.rowCount && result.rowCount > 0) written++;
      else console.log(`    (no-op: ${row.slug}.lead_managers was filled concurrently — write-once guard held)`);
    }
  }

  console.log('-'.repeat(80));
  console.log(
    `Candidates: ${candidates.rows.length} | would-write/${APPLY ? 'written' : 'would-write'}: ${wouldWrite}${APPLY ? ` (${written} applied)` : ''} | ` +
      `skipped no bse_ipo_no: ${skippedNoIpoNo} | skipped fetch failed: ${skippedFetchFailed} | skipped sanitized empty: ${skippedSanitizedEmpty}`
  );

  writeFileSync(LEDGER_PATH, JSON.stringify({ apply: APPLY, dbName, generatedAt: new Date().toISOString(), ledger }, null, 1));
  console.log(`Ledger written: ${LEDGER_PATH}`);

  await pool.end();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
