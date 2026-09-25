#!/usr/bin/env node
// #558 — refuse a local seeded integration run against a drifted local
// test database, instead of asking people to remember to check.
//
// WHAT HAPPENED: `ipodhan_test` (the one sanctioned local integration
// database, docs/ops/prod-ops-recipes.md) carried a hand-run, never-migrated
// `unique_field_source_per_ipo` constraint (4 columns: ipo_id, table_name,
// row_key, field_name) while every migration in the journal — and
// schema.ts — declared it with 3 (no row_key). A test went green locally
// and RED in CI (PR #556, run 34520175611) because the two runs were
// measuring two different schemas. `npm run audit:schema-drift` (this repo's
// existing drift assert, scripts/assert-schema-drift.ts) already covers this
// exact class — it checks unique-constraint column sets, not just column
// types — but it had never been made a PRECONDITION of a local integration
// run; it only ran in CI against a journal-replayed database.
//
// THIS SCRIPT wires that precondition. It is invoked as `pretest:integration`
// (npm's built-in pre<script> convention — runs automatically before
// `npm run test:integration`, so it cannot be skipped by forgetting a
// separate step) in both web/package.json and scraper/package.json.
//
// It resolves the same DATABASE_URL the integration suite itself will use
// (env var first, then scraper/.env.test — the one sanctioned local target,
// same file scraper/vitest.integration.config.ts already loads via
// dotenv), runs the existing assert-schema-drift.ts against it, and on any
// drift REFUSES with the constraint diff printed plus the rebuild recipe —
// never a generic "tests failed" message.
//
// If no DATABASE_URL resolves at all, this is a no-op (exit 0): a suite with
// no configured database has its own "no tests" skip behaviour
// (no-tests-exits-zero.md) — refusing here would be a NEW failure mode, not
// this issue's fix.
//
// ROUND 1 REVIEW (Tier B REVISE): the unconditional refusal above blocked
// EVERY local `test:integration` run the moment `ipodhan_test` carried any
// drift — measured 2026-09-25: 15 real findings on the shared box today,
// none of which a developer can fix without the owner's DB-change approval
// (no-new-databases.md / no-DB-change rule). A precondition that can never
// be satisfied without an approval nobody in the loop can grant is not a
// precondition, it is a lockout. `IPODHAN_ACCEPT_TEST_DB_DRIFT=1` is the
// fix: an explicit, never-silent override — every override run still
// prints every finding plus an "ACCEPTED DRIFT (override)" line to stderr,
// so a developer who sets it is choosing to proceed with eyes open, not
// hiding the drift.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

export const OVERRIDE_ENV_VAR = 'IPODHAN_ACCEPT_TEST_DB_DRIFT';

/**
 * Same resolution order the integration suites themselves rely on:
 * an explicit DATABASE_URL in the environment wins; otherwise fall back to
 * scraper/.env.test — the one file the sanctioned local recipe writes
 * (docs/ops/prod-ops-recipes.md), and the same file
 * scraper/vitest.integration.config.ts loads via dotenv for its own run.
 * Exported for the self-test.
 */
export function resolveDatabaseUrl(env = process.env, repoRoot = REPO_ROOT, readFile = readFileSync, exists = existsSync) {
  if (env.DATABASE_URL) return { url: env.DATABASE_URL, source: 'DATABASE_URL env var' };
  const envTestPath = path.join(repoRoot, 'scraper', '.env.test');
  if (exists(envTestPath)) {
    const text = readFile(envTestPath, 'utf8');
    const m = /^DATABASE_URL=(.+)$/m.exec(text);
    if (m) return { url: m[1].trim(), source: 'scraper/.env.test' };
  }
  return null;
}

/**
 * PURE decision: given whether the drift check found drift, the findings
 * text it printed, and whether the override env var is set, decide what to
 * print and what to exit with. No DB, no subprocess — the self-test injects
 * all three inputs directly. This is the whole class-level fix: a
 * three-way branch (no drift / drift+override / drift+no-override), never a
 * two-way "pass or refuse forever".
 */
export function decideOutcome({ hadDrift, findingsText, overrideSet }) {
  if (!hadDrift) {
    return { exitCode: 0, lines: ['assert-test-db-not-drifted: OK — schema matches the migration journal.'] };
  }

  const findingsBlock = (findingsText ?? '').trim() || '(no findings text captured — see the raw audit:schema-drift output above)';

  if (overrideSet) {
    return {
      exitCode: 0,
      lines: [
        '',
        `assert-test-db-not-drifted: schema drift detected, but ${OVERRIDE_ENV_VAR}=1 is set — proceeding anyway.`,
        findingsBlock,
        `ACCEPTED DRIFT (override): ${OVERRIDE_ENV_VAR}=1 accepted the drift above; this integration run continues against a local database that does NOT match the migration journal (#558).`,
      ],
    };
  }

  return {
    exitCode: 1,
    lines: [
      '',
      'assert-test-db-not-drifted: REFUSING to run the integration suite — the schema drift below means your local test',
      'database does not match the migration journal (#558):',
      findingsBlock,
      '',
      'Rebuild it with the documented recipe (docs/ops/prod-ops-recipes.md, "ipodhan_test" rebuild recipe):',
      '  PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d \'"\')',
      '  DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_test" psql "$DATABASE_URL" -c "\\',
      '    DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;"',
      '  cd web && DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_test" npm run db:migrate',
      '',
      `Or, if this drift is expected right now and you want to proceed anyway, set ${OVERRIDE_ENV_VAR}=1 — every run with it set`,
      'still prints every finding above plus an "ACCEPTED DRIFT (override)" line, so the override is never silent.',
    ],
  };
}

/** Runs the real, existing assert-schema-drift.ts and captures its output instead of streaming it, so decideOutcome() can quote the findings. */
function runDriftCheck(databaseUrl) {
  try {
    const stdout = execFileSync('npx', ['tsx', path.join(REPO_ROOT, 'scripts', 'assert-schema-drift.ts'), databaseUrl], { encoding: 'utf8' });
    return { hadDrift: false, findingsText: stdout };
  } catch (e) {
    const findingsText = [e.stdout, e.stderr].filter(Boolean).join('\n');
    return { hadDrift: true, findingsText };
  }
}

function main() {
  const resolved = resolveDatabaseUrl();
  if (!resolved) {
    console.log('assert-test-db-not-drifted: no DATABASE_URL (env var or scraper/.env.test) — nothing to check; the integration suite\'s own guard governs an unset database.');
    process.exit(0);
  }

  console.log(`assert-test-db-not-drifted: checking schema drift against ${resolved.source} before the seeded integration run...`);
  const { hadDrift, findingsText } = runDriftCheck(resolved.url);
  const outcome = decideOutcome({ hadDrift, findingsText, overrideSet: process.env[OVERRIDE_ENV_VAR] === '1' });
  const print = hadDrift ? console.error : console.log;
  for (const line of outcome.lines) print(line);
  process.exit(outcome.exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
