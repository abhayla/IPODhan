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
"""
import json
import os

DEFAULT_MAX_RSS_MB = 2500

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
