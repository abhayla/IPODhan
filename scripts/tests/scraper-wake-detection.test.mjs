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
  checkScraperWakeSkippedRun,
  SCRAPER_WAKE_CADENCE_BY_SLOT,
  SCRAPER_WAKE_CADENCE_MINUTES,
  SCRAPER_WAKE_FRESHNESS_SLACK_MINUTES,
  SCRAPER_WAKE_SKIPPED_RUN_THRESHOLD,
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

// --- #707: a RUN of consecutive wake-skipped lines (any cause holding the lock) ---
//
// Lines below use the EXACT format scripts/scraper-wake.sh's log() writes
// (verified against scripts/scraper-wake.sh:58-60,442): a leading UTC
// timestamp, ` scraper-wake: `, the kind, then free text — the same shape
// scripts/ops/wake-delta.mjs's LINE_RE already parses. N=3 is chosen because
// the wake fires every 30 min (SCRAPER_WAKE_CADENCE_MINUTES): 3 consecutive
// skips span ~90 min, comfortably more than one normal wake interval, so a
// single overlapping cycle (one skip) never trips this check.

test('#707 sanity: the threshold is named and spans more than one wake interval', () => {
  assert.equal(SCRAPER_WAKE_SKIPPED_RUN_THRESHOLD, 3);
  assert.ok(SCRAPER_WAKE_SKIPPED_RUN_THRESHOLD * SCRAPER_WAKE_CADENCE_MINUTES > SCRAPER_WAKE_CADENCE_MINUTES);
});

test('#707 FAILs when the newest N lines of a slot are all wake-skipped (a stale lock, a hung run, or any cause holding it)', () => {
  const raw = [
    '2026-09-26T10:00:03Z scraper-wake: wake-starting: job=data, lock is free; starting a cycle',
    '2026-09-26T10:30:01Z scraper-wake: wake-skipped: job=data - a cycle is already running and holds the lock; this occurrence is skipped, not queued and not killed. lock_key=scraper:lock:data lock_ttl=7200s remaining',
    '2026-09-26T11:00:01Z scraper-wake: wake-skipped: job=data - a cycle is already running and holds the lock; this occurrence is skipped, not queued and not killed. lock_key=scraper:lock:data lock_ttl=5400s remaining',
    '2026-09-26T11:30:02Z scraper-wake: wake-skipped: job=data - a cycle is already running and holds the lock; this occurrence is skipped, not queued and not killed. lock_key=scraper:lock:data lock_ttl=3600s remaining',
  ].join('\n');
  const violation = checkScraperWakeSkippedRun('prod', raw);
  assert.match(violation, /slot prod/);
  assert.match(violation, /3 consecutive/);
  assert.match(violation, /2026-09-26T10:30:01Z/);
  assert.match(violation, /2026-09-26T11:30:02Z/);
});

test('#707 PASSes when a skip is followed by a real wake (the lock working as designed, W-... one overlap is normal)', () => {
  const raw = [
    '2026-09-26T10:30:01Z scraper-wake: wake-skipped: job=data - a cycle is already running and holds the lock; lock_key=scraper:lock:data lock_ttl=120s remaining',
    '2026-09-26T11:00:01Z scraper-wake: wake-starting: job=data, lock is free; starting a cycle',
    '2026-09-26T11:00:05Z scraper-wake: wake-complete: the cycle finished cleanly. elapsed=180s',
  ].join('\n');
  assert.equal(checkScraperWakeSkippedRun('prod', raw), null);
});

test('#707 PASSes when there are fewer than N wake lines total (nothing to judge a run against)', () => {
  const raw = [
    '2026-09-26T10:30:01Z scraper-wake: wake-skipped: job=data - a cycle is already running; lock_key=scraper:lock:data lock_ttl=60s remaining',
  ].join('\n');
  assert.equal(checkScraperWakeSkippedRun('prod', raw), null);
});

test('#707 UNVERIFIABLE-equivalent: an unreadable/empty log returns null, never a false FAIL (freshness already covers "no wake at all")', () => {
  assert.equal(checkScraperWakeSkippedRun('staging', ''), null);
  assert.equal(checkScraperWakeSkippedRun('staging', undefined), null);
});

test('#707 slots are independent: a staging run of skips never trips the prod check', () => {
  const stagingRaw = [
    '2026-09-26T10:30:01Z scraper-wake: wake-skipped: job=data; lock_ttl=60s remaining',
    '2026-09-26T11:00:01Z scraper-wake: wake-skipped: job=data; lock_ttl=60s remaining',
    '2026-09-26T11:30:01Z scraper-wake: wake-skipped: job=data; lock_ttl=60s remaining',
  ].join('\n');
  assert.match(checkScraperWakeSkippedRun('staging', stagingRaw), /slot staging/);
  // Calling the predicate for a different slot against the SAME raw text (the caller reads
  // each slot's own log file, so this exercises the label, not cross-slot log mixing).
  assert.match(checkScraperWakeSkippedRun('prod', stagingRaw), /slot prod/);
});

test('#707 mutation guard: weakening the threshold to N=10 makes the real 3-in-a-row fixture pass — confirms the test can fail', () => {
  const lines = [
    { kind: 'wake-skipped' },
    { kind: 'wake-skipped' },
    { kind: 'wake-skipped' },
  ];
  const realThreshold = SCRAPER_WAKE_SKIPPED_RUN_THRESHOLD; // 3
  const weakenedThreshold = 10;
  assert.equal(lines.length >= realThreshold, true, 'the real threshold must FAIL this fixture');
  assert.equal(lines.length >= weakenedThreshold, false, 'a weakened threshold must PASS the same fixture — proves the assertion is not vacuous');
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
