// Real lines captured 2026-09-07 (read-only ssh, `grep -h ... | tail -1`) from
// prod (~/.pm2/logs/ipodhan-scraper-out.log) and staging
// (~/.pm2/logs/ipodhan-scraper-staging-out.log) — T-496, per
// docs/reviews/rca-2026-09-07-missed-live-defects.md.
//
// Red before the fix: scripts/ops/lib/failure-classifier.mjs did not exist,
// so every import below threw. Green after: each real line resolves to the
// exact errorClass the RCA names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLine, extractFailures, parseLogLines } from '../ops/lib/failure-classifier.mjs';

// Rentomojo Ltd. — staging, 2026-09-07T16:16:31.384Z — price-band ad insert fails.
const RENTOMOJO_PERSIST = {
  level: 50, time: '2026-09-07T16:16:31.384Z', pid: 979909, hostname: 'srv1707492',
  ipoId: 'b28d9d2a-cb24-4d84-8e1a-297ba828884a', docType: 'PRICE_BAND_AD',
  error: 'Failed query: insert into "ipo_details" ("id", "ipo_id", "issue_type", ...) values (...) on conflict ("ipo_id") do update set ...',
  msg: 'Filing persist failed (non-fatal)',
};

// Steamhouse India Ltd. — staging, 2026-09-07T15:49:16.048Z — unit refusal.
const STEAMHOUSE_UNIT_REFUSAL = {
  level: 50, time: '2026-09-07T15:49:16.048Z', pid: 969707, hostname: 'srv1707492',
  ipoId: 'bd42cdce-c154-4e19-b154-f545c0724efc',
  reason: 'PRICE_BAND_AD has no parseable unit - the two documents cannot be compared, so NEITHER is persisted.',
  msg: 'W-45 cross-document agreement refused the paired persist — nothing written',
};

// ESDS Software Solution Limited — prod, 2026-09-07T05:13:14.212Z — spawn ETIMEDOUT, soft (retried, not hard).
const ESDS_SPAWN_ETIMEDOUT_SOFT = {
  level: 50, time: '2026-09-07T05:13:14.212Z', pid: 715005, hostname: 'srv1707492',
  ipoId: '765193bc-b0b1-432b-a0d6-eabf0e9e898e', docType: 'RHP',
  error: 'spawn failed: spawnSync nice ETIMEDOUT', retryCount: 7, blocked: false, hardFailure: false,
  msg: 'Filing extraction failed (non-fatal) — recorded as FAILED with a backoff',
};

// Hy-Tech Engineers Ltd. — prod, 2026-09-07T17:30:34.124Z — anchor deterministic refusal, second occurrence -> MANUAL_REVIEW (W-168).
const HYTECH_ANCHOR_DETERMINISTIC = {
  level: 50, time: '2026-09-07T17:30:34.124Z', pid: 1007681, hostname: 'srv1707492',
  ipoId: 'ef4563a1-2410-4991-9c6a-d0a2832fdcd7',
  reason: 'anchor: row "Whiteoak Capital Multicap Fund Wh iteoak Capital Balanced" prints 17.39% but holds 15.26% of the anchor portion',
  hardFailure: false, deterministic: true, status: 'MANUAL_REVIEW',
  msg: 'Anchor allocation report failed the same deterministic way twice — recorded MANUAL_REVIEW (W-168)',
};

// Auto-persist summary line carrying the company name for Rentomojo (used by extractFailures to
// resolve identity when the failure line itself lacks `company`).
const RENTOMOJO_SUMMARY = {
  level: 30, time: '2026-09-07T18:01:22.191Z', ipoId: 'b28d9d2a-cb24-4d84-8e1a-297ba828884a',
  company: 'Rentomojo Limited', considered: 4, extracted: 1, persisted: 0, failed: 1,
  msg: 'Filing auto-persist complete for one IPO',
};

test('classifyLine: Rentomojo persist-insert-failed', () => {
  const c = classifyLine(RENTOMOJO_PERSIST);
  assert.equal(c.errorClass, 'persist-insert-failed');
  assert.equal(c.ipoId, 'b28d9d2a-cb24-4d84-8e1a-297ba828884a');
  assert.equal(c.docType, 'PRICE_BAND_AD');
});

// T-504/#402: staging, 2026-09-07T20:22:10.769Z — same Rentomojo ipo_details
// insert, but PR #411's cause-bearing log now carries the driver's real
// error (numeric field overflow, code 22003). RED before this fix (no rule
// distinguished it from any other insert failure — it fell into the generic
// `persist-insert-failed` bucket, indistinguishable from a syntax error or a
// missing column); GREEN after — it resolves to its own class.
const RENTOMOJO_NUMERIC_OVERFLOW = {
  level: 50, time: '2026-09-07T20:22:10.769Z', pid: 979909, hostname: 'srv1707492',
  ipoId: 'b28d9d2a-cb24-4d84-8e1a-297ba828884a', docType: 'PRICE_BAND_AD',
  error: 'Failed query: insert into "ipo_details" ("id", "ipo_id", "issue_type", ...) values (...) on conflict ("ipo_id") do update set ...',
  cause: 'numeric field overflow', code: '22003',
  msg: 'Filing persist failed (non-fatal)',
};

test('classifyLine: Rentomojo persist-numeric-overflow (code 22003)', () => {
  const c = classifyLine(RENTOMOJO_NUMERIC_OVERFLOW);
  assert.equal(c.errorClass, 'persist-numeric-overflow');
  assert.equal(c.ipoId, 'b28d9d2a-cb24-4d84-8e1a-297ba828884a');
  assert.equal(c.docType, 'PRICE_BAND_AD');
});

test('classifyLine: a plain insert failure with no code still falls into persist-insert-failed', () => {
  // Guards against the new rule accidentally widening to match every insert
  // failure — only a genuine 22003 (or a cause naming numeric overflow) gets
  // the more specific class.
  const c = classifyLine(RENTOMOJO_PERSIST);
  assert.equal(c.errorClass, 'persist-insert-failed');
});

test('classifyLine: Steamhouse unit-unparseable', () => {
  const c = classifyLine(STEAMHOUSE_UNIT_REFUSAL);
  assert.equal(c.errorClass, 'unit-unparseable');
  assert.equal(c.ipoId, 'bd42cdce-c154-4e19-b154-f545c0724efc');
});

test('classifyLine: ESDS spawn-timeout-soft (hardFailure:false)', () => {
  const c = classifyLine(ESDS_SPAWN_ETIMEDOUT_SOFT);
  assert.equal(c.errorClass, 'spawn-timeout-soft');
  assert.equal(c.hardFailure, false);
});

test('classifyLine: spawn ETIMEDOUT with hardFailure:true classifies as -hard', () => {
  const hard = { ...ESDS_SPAWN_ETIMEDOUT_SOFT, hardFailure: true };
  const c = classifyLine(hard);
  assert.equal(c.errorClass, 'spawn-timeout-hard');
});

test('classifyLine: Hy-Tech anchor-deterministic-refusal', () => {
  const c = classifyLine(HYTECH_ANCHOR_DETERMINISTIC);
  assert.equal(c.errorClass, 'anchor-deterministic-refusal');
  assert.equal(c.ipoId, 'ef4563a1-2410-4991-9c6a-d0a2832fdcd7');
});

test('classifyLine: level-30 info line is not a failure', () => {
  assert.equal(classifyLine(RENTOMOJO_SUMMARY), null);
});

test('classifyLine: a level-50 line matching a named marker but no specific rule falls into "other"', () => {
  const c = classifyLine({ level: 50, time: '2026-09-07T00:00:00.000Z', msg: 'Something spawn failed unexpectedly' });
  assert.equal(c.errorClass, 'other');
});

test('classifyLine: document-discovery noise (BLOCKED_ALL) is excluded, not "other" — out of scope per T-496 dod', () => {
  const c = classifyLine({
    level: 50, time: '2026-09-07T18:15:59.373Z', ipoId: '390b67e4-b6c5-46e9-997e-5248859307b8',
    company: 'Om Galaxy Ltd.', docType: 'DRHP', msg: 'Document BLOCKED_ALL — every source failed (P2)',
  });
  assert.equal(c, null);
});

test('parseLogLines: skips non-JSON lines, parses embedded JSON per line', () => {
  const text = [
    'pm2 log rotated banner',
    JSON.stringify(RENTOMOJO_PERSIST),
    '',
    JSON.stringify(STEAMHOUSE_UNIT_REFUSAL),
  ].join('\n');
  const lines = parseLogLines(text);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].ipoId, RENTOMOJO_PERSIST.ipoId);
});

test('extractFailures: resolves company via the auto-persist summary line when the failure line lacks it', () => {
  const failures = extractFailures([RENTOMOJO_PERSIST, RENTOMOJO_SUMMARY]);
  const key = 'b28d9d2a-cb24-4d84-8e1a-297ba828884a::PRICE_BAND_AD::persist-insert-failed';
  assert.ok(failures.has(key));
  assert.equal(failures.get(key).company, 'Rentomojo Limited');
});

test('extractFailures: keys by (ipoId, docType, errorClass) — same ipo/class from two lines dedupes to one entry', () => {
  const failures = extractFailures([RENTOMOJO_PERSIST, { ...RENTOMOJO_PERSIST, time: '2026-09-07T16:20:00.000Z' }]);
  assert.equal(failures.size, 1);
});

test('extractFailures: four real fixtures produce four distinct keyed failures', () => {
  const failures = extractFailures([
    RENTOMOJO_PERSIST,
    STEAMHOUSE_UNIT_REFUSAL,
    ESDS_SPAWN_ETIMEDOUT_SOFT,
    HYTECH_ANCHOR_DETERMINISTIC,
  ]);
  assert.equal(failures.size, 4);
  const classes = new Set([...failures.values()].map((f) => f.errorClass));
  assert.deepEqual(
    classes,
    new Set(['persist-insert-failed', 'unit-unparseable', 'spawn-timeout-soft', 'anchor-deterministic-refusal'])
  );
});
