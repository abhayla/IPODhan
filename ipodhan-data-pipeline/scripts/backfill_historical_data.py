"""
Historical Data Backfill Script
Backfills IPO and GMP historical data for last 2 years
AC8: Historical data backfill implementation
"""

import asyncio
import logging
import sys
import os
from datetime import datetime, timedelta
from typing import List, Dict, Any

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from orchestrator.pipeline import DataPipeline
from repositories.ipo_data_repository import IPODataRepository

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class HistoricalDataBackfill:
    """
    Backfill historical IPO and GMP data
    AC8: Backfill logic with progress tracking and resumability
    """

    def __init__(self):
        self.pipeline = DataPipeline()
        self.repository = IPODataRepository()
        self.backfill_start_date = datetime.now() - timedelta(days=730)  # 2 years
        self.progress_file = "backfill_progress.txt"

    def save_progress(self, checkpoint: str):
        """Save progress checkpoint for resumability"""
        try:
            with open(self.progress_file, "w") as f:
                f.write(f"{checkpoint}\n{datetime.now().isoformat()}")
            logger.info(f"Progress saved: {checkpoint}")
        except Exception as e:
            logger.error(f"Failed to save progress: {str(e)}")

    def load_progress(self) -> str:
        """Load last checkpoint"""
        try:
            if os.path.exists(self.progress_file):
                with open(self.progress_file, "r") as f:
                    checkpoint = f.readline().strip()
                    logger.info(f"Resuming from checkpoint: {checkpoint}")
                    return checkpoint
        except Exception as e:
            logger.error(f"Failed to load progress: {str(e)}")

        return "START"

    async def backfill_ipo_data(self):
        """
        Backfill historical IPO data
        AC8: Scrape historical IPOs (last 2 years)
        """
        logger.info("Starting IPO historical data backfill")
        logger.info(
            f"Backfill period: {self.backfill_start_date.strftime('%Y-%m-%d')} to present"
        )

        checkpoint = self.load_progress()

        try:
            if checkpoint in ["START", "IPO_PENDING"]:
                logger.info("Running full IPO pipeline to capture all available IPOs")

                # Run regular pipeline - it will scrape current and recent IPOs
                await self.pipeline.run_ipo_pipeline()

                self.save_progress("IPO_COMPLETED")
                logger.info("IPO backfill completed")

            else:
                logger.info("IPO backfill already completed, skipping")

        except Exception as e:
            logger.error(f"Error during IPO backfill: {str(e)}", exc_info=True)
            self.save_progress("IPO_PENDING")
            raise

    async def backfill_gmp_data(self):
        """
        Backfill historical GMP data
        AC8: Backfill GMP historical data where available
        """
        logger.info("Starting GMP historical data backfill")

        checkpoint = self.load_progress()

        try:
            if checkpoint in ["START", "IPO_COMPLETED", "GMP_PENDING"]:
                logger.info("Running GMP pipeline for all active IPOs")

                # Run regular GMP pipeline
                await self.pipeline.run_gmp_pipeline()

                self.save_progress("GMP_COMPLETED")
                logger.info("GMP backfill completed")

            else:
                logger.info("GMP backfill already completed, skipping")

        except Exception as e:
            logger.error(f"Error during GMP backfill: {str(e)}", exc_info=True)
            self.save_progress("GMP_PENDING")
            raise

    async def run_full_backfill(self):
        """
        Run complete backfill process
        AC8: Backfill historical data with progress tracking
        """
        logger.info("=" * 60)
        logger.info("Starting Historical Data Backfill")
        logger.info("=" * 60)

        start_time = datetime.now()

        try:
            # Step 1: Backfill IPO data
            await self.backfill_ipo_data()

            # Wait a bit between operations
            await asyncio.sleep(5)

            # Step 2: Backfill GMP data
            await self.backfill_gmp_data()

            # Mark as complete
            self.save_progress("COMPLETED")

            # Calculate statistics
            await self._print_backfill_statistics()

            execution_time = (datetime.now() - start_time).total_seconds()
            logger.info("=" * 60)
            logger.info(
                f"Backfill completed successfully in {execution_time:.2f} seconds"
            )
            logger.info("=" * 60)

        except Exception as e:
            logger.error(f"Backfill failed: {str(e)}", exc_info=True)
            raise

    async def _print_backfill_statistics(self):
        """Print backfill statistics"""
        try:
            # Get IPO count
            ipos = self.repository.get_all_active_ipos()
            logger.info(f"Total IPOs in database: {len(ipos)}")

            # Get GMP statistics from database
            from repositories.db_config import get_db_connection
            from psycopg2.extras import RealDictCursor

            with get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    # Count GMP records
                    cursor.execute("SELECT COUNT(*) as count FROM gmp_tracking")
                    gmp_count = cursor.fetchone()["count"]

                    # Count IPOs with GMP data
                    cursor.execute(
                        "SELECT COUNT(DISTINCT ipo_id) as count FROM gmp_tracking"
                    )
                    ipos_with_gmp = cursor.fetchone()["count"]

                    logger.info(f"Total GMP records: {gmp_count}")
                    logger.info(f"IPOs with GMP data: {ipos_with_gmp}")

        except Exception as e:
            logger.warning(f"Failed to print statistics: {str(e)}")

    def reset_progress(self):
        """Reset backfill progress (for re-running)"""
        if os.path.exists(self.progress_file):
            os.remove(self.progress_file)
            logger.info("Progress reset")


async def main():
    """Main entry point for backfill script"""

    # Parse command line arguments
    reset = "--reset" in sys.argv

    backfill = HistoricalDataBackfill()

    if reset:
        logger.info("Resetting backfill progress")
        backfill.reset_progress()

    await backfill.run_full_backfill()


if __name__ == "__main__":
    # Load environment variables
    from dotenv import load_dotenv

    load_dotenv()

    # Run backfill
    asyncio.run(main())
