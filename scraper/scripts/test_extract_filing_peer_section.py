"""Item 8a — the peer-section locator, tested on four real prospectuses.

Every case runs on committed fixture text extracted from a real RHP, not on a
heading typed from memory. That distinction is the whole reason item 8 has a
fixtures slice: the heading wording was got wrong twice from memory before the
documents were read, and a third time while writing the locator's own comment.
"""

import os
import re

import pytest

from peer_table_section import (
    contains_kpi_comparison_table,
    find_peer_table_section,
)

FIXTURES = os.path.join(
    os.path.dirname(__file__), "..", "tests", "fixtures", "peer-tables"
)


def fixture_lines(name):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as handle:
        return handle.read().split("\n")


def flat(lines):
    """PDF text wraps a peer's name across lines, so whitespace is collapsed
    before matching. Without this the assertion tests the PDF's line breaks
    rather than its content."""
    return re.sub(r"\s+", " ", " ".join(lines))


# (fixture, section marker, a phrase the heading must contain, a peer that must
# be inside the BODY — naming a peer is what stops a locator that returns the
# heading with an empty body from passing every other case here.)
CASES = [
    ("karamtara-peer-table.txt", "6", "Comparison of Accounting Ratios", "Inox Wind"),
    ("prasolchem-peer-table.txt", "6", "Comparison of Accounting Ratios", "Aarti Industries"),
    ("kanohar-peer-table.txt", "8", "key accounting ratios", "Hitachi Energy"),
    ("glasswall-peer-table.txt", "VI", "accounting ratios with listed industry peers", "Innovator"),
]


@pytest.mark.parametrize("name,marker,heading_part,peer", CASES)
def test_finds_the_section(name, marker, heading_part, peer):
    lines = fixture_lines(name)
    index, body = find_peer_table_section(lines)
    assert index is not None, "no section found in %s" % name
    assert heading_part.lower() in lines[index].lower()
    assert re.match(r"^\s*%s[.)]" % re.escape(marker), lines[index].strip())


@pytest.mark.parametrize("name,marker,heading_part,peer", CASES)
def test_the_body_is_the_table_not_just_the_heading(name, marker, heading_part, peer):
    _index, body = find_peer_table_section(fixture_lines(name))
    assert peer in flat(body), "%s: peer rows missing from the body" % name


def test_glasswall_heading_is_not_the_cross_reference_above_it():
    """The trap that corrected the build card.

    Glasswall's notes say "...based on the peer set provided below under
    'Comparison with listed industry peers'". That is a mention inside a
    sentence. The real heading is twelve lines below it.
    """
    lines = fixture_lines("glasswall-peer-table.txt")
    index, _body = find_peer_table_section(lines)
    cross_ref = next(
        i for i, line in enumerate(lines) if re.search(r"provided below under", line, re.I)
    )
    assert index > cross_ref
    assert not re.search(r"provided below under", lines[index], re.I)


def test_the_kpi_table_yields_no_peer_section():
    assert find_peer_table_section(fixture_lines("kanohar-kpi-table-NEGATIVE.txt")) == (None, [])


def test_the_kpi_table_is_recognisable_as_itself():
    """Guards the case above: an empty or truncated fixture would satisfy "no
    section found" by containing nothing at all, which looks like discrimination
    and is vacuum."""
    assert contains_kpi_comparison_table(fixture_lines("kanohar-kpi-table-NEGATIVE.txt"))


@pytest.mark.parametrize("name,_m,_h,_p", CASES)
def test_real_peer_tables_are_not_mistaken_for_the_kpi_table(name, _m, _h, _p):
    assert not contains_kpi_comparison_table(fixture_lines(name))


def test_a_kpi_heading_using_the_peer_wording_is_still_refused():
    """The explicit KPI guard was, when written, unreachable — the real KPI
    heading already fails the phrase test because it says "peers listed in
    India", not "listed industry peers". Mutation testing caught that: deleting
    the guard changed no result, so it read as a safety check while doing
    nothing. It is kept because this wording is plausible in an issuer not yet
    seen, and THIS case is what makes it reachable."""
    synthetic = [
        "7. Comparison of KPIs with listed industry peers",
        "Name of Company Revenue EBITDA",
        "Listed Peers",
        "Some Rival Limited 100 20",
    ]
    assert find_peer_table_section(synthetic) == (None, [])


def test_a_prose_mention_inside_a_sentence_is_not_a_heading():
    text = [
        "a) The highest and lowest industry P/E shown above is based on the peer set",
        '   provided below under "Comparison with listed industry peers". The industry',
        "   average has been calculated as the arithmetic average P/E of the peer set.",
    ]
    assert find_peer_table_section(text) == (None, [])


def test_a_numbered_note_does_not_end_the_section_early():
    """"1. Figures for listed peers have been provided by our Company." carries a
    section-marker shape. Treating any marker as the next heading would cut the
    table off at its first note and lose every row after it."""
    text = [
        "6. Comparison of Accounting Ratios with Listed Industry Peers",
        "Name of Company Face Value",
        "Listed Peers",
        "Inox Wind Limited 10.00",
        "1. Figures for listed peers have been provided by our Company and verified.",
        "Waaree Energies Limited 10.00",
        "Notes:",
        "2. This line is past the terminator and must not appear.",
    ]
    _index, body = find_peer_table_section(text)
    joined = " ".join(body)
    assert "Waaree Energies" in joined
    assert "past the terminator" not in joined


def test_text_with_no_such_section_returns_nothing_rather_than_guessing():
    assert find_peer_table_section(
        ["3. INDUSTRY PEER GROUP P/E RATIO", "Highest 206.68"]
    ) == (None, [])


def test_an_empty_document_does_not_raise():
    assert find_peer_table_section([]) == (None, [])
