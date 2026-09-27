// #195 J2: self-test for the synthetic alert-drill audit. Failing-test-first
// per the defect-fix contract — every case drives the REAL functions
// (runDrill / postDrillEvent / findDrillInLog / buildDrillEvent), never a
// re-implementation. No real network, no real filesystem: fetchImpl and
// readFileImpl are injected per the "pure orchestration" shape in
// scripts/audit-alert-drill.mjs, so this is deterministic in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DRILL_PROJECT,
  DRILL_TYPE,
  buildDrillDedupeKey,
  buildDrillEvent,
  postDrillEvent,
  findDrillInLog,
  runDrill,
} from '../audit-alert-drill.mjs';
import { parseDeliveryLine } from '../audit-alert-channel.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'notifier-delivery-log-drill-fixture.jsonl');
const FIXED_NOW = new Date('2026-09-25T12:00:00.000Z'); // IST day 2026-09-25

function fakeReadFile(contents) {
  return () => contents;
}

function throwingReadFile(message) {
  return () => {
    throw new Error(message);
  };
}

function fakeFetch({ ok, status, error }) {
  return async () => {
    if (error) throw error;
    return { ok, status };
  };
}

test('buildDrillDedupeKey / buildDrillEvent: IST-day-scoped, routes to no destination project', () => {
  const key = buildDrillDedupeKey(FIXED_NOW);
  assert.equal(key, 'alert-drill-2026-09-25');
  const event = buildDrillEvent(FIXED_NOW);
  assert.equal(event.project, DRILL_PROJECT);
  assert.equal(event.type, DRILL_TYPE);
  assert.equal(event.severity, 'info');
  assert.equal(event.dedupeKey, key);
});

test('postDrillEvent: non-2xx response is reported as not posted, with the status', async () => {
  const result = await postDrillEvent({
    fetchImpl: fakeFetch({ ok: false, status: 401 }),
    url: 'http://127.0.0.1:3300',
    key: 'wrong-key',
    event: buildDrillEvent(FIXED_NOW),
  });
  assert.equal(result.posted, false);
  assert.match(result.reason, /HTTP 401/);
});

test('postDrillEvent: network error is reported as not posted, with the error message', async () => {
  const result = await postDrillEvent({
    fetchImpl: fakeFetch({ error: new Error('ECONNREFUSED') }),
    url: 'http://127.0.0.1:3300',
    key: 'k',
    event: buildDrillEvent(FIXED_NOW),
  });
  assert.equal(result.posted, false);
  assert.match(result.reason, /ECONNREFUSED/);
});

test('postDrillEvent: 202 is reported as posted', async () => {
  const result = await postDrillEvent({
    fetchImpl: fakeFetch({ ok: true, status: 202 }),
    url: 'http://127.0.0.1:3300',
    key: 'k',
    event: buildDrillEvent(FIXED_NOW),
  });
  assert.equal(result.posted, true);
  assert.equal(result.status, 202);
});

test('findDrillInLog: finds the drill event by project + dedupeKey, ignores unrelated rows', () => {
  const raw = readFileSync(FIXTURE_PATH, 'utf8');
  const records = raw.split('\n').map(parseDeliveryLine).filter((r) => r !== null);
  assert.equal(records.length, 2, 'fixture has one unrelated row and one drill row');
  const found = findDrillInLog(records, { dedupeKey: 'alert-drill-2026-09-25' });
  assert.ok(found);
  assert.equal(found.event.project, DRILL_PROJECT);
  assert.equal(findDrillInLog(records, { dedupeKey: 'alert-drill-2026-09-26' }), null);
});

test('runDrill: UNVERIFIABLE (never FAIL) when the key env is absent', async () => {
  const summary = await runDrill({
    notifierUrl: 'http://127.0.0.1:3300',
    notifierKey: undefined,
    deliveryLogPath: FIXTURE_PATH,
    now: FIXED_NOW,
  });
  assert.equal(summary.status, 'UNVERIFIABLE');
  assert.match(summary.reason, /NOTIFIER_KEY_IPODHAN_ALERT_DRILL/);
});

test('runDrill: UNVERIFIABLE when the URL env is absent', async () => {
  const summary = await runDrill({
    notifierUrl: undefined,
    notifierKey: 'k',
    deliveryLogPath: FIXTURE_PATH,
    now: FIXED_NOW,
  });
  assert.equal(summary.status, 'UNVERIFIABLE');
});

test('runDrill: FAIL when the Notifier rejects the POST (e.g. wrong key -> 401)', async () => {
  const summary = await runDrill({
    notifierUrl: 'http://127.0.0.1:3300',
    notifierKey: 'wrong-key',
    deliveryLogPath: FIXTURE_PATH,
    fetchImpl: fakeFetch({ ok: false, status: 401 }),
    now: FIXED_NOW,
  });
  assert.equal(summary.status, 'FAIL');
  assert.match(summary.reason, /POST rejected/);
  assert.match(summary.reason, /401/);
});

test('runDrill: PASS when the POST succeeds and the event is found in the log', async () => {
  const summary = await runDrill({
    notifierUrl: 'http://127.0.0.1:3300',
    notifierKey: 'k',
    deliveryLogPath: FIXTURE_PATH,
    fetchImpl: fakeFetch({ ok: true, status: 202 }),
    readFileImpl: fakeReadFile(readFileSync(FIXTURE_PATH, 'utf8')),
    now: FIXED_NOW,
  });
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.record.event.dedupeKey, 'alert-drill-2026-09-25');
});

test('runDrill: FAIL when the POST succeeds but the event never lands in the log (T-294C shape)', async () => {
  const summary = await runDrill({
    notifierUrl: 'http://127.0.0.1:3300',
    notifierKey: 'k',
    deliveryLogPath: FIXTURE_PATH,
    fetchImpl: fakeFetch({ ok: true, status: 202 }),
    // A later date than the fixture's own drill row -> a fresh dedupeKey that
    // cannot possibly be in the fixture, simulating "accepted and then lost".
    readFileImpl: fakeReadFile(readFileSync(FIXTURE_PATH, 'utf8')),
    now: new Date('2026-10-02T12:00:00.000Z'),
  });
  assert.equal(summary.status, 'FAIL');
  assert.match(summary.reason, /never appeared in the delivery log/);
});

test('runDrill: UNVERIFIABLE when the POST succeeds but the log cannot be read at all', async () => {
  const summary = await runDrill({
    notifierUrl: 'http://127.0.0.1:3300',
    notifierKey: 'k',
    deliveryLogPath: '/nonexistent/delivery-log.jsonl',
    fetchImpl: fakeFetch({ ok: true, status: 202 }),
    readFileImpl: throwingReadFile('ENOENT: no such file'),
    now: FIXED_NOW,
  });
  assert.equal(summary.status, 'UNVERIFIABLE');
  assert.match(summary.reason, /could not be read/);
});
