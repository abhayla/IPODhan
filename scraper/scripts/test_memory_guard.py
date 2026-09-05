"""W-137 — the shared extractor memory ceiling.

Run:  cd scraper && python -m pytest scripts/test_memory_guard.py -q
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import memory_guard  # noqa: E402


def test_max_rss_mb_default_when_unset(monkeypatch):
    monkeypatch.delenv("EXTRACTOR_MAX_RSS_MB", raising=False)
    assert memory_guard.max_rss_mb() == memory_guard.DEFAULT_MAX_RSS_MB


def test_max_rss_mb_reads_env(monkeypatch):
    monkeypatch.setenv("EXTRACTOR_MAX_RSS_MB", "777")
    assert memory_guard.max_rss_mb() == 777


def test_max_rss_mb_falls_back_on_garbage_env(monkeypatch):
    monkeypatch.setenv("EXTRACTOR_MAX_RSS_MB", "not-a-number")
    assert memory_guard.max_rss_mb() == memory_guard.DEFAULT_MAX_RSS_MB


def test_install_memory_ceiling_noop_without_resource_module(monkeypatch):
    """Windows (and any platform without `resource`) must not raise — the
    guard is defense-in-depth for the Linux VPS, not a portability contract."""
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "resource":
            raise ImportError("no resource module on this platform")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert memory_guard.install_memory_ceiling() is None


def test_memory_ceiling_error_json_shape():
    payload = json.loads(memory_guard.memory_ceiling_error_json(2500))
    assert payload == {"error": "memory ceiling exceeded (2500 MB)"}


def test_is_memory_exhaustion_recognizes_memory_error():
    assert memory_guard.is_memory_exhaustion(MemoryError()) is True


def test_is_memory_exhaustion_recognizes_oserror_enomem():
    exc = OSError("Cannot allocate memory")
    exc.errno = 12  # ENOMEM
    assert memory_guard.is_memory_exhaustion(exc) is True


def test_is_memory_exhaustion_recognizes_oserror_eagain():
    exc = OSError("Resource temporarily unavailable")
    exc.errno = 11  # EAGAIN
    assert memory_guard.is_memory_exhaustion(exc) is True


def test_is_memory_exhaustion_ignores_unrelated_oserror():
    exc = OSError("No such file or directory")
    exc.errno = 2  # ENOENT
    assert memory_guard.is_memory_exhaustion(exc) is False


def test_is_memory_exhaustion_recognizes_onnxruntime_style_message():
    # onnxruntime raises a plain RuntimeError/RuntimeException with no errno
    # at all — the message is the only signal.
    assert memory_guard.is_memory_exhaustion(RuntimeError("Failed to allocate memory for requested buffer")) is True
    assert memory_guard.is_memory_exhaustion(RuntimeError("bad allocation")) is True


def test_is_memory_exhaustion_recognizes_thread_start_failure():
    assert memory_guard.is_memory_exhaustion(RuntimeError("can't start new thread")) is True


def test_is_memory_exhaustion_false_for_ordinary_exceptions():
    assert memory_guard.is_memory_exhaustion(ValueError("unknown doc type XYZ")) is False
    assert memory_guard.is_memory_exhaustion(KeyError("missing_field")) is False
    assert memory_guard.is_memory_exhaustion(RuntimeError("unexpected token in JSON")) is False


def test_is_memory_exhaustion_recognizes_systemerror_shape(monkeypatch):
    """Round 3 — seen live on the VPS at EXTRACTOR_MAX_RSS_MB=60: CPython's
    own 'a C allocation failed without raising MemoryError' symptom."""
    monkeypatch.setattr(memory_guard, "is_near_memory_ceiling", lambda *a, **k: False)
    assert memory_guard.is_memory_exhaustion(SystemError("error return without exception set")) is True
    # Any SystemError counts, even with an unrelated/empty message — round 3
    # asks for the type itself to be trusted, not just this one message.
    assert memory_guard.is_memory_exhaustion(SystemError()) is True


def test_is_memory_exhaustion_near_ceiling_catches_unrecognized_exception_types(monkeypatch):
    """Round 3 last resort: an exception type/message we did not anticipate,
    but the process is already at/above the near-ceiling threshold of the
    configured cap, AND (round 5 MAJOR-A) the guard is actually active."""
    monkeypatch.setattr(memory_guard, "_installed_ceiling_mb", 100)
    monkeypatch.setattr(memory_guard, "_current_vm_size_mb", lambda: 98.0)  # 98% of 100
    assert memory_guard.is_memory_exhaustion(IndexError("list index out of range")) is True


def test_is_memory_exhaustion_below_near_ceiling_threshold_is_not_exhaustion(monkeypatch):
    monkeypatch.setattr(memory_guard, "_installed_ceiling_mb", 100)
    monkeypatch.setattr(memory_guard, "_current_vm_size_mb", lambda: 50.0)  # 50% of 100
    assert memory_guard.is_memory_exhaustion(IndexError("list index out of range")) is False


def test_is_near_memory_ceiling_false_when_vm_size_unmeasurable(monkeypatch):
    monkeypatch.setattr(memory_guard, "_installed_ceiling_mb", 100)
    monkeypatch.setattr(memory_guard, "_current_vm_size_mb", lambda: None)
    assert memory_guard.is_near_memory_ceiling(limit_mb=100) is False


def test_is_near_memory_ceiling_respects_custom_threshold(monkeypatch):
    monkeypatch.setattr(memory_guard, "_installed_ceiling_mb", 100)
    monkeypatch.setattr(memory_guard, "_current_vm_size_mb", lambda: 70.0)
    assert memory_guard.is_near_memory_ceiling(limit_mb=100, threshold=0.85) is False
    assert memory_guard.is_near_memory_ceiling(limit_mb=100, threshold=0.6) is True


def test_is_near_memory_ceiling_false_when_guard_never_installed(monkeypatch):
    """MAJOR-A: even a process reading 99% of the default cap via VmSize must
    NOT be treated as near-ceiling when the RLIMIT_AS guard was never
    installed (e.g. Windows, or install_memory_ceiling() failed/never ran) —
    VmSize's own ~1.5 GB of harmless headroom would otherwise misfire here."""
    monkeypatch.setattr(memory_guard, "_installed_ceiling_mb", None)
    monkeypatch.setattr(memory_guard, "_current_vm_size_mb", lambda: 99.0)
    assert memory_guard.is_near_memory_ceiling(limit_mb=100) is False


def test_is_memory_exhaustion_ordinary_exception_at_90pct_vmsize_is_not_exhaustion(monkeypatch):
    """MAJOR-A false-positive repro: a normal OCR run's RSS 1.26 GB reads as
    VmSize ~90% of the 3072 MB default cap purely from mapped-but-untouched
    library address space. An ORDINARY exception (e.g. a KeyError in field
    emission) at that level must NOT be classified as memory exhaustion now
    that the near-ceiling threshold is 0.97, not 0.85."""
    monkeypatch.setattr(memory_guard, "_installed_ceiling_mb", 3072)
    monkeypatch.setattr(memory_guard, "_current_vm_size_mb", lambda: 3072 * 0.90)
    assert memory_guard.is_memory_exhaustion(KeyError("some_field")) is False


def test_is_memory_exhaustion_ordinary_exception_at_98pct_vmsize_is_exhaustion(monkeypatch):
    """At 98% of the cap (above the 0.97 threshold) with the guard active, an
    unrecognized exception is presumptively the ceiling."""
    monkeypatch.setattr(memory_guard, "_installed_ceiling_mb", 3072)
    monkeypatch.setattr(memory_guard, "_current_vm_size_mb", lambda: 3072 * 0.98)
    assert memory_guard.is_memory_exhaustion(KeyError("some_field")) is True


def test_is_memory_exhaustion_guard_not_installed_never_near_ceiling_even_at_99pct(monkeypatch):
    monkeypatch.setattr(memory_guard, "_installed_ceiling_mb", None)
    monkeypatch.setattr(memory_guard, "_current_vm_size_mb", lambda: 3072 * 0.99)
    assert memory_guard.is_memory_exhaustion(KeyError("some_field")) is False


def test_is_memory_exhaustion_ignores_allocation_business_text_false_positives(monkeypatch):
    """MAJOR-B repro: the bare `allocat` substring previously matched ordinary
    business text from extract_filing.py's check_allocation over anchor
    documents containing "Total Amount allocated" — a HEALTHY document was
    misclassified as memory exhaustion. Disable the near-ceiling last resort
    so only the message regex is under test."""
    monkeypatch.setattr(memory_guard, "_installed_ceiling_mb", None)
    assert memory_guard.is_memory_exhaustion(
        ValueError("could not convert string to float: 'Total Amount allocated'")
    ) is False
    assert memory_guard.is_memory_exhaustion(
        KeyError("allocation_sums_and_qib_floor")
    ) is False


def test_is_memory_exhaustion_recognizes_real_allocation_failure_messages(monkeypatch):
    """MAJOR-B: the narrowed regex must still catch the real memory-allocation
    failure shapes seen live (OpenBLAS's own phrasing, ENOMEM, MemoryError)."""
    monkeypatch.setattr(memory_guard, "_installed_ceiling_mb", None)
    assert memory_guard.is_memory_exhaustion(
        RuntimeError("OpenBLAS error: Memory allocation still failed after 10 retries, giving up.")
    ) is True
    exc = OSError(12, "Cannot allocate memory")
    exc.errno = 12
    assert memory_guard.is_memory_exhaustion(exc) is True
    assert memory_guard.is_memory_exhaustion(MemoryError()) is True


def _fake_resource_module():
    """A minimal stand-in for the `resource` module (POSIX-only) so the
    opt-out/default install tests below can run on Windows too — they assert
    on *whether `setrlimit` was called*, not on the real platform effect."""
    import types

    calls = []

    fake = types.SimpleNamespace(
        RLIMIT_AS="RLIMIT_AS",
        setrlimit=lambda *args: calls.append(args),
    )
    return fake, calls


def test_install_memory_ceiling_skips_when_env_off(monkeypatch):
    """W-159 round 2: EXTRACTOR_MEMORY_CEILING=off must skip installing the
    RLIMIT_AS ceiling entirely — this is the opt-out the pr-gate CI job uses
    so collecting/importing extract_filing.py under pytest does not pin the
    pytest process itself to max_rss_mb()."""
    import builtins

    monkeypatch.setenv("EXTRACTOR_MEMORY_CEILING", "off")
    monkeypatch.setattr(memory_guard, "_installed_ceiling_mb", "sentinel")

    fake_resource, calls = _fake_resource_module()
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "resource":
            return fake_resource
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    assert memory_guard.ceiling_disabled_by_env() is True
    result = memory_guard.install_memory_ceiling()
    assert result is None
    assert memory_guard._installed_ceiling_mb is None
    assert calls == []  # setrlimit must never be reached when opted out


def test_install_memory_ceiling_installs_by_default(monkeypatch):
    """The default (env unset) must still install the ceiling — the opt-out
    must never silently change production behaviour."""
    import builtins

    monkeypatch.delenv("EXTRACTOR_MEMORY_CEILING", raising=False)
    monkeypatch.setenv("EXTRACTOR_MAX_RSS_MB", "512")

    fake_resource, calls = _fake_resource_module()
    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "resource":
            return fake_resource
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)

    assert memory_guard.ceiling_disabled_by_env() is False
    result = memory_guard.install_memory_ceiling()
    assert result == 512
    assert memory_guard._installed_ceiling_mb == 512
    assert calls == [("RLIMIT_AS", (512 * 1024 * 1024, 512 * 1024 * 1024))]


def test_extract_filing_exits_3_on_memory_ceiling():
    """Linux-only: cap the ceiling at 60 MB — the value the VPS proof used
    (ledger: "cap 60 -> clean exit 3 + JSON") — so importing pdfplumber's
    dependency stack itself trips RLIMIT_AS, and assert the script reports
    the ceiling honestly.

    Two honest outcomes exist here (round 4's own docstring in
    memory_guard.py: a C-level abort, e.g. OpenBLAS, can kill the process
    before ANY Python exception handler runs): (a) the preferred path —
    clean exit 3 with the memory-ceiling JSON on stdout, or (b) a signal
    death with empty stdout. Both are honest signals that the ceiling
    tripped; a silent pass-through (any other exit code, or a return code 3
    without the JSON) is never acceptable and fails with a message naming
    which shape was seen.

    The child MUST have `EXTRACTOR_MEMORY_CEILING` unset (not "off") so it
    actually installs its own RLIMIT_AS ceiling, regardless of what the
    parent pytest process's own environment carries (the CI job sets that
    var to "off" for the pytest step itself, per W-159 round 2 — that
    opt-out must not leak into this subprocess under test).
    """
    if os.name != "posix":
        import pytest
        pytest.skip("RLIMIT_AS is POSIX-only; the guard is a documented no-op on Windows")

    here = os.path.dirname(os.path.abspath(__file__))
    script = os.path.join(here, "extract_filing.py")
    env = dict(os.environ)
    env.pop("EXTRACTOR_MEMORY_CEILING", None)
    env["EXTRACTOR_MAX_RSS_MB"] = "60"
    result = subprocess.run(
        [sys.executable, script, "nonexistent.pdf", "--doc-type", "RHP"],
        capture_output=True, text=True, env=env, timeout=60,
    )

    if result.returncode == memory_guard.EXIT_MEMORY_CEILING:
        payload = json.loads(result.stdout)
        assert "memory ceiling exceeded" in payload["error"]
    elif result.returncode < 0 and not result.stdout.strip():
        # Signal death (negative returncode = -signum on POSIX) with no
        # stdout — the C-level-abort shape round 4 documents as undetectable
        # from inside this process. Honest, not a failure of the guard.
        pass
    else:
        raise AssertionError(
            "neither honest shape occurred: expected exit "
            f"{memory_guard.EXIT_MEMORY_CEILING} + JSON stdout, or a signal "
            f"death with empty stdout; got returncode={result.returncode!r} "
            f"stdout={result.stdout!r} stderr_tail={result.stderr[-500:]!r}"
        )
