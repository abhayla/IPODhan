#!/usr/bin/env python3
"""Regression tests for word-boundary bugs in .claude/hooks/no-overask-guard.sh.

Found 2026-09-09 on a live turn. The narrate-and-stop pattern `one (narrow|thin)`
— meant to catch a deferral like "one thin scope remains" — carried no word
boundary after `thin`, so it also matched the ordinary word "thing". A turn that
reported a COMPLETED production data repair was blocked because it carried the
heading "## One thing to flag". The same bug sat in `next up`, which matches
"next update".

A false block was not harmless when this hook blocked: it burned an auto-continue
off the 12-per-turn cap and pushed the model to manufacture more work after it had
legitimately finished. T-143 (synced 2026-09-09) made this hook telemetry-only, so a
false POSITIVE is now only a noisy log line, never a block — but the boundary bug is
still a real detection defect (it would flag a clean turn as a violation), so these
tests keep asserting "clean" (no log line) for the false-positive cases and "logged"
(never blocked, but recorded) for the genuine deferrals.

Run: python3 .claude/hooks/tests/test_word_boundary_regression.py
"""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

HOOK_PATH = Path(__file__).resolve().parent.parent / "no-overask-guard.sh"
REPO_ROOT = HOOK_PATH.resolve().parent.parent.parent
KEEPGOING_COUNT_FILE = REPO_ROOT / ".claude" / ".keepgoing-count"
VIOLATIONS_LOG = REPO_ROOT / ".claude" / ".overask-violations.log"


def make_transcript(final_text):
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


def run_hook(final_text):
    payload = json.dumps({"transcript_path": make_transcript(final_text)})
    return subprocess.run(
        ["bash", str(HOOK_PATH)],
        input=payload,
        capture_output=True,
        text=True,
        timeout=10,
        cwd=str(REPO_ROOT),
    )


def is_blocked(stdout):
    stdout = stdout.strip()
    if not stdout:
        return False
    try:
        obj = json.loads(stdout)
    except (json.JSONDecodeError, ValueError):
        return False
    return obj.get("decision") == "block"


def read_log():
    try:
        return VIOLATIONS_LOG.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


class WordBoundaryRegressionTest(unittest.TestCase):
    def setUp(self):
        for p in (KEEPGOING_COUNT_FILE, VIOLATIONS_LOG):
            try:
                p.unlink()
            except FileNotFoundError:
                pass

    def assert_allowed(self, text):
        # T-143: never blocked AND no log line — a true clean case.
        out = run_hook(text).stdout
        self.assertFalse(is_blocked(out), "should NOT be blocked, but was: " + text)
        self.assertNotIn(
            "stop-violation", read_log(), "should have no log line, but got one: " + text
        )

    def assert_blocked(self, text):
        # T-143: never blocked, but the genuine violation is still logged.
        out = run_hook(text).stdout
        self.assertFalse(
            is_blocked(out), "hook must never block under T-143, but did: " + text
        )
        self.assertIn(
            "stop-violation", read_log(), "SHOULD be logged, but log stayed empty: " + text
        )

    # --- "one thing" must not read as "one thin" (the live false positive) ---

    def test_one_thing_heading_is_allowed(self):
        self.assert_allowed(
            "The merge is applied and verified on production.\n\n"
            "## One thing to flag\n\n"
            "The issue size moved from 696.06 Cr to 732.97 Cr."
        )

    def test_one_thing_inline_is_allowed(self):
        self.assert_allowed("Committed. One thing worth recording: the backup path.")

    def test_one_thin_deferral_still_blocks(self):
        self.assert_blocked("Committed the fix. That leaves one thin scope for later.")

    # --- "next update" must not read as "next up" ---

    def test_next_update_is_allowed(self):
        self.assert_allowed(
            "The row is repaired and the cache is dropped. "
            "The next update of that table happens on its own schedule."
        )

    def test_next_up_deferral_still_blocks(self):
        self.assert_blocked("Committed. Next up: the normaliser change.")


if __name__ == "__main__":
    unittest.main()
