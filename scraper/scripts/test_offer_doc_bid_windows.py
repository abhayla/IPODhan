"""D5 (owner 2026-10-04): an offer document's own bid-submission table gives ipo_details.bid_windows
(the advert reader's row shape) and ipo_market_timings ("10.00 a.m. to 5.00 p.m.", NSE's text shape).
D4: the cover's issuer name is the document's company_name answer.

Text copied verbatim from the National Stock Exchange DRHP (d88fad44) pdf pages 475-476 and 1.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import extract_filing as ef  # noqa: E402

NSE_P475_TAIL = """Submission of Bids (other than Bids from Anchor Investors):
Bid/Offer Period (except the Bid/Offer Closing Date)
Submission and Revision in Bids Only between 10.00 a.m. and 5.00 p.m. IST
469"""
NSE_P476 = """Bid/Offer Closing Date
Submission of electronic applications (online ASBA through 3-in-1 Only between 10.00 a.m. and up to 5.00 p.m. IST
accounts) for RIBs and Eligible Employees Bidding in the Employee
Reservation Portion
Submission of Physical Applications (Bank ASBA) Only between 10.00 a.m. and up to 1.00 p.m. IST
Submission of physical applications (syndicate non-retail, non- Only between 10.00 a.m. and up to 12.00 p.m. IST
individual applications where Bid Amount is more than 0.50
million)
Upward Revision of Bids by QIBs and Non-Institutional Bidders Only between 10.00 a.m. and up to 4.00 p.m. IST on Bid/Offer
categories# Closing Date
* UPI mandate end time shall be 5:00 p.m. on the Bid/Offer Closing Date."""


def _read(pages):
    emit = ef.Emitter("t")
    ef.read_offer_doc_bid_windows(pages, emit)
    return emit.fields


def test_nse_drhp_bid_windows_and_market_timings():
    f = _read([(474, NSE_P475_TAIL), (475, NSE_P476)])
    rows = f["bid_windows"]["value"]
    assert [r["window"] for r in rows] == [
        "Only between 10.00 a.m. and 5.00 p.m. IST",
        "Only between 10.00 a.m. and up to 5.00 p.m. IST",
        "Only between 10.00 a.m. and up to 1.00 p.m. IST",
        "Only between 10.00 a.m. and up to 12.00 p.m. IST",
        "Only between 10.00 a.m. and up to 4.00 p.m. IST",
    ]
    assert rows[0]["activity"] == "Submission and Revision in Bids"
    assert f["ipo_market_timings"]["value"] == "10.00 a.m. to 5.00 p.m."
    assert f["ipo_market_timings"]["page"] == 474


def test_no_bid_table_is_a_miss_never_a_guess():
    f = _read([(0, "UPI mandate end time shall be 5:00 p.m. on the Bid/Offer Closing Date.")])
    assert f["bid_windows"]["value"] is None and f["ipo_market_timings"]["value"] is None
    assert f["ipo_market_timings"]["state"] == "MISSED"


@pytest.mark.parametrize("windows, expected", [
    ([{"window": "Only between 10.00 a.m. and up to 3.00 p.m. IST"},
      {"window": "Only between 9.30 a.m. and 4.00 p.m. IST"},
      {"window": "Only between 11.00 a.m. and 5.00 p.m. IST"}], "9.30 a.m. to 5.00 p.m."),
    ([{"window": "Only between 10.00 a.m. and 12.00 p.m. IST"}], "10.00 a.m. to 12.00 p.m."),
])
def test_widest_window(windows, expected):
    assert ef.market_timings_from_windows(windows) == (expected, None)


@pytest.mark.parametrize("window", [
    "Only between 10 am and 5 pm IST",              # another clock form: refused, not guessed
    "Only between 5.00 p.m. and 10.00 a.m. IST",    # ends before it starts
])
def test_unreadable_window_refuses_the_whole_field(window):
    rows = [{"window": "Only between 10.00 a.m. and 5.00 p.m. IST"}, {"window": window}]
    text, why = ef.market_timings_from_windows(rows)
    assert text is None and why


def test_refused_timings_carry_the_reason():
    page = NSE_P475_TAIL.replace("10.00 a.m. and 5.00 p.m.", "10 am and 5 pm")
    f = _read([(474, page)])
    assert f["ipo_market_timings"]["value"] is None and f["ipo_market_timings"]["state"] == "MISSED"
    assert "not in the 'Only between" in f["ipo_market_timings"]["check"]["detail"]
