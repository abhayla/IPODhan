"""Turn a located, column-mapped peer table into peer records.

Item 8a. The last parsing step: the section locator finds the table, the column
mapper says which column is which, and this reads the rows.

Three rules, each from a measured property of the four prospectuses rather than
from a guess about how such tables "usually" look:

* **The issuer's own row is not a peer.** Every issuer prints its own figures
  ABOVE a divider reading `Listed Peers` or `Peer Group:`, then its comparators
  below. Treating the issuer as its own comparator would put a company in its
  own peer set and skew every average computed from it.
* **One to eight peers.** Glasswall lists exactly ONE - which is why its P/E
  summary reads Highest 16.54 / Lowest 16.54 / Average 16.54. A parser requiring
  two or more rejects a valid table; one requiring ten silently drops six.
* **A pending-price placeholder is absent, not invalid.** The issuer's own P/E
  and closing price genuinely cannot exist until the Offer Price is fixed, and
  the document says so with `NA#`, `N.A.` or a filled circle. Treating that as a
  parse failure rejects a row that is exactly as complete as it can be.
"""

import re

from peer_row_groups import group_of, split_issuer_and_peers
from peer_table_columns import (
    NAME,
    detect_header_row_count,
    divider_listed_status,
    is_divider_row,
    is_placeholder,
    map_columns,
    reconstruct_headers,
)

# A parsed row must carry a name and at least this many real values, or it is a
# stray fragment rather than a company. PDF tables leave continuation lines and
# note text inside the row range, and those carry a name-ish cell with nothing
# after it.
_MIN_VALUES = 2


def _cell(row, index):
    if index is None or index >= len(row):
        return None
    return " ".join((row[index] or "").split()) or None


def _value(row, index):
    """A cell as a value: None when absent, missing, or a pending placeholder."""
    text = _cell(row, index)
    if text is None or is_placeholder(text):
        return None
    return text


def parse_peer_table(table, issuer_name=None):
    """Return ``{"issuer": record|None, "peers": [record, ...], "columns": {...}}``.

    Records are dicts keyed by canonical field name, with None for anything the
    document leaves pending. Values are returned as the STRINGS the document
    printed - converting them is the persister's job, and doing it here would
    bury a formatting decision inside a parser.
    """
    header_rows = detect_header_row_count(table)
    columns = map_columns(reconstruct_headers(table, header_rows), table[header_rows:])
    name_index = columns.get(NAME, 0)
    value_indexes = [i for f, i in columns.items() if f != NAME and i is not None]
    first_value = min(value_indexes) if value_indexes else None

    rows = []  # (record, group) - group None above every divider
    group = None
    any_divider = False

    for row in table[header_rows:]:
        if is_divider_row(row):
            # Everything after this line is a comparator. Before it, the issuer.
            group = group_of(divider_listed_status(row))
            any_divider = True
            continue

        name = _row_name(row, name_index, first_value)
        if not name:
            continue

        record = {field: _value(row, index) for field, index in columns.items()}
        record[NAME] = name

        real_values = sum(
            1 for field, value in record.items() if field != NAME and value is not None
        )
        if real_values < _MIN_VALUES:
            # A name-only row directly under a company row is the rest of that
            # company's name, wrapped into its own table row (Green Asia Impex
            # RHP p141: "Apex Frozen Foods" / "Limited"). Anything else is a
            # stray fragment or a note.
            if rows and real_values == 0 and _is_name_tail(name):
                rows[-1][0][NAME] = "%s %s" % (rows[-1][0][NAME], name)
            continue

        rows.append((record, group))

    issuer, peers = split_issuer_and_peers(rows, any_divider, issuer_name)
    return {"issuer": issuer, "peers": peers, "columns": columns}


_NAME_TAIL_MAX = 40
# A wrapped name's last line ends in the company's legal form. Requiring that
# keeps a note or a stray label from being glued onto the row above it.
_LEGAL_FORM_END = re.compile(r"\b(limited|ltd\.?|corporation|corp\.?|plc|inc\.?)\s*[*#]*$", re.I)


def _is_name_tail(text):
    return (
        len(text) <= _NAME_TAIL_MAX
        and not any(ch.isdigit() for ch in text)
        and bool(_LEGAL_FORM_END.search(text))
    )


def _row_name(row, name_index, first_value):
    """The row's company name.

    Normally the mapped name column. pdfplumber sometimes puts the header in one
    column and the names one column to the right (Green Asia Impex RHP p141: the
    header "Name of the Company" is column 0, every name is column 1), so an
    empty name cell falls back to the first cell holding letters that sits
    before the first value column.
    """
    name = _cell(row, name_index)
    if name:
        return name
    stop = first_value if first_value is not None else len(row)
    for index in range(0, min(stop, len(row))):
        text = _cell(row, index)
        if text and any(ch.isalpha() for ch in text) and not is_placeholder(text):
            return text
    return None
