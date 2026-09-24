"""OD-36 round 2 (item 22 slice 22-5, Tier B review) — the anchor allocation
report extractor (`anchor_report_text.py`) opens PDFs itself
(`pdfplumber.open`) and had NO password guard, unlike `extract_filing.py`.
F-153 — the only REAL encrypted filing measured this project — IS an anchor
allocation report, so this is the extractor that class actually hits.

Same fixtures as `test_extract_filing_password_protected.py` (see that file's
module docstring for their provenance: a genuine 1-page extract of the real
F-153 filing, re-encrypted two ways).

Run:  cd scraper && python -m pytest scripts/test_anchor_report_text_password_protected.py -q
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from anchor_report_text import extract, PasswordProtectedError  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
OWNER_PW_PDF = os.path.join(FIXTURES, "item22-owner-password.pdf")
USER_PW_PDF = os.path.join(FIXTURES, "item22-user-password.pdf")


def test_owner_password_only_pdf_extracts_via_blank_attempt():
    """F-153's own class (owner-password-only) must NOT be misclassified as
    password-protected — the blank attempt opens it fine."""
    pages = extract(OWNER_PW_PDF, ocr=False)
    assert len(pages) >= 1


def test_user_password_pdf_raises_named_terminal_error_not_a_crash():
    """A genuine user password: the blank attempt fails, and `extract()` must
    raise the NAMED `PasswordProtectedError` — never a bare pdfminer/pdfplumber
    exception that `main()`'s generic handler would report as an opaque,
    endlessly-retried `sidecar_error`."""
    try:
        extract(USER_PW_PDF, ocr=False)
    except PasswordProtectedError as exc:
        assert str(exc)  # the cause is recorded, never silently dropped
        return
    raise AssertionError("extract() must raise PasswordProtectedError on a user-password PDF")


def test_user_password_pdf_main_emits_named_json_not_generic_error():
    """The mutation this guards against: removing the guard makes `extract()`
    raise a bare pdfminer exception straight into `main()`'s generic
    `except Exception`, which prints an opaque `{"error": "...: "}` (often an
    EMPTY message — pdfplumber's `PdfminerException.__str__()` is empty) with
    no `password_protected` field — indistinguishable, on the TS side, from
    any other parse failure, and filed as an ordinary retryable sidecar_error
    forever. Runs the actual CLI subprocess so the guard is proven at the same
    boundary the node caller reads."""
    import json
    import subprocess

    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "anchor_report_text.py")
    result = subprocess.run(
        [sys.executable, script, USER_PW_PDF, "--no-ocr"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    last_line = result.stdout.strip().splitlines()[-1]
    parsed = json.loads(last_line)
    assert parsed.get("password_protected") is True, parsed
    assert parsed.get("cause"), parsed
    assert "pages" not in parsed
