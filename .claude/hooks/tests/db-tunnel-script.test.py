"""Self-tests for scripts/ops/db-tunnel.sh (PR #1080 round 2 — reviewer findings on `stop`).

Stdlib-only unittest driving the real bash script, with netstat / ps / kill replaced by tiny
Python stub scripts (DB_TUNNEL_NETSTAT / DB_TUNNEL_PS / DB_TUNNEL_KILL) so the whole suite runs
on Linux CI with no network, no real ssh, and no Windows host. The stub kill script also edits
the stub netstat output to simulate the port actually being freed, so "kill, then re-check the
listener" behaves like the real thing.

Class under test: `stop` must NEVER kill a process it did not record as ITS tunnel. Cases:
  - stale recorded PID that IS listening but is NOT ssh (per ps -W)      -> refuse, no kill
  - recorded PID IS ssh but is NOT the current listener                 -> refuse, no kill
  - recorded PID is both the current listener AND ssh                   -> kill, state cleared
  - `stop` (no --leftover) never kills an unclaimed listener, even ssh  -> refuse, no kill
  - `stop --leftover` kills only an UNCLAIMED ssh listener, skips a claimed one and a non-ssh one
  - owner mismatch (no --force)                                         -> refuse, no kill
  - the start lock, already held                                        -> `start` refuses

Run:
    python .claude/hooks/tests/db-tunnel-script.test.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

SCRIPT_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "scripts", "ops", "db-tunnel.sh")
)
BASH = os.environ.get("DB_TUNNEL_TEST_BASH", "bash")

NETSTAT_STUB = (
    "import os, sys\n"
    "p = os.environ.get('DB_TUNNEL_TEST_NETSTAT_FILE')\n"
    "if p and os.path.exists(p):\n"
    "    with open(p, 'r', encoding='utf-8') as f:\n"
    "        sys.stdout.write(f.read())\n"
)

PS_STUB = (
    "import os, sys\n"
    "sys.stdout.write('PID PPID PGID WINPID TTY UID STIME COMMAND\\n')\n"
    "p = os.environ.get('DB_TUNNEL_TEST_PS_FILE')\n"
    "if p and os.path.exists(p):\n"
    "    with open(p, 'r', encoding='utf-8') as f:\n"
    "        sys.stdout.write(f.read())\n"
)

# Records every invocation, AND edits the stub netstat file to drop any line ending in the
# killed winpid — simulating the listener actually going away once the (fake) kill lands.
KILL_STUB = (
    "import os, sys\n"
    "log = os.environ.get('DB_TUNNEL_TEST_KILL_LOG')\n"
    "if log:\n"
    "    with open(log, 'a', encoding='utf-8') as f:\n"
    "        f.write(' '.join(sys.argv[1:]) + '\\n')\n"
    "pid = None\n"
    "for i, a in enumerate(sys.argv):\n"
    "    # MSYS/Git-Bash path-converts a leading '//' to '/' when the target is treated as a\n"
    "    # native (non-msys) executable, so accept either spelling here.\n"
    "    if a.lstrip('/') == 'PID' and i + 1 < len(sys.argv):\n"
    "        pid = sys.argv[i + 1]\n"
    "netstat_file = os.environ.get('DB_TUNNEL_TEST_NETSTAT_FILE')\n"
    "if netstat_file and pid and os.path.exists(netstat_file):\n"
    "    with open(netstat_file, 'r', encoding='utf-8') as f:\n"
    "        lines = f.readlines()\n"
    "    lines = [l for l in lines if not l.rstrip().endswith(pid)]\n"
    "    with open(netstat_file, 'w', encoding='utf-8') as f:\n"
    "        f.writelines(lines)\n"
)

NETSTAT_LINE = "  TCP    127.0.0.1:15432       0.0.0.0:0              LISTENING       %s"
PS_LINE_SSH = "%s   1   1   %s  ?   0   00:00 /usr/bin/ssh -N -L 15432:localhost:5432 host"
PS_LINE_OTHER = "%s   1   1   %s  ?   0   00:00 /usr/bin/notepad.exe"


class DbTunnelScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="db-tunnel-script-test-")
        self.state_path = os.path.join(self.tmp, "state.json")
        self.lock_dir = os.path.join(self.tmp, "lock")
        self.log_path = os.path.join(self.tmp, "ssh.log")
        self.netstat_file = os.path.join(self.tmp, "netstat.txt")
        self.ps_file = os.path.join(self.tmp, "ps.txt")
        self.kill_log = os.path.join(self.tmp, "kill.log")
        self.netstat_stub = os.path.join(self.tmp, "netstat_stub.py")
        self.ps_stub = os.path.join(self.tmp, "ps_stub.py")
        self.kill_stub = os.path.join(self.tmp, "kill_stub.py")
        with open(self.netstat_stub, "w", encoding="utf-8") as f:
            f.write(NETSTAT_STUB)
        with open(self.ps_stub, "w", encoding="utf-8") as f:
            f.write(PS_STUB)
        with open(self.kill_stub, "w", encoding="utf-8") as f:
            f.write(KILL_STUB)

        self._spawned_pids = []

    def tearDown(self):
        for pid in self._spawned_pids:
            subprocess.run([BASH, "-c", "kill %s 2>/dev/null" % pid], capture_output=True)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _spawn_alive_msys_pid(self):
        # `kill -0 <pid>` under Git Bash/MSYS only reliably recognizes a PID that bash itself
        # launched (its own job-table `$!`), not an arbitrary foreign Windows PID (e.g. this
        # test's own interpreter). So "a live process this test's state file can point at" is a
        # REAL background process, launched the same way db-tunnel.sh launches ssh.
        proc = subprocess.run(
            [BASH, "-c", "nohup sleep 60 >/dev/null 2>&1 & disown; echo $!"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        pid = proc.stdout.strip()
        self.assertTrue(pid.isdigit(), "failed to spawn a background sleep: %r" % proc.stderr)
        self._spawned_pids.append(pid)
        return pid

    def _base_env(self):
        env = dict(os.environ)
        env.pop("CLAUDE_CODE_SESSION_ID", None)
        env["DB_TUNNEL_STATE_FILE"] = self.state_path
        env["DB_TUNNEL_LOCK_DIR"] = self.lock_dir
        env["DB_TUNNEL_LOG_FILE"] = self.log_path
        env["DB_TUNNEL_NETSTAT"] = "%s %s" % (sys.executable, self.netstat_stub)
        env["DB_TUNNEL_PS"] = "%s %s" % (sys.executable, self.ps_stub)
        env["DB_TUNNEL_KILL"] = "%s %s" % (sys.executable, self.kill_stub)
        env["DB_TUNNEL_TEST_NETSTAT_FILE"] = self.netstat_file
        env["DB_TUNNEL_TEST_PS_FILE"] = self.ps_file
        env["DB_TUNNEL_TEST_KILL_LOG"] = self.kill_log
        env["DB_TUNNEL_LOCK_STALE_SECS"] = "2"
        env["DB_TUNNEL_WAIT_SECS"] = "1"
        return env

    def _run(self, *args, env_overrides=None):
        env = self._base_env()
        if env_overrides:
            env.update(env_overrides)
        return subprocess.run(
            [BASH, SCRIPT_PATH] + list(args),
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )

    def _set_netstat(self, lines):
        with open(self.netstat_file, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + ("\n" if lines else ""))

    def _set_ps(self, lines):
        with open(self.ps_file, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + ("\n" if lines else ""))

    def _write_state(self, owner, msys_pid=999999, winpid=9001, extra=None):
        # msys_pid defaults to a fabricated, definitely-not-alive PID — the kill decision in
        # `stop` is gated on the winpid/ssh checks, never on msys_pid_alive, so most tests do not
        # need a real process here. Tests that DO need "recorded process is alive" (the
        # --leftover claim check, the decoy test) pass one from _spawn_alive_msys_pid().
        state = {
            "owner": owner,
            "msys_pid": msys_pid,
            "winpid": winpid,
            "port": 15432,
        }
        if extra:
            state.update(extra)
        with open(self.state_path, "w", encoding="utf-8") as f:
            json.dump(state, f)

    def _kill_calls(self):
        if not os.path.exists(self.kill_log):
            return []
        with open(self.kill_log, "r", encoding="utf-8") as f:
            return [l for l in f.read().splitlines() if l]

    # --- the class under test -------------------------------------------------------------

    def test_stale_pid_not_ssh_no_kill(self):
        self._write_state(owner="manual", winpid=9001)
        self._set_netstat([NETSTAT_LINE % "9001"])
        self._set_ps([PS_LINE_OTHER % (111, "9001")])
        proc = self._run("stop", "--force")
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("NOT an ssh process", proc.stderr)
        self.assertEqual(self._kill_calls(), [])
        self.assertTrue(os.path.exists(self.state_path), "state must be left in place")

    def test_recorded_pid_ssh_but_not_the_listener_no_kill(self):
        self._write_state(owner="manual", winpid=9001)
        self._set_netstat([NETSTAT_LINE % "9999"])
        self._set_ps([PS_LINE_SSH % (222, "9999")])
        proc = self._run("stop", "--force")
        self.assertEqual(proc.returncode, 1, proc.stderr)
        self.assertIn("not currently listening", proc.stderr)
        self.assertEqual(self._kill_calls(), [])

    def test_matching_recorded_ssh_listener_is_killed(self):
        self._write_state(owner="manual", winpid=9001)
        self._set_netstat([NETSTAT_LINE % "9001"])
        self._set_ps([PS_LINE_SSH % (333, "9001")])
        proc = self._run("stop", "--force")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        calls = self._kill_calls()
        self.assertEqual(len(calls), 1, calls)
        self.assertIn("9001", calls[0])
        self.assertFalse(os.path.exists(self.state_path))

    def test_stop_never_kills_unclaimed_leftover(self):
        # No state file; a listener IS present and IS ssh. Plain `stop` (no --leftover, no
        # --force) must refuse and never touch it.
        self._set_netstat([NETSTAT_LINE % "5001"])
        self._set_ps([PS_LINE_SSH % (444, "5001")])
        proc = self._run("stop")
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("unowned leftover", proc.stderr)
        self.assertEqual(self._kill_calls(), [])

    def test_leftover_kills_only_unclaimed_ssh_listener(self):
        # 7001: claimed by a LIVE state file -> must be skipped.
        # 7002: unclaimed, ssh -> must be killed.
        # 7003: unclaimed, NOT ssh -> must be skipped.
        alive_pid = self._spawn_alive_msys_pid()
        self._write_state(owner="manual", msys_pid=alive_pid, winpid=7001)
        self._set_netstat(
            [NETSTAT_LINE % "7001", NETSTAT_LINE % "7002", NETSTAT_LINE % "7003"]
        )
        self._set_ps(
            [
                PS_LINE_SSH % (10, "7001"),
                PS_LINE_SSH % (20, "7002"),
                PS_LINE_OTHER % (30, "7003"),
            ]
        )
        self._run("stop", "--leftover")
        calls = self._kill_calls()
        self.assertEqual(len(calls), 1, calls)
        self.assertIn("7002", calls[0])

    def test_decoy_stale_state_pointing_at_live_sleep_process_is_never_killed(self):
        # The reviewer's decoy (PR #1080 round 2): a stale state file whose msys_pid points at a
        # REAL, live, unrelated process (a `sleep`, standing in for "some other process now has
        # this msys pid" — pids get reused). The recorded winpid is no longer the port's actual
        # listener (that's what makes the state stale). `stop` must never kill the decoy process,
        # and the decoy MUST still be alive afterward — this is the round-1 defect class made
        # concrete: "kill the recorded PID blindly" would kill this decoy.
        decoy_pid = self._spawn_alive_msys_pid()
        self._write_state(owner="manual", msys_pid=decoy_pid, winpid=9001)
        # Nothing is actually listening on the port at all (the strongest form of "stale").
        self._set_netstat([])
        self._set_ps([])
        proc = self._run("stop", "--force")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self._kill_calls(), [], "the decoy's pid must never be passed to kill")
        alive = subprocess.run([BASH, "-c", "kill -0 %s" % decoy_pid], capture_output=True)
        self.assertEqual(alive.returncode, 0, "the decoy sleep process must still be ALIVE")

    def test_owner_mismatch_refuses(self):
        self._write_state(owner="session-abc", winpid=9001)
        self._set_netstat([NETSTAT_LINE % "9001"])
        self._set_ps([PS_LINE_SSH % (55, "9001")])
        proc = self._run("stop", env_overrides={"CLAUDE_CODE_SESSION_ID": "session-xyz"})
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("owned by", proc.stderr)
        self.assertEqual(self._kill_calls(), [])

    def test_lock_held_start_refuses(self):
        # A live (not-yet-stale) lock is held by "someone else". Give the lock a generous
        # staleness window (so this call must not reclaim it as abandoned) but a short WAIT
        # window (so the test does not have to wait out the full staleness timeout) — see
        # DB_TUNNEL_LOCK_WAIT_SECS in db-tunnel.sh's acquire_lock().
        os.makedirs(self.lock_dir)
        with open(os.path.join(self.lock_dir, "created_at"), "w", encoding="utf-8") as f:
            f.write(str(int(time.time())))
        self._set_netstat([])
        proc = self._run(
            "start",
            env_overrides={
                "DB_TUNNEL_LOCK_STALE_SECS": "60",
                "DB_TUNNEL_LOCK_WAIT_SECS": "2",
            },
        )
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("lock", proc.stderr.lower())
        # Must never have gotten far enough to attempt an ssh connection.
        self.assertFalse(os.path.exists(self.log_path) and os.path.getsize(self.log_path) > 0)


if __name__ == "__main__":
    unittest.main()
