// scripts/tests/vps-data-audit-cron-ist-day.test.mjs -- #687 slice 2.
//
// RCA: DATE_TAG in scripts/vps-data-audit-cron.sh was `$(date +%F)`, the HOST
// (UTC) calendar day. The VPS clock is UTC and the nightly cron fires
// 02:00-03:45 IST, when UTC is still the previous day -- so the floor state
// file ($STATE_DIR/floor/$DATE_TAG.txt) and run-$DATE_TAG.log were named one
// day behind the IST day the run actually happened in. Same family as
// #682/#689 (due-step-cycle, status updater) and the slice-1 fix in
// scripts/lib/ist-day.mjs -- but the cron SCRIPT's own DATE_TAG line was never
// touched, one layer upstream of what slice 1 fixed.
//
// This is a static assertion (grep the shipped shell text) plus a runtime
// proof gated on tzdata being present, never a behavioral run of the cron
// script itself -- the cron script must never be executed by CI/tests (no DB,
// no VPS side effects).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', 'vps-data-audit-cron.sh');
const SOURCE = readFileSync(SCRIPT_PATH, 'utf8');

test('DATE_TAG is derived using the IST timezone, not the bare host clock', () => {
  const dateTagLine = SOURCE
    .split('\n')
    .find((line) => line.trim().startsWith('DATE_TAG='));
  assert.ok(dateTagLine, 'could not locate the DATE_TAG= assignment line');
  assert.match(
    dateTagLine,
    /TZ=Asia\/Kolkata date \+%F/,
    'DATE_TAG must be computed with TZ=Asia/Kolkata, not the bare host clock ' +
      `(found: ${dateTagLine})`
  );
});

function tzdataHasKolkata() {
  try {
    const offset = execFileSync('date', ['+%z'], {
      env: { ...process.env, TZ: 'Asia/Kolkata' },
    }).toString().trim();
    return offset === '+0530';
  } catch {
    return false;
  }
}

test(
  'proof: at the cron\'s firing instant (20:30 UTC == 02:00 IST next day), ' +
    'TZ=Asia/Kolkata date +%F prints the later day while UTC still shows the earlier one',
  { skip: !tzdataHasKolkata() && 'host has no Asia/Kolkata tzdata (offset did not resolve to +0530) -- proof runs on any host with real tzdata, e.g. the VPS/CI' },
  () => {
    // 2026-09-15T20:30:00Z == 2026-09-16T02:00:00+05:30: the exact instant the
    // cron is firing while UTC is still the previous calendar day.
    const FIXED_EPOCH = 1789504200; // == 2026-09-15T20:30:00Z (verified via `date -u -d @epoch`)

    const utcDay = execFileSync('date', ['-u', '-d', `@${FIXED_EPOCH}`, '+%F']).toString().trim();
    const istDay = execFileSync('date', ['-d', `@${FIXED_EPOCH}`, '+%F'], {
      env: { ...process.env, TZ: 'Asia/Kolkata' },
    }).toString().trim();

    assert.equal(utcDay, '2026-09-15', 'sanity: UTC day at this instant must be 2026-09-15');
    assert.equal(istDay, '2026-09-16', 'IST day at this instant must already be 2026-09-16');
    assert.notEqual(istDay, utcDay, 'the TZ switch must change the calendar day at this instant');
  }
);
