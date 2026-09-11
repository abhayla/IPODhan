"""Item 8a — the extractor actually CALLS the peer reader.

Every earlier slice tested a piece in isolation. This one tests that the pieces
are connected, because "correct but uncalled" is the exact failure this item has
already produced once tonight: the section locator was merged in TypeScript,
where nothing would ever call it, and had to be retired and ported.

So these tests drive `run()` - the extractor's real entry point - rather than
the peer module directly.
"""

import io
import json
import os

import pytest

from extract_filing import run

FIXTURES = os.path.join(
    os.path.dirname(__file__), "..", "tests", "fixtures", "peer-tables"
)


def text_pages(name):
    with io.open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        raw = handle.read()
    pages = []
    for index, chunk in enumerate(p for p in raw.split("<<<PAGE ") if p.strip()):
        body = chunk.split(">>>", 1)[1] if ">>>" in chunk else chunk
        pages.append((index, body))
    return pages


def cell_tables(name):
    with io.open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        return json.load(handle)["tables"]


def field(envelope, name):
    return envelope.get("fields", {}).get(name)


@pytest.mark.parametrize(
    "text_fixture,cell_fixture,issuer,peer_count",
    [
        ("karamtara-peer-table.txt", "karamtara-peer-cells.json", "Karamtara", 8),
        ("prasolchem-peer-table.txt", "prasolchem-peer-cells.json", "Prasol", 7),
    ],
)
def test_run_emits_the_peer_companies_field(
    text_fixture, cell_fixture, issuer, peer_count
):
    tables = cell_tables(cell_fixture)
    envelope = run(
        text_pages(text_fixture),
        "RHP",
        text_fixture,
        tables_for_page=lambda _p: tables,
    )
    peers = field(envelope, "peer_companies")
    assert peers is not None, "peer_companies never reached the envelope"
    assert peers.get("value"), "peer_companies is present but empty"
    assert len(peers["value"]) == peer_count
    names = [p["name"] for p in peers["value"]]
    assert not any(n.startswith(issuer) for n in names), "the issuer is in its own peer set"


def test_the_field_carries_the_documents_own_verification():
    """The emitted field is checked against the prospectus's OWN summary of
    which peer has the highest and lowest P/E - not against a list I typed."""
    tables = cell_tables("karamtara-peer-cells.json")
    envelope = run(
        text_pages("karamtara-peer-table.txt"),
        "RHP",
        "karamtara",
        tables_for_page=lambda _p: tables,
    )
    peers = field(envelope, "peer_companies")
    assert peers["check"]["name"] == "peer_list_matches_printed_summary"
    assert peers["check"]["passed"] is True
    # The detail says what the check actually compared, so a reader of the
    # envelope can tell a real verification from a vacuous one.
    assert "highest/lowest" in peers["check"]["detail"]


def test_a_document_without_the_table_records_WHY_not_just_nothing():
    envelope = run(
        [(0, "A prospectus with no peer comparison section at all.")],
        "RHP",
        "nothing",
        tables_for_page=lambda _p: [],
    )
    peers = field(envelope, "peer_companies")
    assert peers is not None
    assert peers.get("value") is None
    # A miss is carried the same way every other absent field is: the reason
    # rides in the check detail, so nothing downstream needs a special case.
    assert peers["check"]["name"] == "not_extractable"
    assert "not_in_document" in peers["check"]["detail"]


def test_the_extractor_still_works_with_no_table_reader_supplied():
    """The parameter is optional on purpose. Every field that worked before this
    change must keep working when nothing supplies a table reader - otherwise
    adding peers could regress an unrelated field, which is a far worse outcome
    than not having peers.
    """
    envelope = run(text_pages("karamtara-peer-table.txt"), "RHP", "karamtara")
    assert envelope.get("fields") is not None
    # peer_companies is simply absent; nothing else is disturbed.
    assert field(envelope, "peer_companies") is None


def test_tables_are_requested_for_exactly_one_page():
    """The memory rule, at the level that actually runs it.

    A regression would not fail any assertion about the output - the peers would
    still be right, and the process would just hold every page's objects. On a
    400-page prospectus under a hard memory ceiling that is the difference
    between working and being killed.
    """
    tables = cell_tables("karamtara-peer-cells.json")
    asked = []

    def provider(index):
        asked.append(index)
        return tables

    run(text_pages("karamtara-peer-table.txt"), "RHP", "karamtara", tables_for_page=provider)
    assert len(asked) == 1, "tables were extracted for %d pages" % len(asked)


def test_a_price_band_ad_does_not_take_the_new_path():
    """PRICE_BAND_AD keeps its existing peer block. This slice adds a reader for
    the RHP, where the table actually lives; it does not change what the
    price-band-ad path does."""
    tables = cell_tables("karamtara-peer-cells.json")
    asked = []
    run(
        [(0, "Price band advertisement with no peer grid")],
        "PRICE_BAND_AD",
        "ad",
        tables_for_page=lambda p: asked.append(p) or tables,
    )
    assert asked == [], "the price-band-ad path called the RHP table reader"
