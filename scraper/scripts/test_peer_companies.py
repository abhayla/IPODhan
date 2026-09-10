"""Item 8a — the end-to-end peer read, on real prospectus text and real cells.

These tests join the committed TEXT fixtures (what the locator sees) to the
committed CELL fixtures (what the table extractor returns), which is exactly the
pairing the extractor performs at runtime: find the section in the cheap text
layer, then pay for tables on the one page it names.

The table provider is injected rather than opening a PDF, for two reasons. It
keeps these tests offline and fast, and it mirrors production: `extract_filing`
already owns the PDF handle and its memory discipline, and a second opener
inside the peer module could outlive it.
"""

import io
import json
import os

from peer_companies import (
    NOT_IN_DOCUMENT,
    NO_TABLE_ON_PAGE,
    TABLE_EXTRACTION_FAILED,
    ONLY_KPI_TABLE,
    extract_peer_companies,
    find_peer_section_page,
)

FIXTURES = os.path.join(
    os.path.dirname(__file__), "..", "tests", "fixtures", "peer-tables"
)


def text_pages(name):
    """The committed page text, as the extractor's ``(index, text)`` pairs.

    The fixture holds two consecutive pages separated by a page marker, so it is
    split back into the same shape the extractor produces.
    """
    with io.open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        raw = handle.read()
    parts = raw.split("<<<PAGE ")
    pages = []
    for index, chunk in enumerate(p for p in parts if p.strip()):
        body = chunk.split(">>>", 1)[1] if ">>>" in chunk else chunk
        pages.append((index, body))
    return pages


def cell_tables(name, index):
    with io.open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        return json.load(handle)["tables"]


def test_the_section_is_found_in_the_text_layer():
    """Cheap step first. If this misses, the expensive one never runs."""
    for name in ("karamtara-peer-table.txt", "prasolchem-peer-table.txt"):
        assert find_peer_section_page(text_pages(name)) is not None, name


def test_karamtara_reads_end_to_end():
    pages = text_pages("karamtara-peer-table.txt")
    tables = cell_tables("karamtara-peer-cells.json", 1)
    result, reason = extract_peer_companies(pages, lambda _p: tables)
    assert reason is None
    assert result["issuer"]["name"].startswith("Karamtara")
    assert len(result["peers"]) == 8
    assert result["columns"]["market_cap"] == 3


def test_prasolchem_reads_end_to_end():
    pages = text_pages("prasolchem-peer-table.txt")
    tables = cell_tables("prasolchem-peer-cells.json", 1)
    result, reason = extract_peer_companies(pages, lambda _p: tables)
    assert reason is None
    assert result["issuer"]["name"].startswith("Prasol")
    assert len(result["peers"]) == 7
    assert "market_cap" not in result["columns"]


def test_the_right_table_is_chosen_from_a_page_holding_several():
    """PRASOLCHEM's page carries ELEVEN tables and the peer table is not the
    first. Chosen by whether peers can actually be read out of it, which is
    stronger than any header heuristic - it means the columns mapped AND a
    divider was found AND rows followed."""
    pages = text_pages("prasolchem-peer-table.txt")
    with io.open(
        os.path.join(FIXTURES, "prasolchem-peer-cells.json"), encoding="utf-8"
    ) as handle:
        every_table = json.load(handle)["tables"]
    assert len(every_table) > 5, "fixture no longer has several tables"

    result, reason = extract_peer_companies(pages, lambda _p: every_table)
    assert reason is None
    assert len(result["peers"]) == 7


def test_a_document_without_the_section_says_so():
    pages = [(0, "Some other section entirely\nwith no peer comparison at all")]
    result, reason = extract_peer_companies(pages, lambda _p: [])
    assert result is None
    assert reason == NOT_IN_DOCUMENT


def test_the_lookalike_table_is_reported_as_ITS_OWN_reason():
    """A document printing only the KPI comparison is a DIFFERENT finding from
    one printing neither, and the second is the one worth chasing. Folding them
    together would hide that."""
    pages = text_pages("kanohar-kpi-table-NEGATIVE.txt")
    result, reason = extract_peer_companies(pages, lambda _p: [])
    assert result is None
    assert reason == ONLY_KPI_TABLE


def test_a_found_section_with_no_extractable_table_is_its_own_reason():
    """Measured on Glasswall: the heading is in the text, but neither pdfplumber
    strategy detects its peer table. Reporting that as "not in the document"
    would be false - the table IS in the document, we could not read it."""
    pages = text_pages("glasswall-peer-table.txt")
    result, reason = extract_peer_companies(pages, lambda _p: [])
    assert result is None
    assert reason == NO_TABLE_ON_PAGE


def test_only_the_located_page_is_asked_for_tables():
    """The memory rule, asserted rather than trusted.

    The extractor reads text for every page but must pay for table extraction on
    ONE. pdfplumber caches each page's characters and objects for the life of
    `pdf.pages`; on a 400-page prospectus that pins gigabytes, under a process
    with a hard RLIMIT_AS ceiling. A regression here would not fail a test that
    only checks the output - it would just quietly use far more memory.
    """
    pages = text_pages("karamtara-peer-table.txt")
    tables = cell_tables("karamtara-peer-cells.json", 1)
    asked = []

    def provider(page_index):
        asked.append(page_index)
        return tables

    result, _reason = extract_peer_companies(pages, provider)
    assert result is not None
    assert len(asked) == 1, "table extraction was asked for %d pages" % len(asked)
    assert asked[0] == result["page"]


def test_no_tables_are_extracted_at_all_when_the_section_is_absent():
    """The cheap step gates the expensive one. If the section is not in the
    text, the PDF must never be re-opened for tables."""
    asked = []
    pages = [(0, "nothing relevant here")]
    extract_peer_companies(pages, lambda p: asked.append(p) or [])
    assert asked == []


def test_a_provider_that_raises_does_not_take_down_the_extraction():
    """A peer table is one field among many. A prospectus that yields nothing
    here must still yield everything else, so a failure is reported, not
    thrown."""
    pages = text_pages("karamtara-peer-table.txt")

    def exploding(_page):
        raise RuntimeError("pdfplumber fell over")

    result, reason = extract_peer_companies(pages, exploding)
    assert result is None
    assert reason.startswith(TABLE_EXTRACTION_FAILED)
    # The CAUSE is carried, not just the fact of failure - a reason that cannot
    # be classified from its own text is a defect of the reporter.
    assert "pdfplumber fell over" in reason
