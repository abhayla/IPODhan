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

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

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

function main() {
  const resolved = resolveDatabaseUrl();
  if (!resolved) {
    console.log('assert-test-db-not-drifted: no DATABASE_URL (env var or scraper/.env.test) — nothing to check; the integration suite\'s own guard governs an unset database.');
    process.exit(0);
  }

  console.log(`assert-test-db-not-drifted: checking schema drift against ${resolved.source} before the seeded integration run...`);
  try {
    execFileSync('npx', ['tsx', path.join(REPO_ROOT, 'scripts', 'assert-schema-drift.ts'), resolved.url], { stdio: 'inherit' });
  } catch {
    console.error('');
    console.error('assert-test-db-not-drifted: REFUSING to run the integration suite — the schema drift printed above (from');
    console.error('npm run audit:schema-drift) means your local test database does not match the migration journal (#558).');
    console.error('Rebuild it with the documented recipe (docs/ops/prod-ops-recipes.md, "ipodhan_test" rebuild recipe):');
    console.error('  PW=$(grep "^IPODHAN_APP_DB_PASSWORD=" D:/Abhay/GLOBAL.env | cut -d= -f2- | tr -d \'"\')');
    console.error('  DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_test" psql "$DATABASE_URL" -c "\\');
    console.error('    DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;"');
    console.error('  cd web && DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_test" npm run db:migrate');
    process.exit(1);
  }
  console.log('assert-test-db-not-drifted: OK — schema matches the migration journal.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
