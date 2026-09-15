#!/bin/sh
#
# scraper-wake.sh - the wake wrapper (item 7 slice 1).
#
# WHAT INVOKES THIS: pm2 (and, once the pull-model job table of design section
# 2.1 lands, cron) starts THIS script instead of calling the scraper CLI
# directly. It then invokes the scraper. Two things it adds that calling the
# CLI directly cannot:
#
#   1. LOCK-SKIP. A wake never starts a walk while the job's own Redis lock is
#      held by a still-running cycle. Design section 2.1's rule for both locks
#      is "skip this occurrence and log the skip with the holder's start time;
#      it never kills, never queues, never waits". The skip line is the PROOF
#      ARTIFACT: a silent skip is indistinguishable from a wake that never
#      fired, which is a failure class this project has hit repeatedly
#      (signal-ownership.md R1 - a count is not a reading; the line carries the
#      lock key and the remaining TTL so the reading is an identity, not a bare
#      "skipped").
#
#   2. CEILING. The document job is wrapped in `timeout` at 2 hours, as an
#      EXTERNAL SUPERVISOR of the scraper process. Per OD-55 as corrected by
#      PR #644: a spawn timeout inside the extractor bounds only the CHILD
#      process - a hung parent wedges the extractor with nothing watching it.
#      The supervisor here is the parent's parent, so it bounds the thing the
#      spawn timeout cannot.
#
# WHY THE CEILING HAD TO ARRIVE IN THE SAME CHANGE AS --cron-restart GOING:
# until this script exists, pm2's --cron-restart="*/30 * * * *" is the ONLY
# thing bounding a hung scraper - it restarts the process every 30 minutes
# regardless of what it is doing. That flag is what made OD-55's "let the
# scraper take whatever time it needs" impossible, and it is removed in
# scripts/deploy-linux.sh in this same commit. Removing it without this
# wrapper would leave a runaway job with nothing stopping it at all.
#
# PORTABILITY: POSIX sh (dash), not bash - the deploy host runs this
# non-interactively and /bin/sh is dash on Debian/Ubuntu. No arrays, no
# [[ ]], no `local`, no bashisms.
# CWD-INDEPENDENT: every path is derived from this script's own location, so
# pm2 or cron may invoke it from anywhere.
#
# EXIT CODES - a clean finish, a ceiling trip and a crash are three distinct
# readings, never collapsed into one:
#   0   the job ran and finished cleanly, OR the wake skipped on a held lock
#       (a skip is a correct, expected outcome, not a failure - but it is
#       never silent: it always prints its reason line)
#   124 the 2-hour ceiling fired and the job was terminated (GNU coreutils
#       `timeout`'s own convention, preserved deliberately so an operator
#       reading a pm2 exit code sees the standard "timed out" value)
#   *   anything else is the job's own exit status - a crash, propagated
#
# Usage: scripts/scraper-wake.sh [data|live|closed] [<extra scraper args>]
#   The job name selects which lock is read and which --job= flag is passed on.
#   Omitted, it defaults to `data` (the document/heavy job) - the conservative
#   default, because that is the job the ceiling exists for.

set -u

log() {
  printf '%s scraper-wake: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1"
}


SCRIPT_PATH="$0"
# Resolve one level of symlink without readlink -f (not portable to every sh).
if [ -L "$SCRIPT_PATH" ]; then
  SCRIPT_PATH="$(readlink "$SCRIPT_PATH")"
fi
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRAPER_DIR="${SCRAPER_DIR:-$REPO_ROOT/scraper}"

# --- The 2-hour hung-process ceiling (OD-55) -------------------------------
# 7200 seconds. Overridable ONLY for the test harness; production never sets
# it. This is a crash guard, not a budget: nothing about a slow-but-
# progressing OCR pass should ever reach it.
SCRAPER_CEILING_SECONDS="${SCRAPER_CEILING_SECONDS:-7200}"

# --- Which job, and therefore which lock ------------------------------------
# `data` (the heavy/document job) is the default: it is the job the ceiling
# exists for, so an unqualified wake gets the conservative treatment.
SCRAPER_JOB="data"
case "${1:-}" in
  data|live|closed) SCRAPER_JOB="$1"; shift ;;
  "") : ;;
  --*) : ;;                 # a bare flag: leave it for the scraper, keep the default job
  *) UNKNOWN_JOB="$1"; shift ;;
esac
if [ -n "${UNKNOWN_JOB:-}" ]; then
  # Loud, not fatal: an unrecognised job name must not silently become a
  # different job's wake. It is reported with the name that was passed, and
  # the conservative default (data) runs.
  log "WARN unknown-job: '$UNKNOWN_JOB' is not one of data|live|closed - defaulting to job=data and its lock"
fi

# The locks this script READS are mirrored from the two that already exist -
# never a second locking scheme, and never taken or released here: each cycle
# owns its own lock's lifetime.
#   scraper:cycle              - the whole-cycle lock (scraper/src/index.ts:177,
#                                CYCLE_LOCK_RESOURCE)
#   filing-auto-persist:cycle  - the document/extraction lock
#                                (scraper/src/services/document-cycle.ts:75,
#                                FILING_EXTRACTION_LOCK_KEY)
# `lock:resource:` is the prefix the distributed lock applies - the same two
# fully-qualified keys scripts/deploy-linux.sh's release_scraper_cycle_locks()
# reads, so this script and that one cannot drift apart on key spelling.
#
# A `data` wake reads the DOCUMENT lock: that is the one a long filing read
# holds, and the whole point of the skip. A `live` wake reads the whole-cycle
# lock only - per OD-27 the live-figures job must NEVER be gated on the heavy
# lock, so reading the document lock here would reintroduce exactly the
# coupling the two-lock split exists to prevent.
if [ -n "${SCRAPER_LOCK_KEY:-}" ]; then
  : # explicit operator override wins
elif [ "$SCRAPER_JOB" = "live" ]; then
  SCRAPER_LOCK_KEY="lock:resource:scraper:cycle"
else
  SCRAPER_LOCK_KEY="lock:resource:filing-auto-persist:cycle"
fi

SCRAPER_SOURCE="${SCRAPER_SOURCE:-all}"

# --- Read the lock ---------------------------------------------------------
# Returns 0 (held) or 1 (free / unknowable). An UNKNOWABLE lock state is
# deliberately treated as FREE, not as held: redis-cli missing or Redis
# unreachable must not silently stop every wake forever (a fail-closed read
# here would be a self-inflicted outage whose only symptom is the scraper
# quietly never running - precisely the silent-skip class this wrapper exists
# to eliminate). It is logged loudly either way.
LOCK_TTL=""
lock_is_held() {
  if [ -n "${SCRAPER_WAKE_FAKE_LOCK_TTL:-}" ]; then
    # Test seam ONLY. Production never sets this; it lets the shell suite
    # drive both branches without a Redis.
    if [ "$SCRAPER_WAKE_FAKE_LOCK_TTL" = "free" ]; then
      return 1
    fi
    LOCK_TTL="${SCRAPER_WAKE_FAKE_LOCK_TTL}s remaining"
    return 0
  fi

  if ! command -v redis-cli >/dev/null 2>&1; then
    log "WARN lock-read-unavailable: redis-cli not on PATH; cannot read $SCRAPER_LOCK_KEY - proceeding (fail-open, see header)"
    return 1
  fi

  redis_url="${REDIS_URL:-}"
  if [ -z "$redis_url" ] && [ -f "$SCRAPER_DIR/.env" ]; then
    redis_url="$(grep -E '^REDIS_URL=' "$SCRAPER_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
    redis_url="${redis_url%\"}"
    redis_url="${redis_url#\"}"
    redis_url="${redis_url%\'}"
    redis_url="${redis_url#\'}"
  fi
  if [ -z "$redis_url" ]; then
    log "WARN lock-read-unavailable: no REDIS_URL in env or $SCRAPER_DIR/.env - proceeding (fail-open, see header)"
    return 1
  fi

  ttl="$(redis-cli -t 3 -u "$redis_url" TTL "$SCRAPER_LOCK_KEY" 2>/dev/null || true)"
  # TTL semantics: -2 = key does not exist, -1 = exists with no expiry,
  # >0 = seconds remaining. Only -2 (and 0) mean free. A -1 (a lock with no
  # TTL, i.e. a leaked lock that will never expire on its own) counts as HELD
  # and says so - treating it as free is how two cycles end up overlapping.
  case "$ttl" in
    -2) return 1 ;;
    -1) LOCK_TTL="-1 (no expiry set - leaked lock, will not self-clear)"; return 0 ;;
    0) return 1 ;;
    ''|*[!0-9-]*)
      log "WARN lock-read-unavailable: unreadable TTL for $SCRAPER_LOCK_KEY (got '$ttl') - proceeding (fail-open, see header)"
      return 1
      ;;
    *) LOCK_TTL="${ttl}s remaining"; return 0 ;;
  esac
}

if lock_is_held; then
  # THE SKIP LINE. Greppable on a stable token ("wake-skipped"), and carrying
  # the identity (the lock key) and the number (remaining TTL) rather than a
  # bare "skipped" - signal-ownership.md R1.
  log "wake-skipped: job=$SCRAPER_JOB - a cycle is already running and holds the lock; this occurrence is skipped, not queued and not killed. lock_key=$SCRAPER_LOCK_KEY lock_ttl=$LOCK_TTL"
  exit 0
fi

log "wake-starting: job=$SCRAPER_JOB, lock $SCRAPER_LOCK_KEY is free; starting a cycle under a ${SCRAPER_CEILING_SECONDS}s hung-process ceiling (OD-55)"

# --- Run the job under the external ceiling --------------------------------
# `timeout` is the external supervisor: it is the PARENT of the scraper, so it
# bounds the parent process that an in-extractor spawn timeout cannot see.
#   --signal=TERM gives the cycle its own shutdown path first (scraper/src/
#     index.ts's signal handler releases the held lock - W-140), so a ceiling
#     trip does not leak the lock and wedge every subsequent wake.
#   --kill-after=60 is the backstop for a process too wedged to honour TERM.
STARTED_AT="$(date -u '+%s')"

if [ -z "${SCRAPER_WAKE_CMD:-}" ]; then
  # Production shape: the same tsx entrypoint pm2 used to start directly.
  set -- npx tsx src/index.ts --source="$SCRAPER_SOURCE" --job="$SCRAPER_JOB" "$@"
else
  # Test seam ONLY: a path to an executable the suite substitutes for the
  # scraper (a sleeper, a fast exiter, a crasher). Deliberately a single
  # PATH and not a command line: a word-split command line cannot carry a
  # quoted argument, and silently mangling the job command is precisely the
  # class of bug this seam exists to let the suite catch in the real script.
  set -- "$SCRAPER_WAKE_CMD" "$@"
fi

if command -v timeout >/dev/null 2>&1; then
  ( cd "$SCRAPER_DIR" && exec timeout --signal=TERM --kill-after=60 "$SCRAPER_CEILING_SECONDS" "$@" )
  STATUS=$?
else
  log "WARN no-ceiling: GNU coreutils 'timeout' not found on PATH - the cycle runs UNBOUNDED. On a deploy host this is a defect, not a fallback; install coreutils."
  ( cd "$SCRAPER_DIR" && exec "$@" )
  STATUS=$?
fi

ELAPSED=$(( $(date -u '+%s') - STARTED_AT ))

if [ "$STATUS" -eq 124 ]; then
  # THE CEILING LINE. Distinguishable from both a clean finish and a crash, by
  # its own greppable token and by exit code 124.
  log "ceiling-tripped: the 2-hour hung-process ceiling fired and the cycle was terminated. elapsed=${ELAPSED}s ceiling=${SCRAPER_CEILING_SECONDS}s lock_key=$SCRAPER_LOCK_KEY exit=124"
  exit 124
fi

if [ "$STATUS" -ne 0 ]; then
  log "wake-failed: the cycle exited non-zero on its own (NOT the ceiling - the ceiling exits 124). elapsed=${ELAPSED}s exit=$STATUS"
  exit "$STATUS"
fi

log "wake-complete: the cycle finished cleanly well inside the ceiling. elapsed=${ELAPSED}s ceiling=${SCRAPER_CEILING_SECONDS}s"
exit 0
