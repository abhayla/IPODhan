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


if __name__ == "__main__":
    unittest.main()
