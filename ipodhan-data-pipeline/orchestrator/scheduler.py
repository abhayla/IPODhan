"""
Pipeline Scheduler
Schedules and coordinates pipeline execution based on market hours
AC6: Scheduling logic implementation
"""

import logging
import asyncio
import os
from datetime import datetime, time as dt_time
from typing import Callable

from orchestrator.pipeline import DataPipeline

logger = logging.getLogger(__name__)


class PipelineScheduler:
    """
    Scheduler for IPO data pipeline
    Implements market hours-based scheduling from AC6
    """

    def __init__(self):
        self.pipeline = DataPipeline()

        # Load configuration from environment
        self.ipo_interval = int(os.getenv('IPO_SCRAPE_INTERVAL', 15))  # minutes
        self.gmp_interval_market = int(os.getenv('GMP_SCRAPE_INTERVAL_MARKET', 30))  # minutes
        self.gmp_interval_offhours = int(os.getenv('GMP_SCRAPE_INTERVAL_OFFHOURS', 60))  # minutes

        # Market hours (IST)
        market_start = os.getenv('MARKET_HOURS_START', '09:00')
        market_end = os.getenv('MARKET_HOURS_END', '17:00')

        self.market_start = self._parse_time(market_start)
        self.market_end = self._parse_time(market_end)

        logger.info(
            f"Scheduler initialized: "
            f"IPO interval={self.ipo_interval}min, "
            f"GMP market={self.gmp_interval_market}min, "
            f"GMP off-hours={self.gmp_interval_offhours}min, "
            f"market hours={market_start}-{market_end}"
        )

    def _parse_time(self, time_str: str) -> dt_time:
        """Parse time string HH:MM to datetime.time"""
        try:
            hour, minute = map(int, time_str.split(':'))
            return dt_time(hour=hour, minute=minute)
        except Exception as e:
            logger.error(f"Error parsing time '{time_str}': {str(e)}")
            return dt_time(hour=9, minute=0)  # Default to 9 AM

    def is_market_hours(self) -> bool:
        """Check if current time is within market hours"""
        now = datetime.now().time()
        return self.market_start <= now <= self.market_end

    async def run_scheduled_pipelines(self):
        """
        Run pipelines on schedule
        AC6: Market hours schedule implementation
        """
        logger.info("Starting scheduled pipeline execution")

        # Counters for tracking intervals
        ipo_counter = 0
        gmp_counter = 0

        while True:
            try:
                current_time = datetime.now()
                is_market_hours = self.is_market_hours()

                logger.info(
                    f"Scheduler tick at {current_time.strftime('%H:%M:%S')} "
                    f"(market_hours={is_market_hours})"
                )

                # IPO pipeline (every 15 min during market hours)
                if is_market_hours and ipo_counter % self.ipo_interval == 0:
                    logger.info("Triggering IPO pipeline")
                    await self.pipeline.run_ipo_pipeline()

                # GMP pipeline (interval depends on market hours)
                gmp_interval = self.gmp_interval_market if is_market_hours else self.gmp_interval_offhours

                if gmp_counter % gmp_interval == 0:
                    logger.info("Triggering GMP pipeline")
                    await self.pipeline.run_gmp_pipeline()

                # Increment counters
                ipo_counter += 1
                gmp_counter += 1

                # Reset counters to prevent overflow (every 24 hours = 1440 minutes)
                if ipo_counter >= 1440:
                    ipo_counter = 0
                if gmp_counter >= 1440:
                    gmp_counter = 0

                # Wait 1 minute before next tick
                await asyncio.sleep(60)

            except Exception as e:
                logger.error(f"Error in scheduler loop: {str(e)}", exc_info=True)
                # Continue running despite errors
                await asyncio.sleep(60)

    async def run_ipo_pipeline_once(self):
        """Run IPO pipeline once (for manual execution)"""
        logger.info("Manual IPO pipeline execution")
        await self.pipeline.run_ipo_pipeline()

    async def run_gmp_pipeline_once(self):
        """Run GMP pipeline once (for manual execution)"""
        logger.info("Manual GMP pipeline execution")
        await self.pipeline.run_gmp_pipeline()

    async def run_full_pipeline_once(self):
        """Run full pipeline once (for manual execution)"""
        logger.info("Manual full pipeline execution")
        await self.pipeline.run_full_pipeline()


async def main():
    """Main entry point for scheduler"""
    scheduler = PipelineScheduler()

    # Check if running in manual mode
    import sys
    if len(sys.argv) > 1:
        mode = sys.argv[1]

        if mode == 'ipo':
            await scheduler.run_ipo_pipeline_once()
        elif mode == 'gmp':
            await scheduler.run_gmp_pipeline_once()
        elif mode == 'full':
            await scheduler.run_full_pipeline_once()
        else:
            logger.error(f"Unknown mode: {mode}. Use: ipo, gmp, or full")
    else:
        # Run scheduled pipelines
        await scheduler.run_scheduled_pipelines()


if __name__ == "__main__":
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    # Run scheduler
    asyncio.run(main())
