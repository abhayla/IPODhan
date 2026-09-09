#!/usr/bin/env python3
"""Regression tests for word-boundary bugs in .claude/hooks/no-overask-guard.sh.

Found 2026-09-09 on a live turn. The narrate-and-stop pattern `one (narrow|thin)`
— meant to catch a deferral like "one thin scope remains" — carried no word
boundary after `thin`, so it also matched the ordinary word "thing". A turn that
reported a COMPLETED production data repair was blocked because it carried the
heading "## One thing to flag". The same bug sat in `next up`, which matches
"next update".

A false block is not harmless. It burns an auto-continue off the 12-per-turn cap
and pushes the model to manufacture more work after it has legitimately
finished — the opposite of what the guard exists to do.

Run: python3 .claude/hooks/tests/test_word_boundary_regression.py
"""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

HOOK_PATH = Path(__file__).resolve().parent.parent / "no-overask-guard.sh"
KEEPGOING_COUNT_FILE = HOOK_PATH.resolve().parent.parent / ".keepgoing-count"


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


class WordBoundaryRegressionTest(unittest.TestCase):
    def setUp(self):
        try:
            KEEPGOING_COUNT_FILE.unlink()
        except FileNotFoundError:
            pass

    def assert_allowed(self, text):
        out = run_hook(text).stdout
        self.assertFalse(is_blocked(out), "should NOT be blocked, but was: " + text)

    def assert_blocked(self, text):
        out = run_hook(text).stdout
        self.assertTrue(is_blocked(out), "SHOULD be blocked, but was allowed: " + text)

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
