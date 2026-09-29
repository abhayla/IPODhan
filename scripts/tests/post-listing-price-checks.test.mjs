// #1310 — mutation-proof self-tests for scripts/lib/post-listing-price-checks.mjs.
//
// Run: node --test scripts/tests/post-listing-price-checks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePriceJobRuns,
  checkPriceJobZeroPricedStreak,
  PRICE_JOB_ZERO_PRICED_STREAK_THRESHOLD,
} from '../lib/post-listing-price-checks.mjs';

function runLine({ candidates, updated = 0, confirmed = 0, unchanged = 0, stale = 0, time = '2026-09-29T08:15:00.000Z' }) {
  return JSON.stringify({
    level: 30,
    time,
    candidates,
    closeRead: false,
    updated,
    confirmed,
    unchanged,
    stale,
    noPrice: candidates - updated - confirmed - unchanged - stale,
    refused: 0,
    notReached: 0,
    msg: `Post-listing price job: run complete — 12 exchange calls (NSE 8, BSE 4, BSE list 0) for ${candidates} IPOs`,
  });
}

test('#1310 discriminates: FAILs on the exact measured shape (3 consecutive candidates>0, priced=0)', () => {
  const raw = [runLine({ candidates: 132 }), runLine({ candidates: 130 }), runLine({ candidates: 131, time: '2026-09-29T09:15:00.000Z' })].join('\n');
  const violation = checkPriceJobZeroPricedStreak(raw);
  assert.match(violation, /newest 3 post-listing price runs/);
  assert.match(violation, /131 candidates/);
  assert.match(violation, /#1310/);
});

test('#1310 PASSes when the newest run in the streak priced at least one row (rotation reached a priceable one)', () => {
  const raw = [runLine({ candidates: 132 }), runLine({ candidates: 130 }), runLine({ candidates: 131, updated: 1 })].join('\n');
  assert.equal(checkPriceJobZeroPricedStreak(raw), null);
});

test('#1310 PASSes when only 2 of the last 3 runs are zero-priced (one clean run breaks the streak)', () => {
  const raw = [runLine({ candidates: 132, updated: 2 }), runLine({ candidates: 130 }), runLine({ candidates: 131 })].join('\n');
  assert.equal(checkPriceJobZeroPricedStreak(raw), null);
});

test('#1310 mutation guard: a `candidates: 0` run (outside market hours) never counts toward the streak', () => {
  const raw = [runLine({ candidates: 0 }), runLine({ candidates: 0 }), runLine({ candidates: 0 })].join('\n');
  assert.equal(checkPriceJobZeroPricedStreak(raw), null);
});

test('#1310 returns null (UNVERIFIABLE upstream, never a false FAIL) with fewer than the threshold of run lines', () => {
  const raw = [runLine({ candidates: 132 }), runLine({ candidates: 130 })].join('\n');
  assert.equal(checkPriceJobZeroPricedStreak(raw), null);
});

test('#1310 ignores unrelated pino lines and scraper-wake.sh plain-text lines in the same file', () => {
  const raw = [
    '2026-09-29 08:00:00 [wake] starting',
    JSON.stringify({ level: 30, time: '2026-09-29T08:01:00.000Z', msg: 'Post-listing state job: run complete', candidates: 5, updated: 0 }),
    runLine({ candidates: 132 }),
    runLine({ candidates: 130 }),
    runLine({ candidates: 131 }),
  ].join('\n');
  const violation = checkPriceJobZeroPricedStreak(raw);
  assert.match(violation, /#1310/);
});

test('parsePriceJobRuns: priced sums updated+confirmed+unchanged+stale, never the raw candidates count', () => {
  const raw = runLine({ candidates: 10, updated: 1, confirmed: 2, unchanged: 3, stale: 4 });
  const runs = parsePriceJobRuns(raw);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].priced, 10);
  assert.equal(runs[0].candidates, 10);
});

test('threshold constant is 3 (documents the intent the fixtures above assert)', () => {
  assert.equal(PRICE_JOB_ZERO_PRICED_STREAK_THRESHOLD, 3);
});
