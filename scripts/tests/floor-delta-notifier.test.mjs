// Failing-test-first proof for #477: floor-delta.mjs's postToNotifier sent
// severity values 'high'/'low' (not one of P0|P1|P2|info accepted by the
// Notifier gateway, GLOBAL.md §2) and never read res.status, so a rejected
// (400) POST looked identical to a delivered one in the script's own output.
//
// Run: node --test scripts/tests/floor-delta-notifier.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildNotifyPayload, postToNotifier } from '../ops/floor-delta.mjs';

test('buildNotifyPayload: severity is P2 when hasNew, info otherwise', () => {
  const withNew = buildNotifyPayload('summary text', { newIds: ['a'], newEntitiesByCheck: new Map() });
  assert.equal(withNew.severity, 'P2');

  const withoutNew = buildNotifyPayload('summary text', { newIds: [], newEntitiesByCheck: new Map() });
  assert.equal(withoutNew.severity, 'info');

  const withNewEntities = buildNotifyPayload('summary text', {
    newIds: [],
    newEntitiesByCheck: new Map([['c_issue_size_floor', ['ACME LTD']]]),
  });
  assert.equal(withNewEntities.severity, 'P2');
});

test('postToNotifier: non-2xx status is surfaced as NOTIFY-FAIL and returns false', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.NOTIFIER_URL;
  const originalKey = process.env.NOTIFIER_KEY;
  process.env.NOTIFIER_URL = 'https://example.invalid';
  process.env.NOTIFIER_KEY = 'test-key';
  global.fetch = async () => ({ status: 400, text: async () => '{"error":"invalid severity"}' });

  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    const ok = await postToNotifier('summary', { newIds: ['a'], newEntitiesByCheck: new Map() });
    assert.equal(ok, false);
    assert.ok(logs.some((l) => l.startsWith('NOTIFY-FAIL 400')), `expected a NOTIFY-FAIL line, got: ${logs.join(' | ')}`);
  } finally {
    console.log = originalLog;
    global.fetch = originalFetch;
    process.env.NOTIFIER_URL = originalUrl;
    process.env.NOTIFIER_KEY = originalKey;
  }
});

test('postToNotifier: 2xx status prints NOTIFY-OK and returns true', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.NOTIFIER_URL;
  const originalKey = process.env.NOTIFIER_KEY;
  process.env.NOTIFIER_URL = 'https://example.invalid';
  process.env.NOTIFIER_KEY = 'test-key';
  global.fetch = async () => ({ status: 202, text: async () => '' });

  const logs = [];
  const originalLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    const ok = await postToNotifier('summary', { newIds: [], newEntitiesByCheck: new Map() });
    assert.equal(ok, true);
    assert.ok(logs.some((l) => l.startsWith('NOTIFY-OK 202')), `expected a NOTIFY-OK line, got: ${logs.join(' | ')}`);
  } finally {
    console.log = originalLog;
    global.fetch = originalFetch;
    process.env.NOTIFIER_URL = originalUrl;
    process.env.NOTIFIER_KEY = originalKey;
  }
});
