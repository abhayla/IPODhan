"""Self-tests for .claude/hooks/board-owed-guard.py (T-board, Tier A).

Publish / staleness / session-scope cases (d-h, l, m, n, o) plus the #1365
round-3 cases (s): the Bash command text only TRIGGERS a merge check; GitHub
(a stub `gh` here, never the network) decides at Stop whether a merge happened.
Run:
    python .claude/hooks/tests/board-owed-guard.test.py
BOARD_OWED_HOOK_UNDER_TEST=<path> runs the suite against another copy (used to
show the round-3 cases red on the round-2 hook, and for mutation runs).
"""
import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HOOK_PATH = os.environ.get("BOARD_OWED_HOOK_UNDER_TEST") or os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "board-owed-guard.py"))
BOARD_URL = "https://claude.ai/artifact/NohBg52m7AUjS8kTDMxxKM"


HOLD_LOCK_SCRIPT = """
import os, sys, time
f = open(sys.argv[1], 'a+b'); f.seek(0)
if os.name == 'nt':
    import msvcrt; msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
else:
    import fcntl; fcntl.flock(f.fileno(), fcntl.LOCK_EX)
print('held', flush=True); time.sleep(float(sys.argv[2]))
"""


def git(args, cwd):
    return subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True, check=True)


def iso(delta_seconds=0):
    t = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=delta_seconds)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


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
        # #1381 round 3: a real commit chain for the ancestry checks. Its origin
        # is a path that does not exist, so the hook's one fetch fails at once
        # (never the network).
        cls.anc = os.path.join(cls.tmp, "ancestry")
        os.makedirs(cls.anc)
        git(["init", "-q"], cls.anc)
        git(["remote", "add", "origin", os.path.join(cls.tmp, "no-such-remote")], cls.anc)
        cls.c = []
        for i in range(3):
            git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty",
                 "-m", "c%d" % i], cls.anc)
            cls.c.append(git(["rev-parse", "HEAD"], cls.anc).stdout.strip())
        cls.not_a_repo = os.path.join(cls.tmp, "not-a-repo")
        os.makedirs(cls.not_a_repo)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def setUp(self):
        self.marker = os.path.join(self.tmp, "marker-%s.jsonl" % self._testMethodName)
        self.errlog = os.path.join(self.tmp, "err-%s.log" % self._testMethodName)
        for path in (self.marker, self.pending):
            if os.path.exists(path):
                os.remove(path)
        # A fresh publish stamp by default, so marker-only tests are not also
        # tripped by the daily facts-age check; the (m) tests control it.
        self.stamp = os.path.join(self.tmp, "stamp-%s" % self._testMethodName)
        open(self.stamp, "w").write("x")
        # Default gh: GitHub shows no merges. Never the real gh.
        self.gh_env, self.gh_log = self.stub([])

    @property
    def pending(self):
        return self.marker + ".pending"

    def run_hook(self, event, payload, hook_path=None, env_extra=None):
        env = os.environ.copy()
        env.pop("BOARD_OWED_GUARD", None)
        env["BOARD_OWED_MARKER"] = self.marker
        env["BOARD_OWED_ERROR_LOG"] = self.errlog
        env["BOARD_PUBLISHED_STAMP"] = self.stamp
        env["BOARD_OWED_NO_REGEN"] = "1"
        env["BOARD_OWED_REPO"] = self.anc
        env.update(self.gh_env)
        if env_extra:
            env.update(env_extra)
        return subprocess.run(
            [sys.executable, hook_path or HOOK_PATH, "--event", event],
            input=payload if isinstance(payload, str) else json.dumps(payload),
            capture_output=True,
            text=True,
            env=env,
            timeout=60,
        )

    def stub(self, merged, sleep=0, fail=False, name="gh", side_append=None, side_write=None):
        """A fake gh that logs its argv and prints `merged` for `pr list`.
        `side_append=(path, record)` makes it append a JSON line to `path`
        while "running", i.e. another session writing during the gh call;
        `side_write=(path, records)` makes it REWRITE `path` with `records`."""
        if side_write:
            side = "open(%r, 'w').write(''.join(json.dumps(r) + chr(10) for r in %r))" % side_write
        elif side_append:
            side = "open(%r, 'a').write(json.dumps(%r) + chr(10))" % side_append
        else:
            side = ""
        path = os.path.join(self.tmp, "%s-stub-%s.py" % (name, self._testMethodName))
        log = path + ".log"
        if os.path.exists(log):
            os.remove(log)
        with open(path, "w", encoding="utf-8") as f:
            f.write(
                "import sys, json, time\n"
                "open(%r, 'a').write(json.dumps(sys.argv[1:]) + chr(10))\n"
                "%s\n"
                "time.sleep(%d)\n"
                "%s\n"
                "print(json.dumps(%r))\n" % (
                    log,
                    side,
                    sleep, "sys.exit(1)" if fail else "", merged)
            )
        return {"BOARD_OWED_GH_ARGV": json.dumps([sys.executable, path])}, log

    def use_gh(self, merged, **kw):
        self.gh_env, self.gh_log = self.stub(merged, **kw)

    def gh_calls(self):
        try:
            return [json.loads(l) for l in open(self.gh_log, encoding="utf-8") if l.strip()]
        except Exception:
            return []

    def bash(self, command, session="me", cwd=None, background=False, response=None):
        payload = {"tool_name": "Bash", "tool_input": {"command": command},
                   "cwd": cwd or self.ipodhan, "session_id": session}
        if background:
            payload["tool_input"]["run_in_background"] = True
            payload["tool_response"] = {"backgroundTaskId": "bx1", "stdout": ""}
        if response is not None:
            payload["tool_response"] = response
        p = self.run_hook("PostToolUseBash", payload)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p

    def write_marker(self, records):
        with open(self.marker, "w", encoding="utf-8") as f:
            for rec in records:
                f.write(json.dumps(rec) + "\n")

    def write_pending(self, records):
        with open(self.pending, "w", encoding="utf-8") as f:
            for rec in records:
                f.write(json.dumps(rec) + "\n")

    def read_jsonl(self, path):
        if not os.path.exists(path):
            return []
        return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]

    def marker_prs(self):
        return sorted(r.get("pr") for r in self.read_jsonl(self.marker))

    def run_stop(self, session_id="me", stop_hook_active=False, cwd=None):
        return self.run_hook(
            "Stop",
            {"session_id": session_id, "cwd": cwd or self.ipodhan, "stop_hook_active": stop_hook_active},
        )

    # ---- (s) #1365 round 3: text triggers, GitHub decides ----
    M = "gh pr " + "merge"  # split so this file's own text never reads as a merge

    def test_s1_merge_text_only_triggers_a_check(self):
        self.bash(self.M + " 123 --squash")
        self.assertFalse(os.path.exists(self.marker), "the command text alone recorded a merge")
        recs = self.read_jsonl(self.pending)
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["numbers"], ["123"])
        self.assertEqual(recs[0]["session_id"], "me")

    def test_s2_non_ipodhan_cwd_and_non_merge_command_trigger_nothing(self):
        self.bash(self.M + " 99", cwd=self.other)
        self.bash("git status")
        self.bash("node scripts/ops/merge-if-current.mjs 456")  # a gate, never merges by itself
        self.assertFalse(os.path.exists(self.pending))

    def test_s3_merge_confirmed_by_github_blocks_and_names_pr(self):
        self.bash(self.M + " 123 --squash")
        self.use_gh([{"number": 123, "mergedAt": iso(-5)}])
        p = self.run_stop()
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertIn("#123", p.stderr)
        self.assertIn("Board owed", p.stderr)
        self.assertIn("Artifact(action=publish", p.stderr)
        self.assertIn("do NOT republish", p.stderr)
        self.assertFalse(os.path.exists(self.pending), "a fully merged check stayed due")
        call = self.gh_calls()[0]
        self.assertEqual(call[:4], ["pr", "list", "--state", "merged"])
        self.assertTrue(any(a.startswith("merged:>=") for a in call), call)

    def test_s4_multi_pr_one_refused_one_merged_records_the_merged_one(self):
        # Round-2 re-review MAJOR: this recorded nothing.
        cmd = ("node scripts/ops/merge-if-current.mjs 1498 && %s 1498 --squash; "
               "node scripts/ops/merge-if-current.mjs 1499 && %s 1499 --squash" % (self.M, self.M))
        self.bash(cmd, response={"stdout": "REFUSED (exit 2): PR conflicts with its base", "exit_code": 1})
        self.use_gh([{"number": 1499, "mergedAt": iso(-5)}])
        p = self.run_stop()
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertEqual(self.marker_prs(), ["1499"])
        self.assertNotIn("#1498", p.stderr)

    def test_s5_for_loop_records_every_merged_pr(self):
        self.bash("for n in 1498 1499; do %s $n --squash; done" % self.M)
        self.use_gh([{"number": 1498, "mergedAt": iso(-9)}, {"number": 1499, "mergedAt": iso(-5)}])
        p = self.run_stop()
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertEqual(self.marker_prs(), ["1498", "1499"])

    def test_s6_computed_pr_number_records_the_merge(self):
        self.bash("%s $(gh pr list --head fix/x --json number -q '.[0].number') --squash" % self.M)
        self.use_gh([{"number": 1600, "mergedAt": iso(-5)}])
        self.assertEqual(self.run_stop().returncode, 2)
        self.assertEqual(self.marker_prs(), ["1600"])

    def test_s6b_computed_pr_with_a_number_in_a_flag_value_is_not_a_literal(self):
        self.bash('%s "$PR" --squash --subject "fix 1600 rows"' % self.M)
        self.use_gh([{"number": 1601, "mergedAt": iso(-5)}])
        self.assertEqual(self.run_stop().returncode, 2)
        self.assertEqual(self.marker_prs(), ["1601"], "a number in --subject was taken for the PR")

    def test_s7_background_merge_landing_after_1_2_3_stops(self):
        for landing in (1, 2, 3):
            for path in (self.marker, self.pending):
                if os.path.exists(path):
                    os.remove(path)
            self.bash(self.M + " 1400 --squash", background=True)
            for stop in range(1, landing):
                self.use_gh([])
                p = self.run_stop()
                self.assertEqual(p.returncode, 0, "stop %d of landing %d: %s" % (stop, landing, p.stderr))
                self.assertTrue(os.path.exists(self.pending),
                                "check dropped while the background merge may still land (stop %d)" % stop)
            self.use_gh([{"number": 1400, "mergedAt": iso(5)}])
            p = self.run_stop()
            self.assertEqual(p.returncode, 2, "landing after %d stop(s) not recorded: %s" % (landing, p.stderr))
            self.assertEqual(self.marker_prs(), ["1400"])

    def test_s8_check_older_than_2h_with_a_merge_records_then_drops(self):
        self.write_pending([{"session_id": "me", "ts": iso(-3 * 3600), "numbers": ["1401"], "command": "x"}])
        self.use_gh([{"number": 1401, "mergedAt": iso(-3 * 3600 + 60)}])
        p = self.run_stop()
        self.assertEqual(p.returncode, 2, "an old but real merge was dropped unseen: %s" % p.stderr)
        self.assertEqual(self.marker_prs(), ["1401"])
        self.assertFalse(os.path.exists(self.pending))

    def test_s8b_check_older_than_2h_without_a_merge_drops_after_looking(self):
        self.write_pending([{"session_id": "me", "ts": iso(-3 * 3600), "numbers": ["1402"], "command": "x"}])
        p = self.run_stop()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(len(self.gh_calls()), 1, "dropped without looking first")
        self.assertFalse(os.path.exists(self.pending))
        self.assertFalse(os.path.exists(self.marker))

    def test_s9_refused_only_call_records_nothing(self):
        cmd = "node scripts/ops/merge-if-current.mjs 1500 && %s 1500 --squash" % self.M
        self.bash(cmd, response={"stdout": "Squashed and merged pull request #1500", "exit_code": 0})
        for _ in range(2):
            p = self.run_stop()
            self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(self.marker), "a merge GitHub never saw was recorded")

    def test_s10_gh_timeout_records_unknown_merge(self):
        self.bash(self.M + " 1308 --squash")
        self.use_gh([], sleep=6)
        p = self.run_hook("Stop", {"session_id": "me", "cwd": self.ipodhan},
                          env_extra={"BOARD_OWED_GH_TIMEOUT": "1"})
        self.assertEqual(p.returncode, 2, "gh timeout must fail safe: %s" % p.stderr)
        self.assertIn("unknown merge", p.stderr)
        left = self.read_jsonl(self.pending)
        self.assertEqual(len(left), 1, "a failed lookup dropped the check (#1381 item 3)")

    def test_s10b_gh_failure_and_truncated_page_record_unknown(self):
        for merged, fail in (([], True), ([{"number": n, "mergedAt": iso(-5)} for n in range(1, 101)], False)):
            for path in (self.marker, self.pending):
                if os.path.exists(path):
                    os.remove(path)
            self.bash(self.M + " 1309 --squash")
            self.use_gh(merged, fail=fail)
            p = self.run_stop()
            self.assertEqual(p.returncode, 2, "fail=%s: %s" % (fail, p.stderr))
            self.assertIn("unknown merge", p.stderr)

    def test_s11_another_sessions_stale_check_is_resolved_by_this_session(self):
        self.write_pending([
            {"session_id": "closed", "ts": iso(-3 * 3600), "numbers": ["1700"], "command": "x"},
            {"session_id": "alive", "ts": iso(-60), "numbers": ["1701"], "command": "y"},
        ])
        self.use_gh([{"number": 1700, "mergedAt": iso(-3 * 3600 + 120)},
                     {"number": 1701, "mergedAt": iso(-30)}])
        p = self.run_stop("me")
        self.assertEqual(p.returncode, 2, "a closed session's merge was never recorded: %s" % p.stderr)
        self.assertEqual(self.marker_prs(), ["1700"], "a live session's young check was taken over")
        left = self.read_jsonl(self.pending)
        self.assertEqual([r["session_id"] for r in left], ["alive"])

    def test_s11b_only_young_foreign_checks_means_no_gh_call(self):
        self.write_pending([{"session_id": "alive", "ts": iso(-60), "numbers": ["1702"], "command": "y"}])
        self.assertEqual(self.run_stop("me").returncode, 0)
        self.assertEqual(self.gh_calls(), [])

    def test_s12_mentions_trigger_but_github_decides(self):
        # The #1036 / MAJOR-1 shapes: comment, echo, grep, heredoc bodies,
        # quoted JSON, python -c. They may trigger a check; with no merge on
        # GitHub, nothing is recorded.
        mentions = [
            "# reminder: run " + self.M + " 123 later",
            "echo 'about to run " + self.M + " 123'",
            'echo \'{"tool_input":{"command":"gate; ' + self.M + ' 5"}}\' | python h.py',
            "cat <<'EOF'\nDo not paste " + self.M + " into chat\nEOF",
            "git commit -m \"$(cat <<'EOF'\nfix: 12\" screens\ngate; " + self.M + " 5\nEOF\n)\"",
            'python -c "gate(); ' + self.M + ' 5"',
        ]
        for cmd in mentions:
            self.bash(cmd)
        p = self.run_stop()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(self.marker))
        self.assertEqual(len(self.gh_calls()), 1, "more than one gh call in a single Stop")

    def test_s13_a_literal_number_ignores_other_prs_merged_meanwhile(self):
        self.bash(self.M + " 1304 --squash")
        self.use_gh([{"number": 1999, "mergedAt": iso(-5)}])
        self.assertEqual(self.run_stop().returncode, 0)
        self.assertFalse(os.path.exists(self.marker), "another PR's merge was attributed to this call")
        self.assertIn("1304", open(self.pending, encoding="utf-8").read())

    def test_s13b_flags_before_the_number_still_give_a_literal(self):
        self.bash(self.M + " --squash --delete-branch 812")
        self.use_gh([{"number": 812, "mergedAt": iso(-5)}, {"number": 1999, "mergedAt": iso(-5)}])
        self.assertEqual(self.run_stop().returncode, 2)
        self.assertEqual(self.marker_prs(), ["812"])

    def test_s14_merge_before_the_lookback_window_is_not_this_calls(self):
        self.bash(self.M + " 1305 --squash")
        self.use_gh([{"number": 1305, "mergedAt": iso(-86400)}])
        self.assertEqual(self.run_stop().returncode, 0)
        self.assertFalse(os.path.exists(self.marker), "a day-old merge was attributed to a new call")

    def test_s15_foreground_merge_just_before_the_trigger_counts(self):
        # PostToolUse fires after the command ran; its merge predates the trigger.
        self.bash(self.M + " 1306 --squash")
        self.use_gh([{"number": 1306, "mergedAt": iso(-300)}])
        self.assertEqual(self.run_stop().returncode, 2)
        self.assertEqual(self.marker_prs(), ["1306"])

    def test_s16_partially_merged_check_does_not_record_twice(self):
        self.bash("%s 1310 --squash; %s 1311 --squash" % (self.M, self.M))
        self.use_gh([{"number": 1310, "mergedAt": iso(-5)}])
        self.run_stop()
        self.use_gh([{"number": 1310, "mergedAt": iso(-5)}, {"number": 1311, "mergedAt": iso(-1)}])
        self.run_stop()
        self.assertEqual(self.marker_prs(), ["1310", "1311"])
        self.assertFalse(os.path.exists(self.pending))

    def test_s17_github_check_runs_only_in_ipodhan(self):
        self.bash(self.M + " 1312 --squash")
        self.use_gh([{"number": 1312, "mergedAt": iso(-5)}])
        p = self.run_stop(cwd=self.other)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.gh_calls(), [])

    # ---- publish, staleness and session scope (unchanged behaviour) ----
    def test_c2_stop_with_marker_in_non_ipodhan_cwd_does_not_block(self):
        self.write_marker([{"pr": "123", "session_id": "me"}])
        p = self.run_stop(cwd=self.other)
        self.assertEqual(p.returncode, 0, "blocked a non-IPODhan session; stderr=%s" % p.stderr)
        self.assertNotIn("Board owed", p.stderr)

    def test_d_artifact_publish_with_board_url_clears_marker(self):
        self.write_marker([{"pr": "123", "session_id": "me"}])
        p = self.run_hook(
            "PostToolUseArtifact",
            {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL, "file_path": "board.html"}},
        )
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertFalse(os.path.exists(self.marker), "marker not cleared by board publish")

    def test_d2_artifact_publish_of_another_artifact_does_not_clear(self):
        self.write_marker([{"pr": "123", "session_id": "me"}])
        self.run_hook(
            "PostToolUseArtifact",
            {"tool_name": "Artifact", "tool_input": {"url": "https://claude.ai/artifact/SomeOther1234"}},
        )
        self.assertTrue(os.path.exists(self.marker), "an unrelated artifact cleared the marker")

    def test_d3_non_publish_action_on_board_does_not_clear(self):
        self.write_marker([{"pr": "123", "session_id": "me"}])
        self.run_hook(
            "PostToolUseArtifact",
            {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL, "action": "read"}},
        )
        self.assertTrue(os.path.exists(self.marker), "a read cleared the marker")

    def test_e_stop_after_publish_exits_zero(self):
        self.bash(self.M + " 123")
        self.use_gh([{"number": 123, "mergedAt": iso(-5)}])
        self.assertEqual(self.run_stop().returncode, 2)
        self.run_hook("PostToolUseArtifact", {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL}})
        p = self.run_stop()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stderr.strip(), "")

    def test_f_marker_older_than_12h_warns_instead_of_blocking(self):
        self.write_marker([{"pr": "123", "session_id": "me"}])
        old = time.time() - 13 * 3600
        os.utime(self.marker, (old, old))
        p = self.run_stop()
        self.assertEqual(p.returncode, 0, "stale marker blocked; stderr=%s" % p.stderr)
        self.assertIn("stale marker", p.stdout)

    def test_g_malformed_stdin_exits_zero(self):
        for event in ("PostToolUseBash", "PostToolUseArtifact", "Stop"):
            p = self.run_hook(event, "not json at all {{{")
            self.assertEqual(p.returncode, 0, "%s blocked on malformed stdin" % event)

    def test_g2_stop_hook_active_exits_zero(self):
        self.write_marker([{"pr": "123", "session_id": "me"}])
        p = self.run_stop(stop_hook_active=True)
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_g3_off_switch_disables_everything(self):
        p = self.run_hook(
            "PostToolUseBash",
            {"tool_name": "Bash", "tool_input": {"command": self.M + " 123"}, "cwd": self.ipodhan},
            env_extra={"BOARD_OWED_GUARD": "0"},
        )
        self.assertEqual(p.returncode, 0)
        self.assertFalse(os.path.exists(self.pending))

    def test_g4_corrupt_pending_file_never_crashes_stop(self):
        with open(self.pending, "w", encoding="utf-8") as f:
            f.write("garbage\n" + json.dumps(["list"]) + "\n" + json.dumps({"session_id": "me", "ts": "nope"}) + "\n")
        p = self.run_stop()
        self.assertIn(p.returncode, (0, 2), p.stderr)
        self.assertIn("unknown merge", p.stderr, "an unreadable check must fail safe")

    def test_l_session_id_printed(self):
        self.bash(self.M + " 555 --squash", session="abcdef1234567890")
        self.use_gh([{"number": 555, "mergedAt": iso(-5)}])
        p = self.run_stop("abcdef1234567890")
        self.assertEqual(p.returncode, 2)
        self.assertIn("abcdef12", p.stderr, "Stop message did not print the owing session id")
        self.assertEqual(self.read_jsonl(self.marker)[0]["session_id"], "abcdef1234567890")

    # Mutation: break the url match; case (d) must then FAIL to clear.
    def test_h_mutation_broken_url_match_fails_case_d(self):
        mutant = os.path.join(self.tmp, "mutant-board-owed-guard.py")
        src = open(HOOK_PATH, encoding="utf-8").read()
        mutated = src.replace('BOARD_ID = "NohBg52m7AUjS8kTDMxxKM"', 'BOARD_ID = "XXXXmutantXXXX"', 1)
        self.assertNotEqual(src, mutated, "mutation did not apply — test is vacuous")
        open(mutant, "w", encoding="utf-8").write(mutated)
        self.write_marker([{"pr": "123", "session_id": "me"}])
        self.run_hook(
            "PostToolUseArtifact",
            {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL}},
            hook_path=mutant,
        )
        self.assertTrue(
            os.path.exists(self.marker),
            "MUTATION SURVIVED: a broken url match still cleared the marker",
        )
        self.run_hook("PostToolUseArtifact", {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL}})
        self.assertFalse(os.path.exists(self.marker), "real hook failed to clear after mutation test")

    # (m) 2026-09-23: facts go stale on the clock, not on merges
    def test_m1_no_marker_old_publish_in_ipodhan_blocks(self):
        old = time.time() - 25 * 3600
        os.utime(self.stamp, (old, old))
        p = self.run_stop()
        self.assertEqual(p.returncode, 2, "old publish did not block; stderr=%s" % p.stderr)
        self.assertIn("last published", p.stderr)

    def test_m2_no_marker_never_published_blocks(self):
        os.remove(self.stamp)
        p = self.run_stop()
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertIn("no recorded board publish", p.stderr)

    def test_m3_no_marker_fresh_publish_exits_zero(self):
        p = self.run_stop()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stderr.strip(), "")

    def test_m4_old_publish_outside_ipodhan_exits_zero(self):
        os.remove(self.stamp)
        p = self.run_stop(cwd=self.other)
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_m5_board_publish_writes_the_stamp(self):
        os.remove(self.stamp)
        self.run_hook("PostToolUseArtifact", {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL}})
        self.assertTrue(os.path.exists(self.stamp), "publish did not record a stamp")
        p = self.run_stop()
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

    # (n) a refused publish must not clear the debt or reset the clock
    def test_n1_refused_publish_does_not_clear_or_stamp(self):
        self.write_marker([{"pr": "123", "session_id": "me"}])
        os.remove(self.stamp)
        self.run_hook("PostToolUseArtifact", {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL},
                                              "tool_response": "Publish refused - nothing was merged or published"})
        self.assertTrue(os.path.exists(self.marker), "refused publish cleared the marker")
        self.assertFalse(os.path.exists(self.stamp), "refused publish wrote the stamp")

    def test_n2_successful_publish_clears_and_stamps(self):
        self.write_marker([{"pr": "123", "session_id": "me"}])
        os.remove(self.stamp)
        self.run_hook("PostToolUseArtifact", {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL},
                                              "tool_response": {"url": BOARD_URL, "artifact_id": "b094e3ba-a60f-4c65-845c-f2d56d8c653c", "updated": True, "seq": 66, "version": "1790130990-0d47"}})  # real payload shape, captured 2026-09-23
        self.assertFalse(os.path.exists(self.marker))
        self.assertTrue(os.path.exists(self.stamp))

    # (o) 2026-09-25 session scope: Stop blocks only the session that merged.
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

    def test_o10_stop_hook_active_never_blocks(self):
        self.write_marker([{"pr": "1", "session_id": "me"}])
        p = self.run_stop("me", stop_hook_active=True)
        self.assertEqual(p.returncode, 0, "rc=%s" % p.returncode)

    # ---- (t) #1381: coverage by commit ancestry, lost update, fail-safe drop ----
    def publish(self, sha=None, rendered_offset=0, stamped=True):
        """Publish a board file stamped now+rendered_offset s, carrying
        data-rendered-sha=`sha` when given."""
        path = os.path.join(self.tmp, "board-%s.html" % self._testMethodName)
        attr = ' data-rendered-sha="%s"' % sha if sha else ""
        body = ("<html><p class=\"stamp\" data-rendered-at=\"%s\"%s>x</p></html>" % (iso(rendered_offset), attr)
                if stamped else "<html>no stamp</html>")
        open(path, "w", encoding="utf-8").write(body)
        p = self.run_hook("PostToolUseArtifact",
                          {"tool_name": "Artifact", "tool_input": {"url": BOARD_URL, "file_path": path}})
        self.assertEqual(p.returncode, 0, p.stderr)

    @staticmethod
    def row(number, offset, oid):
        return {"number": number, "mergedAt": iso(offset), "mergeCommit": {"oid": oid}}

    def test_t1_rendered_sha_after_the_merge_covers_it(self):
        self.bash(self.M + " 1381 --squash")
        self.publish(sha=self.c[2])
        self.use_gh([self.row(1381, -120, self.c[1])])
        p = self.run_stop()
        self.assertEqual(p.returncode, 0, "a merge the page contains was re-owed: %s" % p.stderr)
        self.assertFalse(os.path.exists(self.marker))

    def test_t1b_computed_number_check_survives_publish_without_re_owing(self):
        self.bash(self.M + ' "$PR" --squash')
        self.use_gh([self.row(1382, -120, self.c[1])])
        self.assertEqual(self.run_stop().returncode, 2)
        self.publish(sha=self.c[1])
        for _ in range(2):
            p = self.run_stop()
            self.assertEqual(p.returncode, 0, "re-owed after publish: %s" % p.stderr)

    def test_t2_merge_a_publish_merge_b_owes_only_b(self):
        self.bash(self.M + ' "$PR" --squash')
        self.publish(sha=self.c[1])
        self.use_gh([self.row(1390, -120, self.c[1]), self.row(1391, -60, self.c[2])])
        p = self.run_stop()
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertEqual(self.marker_prs(), ["1391"], "only the merge the page lacks is owed")

    def test_t3_gh_down_after_publish_owes_unknown(self):
        # Round 3: no clock covers anything. Without GitHub there is no merge
        # commit to test, so the merge stays owed (one extra prompt).
        self.write_pending([{"session_id": "me", "ts": iso(-300), "numbers": ["1383"], "background": False, "command": "x"}])
        self.publish(sha=self.c[2])
        self.use_gh([], fail=True)
        p = self.run_stop()
        self.assertEqual(p.returncode, 2, "gh down was treated as covered")
        self.assertIn("unknown merge", p.stderr)

    def test_t4_check_appended_by_another_session_during_gh_survives(self):
        self.write_pending([{"session_id": "me", "ts": iso(-60), "numbers": ["1500"], "command": "x"}])
        other = {"session_id": "other", "ts": iso(-1), "numbers": ["1501"], "command": "y"}
        self.use_gh([], side_append=(self.pending, other))
        self.assertEqual(self.run_stop("me").returncode, 0)
        ids = [r["session_id"] for r in self.read_jsonl(self.pending)]
        self.assertIn("other", ids, "a check queued during the gh call was wiped (lost update)")

    def test_t5_lock_held_elsewhere_fails_open(self):
        holder = subprocess.Popen([sys.executable, "-c", HOLD_LOCK_SCRIPT, self.pending + ".lock", "8"],
                                  stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), "held")
            self.write_pending([{"session_id": "me", "ts": iso(-60), "numbers": ["1502"], "command": "x"}])
            self.use_gh([{"number": 1502, "mergedAt": iso(-5)}])
            t0 = time.time()
            p = self.run_hook("Stop", {"session_id": "me", "cwd": self.ipodhan},
                              env_extra={"BOARD_OWED_LOCK_TIMEOUT": "1"})
            self.assertEqual(p.returncode, 2, "a held lock broke the hook: %s" % p.stderr)
            self.assertLess(time.time() - t0, 7, "waited on the lock past its timeout")
            self.assertEqual(self.marker_prs(), ["1502"])
            self.assertFalse(os.path.exists(self.pending), "pending not rewritten after the lock timeout")
        finally:
            holder.kill()
            holder.wait()

    def test_t5b_append_waits_for_a_held_lock_then_lands(self):
        holder = subprocess.Popen([sys.executable, "-c", HOLD_LOCK_SCRIPT, self.pending + ".lock", "2"],
                                  stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), "held")
            t0 = time.time()
            self.bash(self.M + " 1505 --squash")
            self.assertGreater(time.time() - t0, 1.0, "the append did not take the lock")
            self.assertEqual(len(self.read_jsonl(self.pending)), 1)
        finally:
            holder.kill()
            holder.wait()

    def test_t6_gh_failure_keeps_the_check_and_a_later_stop_records_the_real_merge(self):
        self.bash(self.M + " 1503 --squash")
        self.use_gh([], fail=True)
        p = self.run_stop()
        self.assertEqual(p.returncode, 2)
        self.assertIn("unknown merge", p.stderr)
        self.assertEqual(len(self.read_jsonl(self.pending)), 1, "check dropped on gh failure")
        os.remove(self.marker)
        self.use_gh([{"number": 1503, "mergedAt": iso(5)}])
        p = self.run_stop()
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertEqual(self.marker_prs(), ["1503"], "the real merge was lost after a gh failure")

    def test_t6b_repeated_gh_failure_owes_unknown_once(self):
        self.bash(self.M + " 1504 --squash")
        self.use_gh([], fail=True)
        self.assertEqual(self.run_stop().returncode, 2)
        os.remove(self.marker)
        self.assertEqual(self.run_stop().returncode, 0, "unknown re-owed on every Stop")

    def test_t6c_check_older_than_24h_is_dropped_after_failed_lookups(self):
        self.write_pending([{"session_id": "me", "ts": iso(-25 * 3600), "numbers": None, "command": "x"}])
        self.use_gh([], fail=True)
        self.assertEqual(self.run_stop().returncode, 2)
        self.assertFalse(os.path.exists(self.pending))

    def test_t9_rendered_sha_before_the_merge_is_owed(self):
        self.bash(self.M + " 1392 --squash")
        self.use_gh([self.row(1392, -180, self.c[1])])
        self.publish(sha=self.c[0])  # page built from the commit BEFORE the merge
        p = self.run_stop()
        self.assertEqual(p.returncode, 2, "a merge the page never showed was treated as covered: %s" % p.stderr)
        self.assertEqual(self.marker_prs(), ["1392"])

    def test_t9a_stale_fetch_old_sha_owes_a_merge_from_an_hour_ago(self):
        # The page was rendered and published NOW, but from an origin/main last
        # fetched hours ago (sha c0). A merge an hour ago (c1) predates both the
        # render and the publish clock, and is still not on the page.
        self.write_pending([{"session_id": "me", "ts": iso(-3700), "numbers": None, "command": "x"}])
        self.publish(sha=self.c[0], rendered_offset=0)
        self.use_gh([self.row(1395, -3600, self.c[1])])
        p = self.run_stop()
        self.assertEqual(p.returncode, 2, "an old render sha covered a later merge: %s" % p.stderr)
        self.assertEqual(self.marker_prs(), ["1395"])

    def test_t9b_page_without_a_sha_covers_nothing(self):
        self.bash(self.M + " 1393 --squash")
        self.publish(sha=None)  # stamped page, no data-rendered-sha
        self.assertTrue(os.path.exists(self.stamp), "the publish clock file must still be written")
        self.assertIsNone(json.loads(open(self.stamp).read())["rendered_sha"])
        self.use_gh([self.row(1393, -120, self.c[0])])
        self.assertEqual(self.run_stop().returncode, 2, "a page with no sha covered a merge")
        self.assertEqual(self.marker_prs(), ["1393"])

    def test_t9c_publish_stores_the_pages_rendered_sha(self):
        self.publish(sha=self.c[1])
        self.assertEqual(json.loads(open(self.stamp).read())["rendered_sha"], self.c[1])

    def test_t9d_git_failure_means_owed(self):
        self.bash(self.M + " 1396 --squash")
        self.publish(sha=self.c[2])
        self.use_gh([self.row(1396, -120, self.c[1])])
        p = self.run_hook("Stop", {"session_id": "me", "cwd": self.ipodhan},
                          env_extra={"BOARD_OWED_REPO": self.not_a_repo})
        self.assertEqual(p.returncode, 2, "a git failure counted as covered: %s" % p.stderr)
        self.assertEqual(self.marker_prs(), ["1396"])

    def test_t9e_unfetchable_or_missing_oid_means_owed(self):
        self.bash(self.M + ' "$PR" --squash')
        self.publish(sha=self.c[2])
        self.use_gh([self.row(1397, -120, "d" * 40),  # not local, fetch fails
                     {"number": 1398, "mergedAt": iso(-120)}])  # gh gave no oid
        p = self.run_stop()
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertEqual(self.marker_prs(), ["1397", "1398"])

    def test_t11_a_check_removed_by_another_session_stays_removed(self):
        # Reviewer mutation M7 survived: nothing pinned that a record another
        # session removed during the gh call is not written back.
        mine = {"session_id": "me", "ts": iso(-60), "numbers": ["1700"], "command": "x"}
        theirs = {"session_id": "other", "ts": iso(-1), "numbers": ["1701"], "command": "y"}
        self.write_pending([mine])
        self.use_gh([], side_write=(self.pending, [theirs]))
        self.assertEqual(self.run_stop("me").returncode, 0)
        recs = self.read_jsonl(self.pending)
        self.assertEqual([r["numbers"] for r in recs], [["1701"]],
                         "a check another session removed came back: %r" % recs)

    def test_t10_concurrent_rewrite_is_not_duplicated_and_removal_sticks(self):
        mine = {"session_id": "me", "ts": iso(-60), "numbers": ["1600"], "command": "x"}
        gone = {"session_id": "other", "ts": iso(-30), "numbers": ["1601"], "command": "g", "background": True}
        self.write_pending([mine, gone])
        rewritten = dict(mine, recorded=["1600"], unknown_noted=True)
        self.use_gh([], fail=True, side_append=(self.pending, rewritten))
        self.assertEqual(self.run_stop("me").returncode, 2)
        recs = self.read_jsonl(self.pending)
        mine_recs = [r for r in recs if r.get("numbers") == ["1600"]]
        self.assertEqual(len(mine_recs), 1, "a rewritten record was duplicated: %r" % recs)

    def test_t6d_24h_limit_keeps_23h_drops_25h_and_logs(self):
        self.write_pending([{"session_id": "me", "ts": iso(-23 * 3600), "numbers": None, "command": "young23"},
                            {"session_id": "me", "ts": iso(-25 * 3600), "numbers": None, "command": "old25"}])
        self.use_gh([], fail=True)
        self.assertEqual(self.run_stop().returncode, 2)
        cmds = [r["command"] for r in self.read_jsonl(self.pending)]
        self.assertEqual(cmds, ["young23"])
        log = open(self.errlog, encoding="utf-8").read()
        self.assertIn("pending check dropped after 24h of failed GitHub lookups: old25", log)
        self.assertNotIn("young23", log)

    def test_t7_stale_copy_is_gone(self):
        stale = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "..",
                                              "docs", "design", "board", "hooks"))
        self.assertFalse(os.path.exists(stale), "the stale copy of the hook is back: " + stale)

    def test_t8_header_lists_the_auto_merge_limit(self):
        head = open(HOOK_PATH, encoding="utf-8").read(6000)
        self.assertIn("--auto", head)
        self.assertIn("MORE THAN 2 h", head)


if __name__ == "__main__":
    unittest.main(verbosity=2)
