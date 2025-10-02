"""
IPO Scoring Engine - Main Entry Point
Service launcher for API server or scheduler
"""

import os
import sys
import argparse
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


def start_api():
    """Start FastAPI server"""
    import uvicorn
    from api.main import app

    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("API_PORT", 8001))

    logger.info(f"Starting API server on {host}:{port}")
    uvicorn.run(app, host=host, port=port)


def start_scheduler():
    """Start score calculation scheduler"""
    from schedulers import ScoreScheduler
    from repositories import DatabaseConfig

    logger.info("Starting score calculation scheduler")
    DatabaseConfig.initialize_pool()

    scheduler = ScoreScheduler()
    scheduler.start()


def calculate_once():
    """Calculate scores once (manual trigger)"""
    from schedulers import ScoreScheduler
    from repositories import DatabaseConfig

    logger.info("Running one-time score calculation")
    DatabaseConfig.initialize_pool()

    scheduler = ScoreScheduler()
    scheduler.calculate_all_scores()

    logger.info("Score calculation complete")


def run_tests():
    """Run test suite"""
    import pytest

    logger.info("Running test suite")
    exit_code = pytest.main(["-v", "tests/"])
    sys.exit(exit_code)


def print_usage():
    """Print usage information"""
    print(
        """
IPODhan Score Engine - Command Line Interface

Usage:
    python main.py [command]

Commands:
    api             - Start FastAPI server (default port 8001)
    scheduler       - Start automated score calculation scheduler
    calculate       - Run score calculation once (manual trigger)
    test            - Run test suite
    help            - Show this help message

Examples:
    python main.py api              # Start API server
    python main.py scheduler        # Start scheduler (runs 3x daily)
    python main.py calculate        # Calculate scores now

Environment Variables:
    Set in .env file:
    - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
    - REDIS_HOST, REDIS_PORT (optional)
    - API_PORT (default: 8001)
    - SCORE_CALCULATION_TIMES (default: 09:00,13:00,17:00)
    """
    )


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="IPODhan Score Engine", add_help=False)
    parser.add_argument(
        "command",
        nargs="?",
        default="api",
        choices=["api", "scheduler", "calculate", "test", "help"],
    )

    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("IPODhan Score Engine Starting")
    logger.info(f"Command: {args.command}")
    logger.info("=" * 60)

    if args.command == "api":
        start_api()
    elif args.command == "scheduler":
        start_scheduler()
    elif args.command == "calculate":
        calculate_once()
    elif args.command == "test":
        run_tests()
    elif args.command == "help":
        print_usage()
    else:
        print_usage()


if __name__ == "__main__":
    main()
