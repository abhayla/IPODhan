#!/usr/bin/env python3
"""
Item 9 (OD-90, spec section 2.5.5 as amended): the page reader for a stored CORRIGENDUM.

Prints one JSON object: {"pages": [{"page", "text", "ocr", "confidence"}]} — page numbers are
1-based, as an admin reads them. Same reading order as `extract_filing.py`: the text layer first
(pdfplumber, one blank-password attempt, OD-36), and OCR (`ocr_pages.py`, RapidOCR) only for a
page whose text layer `ocr_pages.needs_ocr` rejects. An OCR page is marked `"ocr": true` with its
confidence, so a suggestion read from it carries the section 2.2.1 OCR mark.

This script only READS. The mapping of sentences to fields, and every database write, happens in
`@ipodhan/shared` `corrigendum-suggestions.ts`, and nothing there writes a field without the admin.

The box lock (W-178c, #151 round 3): pdfplumber plus OCR on a scanned corrigendum runs for up to
15 minutes at full CPU, so it takes the same cross-slot fcntl lock as `extract_filing.py` and
`anchor_report_text.py` (`box_lock.py`, /var/www/ipodhan/shared/extractor.lock) BEFORE any PDF
work, waiting up to EXTRACTOR_LOCK_WAIT_S seconds (default 90). Prod and staging share one 2-vCPU
box; two extractors at once starved nginx/Next into Cloudflare 522s (W-178).

Usage: python read_corrigendum_pages.py <pdf-path> [--no-ocr]
Exit codes: 0 ok, 2 usage, 5 password-protected (terminal, OD-36),
75 busy: another extractor holds the box lock (EXTRACTOR_BUSY_EXIT_CODE in low-priority-spawn.ts).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import box_lock  # noqa: E402 - light, safe to import first (W-178c)

# Same env knob and default as extract_filing.py's _extractor_lock_wait_s.
DEFAULT_EXTRACTOR_LOCK_WAIT_S = 90
EXTRACTOR_BUSY_EXIT_CODE = 75


def _extractor_lock_wait_s():
    raw = os.environ.get("EXTRACTOR_LOCK_WAIT_S")
    if raw is None:
        return DEFAULT_EXTRACTOR_LOCK_WAIT_S
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_EXTRACTOR_LOCK_WAIT_S
    return value if value >= 0 else DEFAULT_EXTRACTOR_LOCK_WAIT_S


def read_pages(pdf_path, ocr=True):
    import pdfplumber
    import ocr_pages

    texts = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, p in enumerate(pdf.pages):
            texts.append(p.extract_text() or "")
            p.close()

    pages = [{"page": i + 1, "text": t, "ocr": False, "confidence": None} for i, t in enumerate(texts)]
    if not ocr:
        return pages
    scanned = [i for i, t in enumerate(texts) if ocr_pages.needs_ocr(t)]
    if scanned and ocr_pages.backend_available(ocr_pages.DEFAULT_BACKEND):
        for idx, text, conf in ocr_pages.ocr_pdf_pages(pdf_path, scanned):
            # Keep whichever reading carries more usable text: a short but real text layer
            # (a signature page) must not be replaced by a noisier OCR of the same words.
            if ocr_pages.usable_alnum_count(text) > ocr_pages.usable_alnum_count(texts[idx]):
                pages[idx] = {"page": idx + 1, "text": text, "ocr": True, "confidence": round(conf, 4)}
    return pages


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    if len(args) != 1:
        print("usage: read_corrigendum_pages.py <pdf-path> [--no-ocr]", file=sys.stderr)
        return 2
    # Before any PDF work: the lock is held until this process exits (the kernel releases it).
    if not box_lock.acquire(box_lock.resolve_lock_path(), _extractor_lock_wait_s()):
        print("extractor busy: box lock held (W-178c)", file=sys.stderr)
        return EXTRACTOR_BUSY_EXIT_CODE
    from pdf_password_errors import is_pdf_password_error
    try:
        pages = read_pages(args[0], ocr="--no-ocr" not in argv)
    except Exception as exc:  # noqa: BLE001
        if is_pdf_password_error(exc):
            print(json.dumps({"error": "PDF_PASSWORD_PROTECTED: %s" % exc}))
            return 5
        raise
    print(json.dumps({"source_doc": os.path.basename(args[0]), "pages": pages}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
