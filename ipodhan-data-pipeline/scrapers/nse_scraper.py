"""
NSE IPO Scraper
Scrapes IPO data from NSE India website using Playwright
"""

import asyncio
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime
from playwright.async_api import async_playwright, Page, TimeoutError as PlaywrightTimeoutError

from scrapers.base_scraper import BaseScraper

logger = logging.getLogger(__name__)


class NSEScraper(BaseScraper):
    """
    NSE IPO data scraper
    Implements scraping from https://www.nseindia.com/market-data/all-upcoming-issues-ipo
    """

    def __init__(self, timeout: int = 30000, max_retries: int = 3):
        super().__init__("NSE")
        self.url = "https://www.nseindia.com/market-data/all-upcoming-issues-ipo"
        self.timeout = timeout  # 30 seconds default
        self.max_retries = max_retries
        self.retry_count = 0

    async def scrape(self) -> List[Dict[str, Any]]:
        """
        Scrape IPO data from NSE with retry mechanism
        AC5: Implements Playwright automation, retry mechanism, timeout
        """
        for attempt in range(self.max_retries):
            try:
                self.retry_count = attempt + 1
                logger.info(f"NSE scrape attempt {self.retry_count}/{self.max_retries}")

                async with async_playwright() as p:
                    browser = await p.chromium.launch(headless=True)
                    context = await browser.new_context(
                        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    )

                    page = await context.new_page()
                    page.set_default_timeout(self.timeout)

                    # Navigate to NSE IPO page
                    await page.goto(self.url, wait_until="networkidle")
                    logger.info(f"Successfully navigated to {self.url}")

                    # Wait for content to load
                    await page.wait_for_load_state("networkidle")

                    # Extract IPO data
                    ipo_data = await self._extract_ipo_data(page)

                    await browser.close()

                    self.log_success(len(ipo_data))
                    return ipo_data

            except PlaywrightTimeoutError as e:
                logger.warning(f"Timeout on attempt {self.retry_count}: {str(e)}")
                if attempt < self.max_retries - 1:
                    # Exponential backoff: 1s, 2s, 4s
                    wait_time = 2 ** attempt
                    logger.info(f"Retrying in {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
                else:
                    self.log_error(e)
                    raise

            except Exception as e:
                logger.error(f"Error on attempt {self.retry_count}: {str(e)}", exc_info=True)
                if attempt < self.max_retries - 1:
                    wait_time = 2 ** attempt
                    logger.info(f"Retrying in {wait_time} seconds...")
                    await asyncio.sleep(wait_time)
                else:
                    self.log_error(e)
                    raise

        return []

    async def _extract_ipo_data(self, page: Page) -> List[Dict[str, Any]]:
        """
        Extract IPO data from NSE page
        AC5: Parse HTML tables and extract IPO data fields
        """
        ipo_list = []

        try:
            # NSE uses multiple tabs: Mainboard IPOs, SME IPOs, etc.
            # Check for different table structures

            # Try to find tables with IPO data
            tables = await page.query_selector_all("table")

            if not tables:
                logger.warning("No tables found on NSE page")
                return []

            for table in tables:
                rows = await table.query_selector_all("tbody tr")

                for row in rows:
                    try:
                        cells = await row.query_selector_all("td")

                        if len(cells) < 5:  # Minimum expected columns
                            continue

                        # Extract data from table cells
                        # Note: Actual column indices depend on NSE table structure
                        # This is a generic implementation that needs adjustment based on actual table
                        ipo_data = await self._parse_table_row(cells)

                        if ipo_data and self.validate(ipo_data):
                            ipo_data['data_source'] = 'NSE'
                            ipo_data['exchange'] = 'NSE'
                            ipo_list.append(ipo_data)

                    except Exception as e:
                        logger.warning(f"Error parsing row: {str(e)}")
                        continue

        except Exception as e:
            logger.error(f"Error extracting IPO data: {str(e)}", exc_info=True)

        return ipo_list

    async def _parse_table_row(self, cells: List[Any]) -> Optional[Dict[str, Any]]:
        """
        Parse individual table row to extract IPO data
        Adjust column indices based on actual NSE table structure
        """
        try:
            # This is a template - adjust indices based on actual NSE table structure
            # Common NSE IPO table columns:
            # Company Name | Issue Type | Open Date | Close Date | Issue Price | Issue Size | Listing Date

            company_name = await self._get_cell_text(cells, 0)
            open_date = await self._get_cell_text(cells, 1)
            close_date = await self._get_cell_text(cells, 2)
            price_band = await self._get_cell_text(cells, 3)  # Format: "100-110"
            issue_size = await self._get_cell_text(cells, 4)
            listing_date = await self._get_cell_text(cells, 5) if len(cells) > 5 else None

            if not company_name:
                return None

            # Parse price band
            price_low, price_high = self._parse_price_band(price_band)

            # Determine status based on dates
            status = self._determine_status(open_date, close_date)

            ipo_data = {
                'company_name': company_name,
                'symbol': self._extract_symbol(company_name),
                'open_date': open_date,
                'close_date': close_date,
                'listing_date': listing_date,
                'price_band_low': price_low,
                'price_band_high': price_high,
                'issue_size': self._parse_amount(issue_size),
                'status': status,
                'category': 'MAINBOARD',  # NSE default, may need to detect SME
                'lot_size': 1  # Default, actual value needs to be scraped from detail page
            }

            return ipo_data

        except Exception as e:
            logger.warning(f"Error parsing table row: {str(e)}")
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

    def _parse_price_band(self, price_band: Optional[str]) -> tuple:
        """Parse price band string like '100-110' or '₹100 to ₹110'"""
        if not price_band:
            return (0, 0)

        try:
            # Remove currency symbols and 'to' words
            price_band = price_band.replace('₹', '').replace('Rs', '').replace('to', '-')

            # Split by dash or hyphen
            parts = price_band.split('-')

            if len(parts) == 2:
                price_low = float(parts[0].strip())
                price_high = float(parts[1].strip())
                return (price_low, price_high)
            elif len(parts) == 1:
                # Fixed price
                price = float(parts[0].strip())
                return (price, price)

        except Exception as e:
            logger.warning(f"Error parsing price band '{price_band}': {str(e)}")

        return (0, 0)

    def _parse_amount(self, amount_str: Optional[str]) -> Optional[float]:
        """Parse amount string like '500 Cr' or '₹500 crores'"""
        if not amount_str:
            return None

        try:
            # Remove currency symbols and text
            amount_str = amount_str.replace('₹', '').replace('Rs', '').replace(',', '')

            # Extract number
            import re
            match = re.search(r'[\d.]+', amount_str)
            if match:
                return float(match.group())

        except Exception as e:
            logger.warning(f"Error parsing amount '{amount_str}': {str(e)}")

        return None

    def _extract_symbol(self, company_name: str) -> str:
        """Extract or generate stock symbol from company name"""
        # Generate symbol from first few characters (actual symbol would come from detail page)
        symbol = ''.join(c for c in company_name.upper() if c.isalnum())[:10]
        return symbol or 'UNKNOWN'

    def _determine_status(self, open_date: Optional[str], close_date: Optional[str]) -> str:
        """Determine IPO status based on dates"""
        try:
            from datetime import datetime

            today = datetime.now().date()

            if open_date:
                open_dt = datetime.strptime(open_date, '%d %b %Y').date()
                if today < open_dt:
                    return 'UPCOMING'

            if close_date:
                close_dt = datetime.strptime(close_date, '%d %b %Y').date()
                if today > close_dt:
                    return 'CLOSED'
                elif today >= open_dt:
                    return 'LIVE'

        except Exception as e:
            logger.debug(f"Error determining status: {str(e)}")

        return 'UPCOMING'

    def validate(self, data: Dict[str, Any]) -> bool:
        """
        Validate scraped IPO data
        Basic validation - comprehensive validation happens in IPODataValidator
        """
        required_fields = ['company_name', 'price_band_low', 'price_band_high']

        for field in required_fields:
            if field not in data or not data[field]:
                return False

        return True
