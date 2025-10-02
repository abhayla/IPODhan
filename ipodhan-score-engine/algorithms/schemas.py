"""
IPO Scoring Engine - Pydantic Schemas
Type-safe data models for score calculations
"""

from pydantic import BaseModel, ConfigDict, Field
from datetime import datetime, timezone
from typing import Literal, Optional, List


class ScoreComponents(BaseModel):
    """Component scores breakdown"""

    model_config = ConfigDict(validate_assignment=True)

    fundamental: int = Field(ge=0, le=40, description="Fundamentals score (max 40)")
    sentiment: int = Field(ge=0, le=30, description="Market sentiment score (max 30)")
    subscription: int = Field(ge=0, le=20, description="Subscription score (max 20)")
    sector: int = Field(ge=0, le=10, description="Sector timing score (max 10)")


class IPOScoreSchema(BaseModel):
    """Complete IPO score with breakdown"""

    model_config = ConfigDict(validate_assignment=True)

    ipo_id: str = Field(description="IPO UUID")
    total_score: int = Field(ge=0, le=100, description="Total score (0-100)")
    components: ScoreComponents
    verdict: Literal["APPLY", "CONSIDER", "SKIP"] = Field(
        description="Investment verdict"
    )
    verdict_label: str = Field(
        description="Human-readable verdict (Strong Buy, Consider, Risky, Avoid)"
    )
    verdict_color: str = Field(description="Hex color code for verdict")
    confidence: Literal["HIGH", "MEDIUM", "LOW"] = Field(
        description="Data quality confidence"
    )
    reasoning: str = Field(description="Explanation of score")
    strengths: List[str] = Field(default_factory=list, description="Key strengths")
    weaknesses: List[str] = Field(default_factory=list, description="Key weaknesses")
    key_factors: List[str] = Field(
        default_factory=list, description="Important factors"
    )
    algorithm_version: str = Field(default="1.0", description="Algorithm version")
    is_sme: bool = Field(default=False, description="Is SME category IPO")
    sme_warning: Optional[str] = Field(default=None, description="SME-specific warning")
    calculated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class IPODataInput(BaseModel):
    """Input data for score calculation"""

    model_config = ConfigDict(validate_assignment=True)

    ipo_id: str
    company_name: str
    issue_type: Optional[str] = None
    category: Optional[str] = None  # SME, MAINLINE

    # Fundamentals data
    pe_ratio: Optional[float] = None
    industry_pe: Optional[float] = None
    revenue_fy1: Optional[float] = None
    revenue_fy2: Optional[float] = None
    revenue_fy3: Optional[float] = None
    profit_fy1: Optional[float] = None
    profit_fy2: Optional[float] = None
    profit_fy3: Optional[float] = None
    debt_to_equity: Optional[float] = None
    roe: Optional[float] = None
    roce: Optional[float] = None
    cash_flow: Optional[float] = None

    # Sentiment data
    current_gmp_percent: Optional[float] = None
    gmp_7day_trend: Optional[str] = None  # 'increasing', 'stable', 'decreasing'
    watchlist_additions_7d: Optional[int] = None
    social_buzz_score: Optional[int] = None
    crowd_prediction_avg: Optional[float] = None
    search_trend_score: Optional[int] = None

    # Subscription data
    qib_subscription: Optional[float] = None
    hni_subscription: Optional[float] = None
    retail_subscription: Optional[float] = None
    subscription_momentum: Optional[str] = None  # 'increasing', 'stable', 'decreasing'

    # Sector data
    sector: Optional[str] = None
    sector_performance_30d: Optional[float] = None
    peer_avg_pe: Optional[float] = None
    market_condition: Optional[str] = None  # 'bullish', 'neutral', 'bearish'
    ipo_pipeline_count: Optional[int] = None

    # SME-specific
    post_ipo_promoter_holding: Optional[float] = None
    revenue_growth_3y: Optional[float] = None


class ScoreHistorySchema(BaseModel):
    """Score history database schema"""

    model_config = ConfigDict(validate_assignment=True)

    id: Optional[str] = None
    ipo_id: str
    total_score: int = Field(ge=0, le=100)
    fundamental_score: int = Field(ge=0, le=40)
    sentiment_score: int = Field(ge=0, le=30)
    subscription_score: int = Field(ge=0, le=20)
    sector_score: int = Field(ge=0, le=10)
    confidence_level: Literal["HIGH", "MEDIUM", "LOW"]
    algorithm_version: str = "1.0"
    score_change: Optional[int] = None
    change_reason: Optional[str] = None
    calculated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
