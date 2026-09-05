"""W-148 — the year-on-year plausibility band is segment-aware.

The mainboard band (0.2x-5.0x) is a mis-parse detector: a dropped leading digit
turns 13,970.10 into 3,970.10 and shows up as a 3,970x step. On an SME issuer it
fires on REAL growth instead. The W-146 BSE SME matrix
(D:/Abhay/Ventures/IPODhan-w143/docs/walks/w146-bse-sme-matrix.md) recorded:

  Horizon Reclaim RHP   — PAT rejected, "plausibility check flagged 9.93x YoY
                          jump"; EBITDA rejected on the same bound.
  Vahh Chemicals        — PAT rejected, "plausibility check flagged 7.49x YoY
                          jump".

Two of three filings lost their profit series to a false positive. The figures
below reproduce those two ratios exactly (9.93x and 7.49x) on internally
consistent revenue / EBITDA / PAT rows.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract_financials_pdf import (  # noqa: E402
    YOY_MIN,
    YOY_MAX,
    SME_YOY_MIN,
    SME_YOY_MAX,
    check_yoy_ratio_within_bounds,
    yoy_bounds,
)

# Horizon Reclaim: PAT 9.93x FY25 -> FY26 (12.41 / 1.25), EBITDA 5.9x.
# Revenue >= EBITDA >= PAT holds in every year, so nothing is mis-parsed.
HORIZON = {
    "revenue": {2026: 4820.00, 2025: 2410.00, 2024: 1980.00},
    "ebitda": {2026: 106.20, 2025: 18.00, 2024: 14.50},
    "profit": {2026: 12.41, 2025: 1.25, 2024: 0.98},
}

# Vahh Chemicals: PAT 7.49x FY25 -> FY26 (149.80 / 20.00).
VAHH = {
    "revenue": {2026: 3120.00, 2025: 1740.00, 2024: 1510.00},
    "ebitda": {2026: 231.40, 2025: 46.00, 2024: 38.20},
    "profit": {2026: 149.80, 2025: 20.00, 2024: 16.30},
}


def test_bounds_are_wider_for_sme_and_unchanged_for_mainboard():
    assert yoy_bounds("MAINBOARD") == (YOY_MIN, YOY_MAX) == (0.2, 5.0)
    assert yoy_bounds("SME") == (SME_YOY_MIN, SME_YOY_MAX) == (0.05, 20.0)
    # Anything that is not SME keeps the mainboard band.
    assert yoy_bounds(None) == (YOY_MIN, YOY_MAX)


def test_horizon_pat_and_ebitda_survive_the_sme_band():
    passed, detail, offenders = check_yoy_ratio_within_bounds(HORIZON, "SME")
    assert passed is True, detail
    assert offenders == []
    assert "SME band 0.05x..20.0x" in detail
    # The 9.93x PAT step the W-146 matrix flagged is inside the SME band.
    assert abs(HORIZON["profit"][2026] / HORIZON["profit"][2025] - 9.93) < 0.01


def test_vahh_pat_survives_the_sme_band():
    passed, detail, offenders = check_yoy_ratio_within_bounds(VAHH, "SME")
    assert passed is True, detail
    assert offenders == []
    assert abs(VAHH["profit"][2026] / VAHH["profit"][2025] - 7.49) < 0.01


def test_the_same_rows_are_spared_on_mainboard_only_by_internal_consistency():
    """On the mainboard band the 9.93x step is out of range, but the year's
    figures hold together (revenue >= EBITDA >= PAT, signs agreeing), so the row
    is spared rather than rejected — and the detail says which rule spared it."""
    passed, detail, offenders = check_yoy_ratio_within_bounds(HORIZON, "MAINBOARD")
    assert passed is True, detail
    assert offenders == []
    assert "MAINBOARD band 0.2x..5.0x" in detail
    assert "spared: 2026 figures internally consistent" in detail


def test_a_dropped_leading_digit_is_still_rejected():
    """The class the band exists for: a PAT read 10x too large lands ABOVE
    EBITDA, so the internal-consistency escape does not apply and the row is
    rejected on either band."""
    mangled = {
        "revenue": dict(HORIZON["revenue"]),
        "ebitda": dict(HORIZON["ebitda"]),
        "profit": {2026: 1241.00, 2025: 1.25, 2024: 0.98},  # 12.41 -> 1241.00
    }
    for segment in ("SME", "MAINBOARD"):
        passed, detail, offenders = check_yoy_ratio_within_bounds(mangled, segment)
        assert passed is False, (segment, detail)
        assert "profit" in offenders
        assert "not\ninternally consistent" in detail or "internally consistent" in detail


def test_a_pat_above_revenue_is_rejected_even_inside_the_sme_band():
    """Internal consistency is checked independently of the ratio: a PAT larger
    than revenue cannot spare a step, whatever its size."""
    absurd = {
        "revenue": {2026: 100.00, 2025: 2.00},
        "profit": {2026: 4000.00, 2025: 2.00},  # 2000x AND above revenue
    }
    passed, _detail, offenders = check_yoy_ratio_within_bounds(absurd, "SME")
    assert passed is False
    assert "profit" in offenders


def test_the_check_name_and_band_are_recorded_in_the_detail():
    """The emitted plausibility field must say WHY the row stands or falls."""
    _p, sme_detail, _o = check_yoy_ratio_within_bounds(VAHH, "SME")
    _p2, mb_detail, _o2 = check_yoy_ratio_within_bounds(VAHH, "MAINBOARD")
    assert sme_detail.startswith("SME band 0.05x..20.0x")
    assert mb_detail.startswith("MAINBOARD band 0.2x..5.0x")


# --------------------------------------------------------------------------- #
# W-148 round 3 — the consistency spare needs a magnitude ceiling.
#
# A uniformly-scaled mis-read keeps revenue >= EBITDA >= PAT intact at every
# year, so round 2's ordering test spared it. Beyond the OUTER band the step is
# rejected regardless of ordering.
# --------------------------------------------------------------------------- #
from extract_financials_pdf import (  # noqa: E402
    HARD_YOY_MIN,
    HARD_YOY_MAX,
    SME_HARD_YOY_MIN,
    SME_HARD_YOY_MAX,
    yoy_hard_bounds,
    parse_segment,
)

# 1000x on every row, and internally consistent at both years.
UNIFORMLY_SCALED = {
    "revenue": {2026: 1000.0, 2025: 1.0},
    "ebitda": {2026: 500.0, 2025: 0.5},
    "profit": {2026: 100.0, 2025: 0.1},
}


def test_hard_bounds_are_the_outer_band():
    assert yoy_hard_bounds("MAINBOARD") == (HARD_YOY_MIN, HARD_YOY_MAX) == (0.1, 10.0)
    assert yoy_hard_bounds("SME") == (SME_HARD_YOY_MIN, SME_HARD_YOY_MAX) == (0.02, 50.0)


def test_a_1000x_internally_consistent_series_is_rejected_on_both_segments():
    for segment in ("SME", "MAINBOARD"):
        passed, detail, offenders = check_yoy_ratio_within_bounds(UNIFORMLY_SCALED, segment)
        assert passed is False, (segment, detail)
        assert set(offenders) == {"revenue", "ebitda", "profit"}, segment
        assert "hard ceiling" in detail, segment


def test_the_real_sme_growth_rows_are_still_spared_under_the_ceiling():
    """Horizon 9.93x and Vahh 7.49x sit inside the SME hard band (0.02x-50x),
    so the round-3 ceiling does not take back the round-2 fix."""
    for name, metrics in (("horizon", HORIZON), ("vahh", VAHH)):
        passed, detail, offenders = check_yoy_ratio_within_bounds(metrics, "SME")
        assert passed is True, (name, detail)
        assert offenders == []
        assert "hard ceiling" not in detail, name
    # And on the mainboard band both are still spared by internal consistency,
    # because 9.93x is inside the mainboard hard band (0.1x-10x).
    passed, detail, _o = check_yoy_ratio_within_bounds(HORIZON, "MAINBOARD")
    assert passed is True, detail
    assert "spared: 2026 figures internally consistent" in detail


# --------------------------------------------------------------------------- #
# W-148 round 3 — `--segment` on the backfill CLI (the path
# scraper/scripts/backfill-financials-pdf.ts spawns).
# --------------------------------------------------------------------------- #
def test_parse_segment_accepts_both_flag_forms_and_defaults_closed():
    assert parse_segment(["file.pdf", "--segment", "SME"]) == "SME"
    assert parse_segment(["file.pdf", "--segment=SME"]) == "SME"
    assert parse_segment(["file.pdf", "--segment", "sme"]) == "SME"
    assert parse_segment(["file.pdf", "--segment=MAINBOARD"]) == "MAINBOARD"
    # No flag, an empty value, or an unrecognised one falls back to the NARROWER
    # mainboard band — an unknown caller never silently gets the loose one.
    assert parse_segment(["file.pdf"]) == "MAINBOARD"
    assert parse_segment(["file.pdf", "--segment="]) == "MAINBOARD"
    assert parse_segment(["file.pdf", "--segment", "EMERGE"]) == "MAINBOARD"
    assert parse_segment(["file.pdf", "--segment"]) == "MAINBOARD"
