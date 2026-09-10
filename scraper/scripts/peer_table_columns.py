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

_DIVIDER = re.compile(r"^\s*(listed\s+peers?|peer\s+group\s*:?)\s*$", re.I)

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
    """A data row carries several numbers. A header row does not.

    Two or more numeric cells is the threshold: one stray figure in a header
    (a year, a face value printed in the header itself) must not end the header
    block early, and no real peer row has fewer than two numbers.
    """
    numeric = sum(1 for c in row if _NUMERIC.match(" ".join((c or "").split())))
    return numeric >= 2


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


def map_columns(headers):
    """Return ``{canonical_field: column_index}``.

    Columns whose reconstructed header is empty are dropped, because the
    extractor emits filler columns from whitespace gutters and the reported
    column count is not the real one. A field already claimed by an earlier
    column is not overwritten: the first real match wins, so a stray later
    mention cannot steal a mapping.
    """
    mapping = {}
    last_metric = None
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

        if matched is not None and matched not in mapping:
            mapping[matched] = index
            if matched in (EPS_BASIC, EPS_COMBINED, EPS_DILUTED, PE, PE_BASIC, PE_DILUTED):
                last_metric = matched

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
