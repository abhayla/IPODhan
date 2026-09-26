"""Map a peer table's columns by HEADER NAME, never by position.

Item 8a. This is the piece every earlier slice was measuring for, and the rule it
enforces came from the data rather than from taste:

**Column order is not stable across issuers.** Revenue from operations is the
5th column in Karamtara and the 2nd in Kanohar. A parser reading a fixed
ten-column row by index takes Kanohar's revenue as a face value. It does not
crash and it does not warn — it stores a wrong number and reports success.

**Column SET is not stable either.** Six are universal across the four issuers
measured (name, face value, revenue from operations, NAV, P/E, RoNW). Everything
else varies: market capitalisation appears on one issuer, total income on
another, P/B and EV/EBITDA on a third, and one issuer merges EPS basic and
diluted into a single column while another splits P/E into two.

**And the reported column count is not the real one.** PRASOLCHEM reports 20
columns of which about half are empty filler produced by whitespace gutters.
A real column is one with a non-empty reconstructed header.

Headers span several rows, aligned by column index — `Face` / `Value` / `(Rs` /
`Per` / `Share` — so a header is rebuilt by joining DOWN its own column, not
across a row.
"""

import re

# Canonical field names. Deliberately the same vocabulary the peer_companies
# table already uses, so the mapper's output needs no second translation.
NAME = "name"
FACE_VALUE = "face_value"
CLOSING_PRICE = "closing_price"
MARKET_CAP = "market_cap"
REVENUE_FROM_OPERATIONS = "revenue_from_operations"
TOTAL_INCOME = "total_income"
EPS_BASIC = "eps_basic"
EPS_DILUTED = "eps_diluted"
EPS_COMBINED = "eps_basic_and_diluted"
NAV = "nav"
PE = "pe"
PE_BASIC = "pe_basic"
PE_DILUTED = "pe_diluted"
PB = "pb"
RONW_PCT = "ronw_pct"
EV_EBITDA = "ev_ebitda"
PROFIT_FOR_YEAR = "profit_for_year"

# Order matters: the FIRST pattern that matches a header wins, so the more
# specific ones come first. `EPS (Basic)` must not be taken by the looser EPS
# rule, and `P/E (Diluted)` must not be taken by the bare `P/E` rule.
_PATTERNS = [
    (EPS_COMBINED, re.compile(r"\bEPS\b.*basic\s+and\s+diluted|basic\s+and\s+diluted.*\bEPS\b", re.I)),
    (EPS_BASIC, re.compile(r"\bEPS\b.*\bbasic\b|\bbasic\b.*\bEPS\b", re.I)),
    (EPS_DILUTED, re.compile(r"\bEPS\b.*\bdilut", re.I)),
    (PE_DILUTED, re.compile(r"P\s*/\s*E.*dilut", re.I)),
    (PE_BASIC, re.compile(r"P\s*/\s*E.*basic", re.I)),
    (PB, re.compile(r"P\s*/\s*B", re.I)),
    (PE, re.compile(r"P\s*/\s*E", re.I)),
    (EV_EBITDA, re.compile(r"\bEV\b\s*/|EBITDA", re.I)),
    # `Ro\s*N\s*W`, not `RoNW`: joining down a column can split the word itself.
    # Karamtara's RoNW header arrives as `RON` in one header row and `W` in the
    # next, so it rebuilds as "RON W (%) for" and a tighter pattern misses a
    # column that is plainly there.
    (RONW_PCT, re.compile(r"Ro\s*N\s*W|return\s+on\s+net\s+worth", re.I)),
    (NAV, re.compile(r"\bNAV\b|net\s+asset\s+value", re.I)),
    (MARKET_CAP, re.compile(r"market\s+cap", re.I)),
    (CLOSING_PRICE, re.compile(r"closing\s+price|closing\s+market\s+price", re.I)),
    (TOTAL_INCOME, re.compile(r"total\s+income", re.I)),
    (REVENUE_FROM_OPERATIONS, re.compile(r"revenue\s+from\s+operations", re.I)),
    (PROFIT_FOR_YEAR, re.compile(r"profit\s+for\s+the\s+(year|fiscal)", re.I)),
    (FACE_VALUE, re.compile(r"face\s+value", re.I)),
    (NAME, re.compile(r"name\s+of\s+(the\s+)?compan", re.I)),
]

# The row that separates the issuer's own figures from its comparators. Every
# issuer prints one; the issuer's row sits ABOVE it and is not a peer.
# A sub-header that names only which half of a merged metric it is.
_BASIC_OR_DILUTED = re.compile(r"^\s*\(?\s*(basic|dilut)", re.I)

# "Listed and unlisted Peers" is German Green Steel's RHP p181 (#545).
_DIVIDER = re.compile(
    r"^\s*(listed\s+(?:and\s+unlisted\s+)?peers?|(?:listed\s+)?peer\s+group\s*:?)\s*$", re.I
)

# Cells that are legitimately absent rather than missing: a value that waits on
# the final Offer Price. `[.]` is what the filled-circle placeholder degrades to
# in several text layers.
_PLACEHOLDERS = {"", "-", "na", "n.a.", "na#", "n/a", "[.]", "[]", "nil"}


def _parent_metric(text):
    """A merged header that names a metric but carries no values of its own.

    Returns the metric a child column should inherit, or None. A header naming
    EPS or P/E *and* saying which half it is (basic/diluted) is a real data
    column, not a parent - so it is deliberately excluded here and left to the
    ordinary patterns.
    """
    says_half = re.search(r"basic|dilut", text, re.I)
    if says_half:
        return None
    if re.search(r"\bEPS\b|earnings\s+per\s+share", text, re.I):
        return EPS_BASIC
    if re.search(r"P\s*/\s*E", text, re.I):
        return PE
    return None


def _child_follows(headers, index):
    """True when the next non-empty header is a bare Basic/Diluted sub-header.

    This is what tells a merged PARENT from an ordinary data column with the
    same text. Only the next non-empty header is considered: looking further
    would let an unrelated later column turn a real data column into a parent
    and drop it.
    """
    for later in headers[index + 1:]:
        text = " ".join((later or "").split())
        if not text:
            continue
        return bool(_BASIC_OR_DILUTED.search(text))
    return False


_NUMERIC = re.compile(r"^[\s(]*[-+]?[\d,]+(?:\.\d+)?\s*%?\s*[)]*$")


def _looks_like_data(row):
    """A data row carries a NAME and several numbers. A header row does not.

    Two thresholds, both learned from the fixtures rather than chosen:

    * At least THREE numeric cells. Two is not enough - Karamtara's header
      continuation rows read `Share / 28, 2026 / 2026 (in Rs / 2026`, and the
      two bare years matched a two-number rule, so the header block was cut two
      rows early. Every real peer row here carries seven or more numbers.
    * The first non-empty cell must not itself be numeric, and the row must have
      one. Header continuations begin with an EMPTY first column because the
      name column's header was finished on an earlier row; a peer row always
      opens with the company name.
    """
    cells = [" ".join((c or "").split()) for c in row]
    numeric = sum(1 for c in cells if _NUMERIC.match(c))
    if numeric < 3:
        return False
    first = next((c for c in cells if c), None)
    return first is not None and not _NUMERIC.match(first)


def detect_header_row_count(rows, limit=8):
    """How many rows at the top of the table are header.

    DERIVED, not guessed. A fixed count is what made PRASOLCHEM's first
    reconstructed header read "Name of Company Prasol Chemicals Limited" - the
    issuer's own DATA row glued onto the header, which is precisely how a mapper
    comes to point a field at the wrong column while looking like it worked.
    """
    for index, row in enumerate(rows[:limit]):
        if is_divider_row(row) or _looks_like_data(row):
            return index
    return min(len(rows), limit)


def reconstruct_headers(rows, header_row_count):
    """Join each column's header fragments DOWN its own column.

    A header spans several rows aligned by column index, so joining across a row
    produces one issuer's header glued to the next column's. Joining down the
    column is what makes `Face` / `Value` / `(Rs` / `Per` / `Share` come back as
    one header.
    """
    if not rows:
        return []
    width = max(len(r) for r in rows[:header_row_count]) if header_row_count else 0
    headers = []
    for col in range(width):
        parts = []
        for row in rows[:header_row_count]:
            if col < len(row):
                cell = (row[col] or "").strip()
                if cell:
                    parts.append(cell)
        headers.append(" ".join(parts))
    return headers


def _column_has_data(rows, index):
    """True when at least one row carries a non-empty cell at ``index``.

    Any non-empty text counts, including a pending placeholder (`NA#`, `[.]`) -
    the question here is only "does this column hold a printed value anywhere",
    not "does it hold a usable one". A column that is blank in every row is not
    a real data column, whatever the header above it says.
    """
    for row in rows:
        if index < len(row):
            cell = " ".join((row[index] or "").split())
            if cell:
                return True
    return False


def map_columns(headers, data_rows=None):
    """Return ``{canonical_field: column_index}``.

    Columns whose reconstructed header is empty are dropped, because the
    extractor emits filler columns from whitespace gutters and the reported
    column count is not the real one. A field already claimed by an earlier
    column is not overwritten: the first real match wins, so a stray later
    mention cannot steal a mapping.

    ``data_rows`` (the table's body rows, issuer + peers, after the header) is
    OPTIONAL but load-bearing for two-level headers: pdfplumber centres a child
    label (`Basic`, `Diluted`) inside its parent's sub-span while the numbers
    beneath it sit LEFT-ALIGNED, so the label's own column index is one column
    to the right of where its data actually is (#606). A label-only mapper has
    no way to see that; a mapped column that is empty in every body row is the
    tell.

    When ``data_rows`` is given, a child column found empty in every row is
    relocated to its nearest neighbour (checked left first, since that is the
    direction the observed shift runs, then right) - but ONLY when that
    neighbour is a pure continuation column: no header text of its own in any
    header row (or it IS the parent's own label column, which is not a
    "foreign" field - see below), and it sits inside the SAME parent's span as
    the child being relocated. A neighbour that carries its own header text -
    a real, separately labelled column such as `CMP (Rs)` that the field
    priority matrix does not track - is never taken, even when it holds data
    and is not itself mapped to any field (round-1 review, #606: an unmapped
    CMP column sitting next to a genuinely empty Diluted-EPS column was picked
    up as `eps_diluted`, silently putting share prices under an earnings
    field). A candidate that fails this check, or that carries no data either,
    leaves the field mapped to its original (empty) column - a genuinely
    absent value stays absent rather than being pointed at someone else's
    number. Restricted to the two-level Basic/Diluted children specifically:
    this is the one shape the shift is proven on; an ordinary single-level
    field found empty across every row is left alone, because "empty" for it
    is not evidence of a shift, just evidence the document has no value there.
    """
    mapping = {}
    # child_of[field] = span_start: the column index of the field's PARENT
    # header, recorded only for fields resolved via the bare Basic/Diluted
    # sub-header branch below. Only these are eligible for the empty-column
    # relocation - see the docstring. The span's END is deliberately not fixed
    # here: it is the next MAPPED field's column (computed after the whole
    # header row is read), never the next merely-labelled one - an unmapped
    # column such as `CMP (Rs)` does not end a parent's span, it just never
    # qualifies as a relocation target (the header-text check below is what
    # excludes it).
    child_of = {}
    last_metric = None
    last_metric_parent_start = None
    for index, header in enumerate(headers):
        text = " ".join((header or "").split())
        # Belt and braces, NOT the mechanism — mutation testing showed removing
        # this changes no result, because an empty header matches no pattern
        # anyway. Kept for clarity and to keep the filler columns out of the
        # parent/child logic, but the property "filler columns are dropped" is
        # carried by the patterns, not by this line. Said plainly so the next
        # reader does not mistake it for a guard that is holding something up.
        if not text:
            continue

        # A PARENT header names the metric but holds no values: PRASOLCHEM's
        # `EPS as on March 31, 2026` sits above two child columns reading
        # `Basic` and `Diluted`, and the numbers are in the children. Recognise
        # it so the children can inherit from it, but do NOT map it — mapping a
        # parent would point the field at a column of empty cells, which is a
        # confident wrong answer rather than a miss.
        # ...but ONLY when a child actually follows. A bare `P/E` is a parent on
        # PRASOLCHEM (children `Diluted` and `Basic`) and a real data column on
        # Karamtara (the next header is RoNW). Treating it as a parent
        # unconditionally silently DROPS Karamtara's P/E — which the fixtures
        # caught within a minute of the change. The lookahead is the whole
        # difference between the two issuers.
        parent = _parent_metric(text)
        if parent is not None and _child_follows(headers, index):
            last_metric = parent
            last_metric_parent_start = index
            continue

        matched = None
        for field, pattern in _PATTERNS:
            if field in mapping:
                continue
            if pattern.search(text):
                matched = field
                break

        if matched is None:
            # A SUB-HEADER carries no metric name of its own. These tables print
            # a merged parent (`EPS`, `P/E`) above two children that read only
            # `Basic` and `Diluted`, and joining down a column gives the child
            # without the parent. Karamtara's diluted-EPS column rebuilds as
            # "Dilute d for Fiscal" — plainly the diluted EPS, and invisible to
            # any pattern that requires the word EPS.
            #
            # So a bare Basic/Diluted inherits the nearest metric already mapped
            # to its LEFT, which is where its parent sits. Guessing further than
            # that would start inventing columns.
            child = _BASIC_OR_DILUTED.search(text)
            if child and last_metric in (EPS_BASIC, EPS_COMBINED, PE, PE_BASIC):
                is_diluted = bool(re.search(r"dilut", text, re.I))
                parent_is_pe = last_metric in (PE, PE_BASIC)
                if parent_is_pe:
                    matched = PE_DILUTED if is_diluted else PE_BASIC
                else:
                    matched = EPS_DILUTED if is_diluted else EPS_BASIC
                if matched not in mapping and last_metric_parent_start is not None:
                    child_of[matched] = last_metric_parent_start

        if matched is not None and matched not in mapping:
            mapping[matched] = index
            if matched in (EPS_BASIC, EPS_COMBINED, EPS_DILUTED, PE, PE_BASIC, PE_DILUTED):
                last_metric = matched

    if data_rows and child_of:
        claimed = set(mapping.values())
        # The span's end is the nearest already-MAPPED field to the right of
        # the parent - never an unmapped column, however clearly it is
        # labelled. That is precisely what keeps an unmapped `CMP (Rs)` column
        # from ending the span early on one side, and from being read as
        # "inside" it as a target on the other: the header-text check just
        # below is the thing that actually excludes it.
        for field, span_start in child_of.items():
            index = mapping.get(field)
            if index is None or _column_has_data(data_rows, index):
                continue
            span_end = min(
                (v for f, v in mapping.items() if v > span_start and f not in child_of),
                default=len(headers),
            )
            for candidate in (index - 1, index + 1):
                if candidate < span_start or candidate >= span_end:
                    continue
                if candidate in claimed:
                    continue
                # A pure continuation column carries no header text of its own;
                # the parent's own label column is the one exception, since it
                # is not a foreign field - it is this same child's own parent.
                # A candidate carrying ITS OWN header text - a real, separately
                # labelled column the matrix does not track (`CMP (Rs)`) - is
                # never taken, even though it lies inside the open span and
                # holds data (#606 round-1 review).
                is_continuation = not headers[candidate].strip()
                is_parent_column = candidate == span_start
                if not (is_continuation or is_parent_column):
                    continue
                if _column_has_data(data_rows, candidate):
                    mapping[field] = candidate
                    claimed.discard(index)
                    claimed.add(candidate)
                    break

    return mapping


def is_divider_row(row):
    """True for the `Listed peers` / `Peer Group:` separator."""
    joined = " ".join((c or "").strip() for c in row).strip()
    return bool(_DIVIDER.match(joined))


def is_placeholder(value):
    """True when a cell is legitimately absent rather than missing.

    The issuer's own P/E and closing price are genuinely unknown until the Offer
    Price is fixed, and the document says so with a placeholder. Treating that
    as a parse failure rejects a valid row.
    """
    return " ".join((value or "").split()).lower() in _PLACEHOLDERS
