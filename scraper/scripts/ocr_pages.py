#!/usr/bin/env python3
"""
D6 / W-57 — OCR route for scanned filings (no text layer, or a broken one).

`extract_filing.py` classifies a page with no usable text layer as
`NEEDS_OCR` and stops. This module is the missing route: it renders those
pages to images with pypdfium2 and recovers their text with a pluggable OCR
backend, so extraction can continue on OCR text instead of giving up.

Two backends:
  * `rapidocr`  (default) — `rapidocr-onnxruntime`, pure pip, no system binary.
  * `tesseract` (optional) — `pytesseract`, only when the binary is on PATH.

Every page comes back with a confidence (the mean of the per-box scores).
The caller gates on it: below the floor a field is emitted null with reason
`ocr_low_confidence`, never a guess.

Standalone use:
  python ocr_pages.py <pdf-path> [--dpi 260] [--backend rapidocr] [--pages 0,1]
"""
import json
import os
import re
import shutil
import sys

DEFAULT_DPI = 260
DEFAULT_BACKEND = "rapidocr"
CONFIDENCE_FLOOR = 0.6

# A page with fewer usable alphanumeric characters than this has no text layer
# worth extracting from — a scanned page yields ~0, a page with a broken font
# encoding yields a few dozen bytes of mojibake.
MIN_USABLE_ALNUM = 200
# ...as does a page whose "text" is mostly control/private-use codepoints.
MAX_NONPRINTABLE_RATIO = 0.30

_PRINTABLE = re.compile(r"[\x20-\x7e\s]")
_ALNUM = re.compile(r"[0-9A-Za-z]")


def usable_alnum_count(text):
    """Alphanumeric characters that survive the printable-ASCII filter."""
    return sum(1 for ch in (text or "") if _ALNUM.match(ch))


def nonprintable_ratio(text):
    text = text or ""
    if not text:
        return 1.0
    bad = sum(1 for ch in text if not _PRINTABLE.match(ch))
    return bad / float(len(text))


def needs_ocr(text):
    """True when this page's text layer cannot be trusted for extraction.

    Two independent signals, either is enough:
      * too little usable alphanumeric text (blank scan, or an image-only page)
      * too high a share of non-printable characters (broken font encoding —
        the shape BSE's scanned price-band ads take: ~71 mojibake chars a page)
    """
    text = text or ""
    if usable_alnum_count(text) < MIN_USABLE_ALNUM:
        return True
    return nonprintable_ratio(text) > MAX_NONPRINTABLE_RATIO


# --------------------------------------------------------------------------- #
# backends
# --------------------------------------------------------------------------- #
def tesseract_available():
    if shutil.which("tesseract") is None:
        return False
    try:
        import pytesseract  # noqa: F401
    except Exception:
        return False
    return True


def backend_available(backend=DEFAULT_BACKEND):
    if backend == "tesseract":
        return tesseract_available()
    try:
        from rapidocr_onnxruntime import RapidOCR  # noqa: F401
    except Exception:
        return False
    return True


_ENGINE = {}


def _rapidocr_engine():
    if "rapidocr" not in _ENGINE:
        from rapidocr_onnxruntime import RapidOCR
        _ENGINE["rapidocr"] = RapidOCR()
    return _ENGINE["rapidocr"]


def _reading_order(boxes):
    """Group OCR boxes into lines top-to-bottom, then left-to-right inside a line.

    RapidOCR returns boxes in detection order, which is not reading order; a
    price band table read column-first produces text no line regex can match.
    """
    items = []
    for box, text, score in boxes:
        ys = [float(p[1]) for p in box]
        xs = [float(p[0]) for p in box]
        items.append({
            "top": min(ys), "height": max(ys) - min(ys),
            "left": min(xs), "text": text, "score": float(score),
        })
    items.sort(key=lambda it: (it["top"], it["left"]))

    lines = []
    for it in items:
        placed = False
        for line in lines:
            tol = max(line["height"], it["height"]) * 0.6
            if abs(it["top"] - line["top"]) <= tol:
                line["items"].append(it)
                line["top"] = min(line["top"], it["top"])
                placed = True
                break
        if not placed:
            lines.append({"top": it["top"], "height": it["height"], "items": [it]})

    lines.sort(key=lambda ln: ln["top"])
    out = []
    for line in lines:
        line["items"].sort(key=lambda it: it["left"])
        out.append(" ".join(it["text"] for it in line["items"]))
    return "\n".join(out)


def ocr_image(image, backend=DEFAULT_BACKEND):
    """OCR one page image. Returns (text, confidence).

    `image` is a numpy array, a PIL image, or a path to an image file.
    Confidence is the mean of the per-box scores (0.0 when nothing was read).
    """
    if backend == "tesseract":
        return _ocr_image_tesseract(image)
    return _ocr_image_rapidocr(image)


def _ocr_image_rapidocr(image):
    engine = _rapidocr_engine()
    if hasattr(image, "convert"):  # PIL -> ndarray, RapidOCR wants BGR/RGB array
        import numpy as np
        image = np.array(image.convert("RGB"))
    result, _elapse = engine(image)
    if not result:
        return "", 0.0
    text = _reading_order(result)
    scores = [float(r[2]) for r in result]
    return text, sum(scores) / len(scores)


def _ocr_image_tesseract(image):
    import pytesseract
    from PIL import Image
    if isinstance(image, str):
        image = Image.open(image)
    elif not hasattr(image, "convert"):
        image = Image.fromarray(image)
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
    words, confs, lines, current, last_key = [], [], [], [], None
    for i, word in enumerate(data["text"]):
        if not (word or "").strip():
            continue
        conf = float(data["conf"][i])
        if conf < 0:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        if last_key is not None and key != last_key:
            lines.append(" ".join(current))
            current = []
        current.append(word)
        last_key = key
        words.append(word)
        confs.append(conf / 100.0)
    if current:
        lines.append(" ".join(current))
    if not confs:
        return "", 0.0
    return "\n".join(lines), sum(confs) / len(confs)


# --------------------------------------------------------------------------- #
# rendering + page OCR
# --------------------------------------------------------------------------- #
def render_pages(pdf_path, pages=None, dpi=DEFAULT_DPI):
    """Yield (page_index, PIL image) for the requested pages (all when None)."""
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(pdf_path)
    try:
        wanted = range(len(doc)) if pages is None else pages
        for idx in wanted:
            page = doc[idx]
            bitmap = page.render(scale=dpi / 72.0)
            yield idx, bitmap.to_pil()
    finally:
        doc.close()


def ocr_pdf_pages(pdf_path, pages=None, dpi=DEFAULT_DPI, backend=DEFAULT_BACKEND):
    """OCR the given pages of a PDF. Returns [(page_index, text, confidence)]."""
    out = []
    for idx, image in render_pages(pdf_path, pages, dpi):
        text, conf = ocr_image(image, backend)
        out.append((idx, text, conf))
    return out


# --------------------------------------------------------------------------- #
# field annotation (the confidence gate the extractor applies after OCR)
# --------------------------------------------------------------------------- #
def annotate_fields(fields, page_confidence, floor=CONFIDENCE_FLOOR):
    """Mark every field read off an OCR'd page, and null the untrustworthy ones.

    `page_confidence` maps page index -> confidence. A field whose page was
    OCR'd gets `source_text: "OCR"` and its page confidence; below the floor the
    value is dropped with reason `ocr_low_confidence` — never a guess.
    """
    for name, field in (fields or {}).items():
        page = field.get("page")
        if page is None or page not in page_confidence:
            field.setdefault("source_text", "TEXT")
            continue
        conf = page_confidence[page]
        field["source_text"] = "OCR"
        field["ocr_confidence"] = round(conf, 4)
        if conf < floor:
            field["value"] = None
            field["check"] = {"name": "ocr_confidence_floor", "passed": False,
                              "detail": "ocr_low_confidence: %.4f < %.2f" % (conf, floor)}
    return fields


def main():
    argv = sys.argv[1:]
    if not argv:
        print("usage: ocr_pages.py <pdf-path> [--dpi N] [--backend rapidocr|tesseract] "
              "[--pages 0,1]")
        return 2
    dpi = int(argv[argv.index("--dpi") + 1]) if "--dpi" in argv else DEFAULT_DPI
    backend = argv[argv.index("--backend") + 1] if "--backend" in argv else DEFAULT_BACKEND
    pages = None
    if "--pages" in argv:
        pages = [int(p) for p in argv[argv.index("--pages") + 1].split(",")]
    path = [a for a in argv if not a.startswith("--")][0]
    if not backend_available(backend):
        print(json.dumps({"error": "ocr backend %s not available" % backend}))
        return 3
    result = ocr_pdf_pages(path, pages, dpi, backend)
    print(json.dumps({
        "source_doc": os.path.basename(path), "backend": backend, "dpi": dpi,
        "pages": [{"page": i, "confidence": round(c, 4), "text": t}
                  for i, t, c in result],
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
