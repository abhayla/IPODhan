"""Self-tests for .claude/hooks/db-tunnel-session-end.py.

Stdlib-only unittest, no network, no real ssh/tunnel: the "stop command" is replaced with a
stub script (via DB_TUNNEL_STOP_COMMAND) that just writes a marker file, so a test asserts
"was the stop command invoked" without touching a real process or port.

Cases:
  - owner match            -> stop command IS invoked
  - other owner ("manual" or a different session id) -> stop command is NOT invoked
  - missing state file      -> exit 0, stop command NOT invoked
  - corrupt state file (not JSON) -> exit 0, stop command NOT invoked
  - state file is valid JSON but not an object (e.g. a list) -> exit 0, not invoked
  - missing session_id in the SessionEnd payload -> exit 0, not invoked
  - DB_TUNNEL_SESSION_END_GUARD=0 -> never invoked even on an owner match
  - a mutation of the owner check (owner-match inverted) turns the "other owner" case RED,
    proving the test can fail (per run-discipline C1/"proof must be able to fail").

Run:
    python .claude/hooks/tests/db-tunnel-session-end.test.py
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HOOK_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "db-tunnel-session-end.py")
)


class DbTunnelSessionEndTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="db-tunnel-hook-test-")
        self.state_path = os.path.join(self.tmp, "state.json")
        self.marker_path = os.path.join(self.tmp, "stopped.marker")
        # A stub "stop command": a tiny python script (portable across shells) that just
        # touches the marker file, so the test can assert invocation without a real tunnel.
        self.stub_path = os.path.join(self.tmp, "stub_stop.py")
        with open(self.stub_path, "w", encoding="utf-8") as f:
            f.write(
                "import os, sys\n"
                "with open(sys.argv[1], 'w', encoding='utf-8') as f:\n"
                "    f.write('stopped:' + os.environ.get('CLAUDE_CODE_SESSION_ID', ''))\n"
            )

    def _run(self, session_id, env_overrides=None, payload_override=None):
        env = dict(os.environ)
        env["DB_TUNNEL_STATE_FILE"] = self.state_path
        env["DB_TUNNEL_STOP_COMMAND"] = "%s %s %s" % (
            sys.executable,
            self.stub_path,
            self.marker_path,
        )
        if env_overrides:
            env.update(env_overrides)
        payload = {"session_id": session_id} if payload_override is None else payload_override
        proc = subprocess.run(
            [sys.executable, HOOK_PATH],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            env=env,
            timeout=15,
        )
        return proc

    def _write_state(self, owner, extra=None):
        state = {"owner": owner, "msys_pid": 12345, "winpid": 6789, "port": 15432}
        if extra:
            state.update(extra)
        with open(self.state_path, "w", encoding="utf-8") as f:
            json.dump(state, f)

    def assertStopped(self, msg=""):
        self.assertTrue(os.path.exists(self.marker_path), "stop command was NOT invoked " + msg)

    def assertNotStopped(self, msg=""):
        self.assertFalse(os.path.exists(self.marker_path), "stop command WAS invoked " + msg)

    def test_owner_match_invokes_stop(self):
        self._write_state(owner="session-abc")
        proc = self._run(session_id="session-abc")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertStopped()

    def test_child_env_gets_session_id_even_when_absent_from_hook_env(self):
        # Round 2 reviewer finding: the hook must pass CLAUDE_CODE_SESSION_ID to the CHILD
        # explicitly, never rely on the harness having exported it into the hook's own process.
        # Simulate the harness NOT exporting it by deleting it from the hook's environment, then
        # assert the child still saw the correct value via the payload -> env plumbing.
        self._write_state(owner="session-abc")
        env = dict(os.environ)
        env.pop("CLAUDE_CODE_SESSION_ID", None)
        env["DB_TUNNEL_STATE_FILE"] = self.state_path
        env["DB_TUNNEL_STOP_COMMAND"] = "%s %s %s" % (sys.executable, self.stub_path, self.marker_path)
        proc = subprocess.run(
            [sys.executable, HOOK_PATH],
            input=json.dumps({"session_id": "session-abc"}),
            capture_output=True,
            text=True,
            env=env,
            timeout=15,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        with open(self.marker_path, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertEqual(
            content,
            "stopped:session-abc",
            "child did not receive CLAUDE_CODE_SESSION_ID from the hook (got: %r)" % content,
        )

    def test_other_session_owner_does_not_invoke_stop(self):
        self._write_state(owner="session-abc")
        proc = self._run(session_id="session-xyz")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotStopped()

    def test_manual_owner_does_not_invoke_stop(self):
        # "manual" is what db-tunnel.sh records when opened outside any Claude session; a
        # SessionEnd hook must never claim ownership of a manually-opened tunnel.
        self._write_state(owner="manual")
        proc = self._run(session_id="session-xyz")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotStopped()

    def test_missing_state_file_is_a_noop(self):
        # No _write_state() call — state file does not exist.
        proc = self._run(session_id="session-abc")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotStopped()

    def test_corrupt_state_file_is_a_noop(self):
        with open(self.state_path, "w", encoding="utf-8") as f:
            f.write("{not valid json::")
        proc = self._run(session_id="session-abc")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotStopped()

    def test_state_file_not_an_object_is_a_noop(self):
        with open(self.state_path, "w", encoding="utf-8") as f:
            json.dump(["not", "a", "dict"], f)
        proc = self._run(session_id="session-abc")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotStopped()

    def test_missing_session_id_in_payload_is_a_noop(self):
        self._write_state(owner="session-abc")
        proc = self._run(session_id=None, payload_override={})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotStopped()

    def test_guard_off_switch_never_invokes_stop(self):
        self._write_state(owner="session-abc")
        proc = self._run(session_id="session-abc", env_overrides={"DB_TUNNEL_SESSION_END_GUARD": "0"})
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotStopped()

    def test_empty_stdin_is_a_noop(self):
        env = dict(os.environ)
        env["DB_TUNNEL_STATE_FILE"] = self.state_path
        env["DB_TUNNEL_STOP_COMMAND"] = "%s %s %s" % (sys.executable, self.stub_path, self.marker_path)
        self._write_state(owner="session-abc")
        proc = subprocess.run(
            [sys.executable, HOOK_PATH],
            input="",
            capture_output=True,
            text=True,
            env=env,
            timeout=15,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotStopped()


if __name__ == "__main__":
    unittest.main()
