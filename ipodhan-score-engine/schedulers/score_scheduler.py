"""
Score Calculation Scheduler
Automatically calculates scores 3x daily (9 AM, 1 PM, 5 PM IST)
"""

import os
import logging
import schedule
import time
from datetime import datetime
from typing import List
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Import components
from repositories import ScoreRepository, DatabaseConfig
from repositories.db_config import DatabaseConfig as DB
from repositories.ipo_data_fetcher import IPODataFetcher
from algorithms import IPOScoringEngine, IPODataInput
from algorithms.sme_adjuster import SMEAdjuster
from algorithms.schemas import ScoreHistorySchema


class ScoreScheduler:
    """
    Scheduler for automated score calculations
    Runs at configured times (default: 9 AM, 1 PM, 5 PM IST)
    """

    def __init__(self):
        """Initialize scheduler"""
        self.repository = ScoreRepository()
        self.data_fetcher = IPODataFetcher()
        self.scoring_engine = IPOScoringEngine()
        self.sme_adjuster = SMEAdjuster()

        # Parse calculation times from environment
        times_str = os.getenv("SCORE_CALCULATION_TIMES", "09:00,13:00,17:00")
        self.calculation_times = [t.strip() for t in times_str.split(",")]

        logger.info(
            f"ScoreScheduler initialized with calculation times: {self.calculation_times}"
        )

    def calculate_all_scores(self):
        """
        Calculate scores for all active IPOs
        Active = UPCOMING, LIVE, or CLOSED within 30 days
        """
        logger.info("=" * 60)
        logger.info("Starting scheduled score calculation")
        logger.info("=" * 60)

        start_time = time.time()
        stats = {"total": 0, "success": 0, "failed": 0, "errors": []}

        try:
            # Get all active IPO IDs
            ipo_ids = self.data_fetcher.fetch_all_active_ipos()
            stats["total"] = len(ipo_ids)

            logger.info(f"Found {len(ipo_ids)} active IPOs to score")

            # Calculate score for each IPO
            for ipo_id in ipo_ids:
                try:
                    self._calculate_single_score(ipo_id)
                    stats["success"] += 1

                except Exception as e:
                    stats["failed"] += 1
                    error_msg = f"Failed to calculate score for IPO {ipo_id}: {str(e)}"
                    stats["errors"].append(error_msg)
                    logger.error(error_msg)

            # Refresh materialized view
            try:
                self.repository.refresh_materialized_view()
                logger.info("Materialized view refreshed")
            except Exception as e:
                logger.error(f"Failed to refresh materialized view: {e}")

            # Log summary
            execution_time = time.time() - start_time
            logger.info("=" * 60)
            logger.info(f"Score calculation complete:")
            logger.info(f"  Total IPOs: {stats['total']}")
            logger.info(f"  Success: {stats['success']}")
            logger.info(f"  Failed: {stats['failed']}")
            logger.info(f"  Execution time: {execution_time:.2f}s")
            logger.info("=" * 60)

        except Exception as e:
            logger.error(f"Score calculation failed: {e}", exc_info=True)

    def _calculate_single_score(self, ipo_id: str):
        """
        Calculate score for a single IPO
        Fetches data from database, calculates score, saves to history
        """
        logger.debug(f"Calculating score for IPO {ipo_id}")

        # Fetch IPO data from database
        ipo_data = self.data_fetcher.fetch_ipo_for_scoring(ipo_id)
        if not ipo_data:
            logger.warning(f"No data found for IPO {ipo_id}, skipping")
            return

        # Calculate base score
        base_score = self.scoring_engine.calculate_score(ipo_data)

        # Apply SME adjustments if needed
        if ipo_data.category and ipo_data.category.upper() == "SME":
            final_score, adjustment_reason = self.sme_adjuster.adjust_for_sme(
                base_score, ipo_data
            )
            logger.debug(f"Applied SME adjustments: {adjustment_reason}")
        else:
            final_score = base_score

        # Get previous score for change tracking
        previous_score = self.repository.get_latest_score(ipo_id)
        score_change = None
        change_reason = None

        if previous_score:
            score_change = final_score.total_score - previous_score.get(
                "total_score", 0
            )
            if abs(score_change) >= 5:  # Only track significant changes
                change_reason = f"Score changed by {score_change:+d} points"

        # Save to score_history
        score_history = ScoreHistorySchema(
            ipo_id=ipo_id,
            total_score=final_score.total_score,
            fundamental_score=final_score.components.fundamental,
            sentiment_score=final_score.components.sentiment,
            subscription_score=final_score.components.subscription,
            sector_score=final_score.components.sector,
            confidence_level=final_score.confidence,
            algorithm_version=final_score.algorithm_version,
            score_change=score_change,
            change_reason=change_reason,
        )
        self.repository.save_score_history(score_history)

        logger.info(
            f"Score calculated for {ipo_data.company_name}: {final_score.total_score}/100 ({final_score.verdict})"
        )
        if score_change and abs(score_change) >= 5:
            logger.info(f"  Score change: {score_change:+d} ({change_reason})")

    def start(self):
        """
        Start the scheduler
        Runs indefinitely until interrupted
        """
        logger.info("Starting score calculation scheduler")

        # Schedule calculations at specified times
        for calc_time in self.calculation_times:
            schedule.every().day.at(calc_time).do(self.calculate_all_scores)
            logger.info(f"Scheduled score calculation at {calc_time}")

        # Run scheduler loop
        logger.info("Scheduler running (press Ctrl+C to stop)")
        try:
            while True:
                schedule.run_pending()
                time.sleep(60)  # Check every minute

        except KeyboardInterrupt:
            logger.info("Scheduler stopped by user")

        finally:
            # Cleanup
            DB.close_pool()
            logger.info("Scheduler shutdown complete")


def main():
    """Main entry point"""
    # Initialize database pool
    DatabaseConfig.initialize_pool()

    # Create and start scheduler
    scheduler = ScoreScheduler()
    scheduler.start()


if __name__ == "__main__":
    main()
