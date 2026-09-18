// #762 (S8) review round 2 MAJOR-1: the round-1 comment at
// packages/shared/src/db/schema.ts claimed "A test in the repository pins
// them equal so a change to one without the other fails CI instead of
// silently degrading the plan back to a Seq Scan." No such test existed —
// three copies of the value `5` (FIELD_PLAN_RECLAIM_MAX_ATTEMPTS in the TS
// repository, the `attempts < 5` literal in the schema.ts partial-index
// predicate, PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS in the mjs detection
// check) were never compared to each other. This is the SAME class MAJOR-3
// was last round (a comment claiming a guard that does not exist); fixed
// the same way — parse the REAL source files, never a copy typed a fourth
// time inside this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS } from '../lib/field-plan-slot.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPOSITORY_TS_PATH = join(
  REPO_ROOT,
  'packages',
  'shared',
  'src',
  'repositories',
  'ipo-field-plan-repository.ts'
);
const SCHEMA_TS_PATH = join(REPO_ROOT, 'packages', 'shared', 'src', 'db', 'schema.ts');

function parseTsConstant(source, name) {
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)\\s*;`));
  assert.ok(match, `${name} not found in the real source — the drift guard cannot verify anything`);
  return Number(match[1]);
}

function parseSchemaPartialIndexAttemptsLiteral(source) {
  // The exact predicate text: `${table.state} = 'CHECK_FAILED' AND ${table.attempts} < 5`
  const match = source.match(/CHECK_FAILED'\s*AND\s*\$\{table\.attempts\}\s*<\s*(\d+)/);
  assert.ok(match, "CHECK_FAILED partial-index attempts literal not found in schema.ts's real source");
  return Number(match[1]);
}

test('(constant pin, MAJOR-1) FIELD_PLAN_RECLAIM_MAX_ATTEMPTS (TS) equals the real schema.ts partial-index literal', () => {
  const repoSource = readFileSync(REPOSITORY_TS_PATH, 'utf8');
  const schemaSource = readFileSync(SCHEMA_TS_PATH, 'utf8');
  const tsConstant = parseTsConstant(repoSource, 'FIELD_PLAN_RECLAIM_MAX_ATTEMPTS');
  const schemaLiteral = parseSchemaPartialIndexAttemptsLiteral(schemaSource);
  assert.equal(
    schemaLiteral,
    tsConstant,
    `schema.ts's partial-index predicate (attempts < ${schemaLiteral}) has drifted from FIELD_PLAN_RECLAIM_MAX_ATTEMPTS (${tsConstant}) — ` +
      'the CHECK_FAILED reclaim index no longer matches the claim query\'s own attempts ceiling, so a row at the true ceiling either ' +
      'stops being reclaimable via the index while the query still asks for it (Seq Scan fallback), or the index serves rows the query rejects'
  );
});

test('(constant pin, MAJOR-1) FIELD_PLAN_RECLAIM_MAX_ATTEMPTS (TS) equals PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS (the detection check\'s copy)', () => {
  const repoSource = readFileSync(REPOSITORY_TS_PATH, 'utf8');
  const tsConstant = parseTsConstant(repoSource, 'FIELD_PLAN_RECLAIM_MAX_ATTEMPTS');
  assert.equal(
    PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS,
    tsConstant,
    'field-plan-slot.mjs\'s PULL_PLAN_STUCK_RECLAIM_MAX_ATTEMPTS has drifted from the claim query\'s FIELD_PLAN_RECLAIM_MAX_ATTEMPTS — ' +
      'the detection check would then flag (or fail to flag) rows using a DIFFERENT ceiling than the one the claim query actually enforces'
  );
});

test('(constant pin, MAJOR-1) the guard genuinely fails on a mutated scratch copy of the schema.ts source', () => {
  const schemaSource = readFileSync(SCHEMA_TS_PATH, 'utf8');
  const mutated = schemaSource.replace(
    "CHECK_FAILED' AND ${table.attempts} < 5",
    "CHECK_FAILED' AND ${table.attempts} < 9"
  );
  assert.notEqual(mutated, schemaSource, 'the mutation target text was not found — the real file has changed shape; update this test');
  const mutatedLiteral = parseSchemaPartialIndexAttemptsLiteral(mutated);
  assert.notEqual(
    mutatedLiteral,
    5,
    'a mutated schema.ts (attempts < 9) must parse to a DIFFERENT value than the real FIELD_PLAN_RECLAIM_MAX_ATTEMPTS (5) — proves the guard can actually fail'
  );
});
