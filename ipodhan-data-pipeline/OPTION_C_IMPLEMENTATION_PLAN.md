# Option C Implementation Plan: Dual Approach for IPO Data Pipeline

## Executive Summary

This plan combines both quick wins (Option A) and comprehensive solutions (Option B) to populate the IPO database and establish production-ready data pipelines.

**Timeline:** 5-7 hours total
- Option A: 30 minutes (immediate value)
- Option B Phase 1 (NSE): 2-3 hours
- Option B Phase 2 (BSE): 2-3 hours

**Expected Results:**
- 65+ IPO records from GMP data (Option A)
- 65 GMP records successfully linked to IPOs
- 50-100+ comprehensive IPO records from NSE/BSE (Option B)
- Production-ready multi-step scrapers with full IPO details

---

## Option A: Quick Solution - Populate IPOs from GMP Data

### Overview
Create a script to generate basic IPO records from the 65 GMP entries we already have from InvestorGain scraper. This provides immediate value by allowing GMP data to be saved to the database.

### Implementation Details

**File to Create:** `ipodhan-data-pipeline/scripts/populate_ipos_from_gmp.py`

#### Script Structure:

```python
"""
Populate IPO records from existing GMP data
One-time script to bootstrap the database with IPO records
"""

import asyncio
import sys
import os
from pathlib import Path
from datetime import datetime, timedelta
from uuid import uuid4

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from scrapers.investorgain_scraper import InvestorGainScraper
from repositories.ipo_data_repository import IPODataRepository
from validators.normalizer import DataNormalizer

async def main():
    """
    Main execution flow:
    1. Scrape GMP data from InvestorGain (65 records)
    2. Extract unique company names
    3. Create basic IPO records with sensible defaults
    4. Save IPO records to database
    5. Re-run GMP scraper to link data
    """

    # Initialize components
    scraper = InvestorGainScraper()
    repository = IPODataRepository()
    normalizer = DataNormalizer()

    print("Step 1: Scraping GMP data from InvestorGain...")
    gmp_data = await scraper.scrape()
    print(f"✓ Found {len(gmp_data)} GMP records")

    # Extract unique companies
    companies = {}  # company_name -> gmp_record
    for record in gmp_data:
        company_name = record.get('company_name')
        if company_name and company_name not in companies:
            companies[company_name] = record

    print(f"Step 2: Extracted {len(companies)} unique companies")

    # Create IPO records
    created_count = 0
    skipped_count = 0

    for company_name, gmp_record in companies.items():
        # Normalize company name
        normalized_name = normalizer.normalize_company_name(company_name)

        # Generate symbol (first 10 alphanumeric chars)
        symbol = generate_symbol(normalized_name)

        # Check if IPO already exists
        existing = repository.get_ipo_by_symbol(symbol)
        if existing:
            print(f"⊘ Skipping {company_name} - already exists")
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
            'ipo_id': str(uuid4()),
            'company_name': normalized_name,
            'symbol': symbol,
            'exchange': 'NSE',  # Default
            'issue_type': 'IPO',
            'open_date': open_date,
            'close_date': close_date,
            'listing_date': listing_date,
            'price_band_low': price_low,
            'price_band_high': price_high,
            'lot_size': 1,  # Default - needs manual update
            'issue_size': None,  # Unknown
            'fresh_issue_size': None,
            'offer_for_sale': None,
            'status': determine_status(open_date, close_date),
            'category': category,
            'lead_managers': None,
            'registrar': None,
            'listing_exchange': 'NSE',
            'isin': None,
            'data_source': 'GMP_DERIVED',
            'last_updated': datetime.now()
        }

        try:
            repository.save_ipo_data(ipo_data)
            print(f"✓ Created IPO record: {company_name} ({symbol})")
            created_count += 1
        except Exception as e:
            print(f"✗ Error creating {company_name}: {str(e)}")

    print(f"\nStep 3: Summary")
    print(f"  Created: {created_count} IPO records")
    print(f"  Skipped: {skipped_count} (already exist)")

    # Re-run GMP scraper to link data
    print(f"\nStep 4: Re-running GMP scraper to link data...")
    from orchestrator.pipeline_orchestrator import PipelineOrchestrator
    orchestrator = PipelineOrchestrator()
    results = await orchestrator.run_gmp_pipeline()

    print(f"\n✓ Pipeline complete!")
    print(f"  GMP records saved: {results['summary']['total_records']}")

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

if __name__ == "__main__":
    asyncio.run(main())
```

#### Required Repository Changes

**File:** `ipodhan-data-pipeline/repositories/ipo_data_repository.py`

Add method to check if IPO exists:

```python
def get_ipo_by_symbol(self, symbol: str) -> Optional[Dict[str, Any]]:
    """Get IPO record by symbol"""
    conn = self.get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM ipos WHERE symbol = %s",
            (symbol,)
        )
        row = cursor.fetchone()

        if row:
            columns = [desc[0] for desc in cursor.description]
            return dict(zip(columns, row))

        return None
    finally:
        conn.close()
```

### Execution

```bash
cd D:\Abhay\VibeCoding\IPODhan\ipodhan-data-pipeline
.venv\Scripts\python.exe scripts\populate_ipos_from_gmp.py
```

### Expected Results

- 65 IPO records created in `ipos` table
- All IPO records have `data_source = 'GMP_DERIVED'`
- Basic fields populated (company_name, symbol, dates, price_band, category)
- Status determined based on dates (UPCOMING/LIVE/CLOSED)
- GMP pipeline re-runs automatically and links 65 GMP records successfully

### Limitations

- Price bands are estimates, not actual
- Lot sizes default to 1 (need manual correction)
- Issue sizes are NULL
- Dates are estimates (need correction from actual data)
- No financial data, lead managers, registrars

**These limitations will be addressed in Option B**

---

## Option B: Comprehensive Solution - Multi-Step NSE/BSE Scrapers

### Overview

Enhance NSE and BSE scrapers to perform two-step scraping:
1. Scrape main listing page to get company list and detail URLs
2. Navigate to each detail page to extract complete IPO information

### Research Findings

**NSE Main Page Analysis:**
- URL: `https://www.nseindia.com/market-data/all-upcoming-issues-ipo`
- Has 2 tables on the page
- Table 2 contains 10 rows with 8 columns:
  - Company Name (with clickable link to detail page)
  - Security Type
  - Issue Start Date
  - Issue End Date
  - Status
  - Subscription data columns

**Critical Discovery:** Main page does NOT have:
- Price Band (₹X - ₹Y)
- Lot Size
- Issue Size (₹X crores)

**Detail Page Structure:**
- URL format: `/market-data/issue-information?symbol=ADVANCE&series=EQ&type=Active`
- Contains full IPO details including all missing fields

---

## Phase B1: NSE Scraper Enhancement (2-3 hours)

### Implementation Plan

**File to Modify:** `ipodhan-data-pipeline/scrapers/nse_scraper.py`

#### Changes Required:

**1. Update `_extract_ipo_data` method (lines 168-236)**

Current implementation tries to extract all data from main page table. New implementation:

```python
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
```

**2. Add `_parse_main_listing_page` method**

```python
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
            logger.warning("Expected at least 2 tables, found {len(tables)}")
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
```

**3. Add `_parse_detail_url` method**

```python
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
```

**4. Add `_scrape_ipo_detail_page` method**

```python
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
        # NOTE: Actual selectors need to be determined by inspecting the page
        # This is a template that needs adjustment based on actual HTML structure

        detail_data = {}

        # Look for data in tables or divs
        # Common patterns on NSE detail pages:
        # - Tables with key-value pairs
        # - Divs with class like "data-row", "detail-item", etc.

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

        # Save debug info for first few detail pages
        if len(detail_data) == 0:
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
```

**5. Add helper methods**

```python
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
```

### Testing Strategy

1. **Debug Mode First:**
   - Run scraper with debug enabled
   - Capture screenshots and HTML for first 2-3 detail pages
   - Analyze HTML structure to finalize selectors

2. **Iterative Testing:**
   ```bash
   cd D:\Abhay\VibeCoding\IPODhan\ipodhan-data-pipeline
   .venv\Scripts\python.exe -c "import asyncio; from scrapers.nse_scraper import NSEScraper; scraper = NSEScraper(); asyncio.run(scraper.scrape())"
   ```

3. **Validation:**
   - Check that 10+ IPO records are extracted
   - Verify all critical fields are populated
   - Confirm data quality with manual spot-checks

### Expected Results

- 10-50 comprehensive IPO records from NSE
- All critical fields populated (price_band, lot_size, issue_size)
- Financial data, lead managers, registrars captured
- Accurate status and dates
- Detail page HTML/screenshots saved for analysis if needed

---

## Phase B2: BSE Scraper Enhancement (2-3 hours)

### Current Status

BSE scraper is returning "No tables found on BSE page". Need to debug and understand page structure.

### Implementation Plan

**File to Modify:** `ipodhan-data-pipeline/scrapers/bse_scraper.py`

#### Step 1: Add Debugging (Similar to NSE)

Add debugging code to understand BSE page structure:

```python
# After successful navigation, add:
import os
debug_dir = os.path.join(os.path.dirname(__file__), '..', 'debug')
os.makedirs(debug_dir, exist_ok=True)

screenshot_path = os.path.join(debug_dir, 'bse_page.png')
html_path = os.path.join(debug_dir, 'bse_page.html')

await page.screenshot(path=screenshot_path, full_page=True)
logger.info(f"Screenshot saved to: {screenshot_path}")

html_content = await page.content()
with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html_content)
logger.info(f"HTML saved to: {html_path}")

# Log page structure
page_title = await page.title()
logger.info(f"Page title: {page_title}")

tables = await page.query_selector_all("table")
logger.info(f"Found {len(tables)} tables")

divs = await page.query_selector_all("div.table, div[id*='ipo'], div[class*='ipo']")
logger.info(f"Found {len(divs)} potential IPO divs")
```

#### Step 2: Run Debugging Session

```bash
cd D:\Abhay\VibeCoding\IPODhan\ipodhan-data-pipeline
.venv\Scripts\python.exe -c "import asyncio; from scrapers.bse_scraper import BSEScraper; scraper = BSEScraper(); asyncio.run(scraper.scrape())"
```

Analyze outputs:
- Review screenshot to see page structure
- Inspect HTML to find data containers
- Determine if BSE uses tables, divs, or JavaScript-rendered content

#### Step 3: Implement Parser Based on Findings

**Scenario A: BSE uses tables (like NSE)**
- Implement similar two-step scraping approach
- Parse main listing table
- Visit detail pages for complete data

**Scenario B: BSE uses divs or cards**
- Implement div/card parser
- Extract data from structured divs
- May not need detail pages if all data is on main page

**Scenario C: BSE uses JavaScript/AJAX**
- Monitor network requests to find API endpoints
- Use API directly instead of HTML parsing
- Implement JSON parser

#### Step 4: Implement Based on Analysis

Template for table-based approach (adjust after debugging):

```python
async def _extract_ipo_data(self, page: Page) -> List[Dict[str, Any]]:
    """Extract IPO data from BSE page"""
    ipo_list = []

    try:
        # Adjust based on actual BSE structure
        tables = await page.query_selector_all("table")

        if not tables:
            logger.warning("No tables found on BSE page")
            return []

        # Process each table (adjust index based on which table has IPO data)
        for table in tables:
            rows = await table.query_selector_all("tbody tr")

            for row in rows:
                cells = await row.query_selector_all("td")

                if len(cells) < 5:
                    continue

                # Extract data (adjust column indices based on actual structure)
                ipo_data = await self._parse_bse_row(cells)

                if ipo_data and self.validate(ipo_data):
                    ipo_data['data_source'] = 'BSE'
                    ipo_data['exchange'] = 'BSE'
                    ipo_list.append(ipo_data)

    except Exception as e:
        logger.error(f"Error extracting BSE data: {str(e)}", exc_info=True)

    return ipo_list
```

### Testing Strategy

1. **Debug first:** Capture page structure
2. **Analyze:** Determine parsing strategy
3. **Implement:** Build parser based on findings
4. **Validate:** Test with multiple IPOs

### Expected Results

- 20-30 comprehensive IPO records from BSE
- All critical fields populated
- SME IPOs included (BSE has many SME listings)

---

## Integration Testing

After completing both Option A and Option B, run comprehensive integration tests:

### Test 1: Full Pipeline Run

```bash
cd D:\Abhay\VibeCoding\IPODhan\ipodhan-data-pipeline
.venv\Scripts\python.exe main.py run-all
```

Expected results:
- NSE: 10-50 IPO records
- BSE: 20-30 IPO records
- InvestorGain: 65+ GMP records linked to IPOs
- IPOWatch: 0-20 GMP records
- Chittorgarh: 0-15 GMP records

### Test 2: Health Check

```bash
.venv\Scripts\python.exe main.py health-check
```

Expected output:
```
Health Check Report
==================
Database: ✓ Connected (11 tables)
IPO Data: ✓ 65-100 records, freshness: <1 hour
GMP Data: ✓ 65-100 records, freshness: <1 hour
Pipeline Status: ✓ All sources SUCCESS
Last Run: <5 minutes ago
```

### Test 3: Data Quality Validation

```bash
.venv\Scripts\python.exe scripts/validate_data_quality.py
```

Check:
- All IPOs have required fields populated
- Price bands are reasonable (₹10-₹5000 range)
- Dates are valid and logical (open < close < listing)
- Symbols are unique
- No duplicate records
- GMP records properly linked to IPOs

---

## Rollback Plan

If Option B implementation encounters issues:

1. **Option A is complete and working** - database has 65 IPO records with GMP data
2. Can continue using Option A data while debugging Option B
3. No data loss or corruption risk
4. Each phase is independent and can be rolled back separately

---

## Success Criteria

### Option A Success:
- ✓ 65 IPO records in database
- ✓ 65 GMP records successfully linked
- ✓ No foreign key constraint errors
- ✓ Data queryable via API/dashboard

### Option B Phase 1 Success (NSE):
- ✓ 10-50 comprehensive IPO records from NSE
- ✓ All critical fields populated (price_band, lot_size, issue_size)
- ✓ Multi-step scraper working reliably
- ✓ Rate limiting and error handling in place

### Option B Phase 2 Success (BSE):
- ✓ 20-30 comprehensive IPO records from BSE
- ✓ SME IPOs included
- ✓ All critical fields populated

### Overall Success:
- ✓ 65-100+ total IPO records in database
- ✓ 65-100+ GMP records linked to IPOs
- ✓ All 3 data sources (NSE, BSE, GMP) working
- ✓ Production-ready pipelines with monitoring
- ✓ Health checks passing
- ✓ Data freshness <1 hour

---

## File Summary

### Files to Create:
1. `ipodhan-data-pipeline/scripts/populate_ipos_from_gmp.py` (Option A - ~300 lines)
2. `ipodhan-data-pipeline/scripts/validate_data_quality.py` (Testing - ~200 lines)

### Files to Modify:
1. `ipodhan-data-pipeline/repositories/ipo_data_repository.py` (Add get_ipo_by_symbol method - ~15 lines)
2. `ipodhan-data-pipeline/scrapers/nse_scraper.py` (Multi-step scraping - ~400 new lines, ~100 modified)
3. `ipodhan-data-pipeline/scrapers/bse_scraper.py` (Debugging + parsing - ~300 modified lines)

### Total Code Changes:
- New code: ~800-1000 lines
- Modified code: ~500 lines
- 5 files affected

---

## Timeline

### Option A (30 minutes)
- 10 min: Create populate_ipos_from_gmp.py script
- 5 min: Add get_ipo_by_symbol method to repository
- 5 min: Test script execution
- 10 min: Verify results and run health check

### Option B Phase 1 - NSE (2-3 hours)
- 30 min: Implement _parse_main_listing_page method
- 45 min: Implement _scrape_ipo_detail_page method
- 30 min: Add helper methods and error handling
- 30 min: Debug with real NSE pages (screenshot analysis)
- 30 min: Testing and validation

### Option B Phase 2 - BSE (2-3 hours)
- 45 min: Add debugging and capture BSE page structure
- 45 min: Analyze structure and determine parsing strategy
- 60 min: Implement parser based on findings
- 30 min: Testing and validation

### Integration Testing (30 minutes)
- 15 min: Full pipeline run
- 10 min: Health check and validation
- 5 min: Documentation updates

**Total: 5-7 hours**

---

## Next Steps

1. **User approval of this plan**
2. **Execute Option A** (immediate value - 30 min)
3. **Execute Option B Phase 1** (NSE enhancement - 2-3 hours)
4. **Execute Option B Phase 2** (BSE enhancement - 2-3 hours)
5. **Integration testing and validation** (30 min)
6. **Commit all changes to git**
7. **Update documentation with findings**

---

## Notes

- This plan prioritizes getting data into the database quickly (Option A) while building robust long-term solutions (Option B)
- Anti-bot bypasses are already working for NSE - focus is on data extraction logic
- BSE requires investigation before implementation can be finalized
- All changes are backwards compatible with existing code
- No database schema changes required
- All code uses existing validators and normalizers
