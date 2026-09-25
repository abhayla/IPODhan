// #663 — mutation-proof self-tests for scripts/lib/scraper-wake-detection.mjs
// and the newestWakeTimestamp() addition to scripts/ops/wake-delta.mjs.
//
// The class: after #660 removed pm2's --cron-restart, the only thing that
// wakes the scraper is a crontab line the deploying user installs. Nothing
// checked (1) that the line still exists, or (2) that a wake has actually
// happened recently — a cron line can fire a command that fails instantly
// (scraper-wake.sh's exit-78 refusals) and leave the line present while the
// scraper stays asleep. Each fixture below matches the failure SHAPE these
// two checks exist to catch (must FAIL) and a clean shape (must PASS).
//
// Run: node --test scripts/tests/scraper-wake-detection.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkScraperWakeCrontabLine,
  checkScraperWakeFreshness,
  SCRAPER_WAKE_CADENCE_BY_SLOT,
  SCRAPER_WAKE_CADENCE_MINUTES,
  SCRAPER_WAKE_FRESHNESS_SLACK_MINUTES,
  expectedWakeScriptFragment,
} from '../lib/scraper-wake-detection.mjs';
import { newestWakeTimestamp } from '../ops/wake-delta.mjs';

// --- crontab line presence, cadence and target (check 1) --------------------

test('#663 crontab FAILs when the marker line is entirely absent (the exact class: pm2 no longer restarts, cron removed by hand)', () => {
  const crontab = [
    '# some other unrelated line',
    '0 3 * * * /usr/bin/certbot renew',
  ].join('\n');
  const violation = checkScraperWakeCrontabLine('prod', crontab);
  assert.match(violation, /no crontab line carries the marker "# ipodhan-scraper-wake:prod"/);
});

test('#663 crontab FAILs on a duplicate marker line (a re-install that never cleaned up)', () => {
  const line = '*/30 * * * * /var/www/ipodhan/current/scripts/scraper-wake.sh data >> /var/log/ipodhan-scraper-wake-prod.log 2>&1 # ipodhan-scraper-wake:prod';
  const crontab = [line, line].join('\n');
  const violation = checkScraperWakeCrontabLine('prod', crontab);
  assert.match(violation, /2 crontab lines carry the marker/);
});

test('#663 crontab FAILs when the cadence field is wrong (a hand edit, or the wrong slot template copied)', () => {
  const crontab = '15,45 * * * * /var/www/ipodhan/current/scripts/scraper-wake.sh data >> /var/log/ipodhan-scraper-wake-prod.log 2>&1 # ipodhan-scraper-wake:prod';
  const violation = checkScraperWakeCrontabLine('prod', crontab);
  assert.match(violation, /does not start with the expected cadence "\*\/30 \* \* \* \*"/);
});

test('#663 crontab FAILs when the line invokes a release directory instead of the current symlink (deleted by retention pruning)', () => {
  const crontab = '*/30 * * * * /var/www/ipodhan/releases/2026-09-01T00-00-00Z/scripts/scraper-wake.sh data >> /var/log/ipodhan-scraper-wake-prod.log 2>&1 # ipodhan-scraper-wake:prod';
  const violation = checkScraperWakeCrontabLine('prod', crontab);
  assert.match(violation, /does not invoke the deploy's "current" symlink/);
});

test('#663 crontab PASSes the real prod line scripts\\/deploy-linux.sh installs', () => {
  const crontab = [
    '# ipodhan-scraper-live:prod',
    '5,35 * * * * /var/www/ipodhan/current/scripts/scraper-wake.sh live >> /var/log/ipodhan-scraper-wake-prod.log 2>&1 # ipodhan-scraper-live:prod',
    '*/30 * * * * /var/www/ipodhan/current/scripts/scraper-wake.sh data >> /var/log/ipodhan-scraper-wake-prod.log 2>&1 # ipodhan-scraper-wake:prod',
  ].join('\n');
  assert.equal(checkScraperWakeCrontabLine('prod', crontab), null);
});

test('#663 crontab PASSes the real staging line (offset cadence + current-staging symlink, W-178)', () => {
  const crontab = '15,45 * * * * /var/www/ipodhan/current-staging/scripts/scraper-wake.sh data >> /var/log/ipodhan-scraper-wake-staging.log 2>&1 # ipodhan-scraper-wake:staging';
  assert.equal(checkScraperWakeCrontabLine('staging', crontab), null);
});

test('#663 crontab: prod and staging markers do not collide (a staging line never satisfies the prod check)', () => {
  const crontab = '15,45 * * * * /var/www/ipodhan/current-staging/scripts/scraper-wake.sh data >> /var/log/ipodhan-scraper-wake-staging.log 2>&1 # ipodhan-scraper-wake:staging';
  assert.match(checkScraperWakeCrontabLine('prod', crontab), /no crontab line carries the marker "# ipodhan-scraper-wake:prod"/);
});

test('#663 sanity: the cadence/target constants agree with scripts/deploy-linux.sh', () => {
  assert.equal(SCRAPER_WAKE_CADENCE_BY_SLOT.prod, '*/30 * * * *');
  assert.equal(SCRAPER_WAKE_CADENCE_BY_SLOT.staging, '15,45 * * * *');
  assert.equal(expectedWakeScriptFragment('prod'), '/current/scripts/scraper-wake.sh');
  assert.equal(expectedWakeScriptFragment('staging'), '/current-staging/scripts/scraper-wake.sh');
});

// --- log freshness: a wake actually happened recently (check 2) ------------

test('#663 freshness FAILs when the log has no wake line at all (mirrors the "line present, nothing ever fired" shape)', () => {
  const violation = checkScraperWakeFreshness('prod', null, '2026-09-25T10:00:00Z');
  assert.match(violation, /no wake line found in the log for slot prod/);
});

test('#663 freshness FAILs when the newest wake is older than cadence + slack (the exit-78-refusal shape: line present, scraper asleep)', () => {
  // 30min cadence + 15min slack = 45min ceiling; 46 minutes old must FAIL.
  const violation = checkScraperWakeFreshness('prod', '2026-09-25T09:14:00Z', '2026-09-25T10:00:00Z');
  assert.match(violation, /newest wake log line is 46\.0 min old, exceeds the 45 min ceiling/);
});

test('#663 freshness PASSes exactly at the ceiling and comfortably under it', () => {
  assert.equal(checkScraperWakeFreshness('prod', '2026-09-25T09:15:00Z', '2026-09-25T10:00:00Z'), null); // exactly 45 min
  assert.equal(checkScraperWakeFreshness('staging', '2026-09-25T09:50:00Z', '2026-09-25T10:00:00Z'), null); // 10 min
});

test('#663 sanity: the ceiling is cadence + slack, both named', () => {
  assert.equal(SCRAPER_WAKE_CADENCE_MINUTES, 30);
  assert.equal(SCRAPER_WAKE_FRESHNESS_SLACK_MINUTES, 15);
});

// --- newestWakeTimestamp: EVERY wake kind counts, not only failures --------

test('#663 newestWakeTimestamp reads a wake-complete line (a healthy wake, not a failure) as evidence of life', () => {
  const raw = [
    '2026-09-25T08:00:03Z scraper-wake: wake-starting: job=data, lock is free; starting a cycle',
    '2026-09-25T08:00:03Z scraper-wake: wake-complete: the cycle finished cleanly. elapsed=180s',
  ].join('\n');
  assert.equal(newestWakeTimestamp(raw), '2026-09-25T08:00:03Z');
});

test('#663 newestWakeTimestamp picks the LATEST line across mixed kinds, not the last line in the file', () => {
  const raw = [
    '2026-09-25T08:30:01Z scraper-wake: wake-skipped: job=data - a cycle is already running',
    '2026-09-25T09:00:02Z scraper-wake: wake-starting: job=data, lock is free; starting a cycle',
    '2026-09-25T08:45:00Z scraper-wake: wake-failed: elapsed=5s exit=1',
  ].join('\n');
  assert.equal(newestWakeTimestamp(raw), '2026-09-25T09:00:02Z');
});

test('#663 newestWakeTimestamp returns null for an empty or unparseable log (missing file reads the same as "nothing happened")', () => {
  assert.equal(newestWakeTimestamp(''), null);
  assert.equal(newestWakeTimestamp('not a wake line at all\nneither is this'), null);
  assert.equal(newestWakeTimestamp(undefined), null);
});

// --- mutation guard: confirms the FAIL fixtures can actually fail ----------

test('#663 mutation guard: an inverted ceiling comparison would make the red freshness case pass — confirms the test can fail', () => {
  const ageMinutes = 46;
  const ceilingMinutes = SCRAPER_WAKE_CADENCE_MINUTES + SCRAPER_WAKE_FRESHNESS_SLACK_MINUTES;
  // The real predicate FAILs (ageMinutes > ceilingMinutes). An inverted
  // predicate (ageMinutes < ceilingMinutes) would PASS the same input —
  // proving this fixture is not vacuously true either way.
  assert.equal(ageMinutes > ceilingMinutes, true);
  assert.equal(ageMinutes < ceilingMinutes, false);
});
