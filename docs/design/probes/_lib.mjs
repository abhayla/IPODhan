// docs/design/probes/_lib.mjs — the shared half of every probe (OD-25).
//
// Three rules live here so no individual probe can forget one:
//   1. Every database pool is opened READ-ONLY and in UTC. The VPS is production; a probe that can
//      write is a probe that will, eventually, write.
//   2. Every fetch retries three times, two minutes apart, with a browser-like user agent, and then
//      RECORDS the failure. An unreachable source is recorded as unreachable, never invented.
//   3. Every payload is saved beside the probe with the URL it came from and the date it was
//      fetched, because that saved file — not the probe's console output — is the evidence.
//
// Dependencies: `pg` only, resolved from whichever checkout on this machine already has it. Probes
// never add a package (OD-25).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(HERE, 'fixtures');

const CANDIDATE_MODULE_ROOTS = [
  path.resolve(HERE, '../../../node_modules/'),
  'D:/Abhay/Ventures/IPODhan/node_modules/',
];

function req(name) {
  for (const root of CANDIDATE_MODULE_ROOTS) {
    try {
      return createRequire(root)(name);
    } catch { /* try the next root */ }
  }
  throw new Error(`could not resolve "${name}" from any known node_modules root. ` +
    `Probes never install packages; run npm install in the main checkout instead.`);
}

// ---------------------------------------------------------------------------
// Credentials. GLOBAL.env is the shared store and lives ABOVE every repo, so it
// is read, never copied.
// ---------------------------------------------------------------------------
export function globalEnv(key) {
  for (const p of ['D:/Abhay/GLOBAL.env', 'C:/Abhay/GLOBAL.env']) {
    if (!fs.existsSync(p)) continue;
    const line = fs.readFileSync(p, 'utf8').split(/\r?\n/).find((l) => l.startsWith(key + '='));
    if (line) return line.slice(key.length + 1).trim().replace(/^["']|["']$/g, '');
  }
  throw new Error(`${key} not found in GLOBAL.env`);
}

/**
 * A pool that cannot write. `default_transaction_read_only` is set on the server side of the
 * connection, so it holds even for a query this file never saw.
 */
export async function openReadOnlyPool(database = 'ipodhan') {
  const pg = req('pg');
  const { Pool } = pg;
  const password = globalEnv('IPODHAN_APP_DB_PASSWORD');

  // A `date` column comes back as a STRING, not a Date. (F-104, found 2026-09-09 by a walkthrough.)
  //
  // node-pg's default parser turns a bare `date` into a JavaScript Date at LOCAL midnight. Read
  // from an IST machine that is 2026-09-10T00:00+05:30, whose UTC form is 2026-09-09T18:30Z — so
  // every `.toISOString().slice(0,10)` in every probe printed the day BEFORE the real one. Every
  // date in both walkthroughs published this morning was one day early, and nothing noticed,
  // because a plausible date looks exactly like a correct one.
  //
  // 1082 is the `date` OID. Returning the raw 'YYYY-MM-DD' the server sent removes the timezone
  // from the question entirely, which is the only fix that cannot drift back.
  pg.types.setTypeParser(1082, (v) => v);
  const { Pool } = req('pg');
  const password = globalEnv('IPODHAN_APP_DB_PASSWORD');
  const pool = new Pool({
    host: 'localhost',
    port: 15432,
    user: 'ipodhan_app',
    password,
    database,
    max: 2,
    // UTC, and read-only for every transaction on this connection.
    options: '-c timezone=UTC -c default_transaction_read_only=on',
    statement_timeout: 60_000,
  });
  // Prove it: a probe that quietly had write access would be a lie in the evidence trail.
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

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------
export const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html;q=0.9, */*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Three attempts, spaced. Returns {ok, status, body, url, attempts, error} and NEVER throws for a
 * bad response — an unreachable source is a result, not a crash.
 * `spacingMs` defaults to two minutes per the contract; probes that fetch many URLs pass a shorter
 * spacing and say so in their own output.
 */
export async function fetchWithRetry(url, { headers = {}, spacingMs = 120_000, attempts = 3, timeoutMs = 45_000, cookieJar = null, binary = false } = {}) {
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const h = { ...BROWSER_HEADERS, ...headers };
      if (cookieJar && cookieJar.value) h.Cookie = cookieJar.value;
      const res = await fetch(url, { headers: h, signal: ac.signal, redirect: 'follow' });
      if (cookieJar) {
        const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
        if (set.length) cookieJar.value = set.map((c) => c.split(';')[0]).join('; ');
      }
      const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
      last = { ok: res.ok, status: res.status, body, url, attempts: i,
               contentType: res.headers.get('content-type') || '', size: body.length };
      if (res.ok) { clearTimeout(t); return last; }
    } catch (err) {
      last = { ok: false, status: 0, body: '', url, attempts: i, error: `${err.name}: ${err.message}` };
    } finally {
      clearTimeout(t);
    }
    if (i < attempts) await sleep(spacingMs);
  }
  return last;
}

// ---------------------------------------------------------------------------
// Saving evidence
// ---------------------------------------------------------------------------
export function saveFixture(relPath, content) {
  const full = path.join(FIXTURES, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' || Buffer.isBuffer(content)
    ? content : JSON.stringify(content, null, 2) + '\n');
  return path.relative(HERE, full).split(path.sep).join('/');
}

export function saveOutput(probeName, obj) {
  const full = path.join(HERE, `${probeName}.out.json`);
  fs.writeFileSync(full, JSON.stringify(obj, null, 2) + '\n');
  return path.basename(full);
}

export const nowStamp = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Saying WHY something failed
// ---------------------------------------------------------------------------
/**
 * A human-readable cause for any error, including the ones whose `.message` is empty.
 *
 * WHY THIS EXISTS. On 2026-09-09 `duplicate-scan.mjs` recorded `"unreachable on 2026-09-09 — "`
 * with nothing after the dash, and the run could not tell a dead tunnel from a wrong password
 * without re-running it. The cause was a Node `AggregateError` from `pg-pool`: its `.message` is
 * the empty string and the real information lives in `.code` and `.errors[0]`. A failure that
 * cannot be classified from its log line is a defect of the LOGGER, not of the reader
 * (`.claude/rules/signal-ownership.md` R6), so every probe reports through this.
 */
export function causeOf(err) {
  if (!err) return 'unknown (no error object)';
  const bits = [];
  if (err.code) bits.push(String(err.code));
  if (err.message) bits.push(err.message);
  const inner = Array.isArray(err.errors) ? err.errors : (err.cause ? [err.cause] : []);
  for (const e of inner.slice(0, 3)) {
    const s = [e && e.code, e && e.message].filter(Boolean).join(' ');
    if (s) bits.push(`<- ${s}`);
  }
  if (!bits.length) bits.push(err.constructor ? err.constructor.name : String(err));
  return bits.join(' ');
}
