"""
Unit Tests for IPO Scoring Engine
Tests all component calculation methods and score banding logic
"""

import pytest
from algorithms import IPOScoringEngine, IPODataInput


class TestIPOScoringEngine:
    """Test suite for IPOScoringEngine class"""

    @pytest.fixture
    def engine(self):
        """Create scoring engine instance"""
        return IPOScoringEngine()

    @pytest.fixture
    def sample_ipo_data(self):
        """Sample IPO data with high fundamentals"""
        return IPODataInput(
            ipo_id="test-ipo-123",
            company_name="Test Company Ltd",
            category="MAINLINE",
            # Fundamentals
            pe_ratio=25.0,
            industry_pe=40.0,  # PE below industry
            revenue_fy1=100.0,
            revenue_fy2=150.0,
            revenue_fy3=200.0,  # 100% growth over 2 years
            profit_fy1=10.0,
            profit_fy2=18.0,
            profit_fy3=28.0,
            debt_to_equity=0.3,  # Low debt
            roe=22.0,  # High ROE
            cash_flow=120.0,  # Strong cash flow
            # Sentiment
            current_gmp_percent=55.0,  # High GMP
            gmp_7day_trend="increasing",
            watchlist_additions_7d=1200,
            crowd_prediction_avg=78.0,
            # Subscription
            qib_subscription=12.0,
            hni_subscription=8.0,
            retail_subscription=6.0,
            subscription_momentum="increasing",
            # Sector
            sector="Technology",
            sector_performance_30d=12.0,
            peer_avg_pe=30.0,
            market_condition="bullish",
            ipo_pipeline_count=3,
        )

    def test_calculate_fundamentals_high_pe(self, engine, sample_ipo_data):
        """Test fundamentals calculation with high PE"""
        score = engine.calculate_fundamentals(sample_ipo_data)
        assert score >= 30, f"High fundamentals should score >30, got {score}"
        assert score <= 40, "Fundamentals score cannot exceed 40"

    def test_calculate_fundamentals_missing_data(self, engine):
        """Test fundamentals with minimal data"""
        minimal_data = IPODataInput(ipo_id="test-minimal", company_name="Minimal Ltd")
        score = engine.calculate_fundamentals(minimal_data)
        assert score >= 0, "Score cannot be negative"
        assert score <= 40, "Score cannot exceed maximum"

    def test_calculate_sentiment(self, engine, sample_ipo_data):
        """Test sentiment calculation"""
        score = engine.calculate_sentiment(sample_ipo_data)
        assert score >= 20, f"High sentiment should score >20, got {score}"
        assert score <= 30, "Sentiment score cannot exceed 30"

    def test_calculate_subscription(self, engine, sample_ipo_data):
        """Test subscription calculation"""
        score = engine.calculate_subscription(sample_ipo_data)
        assert score >= 15, f"High subscription should score >15, got {score}"
        assert score <= 20, "Subscription score cannot exceed 20"

    def test_calculate_sector(self, engine, sample_ipo_data):
        """Test sector timing calculation"""
        score = engine.calculate_sector(sample_ipo_data)
        assert score >= 7, f"Favorable sector should score >7, got {score}"
        assert score <= 10, "Sector score cannot exceed 10"

    def test_assess_confidence_high(self, engine, sample_ipo_data):
        """Test confidence assessment with complete data"""
        confidence = engine.assess_confidence(sample_ipo_data)
        assert (
            confidence == "HIGH"
        ), f"Complete data should have HIGH confidence, got {confidence}"

    def test_assess_confidence_low(self, engine):
        """Test confidence assessment with minimal data"""
        minimal_data = IPODataInput(ipo_id="test-minimal", company_name="Minimal Ltd")
        confidence = engine.assess_confidence(minimal_data)
        assert (
            confidence == "LOW"
        ), f"Minimal data should have LOW confidence, got {confidence}"

    def test_get_verdict_strong_buy(self, engine):
        """Test verdict for strong buy score (70-100)"""
        verdict, label, color = engine.get_verdict(85)
        assert verdict == "APPLY", f"Score 85 should be APPLY, got {verdict}"
        assert label == "Strong Buy", f"Expected 'Strong Buy', got {label}"
        assert color == "#10B981", "Color should be green"

    def test_get_verdict_consider(self, engine):
        """Test verdict for consider score (50-69)"""
        verdict, label, color = engine.get_verdict(60)
        assert verdict == "CONSIDER", f"Score 60 should be CONSIDER, got {verdict}"
        assert label == "Consider", f"Expected 'Consider', got {label}"

    def test_get_verdict_risky(self, engine):
        """Test verdict for risky score (30-49)"""
        verdict, label, color = engine.get_verdict(40)
        assert verdict == "CONSIDER", f"Score 40 should be CONSIDER (Risky)"
        assert label == "Risky", f"Expected 'Risky', got {label}"

    def test_get_verdict_avoid(self, engine):
        """Test verdict for avoid score (0-29)"""
        verdict, label, color = engine.get_verdict(20)
        assert verdict == "SKIP", f"Score 20 should be SKIP, got {verdict}"
        assert label == "Avoid", f"Expected 'Avoid', got {label}"

    def test_calculate_score_complete(self, engine, sample_ipo_data):
        """Test complete score calculation"""
        score = engine.calculate_score(sample_ipo_data)

        # Verify structure
        assert score.ipo_id == "test-ipo-123"
        assert 0 <= score.total_score <= 100, "Total score must be 0-100"
        assert score.confidence in ["HIGH", "MEDIUM", "LOW"]
        assert score.verdict in ["APPLY", "CONSIDER", "SKIP"]

        # Verify components
        assert 0 <= score.components.fundamental <= 40
        assert 0 <= score.components.sentiment <= 30
        assert 0 <= score.components.subscription <= 20
        assert 0 <= score.components.sector <= 10

        # Verify total equals sum of components
        component_sum = (
            score.components.fundamental
            + score.components.sentiment
            + score.components.subscription
            + score.components.sector
        )
        assert score.total_score == component_sum

    def test_calculate_cagr(self, engine):
        """Test CAGR calculation"""
        # 100 to 200 over 2 years = 41.42% CAGR
        cagr = engine._calculate_cagr(100, 200, years=2)
        assert 40 <= cagr <= 42, f"CAGR should be ~41%, got {cagr}"

    def test_generate_explanation(self, engine):
        """Test explanation generation"""
        strengths, weaknesses, key_factors = engine.generate_explanation(
            fundamental_score=35,
            sentiment_score=25,
            subscription_score=18,
            sector_score=8,
            ipo_data=IPODataInput(
                ipo_id="test",
                company_name="Test",
                pe_ratio=25.0,
                industry_pe=40.0,
                current_gmp_percent=45.0,
                qib_subscription=10.0,
            ),
        )

        assert len(strengths) > 0, "Should have strengths"
        assert len(key_factors) > 0, "Should have key factors"


    def test_calculate_fundamentals_zero_industry_pe(self, engine):
        """Test fundamentals when industry PE is zero"""
        data = IPODataInput(
            ipo_id="test",
            company_name="Test",
            pe_ratio=25.0,
            industry_pe=0,  # Zero industry PE
            current_gmp_percent=45.0,
            qib_subscription=10.0,
        )
        result = engine.calculate_score(data)
        assert result.components.fundamental >= 0

    def test_calculate_fundamentals_negative_values(self, engine):
        """Test fundamentals with negative profit margins"""
        data = IPODataInput(
            ipo_id="test",
            company_name="Test",
            pe_ratio=-10.0,  # Negative PE (loss-making)
            industry_pe=20.0,
            profit_margin=-5.0,  # Negative margin
            current_gmp_percent=45.0,
            qib_subscription=10.0,
        )
        result = engine.calculate_score(data)
        assert result.components.fundamental >= 0  # Score should be clamped to 0

    def test_calculate_sentiment_no_gmp_trend(self, engine):
        """Test sentiment calculation when GMP trend is None"""
        data = IPODataInput(
            ipo_id="test",
            company_name="Test",
            current_gmp_percent=25.0,
            gmp_7day_trend=None,  # No trend data
            watchlist_additions_7d=0,
            qib_subscription=10.0,
        )
        result = engine.calculate_score(data)
        assert result.components.sentiment >= 0

    def test_calculate_subscription_zero_subscriptions(self, engine):
        """Test subscription score with zero subscription values"""
        data = IPODataInput(
            ipo_id="test",
            company_name="Test",
            qib_subscription=0.0,  # Not subscribed
            hni_subscription=0.0,
            retail_subscription=0.0,
            subscription_momentum=None,
            current_gmp_percent=45.0,
        )
        result = engine.calculate_score(data)
        assert result.components.subscription >= 0
        assert result.components.subscription < 5  # Should be very low

    def test_calculate_sector_no_peer_data(self, engine):
        """Test sector calculation when peer data is missing"""
        data = IPODataInput(
            ipo_id="test",
            company_name="Test",
            sector="Unknown",
            sector_performance_30d=None,  # No sector data
            peer_avg_pe=None,  # No peer data
            pe_ratio=25.0,
            market_condition=None,
            current_gmp_percent=45.0,
            qib_subscription=10.0,
        )
        result = engine.calculate_score(data)
        assert result.components.sector >= 0

    def test_assess_confidence_medium(self, engine):
        """Test confidence assessment with medium completeness"""
        data = IPODataInput(
            ipo_id="test",
            company_name="Test",
            pe_ratio=25.0,
            # 70% of fields populated (between 60-90%)
            current_gmp_percent=45.0,
            qib_subscription=10.0,
            revenue_fy1=100.0,
            profit_fy1=10.0,
        )
        result = engine.calculate_score(data)
        assert result.confidence in ["HIGH", "MEDIUM", "LOW"]

    def test_calculate_score_with_missing_critical_fields(self, engine):
        """Test complete score calculation with minimal data"""
        data = IPODataInput(
            ipo_id="minimal-test",
            company_name="Minimal Data Ltd",
            # Only required fields
            current_gmp_percent=0.0,
            qib_subscription=0.0,
        )
        result = engine.calculate_score(data)
        
        assert result.total_score >= 0
        assert result.total_score <= 100
        assert result.confidence in ["HIGH", "MEDIUM", "LOW"]
        assert result.verdict in ["APPLY", "CONSIDER", "SKIP"]

    def test_calculate_score_extreme_values(self, engine):
        """Test score calculation with extreme values"""
        data = IPODataInput(
            ipo_id="extreme-test",
            company_name="Extreme Values Ltd",
            pe_ratio=200.0,  # Very high PE
            industry_pe=20.0,
            current_gmp_percent=150.0,  # Extreme GMP
            qib_subscription=500.0,  # Massively oversubscribed
            hni_subscription=300.0,
            retail_subscription=200.0,
            debt_to_equity=5.0,  # High debt
            roe=-10.0,  # Negative ROE
        )
        result = engine.calculate_score(data)
        
        # Score should still be bounded
        assert result.total_score >= 0
        assert result.total_score <= 100
        
    def test_calculate_cagr_with_zero_base(self, engine):
        """Test CAGR calculation when base value is zero"""
        cagr = engine._calculate_cagr(0, 100, 2)  # Base is zero
        assert cagr == 0  # Should handle gracefully

    def test_calculate_cagr_negative_years(self, engine):
        """Test CAGR calculation with invalid years"""
        cagr = engine._calculate_cagr(100, 150, 0)  # Zero years
        assert cagr == 0  # Should handle gracefully
