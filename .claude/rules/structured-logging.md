---
name: structured-logging
description: >
  Enforces pino structured logging in scraper source code — object-first call
  signature, context tags, level discipline — with a narrow console allowance
  for CLI script user-facing output.
paths: ["scraper/src/**/*.ts", "scraper/scripts/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Scraper Structured Logging (pino)

All operational logging in the scraper workspace goes through the shared pino
logger at `scraper/src/utils/logger.ts` — pino-pretty (colorized) in
development, raw JSON in production, ISO timestamps, level from `LOG_LEVEL`.

## Call signature — object first

MUST pass structured context as the FIRST argument, message second:

```typescript
import logger from '../utils/logger.js';

// ✅ Correct — fields are queryable in production JSON logs
logger.info({ ipoId, source: 'NSE', fieldsUpdated: 5 }, 'Updated IPO');

// ❌ Wrong — context interpolated into the message string is unqueryable
logger.info(`Updated IPO ${ipoId} from NSE with 5 fields`);
```

## Context tags

Every log line in scraper/service/pipeline code SHOULD carry the identifiers
needed to trace it: `ipoId` (or slug), `source` (the `ScraperSource`), and the
operation. Logs without identifiers are noise in a multi-source concurrent run.

## Level discipline

| Level | Use for |
|---|---|
| `debug` | Verbose detail (disabled in production) |
| `info` | Milestones — run start/finish, counts, upsert outcomes |
| `warn` | Transient issues — retries, skips, validation warnings, Redis-lock unavailable |
| `error` | Hard failures — DB errors, network failures, consolidation fallback |

## console.* policy

- `scraper/src/**`: MUST NOT use `console.log` / `console.error` — use the pino
  logger exclusively
- `scraper/scripts/**` (CLI backfill/maintenance scripts): MAY use `console.log`
  for **user-facing run summaries** (mode banner, progress, final table), but
  operational events (per-item success/failure, retries, DB errors) MUST still
  go through pino so production log files stay structured

## Secrets

MUST NOT log secret values or full credentials; log variable/field names only.
Pino redaction operates on structured fields — another reason interpolated
message strings are forbidden.

## CRITICAL RULES

- MUST log via `scraper/src/utils/logger.ts` with object-first signature
- MUST NOT use console.* in `scraper/src/**`; scripts may console.log
  user-facing summaries only
- MUST include ipoId/source context on data-pipeline log lines
- MUST NOT interpolate secrets or payload values into message strings
