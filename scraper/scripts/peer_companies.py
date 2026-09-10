"""Read a prospectus's listed-peer comparison, end to end.

Item 8a. Joins the three pieces already on main - the section locator, the
header-based column mapper and the row reader - into the one call the extractor
makes.

**Why this narrows to a single page first.** `extract_filing.py` deliberately
reads only each page's TEXT and then closes the page immediately: pdfplumber
caches every page's characters and objects for the life of `pdf.pages`, and on a
400-page prospectus that pins gigabytes, under a process that runs with a hard
RLIMIT_AS ceiling (W-137). Extracting tables for every page would be a memory
regression on exactly the path that has a cap.

So the order matters and is not incidental: find the section in the cheap text
layer, then pay for table extraction on the ONE page it names. That is what the
locator is for.

**The tables come from a caller-supplied function**, not from opening the PDF
here. The extractor already owns the PDF handle and its memory discipline; a
second opener inside this module would duplicate that and could outlive it. It
also means these functions are testable without a PDF at all.
"""

from peer_table_rows import parse_peer_table
from peer_table_section import contains_kpi_comparison_table, find_peer_table_section

# Refusal reasons, kept as strings the envelope can carry so a miss says WHY.
# "not in the document" and "the wrong table was there" are different findings
# and only one of them is worth investigating.
NOT_IN_DOCUMENT = "peer_comparison_table_not_in_document"
ONLY_KPI_TABLE = "peer_comparison_table_absent_only_kpi_table_present"
NO_TABLE_ON_PAGE = "peer_comparison_section_found_but_no_table_extracted"
NO_ROWS_PARSED = "peer_comparison_table_found_but_no_peer_rows_parsed"
TABLE_EXTRACTION_FAILED = "peer_comparison_table_extraction_failed"


def find_peer_section_page(page_texts):
    """Return the 0-based page index carrying the peer section, or None.

    `page_texts` is the extractor's own list of ``(index, text)`` pairs.
    """
    for index, text in page_texts:
        lines = (text or "").split("\n")
        heading_line, _body = find_peer_table_section(lines)
        if heading_line is not None:
            return index
    return None


def _looks_like_the_peer_table(table):
    """Pick the peer table out of a page that holds several.

    Never by index: it is table 1 of 2 on one issuer and 1 of 11 on another. A
    table qualifies when the row reader can actually get peers out of it, which
    is a stronger test than any header heuristic - it means the columns mapped
    AND a divider was found AND rows followed it.
    """
    try:
        parsed = parse_peer_table(table)
    except Exception:
        return None
    return parsed if parsed["peers"] else None


def extract_peer_companies(page_texts, tables_for_page):
    """Return ``(result, reason)``.

    On success `result` is ``{"page": index, "issuer": record, "peers": [...],
    "columns": {...}}`` and `reason` is None. On a miss `result` is None and
    `reason` names WHICH miss it was.

    `tables_for_page(index)` returns that page's tables as lists of rows of
    cells. The caller owns the PDF and its memory discipline.
    """
    page = find_peer_section_page(page_texts)
    if page is None:
        # Distinguish "no such table" from "the lookalike was there". A document
        # that prints only the KPI comparison is a different finding from one
        # that prints neither, and the second is the one worth chasing.
        for _index, text in page_texts:
            if contains_kpi_comparison_table((text or "").split("\n")):
                return None, ONLY_KPI_TABLE
        return None, NOT_IN_DOCUMENT

    try:
        tables = tables_for_page(page) or []
    except Exception as err:  # noqa: BLE001 - deliberately broad, see below
        # A peer table is ONE field among many in a prospectus. If table
        # extraction falls over - a malformed page, a memory refusal, a
        # pdfplumber edge - the document must still yield everything else it
        # has. So the failure is REPORTED with its cause rather than thrown,
        # and the cause is carried so the reason is auditable instead of just
        # "no peers" (signal-ownership R6).
        return None, "%s: %s" % (TABLE_EXTRACTION_FAILED, err)

    if not tables:
        # The section's heading is in the text but no table was extracted from
        # its page. Measured on Glasswall: neither pdfplumber strategy detects
        # its peer table, and the rotated issuer needs a different path
        # entirely. Reported as its own reason rather than folded into
        # "not in the document", which would be false.
        return None, NO_TABLE_ON_PAGE

    for table in tables:
        parsed = _looks_like_the_peer_table(table)
        if parsed is not None:
            return (
                {
                    "page": page,
                    "issuer": parsed["issuer"],
                    "peers": parsed["peers"],
                    "columns": parsed["columns"],
                },
                None,
            )

    return None, NO_ROWS_PARSED
