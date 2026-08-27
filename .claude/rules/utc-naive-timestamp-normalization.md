---
name: utc-naive-timestamp-normalization
description: >
  All `timestamp without time zone` columns obey a two-part UTC contract — every pg Pool sets
  session timezone UTC, and configureUtcTimestampParsing() reads naive values as UTC — because PM2
  on the VPS does not propagate TZ=UTC to Node. Skipping either half skews timestamps by the IST offset.
paths: ["packages/shared/src/db/**/*.ts", "web/**/*.ts", "scraper/src/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# UTC-Naive Timestamp Normalization (GitHub #28)

## The two-part contract — both halves are mandatory
The schema uses `timestamp without time zone` columns and the Postgres server default session
timezone is `Asia/Calcutta`. Under that combination app/Drizzle writers (`new Date().toISOString()`)
store true UTC wall-clock while `now()`/`defaultNow()` store IST wall-clock, so the same row's
`created_at` and `last_scraped_at` can differ by 5h30m and any `now()`-relative server query
mis-reads naive values as IST. Two independent guarantees fix this and BOTH are required:

1. **WRITE side — session UTC.** Every `new Pool(...)` MUST pass `options: '-c timezone=UTC'` so the
   session runs in UTC and `now()`/`defaultNow()` write UTC-naive. This is set in
   `packages/shared/src/db/index.ts` (~line 34 and ~41, both the `DATABASE_HOST` and
   `DATABASE_URL` branches) and in `packages/shared/src/db.ts` `getPool()` (~line 21). Any NEW pool
   anywhere (web, scraper, scripts) MUST set the same option.
2. **READ side — UTC parser.** `configureUtcTimestampParsing()` in
   `packages/shared/src/db/timezone-config.ts` overrides pg's TIMESTAMP OID **1114** parser
   (`types.builtins.TIMESTAMP`) so a naive value is parsed AS UTC on read, independent of the OS
   process timezone. It MUST be called once before any query (see `db/index.ts` line ~8). It is
   idempotent (`configured` guard).

## Do NOT override timestamptz; DO keep the boot guard
The parser override is deliberately scoped to OID 1114 only. `timestamptz` (OID **1184**) MUST NOT
be overridden — pg's default parser already returns a correct absolute instant for it, and overriding
would double-shift the value. This is why the READ-side fix targets only the naive `timestamp` type.

`assertSessionTimezoneUtc(pool)` is a boot-time fail-fast guard: it runs `SHOW timezone` and throws
unless the session is `UTC`, surfacing a mis-configured connection immediately (called from
`testConnection()`). Keep it on startup paths; do not silence it.

WHY this is not just `TZ=UTC`: PM2 on the VPS does NOT reliably propagate `TZ=UTC` to the Node
process (the process reports `Asia/Calcutta` despite `ecosystem.config.js` `TZ:'UTC'`), so a
process-env approach alone is insufficient — the parser override removes that dependency entirely.

## CRITICAL RULES
- MUST set `options: '-c timezone=UTC'` on EVERY `new Pool(...)` (web, scraper, shared, scripts) — no exceptions.
- MUST call `configureUtcTimestampParsing()` before issuing queries; rely on its idempotent guard, do not reimplement OID parsing inline.
- MUST NOT override the `timestamptz` parser (OID 1184) — only naive `timestamp` (OID 1114) is normalized; overriding 1184 double-shifts.
- MUST keep `assertSessionTimezoneUtc(pool)` as a boot-time check on connection startup; never remove or swallow its throw.
- MUST NOT depend on `TZ=UTC` reaching the Node process — PM2 on the VPS does not propagate it; the in-code contract is the source of truth.
