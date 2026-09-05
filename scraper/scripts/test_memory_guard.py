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
    but the process is already at/above 85% of the configured cap."""
    monkeypatch.setenv("EXTRACTOR_MAX_RSS_MB", "100")
    monkeypatch.setattr(memory_guard, "_current_vm_peak_mb", lambda: 90.0)  # 90% of 100
    assert memory_guard.is_memory_exhaustion(IndexError("list index out of range")) is True


def test_is_memory_exhaustion_below_near_ceiling_threshold_is_not_exhaustion(monkeypatch):
    monkeypatch.setenv("EXTRACTOR_MAX_RSS_MB", "100")
    monkeypatch.setattr(memory_guard, "_current_vm_peak_mb", lambda: 50.0)  # 50% of 100
    assert memory_guard.is_memory_exhaustion(IndexError("list index out of range")) is False


def test_is_near_memory_ceiling_false_when_vm_peak_unmeasurable(monkeypatch):
    monkeypatch.setattr(memory_guard, "_current_vm_peak_mb", lambda: None)
    assert memory_guard.is_near_memory_ceiling(limit_mb=100) is False


def test_is_near_memory_ceiling_respects_custom_threshold(monkeypatch):
    monkeypatch.setattr(memory_guard, "_current_vm_peak_mb", lambda: 70.0)
    assert memory_guard.is_near_memory_ceiling(limit_mb=100, threshold=0.85) is False
    assert memory_guard.is_near_memory_ceiling(limit_mb=100, threshold=0.6) is True


def test_extract_filing_exits_3_on_memory_ceiling():
    """Linux-only: set an impossibly low ceiling so importing pdfplumber's
    dependency stack itself trips RLIMIT_AS, and assert the script reports a
    clean exit 3 + the memory-ceiling JSON instead of being killed."""
    if os.name != "posix":
        import pytest
        pytest.skip("RLIMIT_AS is POSIX-only; the guard is a documented no-op on Windows")

    here = os.path.dirname(os.path.abspath(__file__))
    script = os.path.join(here, "extract_filing.py")
    env = dict(os.environ)
    env["EXTRACTOR_MAX_RSS_MB"] = "1"
    result = subprocess.run(
        [sys.executable, script, "nonexistent.pdf", "--doc-type", "RHP"],
        capture_output=True, text=True, env=env, timeout=60,
    )
    assert result.returncode == memory_guard.EXIT_MEMORY_CEILING
    payload = json.loads(result.stdout)
    assert "memory ceiling exceeded" in payload["error"]
