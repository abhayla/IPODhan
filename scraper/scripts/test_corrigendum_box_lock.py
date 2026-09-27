"""
#151 round 3 (W-178c class): the corrigendum page reader takes the cross-slot box lock.

`read_corrigendum_pages.py` runs pdfplumber plus OCR for up to 15 minutes, spawned by the
document cycle of BOTH slots (prod and staging share one 2-vCPU box). Before this round it took
no box lock, so it could run beside another slot's `extract_filing.py`. The contract is the one
`extract_filing.py` and `anchor_report_text.py` already honour (test_box_lock.py): acquire the
fcntl lock BEFORE any PDF work, wait up to EXTRACTOR_LOCK_WAIT_S, then exit 75 (busy).

MUTATION: remove the `box_lock.acquire(...)` block from `read_corrigendum_pages.main` -> every
test below that expects 75 goes RED (the reader runs while the lock is held).
"""
import errno
import os
import subprocess
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import box_lock  # noqa: E402
import read_corrigendum_pages  # noqa: E402

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))


class AlwaysHeldFcntl:
    """Another process holds the lock for the whole test: every non-blocking flock is EAGAIN."""

    LOCK_EX = 2
    LOCK_NB = 4

    def flock(self, fd, flags):
        raise OSError(errno.EAGAIN, "Resource temporarily unavailable")


class FreeFcntl:
    LOCK_EX = 2
    LOCK_NB = 4

    def flock(self, fd, flags):
        return None


def _isolate(monkeypatch, tmp_path, fake, wait_s):
    monkeypatch.setattr(box_lock, "_lock_fd", None)
    monkeypatch.setattr(box_lock, "fcntl", fake)
    monkeypatch.setattr(box_lock, "_POLL_INTERVAL_S", 0.05)
    monkeypatch.setenv("EXTRACTOR_BOX_LOCK", str(tmp_path / "extractor.lock"))
    monkeypatch.setenv("EXTRACTOR_LOCK_WAIT_S", str(wait_s))


def test_corrigendum_reader_waits_then_exits_busy_while_the_box_lock_is_held(tmp_path, monkeypatch, capsys):
    _isolate(monkeypatch, tmp_path, AlwaysHeldFcntl(), wait_s=1)
    read_calls = []
    monkeypatch.setattr(read_corrigendum_pages, "read_pages", lambda *a, **k: read_calls.append(a) or [])

    started = time.monotonic()
    rc = read_corrigendum_pages.main(["some.pdf"])
    waited = time.monotonic() - started

    assert rc == 75
    assert waited >= 0.9, "it must WAIT the configured window before giving up, not fail at once"
    assert read_calls == [], "no PDF work may start while another extractor holds the box lock"
    assert "extractor busy" in capsys.readouterr().err


def test_corrigendum_reader_reads_once_the_box_lock_is_free(tmp_path, monkeypatch, capsys):
    _isolate(monkeypatch, tmp_path, FreeFcntl(), wait_s=0)
    monkeypatch.setattr(
        read_corrigendum_pages,
        "read_pages",
        lambda path, ocr=True: [{"page": 1, "text": "x", "ocr": False, "confidence": None}],
    )

    rc = read_corrigendum_pages.main(["some.pdf"])

    assert rc in (0, None)
    assert '"pages"' in capsys.readouterr().out
    assert box_lock._lock_fd is not None, "the lock fd is kept for the process lifetime"


def test_busy_exit_code_matches_the_ts_contract():
    ts = open(os.path.join(_SCRIPTS_DIR, "..", "src", "utils", "low-priority-spawn.ts"), encoding="utf-8").read()
    assert "EXTRACTOR_BUSY_EXIT_CODE = %d;" % read_corrigendum_pages.EXTRACTOR_BUSY_EXIT_CODE in ts


try:
    import fcntl as _real_fcntl
except ImportError:
    _real_fcntl = None


@pytest.mark.skipif(_real_fcntl is None, reason="fcntl/flock box lock is POSIX-only (Linux VPS + ubuntu pr-gate job)")
def test_corrigendum_reader_exits_75_when_a_real_flock_holds_the_box_lock(tmp_path):
    lock_path = str(tmp_path / "extractor.lock")
    holder_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
    _real_fcntl.flock(holder_fd, _real_fcntl.LOCK_EX | _real_fcntl.LOCK_NB)
    try:
        env = dict(os.environ)
        env["EXTRACTOR_BOX_LOCK"] = lock_path
        env["EXTRACTOR_LOCK_WAIT_S"] = "0"
        proc = subprocess.run(
            [sys.executable, os.path.join(_SCRIPTS_DIR, "read_corrigendum_pages.py"), "nonexistent.pdf"],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert proc.returncode == 75
        assert "extractor busy" in proc.stderr
    finally:
        os.close(holder_fd)
