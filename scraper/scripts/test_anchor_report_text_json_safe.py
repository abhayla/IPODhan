"""W-138 — anchor_report_text.py's `main()` prints `{"pages": [...]}` built
from pdfplumber-derived text (`page_text`). The same misencoded-font-glyph
class that broke PRASOLCHEM's price-band ad (a rupee sign decoded as a literal
NUL byte, which Postgres refuses outright in text/jsonb — 22P05) can land in
any page's text here too, so the emission must route through the shared
`json_safe.strip_nul_bytes` backstop before printing.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from anchor_report_text import strip_nul_bytes  # noqa: E402

HERE = os.path.dirname(__file__)


def test_strip_nul_bytes_removes_nul_from_page_text():
    misencoded_page = "Bid Amount is up to \x000.50 million)"
    payload = {"pages": [misencoded_page, "a clean page with no issue"]}
    cleaned = strip_nul_bytes(payload)
    assert "\x00" not in cleaned["pages"][0]
    assert cleaned["pages"][0] == "Bid Amount is up to 0.50 million)"
    assert cleaned["pages"][1] == "a clean page with no issue"


def test_strip_nul_bytes_is_wired_at_the_success_emission_point():
    """Guards against the wrapper being un-wired by a future edit."""
    src = open(os.path.join(HERE, "anchor_report_text.py"), encoding="utf-8").read()
    assert 'print(json.dumps(strip_nul_bytes({"pages": pages})))' in src
