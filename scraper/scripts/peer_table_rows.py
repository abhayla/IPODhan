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

from peer_table_columns import (
    NAME,
    detect_header_row_count,
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


def parse_peer_table(table):
    """Return ``{"issuer": record|None, "peers": [record, ...], "columns": {...}}``.

    Records are dicts keyed by canonical field name, with None for anything the
    document leaves pending. Values are returned as the STRINGS the document
    printed - converting them is the persister's job, and doing it here would
    bury a formatting decision inside a parser.
    """
    header_rows = detect_header_row_count(table)
    columns = map_columns(reconstruct_headers(table, header_rows))
    name_index = columns.get(NAME, 0)

    issuer = None
    peers = []
    seen_divider = False

    for row in table[header_rows:]:
        if is_divider_row(row):
            # Everything after this line is a comparator. Before it, the issuer.
            seen_divider = True
            continue

        name = _cell(row, name_index)
        if not name:
            continue

        record = {field: _value(row, index) for field, index in columns.items()}
        record[NAME] = name

        real_values = sum(
            1 for field, value in record.items() if field != NAME and value is not None
        )
        if real_values < _MIN_VALUES:
            # A continuation fragment or a note, not a company row.
            continue

        if seen_divider:
            peers.append(record)
        elif issuer is None:
            issuer = record

    return {"issuer": issuer, "peers": peers, "columns": columns}
