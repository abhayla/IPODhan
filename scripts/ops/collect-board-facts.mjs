#!/usr/bin/env node
// Measure the board's environment facts and write them, each with the moment
// it was measured and the command that measured it.
//
// WHY THIS EXISTS
//   The board's served sha, "since" date and migration counts were typed into
//   board-data.json on 2026-09-20 and never retyped, while the page was
//   republished seven times. Re-rendering stale input republishes stale facts,
//   and a byte-identical render looked like "nothing owed". A fact that can be
//   measured must be measured; this script is the only writer of those facts.
//
// WHAT IT MEASURES (read-only everywhere)
//   prod / staging served release   ssh rfp-vps: readlink -f of the `current`
//                                    symlinks, the symlink's own mtime (the
//                                    moment the slot switched = serving since),
//                                    and DEPLOYED_SHA-<slot> as a cross-check.
//   migrations applied per DB       count(*) from drizzle.__drizzle_migrations
//                                    on `ipodhan` and `ipodhan_staging` through
//                                    the tunnel localhost:15432, session
//                                    read-only, pool pinned to UTC.
//   migrations on main              entries in _journal.json at
//                                    refs/remotes/origin/main (the explicit
//                                    remote ref; a local branch named
//                                    origin/main has shadowed it before).
//
// FAILURE IS WRITTEN, NEVER PAPERED OVER
//   A probe that fails writes {value: null, error: "<cause>"}. An old value is
//   never carried forward: the renderer shows "unmeasured — <cause>".
//
// USAGE
//   node scripts/ops/collect-board-facts.mjs            # write measured-facts.json
//   node scripts/ops/collect-board-facts.mjs --stdout   # print, write nothing
//   Needs: ssh alias rfp-vps (BatchMode), the DB tunnel on 15432, and
//   IPODHAN_APP_DB_PASSWORD in the env or in D:/Abhay/GLOBAL.env.
//   Then: node scripts/ops/render-board.mjs

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
export const FACTS_PATH = join(REPO_ROOT, 'docs/design/board/measured-facts.json');

const SLOTS = {
  prod: { link: '/var/www/ipodhan/current', shaFile: '/var/www/ipodhan/DEPLOYED_SHA-prod', db: 'ipodhan' },
  staging: { link: '/var/www/ipodhan/current-staging', shaFile: '/var/www/ipodhan/DEPLOYED_SHA-staging', db: 'ipodhan_staging' },
};

/** Parse `.../releases/20260907-170024-f0c66b6b` -> { sha: 'f0c66b6b' }. */
export function parseReleaseDir(path) {
  const m = /\/\d{8}-\d{6}-([0-9a-f]{7,40})$/.exec(String(path).trim());
  return m ? { sha: m[1] } : null;
}

const fact = (value, command, error) =>
  error ? { value: null, measured_at: new Date().toISOString(), command, error: String(error) }
        : { value, measured_at: new Date().toISOString(), command };

const errText = (e) => {
  const msg = (e && (e.stderr?.toString().trim() || e.message)) || String(e);
  const cause = e?.cause ? ` (cause: ${e.cause.code || ''} ${e.cause.message || e.cause})` : '';
  return (msg + cause).split('\n')[0].slice(0, 300);
};

function measureVps(out) {
  // One ssh round-trip; every command read-only.
  const remote = Object.entries(SLOTS).map(([slot, s]) =>
    `echo "${slot} $(readlink -f ${s.link}) $(stat -c %Y ${s.link}) $(cat ${s.shaFile} 2>/dev/null | tr -d '[:space:]')"`).join('; ');
  const command = `ssh -o BatchMode=yes -o ConnectTimeout=15 rfp-vps '${remote}'`;
  let text;
  try {
    text = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'rfp-vps', remote],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 45000 });
  } catch (e) {
    for (const slot of Object.keys(SLOTS)) {
      out[`${slot}.sha`] = fact(null, command, errText(e));
      out[`${slot}.since`] = fact(null, command, errText(e));
    }
    return;
  }
  for (const slot of Object.keys(SLOTS)) {
    const line = text.split('\n').find((l) => l.startsWith(slot + ' '));
    const [, dir, mtime, shaFile] = (line || '').trim().split(/\s+/);
    const parsed = dir ? parseReleaseDir(dir) : null;
    if (!parsed) {
      out[`${slot}.sha`] = fact(null, command, `no release dir parsed from "${line || '(no line)'}"`);
    } else if (shaFile && !parsed.sha.startsWith(shaFile) && !shaFile.startsWith(parsed.sha)) {
      out[`${slot}.sha`] = fact(null, command, `served dir says ${parsed.sha} but DEPLOYED_SHA-${slot} says ${shaFile}`);
    } else {
      out[`${slot}.sha`] = fact(parsed.sha, command);
    }
    const epoch = Number(mtime);
    out[`${slot}.since`] = Number.isFinite(epoch) && epoch > 0
      ? fact(new Date(epoch * 1000).toISOString(), command + '  # mtime of the slot symlink = when it switched')
      : fact(null, command, `no symlink mtime in "${line || '(no line)'}"`);
  }
}

function readPassword() {
  if (process.env.IPODHAN_APP_DB_PASSWORD) return process.env.IPODHAN_APP_DB_PASSWORD;
  const envFile = 'D:/Abhay/GLOBAL.env';
  if (!existsSync(envFile)) return null;
  const line = readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('IPODHAN_APP_DB_PASSWORD='));
  return line ? line.slice('IPODHAN_APP_DB_PASSWORD='.length).trim().replace(/^["']|["']$/g, '') : null;
}

async function measureDbs(out) {
  const sql = 'select count(*)::int as n from drizzle.__drizzle_migrations';
  const password = readPassword();
  let pgUtc;
  try {
    pgUtc = await import('../lib/pg-utc.mjs');
  } catch (e) {
    for (const [slot, s] of Object.entries(SLOTS))
      out[`${slot}.migrations_applied`] = fact(null, `${s.db}: ${sql}`, `cannot load pg: ${errText(e)}`);
    return;
  }
  pgUtc.installUtcTimestampParsing();
  for (const [slot, s] of Object.entries(SLOTS)) {
    const command = `psql -h localhost -p 15432 -U ipodhan_app -d ${s.db} (read-only session): ${sql}`;
    if (!password) { out[`${slot}.migrations_applied`] = fact(null, command, 'IPODHAN_APP_DB_PASSWORD not in env or D:/Abhay/GLOBAL.env'); continue; }
    const pool = pgUtc.createUtcPool({
      host: 'localhost', port: 15432, user: 'ipodhan_app', password, database: s.db,
      max: 1, connectionTimeoutMillis: 10000,
    });
    try {
      const client = await pool.connect();
      try {
        await client.query('SET default_transaction_read_only = on');
        const { rows } = await client.query(sql);
        out[`${slot}.migrations_applied`] = fact(rows[0].n, command);
      } finally { client.release(); }
    } catch (e) {
      out[`${slot}.migrations_applied`] = fact(null, command, errText(e));
    } finally {
      await pool.end().catch(() => {});
    }
  }
}

function measureJournal(out) {
  const ref = 'refs/remotes/origin/main';
  const command = `git show ${ref}:web/drizzle/migrations/meta/_journal.json  # count entries`;
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=8', ref], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const journal = JSON.parse(execFileSync('git', ['show', `${ref}:web/drizzle/migrations/meta/_journal.json`],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
    out['main.migrations'] = fact(journal.entries.length, `${command} (origin/main at ${sha})`);
  } catch (e) {
    out['main.migrations'] = fact(null, command, errText(e));
  }
}

async function main() {
  const facts = {};
  measureVps(facts);
  await measureDbs(facts);
  measureJournal(facts);
  const doc = {
    _comment: 'Written ONLY by scripts/ops/collect-board-facts.mjs. Never hand-edit: a typed value here is the drift this file exists to stop. A null value carries the error that prevented measuring it.',
    collected_at: new Date().toISOString(),
    facts,
  };
  const text = JSON.stringify(doc, null, 2) + '\n';
  if (process.argv.includes('--stdout')) { process.stdout.write(text); return; }
  writeFileSync(FACTS_PATH, text);
  const failed = Object.entries(facts).filter(([, f]) => f.value === null);
  console.log(`written ${FACTS_PATH}: ${Object.keys(facts).length} facts, ${failed.length} unmeasured`);
  for (const [k, f] of Object.entries(facts)) console.log(`  ${k} = ${f.value === null ? 'null — ' + f.error : f.value}`);
  // Exit 0 even with unmeasured facts: the page then SAYS unmeasured, which is
  // the honest outcome. Exit 2 only so a caller can tell something was missing.
  if (failed.length) process.exitCode = 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error('collect-board-facts: ' + errText(e)); process.exit(1); });
}
