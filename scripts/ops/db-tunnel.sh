#!/usr/bin/env bash
# scripts/ops/db-tunnel.sh — owned start/stop for the prod-DB SSH tunnel (127.0.0.1:15432).
#
# RCA (2026-09-25, reproduced twice at 16:09 and 17:11 IST): the tunnel was being started as a
# harness background task (`ssh ... -N -L 15432:localhost:5432 ...` launched directly by the
# session harness). Under Git Bash (MSYS) the Windows process that launched /usr/bin/ssh exits
# immediately, so ssh ends up with NO live Windows parent. The harness's TaskStop kills a task by
# walking the Windows process tree from the task's own PID; with no parent link to walk, it never
# reaches ssh, so the port is left open across sessions. `kill <msys pid>` on the actual ssh process
# closes it cleanly (measured: listener count 1 -> 0).
#
# This script is the fix at the class level: every open of this tunnel from a Claude session in
# this repo goes through `start`, which records who owns it, and `stop`, which can only be run by
# that owner (or with --force) and verifies the port is actually closed afterward.
#
# Round 2 (reviewer findings on PR #1080): `stop` MUST NEVER kill a process it did not launch and
# does not currently own. It kills the recorded WINPID ONLY when that exact WINPID is (a) the one
# currently LISTENING on 127.0.0.1:$PORT per netstat AND (b) an ssh process per `ps -W`. Any other
# ssh process that happens to be listening on the port is a LEFTOVER, not this session's tunnel,
# and is only ever touched by the explicit human command `stop --leftover` — the hook never calls
# that. A second class fixed this round: two `start` calls racing (e.g. two sessions opening at
# once) could both pass the "nothing listening yet" check before either had bound the port; `start`
# now takes an exclusive `mkdir`-based lock (atomic on every POSIX and MSYS filesystem) around the
# whole check -> launch -> record sequence, with a stale-lock timeout so a crashed holder cannot
# wedge every future start.
#
# State file: ~/.claude/.ipodhan-db-tunnel.json — deliberately OUTSIDE the repo/worktree so every
# worktree and every session on this machine sees the same tunnel state (there is only ever one
# tunnel to 127.0.0.1:15432 regardless of which worktree opened it).
#
# The netstat / ps / kill calls are overridable via DB_TUNNEL_NETSTAT / DB_TUNNEL_PS /
# DB_TUNNEL_KILL so the decision logic (which is the part worth testing) can run against stub
# scripts in CI, with no network and no real ssh/tunnel/Windows host required.
#
# Usage:
#   bash scripts/ops/db-tunnel.sh start
#   bash scripts/ops/db-tunnel.sh stop [--force]
#   bash scripts/ops/db-tunnel.sh stop --leftover   # human-only: reap an UNCLAIMED ssh listener
#   bash scripts/ops/db-tunnel.sh status
set -u

PORT=15432
REMOTE_HOST="Administrator@103.118.16.189"
SSH_KEY="${DB_TUNNEL_SSH_KEY:-$HOME/.ssh/ipodhan_vps}"
STATE_FILE="${DB_TUNNEL_STATE_FILE:-$HOME/.claude/.ipodhan-db-tunnel.json}"
LOG_FILE="${DB_TUNNEL_LOG_FILE:-$HOME/.claude/.ipodhan-db-tunnel.log}"
LOCK_DIR="${DB_TUNNEL_LOCK_DIR:-$HOME/.claude/.ipodhan-db-tunnel.lock}"
WAIT_SECS="${DB_TUNNEL_WAIT_SECS:-20}"
LOCK_STALE_SECS="${DB_TUNNEL_LOCK_STALE_SECS:-60}"

# Overridable so tests can stub out the Windows-only tooling.
NETSTAT_CMD="${DB_TUNNEL_NETSTAT:-netstat}"
PS_CMD="${DB_TUNNEL_PS:-ps}"
KILL_CMD="${DB_TUNNEL_KILL:-taskkill}"

owner_session() {
  # CLAUDE_CODE_SESSION_ID is set by the harness inside a Claude Code session; outside one
  # (a human running this by hand) there is no such session, so the owner is "manual".
  if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
    printf '%s' "$CLAUDE_CODE_SESSION_ID"
  else
    printf 'manual'
  fi
}

# Portable JSON field reader (stdlib-free): reads one top-level string/number field by name.
json_get() {
  local file="$1" field="$2"
  [ -f "$file" ] || return 1
  python3 -c "
import json,sys
try:
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        d = json.load(f)
except Exception:
    sys.exit(1)
v = d.get(sys.argv[2])
if v is None:
    sys.exit(1)
print(v)
" "$file" "$field" 2>/dev/null
}

listener_winpids() {
  # Windows PID(s) currently LISTENING on 127.0.0.1:$PORT, one per line.
  $NETSTAT_CMD -ano 2>/dev/null | grep -i "LISTENING" | grep -i ":$PORT " | awk '{print $NF}' | sort -u
}

msys_pid_alive() {
  # $1 = msys PID. Alive if `kill -0` succeeds.
  kill -0 "$1" 2>/dev/null
}

is_ssh_winpid() {
  # $1 = Windows PID. Exit 0 iff `ps -W`'s WINPID column has a row for this PID whose command
  # mentions ssh. This is the ONLY test that authorizes killing a Windows process by PID.
  $PS_CMD -W 2>/dev/null | awk -v w="$1" '
    NR==1 { next }
    $4==w && $0 ~ /ssh/ { found=1 }
    END { exit !found }
  '
}

msys_pid_for_winpid() {
  # $1 = Windows PID. Prints the msys PID of the row whose WINPID column matches and whose
  # command mentions ssh, or nothing. Measured 2026-09-25: `$!` from `nohup ssh ... &` is
  # SOMETIMES the ssh process's own msys PID and sometimes an intermediate wrapper's — the one
  # thing that is always reliable is that the socket's owning Windows PID (from netstat) matches
  # the WINPID column of the ssh row in `ps -W`. Resolve backward from there instead of trusting
  # the parent/child relationship of `$!`.
  $PS_CMD -W 2>/dev/null | awk -v w="$1" '
    NR==1 { next }
    $4==w && $0 ~ /ssh/ { print $1; found=1 }
    END { if (!found) exit 1 }
  '
}

is_winpid_listening() {
  # $1 = Windows PID. Exit 0 iff it appears in the CURRENT listener set for $PORT.
  local w
  for w in $(listener_winpids); do
    [ "$w" = "$1" ] && return 0
  done
  return 1
}

kill_winpid() {
  # $1 = Windows PID. The only place in this script that kills anything. Callers MUST have
  # already proven both is_winpid_listening and is_ssh_winpid for this exact PID.
  $KILL_CMD //PID "$1" //F >/dev/null 2>&1
}

acquire_lock() {
  # LOCK_STALE_SECS governs when a held lock is considered abandoned (crashed holder) and is
  # reclaimed. DB_TUNNEL_LOCK_WAIT_SECS is how long THIS call is willing to wait for a
  # currently-live (not-yet-stale) holder before giving up — defaults to the same value in
  # production, but tests override it independently so a "lock genuinely held" case can refuse
  # quickly without also having to wait out the full staleness window.
  local wait_limit="${DB_TUNNEL_LOCK_WAIT_SECS:-$LOCK_STALE_SECS}"
  local waited=0
  while true; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      date +%s >"$LOCK_DIR/created_at" 2>/dev/null
      printf '%s' "$$" >"$LOCK_DIR/pid" 2>/dev/null
      return 0
    fi
    if [ -f "$LOCK_DIR/created_at" ]; then
      local created now age
      created="$(cat "$LOCK_DIR/created_at" 2>/dev/null || echo 0)"
      now="$(date +%s)"
      age=$((now - created))
      if [ "$age" -ge "$LOCK_STALE_SECS" ]; then
        echo "lock: removing stale start-lock (${age}s old)" >&2
        rm -rf "$LOCK_DIR" 2>/dev/null
        continue
      fi
    fi
    if [ "$waited" -ge "$wait_limit" ]; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

release_lock() {
  rm -rf "$LOCK_DIR" 2>/dev/null
}

do_status() {
  local winpids
  winpids="$(listener_winpids)"
  if [ -z "$winpids" ]; then
    echo "status: no listener on 127.0.0.1:$PORT"
    return 0
  fi
  echo "status: listener winpid(s) on 127.0.0.1:$PORT: $winpids"
  if [ -f "$STATE_FILE" ]; then
    local owner pid started
    owner="$(json_get "$STATE_FILE" owner)"
    pid="$(json_get "$STATE_FILE" msys_pid)"
    started="$(json_get "$STATE_FILE" started_at)"
    if [ -n "$pid" ] && msys_pid_alive "$pid"; then
      echo "owner: $owner (msys pid $pid, started $started) — recorded and alive"
    else
      echo "owner: $owner (msys pid $pid, started $started) — recorded but msys pid is DEAD (state is stale)"
    fi
  else
    echo "owner: unowned leftover — no state file matches this listener"
  fi
  return 0
}

do_start() {
  if ! acquire_lock; then
    echo "refuse: could not acquire the start lock within ${LOCK_STALE_SECS}s (another start is in progress); try again shortly" >&2
    return 2
  fi
  trap 'release_lock' RETURN

  local winpids
  winpids="$(listener_winpids)"
  if [ -n "$winpids" ]; then
    if [ -f "$STATE_FILE" ]; then
      local owner pid
      owner="$(json_get "$STATE_FILE" owner)"
      pid="$(json_get "$STATE_FILE" msys_pid)"
      if [ "$owner" = "$(owner_session)" ] && [ -n "$pid" ] && msys_pid_alive "$pid"; then
        echo "reuse: tunnel already open and owned by this session (msys pid $pid)"
        return 0
      fi
      echo "refuse: tunnel already open, owned by '$owner' (msys pid ${pid:-unknown}, started $(json_get "$STATE_FILE" started_at))" >&2
      return 2
    fi
    echo "refuse: tunnel already open (winpid $winpids), no state file — unowned leftover; run 'status' then 'stop --leftover' if you intend to take it over" >&2
    return 2
  fi

  mkdir -p "$(dirname "$STATE_FILE")"
  : >"$LOG_FILE"
  nohup ssh -i "$SSH_KEY" \
    -o BatchMode=yes -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes \
    -o StrictHostKeyChecking=accept-new \
    -N -L "$PORT:localhost:5432" "$REMOTE_HOST" >"$LOG_FILE" 2>&1 &
  local wrapper_pid=$!
  disown "$wrapper_pid" 2>/dev/null

  local waited=0 ssh_msys_pid="" ssh_winpid=""
  while [ "$waited" -lt "$WAIT_SECS" ]; do
    winpids="$(listener_winpids)"
    if [ -n "$winpids" ]; then
      ssh_winpid="$(printf '%s\n' "$winpids" | head -1)"
      ssh_msys_pid="$(msys_pid_for_winpid "$ssh_winpid")"
      [ -n "$ssh_msys_pid" ] && break
    fi
    sleep 1
    waited=$((waited + 1))
  done

  if [ -z "$ssh_msys_pid" ]; then
    kill "$wrapper_pid" 2>/dev/null
    winpids="$(listener_winpids)"
    if [ -n "$winpids" ]; then
      # Something else is now listening on the port. Never adopt or overwrite whatever that
      # is — report it and leave without writing state.
      echo "refuse: port $PORT is now occupied by winpid(s) $winpids that this start did not launch as ssh; not adopting, not writing state. Run 'status' to see the current owner." >&2
      return 2
    fi
    echo "fail: no listener on 127.0.0.1:$PORT after ${WAIT_SECS}s; ssh log follows:" >&2
    cat "$LOG_FILE" >&2
    return 1
  fi

  local owner started
  owner="$(owner_session)"
  started="$(date '+%Y-%m-%d %H:%M:%S %z')"

  python3 -c "
import json,sys
d = {
    'owner': sys.argv[1],
    'msys_pid': int(sys.argv[2]),
    'winpid': int(sys.argv[3]),
    'wrapper_msys_pid': int(sys.argv[4]),
    'started_at': sys.argv[5],
    'port': int(sys.argv[6]),
}
with open(sys.argv[7], 'w', encoding='utf-8') as f:
    json.dump(d, f)
" "$owner" "$ssh_msys_pid" "$ssh_winpid" "$wrapper_pid" "$started" "$PORT" "$STATE_FILE"

  echo "start: ok — owner=$owner ssh_msys_pid=$ssh_msys_pid winpid=$ssh_winpid listening on 127.0.0.1:$PORT"
  return 0
}

do_stop() {
  local force=0
  [ "${1:-}" = "--force" ] && force=1

  if [ ! -f "$STATE_FILE" ]; then
    local winpids
    winpids="$(listener_winpids)"
    if [ -z "$winpids" ]; then
      echo "stop: nothing listening, nothing recorded — already stopped"
      return 0
    fi
    echo "refuse: no state file for the listener(s) on 127.0.0.1:$PORT (winpid(s) $winpids) — this is an unowned leftover, not this session's tunnel; not killing anything. Use 'stop --leftover' (human-only) if you intend to reap it." >&2
    return 2
  fi

  local owner pid winpid
  owner="$(json_get "$STATE_FILE" owner)"
  pid="$(json_get "$STATE_FILE" msys_pid)"
  winpid="$(json_get "$STATE_FILE" winpid)"

  if [ "$force" -ne 1 ] && [ "$owner" != "$(owner_session)" ]; then
    echo "refuse: tunnel is owned by '$owner', this session is '$(owner_session)'; use --force to stop it anyway" >&2
    return 2
  fi

  if [ -z "$winpid" ]; then
    echo "refuse: state file has no recorded winpid; not killing anything. Inspect with 'status'." >&2
    return 2
  fi

  if ! is_winpid_listening "$winpid"; then
    # The recorded winpid is not the (or not a) current listener: the state is stale, e.g. the
    # process died and the port is free, or something ELSE now holds the port. Either way this
    # is never a reason to kill whatever IS currently listening.
    local current
    current="$(listener_winpids)"
    echo "refuse: recorded winpid $winpid is not currently listening on 127.0.0.1:$PORT (current listener(s): ${current:-none}); not killing anything." >&2
    if [ -z "$pid" ] || ! msys_pid_alive "$pid"; then
      rm -f "$STATE_FILE"
      echo "note: stale state file removed — recorded process is not alive either" >&2
    fi
    if [ -n "$current" ]; then
      return 1
    fi
    return 0
  fi

  if ! is_ssh_winpid "$winpid"; then
    echo "refuse: recorded winpid $winpid is listening on 127.0.0.1:$PORT but is NOT an ssh process; not killing anything. Investigate manually — the state file is left in place." >&2
    return 2
  fi

  kill_winpid "$winpid"

  local waited=0
  while [ "$waited" -lt 5 ]; do
    is_winpid_listening "$winpid" || break
    sleep 1
    waited=$((waited + 1))
  done

  if is_winpid_listening "$winpid"; then
    echo "fail: winpid $winpid still listening on 127.0.0.1:$PORT after kill; state file left in place" >&2
    return 1
  fi

  rm -f "$STATE_FILE"
  echo "stop: ok — 0 listeners on 127.0.0.1:$PORT"
  return 0
}

do_stop_leftover() {
  # Human-only: reap an ssh listener on $PORT that no LIVE state file claims. The SessionEnd
  # hook never calls this path — it only ever calls `stop`, which is scoped to the recorded
  # winpid, per the class rule above.
  local winpids
  winpids="$(listener_winpids)"
  if [ -z "$winpids" ]; then
    echo "stop --leftover: no listener on 127.0.0.1:$PORT"
    return 0
  fi

  local claimed_winpid="" claimed_pid=""
  if [ -f "$STATE_FILE" ]; then
    claimed_winpid="$(json_get "$STATE_FILE" winpid)"
    claimed_pid="$(json_get "$STATE_FILE" msys_pid)"
    if [ -z "$claimed_pid" ] || ! msys_pid_alive "$claimed_pid"; then
      claimed_winpid=""  # state file is stale — nothing is truly claimed
    fi
  fi

  local wp any_refused=0
  for wp in $winpids; do
    if [ -n "$claimed_winpid" ] && [ "$wp" = "$claimed_winpid" ]; then
      echo "skip: winpid $wp is claimed by a live state file; use 'stop' (or 'stop --force') for it, not --leftover" >&2
      any_refused=1
      continue
    fi
    if is_ssh_winpid "$wp"; then
      kill_winpid "$wp"
    else
      echo "skip: winpid $wp is listening on 127.0.0.1:$PORT but is not ssh; not killing" >&2
      any_refused=1
    fi
  done

  sleep 1
  winpids="$(listener_winpids)"
  if [ -n "$winpids" ]; then
    echo "fail: listener(s) still present on 127.0.0.1:$PORT after --leftover cleanup: $winpids" >&2
    return 1
  fi
  if [ "$any_refused" -eq 1 ]; then
    echo "stop --leftover: done, but at least one listener was left alone (see above)"
    return 1
  fi
  echo "stop --leftover: ok — 0 listeners on 127.0.0.1:$PORT"
  return 0
}

case "${1:-}" in
  start) do_start ;;
  stop)
    shift
    case "${1:-}" in
      --leftover) do_stop_leftover ;;
      *) do_stop "${1:-}" ;;
    esac
    ;;
  status) do_status ;;
  *)
    echo "usage: $0 {start|stop [--force|--leftover]|status}" >&2
    exit 64
    ;;
esac
