"""
IPO Data Fetcher Repository
Fetches comprehensive IPO data from database for scoring engine
Integrates with Story 1.2 data pipeline tables
"""

import logging
from typing import Optional, List
from datetime import datetime, timedelta
from psycopg2.extras import RealDictCursor

from repositories.db_config import get_db_connection
from algorithms.schemas import IPODataInput

logger = logging.getLogger(__name__)


class IPODataFetcher:
    """
    Repository for fetching IPO data from database
    Maps database schema to IPODataInput schema for scoring engine
    """

    def __init__(self):
        pass

    def fetch_ipo_for_scoring(self, ipo_id: str) -> Optional[IPODataInput]:
        """
        Fetch complete IPO data for scoring calculation

        Args:
            ipo_id: UUID of the IPO

        Returns:
            IPODataInput object with all available data, or None if IPO not found
        """
        try:
            with get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    # Fetch core IPO data with details and financials
                    cursor.execute(
                        """
                        SELECT
                            i.id as ipo_id,
                            i.company_name,
                            i.symbol,
                            i.category,
                            i.price_band_high,
                            i.open_date,
                            i.close_date,
                            i.listing_date,
                            i.status,

                            -- IPO Details
                            id.isin,
                            id.fresh_issue,
                            id.ofs_issue,
                            id.face_value,
                            id.data_source,

                            -- IPO Financials
                            f.revenue_fy1,
                            f.revenue_fy2,
                            f.revenue_fy3,
                            f.profit_fy1,
                            f.profit_fy2,
                            f.profit_fy3,
                            f.pe_ratio,
                            f.pb_ratio,
                            f.roe_percentage,
                            f.roce_percentage,
                            f.debt_to_equity,
                            f.industry_pe,
                            f.peer_companies

                        FROM ipos i
                        LEFT JOIN ipo_details id ON i.id = id.ipo_id
                        LEFT JOIN ipo_financials f ON i.id = f.ipo_id
                        WHERE i.id = %s
                        """,
                        (ipo_id,),
                    )

                    ipo_row = cursor.fetchone()
                    if not ipo_row:
                        logger.warning(f"IPO not found: {ipo_id}")
                        return None

                    # Fetch latest GMP data
                    gmp_data = self._fetch_latest_gmp(cursor, ipo_id)

                    # Fetch subscription data
                    subscription_data = self._fetch_latest_subscription(cursor, ipo_id)

                    # Fetch GMP trend (last 7 days)
                    gmp_trend = self._calculate_gmp_trend(cursor, ipo_id)

                    # Fetch watchlist count (last 7 days)
                    watchlist_count = self._fetch_watchlist_additions(cursor, ipo_id)

                    # Calculate sector metrics
                    sector_data = self._fetch_sector_data(cursor, ipo_row)

                    # Map to IPODataInput schema
                    ipo_data = IPODataInput(
                        ipo_id=str(ipo_row["ipo_id"]),
                        company_name=ipo_row["company_name"],
                        symbol=ipo_row.get("symbol"),
                        category=ipo_row.get("category", "MAINLINE"),
                        # Fundamentals - Financial Metrics
                        pe_ratio=(
                            float(ipo_row["pe_ratio"])
                            if ipo_row.get("pe_ratio")
                            else None
                        ),
                        industry_pe=(
                            float(ipo_row["industry_pe"])
                            if ipo_row.get("industry_pe")
                            else None
                        ),
                        revenue_fy1=(
                            float(ipo_row["revenue_fy1"])
                            if ipo_row.get("revenue_fy1")
                            else None
                        ),
                        revenue_fy2=(
                            float(ipo_row["revenue_fy2"])
                            if ipo_row.get("revenue_fy2")
                            else None
                        ),
                        revenue_fy3=(
                            float(ipo_row["revenue_fy3"])
                            if ipo_row.get("revenue_fy3")
                            else None
                        ),
                        profit_fy1=(
                            float(ipo_row["profit_fy1"])
                            if ipo_row.get("profit_fy1")
                            else None
                        ),
                        profit_fy2=(
                            float(ipo_row["profit_fy2"])
                            if ipo_row.get("profit_fy2")
                            else None
                        ),
                        profit_fy3=(
                            float(ipo_row["profit_fy3"])
                            if ipo_row.get("profit_fy3")
                            else None
                        ),
                        debt_to_equity=(
                            float(ipo_row["debt_to_equity"])
                            if ipo_row.get("debt_to_equity")
                            else None
                        ),
                        roe=(
                            float(ipo_row["roe_percentage"])
                            if ipo_row.get("roe_percentage")
                            else None
                        ),
                        # Calculate revenue growth (3-year CAGR)
                        revenue_growth_3y=(
                            self._calculate_cagr(
                                ipo_row.get("revenue_fy1"),
                                ipo_row.get("revenue_fy3"),
                                years=2,
                            )
                            if ipo_row.get("revenue_fy1") and ipo_row.get("revenue_fy3")
                            else None
                        ),
                        # Calculate cash flow proxy (profit trend)
                        cash_flow=(
                            float(ipo_row["profit_fy3"])
                            if ipo_row.get("profit_fy3")
                            else None
                        ),
                        # Issue details for promoter holding calculation
                        # Note: promoter holding not in current schema, will default to None
                        post_ipo_promoter_holding=None,  # TODO: Add to schema if available
                        # Sentiment - GMP Data
                        current_gmp_percent=(
                            gmp_data.get("gmp_percentage") if gmp_data else None
                        ),
                        gmp_7day_trend=gmp_trend,
                        # Sentiment - Crowd metrics
                        watchlist_additions_7d=watchlist_count,
                        crowd_prediction_avg=None,  # TODO: Implement user prediction tracking
                        # Subscription Data
                        qib_subscription=(
                            subscription_data.get("QIB") if subscription_data else None
                        ),
                        hni_subscription=(
                            subscription_data.get("NII") if subscription_data else None
                        ),
                        retail_subscription=(
                            subscription_data.get("RETAIL")
                            if subscription_data
                            else None
                        ),
                        subscription_momentum=self._calculate_subscription_momentum(
                            cursor, ipo_id
                        ),
                        # Sector Timing
                        sector=sector_data.get("sector", "General"),
                        sector_performance_30d=sector_data.get("performance_30d"),
                        peer_avg_pe=sector_data.get("peer_avg_pe"),
                        market_condition=self._determine_market_condition(cursor),
                        ipo_pipeline_count=sector_data.get("pipeline_count", 0),
                    )

                    logger.info(
                        f"Fetched IPO data for scoring: {ipo_id} ({ipo_row['company_name']})"
                    )
                    return ipo_data

        except Exception as e:
            logger.error(
                f"Error fetching IPO data for scoring: {str(e)}", exc_info=True
            )
            return None

    def fetch_all_active_ipos(self) -> List[str]:
        """
        Fetch IDs of all active IPOs that need scoring

        Returns:
            List of IPO IDs (UUIDs as strings)
        """
        try:
            with get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute(
                        """
                        SELECT id FROM ipos
                        WHERE status IN ('UPCOMING', 'LIVE')
                        ORDER BY open_date ASC
                        """
                    )
                    results = cursor.fetchall()
                    return [str(row["id"]) for row in results]

        except Exception as e:
            logger.error(f"Error fetching active IPOs: {str(e)}", exc_info=True)
            return []

    def _fetch_latest_gmp(self, cursor, ipo_id: str) -> Optional[dict]:
        """Fetch latest GMP data from gmp_current materialized view"""
        cursor.execute(
            """
            SELECT
                avg_gmp_percentage,
                avg_gmp_amount,
                avg_confidence_score,
                last_updated_at
            FROM gmp_current
            WHERE ipo_id = %s
            """,
            (ipo_id,),
        )
        result = cursor.fetchone()
        return (
            {
                "gmp_percentage": (
                    float(result["avg_gmp_percentage"])
                    if result and result.get("avg_gmp_percentage")
                    else None
                ),
                "gmp_amount": (
                    float(result["avg_gmp_amount"])
                    if result and result.get("avg_gmp_amount")
                    else None
                ),
                "confidence": (
                    float(result["avg_confidence_score"])
                    if result and result.get("avg_confidence_score")
                    else None
                ),
            }
            if result
            else None
        )

    def _fetch_latest_subscription(self, cursor, ipo_id: str) -> Optional[dict]:
        """Fetch latest subscription data by category"""
        cursor.execute(
            """
            WITH latest_subscription AS (
                SELECT
                    category,
                    subscription_times,
                    ROW_NUMBER() OVER (PARTITION BY category ORDER BY recorded_at DESC) as rn
                FROM subscription_data
                WHERE ipo_id = %s
            )
            SELECT category, subscription_times
            FROM latest_subscription
            WHERE rn = 1
            """,
            (ipo_id,),
        )
        results = cursor.fetchall()
        return (
            {row["category"]: float(row["subscription_times"]) for row in results}
            if results
            else None
        )

    def _calculate_gmp_trend(self, cursor, ipo_id: str) -> Optional[str]:
        """Calculate GMP trend over last 7 days"""
        cursor.execute(
            """
            WITH gmp_7day AS (
                SELECT
                    gmp_percentage,
                    recorded_at,
                    LAG(gmp_percentage) OVER (ORDER BY recorded_at) as prev_gmp
                FROM gmp_tracking
                WHERE ipo_id = %s
                AND recorded_at >= NOW() - INTERVAL '7 days'
                ORDER BY recorded_at DESC
                LIMIT 10
            )
            SELECT
                AVG(gmp_percentage - prev_gmp) as avg_change
            FROM gmp_7day
            WHERE prev_gmp IS NOT NULL
            """,
            (ipo_id,),
        )
        result = cursor.fetchone()
        if result and result["avg_change"] is not None:
            avg_change = float(result["avg_change"])
            if avg_change > 1:
                return "increasing"
            elif avg_change < -1:
                return "decreasing"
            else:
                return "stable"
        return None

    def _fetch_watchlist_additions(self, cursor, ipo_id: str) -> int:
        """Fetch watchlist additions in last 7 days"""
        cursor.execute(
            """
            SELECT COUNT(*) as count
            FROM user_watchlist
            WHERE ipo_id = %s
            AND added_at >= NOW() - INTERVAL '7 days'
            """,
            (ipo_id,),
        )
        result = cursor.fetchone()
        return int(result["count"]) if result else 0

    def _calculate_subscription_momentum(self, cursor, ipo_id: str) -> Optional[str]:
        """Calculate subscription momentum (increasing/decreasing/stable)"""
        cursor.execute(
            """
            WITH sub_changes AS (
                SELECT
                    subscription_times,
                    recorded_at,
                    LAG(subscription_times) OVER (ORDER BY recorded_at) as prev_subscription
                FROM subscription_data
                WHERE ipo_id = %s
                ORDER BY recorded_at DESC
                LIMIT 5
            )
            SELECT
                AVG(subscription_times - prev_subscription) as avg_change
            FROM sub_changes
            WHERE prev_subscription IS NOT NULL
            """,
            (ipo_id,),
        )
        result = cursor.fetchone()
        if result and result["avg_change"] is not None:
            avg_change = float(result["avg_change"])
            if avg_change > 0.5:
                return "increasing"
            elif avg_change < -0.5:
                return "decreasing"
            else:
                return "stable"
        return None

    def _fetch_sector_data(self, cursor, ipo_row: dict) -> dict:
        """
        Fetch sector-related data
        Note: Sector classification not in current schema, using placeholders
        """
        sector_data = {
            "sector": "General",  # TODO: Add sector classification to database
            "performance_30d": None,  # TODO: Integrate with market data API
            "peer_avg_pe": None,
            "pipeline_count": 0,
        }

        # Calculate peer average PE if peer companies available
        if ipo_row.get("peer_companies"):
            cursor.execute(
                """
                SELECT AVG(f.pe_ratio) as avg_pe
                FROM ipo_financials f
                JOIN ipos i ON f.ipo_id = i.id
                WHERE i.company_name = ANY(%s)
                """,
                (ipo_row["peer_companies"],),
            )
            result = cursor.fetchone()
            if result and result["avg_pe"]:
                sector_data["peer_avg_pe"] = float(result["avg_pe"])

        # Count IPOs in pipeline (upcoming/live)
        cursor.execute(
            """
            SELECT COUNT(*) as count
            FROM ipos
            WHERE status IN ('UPCOMING', 'LIVE')
            """
        )
        result = cursor.fetchone()
        sector_data["pipeline_count"] = int(result["count"]) if result else 0

        return sector_data

    def _determine_market_condition(self, cursor) -> str:
        """
        Determine overall market condition based on recent IPO performance
        Returns: 'bullish', 'neutral', 'bearish'
        """
        # Simple heuristic: Check GMP trends of recent IPOs
        cursor.execute(
            """
            SELECT AVG(avg_gmp_percentage) as avg_market_gmp
            FROM gmp_current gc
            JOIN ipos i ON gc.ipo_id = i.id
            WHERE i.status IN ('LIVE', 'UPCOMING')
            """
        )
        result = cursor.fetchone()

        if result and result["avg_market_gmp"]:
            avg_gmp = float(result["avg_market_gmp"])
            if avg_gmp > 20:
                return "bullish"
            elif avg_gmp < 5:
                return "bearish"

        return "neutral"

    def _calculate_cagr(
        self, start_value: float, end_value: float, years: int
    ) -> float:
        """Calculate Compound Annual Growth Rate"""
        if not start_value or not end_value or start_value <= 0:
            return 0.0
        return ((end_value / start_value) ** (1 / years) - 1) * 100
