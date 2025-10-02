"""
SME IPO Adjustment Logic
Applies special scoring adjustments for SME category IPOs
"""

import logging
from typing import Tuple
from algorithms.schemas import IPOScoreSchema, IPODataInput

logger = logging.getLogger(__name__)


class SMEAdjuster:
    """
    Applies SME-specific adjustments to IPO scores
    Adjustments:
    - Higher risk penalty: -5 points
    - Lower liquidity penalty: -3 points
    - Growth potential bonus: +8 points (if revenue growth >40%)
    - Promoter holding bonus: +3 points (if post-IPO holding >60%)
    """

    # Adjustment constants
    HIGHER_RISK_PENALTY = -5
    LOWER_LIQUIDITY_PENALTY = -3
    GROWTH_POTENTIAL_BONUS = 8
    PROMOTER_HOLDING_BONUS = 3

    # Thresholds
    REVENUE_GROWTH_THRESHOLD = 40.0  # % CAGR
    PROMOTER_HOLDING_THRESHOLD = 60.0  # % post-IPO

    def __init__(self):
        logger.info("SMEAdjuster initialized")

    def adjust_for_sme(
        self, base_score: IPOScoreSchema, ipo_data: IPODataInput
    ) -> Tuple[IPOScoreSchema, str]:
        """
        Apply SME adjustments to base score
        Returns (adjusted_score, adjustment_reason)
        """
        # Check if SME category
        if ipo_data.category != "SME":
            return base_score, "Not an SME IPO - no adjustments applied"

        logger.info(f"Applying SME adjustments for IPO: {ipo_data.company_name}")

        # Start with base score
        adjusted_total = base_score.total_score
        adjustments = []

        # 1. Higher risk penalty (-5 points)
        adjusted_total += self.HIGHER_RISK_PENALTY
        adjustments.append(f"Higher risk penalty: {self.HIGHER_RISK_PENALTY}")

        # 2. Lower liquidity penalty (-3 points)
        adjusted_total += self.LOWER_LIQUIDITY_PENALTY
        adjustments.append(f"Lower liquidity penalty: {self.LOWER_LIQUIDITY_PENALTY}")

        # 3. Growth potential bonus (+8 points if revenue growth >40%)
        if ipo_data.revenue_growth_3y is not None:
            if ipo_data.revenue_growth_3y > self.REVENUE_GROWTH_THRESHOLD:
                adjusted_total += self.GROWTH_POTENTIAL_BONUS
                adjustments.append(
                    f"Growth potential bonus: +{self.GROWTH_POTENTIAL_BONUS} "
                    f"(revenue growth {ipo_data.revenue_growth_3y:.1f}% > {self.REVENUE_GROWTH_THRESHOLD}%)"
                )

        # 4. Promoter holding bonus (+3 points if post-IPO holding >60%)
        if ipo_data.post_ipo_promoter_holding is not None:
            if ipo_data.post_ipo_promoter_holding > self.PROMOTER_HOLDING_THRESHOLD:
                adjusted_total += self.PROMOTER_HOLDING_BONUS
                adjustments.append(
                    f"Promoter holding bonus: +{self.PROMOTER_HOLDING_BONUS} "
                    f"(holding {ipo_data.post_ipo_promoter_holding:.1f}% > {self.PROMOTER_HOLDING_THRESHOLD}%)"
                )

        # Ensure final score stays within 0-100 bounds
        adjusted_total = max(0, min(adjusted_total, 100))

        # Create adjustment reason summary
        adjustment_reason = "; ".join(adjustments)
        net_adjustment = adjusted_total - base_score.total_score

        logger.info(
            f"SME adjustments applied: {net_adjustment:+d} points "
            f"({base_score.total_score} -> {adjusted_total})"
        )

        # Create SME warning message
        sme_warning = self._generate_sme_warning(
            adjusted_total,
            ipo_data.revenue_growth_3y,
            ipo_data.post_ipo_promoter_holding,
        )

        # Update score with adjustments (using Pydantic V2 model_copy)
        adjusted_score = base_score.model_copy(
            update={
                "total_score": adjusted_total,
                "is_sme": True,
                "sme_warning": sme_warning,
                "reasoning": f"{base_score.reasoning} SME adjustments: {adjustment_reason}.",
            }
        )

        # Recalculate verdict based on adjusted score
        if adjusted_total >= 70:
            adjusted_score.verdict = "APPLY"
            adjusted_score.verdict_label = "Strong Buy"
            adjusted_score.verdict_color = "#10B981"
        elif adjusted_total >= 50:
            adjusted_score.verdict = "CONSIDER"
            adjusted_score.verdict_label = "Consider"
            adjusted_score.verdict_color = "#F59E0B"
        elif adjusted_total >= 30:
            adjusted_score.verdict = "CONSIDER"
            adjusted_score.verdict_label = "Risky"
            adjusted_score.verdict_color = "#EF4444"
        else:
            adjusted_score.verdict = "SKIP"
            adjusted_score.verdict_label = "Avoid"
            adjusted_score.verdict_color = "#991B1B"

        return adjusted_score, adjustment_reason

    def _generate_sme_warning(
        self,
        final_score: int,
        revenue_growth: float | None,
        promoter_holding: float | None,
    ) -> str:
        """Generate SME-specific warning message"""
        warnings = []

        # Base SME warning
        warnings.append(
            "SME IPOs carry higher risk and lower liquidity compared to mainboard IPOs"
        )

        # Score-based warnings
        if final_score < 50:
            warnings.append("Score adjusted downward due to SME risk factors")

        # Growth-based warnings
        if revenue_growth is not None:
            if revenue_growth < 20:
                warnings.append("Limited revenue growth history")
            elif revenue_growth > 40:
                warnings.append("High growth potential but verify sustainability")

        # Promoter holding warnings
        if promoter_holding is not None:
            if promoter_holding < 40:
                warnings.append(
                    "Low promoter holding post-IPO may indicate dilution concerns"
                )
            elif promoter_holding > 75:
                warnings.append("Very high promoter holding limits public float")

        return ". ".join(warnings) + "."
