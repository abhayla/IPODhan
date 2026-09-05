"""W-138 — a NUL byte (\\x00) anywhere in extracted text breaks Postgres, not
just display. Postgres refuses a NUL byte in text/jsonb outright (22P05
"unsupported Unicode escape sequence"), so any of the three PDF-extraction
CLIs (extract_filing.py, extract_financials_pdf.py, anchor_report_text.py)
can hand the Node side a JSON payload that fails EVERY future persist
attempt for that document, the moment pdfplumber decodes a misencoded font
glyph (the rupee sign, in the PRASOLCHEM case) as NUL instead of a printable
character.

One shared helper, applied once at each script's JSON emission point, so no
script carries its own copy that can drift from the others.
"""


def strip_nul_bytes(value):
    """Recursively strip any '\\x00' from strings inside `value` (dict / list /
    str / anything else). Leaves non-string values and already-clean strings
    untouched. Call this on the whole object right before `json.dumps`."""
    if isinstance(value, str):
        return value.replace("\x00", "") if "\x00" in value else value
    if isinstance(value, dict):
        return {k: strip_nul_bytes(v) for k, v in value.items()}
    if isinstance(value, list):
        return [strip_nul_bytes(v) for v in value]
    return value
