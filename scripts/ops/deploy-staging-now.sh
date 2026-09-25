#!/usr/bin/env bash
# The capped manual staging-deploy button (owner standing rule 2026-09-16,
# "staging deploys in windows, not per merge"). Run from a laptop/dev
# machine with `gh` authenticated against this repo.
#
# Staging now deploys only on two daily cron windows
# (scripts/ops/staging-window-deploy.sh) plus this manual button, capped at
# TWO dispatches per calendar day so an impatient "just deploy it" loop
# cannot recreate the per-push load this change removed. A THIRD dispatch
# the same day is refused (with the first two reasons printed) unless
# --override is given, and every override is logged as such in the state
# file - it is escape-hatch, not silent.
#
# Usage:
#   deploy-staging-now.sh --reason "<text>" [--override] [--dry-run]
#
# --reason "<text>"  required; recorded with the dispatch.
# --override         bypass the 2/day cap (still logged, loudly, as an override).
# --dry-run          print the gh command that WOULD be dispatched; does not
#                     dispatch and does not touch the per-day counter.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/ist-day.sh
source "$SCRIPT_DIR/lib/ist-day.sh"

REPO="${STAGING_NOW_REPO:-abhayla/IPODhan}"
GH_BIN="${GH_BIN:-gh}"
STATE_DIR="${STAGING_NOW_STATE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/ops/state}"
DAILY_CAP=2

REASON=""
OVERRIDE=0
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --reason)
      REASON="${2:-}"
      shift 2
      ;;
    --reason=*)
      REASON="${1#--reason=}"
      shift
      ;;
    --override)
      OVERRIDE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      echo "FATAL: unknown argument '$1'" >&2
      exit 2
      ;;
  esac
done

if [ -z "$REASON" ]; then
  echo "FATAL: --reason \"<text>\" is required - the manual button is capped and every dispatch (and every refusal) is attributed to a reason." >&2
  exit 1
fi

GH_CMD=("$GH_BIN" workflow run deploy-linux.yml --repo "$REPO" --ref main -f slot=staging -f mode=manual)

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s\n' "${GH_CMD[*]}"
  exit 0
fi

mkdir -p "$STATE_DIR"
# #1064: keyed on the IST calendar day, not the UTC one - a UTC day reset
# the 2/day cap at 05:30 IST instead of midnight IST (this PR's own sweep
# grep missed this quoted `date -u` form). STAGING_NOW_NOW (epoch seconds)
# lets a test inject the clock instead of reading the real one.
TODAY="$(ist_day_from_epoch "${STAGING_NOW_NOW:-$(date +%s)}")"
STATE_FILE="$STATE_DIR/staging-now-$TODAY.json"

# Minimal JSON array of {ts, reason, override} objects, read/written with
# node so this script has no jq dependency. Corrupt/missing state reads as
# empty rather than failing the button.
read_dispatches() {
  node -e '
    const fs = require("fs");
    const [file] = process.argv.slice(1);
    let out = "[]";
    try {
      const raw = fs.readFileSync(file, "utf8");
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) { out = JSON.stringify(arr); }
    } catch {}
    console.log(out);
  ' "$STATE_FILE"
}

EXISTING_JSON="$(read_dispatches)"
COUNT="$(node -e 'console.log(JSON.parse(process.argv[1]).length)' "$EXISTING_JSON")"

if [ "$COUNT" -ge "$DAILY_CAP" ] && [ "$OVERRIDE" -ne 1 ]; then
  echo "REFUSED: this is dispatch #$((COUNT + 1)) for $TODAY - the manual button is capped at $DAILY_CAP/day." >&2
  echo "Earlier reasons today:" >&2
  node -e '
    const arr = JSON.parse(process.argv[1]);
    for (const d of arr) {
      console.error(` - ${d.ts}: ${d.reason}${d.override ? " (override)" : ""}`);
    }
  ' "$EXISTING_JSON"
  echo "Pass --override to dispatch anyway (this is logged as an override)." >&2
  exit 1
fi

TS="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
UPDATED_JSON="$(node -e '
  const [existing, ts, reason, override] = process.argv.slice(1);
  const arr = JSON.parse(existing);
  arr.push({ ts, reason, override: override === "1" });
  console.log(JSON.stringify(arr, null, 2));
' "$EXISTING_JSON" "$TS" "$REASON" "$OVERRIDE")"
printf '%s\n' "$UPDATED_JSON" > "$STATE_FILE"

if [ "$OVERRIDE" -eq 1 ] && [ "$COUNT" -ge "$DAILY_CAP" ]; then
  echo "OVERRIDE: dispatching beyond the $DAILY_CAP/day cap (dispatch #$((COUNT + 1)) for $TODAY)."
fi

echo "Dispatching: ${GH_CMD[*]}"
"${GH_CMD[@]}"

echo "Most recent deploy-linux.yml run:"
"$GH_BIN" run list --repo "$REPO" --workflow deploy-linux.yml --limit 1
