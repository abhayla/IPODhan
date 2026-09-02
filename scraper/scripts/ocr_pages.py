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
# Cap on the rendered image's longest side (see render_pages).
MAX_EDGE_PX = 3600

# A page with fewer usable alphanumeric characters than this has no text layer
# worth extracting from — a scanned page yields ~0, a page with a broken font
# encoding yields a few dozen bytes of mojibake.
MIN_USABLE_ALNUM = 200
# ...as does a page whose "text" is mostly control/private-use codepoints.
MAX_NONPRINTABLE_RATIO = 0.30

# Word-splitting (see split_words): a blank-column run wider than the Otsu
# split of all the runs on a line is an inter-word gap, clamped to this
# fraction of the line height so a degenerate line cannot shatter into
# characters.
WORD_GAP_MIN_RATIO = 0.12
WORD_GAP_MAX_RATIO = 0.45
WORD_GAP_DEFAULT_RATIO = 0.22
MIN_GAPS_FOR_OTSU = 4
MIN_WORD_WIDTH_PX = 4
WORD_PAD_PX = 2
REC_BATCH_NUM = 16

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
    """RapidOCR, with the wide-image detection shortcut disabled.

    RapidOCR skips detection entirely for any image wider than
    `width_height_ratio` (8) times its height and recognises it as ONE text
    line — on a wide crop of a filing (a price band block, a date table row)
    that returns nothing at all. `-1` means "always detect", which is the only
    correct behaviour for document pages and crops.
    """
    if "rapidocr" not in _ENGINE:
        from rapidocr_onnxruntime import RapidOCR
        engine = RapidOCR()
        engine.width_height_ratio = -1
        # Word crops are narrow, so a larger batch costs little memory and cuts
        # the number of ONNX calls on a page holding a few hundred words.
        engine.text_recognizer.rec_batch_num = max(
            REC_BATCH_NUM, engine.text_recognizer.rec_batch_num)
        _ENGINE["rapidocr"] = engine
    return _ENGINE["rapidocr"]


def _otsu_threshold(values):
    """1-D Otsu split of a list of numbers. None when it cannot be split."""
    import numpy as np
    vals = np.asarray(values, dtype=float)
    best_variance, best_t = None, None
    for t in np.unique(vals):
        low, high = vals[vals <= t], vals[vals > t]
        if low.size == 0 or high.size == 0:
            continue
        variance = low.size * high.size * (low.mean() - high.mean()) ** 2
        if best_variance is None or variance > best_variance:
            best_variance, best_t = variance, t
    return best_t


def split_words(crop):
    """Split one detected text-line crop into word-level crops.

    The recogniser (a PP-OCR model trained overwhelmingly on Chinese) does not
    decode the space character on dense all-caps English: a whole line of a
    price band ad comes back as `PRICEBAND:R168TOR177PEREQUITYSHAREOF...`,
    which no field regex can match. The space is in the pixels; it is simply
    never emitted. So recover the word boundaries geometrically, from the
    image, and recognise each word on its own.

    Method: binarise the crop, take the per-column ink profile, and measure the
    runs of blank columns. On printed text those runs are bimodal — narrow
    inter-character gaps, wide inter-word gaps — so a 1-D Otsu split of the run
    widths separates them with no hand-tuned constant. The split is clamped to
    a sane fraction of the line height so a degenerate line (a single word, or
    solid ink) cannot shatter into characters.

    Returns the sub-images left to right; `[crop]` when it cannot split.
    """
    import cv2
    import numpy as np

    if crop is None or getattr(crop, "size", 0) == 0:
        return [crop]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop
    _t, bright = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    # Which side is the ink is decided by the CORNERS, not by how much ink
    # there is: a dense all-caps line can be more than half ink, so an
    # ink-share test inverts exactly the lines this route exists for. The
    # corners of a detected line crop are background in either polarity.
    k = max(1, min(3, min(crop.shape[0], crop.shape[1]) // 4))
    corners = np.concatenate([
        gray[:k, :k].ravel(), gray[:k, -k:].ravel(),
        gray[-k:, :k].ravel(), gray[-k:, -k:].ravel()])
    ink = (bright > 0) if np.median(corners) < 128 else (bright == 0)

    profile = ink.sum(axis=0)
    ink_cols = np.nonzero(profile > 0)[0]
    if ink_cols.size == 0:
        return [crop]
    left, right = int(ink_cols[0]), int(ink_cols[-1]) + 1

    runs, start = [], None
    for i, blank in enumerate(profile == 0):
        if blank and start is None:
            start = i
        elif not blank and start is not None:
            runs.append((start, i - start))
            start = None
    if start is not None:
        runs.append((start, len(profile) - start))
    interior = [(s, w) for s, w in runs if s > left and s + w < right]
    if not interior:
        return [crop]

    height = float(crop.shape[0])
    widths = [w for _s, w in interior]
    threshold = _otsu_threshold(widths) if len(widths) >= MIN_GAPS_FOR_OTSU else None
    if threshold is None:
        threshold = WORD_GAP_DEFAULT_RATIO * height
    threshold = max(WORD_GAP_MIN_RATIO * height,
                    min(WORD_GAP_MAX_RATIO * height, float(threshold)))

    cuts = [s + w // 2 for s, w in interior if w > threshold]
    bounds = [left] + [c for c in cuts if left < c < right] + [right]
    words = []
    for a, b in zip(bounds[:-1], bounds[1:]):
        sub = crop[:, max(0, a - WORD_PAD_PX):min(crop.shape[1], b + WORD_PAD_PX)]
        if sub.shape[1] >= MIN_WORD_WIDTH_PX:
            words.append(sub)
    return words if len(words) > 1 else [crop]


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
    """Detect lines, split each into words, recognise the words.

    This deliberately replaces `RapidOCR.__call__`: its one-crop-per-line
    recognition is where the spaces are lost (see `split_words`). Detection,
    cropping, angle classification, scoring and box filtering are still
    RapidOCR's — only the unit of recognition changes from a line to a word.
    """
    engine = _rapidocr_engine()
    if hasattr(image, "convert"):  # PIL -> ndarray, RapidOCR wants BGR/RGB array
        import numpy as np
        image = np.array(image.convert("RGB"))
    img = engine.load_img(image)

    boxes, _elapse = engine.text_detector(img)
    if boxes is None or len(boxes) < 1:
        return "", 0.0
    boxes = engine.sorted_boxes(boxes)
    crops = engine.get_crop_img_list(img, boxes)
    if engine.use_angle_cls:
        crops, _cls, _cls_elapse = engine.text_cls(crops)

    word_crops, spans = [], []
    for crop in crops:
        words = split_words(crop)
        spans.append((len(word_crops), len(words)))
        word_crops.extend(words)
    if not word_crops:
        return "", 0.0

    rec_res, _rec_elapse = engine.text_recognizer(word_crops)

    result = []
    for box, (start, count) in zip(boxes, spans):
        parts = [rec_res[start + i] for i in range(count)]
        words = [(p[0] or "").strip() for p in parts]
        scores = [float(p[1]) for p, w in zip(parts, words) if w]
        text = " ".join(w for w in words if w)
        if not text or not scores:
            continue
        score = sum(scores) / len(scores)
        if score < engine.text_score:
            continue
        result.append((box.tolist(), text, score))
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
def render_pages(pdf_path, pages=None, dpi=DEFAULT_DPI, max_edge=MAX_EDGE_PX):
    """Yield (page_index, PIL image) for the requested pages (all when None).

    `max_edge` caps the rendered pixel size. A newspaper-format price band ad is
    a physically huge page: at 260 dpi it renders ~5400x8600, which the detector
    spends minutes on for no accuracy gain. The cap keeps a full page inside a
    few seconds of OCR while leaving normal A4 filings at the requested dpi.
    """
    import pypdfium2 as pdfium
    doc = pdfium.PdfDocument(pdf_path)
    try:
        wanted = range(len(doc)) if pages is None else pages
        for idx in wanted:
            page = doc[idx]
            scale = dpi / 72.0
            if max_edge:
                longest = max(page.get_width(), page.get_height()) * scale
                if longest > max_edge:
                    scale *= max_edge / longest
            yield idx, page.render(scale=scale).to_pil()
    finally:
        doc.close()


def ocr_pdf_pages(pdf_path, pages=None, dpi=DEFAULT_DPI, backend=DEFAULT_BACKEND):
    """OCR the given pages of a PDF. Returns [(page_index, text, confidence)]."""
    out = []
    for idx, image in render_pages(pdf_path, pages, dpi, MAX_EDGE_PX):
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
