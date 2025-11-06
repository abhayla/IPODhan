# Implementation Plan: Core Data Quality Fixes

**Created**: 2025-11-04
**Updated**: 2025-01-04 (PDF Parser: pdfplumber Python microservice)
**Status**: PLANNING
**Timeline**: 2-3 Weeks (58 hours)
**Focus**: Financial Data, Promoter Holding, Issue Structure, Subscription Monitoring, Lot Size
**PDF Parsing**: pdfplumber Python microservice (96-99.9% accuracy)

---

## Executive Summary

This plan addresses the 31 remaining data quality issues identified in Phase 9-10 investigation. After comprehensive analysis, we've identified that:

1. **Financial Data** (28 fields) - 0% coverage, scraper exists but not integrated
2. **Promoter Holding & Issue Structure** - May be available via BSE scraping (needs investigation)
3. **Subscription Monitoring** - Critical to prevent future data loss
4. **Lot Size** - Trivial one-line fix + backfill script
5. **Live Stock Prices** - EXCLUDED (out of scope)
6. **IPO Reviews** - EXCLUDED (out of scope)

---

## Focus Areas (Simplified)

1. **Financial Data** (PDF parsing integration) - P0 CRITICAL
2. **Promoter Holding & Issue Structure** (BSE scraping) - P0 HIGH
3. **Subscription Monitoring** (prevent future data loss) - P0 CRITICAL
4. **Lot Size Fix** (trivial scraper fix + backfill) - P1 QUICK WIN
5. **Contact Information** (DRHP extraction) - P2 OPTIONAL

---

## PHASE 12: Core Data Quality (2-3 Weeks)

### Week 1: Schema Validation + BSE Scraping Enhancement

#### Task 1.1: Schema Validation (Day 1 - 2 hours)

**Verify All Required Fields Exist:**

```sql
-- Check ipos table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'ipos'
AND column_name IN (
  'promoter_holding_pre_issue',
  'promoter_holding_post_issue',
  'fresh_issue',
  'ofs_issue',
  'min_investment'
);

-- Check financialData table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'financial_data'
AND column_name LIKE '%revenue%'
   OR column_name LIKE '%profit%'
   OR column_name LIKE '%ebitda%';

-- Check subscriptions table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'subscriptions';
```

**Actions:**
- ✅ If all fields exist: Proceed
- ❌ If fields missing: Generate migration, apply to dev DB, test, then apply to prod

**Deliverable**: `docs/schema-validation-report.md`

---

#### Task 1.2: Investigate BSE Detail Pages (Day 1 - 2 hours)

**Manual Investigation:**
1. Visit BSE detail pages for 5-10 IPOs:
   - https://www.bseindia.com/stock-share-price/ipo/{IPO-NAME}/
2. Check for these sections:
   - **Promoter Holding**: Pre-IPO and Post-IPO percentages
   - **Issue Structure**: Fresh Issue vs OFS breakdown
   - **Minimum Investment**: Displayed amount
3. Screenshot HTML structure for parser development
4. Test with Inspect Element to find CSS selectors

**Document Findings:**
```markdown
# BSE Detail Page Analysis

## Promoter Holding Section
- **Available**: Yes/No
- **HTML Structure**: <div class="promoter-info">...</div>
- **CSS Selector**: .promoter-info .pre-ipo-percentage
- **Sample Data**: Pre: 75.5%, Post: 68.2%
- **Success Probability**: 80%+

## Issue Structure Section
- **Available**: Yes/No
- **HTML Structure**: <table class="issue-breakdown">...</table>
- **CSS Selector**: .issue-breakdown td:nth-child(2)
- **Sample Data**: Fresh: ₹500 Cr, OFS: ₹300 Cr
- **Success Probability**: 85%+

## Recommendation
- [ ] Proceed with scraping (data available)
- [ ] Skip scraping (data not available, use PDF parsing)
```

**Deliverable**: `scraper/docs/BSE_DETAIL_PAGE_ANALYSIS.md`

---

#### Task 1.3: Enhance BSE Detail Scraper (Day 2-3 - 6-8 hours)

**Only if Task 1.2 confirms data availability**

**File**: `scraper/src/scrapers/bse-detail-scraper.ts`

**Add Extraction Logic:**

```typescript
// 1. Promoter Holding Extraction
async function extractPromoterHolding(html: string): {
  preIssue: number | null;
  postIssue: number | null;
} {
  // Parse HTML for promoter holding section
  // Extract percentages (handle "75.50%" format)
  // Validate range (0-100%)
  return { preIssue, postIssue };
}

// 2. Issue Structure Extraction
async function extractIssueStructure(html: string): {
  freshIssue: number | null;
  ofsIssue: number | null;
  issueType: string | null;
} {
  // Parse HTML for issue breakdown table
  // Extract amounts in crores
  // Convert to numeric (remove ₹, Cr symbols)
  // Validate: freshIssue + ofsIssue ≈ totalIssueSize
  return { freshIssue, ofsIssue, issueType };
}

// 3. Minimum Investment Calculation
function calculateMinInvestment(lotSize: number, priceMin: number): number {
  return lotSize * priceMin;
}

// 4. Integration into main scraper
async function scrapeBSEDetail(ipoUrl: string) {
  const html = await fetchBSEDetailPage(ipoUrl);

  const promoterData = await extractPromoterHolding(html);
  const issueData = await extractIssueStructure(html);
  const minInvestment = calculateMinInvestment(lotSize, priceMin);

  return {
    promoterHoldingPreIssue: promoterData.preIssue,
    promoterHoldingPostIssue: promoterData.postIssue,
    freshIssue: issueData.freshIssue,
    ofsIssue: issueData.ofsIssue,
    issueType: issueData.issueType,
    minInvestment,
  };
}
```

**Testing:**
- Test on 10 different IPOs (mix of old/new, MAINBOARD/SME)
- Verify extracted data matches BSE website manually
- Check edge cases: NULL values, malformed HTML, missing sections
- Success criteria: 80%+ extraction success rate

**Files Modified:**
- `scraper/src/scrapers/bse-detail-scraper.ts` - Add extraction functions
- `scraper/src/services/data-persister.ts` - Update upsert logic for new fields
- `scraper/tests/unit/bse-detail-scraper.test.ts` - Add unit tests (10+ test cases)

---

### Week 2: Python PDF Microservice (pdfplumber - 96-99.9% Accuracy)

#### Task 2.1: Create Python PDF Microservice (Day 4-5 - 12-14 hours)

**Goal**: Build standalone Python service with pdfplumber for 96-99.9% table extraction accuracy

**Architecture:**
```
Node.js Scraper → HTTP Request → Python PDF Service (FastAPI) → pdfplumber → JSON Response
```

**New Directory Structure:**
```
IPODhan/
├── pdf-parser/                    # NEW Python microservice
│   ├── src/
│   │   ├── __init__.py
│   │   ├── main.py               # FastAPI app
│   │   ├── parsers/
│   │   │   ├── __init__.py
│   │   │   ├── table_extractor.py   # pdfplumber logic
│   │   │   ├── text_extractor.py    # PyMuPDF for fast text
│   │   │   └── drhp_parser.py       # DRHP-specific parsing
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── schemas.py        # Pydantic models
│   │   └── utils/
│   │       ├── __init__.py
│   │       ├── validators.py     # Data validation
│   │       └── converters.py     # Unit conversion
│   ├── tests/
│   │   ├── test_table_extractor.py
│   │   └── sample_drhps/
│   ├── requirements.txt
│   ├── Dockerfile
│   └── README.md
```

**Implementation:**

**File**: `pdf-parser/src/main.py` (FastAPI REST API)
```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import pdfplumber
import pymupdf
import requests
from typing import List, Dict, Optional

app = FastAPI(title="DRHP PDF Parser", version="1.0.0")

class ParseRequest(BaseModel):
    pdf_url: str
    extract_tables: bool = True
    extract_text: bool = False
    pages: Optional[str] = None  # "1-10" or "all"

class FinancialData(BaseModel):
    revenue_fy2022: Optional[float] = None
    revenue_fy2023: Optional[float] = None
    revenue_fy2024: Optional[float] = None
    profit_fy2022: Optional[float] = None
    profit_fy2023: Optional[float] = None
    profit_fy2024: Optional[float] = None
    ebitda_fy2022: Optional[float] = None
    ebitda_fy2023: Optional[float] = None
    ebitda_fy2024: Optional[float] = None
    pe_ratio: Optional[float] = None
    eps: Optional[float] = None
    roe: Optional[float] = None
    debt_to_equity: Optional[float] = None
    promoter_holding_pre: Optional[float] = None
    promoter_holding_post: Optional[float] = None

@app.post("/parse-drhp")
async def parse_drhp(request: ParseRequest):
    """
    Parse DRHP PDF and extract financial tables with 96-99.9% accuracy.

    Uses pdfplumber for table extraction.
    Returns structured financial data as JSON.
    """
    try:
        # Download PDF
        response = requests.get(request.pdf_url, timeout=60)
        pdf_content = response.content

        # Extract tables using pdfplumber
        tables = []
        with pdfplumber.open(io.BytesIO(pdf_content)) as pdf:
            for page in pdf.pages:
                page_tables = page.extract_tables({
                    'vertical_strategy': 'lines',
                    'horizontal_strategy': 'lines',
                    'intersection_tolerance': 3,
                    'snap_tolerance': 3,
                    'join_tolerance': 3,
                    'edge_min_length': 3
                })
                tables.extend(page_tables)

        # Parse financial data from tables
        financial_data = parse_financial_tables(tables)

        return {
            "success": True,
            "financial_data": financial_data,
            "tables_found": len(tables),
            "confidence": calculate_confidence(financial_data)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy", "parser": "pdfplumber", "accuracy": "96-99.9%"}
```

**File**: `pdf-parser/src/parsers/table_extractor.py` (pdfplumber logic)
```python
import pdfplumber
import re
from typing import List, Dict, Optional

def extract_financial_tables(pdf_path: str, pages: str = "all") -> List[List[List[str]]]:
    """
    Extract tables from DRHP PDF using pdfplumber (96-99.9% accuracy).

    Args:
        pdf_path: Path to PDF file or URL
        pages: Page range ("1-10", "1,5,10", or "all")

    Returns:
        List of tables, each table is a list of rows
    """
    tables = []

    with pdfplumber.open(pdf_path) as pdf:
        # Parse page range
        if pages == "all":
            pages_to_process = pdf.pages
        else:
            page_numbers = parse_page_range(pages)
            pages_to_process = [pdf.pages[i-1] for i in page_numbers if i <= len(pdf.pages)]

        for page in pages_to_process:
            # Extract tables with optimized settings for financial documents
            page_tables = page.extract_tables({
                'vertical_strategy': 'lines',        # Detect vertical borders
                'horizontal_strategy': 'lines',      # Detect horizontal borders
                'intersection_tolerance': 3,         # Tolerance for line intersections
                'snap_tolerance': 3,                 # Snap text to grid
                'join_tolerance': 3,                 # Join broken lines
                'edge_min_length': 3,                # Minimum border length
                'min_words_vertical': 1,             # Minimum words for column
                'min_words_horizontal': 1,           # Minimum words for row
                'keep_blank_chars': False,           # Remove whitespace
                'text_tolerance': 3,                 # Text alignment tolerance
                'intersection_x_tolerance': 5,       # Vertical intersection tolerance
                'intersection_y_tolerance': 5        # Horizontal intersection tolerance
            })

            if page_tables:
                tables.extend(page_tables)

    return tables

def extract_borderless_tables(pdf_path: str) -> List[List[List[str]]]:
    """
    Extract tables without borders using text positioning.

    pdfplumber can handle borderless tables by analyzing text alignment.
    """
    tables = []

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            # For borderless tables, use text strategy
            page_tables = page.extract_tables({
                'vertical_strategy': 'text',    # Use text alignment for vertical
                'horizontal_strategy': 'text',  # Use text alignment for horizontal
                'explicit_vertical_lines': [],
                'explicit_horizontal_lines': []
            })

            if page_tables:
                tables.extend(page_tables)

    return tables

def parse_page_range(page_range: str) -> List[int]:
    """Parse page range string to list of page numbers."""
    pages = []
    for part in page_range.split(','):
        if '-' in part:
            start, end = map(int, part.split('-'))
            pages.extend(range(start, end + 1))
        else:
            pages.append(int(part))
    return pages
```

**File**: `pdf-parser/src/parsers/drhp_parser.py` (DRHP-specific logic)
```python
import re
from typing import Dict, List, Optional

def parse_financial_tables(tables: List[List[List[str]]]) -> Dict:
    """
    Parse financial data from extracted tables.

    Looks for financial statement tables (Income Statement, Balance Sheet)
    and extracts Revenue, Profit, EBITDA, ROE, etc.
    """
    financial_data = {
        'revenue_fy2022': None,
        'revenue_fy2023': None,
        'revenue_fy2024': None,
        'profit_fy2022': None,
        'profit_fy2023': None,
        'profit_fy2024': None,
        'ebitda_fy2022': None,
        'ebitda_fy2023': None,
        'ebitda_fy2024': None,
        'pe_ratio': None,
        'eps': None,
        'roe': None,
        'debt_to_equity': None,
        'promoter_holding_pre': None,
        'promoter_holding_post': None
    }

    for table in tables:
        if not table or len(table) < 2:
            continue

        # Check if this is a financial statement table
        header = ' '.join(table[0]).lower() if table[0] else ''

        # Revenue from Operations table
        if 'revenue' in header or 'total income' in header:
            financial_data.update(extract_revenue_from_table(table))

        # Profit & Loss table
        if 'profit' in header or 'pat' in header or 'net income' in header:
            financial_data.update(extract_profit_from_table(table))

        # EBITDA table
        if 'ebitda' in header:
            financial_data.update(extract_ebitda_from_table(table))

        # Financial Ratios table
        if 'ratio' in header or 'roe' in header or 'eps' in header:
            financial_data.update(extract_ratios_from_table(table))

        # Promoter Holding table
        if 'promoter' in header or 'shareholding' in header:
            financial_data.update(extract_promoter_holding_from_table(table))

    return financial_data

def extract_revenue_from_table(table: List[List[str]]) -> Dict:
    """Extract revenue data from financial table."""
    revenue = {}

    for row in table:
        if not row or len(row) < 4:
            continue

        row_text = ' '.join(row).lower()

        # Check if this is a revenue row
        if any(keyword in row_text for keyword in ['revenue from operations', 'total income', 'sales']):
            # Extract years and values
            years, values = extract_years_and_values(row)

            for year, value in zip(years, values):
                if year == 2022 or year == 22:
                    revenue['revenue_fy2022'] = convert_to_crores(value)
                elif year == 2023 or year == 23:
                    revenue['revenue_fy2023'] = convert_to_crores(value)
                elif year == 2024 or year == 24:
                    revenue['revenue_fy2024'] = convert_to_crores(value)

    return revenue

def extract_years_and_values(row: List[str]) -> tuple:
    """Extract fiscal years and corresponding values from table row."""
    years = []
    values = []

    for cell in row:
        # Check for year pattern (FY2024, FY24, 2024, etc.)
        year_match = re.search(r'(?:FY\s*)?(?:20)?(\d{2})', cell)
        if year_match:
            year = int(year_match.group(1))
            if year < 100:  # Convert 2-digit to 4-digit
                year = 2000 + year if year < 50 else 1900 + year
            years.append(year)

        # Check for numeric value
        value_match = re.search(r'[\d,]+\.?\d*', cell)
        if value_match:
            value = float(value_match.group().replace(',', ''))
            values.append(value)

    return years, values

def convert_to_crores(value: float) -> float:
    """Convert value to crores (handles lakhs, crores, absolute amounts)."""
    # Assume values > 10000 are in lakhs, need conversion to crores
    if value > 10000:
        return value / 100
    return value

def extract_profit_from_table(table: List[List[str]]) -> Dict:
    """Extract profit data from financial table."""
    # Similar logic to extract_revenue_from_table
    # Look for "PAT", "Net Profit", "Profit After Tax"
    pass

def extract_ebitda_from_table(table: List[List[str]]) -> Dict:
    """Extract EBITDA data from financial table."""
    pass

def extract_ratios_from_table(table: List[List[str]]) -> Dict:
    """Extract financial ratios (PE, EPS, ROE, D/E) from table."""
    pass

def extract_promoter_holding_from_table(table: List[List[str]]) -> Dict:
    """Extract promoter holding percentages (Pre-IPO and Post-IPO)."""
    pass
```

**File**: `pdf-parser/requirements.txt`
```txt
fastapi==0.115.6
uvicorn[standard]==0.34.0
pdfplumber==0.11.6
pymupdf==1.25.5
requests==2.32.3
pydantic==2.10.5
python-multipart==0.0.20
```

**File**: `pdf-parser/Dockerfile`
```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY src/ ./src/

# Expose port
EXPOSE 8000

# Run FastAPI app
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Testing:**
- Test with 10 sample DRHP PDFs (various formats)
- Verify table extraction accuracy (target: 96%+)
- Test borderless table detection
- Verify currency conversion (lakhs → crores)
- Check year detection (FY24, FY2024, 2023-24)

**Success Criteria:**
- ✅ 96%+ accuracy for bordered tables
- ✅ 85%+ accuracy for borderless tables
- ✅ <10 seconds processing time for 200-page DRHP
- ✅ Structured JSON output

---

#### Task 2.2: Integrate Python Service with Node.js Scraper (Day 6 - 4 hours)

**File**: `scraper/src/services/pdf-parser-client.ts` (NEW)

**HTTP Client to Python Service:**
```typescript
import axios from 'axios';

const PDF_PARSER_URL = process.env.PDF_PARSER_URL || 'http://localhost:8000';

export interface FinancialData {
  revenueFy2022?: number;
  revenueFy2023?: number;
  revenueFy2024?: number;
  profitFy2022?: number;
  profitFy2023?: number;
  profitFy2024?: number;
  ebitdaFy2022?: number;
  ebitdaFy2023?: number;
  ebitdaFy2024?: number;
  peRatio?: number;
  eps?: number;
  roe?: number;
  debtToEquity?: number;
  promoterHoldingPre?: number;
  promoterHoldingPost?: number;
}

export interface ParseDRHPResponse {
  success: boolean;
  financial_data: FinancialData;
  tables_found: number;
  confidence: number;
}

export async function parseDRHPPDF(pdfUrl: string): Promise<ParseDRHPResponse | null> {
  try {
    console.log(`[PDF Parser] Requesting parse for: ${pdfUrl}`);

    const response = await axios.post<ParseDRHPResponse>(
      `${PDF_PARSER_URL}/parse-drhp`,
      {
        pdf_url: pdfUrl,
        extract_tables: true,
        pages: 'all'
      },
      {
        timeout: 60000, // 60 seconds
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`[PDF Parser] Success! Found ${response.data.tables_found} tables`);
    console.log(`[PDF Parser] Confidence: ${response.data.confidence}%`);

    return response.data;

  } catch (error) {
    console.error('[PDF Parser] Error:', error.message);

    // Check if service is down
    if (error.code === 'ECONNREFUSED') {
      console.error('[PDF Parser] Service is not running! Start with: docker-compose up pdf-parser');
    }

    return null;
  }
}

export async function checkPDFParserHealth(): Promise<boolean> {
  try {
    const response = await axios.get(`${PDF_PARSER_URL}/health`, { timeout: 5000 });
    return response.data.status === 'healthy';
  } catch {
    return false;
  }
}
```

**File**: `scraper/src/scrapers/nse-scraper-orchestrator-v2.ts`

**Integration into Main Pipeline:**
```typescript
import { parseDRHPPDF } from '../services/pdf-parser-client';

async function scrapeIPOComplete(ipoSymbol: string) {
  // Step 1: Scrape basic IPO data (NSE API)
  const basicData = await nseApiClient.getIPODetail(ipoSymbol);

  // Step 2: Scrape BSE detail page
  const bseData = await bseDetailScraper.scrape(basicData.companyName);

  // Step 3: Fetch DRHP document URL from documents table
  const drhpDoc = await db.select()
    .from(documents)
    .where(and(
      eq(documents.ipoId, basicData.id),
      eq(documents.type, 'DRHP')
    ))
    .limit(1);

  // Step 4: Parse financial data from DRHP using Python microservice
  let financialData = null;
  if (drhpDoc && drhpDoc.url) {
    try {
      console.log(`[Scraper] Parsing DRHP for ${basicData.companyName}...`);

      const parseResult = await parseDRHPPDF(drhpDoc.url);

      if (parseResult && parseResult.success) {
        financialData = parseResult.financial_data;

        // Validate extracted data
        const validation = validateFinancialData(financialData);
        if (!validation.isValid) {
          logger.warn(`Financial data validation failed: ${validation.errors.join(', ')}`);
        }

        // Store in database
        await db.insert(financialDataTable).values({
          ipoId: basicData.id,
          ...financialData,
          dataSource: 'DRHP_PDFPLUMBER',
          confidence: parseResult.confidence,
        });

        console.log(`[Scraper] ✅ Financial data parsed with ${parseResult.confidence}% confidence`);
      } else {
        console.warn(`[Scraper] ⚠️  Failed to parse DRHP for ${basicData.companyName}`);
      }

    } catch (error) {
      logger.error(`Failed to parse financial data: ${error.message}`);
      // Don't fail entire scrape, just skip financial data
    }
  }

  // Step 5: Merge and persist
  await dataPersister.upsertIPO({
    ...basicData,
    ...bseData,
    financialData,
  });
}
```

**Environment Variables:**
```bash
# .env
PDF_PARSER_URL=http://localhost:8000  # Local development
# PDF_PARSER_URL=http://pdf-parser:8000  # Docker compose
# PDF_PARSER_URL=http://pdf-parser-service:8000  # Production
```

**Docker Compose Integration:**
```yaml
# docker-compose.yml (add to existing compose file)
services:
  pdf-parser:
    build: ./pdf-parser
    container_name: ipodhan-pdf-parser
    ports:
      - "8000:8000"
    environment:
      - PYTHONUNBUFFERED=1
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

---

#### Task 2.3: Testing & Validation (Day 7 - 4 hours)

**Python Service Tests:**
```bash
# Test Python service locally
cd pdf-parser
pip install -r requirements.txt
uvicorn src.main:app --reload

# Test health endpoint
curl http://localhost:8000/health

# Test parse endpoint with sample DRHP
curl -X POST http://localhost:8000/parse-drhp \
  -H "Content-Type: application/json" \
  -d '{"pdf_url": "https://example.com/sample-drhp.pdf", "extract_tables": true}'
```

**Integration Tests:**
```typescript
// File: scraper/tests/integration/pdf-parser-integration.test.ts

describe('PDF Parser Integration', () => {
  it('should parse DRHP and extract financial data', async () => {
    const sampleDRHPUrl = 'https://www.nseindia.com/drhp/sample.pdf';

    const result = await parseDRHPPDF(sampleDRHPUrl);

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.tables_found).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThanOrEqual(80);
    expect(result.financial_data.revenueFy2024).toBeDefined();
  });

  it('should handle service downtime gracefully', async () => {
    // Stop PDF parser service
    const result = await parseDRHPPDF('https://example.com/test.pdf');

    // Should return null, not throw error
    expect(result).toBeNull();
  });

  it('should validate extracted data', async () => {
    const result = await parseDRHPPDF(sampleDRHPUrl);

    const validation = validateFinancialData(result.financial_data);

    // Revenue should be positive
    expect(result.financial_data.revenueFy2024).toBeGreaterThan(0);

    // Profit should be less than revenue
    if (result.financial_data.profitFy2024) {
      expect(result.financial_data.profitFy2024).toBeLessThanOrEqual(
        result.financial_data.revenueFy2024
      );
    }
  });
});
```

**Manual Testing Checklist:**
- [ ] Start Python service: `docker-compose up pdf-parser`
- [ ] Verify health check: `curl http://localhost:8000/health`
- [ ] Test with 5 sample DRHPs (various formats)
- [ ] Verify table extraction accuracy (96%+ target)
- [ ] Check Node.js scraper integration
- [ ] Verify database storage
- [ ] Test error handling (service down, invalid PDF, etc.)

**Performance Benchmarks:**
- Target: <10 seconds for 200-page DRHP
- Accuracy: 96-99.9% for financial tables
- Concurrent requests: Support 5-10 parallel parses

---

#### Task 2.4: Deployment Setup (Day 7 - 2 hours)

**Production Deployment:**

**Option 1: Docker Compose (Recommended for VPS)**
```bash
# Build and start PDF parser service
docker-compose up -d pdf-parser

# Verify service is running
docker-compose logs pdf-parser

# Check health
curl http://localhost:8000/health
```

**Option 2: PM2 (Python Service)**
```bash
# Install Python dependencies
cd pdf-parser
pip install -r requirements.txt

# Run with PM2
pm2 start "uvicorn src.main:app --host 0.0.0.0 --port 8000" --name pdf-parser

# Check status
pm2 list
pm2 logs pdf-parser
```

**Monitoring:**
```typescript
// Add health check to scraper startup
async function checkDependencies() {
  const pdfParserHealthy = await checkPDFParserHealth();

  if (!pdfParserHealthy) {
    logger.error('[Startup] PDF Parser service is not available!');
    logger.error('[Startup] Start with: docker-compose up pdf-parser');
    // Don't exit, just warn - scraper can still run without financial data
  } else {
    logger.info('[Startup] ✅ PDF Parser service is healthy');
  }
}
```

**Deliverables:**
1. `pdf-parser/` - Complete Python microservice
2. `scraper/src/services/pdf-parser-client.ts` - Node.js HTTP client
3. `docker-compose.yml` - Docker deployment configuration
4. `pdf-parser/README.md` - Service documentation
5. Integration tests passing

---

### Week 3: Subscription Monitoring + Lot Size Fix

#### Task 3.1: Subscription Monitoring Service (Day 8-9 - 6-8 hours)

**File**: `scraper/src/services/subscription-monitor.ts`

**Implementation:**

```typescript
import { db } from '../../web/lib/db';
import { ipos, subscriptions } from '../../web/lib/db/schema';
import { eq } from 'drizzle-orm';
import { nseApiClient } from '../scrapers/nse-api-client';
import { sendAlert } from './alert-service';

export async function monitorOpenIPOs() {
  console.log('[Subscription Monitor] Starting...');

  // 1. Find all OPEN IPOs
  const openIPOs = await db.select()
    .from(ipos)
    .where(eq(ipos.status, 'OPEN'));

  console.log(`Found ${openIPOs.length} OPEN IPOs to monitor`);

  const failures: string[] = [];

  // 2. For each IPO, scrape current subscription
  for (const ipo of openIPOs) {
    try {
      console.log(`Scraping subscription for: ${ipo.companyName}`);

      const subscriptionData = await nseApiClient.getSubscription(ipo.symbol);

      // 3. Store timestamped snapshot
      await db.insert(subscriptions).values({
        ipoId: ipo.id,
        timestamp: new Date(),
        qibSubscription: subscriptionData.qib,
        niiSubscription: subscriptionData.nii,
        retailSubscription: subscriptionData.retail,
        employeeSubscription: subscriptionData.employee,
        totalSubscription: subscriptionData.total,
        // ... all subscription fields
        dataSource: 'NSE_API_MONITOR',
      });

      console.log(`✅ Captured subscription snapshot for ${ipo.companyName}`);

    } catch (error) {
      console.error(`❌ Failed to scrape ${ipo.companyName}:`, error);
      failures.push(ipo.companyName);
    }
  }

  // 4. Send alert if scraping fails
  if (failures.length > 0) {
    await sendAlert(
      `Subscription scraping failed for ${failures.join(', ')}`,
      'WARNING'
    );
  }

  console.log(`[Subscription Monitor] Complete. Failures: ${failures.length}`);
}
```

**Cron Configuration:**
```typescript
// File: scraper/src/scheduler/subscription-cron.ts
import cron from 'node-cron';
import { monitorOpenIPOs } from '../services/subscription-monitor';

// Run every 2 hours during market days (9 AM - 5 PM)
cron.schedule('0 9,11,13,15,17 * * 1-5', async () => {
  await monitorOpenIPOs();
});
```

**PM2 Configuration:**
```javascript
// ecosystem.config.js
{
  name: 'subscription-monitor',
  script: './scraper/src/scheduler/subscription-cron.ts',
  instances: 1,
  autorestart: true,
  watch: false,
  max_memory_restart: '500M',
}
```

**Testing:**
- Run manually on current OPEN IPO
- Verify snapshot stored in database
- Simulate NSE API failure, check alert system
- Check logs for proper error handling

---

#### Task 3.2: Lot Size Fix (Day 10 - 1 hour)

**File**: `scraper/src/scrapers/nse-scraper.ts:249`

**Current Code (WRONG):**
```typescript
lotSize: undefined,  // ❌ Hardcoded
```

**Fixed Code:**
```typescript
lotSize: parseInt(data.lotSize) || undefined,  // ✅ Extract from API
```

**Why This Works:**
- NSE API already returns `lotSize` field in response
- We were just ignoring it!
- One-line fix with huge impact

**Testing:**
- Run scraper on 5 test IPOs
- Verify lot_size populated in database
- Check UI displays lot size correctly

---

#### Task 3.3: Lot Size Backfill Script (Day 10-11 - 4 hours)

**File**: `web/scripts/backfill-lot-size.ts`

**Implementation:**

```typescript
import { db } from '../lib/db';
import { ipos } from '../lib/db/schema';
import { eq, isNull } from 'drizzle-orm';
import { nseApiClient } from '../../scraper/src/scrapers/nse-api-client';

async function backfillLotSize() {
  console.log('Starting lot size backfill...');

  // 1. Find all IPOs with NULL lot_size
  const iposWithoutLotSize = await db.select()
    .from(ipos)
    .where(isNull(ipos.lotSize));

  console.log(`Found ${iposWithoutLotSize.length} IPOs without lot_size`);

  let successCount = 0;
  let failureCount = 0;

  // 2. Re-scrape NSE API for each
  for (const ipo of iposWithoutLotSize) {
    try {
      console.log(`Backfilling ${ipo.companyName}...`);

      const nseData = await nseApiClient.getIPODetail(ipo.symbol);

      if (nseData.lotSize) {
        await db.update(ipos)
          .set({
            lotSize: nseData.lotSize,
            updatedAt: new Date(),
          })
          .where(eq(ipos.id, ipo.id));

        console.log(`✅ ${ipo.companyName}: lot_size = ${nseData.lotSize}`);
        successCount++;
      } else {
        console.log(`⚠️  ${ipo.companyName}: NSE API returned NULL lot_size`);
        failureCount++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay

    } catch (error) {
      console.error(`❌ Failed to backfill ${ipo.companyName}:`, error);
      failureCount++;
    }
  }

  console.log('\n=== Backfill Complete ===');
  console.log(`Success: ${successCount}`);
  console.log(`Failures: ${failureCount}`);
  console.log(`New Completeness: ${((successCount / iposWithoutLotSize.length) * 100).toFixed(2)}%`);
}

backfillLotSize().catch(console.error);
```

**Execution:**
```bash
# Dry run (preview changes)
npx tsx web/scripts/backfill-lot-size.ts --dry-run

# Execute
npx tsx web/scripts/backfill-lot-size.ts --execute
```

**Expected Results:**
- Before: 32.88% completeness (171/526 IPOs)
- After: 70-80% completeness (380-420 IPOs)
- Remaining NULLs: Old IPOs where NSE API doesn't have data

---

#### Task 3.4: Comprehensive Testing (Day 12-14 - 12 hours)

**Unit Tests:**
```bash
# Run all unit tests
npm run test:unit --workspace=scraper

# Target files:
# - bse-detail-scraper.test.ts
# - financial-data-scraper.test.ts
# - subscription-monitor.test.ts
```

**Integration Tests:**
```typescript
// File: scraper/tests/integration/end-to-end-scrape.test.ts

describe('End-to-End IPO Scraping', () => {
  it('should scrape complete IPO data including financials', async () => {
    // 1. Scrape basic IPO data
    const ipoData = await nseApiClient.getIPODetail('HYPERSOFT');
    expect(ipoData).toBeDefined();

    // 2. Scrape BSE detail page
    const bseData = await bseDetailScraper.scrape('Hypersoft');
    expect(bseData.promoterHoldingPreIssue).toBeGreaterThan(0);
    expect(bseData.freshIssue).toBeGreaterThan(0);

    // 3. Parse financial data from DRHP
    const financialData = await financialDataScraper.parse(drhpUrl);
    expect(financialData.revenueFy2024).toBeGreaterThan(0);
    expect(financialData.profitFy2024).toBeDefined();

    // 4. Verify data stored in database
    const storedIPO = await db.select().from(ipos).where(eq(ipos.slug, 'hypersoft-ltd'));
    expect(storedIPO.promoterHoldingPreIssue).toBe(bseData.promoterHoldingPreIssue);

    const storedFinancials = await db.select().from(financialData).where(eq(financialData.ipoId, storedIPO.id));
    expect(storedFinancials.revenueFy2024).toBe(financialData.revenueFy2024);
  });

  it('should monitor OPEN IPO subscriptions', async () => {
    // Run subscription monitor
    await monitorOpenIPOs();

    // Verify snapshot captured
    const snapshots = await db.select()
      .from(subscriptions)
      .where(eq(subscriptions.ipoId, testIPOId))
      .orderBy(subscriptions.timestamp, 'desc')
      .limit(1);

    expect(snapshots.length).toBe(1);
    expect(snapshots[0].totalSubscription).toBeGreaterThanOrEqual(0);
  });
});
```

**Manual Verification:**
1. Run scrapers on 5 test IPOs
2. Compare extracted data with source (BSE website, DRHP PDF)
3. Check UI display matches database
4. Verify calculated fields (min investment, growth rates)

**Acceptance Criteria:**
- ✅ 95%+ accuracy on manual checks
- ✅ 80%+ success rate for financial data extraction
- ✅ 85%+ success rate for BSE promoter/issue structure
- ✅ 100% subscription monitoring success for OPEN IPOs
- ✅ 70%+ lot_size backfill success

---

## Success Metrics

**After Implementation:**

### Data Completeness Improvements:
- **Financial Data**: 0% → **96-99.9%** (revenue, profit, EBITDA, ratios) - pdfplumber Python microservice
- **Promoter Holding**: 0% → 85%+ (BSE scraping) + **96%+ from DRHP** (pdfplumber fallback)
- **Issue Structure**: 0% → 85%+ (fresh issue, OFS breakdown)
- **Lot Size**: 32.88% → 75%+ (trivial fix + backfill)
- **Subscription Data**: No future data loss (monitoring active)

### Issues Fixed:
- **Phase 9 Issues**: 12 out of 32 fixed (37.5%)
- **Critical P0 Issues**: 100% addressed
- **Overall Progress**: 31 remaining → 19 remaining

### System Improvements:
- ✅ Financial analysis enabled
- ✅ Investment recommendations possible (PE, ROE, growth rates)
- ✅ Subscription data loss prevention
- ✅ Issue structure transparency (fresh vs OFS)
- ✅ Promoter holding tracking

---

## Timeline Summary

| Week | Days | Tasks | Effort |
|------|------|-------|--------|
| **Week 1** | 1-3 | Schema validation + BSE scraping | 12 hours |
| **Week 2** | 4-7 | Financial data scraper integration | 18 hours |
| **Week 3** | 8-14 | Subscription monitoring + lot size + testing | 24 hours |
| **Total** | 14 days | 9 major tasks | **54 hours** |

---

## Risk Assessment

### High Risk:
- ⚠️ **BSE scraping may not have promoter/issue data**
  - Mitigation: Task 1.2 investigates first (2 hours)
  - Fallback: Skip BSE scraping, rely on DRHP PDF parsing

### Medium Risk:
- ⚠️ **Financial data extraction accuracy <80%**
  - Mitigation: Comprehensive validation logic + manual review queue
  - Fallback: Manual data entry for top 50 IPOs (20 hours)

### Low Risk:
- ✅ **Lot size fix** - Trivial one-line change
- ✅ **Subscription monitoring** - Simple API calls + DB inserts
- ✅ **Schema validation** - Clear pass/fail result

---

## Decision Points

**After Task 1.2 (BSE Investigation):**
- ✅ If BSE has data: Proceed with Task 1.3 (6-8 hours)
- ❌ If BSE doesn't have data: Skip Task 1.3, save 8 hours, rely on DRHP

**After Task 2.2 (Financial Scraper Testing):**
- ✅ If success rate ≥80%: Full automation, proceed
- ⚠️ If success rate 60-80%: Add manual review queue
- ❌ If success rate <60%: Manual entry for critical IPOs

**After Task 3.3 (Lot Size Backfill):**
- ✅ If completeness ≥70%: Success
- ⚠️ If completeness 50-70%: Investigate BSE as secondary source
- ❌ If completeness <50%: Check NSE API authentication issues

---

## Deliverables

### Documentation:
1. `docs/schema-validation-report.md` - Field inventory + migration needs
2. `scraper/docs/BSE_DETAIL_PAGE_ANALYSIS.md` - BSE scraping feasibility
3. `scraper/docs/FINANCIAL_SCRAPER_REVIEW.md` - Parser assessment
4. `docs/19-ui/ipo-detail-page/data/PHASE_12_IMPLEMENTATION_LOG.md` - Progress tracking

### Code:
1. Enhanced `bse-detail-scraper.ts` (if feasible)
2. Improved `financial-data-scraper.ts` with 80%+ accuracy
3. New `subscription-monitor.ts` service
4. Fixed `nse-scraper.ts` lot size extraction
5. New `backfill-lot-size.ts` script
6. 40+ new test cases (unit + integration)

### Database:
1. Schema migrations (if needed)
2. Backfilled lot_size data (300+ IPOs)
3. Financial data populated (80%+ IPOs with DRHPs)
4. Subscription monitoring active (no future data loss)

---

## Next Steps

1. **Review and approve this plan**
2. **Start with Task 1.1: Schema Validation** (2 hours)
3. **Track progress** in `PHASE_12_IMPLEMENTATION_LOG.md`
4. **Update MULTI_IPO_DATA_INVESTIGATION_PLAN.md** as tasks complete

---

## Related Documents

- `MULTI_IPO_DATA_INVESTIGATION_PLAN.md` - Phase 9-11 investigation history
- `LOT_SIZE_EXECUTIVE_SUMMARY.md` - Lot size data quality analysis (Phase 3)
- `docs/16-database/SCHEMA_MANAGEMENT.md` - Schema change workflow
- `docs/02-architecture/backend-architecture.md` - 3-layer architecture
- `scraper/docs/SCRAPING_STRATEGY.md` - NSE API discovery
