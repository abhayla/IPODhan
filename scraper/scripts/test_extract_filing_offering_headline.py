"""W-147: the offering headline read off an RHP / PROSPECTUS / DRHP cover.

Every expected value below was read BY HAND off the cover of the document named
in the test, and is restated in the test so a future reader can re-check it
against the PDF without re-running the extractor.

The three BSE SME documents are real filings; their covers are reproduced here
as the text pdfplumber returns for them (the PDFs themselves are not committed).
The NSE Emerge case is a SYNTHETIC cover written to the SEBI ICDR wording — the
Qualiance fixtures in scraper/tests/fixtures/sme/ are interior pages (P&L, KPIs,
the anchor letter), not a cover, and no Emerge cover PDF was available.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_filing import Emitter, extract_offering_headline  # noqa: E402


def headline(text, segment="SME", doc_unit="lakhs"):
    emit = Emitter("test.pdf")
    extract_offering_headline([(0, text)], emit, segment, doc_unit)
    return emit.fields


def value(fields, name):
    return fields[name]["value"]


# --------------------------------------------------------------------------- #
# 1. AUTOFURNISH LIMITED — Prospectus dated May 14, 2026, BSE SME, FIXED PRICE
#
# Read off the cover:
#   face value          Rs 10
#   issue price         Rs 41            (single price — a fixed price issue)
#   offer shares        35,61,000        = 3,561,000
#   aggregate           Rs 1,460.01 Lakh
#   minimum lot         3,000 equity shares
#   offer for sale      NOT APPLICABLE (the entire issue is a fresh issue)
#   3,561,000 x 41 = Rs 146,001,000 = 1,460.01 lakh  -> the identity holds
# --------------------------------------------------------------------------- #
AUTOFURNISH_COVER = """PROSPECTUS
Dated: May 14, 2026
100% Fixed Price Issue
AUTOFURNISH LIMITED
DETAILS OF OFFER TO PUBLIC
FRESH ISSUE SIZE (Rs. In Lakh) OFFER FOR SALE SIZE (Rs. In Lakh) TOTAL OFFER SIZE (Rs. In Lakh)
Fresh Issue Upto 35,61,000 Equity Shares of NA Upto 35,61,000 Equity
DETAILS OF OFFER FOR SALE, SELLING SHAREHOLDERS AND THEIR WEIGHTED AVERAGE COST OF ACQUISITION
NOT APPLICABLE AS THE ENTIRE ISSUE CONSTITUTES FRESH ISSUE OF EQUITY SHARES
THE ISSUE
INITIAL PUBLIC OFFERING OF UP TO 35,61,000 EQUITY SHARES OF FACE VALUE RS. 10/- EACH ("EQUITY SHARES") OF AUTOFURNISH
LIMITED ("THE "COMPANY") FOR CASH AT A PRICE OF RS. 41/- PER EQUITY SHARE INCLUDING A SHARE PREMIUM OF RS. 31/- PER
EQUITY SHARE (THE "ISSUE PRICE") AGGREGATING TO RS. 1460.01 LAKHS ("THE ISSUE") OF WHICH UPTO 1,80,000 EQUITY SHARES
OF FACE VALUE OF RS. 10/- EACH FOR CASH AT A PRICE OF RS. 41/- PER EQUITY SHARE AGGREGATING TO RS. 73.80 LAKHS WILL
BE RESERVED FOR SUBSCRIPTION BY MARKET MAKER TO THE ISSUE (THE "MARKET MAKER RESERVATION PORTION").
THE FACE VALUE OF THE EQUITY SHARE IS RS. 10/- EACH AND THE ISSUE PRICE IS RS. 41/- EACH i.e.,4.1 TIMES OF THE FACE VALUE OF THE
EQUITY SHARES. THE MINIMUM LOT SIZE IS 3000 EQUITY SHARES
"""


def test_autofurnish_fixed_price_cover():
    f = headline(AUTOFURNISH_COVER)
    assert value(f, "headline_source") == "PROSPECTUS_COVER"
    assert value(f, "issue_price_type") == "FIXED_PRICE"
    assert value(f, "face_value") == 10.0
    # A fixed price issue is floor == cap. That is its true shape, not a
    # degenerate band; data-validation.ts exempts FIXED_PRICE for this reason.
    assert value(f, "price_band_floor") == 41.0
    assert value(f, "price_band_cap") == 41.0
    assert value(f, "lot_size") == 3000.0
    assert value(f, "shares_at_floor") == 3561000.0
    assert value(f, "shares_at_cap") == 3561000.0
    assert value(f, "total_offer_shares_at_cap") == 3561000.0
    # Amounts are emitted in the DOCUMENT unit (lakhs here) so the persister's
    # `toRupees(value, extraction.unit)` lands on Rs 146,001,000.
    assert value(f, "fresh_issue_amount") == pytest.approx(1460.01)
    assert value(f, "total_offer_amount_at_cap") == pytest.approx(1460.01)
    assert value(f, "ofs_amount") == 0.0
    assert value(f, "ofs_amount_at_cap") == 0.0
    assert value(f, "ofs_shares") == 0.0
    assert value(f, "issue_structure") == "FRESH_ONLY"


def test_autofurnish_amount_converted_into_the_document_unit():
    """The cover prints lakhs; a document whose stated unit is millions must get
    the SAME rupee amount, not the lakh figure multiplied by a million (W-109)."""
    f = headline(AUTOFURNISH_COVER, doc_unit="millions")
    assert value(f, "fresh_issue_amount") == pytest.approx(146.001)
    f = headline(AUTOFURNISH_COVER, doc_unit="crores")
    assert value(f, "fresh_issue_amount") == pytest.approx(14.6001)


def test_headline_amount_withheld_when_the_document_states_no_unit():
    f = headline(AUTOFURNISH_COVER, doc_unit=None)
    assert value(f, "fresh_issue_amount") is None
    assert f["fresh_issue_amount"]["check"]["detail"] == "unit_unknown"
    # The share count and the price do not depend on a unit and survive.
    assert value(f, "shares_at_cap") == 3561000.0
    assert value(f, "price_band_cap") == 41.0


def test_market_maker_reservation_is_not_read_as_the_issue_size():
    """The same sentence restates a 1,80,000-share / Rs 73.80 lakh slice as the
    market maker portion. Reading past "OF WHICH" would publish that as the
    offer."""
    f = headline(AUTOFURNISH_COVER)
    assert value(f, "fresh_issue_amount") != pytest.approx(73.80)
    assert value(f, "shares_at_cap") != 180000.0


# --------------------------------------------------------------------------- #
# 2. VAHH CHEMICALS LIMITED — Prospectus dated May 27, 2026, BSE SME, FIXED PRICE
#
# Read off the cover:
#   face value          Rs 10
#   issue price         Rs 60
#   offer shares        22,42,000        = 2,242,000
#   aggregate           Rs 1,345.20 Lakhs
#   offer for sale      "Not Applicable" (no "entire issue constitutes fresh
#                       issue" sentence — the nil is stated as a table cell)
#   minimum lot         not printed on the cover
#   2,242,000 x 60 = Rs 134,520,000 = 1,345.20 lakh  -> the identity holds
# --------------------------------------------------------------------------- #
VAHH_COVER = """PROSPECTUS
Dated: May 27, 2026
Fixed Price Issue
VAHH CHEMICALS LIMITED
DETAILS OF THE ISSUE
TYPE FRESH OFFER FOR SALE TOTAL ELIGIBILITY AND SHARE RESERVATION AMONGST
ISSUE ISSUE QIBS, NIIS AND RIIS
SIZE (in SIZE (in
lakhs) lakhs)
Fresh Issue 22,42,000 Not Applicable 22,42,000 The issue is being made in accordance with Regulation 229 (1)
DETAILS OF THE ISSUE FOR SALE
NAME OF THE TYPE NUMBER OF EQUITY WEIGHTED AVERAGE COST OF ACQUISITION PER EQUITY SHARE (IN )
SHAREHOLDER AMOUNT (IN lakhs)
Not Applicable
INITIAL PUBLIC ISSUE OF 22,42,000 EQUITY SHARES OF FACE VALUE OF 10/- EACH OF THE COMPANY FOR CASH AT A PRICE OF
60/- PER EQUITY SHARE (INCLUDING A SHARE PREMIUM OF 50/- PER EQUITY SHARE) AGGREGATING UPTO 1,345.20 LAKHS
("THE ISSUE"), OUT OF WHICH 1,14,000 EQUITY SHARES OF FACE VALUE OF 10/- EACH AGGREGATING TO 68.40 LAKHS WILL
BE RESERVED FOR SUBSCRIPTION BY THE MARKET MAKER TO THE ISSUE (THE "MARKET MAKER RESERVATION PORTION").
"""


def test_vahh_fixed_price_cover_with_a_nil_ofs_stated_as_not_applicable():
    f = headline(VAHH_COVER)
    assert value(f, "issue_price_type") == "FIXED_PRICE"
    assert value(f, "face_value") == 10.0
    assert value(f, "price_band_floor") == 60.0
    assert value(f, "price_band_cap") == 60.0
    assert value(f, "shares_at_cap") == 2242000.0
    assert value(f, "fresh_issue_amount") == pytest.approx(1345.20)
    assert value(f, "ofs_amount") == 0.0
    assert value(f, "issue_structure") == "FRESH_ONLY"
    # The cover does not print a lot size; nothing is invented for it.
    assert value(f, "lot_size") is None


# --------------------------------------------------------------------------- #
# 3. HORIZON RECLAIM (INDIA) LIMITED — RHP dated June 05, 2026, BSE SME,
#    100% BOOK BUILT. The price band and the bid lot are still "[●]".
#
# Read off the cover:
#   face value          Rs 10
#   offer shares        52,69,200        = 5,269,200
#   aggregate           Rs [●] Lakhs     (not yet determined)
#   offer for sale      Nil — "NOT APPLICABLE AS THE ENTIRE ISSUE CONSTITUTES
#                       FRESH ISSUE OF EQUITY SHARES"
# --------------------------------------------------------------------------- #
HORIZON_COVER = """RED HERRING PROSPECTUS
Dated: June 05, 2026
100% Book Built Issue
HORIZON RECLAIM (INDIA) LIMITED
DETAILS OF THE ISSUE
Upto 52,69,200 Equity Shares of face value of 10 each Nil
DETAILS OF OFFER FOR SALE, SELLING SHAREHOLDERS AND THEIR AVERAGE COST OF ACQUISITION - NOT APPLICABLE AS THE
ENTIRE ISSUE CONSTITUTES FRESH ISSUE OF EQUITY SHARES
INITIAL PUBLIC OFFER OF UP TO 52,69,200 EQUITY SHARES OF FACE VALUE 10 EACH (THE "EQUITY SHARES") OF HORIZON RECLAIM (INDIA) LIMITED
FOR CASH AT AN ISSUE PRICE OF [*] PER EQUITY SHARE (INCLUDING SECURITIES PREMIUM OF [*] PER EQUITY SHARE) ("ISSUE PRICE"), AGGREGATING UP TO [*] LAKHS
(THE "ISSUE") OF WHICH 2,64,000 EQUITY SHARES AGGREGATING TO [*] LAKHS WILL BE RESERVED FOR SUBSCRIPTION BY MARKET MAKER
THE PRICE BAND AND THE MINIMUM BID LOT WILL BE DECIDED BY OUR COMPANY IN CONSULTATION WITH THE BOOK RUNNING LEAD MANAGER
"""


def test_horizon_book_built_rhp_with_an_undetermined_price():
    f = headline(HORIZON_COVER)
    assert value(f, "issue_price_type") == "BOOK_BUILDING"
    assert value(f, "face_value") == 10.0
    assert value(f, "shares_at_cap") == 5269200.0
    assert value(f, "total_offer_shares_at_cap") == 5269200.0
    assert value(f, "issue_structure") == "FRESH_ONLY"
    # The cover prints "[*]" for the price, the aggregate and the bid lot. None
    # of the three may be invented from the share count alone.
    assert value(f, "price_band_floor") is None
    assert value(f, "price_band_cap") is None
    assert value(f, "lot_size") is None
    assert value(f, "fresh_issue_amount") is None
    assert value(f, "total_offer_amount_at_cap") is None


# --------------------------------------------------------------------------- #
# 4. NSE EMERGE, book-built with a DETERMINED price band. SYNTHETIC — written to
#    the SEBI ICDR cover wording, with the face value (Rs 10) and price scale of
#    Qualiance International (whose anchor letter fixture prices the issue at
#    Rs 127); no Emerge cover PDF was available to read.
#    1,009,000 x 127 = Rs 128,143,000 = 1,281.43 lakh -> the identity holds.
# --------------------------------------------------------------------------- #
EMERGE_COVER = """RED HERRING PROSPECTUS
Dated: September 01, 2026
100% Book Built Issue
QUALIANCE INTERNATIONAL LIMITED
DETAILS OF OFFER FOR SALE, SELLING SHAREHOLDERS AND THEIR AVERAGE COST OF ACQUISITION - NOT APPLICABLE AS THE
ENTIRE ISSUE CONSTITUTES FRESH ISSUE OF EQUITY SHARES
INITIAL PUBLIC OFFER OF UP TO 10,09,000 EQUITY SHARES OF FACE VALUE OF 10 EACH OF QUALIANCE INTERNATIONAL LIMITED
FOR CASH AT A PRICE OF 127 PER EQUITY SHARE AGGREGATING UP TO 1,281.43 LAKHS (THE "ISSUE").
PRICE BAND: 120 TO 127 PER EQUITY SHARE. THE MINIMUM BID LOT IS 1000 EQUITY SHARES.
"""


def test_nse_emerge_book_built_cover_with_a_determined_band():
    f = headline(EMERGE_COVER)
    assert value(f, "issue_price_type") == "BOOK_BUILDING"
    assert value(f, "face_value") == 10.0
    # A printed band wins over the single "at a price of" figure.
    assert value(f, "price_band_floor") == 120.0
    assert value(f, "price_band_cap") == 127.0
    assert value(f, "lot_size") == 1000.0
    assert value(f, "total_offer_shares_at_cap") == 1009000.0


# --------------------------------------------------------------------------- #
# 5. Mainboard RHP cover — the same reader, no SME-only assumption. Values are
#    in crore, and the segment bound is the mainboard one.
#    30,000,000 x 500 = Rs 15,000,000,000 = 1,500 crore -> the identity holds.
# --------------------------------------------------------------------------- #
MAINBOARD_COVER = """RED HERRING PROSPECTUS
Dated: August 25, 2026
Book Built Offer
EXAMPLE INDUSTRIES LIMITED
DETAILS OF OFFER FOR SALE, SELLING SHAREHOLDERS AND THEIR AVERAGE COST OF ACQUISITION - NOT APPLICABLE AS THE
ENTIRE OFFER CONSTITUTES FRESH ISSUE OF EQUITY SHARES
INITIAL PUBLIC OFFER OF UP TO 3,00,00,000 EQUITY SHARES OF FACE VALUE OF 5 EACH OF EXAMPLE INDUSTRIES LIMITED
FOR CASH AT A PRICE OF 500 PER EQUITY SHARE AGGREGATING UP TO 1,500.00 CRORES (THE "OFFER").
"""


def test_mainboard_cover_uses_the_mainboard_plausibility_band():
    f = headline(MAINBOARD_COVER, segment="MAINBOARD", doc_unit="crores")
    assert value(f, "face_value") == 5.0
    assert value(f, "price_band_cap") == 500.0
    assert value(f, "fresh_issue_amount") == pytest.approx(1500.0)
    assert "within the MAINBOARD range" in f["fresh_issue_amount"]["check"]["detail"]


def test_out_of_band_issue_size_is_flagged_not_rejected():
    """Section 3: the plausibility bounds WARN. Only the arithmetic identity
    rejects, so an out-of-band-but-arithmetically-sound offer is still
    published, with the range in the detail line. A Rs 1,500 crore offer is far
    outside the SME band (1-500 crore)."""
    f = headline(MAINBOARD_COVER, segment="SME", doc_unit="crores")
    assert value(f, "fresh_issue_amount") == pytest.approx(1500.0)
    assert "WARN" in f["fresh_issue_amount"]["check"]["detail"]
    assert "outside the SME range" in f["fresh_issue_amount"]["check"]["detail"]


# --------------------------------------------------------------------------- #
# 6. The one rejection: shares x price does not reproduce the printed aggregate.
#    35,61,000 x 41 = Rs 1,460.01 lakh, but this cover prints 14,600.10 lakh —
#    a leading digit gained, exactly the OCR class the ad path guards against.
# --------------------------------------------------------------------------- #
ARITHMETIC_MISMATCH_COVER = AUTOFURNISH_COVER.replace(
    "AGGREGATING TO RS. 1460.01 LAKHS", "AGGREGATING TO RS. 14600.10 LAKHS"
)


def test_arithmetic_mismatch_rejects_shares_price_and_amount_together():
    f = headline(ARITHMETIC_MISMATCH_COVER)
    # All three figures come from the same sentence; one of them is misread and
    # there is no way to tell which, so none is published.
    assert value(f, "fresh_issue_amount") is None
    assert value(f, "total_offer_amount_at_cap") is None
    assert value(f, "price_band_floor") is None
    assert value(f, "price_band_cap") is None
    assert value(f, "shares_at_floor") is None
    assert value(f, "shares_at_cap") is None
    assert value(f, "total_offer_shares_at_cap") is None
    # Face value and lot size are printed independently and are unaffected.
    assert value(f, "face_value") == 10.0
    assert value(f, "lot_size") == 3000.0


def test_arithmetic_within_five_percent_is_accepted():
    """Rounding in the printed aggregate must not reject a correct read: 4% off
    stays, 6% off goes."""
    ok = headline(
        AUTOFURNISH_COVER.replace("RS. 1460.01 LAKHS", "RS. 1500.00 LAKHS")
    )  # +2.7%
    assert value(ok, "fresh_issue_amount") == pytest.approx(1500.0)
    bad = headline(
        AUTOFURNISH_COVER.replace("RS. 1460.01 LAKHS", "RS. 1560.00 LAKHS")
    )  # +6.8%
    assert value(bad, "fresh_issue_amount") is None


def test_cover_with_no_offer_sentence_nulls_every_headline_field():
    f = headline("PROSPECTUS\nDated: May 14, 2026\nSOME COMPANY LIMITED\n")
    for name in ("price_band_floor", "price_band_cap", "face_value", "lot_size",
                 "fresh_issue_amount", "total_offer_amount_at_cap", "shares_at_cap",
                 "issue_structure"):
        assert value(f, name) is None, name
    # The marker is still emitted so the persister can rank the (empty) read.
    assert value(f, "headline_source") == "PROSPECTUS_COVER"
