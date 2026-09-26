"""Which parsed peer-table row is the issuer, and which group each peer is in.

#545 round 2. Shared by the table reader (`peer_table_rows.py`) and the text
reader (`peer_text_rows.py`) so the two paths cannot disagree about it.

* With a divider row, the issuer is the row printed above it and every row
  below it is a comparator whose listed status is the divider's own
  (`divider_listed_status`).
* With NO divider (A-One Steels DRHP p150), the issuer row is recognised by
  NAME against the offer document's own company name, never by position alone:
  a table whose first row is a peer would otherwise lose that peer and keep the
  issuer as its own comparator. When no company name is known, or no row
  carries it, the fallback refuses and the caller reports no rows parsed.
"""

import re

_SUFFIX = re.compile(r"\b(?:limited|ltd|private|pvt|the)\b")


def _norm(name):
    letters = "".join(c if c.isalpha() else " " for c in (name or "").lower())
    return " ".join(_SUFFIX.sub(" ", letters).split())


def is_issuer_name(row_name, issuer_name):
    """True when a row's company name is the issuer's (suffixes and punctuation
    ignored, a wrapped or truncated name accepted as a prefix of at least two
    words)."""
    a, b = _norm(row_name), _norm(issuer_name)
    if not a or not b:
        return False
    if a == b:
        return True
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return len(short.split()) >= 2 and (long_ + " ").startswith(short + " ")


def split_issuer_and_peers(rows, any_divider, issuer_name=None):
    """``(issuer, peers)`` from ``[(record, group), ...]``.

    `group` is None for a row above every divider, else the listed status of
    the divider the row sits under (True / False / None-for-unknown is carried
    as the string "unknown" so it differs from "above the divider").
    Each peer record gets ``is_listed`` (True / False / None).
    """
    issuer = None
    peers = []
    if any_divider:
        for record, group in rows:
            if group is not None:
                record["is_listed"] = None if group == "unknown" else group
                peers.append(record)
            elif issuer is None:
                issuer = record
        return issuer, peers

    if len(rows) < 2 or not issuer_name:
        return None, []
    at = next((i for i, (record, _g) in enumerate(rows) if is_issuer_name(record.get("name"), issuer_name)), None)
    if at is None:
        return None, []
    issuer = rows[at][0]
    for i, (record, _g) in enumerate(rows):
        if i != at:
            # No divider: the section is the ICDR "listed industry peers" comparison.
            record["is_listed"] = True
            peers.append(record)
    return issuer, peers


def group_of(divider_status):
    """The `group` value for rows under a divider with this listed status."""
    return "unknown" if divider_status is None else divider_status
