"""OD-36 (item 22 slice 22-5, F-153) — a password-protected PDF gets exactly
one blank-password attempt. On failure this is TERMINAL: `extract()` returns
an envelope naming the cause instead of raising into `main()`'s memory-
ceiling handler (which would crash the whole process and lose the
document's identity), and nothing on the node side retries it on a clock
(see the paired assertion in `scraper/tests/unit/services/filing-auto-persist-password-protected.test.ts`).

Fixtures (`scraper/scripts/fixtures/item22-*-password.pdf`) are a genuine
1-page extract of the REAL encrypted filing this class was found on:
`ANCHOR_ALLOCATION_REPORT-4e5a4f9d.pdf` under
`IPODhan-backups/prospectus-fable/8fcdf521-.../`, which pypdf's blank-decrypt
proves is OWNER-password-only (opens with `""`). The extract was re-encrypted
two ways:
  - `item22-owner-password.pdf`: owner password only, blank user password —
    this is the class F-153 measured on 3 of 45 local filings; the blank
    attempt succeeds.
  - `item22-user-password.pdf`: a genuine non-empty USER password — the
    blank attempt cannot open it. This is the class OD-36 makes terminal.

Run:  cd scraper && python -m pytest scripts/test_extract_filing_password_protected.py -q
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_filing import extract, STATUS_PDF_PASSWORD_PROTECTED  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
OWNER_PW_PDF = os.path.join(FIXTURES, "item22-owner-password.pdf")
USER_PW_PDF = os.path.join(FIXTURES, "item22-user-password.pdf")


def test_owner_password_only_pdf_opens_with_blank_attempt():
    """F-153's class: owner-password-only PDFs (3 of 45 local filings) open
    fine on the one blank-password attempt — this must NOT be misclassified
    as password-protected."""
    out = extract(OWNER_PW_PDF, "PROSPECTUS", ocr=False)
    assert out["extraction_status"] != STATUS_PDF_PASSWORD_PROTECTED
    assert len(out["page_texts"]) >= 1


def test_user_password_pdf_yields_named_terminal_cause_not_a_crash():
    """The class OD-36 covers: a genuine user password. The blank attempt
    fails, and `extract()` must return the terminal envelope — never raise,
    never report an empty success."""
    out = extract(USER_PW_PDF, "PROSPECTUS", ocr=False)
    assert out["extraction_status"] == STATUS_PDF_PASSWORD_PROTECTED
    assert out["page_texts"] == []
    assert out["fields"] == {}
    # The cause is recorded, not silently dropped (defect-fix-contract R2/R5:
    # "known" needs identity, never a bare outcome).
    assert out["extraction_status_cause"]


def test_user_password_pdf_does_not_raise():
    """A crash here means the WHOLE extractor process dies (main()'s
    memory-ceiling handler is the only catch-all left), losing this
    document's identity from the failure. Must return cleanly instead."""
    try:
        extract(USER_PW_PDF, "PROSPECTUS", ocr=False)
    except Exception as exc:  # noqa: BLE001
        raise AssertionError(
            "extract() must not raise on a password-protected PDF; got %r" % exc
        )
