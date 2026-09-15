r"""OD-55 part 3, the loop half — `extract()` now drives OCR one page at a
time instead of calling `ocr_pages.ocr_pdf_pages()`, so that an interrupted
read (the hung-process ceiling, or the spawn timeout) KEEPS the pages it
already recovered and NAMES the pages it never reached.

Why this file exists at all: the rewritten loop is the code that will run on
the real 555-page ESDS RHP (~60 pages needing OCR at ~46 s/page, 3028 s
measured), and before this file NOTHING in the suite exercised the OCR render
path — `ocr_pdf_pages`, `render_pages_scaled` and `ocr_image` had no test
caller. Swapping a library call for a hand-rolled loop with no coverage is how
a "fix" silently changes behaviour, so the first test here is an EQUIVALENCE
test: on a completed run the new loop must produce exactly what the old call
produced.

The primitives are faked (no PDF rendering, no ONNX model) because what is
under test is the LOOP's bookkeeping — which pages are kept, which are named,
and what the status becomes. `test_extract_filing_incomplete_pages.py` covers
the envelope shaping; this covers how the loop feeds it.

Run:  cd scraper && python -m pytest scripts/test_extract_filing_ocr_loop_interrupt.py -q
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import extract_filing  # noqa: E402
import ocr_pages  # noqa: E402
from extract_filing import STATUS_INCOMPLETE_PAGES  # noqa: E402


SCANNED_TEXT = ""  # no text layer -> needs_ocr() is True
RECOVERED = (
    "The Issue is being made through the Book Building Process in terms of "
    "Rule 19(2)(b) of the Securities Contracts (Regulation) Rules, 1957. "
) * 3


class _Img:
    """Stands in for the PIL image render_pages_scaled yields."""


def _install_fakes(monkeypatch, pages_before_stop=None, stop_exc=None):
    """Fake the three OCR primitives `extract()` now calls directly.

    `pages_before_stop=None` means "never interrupt" (the equivalence case).
    An int means: render that many pages, then raise — standing in for the
    ceiling killing the process mid-pass.
    """
    rendered = []

    exc_type = stop_exc or extract_filing.CeilingReached

    def fake_render_pages_scaled(pdf_path, pages=None, dpi=None, max_edge=None):
        for n, idx in enumerate(pages):
            if pages_before_stop is not None and n >= pages_before_stop:
                raise exc_type("ceiling killed the OCR pass")
            rendered.append(idx)
            yield idx, _Img(), 1.0

    def fake_ocr_image(image, backend):
        return RECOVERED, 0.93

    monkeypatch.setattr(ocr_pages, "render_pages_scaled", fake_render_pages_scaled)
    monkeypatch.setattr(ocr_pages, "ocr_image", fake_ocr_image)
    monkeypatch.setattr(ocr_pages, "backend_available", lambda backend: True)
    return rendered


def _fake_pdf_open(monkeypatch, n_pages, scanned_indexes):
    """Fake pdfplumber so `extract()` can run without a real PDF."""

    class _Page:
        def __init__(self, i):
            self._i = i

        def extract_text(self):
            return SCANNED_TEXT if self._i in scanned_indexes else RECOVERED

        def close(self):
            pass

        def extract_tables(self):
            return []

    class _Pdf:
        pages = None

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    pdf = _Pdf()
    pdf.pages = [_Page(i) for i in range(n_pages)]

    import pdfplumber

    monkeypatch.setattr(pdfplumber, "open", lambda path: pdf)


def test_a_completed_pass_recovers_every_scanned_page(monkeypatch):
    """EQUIVALENCE with the old `ocr_pdf_pages` call: every scanned page is
    rendered exactly once, its recovered text replaces the empty text layer,
    and nothing is reported unread.

    Asserted against what the CODE did (`rendered`, and the page text in the
    envelope), never against literals this test also supplies — an assertion
    built from both sides of the same constant proves nothing. A mutation that
    stops computing unread pages must fail the interrupt test below; a mutation
    that stops rendering must fail this one."""
    scanned = {1, 3}
    rendered = _install_fakes(monkeypatch)
    _fake_pdf_open(monkeypatch, 5, scanned)

    out = extract_filing.extract("esds-rhp.pdf", "RHP")

    assert sorted(rendered) == sorted(scanned)
    assert out["extraction_status"] != STATUS_INCOMPLETE_PAGES
    assert "unread_pages" not in out
    # The OCR'd pages carry real text in the envelope, so the recovery was
    # actually kept rather than rendered and dropped.
    text_by_page = dict(out["page_texts"])
    for idx in scanned:
        assert RECOVERED.strip()[:40] in text_by_page[idx]


def test_an_interrupted_pass_keeps_finished_pages_and_names_the_rest(monkeypatch):
    """The behaviour the slice exists for, asserted on the RETURNED envelope.

    The interrupt is swallowed by design: a 555-page RHP stopped on its 58th
    OCR page has ~45 minutes of recovered content, and re-raising would discard
    all of it. So `extract()` returns, page 1 is kept, and pages 3 and 4 are
    named with the reason they were never read."""
    scanned = {1, 3, 4}
    rendered = _install_fakes(
        monkeypatch, pages_before_stop=1, stop_exc=extract_filing.CeilingReached
    )
    _fake_pdf_open(monkeypatch, 6, scanned)

    out = extract_filing.extract("esds-rhp.pdf", "RHP")

    assert rendered == [1], "the fake should have rendered exactly one page"
    assert out["extraction_status"] == STATUS_INCOMPLETE_PAGES
    assert out["unread_pages"] == [
        {"page": 3, "reason": "ceiling_reached"},
        {"page": 4, "reason": "ceiling_reached"},
    ]
    # The page that DID finish kept its recovered text — the whole point of
    # swallowing the interrupt instead of failing the document.
    assert RECOVERED.strip()[:40] in dict(out["page_texts"])[1]


def test_a_memory_error_is_not_swallowed(monkeypatch):
    """The narrowness of the catch, proven rather than asserted in a comment.
    main() has its own JSON + exit-75 contract for a memory kill, which the
    node caller reads to tell a memory kill apart from a slow document. If the
    ceiling catch widened to `except Exception`, that contract would silently
    become 'INCOMPLETE_PAGES' and a real OOM would read as a slow read."""
    scanned = {0, 1}
    _install_fakes(monkeypatch, pages_before_stop=1, stop_exc=MemoryError)
    _fake_pdf_open(monkeypatch, 3, scanned)

    with pytest.raises(MemoryError):
        extract_filing.extract("esds-rhp.pdf", "RHP")


def test_a_terminated_process_is_reported_as_such_not_as_a_ceiling_trip(monkeypatch):
    """The reason must name the real cause: an operator killing the job is not
    the 2-hour ceiling tripping, and the two want different follow-ups."""
    scanned = {0, 1}
    _install_fakes(monkeypatch, pages_before_stop=1, stop_exc=KeyboardInterrupt)
    _fake_pdf_open(monkeypatch, 3, scanned)

    out = extract_filing.extract("esds-rhp.pdf", "RHP")

    assert out["unread_pages"] == [{"page": 1, "reason": "process_terminated"}]


def test_an_unavailable_backend_names_the_pages_it_could_not_read(monkeypatch):
    """Previously this path wrote a stderr line and returned a status claiming
    a clean read. Those pages needed OCR and did not get it."""
    scanned = {0, 2}
    _install_fakes(monkeypatch)
    monkeypatch.setattr(ocr_pages, "backend_available", lambda backend: False)
    _fake_pdf_open(monkeypatch, 4, scanned)

    out = extract_filing.extract("scanned-ad.pdf", "PRICE_BAND_AD")

    assert out["extraction_status"] == STATUS_INCOMPLETE_PAGES
    assert [p["page"] for p in out["unread_pages"]] == [0, 2]
    for p in out["unread_pages"]:
        assert p["reason"].startswith("ocr_backend_unavailable:")


def test_a_document_with_no_scanned_pages_never_renders_anything(monkeypatch):
    """The positive control on the control: if the loop rendered pages for a
    document whose text layer is fine, every clean filing would pay the OCR
    cost and the 'unread' signal would be noise."""
    rendered = _install_fakes(monkeypatch)
    _fake_pdf_open(monkeypatch, 4, set())

    out = extract_filing.extract("clean-rhp.pdf", "RHP")

    assert rendered == []
    assert out["extraction_status"] != STATUS_INCOMPLETE_PAGES
    assert "unread_pages" not in out
