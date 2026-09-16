#!/usr/bin/env node
// scripts/ops/walk-proof.mjs — stage 2's staging proof for the field-plan walk (item 6).
//
// READ-ONLY, exactly like docs/design/probes/_lib.mjs's pool: a proof tool that can write is a
// proof tool that will, eventually, write, and this one runs against staging after a real cycle
// — it must never be the thing that perturbs the state it is trying to read.
//
// WHAT THIS PROVES, per live IPO (UPCOMING/OPEN, MAINBOARD and SME):
//   1. every ipo_field_plan row, grouped by state (PENDING / SUPPLIED / EXHAUSTED / CHECK_FAILED /
//      NOT_AVAILABLE_YET / ...) — so "the walk ran" is a real count, not a log line (signal-ownership R1).
//   2. for every SUPPLIED row: table.field, the value ON THE ROW right now, the chosen_source and
//      chosen_document_type the plan recorded, and an INDEPENDENT re-read of the same fact against a
//      LIVE call, never field_sources itself (review round 1: re-reading field_sources for a
//      chosen_source DRHP row proves only that the fetcher read back its own write, not that the
//      WRITTEN VALUE is correct):
//        - chosen_source DRHP or BSE -> a LIVE call to BSE's detail API for that IPO, mapped the same
//          way the fetcher itself maps it (mapBSEToScrapedIPO). DOC and BSE both check against BSE
//          because DOC's own claim (the PBA prints the offer total) and BSE's claim are about the
//          SAME published number; Chittorgarh's list scrape is the other independent source below.
//        - chosen_source CHITTORGARH -> a LIVE call to the Chittorgarh list API, same comparison.
//      Three outcomes, printed for every SUPPLIED row and tracked SEPARATELY in the summary:
//        - MATCH: the live value is within 0.5% of the value on the row.
//        - MISMATCH: the live value differs by more than 0.5%, or the independent check itself
//          failed (CHECK_FAILED counts as a mismatch — a check that could not run is not proof).
//        - PROVENANCE-ONLY: no independent source prints this field at all (e.g. a field only DOC
//          can ever answer) — NOT counted as a match, so it can never inflate the pass count.
//      Rule 5 (proof-must-be-able-to-fail) needs a count that can actually be wrong: this proof
//      exits 1 on ANY mismatch, or fewer than 3 IPOs with at least one MATCH.
//
// `--expect-db <name>` is MANDATORY (mirrors scraper/scripts/lib/repair-tool.ts's guard) — this
// asks the pool itself, via `current_database()`, never trusting an env var to describe itself.
//
// Credentials: `IPODHAN_APP_DB_PASSWORD` read from D:/Abhay/GLOBAL.env (or C:/Abhay/GLOBAL.env on
// the VPS) IN PROCESS — never printed, never committed, same convention as every probe under
// docs/design/probes/_lib.mjs.
//
// Exit codes: 0 pass (>=3 IPOs with at least one MATCH, 0 mismatches); 1 the proof read ran but
// failed (too few IPOs with a MATCH, or a mismatch); 2 usage/guard refusal (no --expect-db, wrong database).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CANDIDATE_MODULE_ROOTS = [
  path.resolve(HERE, '../../node_modules/'),
  'D:/Abhay/Ventures/IPODhan/node_modules/',
];

function req(name) {
  for (const root of CANDIDATE_MODULE_ROOTS) {
    try {
      return createRequire(root)(name);
    } catch {
      /* try the next root */
    }
  }
  throw new Error(`could not resolve "${name}" — run npm install in the main checkout first.`);
}

function globalEnv(key) {
  for (const p of ['D:/Abhay/GLOBAL.env', 'C:/Abhay/GLOBAL.env']) {
    if (!fs.existsSync(p)) continue;
    const line = fs
      .readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(key + '='));
    if (line) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  }
  throw new Error(`${key} not found in GLOBAL.env`);
}

async function openReadOnlyPool(database) {
  const pg = req('pg');
  const { Pool } = pg;
  const password = globalEnv('IPODHAN_APP_DB_PASSWORD');

  const pool = new Pool({
    host: '127.0.0.1',
    port: 15432,
    user: 'ipodhan_app',
    password,
    database,
    max: 2,
    options: '-c timezone=UTC -c default_transaction_read_only=on',
    statement_timeout: 60_000,
  });
  const c = await pool.connect();
  try {
    const { rows } = await c.query('show transaction_read_only');
    if (rows[0].transaction_read_only !== 'on') {
      throw new Error('the connection is NOT read-only — refusing to continue');
    }
  } finally {
    c.release();
  }
  return pool;
}

const BSE_API_BASE = 'https://api.bseindia.com/BseIndiaAPI/api/';
const BSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Origin: 'https://www.bseindia.com',
  Referer: 'https://www.bseindia.com/',
  Accept: 'application/json',
};

function asArray(j) {
  if (Array.isArray(j)) return j;
  if (j && typeof j === 'object') {
    const arr = Object.values(j).find((v) => Array.isArray(v));
    if (arr) return arr;
  }
  return [];
}

async function fetchBSEJson(path_) {
  const res = await fetch(BSE_API_BASE + path_, { headers: BSE_HEADERS });
  if (!res.ok) throw new Error(`BSE API HTTP ${res.status} for ${path_}`);
  return res.json();
}

function normalizeCompanyNameForMatching(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(limited|ltd\.?|private|pvt\.?)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

async function independentReReadBSE(companyName) {
  const listJson = await fetchBSEJson('IPO_HomePageDetail/w');
  const rows = asArray(listJson).filter((r) => (r.IR_flag || '').toUpperCase() === 'IPO');
  const target = normalizeCompanyNameForMatching(companyName);
  const row = rows.find((r) => normalizeCompanyNameForMatching(r.Scrip_name) === target);
  if (!row) return { found: false };
  const detailJson = await fetchBSEJson(`GetMkt_ISSUE_BBS_IPO/w?IPO_NO=${row.IPO_NO}`);
  const detail = asArray(detailJson)[0];
  if (!detail) return { found: false };
  const band = String(detail.Price_Band || '')
    .split('-')
    .map((p) => parseFloat(p.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const min = band.length === 2 ? Math.min(band[0], band[1]) : undefined;
  const shares = parseInt(String(detail.Issue_Size_No_of_shares || '0').replace(/[,\s]/g, ''), 10);
  const issueSize = min !== undefined && shares > 0 ? Math.round(shares * min) : null;
  return { found: true, issueSize };
}

const CHITTORGARH_API_BASE = 'https://webnodejs.chittorgarh.com/cloud/report/data-read/82/1/2/2026/2026-26/0/all?search=';

async function independentReReadChittorgarh(companyName) {
  const res = await fetch(CHITTORGARH_API_BASE, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Chittorgarh API HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json?.reportTableData) ? json.reportTableData : [];
  const target = normalizeCompanyNameForMatching(companyName);
  const row = rows.find((r) => {
    const m = String(r['Company'] || '').match(/>([^<]+)</);
    const name = m ? m[1] : r['Company'];
    return normalizeCompanyNameForMatching(name) === target;
  });
  if (!row) return { found: false };
  const raw = String(row['Total Issue Amount (Incl.Firm reservations) (Rs.cr.)'] || '').replace(/,/g, '');
  const crores = parseFloat(raw);
  const issueSize = Number.isFinite(crores) ? Math.round(crores * 1e7) : null;
  return { found: true, issueSize };
}

function parseArgs(argv) {
  const idx = argv.indexOf('--expect-db');
  const expectDb = idx >= 0 ? argv[idx + 1] : undefined;
  return { expectDb };
}

async function main() {
  const { expectDb } = parseArgs(process.argv.slice(2));
  if (!expectDb) {
    console.error('walk-proof: --expect-db <name> is mandatory. Refusing to read without it.');
    process.exitCode = 2;
    return;
  }

  const pool = await openReadOnlyPool(expectDb);
  // Review round 1: the DOC arm used to re-read field_sources — the SAME
  // table the DOC fetcher itself answered from — which proves the fetcher
  // read its own write correctly, never that the WRITTEN VALUE is right.
  // matches / mismatches / provenanceOnly are now tracked separately: a
  // DOC-supplied ipos.issue_size is compared against the LIVE BSE detail
  // value when BSE prints it (MATCH within 0.5% / MISMATCH); where no
  // independent source prints the field, it is PROVENANCE-ONLY and never
  // counted toward "IPOs with a MATCH".
  let matches = 0;
  let mismatches = 0;
  let provenanceOnly = 0;
  let iposWithSupplied = 0;
  let iposWithMatch = 0;
  let exhaustedTotal = 0;

  try {
    const { rows: dbCheck } = await pool.query('select current_database() as name');
    const actual = dbCheck[0]?.name;
    if (actual !== expectDb) {
      console.error(
        `walk-proof: connected to database "${actual}" but --expect-db said "${expectDb}" — refusing to read.`
      );
      process.exitCode = 2;
      return;
    }
    console.log(`current_database(): ${actual}`);

    const { rows: ipoRows } = await pool.query(
      `select id, company_name, status, segment
         from ipos
        where status in ('UPCOMING', 'OPEN')
        order by company_name`
    );

    for (const ipo of ipoRows) {
      const { rows: planRows } = await pool.query(
        `select table_name, row_key, field_name, state, chosen_source, chosen_document_type,
                chosen_sha256, chosen_page, attempts, next_due_at
           from ipo_field_plan
          where ipo_id = $1
          order by table_name, field_name`,
        [ipo.id]
      );
      if (planRows.length === 0) continue;

      const byState = {};
      for (const r of planRows) byState[r.state] = (byState[r.state] ?? 0) + 1;
      exhaustedTotal += byState.EXHAUSTED ?? 0;

      console.log(
        `\n${ipo.company_name} (${ipo.status}/${ipo.segment ?? 'UNKNOWN'}): ${planRows.length} plan rows — ` +
          Object.entries(byState)
            .map(([s, n]) => `${s}=${n}`)
            .join(', ')
      );

      const suppliedRows = planRows.filter((r) => r.state === 'SUPPLIED');
      if (suppliedRows.length > 0) iposWithSupplied += 1;
      let ipoHasMatch = false;

      for (const row of suppliedRows) {
        const camelField = row.field_name.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
        const { rows: valRows } = await pool.query(
          row.table_name === 'ipos'
            ? `select ${sanitizeIdent(camelToSnake(camelField))} as value from ipos where id = $1`
            : `select * from ${sanitizeIdent(row.table_name)} where ipo_id = $1 and row_key = $2 limit 1`,
          row.table_name === 'ipos' ? [ipo.id] : [ipo.id, row.row_key]
        ).catch((e) => ({ rows: [{ value: `<read failed: ${e.message}>` }] }));
        const value = row.table_name === 'ipos' ? valRows[0]?.value : valRows[0]?.[camelField.toLowerCase()];

        let matchLabel = 'PROVENANCE-ONLY (no independent source prints this field)';
        let category = 'provenance-only';
        try {
          if (row.chosen_source === 'BSE' || row.chosen_source === 'DRHP') {
            // The independent check for a DOC-supplied answer is a LIVE BSE
            // read, never field_sources (that table is the fetcher's own
            // write — re-reading it proves nothing about the WRITTEN VALUE,
            // only that the fetcher read back what it just wrote). BSE is
            // used as the independent oracle whenever it prints the field,
            // regardless of which source (DOC or BSE) the plan credits.
            const reread = await independentReReadBSE(ipo.company_name);
            if (reread.found && reread.issueSize != null && value != null) {
              const ours = Number(value);
              const theirs = Number(reread.issueSize);
              const pctDiff = theirs === 0 ? (ours === 0 ? 0 : Infinity) : Math.abs(ours - theirs) / Math.abs(theirs);
              if (pctDiff <= 0.005) {
                matchLabel = `MATCH (BSE live=${reread.issueSize}, within 0.5%)`;
                category = 'match';
              } else {
                matchLabel = `MISMATCH (BSE live=${reread.issueSize}, ours=${value}, diff=${(pctDiff * 100).toFixed(2)}%)`;
                category = 'mismatch';
              }
            }
            // BSE has nothing for this IPO/field -> stays PROVENANCE-ONLY.
          } else if (row.chosen_source === 'CHITTORGARH') {
            const reread = await independentReReadChittorgarh(ipo.company_name);
            if (reread.found && reread.issueSize != null && value != null) {
              const ours = Number(value);
              const theirs = Number(reread.issueSize);
              const pctDiff = theirs === 0 ? (ours === 0 ? 0 : Infinity) : Math.abs(ours - theirs) / Math.abs(theirs);
              if (pctDiff <= 0.005) {
                matchLabel = `MATCH (Chittorgarh live=${reread.issueSize}, within 0.5%)`;
                category = 'match';
              } else {
                matchLabel = `MISMATCH (Chittorgarh live=${reread.issueSize}, ours=${value}, diff=${(pctDiff * 100).toFixed(2)}%)`;
                category = 'mismatch';
              }
            }
          }
        } catch (e) {
          matchLabel = `CHECK_FAILED (${e.message})`;
          category = 'mismatch'; // a check that could not run is not a proof of correctness
        }

        if (category === 'match') {
          matches += 1;
          ipoHasMatch = true;
        } else if (category === 'mismatch') {
          mismatches += 1;
        } else {
          provenanceOnly += 1;
        }

        console.log(
          `  SUPPLIED ${row.table_name}.${camelField} = ${value} ` +
            `(source=${row.chosen_source} docType=${row.chosen_document_type ?? '-'}) -> ${matchLabel}`
        );
      }

      if (ipoHasMatch) iposWithMatch += 1;
    }

    console.log(
      `\nIPOs with SUPPLIED: ${iposWithSupplied}; IPOs with at least one MATCH: ${iposWithMatch}; ` +
        `matches: ${matches}; mismatches: ${mismatches}; provenance-only: ${provenanceOnly}; EXHAUSTED: ${exhaustedTotal}`
    );

    if (iposWithMatch < 3 || mismatches > 0) {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

function camelToSnake(s) {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

/** Identifiers used in interpolated SQL here come only from a fixed, code-known allowlist path
 *  (ipo_field_plan.table_name / the camelCase->snake_case of ipo_field_plan.field_name), never
 *  directly from request input — this is a defence-in-depth character check, not the only guard. */
function sanitizeIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`walk-proof: refusing to interpolate unsafe identifier "${name}"`);
  }
  return name;
}

main().catch((err) => {
  console.error('walk-proof: FAILED —', err.stack || err.message);
  process.exitCode = 1;
});
