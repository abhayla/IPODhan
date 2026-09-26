r"""#1046: an OCR inference failure on one page must not fail the whole document.

RCA: RapidOCR's text detector runs at the page image's full size, and under the
extractor's RLIMIT_AS memory ceiling an onnxruntime allocation for a large page
fails. RapidOCR re-raises that as `ONNXRuntimeError('ONNXRuntime inferece
failed.') from e`, the real cause ("... Status Message: bad allocation") sits
only on `__cause__`, so (a) the memory classifier read it as an ordinary crash
(exit 1, not the ceiling's exit 3) and (b) one page took the whole document
down on every retry. Four staging offer documents failed this way
(Kanohar Electricals PROSPECTUS, Elevate Campuses RHP, Swastika Infra DRHP,
Runwal Enterprises PRICE_BAND_AD).

The fixture is a REAL page: page 341 of the Kanohar prospectus
(`scraper/tests/fixtures/ocr/kanohar-prospectus-page341.pdf`, provenance in its
`.meta.json`). It is rendered for real through pypdfium2 (installed in CI as a
pdfplumber dependency); only the ONNX model is replaced, by a reader that fails
exactly the way the real one did when the render is too large. The message
strings are copied from the local reproduction under a 1000 MB memory cap.

Run:  python -m pytest scraper/scripts/test_ocr_inference_failure_1046.py -q
"""

import os
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import extract_filing  # noqa: E402
import memory_guard  # noqa: E402
import ocr_pages  # noqa: E402
from extract_filing import STATUS_INCOMPLETE_PAGES  # noqa: E402

FIXTURE = os.path.join(HERE, "..", "tests", "fixtures", "ocr",
                       "kanohar-prospectus-page341.pdf")

# Copied from the reproduction (rapidocr-onnxruntime 1.2.3, onnxruntime 1.29.0).
ORT_CAUSE = ("[ONNXRuntimeError] : 6 : RUNTIME_EXCEPTION : Non-zero status code "
             "returned while running Resize node. Name:'Resize_2' Status Message: "
             "bad allocation")
ORT_OTHER_CAUSE = ("[ONNXRuntimeError] : 2 : INVALID_ARGUMENT : Got invalid "
                   "dimensions for input: x")


class ONNXRuntimeError(Exception):
    """Same module and name as rapidocr's wrapper, so the classifier sees what
    production sees."""


ONNXRuntimeError.__module__ = "rapidocr_onnxruntime.utils"


class RuntimeException(Exception):
    pass


RuntimeException.__module__ = "onnxruntime.capi.onnxruntime_pybind11_state"


def _rapidocr_failure(cause_message):
    try:
        try:
            raise RuntimeException(cause_message)
        except RuntimeException as e:
            raise ONNXRuntimeError("ONNXRuntime inferece failed.") from e
    except ONNXRuntimeError as wrapped:
        return wrapped


pypdfium2 = pytest.importorskip("pypdfium2")


# --------------------------------------------------------------------------- #
# the classifier
# --------------------------------------------------------------------------- #
def test_memory_classifier_reads_the_wrapped_cause():
    exc = _rapidocr_failure(ORT_CAUSE)
    assert str(exc) == "ONNXRuntime inferece failed."
    assert memory_guard.is_memory_exhaustion(exc) is True


def _raised_inside_handler(handled, raised):
    """`raised` thrown while `handled` is being handled: Python sets
    `raised.__context__ = handled` implicitly (no `from`)."""
    try:
        try:
            raise handled
        except type(handled):
            raise raised
    except type(raised) as exc:
        return exc


def test_a_bug_raised_inside_a_memory_handler_is_not_memory():
    """PR #1195 review: following `__context__` made a KeyError raised inside
    an `except SystemError:` (or EAGAIN OSError) block classify as the memory
    ceiling, sending a healthy document to the hard-failure floor."""
    import errno
    for handled in (SystemError("error return without exception set"),
                    OSError(errno.EAGAIN, "Resource temporarily unavailable"),
                    MemoryError()):
        exc = _raised_inside_handler(handled, KeyError("allocation_sums_and_qib_floor"))
        assert exc.__context__ is handled
        assert memory_guard.is_memory_exhaustion(exc) is False, handled
        assert ocr_pages.ocr_page_failure_reason(exc) is None, handled


def test_memory_classifier_still_rejects_a_non_memory_onnx_failure():
    assert memory_guard.is_memory_exhaustion(_rapidocr_failure(ORT_OTHER_CAUSE)) is False


def test_page_failure_reason_names_both_shapes_and_nothing_else():
    assert ocr_pages.ocr_page_failure_reason(_rapidocr_failure(ORT_CAUSE)) == "ocr_out_of_memory"
    assert (ocr_pages.ocr_page_failure_reason(_rapidocr_failure(ORT_OTHER_CAUSE))
            == "ocr_inference_failed")
    # numpy's _ArrayMemoryError in the detector's preprocessing is a MemoryError.
    numpy_oom = MemoryError("Unable to allocate 136. MiB")
    assert ocr_pages.ocr_page_failure_reason(numpy_oom) == "ocr_out_of_memory"
    assert ocr_pages.ocr_page_failure_reason(ValueError("a real bug")) is None


# --------------------------------------------------------------------------- #
# the per-page fallback, on the real page
# --------------------------------------------------------------------------- #
def _reader_failing_above(max_ok_edge, cause=ORT_CAUSE, calls=None):
    def read(image):
        edge = max(image.size)
        if calls is not None:
            calls.append(edge)
        if edge > max_ok_edge:
            raise _rapidocr_failure(cause)
        return "read at %d px" % edge
    return read


def test_fixture_is_a_scanned_page_rendered_large():
    [(idx, image, _scale)] = list(ocr_pages.render_pages_scaled(FIXTURE, [0]))
    assert image.size == (2860, 2210)


def test_a_page_that_fails_full_size_is_read_at_a_smaller_render():
    calls = []
    [(idx, image, scale)] = list(ocr_pages.render_pages_scaled(FIXTURE, [0]))
    ref = [image]
    del image
    result, used_scale, edge = ocr_pages.read_page_with_fallback(
        FIXTURE, idx, ref, scale, _reader_failing_above(1600, calls=calls))
    assert calls == [2860, 2400, 1600]
    assert result == "read at 1600 px"
    assert edge == 1600
    assert ref == [], "the helper must take the full-size render out of the caller's hands"
    # The scale returned is the one the successful render used, so a caller
    # mapping boxes back to PDF points (ocr_pdf_page_boxes) stays correct.
    assert used_scale == pytest.approx(scale * 1600 / 2860, rel=1e-3)


def test_a_page_unreadable_at_every_size_is_named_with_its_cause():
    [(idx, image, scale)] = list(ocr_pages.render_pages_scaled(FIXTURE, [0]))
    with pytest.raises(ocr_pages.OcrPageUnreadable) as info:
        ocr_pages.read_page_with_fallback(FIXTURE, idx, [image], scale,
                                          _reader_failing_above(100))
    assert info.value.page == 0
    assert info.value.reason == "ocr_out_of_memory"
    assert info.value.sizes == (2860, 2400, 1600)
    # The memory cause survives, so main()'s classifier still sees the ceiling.
    assert memory_guard.is_memory_exhaustion(info.value) is True
    # ...but no traceback frames (which held the page arrays) are kept alive.
    for link in memory_guard._exception_chain(info.value.__cause__):
        assert link.__traceback__ is None


def test_a_non_onnx_error_is_not_retried():
    [(idx, image, scale)] = list(ocr_pages.render_pages_scaled(FIXTURE, [0]))

    def read(image):
        raise ValueError("a real bug, not an inference failure")

    with pytest.raises(ValueError):
        ocr_pages.read_page_with_fallback(FIXTURE, idx, [image], scale, read)


# --------------------------------------------------------------------------- #
# the document extractor
# --------------------------------------------------------------------------- #
def test_extract_keeps_going_and_names_the_page_it_could_not_read(monkeypatch):
    """The behaviour #1046 is about: before, the exception escaped extract()
    and the node caller recorded HARD_FAILURE for the whole document."""
    monkeypatch.setattr(ocr_pages, "backend_available", lambda backend: True)
    monkeypatch.setattr(ocr_pages, "ocr_image",
                        lambda image, backend: (_ for _ in ()).throw(
                            _rapidocr_failure(ORT_CAUSE)))

    out = extract_filing.extract(FIXTURE, "PROSPECTUS")

    assert out["extraction_status"] == STATUS_INCOMPLETE_PAGES
    assert out["unread_pages"] == [
        {"page": 0, "reason": "ocr_out_of_memory"},
    ]
    assert out["ocr_render"] == []  # nothing was read, at any size


def test_extract_reads_the_page_after_a_smaller_render(monkeypatch):
    monkeypatch.setattr(ocr_pages, "backend_available", lambda backend: True)
    text = "Kanohar Electricals Limited restated statement of assets " * 10
    reader = _reader_failing_above(1600)
    monkeypatch.setattr(ocr_pages, "ocr_image",
                        lambda image, backend: (reader(image) and text, 0.91))

    out = extract_filing.extract(FIXTURE, "PROSPECTUS")

    assert "unread_pages" not in out
    assert out["extraction_status"] != STATUS_INCOMPLETE_PAGES
    assert text.strip()[:40] in dict(out["page_texts"])[0]
    # OD-55 accuracy first: the envelope says this page was read downscaled.
    assert out["ocr_render"] == [
        {"page": 0, "long_edge_px": 1600, "full_long_edge_px": 2860, "downscaled": True},
    ]


def test_extract_marks_a_full_size_read_as_not_downscaled(monkeypatch):
    monkeypatch.setattr(ocr_pages, "backend_available", lambda backend: True)
    text = "Kanohar Electricals Limited restated statement of assets " * 10
    monkeypatch.setattr(ocr_pages, "ocr_image", lambda image, backend: (text, 0.91))

    out = extract_filing.extract(FIXTURE, "PROSPECTUS")

    assert out["ocr_render"] == [
        {"page": 0, "long_edge_px": 2860, "full_long_edge_px": 2860, "downscaled": False},
    ]
