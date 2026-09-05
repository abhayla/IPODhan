"""W-138 — a misencoded rupee glyph coming through as a literal NUL byte broke
every `bid_windows` persist for PRASOLCHEM's price-band ad (Postgres 22P05
"unsupported Unicode escape sequence": a NUL byte cannot be stored in
text/jsonb at all). `_normalize_rupee_glyph` already repaired a backtick and a
`?` misencoding (W-92); this adds the NUL-byte variant, plus a whole-output
backstop (`_strip_nul_bytes`) that catches ANY field carrying a stray NUL, not
just `bid_windows`.

Run:  cd scraper && python -m pytest scripts/test_extract_filing_rupee_glyph.py -q
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_filing import _normalize_rupee_glyph, _strip_nul_bytes, bid_windows  # noqa: E402


def test_normalize_rupee_glyph_repairs_nul_byte_before_digit():
    line = "banking and Syndicate UPI ASBA applications where Bid Amount is up to \x000.50 million)"
    repaired = _normalize_rupee_glyph(line)
    assert "\x00" not in repaired
    assert "Bid Amount is up to Rs 0.50 million)" in repaired


def test_normalize_rupee_glyph_still_repairs_backtick_and_question_mark():
    # W-92's original two variants must keep working — this is an ADDITION,
    # not a replacement.
    assert "Rs 0.50" in _normalize_rupee_glyph("`0.50 million")
    assert "Rs 0.50" in _normalize_rupee_glyph("?0.50 million")


def test_normalize_rupee_glyph_leaves_unrelated_nul_untouched():
    # Only a NUL directly before a digit is a rupee-glyph misread; a NUL
    # anywhere else is not this repair's job (the whole-output backstop
    # below still removes it before the JSON is emitted).
    line = "unrelated\x00text with no digit adjacent"
    assert _normalize_rupee_glyph(line) == line


def test_bid_windows_reproduces_the_real_prasolchem_row_without_nul():
    heading = "Submission of Bids (other than Bids from Anchor Investors)"
    lines = [
        heading,
        "Submission and revision in Bids Only between 10.00 a.m. and 5.00 p.m. IST",
        "banking and Syndicate UPI ASBA applications where Bid Amount is up to "
        "\x000.50 million) Only between 10.00 a.m. and up to 4.00 p.m. IST",
    ]
    rows, anchor = bid_windows(lines)
    assert anchor is not None
    joined = " ".join(r["activity"] for r in rows)
    assert "\x00" not in joined
    assert any("Rs 0.50 million" in r["activity"] for r in rows)


def test_strip_nul_bytes_removes_nul_from_nested_structure():
    tree = {
        "fields": {
            "bid_windows": {
                "value": [{"activity": "up to \x000.50 million)", "window": "10am"}],
            },
            "clean_field": {"value": "no nul here"},
            "null_field": {"value": None},
        }
    }
    cleaned = _strip_nul_bytes(tree)
    assert "\x00" not in cleaned["fields"]["bid_windows"]["value"][0]["activity"]
    assert cleaned["fields"]["clean_field"]["value"] == "no nul here"
    assert cleaned["fields"]["null_field"]["value"] is None


def test_strip_nul_bytes_is_a_noop_on_clean_input():
    tree = {"a": [1, 2, "text", None], "b": {"c": "ok"}}
    assert _strip_nul_bytes(tree) == tree
