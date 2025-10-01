"""
Data Pipeline Orchestrator
Coordinates scraping, validation, normalization, and storage
AC6: Pipeline orchestration implementation
"""

import logging
import asyncio
import time
from typing import List, Dict, Any
from datetime import datetime

# Import scrapers
from scrapers.nse_scraper import NSEScraper
from scrapers.bse_scraper import BSEScraper
from scrapers.ipowatch_scraper import IPOWatchScraper
from scrapers.investorgain_scraper import InvestorGainScraper
from scrapers.chittorgarh_scraper import ChittorgarhScraper

# Import validators
from validators.ipo_validator import IPODataValidator
from validators.normalizer import DataNormalizer

# Import repository
from repositories.ipo_data_repository import IPODataRepository

logger = logging.getLogger(__name__)


class DataPipeline:
    """
    Main data pipeline orchestrator
    Implements scrape → validate → normalize → store workflow
    """

    def __init__(self):
        # Initialize scrapers
        self.nse_scraper = NSEScraper()
        self.bse_scraper = BSEScraper()
        self.ipowatch_scraper = IPOWatchScraper()
        self.investorgain_scraper = InvestorGainScraper()
        self.chittorgarh_scraper = ChittorgarhScraper()

        # Initialize validators
        self.ipo_validator = IPODataValidator()
        self.normalizer = DataNormalizer()

        # Initialize repository
        self.repository = IPODataRepository()

    async def run_ipo_pipeline(self):
        """
        Run IPO data pipeline: Scrape → Validate → Normalize → Store
        AC6: IPO pipeline implementation
        """
        logger.info("Starting IPO data pipeline")
        start_time = time.time()

        # Statistics
        stats = {
            'total_scraped': 0,
            'total_validated': 0,
            'total_inserted': 0,
            'total_updated': 0,
            'errors': []
        }

        try:
            # Run NSE scraper
            await self._process_ipo_source(
                'NSE',
                self.nse_scraper,
                stats
            )

            # Run BSE scraper
            await self._process_ipo_source(
                'BSE',
                self.bse_scraper,
                stats
            )

            # Calculate execution time
            execution_time_ms = int((time.time() - start_time) * 1000)

            # Update pipeline status
            self.repository.update_pipeline_status(
                source='ALL',
                pipeline_type='IPO_DATA',
                status='SUCCESS' if not stats['errors'] else 'FAILURE',
                records_processed=stats['total_scraped'],
                records_inserted=stats['total_inserted'],
                records_updated=stats['total_updated'],
                execution_time_ms=execution_time_ms,
                error_message='; '.join(stats['errors']) if stats['errors'] else None
            )

            logger.info(
                f"IPO pipeline completed: "
                f"scraped={stats['total_scraped']}, "
                f"validated={stats['total_validated']}, "
                f"inserted={stats['total_inserted']}, "
                f"updated={stats['total_updated']}, "
                f"time={execution_time_ms}ms"
            )

        except Exception as e:
            logger.error(f"IPO pipeline failed: {str(e)}", exc_info=True)
            self.repository.update_pipeline_status(
                source='ALL',
                pipeline_type='IPO_DATA',
                status='FAILURE',
                error_message=str(e)
            )
            raise

    async def _process_ipo_source(self, source: str, scraper: Any, stats: Dict):
        """Process IPO data from a single source"""
        logger.info(f"Processing IPO data from {source}")
        source_start = time.time()

        try:
            # Scrape data
            raw_data = await scraper.scrape()
            stats['total_scraped'] += len(raw_data)

            logger.info(f"Scraped {len(raw_data)} IPOs from {source}")

            # Validate, normalize, and store
            for raw_ipo in raw_data:
                try:
                    # Validate
                    validation_result = self.ipo_validator.validate_ipo_data(raw_ipo)

                    if not validation_result.is_valid:
                        logger.warning(
                            f"Validation failed for {raw_ipo.get('company_name')}: "
                            f"{validation_result.errors}"
                        )
                        continue

                    stats['total_validated'] += 1

                    # Normalize
                    normalized_data = self.normalizer.normalize_ipo_data(validation_result.data)

                    # Check if it's an insert or update
                    existing = self.repository.check_duplicate(normalized_data)

                    # Store
                    ipo_id = self.repository.upsert_ipo_details(normalized_data)

                    if existing:
                        stats['total_updated'] += 1
                    else:
                        stats['total_inserted'] += 1

                    logger.debug(f"Stored IPO: {normalized_data.get('company_name')} ({ipo_id})")

                except Exception as e:
                    error_msg = f"Error processing IPO {raw_ipo.get('company_name')}: {str(e)}"
                    logger.error(error_msg)
                    stats['errors'].append(error_msg)

            # Update source-specific status
            execution_time_ms = int((time.time() - source_start) * 1000)
            self.repository.update_pipeline_status(
                source=source,
                pipeline_type='IPO_DATA',
                status='SUCCESS',
                records_processed=len(raw_data),
                execution_time_ms=execution_time_ms
            )

        except Exception as e:
            error_msg = f"Error processing {source}: {str(e)}"
            logger.error(error_msg, exc_info=True)
            stats['errors'].append(error_msg)

            self.repository.update_pipeline_status(
                source=source,
                pipeline_type='IPO_DATA',
                status='FAILURE',
                error_message=str(e)
            )

    async def run_gmp_pipeline(self):
        """
        Run GMP data pipeline: Scrape → Validate → Normalize → Store
        AC6: GMP pipeline implementation
        """
        logger.info("Starting GMP data pipeline")
        start_time = time.time()

        stats = {
            'total_scraped': 0,
            'total_validated': 0,
            'total_inserted': 0,
            'errors': []
        }

        try:
            # Run all GMP scrapers
            await self._process_gmp_source('IPOWATCH', self.ipowatch_scraper, stats)
            await self._process_gmp_source('INVESTORGAIN', self.investorgain_scraper, stats)
            await self._process_gmp_source('CHITTORGARH', self.chittorgarh_scraper, stats)

            # Refresh GMP materialized view
            try:
                self.repository.refresh_gmp_materialized_view()
                logger.info("GMP materialized view refreshed")
            except Exception as e:
                logger.error(f"Failed to refresh GMP view: {str(e)}")

            # Calculate execution time
            execution_time_ms = int((time.time() - start_time) * 1000)

            # Update pipeline status
            self.repository.update_pipeline_status(
                source='ALL',
                pipeline_type='GMP_DATA',
                status='SUCCESS' if not stats['errors'] else 'FAILURE',
                records_processed=stats['total_scraped'],
                records_inserted=stats['total_inserted'],
                execution_time_ms=execution_time_ms,
                error_message='; '.join(stats['errors']) if stats['errors'] else None
            )

            logger.info(
                f"GMP pipeline completed: "
                f"scraped={stats['total_scraped']}, "
                f"validated={stats['total_validated']}, "
                f"inserted={stats['total_inserted']}, "
                f"time={execution_time_ms}ms"
            )

        except Exception as e:
            logger.error(f"GMP pipeline failed: {str(e)}", exc_info=True)
            self.repository.update_pipeline_status(
                source='ALL',
                pipeline_type='GMP_DATA',
                status='FAILURE',
                error_message=str(e)
            )
            raise

    async def _process_gmp_source(self, source: str, scraper: Any, stats: Dict):
        """Process GMP data from a single source"""
        logger.info(f"Processing GMP data from {source}")
        source_start = time.time()

        try:
            # Scrape data
            raw_data = await scraper.scrape()
            stats['total_scraped'] += len(raw_data)

            logger.info(f"Scraped {len(raw_data)} GMP records from {source}")

            # Validate, normalize, and store
            for raw_gmp in raw_data:
                try:
                    # Find IPO by company name
                    ipo = self.repository.get_ipo_by_company_name(raw_gmp['company_name'])

                    if not ipo:
                        logger.warning(f"IPO not found for: {raw_gmp['company_name']}")
                        continue

                    # Add IPO ID to GMP data
                    raw_gmp['ipo_id'] = str(ipo['id'])

                    # Validate
                    validation_result = self.ipo_validator.validate_gmp_data(raw_gmp)

                    if not validation_result.is_valid:
                        logger.warning(
                            f"GMP validation failed for {raw_gmp.get('company_name')}: "
                            f"{validation_result.errors}"
                        )
                        continue

                    stats['total_validated'] += 1

                    # Normalize
                    normalized_data = self.normalizer.normalize_gmp_data(validation_result.data)

                    # Store
                    gmp_id = self.repository.insert_gmp_record(normalized_data)
                    stats['total_inserted'] += 1

                    logger.debug(f"Stored GMP: {normalized_data.get('company_name')} ({gmp_id})")

                except Exception as e:
                    error_msg = f"Error processing GMP {raw_gmp.get('company_name')}: {str(e)}"
                    logger.error(error_msg)
                    stats['errors'].append(error_msg)

            # Update source-specific status
            execution_time_ms = int((time.time() - source_start) * 1000)
            self.repository.update_pipeline_status(
                source=source,
                pipeline_type='GMP_DATA',
                status='SUCCESS',
                records_processed=len(raw_data),
                execution_time_ms=execution_time_ms
            )

        except Exception as e:
            error_msg = f"Error processing {source} GMP: {str(e)}"
            logger.error(error_msg, exc_info=True)
            stats['errors'].append(error_msg)

            self.repository.update_pipeline_status(
                source=source,
                pipeline_type='GMP_DATA',
                status='FAILURE',
                error_message=str(e)
            )

    async def run_full_pipeline(self):
        """Run both IPO and GMP pipelines"""
        logger.info("Starting full data pipeline (IPO + GMP)")

        try:
            # Run IPO pipeline first
            await self.run_ipo_pipeline()

            # Wait a bit before running GMP
            await asyncio.sleep(5)

            # Run GMP pipeline
            await self.run_gmp_pipeline()

            logger.info("Full pipeline completed successfully")

        except Exception as e:
            logger.error(f"Full pipeline failed: {str(e)}", exc_info=True)
            raise
