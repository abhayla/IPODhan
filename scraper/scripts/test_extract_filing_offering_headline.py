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


def headline(text, segment="SME", doc_unit="lakhs", doc_type=None):
    emit = Emitter("test.pdf")
    extract_offering_headline([(0, text)], emit, segment, doc_unit, doc_type=doc_type)
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
# SYNTHETIC - not proven on a real cover (W-147 follow-up)
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
# SYNTHETIC - not proven on a real cover (W-147 follow-up)
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


# --------------------------------------------------------------------------- #
# W-147 round 2 — MAJOR-1: an UNCHECKED identity is not a passed identity.
# --------------------------------------------------------------------------- #
UNPRICED_BUT_AGGREGATED_COVER = AUTOFURNISH_COVER.replace(
    "AT A PRICE OF RS. 41/- PER EQUITY SHARE INCLUDING A SHARE PREMIUM OF RS. 31/- PER\n"
    "EQUITY SHARE (THE \"ISSUE PRICE\") AGGREGATING TO RS. 1460.01 LAKHS",
    "AT A PRICE OF RS. [*] PER EQUITY SHARE (THE \"ISSUE PRICE\") "
    "AGGREGATING TO RS. 1460.01 LAKHS",
)


def test_aggregate_withheld_when_the_identity_cannot_be_checked():
    """The cover prints an aggregate but no price, so shares x price == aggregate
    was never evaluated. Round 1 published the aggregate anyway, on no evidence
    at all."""
    assert "PRICE OF RS. [*]" in UNPRICED_BUT_AGGREGATED_COVER
    f = headline(UNPRICED_BUT_AGGREGATED_COVER)
    assert value(f, "price_band_cap") is None
    for name in ("fresh_issue_amount", "total_offer_amount_at_cap", "ofs_amount",
                 "ofs_amount_at_cap"):
        assert value(f, name) is None, name
        assert f[name]["check"]["detail"] == (
            "aggregate withheld: identity uncheckable (no price/shares)"
        ), name
    # The share count and the face value are printed independently and survive.
    assert value(f, "total_offer_shares_at_cap") == 3561000.0
    assert value(f, "face_value") == 10.0


def test_aggregate_withheld_when_the_share_count_is_unreadable():
    cover = AUTOFURNISH_COVER.replace(
        "INITIAL PUBLIC OFFERING OF UP TO 35,61,000 EQUITY SHARES",
        "INITIAL PUBLIC OFFERING OF UP TO [*] EQUITY SHARES",
    )
    f = headline(cover)
    # With no readable share count the offer sentence is not located at all, so
    # every headline field — the aggregate included — is withheld a step earlier.
    assert value(f, "fresh_issue_amount") is None
    assert value(f, "total_offer_amount_at_cap") is None
    assert value(f, "total_offer_shares_at_cap") is None
    assert f["fresh_issue_amount"]["check"]["detail"] == (
        "no 'issue/offer of N equity shares' sentence on the cover"
    )


# --------------------------------------------------------------------------- #
# W-147 round 2 — MINOR-1: the unit spellings a cover actually uses.
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "printed,doc_unit,expected",
    [
        ("RS. 1460.01 LAKHS", "lakhs", 1460.01),
        ("RS. 1460.01 LAKH", "lakhs", 1460.01),
        ("RS. 1460.01 LACS", "lakhs", 1460.01),
        ("RS. 1460.01 LAC", "lakhs", 1460.01),
        ("RS. 14.6001 CRORES", "lakhs", 1460.01),
        ("RS. 14.6001 CRORE", "lakhs", 1460.01),
        ("RS. 14.6001 CR", "lakhs", 1460.01),
        ("RS. 14.6001 CR.", "lakhs", 1460.01),
        ("RS. 146.001 MILLIONS", "lakhs", 1460.01),
        ("RS. 146.001 MILLION", "lakhs", 1460.01),
        ("RS. 146.001 MN", "lakhs", 1460.01),
        ("RS. 146.001 MN.", "lakhs", 1460.01),
    ],
)
def test_every_printed_unit_spelling_converts_the_same_way(printed, doc_unit, expected):
    cover = AUTOFURNISH_COVER.replace("RS. 1460.01 LAKHS", printed)
    f = headline(cover, doc_unit=doc_unit)
    assert value(f, "fresh_issue_amount") == pytest.approx(expected, rel=1e-6)


# --------------------------------------------------------------------------- #
# W-171 — a DRHP never emits a price band, even when its cover would otherwise
# match the same band regex an RHP/PROSPECTUS cover matches.
#
# SYNTHETIC cover (no real Kanohar DRHP fixture exists) built to the exact
# shapes COVER_BAND_RX / COVER_OFFER_SHARES_RX / COVER_AGGREGATING_RX already
# match in the tests above — the prod incident (2026-09-05) was a DRHP cover
# misread as price band 72/82 (the RHP's true band was 601-632); this fixture
# reproduces that SHAPE, not the real filing text.
# --------------------------------------------------------------------------- #
KANOHAR_SHAPE_COVER = """DRAFT RED HERRING PROSPECTUS
Dated: August 1, 2026
100% Book Built Issue
KANOHAR-SHAPE LIMITED (SYNTHETIC FIXTURE)
DETAILS OF THE ISSUE
PRICE BAND: 72 TO 82 PER EQUITY SHARE
INITIAL PUBLIC OFFERING OF UP TO 50,00,000 EQUITY SHARES OF FACE VALUE RS. 10/- EACH
("EQUITY SHARES") OF KANOHAR-SHAPE LIMITED ("THE COMPANY") FOR CASH AGGREGATING UP TO
RS. 4100.00 LAKHS ("THE ISSUE").
NOT APPLICABLE AS THE ENTIRE ISSUE CONSTITUTES FRESH ISSUE OF EQUITY SHARES
THE MINIMUM LOT SIZE IS 23 EQUITY SHARES
"""


def test_drhp_never_emits_a_price_band_even_when_the_cover_would_match():
    """A DRHP cover carrying the exact band-regex shape must still null every
    price-dependent headline field — the extractor must not even attempt the
    band/lot/price regex match. `face_value` is the exception: it is the par
    value fixed at registration, legitimately printed on a DRHP cover, and is
    still read."""
    f = headline(KANOHAR_SHAPE_COVER, doc_type="DRHP")
    for name in ("price_band_floor", "price_band_cap", "lot_size",
                 "shares_at_floor", "shares_at_cap", "ofs_shares",
                 "total_offer_shares_at_cap", "issue_structure",
                 "fresh_issue_amount", "ofs_amount", "ofs_amount_at_cap",
                 "total_offer_amount_at_cap"):
        assert value(f, name) is None, name
    assert value(f, "face_value") == 10.0
    # F-244: the process is not a price; "100% Book Built Issue" is read on a draft.
    assert value(f, "issue_price_type") == "BOOK_BUILDING"
    assert value(f, "headline_source") is None
    assert value(f, "headline_skipped_reason") is None
    assert f["headline_skipped_reason"]["check"]["detail"] == \
        "DRHP has no price band by law (face value kept)"
    assert f["price_band_floor"]["check"]["detail"] == \
        "DRHP has no price band by law (face value kept)"


def test_rhp_twin_of_the_same_cover_still_parses_the_band():
    """The exact same cover text, read as an RHP (doc_type not DRHP), parses
    the band normally — proving the DRHP guard is doc-type-specific, not a
    regression of RHP/PROSPECTUS behaviour."""
    f = headline(KANOHAR_SHAPE_COVER, doc_type="RHP")
    assert value(f, "price_band_floor") == 72.0
    assert value(f, "price_band_cap") == 82.0
    assert value(f, "lot_size") == 23.0
    assert value(f, "total_offer_shares_at_cap") == 5000000.0


def test_headline_helper_default_doc_type_is_unaffected():
    """Every pre-existing test above calls `headline()` with no doc_type
    (defaults to None) and must keep parsing exactly as before."""
    f = headline(AUTOFURNISH_COVER)
    assert value(f, "price_band_floor") == 41.0


# --------------------------------------------------------------------------- #
# F-244 — W-171 blanks only what depends on a price. Thirteen REAL draft covers
# (fixtures/drhp-covers/drhp-covers.json, page 1 as pdfplumber returns it; each entry
# names its source PDF). Values read by hand off each cover's offer table:
#   NSE       "Offer for Sale" | fresh "Not applicable" | up to 148,905,525 | Book Built
#   Hyundai   "Offer for Sale" | fresh "Not applicable" | up to 142,194,700 | Book Building
#   Studds    "Offer for Sale" | fresh "Not applicable" | up to 7,786,120   | Book Building
#   Nityas    "Fresh Issue" | up to 14,456,000 | OFS "Not applicable" | Book Built
#   RK        "Fresh Issue" | upto 42,67,200 | OFS "NIL" | Book Built (SME)
#   Modern    "Fresh Issue" | upto 41,00,000 | OFS "Not Applicable" | Book Building (SME)
#   Panchatv  "Fresh Issue" 16,75,200 | OFS "NIL" | Fixed Price (SME DRAFT PROSPECTUS)
#   Water     "Fresh Issue and Offer for Sale" | 9,505,000 + 2,376,000 = 11,881,000
#   Emcure    mixed | fresh [*] shares (Rs 8,000 million) | OFS 13,678,839 | total [*]
#   Ola       mixed | fresh "up to [*]" wrapped | OFS 95,191,195 | total [*]
#   Orient, Bajaj, Lenskart  mixed | every share count "[*]"
# Emcure and Bajaj print a WRAPPED HEADER line starting "FRESH ISSUE OFFER FOR ..." after
# the eligibility header; Lenskart wraps the type cell itself ("Fresh Issue" / "and Offer").
# --------------------------------------------------------------------------- #
import json  # noqa: E402
import re  # noqa: E402

_COVERS = {c["slug"]: c["text"] for c in json.load(open(
    os.path.join(os.path.dirname(os.path.abspath(__file__)),
                 "fixtures", "drhp-covers", "drhp-covers.json"), encoding="utf-8"))["covers"]}

_SHARE_FIELDS = ("shares_at_floor", "shares_at_cap", "ofs_shares", "total_offer_shares_at_cap")
_PRICED = ("price_band_floor", "price_band_cap", "lot_size", "fresh_issue_amount",
           "ofs_amount", "ofs_amount_at_cap", "total_offer_amount_at_cap")


def drhp(text):
    return headline(text, segment="MAINBOARD", doc_unit="millions", doc_type="DRHP")


def detail(fields, name):
    return fields[name]["check"]["detail"]


# slug -> (issue_price_type, issue_structure, fresh shares, OFS shares, total shares);
# None = must be null.
_DRHP_EXPECTED = {
    "national-stock-exchange-of-india-ltd":
        ("BOOK_BUILDING", "OFS_ONLY", 0.0, 148905525.0, 148905525.0),
    "hyundai-motor": ("BOOK_BUILDING", "OFS_ONLY", 0.0, 142194700.0, 142194700.0),
    "studds": ("BOOK_BUILDING", "OFS_ONLY", 0.0, 7786120.0, 7786120.0),
    "nityas-gems-and-jewellery-ltd":
        ("BOOK_BUILDING", "FRESH_ONLY", 14456000.0, 0.0, 14456000.0),
    "r-k-fashion-accessories-ltd":
        ("BOOK_BUILDING", "FRESH_ONLY", 4267200.0, 0.0, 4267200.0),
    "modern-diagnostic": ("BOOK_BUILDING", "FRESH_ONLY", 4100000.0, 0.0, 4100000.0),
    "panchatv-bharat-ltd":
        ("FIXED_PRICE", "FRESH_ONLY", 1675200.0, 0.0, 1675200.0),
    "water-infra": ("BOOK_BUILDING", "FRESH_AND_OFS", 9505000.0, 2376000.0, 11881000.0),
    "emcure-pharma": ("BOOK_BUILDING", "FRESH_AND_OFS", None, 13678839.0, None),
    "ola-electric": ("BOOK_BUILDING", "FRESH_AND_OFS", None, 95191195.0, None),
    "orient-cables-india-ltd": ("BOOK_BUILDING", "FRESH_AND_OFS", None, None, None),
    "bajaj-housing": ("BOOK_BUILDING", "FRESH_AND_OFS", None, None, None),
    "lenskart": ("BOOK_BUILDING", "FRESH_AND_OFS", None, None, None),
}


def test_every_fixture_cover_has_an_expectation():
    assert sorted(_COVERS) == sorted(_DRHP_EXPECTED)


@pytest.mark.parametrize("slug", sorted(_DRHP_EXPECTED))
def test_drhp_reads_price_independent_facts_off_real_covers(slug):
    ptype, structure, fresh, ofs, total = _DRHP_EXPECTED[slug]
    f = drhp(_COVERS[slug])
    assert value(f, "issue_price_type") == ptype
    assert value(f, "issue_structure") == structure
    assert value(f, "shares_at_floor") == fresh
    assert value(f, "shares_at_cap") == fresh
    assert value(f, "ofs_shares") == ofs
    assert value(f, "total_offer_shares_at_cap") == total
    for name in _SHARE_FIELDS:
        if value(f, name) is None:
            assert detail(f, name).startswith("DRHP: "), name
    # Everything priced stays null on a draft (W-171 unchanged).
    for name in _PRICED:
        assert value(f, name) is None, name


def test_mixed_offer_rupee_fresh_leg_gives_ofs_shares_only():
    """Emcure prints the fresh leg as "[*] Equity Shares aggregating up to Rs 8,000.00
    million": the OFS count is read, the fresh and total counts stay null with the reason,
    and the rupee figure is never read as shares."""
    f = drhp(_COVERS["emcure-pharma"])
    assert value(f, "ofs_shares") == 13678839.0
    assert detail(f, "shares_at_floor") == "DRHP: fresh leg not printed as a share count (a [*] placeholder)"
    assert detail(f, "total_offer_shares_at_cap") == \
        "DRHP: total leg not printed as a share count (a [*] placeholder)"
    assert 8000.0 not in [value(f, n) for n in _SHARE_FIELDS]


def test_mixed_offer_rupee_amount_in_a_share_cell_is_refused():
    """Water's fresh cell edited to a rupee figure: "up to 9,505.00 million" is money."""
    f = drhp(_COVERS["water-infra"].replace("Up to 9,505,000", "Up to 9,505.00 million", 1))
    assert value(f, "shares_at_floor") is None
    assert detail(f, "shares_at_floor") == "DRHP: fresh leg not printed as a share count (a rupee amount)"
    assert value(f, "ofs_shares") == 2376000.0


def test_mixed_offer_cells_that_do_not_add_up_fail_closed():
    f = drhp(_COVERS["water-infra"].replace("Up to 11,881,000", "Up to 11,882,000", 1))
    assert value(f, "issue_structure") == "FRESH_AND_OFS"
    for name in _SHARE_FIELDS:
        assert value(f, name) is None, name
        assert "!= total" in detail(f, name)


def test_mixed_offer_row_without_three_cells_fails_closed():
    f = drhp(_COVERS["water-infra"].replace("Up to 2,376,000 ", "", 1))
    for name in _SHARE_FIELDS:
        assert value(f, name) is None, name
        assert detail(f, name) == "DRHP: mixed offer table row has 2 'up to' cells, expected 3"


def test_mixed_offer_header_without_column_names_fails_closed():
    text = _COVERS["water-infra"].replace(
        "Type Fresh Offer Size Offer for Sale size Total Offer size",
        "Type Size A Size B Size C", 1)
    f = drhp(text)
    for name in _SHARE_FIELDS:
        assert value(f, name) is None, name
        assert "header does not name" in detail(f, name)


def test_wrapped_header_line_is_not_taken_as_the_type_cell():
    """Studds (OFS only) with a real-shaped wrapped header line after the eligibility header:
    "Fresh Issue size Offer for Sale size" carries no cell value, so it is not the data row
    and the offer stays OFS_ONLY (before: FRESH_ONLY with the OFS count as fresh shares)."""
    head = "Type Fresh Issue size Offer for Sale size Total Offer size Eligibility and share reservation"
    text = _COVERS["studds"].replace(head, head + "\nFresh Issue size Offer for Sale size", 1)
    assert text != _COVERS["studds"]
    f = drhp(text)
    assert value(f, "issue_structure") == "OFS_ONLY"
    assert value(f, "shares_at_floor") == 0.0
    assert value(f, "ofs_shares") == 7786120.0


def test_table_with_no_data_row_fails_closed():
    f = drhp(_COVERS["studds"].replace("Offer for Sale Not applicable", "Not applicable", 1))
    for name in _SHARE_FIELDS + ("issue_structure",):
        assert value(f, name) is None, name
        assert detail(f, name) == "DRHP: offer table has no data row with a type cell"


def test_no_offer_table_fails_closed():
    f = drhp(re.sub(r"DETAILS OF THE OFFER", "SUMMARY", _COVERS["studds"]))
    for name in _SHARE_FIELDS + ("issue_structure",):
        assert value(f, name) is None, name
        assert detail(f, name) == "DRHP: no 'details of the offer' table on the cover"


def test_count_after_type_cell_needs_a_by_number_of_shares_header():
    """Panchatv's "Fresh Issue 16,75,200 NIL" is read only because its header says
    "(By Number of Shares)"; the same row under a rupees-in-lakhs header stays null."""
    text = _COVERS["panchatv-bharat-ltd"].replace(
        "(By Number of Shares) (By Number of Shares)", "(₹ in Lakhs) (₹ in Lakhs)", 1)
    assert text != _COVERS["panchatv-bharat-ltd"]
    f = drhp(text)
    for name in _SHARE_FIELDS:
        assert value(f, name) is None, name
    assert detail(f, "ofs_shares") == "DRHP: no 'up to N' share count in the offer table"


def test_rupee_figure_after_type_cell_is_not_shares():
    f = drhp(_COVERS["panchatv-bharat-ltd"].replace("Fresh Issue 16,75,200 NIL",
                                                    "Fresh Issue 1,800.50 NIL", 1))
    assert value(f, "shares_at_floor") is None
    assert value(f, "total_offer_shares_at_cap") is None


def test_nil_leg_must_be_on_the_data_row():
    """Nityas with its row's "Not applicable" cell removed and a NIL elsewhere in the table
    region: a NIL that is not the other leg's cell does not make the offer fresh-only."""
    text = _COVERS["nityas-gems-and-jewellery-ltd"].replace(
        "Up to 14,456,000 Not applicable Up to 14,456,000",
        "Up to 14,456,000 Up to 14,456,000", 1).replace(
        "Eligibility for the Issue", "Eligibility for the Issue NIL", 1)
    assert text.count("NIL") == _COVERS["nityas-gems-and-jewellery-ltd"].count("NIL") + 1
    f = drhp(text)
    assert value(f, "ofs_shares") is None
    assert detail(f, "ofs_shares") == "DRHP: the other leg is not stated as nil / not applicable"


def test_drhp_unstated_other_leg_fails_closed():
    """The NSE cover with its "Not applicable" cell removed: the count alone does not say which
    leg is empty, so nothing share-related is written."""
    text = _COVERS["national-stock-exchange-of-india-ltd"].replace("Not", "Up").replace(
        "applicable", "")
    f = drhp(text)
    assert value(f, "ofs_shares") is None
    assert detail(f, "ofs_shares") == "DRHP: the other leg is not stated as nil / not applicable"


def test_drhp_two_different_counts_fail_closed():
    text = _COVERS["nityas-gems-and-jewellery-ltd"].replace(
        "Up to 14,456,000 Not applicable Up to 14,456,000",
        "Up to 14,456,000 Not applicable Up to 14,465,000")
    f = drhp(text)
    assert value(f, "total_offer_shares_at_cap") is None
    assert "different share counts" in detail(f, "total_offer_shares_at_cap")


def test_issue_process_both_wordings_is_null_with_reason():
    text = _COVERS["nityas-gems-and-jewellery-ltd"] + "\n100% Fixed Price Issue"
    f = drhp(text)
    assert value(f, "issue_price_type") is None
    assert detail(f, "issue_price_type") == "check_failed: both 'fixed price' and 'book built' on the cover"


def test_issue_process_neither_wording_is_null_with_reason():
    text = re.sub(r"book[\s-]*(?:built|building)", "", _COVERS["nityas-gems-and-jewellery-ltd"],
                  flags=re.I)
    f = drhp(text)
    assert value(f, "issue_price_type") is None
    assert detail(f, "issue_price_type") == "check_failed: neither wording on the cover"
