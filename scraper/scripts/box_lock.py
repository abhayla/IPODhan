"""
W-178c round 2 — the box lock now lives INSIDE the python extractor process,
not around it.

Round 1 wrapped the spawn with `flock -w <wait> -E 75 <lockfile> <bin> ...`
(`scraper/src/utils/low-priority-spawn.ts`'s `withBoxLock`). The Opus review
found three structural problems with wrapping from the OUTSIDE:

  1. A killed extractor (SIGKILL from the OOM killer, or Node's own
     `spawnSync` timeout) leaves `flock` itself as the process actually
     holding the lock — `flock` never observes the child die, so the lock
     stays held by an orphaned `flock` process until IT is also reaped,
     starving every other cycle for no reason.
  2. The wait was tied to `flock -w`, a SEPARATE timeout from Node's own
     `spawnSync` `timeout:` — the two could disagree, and a `flock` wait
     longer than the spawn timeout meant Node killed the whole wrapped
     command (both flock and the not-yet-started python) before flock ever
     got the lock.
  3. Node only ever saw `flock`'s exit code (propagated from the wrapped
     command, or flock's own 75 on timeout) — indistinguishable from "python
     itself decided to exit 75" without the round-1 comment explaining why
     that never happens on its own.

Moving the lock into the process itself fixes all three: `fcntl.flock` is
released by the KERNEL the instant the holding process dies for ANY reason
(normal exit, SIGKILL, SIGTERM) — there is no wrapper process to leak. The
wait is a plain `time.sleep` poll owned by the extractor script itself, so
it is inherently bounded by whatever timeout Node applies to the WHOLE
spawn (there is no second clock to disagree with). And exit 75 is now a
literal `sys.exit(75)` the script itself calls — the contract
(`EXTRACTOR_BUSY_EXIT_CODE` in `low-priority-spawn.ts`) is exactly what it
always claimed to be.

Fail-open, same as `withLowPriority`/`withBoxLock` before it: a box lock is
a best-effort mitigation for CPU contention on a 2-vCPU VPS, never a
correctness requirement. If the lock file cannot be opened/created (missing
directory, permissions), or `fcntl` does not exist on this platform
(Windows — every dev box), `acquire()` returns True and the extractor runs
unlocked, exactly as if no other extractor were running.
"""
import errno
import os
import sys
import time

try:
    import fcntl
except ImportError:  # Windows — every dev box; the VPS is always Linux.
    fcntl = None

DEFAULT_EXTRACTOR_BOX_LOCK = "/var/www/ipodhan/shared/extractor.lock"

# Held for the process's whole lifetime — released by the kernel on exit
# (normal or killed), never explicitly closed. A module global rather than a
# return value the caller must remember to keep alive: a script-local
# variable going out of scope (or being garbage-collected) would close the
# fd and silently drop the lock mid-extraction.
_lock_fd = None

# 0.5s poll interval — round 2 MINOR-5's `EXTRACTOR_NICE`/wait tuning showed
# a lock genuinely worth waiting tens of seconds for; polling every 0.5s
# costs at most that much slop on a wait that already runs to `wait_s`.
_POLL_INTERVAL_S = 0.5


def resolve_lock_path():
    """`EXTRACTOR_BOX_LOCK` override, else the shared VPS default — mirrors
    `resolveBoxLockPath()` in `low-priority-spawn.ts` (kept in sync by
    convention; there is no cross-language import to enforce it)."""
    raw = os.environ.get("EXTRACTOR_BOX_LOCK", "").strip()
    return raw if raw else DEFAULT_EXTRACTOR_BOX_LOCK


def acquire(lock_path, wait_s):
    """Try to hold the box lock, polling every 0.5s for up to `wait_s`
    seconds. Returns True once the lock is held (or the platform/lock file
    makes locking impossible — fail-open) and False only when a REAL lock
    is held by another process and the wait window elapsed without ever
    acquiring it.

    The fd is kept open in a module global for the process's remaining
    lifetime — `fcntl.flock` is an advisory lock tied to the OPEN FILE
    DESCRIPTION, not the process; closing (or exiting) releases it
    automatically, which is exactly the "a killed extractor releases its
    lock" property round 1's external `flock` wrapper did not have.
    """
    global _lock_fd
    if fcntl is None:
        return True  # non-Linux (no fcntl): fail-open, same as withLowPriority.

    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
    except OSError as exc:
        sys.stderr.write(
            "box lock unavailable (%s); running unlocked (W-178c)\n" % exc
        )
        return True

    # Round 3 (minor): only the errnos a REAL held lock raises under
    # LOCK_NB count as contention (EAGAIN on Linux, EACCES on some BSD/mac
    # flock shims, EWOULDBLOCK -- the same value as EAGAIN on most
    # platforms but a distinct symbol on a few). Any OTHER errno (ENOLCK --
    # no locks available/exhausted, EBADF -- the fd itself is bad) is an
    # environment problem, not contention, and must fail-open (same as the
    # file-cannot-be-created branch above) instead of being misreported as
    # "another extractor holds the box lock".
    contention_errnos = {
        errno.EAGAIN,
        errno.EACCES,
        getattr(errno, "EWOULDBLOCK", errno.EAGAIN),
    }
    deadline = time.monotonic() + max(0, wait_s)
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            _lock_fd = fd  # keep the fd (and the lock) alive for process lifetime
            return True
        except OSError as exc:
            if exc.errno not in contention_errnos:
                sys.stderr.write("box lock flock() failed with unexpected errno ")
                sys.stderr.write(str(exc.errno))
                sys.stderr.write(" (")
                sys.stderr.write(str(exc))
                sys.stderr.write("); running unlocked (W-178c)")
                sys.stderr.write(chr(10))
                os.close(fd)
                return True
            if time.monotonic() >= deadline:
                os.close(fd)
                return False
            time.sleep(_POLL_INTERVAL_S)
