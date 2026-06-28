---
name: redis-best-effort-fail-open
description: >
  Redis is best-effort across the IPODhan monorepo: every cache read and lock
  acquisition degrades to the source-of-truth on Redis error/outage and MUST NEVER
  throw into or block a user request or a scrape. Cache writes are non-blocking.
globs: ["web/**/*.ts", "web/**/*.tsx", "packages/shared/src/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Redis Is Best-Effort — Fail Open, Never Block

Caching is an optimization, never a dependency. A Redis outage, timeout, or any cache
error MUST degrade gracefully to the source of truth (Postgres via Drizzle, or an
upstream fetch). A user request or a scraper run MUST NEVER fail, hang, or 500 because
Redis is down. This is project-wide policy spanning the `web/` and `packages/shared/`
workspaces; it sits on top of (and does not restate) the 3-layer repository architecture
in `web-data-access.md`.

## Web service layer — the fail-open `getCachedOrFetch` contract

The canonical helper (see `web/lib/services/home-ipo-service.ts`) wraps caching so a
Redis failure can never surface to the caller:

1. `safeGet(cacheKey)` (from `web/lib/cache/redis-client.ts`) — on hit, `JSON.parse` and return.
2. On miss, call `fetchFn()` (the real DB/API read).
3. Write back NON-BLOCKING: `safeSet(...).catch(...)` — the write is fire-and-forget; a
   failed cache write is logged, never awaited into the response path.
4. On ANY thrown error, the outer `catch` falls through to a direct `return fetchFn()` —
   the request still succeeds with fresh data.

This helper is currently COPY-PASTED across all 6 landing services: `ncd-service.ts`,
`home-ipo-service.ts`, `mainboard-landing-service.ts`, `ofs-service.ts`, `rights-service.ts`,
and `sme-landing-service.ts` (all under `web/lib/services/`). A new service MUST reuse a
single fail-open helper, not re-author the pattern.

WARNING — do NOT use `web/lib/cache/cache-aside.ts` (`cacheAside`) for new code: it
RE-THROWS on cache-read error (`catch (error) { ... throw error }`) instead of falling
through, which violates this rule. It is currently unused; the fail-open `getCachedOrFetch`
is the correct model. New services SHOULD consolidate onto one shared fail-open helper
rather than copying it a seventh time.

## Repository layer — `BaseRepository.getFromCache` (packages/shared)

`packages/shared/src/repositories/base-repository.ts` enforces the same stance for all
repositories that extend `BaseRepository`:

- `getFromCache(key, dbQuery, ttl)` wraps each cache read in a 2000ms `Promise.race`
  timeout. On hit it returns parsed data; on miss/error it logs (`[Cache]`/`[DB]` tags)
  and falls through to `dbQuery()` — the read NEVER throws.
- The cache write is also timeout-bounded (2000ms `Promise.race`) and runs detached via
  `setCacheWithTimeout().catch(...)` — non-blocking, never awaited into the result.
- `deleteCache` / `deleteCachePattern` LOG-and-continue on error (cache invalidation
  failure must not break a write operation).
- Only `setCache` throws `CacheError` — and it is always called inside the detached,
  caught write path, so the throw is contained and never reaches the caller.

## Scraper locks — same stance, documented elsewhere

Scraper distributed locks (`scraper/src/utils/distributed-lock.ts`) follow the identical
philosophy: "if Redis is down, log a warning and continue — never hard-block on lock
infrastructure." Do NOT re-document scraper internals here; that contract lives in
`scraper-write-path.md`. This rule simply records that locks share the project-wide
best-effort stance.

## CRITICAL RULES

- MUST NEVER let a Redis outage, timeout, or cache error fail, hang, or 500 a user
  request or a scrape — always fall through to the source of truth.
- Cache READS and LOCK acquisitions MUST fail open (degrade to DB / continue), never throw to the caller.
- Cache WRITES MUST be non-blocking (fire-and-forget `.catch()`), never awaited into the response/scrape path.
- New web services MUST use the fail-open `getCachedOrFetch` model; MUST NOT use the re-throwing `cacheAside` from `web/lib/cache/cache-aside.ts`.
- Redis ops in `packages/shared` repositories MUST stay inside the 2000ms `Promise.race` timeout wrapper of `BaseRepository`.
- Cache invalidation failures MUST log-and-continue (`deleteCache`/`deleteCachePattern`), never break the underlying write.
