# BSE Detail Page Comparison - ACQDisp vs DisplayIPO

**Document Version:** 1.0
**Created:** 2025-10-18
**Purpose:** Document HTML structure differences between BSE ACQDisp.aspx (MAINBOARD/SME) and DisplayIPO.aspx (RIGHTS/NCD) pages

---

## Page Type Overview

BSE uses two different page formats for IPO details:

1. **ACQDisp.aspx** - Used for MAINBOARD and SME IPOs (OTB = "On The Board")
   - URL Pattern: `https://www.bseindia.com/markets/PublicIssues/ACQDisp.aspx?id={id}&Type=OTB&...`
   - Technology: Static HTML tables
   - Status: ✅ Currently parsing successfully (12/12 IPOs)

2. **DisplayIPO.aspx** - Used for Rights Issues (RI) and Debt Issues (DPI/NCD)
   - URL Pattern: `https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id={id}&type={RI|DPI}&...`
   - Technology: Static HTML tables (different structure)
   - Status: ❌ Currently failing validation (11/11 IPOs)

---

## URL Pattern Detection

### ACQDisp.aspx (MAINBOARD/SME)
```
https://www.bseindia.com/markets/PublicIssues/ACQDisp.aspx?id=543555&Type=OTB&IDType=1&Status=Forthcoming&IPONo=20&startdt=2024-03-01
```

**Key Identifiers:**
- Path contains `/PublicIssues/ACQDisp.aspx`
- Query parameter: `Type=OTB`
- Case-sensitive: `PublicIssues` with capital P

### DisplayIPO.aspx (RIGHTS/NCD)
```
https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id=535238&type=RI&idtype=1&status=Forthcoming&IPONo=17&startdt=2024-01-15
https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id=543333&type=DPI&idtype=1&status=Forthcoming&IPONo=15&startdt=2024-01-10
```

**Key Identifiers:**
- Path contains `/publicIssues/DisplayIPO.aspx` (lowercase 'p')
- Query parameter: `type=RI` (Rights) or `type=DPI` (Debt)
- Case-sensitive: `publicIssues` with lowercase p

---

## HTML Structure Comparison

### ACQDisp.aspx (MAINBOARD/SME) - Current Working Parser

**Table Structure:**
```html
<table class="tablehead">
  <tbody>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Symbol</td>
      <td class="TTRow_left">MIDWESTLTD</td>
    </tr>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Issue Period</td>
      <td class="TTRow_left">15 Oct 2025 to 17 Oct 2025</td>
    </tr>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Price Band</td>
      <td class="TTRow_left">1014.00-1065.00</td>
    </tr>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Issue Size – No. of Shares</td>
      <td class="TTRow_left">31,17,460</td>
    </tr>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Face Value</td>
      <td class="TTRow_left">10</td>
    </tr>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Market Lot</td>
      <td class="TTRow_left">14</td>
    </tr>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Registrar</td>
      <td class="TTRow_left">Link Intime India Pvt. Ltd.</td>
    </tr>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Book Running Lead Manager</td>
      <td class="TTRow_left">Beeline Capital Advisors Pvt. Ltd., Narnolia Financial Advisors Ltd.</td>
    </tr>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Sponsor Bank</td>
      <td class="TTRow_left">HDFC Bank Ltd., ICICI Bank Ltd.</td>
    </tr>
  </tbody>
</table>
```

**Key CSS Selectors:**
- Table: `table.tablehead`
- Label cells: `td.TTRow_left[style*="font-weight:bold"]` (first column)
- Value cells: `td.TTRow_left` (second column without bold style)

**Field Labels (Exact Text):**
- Symbol
- Issue Period
- Price Band
- Issue Size – No. of Shares
- Face Value
- Market Lot
- Registrar
- Book Running Lead Manager
- Sponsor Bank

---

### DisplayIPO.aspx (RIGHTS/NCD) - New Parser Required

**Table Structure (Observed):**
```html
<table class="tablehead">
  <tbody>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Issue Period</td>
      <td class="TTRow_left">15 Jan 2024 to 22 Jan 2024</td>
    </tr>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Issue Price</td>
      <td class="TTRow_left">100.00</td>
    </tr>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Face Value</td>
      <td class="TTRow_left">10</td>
    </tr>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Lot Size</td>
      <td class="TTRow_left">150</td>
    </tr>
    <tr>
      <td class="TTRow_left" style="font-weight:bold;">Registrar</td>
      <td class="TTRow_left">KFin Technologies Limited</td>
    </tr>
    <!-- Note: Symbol field is ABSENT in many cases -->
    <!-- Note: Lead Managers field is ABSENT or uses different label -->
  </tbody>
</table>
```

**Key Differences:**

| Field | ACQDisp.aspx | DisplayIPO.aspx | Impact |
|-------|--------------|-----------------|--------|
| **Symbol** | ✅ Always present | ❌ Often missing | CRITICAL - Validation fails |
| **Lead Managers** | ✅ "Book Running Lead Manager" | ❌ Missing or different label | CRITICAL - Validation fails |
| **Price Field** | "Price Band" (min-max) | "Issue Price" (single value) | Different parsing logic |
| **Lot Size Field** | "Market Lot" | "Lot Size" | Different label |
| **Issue Shares** | "Issue Size – No. of Shares" | Often missing | Affects issue size calculation |
| **Field Order** | Consistent | Variable | Different selector strategy |

**CSS Selectors (Same):**
- Table: `table.tablehead`
- Label cells: `td.TTRow_left[style*="font-weight:bold"]`
- Value cells: `td.TTRow_left` (second column)

**Field Labels (DisplayIPO.aspx):**
- Issue Period
- Issue Price (instead of "Price Band")
- Face Value
- Lot Size (instead of "Market Lot")
- Registrar
- Symbol (optional)
- Lead Manager (optional, different label variations)
- Issue Size (optional, different format)

---

## Field Mapping Strategy

### Common Fields (Same Extraction Logic)

| Field | ACQDisp Label | DisplayIPO Label | Parsing Method |
|-------|---------------|------------------|----------------|
| Issue Period | "Issue Period" | "Issue Period" | parseIssuePeriod() - same |
| Face Value | "Face Value" | "Face Value" | parseInt() - same |
| Registrar | "Registrar" | "Registrar" | sanitizeText() - same |

### Different Fields (Conditional Parsing)

| Field | ACQDisp Approach | DisplayIPO Approach |
|-------|------------------|---------------------|
| **Symbol** | Extract from "Symbol" label | Try "Symbol" label, fallback to null |
| **Lead Managers** | "Book Running Lead Manager" | Try multiple labels: "Lead Manager", "Book Running Lead Manager", "Manager", or null |
| **Price** | "Price Band" → min-max | "Issue Price" → single value (use as both min/max) |
| **Lot Size** | "Market Lot" | "Lot Size" |
| **Issue Shares** | "Issue Size – No. of Shares" | Try "Issue Size", "No. of Shares", or calculate from issue value |

---

## Parsing Strategy by Page Type

### ACQDisp.aspx Parser (Existing - No Changes)

```typescript
function parseACQDispPage($: CheerioAPI): BSEDetailPageData {
  // Extract using current logic
  const symbol = extractFieldValue($, 'Symbol'); // REQUIRED
  const leadManagers = extractFieldValue($, 'Book Running Lead Manager'); // REQUIRED
  const priceBand = extractFieldValue($, 'Price Band'); // Format: "min-max"
  const lotSize = extractFieldValue($, 'Market Lot');
  const issueShares = extractFieldValue($, 'Issue Size – No. of Shares');

  // ... current parsing logic (no changes)
}
```

**Requirements:**
- Symbol: REQUIRED (validation fails if null)
- Lead Managers: REQUIRED (validation fails if null)

---

### DisplayIPO.aspx Parser (New Implementation)

```typescript
function parseDisplayIPOPage($: CheerioAPI): BSEDetailPageData {
  // Symbol: OPTIONAL (may be missing)
  const symbol = extractFieldValue($, 'Symbol') || null;

  // Lead Managers: Try multiple label variations, fallback to null
  const leadManagers =
    extractFieldValue($, 'Lead Manager') ||
    extractFieldValue($, 'Book Running Lead Manager') ||
    extractFieldValue($, 'Manager') ||
    null;

  // Price: Single value instead of range
  const issuePriceStr = extractFieldValue($, 'Issue Price') ||
                        extractFieldValue($, 'Price');
  const issuePrice = issuePriceStr ? parseFloat(issuePriceStr) : 0;
  const priceRangeMin = issuePrice;
  const priceRangeMax = issuePrice;

  // Lot Size: Different label
  const lotSizeStr = extractFieldValue($, 'Lot Size') ||
                     extractFieldValue($, 'Market Lot');
  const lotSize = lotSizeStr ? parseInt(lotSizeStr, 10) : 100;

  // Issue Shares: Try multiple approaches
  const issueSharesStr = extractFieldValue($, 'Issue Size – No. of Shares') ||
                         extractFieldValue($, 'Issue Size') ||
                         extractFieldValue($, 'No. of Shares');
  const issueShares = parseShareCount(issueSharesStr);

  // ... rest of common fields (same logic)
  const issuePeriod = extractFieldValue($, 'Issue Period');
  const { openDate, closeDate } = parseIssuePeriod(issuePeriod);

  const faceValueStr = extractFieldValue($, 'Face Value');
  const faceValue = faceValueStr ? parseInt(parseFloat(faceValueStr).toString(), 10) : 10;

  const registrar = extractFieldValue($, 'Registrar');
  const sponsorBanksStr = extractFieldValue($, 'Sponsor Bank');

  return {
    symbol, // May be null
    openDate,
    closeDate,
    priceRangeMin,
    priceRangeMax,
    issueSize: calculateIssueSize(issueShares, priceRangeMax),
    lotSize,
    faceValue,
    registrar,
    leadManagers: parseCommaSeparatedList(leadManagers), // May be null
    sponsorBanks: parseCommaSeparatedList(sponsorBanksStr),
    issueShares,
  };
}
```

**Requirements:**
- Symbol: OPTIONAL (can be null for RIGHTS/NCD)
- Lead Managers: OPTIONAL (can be null for RIGHTS/NCD)

---

## Failed IPO Examples

### Rights Issues (8 failed)

1. **SUNSHIELD CHEMICALS LTD** - Rights Issue
   - Likely missing: Symbol, Lead Managers
   - Has: Dates, Price, Lot Size

2. **WARDWIZARD INNOVATIONS MOBILITY LTD** - Rights Issue
   - Likely missing: Symbol, Lead Managers
   - Has: Dates, Price, Lot Size

3. **3I INFOTECH LTD** - Rights Issue
   - Likely missing: Symbol, Lead Managers
   - Has: Dates, Price, Lot Size

4. **HEALTHY LIFE AGRITEC LTD** - Rights Issue
5. **ASHNISHA INDUSTRIES LTD** - Rights Issue
6. **STAR HOUSING FINANCE LTD** - Rights Issue
7. **SURAJ INDUSTRIES LTD** - Rights Issue
8. **CAPITAL TRUST LTD** - Rights Issue

### Debt Issues (3 failed)

1. **SMC Global Securities Limited** - NCD
   - Likely missing: Symbol, Lead Managers
   - Has: Dates, Issue Price, Lot Size

2. **Indel Money Limited** - NCD
   - Likely missing: Symbol, Lead Managers
   - Has: Dates, Issue Price, Lot Size

3. **Chemmanur Credits and Investments Limited** - NCD
   - Likely missing: Symbol, Lead Managers
   - Has: Dates, Issue Price, Lot Size

---

## Validation Schema Changes Required

### Current Validation (Fails for RIGHTS/NCD)

```typescript
// Current: symbol and leadManagers are REQUIRED
if (!data.symbol) {
  errors.push('Missing required field: symbol');
}

if (!data.leadManagers) {
  errors.push('Missing required field: leadManagers');
}
```

**Problem:** All 11 RIGHTS/NCD IPOs fail validation due to missing symbol/leadManagers

---

### New Conditional Validation (Required)

```typescript
// Make fields nullable in schema
const BSEDetailPageDataSchema = z.object({
  symbol: z.string().nullable(), // Changed from .min(1)
  leadManagers: z.array(z.string()).nullable(), // Changed from required
  // ... other fields
}).refine((data) => {
  // Conditional validation based on category
  // Note: Category not available in detail scraper, so validation happens in orchestrator
  // For now, allow null symbol and leadManagers at detail page level
  return true;
}, {
  message: 'Conditional validation placeholder',
});
```

**Implementation Location:** `scraper/src/utils/validators.ts`

---

## Implementation Checklist

- [x] Document HTML structure differences
- [x] Create field mapping table
- [x] Define parsing strategy for each page type
- [ ] Implement `detectBSEDetailPageType()` function
- [ ] Implement `parseDisplayIPOPage()` function
- [ ] Refactor `parseACQDispPage()` function
- [ ] Update validation schema to allow nullable fields
- [ ] Create HTML test fixtures
- [ ] Write unit tests
- [ ] Run integration tests

---

## Test Coverage Plan

### Unit Tests Required

1. **Page Type Detection**
   - ACQDisp.aspx URL → returns 'ACQDisp'
   - DisplayIPO.aspx with type=RI → returns 'DisplayIPO'
   - DisplayIPO.aspx with type=DPI → returns 'DisplayIPO'
   - Edge cases (malformed URLs)

2. **ACQDisp Parser**
   - Existing test with full data
   - Test with missing optional fields
   - Regression test (ensure no changes)

3. **DisplayIPO Parser**
   - Rights Issue with missing symbol → symbol = null
   - Rights Issue with missing leadManagers → leadManagers = null
   - Debt Issue with single issue price → min === max
   - Debt Issue with all required fields

4. **Validation Schema**
   - MAINBOARD with null symbol → FAIL
   - MAINBOARD with null leadManagers → FAIL
   - RIGHTS with null symbol → PASS
   - RIGHTS with null leadManagers → PASS
   - NCD with null symbol → PASS
   - NCD with null leadManagers → PASS

---

## Integration Test Plan

### Test Data Setup
- Fixture file: `scraper/tests/fixtures/bse-test-urls.json`
- Contains 23 BSE IPO URLs:
  - 12 OTB (ACQDisp.aspx) - Currently passing
  - 8 Rights Issues (DisplayIPO.aspx) - Currently failing
  - 3 Debt Issues (DisplayIPO.aspx) - Currently failing

### Success Criteria
- Before: 12/23 IPOs validate successfully (52%)
- After: 23/23 IPOs validate successfully (100%)
- Zero regression for OTB IPOs

---

## Performance Impact

### Before (Current)
- Phase 2 (Detail Pages): ~2 seconds per IPO
- Validation: 12/23 pass, 11/23 fail
- Database writes: 12 IPOs only

### After (With DisplayIPO Parser)
- Phase 2 (Detail Pages): ~2 seconds per IPO (same)
- Validation: 23/23 pass
- Database writes: 23 IPOs (100% coverage)

**Impact:** Zero performance degradation, 91% increase in validation success rate

---

## Related Files

**Implementation:**
- `scraper/src/scrapers/bse-detail-scraper.ts` - Main parser
- `scraper/src/utils/validators.ts` - Validation schema

**Tests:**
- `scraper/tests/unit/scrapers/bse-detail-scraper.test.ts`
- `scraper/tests/integration/bse-scraper.integration.test.ts`

**Fixtures:**
- `scraper/tests/fixtures/bse-rights-issue-detail.html`
- `scraper/tests/fixtures/bse-debt-issue-detail.html`
- `scraper/tests/fixtures/bse-mainboard-acqdisp.html`
- `scraper/tests/fixtures/bse-test-urls.json`

---

**Document Status:** ✅ COMPLETE
**Last Updated:** 2025-10-18
**Next Steps:** Implement `detectBSEDetailPageType()` and `parseDisplayIPOPage()` functions
