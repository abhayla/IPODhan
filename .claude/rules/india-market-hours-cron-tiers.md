---
name: india-market-hours-cron-tiers
description: >
  Scheduled scraper jobs declare a JobSchedule with timezone 'Asia/Kolkata'
  (IST, never UTC) and TIERED crons (marketHours vs afterHours vs weekends); the
  whole table swaps to DEV_SCHEDULES when SCRAPER_INTERVAL_MODE=dev. Cadence is
  driven by Indian trading hours, not a flat interval.
paths: ["scraper/src/scheduler/**"]
version: "1.0.0"
synthesized: true
private: false
---

# India Market-Hours Cron Tiers

## Every job is an IST-anchored JobSchedule

All scheduled jobs are declared as `JobSchedule` objects in
`scraper/src/scheduler/config.ts` (interface at ~line 9). Every schedule MUST set
`timezone: 'Asia/Kolkata'` — cron expressions are evaluated in IST so windows
line up with NSE/BSE trading hours. MUST NOT author cron expressions in UTC or
omit the timezone; a UTC schedule silently shifts every window by 5h30m and
misses the open/close. (Note: `refresh-calendar.ts` forces a UTC *DB session* for
a timestamp write (#28) — that is a Postgres concern, NOT the cron timezone; do
not conflate the two.)

## Tiered cadence, not a flat interval

Time-of-day-sensitive jobs MUST use the three-tier shape rather than a single
`schedule`:

- `marketHours` — densest cadence during trading hours, Mon–Fri. e.g. NSE
  `'*/30 9-15 * * 1-5'` (every 30 min, 9:15–15:30, Story 11.2); BSE
  `'*/15 9-17 * * 1-5'` (every 15 min).
- `afterHours` — relaxed off-hours weekday cadence, e.g. `'*/30 0-8,16-23 * * 1-5'`.
- `weekends` — hourly, e.g. `'0 */1 * * 0,6'`.

Jobs that are genuinely time-insensitive may use the single `schedule` field
(e.g. `moneycontrol` `'*/30 * * * *'` 24/7, `statusUpdater` `'0 * * * *'`,
`healthCheck` `'*/5 * * * *'`). Pick tiers when the data only changes during
market hours; pick a flat `schedule` only when it genuinely does not.

## dev vs prod swap the whole table

`config.ts` defines two complete tables, `PROD_SCHEDULES` and `DEV_SCHEDULES`,
selected at the bottom by `schedulerConfig.jobs = process.env.SCRAPER_INTERVAL_MODE
=== 'dev' ? DEV_SCHEDULES : PROD_SCHEDULES` (~line 239), with
`intervalMode: (process.env.SCRAPER_INTERVAL_MODE as 'dev' | 'prod') || 'prod'`.
`DEV_SCHEDULES` uses deliberately longer intervals and disables heavy daily jobs
(`financialData`, `peerCompanies`, `dailySummary`, `logCleanup` set
`enabled: false`) to cut local resource use. A new job MUST be added to BOTH
tables — omitting it from one means it silently never runs in that mode.

`scraper/src/scheduler/scheduler.ts` (`init()` ~line 58) reads each tier off
`schedulerConfig.jobs.<job>` and only `registerJob()`s the enabled ones (e.g.
market/after/weekend tiers registered separately ~line 207+); the process is
launched from `scraper/src/scheduler/index.ts` (~line 22) via
`new SchedulerService()` → `init()` → `start()`.

## Why

IPO subscription, price, and GMP data only move while Indian exchanges are open.
Tiering concentrates scrape frequency (and rate-limit budget) on market hours and
backs off nights/weekends; IST anchoring is what makes `9-15`/`9-17` map to the
actual session. A flat interval either hammers sources off-hours or misses
intra-session changes.

## CRITICAL RULES

- MUST set `timezone: 'Asia/Kolkata'` on every `JobSchedule`; MUST NOT write cron
  expressions in UTC or leave the timezone unset.
- MUST tier time-of-day-sensitive jobs into `marketHours`/`afterHours`/`weekends`
  (Mon–Fri windows aligned to NSE/BSE hours); use a single `schedule` only for
  genuinely time-insensitive jobs.
- MUST add any new job to BOTH `PROD_SCHEDULES` and `DEV_SCHEDULES` in
  `scraper/src/scheduler/config.ts`; the dev table MUST use longer intervals.
- MUST drive cadence by Indian trading hours, never a single flat interval for
  market-sensitive data.
