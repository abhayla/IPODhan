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
# State file: ~/.claude/.ipodhan-db-tunnel.json — deliberately OUTSIDE the repo/worktree so every
# worktree and every session on this machine sees the same tunnel state (there is only ever one
# tunnel to 127.0.0.1:15432 regardless of which worktree opened it).
#
# Usage:
#   bash scripts/ops/db-tunnel.sh start
#   bash scripts/ops/db-tunnel.sh stop [--force]
#   bash scripts/ops/db-tunnel.sh status
set -u

PORT=15432
REMOTE_HOST="Administrator@103.118.16.189"
SSH_KEY="${DB_TUNNEL_SSH_KEY:-$HOME/.ssh/ipodhan_vps}"
STATE_FILE="${DB_TUNNEL_STATE_FILE:-$HOME/.claude/.ipodhan-db-tunnel.json}"
LOG_FILE="${DB_TUNNEL_LOG_FILE:-$HOME/.claude/.ipodhan-db-tunnel.log}"
WAIT_SECS="${DB_TUNNEL_WAIT_SECS:-20}"

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
  netstat -ano 2>/dev/null | grep -i "LISTENING" | grep -i ":$PORT " | awk '{print $NF}' | sort -u
}

msys_pid_alive() {
  # $1 = msys PID. Alive if `ps -p` (or a plain kill -0) succeeds.
  kill -0 "$1" 2>/dev/null
}

msys_pid_for_winpid() {
  # $1 = Windows PID. Prints the msys PID of the row whose WINPID column matches and whose
  # command mentions ssh, or nothing. Measured 2026-09-25: `$!` from `nohup ssh ... &` is
  # SOMETIMES the ssh process's own msys PID and sometimes an intermediate wrapper's — the one
  # thing that is always reliable is that the socket's owning Windows PID (from netstat) matches
  # the WINPID column of the ssh row in `ps -W`. Resolve backward from there instead of trusting
  # the parent/child relationship of `$!`.
  ps -W 2>/dev/null | awk -v w="$1" '
    NR==1 { next }
    $4==w && $0 ~ /ssh/ { print $1; found=1 }
    END { if (!found) exit 1 }
  '
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
    echo "refuse: tunnel already open (winpid $winpids), no state file — unowned leftover; run 'status' then 'stop --force' if you intend to take it over" >&2
    return 2
  fi

  mkdir -p "$(dirname "$STATE_FILE")"
  : > "$LOG_FILE"
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

  if [ -z "$winpids" ] || [ -z "$ssh_msys_pid" ]; then
    echo "fail: no listener on 127.0.0.1:$PORT after ${WAIT_SECS}s; ssh log follows:" >&2
    cat "$LOG_FILE" >&2
    # Best-effort cleanup of whatever we just launched.
    kill "$wrapper_pid" 2>/dev/null
    [ -n "$ssh_msys_pid" ] && kill "$ssh_msys_pid" 2>/dev/null
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

  local winpids
  winpids="$(listener_winpids)"

  if [ ! -f "$STATE_FILE" ]; then
    if [ -z "$winpids" ]; then
      echo "stop: nothing listening, nothing recorded — already stopped"
      return 0
    fi
    if [ "$force" -ne 1 ]; then
      echo "refuse: no state file (unowned leftover) for winpid(s) $winpids; use --force to kill it anyway" >&2
      return 2
    fi
  else
    local owner pid
    owner="$(json_get "$STATE_FILE" owner)"
    pid="$(json_get "$STATE_FILE" msys_pid)"
    if [ "$force" -ne 1 ] && [ "$owner" != "$(owner_session)" ]; then
      echo "refuse: tunnel is owned by '$owner', this session is '$(owner_session)'; use --force to stop it anyway" >&2
      return 2
    fi
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null
    fi
  fi

  # Verify: if the port is still listening (state was stale, or --force with no matching pid),
  # fall back to killing whatever Windows process actually owns the socket, but only if it is ssh.
  local waited=0
  while [ "$waited" -lt 5 ]; do
    winpids="$(listener_winpids)"
    [ -z "$winpids" ] && break
    sleep 1
    waited=$((waited + 1))
  done

  winpids="$(listener_winpids)"
  if [ -n "$winpids" ]; then
    local wp
    for wp in $winpids; do
      if command -v taskkill >/dev/null 2>&1 && ps -W 2>/dev/null | awk -v w="$wp" '$4==w && $0 ~ /ssh/ {found=1} END{exit !found}'; then
        taskkill //PID "$wp" //F >/dev/null 2>&1
      fi
    done
    sleep 1
    winpids="$(listener_winpids)"
  fi

  rm -f "$STATE_FILE"

  if [ -n "$winpids" ]; then
    echo "fail: listener still present on 127.0.0.1:$PORT after stop (winpid(s) $winpids)" >&2
    return 1
  fi
  echo "stop: ok — 0 listeners on 127.0.0.1:$PORT"
  return 0
}

case "${1:-}" in
  start) do_start ;;
  stop) shift; do_stop "${1:-}" ;;
  status) do_status ;;
  *)
    echo "usage: $0 {start|stop [--force]|status}" >&2
    exit 64
    ;;
esac
