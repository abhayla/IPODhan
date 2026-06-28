---
name: cache-key-and-ttl-ssot
description: >
  Redis cache keys, invalidation patterns, and TTLs come ONLY from the centralized
  cache-keys SSOT modules — never inline string keys or magic-number TTLs. A page's
  ISR revalidate window MUST equal its backing data-layer Redis TTL.
globs: ["web/**/*.ts", "web/**/*.tsx", "packages/shared/src/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Cache Keys & TTLs Are SSOT — Never Inline

Cache keys, invalidation wildcard patterns, and TTLs are a single source of truth. Inline
key strings drift apart from their invalidators (silent stale cache), and magic-number
TTLs drift apart from page ISR windows (data served older/newer than the page claims).
This composes with `web-data-access.md` (the 3-layer repo architecture) — it governs the
caching keys/TTLs that layer consumes, which `web-data-access.md` does not cover.

## Keys — only from cache-keys generators

Two parallel SSOT modules define every key: `web/lib/cache/cache-keys.ts` AND
`packages/shared/src/cache/cache-keys.ts`. Keys follow `{entity}:{operation}:{identifier}`:

- Simple identifier keys: `getIPOBySlugKey` (`ipo:slug:${slug}`), `getIPODetailKey`
  (`ipo:detail:${slug}`), `getLatestGMPKey` (`gmp:latest:${ipoId}`), etc.
- Filter/query-object keys hash their params with `crypto.createHash('md5')` for a stable,
  collision-resistant key: `getIPOListKey`, `getIPOSearchKey`, `getFuzzySearchKey`.

A new cached read MUST call (or add) a generator in `cache-keys.ts` — MUST NOT build a key
inline. (Note: `web/lib/cache/cache-aside.ts` still inlines keys like `ipo:list:${filterHash}`
and uses a weaker `Buffer.from(...).base64` hash via `generateFilterHash`; do not follow it —
prefer the `crypto.createHash('md5')` generators in `cache-keys.ts`.)

## Invalidation — paired wildcard generators

Every entity has a paired `get<Entity>InvalidationKeys()` returning the wildcard patterns
to purge, consumed by `safeDelPattern` (`web/lib/cache/redis-client.ts`) via the helpers in
`web/lib/cache/invalidate.ts`. Examples: `getIPOInvalidationKeys` → `ipo:list:*`,
`getGMPInvalidationKeys` → `gmp:history:${ipoId}:*`, `getReviewInvalidationKeys` →
`reviews:ipo:${ipoId}*`. Cache-warming (`web/lib/cache/warm.ts`) writes the same keyed
entries. When you add a key generator you MUST add/extend its invalidation generator so
writes can purge it.

## TTLs — only from the `CacheTTL` SSOT map

TTLs come from the `CacheTTL` const map in `cache-keys.ts` (e.g. `CacheTTL.IPO_LISTINGS: 300`,
`CacheTTL.GMP_LATEST: 600`, `CacheTTL.HISTORICAL_DATA: 3600`). MUST NOT hard-code a TTL number.

WARNING — fragmentation to fix, not extend: `300` is currently triplicated across
`CacheTTL` (cache-keys.ts), `CACHE_TTL` (`web/lib/cache/warm.ts`), and ~7 inline
`const CACHE_TTL = 300` in services (`home-ipo-service.ts`, `mainboard-landing-service.ts`,
`mainboard-calendar-service.ts`, `ncd-service.ts`, `ofs-service.ts`, `rights-service.ts`,
`sme-landing-service.ts`). All TTL references MUST resolve to the `CacheTTL` SSOT; do not
add an eighth inline copy.

## ISR alignment — page `revalidate` MUST equal the backing Redis TTL

A Next.js list page's `export const revalidate = N` MUST equal the Redis TTL of the data
layer behind it (the `CacheTTL` comment literally reads "matches page ISR revalidation").
Verified examples: `web/app/page.tsx`, `web/app/mainboard-ipos/page.tsx`,
`web/app/sme-ipos/page.tsx` and ~13 list pages use `revalidate = 300`; detail/history/
prospectus pages use `600` / `3600` (`web/app/ipos/[slug]/page.tsx`, `web/app/history/page.tsx`,
`web/app/mainboard-ipo-prospectus/page.tsx`). `force-dynamic` + `revalidate = 0` is reserved
for non-cacheable routes only — `web/app/api/metrics`, `web/app/api/health-detailed`, and the
prospectus/reviews API routes. If you change one side (page ISR or Redis TTL), you MUST change
the other to match.

## CRITICAL RULES

- MUST generate every cache key via a `cache-keys.ts` generator (`web/lib/cache/cache-keys.ts` or `packages/shared/src/cache/cache-keys.ts`); MUST NOT inline key strings.
- MUST hash filter/query-object keys with `crypto.createHash('md5')` (as `getIPOListKey`/`getIPOSearchKey` do).
- MUST add/extend a paired `get<Entity>InvalidationKeys()` whenever you add a key generator, so writes can purge it via `safeDelPattern`.
- MUST source every TTL from the `CacheTTL` map in `cache-keys.ts`; MUST NOT hard-code a TTL number or add another inline `CACHE_TTL`.
- A list page's `export const revalidate = N` MUST equal its backing data-layer Redis TTL; changing one side requires changing the other.
- `force-dynamic` / `revalidate = 0` is reserved for genuinely non-cacheable routes (metrics, health-detailed, prospectus/reviews APIs).
