"""
W-137 — shared memory ceiling for the extractor subprocesses.

The scraper's filing auto-persist service spawns `extract_filing.py` (and,
transitively, `extract_financials_pdf.py`'s core + `ocr_pages.py`'s OCR route)
once per hour per outstanding filing. A 400-page prospectus PDF held pdfplumber
page caches alive for the whole document, growing the process to 3.9-4.7 GB
RSS on an 8 GB VPS; the kernel OOM-killer then killed the process AND the pm2
daemon supervising it, restarting every app on the box.

This module gives every extractor entrypoint a hard virtual-memory ceiling
(`RLIMIT_AS`) so a runaway extraction raises a catchable `MemoryError` instead
of triggering the OOM killer. `RLIMIT_AS` bounds virtual address space, not
resident memory — libraries like onnxruntime/opencv (the OCR backend) can map
more virtual memory than they touch, so the default here is deliberately
generous; tune `EXTRACTOR_MAX_RSS_MB` down only after confirming the OCR route
still completes under the new value.

No-op on platforms without the `resource` module (Windows) — there is no
directly equivalent primitive there, and this guard is defense-in-depth for
the Linux VPS the auto-persist service actually runs on, not a portability
requirement.

Default: 3072 MB (VSZ, i.e. RLIMIT_AS — an address-space cap, not RSS).
Measured on the VPS (2026-09-05, staging venv, 8 GB box) under the PREVIOUS
2500 MB cap: the full `extract_filing.py` OCR route on a 522-page incident
DRHP peaked at 1,216 MB RSS in 1:17, and `ocr_pages.py --pages 0` on a scanned
ad peaked at 1,452 MB RSS — VSZ tracked roughly RSS + ~1.5 GB of mapped-but-
untouched library address space (onnxruntime/opencv). 3072 MB keeps that
same ~1.5 GB of headroom above the higher of the two measured RSS peaks.
Two scrapers (prod + staging) can run at once on the 8 GB box: 2 x 3072 MB
VSZ is fine because actual RSS use stays ~1.2-1.5 GB each — VSZ is address
space reserved, not memory paged in.
"""
import json
import os
import re

DEFAULT_MAX_RSS_MB = 3072

# The extractor CLI's own "the memory ceiling tripped" exit code. The node
# caller (`filing-auto-persist.ts`) treats this — like a signal-killed process
# ("exited null") — as a HARD failure that backs off for at least 24h instead
# of retrying hourly.
EXIT_MEMORY_CEILING = 3


def max_rss_mb():
    """The configured ceiling in MB (`EXTRACTOR_MAX_RSS_MB` env, default 2500)."""
    raw = os.environ.get("EXTRACTOR_MAX_RSS_MB", str(DEFAULT_MAX_RSS_MB))
    try:
        value = int(raw)
    except ValueError:
        value = DEFAULT_MAX_RSS_MB
    return value if value > 0 else DEFAULT_MAX_RSS_MB


def install_memory_ceiling():
    """Set RLIMIT_AS to `max_rss_mb()`.

    Returns the limit (in MB) that was applied, or `None` when the platform
    has no `resource` module (Windows) or the call itself failed — a caller
    can use the return value to log/test without guessing whether the guard
    is actually active.
    """
    try:
        import resource
    except ImportError:
        return None
    limit_bytes = max_rss_mb() * 1024 * 1024
    try:
        resource.setrlimit(resource.RLIMIT_AS, (limit_bytes, limit_bytes))
    except (ValueError, OSError):
        return None
    return max_rss_mb()


def memory_ceiling_error_json(limit_mb):
    """The JSON body emitted on stdout when a `MemoryError` is caught at the
    top level of an extractor script — the message text
    `filing-auto-persist.ts` does not parse (it treats any hard failure the
    same way), but a human reading the log/row sees exactly what happened."""
    return json.dumps({"error": "memory ceiling exceeded (%d MB)" % limit_mb})


# errno values raised by C extensions when RLIMIT_AS refuses an allocation.
# ENOMEM (12): "Cannot allocate memory" — the direct hit. EAGAIN (11): some
# allocators (and `can't start new thread`, which is raised as a bare
# RuntimeError, not OSError) surface a transient resource-unavailable errno
# under memory pressure rather than ENOMEM itself.
_MEMORY_EXHAUSTION_ERRNOS = frozenset({11, 12})

# Message substrings raised by non-MemoryError, non-OSError exception types
# when RLIMIT_AS starves an allocation inside a C extension: onnxruntime's
# RuntimeException/RuntimeError ("allocate" / "bad allocation"), and CPython's
# own `RuntimeError: can't start new thread` when pthread_create fails under
# the same address-space ceiling.
_MEMORY_EXHAUSTION_MESSAGE_RE = re.compile(
    r"allocat|cannot allocate|out of memory|can't start new thread|bad_alloc",
    re.IGNORECASE,
)


def is_memory_exhaustion(exc):
    """True when `exc` is the RLIMIT_AS ceiling manifesting as something OTHER
    than a plain `MemoryError` (which every caller already catches directly).

    Under `RLIMIT_AS`, only pure-Python allocations reliably raise
    `MemoryError`. C extensions (pdfplumber's C deps, onnxruntime, opencv —
    the OCR backend) instead raise `OSError` with `errno` ENOMEM/EAGAIN, an
    onnxruntime `RuntimeException`/`RuntimeError` mentioning "allocate" or
    "bad allocation", or `RuntimeError: can't start new thread` when the
    ceiling blocks a new native thread. Each of those escaped the W-137
    round-1 guard as an ordinary (soft) failure, retried hourly instead of
    getting the hard-failure 24h backoff — this closes that gap.
    """
    if isinstance(exc, MemoryError):
        return True
    if isinstance(exc, OSError) and exc.errno in _MEMORY_EXHAUSTION_ERRNOS:
        return True
    message = str(exc)
    if message and _MEMORY_EXHAUSTION_MESSAGE_RE.search(message):
        return True
    return False
