#!/usr/bin/env python3
"""Unit tests for .claude/hooks/no-overask-guard.sh (telemetry-only contract, T-143).

Builds a minimal Stop-hook transcript (JSONL) containing one real user prompt
followed by one assistant turn whose final text is the case under test, then
invokes the hook exactly as Claude Code does: JSON payload with
`transcript_path` on stdin, verdict read from stdout + the violations log.

T-143 (owner decision 2026-09-09, syncing IPODhan to the hub's 2026-08-16
telemetry-only flip "the logs stay, the whip goes"): this hook NEVER blocks a
stop anymore. Detection is UNCHANGED from the prior blocking version; only the
final action changed. Every case that used to assert `{"decision":"block"}`
now asserts exit 0 (no re-injected block) AND a matching line appended to
.claude/.overask-violations.log.

- Exit 0, no stdout JSON, log line WRITTEN     -> logged   (was: "blocked")
- Exit 0, no stdout JSON, log line NOT written -> clean    (was: "allowed")
- stdout ever contains {"decision":"block",...} -> hard failure (this hook
  must never emit a block decision under the new contract)

Run: python3 .claude/hooks/tests/test_no_overask_guard.py
"""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

HOOK_PATH = Path(__file__).resolve().parent.parent / "no-overask-guard.sh"
REPO_ROOT = HOOK_PATH.resolve().parent.parent.parent
# The hook's per-user-turn auto-continue counter and violations log live at
# these repo-relative paths. Reset both before every test so a prior test's
# writes never leak into the next assertion.
KEEPGOING_COUNT_FILE = REPO_ROOT / ".claude" / ".keepgoing-count"
VIOLATIONS_LOG = REPO_ROOT / ".claude" / ".overask-violations.log"


def make_transcript(final_text: str) -> str:
    """Write a temp JSONL transcript: one user turn boundary + one assistant
    turn whose text is `final_text`. Returns the transcript file path."""
    lines = [
        json.dumps({"type": "user", "message": {"content": "do the task"}}),
        json.dumps(
            {
                "type": "assistant",
                "message": {"content": [{"type": "text", "text": final_text}]},
            }
        ),
    ]
    f = tempfile.NamedTemporaryFile(
        mode="w", suffix=".jsonl", delete=False, encoding="utf-8"
    )
    f.write("\n".join(lines) + "\n")
    f.close()
    return f.name


def make_boundary_transcript(assistant_block_1: str, assistant_block_2: str) -> str:
    """Real user prompt -> assistant block 1 -> a tool-result "user" entry
    (must NOT split the turn) -> assistant block 2 (final). Mirrors a
    tool-using turn: text, then a tool call/result, then more text."""
    lines = [
        json.dumps({"type": "user", "message": {"content": "do the task"}}),
        json.dumps(
            {
                "type": "assistant",
                "message": {"content": [{"type": "text", "text": assistant_block_1}]},
            }
        ),
        json.dumps(
            {
                "type": "user",
                "message": {
                    "content": [
                        {"type": "tool_result", "content": "tool output here"}
                    ]
                },
            }
        ),
        json.dumps(
            {
                "type": "assistant",
                "message": {"content": [{"type": "text", "text": assistant_block_2}]},
            }
        ),
    ]
    f = tempfile.NamedTemporaryFile(
        mode="w", suffix=".jsonl", delete=False, encoding="utf-8"
    )
    f.write("\n".join(lines) + "\n")
    f.close()
    return f.name


def run_hook_with_transcript(tp: str):
    payload = json.dumps({"transcript_path": tp})
    result = subprocess.run(
        ["bash", str(HOOK_PATH)],
        input=payload,
        capture_output=True,
        text=True,
        timeout=10,
        cwd=str(REPO_ROOT),
    )
    return result.returncode, result.stdout, result.stderr


def run_hook(final_text: str):
    tp = make_transcript(final_text)
    return run_hook_with_transcript(tp)


def is_blocked(stdout: str) -> bool:
    stdout = stdout.strip()
    if not stdout:
        return False
    try:
        obj = json.loads(stdout)
    except (json.JSONDecodeError, ValueError):
        return False
    return obj.get("decision") == "block"


def read_log() -> str:
    try:
        return VIOLATIONS_LOG.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


class NoOveraskGuardTelemetryOnlyTest(unittest.TestCase):
    def setUp(self):
        for p in (KEEPGOING_COUNT_FILE, VIOLATIONS_LOG):
            try:
                p.unlink()
            except FileNotFoundError:
                pass

    def _assert_never_blocks(self, code: int, out: str, text: str):
        # T-143: under NO circumstance may this hook still emit a block
        # decision — that is the entire behavioral flip under test.
        self.assertFalse(
            is_blocked(out),
            msg=(
                'hook emitted {"decision":"block"} — telemetry-only contract '
                f"violated. text={text!r} stdout={out!r}"
            ),
        )
        self.assertEqual(code, 0, msg=f"hook exited {code}, expected 0. text={text!r}")

    def assert_clean(self, text: str):
        """No stop-violation class matched: exit 0, no block, no log line."""
        code, out, err = run_hook(text)
        self._assert_never_blocks(code, out, text)
        self.assertNotIn(
            "stop-violation",
            read_log(),
            msg=f"expected no log line, got one. text={text!r} log={read_log()!r} stderr={err!r}",
        )

    def assert_logged(self, text: str):
        """A stop-violation class matched: exit 0 (never blocked), but the
        violation is still recorded in .overask-violations.log."""
        code, out, err = run_hook(text)
        self._assert_never_blocks(code, out, text)
        log = read_log()
        self.assertIn(
            "stop-violation",
            log,
            msg=f"expected a logged violation, log stayed empty. text={text!r} log={log!r} stderr={err!r}",
        )

    # -- the six real waits from tonight -- clean, no log line at all --

    def test_workers_remain_still_building_clean(self):
        self.assert_clean(
            "Four workers remain: W-168 round 2, W-169 build, and W-170 "
            "review -- all still running in the background."
        )

    def test_until_one_of_those_returns_clean(self):
        self.assert_clean("Nothing else can move until one of those five returns.")

    def test_still_building_clean(self):
        self.assert_clean("W-151 and W-170 are still building.")

    def test_still_running_colon_clean(self):
        self.assert_clean(
            "Status check: still running: unit tests, W-169 verification."
        )

    def test_in_flight_clean(self):
        self.assert_clean(
            "The reproduction step is in flight; nothing to do until it finishes."
        )

    def test_runs_in_the_background_clean(self):
        self.assert_clean(
            "The scraper audit runs in the background; report will land once it's done."
        )

    # -- the explicit marker -- clean --

    def test_waiting_background_marker_clean(self):
        self.assert_clean("Everything queued is done for now. [waiting: background]")

    # -- over-ask must still be LOGGED (never blocked) --

    def test_want_me_to_proceed_logged(self):
        self.assert_logged("The fix is ready. Want me to proceed?")

    # -- narrate-and-stop must still be LOGGED (never blocked) --

    def test_next_ill_implement_logged(self):
        self.assert_logged("That covers the analysis. Next I'll implement the fix.")

    # -- round 2: over-ask wins over the wait exemption -- still logged --

    def test_want_me_to_proceed_with_wait_phrase_still_logged(self):
        self.assert_logged("Want me to proceed? A worker is still running.")

    def test_should_i_go_ahead_with_marker_still_logged(self):
        self.assert_logged("Should I go ahead? [waiting: background]")

    def test_shall_i_continue_with_wait_phrase_still_logged(self):
        self.assert_logged(
            "Shall I continue with the next fix? The build is still running."
        )

    # -- round 2: a genuine wait still clears B (narrate-and-stop) -- clean --

    def test_agent_still_running_next_ill_implement_clean(self):
        self.assert_clean("The agent is still running. Next I'll implement the fix.")

    # -- round 2: tool-result boundary must not split the turn; the wait
    # phrase living only in the FINAL block must still clear B computed
    # over the full aggregated (block1 + block2) text. --

    def test_wait_phrase_in_final_block_after_tool_result_clean(self):
        tp = make_boundary_transcript(
            assistant_block_1="Next I'll implement the fix.",
            assistant_block_2="The review agent is still running.",
        )
        code, out, err = run_hook_with_transcript(tp)
        self._assert_never_blocks(code, out, "boundary-transcript")
        self.assertNotIn(
            "stop-violation",
            read_log(),
            msg=f"expected no log line, got one. log={read_log()!r} stderr={err!r}",
        )

    # -- round 3 (2026-09-07): three genuine-wait shapes -- clean --

    def test_ci_gate_running_follow_up_clean(self):
        self.assert_clean(
            "Follow-up already building. The stage harness is on its last CI job."
        )

    def test_scheduled_landing_pass_merges_clean(self):
        self.assert_clean(
            "The remaining items are two PRs. The 13:33 landing pass merges "
            "them once the gate is green."
        )

    def test_owner_decision_only_left_clean(self):
        self.assert_clean(
            "The only item left is the prod run, which is on the owner's word."
        )

    def test_ci_wait_with_permission_question_still_logged(self):
        self.assert_logged("Want me to merge it? The gate is still running.")

    # -- round 4 (2026-09-07, Tier A on round 3): "check"/"job" + "going" are
    # ordinary prose -- a textbook narrate-and-stop must still be logged. --

    def test_check_remaining_before_going_ahead_still_logged(self):
        self.assert_logged("Next, I'll fix the job check that keeps going wrong.")

    # -- word-boundary regression (fixed 2026-09-09, d99383c0): "thing" must
    # not match "one (narrow|thin)", and "next update" must not match
    # "next up" -- both stay clean under the telemetry-only contract too. --

    def test_one_thing_to_flag_clean(self):
        self.assert_clean(
            "Prod repair landed and verified. ## One thing to flag: the "
            "backfill script still needs a dry-run label before next use."
        )

    def test_next_update_clean(self):
        self.assert_clean(
            "Deploy verified. The next update will post to Notifier once the "
            "cron confirms the release tag."
        )


if __name__ == "__main__":
    unittest.main()
