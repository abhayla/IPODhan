"""Detect "this PDF needs a password we don't have" — shared by every sidecar
that opens a PDF with pdfplumber and takes exactly one blank-password attempt
(OD-36, F-153, item 22 slice 22-5). Both `extract_filing.py` (prospectus/RHP
documents) and `anchor_report_text.py` (anchor allocation reports — the only
REAL encrypted filing found, F-153, is one of these) open PDFs this way; this
module exists so the detection logic lives in exactly one place instead of
being retyped per sidecar and drifting.

Named for what it does, not `utils`/`helpers` (`.claude/rules/claude-behavior.md`
rule 8).
"""


def is_pdf_password_error(exc):
    """True only for "this PDF needs a password we don't have" — never a
    generic pdfminer parse failure, which must keep failing loudly.

    Measured (item 22 slice 22-5): pdfplumber.open() on an encrypted PDF wraps
    the real cause in `pdfplumber.utils.exceptions.PdfminerException`, whose
    `str()` is empty — the informative object is `exc.args[0]`, an instance of
    `pdfminer.pdfdocument.PDFPasswordIncorrect`. `ocr_pages.py`'s pypdfium2
    route raises its own `PdfiumError` with a readable message instead, so
    that one is matched on text.
    """
    try:
        from pdfminer.pdfdocument import PDFPasswordIncorrect
    except ImportError:
        PDFPasswordIncorrect = ()  # pragma: no cover - pdfminer always ships with pdfplumber
    try:
        from pdfplumber.utils.exceptions import PdfminerException
    except ImportError:
        PdfminerException = ()  # pragma: no cover
    if PdfminerException and isinstance(exc, PdfminerException):
        inner = exc.args[0] if exc.args else None
        if PDFPasswordIncorrect and isinstance(inner, PDFPasswordIncorrect):
            return True
    try:
        from pypdfium2 import PdfiumError
    except ImportError:
        PdfiumError = ()  # pragma: no cover
    if PdfiumError and isinstance(exc, PdfiumError) and "password" in str(exc).lower():
        return True
    return False
