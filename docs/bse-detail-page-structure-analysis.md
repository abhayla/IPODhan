# BSE IPO Detail Page Structure Analysis

**Date:** October 17, 2025
**Analyzed Pages:**
- Main listing: https://www.bseindia.com/publicissue.html
- Detail page: https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id=4243&type=IPO&idtype=1&status=L&IPONo=7390&startdt=15/Oct/2025

---

## 1. URL Pattern Discovery

### Main Listing Page
- **URL:** `https://www.bseindia.com/publicissue.html`
- **Content:** Shows all live and forthcoming IPOs with basic information

### Detail Page URL Pattern
```
https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id={id}&type={type}&idtype={idtype}&status={status}&IPONo={ipoNo}&startdt={startDate}
```

**Parameters:**
- `id`: Internal BSE ID (e.g., 4243)
- `type`: Issue type - "IPO" for initial public offerings
- `idtype`: Always "1" (appears to be constant)
- `status`: "L" for Live, "F" for Forthcoming
- `IPONo`: IPO number (e.g., 7390)
- `startdt`: Start date in format "DD/MMM/YYYY" (e.g., "15/Oct/2025")

**Example:**
```
https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id=4243&type=IPO&idtype=1&status=L&IPONo=7390&startdt=15/Oct/2025
```

**Note:** All parameters can be extracted from the main listing page's link elements.

---

## 2. Data Extraction Method: Cheerio vs Puppeteer

### ✅ Cheerio is Sufficient

**Test Results:**
- ✅ All data is present in the initial HTML response
- ✅ No JavaScript rendering required for core IPO details
- ✅ Page uses ASP.NET postback but data loads on initial GET request
- ✅ Verified using `curl` - all fields are in raw HTML

**Evidence:**
```bash
# Data is present in page source
curl -s "https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id=4243..." | grep "Issue Size"
# Returns: <td>Issue Size – No. of Shares</td><td>31,17,460</td>
```

**Recommendation:** Use Cheerio for scraping BSE detail pages. Puppeteer not needed.

---

## 3. HTML Structure Analysis

### Page Layout
The detail page uses an ASP.NET structure with a simple table-based layout:

```html
<table>
  <tr>
    <td class="TTRow_left" style="font-weight:bold;width:200px;">Field Label</td>
    <td class="TTRow_left" style="width:400px;">Field Value</td>
  </tr>
</table>
```

### CSS Selectors

**Field Labels:**
```css
td.TTRow_left[style*="font-weight:bold"]
```

**Field Values:**
```css
td.TTRow_left[style*="width:400px"]
```

**Pattern:** Each field is a table row with two cells:
1. First cell: Bold label (width: 200px)
2. Second cell: Value (width: 400px)

---

## 4. Available Fields on Detail Page

### Core IPO Details

| Field Label | Example Value | CSS Selector | Database Column | Table |
|------------|---------------|--------------|-----------------|-------|
| **Security Type** | Equity | `td:contains("Security Type") + td` | - | - |
| **Symbol** | MIDWESTLTD | `td:contains("Symbol") + td` | `symbol` | `ipos` |
| **Issue Period** | 15 Oct 2025 to 17 Oct 2025 | `td:contains("Issue Period") + td` | `open_date`, `close_date` | `ipos` |
| **IPO Market Timings** | 10.00 am to 5.00 pm | `td:contains("IPO Market Timings") + td` | - | - |
| **Cut-off time for UPI Mandate Confirmation** | 17-Oct-2025 (Upto 5.00 pm) | `td:contains("Cut-off time") + td` | - | - |
| **Issue Size – No. of Shares** | 31,17,460 | `td:contains("Issue Size") + td` | `issue_size` (calculate) | `ipo_details` |
| **Price Band** | 1014.00-1065.00 | `td:contains("Price Band") + td` | `price_min`, `price_max` | `ipos` |
| **Face Value** | 5.00 | `td:contains("Face Value") + td` | `face_value` | `ipo_details` |
| **Market Lot** | 14 | `td:contains("Market Lot") + td` | `lot_size` | `ipos` |
| **Minimum Bid Quantity** | 14 | `td:contains("Minimum Bid Quantity") + td` | `lot_size` | `ipos` |
| **Maximum Bid Quantity for QII** | 3106502 | `td:contains("Maximum Bid Quantity for Qualified") + td` | - | - |
| **Maximum Bid Quantity for NII** | 2218930 | `td:contains("Maximum Bid Quantity for Non-Institutional") + td` | - | - |
| **Book Running Lead Manager** | 1) DAM Capital...<br>2) Intensive Fiscal...<br>3) Motilal Oswal... | `td:contains("Book Running Lead Manager") + td` | `lead_managers` | `ipo_details` |
| **Registrar** | KFin Technologies Limited | `td:contains("Registrar") + td` | `registrar` | `ipos` |
| **Sponsor Bank** | 1) KOTAK BANK<br>2) HDFC BANK | `td:contains("Sponsor Bank") + td` | - | - |
| **IPO Categories** | FI, IC, MF, FII, OTH, CO, IND, NOH, EMP | `td:contains("IPO Categories") + td` | - | - |
| **UPI Categories** | IND, EMP | `td:contains("UPI Categories") + td` | - | - |
| **Cut off Amount (Rs.)** | IND - 200000, EMP - 500000 | `td:contains("Cut off Amount") + td` | - | - |
| **Tick Size** | 1.00 | `td:contains("Tick Size") + td` | - | - |

### Document Links

| Field Label | Value | Notes |
|------------|-------|-------|
| **Price-Band Advertisement** | Click Here (Link) | PDF document URL available |
| **Prospectus & GID** | Click Here (Link) | Contains prospectus PDF URL |
| **Blank ASBA Form** | Click Here (Link) | ASBA form URL |
| **Online ASBA Form** | Click Here (Link) | Online form URL |
| **Revised Online ASBA Form** | Click Here (Link) | Revised form URL |
| **Exchange Notices** | Multiple links | Contains notice URLs |

---

## 5. Fields NOT Available on BSE Detail Page

### Missing Critical Fields

**Important:** BSE detail page does NOT contain the following fields that are required for our database:

| Missing Field | Required For | Alternative Source |
|--------------|-------------|-------------------|
| **ISIN** | `isin` in `ipos` table | NSE, Moneycontrol, or BSE Equity API |
| **Company Description** | `about` in `ipo_details` | Prospectus PDF or Moneycontrol |
| **Fresh Issue Amount** | `issue_size` calculation | Calculate from shares × price OR get from NSE |
| **OFS Amount** | `offer_for_sale` in `ipo_details` | NSE or Moneycontrol |
| **Total Issue Size (₹)** | `issue_size` in `ipo_details` | Calculate: shares × price band upper |
| **Basis of Allotment Date** | `allotment_date` in `ipos` | Usually announced later, track via notices |
| **Listing Date** | `listing_date` in `ipos` | Usually announced later |
| **Financial Metrics** | `ipo_financials` table | Must get from prospectus or Moneycontrol |
| - Revenue | `revenue` | Prospectus/Moneycontrol |
| - Profit/Loss | `net_profit` | Prospectus/Moneycontrol |
| - EPS | `eps` | Prospectus/Moneycontrol |
| - P/E Ratio | `pe_ratio` | Calculate or get from Moneycontrol |
| - ROE, ROCE | `roe`, `roce` | Prospectus/Moneycontrol |
| - Debt-to-Equity | `debt_to_equity` | Prospectus/Moneycontrol |

### Partial Information

**Issue Size:**
- BSE provides: Number of shares (31,17,460)
- BSE provides: Price band (1014.00-1065.00)
- **Calculation needed:** Total issue size = shares × upper price band
- **Missing breakdown:** Fresh issue vs OFS breakdown

**Registrar:**
- BSE provides: Registrar name (KFin Technologies Limited)
- **Missing:** Registrar contact details, website, email
- **Solution:** Maintain separate registrars table with full details

---

## 6. Data Extraction Code Snippets

### Cheerio Extraction Example

```typescript
import * as cheerio from 'cheerio';
import axios from 'axios';

async function scrapeIPODetailFromBSE(detailUrl: string) {
  const response = await axios.get(detailUrl);
  const $ = cheerio.load(response.data);

  // Extract all fields from the table
  const fields: Record<string, string> = {};

  $('table tr').each((_, row) => {
    const cells = $(row).find('td.TTRow_left');
    if (cells.length === 2) {
      const label = $(cells[0]).text().trim();
      const value = $(cells[1]).text().trim();

      // Skip "Click Here" links for now
      if (value && value !== 'Click Here') {
        fields[label] = value;
      }
    }
  });

  return {
    symbol: fields['Symbol'],
    issuePeriod: fields['Issue Period'],
    issueShares: fields['Issue Size – No. of Shares'],
    priceBand: fields['Price Band'],
    faceValue: fields['Face Value'],
    lotSize: fields['Market Lot'] || fields['Minimum Bid Quantity'],
    registrar: fields['Registrar'],
    leadManagers: fields['Book Running Lead Manager'],
  };
}
```

### Field Mapping Function

```typescript
function mapBSEFieldsToDatabase(bseData: Record<string, string>) {
  // Parse price band
  const priceBand = bseData['Price Band'];
  const [priceMin, priceMax] = priceBand.split('-').map(p => parseFloat(p.trim()));

  // Parse issue period
  const issuePeriod = bseData['Issue Period'];
  const [startDate, endDate] = issuePeriod.split(' to ').map(d => new Date(d.trim()));

  // Parse issue shares (remove commas)
  const issueShares = parseInt(bseData['Issue Size – No. of Shares'].replace(/,/g, ''));

  // Calculate total issue size (in crores)
  const totalIssueSizeRs = (issueShares * priceMax) / 10000000; // Convert to crores

  return {
    // For `ipos` table
    symbol: bseData['Symbol'],
    open_date: startDate,
    close_date: endDate,
    price_min: priceMin,
    price_max: priceMax,
    lot_size: parseInt(bseData['Market Lot']),
    registrar: bseData['Registrar'],

    // For `ipo_details` table
    issue_size: totalIssueSizeRs,
    face_value: parseFloat(bseData['Face Value']),
    lead_managers: bseData['Book Running Lead Manager'],

    // Missing fields - need other sources
    isin: null, // Get from NSE or Moneycontrol
    about: null, // Get from prospectus or Moneycontrol
    offer_for_sale: null, // Get from NSE or Moneycontrol
  };
}
```

### URL Construction from Listing Page

```typescript
function extractDetailURLsFromListingPage($: cheerio.CheerioAPI) {
  const urls: string[] = [];

  // Find all IPO links in the listing table
  $('table tr').each((_, row) => {
    const link = $(row).find('a[href*="DisplayIPO.aspx"]');
    if (link.length > 0) {
      const href = link.attr('href');
      if (href) {
        // Construct full URL
        const fullUrl = `https://www.bseindia.com/${href}`;
        urls.push(fullUrl);
      }
    }
  });

  return urls;
}
```

---

## 7. Scraping Strategy & Workflow

### Recommended Approach

**Step 1: Scrape Main Listing Page**
- URL: `https://www.bseindia.com/publicissue.html`
- Extract all IPO links with detail page URLs
- Filter by status: Live or Forthcoming
- Store IPO IDs and parameters

**Step 2: Scrape Each Detail Page**
- Use Cheerio (no Puppeteer needed)
- Extract all available fields
- Map to database schema
- Calculate derived fields (issue size)

**Step 3: Handle Missing Fields**
- Flag IPOs with missing ISIN, about, financials
- Queue for secondary scraping from NSE or Moneycontrol
- Store partial data immediately

**Step 4: Update Mechanism**
- Check for new IPOs daily
- Update existing IPOs if details change
- Track "last scraped" timestamp

### Rate Limiting
- BSE does not have explicit rate limits
- Recommended: 1-2 seconds delay between requests
- Use User-Agent header to identify scraper
- Consider caching responses locally

---

## 8. Challenges & Limitations

### 1. **ISIN Not Available**
- **Impact:** HIGH - ISIN is a critical identifier
- **Solution:** Cross-reference with NSE or use BSE Symbol to lookup ISIN
- **Alternative:** BSE provides ISIN via their equity API after listing

### 2. **Financial Metrics Not Available**
- **Impact:** MEDIUM - Required for analysis
- **Solution:** Parse prospectus PDFs or scrape from Moneycontrol
- **Complexity:** Prospectus parsing is complex; Moneycontrol easier

### 3. **Company Description Not Available**
- **Impact:** MEDIUM - Needed for user-facing pages
- **Solution:** Extract from prospectus "Company Overview" section or Moneycontrol
- **Alternative:** Use NSE description

### 4. **Issue Size Breakdown (Fresh vs OFS)**
- **Impact:** MEDIUM - Important for investors
- **Solution:** Get from NSE IPO page or prospectus
- **Workaround:** Calculate total only from BSE data

### 5. **Listing Date Uncertainty**
- **Impact:** LOW - Updated closer to listing
- **Solution:** Monitor "Exchange Notices" section for announcements
- **Timing:** Usually announced 1-2 days before listing

### 6. **Registrar Contact Details**
- **Impact:** LOW - Full registrar info not available
- **Solution:** Maintain separate registrars reference table
- **Source:** One-time scrape from registrar directory

---

## 9. Data Quality Comparison

### BSE vs NSE vs Moneycontrol

| Field | BSE | NSE | Moneycontrol | Best Source |
|-------|-----|-----|--------------|-------------|
| Symbol | ✅ Yes | ✅ Yes | ✅ Yes | All equal |
| ISIN | ❌ No | ✅ Yes | ✅ Yes | **NSE** |
| Price Band | ✅ Yes | ✅ Yes | ✅ Yes | All equal |
| Lot Size | ✅ Yes | ✅ Yes | ✅ Yes | All equal |
| Issue Size (₹) | ⚠️ Calculated | ✅ Yes | ✅ Yes | **NSE** |
| Fresh Issue | ❌ No | ✅ Yes | ✅ Yes | **NSE** |
| OFS | ❌ No | ✅ Yes | ✅ Yes | **NSE** |
| Face Value | ✅ Yes | ✅ Yes | ✅ Yes | All equal |
| Registrar | ✅ Yes | ✅ Yes | ✅ Yes | All equal |
| Lead Managers | ✅ Yes | ✅ Yes | ⚠️ Partial | **BSE/NSE** |
| Company Description | ❌ No | ⚠️ Brief | ✅ Detailed | **Moneycontrol** |
| Financials | ❌ No | ❌ No | ✅ Yes | **Moneycontrol** |
| Listing Date | ⚠️ Later | ⚠️ Later | ⚠️ Later | All equal (updated later) |

**Conclusion:** BSE is good for basic details but lacks ISIN, financials, and detailed company info.

---

## 10. Sample Extraction Code

### Complete Scraper Implementation

```typescript
import axios from 'axios';
import * as cheerio from 'cheerio';

interface BSEIPODetail {
  symbol: string;
  issueStartDate: Date;
  issueEndDate: Date;
  priceMin: number;
  priceMax: number;
  issueShares: number;
  faceValue: number;
  lotSize: number;
  registrar: string;
  leadManagers: string;
  totalIssueSizeCr: number;
}

async function scrapeBSEIPODetail(url: string): Promise<BSEIPODetail | null> {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'IPODhan/1.0 (ipodhan.com)',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);

    // Helper function to get field value
    const getFieldValue = (label: string): string | null => {
      let value: string | null = null;

      $('table tr').each((_, row) => {
        const cells = $(row).find('td.TTRow_left');
        if (cells.length === 2) {
          const cellLabel = $(cells[0]).text().trim();
          if (cellLabel === label) {
            value = $(cells[1]).text().trim();
            return false; // Break the loop
          }
        }
      });

      return value;
    };

    // Extract all fields
    const symbol = getFieldValue('Symbol');
    const issuePeriod = getFieldValue('Issue Period');
    const priceBand = getFieldValue('Price Band');
    const issueShares = getFieldValue('Issue Size – No. of Shares');
    const faceValue = getFieldValue('Face Value');
    const lotSize = getFieldValue('Market Lot') || getFieldValue('Minimum Bid Quantity');
    const registrar = getFieldValue('Registrar');
    const leadManagers = getFieldValue('Book Running Lead Manager');

    // Validate required fields
    if (!symbol || !issuePeriod || !priceBand) {
      console.error('Missing required fields');
      return null;
    }

    // Parse issue period
    const [startDateStr, endDateStr] = issuePeriod.split(' to ').map(d => d.trim());
    const issueStartDate = new Date(startDateStr);
    const issueEndDate = new Date(endDateStr);

    // Parse price band
    const [priceMinStr, priceMaxStr] = priceBand.split('-').map(p => p.trim());
    const priceMin = parseFloat(priceMinStr);
    const priceMax = parseFloat(priceMaxStr);

    // Parse issue shares (remove commas)
    const issueSharesNum = parseInt(issueShares?.replace(/,/g, '') || '0');

    // Calculate total issue size in crores
    const totalIssueSizeCr = (issueSharesNum * priceMax) / 10000000;

    return {
      symbol,
      issueStartDate,
      issueEndDate,
      priceMin,
      priceMax,
      issueShares: issueSharesNum,
      faceValue: parseFloat(faceValue || '0'),
      lotSize: parseInt(lotSize || '0'),
      registrar: registrar || '',
      leadManagers: leadManagers || '',
      totalIssueSizeCr,
    };

  } catch (error) {
    console.error('Error scraping BSE IPO detail:', error);
    return null;
  }
}

// Example usage
const exampleUrl = 'https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id=4243&type=IPO&idtype=1&status=L&IPONo=7390&startdt=15/Oct/2025';
scrapeBSEIPODetail(exampleUrl).then(data => {
  console.log('BSE IPO Detail:', data);
});
```

---

## 11. Integration with Existing Scraper

### Modifications to Current BSE Scraper

**File:** `scraper/src/scrapers/bse-scraper.ts`

**Current Status:** Only scrapes main listing page

**Required Changes:**

1. **Add detail page scraping**
   ```typescript
   // After scraping listing page
   for (const ipo of ipos) {
     if (ipo.detailUrl) {
       const details = await scrapeBSEIPODetail(ipo.detailUrl);
       if (details) {
         // Merge details into IPO object
         Object.assign(ipo, details);
       }
     }

     // Rate limiting
     await new Promise(resolve => setTimeout(resolve, 2000));
   }
   ```

2. **Store detail URL during listing scrape**
   ```typescript
   const detailUrl = $(row).find('a[href*="DisplayIPO.aspx"]').attr('href');
   if (detailUrl) {
     ipo.detailUrl = `https://www.bseindia.com/${detailUrl}`;
   }
   ```

3. **Update database schema if needed**
   - Ensure `ipo_details` table has all fields
   - Add `last_scraped_at` timestamp
   - Add `scrape_source` field to track data origin

---

## 12. Testing Checklist

### Manual Testing

- [x] Verify data is in HTML source (not JS-loaded)
- [x] Identify CSS selectors for all fields
- [x] Test URL pattern with multiple IPOs
- [ ] Test with different IPO statuses (Live, Forthcoming, Closed)
- [ ] Test with mainboard vs SME IPOs
- [ ] Verify field parsing edge cases (multiple lead managers, etc.)

### Automated Testing

- [ ] Unit test for field extraction
- [ ] Unit test for data mapping
- [ ] Integration test for full scraper
- [ ] Test rate limiting
- [ ] Test error handling
- [ ] Test with mock HTML responses

---

## 13. Production Deployment Considerations

### Monitoring

- Log scraping success/failure rates
- Alert on parsing errors
- Track fields that are frequently missing
- Monitor scraping duration

### Error Handling

- Retry failed requests (max 3 attempts)
- Handle HTTP errors gracefully
- Continue scraping on single failure
- Log problematic URLs for manual review

### Data Validation

- Validate price band (min < max)
- Validate dates (start < end)
- Validate numerical fields are positive
- Check for required fields before saving

---

## 14. Conclusion

### Summary

✅ **Cheerio is sufficient** - No Puppeteer needed
✅ **Data structure is simple** - Table-based layout
✅ **URL pattern identified** - Can construct from listing page
⚠️ **Missing critical fields** - ISIN, financials, company description
⚠️ **Need secondary sources** - NSE/Moneycontrol for complete data

### Next Steps

1. ✅ Document BSE detail page structure (DONE)
2. Implement detail page scraper using Cheerio
3. Test scraper with multiple IPOs
4. Integrate with existing BSE scraper
5. Add unit and integration tests
6. Plan Moneycontrol scraper for missing fields
7. Implement prospectus PDF parsing (future)

### Priority Fields from BSE

**High Priority (Available):**
- Symbol, Price Band, Lot Size, Face Value
- Issue Period (Open/Close dates)
- Registrar, Lead Managers
- Issue Size (calculated)

**Medium Priority (Missing - Get from other sources):**
- ISIN, Company Description
- Fresh Issue vs OFS breakdown
- Financial metrics

**Low Priority (Updated later):**
- Listing Date, Basis of Allotment Date

---

**Report End**
