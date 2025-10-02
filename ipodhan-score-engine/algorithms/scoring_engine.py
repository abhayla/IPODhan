"""
IPO Scoring Engine - Core Algorithm
Calculates 0-100 scores for IPOs based on 4 weighted components
"""

import logging
from typing import Tuple, List
from algorithms.schemas import IPOScoreSchema, ScoreComponents, IPODataInput

logger = logging.getLogger(__name__)


class IPOScoringEngine:
    """
    Main scoring engine for IPO evaluation
    Implements weighted scoring across 4 components:
    - Fundamentals (40%)
    - Market Sentiment (30%)
    - Subscription (20%)
    - Sector Timing (10%)
    """

    # Score thresholds for verdicts
    VERDICT_THRESHOLDS = {"STRONG_BUY": 70, "CONSIDER": 50, "RISKY": 30, "AVOID": 0}

    # Verdict colors (hex codes)
    VERDICT_COLORS = {
        "Strong Buy": "#10B981",  # Green
        "Consider": "#F59E0B",  # Yellow
        "Risky": "#EF4444",  # Orange
        "Avoid": "#991B1B",  # Red
    }

    def __init__(self, algorithm_version: str = "1.0"):
        """Initialize scoring engine with version"""
        self.algorithm_version = algorithm_version
        logger.info(f"IPOScoringEngine initialized (version {algorithm_version})")

    def calculate_score(self, ipo_data: IPODataInput) -> IPOScoreSchema:
        """
        Main entry point for score calculation
        Returns complete score with breakdown and explanation
        """
        logger.info(
            f"Calculating score for IPO: {ipo_data.company_name} ({ipo_data.ipo_id})"
        )

        # Calculate component scores
        fundamental_score = self.calculate_fundamentals(ipo_data)
        sentiment_score = self.calculate_sentiment(ipo_data)
        subscription_score = self.calculate_subscription(ipo_data)
        sector_score = self.calculate_sector(ipo_data)

        # Total score
        total_score = (
            fundamental_score + sentiment_score + subscription_score + sector_score
        )

        # Confidence assessment
        confidence = self.assess_confidence(ipo_data)

        # Verdict
        verdict, verdict_label, verdict_color = self.get_verdict(total_score)

        # Generate explanation
        strengths, weaknesses, key_factors = self.generate_explanation(
            fundamental_score,
            sentiment_score,
            subscription_score,
            sector_score,
            ipo_data,
        )

        reasoning = (
            f"Score based on "
            f"{len([s for s in [fundamental_score, sentiment_score, subscription_score, sector_score] if s > 0])} "
            f"available components. Confidence: {confidence}. {' '.join(key_factors[:2])}"
        )

        # Build score schema
        components = ScoreComponents(
            fundamental=fundamental_score,
            sentiment=sentiment_score,
            subscription=subscription_score,
            sector=sector_score,
        )

        score = IPOScoreSchema(
            ipo_id=ipo_data.ipo_id,
            total_score=total_score,
            components=components,
            verdict=verdict,
            verdict_label=verdict_label,
            verdict_color=verdict_color,
            confidence=confidence,
            reasoning=reasoning,
            strengths=strengths,
            weaknesses=weaknesses,
            key_factors=key_factors,
            algorithm_version=self.algorithm_version,
            is_sme=(ipo_data.category == "SME"),
            sme_warning=None,  # Will be set by SME adjuster if needed
        )

        logger.info(
            f"Score calculated: {total_score}/100 ({verdict_label}, {confidence} confidence)"
        )
        return score

    def calculate_fundamentals(self, ipo_data: IPODataInput) -> int:
        """
        Calculate fundamentals score (max 40 points)
        Components:
        - P/E Ratio (8 points)
        - Revenue Growth (8 points)
        - Profitability (8 points)
        - Debt-to-Equity (5 points)
        - ROE (5 points)
        - Cash Flow (6 points)
        """
        score = 0
        components_scored = 0

        # P/E Ratio (8 points) - compared to industry benchmark
        if ipo_data.pe_ratio is not None and ipo_data.industry_pe is not None:
            if ipo_data.pe_ratio < ipo_data.industry_pe * 0.7:
                score += 8  # Significantly below industry
            elif ipo_data.pe_ratio < ipo_data.industry_pe:
                score += 6  # Below industry
            elif ipo_data.pe_ratio < ipo_data.industry_pe * 1.2:
                score += 4  # Slightly above industry
            else:
                score += 2  # Significantly above industry
            components_scored += 1

        # Revenue Growth (8 points) - 3-year CAGR
        if ipo_data.revenue_fy1 and ipo_data.revenue_fy3:
            revenue_growth = self._calculate_cagr(
                ipo_data.revenue_fy1, ipo_data.revenue_fy3, years=2
            )
            if revenue_growth > 30:
                score += 8
            elif revenue_growth > 20:
                score += 6
            elif revenue_growth > 10:
                score += 4
            elif revenue_growth > 0:
                score += 2
            else:
                score += 0  # Negative growth
            components_scored += 1

        # Profitability (8 points) - profit growth and margins
        if ipo_data.profit_fy1 and ipo_data.profit_fy3:
            profit_growth = self._calculate_cagr(
                ipo_data.profit_fy1, ipo_data.profit_fy3, years=2
            )
            # Profit margin FY3
            profit_margin = (
                (ipo_data.profit_fy3 / ipo_data.revenue_fy3 * 100)
                if ipo_data.revenue_fy3
                else 0
            )

            if profit_growth > 30 and profit_margin > 15:
                score += 8
            elif profit_growth > 20 and profit_margin > 10:
                score += 6
            elif profit_growth > 10:
                score += 4
            elif profit_growth > 0:
                score += 2
            else:
                score += 0
            components_scored += 1

        # Debt-to-Equity (5 points) - lower is better
        if ipo_data.debt_to_equity is not None:
            if ipo_data.debt_to_equity < 0.5:
                score += 5  # Very low debt
            elif ipo_data.debt_to_equity < 1.0:
                score += 4  # Moderate debt
            elif ipo_data.debt_to_equity < 2.0:
                score += 2  # High debt
            else:
                score += 0  # Very high debt
            components_scored += 1

        # ROE (5 points) - return on equity
        if ipo_data.roe is not None:
            if ipo_data.roe > 20:
                score += 5
            elif ipo_data.roe > 15:
                score += 4
            elif ipo_data.roe > 10:
                score += 3
            elif ipo_data.roe > 5:
                score += 2
            else:
                score += 0
            components_scored += 1

        # Cash Flow (6 points) - positive free cash flow
        if ipo_data.cash_flow is not None:
            if ipo_data.cash_flow > 100:  # In crores, strong positive
                score += 6
            elif ipo_data.cash_flow > 50:
                score += 5
            elif ipo_data.cash_flow > 0:
                score += 3
            else:
                score += 0  # Negative cash flow
            components_scored += 1

        # If some components missing, proportionally adjust
        if components_scored < 6 and components_scored > 0:
            # Recalculate proportionally
            max_possible = components_scored * (40 / 6)
            score = min(score, int(max_possible))

        return min(score, 40)  # Cap at 40

    def calculate_sentiment(self, ipo_data: IPODataInput) -> int:
        """
        Calculate market sentiment score (max 30 points)
        Components:
        - GMP Trend (10 points)
        - Watchlist Additions (5 points)
        - Social Buzz (5 points) - MVP: skip
        - Crowd Prediction (5 points)
        - Search Trends (5 points) - MVP: skip

        MVP: Skip social buzz and search trends, recalculate weights proportionally
        """
        score = 0
        components_scored = 0

        # GMP Trend (12 points in MVP - increased from 10)
        if ipo_data.current_gmp_percent is not None:
            gmp = ipo_data.current_gmp_percent
            trend = ipo_data.gmp_7day_trend or "stable"

            # Base score from GMP percentage
            if gmp > 50:
                base_score = 9
            elif gmp > 30:
                base_score = 7
            elif gmp > 15:
                base_score = 5
            elif gmp > 0:
                base_score = 3
            else:
                base_score = 0  # Negative GMP

            # Trend bonus
            if trend == "increasing":
                score += base_score + 3
            elif trend == "stable":
                score += base_score + 2
            else:
                score += base_score

            components_scored += 1

        # Watchlist Additions (6 points in MVP - increased from 5)
        if ipo_data.watchlist_additions_7d is not None:
            additions = ipo_data.watchlist_additions_7d
            if additions > 1000:
                score += 6
            elif additions > 500:
                score += 5
            elif additions > 100:
                score += 3
            else:
                score += 1
            components_scored += 1

        # Crowd Prediction (6 points in MVP - increased from 5)
        if ipo_data.crowd_prediction_avg is not None:
            prediction = ipo_data.crowd_prediction_avg
            if prediction > 75:
                score += 6
            elif prediction > 60:
                score += 5
            elif prediction > 50:
                score += 3
            else:
                score += 1
            components_scored += 1

        # Social Buzz (skipped in MVP)
        # Search Trends (skipped in MVP)

        return min(score, 30)  # Cap at 30

    def calculate_subscription(self, ipo_data: IPODataInput) -> int:
        """
        Calculate subscription score (max 20 points)
        Components:
        - QIB Subscription (8 points)
        - HNI Subscription (4 points)
        - Retail Subscription (5 points)
        - Momentum (3 points)
        """
        score = 0

        # QIB Subscription (8 points) - institutional investors
        if ipo_data.qib_subscription is not None:
            qib = ipo_data.qib_subscription
            if qib > 10:
                score += 8
            elif qib > 5:
                score += 6
            elif qib > 2:
                score += 4
            elif qib > 1:
                score += 2
            else:
                score += 0

        # HNI Subscription (4 points) - high net worth individuals
        if ipo_data.hni_subscription is not None:
            hni = ipo_data.hni_subscription
            if hni > 10:
                score += 4
            elif hni > 5:
                score += 3
            elif hni > 2:
                score += 2
            elif hni > 1:
                score += 1
            else:
                score += 0

        # Retail Subscription (5 points)
        if ipo_data.retail_subscription is not None:
            retail = ipo_data.retail_subscription
            if retail > 5:
                score += 5
            elif retail > 3:
                score += 4
            elif retail > 2:
                score += 3
            elif retail > 1:
                score += 2
            else:
                score += 0

        # Momentum (3 points) - subscription trend
        if ipo_data.subscription_momentum:
            if ipo_data.subscription_momentum == "increasing":
                score += 3
            elif ipo_data.subscription_momentum == "stable":
                score += 2
            else:
                score += 1

        return min(score, 20)  # Cap at 20

    def calculate_sector(self, ipo_data: IPODataInput) -> int:
        """
        Calculate sector timing score (max 10 points)
        Components:
        - Sector Performance (3 points) - 30-day sector index performance
        - Peer Comparison (3 points) - compared to peer average PE
        - Market Condition (2 points) - overall market sentiment
        - IPO Pipeline (2 points) - IPO capacity/saturation
        """
        score = 0

        # Sector Performance (3 points) - 30-day performance
        if ipo_data.sector_performance_30d is not None:
            perf = ipo_data.sector_performance_30d
            if perf > 10:
                score += 3  # Sector outperforming
            elif perf > 5:
                score += 2
            elif perf > 0:
                score += 1
            else:
                score += 0  # Sector underperforming

        # Peer Comparison (3 points)
        if ipo_data.pe_ratio and ipo_data.peer_avg_pe:
            if ipo_data.pe_ratio < ipo_data.peer_avg_pe * 0.8:
                score += 3  # Cheaper than peers
            elif ipo_data.pe_ratio < ipo_data.peer_avg_pe:
                score += 2
            else:
                score += 1

        # Market Condition (2 points)
        if ipo_data.market_condition:
            if ipo_data.market_condition == "bullish":
                score += 2
            elif ipo_data.market_condition == "neutral":
                score += 1
            else:
                score += 0

        # IPO Pipeline (2 points) - fewer IPOs is better (less competition)
        if ipo_data.ipo_pipeline_count is not None:
            if ipo_data.ipo_pipeline_count < 5:
                score += 2
            elif ipo_data.ipo_pipeline_count < 10:
                score += 1
            else:
                score += 0

        return min(score, 10)  # Cap at 10

    def assess_confidence(self, ipo_data: IPODataInput) -> str:
        """
        Assess data quality confidence based on field completeness
        HIGH: >90% fields populated
        MEDIUM: 60-90% fields populated
        LOW: <60% fields populated
        """
        # Count available fields (excluding meta fields)
        total_fields = 0
        populated_fields = 0

        # Fundamentals (8 fields)
        fundamental_fields = [
            ipo_data.pe_ratio,
            ipo_data.revenue_fy1,
            ipo_data.revenue_fy3,
            ipo_data.profit_fy1,
            ipo_data.profit_fy3,
            ipo_data.debt_to_equity,
            ipo_data.roe,
            ipo_data.cash_flow,
        ]
        total_fields += len(fundamental_fields)
        populated_fields += sum(1 for f in fundamental_fields if f is not None)

        # Sentiment (4 fields - excluding social/search in MVP)
        sentiment_fields = [
            ipo_data.current_gmp_percent,
            ipo_data.gmp_7day_trend,
            ipo_data.watchlist_additions_7d,
            ipo_data.crowd_prediction_avg,
        ]
        total_fields += len(sentiment_fields)
        populated_fields += sum(1 for f in sentiment_fields if f is not None)

        # Subscription (4 fields)
        subscription_fields = [
            ipo_data.qib_subscription,
            ipo_data.hni_subscription,
            ipo_data.retail_subscription,
            ipo_data.subscription_momentum,
        ]
        total_fields += len(subscription_fields)
        populated_fields += sum(1 for f in subscription_fields if f is not None)

        # Sector (4 fields)
        sector_fields = [
            ipo_data.sector_performance_30d,
            ipo_data.peer_avg_pe,
            ipo_data.market_condition,
            ipo_data.ipo_pipeline_count,
        ]
        total_fields += len(sector_fields)
        populated_fields += sum(1 for f in sector_fields if f is not None)

        # Calculate completeness percentage
        completeness = (
            (populated_fields / total_fields) * 100 if total_fields > 0 else 0
        )

        if completeness > 90:
            return "HIGH"
        elif completeness >= 60:
            return "MEDIUM"
        else:
            return "LOW"

    def get_verdict(self, total_score: int) -> Tuple[str, str, str]:
        """
        Returns (verdict, label, color) based on score
        70-100: Strong Buy (APPLY)
        50-69: Consider
        30-49: Risky (CONSIDER)
        0-29: Avoid (SKIP)
        """
        if total_score >= self.VERDICT_THRESHOLDS["STRONG_BUY"]:
            return ("APPLY", "Strong Buy", self.VERDICT_COLORS["Strong Buy"])
        elif total_score >= self.VERDICT_THRESHOLDS["CONSIDER"]:
            return ("CONSIDER", "Consider", self.VERDICT_COLORS["Consider"])
        elif total_score >= self.VERDICT_THRESHOLDS["RISKY"]:
            return ("CONSIDER", "Risky", self.VERDICT_COLORS["Risky"])
        else:
            return ("SKIP", "Avoid", self.VERDICT_COLORS["Avoid"])

    def generate_explanation(
        self,
        fundamental_score: int,
        sentiment_score: int,
        subscription_score: int,
        sector_score: int,
        ipo_data: IPODataInput,
    ) -> Tuple[List[str], List[str], List[str]]:
        """
        Generate strengths, weaknesses, and key factors
        Returns (strengths, weaknesses, key_factors)
        """
        strengths = []
        weaknesses = []
        key_factors = []

        # Fundamentals analysis
        if fundamental_score >= 30:
            strengths.append("Strong fundamentals with healthy financials")
        elif fundamental_score <= 15:
            weaknesses.append("Weak fundamentals")

        # Sentiment analysis
        if sentiment_score >= 20:
            strengths.append("Positive market sentiment and high GMP")
        elif sentiment_score <= 10:
            weaknesses.append("Low market interest and weak GMP")

        # Subscription analysis
        if subscription_score >= 15:
            strengths.append("Oversubscribed across all categories")
        elif subscription_score <= 8:
            weaknesses.append("Weak subscription demand")

        # Sector analysis
        if sector_score >= 7:
            strengths.append("Favorable sector timing")
        elif sector_score <= 3:
            weaknesses.append("Unfavorable sector conditions")

        # Key factors (max 3-4)
        if ipo_data.pe_ratio and ipo_data.industry_pe:
            key_factors.append(
                f"P/E ratio {ipo_data.pe_ratio:.1f}x vs industry {ipo_data.industry_pe:.1f}x"
            )

        if ipo_data.current_gmp_percent is not None:
            key_factors.append(f"GMP at {ipo_data.current_gmp_percent:.1f}%")

        if ipo_data.qib_subscription is not None:
            key_factors.append(f"QIB subscription {ipo_data.qib_subscription:.1f}x")

        return strengths, weaknesses, key_factors

    def _calculate_cagr(
        self, start_value: float, end_value: float, years: int = 2
    ) -> float:
        """Calculate Compound Annual Growth Rate"""
        if start_value <= 0 or end_value <= 0:
            return 0.0
        try:
            cagr = ((end_value / start_value) ** (1 / years) - 1) * 100
            return round(cagr, 2)
        except (ZeroDivisionError, ValueError):
            return 0.0
