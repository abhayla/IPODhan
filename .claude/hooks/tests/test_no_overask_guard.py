#!/usr/bin/env python3
"""Unit tests for .claude/hooks/no-overask-guard.sh (genuine-wait exemption fix).

Builds a minimal Stop-hook transcript (JSONL) containing one real user prompt
followed by one assistant turn whose final text is the case under test, then
invokes the hook exactly as Claude Code does: JSON payload with
`transcript_path` on stdin, verdict read from stdout.

- Exit 0 / no stdout JSON  -> allowed (no block)
- stdout contains {"decision":"block",...} -> blocked

Run: python3 .claude/hooks/tests/test_no_overask_guard.py
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOK_PATH = Path(__file__).resolve().parent.parent / "no-overask-guard.sh"
# The hook's per-user-turn auto-continue counter lives at this repo-relative
# path and persists across invocations (it is reset externally by
# prompt-enhance-reminder.sh in real sessions). Reset it before every test so
# the 12-cap yield message never masquerades as "allowed" in this suite.
KEEPGOING_COUNT_FILE = HOOK_PATH.resolve().parent.parent / ".keepgoing-count"


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
    )
    return result.returncode, result.stdout, result.stderr


def run_hook(final_text: str):
    tp = make_transcript(final_text)
    payload = json.dumps({"transcript_path": tp})
    result = subprocess.run(
        ["bash", str(HOOK_PATH)],
        input=payload,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return result.returncode, result.stdout, result.stderr


def is_blocked(stdout: str) -> bool:
    stdout = stdout.strip()
    if not stdout:
        return False
    try:
        obj = json.loads(stdout)
    except (json.JSONDecodeError, ValueError):
        return False
    return obj.get("decision") == "block"


class NoOveraskGuardWaitExemptionTest(unittest.TestCase):
    def setUp(self):
        try:
            KEEPGOING_COUNT_FILE.unlink()
        except FileNotFoundError:
            pass

    def assert_allowed(self, text: str):
        code, out, err = run_hook(text)
        self.assertFalse(
            is_blocked(out),
            msg=f"expected ALLOWED, got blocked. text={text!r} stdout={out!r} stderr={err!r}",
        )

    def assert_blocked(self, text: str):
        code, out, err = run_hook(text)
        self.assertTrue(
            is_blocked(out),
            msg=f"expected BLOCKED, got allowed. text={text!r} stdout={out!r} stderr={err!r}",
        )

    # -- the six real waits from tonight that were wrongly blocked --

    def test_workers_remain_still_building_allowed(self):
        self.assert_allowed(
            "Four workers remain: W-168 round 2, W-169 build, and W-170 "
            "review -- all still running in the background."
        )

    def test_until_one_of_those_returns_allowed(self):
        self.assert_allowed(
            "Nothing else can move until one of those five returns."
        )

    def test_still_building_allowed(self):
        self.assert_allowed("W-151 and W-170 are still building.")

    def test_still_running_colon_allowed(self):
        self.assert_allowed(
            "Status check: still running: unit tests, W-169 verification."
        )

    def test_in_flight_allowed(self):
        self.assert_allowed(
            "The reproduction step is in flight; nothing to do until it finishes."
        )

    def test_runs_in_the_background_allowed(self):
        self.assert_allowed(
            "The scraper audit runs in the background; report will land once it's done."
        )

    # -- the explicit marker --

    def test_waiting_background_marker_allowed(self):
        self.assert_allowed(
            "Everything queued is done for now. [waiting: background]"
        )

    # -- over-ask must still block --

    def test_want_me_to_proceed_blocked(self):
        self.assert_blocked("The fix is ready. Want me to proceed?")

    # -- narrate-and-stop must still block --

    def test_next_ill_implement_blocked(self):
        self.assert_blocked(
            "That covers the analysis. Next I'll implement the fix."
        )

    # -- round 2: over-ask wins over the wait exemption --

    def test_want_me_to_proceed_with_wait_phrase_still_blocked(self):
        self.assert_blocked(
            "Want me to proceed? A worker is still running."
        )

    def test_should_i_go_ahead_with_marker_still_blocked(self):
        self.assert_blocked(
            "Should I go ahead? [waiting: background]"
        )

    def test_shall_i_continue_with_wait_phrase_still_blocked(self):
        self.assert_blocked(
            "Shall I continue with the next fix? The build is still running."
        )

    # -- round 2: a genuine wait still clears B (narrate-and-stop) --

    def test_agent_still_running_next_ill_implement_allowed(self):
        self.assert_allowed(
            "The agent is still running. Next I'll implement the fix."
        )

    # -- round 2: tool-result boundary must not split the turn; the wait
    # phrase living only in the FINAL block must still clear B computed
    # over the full aggregated (block1 + block2) text. --

    def test_wait_phrase_in_final_block_after_tool_result_allowed(self):
        tp = make_boundary_transcript(
            assistant_block_1="Next I'll implement the fix.",
            assistant_block_2="The review agent is still running.",
        )
        code, out, err = run_hook_with_transcript(tp)
        self.assertFalse(
            is_blocked(out),
            msg=f"expected ALLOWED, got blocked. stdout={out!r} stderr={err!r}",
        )


if __name__ == "__main__":
    unittest.main()
