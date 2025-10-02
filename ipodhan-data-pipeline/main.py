"""
IPODhan Data Pipeline Main Entry Point
Provides CLI interface for running the pipeline
"""

import os
import sys
import asyncio
import logging
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Initialize Sentry if configured
sentry_dsn = os.getenv("SENTRY_DSN")
if sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(dsn=sentry_dsn, traces_sample_rate=0.1)
    logger.info("Sentry error tracking initialized")

from orchestrator.pipeline import DataPipeline
from orchestrator.scheduler import PipelineScheduler
from monitoring.health_check import HealthCheckMonitor
from monitoring.metrics import DataQualityMetrics


def print_usage():
    """Print CLI usage information"""
    print(
        """
IPODhan Data Pipeline - Command Line Interface

Usage:
    python main.py [command]

Commands:
    schedule        - Run scheduled pipeline (default, runs continuously)
    run-ipo         - Run IPO pipeline once
    run-gmp         - Run GMP pipeline once
    run-full        - Run full pipeline (IPO + GMP) once
    health-check    - Run health check and display status
    metrics         - Generate and display weekly metrics report
    backfill        - Run historical data backfill (see scripts/backfill_historical_data.py)

Examples:
    python main.py                  # Start scheduled pipeline
    python main.py run-ipo          # Run IPO scraping once
    python main.py health-check     # Check pipeline health
    python main.py metrics          # View weekly report

Environment Variables:
    Set in .env file or environment:
    - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
    - SENTRY_DSN (optional)
    - IPO_SCRAPE_INTERVAL (default: 15 minutes)
    - GMP_SCRAPE_INTERVAL_MARKET (default: 30 minutes)
    - MARKET_HOURS_START, MARKET_HOURS_END (default: 09:00-17:00)
    """
    )


async def main():
    """Main entry point for the data pipeline"""
    logger.info("=" * 60)
    logger.info("IPODhan Data Pipeline Starting")
    logger.info("=" * 60)
    logger.info(f"Python Version: {sys.version.split()[0]}")
    logger.info(f"Environment: {os.getenv('ENVIRONMENT', 'development')}")
    logger.info("=" * 60)

    # Parse command line arguments
    command = sys.argv[1] if len(sys.argv) > 1 else "schedule"

    try:
        if command == "help" or command == "--help" or command == "-h":
            print_usage()
            return

        elif command == "schedule":
            logger.info("Starting scheduled pipeline")
            scheduler = PipelineScheduler()
            await scheduler.run_scheduled_pipelines()

        elif command == "run-ipo":
            logger.info("Running IPO pipeline once")
            pipeline = DataPipeline()
            await pipeline.run_ipo_pipeline()
            logger.info("IPO pipeline completed")

        elif command == "run-gmp":
            logger.info("Running GMP pipeline once")
            pipeline = DataPipeline()
            await pipeline.run_gmp_pipeline()
            logger.info("GMP pipeline completed")

        elif command == "run-full":
            logger.info("Running full pipeline once")
            pipeline = DataPipeline()
            await pipeline.run_full_pipeline()
            logger.info("Full pipeline completed")

        elif command == "health-check":
            logger.info("Running health check")
            monitor = HealthCheckMonitor()
            monitor.run_health_check()

        elif command == "metrics":
            logger.info("Generating metrics report")
            metrics = DataQualityMetrics()
            metrics.print_weekly_report()

        elif command == "backfill":
            logger.info("For historical data backfill, run:")
            logger.info("python scripts/backfill_historical_data.py")

        else:
            logger.error(f"Unknown command: {command}")
            print_usage()
            sys.exit(1)

    except KeyboardInterrupt:
        logger.info("Pipeline interrupted by user")
        sys.exit(0)

    except Exception as e:
        logger.error(f"Pipeline failed: {str(e)}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
