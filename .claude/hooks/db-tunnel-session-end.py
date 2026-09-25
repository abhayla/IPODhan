#!/usr/bin/env python3
"""hooks/db-tunnel-session-end.py — SessionEnd hook: stop the DB tunnel this session owns.

RCA (2026-09-25, docs/ops/prod-ops-recipes.md "DB tunnel" row and
scripts/ops/db-tunnel.sh header): the tunnel was being started as a harness background task
(`ssh ... -N -L 15432:localhost:5432 ...`). Under Git Bash (MSYS) the Windows process that
launched /usr/bin/ssh exits immediately, so ssh has no live Windows parent; the harness's
TaskStop walks the Windows process tree from the task's own PID and never reaches ssh, so the
port is left open across sessions. Class: every localhost tunnel a Claude session opens in this
repo outlives its session unless something records its owner and stops it on the way out.

`scripts/ops/db-tunnel.sh start` records the owning session id ($CLAUDE_CODE_SESSION_ID) and the
ssh process's PID in a state file shared across worktrees (~/.claude/.ipodhan-db-tunnel.json).
This hook is the other half: on SessionEnd, if that state file's owner is THIS session, it runs
`db-tunnel.sh stop`. It never touches another session's tunnel (D2, shared-state owner rule) and
it never blocks the session end — any failure here degrades to "the tunnel stays up", not "the
session cannot end".

Reads the Claude Code SessionEnd hook JSON from stdin, e.g. {"session_id": "...", ...}.

Fail-open: any missing state file, any parse error, any subprocess failure -> exit 0 silently.
This hook does its own work only when it can positively confirm session ownership; anything
short of that is a no-op, never a block.

Off-switch: DB_TUNNEL_SESSION_END_GUARD=0 -> no-op.

Python 3.12 stdlib only.
"""
import json
import os
import subprocess
import sys


def _state_file_path() -> str:
    override = os.environ.get("DB_TUNNEL_STATE_FILE")
    if override:
        return override
    home = os.environ.get("HOME") or os.path.expanduser("~")
    return os.path.join(home, ".claude", ".ipodhan-db-tunnel.json")


def _repo_root() -> str:
    return os.environ.get("DB_TUNNEL_REPO_ROOT") or os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "..")
    )


def _stop_command() -> list:
    override = os.environ.get("DB_TUNNEL_STOP_COMMAND")
    if override:
        return override.split()
    script = os.path.join(_repo_root(), "scripts", "ops", "db-tunnel.sh")
    return ["bash", script, "stop"]


def main() -> int:
    if os.environ.get("DB_TUNNEL_SESSION_END_GUARD") == "0":
        return 0

    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        return 0

    session_id = payload.get("session_id") if isinstance(payload, dict) else None
    if not session_id:
        return 0

    state_path = _state_file_path()
    try:
        with open(state_path, "r", encoding="utf-8") as f:
            state = json.load(f)
    except Exception:
        # Missing / corrupt state file: nothing this session owns, nothing to stop.
        return 0

    if not isinstance(state, dict):
        return 0

    if state.get("owner") != session_id:
        # Not ours — never touch another session's (or "manual"'s) tunnel.
        return 0

    try:
        subprocess.run(
            _stop_command(),
            cwd=_repo_root(),
            capture_output=True,
            text=True,
            timeout=30,
        )
    except Exception:
        # Best-effort: a failed stop here just leaves the tunnel up for the next
        # `db-tunnel.sh start` to detect as an owned-but-dead or unowned leftover.
        pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
