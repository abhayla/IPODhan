#!/usr/bin/env python3
"""hooks/board-owed-guard.py — board-owed mechanism (Tier A: runs every session).

Owner rule (2026-09-19, memory `board-update-is-automatic.md`): "the board
artifact updates itself whenever a slice lands". That rule was prose, the
update tooling lived only in per-session scratchpads, and nothing checked that
a merge was followed by a board write — so the owner had to ask three times
(2026-09-10, 09-17, 09-19).

This one script serves three events, selected by `--event`:

  --event PostToolUseBash
      stdin is a PostToolUse payload for Bash. The command is split into
      statements (on newlines, `;`, `&&`, `||`, `|`, `(`); if any statement is
      a REAL invocation of `merge-if-current.mjs` or `gh pr merge` (not a
      comment/echo/grep/cat/sed/awk/python mentioning the phrase) AND the
      cwd's git origin URL contains "IPODhan" AND the tool_response does not
      show the merge failed, append a JSON record {pr, command, session_id,
      ts} to the marker file (default ~/.claude/.board-owed.ipodhan, one JSON
      object per line).

  --event PostToolUseArtifact
      stdin is a PostToolUse payload for Artifact. If tool_input has a `url`
      containing the board id NohBg52m7AUjS8kTDMxxKM and the action is a
      publish (action absent, or literally "publish"), delete the marker —
      the board was republished, nothing is owed.

  --event Stop
      stdin is a Stop payload. If the marker exists, exit 2 with the checklist
      message on stderr (a Stop hook blocks the turn on exit 2). If the marker
      is older than BOARD_OWED_MAX_AGE_HOURS (default 12) hours, print a
      warning to stdout and exit 0 instead — a dead marker must never lock a
      session forever. `stop_hook_active` true -> exit 0 silently (no loop).

Off-switch: BOARD_OWED_GUARD=0 -> no-op everywhere.

Fail-open: every unexpected exception exits 0 and appends one line to
~/.claude/.board-owed-guard.errors.log. Never runs for a cwd whose git origin
is not IPODhan. stdin is read exactly once.

Python 3.12 stdlib only (runs under `python -I -S`).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone


BOARD_ID = "NohBg52m7AUjS8kTDMxxKM"
BOARD_URL = "https://claude.ai/artifact/" + BOARD_ID

MARKER_PATH = os.environ.get("BOARD_OWED_MARKER") or os.path.join(
    os.path.expanduser("~"), ".claude", ".board-owed.ipodhan"
)
ERROR_LOG = os.environ.get("BOARD_OWED_ERROR_LOG") or os.path.join(
    os.path.expanduser("~"), ".claude", ".board-owed-guard.errors.log"
)

_BARE_NUMBER_RE = re.compile(r"^\d{1,6}$")


def _extract_pr_number(merge_stmt):
    """PR number for a real merge statement: `gh pr merge [flags] <n> [flags]`
    or `... merge-if-current.mjs <n> [flags]` — a bare all-digit token,
    wherever it falls among the flags (MINOR-3: flags may precede it)."""
    for tok in merge_stmt.replace("--pr=", "--pr ").split():
        tok = tok.lstrip("#").strip()
        if _BARE_NUMBER_RE.match(tok):
            return tok
    return None

# MAJOR-1 (Tier A review, 2026-09-19): matching a merge regex against the raw
# command string armed on a comment, an `echo`, or a `grep` mentioning the
# phrase. The guard must parse STATEMENTS, not text. A command is split on
# statement separators; each statement is checked for a non-merge leading
# verb (comment / print / search) before the merge pattern is tested against
# ONLY that statement, with common prefixes (cd X &&, env assignment, node,
# npx) stripped first.
_STATEMENT_SPLIT_RE = re.compile(r"&&|\|\||[;|]|\(")
_NON_MERGE_LEADING_VERB_RE = re.compile(
    r"^(?:echo|printf|grep|rg|cat|sed|awk|python[0-9.]*|node\s+-e)\b", re.IGNORECASE
)
_LEADING_PREFIX_RE = re.compile(
    r"^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*"          # env var assignments
    r"(?:cd\s+\S+\s*&&\s*)?"                          # cd X &&  (rare after split, but be safe)
    r"(?:MSYS_NO_PATHCONV=1\s+)?"
    r"(?:(?:node|npx)\s+)?",
    re.IGNORECASE,
)
_MERGE_STATEMENT_RE = re.compile(
    r"^(?:gh\s+pr\s+merge\b|\S*merge-if-current\.mjs\b)", re.IGNORECASE
)


def _iter_statements(command):
    """Split a shell command into individual statements on ; && || | ( and
    newlines. A best-effort lexical split (no real shell parser) — good
    enough to tell a real merge invocation from a comment/echo/grep about
    one, which is the only thing this guard needs."""
    for raw_line in command.splitlines():
        for chunk in _STATEMENT_SPLIT_RE.split(raw_line):
            stmt = chunk.strip()
            if stmt:
                yield stmt


def _is_real_merge_statement(stmt):
    if stmt.startswith("#"):
        return False
    if _NON_MERGE_LEADING_VERB_RE.match(stmt):
        return False
    stripped = _LEADING_PREFIX_RE.sub("", stmt)
    return bool(_MERGE_STATEMENT_RE.match(stripped.strip()))


def _find_merge_statement(command):
    """Return the first statement in `command` that is a REAL merge
    invocation (gh pr merge / a merge-if-current.mjs path), or None. Never
    matches a comment, echo, printf, grep/rg, cat/sed/awk of a file, a
    `python`/`node -e` one-liner, or text inside a heredoc body line that
    merely mentions the phrase without being the leading statement verb."""
    for stmt in _iter_statements(command):
        if _is_real_merge_statement(stmt):
            return stmt
    return None

_REDACT_RE = re.compile(r"(ghp_\S*|sk-\S*|password=\S*|token=\S*)", re.IGNORECASE)


def _redact(text):
    return _REDACT_RE.sub("***", text or "")


def _log_error(detail):
    try:
        os.makedirs(os.path.dirname(ERROR_LOG), exist_ok=True)
        ts = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
        with open(ERROR_LOG, "a", encoding="utf-8") as f:
            f.write("%s %s\n" % (ts, _redact(detail)[:500]))
    except Exception:
        pass


def _max_age_hours():
    try:
        return float(os.environ.get("BOARD_OWED_MAX_AGE_HOURS") or 12)
    except (TypeError, ValueError):
        return 12.0


def _is_ipodhan_repo(cwd):
    """True only when the cwd's git origin URL names IPODhan. Any failure
    (not a repo, no origin, git missing, timeout) is False — the guard never
    fires outside a confirmed IPODhan checkout."""
    if not cwd or not os.path.isdir(cwd):
        return False
    try:
        proc = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        return False
    if proc.returncode != 0:
        return False
    return "ipodhan" in (proc.stdout or "").lower()


def _read_marker_records():
    try:
        with open(MARKER_PATH, "r", encoding="utf-8") as f:
            records = []
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except (json.JSONDecodeError, ValueError):
                    continue
            return records
    except Exception:
        return []


def _append_marker(record):
    os.makedirs(os.path.dirname(MARKER_PATH), exist_ok=True)
    with open(MARKER_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")


def _clear_marker():
    try:
        if os.path.exists(MARKER_PATH):
            os.remove(MARKER_PATH)
            return True
    except Exception:
        pass
    return False


def _tool_input(data):
    ti = data.get("tool_input")
    return ti if isinstance(ti, dict) else {}


# MAJOR-2 (Tier A review, 2026-09-19): a FAILED merge attempt must not arm
# the marker — a merge that never happened owes nothing. Text taken from the
# real refusal wording: merge-if-current.mjs prints "REFUSED (exit N):" with
# reasons like "conflicts with its base", "is not OPEN", "Mergeability is
# UNKNOWN", "checks are not green" (see scripts/ops/lib/merge-freshness.mjs);
# `gh pr merge` prints "Pull request ... is not mergeable" / "GraphQL: ...".
# On genuine AMBIGUITY (can't tell success from failure) we still mark — a
# false "owed" costs one republish; a false "clear" costs the whole mechanism.
_FAILURE_TEXT_RE = re.compile(
    r"REFUSED\s*\(exit|conflicts with its base|is not OPEN|Mergeability is UNKNOWN|"
    r"checks are not green|not mergeable|CONFLICTING|is a draft|GraphQL:\s*|"
    r"pull request is not mergeable",
    re.IGNORECASE,
)


def _merge_call_failed(data):
    """True only when the tool_response gives clear evidence the merge did
    NOT go through. Anything ambiguous (missing/unrecognized response shape)
    returns False so the marker is still armed — see module note above."""
    resp = data.get("tool_response")
    if isinstance(resp, dict):
        if resp.get("is_error") is True:
            return True
        for code_key in ("exit_code", "returncode", "exitCode"):
            code = resp.get(code_key)
            if isinstance(code, int) and code != 0:
                return True
        text = ""
        for text_key in ("stdout", "stderr", "output", "text"):
            val = resp.get(text_key)
            if isinstance(val, str):
                text += "\n" + val
        if text and _FAILURE_TEXT_RE.search(text):
            return True
    elif isinstance(resp, str):
        if resp and _FAILURE_TEXT_RE.search(resp):
            return True
    return False


def handle_bash(data):
    command = _tool_input(data).get("command")
    if not isinstance(command, str) or not command.strip():
        return
    merge_stmt = _find_merge_statement(command)
    if not merge_stmt:
        return
    cwd = data.get("cwd") or ""
    if not _is_ipodhan_repo(cwd):
        return
    if _merge_call_failed(data):
        return
    pr_number = _extract_pr_number(merge_stmt)
    _append_marker(
        {
            "pr": pr_number or "",
            "command": _redact(command)[:300],
            "session_id": data.get("session_id") or "",
            "ts": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        }
    )


def handle_artifact(data):
    tool_input = _tool_input(data)
    url = tool_input.get("url")
    if not isinstance(url, str) or BOARD_ID not in url:
        return
    action = tool_input.get("action")
    if action is not None and action != "publish":
        return
    _clear_marker()


STOP_MESSAGE = (
    "Board owed: merge(s) {prs} this session, board {url} not republished "
    "(owed by session {session}). "
    "Edit docs/design/board/board-data.json (stamp from `date`), run "
    "`node scripts/ops/render-board.mjs`, republish "
    "docs/design/board/index.html with `url`, then end the turn. "
    "If no stage actually crossed (an ordinary merge that changed no verdict, "
    "docs, or a CI re-run), do NOT republish: clear the marker with "
    "`rm -f ~/.claude/.board-owed.ipodhan` and say why in the same turn."
)


def handle_stop(data):
    if data.get("stop_hook_active"):
        return 0
    if not os.path.exists(MARKER_PATH):
        return 0

    try:
        age_hours = (time.time() - os.path.getmtime(MARKER_PATH)) / 3600.0
    except Exception:
        age_hours = 0.0

    records = _read_marker_records()
    prs = [r.get("pr") for r in records if r.get("pr")]
    prs_text = ", ".join("#" + p for p in prs) if prs else "unnumbered"
    session_ids = [r.get("session_id") for r in records if r.get("session_id")]
    session_text = session_ids[-1][:8] if session_ids else "unknown"

    if age_hours > _max_age_hours():
        print(
            "board-owed-guard: stale marker (%.1f h old) for merge(s) %s — not blocking. "
            "Republish %s or delete %s."
            % (age_hours, prs_text, BOARD_URL, MARKER_PATH)
        )
        return 0

    sys.stderr.write(
        STOP_MESSAGE.format(prs=prs_text, url=BOARD_URL, session=session_text) + "\n"
    )
    return 2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--event",
        required=True,
        choices=["PostToolUseBash", "PostToolUseArtifact", "Stop"],
    )
    args = parser.parse_args()

    if os.environ.get("BOARD_OWED_GUARD") == "0":
        return 0

    try:
        raw = sys.stdin.read()
    except Exception:
        return 0
    try:
        data = json.loads(raw)
    except Exception:
        return 0
    if not isinstance(data, dict):
        return 0

    if args.event == "PostToolUseBash":
        handle_bash(data)
        return 0
    if args.event == "PostToolUseArtifact":
        handle_artifact(data)
        return 0
    return handle_stop(data)


def run_guarded():
    try:
        return main()
    except SystemExit:
        raise
    except Exception:
        _log_error("internal-exception: " + traceback.format_exc().replace("\n", " | "))
        return 0


if __name__ == "__main__":
    sys.exit(run_guarded())
