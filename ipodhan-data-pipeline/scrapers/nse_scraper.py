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
        Scrape IPO data from NSE with retry mechanism and anti-bot bypasses
        AC5: Implements Playwright automation, retry mechanism, timeout
        Enhanced with realistic browser fingerprinting to bypass anti-bot detection
        """
        for attempt in range(self.max_retries):
            try:
                self.retry_count = attempt + 1
                logger.info(f"NSE scrape attempt {self.retry_count}/{self.max_retries}")

                async with async_playwright() as p:
                    # Launch browser with anti-detection settings
                    browser = await p.chromium.launch(
                        headless=False,  # Non-headless mode to avoid detection
                        args=[
                            '--disable-blink-features=AutomationControlled',
                            '--no-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-web-security',
                            '--disable-features=IsolateOrigins,site-per-process'
                        ]
                    )

                    # Create context with realistic browser fingerprint
                    context = await browser.new_context(
                        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                        viewport={'width': 1920, 'height': 1080},
                        locale='en-US',
                        timezone_id='Asia/Kolkata',
                        extra_http_headers={
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Accept-Encoding': 'gzip, deflate, br',
                            'Connection': 'keep-alive',
                            'Upgrade-Insecure-Requests': '1',
                            'Sec-Fetch-Dest': 'document',
                            'Sec-Fetch-Mode': 'navigate',
                            'Sec-Fetch-Site': 'none',
                            'Sec-Fetch-User': '?1',
                            'Cache-Control': 'max-age=0'
                        }
                    )

                    page = await context.new_page()
                    page.set_default_timeout(self.timeout)

                    # Remove webdriver detection
                    await page.add_init_script("""
                        Object.defineProperty(navigator, 'webdriver', {
                            get: () => undefined
                        });

                        // Override the plugins to make it look like a real browser
                        Object.defineProperty(navigator, 'plugins', {
                            get: () => [1, 2, 3, 4, 5]
                        });

                        // Chrome object
                        window.chrome = { runtime: {} };

                        // Permissions
                        const originalQuery = window.navigator.permissions.query;
                        window.navigator.permissions.query = (parameters) => (
                            parameters.name === 'notifications' ?
                                Promise.resolve({ state: Notification.permission }) :
                                originalQuery(parameters)
                        );
                    """)

                    # First visit NSE homepage to establish session
                    logger.info("Establishing session with NSE homepage...")
                    await page.goto("https://www.nseindia.com", wait_until="domcontentloaded")
                    await asyncio.sleep(2)  # Wait for cookies/session to be set

                    # Navigate to NSE IPO page with realistic user behavior
                    logger.info(f"Navigating to IPO page: {self.url}")
                    await page.goto(self.url, wait_until="domcontentloaded", timeout=60000)

                    # Simulate human-like behavior
                    await asyncio.sleep(3)

                    # Scroll down slowly like a human
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight/4)")
                    await asyncio.sleep(1)

                    # Wait for content to load
                    await page.wait_for_load_state("networkidle", timeout=30000)

                    logger.info(f"Successfully navigated to {self.url}")

                    # DEBUG: Save page screenshot and HTML for analysis
                    import os
                    debug_dir = os.path.join(os.path.dirname(__file__), '..', 'debug')
                    os.makedirs(debug_dir, exist_ok=True)

                    screenshot_path = os.path.join(debug_dir, 'nse_page.png')
                    html_path = os.path.join(debug_dir, 'nse_page.html')

                    await page.screenshot(path=screenshot_path, full_page=True)
                    logger.info(f"Screenshot saved to: {screenshot_path}")

                    html_content = await page.content()
                    with open(html_path, 'w', encoding='utf-8') as f:
                        f.write(html_content)
                    logger.info(f"HTML saved to: {html_path}")

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
        Extract IPO data from NSE page using two-step approach:
        1. Parse main listing page for company list and detail URLs
        2. Visit each detail page to get complete IPO data
        """
        ipo_list = []

        try:
            # Step 1: Get company list from main page
            companies = await self._parse_main_listing_page(page)
            logger.info(f"Found {len(companies)} companies on NSE main page")

            # Step 2: Visit each detail page
            for idx, company in enumerate(companies):
                try:
                    logger.info(f"Processing {idx+1}/{len(companies)}: {company['company_name']}")

                    # Navigate to detail page
                    detail_data = await self._scrape_ipo_detail_page(
                        page,
                        company['symbol'],
                        company['series'],
                        company['issue_type']
                    )

                    if detail_data:
                        # Merge main page data + detail page data
                        ipo_data = {**company, **detail_data}

                        # Validate
                        if self.validate(ipo_data):
                            ipo_data['data_source'] = 'NSE'
                            ipo_data['exchange'] = 'NSE'
                            ipo_list.append(ipo_data)
                            logger.info(f"  ✓ Extracted: {company['company_name']}")
                        else:
                            logger.warning(f"  ⊘ Validation failed: {company['company_name']}")
                    else:
                        logger.warning(f"  ⊘ No detail data: {company['company_name']}")

                    # Rate limiting: 2 seconds between requests
                    await asyncio.sleep(2)

                except Exception as e:
                    logger.error(f"  ✗ Error processing {company['company_name']}: {str(e)}")
                    continue

        except Exception as e:
            logger.error(f"Error extracting IPO data: {str(e)}", exc_info=True)

        return ipo_list

    async def _parse_main_listing_page(self, page: Page) -> List[Dict[str, Any]]:
        """
        Parse main NSE listing page to extract company list and detail URLs
        Returns list of dicts with: company_name, symbol, series, issue_type, status, dates
        """
        companies = []

        try:
            # Find all tables
            tables = await page.query_selector_all("table")

            if len(tables) < 2:
                logger.warning(f"Expected at least 2 tables, found {len(tables)}")
                return []

            # Table 2 (index 1) has the IPO data
            ipo_table = tables[1]
            rows = await ipo_table.query_selector_all("tbody tr")

            if not rows:
                rows = await ipo_table.query_selector_all("tr")

            logger.info(f"Found {len(rows)} rows in IPO table")

            for row in rows:
                try:
                    cells = await row.query_selector_all("td")

                    if len(cells) < 5:  # Need at least 5 columns
                        continue

                    # Column 0: Company Name with link
                    company_cell = cells[0]
                    company_name = await self._get_cell_text(cells, 0)

                    # Extract detail page URL from link
                    link = await company_cell.query_selector("a")
                    if not link:
                        logger.warning(f"No link found for {company_name}")
                        continue

                    href = await link.get_attribute("href")
                    if not href:
                        continue

                    # Parse URL: /market-data/issue-information?symbol=ADVANCE&series=EQ&type=Active
                    params = self._parse_detail_url(href)
                    if not params:
                        continue

                    # Extract other fields
                    security_type = await self._get_cell_text(cells, 1)
                    open_date = await self._get_cell_text(cells, 2)
                    close_date = await self._get_cell_text(cells, 3)
                    status = await self._get_cell_text(cells, 4)

                    company_data = {
                        'company_name': company_name,
                        'symbol': params['symbol'],
                        'series': params['series'],
                        'issue_type': params['type'],
                        'open_date': open_date,
                        'close_date': close_date,
                        'status': self._normalize_status(status),
                        'detail_url': href
                    }

                    companies.append(company_data)

                except Exception as e:
                    logger.warning(f"Error parsing row: {str(e)}")
                    continue

        except Exception as e:
            logger.error(f"Error parsing main listing page: {str(e)}", exc_info=True)

        return companies

    def _parse_detail_url(self, url: str) -> Optional[Dict[str, str]]:
        """
        Parse NSE detail page URL to extract parameters
        URL format: /market-data/issue-information?symbol=ADVANCE&series=EQ&type=Active
        """
        try:
            from urllib.parse import urlparse, parse_qs

            parsed = urlparse(url)
            params = parse_qs(parsed.query)

            return {
                'symbol': params.get('symbol', [''])[0],
                'series': params.get('series', [''])[0],
                'type': params.get('type', [''])[0]
            }
        except Exception as e:
            logger.warning(f"Error parsing detail URL '{url}': {str(e)}")
            return None

    async def _scrape_ipo_detail_page(
        self,
        page: Page,
        symbol: str,
        series: str,
        issue_type: str
    ) -> Optional[Dict[str, Any]]:
        """
        Scrape individual IPO detail page to extract complete information
        URL: /market-data/issue-information?symbol=X&series=Y&type=Z

        Returns dict with:
        - price_band_low, price_band_high
        - lot_size
        - issue_size, fresh_issue_size, offer_for_sale
        - listing_date
        - lead_managers
        - registrar
        - isin
        """
        detail_url = f"https://www.nseindia.com/market-data/issue-information?symbol={symbol}&series={series}&type={issue_type}"

        try:
            logger.debug(f"  Navigating to detail page: {detail_url}")
            await page.goto(detail_url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)  # Rate limiting

            # Wait for content
            await page.wait_for_load_state("networkidle", timeout=20000)

            # Extract data from detail page
            detail_data = {}

            # Try to find all tables
            tables = await page.query_selector_all("table")

            for table in tables:
                rows = await table.query_selector_all("tr")

                for row in rows:
                    cells = await row.query_selector_all("td, th")

                    if len(cells) == 2:
                        key = await cells[0].inner_text()
                        value = await cells[1].inner_text()

                        key = key.strip().lower()
                        value = value.strip()

                        # Map keys to fields
                        if 'price band' in key or 'issue price' in key:
                            price_low, price_high = self._parse_price_band(value)
                            detail_data['price_band_low'] = price_low
                            detail_data['price_band_high'] = price_high

                        elif 'lot size' in key or 'minimum lot' in key:
                            detail_data['lot_size'] = self._parse_number(value)

                        elif 'issue size' in key:
                            detail_data['issue_size'] = self._parse_amount(value)

                        elif 'fresh issue' in key:
                            detail_data['fresh_issue_size'] = self._parse_amount(value)

                        elif 'offer for sale' in key or 'ofs' in key:
                            detail_data['offer_for_sale'] = self._parse_amount(value)

                        elif 'listing date' in key or 'tentative listing' in key:
                            detail_data['listing_date'] = value

                        elif 'lead manager' in key or 'book running' in key:
                            detail_data['lead_managers'] = value

                        elif 'registrar' in key:
                            detail_data['registrar'] = value

                        elif 'isin' in key:
                            detail_data['isin'] = value

            # Save debug info for first few detail pages if no data extracted
            if len(detail_data) == 0:
                import os
                debug_dir = os.path.join(os.path.dirname(__file__), '..', 'debug')
                os.makedirs(debug_dir, exist_ok=True)

                screenshot_path = os.path.join(debug_dir, f'nse_detail_{symbol}.png')
                html_path = os.path.join(debug_dir, f'nse_detail_{symbol}.html')

                await page.screenshot(path=screenshot_path)
                html_content = await page.content()
                with open(html_path, 'w', encoding='utf-8') as f:
                    f.write(html_content)

                logger.warning(f"  No data extracted from detail page. Debug files saved: {screenshot_path}")

            return detail_data if detail_data else None

        except PlaywrightTimeoutError as e:
            logger.warning(f"  Timeout loading detail page for {symbol}: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"  Error scraping detail page for {symbol}: {str(e)}", exc_info=True)
            return None

    def _normalize_status(self, status_text: str) -> str:
        """Normalize NSE status to our standard statuses"""
        if not status_text:
            return 'UPCOMING'

        status_lower = status_text.lower()

        if 'open' in status_lower or 'live' in status_lower:
            return 'LIVE'
        elif 'closed' in status_lower or 'completed' in status_lower:
            return 'CLOSED'
        elif 'upcoming' in status_lower or 'forthcoming' in status_lower:
            return 'UPCOMING'
        else:
            return 'UPCOMING'

    def _parse_number(self, number_str: Optional[str]) -> Optional[int]:
        """Parse integer from string"""
        if not number_str:
            return None

        try:
            import re
            match = re.search(r'\d+', number_str.replace(',', ''))
            if match:
                return int(match.group())
        except Exception as e:
            logger.warning(f"Error parsing number '{number_str}': {str(e)}")

        return None

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
