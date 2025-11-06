# Test 3.3: DRHP Extraction Workflow - Test Results

**Date**: 2025-11-06
**Test Duration**: ~15 minutes
**Overall Result**: ⚠️ **PARTIALLY PASSED** (P0 Critical Bug Found)

---

## 📋 Test Objective

Test the complete end-to-end DRHP extraction workflow:
1. Upload PDF via web UI
2. Trigger extraction process
3. Monitor progress
4. Verify extraction completion
5. Check extracted data in history
6. Review extracted data

---

## ✅ What Worked

### 1. PDF Upload (PASSED)
- ✅ File selection via dropzone
- ✅ File validation (8.57 MB accepted)
- ✅ Success notification displayed
- ✅ File name shown: "studds-drhp.pdf"
- ✅ Clear and Extract buttons appeared

**Screenshot**: `.playwright-mcp/phase3-test3.3a-pdf-uploaded.png`

### 2. Python Extractor Execution (PASSED)
The Python script successfully executed and extracted financial data:

```json
{
  "data": {
    "company": "1762455830399_932d2561_studds-drhp",
    "ebitda_fy2022": 9.0192,
    "ebitda_fy2023": 10.484,
    "ebitda_fy2024": 3.0261,
    "revenue_fy2022": null,
    "revenue_fy2023": null,
    "revenue_fy2024": null,
    ...
  },
  "metadata": {
    "extraction_time": 106.53,
    "pl_page": 264,
    "tables_found": 1,
    "confidence_score": 25,
    "confidence_level": "LOW",
    "unit": "lakhs"
  }
}
```

**Verified**:
- ✅ 3 EBITDA fields extracted (FY2022, FY2023, FY2024)
- ✅ Correct crores conversion (from lakhs)
- ✅ 25% confidence score (LOW level)
- ✅ Extraction time: ~50-107 seconds
- ✅ JSON file saved: `pdf-parser-test/output/1762455830399_932d2561_studds-drhp_extraction_v3.json`

### 3. Database Integration (PASSED)
- ✅ IPO record created/found
- ✅ Extraction log entries created
- ✅ File uploaded to `web/web/uploads/drhp/`
- ✅ Extraction history updated (9 total extractions)

**Screenshot**: `.playwright-mcp/phase3-test3.3b-extraction-completed-with-failures.png`

---

## ❌ What Failed

### 🐛 P0 CRITICAL BUG #1: JSON Parsing Error

**Location**: `web/app/api/admin/drhp/extract/route.ts:220-222`

**Problem**:
```typescript
// ❌ WRONG: API expects this path
const { score, level } = calculateConfidence(result.data.financial_data);
const fieldsExtracted = Object.keys(result.data.financial_data || {})
  .filter(k => result.data.financial_data[k] !== null).length;
```

**Python Outputs**:
```json
{
  "data": {
    "ebitda_fy2022": 9.0192,  // ← Fields are here
    "ebitda_fy2023": 10.484,
    ...
  },
  "metadata": { ... }
}
```

**Should Be**:
```typescript
// ✅ CORRECT: Fields are in result.data, not result.data.financial_data
const { score, level } = calculateConfidence(result.data);
const fieldsExtracted = Object.keys(result.data || {})
  .filter(k => result.data[k] !== null).length;
```

**Impact**:
- Shows "0 fields extracted" instead of 3
- Confidence score shows 0% instead of 25%
- Status incorrectly shows "PARTIAL" instead of proper status
- Extracted data not visible in UI

---

### 🐛 P0 CRITICAL BUG #2: stdout Parsing Failure

**Location**: `web/app/api/admin/drhp/extract/route.ts:123-124`

**Problem**:
Python script outputs formatted progress text **before** the JSON:
```
============================================================
DRHP FINANCIAL EXTRACTOR V3 (Unit Detection)
============================================================
[Input] D:\path\to\file.pdf
[Size] 8.6 MB
...
{JSON here}
```

But the code tries to parse `stdout` directly:
```typescript
const result = JSON.parse(stdout);  // ❌ Fails - stdout contains progress text
```

**Server Logs**:
```
Failed to parse Python output: [Size] 8.6 MB
[Pages] 570
...
[DRHP Extraction] Failed: studds-drhp Invalid output from extractor
```

**Solution Needed**:
1. Extract only the JSON portion from stdout (find last `{` to last `}`)
2. Or modify Python script to output JSON only to stdout, progress to stderr
3. Or use a dedicated output file path

---

## 📊 Test Results Summary

| Test Step | Expected | Actual | Status |
|-----------|----------|--------|--------|
| PDF Upload | File uploaded | ✅ Uploaded successfully | **PASS** |
| Dropzone UI | Shows file name + size | ✅ studds-drhp.pdf, 8.57 MB | **PASS** |
| Extraction Trigger | Starts processing | ✅ Started | **PASS** |
| Python Execution | Extract 3 fields, 25% confidence | ✅ Extracted correctly | **PASS** |
| JSON Output | Valid JSON file created | ✅ Created | **PASS** |
| API Parsing | Parse and store data | ❌ **FAILED** - 0 fields shown | **FAIL** |
| Extraction History | Show correct stats | ❌ Shows 0/16 fields, 0% | **FAIL** |
| Confidence Display | 25% LOW | ❌ Shows 0% or missing | **FAIL** |
| Review Data Tab | Show extracted values | ❌ Empty state | **FAIL** |

---

## 📈 Metrics

**Extraction Performance**:
- Upload time: < 2 seconds
- Python processing: 50-107 seconds (varies by run)
- Total workflow: ~2 minutes
- Success rate: 100% (Python level)
- Display success rate: 0% (API bug)

**Data Quality**:
- Fields extracted: 3 (EBITDA FY2022, FY2023, FY2024)
- Confidence: 25% (LOW)
- Unit conversion: ✅ Correct (lakhs → crores)
- JSON validity: ✅ Valid

---

## 🔍 Evidence

### Screenshots Captured:
1. `phase3-test3.3a-pdf-uploaded.png` - Upload success state
2. `phase3-test3.3b-extraction-completed-with-failures.png` - History showing 0 fields
3. `phase3-test3.3c-review-data-empty.png` - Review tab empty state

### Log Evidence:
**Python Success (from server logs)**:
```
[OK] ebitda_fy2024 = 3.03 crores (from lakhs) (KPI-p148)
[OK] ebitda_fy2023 = 10.48 crores (from lakhs) (KPI-p148)
[OK] ebitda_fy2022 = 9.02 crores (from lakhs) (KPI-p148)

[Summary]
  Extracted: 3/16 fields
  Time: 50.6s
  Confidence: 25% (LOW)
```

**API Failure (from server logs)**:
```
Failed to parse Python output: [Size] 8.6 MB...
[DRHP Extraction] Failed: studds-drhp Invalid output from extractor
[DRHP Extraction] Success: studds-drhp, 0 fields extracted
```

### File Evidence:
- JSON output: `pdf-parser-test/output/1762455830399_932d2561_studds-drhp_extraction_v3.json`
- Uploaded PDF: `web/web/uploads/drhp/1762455830399_932d2561_studds-drhp.pdf`

---

## 🔧 Required Fixes

### Fix #1: Correct JSON Path
**File**: `web/app/api/admin/drhp/extract/route.ts`
**Lines**: 220-222, 239-240

**Change**:
```typescript
// OLD
const { score, level } = calculateConfidence(result.data.financial_data);
const fieldsExtracted = Object.keys(result.data.financial_data || {})
  .filter(k => result.data.financial_data[k] !== null).length;

// NEW
const { score, level } = calculateConfidence(result.data);
const fieldsExtracted = Object.keys(result.data || {})
  .filter(k => result.data[k] !== null).length;
```

### Fix #2: Extract JSON from stdout
**File**: `web/app/api/admin/drhp/extract/route.ts`
**Lines**: 122-129

**Change**:
```typescript
// Parse the JSON output
try {
  // Extract JSON portion from stdout (find last opening brace to end)
  const jsonStart = stdout.lastIndexOf('{');
  const jsonEnd = stdout.lastIndexOf('}') + 1;

  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    throw new Error('No JSON found in output');
  }

  const jsonString = stdout.substring(jsonStart, jsonEnd);
  const result = JSON.parse(jsonString);

  return { success: true, data: result };
} catch (parseError) {
  console.error('Failed to parse Python output:', stdout);
  return { success: false, error: 'Invalid output from extractor' };
}
```

---

## 🎯 Impact Assessment

**Severity**: P0 CRITICAL
**Impact**: Feature non-functional - extraction works but results not visible
**Users Affected**: All admin users attempting DRHP extraction
**Workaround**: None - data not accessible via UI

**Business Impact**:
- Manual data entry still required (defeats purpose)
- Admin confidence in feature: Low
- Cannot proceed to Phase 4/5 testing until fixed

---

## ✅ Next Steps

1. **Fix P0 bugs** (estimated: 30 minutes)
   - Update JSON paths in route.ts
   - Add stdout JSON extraction logic
   - Test with studds-drhp.pdf again

2. **Verify fix** (estimated: 15 minutes)
   - Re-run Test 3.3
   - Confirm 3 fields display correctly
   - Verify 25% confidence shown
   - Check Review Data tab shows values

3. **Regression test** (estimated: 10 minutes)
   - Test with different PDF (e.g., lenskart-drhp.pdf)
   - Verify history accumulates correctly
   - Test retry functionality

4. **Continue to Test 3.6** - Error handling

---

## 📝 Test Execution Notes

**Tester**: Claude Code
**Environment**: Windows development environment
**Server**: Next.js dev server (port 3000)
**Python**: 3.13.7
**Database**: PostgreSQL local instance
**Test File**: studds-drhp.pdf (8.57 MB, 570 pages)

**Total Execution Time**: 15 minutes
**Bugs Found**: 2 (both P0 Critical)
**Tests Passed**: 5/9 (56%)
**Tests Failed**: 4/9 (44%)
**Overall Quality**: 6.5/10 (Feature works, integration broken)

---

## 🔗 Related Documentation

- Test Plan: `docs/00-admin/Admin-new-feature-test-prompt.md`
- Python Extractor: `pdf-parser-test/extract_drhp_pdfplumber_v3.py`
- API Route: `web/app/api/admin/drhp/extract/route.ts`
- Previous Tests: `docs/00-admin/TEST_3.2_FILE_VALIDATION_RESULTS.md`

---

**Report Generated**: 2025-11-06
**Status**: BLOCKED - Requires P0 fixes before proceeding
