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
#   The job name is accepted and logged as operator intent. It does NOT change
#   the lock (see the lock section below) and is NOT forwarded to the scraper,
#   because nothing in scraper/src parses a job flag today.

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
# pm2 passes DEPLOY_SLOT; cron does not. Only used to guess a venv path.
DEPLOY_SLOT_NAME="${DEPLOY_SLOT:-prod}"

# --- The 2-hour hung-process ceiling (OD-55) -------------------------------
# 7200 seconds. Overridable ONLY for the test harness; production never sets
# it. This is a crash guard, not a budget: nothing about a slow-but-
# progressing OCR pass should ever reach it.
SCRAPER_CEILING_SECONDS="${SCRAPER_CEILING_SECONDS:-7200}"

# --- Which lock this wake must read -----------------------------------------
# CRITICAL correction (Tier A review): this script must read the lock the job
# it is ABOUT TO START will actually take, not the lock of the phase we happen
# to care about. Getting that wrong is worse than having no check at all.
#
# What the wrapper starts is `src/index.ts --source=all`, and that acquires
# CYCLE_LOCK_RESOURCE = 'scraper:cycle' (scraper/src/index.ts:177, taken at
# :719) for the WHOLE cycle. The document/extraction lock
# 'filing-auto-persist:cycle' is an INNER lock held only during the extraction
# phase. Reading the inner lock to decide whether to start an outer cycle is a
# false-negative machine: during a running cycle's non-document phase the inner
# lock reads free, the wrapper starts a SECOND cycle, that cycle immediately
# exits 0 on the scraper:cycle lock it cannot get - and the wrapper then logs
# `wake-complete`, reporting SUCCESS for a wake that did nothing at all.
#
# So: one lock, the outer one, matching the one command this script runs.
#
# BUT THE DEPENDENCY IS FLAG-CONDITIONAL, and this comment previously stated it
# as an unconditional fact - which is how the next reader comes to trust a guard
# that is not there. `--source=all` acquires scraper:cycle ONLY when
# FEATURE_FLAGS.ENABLE_DUE_STEP_SCHEDULER is true (scraper/src/index.ts:751,
# and the flag is `process.env.ENABLE_DUE_STEP_SCHEDULER === 'true'`, so it is
# OFF unless explicitly set). With the flag OFF the cycle takes NO lock at all,
# this check reads free every time, and every wake starts a cycle.
#
# That is deliberately NOT treated as a failure here. It is the flag's own
# legacy behaviour, and it is a different thing from the bug this check exists
# to prevent: with the flag off there is no lock to contend for, so nothing is
# being misreported - unlike the old inner-lock read, which saw a FREE lock
# while a cycle WAS running and then logged success for a wake that did nothing.
# The honest summary: this skip is a real guard when the scheduler flag is on,
# and a no-op when it is off. The ceiling above is unconditional either way.
# `lock:resource:` is the prefix the distributed lock applies - the same
# fully-qualified spelling scripts/deploy-linux.sh's
# release_scraper_cycle_locks() uses, so the two cannot drift apart. Read
# only; never taken or released here - the cycle owns its own lock's lifetime.
#
# A job argument (data|live|closed) is ACCEPTED and logged for operator
# intent, but it deliberately does NOT change the lock and is NOT forwarded to
# the scraper: nothing in scraper/src parses `--job=` today (verified by grep),
# so passing it would be a fiction that reads like a feature. When the job
# split of design section 2.1 lands, this is where each job names both the
# command it runs and the lock that command takes - together, never apart.
# --check: run ONLY the resolution checks below and exit - never start a cycle.
# This is what the deploy calls, so the deploy's verdict and the wrapper's
# runtime refusal come from the SAME code and cannot drift apart.
SCRAPER_WAKE_CHECK_ONLY=0
if [ "${1:-}" = "--check" ]; then
  SCRAPER_WAKE_CHECK_ONLY=1
  shift
fi

SCRAPER_JOB="data"
case "${1:-}" in
  data|live|closed) SCRAPER_JOB="$1"; shift ;;
  "") : ;;
  --*) : ;;
  *) UNKNOWN_JOB="$1"; shift ;;
esac
if [ -n "${UNKNOWN_JOB:-}" ]; then
  log "WARN unknown-job: '$UNKNOWN_JOB' is not one of data|live|closed - proceeding with the default cycle"
fi

SCRAPER_LOCK_KEY="${SCRAPER_LOCK_KEY:-lock:resource:scraper:cycle}"

SCRAPER_SOURCE="${SCRAPER_SOURCE:-all}"

# --- The cron environment is NOT the pm2 environment ------------------------
# CRITICAL (Tier A review): cron runs this with PATH=/usr/bin:/bin, no login
# shell, no nvm rc, no cwd, and none of the variables every `pm2 start` in
# deploy-linux.sh injects deliberately. A bare `npx tsx` under cron therefore
# most likely resolves to NOTHING - the line fires, npx is not found, the log
# grows, nobody notices, and we have shipped a scheduler that never runs. That
# failure is silent in exactly the way this whole slice exists to prevent, so
# every input the scraper needs is resolved explicitly here and its absence is
# LOUD.
#
# TZ=UTC (T-327 P2-7) and PYTHON_BIN (W-111/W-112) are not optional niceties:
# an unset TZ is what made NSE dates land a day early for months, and an unset
# PYTHON_BIN silently falls back to whatever `python` resolves to instead of
# the deploy-managed venv. pm2 passes both at every start; cron passes neither.
export TZ="${TZ:-UTC}"

# PATH: keep anything the caller set (pm2 passes a full PATH), then append the
# standard locations plus the node that is actually running this deploy, so a
# cron invocation with the minimal PATH can still find its tools.
PATH="${PATH:-/usr/bin:/bin}:/usr/local/bin:/usr/local/sbin:/snap/bin"
export PATH

# node: prefer an explicit override, then whatever is on PATH. Resolved to an
# ABSOLUTE path so the value we log is the value that runs.
NODE_BIN="${SCRAPER_NODE_BIN:-}"
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi

# tsx: the workspace copy, wherever npm's hoisting actually put it (the same
# three candidate roots deploy-linux.sh's resolve_bin() searches). Never `npx`,
# which under cron would try to fetch from the network on a miss.
TSX_BIN="${SCRAPER_TSX_BIN:-}"
if [ -z "$TSX_BIN" ]; then
  for _cand in \
    "$SCRAPER_DIR/node_modules/tsx/dist/cli.mjs" \
    "$REPO_ROOT/node_modules/tsx/dist/cli.mjs" \
    "$REPO_ROOT/web/node_modules/tsx/dist/cli.mjs"; do
    if [ -f "$_cand" ]; then TSX_BIN="$_cand"; break; fi
  done
fi

# PYTHON_BIN: pins the PDF/OCR extractor to the deploy-managed venv. If the
# caller did not set it (cron does not), try the venv layout deploy-linux.sh
# creates, and say so plainly when it cannot be found - an ENOENT spawn is the
# visible signal, never a silent fallback to system python (W-111 round 2).
if [ -z "${PYTHON_BIN:-}" ]; then
  # SCRAPER_PYTHON_BIN_CANDIDATE is a TEST SEAM: it prepends one candidate so
  # the suite can exercise the resolve-THEN-EXPORT path without a real deploy
  # venv on disk. Production never sets it; the two real candidates are the
  # layout setup_python_venv() creates.
  for _cand in \
    "${SCRAPER_PYTHON_BIN_CANDIDATE:-/nonexistent/python}" \
    "$REPO_ROOT/../shared/venv/$DEPLOY_SLOT_NAME/bin/python" \
    "$REPO_ROOT/../../shared/venv/$DEPLOY_SLOT_NAME/bin/python"; do
    # No export here: the single `export PYTHON_BIN` below covers both this
    # resolved value and a caller-supplied one. Two exports meant a mutation
    # could delete one and survive, which reads as an untested guard when in
    # fact it was a redundant line.
    if [ -x "$_cand" ]; then PYTHON_BIN="$_cand"; break; fi
  done
fi
if [ -z "${PYTHON_BIN:-}" ]; then
  log "WARN no-python-bin: PYTHON_BIN is unset and no deploy venv was found - the PDF/OCR extractor will fall back to whatever 'python' resolves to, or fail to spawn. Set PYTHON_BIN in the cron line."
else
  export PYTHON_BIN
fi

# Both interpreters are hard requirements. Missing either means the cycle
# cannot run at all, and under cron that would otherwise be a silent no-op
# repeated every 30 minutes - so refuse LOUDLY and with a non-zero exit that
# is distinguishable from both a clean finish and the ceiling.
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  log "FATAL no-node: cannot find an executable node (PATH=$PATH). Under cron, PATH is minimal and nvm is not sourced - set SCRAPER_NODE_BIN to an absolute path in the cron line. Nothing was run."
  exit 78
fi
if [ -z "$TSX_BIN" ] || [ ! -f "$TSX_BIN" ]; then
  log "FATAL no-tsx: cannot find tsx/dist/cli.mjs under $SCRAPER_DIR or $REPO_ROOT - set SCRAPER_TSX_BIN in the cron line. Nothing was run."
  exit 78
fi

# The ceiling's own dependency, checked HERE (not only at launch) so --check
# covers every condition that can make a real wake refuse.
if ! command -v timeout >/dev/null 2>&1; then
  log "FATAL no-ceiling: GNU coreutils 'timeout' is not on PATH, so the 2-hour hung-process ceiling cannot be enforced. REFUSING - pm2 no longer restarts the scraper, so nothing else would stop a hung cycle. Install coreutils. Nothing was run."
  exit 78
fi

if [ "$SCRAPER_WAKE_CHECK_ONLY" -eq 1 ]; then
  # Every refusal condition above has passed. Report WHAT was resolved, not a
  # bare OK: the deploy log is where an operator later reconstructs which node
  # and which tsx this box actually resolved.
  log "check-ok: node=$NODE_BIN tsx=$TSX_BIN timeout=$(command -v timeout) TZ=$TZ PYTHON_BIN=${PYTHON_BIN:-<unset>}"
  exit 0
fi


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
  set -- "$NODE_BIN" "$TSX_BIN" src/index.ts --source="$SCRAPER_SOURCE" "$@"
else
  # Test seam ONLY: a path to an executable the suite substitutes for the
  # scraper (a sleeper, a fast exiter, a crasher). Deliberately a single
  # PATH and not a command line: a word-split command line cannot carry a
  # quoted argument, and silently mangling the job command is precisely the
  # class of bug this seam exists to let the suite catch in the real script.
  set -- "$SCRAPER_WAKE_CMD" "$@"
fi

if command -v timeout >/dev/null 2>&1; then
  # MINOR (Tier A review), handled defensively: GNU `timeout` signals only its
  # DIRECT child unless that child leads its own process group. The scraper
  # spawns a python PDF/OCR extractor, so on a ceiling trip that grandchild
  # could outlive the kill and keep burning a 2-vCPU box with nothing watching.
  #
  # `timeout --foreground` is NOT the fix here (it does the opposite - it
  # declines to create a new group). The fix is to put the job in its own
  # process group and signal the GROUP, which is exactly what `setsid` plus
  # timeout's own `--kill-after` gives: setsid makes the job a session/group
  # leader, so the signal timeout sends reaches the whole tree.
  #
  # UNVERIFIED ON LINUX: I could only exercise this on MSYS/Windows, where the
  # grandchild did NOT survive the ceiling - a result that says nothing about
  # Linux process groups. setsid is used because it is correct-by-construction
  # for the documented semantics, not because I reproduced the orphan here.
  # The staging soak is where a real ceiling trip can confirm no python
  # process outlives it.
  if command -v setsid >/dev/null 2>&1; then
    ( cd "$SCRAPER_DIR" && exec timeout --signal=TERM --kill-after=60 "$SCRAPER_CEILING_SECONDS" setsid "$@" )
  else
    log "WARN no-setsid: setsid not on PATH - the ceiling signals only the direct child, so a python extractor grandchild may outlive a ceiling trip. Check for stray processes after any ceiling-tripped line."
    ( cd "$SCRAPER_DIR" && exec timeout --signal=TERM --kill-after=60 "$SCRAPER_CEILING_SECONDS" "$@" )
  fi
  STATUS=$?
else
  # REFUSE, do not run unbounded. An earlier version ran the cycle anyway with
  # a warning, which quietly reintroduced exactly what this slice removes: a
  # scraper with nothing bounding it. Since pm2 no longer force-restarts at 30
  # minutes, an unbounded run here could hang indefinitely on a 2-vCPU box that
  # also serves the site. A missing coreutils on a deploy host is a defect to
  # fix, never a mode to degrade into - and refusing is loud, where a hang is
  # silent. Exit 78 (config error), distinct from clean 0 and the ceiling 124.
  log "FATAL no-ceiling: GNU coreutils 'timeout' is not on PATH, so the 2-hour hung-process ceiling cannot be enforced. REFUSING to start an unbounded cycle - pm2 no longer restarts the scraper, so nothing else would stop it. Install coreutils. Nothing was run."
  exit 78
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
