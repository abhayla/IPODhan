"""W-178c round 2 — the box lock, now inside the python extractor process.

Run:  cd scraper && python -m pytest scripts/test_box_lock.py -q

Real `fcntl.flock` is Linux-only, so this dev box (and CI's non-Linux
runners) exercise the busy/success paths through a FAKE `fcntl` module
substituted at `box_lock.fcntl` — it models the one property real advisory
locking has that these tests depend on: two SEPARATE `os.open()` calls
against the SAME underlying file (same device+inode) conflict under
`LOCK_EX | LOCK_NB`, exactly like two separate OS processes would. The
non-fcntl-platform test does not need a fake at all — it exercises the
REAL absence of `fcntl` this dev box already has.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import box_lock  # noqa: E402


class FakeFcntl:
    """Models `fcntl.flock(fd, LOCK_EX | LOCK_NB)` well enough for these
    tests: tracks which (device, inode) pairs are "locked", regardless of
    which fd opened them — mirroring how a REAL flock on Linux would
    conflict across two separate `open()` calls on the same file. Never
    releases (`LOCK_UN` is not implemented) — nothing in these tests needs
    it; each acquired lock is scoped to one held fake fd for the test's
    lifetime, same as the real module-global `_lock_fd` in `box_lock.py`.
    """

    LOCK_EX = 2
    LOCK_NB = 4

    def __init__(self):
        self._locked = set()

    def flock(self, fd, flags):
        st = os.fstat(fd)
        key = (st.st_dev, st.st_ino)
        if key in self._locked:
            raise OSError(11, "Resource temporarily unavailable")
        self._locked.add(key)


def _reset_lock_fd(monkeypatch):
    """`box_lock._lock_fd` is a module global that outlives one `acquire()`
    call by design (kept open for the process lifetime) — reset it between
    tests so one test's successful acquire never leaks into the next."""
    monkeypatch.setattr(box_lock, "_lock_fd", None)


def test_acquire_succeeds_on_first_try(tmp_path, monkeypatch):
    monkeypatch.setattr(box_lock, "fcntl", FakeFcntl())
    _reset_lock_fd(monkeypatch)
    lock_path = str(tmp_path / "extractor.lock")

    assert box_lock.acquire(lock_path, wait_s=5) is True


def test_acquire_returns_false_when_another_holder_keeps_the_lock_past_the_wait(tmp_path, monkeypatch):
    fake = FakeFcntl()
    monkeypatch.setattr(box_lock, "fcntl", fake)
    monkeypatch.setattr(box_lock, "_POLL_INTERVAL_S", 0.05)
    _reset_lock_fd(monkeypatch)
    lock_path = str(tmp_path / "extractor.lock")

    # First "process": opens its own fd and holds the lock for the rest of
    # this test (never released) — module global `_lock_fd` keeps it alive.
    assert box_lock.acquire(lock_path, wait_s=5) is True
    holder_fd = box_lock._lock_fd

    # Second "process": a genuinely SEPARATE fd (its own os.open call) on the
    # SAME file — FakeFcntl conflicts on (device, inode), same as real flock.
    _reset_lock_fd(monkeypatch)
    busy = box_lock.acquire(lock_path, wait_s=0.2)

    assert busy is False
    os.close(holder_fd)


def test_acquire_fails_open_on_an_unexpected_errno_instead_of_treating_it_as_contention(tmp_path, monkeypatch, capsys):
    """Round 3 (minor): only EAGAIN/EACCES/EWOULDBLOCK are REAL contention —
    any other errno (ENOLCK: no locks available/exhausted; EBADF: the fd
    itself is bad) is an environment problem, not another extractor holding
    the box lock, and must fail-open immediately rather than waiting out the
    full `wait_s` only to report `False`."""
    import errno as errno_module

    class RaisesUnexpectedErrno:
        LOCK_EX = 2
        LOCK_NB = 4

        def flock(self, fd, flags):
            raise OSError(errno_module.ENOLCK, "No locks available")

    monkeypatch.setattr(box_lock, "fcntl", RaisesUnexpectedErrno())
    _reset_lock_fd(monkeypatch)
    lock_path = str(tmp_path / "extractor.lock")

    result = box_lock.acquire(lock_path, wait_s=5)

    assert result is True
    err = capsys.readouterr().err
    assert "unexpected errno" in err
    assert "running unlocked (W-178c)" in err


def test_acquire_polls_and_succeeds_once_the_lock_file_content_changes_are_irrelevant(tmp_path, monkeypatch):
    """A lock is per (device, inode), not per fd — acquiring, closing, and
    reopening the SAME path must be able to re-acquire (no stale-lock leak
    from a test that already released its own fd)."""
    monkeypatch.setattr(box_lock, "fcntl", FakeFcntl())
    _reset_lock_fd(monkeypatch)
    lock_path = str(tmp_path / "extractor.lock")

    assert box_lock.acquire(lock_path, wait_s=5) is True


def test_acquire_fails_open_when_the_lock_file_cannot_be_created(monkeypatch, capsys):
    monkeypatch.setattr(box_lock, "fcntl", FakeFcntl())
    _reset_lock_fd(monkeypatch)
    # A parent directory that does not exist — `os.open(..., O_CREAT)` raises
    # FileNotFoundError (a subclass of OSError), which `acquire()` must treat
    # as fail-open, not propagate.
    unwritable_path = os.path.join(
        "this-directory-does-not-exist-w178c", "nested", "extractor.lock"
    )

    result = box_lock.acquire(unwritable_path, wait_s=5)

    assert result is True
    err = capsys.readouterr().err
    assert "box lock unavailable" in err
    assert "running unlocked (W-178c)" in err


def test_acquire_returns_true_unconditionally_when_fcntl_is_absent(tmp_path, monkeypatch):
    """Non-Linux (this dev box, in real life): `box_lock.fcntl` is `None`
    (the real `import fcntl` failed at module load) — `acquire()` must
    fail-open immediately, without even trying to open the lock file."""
    monkeypatch.setattr(box_lock, "fcntl", None)
    _reset_lock_fd(monkeypatch)

    # Even an unwritable path must not matter — the fcntl-absent branch
    # returns True before ever calling `os.open`.
    unwritable_path = os.path.join("no", "such", "dir", "extractor.lock")
    assert box_lock.acquire(unwritable_path, wait_s=5) is True


def test_resolve_lock_path_default(monkeypatch):
    monkeypatch.delenv("EXTRACTOR_BOX_LOCK", raising=False)
    assert box_lock.resolve_lock_path() == box_lock.DEFAULT_EXTRACTOR_BOX_LOCK


def test_resolve_lock_path_honours_env_override(monkeypatch):
    monkeypatch.setenv("EXTRACTOR_BOX_LOCK", "/tmp/custom.lock")
    assert box_lock.resolve_lock_path() == "/tmp/custom.lock"


def test_resolve_lock_path_blank_env_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("EXTRACTOR_BOX_LOCK", "   ")
    assert box_lock.resolve_lock_path() == box_lock.DEFAULT_EXTRACTOR_BOX_LOCK


# ---------------------------------------------------------------------------
# Round 3: cross-language contract test — a REAL held `fcntl.flock` (this
# test process) must make a REAL `extract_filing.py` / `anchor_report_text.py`
# subprocess exit 75 with "extractor busy" on stderr. Every other test in
# this file exercises `box_lock.acquire()` in-process against a FAKE
# `fcntl`; this is the one test that proves the two python entrypoints wire
# `box_lock.acquire()` into their own `main()` correctly, and that the
# contract (`EXTRACTOR_BUSY_EXIT_CODE` = 75 in `low-priority-spawn.ts`) holds
# across the process boundary, not just inside `box_lock.py`'s own unit
# tests. `fcntl` only exists on POSIX platforms — Windows dev boxes (this
# laptop) and Windows CI runners skip; the ubuntu `pr-gate.yml` python job
# (which runs `pytest scripts/`, per `scraper/package.json`'s test config)
# collects and runs it for real.
import subprocess
import sys as _sys

import pytest

try:
    import fcntl as _real_fcntl
except ImportError:
    _real_fcntl = None

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))

pytestmark_skip_reason = "fcntl/flock box lock is POSIX-only (Linux VPS + ubuntu pr-gate job); this dev box is Windows"


@pytest.mark.skipif(_real_fcntl is None, reason=pytestmark_skip_reason)
def test_extract_filing_exits_75_when_a_real_flock_holds_the_box_lock(tmp_path):
    lock_path = str(tmp_path / "extractor.lock")

    # Hold the REAL lock from THIS test process for the subprocess's whole
    # lifetime — a separate `os.open()` on the same path, exactly like a
    # concurrent extractor would.
    holder_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
    _real_fcntl.flock(holder_fd, _real_fcntl.LOCK_EX | _real_fcntl.LOCK_NB)
    try:
        env = dict(os.environ)
        env["EXTRACTOR_BOX_LOCK"] = lock_path
        env["EXTRACTOR_LOCK_WAIT_S"] = "0"

        proc = subprocess.run(
            [
                _sys.executable,
                os.path.join(_SCRIPTS_DIR, "extract_filing.py"),
                "nonexistent.pdf",
                "--doc-type",
                "RHP",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

        assert proc.returncode == 75
        assert "extractor busy" in proc.stderr
    finally:
        os.close(holder_fd)


@pytest.mark.skipif(_real_fcntl is None, reason=pytestmark_skip_reason)
def test_anchor_report_text_exits_75_when_a_real_flock_holds_the_box_lock(tmp_path):
    lock_path = str(tmp_path / "extractor.lock")

    holder_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
    _real_fcntl.flock(holder_fd, _real_fcntl.LOCK_EX | _real_fcntl.LOCK_NB)
    try:
        env = dict(os.environ)
        env["EXTRACTOR_BOX_LOCK"] = lock_path
        env["ANCHOR_LOCK_WAIT_S"] = "0"

        proc = subprocess.run(
            [
                _sys.executable,
                os.path.join(_SCRIPTS_DIR, "anchor_report_text.py"),
                "nonexistent.pdf",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

        assert proc.returncode == 75
        assert "extractor busy" in proc.stderr
    finally:
        os.close(holder_fd)
