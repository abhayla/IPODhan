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
import io
import json
import os
import re
import subprocess
import shutil
import tarfile
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
                    rec = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                # A non-object line (e.g. a bare string or list) would make every
                # r.get() raise, and fail-open would then let every session through.
                if isinstance(rec, dict):
                    records.append(rec)
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
    resp = data.get("tool_response")
    if resp is not None:
        # Failed only on POSITIVE evidence (an error flag or refusal wording), the
        # same rule handle_bash uses for merges. The first version required the
        # word "Published" and never matched the real payload, so a successful
        # publish left the debt armed (2026-09-23, board v65).
        text = resp if isinstance(resp, str) else json.dumps(resp)
        is_err = isinstance(resp, dict) and (resp.get("is_error") is True or resp.get("isError") is True)
        if is_err or re.search(r"publish refused|refused|was not published", text, re.I):
            _log_error("board publish looked failed; debt kept. response head: %s" % text[:200])
            return
    _clear_marker()
    try:
        with open(PUBLISH_STAMP_PATH, "w", encoding="utf-8") as fh:
            fh.write(datetime.now(timezone.utc).isoformat() + chr(10))
    except Exception as exc:
        _log_error("publish stamp: %s" % exc)


def _default_main_checkout():
    """Parent of the MAIN checkout's .git dir, derived via git so a session
    running in a linked worktree still resolves the main checkout (never the
    worktree) — `--git-common-dir` from a linked worktree already points at
    the main repo's real .git directory. Run from the hook's own directory so
    this works regardless of the caller's cwd. None on any failure (not a
    repo, git missing, timeout); callers fall back to cwd."""
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        return None
    if proc.returncode != 0:
        return None
    common_dir = (proc.stdout or "").strip()
    if not common_dir:
        return None
    return os.path.dirname(common_dir)


BOARD_REPO = os.environ.get("BOARD_OWED_REPO") or _default_main_checkout() or os.getcwd()


PUBLISH_STAMP_PATH = os.environ.get("BOARD_PUBLISHED_STAMP") or os.path.join(
    os.path.expanduser("~"), ".claude", ".board-published.ipodhan"
)
RENDER_DIR = os.environ.get("BOARD_RENDER_DIR") or os.path.join(
    os.path.expanduser("~"), ".claude", ".board-render"
)


def _facts_max_age_hours():
    try:
        return float(os.environ.get("BOARD_FACTS_MAX_AGE_HOURS") or 24)
    except ValueError:
        return 24.0


def _copy_node_package_tree(src_modules, dst_modules, name, seen):
    """Copy one package and its runtime dependencies as PLAIN FILES (never a
    junction or symlink: a junction inside a folder this hook later deletes
    has wiped the main checkout twice on this machine)."""
    if name in seen:
        return
    seen.add(name)
    src = os.path.join(src_modules, *name.split("/"))
    if not os.path.isdir(src):
        return
    dst = os.path.join(dst_modules, *name.split("/"))
    shutil.copytree(src, dst, symlinks=False, dirs_exist_ok=True)
    try:
        with open(os.path.join(src, "package.json"), encoding="utf-8") as fh:
            pkg = json.load(fh)
    except Exception:
        return
    for dep in list((pkg.get("dependencies") or {}).keys()):
        _copy_node_package_tree(src_modules, dst_modules, dep, seen)


def _session_render_dir(session_id):
    """One folder per session (review MAJOR-3: two sessions stopping together
    shared one folder and could delete each other's render mid-run). Siblings
    older than a day are pruned; they hold plain files only (no links)."""
    safe = re.sub(r"[^A-Za-z0-9_-]", "", str(session_id or ""))[:40] or ("pid%d" % os.getpid())
    try:
        os.makedirs(RENDER_DIR, exist_ok=True)
        for name in os.listdir(RENDER_DIR):
            full = os.path.join(RENDER_DIR, name)
            if name != safe and os.path.isdir(full) and time.time() - os.path.getmtime(full) > 86400:
                shutil.rmtree(full, ignore_errors=True)
    except Exception as exc:
        _log_error("render dir prune: %s" % exc)
    return os.path.join(RENDER_DIR, safe)


def _regenerate_board(session_id=None):
    """Render the board from a CLEAN EXPORT OF origin/main, with freshly measured
    facts. Returns (message_suffix, path_of_rendered_index_html_or_None).

    2026-09-23 RCA (owner: "you fixed it yesterday, why is it still happening"):
    this used to run the generators IN the main checkout, whose working tree
    sessions never pull (project rule) and which was 6 commits behind
    origin/main, so the page it produced, and the file its Stop message told
    the session to publish, were built from old sources. And the page's facts
    were hand-typed, so a republish republished them unchanged. Now: fetch,
    `git archive refs/remotes/origin/main` into RENDER_DIR, run
    collect-board-facts (served sha / migrations, a timestamp per fact), then
    both generators, all inside RENDER_DIR. The main checkout is only READ
    (its .git via GIT_DIR, its node_modules/pg copied as plain files).
    Fail-open: any problem returns a phrase and None.
    """
    if os.environ.get("BOARD_OWED_NO_REGEN") == "1":
        return " (regeneration disabled by BOARD_OWED_NO_REGEN=1)", None
    repo = BOARD_REPO
    out_dir = _session_render_dir(session_id)
    try:
        # Time limits sum to well under the Stop hook's settings.json timeout
        # (review MAJOR-2: a 15 s hook timeout against a multi-minute worst case).
        try:
            subprocess.run(["git", "fetch", "-q", "origin"], cwd=repo, capture_output=True, text=True, timeout=10)
        except subprocess.TimeoutExpired:
            pass  # render from the refs already fetched; still newer than the main checkout's tree
        if os.path.isdir(out_dir):
            shutil.rmtree(out_dir)
        os.makedirs(out_dir)
        arch = subprocess.run(
            ["git", "archive", "--format=tar", os.environ.get("BOARD_RENDER_REF") or "refs/remotes/origin/main", "scripts", "docs/design", "scraper/config"],
            cwd=repo, capture_output=True, timeout=20,
        )
        if arch.returncode != 0:
            err = (arch.stderr or b"")[-160:].decode("utf-8", "replace")
            return " Auto-render FAILED: git archive: %s" % err, None
        with tarfile.open(fileobj=io.BytesIO(arch.stdout)) as tf:
            tf.extractall(out_dir, filter="data")
        _copy_node_package_tree(
            os.path.join(repo, "node_modules"), os.path.join(out_dir, "node_modules"), "pg", set()
        )
    except Exception as exc:
        return " Auto-render could not prepare the origin/main export (%s) - render by hand from origin/main." % exc, None
    env = os.environ.copy()
    env["GIT_DIR"] = os.path.join(repo, ".git")
    last = ""
    facts_note = ""
    collector = "scripts/ops/collect-board-facts.mjs"
    if os.path.exists(os.path.join(out_dir, collector)):
        # Exit 2 = "some fact unmeasured": the render must still happen, because
        # showing "unmeasured" on the page is the point (review MAJOR-1). A timeout
        # or any other failure is soft too: the render then uses the last committed
        # facts, which the page itself labels stale by age.
        try:
            proc = subprocess.run(["node", collector], cwd=out_dir, env=env, capture_output=True, text=True, timeout=25)
            if proc.returncode == 2:
                facts_note = " Some facts UNMEASURED (shown so on the page)."
            elif proc.returncode != 0:
                tail = (proc.stderr or proc.stdout or "").strip().splitlines()
                facts_note = " Fact collector failed (%s); page uses last committed facts, labelled by age." % (
                    tail[-1][:120] if tail else "no output")
        except subprocess.TimeoutExpired:
            facts_note = " Fact collector timed out (25 s); page uses last committed facts, labelled by age."
        except Exception as exc:
            facts_note = " Fact collector could not run (%s); page uses last committed facts." % exc
    for script in ("scripts/ops/build-plan-board.mjs", "scripts/ops/render-board.mjs"):
        try:
            proc = subprocess.run(["node", script], cwd=out_dir, env=env, capture_output=True, text=True, timeout=20)
        except Exception as exc:
            return " Auto-render could not run %s (%s)." % (script, exc), None
        if proc.returncode != 0:
            tail = (proc.stderr or "").strip().splitlines() or (proc.stdout or "").strip().splitlines()
            return " Auto-render FAILED on %s: %s" % (script, (tail[-1][:160] if tail else "no output")), None
        out = (proc.stdout or "").strip().splitlines()
        if out:
            last = out[-1].strip()
    index = os.path.join(out_dir, "docs", "design", "board", "index.html")
    return " Board ALREADY RENDERED from origin/main: %s.%s" % (last[:150], facts_note), index


STOP_MESSAGE = (
    "Board owed: {why}, board {url} not republished (session {session}).{regen} "
    "ONE STEP LEFT - publish it. Do NOT hand-edit the HTML, do NOT publish "
    "the main checkout's copy (its tree lags origin/main), do NOT run the "
    "generators again (this hook already did): "
    "Artifact(action=publish, url={url}, file_path={path}). "
    "If no stage actually crossed (an ordinary merge that changed no verdict, "
    "docs, or a CI re-run) AND the board was published within the last "
    "{max_age:.0f} h, do NOT republish: clear the marker with "
    "`rm -f ~/.claude/.board-owed.ipodhan` and say why in the same turn. "
    "Never clear it because the page 'looks unchanged' when the last publish is "
    "older than that: an unchanged render of stale facts is the failure this "
    "guard exists for (2026-09-23)."
)


def _hours_since_publish():
    try:
        return (time.time() - os.path.getmtime(PUBLISH_STAMP_PATH)) / 3600.0
    except Exception:
        return None  # never recorded


def _block(why, session_text, session_id=None):
    regen, path = _regenerate_board(session_id)
    sys.stderr.write(
        STOP_MESSAGE.format(
            why=why,
            url=BOARD_URL,
            session=session_text,
            regen=regen,
            path=(path or "<render failed: render from origin/main by hand>").replace(chr(92), "/"),
            max_age=_facts_max_age_hours(),
        )
        + chr(10)
    )
    return 2


def handle_stop(data):
    if data.get("stop_hook_active"):
        return 0

    # IPODhan sessions only, in BOTH branches below. The marker file is global
    # (~/.claude), so without this check an IPODhan merge blocked the turn end of
    # every other project's session on the machine (2026-09-24, Startup-Factory).
    if not _is_ipodhan_repo(data.get("cwd") or os.getcwd()):
        return 0

    if not os.path.exists(MARKER_PATH):
        # No merge owed. Still owed when the last publish is older than
        # BOARD_FACTS_MAX_AGE_HOURS: facts go stale on the clock, not on merges
        # (2026-09-23: the page said staging served a sha it had not served for
        # three days). IPODhan sessions only.
        if not _is_ipodhan_repo(data.get("cwd") or os.getcwd()):
            return 0
        age = _hours_since_publish()
        limit = _facts_max_age_hours()
        if age is not None and age <= limit:
            return 0
        if age is not None:
            why = "board last published %.1f h ago (facts go stale after %.0f h)" % (age, limit)
        else:
            why = "no recorded board publish (facts age unknown)"
        return _block(why, "n/a", data.get("session_id"))

    try:
        age_hours = (time.time() - os.path.getmtime(MARKER_PATH)) / 3600.0
    except Exception:
        age_hours = 0.0

    records = _read_marker_records()

    # The marker is shared by every session on the machine, but the publish is
    # owed by the session that MERGED. Blocking any other session told it
    # "merge(s) #N this session" (false) and pushed it to publish over the owning
    # session's newer page or to clear the marker the owner still needed
    # (2026-09-24/25: an idle session was blocked for #978/#982/#1010, merged by
    # the goal session). Records with no session_id (legacy) still block anyone.
    my_id = data.get("session_id") or ""
    mine = [r for r in records if not r.get("session_id") or r.get("session_id") == my_id]
    if records and not mine:
        others = sorted({(r.get("session_id") or "")[:8] for r in records})
        # Safety net if the owning session never publishes: once the page itself
        # is older than the facts limit, any IPODhan session is asked, as in the
        # no-marker branch.
        age = _hours_since_publish()
        limit = _facts_max_age_hours()
        if age is None or age > limit:
            why = ("board last published %.1f h ago; merges owed by session(s) %s"
                   % (age, ", ".join(others))) if age is not None else (
                   "no recorded board publish; merges owed by session(s) %s" % ", ".join(others))
            return _block(why, "other", data.get("session_id"))
        print(
            "board-owed-guard: board owed by session(s) %s, not this one — not blocking."
            % ", ".join(others)
        )
        return 0
    records = mine or records

    prs = []
    for r in records:
        p = r.get("pr")
        if p and p not in prs:
            prs.append(p)
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

    return _block("merge(s) %s this session" % prs_text, session_text, data.get("session_id"))


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
