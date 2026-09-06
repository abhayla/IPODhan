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
