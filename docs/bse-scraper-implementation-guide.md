# BSE Detail Page Scraper - Implementation Guide

## Quick Reference

**Status:** ✅ Ready to implement
**Technology:** Cheerio (no Puppeteer needed)
**Complexity:** Low to Medium
**Data Completeness:** 60% (missing ISIN, financials, company description)

---

## URL Pattern

### Main Listing Page
```
https://www.bseindia.com/publicissue.html
```

### Detail Page
```
https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id={id}&type=IPO&idtype=1&status={status}&IPONo={ipoNo}&startdt={startDate}
```

**Example:**
```
https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id=4243&type=IPO&idtype=1&status=L&IPONo=7390&startdt=15/Oct/2025
```

**Parameters extracted from listing page links:**
- `id`: BSE internal ID
- `type`: Always "IPO" for public issues
- `idtype`: Always "1"
- `status`: "L" (Live) or "F" (Forthcoming)
- `IPONo`: IPO number
- `startdt`: Start date (DD/MMM/YYYY format)

---

## Data Available on BSE Detail Page

### ✅ Available Fields

| Field | Example | Maps to DB Column |
|-------|---------|-------------------|
| Symbol | MIDWESTLTD | `ipos.symbol` |
| Issue Period | 15 Oct 2025 to 17 Oct 2025 | `ipos.open_date`, `ipos.close_date` |
| Issue Size (shares) | 31,17,460 | Used to calculate `ipo_details.issue_size` |
| Price Band | 1014.00-1065.00 | `ipos.price_min`, `ipos.price_max` |
| Face Value | 5.00 | `ipo_details.face_value` |
| Market Lot | 14 | `ipos.lot_size` |
| Registrar | KFin Technologies Limited | `ipos.registrar` |
| Book Running Lead Manager | DAM Capital, Intensive Fiscal, Motilal Oswal | `ipo_details.lead_managers` |
| Sponsor Bank | KOTAK BANK, HDFC BANK | (optional field) |

### ❌ Missing Fields (Need Other Sources)

| Field | Database Column | Alternative Source |
|-------|----------------|-------------------|
| ISIN | `ipos.isin` | NSE or Moneycontrol |
| Company Description | `ipo_details.about` | Prospectus or Moneycontrol |
| Fresh Issue Amount | `ipo_details.issue_size` breakdown | NSE or Prospectus |
| Offer for Sale | `ipo_details.offer_for_sale` | NSE or Prospectus |
| Listing Date | `ipos.listing_date` | Updated later |
| Allotment Date | `ipos.allotment_date` | Updated later |
| **All Financial Metrics** | `ipo_financials` table | Moneycontrol or Prospectus |

---

## HTML Structure

### Table-Based Layout

All data is in a simple HTML table:

```html
<table>
  <tr>
    <td class="TTRow_left" style="font-weight:bold;width:200px;">Symbol</td>
    <td class="TTRow_left" style="width:400px;">MIDWESTLTD</td>
  </tr>
  <tr>
    <td class="TTRow_left" style="font-weight:bold;width:200px;">Price Band</td>
    <td class="TTRow_left" style="width:400px;">1014.00-1065.00</td>
  </tr>
  <!-- More rows... -->
</table>
```

### CSS Selectors

**Field labels:**
```css
td.TTRow_left[style*="font-weight:bold"]
```

**Field values (next sibling):**
```css
td.TTRow_left[style*="font-weight:bold"] + td
```

---

## Sample Code

### 1. Extract Field Values

```typescript
function extractFieldValue($: cheerio.CheerioAPI, label: string): string | null {
  let value: string | null = null;

  $('table tr').each((_, row) => {
    const cells = $(row).find('td.TTRow_left');
    if (cells.length === 2) {
      const cellLabel = $(cells[0]).text().trim();
      if (cellLabel === label) {
        value = $(cells[1]).text().trim();
        return false; // Break
      }
    }
  });

  return value;
}
```

### 2. Parse Issue Period

```typescript
function parseIssuePeriod(issuePeriod: string): { start: Date; end: Date } {
  const [startStr, endStr] = issuePeriod.split(' to ').map(d => d.trim());
  return {
    start: new Date(startStr),
    end: new Date(endStr),
  };
}
```

### 3. Parse Price Band

```typescript
function parsePriceBand(priceBand: string): { min: number; max: number } {
  const [minStr, maxStr] = priceBand.split('-').map(p => p.trim());
  return {
    min: parseFloat(minStr),
    max: parseFloat(maxStr),
  };
}
```

### 4. Calculate Issue Size

```typescript
function calculateIssueSize(shares: string, priceMax: number): number {
  const sharesNum = parseInt(shares.replace(/,/g, ''));
  // Return in crores
  return (sharesNum * priceMax) / 10000000;
}
```

### 5. Complete Scraper Function

```typescript
async function scrapeBSEIPODetail(url: string) {
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'IPODhan/1.0' },
    timeout: 10000,
  });

  const $ = cheerio.load(response.data);

  // Extract fields
  const symbol = extractFieldValue($, 'Symbol');
  const issuePeriod = extractFieldValue($, 'Issue Period');
  const priceBand = extractFieldValue($, 'Price Band');
  const issueShares = extractFieldValue($, 'Issue Size – No. of Shares');
  const faceValue = extractFieldValue($, 'Face Value');
  const lotSize = extractFieldValue($, 'Market Lot');
  const registrar = extractFieldValue($, 'Registrar');
  const leadManagers = extractFieldValue($, 'Book Running Lead Manager');

  // Parse dates
  const { start: openDate, end: closeDate } = parseIssuePeriod(issuePeriod!);

  // Parse price band
  const { min: priceMin, max: priceMax } = parsePriceBand(priceBand!);

  // Calculate issue size
  const issueSizeCr = calculateIssueSize(issueShares!, priceMax);

  return {
    symbol,
    openDate,
    closeDate,
    priceMin,
    priceMax,
    lotSize: parseInt(lotSize!),
    faceValue: parseFloat(faceValue!),
    registrar,
    leadManagers,
    issueSizeCr,
  };
}
```

---

## Integration Steps

### Step 1: Update BSE Listing Scraper

**File:** `scraper/src/scrapers/bse-scraper.ts`

```typescript
// Extract detail URLs during listing scrape
const detailUrl = $(row).find('a[href*="DisplayIPO.aspx"]').attr('href');
if (detailUrl) {
  ipo.detailUrl = `https://www.bseindia.com/${detailUrl}`;
}
```

### Step 2: Create Detail Scraper

**File:** `scraper/src/scrapers/bse-detail-scraper.ts`

```typescript
export async function scrapeBSEIPODetails(urls: string[]) {
  const results = [];

  for (const url of urls) {
    try {
      const details = await scrapeBSEIPODetail(url);
      results.push(details);

      // Rate limiting
      await sleep(2000);
    } catch (error) {
      console.error(`Error scraping ${url}:`, error);
    }
  }

  return results;
}
```

### Step 3: Update Database Inserts

```typescript
// Insert into `ipos` table
await db.insert(ipos).values({
  symbol: data.symbol,
  open_date: data.openDate,
  close_date: data.closeDate,
  price_min: data.priceMin,
  price_max: data.priceMax,
  lot_size: data.lotSize,
  registrar: data.registrar,
  // ... other fields
});

// Insert into `ipo_details` table
await db.insert(ipoDetails).values({
  ipo_id: ipoId,
  issue_size: data.issueSizeCr,
  face_value: data.faceValue,
  lead_managers: data.leadManagers,
  // ... other fields
});
```

---

## Rate Limiting

**Recommendation:**
- **2 seconds** between detail page requests
- **5 seconds** after every 10 requests
- Add exponential backoff on errors

```typescript
async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## Error Handling

### Common Errors

1. **Network timeout:** Retry up to 3 times
2. **HTML structure change:** Log error and skip
3. **Missing required fields:** Log warning, store partial data
4. **Invalid date format:** Try multiple parsers

### Example Error Handler

```typescript
async function scrapeBSEIPODetailSafe(url: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await scrapeBSEIPODetail(url);
    } catch (error) {
      console.error(`Attempt ${i + 1} failed for ${url}:`, error);
      if (i === retries - 1) throw error;
      await sleep(5000 * (i + 1)); // Exponential backoff
    }
  }
}
```

---

## Testing

### Unit Tests

**File:** `scraper/src/scrapers/__tests__/bse-detail-scraper.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { scrapeBSEIPODetail } from '../bse-detail-scraper';

describe('BSE Detail Scraper', () => {
  it('should extract all fields correctly', async () => {
    const url = 'https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id=4243&type=IPO&idtype=1&status=L&IPONo=7390&startdt=15/Oct/2025';
    const data = await scrapeBSEIPODetail(url);

    expect(data.symbol).toBe('MIDWESTLTD');
    expect(data.priceMin).toBe(1014);
    expect(data.priceMax).toBe(1065);
    expect(data.lotSize).toBe(14);
  });

  it('should handle missing optional fields', async () => {
    // Test with IPO that has missing fields
  });

  it('should throw on invalid URL', async () => {
    await expect(scrapeBSEIPODetail('invalid')).rejects.toThrow();
  });
});
```

---

## Data Validation

### Required Fields

Before inserting into database:

```typescript
function validateBSEData(data: any): boolean {
  const required = [
    'symbol',
    'openDate',
    'closeDate',
    'priceMin',
    'priceMax',
    'lotSize',
  ];

  for (const field of required) {
    if (!data[field]) {
      console.error(`Missing required field: ${field}`);
      return false;
    }
  }

  // Validate ranges
  if (data.priceMin >= data.priceMax) {
    console.error('Invalid price band: min >= max');
    return false;
  }

  if (data.openDate >= data.closeDate) {
    console.error('Invalid dates: open >= close');
    return false;
  }

  return true;
}
```

---

## Next Steps

1. **Implement detail scraper** (1-2 days)
   - Create `bse-detail-scraper.ts`
   - Add parsing functions
   - Add error handling

2. **Write unit tests** (1 day)
   - Test field extraction
   - Test edge cases
   - Mock HTTP responses

3. **Integrate with existing scraper** (1 day)
   - Update listing scraper to extract URLs
   - Call detail scraper for each IPO
   - Update database insertion

4. **Test in production** (1 day)
   - Run against live IPOs
   - Monitor logs for errors
   - Verify database entries

5. **Plan Moneycontrol scraper** (for missing fields)
   - ISIN, company description, financials
   - See separate document

---

## Monitoring & Logging

### Metrics to Track

- Total IPOs scraped
- Successful vs failed scrapes
- Average scrape time per IPO
- Fields with most missing data
- Error rate by error type

### Log Format

```typescript
console.log('[BSE Detail] Starting scrape for IPO:', symbol);
console.log('[BSE Detail] Successfully scraped:', symbol, 'in', duration, 'ms');
console.error('[BSE Detail] Failed to scrape:', url, error.message);
console.warn('[BSE Detail] Missing optional field:', field, 'for IPO:', symbol);
```

---

## Conclusion

### Summary

✅ **Cheerio works perfectly** - No need for Puppeteer
✅ **Simple HTML structure** - Easy to parse
✅ **URL pattern identified** - Can extract from listing page
⚠️ **60% data completeness** - Need secondary sources for ISIN, financials

### Estimated Effort

- Implementation: **2-3 days**
- Testing: **1-2 days**
- Integration: **1 day**
- **Total: 4-6 days**

### Recommended Priority

**HIGH** - BSE detail scraper provides critical fields like lot size, face value, and exact open/close dates that are essential for the platform.

Implement this scraper **before** Moneycontrol scraper, as it provides the foundation for IPO data.

---

**Document Version:** 1.0
**Last Updated:** October 17, 2025
**Status:** Ready for implementation
