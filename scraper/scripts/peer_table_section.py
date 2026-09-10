"""Locate the listed-peer comparison section in a prospectus.

Item 8a. Ported from a TypeScript version that was merged and then RETIRED the
same night: the peer extraction lives HERE, in Python, over `page_texts`, so a
locator on the TypeScript side had no caller and no prospect of one. That is the
"correct but uncalled helper" class — and shipping one while item 20 exists to
catch exactly that was worth undoing rather than defending.

Finding this section has been got wrong three times on this item, so the rules
below are the measured ones rather than the obvious ones:

* The heading is worded TWO ways across the four issuers measured —
  "Comparison of Accounting Ratios with Listed Industry Peers" (section 6) and
  "Comparison of KEY accounting ratios with listed industry peers" (section 8).
  A build card once recorded a third; that was a footnote's cross-reference
  being read as the heading.
* The section MARKER (``6.``, ``8.``, ``VI.``) is not a discriminator: numbered
  NOTES carry the identical shape ("1. The face value of each Equity Share...").
* What separates a heading from a mention is that the PHRASE STARTS THE LINE
  after an optional marker. A cross-reference sits mid-sentence.
* Kanohar prints a SECOND peer-shaped table, "Comparison of KPIs with our peers
  listed in India", listing the same companies with numeric columns. It must be
  refused, or "found a table" and "found the RIGHT table" become the same
  question and only the first one is being asked.
"""

import re

# The words between "comparison" and "with" vary ("of accounting ratios", "of
# key accounting ratios"). Bounded rather than open so it cannot swallow half a
# paragraph on its way to a later "with listed industry peers".
_PEER_HEADING = re.compile(
    r"comparison(?:\s+\S+){0,4}?\s+with\s+(?:the\s+)?listed\s+industry\s+peers",
    re.I,
)

# `6.`, `8.`, `VI.`, `III.` — optional, and never sufficient on its own.
_SECTION_MARKER = re.compile(r"^\s*(\d{1,2}|[IVXLC]{1,5})[.)]\s+", re.I)

# Matched so the KPI table can be REFUSED with a named reason rather than
# silently not-matched: "we found nothing" and "we found the wrong thing and
# declined it" are different outcomes, and only one is worth alerting on.
_KPI_HEADING = re.compile(r"comparison\s+of\s+kpis?\b", re.I)

_NOTES_TERMINATOR = re.compile(r"^notes?\s*:", re.I)
_SOURCE_TERMINATOR = re.compile(r"^source\s*:", re.I)

_STARTS_WITH_COMPARISON = re.compile(r"^comparison\b", re.I)


def _after_marker(line):
    """The line with any leading section marker removed."""
    text = (line or "").strip()
    match = _SECTION_MARKER.match(text)
    return text[match.end():] if match else text


def _ends_peer_section(line):
    """What closes the section.

    A numbered NOTE does not. Treating any marker as the next heading cuts the
    table off at its first footnote and silently loses every row after it, which
    looks like a short table rather than like a bug.
    """
    text = (line or "").strip()
    if _NOTES_TERMINATOR.match(text) or _SOURCE_TERMINATOR.match(text):
        return True
    match = _SECTION_MARKER.match(text)
    if not match:
        return False
    rest = text[match.end():]
    # A heading is a short title. A note is a sentence: it runs long and ends in
    # a full stop. Judging on shape, not on the presence of a marker.
    return bool(rest) and len(rest) < 90 and not rest.endswith(".")


def find_peer_table_section(lines):
    """Return ``(heading_index, body_lines)`` for the listed-peer comparison
    section, or ``(None, [])`` when the text has none.

    Refuses the KPI comparison table and prose mentions of the section's name.
    """
    for index, raw in enumerate(lines):
        text = (raw or "").strip()
        if not text:
            continue
        after = _after_marker(text)
        # Must START with "Comparison" — this is what tells a heading from a
        # footnote that merely quotes the heading's name mid-sentence.
        if not _STARTS_WITH_COMPARISON.match(after):
            continue
        if _KPI_HEADING.search(after):
            continue
        if not _PEER_HEADING.search(after):
            continue

        body = []
        for j in range(index + 1, len(lines)):
            if _ends_peer_section(lines[j]):
                break
            body.append(lines[j])
        return index, body

    return None, []


def contains_kpi_comparison_table(lines):
    """True when the KPI comparison table is present.

    Exposed so a caller can report "the wrong table was here" rather than a
    silent miss.
    """
    for raw in lines:
        after = _after_marker(raw)
        if _STARTS_WITH_COMPARISON.match(after) and _KPI_HEADING.search(after):
            return True
    return False
