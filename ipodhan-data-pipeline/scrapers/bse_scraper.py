"""
BSE IPO Scraper
Scrapes IPO data from BSE India website using Playwright
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


class BSEScraper(BaseScraper):
    """
    BSE IPO data scraper
    Implements scraping from https://www.bseindia.com/markets/PublicIssues/IPOIssues.aspx
    """

    def __init__(self, timeout: int = 30000, max_retries: int = 3):
        super().__init__("BSE")
        self.url = "https://www.bseindia.com/publicissue.html"
        self.timeout = timeout  # 30 seconds default
        self.max_retries = max_retries
        self.retry_count = 0

    async def scrape(self) -> List[Dict[str, Any]]:
        """
        Scrape IPO data from BSE with retry mechanism
        AC5: Implements Playwright automation, retry mechanism, timeout
        """
        for attempt in range(self.max_retries):
            try:
                self.retry_count = attempt + 1
                logger.info(f"BSE scrape attempt {self.retry_count}/{self.max_retries}")

                async with async_playwright() as p:
                    browser = await p.chromium.launch(headless=True)
                    context = await browser.new_context(
                        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    )

                    page = await context.new_page()
                    page.set_default_timeout(self.timeout)

                    # Navigate to BSE IPO page
                    await page.goto(self.url, wait_until="networkidle")
                    logger.info(f"Successfully navigated to {self.url}")

                    # Wait for content to load
                    await page.wait_for_load_state("networkidle")

                    # DEBUG: Save page screenshot and HTML for analysis
                    import os

                    debug_dir = os.path.join(os.path.dirname(__file__), "..", "debug")
                    os.makedirs(debug_dir, exist_ok=True)

                    screenshot_path = os.path.join(debug_dir, "bse_page.png")
                    html_path = os.path.join(debug_dir, "bse_page.html")

                    await page.screenshot(path=screenshot_path, full_page=True)
                    logger.info(f"Screenshot saved to: {screenshot_path}")

                    html_content = await page.content()
                    with open(html_path, "w", encoding="utf-8") as f:
                        f.write(html_content)
                    logger.info(f"HTML saved to: {html_path}")

                    # Log page structure
                    page_title = await page.title()
                    logger.info(f"Page title: {page_title}")

                    tables = await page.query_selector_all("table")
                    logger.info(f"Found {len(tables)} tables")

                    divs = await page.query_selector_all(
                        "div.table, div[id*='ipo'], div[class*='ipo']"
                    )
                    logger.info(f"Found {len(divs)} potential IPO divs")

                    # Handle pagination if present
                    ipo_data = await self._extract_all_pages(page)

                    await browser.close()

                    self.log_success(len(ipo_data))
                    return ipo_data

            except PlaywrightTimeoutError as e:
                logger.warning(f"Timeout on attempt {self.retry_count}: {str(e)}")
                if attempt < self.max_retries - 1:
                    # Exponential backoff: 1s, 2s, 4s
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

    async def _extract_all_pages(self, page: Page) -> List[Dict[str, Any]]:
        """
        Extract IPO data from all pages (handle pagination)
        AC5: Handle pagination on source websites
        """
        all_ipo_data = []
        current_page = 1
        max_pages = 10  # Safety limit

        while current_page <= max_pages:
            try:
                logger.info(f"Extracting BSE page {current_page}")

                # Extract data from current page
                page_data = await self._extract_ipo_data(page)
                all_ipo_data.extend(page_data)

                if not page_data:
                    logger.info("No more data found, stopping pagination")
                    break

                # Check for next page button
                next_button = await page.query_selector(
                    "a.next-page, button.next-page, a[title='Next']"
                )

                if not next_button:
                    logger.info("No next page button found")
                    break

                # Check if next button is disabled
                is_disabled = await next_button.is_disabled()
                if is_disabled:
                    logger.info("Next page button is disabled")
                    break

                # Click next page
                await next_button.click()
                await page.wait_for_load_state("networkidle")
                await asyncio.sleep(1)  # Brief pause between pages

                current_page += 1

            except Exception as e:
                logger.warning(
                    f"Error during pagination at page {current_page}: {str(e)}"
                )
                break

        logger.info(
            f"Extracted total {len(all_ipo_data)} IPOs from {current_page} pages"
        )
        return all_ipo_data

    async def _extract_ipo_data(self, page: Page) -> List[Dict[str, Any]]:
        """
        Extract IPO data from BSE page
        AC5: Parse HTML tables and extract IPO data fields
        """
        ipo_list = []

        try:
            # BSE typically uses a specific table ID or class for IPO data
            # Try multiple selectors
            tables = await page.query_selector_all(
                "table.tablesorter, table#ContentPlaceHolder1_gvIPO, table"
            )

            if not tables:
                logger.warning("No tables found on BSE page")
                return []

            for table in tables:
                rows = await table.query_selector_all("tbody tr")

                if not rows:
                    # Try alternate selector
                    rows = await table.query_selector_all("tr")

                for row in rows:
                    try:
                        cells = await row.query_selector_all("td")

                        if len(cells) < 5:  # Minimum expected columns
                            continue

                        # Extract data from table cells
                        ipo_data = await self._parse_table_row(cells)

                        if ipo_data and self.validate(ipo_data):
                            ipo_data["data_source"] = "BSE"
                            ipo_data["exchange"] = "BSE"
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
        Adjust column indices based on actual BSE table structure
        """
        try:
            # BSE IPO table typical columns:
            # Company Name | Issue Type | Open | Close | Issue Price | Issue Size | Status

            company_name = await self._get_cell_text(cells, 0)
            issue_type = await self._get_cell_text(cells, 1)
            open_date = await self._get_cell_text(cells, 2)
            close_date = await self._get_cell_text(cells, 3)
            price_band = await self._get_cell_text(cells, 4)
            issue_size = await self._get_cell_text(cells, 5) if len(cells) > 5 else None
            status = await self._get_cell_text(cells, 6) if len(cells) > 6 else None

            if not company_name:
                return None

            # Parse price band
            price_low, price_high = self._parse_price_band(price_band)

            # Determine status and category
            ipo_status = self._determine_status(open_date, close_date, status)
            category = self._determine_category(issue_type)

            ipo_data = {
                "company_name": company_name,
                "symbol": self._extract_symbol(company_name),
                "open_date": open_date,
                "close_date": close_date,
                "price_band_low": price_low,
                "price_band_high": price_high,
                "issue_size": self._parse_amount(issue_size),
                "status": ipo_status,
                "category": category,
                "lot_size": 1,  # Default, actual value needs to be scraped from detail page
                "issue_type": issue_type,
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
            price_band = (
                price_band.replace("₹", "")
                .replace("Rs", "")
                .replace("to", "-")
                .replace("/", "-")
            )

            # Split by dash or hyphen
            parts = [p.strip() for p in price_band.split("-") if p.strip()]

            if len(parts) == 2:
                price_low = float(parts[0].replace(",", ""))
                price_high = float(parts[1].replace(",", ""))
                return (price_low, price_high)
            elif len(parts) == 1:
                # Fixed price
                price = float(parts[0].replace(",", ""))
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
            amount_str = amount_str.replace("₹", "").replace("Rs", "").replace(",", "")

            # Extract number
            import re

            match = re.search(r"[\d.]+", amount_str)
            if match:
                return float(match.group())

        except Exception as e:
            logger.warning(f"Error parsing amount '{amount_str}': {str(e)}")

        return None

    def _extract_symbol(self, company_name: str) -> str:
        """Extract or generate stock symbol from company name"""
        # Generate symbol from first few characters (actual symbol would come from detail page)
        symbol = "".join(c for c in company_name.upper() if c.isalnum())[:10]
        return symbol or "UNKNOWN"

    def _determine_status(
        self, open_date: Optional[str], close_date: Optional[str], status: Optional[str]
    ) -> str:
        """Determine IPO status based on dates or status column"""
        # If status is provided in table, use it
        if status:
            status_upper = status.upper()
            if "UPCOMING" in status_upper or "FORTHCOMING" in status_upper:
                return "UPCOMING"
            elif "OPEN" in status_upper or "LIVE" in status_upper:
                return "LIVE"
            elif "CLOSED" in status_upper or "COMPLETED" in status_upper:
                return "CLOSED"
            elif "LISTED" in status_upper:
                return "LISTED"

        # Otherwise, determine from dates
        try:
            from datetime import datetime

            today = datetime.now().date()

            if open_date:
                # Try multiple date formats
                open_dt = self._parse_date(open_date)
                if open_dt and today < open_dt:
                    return "UPCOMING"

            if close_date:
                close_dt = self._parse_date(close_date)
                if close_dt:
                    if today > close_dt:
                        return "CLOSED"
                    elif open_dt and today >= open_dt:
                        return "LIVE"

        except Exception as e:
            logger.debug(f"Error determining status: {str(e)}")

        return "UPCOMING"

    def _parse_date(self, date_str: str) -> Optional[datetime]:
        """Parse date from various formats"""
        date_formats = [
            "%d %b %Y",  # 01 Oct 2025
            "%d-%m-%Y",  # 01-10-2025
            "%d/%m/%Y",  # 01/10/2025
            "%d %B %Y",  # 01 October 2025
        ]

        for fmt in date_formats:
            try:
                return datetime.strptime(date_str.strip(), fmt).date()
            except ValueError:
                continue

        return None

    def _determine_category(self, issue_type: Optional[str]) -> str:
        """Determine IPO category from issue type"""
        if issue_type:
            issue_type_upper = issue_type.upper()
            if "SME" in issue_type_upper:
                return "SME"

        return "MAINBOARD"

    def validate(self, data: Dict[str, Any]) -> bool:
        """
        Validate scraped IPO data
        Basic validation - comprehensive validation happens in IPODataValidator
        """
        required_fields = ["company_name", "price_band_low", "price_band_high"]

        for field in required_fields:
            if field not in data or not data[field]:
                return False

        return True
