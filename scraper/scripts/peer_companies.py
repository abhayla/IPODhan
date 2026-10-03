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

import re

from peer_table_rows import parse_peer_table
from peer_text_rows import parse_peer_text_rows
from peer_table_section import find_peer_table_section, kpi_comparison_section_body

# The document's own cross-reference: every prospectus measured prints, on the
# same page, which company has the highest and which the lowest P/E "of the peer
# set provided below".
# `[ \t]`, never `\s`, between the parts: under re.M `\s` crosses the line end,
# so A-One Steels' EV/EBITDA summary ("Highest 18.17" / "Lowest 12.71", no
# company named) was read as a peer called "Lowest" and failed the check (#545).
_SUMMARY_LINE = re.compile(r"^[ \t]*(?:Highest|Lowest)[ \t]+[\d.,]+[ \t]+(.+?)[ \t]*$", re.M | re.I)
_TRAILING_NUMBER = re.compile(r"\s+[\d.,]+\s*$")

# Refusal reasons, kept as strings the envelope can carry so a miss says WHY.
# "not in the document" and "the wrong table was there" are different findings
# and only one of them is worth investigating.
NOT_IN_DOCUMENT = "peer_comparison_table_not_in_document"
ONLY_KPI_TABLE = "peer_comparison_table_absent_only_kpi_table_present"
NO_TABLE_ON_PAGE = "peer_comparison_section_found_but_no_table_extracted"
NO_ROWS_PARSED = "peer_comparison_table_found_but_no_peer_rows_parsed"
TABLE_EXTRACTION_FAILED = "peer_comparison_table_extraction_failed"
# The issuer SAYS it has no listed peer. A fact about the document, not a miss,
# and the detection check accepts it; an empty peer list with no reason is not.
NO_LISTED_PEERS = "peer_comparison_issuer_states_no_listed_peers"

_NO_PEERS_STATEMENT = re.compile(
    r"(?:there\s+(?:are|is)\s+no|do(?:es)?\s+not\s+have\s+any|no)\s+"
    # Item 46 round 3: "has no directly comparable listed peers" (Robokidz RHP p97).
    r"(?:directly\s+)?(?:comparable\s+|other\s+)?listed\s+(?:industry\s+)?"
    r"(?:peers?|compan(?:y|ies)|entit(?:y|ies))\b"
    # PR #1496 review (OD-158): "No listed entity DATA is available for FY2022",
    # "no listed peers WHOSE KPIs ..." restrict the noun; they never say the
    # issuer has no listed peer.
    r"(?!\s+(?:data|information|figures|details|whose|for)\b)",
    re.I,
)

# A sentence naming no listed peer is a stated absence only when nothing in its
# paragraph walks it back: "...exactly the same line of business; however we have
# compared ...", "the following listed peers", "the table below". Fail closed: any
# of these words keeps the answer a MISS.
_WALKED_BACK = re.compile(r"\b(?:however|compared|following|below|table)\b", re.I)
_SENTENCE_SPLIT = re.compile(r"(?<=\.)\s+(?=[A-Z(])")
_ALL_CAPS_HEADING = re.compile(r"^[^a-z]*[A-Z]{4}[^a-z]*$")


def stated_no_listed_peer(body_lines):
    """True only when a whole sentence of the section body literally states the
    issuer has no listed peer / comparable listed company, and nothing later in
    the same paragraph (up to a blank-free heading line) walks it back."""
    paragraphs, current = [], []
    for raw in body_lines:
        line = (raw or "").strip()
        if not line or _ALL_CAPS_HEADING.match(line):
            if current:
                paragraphs.append(current)
            current = []
            continue
        current.append(line)
    if current:
        paragraphs.append(current)
    for para in paragraphs:
        sentences = _SENTENCE_SPLIT.split(" ".join(" ".join(para).split()))
        for at, sentence in enumerate(sentences):
            if not _NO_PEERS_STATEMENT.search(sentence):
                continue
            if any(_WALKED_BACK.search(s) for s in sentences[at:]):
                return False
            return True
    return False


# A peer-ratio table set as text: a company row (Limited / Ltd on the row or the
# line after it) followed by at least four figures, on a page that names EPS and
# one of P/E, NAV or RoNW. Two such rows (issuer + a peer) on one page is the shape.
_FIGURE = r"(?:\(?-?[\d,]*\d(?:\.\d+)?\)?%?|\[\s*[●•]\s*\])"
_COMPANY_ROW = re.compile(r"^[A-Za-z][A-Za-z&.,'()\- ]{2,80}?(?:\s+" + _FIGURE + r"){4,}\s*$")
_FIGURES_ONLY_ROW = re.compile(r"^" + _FIGURE + r"(?:\s+" + _FIGURE + r"){3,}\s*$")
_LEGAL_FORM = re.compile(r"\b(?:limited|ltd)\b\.?", re.I)
_RATIO_TERMS = re.compile(r"\bP\s*/\s*E\b|\bNAV\b|\bRoNW\b|return\s+on\s+(?:average\s+)?net\s+worth", re.I)


def page_has_peer_ratio_table(text):
    """True when the page carries a peer accounting-ratio table shape."""
    text = text or ""
    if not (re.search(r"\bEPS\b", text) and _RATIO_TERMS.search(text)):
        return False
    lines = [ln.strip() for ln in text.split("\n")]
    rows = 0
    for i, line in enumerate(lines):
        following = lines[i + 1] if i + 1 < len(lines) else ""
        tail_is_form = bool(re.match(r"^(?:limited|ltd)\b", following, re.I))
        if _COMPANY_ROW.match(line):
            if _LEGAL_FORM.search(line) or tail_is_form:
                rows += 1
        elif _FIGURES_ONLY_ROW.match(line) and i > 0 and tail_is_form:
            # Vivekanand RHP p113: "Deepak Spinners" / "10 53,416.00 ..." / "limited".
            if re.match(r"^[A-Za-z][A-Za-z&.,'\- ]{2,60}$", lines[i - 1]):
                rows += 1
    return rows >= 2


def _document_prints_peer_table(page_texts):
    return any(page_has_peer_ratio_table(text) for _i, text in page_texts)

# How far a peer table may run past its heading's page. A-One Steels' RHP prints
# the heading at the foot of p220 and the whole table on p221 (#545).
_FOLLOW_PAGES = 1


def _first_two_words(name):
    letters = "".join(c if (c.isalpha() or c.isspace()) else " " for c in (name or ""))
    return " ".join(letters.split()[:2]).lower()


def check_against_printed_summary(peers, page_texts):
    """Verify the parsed peer list against the DOCUMENT'S OWN summary.

    Every prospectus measured names, on the same page, which company has the
    highest and which the lowest price/earnings "of the peer set provided
    below". So the document itself asserts two companies that must appear in our
    answer - an oracle nobody had to hand-write, which fails loudly if a row is
    dropped. It already caught a wrong peer count on a build card.

    Matched on the first TWO WORDS rather than the full name, because the
    documents contradict themselves: Karamtara's summary calls a peer `KP Green
    Energy Limited` while its own table calls the same company `KP Green
    Engineering Limited`. The real company is KP Green Engineering. An
    exact-match oracle would fail on a CORRECT parse, and a check that fails on
    correct output is a check somebody switches off.

    Returns ``(passed, detail)``: True / False when the document prints a
    summary, None when it prints none (not cross-checked).
    """
    whole = "\n".join(t or "" for _i, t in page_texts)
    named = _SUMMARY_LINE.findall(whole)
    wanted = []
    for candidate in named:
        trimmed = _first_two_words(_TRAILING_NUMBER.sub("", candidate))
        if trimmed:
            wanted.append(trimmed)

    if not wanted:
        # No summary in the document, so there is nothing to cross-check
        # against. `None` is the third state - NOT CROSS-CHECKED - and never a
        # pass: "we could not check" and "we checked and it was right" are
        # different facts, and collapsing them is how an unverified value
        # acquires a clean mark (#545 round 2). The caller keeps the list under
        # the check that did run (the rows parsed from the located section) and
        # records this state beside it. Measured 2026-09-26: 0 of 4 real
        # prospectuses print the summary (A-One Steels RHP + DRHP, German Green
        # Steel RHP, Green Asia Impex RHP).
        return None, "not_cross_checked: document prints no highest/lowest P/E summary naming a peer"

    have = set()
    for peer in peers:
        have.add(_first_two_words(peer.get("name")))

    missing = [w for w in wanted if w not in have]
    if missing:
        return False, "summary names %s, absent from the parsed peers" % ", ".join(missing)
    return True, "summary's highest/lowest companies are both in the parsed peer set"


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


def _looks_like_the_peer_table(table, issuer_name=None):
    """Pick the peer table out of a page that holds several.

    Never by index: it is table 1 of 2 on one issuer and 1 of 11 on another. A
    table qualifies when the row reader can actually get peers out of it, which
    is a stronger test than any header heuristic - it means the columns mapped
    AND a divider was found AND rows followed it.
    """
    try:
        parsed = parse_peer_table(table, issuer_name)
    except Exception:
        return None
    return parsed if parsed["peers"] else None


# Item 46 (OD-165): a footnote reference glued to a cell - "BSE Limited(1)",
# "54.28(2)", "45.00%(4)" (NSE RHP p138). It is never part of a name or figure;
# left on a figure the persister cannot parse it and stores null. Only a 1-2 digit
# bracket glued to a preceding character is a reference: a whole-cell "(4.20)" or
# "(2)" is a bracketed negative and is left alone.
_FOOTNOTE_REF = re.compile(r"(?<=[\w%.)])\(\d{1,2}\)$")
# A reference after a space ("Infosys Limited (1)") is stripped only from a NAME that has letters,
# so a numeric cell "(2)" or "12 (3)" stays as is.
_SPACED_FOOTNOTE_REF = re.compile(r"(?<=[A-Za-z.)])\s+\(\d{1,2}\)$")


def drop_footnote_refs(record):
    """`record` with each string cell's trailing glued footnote reference removed."""
    out = {}
    for key, value in record.items():
        if isinstance(value, str):
            value = _SPACED_FOOTNOTE_REF.sub("", _FOOTNOTE_REF.sub("", value.strip()))
        out[key] = value
    return out


def extract_peer_companies(page_texts, tables_for_page, issuer_name=None):
    """Return ``(result, reason)``.

    On success `result` is ``{"page": index, "issuer": record, "peers": [...],
    "columns": {...}}`` and `reason` is None. On a miss `result` is None and
    `reason` names WHICH miss it was.

    `tables_for_page(index)` returns that page's tables as lists of rows of
    cells. The caller owns the PDF and its memory discipline. `issuer_name` is
    the offer document's own company name, used only to recognise the issuer's
    row in a table printed with no divider (`peer_row_groups.py`).
    """
    page = find_peer_section_page(page_texts)
    if page is None:
        # Distinguish "no such table" from "the lookalike was there". A document
        # that prints only the KPI comparison is a different finding from one
        # that prints neither, and the second is the one worth chasing.
        kpi_found = False
        for _index, text in page_texts:
            body = kpi_comparison_section_body((text or "").split("\n"))
            if body is None:
                continue
            kpi_found = True
            # Item 46 round 3 (OD-158): with no peer section anywhere, the
            # document's only peer statement may sit under the KPI heading (S. K.
            # Offset RHP p119, "There are presently no listed Companies in India
            # that are engaged in a business that is directly comparable ...").
            # That sentence is the issuer STATING no listed peer; without it the
            # answer stays a miss (ONLY_KPI_TABLE / NOT_IN_DOCUMENT).
            # PR #1496 review: only a literal, un-walked-back sentence, and only
            # when no page of the document prints a peer-ratio table shape.
            if stated_no_listed_peer(body) and not _document_prints_peer_table(page_texts):
                return None, NO_LISTED_PEERS
        if kpi_found:
            return None, ONLY_KPI_TABLE
        return None, NOT_IN_DOCUMENT

    by_index = dict(page_texts)
    span = [p for p in range(page, page + _FOLLOW_PAGES + 1) if p in by_index]
    lines = []
    for p in span:
        lines.extend((by_index[p] or "").split("\n"))
    _heading, body = find_peer_table_section(lines)
    # The "no listed peers" statement is read only AFTER parsing, as the reason
    # for an empty result. A section can say "there are no listed companies
    # engaged exclusively in our business; however, the following listed
    # peers..." and then print them - checking the sentence first threw those
    # rows away (#545 round 2).
    states_no_peers = (stated_no_listed_peer(body)
                       and not _document_prints_peer_table(page_texts))

    any_table = False
    for p in span:
        try:
            tables = tables_for_page(p) or []
        except Exception as err:  # noqa: BLE001 - deliberately broad, see below
            # A peer table is ONE field among many in a prospectus. If table
            # extraction falls over - a malformed page, a memory refusal, a
            # pdfplumber edge - the document must still yield everything else it
            # has. So the failure is REPORTED with its cause rather than thrown,
            # and the cause is carried so the reason is auditable instead of just
            # "no peers" (signal-ownership R6).
            return None, "%s: %s" % (TABLE_EXTRACTION_FAILED, err)
        any_table = any_table or bool(tables)
        for table in tables:
            parsed = _looks_like_the_peer_table(table, issuer_name)
            if parsed is not None:
                return (
                    {
                        "page": p,
                        "issuer": parsed["issuer"] and drop_footnote_refs(parsed["issuer"]),
                        "peers": [drop_footnote_refs(peer) for peer in parsed["peers"]],
                        "columns": parsed["columns"],
                    },
                    None,
                )

    # No table gave rows: the body may be set as plain text with no rules
    # (A-One Steels RHP p221), where pdfplumber finds the header cells only.
    parsed = parse_peer_text_rows(body, issuer_name)
    if parsed["peers"]:
        return (
            {"page": page, "issuer": parsed["issuer"] and drop_footnote_refs(parsed["issuer"]),
             "peers": [drop_footnote_refs(peer) for peer in parsed["peers"]], "columns": {}},
            None,
        )

    if states_no_peers:
        return None, NO_LISTED_PEERS
    if not any_table:
        # The section's heading is in the text but no table was extracted from
        # its page(s), and its text holds no company rows either. Measured on
        # Glasswall: neither pdfplumber strategy detects its peer table, and the
        # rotated issuer needs a different path entirely.
        return None, NO_TABLE_ON_PAGE
    return None, NO_ROWS_PARSED
