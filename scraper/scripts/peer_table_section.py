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
# Item 46 (OD-165): "peer" is singular when the issuer names ONE listed peer -
# NSE RHP p138, "6. Comparison of Accounting Ratios with listed industry peer"
# (BSE Limited). The plural-only pattern reported that document as having only
# the KPI table.
# Item 46 round 3 (OD-165): two more real wordings name the same section on SME
# RHPs - "6. Comparison of Accounting Ratios with Industry Peers" (Robokidz RHP
# p97, no "listed") and "6. Comparison with Peer Group Companies:" (Vivekanand
# Cotspin RHP p113, where the whole peer table sits). Both read as "no section" /
# "only the KPI table", a MISS on a document that prints the section. The KPI
# heading is still refused first (_KPI_HEADING).
_PEER_HEADING = re.compile(
    r"comparison(?:\s+\S+){0,4}?\s+with\s+(?:the\s+|our\s+)?"
    r"(?:(?:listed\s+)?industry\s+peers?|(?:listed\s+)?peer\s+group(?:\s+compan(?:y|ies))?)\b",
    re.I,
)

# `6.`, `8.`, `VI.`, `III.`, `f)` — optional, and never sufficient on its own.
# The single-letter form is German Green Steel's RHP (p181, "f) Comparison of
# Accounting Ratios with listed industry peers"): without it the marker stayed
# glued to the phrase, the heading never "started with Comparison", and the
# locator walked on to the KPI table three pages later (#545).
_SECTION_MARKER = re.compile(r"^\s*(\d{1,2}|[IVXLC]{1,5}|[a-z])[.)]\s+", re.I)

# Matched so the KPI table can be REFUSED with a named reason rather than
# silently not-matched: "we found nothing" and "we found the wrong thing and
# declined it" are different outcomes, and only one is worth alerting on.
# Both spellings are real: Kanohar's "Comparison of KPIs with our peers" and
# German Green's "Comparison of Key Performance Indicators with listed industry
# peers" (RHP p184). The second also satisfies _PEER_HEADING, so without this
# alternative it was taken for the peer table (#545).
# "indic\w*" because a real SME RHP misspells it: Papadmalji p132 "7. Comparison of
# key performance indictors with Peer Group Companies" (a KPI table, never peers).
_KPI_HEADING = re.compile(
    # "of our key performance indicators" is S. K. Offset RHP p119.
    r"comparison\s+of\s+(?:our\s+|the\s+)?(?:kpis?\b|key\s+performance\s+indic\w*)", re.I
)

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


def kpi_comparison_section_body(lines):
    """The lines of the KPI comparison section (heading excluded), or None.

    Item 46 round 3: S. K. Offset's RHP prints no accounting-ratio peer section;
    its only peer statement sits under the KPI heading (p119): "There are
    presently no listed Companies in India that are engaged in a business that is
    directly comparable ...". The caller reads a stated absence from this body
    only when the document has no peer section at all.
    """
    for index, raw in enumerate(lines):
        after = _after_marker(raw)
        if not (_STARTS_WITH_COMPARISON.match(after) and _KPI_HEADING.search(after)):
            continue
        body = []
        for j in range(index + 1, len(lines)):
            if _ends_peer_section(lines[j]):
                break
            body.append(lines[j])
        return body
    return None


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
