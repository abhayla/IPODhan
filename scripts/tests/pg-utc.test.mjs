// Mutation-proof tests for scripts/lib/pg-utc.mjs (round 2 of the audit-pool-utc
// fix). Round 1 only pinned the session (`options: '-c timezone=UTC'`), which
// fixes SERVER-SIDE now()-relative SQL but does nothing for ages computed in
// JAVASCRIPT from a Date object read out of a naive `timestamp` (OID 1114)
// column — `pg` parses that as MACHINE-LOCAL time regardless of the session
// pin. Staging proof: m_blocked_all_age read 56.5h before round 1 and 56.8h
// after (only elapsed time moved) because hoursBetween/daysBetween in
// document-state-checks.mjs and the age math in audit-detection-floor.mjs
// all compute from Date objects, not from SQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import {
  parseNaiveTimestampAsUtc,
  installUtcTimestampParsing,
  createUtcPool,
} from '../lib/pg-utc.mjs';

test('parseNaiveTimestampAsUtc: parses a naive timestamp string as UTC', () => {
  const parsed = parseNaiveTimestampAsUtc('2026-01-01 00:00:00');
  assert.equal(parsed.getTime(), Date.UTC(2026, 0, 1));
});

test('parseNaiveTimestampAsUtc: handles fractional seconds', () => {
  const parsed = parseNaiveTimestampAsUtc('2026-06-15 14:55:32.123');
  assert.equal(parsed.getTime(), Date.UTC(2026, 5, 15, 14, 55, 32, 123));
});

test('parseNaiveTimestampAsUtc: null passes through', () => {
  assert.equal(parseNaiveTimestampAsUtc(null), null);
});

test('parseNaiveTimestampAsUtc: infinity sentinels', () => {
  assert.equal(parseNaiveTimestampAsUtc('infinity').getTime(), 8640000000000000);
  assert.equal(parseNaiveTimestampAsUtc('-infinity').getTime(), -8640000000000000);
});

test('installUtcTimestampParsing: registers the OID-1114 parser regardless of process.env.TZ', () => {
  const originalTz = process.env.TZ;
  process.env.TZ = 'Asia/Kolkata';
  try {
    installUtcTimestampParsing();
    const TIMESTAMP_OID = pg.types.builtins.TIMESTAMP;
    const parser = pg.types.getTypeParser(TIMESTAMP_OID);
    const result = parser('2026-01-01 00:00:00');
    assert.equal(
      result.getTime(),
      Date.UTC(2026, 0, 1),
      'the 1114 parser must read the naive string as UTC even when process.env.TZ is IST — the exact class of bug that made m_blocked_all_age read 5.5h high on the IST VPS'
    );
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test('installUtcTimestampParsing: is idempotent (safe to call from every script)', () => {
  assert.doesNotThrow(() => {
    installUtcTimestampParsing();
    installUtcTimestampParsing();
    installUtcTimestampParsing();
  });
});

test('installUtcTimestampParsing: never overrides timestamptz (OID 1184) — only naive timestamp (1114)', () => {
  const src = readFileSync(new URL('../lib/pg-utc.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /builtins\.TIMESTAMPTZ/);
  assert.match(src, /builtins\.TIMESTAMP\b/);
});

test('createUtcPool: pins options to -c timezone=UTC and preserves the rest of the config', () => {
  const pool = createUtcPool({ host: 'example', max: 4 });
  try {
    assert.equal(pool.options.options, '-c timezone=UTC');
    assert.equal(pool.options.host, 'example');
    assert.equal(pool.options.max, 4);
  } finally {
    pool.end();
  }
});

// --- source-level: the four scripts route through pg-utc.mjs, never a bare Pool ---

for (const rel of [
  '../audit-detection-floor.mjs',
  '../audit-ipo-coverage.mjs',
  '../audit-substance-plausibility.mjs',
  '../fix-substance-corruption.mjs',
]) {
  test(`${rel}: imports createUtcPool from ./lib/pg-utc.mjs, calls assertUtcSession(pool) before any query, never constructs Pool directly`, () => {
    const script = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.match(script, /import\s*\{[^}]*createUtcPool[^}]*\}\s*from\s*'\.\/lib\/pg-utc\.mjs'/);
    assert.match(script, /installUtcTimestampParsing\(\)/);
    assert.match(script, /assertUtcSession\(/, `${rel} must call assertUtcSession(pool) — utc-naive-timestamp-normalization.md requires the boot-time assert on every pool`);
    assert.doesNotMatch(script, /new pg\.Pool\(/);
    assert.doesNotMatch(script, /new Pool\(/);
  });
}
