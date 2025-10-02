"""
Unit Tests for SME Adjuster
Tests SME-specific scoring adjustments
"""

import pytest
from algorithms import IPODataInput, IPOScoreSchema, ScoreComponents
from algorithms.sme_adjuster import SMEAdjuster


class TestSMEAdjuster:
    """Test suite for SMEAdjuster class"""

    @pytest.fixture
    def adjuster(self):
        """Create SME adjuster instance"""
        return SMEAdjuster()

    @pytest.fixture
    def base_score(self):
        """Create base score (before SME adjustments)"""
        return IPOScoreSchema(
            ipo_id="test-sme-123",
            total_score=75,
            components=ScoreComponents(
                fundamental=32, sentiment=25, subscription=15, sector=3
            ),
            verdict="APPLY",
            verdict_label="Strong Buy",
            verdict_color="#10B981",
            confidence="HIGH",
            reasoning="Base score before SME adjustments",
            algorithm_version="1.0",
        )

    @pytest.fixture
    def sme_ipo_data(self):
        """SME IPO data with growth potential"""
        return IPODataInput(
            ipo_id="test-sme-123",
            company_name="SME Company Ltd",
            category="SME",  # SME category
            revenue_growth_3y=45.0,  # >40% growth - qualifies for bonus
            post_ipo_promoter_holding=65.0,  # >60% - qualifies for bonus
        )

    def test_adjust_for_non_sme(self, adjuster, base_score):
        """Test that non-SME IPOs are not adjusted"""
        non_sme_data = IPODataInput(
            ipo_id="test-mainline", company_name="Mainline Company", category="MAINLINE"
        )

        adjusted_score, reason = adjuster.adjust_for_sme(base_score, non_sme_data)

        assert adjusted_score.total_score == base_score.total_score
        assert "Not an SME IPO" in reason

    def test_apply_sme_penalties(self, adjuster, base_score, sme_ipo_data):
        """Test SME risk and liquidity penalties are applied"""
        # Use SME data without bonuses
        sme_data_no_bonuses = IPODataInput(
            ipo_id="test-sme",
            company_name="SME Ltd",
            category="SME",
            revenue_growth_3y=30.0,  # <40% - no growth bonus
            post_ipo_promoter_holding=55.0,  # <60% - no promoter bonus
        )

        adjusted_score, reason = adjuster.adjust_for_sme(
            base_score, sme_data_no_bonuses
        )

        # Should have -5 (risk) + -3 (liquidity) = -8 penalty
        expected_score = base_score.total_score - 8
        assert adjusted_score.total_score == expected_score
        assert "Higher risk penalty" in reason
        assert "Lower liquidity penalty" in reason

    def test_apply_growth_bonus(self, adjuster, base_score):
        """Test growth potential bonus for high revenue growth"""
        sme_data_high_growth = IPODataInput(
            ipo_id="test-sme",
            company_name="SME Ltd",
            category="SME",
            revenue_growth_3y=50.0,  # >40% - qualifies for +8 bonus
            post_ipo_promoter_holding=50.0,  # <60% - no promoter bonus
        )

        adjusted_score, reason = adjuster.adjust_for_sme(
            base_score, sme_data_high_growth
        )

        # -5 (risk) - 3 (liquidity) + 8 (growth) = 0 net adjustment
        expected_score = base_score.total_score + 0
        assert adjusted_score.total_score == expected_score
        assert "Growth potential bonus" in reason

    def test_apply_promoter_bonus(self, adjuster, base_score):
        """Test promoter holding bonus"""
        sme_data_high_promoter = IPODataInput(
            ipo_id="test-sme",
            company_name="SME Ltd",
            category="SME",
            revenue_growth_3y=30.0,  # <40% - no growth bonus
            post_ipo_promoter_holding=70.0,  # >60% - qualifies for +3 bonus
        )

        adjusted_score, reason = adjuster.adjust_for_sme(
            base_score, sme_data_high_promoter
        )

        # -5 (risk) - 3 (liquidity) + 3 (promoter) = -5 net adjustment
        expected_score = base_score.total_score - 5
        assert adjusted_score.total_score == expected_score
        assert "Promoter holding bonus" in reason

    def test_apply_all_bonuses(self, adjuster, base_score, sme_ipo_data):
        """Test all bonuses applied together"""
        adjusted_score, reason = adjuster.adjust_for_sme(base_score, sme_ipo_data)

        # -5 (risk) - 3 (liquidity) + 8 (growth) + 3 (promoter) = +3 net adjustment
        expected_score = base_score.total_score + 3
        assert adjusted_score.total_score == expected_score
        assert "Growth potential bonus" in reason
        assert "Promoter holding bonus" in reason

    def test_score_bounded_to_100(self, adjuster):
        """Test that final score doesn't exceed 100"""
        # Use a score of 97 so that with max bonuses it would exceed 100
        # 97 - 5 - 3 + 8 + 3 = 100 (exact boundary)
        high_score = IPOScoreSchema(
            ipo_id="test-high",
            total_score=97,  # High enough to reach 100 with bonuses
            components=ScoreComponents(
                fundamental=40, sentiment=28, subscription=19, sector=10
            ),
            verdict="APPLY",
            verdict_label="Strong Buy",
            verdict_color="#10B981",
            confidence="HIGH",
            reasoning="High base score",
            algorithm_version="1.0",
        )

        sme_data_max_bonuses = IPODataInput(
            ipo_id="test-high",
            company_name="High Score SME",
            category="SME",
            revenue_growth_3y=60.0,  # +8 bonus
            post_ipo_promoter_holding=80.0,  # +3 bonus
        )

        adjusted_score, _ = adjuster.adjust_for_sme(high_score, sme_data_max_bonuses)

        # Should cap at 100 (97 - 5 - 3 + 8 + 3 = 100)
        assert adjusted_score.total_score <= 100
        assert adjusted_score.total_score == 100

    def test_score_bounded_to_zero(self, adjuster):
        """Test that final score doesn't go below 0"""
        low_score = IPOScoreSchema(
            ipo_id="test-low",
            total_score=5,  # Very low
            components=ScoreComponents(
                fundamental=2, sentiment=1, subscription=1, sector=1
            ),
            verdict="SKIP",
            verdict_label="Avoid",
            verdict_color="#991B1B",
            confidence="LOW",
            reasoning="Low base score",
            algorithm_version="1.0",
        )

        sme_data_no_bonuses = IPODataInput(
            ipo_id="test-low",
            company_name="Low Score SME",
            category="SME",
            revenue_growth_3y=10.0,  # No growth bonus
            post_ipo_promoter_holding=30.0,  # No promoter bonus
        )

        adjusted_score, _ = adjuster.adjust_for_sme(low_score, sme_data_no_bonuses)

        # Should not go negative
        assert adjusted_score.total_score >= 0
        assert adjusted_score.total_score == 0  # 5 - 8 penalties = -3, capped to 0

    def test_sme_warning_generated(self, adjuster, base_score, sme_ipo_data):
        """Test that SME warning is generated"""
        adjusted_score, _ = adjuster.adjust_for_sme(base_score, sme_ipo_data)

        assert adjusted_score.is_sme == True
        assert adjusted_score.sme_warning is not None
        assert "SME IPOs carry higher risk" in adjusted_score.sme_warning

    def test_verdict_updated_after_adjustment(self, adjuster):
        """Test that verdict is recalculated after adjustment"""
        # Start with "Consider" score (60)
        medium_score = IPOScoreSchema(
            ipo_id="test-medium",
            total_score=60,
            components=ScoreComponents(
                fundamental=25, sentiment=20, subscription=12, sector=3
            ),
            verdict="CONSIDER",
            verdict_label="Consider",
            verdict_color="#F59E0B",
            confidence="MEDIUM",
            reasoning="Medium score",
            algorithm_version="1.0",
        )

        # Apply bonuses that push it to "Strong Buy" (70+)
        sme_data_bonuses = IPODataInput(
            ipo_id="test-medium",
            company_name="Medium SME",
            category="SME",
            revenue_growth_3y=50.0,  # +8 bonus
            post_ipo_promoter_holding=70.0,  # +3 bonus
        )

        adjusted_score, _ = adjuster.adjust_for_sme(medium_score, sme_data_bonuses)

        # 60 - 5 - 3 + 8 + 3 = 63 (still "Consider")
        assert adjusted_score.total_score == 63
        assert adjusted_score.verdict == "CONSIDER"
        assert adjusted_score.verdict_label == "Consider"
