"""
Populate IPO records from existing GMP data
One-time script to bootstrap the database with IPO records from GMP data
Part of Option C implementation
"""

import asyncio
import sys
import os
from pathlib import Path
from datetime import datetime, timedelta
from uuid import uuid4
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from scrapers.investorgain_scraper import InvestorGainScraper
from repositories.ipo_data_repository import IPODataRepository
from validators.normalizer import DataNormalizer
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def generate_symbol(company_name: str) -> str:
    """Generate unique symbol from company name"""
    symbol = ''.join(c for c in company_name.upper() if c.isalnum())[:10]
    return symbol or 'UNKNOWN'


def detect_category(company_name: str) -> str:
    """Detect if IPO is MAINBOARD or SME based on company name"""
    name_lower = company_name.lower()
    sme_indicators = ['sme', 'small', 'micro', 'emerge']

    for indicator in sme_indicators:
        if indicator in name_lower:
            return 'SME'

    return 'MAINBOARD'


def estimate_price_band(expected_listing_price: float) -> tuple:
    """Estimate price band from expected listing price"""
    if not expected_listing_price or expected_listing_price == 0:
        return (100, 110)  # Default band

    # Assume issue price is ~10% below expected listing
    issue_price = expected_listing_price * 0.9

    # Create 5% band
    price_low = round(issue_price * 0.95, 2)
    price_high = round(issue_price * 1.05, 2)

    return (price_low, price_high)


def determine_status(open_date, close_date):
    """Determine IPO status based on dates"""
    today = datetime.now().date()

    if today < open_date:
        return 'UPCOMING'
    elif today > close_date:
        return 'CLOSED'
    else:
        return 'LIVE'


async def main():
    """
    Main execution flow:
    1. Scrape GMP data from InvestorGain (65 records)
    2. Extract unique company names
    3. Create basic IPO records with sensible defaults
    4. Save IPO records to database
    5. Re-run GMP scraper to link data
    """

    logger.info("=" * 60)
    logger.info("Option A: Populate IPOs from GMP Data")
    logger.info("=" * 60)

    # Initialize components
    scraper = InvestorGainScraper()
    repository = IPODataRepository()
    normalizer = DataNormalizer()

    logger.info("\nStep 1: Scraping GMP data from InvestorGain...")
    gmp_data = await scraper.scrape()
    logger.info(f"✓ Found {len(gmp_data)} GMP records")

    # Extract unique companies
    companies = {}  # company_name -> gmp_record
    for record in gmp_data:
        company_name = record.get('company_name')
        if company_name and company_name not in companies:
            companies[company_name] = record

    logger.info(f"\nStep 2: Extracted {len(companies)} unique companies")

    # Create IPO records
    created_count = 0
    skipped_count = 0

    logger.info("\nStep 3: Creating IPO records...")
    for company_name, gmp_record in companies.items():
        # Normalize company name using the normalizer's internal method
        normalized_name = normalizer._standardize_company_name(company_name)

        # Generate symbol (first 10 alphanumeric chars)
        symbol = generate_symbol(normalized_name)

        # Check if IPO already exists
        existing = repository.get_ipo_by_symbol(symbol)
        if existing:
            logger.info(f"⊘ Skipping {company_name} - already exists")
            skipped_count += 1
            continue

        # Detect category (MAINBOARD vs SME)
        category = detect_category(company_name)

        # Estimate price band from expected listing price
        expected_price = gmp_record.get('expected_listing_price', 0)
        price_low, price_high = estimate_price_band(expected_price)

        # Estimate dates (assume current/upcoming IPOs)
        open_date = datetime.now().date() - timedelta(days=5)  # Opened 5 days ago
        close_date = datetime.now().date() + timedelta(days=2)  # Closes in 2 days
        listing_date = close_date + timedelta(days=7)  # Lists 7 days after close

        # Create IPO record
        ipo_data = {
            'symbol': symbol,
            'company_name': normalized_name,
            'exchange': 'NSE',  # Default
            'open_date': open_date,
            'close_date': close_date,
            'listing_date': listing_date,
            'price_band_low': price_low,
            'price_band_high': price_high,
            'lot_size': 1,  # Default - needs manual update
            'issue_size': None,  # Unknown
            'status': determine_status(open_date, close_date),
            'category': category,
            'registrar': None,
            'data_source': 'GMP_DERIVED',
            'issue_type': 'BOOK_BUILDING'  # Most common type for IPOs
        }

        try:
            ipo_id = repository.upsert_ipo_details(ipo_data)
            logger.info(f"✓ Created IPO record: {company_name} ({symbol}) - ID: {ipo_id}")
            created_count += 1
        except Exception as e:
            logger.error(f"✗ Error creating {company_name}: {str(e)}")

    logger.info(f"\n{'=' * 60}")
    logger.info(f"Step 4: Summary")
    logger.info(f"  Created: {created_count} IPO records")
    logger.info(f"  Skipped: {skipped_count} (already exist)")
    logger.info(f"{'=' * 60}")

    # Re-run GMP scraper to link data (optional step)
    logger.info(f"\nStep 5: Re-running GMP scraper to link data...")
    try:
        from orchestrator.pipeline_orchestrator import PipelineOrchestrator
        orchestrator = PipelineOrchestrator()
        results = await orchestrator.run_gmp_pipeline()

        logger.info(f"\n{'=' * 60}")
        logger.info(f"✓ Pipeline complete!")
        logger.info(f"  GMP records processed: {results.get('summary', {}).get('total_records', 0)}")
        logger.info(f"  Successfully saved: {results.get('summary', {}).get('saved_count', 0)}")
        logger.info(f"{'=' * 60}\n")
    except Exception as e:
        logger.warning(f"\n✓ IPO records created successfully!")
        logger.warning(f"  (Skipping GMP pipeline re-run due to: {str(e)})")
        logger.warning(f"  You can run 'python main.py run-gmp' manually to link GMP data\n")


if __name__ == "__main__":
    asyncio.run(main())
