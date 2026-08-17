# Scrape Cadence Measurement — Ground Truth for Watchdog SLOs

**Task:** T-176 (owner-approved watchdog plan v6, 2026-08-17). Measures the ACTUAL
observed scrape cadence per source, retrospectively, from IPODhan's own runtime
records — so the watchdog's freshness SLOs are set from reality, not from the
cron expression on paper.

**Status:** Retrospective measurement was sufficient. No sampler was added (see
"Why no sampler" below).

## 1. History window used and its source

- **Source:** the `scraper_logs` table in the production Postgres DB (`packages/shared/src/db/schema.ts`
  table `SCRAPER_LOGS`), read via the standing VPS SSH tunnel (`localhost:15432` →
  `103.118.16.189:5432`, see `.claude/skills`/memory `vps-db-tunnel-setup`). Every
  scraper run writes one row per source per invocation (`source`, `status`,
  `createdAt = defaultNow()`).
- **Window:** **30 days** (2026-07-18T03:00:05Z → 2026-08-17T02:30:07Z), queried
  2026-08-17. This exceeds the DoD's 7-day minimum, so **item 2 (the sampler) is
  NOT mandatory** and was not added — see the "Why no sampler" section.
- Corroborating source: live PM2 log files on the VPS (`C:\Apps\IPODhan\logs\scraper-out.log`
  and the daily-rotated `scraper-out__YYYY-MM-DD_00-00-00.log`, via `pm2-logrotate`),
  used in §3 for direct timestamped evidence of the TZ question. Log retention on
  disk is short (~5 days, rotated daily) — the DB table is the authoritative
  30-day record; the log files are corroborating raw evidence only.

## 2. Per-source cadence: observed vs configured

All values computed from consecutive `scraper_logs.created_at` gaps per source
(`lag() over (partition by source order by created_at)`), in minutes.

| Source | Configured expectation | n runs (30d) | Median gap | p90 gap | Max gap | Min gap |
|---|---|---:|---:|---:|---:|---:|
| NSE | every 30 min (PM2 `cron_restart`) | 1441 | 30.00 | 30.13 | 72.08 | 0.004 |
| BSE | every 30 min (PM2 `cron_restart`) | 1441 | 30.00 | 30.19 | 72.34 | 0.001 |
| MONEYCONTROL | every 30 min (PM2 `cron_restart`) | 1441 | 30.00 | 30.26 | 71.52 | 0.002 |
| CHITTORGARH | every 30 min (PM2 `cron_restart`) | 1440 | 30.00 | 30.28 | 91.05 | 0.002 |
| INVESTORGAIN_GMP (GMP) | every 30 min (PM2 `cron_restart`) | 1440 | 30.00 | 30.28 | 90.96 | 0.002 |
| IPO_ALERTS_API (API fallback) | every 30 min (PM2 `cron_restart`) | 1440 | 30.00 | 30.28 | 91.05 | 0.002 |
| **listingPerformanceUpdate** | tiered, `scheduler/config.ts` | **0** | **N/A — never runs** | — | — | — |
| **statusUpdater** | every 1 min, `scheduler/config.ts` | **0** | **job dormant; function runs every 30 min via triggerStatusUpdate()** | — | — | — |

**Finding 1 — the six "live" sources track the configured 30-minute PM2 cron
almost exactly.** Median gap is 30.00 min for every source (i.e. the scraper
fires on schedule the vast majority of the time); p90 is 30.1–30.3 min (a small,
consistent overrun — the scrape itself takes a few seconds to a couple of
minutes before the next cron tick, well inside the 30-min window). Max gaps of
72–91 minutes appear a handful of times over 30 days (2–3 occurrences per
source) and correlate with deploys/VPS restarts, e.g. NSE's largest gap
(72.1 min, 2026-07-23 23:32 → 2026-07-24 00:44 UTC) — a single missed cycle,
not a sustained outage. There is **no evidence of Indian-market-hours tiering**
(see §3) — the hourly run count is flat (59–61 runs per UTC hour across the
24-hour day) and the day-of-week distribution is proportional to the number of
each weekday observed in the window, not weighted toward weekdays/market hours.

**Finding 2 — the dedicated `listingPerformanceUpdate` and `statusUpdater`
scheduler JOBS never run in production, at all.** Zero rows for either job
name in 30 days of `scraper_logs`. This is not a measurement gap — it is
confirmed structurally:

- Both jobs are defined only in `scraper/src/scheduler/config.ts` /
  `scraper/src/scheduler/scheduler.ts`, which is driven by the
  `scraper/src/scheduler/index.ts` entrypoint (a long-running, self-scheduling
  daemon).
- `ecosystem.config.js` does **not** run that entrypoint. The only scraper
  process PM2 manages (`ipodhan-scraper`) runs `scraper/src/index.ts
  --source=all`, a one-shot CLI script (see `.claude/rules/pm2-scheduled-one-shot-scraper.md`)
  that only ever touches `nse | bse | moneycontrol | chittorgarh | fallback/api
  | gmp` (confirmed by reading `scraper/src/index.ts`'s `--source` branches —
  there is no `listingPerformanceUpdate` or `statusUpdater` branch in that
  file). `scraper/src/scheduler/index.ts` is not deployed as its own PM2 app.

**`listingPerformanceUpdate` — dormant job, no functional equivalent (CONFIRMED).**
DB corroboration: the `listing_performance` table's most recent row
(`updated_at`/`created_at`) is **2026-07-01T10:56:44Z — 47 days stale** as of
this measurement (2026-08-17), with 143 total rows, consistent with the job
never having run since whatever one-off backfill populated it. There is no
other code path that writes `listing_performance` in production — the dedicated
job is the only writer, and it is not deployed. Any freshness SLO on this table
cannot be "expected cadence minus tolerance" — there is no cadence, because the
feature is not wired into the production process tree.

**`statusUpdater` — dormant job, BUT its functional work runs via a different
path every 30 minutes.** The dedicated scheduler job (the 1-minute-cadence
entry in `scraper/src/scheduler/config.ts`) never fires, for the same
structural reason as above. But IPO status transitions — the *functional*
purpose of that job — are NOT actually missing: every one-shot
`--source=all` cron cycle calls `triggerStatusUpdate()`
(`scraper/src/index.ts`, called after the source scrapes complete), which
POSTs to `/api/admin/status/update` on the web app, which runs
`updateIPOStatuses()` server-side. This means time-based IPO status
transitions execute on the **same flat 30-minute cadence** as the six live
scraper sources above, just via the web admin API instead of the dedicated
scheduler job. Verified directly: 20/20 cron cycles in the 2026-08-16 VPS PM2
logs show `triggerStatusUpdate()` firing and completing (`"IPO status
transitions applied"`) once per cycle, with zero misses. `ipos.status` being
current in the DB is therefore not a side effect of the live scrapers'
`upsertIPO` writes — it is evidence this alternate path executes on schedule.

**Implication for the watchdog:**
- `listingPerformanceUpdate` — treat as "known-inactive, out-of-scope for
  freshness alerting until the dedicated job (or an equivalent write path) is
  deployed," OR file a separate activation task (deploy `scheduler/index.ts`
  as its own gated PM2 app per `.claude/rules/owner-gated-feature-flags.md`
  §GATE convention) before setting an SLO on it.
- `statusUpdater` — do **not** treat this as inactive/out-of-scope. Set its
  freshness SLO against the same flat 30-minute cadence as the six live
  scraper sources (§2's ground truth), measured via `triggerStatusUpdate()`
  call success/failure in the scraper's own logs or `ipos.status`-transition
  timestamps — NOT against a "job never runs, zero rows" signal from
  `scraper_logs`, which would incorrectly page on a healthy system (the
  dedicated job name legitimately never appears there; that is expected, not
  a failure).

This report does not make the activation call for `listingPerformanceUpdate` —
it is out of scope (read/measure only, per the task contract).

## 3. The PM2-UTC-vs-IST contradiction, resolved with evidence

**Claim being tested:** `ecosystem.config.js` sets `cron_restart: '*/30 * * * *'`
on `ipodhan-scraper` with `env.TZ: 'UTC'`, while the (dormant — see §2)
in-app scheduler at `scraper/src/scheduler/config.ts` uses
`timezone: 'Asia/Kolkata'` (IST) tiers for `marketHours`/`afterHours`/`weekends`.
A reviewer flagged these as "competing schedulers" whose actual timezone
behavior was unproven.

**Evidence — live log lines (VPS, `C:\Apps\IPODhan\logs\scraper-out.log`,
2026-08-17):**

```
2026-08-17T14:00:04: {"level":30,"time":"2026-08-17T08:30:04.356Z", ... "msg":"IPO Scraper CLI started"}
2026-08-17T13:30:04: {"level":30,"time":"2026-08-17T08:00:04.410Z", ... "msg":"IPO Scraper CLI started"}
2026-08-17T13:00:22: {"level":30,"time":"2026-08-17T07:30:22.004Z", ... "msg":"IPO Scraper CLI started"}
2026-08-17T12:30:38: {"level":30,"time":"2026-08-17T07:00:38.764Z", ... "msg":"IPO Scraper CLI started"}
```

The **leftmost timestamp** (PM2's own log-line prefix, written by the
`pm2-logrotate` module) is in the VPS's **local time zone — India Standard Time**
(confirmed live: `[System.TimeZoneInfo]::Local.Id` on the VPS returns
`"India Standard Time"`, and `Get-Date` returns `1:59:06 PM` at the same
instant the tunnel query showed `08:29 UTC`, an exact +5:30 offset). The
**inner `time` field** is the scraper process's own pino logger timestamp
(`structured-logging.md`), genuinely UTC because the forked process has
`env.TZ: 'UTC'` set in `ecosystem.config.js`. Every pair above differs by
exactly `05:30:00`.

**Resolution:** the contradiction is real in the sense that the PM2 daemon
(the God process that evaluates `cron_restart`) is **not** told `TZ: 'UTC'` —
that env var only applies to the *forked scraper process*, not to PM2's own
cron scheduler, which runs in the VPS's local time zone (IST). But this
**does not change the observed cadence**, because `*/30 * * * *` is
timezone-invariant for any zone whose UTC offset is itself a multiple of 30
minutes — and IST (UTC+05:30) is exactly 11 × 30 min. A cron pattern that
fires "at :00 and :30 of every hour" produces the **same sequence of absolute
instants** whether the daemon evaluates it in UTC or in IST; only the
clock-label differs (14:00 IST is the same instant as 08:30 UTC, and both are
still "on a :00/:30 boundary"). This is confirmed empirically: the inner-UTC
`time` values above land on exact 30-minute UTC boundaries
(`08:30:04`, `08:00:04`, `07:30:22`, `07:00:38`), and §2's hourly-distribution
query shows a flat 59–61 runs per UTC hour with no market-hours skew.

**Net effect:** PM2's flat `*/30 * * * *` cron fires the one-shot
`--source=all` scrape **unconditionally, 24 hours a day, 7 days a week**,
regardless of Indian market hours, regardless of which timezone the daemon
evaluates the pattern in. The `Asia/Kolkata` market-hours tiers defined in
`scraper/src/scheduler/config.ts` are **not a competing, race-condition
schedule** — they are simply **inert configuration for code that is not
running in production** (§2, Finding 2). There is one live scheduler
(PM2's flat cron) and one dormant one (the in-app tiered scheduler); they do
not fight each other because only one is deployed.

**Ground truth for the watchdog:** set freshness SLOs for NSE / BSE /
MONEYCONTROL / CHITTORGARH / INVESTORGAIN_GMP / IPO_ALERTS_API against a **flat
30-minute expected cadence, 24/7**, with a tolerance that accommodates the
observed p90 (~30.3 min) and the occasional single-cycle miss (max observed gap
91 min, i.e. up to ~3 missed cycles before it should page) — NOT against the
`Asia/Kolkata` market-hours tiers in `scheduler/config.ts`, which do not govern
production behavior today.

## 4. Why no sampler was added

DoD item 2 is conditional: a sampler is only required "if retrospective history
was insufficient." The `scraper_logs` table provided **30 days** of per-run,
per-source timestamps (≥1440 samples per source) — well past the 7-day bar —
with clean, unambiguous interval statistics. Adding a parallel sampler would
have duplicated data this task already has authoritative access to, for no
analytical gain. If a future re-measurement needs a *forward-looking* window
(e.g. to catch a regression after a scheduler change), re-run the same query
against `scraper_logs` — it is a standing, always-on record; no separate
instrumentation is needed for that either.

## 5. Reproduce this measurement

1. Open the VPS DB tunnel (`vps-db-tunnel-setup` memory / `.claude/rules`):

   ```bash
   ssh -i ~/.ssh/ipodhan_vps -N -L 15432:localhost:5432 Administrator@103.118.16.189
   ```

2. Run the exact query used to produce §2's table against `scraper_logs`
   (via `psql "postgresql://<user>:<pass>@localhost:15432/<db>"` or any
   Postgres client pointed at the tunnel). It computes per-source gaps with
   `lag()` over `created_at`, then aggregates median/p90/max/min in minutes
   over a rolling 30-day window:

   ```sql
   WITH gaps AS (
     SELECT
       source,
       created_at,
       EXTRACT(EPOCH FROM (
         created_at - LAG(created_at) OVER (
           PARTITION BY source ORDER BY created_at
         )
       )) / 60.0 AS gap_minutes
     FROM scraper_logs
     WHERE created_at >= NOW() - INTERVAL '30 days'
   )
   SELECT
     source,
     COUNT(*) AS n_runs,
     ROUND(PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY gap_minutes)::numeric, 2) AS median_gap_min,
     ROUND(PERCENTILE_CONT(0.9)  WITHIN GROUP (ORDER BY gap_minutes)::numeric, 2) AS p90_gap_min,
     ROUND(MAX(gap_minutes)::numeric, 2) AS max_gap_min,
     ROUND(MIN(gap_minutes)::numeric, 3) AS min_gap_min
   FROM gaps
   WHERE gap_minutes IS NOT NULL
   GROUP BY source
   ORDER BY source;
   ```

3. To confirm the "never runs" finding for `listingPerformanceUpdate` /
   `statusUpdater` (§2, Finding 2), run:

   ```sql
   SELECT source, COUNT(*) AS n_runs
   FROM scraper_logs
   WHERE created_at >= NOW() - INTERVAL '30 days'
     AND source IN ('listingPerformanceUpdate', 'statusUpdater')
   GROUP BY source;
   -- Expected (as measured 2026-08-17): zero rows for both.
   ```

No new script is needed since `scraper_logs` is populated continuously by
production — re-running the query above at any later date refreshes the
measurement over a new rolling 30-day window.

## 6. Data source declaration (per task contract)

This report is a **measurement of IPODhan's own runtime records only**:
the `scraper_logs` Postgres table (authoritative write-path record of every
scrape attempt) and live PM2 log files on the production VPS. No external
service or third-party monitoring tool was used or is required.
