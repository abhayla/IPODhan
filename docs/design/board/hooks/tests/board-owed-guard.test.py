"""Self-tests for hooks/board-owed-guard.py (T-board, Tier A).

Cases a-g from the build brief plus a mutation check. Run:
    python C:/Users/itsab/.claude/hooks/tests/board-owed-guard.test.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HOOK_PATH = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "board-owed-guard.py"))
BOARD_URL = "https://claude.ai/artifact/NohBg52m7AUjS8kTDMxxKM"


def git(args, cwd):
    return subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True, check=True)


class BoardOwedGuardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="board-owed-test-")
        cls.ipodhan = os.path.join(cls.tmp, "IPODhan")
        cls.other = os.path.join(cls.tmp, "SomethingElse")
        for path, origin in (
            (cls.ipodhan, "https://github.com/abhayla/IPODhan.git"),
            (cls.other, "https://github.com/abhayla/gorefer.git"),
        ):
            os.makedirs(path)
            git(["init", "-q"], path)
            git(["remote", "add", "origin", origin], path)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.marker = os.path.join(self.tmp, "marker-%s.jsonl" % self._testMethodName)
        self.errlog = os.path.join(self.tmp, "err-%s.log" % self._testMethodName)
        if os.path.exists(self.marker):
            os.remove(self.marker)

    def run_hook(self, event, payload, hook_path=HOOK_PATH, env_extra=None):
        env = os.environ.copy()
        env.pop("BOARD_OWED_GUARD", None)
        env["BOARD_OWED_MARKER"] = self.marker
        env["BOARD_OWED_ERROR_LOG"] = self.errlog
        if env_extra:
            env.update(env_extra)
        return subprocess.run(
            [sys.executable, hook_path, "--event", event],
            input=payload if isinstance(payload, str) else json.dumps(payload),
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )

    def bash_payload(self, command, cwd):
        return {"tool_name": "Bash", "tool_input": {"command": command}, "cwd": cwd}

    # (a)
    def test_a_bash_merge_in_ipodhan_writes_marker(self):
        p = self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 123 --squash", self.ipodhan))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.marker), "marker not written")
        rec = json.loads(open(self.marker, encoding="utf-8").read().strip())
        self.assertEqual(rec["pr"], "123")

    def test_a2_merge_if_current_also_writes_marker(self):
        p = self.run_hook(
            "PostToolUseBash",
            self.bash_payload("node scripts/ops/merge-if-current.mjs --pr 456", self.ipodhan),
        )
        self.assertEqual(p.returncode, 0, p.stderr)
        rec = json.loads(open(self.marker, encoding="utf-8").read().strip())
        self.assertEqual(rec["pr"], "456")

    def test_a3_non_merge_command_writes_nothing(self):
        self.run_hook("PostToolUseBash", self.bash_payload("git status", self.ipodhan))
        self.assertFalse(os.path.exists(self.marker))

    # (b)
    def test_b_bash_merge_in_non_ipodhan_cwd_writes_nothing(self):
        p = self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 99", self.other))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(self.marker), "marker written for a non-IPODhan repo")

    # (c)
    def test_c_stop_with_marker_blocks_and_names_pr(self):
        self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 123 --squash", self.ipodhan))
        p = self.run_hook("Stop", {"stop_hook_active": False, "cwd": self.ipodhan})
        self.assertEqual(p.returncode, 2, "expected block; stdout=%s stderr=%s" % (p.stdout, p.stderr))
        self.assertIn("123", p.stderr)
        self.assertIn("Board owed", p.stderr)
        self.assertIn("render-board.mjs", p.stderr)
        # the message must also offer the no-stage-crossed escape, so a session
        # facing a false-positive marker is not pushed into republishing
        self.assertIn("do NOT republish", p.stderr)

    # (d)
    def test_d_artifact_publish_with_board_url_clears_marker(self):
        self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 123", self.ipodhan))
        self.assertTrue(os.path.exists(self.marker))
        p = self.run_hook(
            "PostToolUseArtifact",
            {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL, "file_path": "board.html"}},
        )
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(self.marker), "marker not cleared by board publish")

    def test_d2_artifact_publish_of_another_artifact_does_not_clear(self):
        self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 123", self.ipodhan))
        self.run_hook(
            "PostToolUseArtifact",
            {"tool_name": "Artifact", "tool_input": {"url": "https://claude.ai/artifact/SomeOther1234"}},
        )
        self.assertTrue(os.path.exists(self.marker), "an unrelated artifact cleared the marker")

    def test_d3_non_publish_action_on_board_does_not_clear(self):
        self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 123", self.ipodhan))
        self.run_hook(
            "PostToolUseArtifact",
            {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL, "action": "read"}},
        )
        self.assertTrue(os.path.exists(self.marker), "a read cleared the marker")

    # (e)
    def test_e_stop_after_publish_exits_zero(self):
        self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 123", self.ipodhan))
        self.run_hook("PostToolUseArtifact", {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL}})
        p = self.run_hook("Stop", {"stop_hook_active": False, "cwd": self.ipodhan})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stderr.strip(), "")

    # (f)
    def test_f_marker_older_than_12h_warns_instead_of_blocking(self):
        self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 123", self.ipodhan))
        old = time.time() - 13 * 3600
        os.utime(self.marker, (old, old))
        p = self.run_hook("Stop", {"stop_hook_active": False, "cwd": self.ipodhan})
        self.assertEqual(p.returncode, 0, "stale marker blocked; stderr=%s" % p.stderr)
        self.assertIn("stale marker", p.stdout)

    # (g)
    def test_g_malformed_stdin_exits_zero(self):
        for event in ("PostToolUseBash", "PostToolUseArtifact", "Stop"):
            p = self.run_hook(event, "not json at all {{{")
            self.assertEqual(p.returncode, 0, "%s blocked on malformed stdin" % event)

    def test_g2_stop_hook_active_exits_zero(self):
        self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 123", self.ipodhan))
        p = self.run_hook("Stop", {"stop_hook_active": True, "cwd": self.ipodhan})
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_g3_off_switch_disables_everything(self):
        p = self.run_hook(
            "PostToolUseBash",
            self.bash_payload("gh pr merge 123", self.ipodhan),
            env_extra={"BOARD_OWED_GUARD": "0"},
        )
        self.assertEqual(p.returncode, 0)
        self.assertFalse(os.path.exists(self.marker))

    # MAJOR-1: statement parsing, not text search — a comment/echo/grep/heredoc
    # mentioning the merge phrase must NOT arm; a real invocation still does.
    def test_i1_comment_line_does_not_arm(self):
        cmd = "# reminder: run " + "gh pr " + "merge 123 later"
        self.run_hook("PostToolUseBash", self.bash_payload(cmd, self.ipodhan))
        self.assertFalse(os.path.exists(self.marker), "a comment armed the marker")

    def test_i2_echo_does_not_arm(self):
        cmd = "echo 'about to run " + "gh pr " + "merge 123'"
        self.run_hook("PostToolUseBash", self.bash_payload(cmd, self.ipodhan))
        self.assertFalse(os.path.exists(self.marker), "an echo armed the marker")

    def test_i3_grep_does_not_arm(self):
        cmd = "grep -n '" + "merge-if-current.mjs" + "' scripts/ops/*.mjs"
        self.run_hook("PostToolUseBash", self.bash_payload(cmd, self.ipodhan))
        self.assertFalse(os.path.exists(self.marker), "a grep armed the marker")

    def test_i4_heredoc_body_mentioning_phrase_does_not_arm(self):
        cmd = "cat <<'EOF'\nDo not paste " + "gh pr " + "merge into chat\nEOF"
        self.run_hook("PostToolUseBash", self.bash_payload(cmd, self.ipodhan))
        self.assertFalse(os.path.exists(self.marker), "a heredoc body armed the marker")

    def test_i5_real_merge_if_current_path_arms(self):
        cmd = "node scripts/ops/" + "merge-if-current.mjs 812"
        p = self.run_hook("PostToolUseBash", self.bash_payload(cmd, self.ipodhan))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.marker), "real merge-if-current.mjs did not arm")
        rec = json.loads(open(self.marker, encoding="utf-8").read().strip())
        self.assertEqual(rec["pr"], "812")

    def test_i6_real_gh_pr_merge_arms(self):
        cmd = "gh pr " + "merge 812 --squash"
        p = self.run_hook("PostToolUseBash", self.bash_payload(cmd, self.ipodhan))
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.marker), "real gh pr merge did not arm")

    # MAJOR-2: a FAILED merge attempt must not arm the marker.
    def test_j1_failed_merge_is_error_does_not_arm(self):
        cmd = "gh pr " + "merge 900 --squash"
        payload = self.bash_payload(cmd, self.ipodhan)
        payload["tool_response"] = {"is_error": True, "stderr": "Pull request #900 is not mergeable"}
        self.run_hook("PostToolUseBash", payload)
        self.assertFalse(os.path.exists(self.marker), "a failed merge (is_error) armed the marker")

    def test_j2_failed_merge_exit_code_does_not_arm(self):
        cmd = "node scripts/ops/" + "merge-if-current.mjs 901"
        payload = self.bash_payload(cmd, self.ipodhan)
        payload["tool_response"] = {"exit_code": 4, "stdout": "REFUSED (exit 4): stale"}
        self.run_hook("PostToolUseBash", payload)
        self.assertFalse(os.path.exists(self.marker), "a REFUSED exit code armed the marker")

    def test_j3_refusal_text_without_exit_code_does_not_arm(self):
        cmd = "node scripts/ops/" + "merge-if-current.mjs 902"
        payload = self.bash_payload(cmd, self.ipodhan)
        payload["tool_response"] = {
            "stdout": "REFUSED (exit 2): PR conflicts with its base (mergeable=CONFLICTING)"
        }
        self.run_hook("PostToolUseBash", payload)
        self.assertFalse(os.path.exists(self.marker), "refusal text armed the marker")

    def test_j4_ambiguous_response_still_arms(self):
        cmd = "gh pr " + "merge 903 --squash"
        payload = self.bash_payload(cmd, self.ipodhan)
        payload["tool_response"] = {"stdout": "Merged pull request #903"}
        p = self.run_hook("PostToolUseBash", payload)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.marker), "an ambiguous successful-looking response failed to arm")

    def test_j5_missing_tool_response_still_arms(self):
        cmd = "gh pr " + "merge 904 --squash"
        payload = self.bash_payload(cmd, self.ipodhan)
        p = self.run_hook("PostToolUseBash", payload)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(os.path.exists(self.marker), "a missing tool_response failed to arm (should default to arm)")

    # MINOR-3: flags between `merge` and the PR number.
    def test_k_flags_between_merge_and_number(self):
        cmd = "gh pr " + "merge --squash --delete-branch 812"
        p = self.run_hook("PostToolUseBash", self.bash_payload(cmd, self.ipodhan))
        self.assertEqual(p.returncode, 0, p.stderr)
        rec = json.loads(open(self.marker, encoding="utf-8").read().strip())
        self.assertEqual(rec["pr"], "812", "PR number not extracted with flags before it")

    # MINOR-4: session_id recorded in the marker and printed at Stop.
    def test_l_session_id_recorded_and_printed(self):
        cmd = "gh pr " + "merge 555 --squash"
        payload = self.bash_payload(cmd, self.ipodhan)
        payload["session_id"] = "abcdef1234567890"
        self.run_hook("PostToolUseBash", payload)
        rec = json.loads(open(self.marker, encoding="utf-8").read().strip())
        self.assertEqual(rec["session_id"], "abcdef1234567890")
        p = self.run_hook("Stop", {"stop_hook_active": False, "cwd": self.ipodhan})
        self.assertEqual(p.returncode, 2)
        self.assertIn("abcdef12", p.stderr, "Stop message did not print the owing session id")

    # Mutation: break the url match; case (d) must then FAIL to clear.
    def test_h_mutation_broken_url_match_fails_case_d(self):
        mutant = os.path.join(self.tmp, "mutant-board-owed-guard.py")
        src = open(HOOK_PATH, encoding="utf-8").read()
        mutated = src.replace('BOARD_ID = "NohBg52m7AUjS8kTDMxxKM"', 'BOARD_ID = "XXXXmutantXXXX"', 1)
        self.assertNotEqual(src, mutated, "mutation did not apply — test is vacuous")
        open(mutant, "w", encoding="utf-8").write(mutated)

        self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 123", self.ipodhan))
        self.run_hook(
            "PostToolUseArtifact",
            {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL}},
            hook_path=mutant,
        )
        self.assertTrue(
            os.path.exists(self.marker),
            "MUTATION SURVIVED: a broken url match still cleared the marker",
        )
        # and the real hook still clears it
        self.run_hook("PostToolUseArtifact", {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL}})
        self.assertFalse(os.path.exists(self.marker), "real hook failed to clear after mutation test")


if __name__ == "__main__":
    unittest.main(verbosity=2)
