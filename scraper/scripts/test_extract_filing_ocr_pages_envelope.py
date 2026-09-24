"""OD-97 (item 22): the extractor envelope always lists `ocr_pages`.

The persister marks each value TEXT / OCR / MIXED from this list plus the
field's own page (scraper/src/services/ocr-value-mark.ts). A MISSING key means
"an envelope from before the mark" (unknown), so a current envelope must carry
the key even when no page was OCR'd: `[]` is a known text-layer read.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_filing import run  # noqa: E402

PAGE = (
    "PRICE BAND: Rs 77 TO Rs 81 PER EQUITY SHARE OF FACE VALUE OF Rs 2 EACH\n"
    "BIDS CAN BE MADE FOR A MINIMUM OF 185 EQUITY SHARES AND IN MULTIPLES OF 185\n"
)


def test_text_layer_envelope_lists_empty_ocr_pages():
    env = run([(0, PAGE), (1, PAGE)], "PRICE_BAND_AD", "ad.pdf")
    assert env["ocr_pages"] == []


def test_ocr_route_envelope_lists_the_ocr_pages_sorted():
    env = run([(0, PAGE), (1, PAGE), (2, PAGE)], "PRICE_BAND_AD", "ad.pdf",
              ocr_confidence={2: 0.76, 0: 0.74})
    assert env["ocr_pages"] == [0, 2]
    assert all(isinstance(p, int) for p in env["ocr_pages"])
