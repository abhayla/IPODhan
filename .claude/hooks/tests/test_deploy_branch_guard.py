#!/usr/bin/env python3
"""W-141 - unit tests for .claude/hooks/deploy-branch-guard.py.

Runs the hook as a subprocess (matching how Claude Code actually invokes
PreToolUse hooks: JSON on stdin, exit code is the verdict), no external
deps beyond the stdlib.

Run: python3 .claude/hooks/tests/test_deploy_branch_guard.py
"""

import json
import subprocess
import sys
import unittest
from pathlib import Path

HOOK_PATH = Path(__file__).resolve().parent.parent / "deploy-branch-guard.py"


def run_hook(payload_text: str):
    result = subprocess.run(
        [sys.executable, str(HOOK_PATH)],
        input=payload_text,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return result.returncode, result.stdout, result.stderr


def bash_payload(command: str) -> str:
    return json.dumps({"tool_name": "Bash", "tool_input": {"command": command}})


class DeployBranchGuardTest(unittest.TestCase):
    def test_prod_without_release_ref_is_blocked(self):
        cmd = "gh workflow run deploy-linux.yml -f slot=prod -f ref=abc1234"
        code, _out, err = run_hook(bash_payload(cmd))
        self.assertEqual(code, 2, msg=f"expected block, got {code}: {err}")
        self.assertIn("BLOCKED", err)
        self.assertIn("release/prod-", err)

    def test_prod_with_release_ref_is_allowed(self):
        cmd = (
            "gh workflow run deploy-linux.yml --ref release/prod-2026-09-05 "
            "-f slot=prod -f ref=abc1234"
        )
        code, _out, err = run_hook(bash_payload(cmd))
        self.assertEqual(code, 0, msg=f"expected allow, got {code}: {err}")

    def test_staging_is_allowed(self):
        cmd = "gh workflow run deploy-linux.yml -f slot=staging"
        code, _out, err = run_hook(bash_payload(cmd))
        self.assertEqual(code, 0, msg=f"expected allow, got {code}: {err}")

    def test_unrelated_command_is_allowed(self):
        cmd = "git status"
        code, _out, err = run_hook(bash_payload(cmd))
        self.assertEqual(code, 0, msg=f"expected allow, got {code}: {err}")

    def test_malformed_json_fails_open(self):
        code, _out, err = run_hook("{not valid json")
        self.assertEqual(code, 0, msg=f"expected fail-open allow, got {code}: {err}")
        self.assertIn("fail-open", err)

    def test_json_field_form_prod_without_ref_is_blocked(self):
        cmd = 'gh workflow run deploy-linux.yml --raw-field \'{"slot": "prod", "ref": "abc1234"}\''
        code, _out, err = run_hook(bash_payload(cmd))
        self.assertEqual(code, 2, msg=f"expected block, got {code}: {err}")

    def test_json_field_form_prod_with_release_ref_is_allowed(self):
        cmd = (
            "gh workflow run deploy-linux.yml --ref release/prod-2026-09-05 "
            '--raw-field \'{"slot": "prod", "ref": "abc1234"}\''
        )
        code, _out, err = run_hook(bash_payload(cmd))
        self.assertEqual(code, 0, msg=f"expected allow, got {code}: {err}")

    def test_non_bash_tool_is_allowed(self):
        payload = json.dumps({"tool_name": "Edit", "tool_input": {"command": "irrelevant"}})
        code, _out, err = run_hook(payload)
        self.assertEqual(code, 0, msg=f"expected allow, got {code}: {err}")

    def test_deploy_linux_dispatch_without_slot_is_allowed(self):
        # e.g. dispatching with only defaults (slot defaults to staging in
        # the workflow's own UI) - the hook only fires on an EXPLICIT
        # slot=prod, never guesses.
        cmd = "gh workflow run deploy-linux.yml"
        code, _out, err = run_hook(bash_payload(cmd))
        self.assertEqual(code, 0, msg=f"expected allow, got {code}: {err}")


if __name__ == "__main__":
    unittest.main()
