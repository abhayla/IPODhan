"""
Score Repository - Database Access Layer
Handles all score-related database operations using repository pattern
"""

import logging
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from repositories.db_config import DatabaseConfig
from algorithms.schemas import ScoreHistorySchema

logger = logging.getLogger(__name__)


class ScoreRepository:
    """
    Repository for score-related database operations
    All methods use parameterized queries for SQL injection prevention
    """

    def __init__(self):
        """Initialize repository"""
        logger.info("ScoreRepository initialized")

    def save_score_history(self, score_data: ScoreHistorySchema) -> str:
        """
        Insert score history record
        Returns: score history ID (UUID)
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                # Calculate score change from previous
                score_change = self.calculate_score_change(
                    score_data.ipo_id, score_data.total_score
                )

                insert_query = """
                    INSERT INTO score_history (
                        ipo_id, total_score, fundamental_score, sentiment_score,
                        subscription_score, sector_score, confidence_level,
                        algorithm_version, score_change, change_reason, calculated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """

                cursor.execute(
                    insert_query,
                    (
                        score_data.ipo_id,
                        score_data.total_score,
                        score_data.fundamental_score,
                        score_data.sentiment_score,
                        score_data.subscription_score,
                        score_data.sector_score,
                        score_data.confidence_level,
                        score_data.algorithm_version,
                        score_change,
                        score_data.change_reason,
                        score_data.calculated_at,
                    ),
                )

                score_id = cursor.fetchone()[0]
                conn.commit()

                logger.info(
                    f"Score history saved: {score_id} for IPO {score_data.ipo_id}"
                )
                return str(score_id)

        except Exception as e:
            logger.error(f"Failed to save score history: {e}")
            raise

    def get_score_history(self, ipo_id: str, days: int = 7) -> List[Dict]:
        """
        Retrieve historical scores for an IPO
        Args:
            ipo_id: IPO UUID
            days: Number of days to retrieve (default 7)
        Returns: List of score history records
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                cutoff_date = datetime.utcnow() - timedelta(days=days)

                query = """
                    SELECT
                        id, ipo_id, total_score, fundamental_score, sentiment_score,
                        subscription_score, sector_score, confidence_level,
                        algorithm_version, score_change, change_reason, calculated_at
                    FROM score_history
                    WHERE ipo_id = %s
                    AND calculated_at >= %s
                    ORDER BY calculated_at DESC
                """

                cursor.execute(query, (ipo_id, cutoff_date))
                rows = cursor.fetchall()

                # Convert to dict
                history = []
                for row in rows:
                    history.append(
                        {
                            "id": str(row[0]),
                            "ipo_id": str(row[1]),
                            "total_score": row[2],
                            "fundamental_score": row[3],
                            "sentiment_score": row[4],
                            "subscription_score": row[5],
                            "sector_score": row[6],
                            "confidence_level": row[7],
                            "algorithm_version": row[8],
                            "score_change": row[9],
                            "change_reason": row[10],
                            "calculated_at": row[11].isoformat() if row[11] else None,
                        }
                    )

                logger.info(
                    f"Retrieved {len(history)} score history records for IPO {ipo_id}"
                )
                return history

        except Exception as e:
            logger.error(f"Failed to get score history: {e}")
            raise

    def get_latest_score(self, ipo_id: str) -> Optional[Dict]:
        """
        Get latest score from materialized view
        Returns: Score dict or None if not found
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                query = """
                    SELECT
                        score_id, ipo_id, company_name, issue_type,
                        total_score, fundamental_score, sentiment_score,
                        subscription_score, sector_score, confidence_level,
                        algorithm_version, calculated_at, verdict, verdict_color
                    FROM current_ipo_scores
                    WHERE ipo_id = %s
                """

                cursor.execute(query, (ipo_id,))
                row = cursor.fetchone()

                if not row:
                    logger.warning(f"No score found for IPO {ipo_id}")
                    return None

                score = {
                    "score_id": str(row[0]),
                    "ipo_id": str(row[1]),
                    "company_name": row[2],
                    "issue_type": row[3],
                    "total_score": row[4],
                    "fundamental_score": row[5],
                    "sentiment_score": row[6],
                    "subscription_score": row[7],
                    "sector_score": row[8],
                    "confidence_level": row[9],
                    "algorithm_version": row[10],
                    "calculated_at": row[11].isoformat() if row[11] else None,
                    "verdict": row[12],
                    "verdict_color": row[13],
                }

                logger.info(
                    f"Retrieved latest score for IPO {ipo_id}: {score['total_score']}"
                )
                return score

        except Exception as e:
            logger.error(f"Failed to get latest score: {e}")
            raise

    def save_score_performance(self, performance_data: Dict) -> str:
        """
        Save score performance tracking data
        Args:
            performance_data: Dict with predicted_score, actual_listing_gain, prediction_accuracy
        Returns: performance record ID
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                insert_query = """
                    INSERT INTO score_performance (
                        ipo_id, predicted_score, actual_listing_gain, prediction_accuracy
                    ) VALUES (%s, %s, %s, %s)
                    RETURNING id
                """

                cursor.execute(
                    insert_query,
                    (
                        performance_data["ipo_id"],
                        performance_data["predicted_score"],
                        performance_data["actual_listing_gain"],
                        performance_data["prediction_accuracy"],
                    ),
                )

                perf_id = cursor.fetchone()[0]
                conn.commit()

                logger.info(
                    f"Score performance saved: {perf_id} for IPO {performance_data['ipo_id']}"
                )
                return str(perf_id)

        except Exception as e:
            logger.error(f"Failed to save score performance: {e}")
            raise

    def apply_manual_override(
        self, ipo_id: str, override_data: Dict, reason: str, authorized_by: str
    ) -> str:
        """
        Apply manual score override with audit trail
        Args:
            ipo_id: IPO UUID
            override_data: Dict with new score values
            reason: Reason for override
            authorized_by: User who authorized the override
        Returns: New score history ID
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                # Get current score
                current_score = self.get_latest_score(ipo_id)
                if not current_score:
                    raise ValueError(f"No existing score found for IPO {ipo_id}")

                # Create audit log entry
                audit_query = """
                    INSERT INTO score_history (
                        ipo_id, total_score, fundamental_score, sentiment_score,
                        subscription_score, sector_score, confidence_level,
                        algorithm_version, score_change, change_reason, calculated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """

                score_change = (
                    override_data.get("total_score", current_score["total_score"])
                    - current_score["total_score"]
                )
                change_reason = f"MANUAL OVERRIDE by {authorized_by}: {reason}"

                cursor.execute(
                    audit_query,
                    (
                        ipo_id,
                        override_data.get("total_score", current_score["total_score"]),
                        override_data.get(
                            "fundamental_score", current_score["fundamental_score"]
                        ),
                        override_data.get(
                            "sentiment_score", current_score["sentiment_score"]
                        ),
                        override_data.get(
                            "subscription_score", current_score["subscription_score"]
                        ),
                        override_data.get(
                            "sector_score", current_score["sector_score"]
                        ),
                        override_data.get(
                            "confidence_level", current_score["confidence_level"]
                        ),
                        "OVERRIDE",  # Simplified to fit VARCHAR(10)
                        score_change,
                        change_reason,
                        datetime.utcnow(),
                    ),
                )

                override_id = cursor.fetchone()[0]
                conn.commit()

                logger.warning(
                    f"Manual override applied for IPO {ipo_id} by {authorized_by}: "
                    f"{current_score['total_score']} -> {override_data.get('total_score')}. "
                    f"Reason: {reason}"
                )

                return str(override_id)

        except Exception as e:
            logger.error(f"Failed to apply manual override: {e}")
            raise

    def calculate_score_change(self, ipo_id: str, new_score: int) -> Optional[int]:
        """
        Calculate score change from previous score
        Returns: Score difference (new - previous) or None if no previous score
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                # Get most recent score
                query = """
                    SELECT total_score
                    FROM score_history
                    WHERE ipo_id = %s
                    ORDER BY calculated_at DESC
                    LIMIT 1
                """

                cursor.execute(query, (ipo_id,))
                row = cursor.fetchone()

                if row:
                    previous_score = row[0]
                    change = new_score - previous_score
                    return change
                else:
                    return None  # First score for this IPO

        except Exception as e:
            logger.error(f"Failed to calculate score change: {e}")
            return None

    def refresh_materialized_view(self):
        """Refresh current_ipo_scores materialized view"""
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT refresh_current_ipo_scores()")
                conn.commit()
                logger.info("Materialized view current_ipo_scores refreshed")

        except Exception as e:
            logger.error(f"Failed to refresh materialized view: {e}")
            raise

    def get_all_active_ipo_ids(self) -> List[str]:
        """
        Get all active IPO IDs for score calculation
        Returns IPOs with status UPCOMING, LIVE, or CLOSED within 30 days
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                query = """
                    SELECT DISTINCT id.id
                    FROM ipo_details id
                    INNER JOIN ipos i ON id.ipo_id = i.id
                    WHERE i.status IN ('UPCOMING', 'LIVE', 'CLOSED')
                    AND (
                        i.listing_date IS NULL
                        OR i.listing_date >= CURRENT_DATE - INTERVAL '30 days'
                    )
                """

                cursor.execute(query)
                rows = cursor.fetchall()

                ipo_ids = [str(row[0]) for row in rows]
                logger.info(f"Retrieved {len(ipo_ids)} active IPO IDs")
                return ipo_ids

        except Exception as e:
            logger.error(f"Failed to get active IPO IDs: {e}")
            raise
