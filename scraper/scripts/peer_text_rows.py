"""Read the listed-peer comparison from the TEXT layer when no table yields it.

#545. On A-One Steels' RHP (p221) pdfplumber finds only the header cells of the
peer table: the body is set with no rules, so every company row comes back as
plain text and the table path sees headers and nothing else. The text layer
still carries each row on one line, name first, figures after it:

    A-One Consolidate 10 4,20,205.44 18.47 18.47 119.93 15.43 [●]# [●]#
    Steels d
    India
    Limited*

A long name wraps DOWN onto the next short lines, and the basis column
("Consolidated" / "Standalone") wraps too, leaving a lone "d" behind.

What this reader returns is deliberately narrow: each company's NAME. The
figures are not assigned to columns here, because in text the columns are only
whitespace, and a figure put in the wrong column is worse than an absent one
(the persister writes a null, never a guess). The name is the identity the
peer_companies row needs; the table path still supplies figures wherever a
table exists.
"""

import re

from peer_row_groups import group_of, split_issuer_and_peers
from peer_table_columns import divider_listed_status, is_divider_row

_VALUE_TOKEN = re.compile(
    r"^(?:[(\-+]?[\d,]*\d(?:\.\d+)?%?\)?[*#]*|\[[●•.]?\][*#]*|n\.?a\.?[*#]*|-|nil)$", re.I
)
# The basis column, and the fragment it leaves when it wraps ("Consolidate" / "d").
_BASIS_WORD = re.compile(r"^(?:consolidated?|standalone)$", re.I)
_LONE_LETTER = re.compile(r"\s+[a-z]$")
_MIN_VALUES = 3
_TAIL_MAX = 40


def _row_split(line):
    """``(name, value_count)`` for a company row, or None for any other line."""
    tokens = line.split()
    for start in range(len(tokens)):
        if not _VALUE_TOKEN.match(tokens[start]):
            continue
        rest = tokens[start:]
        values = sum(1 for t in rest if _VALUE_TOKEN.match(t))
        # A row's figures run to the end of the line; a sentence with a number in
        # it does not.
        if values < _MIN_VALUES or values < len(rest) - 1:
            return None
        name_tokens = [t for t in tokens[:start] if not _BASIS_WORD.match(t)]
        name = " ".join(name_tokens)
        if not any(ch.isalpha() for ch in name):
            return None
        return name, values
    return None


def _is_tail(line):
    text = line.strip()
    return (
        bool(text)
        and len(text) <= _TAIL_MAX
        and not any(ch.isdigit() for ch in text)
        and not is_divider_row([text])
    )


def _clean(name):
    name = _LONE_LETTER.sub("", " ".join(name.split()))
    return name.rstrip("*# ").strip()


def parse_peer_text_rows(lines, issuer_name=None):
    """Return ``{"issuer": record|None, "peers": [record, ...]}`` from the text
    lines of a located peer section. Records carry only ``name``."""
    rows = []  # [name, group] - group None above every divider
    group = None
    any_divider = False
    extending = False
    for raw in lines:
        line = (raw or "").strip()
        if not line:
            continue
        if is_divider_row([line]):
            group = group_of(divider_listed_status([line]))
            any_divider = True
            extending = False
            continue
        split = _row_split(line)
        if split is not None:
            name = _LONE_LETTER.sub("", split[0])
            rows.append([name, group])
            extending = True
            continue
        if extending and _is_tail(line):
            tail = _LONE_LETTER.sub("", " " + line).strip()
            if tail:
                rows[-1][0] = "%s %s" % (rows[-1][0], tail)
            continue
        extending = False

    records = [({"name": _clean(name)}, grp) for name, grp in rows if _clean(name)]
    issuer, peers = split_issuer_and_peers(records, any_divider, issuer_name)
    return {"issuer": issuer, "peers": peers}
