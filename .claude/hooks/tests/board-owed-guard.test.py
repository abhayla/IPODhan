"""Self-tests for .claude/hooks/board-owed-guard.py (T-board, Tier A).

Cases a-g from the build brief plus a mutation check, plus the 2026-09-25
session-scope cases (o1-o10, folded in from the former standalone
board-owed-guard.test.py). Run:
    python .claude/hooks/tests/board-owed-guard.test.py
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
        # A fresh publish stamp by default, so marker-only tests are not also
        # tripped by the daily facts-age check; the (m) tests control it.
        self.stamp = os.path.join(self.tmp, "stamp-%s" % self._testMethodName)
        open(self.stamp, "w").write("x")

    def run_hook(self, event, payload, hook_path=HOOK_PATH, env_extra=None):
        env = os.environ.copy()
        env.pop("BOARD_OWED_GUARD", None)
        env["BOARD_OWED_MARKER"] = self.marker
        env["BOARD_OWED_ERROR_LOG"] = self.errlog
        env["BOARD_PUBLISHED_STAMP"] = self.stamp
        env["BOARD_OWED_NO_REGEN"] = "1"
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

    def write_marker(self, records):
        with open(self.marker, "w", encoding="utf-8") as f:
            for rec in records:
                f.write((json.dumps(rec) if isinstance(rec, dict) else json.dumps(rec)) + "\n")

    def run_stop(self, session_id, stop_hook_active=False):
        return self.run_hook(
            "Stop",
            {"session_id": session_id, "cwd": self.ipodhan, "stop_hook_active": stop_hook_active},
        )

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
        self.assertIn("Artifact(action=publish", p.stderr)
        # the message must also offer the no-stage-crossed escape, so a session
        # facing a false-positive marker is not pushed into republishing
        self.assertIn("do NOT republish", p.stderr)

    # (c2) the marker file is global; a session in ANOTHER project must never be blocked by it
    def test_c2_stop_with_marker_in_non_ipodhan_cwd_does_not_block(self):
        self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 123 --squash", self.ipodhan))
        self.assertTrue(os.path.exists(self.marker), "precondition: marker armed by the IPODhan merge")
        p = self.run_hook("Stop", {"stop_hook_active": False, "cwd": self.other})
        self.assertEqual(p.returncode, 0, "blocked a non-IPODhan session; stderr=%s" % p.stderr)
        self.assertNotIn("Board owed", p.stderr)

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
        # 2026-09-25: Stop blocks only the session that merged (session-scoped marker).
        p = self.run_hook("Stop", {"stop_hook_active": False, "cwd": self.ipodhan,
                                   "session_id": "abcdef1234567890"})
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

    # (m) 2026-09-23: facts go stale on the clock, not on merges
    def test_m1_no_marker_old_publish_in_ipodhan_blocks(self):
        old = time.time() - 25 * 3600
        os.utime(self.stamp, (old, old))
        p = self.run_hook("Stop", {"stop_hook_active": False, "cwd": self.ipodhan})
        self.assertEqual(p.returncode, 2, "old publish did not block; stderr=%s" % p.stderr)
        self.assertIn("last published", p.stderr)

    def test_m2_no_marker_never_published_blocks(self):
        os.remove(self.stamp)
        p = self.run_hook("Stop", {"stop_hook_active": False, "cwd": self.ipodhan})
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertIn("no recorded board publish", p.stderr)

    def test_m3_no_marker_fresh_publish_exits_zero(self):
        p = self.run_hook("Stop", {"stop_hook_active": False, "cwd": self.ipodhan})
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stderr.strip(), "")

    def test_m4_old_publish_outside_ipodhan_exits_zero(self):
        os.remove(self.stamp)
        p = self.run_hook("Stop", {"stop_hook_active": False, "cwd": self.other})
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_m5_board_publish_writes_the_stamp(self):
        os.remove(self.stamp)
        self.run_hook("PostToolUseArtifact", {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL}})
        self.assertTrue(os.path.exists(self.stamp), "publish did not record a stamp")
        p = self.run_hook("Stop", {"stop_hook_active": False, "cwd": self.ipodhan})
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_m6_mutation_age_check_removed_fails_m1(self):
        mutant = os.path.join(self.tmp, "mutant-age-board-owed-guard.py")
        src = open(HOOK_PATH, encoding="utf-8").read()
        mutated = src.replace("if age is not None and age <= limit:", "if True:", 1)
        self.assertNotEqual(src, mutated, "mutation did not apply - test is vacuous")
        open(mutant, "w", encoding="utf-8").write(mutated)
        old = time.time() - 25 * 3600
        os.utime(self.stamp, (old, old))
        p = self.run_hook("Stop", {"stop_hook_active": False, "cwd": self.ipodhan}, hook_path=mutant)
        self.assertEqual(p.returncode, 0, "mutant should NOT block (proves m1 can fail)")

    # (n) review MINOR: a refused publish must not clear the debt or reset the clock
    def test_n1_refused_publish_does_not_clear_or_stamp(self):
        self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 123", self.ipodhan))
        os.remove(self.stamp)
        self.run_hook("PostToolUseArtifact", {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL},
                                              "tool_response": "Publish refused - nothing was merged or published"})
        self.assertTrue(os.path.exists(self.marker), "refused publish cleared the marker")
        self.assertFalse(os.path.exists(self.stamp), "refused publish wrote the stamp")

    def test_n2_successful_publish_clears_and_stamps(self):
        self.run_hook("PostToolUseBash", self.bash_payload("gh pr merge 123", self.ipodhan))
        os.remove(self.stamp)
        self.run_hook("PostToolUseArtifact", {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL},
                                              "tool_response": {"url": BOARD_URL, "artifact_id": "b094e3ba-a60f-4c65-845c-f2d56d8c653c", "updated": True, "seq": 66, "version": "1790130990-0d47"}})  # real payload shape, captured 2026-09-23
        self.assertFalse(os.path.exists(self.marker))
        self.assertTrue(os.path.exists(self.stamp))

    # (o) 2026-09-25 session-scope cases, folded in from the former standalone
    # hooks/board-owed-guard.test.py (Stop blocks only the merging session).
    def test_o1_other_session_merge_does_not_block(self):
        self.write_marker([{"pr": "1010", "session_id": "goal-aaaa"}])
        p = self.run_stop("idle-bbbb")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn("not this one", p.stdout)

    def test_o2_other_session_merge_blocks_when_board_stale(self):
        self.write_marker([{"pr": "1010", "session_id": "goal-aaaa"}])
        old = time.time() - 30 * 3600
        os.utime(self.stamp, (old, old))
        p = self.run_stop("idle-bbbb")
        self.assertEqual(p.returncode, 2, "rc=%s stdout=%s" % (p.returncode, p.stdout))
        self.assertIn("goal-aaa", p.stderr)

    def test_o3_other_session_merge_blocks_when_never_published(self):
        self.write_marker([{"pr": "7", "session_id": "goal-aaaa"}])
        os.remove(self.stamp)
        p = self.run_stop("idle-bbbb")
        self.assertEqual(p.returncode, 2, p.stderr)

    def test_o4_non_object_marker_line_is_ignored_not_fail_open(self):
        with open(self.marker, "w", encoding="utf-8") as f:
            f.write(json.dumps("garbage-string") + "\n")
            f.write(json.dumps({"pr": "9", "session_id": "me"}) + "\n")
        p = self.run_stop("me")
        self.assertEqual(p.returncode, 2, "rc=%s stdout=%s stderr=%s" % (p.returncode, p.stdout, p.stderr))
        self.assertIn("#9", p.stderr)

    def test_o5_own_merge_blocks(self):
        self.write_marker([{"pr": "1010", "session_id": "goal-aaaa"}])
        p = self.run_stop("goal-aaaa")
        self.assertEqual(p.returncode, 2, "rc=%s" % p.returncode)
        self.assertIn("#1010", p.stderr)

    def test_o6_mixed_blocks_only_with_own_prs(self):
        self.write_marker([{"pr": "11", "session_id": "goal-aaaa"},
                            {"pr": "22", "session_id": "idle-bbbb"}])
        p = self.run_stop("idle-bbbb")
        self.assertEqual(p.returncode, 2, "rc=%s" % p.returncode)
        self.assertIn("#22", p.stderr)
        self.assertNotIn("#11", p.stderr)

    def test_o7_duplicate_pr_listed_once(self):
        self.write_marker([{"pr": "978", "session_id": "s1"}, {"pr": "978", "session_id": "s1"}])
        p = self.run_stop("s1")
        self.assertEqual(p.returncode, 2, "rc=%s" % p.returncode)
        self.assertNotIn("#978, #978", p.stderr)
        self.assertIn("#978", p.stderr)

    def test_o8_legacy_record_without_session_still_blocks(self):
        self.write_marker([{"pr": "5"}])
        p = self.run_stop("anyone")
        self.assertEqual(p.returncode, 2, "rc=%s" % p.returncode)

    def test_o9_no_marker_fresh_publish_passes(self):
        p = self.run_stop("anyone")
        self.assertEqual(p.returncode, 0, p.stderr)

    # (p) #1036: quote-, heredoc- and comment-aware statement splitting. A
    # `;`/`|` INSIDE quoted text, a heredoc body line, or a comment line that
    # itself contains a `;` must never arm the marker on the mention alone.
    def test_p1_quoted_json_with_embedded_semicolon_does_not_arm(self):
        # the real #1036 shape: a test harness piping a JSON blob whose
        # quoted command string contains "gate; gh pr merge 5"
        cmd = 'echo \'{"tool_input":{"command":"gate; gh pr merge 5"}}\' | cat'
        self.run_hook("PostToolUseBash", self.bash_payload(cmd, self.ipodhan))
        self.assertFalse(os.path.exists(self.marker), "quoted mention with embedded ; armed the marker")

    def test_p2_heredoc_body_line_with_embedded_semicolon_does_not_arm(self):
        cmd = 'cat <<\'EOF\'\ncommit note: "fix; gh pr merge 42" pending\nEOF'
        self.run_hook("PostToolUseBash", self.bash_payload(cmd, self.ipodhan))
        self.assertFalse(os.path.exists(self.marker), "heredoc body mention with embedded ; armed the marker")

    def test_p3_comment_with_embedded_semicolon_does_not_arm(self):
        cmd = "# note: run gate; gh pr merge 5 later"
        self.run_hook("PostToolUseBash", self.bash_payload(cmd, self.ipodhan))
        self.assertFalse(os.path.exists(self.marker), "comment mention with embedded ; armed the marker")

    def test_p4_python_dash_c_string_with_embedded_semicolon_does_not_arm(self):
        cmd = 'python -c "gate(); gh pr merge 5"'
        self.run_hook("PostToolUseBash", self.bash_payload(cmd, self.ipodhan))
        self.assertFalse(os.path.exists(self.marker), "python -c string mention with embedded ; armed the marker")

    def test_p5_real_run_against_todays_false_positive_payload(self):
        # one real run of the handler against a payload shaped like the one
        # that produced the false "Board owed: merge(s) #5" on 2026-09-25
        payload = {
            "tool_name": "Bash",
            "tool_input": {
                "command": 'echo \'{"tool_input":{"command":"gate; gh pr merge 5"}}\' | python h.py'
            },
            "cwd": self.ipodhan,
        }
        p = self.run_hook("PostToolUseBash", payload)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(self.marker), "today's false-positive payload still arms the marker")

    def test_p6_real_merges_still_arm_after_the_scanner_change(self):
        # regression guard for the fix itself: real merges (a/a2/i5/i6) must
        # still record after quote/heredoc/comment stripping is added.
        for cmd, pr in (
            ("gh pr merge 123 --squash", "123"),
            ("node scripts/ops/merge-if-current.mjs --pr 456", "456"),
        ):
            marker = os.path.join(self.tmp, "p6-marker-%s.jsonl" % pr)
            if os.path.exists(marker):
                os.remove(marker)
            env = os.environ.copy()
            env["BOARD_OWED_MARKER"] = marker
            env["BOARD_OWED_ERROR_LOG"] = self.errlog
            env["BOARD_PUBLISHED_STAMP"] = self.stamp
            env["BOARD_OWED_NO_REGEN"] = "1"
            p = subprocess.run(
                [sys.executable, HOOK_PATH, "--event", "PostToolUseBash"],
                input=json.dumps(self.bash_payload(cmd, self.ipodhan)),
                capture_output=True, text=True, env=env, timeout=30,
            )
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertTrue(os.path.exists(marker), "real merge %r stopped arming" % cmd)
            rec = json.loads(open(marker, encoding="utf-8").read().strip())
            self.assertEqual(rec["pr"], pr)

    def test_o10_stop_hook_active_never_blocks(self):
        self.write_marker([{"pr": "1", "session_id": "me"}])
        p = self.run_stop("me", stop_hook_active=True)
        self.assertEqual(p.returncode, 0, "rc=%s" % p.returncode)


if __name__ == "__main__":
    unittest.main(verbosity=2)
