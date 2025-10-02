"""
InvestorGain GMP Scraper
Scrapes Grey Market Premium data from InvestorGain.com
"""

import asyncio
import logging
import re
from typing import Dict, List, Any, Optional
from datetime import datetime
from playwright.async_api import (
    async_playwright,
    Page,
    TimeoutError as PlaywrightTimeoutError,
)

from scrapers.base_scraper import BaseScraper

logger = logging.getLogger(__name__)


class InvestorGainScraper(BaseScraper):
    """InvestorGain GMP data scraper"""

    def __init__(self, timeout: int = 30000, max_retries: int = 3):
        super().__init__("INVESTORGAIN")
        self.url = "https://www.investorgain.com/report/live-ipo-gmp/331/"
        self.timeout = timeout
        self.max_retries = max_retries

    async def scrape(self) -> List[Dict[str, Any]]:
        """Scrape GMP data with retry mechanism"""
        for attempt in range(self.max_retries):
            try:
                logger.info(
                    f"InvestorGain scrape attempt {attempt + 1}/{self.max_retries}"
                )

                async with async_playwright() as p:
                    browser = await p.chromium.launch(headless=True)
                    context = await browser.new_context(
                        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    )
                    page = await context.new_page()
                    page.set_default_timeout(self.timeout)

                    await page.goto(self.url, wait_until="networkidle")
                    await page.wait_for_load_state("networkidle")

                    gmp_data = await self._extract_gmp_data(page)
                    await browser.close()

                    self.log_success(len(gmp_data))
                    return gmp_data

            except Exception as e:
                logger.error(f"Error on attempt {attempt + 1}: {str(e)}")
                if attempt < self.max_retries - 1:
                    await asyncio.sleep(2**attempt)
                else:
                    self.log_error(e)
                    raise

        return []

    async def _extract_gmp_data(self, page: Page) -> List[Dict[str, Any]]:
        """Extract GMP data from InvestorGain page"""
        gmp_list = []

        try:
            tables = await page.query_selector_all("table")
            for table in tables:
                rows = await table.query_selector_all("tbody tr, tr")

                for row in rows:
                    cells = await row.query_selector_all("td")
                    if len(cells) < 3:
                        continue

                    gmp_data = await self._parse_gmp_row(cells)
                    if gmp_data and self.validate(gmp_data):
                        gmp_data["source"] = "INVESTORGAIN"
                        gmp_data["source_url"] = self.url
                        gmp_data["recorded_at"] = datetime.now()
                        gmp_list.append(gmp_data)

        except Exception as e:
            logger.error(f"Error extracting GMP data: {str(e)}")

        return gmp_list

    async def _parse_gmp_row(self, cells: List[Any]) -> Optional[Dict[str, Any]]:
        """Parse GMP row data"""
        try:
            company_name = await self._get_cell_text(cells, 0)
            gmp_text = await self._get_cell_text(cells, 1)
            expected_price_text = await self._get_cell_text(cells, 2)

            if not company_name or not gmp_text:
                return None

            gmp_amount, gmp_percentage = self._parse_gmp_value(gmp_text)
            expected_price = self._parse_price(expected_price_text)

            return {
                "company_name": company_name,
                "gmp_amount": gmp_amount,
                "gmp_percentage": gmp_percentage,
                "expected_listing_price": expected_price,
                "confidence_score": 75,  # Medium confidence for InvestorGain
            }

        except Exception as e:
            logger.warning(f"Error parsing row: {str(e)}")
            return None

    async def _get_cell_text(self, cells: List[Any], index: int) -> Optional[str]:
        """Extract text from cell"""
        try:
            if index < len(cells):
                text = await cells[index].inner_text()
                return text.strip() if text else None
        except:
            return None

    def _parse_gmp_value(self, gmp_text: str) -> tuple:
        """Parse GMP value and percentage"""
        if not gmp_text:
            return (0, 0)
        try:
            amount_match = re.search(r"[+-]?\d+\.?\d*", gmp_text)
            pct_match = re.search(r"\(([+-]?\d+\.?\d*)%\)", gmp_text)
            return (
                float(amount_match.group()) if amount_match else 0,
                float(pct_match.group(1)) if pct_match else 0,
            )
        except:
            return (0, 0)

    def _parse_price(self, price_text: Optional[str]) -> Optional[float]:
        """Parse price"""
        if not price_text:
            return None
        try:
            match = re.search(r"\d+\.?\d*", price_text.replace(",", ""))
            return float(match.group()) if match else None
        except:
            return None

    def validate(self, data: Dict[str, Any]) -> bool:
        """Validate GMP data"""
        return "company_name" in data and "gmp_amount" in data
