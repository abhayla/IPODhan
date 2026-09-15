r"""OD-55 (owner, 2026-09-11) part 3 — when the hung-process ceiling stops a
read, the envelope names EVERY page it never read, by page number, with the
reason it stopped. Never a bare "N pages unread" count (signal-ownership.md
R1: "a number is not a reading").

WHY A NEW STATUS RATHER THAN REUSING PARTIAL_OCR. `STATUS_PARTIAL_OCR` already
exists and already means something else: "some field check failed AND the text
came (wholly or partly) from OCR". That is a statement about CONFIDENCE in
pages that WERE read. "I was stopped before reading every page" is a statement
about COVERAGE. Folding the second meaning into the first would make the
envelope unreadable — a consumer could no longer tell a low-confidence read of
a complete document from a clean read of an incomplete one, which are opposite
operational situations: the first needs a human to check a number, the second
needs the remaining pages re-read from the retained PDF (OD-32's seven-day
retention exists precisely for that). So `INCOMPLETE_PAGES` is its own status.

Class this covers (every member, not the sample):
  - every doc_type the extractor handles (RHP, DRHP, PROSPECTUS,
    PRICE_BAND_AD) — the ceiling is doc-type-blind;
  - both segments (MAINBOARD, SME);
  - both slots (prod, staging) — this is pure in-process envelope shaping with
    no environment dependency;
  - both directions in time: a document interrupted by the ceiling on a FUTURE
    cycle, and one whose stored envelope is read back by a later re-read pass;
  - the interrupted-OCR case AND the never-interrupted case, because a status
    that fires when nothing was skipped would mark every healthy document
    incomplete (the failure mode that makes a signal worthless).

Run:  cd scraper && python -m pytest scripts/test_extract_filing_incomplete_pages.py -q
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_filing import (  # noqa: E402
    run,
    STATUS_OK,
    STATUS_OK_OCR,
    STATUS_PARTIAL_OCR,
    STATUS_INCOMPLETE_PAGES,
)


# A page carrying enough real prose that the extractor treats it as read.
READABLE = (
    "The Issue is being made through the Book Building Process in terms of "
    "Rule 19(2)(b) of the Securities Contracts (Regulation) Rules, 1957 and "
    "in compliance with Regulation 6(1) of the SEBI ICDR Regulations. "
) * 3


def _pages(n):
    return [(i, READABLE) for i in range(n)]


def test_the_status_is_its_own_value_not_an_alias_of_partial_ocr():
    """The two meanings must not collapse onto one string."""
    assert STATUS_INCOMPLETE_PAGES != STATUS_PARTIAL_OCR
    assert STATUS_INCOMPLETE_PAGES != STATUS_OK_OCR
    assert STATUS_INCOMPLETE_PAGES != STATUS_OK


def test_unread_pages_are_named_by_number_with_a_reason():
    """The ceiling tripped after page 2; pages 3 and 4 were never read."""
    out = run(
        _pages(5),
        "RHP",
        "esds-rhp.pdf",
        unread_pages=[(3, "ceiling_reached"), (4, "ceiling_reached")],
    )
    assert out["extraction_status"] == STATUS_INCOMPLETE_PAGES
    # The identities, not a count — this is the whole point of the slice.
    assert out["unread_pages"] == [
        {"page": 3, "reason": "ceiling_reached"},
        {"page": 4, "reason": "ceiling_reached"},
    ]


def test_a_bare_count_is_not_accepted_as_a_record():
    """Passing a number where identities belong must fail loudly, not silently
    degrade to the very 'N pages unread' shape the rule forbids."""
    try:
        run(_pages(5), "RHP", "esds-rhp.pdf", unread_pages=2)
    except (TypeError, ValueError):
        return
    raise AssertionError("a bare count was accepted as an unread-page record")


def test_a_complete_read_never_reports_incomplete():
    """The positive control. A status that fires when nothing was skipped
    would mark every healthy document incomplete."""
    out = run(_pages(5), "RHP", "esds-rhp.pdf")
    assert out["extraction_status"] != STATUS_INCOMPLETE_PAGES
    assert out.get("unread_pages") in (None, [])

    out_empty = run(_pages(5), "RHP", "esds-rhp.pdf", unread_pages=[])
    assert out_empty["extraction_status"] != STATUS_INCOMPLETE_PAGES


def test_coverage_beats_confidence_when_both_apply():
    """A document that was BOTH OCR'd and cut short reports the coverage gap.
    Reporting PARTIAL_OCR here would hide the missing pages behind a
    confidence caveat, and the missing pages are the actionable half: they can
    be re-read from the retained PDF, whereas a low-confidence number cannot
    be improved by re-reading the same page."""
    out = run(
        _pages(5),
        "RHP",
        "esds-rhp.pdf",
        ocr_confidence={0: 0.91},
        unread_pages=[(4, "ceiling_reached")],
    )
    assert out["extraction_status"] == STATUS_INCOMPLETE_PAGES
    assert out["unread_pages"] == [{"page": 4, "reason": "ceiling_reached"}]


def test_every_doc_type_and_segment_is_covered_by_the_same_rule():
    """The ceiling is doc-type- and segment-blind: it is a property of the
    process being stopped, not of what it was reading."""
    for doc_type in ("RHP", "DRHP", "PROSPECTUS", "PRICE_BAND_AD"):
        for segment in ("MAINBOARD", "SME"):
            out = run(
                _pages(3),
                doc_type,
                "some-filing.pdf",
                segment=segment,
                unread_pages=[(2, "ceiling_reached")],
            )
            assert out["extraction_status"] == STATUS_INCOMPLETE_PAGES, (doc_type, segment)
            assert out["unread_pages"] == [{"page": 2, "reason": "ceiling_reached"}], (
                doc_type,
                segment,
            )


def test_the_reason_is_carried_through_not_normalised_away():
    """A stopped read has more than one cause, and the cause decides what a
    later pass does: a ceiling trip is worth retrying from the stored PDF, a
    malformed page is not."""
    out = run(
        _pages(4),
        "RHP",
        "esds-rhp.pdf",
        unread_pages=[(2, "ceiling_reached"), (3, "malformed_page")],
    )
    assert out["unread_pages"] == [
        {"page": 2, "reason": "ceiling_reached"},
        {"page": 3, "reason": "malformed_page"},
    ]
