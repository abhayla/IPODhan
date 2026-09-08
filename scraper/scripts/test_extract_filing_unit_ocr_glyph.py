r"""T-511 (#403) — every staging cycle, the W-45 cross-document agreement gate
refused to compare SteamHouse India Ltd.'s PRICE_BAND_AD against its RHP with
"PRICE_BAND_AD has no parseable unit". The refusal was the SAFE outcome (no
wrong value was written) but re-fired every cycle and burned extraction
budget.

RCA: the OCR route (D6/W-57) reads a scanned ₹ glyph as an unrelated Unicode
character rather than a fixed handful of ASCII lookalikes (the text-layer
misencodings `_normalize_rupee_glyph`/W-92/W-138 already repair). Fetched
straight from the real SteamHouse price-band ad
(https://listing.bseindia.com/Download//PreAnchor/PriceBandAD_20260907153412.pdf,
OCR'd locally with the pinned rapidocr-onnxruntime==1.2.3 route), the phrase
came back as "(in 天 million)" and "in 使 million)" — a different CJK
ideograph standing in for ₹ each time. That stray character sits BETWEEN "in"
and the unit word, so `UNIT_RX`'s `in\s+(million|...)` never matched even
though the unit phrase was printed and otherwise OCR'd correctly.

Class: every price-band advertisement (and RHP/DRHP/PROSPECTUS, any segment,
prod + staging, existing and future filings) whose OCR'd or text-layer unit
line carries (a) a single non-letter noise token between "in" and the unit
word, or (b) the "lac"/"lacs" spelling of lakh — never a genuinely unit-less
line, which must keep returning None.

Run:  cd scraper && python -m pytest scripts/test_extract_filing_unit_ocr_glyph.py -q
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_filing import _find_unit, UNIT_RX  # noqa: E402


# The exact line recovered by OCR from the real SteamHouse price-band ad
# (page 3 of the PDF at the URL above), with the misread rupee glyph exactly
# as RapidOCR emitted it.
REAL_STEAMHOUSE_LINE = (
    "The table below sets forth the total amount ofour related party "
    "transactions in the ordinary course of business for the years "
    "indicated: (in 天 million)"
)

# A second real line from the same document (page 3, the pre-IPO placement
# table), where RapidOCR misread the same ₹ glyph as a DIFFERENT ideograph
# (专, not 天) — confirming the fix must bridge any non-letter noise token,
# not one hardcoded lookalike character.
REAL_STEAMHOUSE_LINE_2 = (
    "Percentage of pre-Offer share Number of Equity Face Value per Equity "
    "Issue price Gin 司 Amount in 专 million)"
)


def test_find_unit_recovers_the_real_steamhouse_ocr_line():
    unit, page = _find_unit([(2, REAL_STEAMHOUSE_LINE)])
    assert unit == "millions"
    assert page == 2


def test_find_unit_does_not_false_positive_on_the_ordinary_course_prose():
    # The same real line has an EARLIER "in" ("in the ordinary course of
    # business") that must not be mistaken for a unit statement — "the" is
    # ASCII letters, not a noise token, and is not a unit word either.
    unit, _page = _find_unit([(0, "stated in the ordinary course of business only")])
    assert unit is None


def test_find_unit_handles_a_different_glyph_before_the_unit_word():
    unit, _page = _find_unit([(5, REAL_STEAMHOUSE_LINE_2)])
    assert unit == "millions"


def test_find_unit_recognises_lac_and_lacs_spelling():
    # "Lac"/"Lacs" is the older common spelling of lakh in BSE-era filings;
    # named explicitly in the class this fix covers.
    assert _find_unit([(0, "(Rs. in Lacs)")]) == ("lakhs", 0)
    assert _find_unit([(0, "Amount in Lac")]) == ("lakhs", 0)


def test_find_unit_still_recognises_the_plain_forms_unchanged():
    assert _find_unit([(0, "(₹ in Lakhs)")]) == ("lakhs", 0)
    assert _find_unit([(0, "Rs. in Crores")]) == ("crores", 0)
    assert _find_unit([(0, "figures in Million")]) == ("millions", 0)


def test_find_unit_still_returns_none_when_genuinely_unstated():
    # A single stray glyph is bridged; two words of real prose between "in"
    # and a number that merely LOOKS like it could be a unit must still not
    # be treated as a unit statement — no guessing.
    unit, page = _find_unit([(0, "the figures reported in the annexed statement are unaudited")])
    assert unit is None
    assert page is None


def test_unit_rx_noise_token_is_at_most_one_word_of_symbols():
    # A run of TWO noise words must not bridge "in" to a unit word that is
    # not actually adjacent to it in the source text.
    assert UNIT_RX.search("stated in 天 使 million") is None
