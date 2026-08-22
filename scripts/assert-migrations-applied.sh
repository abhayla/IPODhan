#!/usr/bin/env bash
# T-267 — migrations-applied assert, run by scripts/deploy-linux.sh AFTER
# `drizzle-kit migrate`. Fails loudly (names the gap) rather than letting a
# release flip live against a database that never actually picked up the
# journaled schema — that is exactly the T-139/T-263/T-264 lesson: the Linux
# deploy pipeline never ran migrations at all, `drizzle.__drizzle_migrations`
# sat at 0 rows in prod for the app's whole life, and a NOT NULL drift on
# listing_performance silently failed 243/243 upserts every cycle for seven
# weeks before anyone noticed (nothing checked that migrations had landed).
#
# WHAT IT CHECKS
# --------------
# drizzle-kit's own migrate() (node_modules/drizzle-kit/api.js) decides what
# counts as "new" by comparing MAX(created_at) in drizzle.__drizzle_migrations
# against each journal entry's `when` — nothing else (the `hash` column is
# stored but never compared). This assert mirrors that exact decision: it
# reads the newest `when` across every entry in the target release's
# meta/_journal.json, queries the newest `created_at` actually recorded in
# the target DB's drizzle.__drizzle_migrations, and FAILS if the DB is older
# than the journal — i.e. if a journaled migration exists that migrate()
# itself would still consider unapplied.
#
# This intentionally does NOT try to enumerate individual gated/repair files
# under web/drizzle/migrations/_gated or _repair — those are deliberately
# excluded from meta/_journal.json and applied by hand under a separate
# sign-off gate (.claude/rules/drizzle-migration-gated-ddl.md). Only the
# journaled chain is this assert's concern; that is also the only chain
# `drizzle-kit migrate` itself ever touches.
#
# Usage: scripts/assert-migrations-applied.sh <DATABASE_URL> <journal-json-path>

set -euo pipefail

usage() {
  echo "Usage: $0 <DATABASE_URL> <journal-json-path>" >&2
  exit 2
}

if [ "$#" -ne 2 ]; then
  usage
fi

DATABASE_URL="$1"
JOURNAL_PATH="$2"

if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: DATABASE_URL argument is empty." >&2
  exit 1
fi

if [ ! -f "$JOURNAL_PATH" ]; then
  echo "FATAL: journal file not found: $JOURNAL_PATH" >&2
  exit 1
fi

MAX_JOURNAL_MS="$(node -e '
  const fs = require("fs");
  const journal = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const entries = Array.isArray(journal.entries) ? journal.entries : [];
  const max = entries.reduce((m, e) => Math.max(m, Number(e.when) || 0), 0);
  process.stdout.write(String(max));
' "$JOURNAL_PATH")"

case "$MAX_JOURNAL_MS" in
  ''|0|*[!0-9]*)
    echo "FATAL: could not determine a newest migration timestamp from $JOURNAL_PATH (got '$MAX_JOURNAL_MS')." >&2
    exit 1
    ;;
esac

DB_MAX_RAW="$(psql "$DATABASE_URL" -tA -c \
  "SELECT COALESCE(MAX(created_at), 0) FROM drizzle.__drizzle_migrations;" 2>&1)" \
  || {
    echo "FATAL: could not query drizzle.__drizzle_migrations on the target DB:" >&2
    echo "$DB_MAX_RAW" >&2
    exit 1
  }

DB_MAX_MS="$(printf '%s' "$DB_MAX_RAW" | tr -d '[:space:]')"

case "$DB_MAX_MS" in
  ''|*[!0-9]*)
    echo "FATAL: unexpected response querying drizzle.__drizzle_migrations: $DB_MAX_RAW" >&2
    exit 1
    ;;
esac

if [ "$DB_MAX_MS" -lt "$MAX_JOURNAL_MS" ]; then
  echo "FATAL: journaled migrations are unapplied on the target DB — deploy refused." >&2
  echo "       newest journaled migration timestamp:  $MAX_JOURNAL_MS" >&2
  echo "       newest applied (drizzle.__drizzle_migrations.created_at): $DB_MAX_MS" >&2
  echo "       'npx drizzle-kit migrate' either failed or the target DB was never" >&2
  echo "       baselined — see web/drizzle/migrations/_repair/ for the baseline" >&2
  echo "       pattern (T-267) before re-running the full journal against a live DB." >&2
  exit 1
fi

echo "OK: drizzle.__drizzle_migrations is current (newest applied $DB_MAX_MS >= newest journaled $MAX_JOURNAL_MS)"
