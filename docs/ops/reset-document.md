# reset-document CLI (W-158)

A manual `update documents set extraction_status='PENDING'` on staging stayed
invisible to the scraper for three cycles: `DocumentRepository.findByIPO`
(packages/shared) caches its result in Redis (`documents:<ipoId>`, TTL 3600s),
and the document cycle's selector + its extraction_failed tally both read
that cache. `scraper/scripts/reset-document.ts` resets the row AND drops the
cache key in one command, dry-run by default.

## Usage (from `scraper/`)

```bash
# dry run — prints before/after + the cache keys it WOULD invalidate
npx tsx scripts/reset-document.ts --document-id <uuid>

# apply: PENDING + retry_count=0 + extraction_error=null (default for --to PENDING)
npx tsx scripts/reset-document.ts --document-id <uuid> --apply

# resolve by IPO + doc type instead of a document id
npx tsx scripts/reset-document.ts --ipo <slug-or-uuid> --doc-type RHP --apply

# park it for manual review instead (retry history kept unless --clear-retries)
npx tsx scripts/reset-document.ts --document-id <uuid> --to MANUAL_REVIEW --apply
```

Refuses (exit 1, no writes) when: the id doesn't match a row, or `--ipo` +
`--doc-type` match more than one row. Refuses (exit 1) with `NODE_ENV=production`
unless `--allow-prod` is passed.

## Staging invocation (via the DB tunnel)

Open the SSH tunnel to the DB host per `vps-db-tunnel-setup` (localhost:15432),
then run with the tunnel-aware env:

```bash
cd scraper
DATABASE_URL="postgresql://ipodhan_app:<pwd>@localhost:15432/ipodhan_staging" \
  npx tsx scripts/reset-document.ts --ipo <slug> --doc-type RHP --apply
```

The script loads `../web/.env.local` (`override:true`) first, same convention
as `persist-filing.ts` — export `DATABASE_URL` in the shell to override that
file's value for the tunnel.

## What it invalidates

Exactly one key: `documents:<ipoId>` (`getDocumentsKey`, `packages/shared/src/cache/cache-keys.ts`).
`document_fetch_state` (the discovery-runner's per-doc-type state) is
deliberately never cached (see `document-fetch-state-repository.ts`'s header),
so no key exists for it. After invalidation the script re-reads the row
through `DocumentRepository.findByIPO` (not raw SQL) and prints it, so the
printed "AFTER" row is proof the cache miss served the fresh database row.
