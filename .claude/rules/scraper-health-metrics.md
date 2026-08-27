---
name: scraper-health-metrics
description: >
  Enforces recording per-source scraper run metrics to Redis (24h TTL) and the
  threshold-based alerting contract — consecutive-failure and success-rate alerts
  with a cooldown — so a degrading source is caught instead of silently rotting.
paths: ["scraper/src/services/scraper-metrics-tracker.ts", "scraper/src/services/alerting-service.ts", "scraper/src/scrapers/**/*.ts", "scraper/src/jobs/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Scraper Health Metrics & Alerting

Every scraper source reports run outcomes so health is observable across a
multi-source concurrent system. Metrics live in Redis; alerting is
threshold-driven with a cooldown so it warns without spamming.

## Record outcomes per source

Use `ScraperMetricsTracker` (`scraper/src/services/scraper-metrics-tracker.ts`)
to record success/failure keyed by `ScraperSource`. Metrics are stored with a
fixed TTL:

- `METRICS_TTL = 86400` (24h) — metrics and the consecutive-failure counter both
  expire on this window; MUST NOT persist scraper metrics in the primary DB or
  with an unbounded key
- New scrapers/jobs MUST record an outcome on every run so success rate and the
  failure streak stay accurate — a source that never reports looks healthy

## Alerting is threshold + cooldown

The tracker raises an alert (via `alerting-service.ts`) when either:

- consecutive failures reach `CONSECUTIVE_FAILURE_THRESHOLD`, or
- the success `rate` drops below the success-rate threshold

and an alert was not sent within the `ALERT_COOLDOWN` window.

- MUST keep alerts gated by `ALERT_COOLDOWN` — removing the cooldown turns a sick
  source into an alert storm
- Alert delivery rides the project notifier (see `notifier-integration.md`); MUST
  NOT add a second ad-hoc alert channel from inside a scraper
- Tuning the thresholds is a deliberate ops decision — change the constants in the
  tracker, not by scattering inline comparisons at call sites
