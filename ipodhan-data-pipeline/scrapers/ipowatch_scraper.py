"""
IPOWatch GMP Scraper
Scrapes Grey Market Premium data from IPOWatch.in
"""

import asyncio
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime
from playwright.async_api import (
    async_playwright,
    Page,
    TimeoutError as PlaywrightTimeoutError,
)

from scrapers.base_scraper import BaseScraper

logger = logging.getLogger(__name__)


class IPOWatchScraper(BaseScraper):
    """
    IPOWatch GMP data scraper
    Implements scraping from https://www.ipowatch.in
    """

    def __init__(self, timeout: int = 30000, max_retries: int = 3):
        super().__init__("IPOWATCH")
        self.url = (
            "https://www.ipowatch.in/p/ipo-grey-market-premium-latest-live-gmp.html"
        )
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_count = 0

    async def scrape(self) -> List[Dict[str, Any]]:
        """
        Scrape GMP data from IPOWatch with retry mechanism
        AC5: Implements Playwright automation, retry mechanism, timeout
        """
        for attempt in range(self.max_retries):
            try:
                self.retry_count = attempt + 1
                logger.info(
                    f"IPOWatch scrape attempt {self.retry_count}/{self.max_retries}"
                )

                async with async_playwright() as p:
                    browser = await p.chromium.launch(headless=True)
                    context = await browser.new_context(
                        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    )

                    page = await context.new_page()
                    page.set_default_timeout(self.timeout)

                    # Navigate to IPOWatch GMP page
                    await page.goto(self.url, wait_until="networkidle")
                    logger.info(f"Successfully navigated to {self.url}")

                    # Wait for content to load
                    await page.wait_for_load_state("networkidle")

                    # Extract GMP data
                    gmp_data = await self._extract_gmp_data(page)

                    await browser.close()

                    self.log_success(len(gmp_data))
                    return gmp_data

            except PlaywrightTimeoutError as e:
                logger.warning(f"Timeout on attempt {self.retry_count}: {str(e)}")
                if attempt < self.max_retries - 1:
                    wait_time = 2**attempt
                    logger.info(f"Retrying in {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
                else:
                    self.log_error(e)
                    raise

            except Exception as e:
                logger.error(
                    f"Error on attempt {self.retry_count}: {str(e)}", exc_info=True
                )
                if attempt < self.max_retries - 1:
                    wait_time = 2**attempt
                    logger.info(f"Retrying in {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
                else:
                    self.log_error(e)
                    raise

        return []

    async def _extract_gmp_data(self, page: Page) -> List[Dict[str, Any]]:
        """
        Extract GMP data from IPOWatch page
        AC5: Parse HTML tables and extract GMP data
        """
        gmp_list = []

        try:
            # IPOWatch uses tables for GMP data
            tables = await page.query_selector_all("table")

            if not tables:
                logger.warning("No tables found on IPOWatch page")
                return []

            for table in tables:
                rows = await table.query_selector_all("tbody tr, tr")

                for row in rows:
                    try:
                        cells = await row.query_selector_all("td")

                        if len(cells) < 3:  # Minimum expected columns
                            continue

                        # Parse GMP data from row
                        gmp_data = await self._parse_gmp_row(cells)

                        if gmp_data and self.validate(gmp_data):
                            gmp_data["source"] = "IPOWATCH"
                            gmp_data["source_url"] = self.url
                            gmp_data["recorded_at"] = datetime.now()
                            gmp_list.append(gmp_data)

                    except Exception as e:
                        logger.warning(f"Error parsing row: {str(e)}")
                        continue

        except Exception as e:
            logger.error(f"Error extracting GMP data: {str(e)}", exc_info=True)

        return gmp_list

    async def _parse_gmp_row(self, cells: List[Any]) -> Optional[Dict[str, Any]]:
        """
        Parse individual table row to extract GMP data
        Typical columns: Company Name | GMP | Expected Price | Kostak | Subject to Sauda
        """
        try:
            company_name = await self._get_cell_text(cells, 0)
            gmp_text = await self._get_cell_text(cells, 1)
            expected_price_text = await self._get_cell_text(cells, 2)
            kostak_text = (
                await self._get_cell_text(cells, 3) if len(cells) > 3 else None
            )
            sauda_text = await self._get_cell_text(cells, 4) if len(cells) > 4 else None

            if not company_name or not gmp_text:
                return None

            # Parse GMP amount and percentage
            gmp_amount, gmp_percentage = self._parse_gmp_value(gmp_text)

            # Parse expected listing price
            expected_price = self._parse_price(expected_price_text)

            # Parse kostak and sauda rates
            kostak_rate = self._parse_price(kostak_text) if kostak_text else None
            sauda_rate = self._parse_price(sauda_text) if sauda_text else None

            # Calculate confidence score based on data completeness
            confidence_score = self._calculate_confidence(
                gmp_amount, expected_price, kostak_rate, sauda_rate
            )

            gmp_data = {
                "company_name": company_name,
                "gmp_amount": gmp_amount,
                "gmp_percentage": gmp_percentage,
                "expected_listing_price": expected_price,
                "kostak_rate": kostak_rate,
                "subject_to_sauda": sauda_rate,
                "confidence_score": confidence_score,
            }

            return gmp_data

        except Exception as e:
            logger.warning(f"Error parsing GMP row: {str(e)}")
            return None

    async def _get_cell_text(self, cells: List[Any], index: int) -> Optional[str]:
        """Extract text from table cell at given index"""
        try:
            if index < len(cells):
                text = await cells[index].inner_text()
                return text.strip() if text else None
        except Exception as e:
            logger.debug(f"Error getting cell text at index {index}: {str(e)}")
        return None

    def _parse_gmp_value(self, gmp_text: str) -> tuple:
        """
        Parse GMP text like '+50 (45%)' or '₹50 (+45%)'
        Returns: (gmp_amount, gmp_percentage)
        """
        if not gmp_text:
            return (0, 0)

        try:
            import re

            # Remove currency symbols
            gmp_text = gmp_text.replace("₹", "").replace("Rs", "")

            # Extract amount
            amount_match = re.search(r"[+-]?\d+\.?\d*", gmp_text)
            gmp_amount = float(amount_match.group()) if amount_match else 0

            # Extract percentage
            pct_match = re.search(r"\(([+-]?\d+\.?\d*)%\)", gmp_text)
            gmp_percentage = float(pct_match.group(1)) if pct_match else 0

            return (abs(gmp_amount), gmp_percentage)

        except Exception as e:
            logger.warning(f"Error parsing GMP value '{gmp_text}': {str(e)}")
            return (0, 0)

    def _parse_price(self, price_text: Optional[str]) -> Optional[float]:
        """Parse price from text"""
        if not price_text:
            return None

        try:
            import re

            # Remove currency symbols and commas
            price_text = price_text.replace("₹", "").replace("Rs", "").replace(",", "")

            # Extract number
            match = re.search(r"\d+\.?\d*", price_text)
            if match:
                return float(match.group())

        except Exception as e:
            logger.debug(f"Error parsing price '{price_text}': {str(e)}")

        return None

    def _calculate_confidence(
        self,
        gmp_amount: float,
        expected_price: Optional[float],
        kostak: Optional[float],
        sauda: Optional[float],
    ) -> int:
        """
        Calculate confidence score (1-100) based on data completeness
        AC4: Confidence scoring requirement
        """
        score = 50  # Base score

        # GMP amount present
        if gmp_amount > 0:
            score += 15

        # Expected price present
        if expected_price:
            score += 15

        # Kostak rate present
        if kostak:
            score += 10

        # Sauda rate present
        if sauda:
            score += 10

        # IPOWatch is a reliable source
        score = min(score, 100)

        return score

    def validate(self, data: Dict[str, Any]) -> bool:
        """
        Validate scraped GMP data
        Basic validation - comprehensive validation happens in IPODataValidator
        """
        required_fields = ["company_name", "gmp_amount"]

        for field in required_fields:
            if field not in data or data[field] is None:
                return False

        return True
