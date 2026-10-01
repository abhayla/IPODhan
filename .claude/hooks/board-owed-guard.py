#!/usr/bin/env python3
"""hooks/board-owed-guard.py — board-owed mechanism (Tier A: runs every session).

Owner rule (2026-09-19, memory `board-update-is-automatic.md`): "the board
artifact updates itself whenever a slice lands". That rule was prose, the
update tooling lived only in per-session scratchpads, and nothing checked that
a merge was followed by a board write — so the owner had to ask three times
(2026-09-10, 09-17, 09-19).

This one script serves three events, selected by `--event`:

  --event PostToolUseBash
      #1365 round 3 (structural): the command text only TRIGGERS a check, it
      never decides whether a merge happened. Any Bash call (foreground or
      background) in an IPODhan checkout whose text contains `gh pr merge`
      appends a "merge-check due" entry {session_id, ts, numbers, command} to
      <marker>.pending. `numbers` is the set of literal PR numbers given to
      every `gh pr merge` in the text, or null when any of them is computed at
      run time (`$`, backticks, xargs, no literal number): null means "any PR".

  --event PostToolUseArtifact
      stdin is a PostToolUse payload for Artifact. If tool_input has a `url`
      containing the board id NohBg52m7AUjS8kTDMxxKM and the action is a
      publish (action absent, or literally "publish"), delete the marker —
      the board was republished, nothing is owed.

  --event Stop
      First the due merge-checks are resolved against GitHub with ONE capped
      `gh pr list --state merged --search merged:>=<ts>` call (the only
      authority on whether a merge happened): every merged PR inside an entry's
      window (and in its `numbers`, when given) becomes an owed marker record.
      An entry stays due for PENDING_MAX_AGE_HOURS after its trigger (a
      background merge may still land), then is dropped only after one more
      lookup. Due = this session's entries, plus ANY session's entry older than
      that (a closed session can never resolve its own). gh failure, timeout or
      a truncated answer records an "unknown merge" (fail safe) ONCE per check
      and KEEPS the check (until PENDING_HARD_MAX_HOURS) so a later Stop with a
      working gh still finds the real merge. A merge whose mergedAt is at or
      before the last published page's render cutoff (the stamp file) is covered by that publish
      and never re-owed (#1381). The pending file is rewritten under a short
      lock and entries another session appended meanwhile are kept.
      Then, if the marker exists, exit 2 with the checklist message on stderr
      (a Stop hook blocks the turn on exit 2). If the marker is older than
      BOARD_OWED_MAX_AGE_HOURS (default 12) hours, print a warning to stdout
      and exit 0 instead — a dead marker must never lock a session forever.
      `stop_hook_active` true -> exit 0 silently (no loop).

Off-switch: BOARD_OWED_GUARD=0 -> no-op everywhere.

Known limits (accepted, #1381):
  - A `gh pr merge --auto` that lands MORE THAN 2 h after the command is not
    seen: its check is resolved and dropped (after one last lookup) at 2 h, and
    a later landing creates no new trigger. Publish the board by hand then.
  - The coverage cutoff is the page's own data-rendered-at minus 60 s (capped at
    the publish time), read from the published file, so a merge between render
    and publish stays owed. A publish with no readable stamp stores NO cutoff;
    the 12 h / 24 h staleness checks are the backstop.

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
from datetime import datetime, timedelta, timezone


BOARD_ID = "NohBg52m7AUjS8kTDMxxKM"
BOARD_URL = "https://claude.ai/artifact/" + BOARD_ID

MARKER_PATH = os.environ.get("BOARD_OWED_MARKER") or os.path.join(
    os.path.expanduser("~"), ".claude", ".board-owed.ipodhan"
)
ERROR_LOG = os.environ.get("BOARD_OWED_ERROR_LOG") or os.path.join(
    os.path.expanduser("~"), ".claude", ".board-owed-guard.errors.log"
)
PENDING_PATH = MARKER_PATH + ".pending"

# #1365 round 3: two rounds tried to DECIDE from command text and tool output
# whether a merge happened (statement splitting, refusal-wording regexes) and
# each missed shapes: multi-PR commands with one refusal, for-loops, background
# calls, incidental words in success output, PR numbers computed at run time.
# Now the text only triggers; GitHub decides at Stop (run-discipline B8).
_TRIGGER_RE = re.compile(r"gh\s+pr\s+merge\b", re.IGNORECASE)
# The arguments of one `gh pr merge` run up to the next shell separator. A
# separator inside a quoted flag value only shortens the segment, which can
# only turn a literal number into "unknown" (null = any PR): the safe side.
_SEGMENT_END_RE = re.compile(r"[;&|\n)]")
_LITERAL_PR_RE = re.compile(r"^(?:#?(\d{1,7})|\S*/pull/(\d{1,7})\S*)$")

# A foreground call's PostToolUse fires AFTER the command ran, so its merge can
# predate the trigger by up to the Bash tool's 10-minute cap; look back 15.
LOOKBACK_MINUTES = 15
PENDING_MAX_AGE_HOURS = 2
# A check whose lookups keep failing is kept this long (hours), then dropped.
PENDING_HARD_MAX_HOURS = 24
RENDER_MARGIN_SECONDS = 60
GH_LIST_LIMIT = 100


def _merge_numbers(command):
    """Literal PR numbers of every `gh pr merge` in `command`, or None when any
    of them is not a literal — None means "any PR merged in the window counts".
    The PR argument is the first token after `gh pr merge` that is not a flag;
    when it is computed (`$PR`, `$(...)`, `{}` under xargs), missing (the
    current branch's PR), or a flag's value, it is not a literal, so a number
    later in the line (a subject, a limit) is never taken for it."""
    numbers = set()
    for m in _TRIGGER_RE.finditer(command):
        rest = command[m.end():]
        end = _SEGMENT_END_RE.search(rest)
        found = None
        for tok in (rest[: end.start()] if end else rest).split():
            if tok.startswith("-"):
                continue
            lit = _LITERAL_PR_RE.match(tok.strip("\"'"))
            found = (lit.group(1) or lit.group(2)) if lit else None
            break
        if found is None:
            return None
        numbers.add(str(int(found)))
    return sorted(numbers, key=int) if numbers else None


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


def _read_jsonl(path):
    records = []
    try:
        with open(path, "r", encoding="utf-8") as f:
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
    except Exception:
        pass
    return records


def _read_marker_records():
    return _read_jsonl(MARKER_PATH)


def _append_jsonl(path, record):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")


def _append_marker(record):
    _append_jsonl(MARKER_PATH, record)


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


def _write_pending(records):
    if not records:
        if os.path.exists(PENDING_PATH):
            os.remove(PENDING_PATH)
        return
    tmp = PENDING_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
    os.replace(tmp, PENDING_PATH)


class _PendingLock:
    """Short exclusive lock on <pending>.lock (msvcrt on Windows, fcntl
    elsewhere; stdlib only). Held only around a read-modify-write or an append,
    never across the gh call. Fail-open: after BOARD_OWED_LOCK_TIMEOUT seconds
    (default 3) or on any error the caller proceeds without the lock."""

    def __init__(self):
        self.fh = None

    def _try(self):
        if os.name == "nt":
            import msvcrt
            self.fh.seek(0)
            msvcrt.locking(self.fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(self.fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)

    def __enter__(self):
        try:
            timeout = float(os.environ.get("BOARD_OWED_LOCK_TIMEOUT") or 3)
        except ValueError:
            timeout = 3.0
        try:
            os.makedirs(os.path.dirname(PENDING_PATH), exist_ok=True)
            self.fh = open(PENDING_PATH + ".lock", "a+b")
            deadline = time.time() + timeout
            while True:
                try:
                    self._try()
                    return self
                except OSError:
                    if time.time() >= deadline:
                        raise
                    time.sleep(0.05)
        except Exception as exc:
            _log_error("pending lock not taken (proceeding without): %s" % exc)
            self._close()
            return self

    def _close(self):
        if self.fh is not None:
            try:
                self.fh.close()  # closing releases the OS lock
            except Exception:
                pass
            self.fh = None

    def __exit__(self, *exc):
        self._close()
        return False


def _last_publish():
    """UTC datetime of the last successful board publish, from the stamp
    file's CONTENT (written by handle_artifact), or None when unreadable."""
    try:
        with open(PUBLISH_STAMP_PATH, "r", encoding="utf-8") as fh:
            return _parse_ts(fh.read().strip())
    except Exception:
        return None


def _rec_id(rec):
    """Stable identity of a pending check: session + trigger timestamp + PR
    list. Survives another session rewriting the record (recorded/unknown_noted
    change, the identity does not)."""
    nums = rec.get("numbers")
    return json.dumps([rec.get("session_id") or "", rec.get("ts") or "",
                       sorted(str(n) for n in nums) if isinstance(nums, list) else None])


def _merge_pending(snapshot, mine, fresh):
    """What to write back: `mine` (this session's resolved view of `snapshot`)
    merged by _rec_id with `fresh` (the file as it is now). A record another
    session appended is added; one another session removed stays removed; one it
    rewrote is not duplicated."""
    fresh_ids = {_rec_id(r) for r in fresh}
    snap_ids = {_rec_id(r) for r in snapshot}
    out, seen = [], set()
    for rec in mine:
        rid = _rec_id(rec)
        if rid in seen or rid not in fresh_ids:
            continue
        seen.add(rid)
        out.append(rec)
    for rec in fresh:
        rid = _rec_id(rec)
        if rid in seen or rid in snap_ids:
            continue
        seen.add(rid)
        out.append(rec)
    return out


def _parse_ts(text):
    try:
        ts = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except Exception:
        return None
    return ts if ts.tzinfo is not None else None


def _gh_argv():
    raw_argv = os.environ.get("BOARD_OWED_GH_ARGV")
    if raw_argv:
        try:
            argv = json.loads(raw_argv)
            if argv:
                return argv
        except Exception:
            pass
    return ["gh"]


def _gh_timeout():
    try:
        return max(1, int(os.environ.get("BOARD_OWED_GH_TIMEOUT") or 25))
    except Exception:
        return 25


def _merged_since(since, cwd):
    """ONE capped gh call: {number: mergedAt} for every PR merged at or after
    `since`, or None when gh cannot answer completely (failure, timeout,
    garbage, or a full page that may be truncated)."""
    try:
        proc = subprocess.run(
            _gh_argv() + [
                "pr", "list", "--state", "merged",
                "--search", "merged:>=" + since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "--limit", str(GH_LIST_LIMIT), "--json", "number,mergedAt",
            ],
            cwd=cwd or None, capture_output=True, text=True, timeout=_gh_timeout(),
        )
        if proc.returncode != 0:
            return None
        rows = json.loads(proc.stdout)
    except Exception:
        return None
    if not isinstance(rows, list) or len(rows) >= GH_LIST_LIMIT:
        return None
    out = {}
    for row in rows:
        if not isinstance(row, dict):
            return None
        merged_at = _parse_ts(row.get("mergedAt"))
        if merged_at is None or row.get("number") is None:
            return None
        out[str(row.get("number"))] = merged_at
    return out


def _resolve_pending(session_id, cwd):
    """Turn due merge-checks into owed records, with GitHub as the only judge
    of whether a merge happened (see module docstring)."""
    snapshot = _read_jsonl(PENDING_PATH)
    if not snapshot:
        return
    me = session_id or ""
    now = datetime.now(timezone.utc)
    max_age = timedelta(hours=PENDING_MAX_AGE_HOURS)
    hard_age = timedelta(hours=PENDING_HARD_MAX_HOURS)
    last_pub = _last_publish()
    due, keep = [], []
    for rec in snapshot:
        ts = _parse_ts(rec.get("ts"))
        old = ts is None or now - ts > max_age
        owner = rec.get("session_id") or ""
        if owner == me or not owner or old:
            due.append((rec, ts, old))
        else:
            keep.append(rec)
    if not due:
        return
    stamps = [ts for _, ts, _ in due if ts is not None]
    lookback = timedelta(minutes=LOOKBACK_MINUTES)
    merged = _merged_since(min(stamps) - lookback, cwd) if len(stamps) == len(due) else None
    stamp = now.astimezone().isoformat(timespec="seconds")
    for rec, ts, old in due:
        if merged is None:
            # A foreground check's merge happened before its trigger; if the
            # board was published after the trigger, that publish covered it.
            covered = (ts is not None and last_pub is not None and ts <= last_pub
                       and not rec.get("background"))
            if covered:
                continue
            if not rec.get("unknown_noted"):
                # Fail safe: a missed board publish costs more than one extra prompt.
                _append_marker({"pr": "", "unknown": True, "session_id": me, "ts": stamp,
                                "trigger_session": rec.get("session_id") or "",
                                "command": rec.get("command") or ""})
            if ts is None or now - ts > hard_age:
                _log_error("pending check dropped after %dh of failed GitHub lookups: %s"
                           % (PENDING_HARD_MAX_HOURS, rec.get("command") or ""))
                continue
            rec = dict(rec)
            rec["unknown_noted"] = True  # owed once; keep the check for the next Stop
            keep.append(rec)
            continue
        wanted = rec.get("numbers")
        recorded = list(rec.get("recorded") or [])
        for num in sorted(merged, key=lambda n: int(n) if n.isdigit() else 0):
            if num in recorded or merged[num] < ts - lookback:
                continue
            if wanted is not None and num not in wanted:
                continue
            if last_pub is not None and merged[num] <= last_pub:
                recorded.append(num)  # covered by a publish; never owed again
                continue
            _append_marker({"pr": num, "merged_at": merged[num].isoformat(), "session_id": me,
                            "ts": stamp, "trigger_session": rec.get("session_id") or "",
                            "command": rec.get("command") or ""})
            recorded.append(num)
        if old:
            continue  # looked first; now drop
        if wanted is not None and set(wanted) <= set(recorded):
            continue  # every PR it named has merged; nothing more can land
        rec = dict(rec)
        rec["recorded"] = recorded
        keep.append(rec)
    with _PendingLock():
        # gh took up to 25 s; keep whatever another session appended meanwhile.
        _write_pending(_merge_pending(snapshot, keep, _read_jsonl(PENDING_PATH)))


def handle_bash(data):
    command = _tool_input(data).get("command")
    if not isinstance(command, str) or not _TRIGGER_RE.search(command):
        return
    if not _is_ipodhan_repo(data.get("cwd") or ""):
        return
    entry = {
        "session_id": data.get("session_id") or "",
        "ts": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "numbers": _merge_numbers(command),
        "background": _tool_input(data).get("run_in_background") is True,
        "command": _redact(command)[:300],
    }
    with _PendingLock():
        _append_jsonl(PENDING_PATH, entry)


_RENDERED_AT_RE = re.compile(r'data-rendered-at="([^"]+)"')


def _rendered_cutoff(file_path):
    """min(data-rendered-at - RENDER_MARGIN_SECONDS, now) from the published
    file, or None when the file or the stamp is missing or unreadable."""
    if not isinstance(file_path, str) or not file_path:
        return None
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
            m = _RENDERED_AT_RE.search(fh.read(4 * 1024 * 1024))
    except Exception:
        return None
    rendered = _parse_ts(m.group(1)) if m else None
    if rendered is None:
        return None
    return min(rendered - timedelta(seconds=RENDER_MARGIN_SECONDS), datetime.now(timezone.utc))


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
    # The page shows origin/main as of its RENDER, not of the publish. The cutoff
    # is therefore min(rendered_at - margin, publish time); with no readable
    # render stamp there is NO cutoff (the file is still written: its mtime is
    # the publish clock the staleness checks read).
    cutoff = _rendered_cutoff(tool_input.get("file_path"))
    try:
        with open(PUBLISH_STAMP_PATH, "w", encoding="utf-8") as fh:
            fh.write((cutoff.isoformat() if cutoff else "") + chr(10))
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

    try:
        _resolve_pending(data.get("session_id"), data.get("cwd") or os.getcwd())
    except Exception:
        # Resolution trouble must not also skip the marker check below.
        _log_error("resolve-pending: " + traceback.format_exc().replace("\n", " | "))

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
    parts = ["#" + p for p in prs]
    if any(r.get("unknown") for r in records):
        parts.append("unknown merge (GitHub could not be asked)")
    prs_text = ", ".join(parts) if parts else "unnumbered"
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
