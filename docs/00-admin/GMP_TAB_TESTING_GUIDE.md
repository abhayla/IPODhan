# GMP Tab Testing Guide

Quick reference for testing the editable GMP tab functionality.

---

## Test Environment Setup

1. **Start Development Server:**
   ```bash
   cd web
   npm run dev
   ```

2. **Navigate to Admin Edit Page:**
   ```
   http://localhost:3000/admin/edit/{slug}
   ```
   Replace `{slug}` with an actual IPO slug (e.g., `xyz-corporation-ipo`)

3. **Login as Admin:**
   - Use admin credentials to access the admin panel
   - JWT token should be stored in context

---

## Manual Test Cases

### Test 1: Create New GMP Record (Happy Path)

**Steps:**
1. Click "GMP" tab
2. Click "+ Add New GMP Record" button
3. Fill in form:
   - GMP Price: `150`
   - Expected Listing Price: `450`
   - Sauda Details: `Strong grey market demand`
   - Source: `Manual Entry`
   - Recorded At: Leave default (current time)
   - Auto-Protect: Leave checked
4. Click "Create Record"

**Expected Result:**
- ✅ Success message appears: "GMP record created successfully"
- ✅ Modal closes
- ✅ New record appears in GMP list
- ✅ Record shows: ₹150 Premium, Source: Manual Entry
- ✅ Timestamp matches current time

**Verification:**
```sql
SELECT * FROM gmp_records WHERE ipo_id = '{ipo-id}' ORDER BY timestamp DESC LIMIT 1;
```

---

### Test 2: Validation - Missing Required Fields

**Steps:**
1. Click "+ Add New GMP Record"
2. Leave GMP Price empty
3. Fill only Source: `Test Source`
4. Click "Create Record"

**Expected Result:**
- ❌ Error message: "Error: GMP Price is required and must be >= 0"
- ⏸️ Modal stays open
- ⏸️ No record created

**Repeat for Source:**
1. Fill GMP Price: `100`
2. Leave Source empty
3. Click "Create Record"

**Expected Result:**
- ❌ Error message: "Error: Source is required"

---

### Test 3: Validation - Negative GMP Price

**Steps:**
1. Click "+ Add New GMP Record"
2. GMP Price: `-50`
3. Source: `Test Source`
4. Click "Create Record"

**Expected Result:**
- ❌ Error message: "Error: GMP Price is required and must be >= 0"
- ⏸️ No record created

---

### Test 4: Edit Existing GMP Record

**Prerequisites:** At least one GMP record exists

**Steps:**
1. Click "Edit" button on any GMP record
2. Modal opens with pre-filled data
3. Change GMP Price: `175` (was `150`)
4. Change Source: `Updated Source` (was `Manual Entry`)
5. Click "Update Record"

**Expected Result:**
- ✅ Success message: "GMP record updated successfully"
- ✅ Modal closes
- ✅ Record displays updated values
- ✅ Other records unchanged

**Verification:**
```sql
SELECT * FROM gmp_records WHERE id = '{record-id}';
-- Should show gmp = 175, source = 'Updated Source'
```

---

### Test 5: Delete GMP Record

**Prerequisites:** At least two GMP records exist

**Steps:**
1. Click "Delete" button on any GMP record
2. Confirmation dialog appears
3. Click "OK" to confirm

**Expected Result:**
- ✅ Success message: "GMP record deleted successfully"
- ✅ Record removed from list
- ✅ Other records still visible
- ✅ List refreshes

**Cancel Deletion:**
1. Click "Delete" on another record
2. Click "Cancel" in confirmation dialog

**Expected Result:**
- ⏸️ Record NOT deleted
- ⏸️ List unchanged

---

### Test 6: Auto-Protect Toggle

**Steps:**
1. Click "+ Add New GMP Record"
2. Fill required fields
3. **Uncheck** "Auto-Protect" checkbox
4. Click "Create Record"

**Verification:**
```sql
SELECT * FROM field_protection_metadata
WHERE ipo_id = '{ipo-id}'
  AND table_name = 'gmp_records'
  AND field_name = 'gmp'
ORDER BY created_at DESC LIMIT 1;
```

**Expected:**
- `is_protected` = `false`
- `auto_protected` = `false`

**Repeat with Auto-Protect CHECKED:**
- `is_protected` = `true`
- `auto_protected` = `true`

---

### Test 7: Multiple GMP Records Display

**Steps:**
1. Create 12 GMP records (more than display limit of 10)
2. Navigate to GMP tab

**Expected Result:**
- ✅ Shows latest 10 records
- ✅ Message: "Showing latest 10 of 12 records"
- ✅ Records sorted by timestamp (latest first)

---

### Test 8: Modal Cancel Button

**Steps:**
1. Click "+ Add New GMP Record"
2. Fill in some fields (don't save)
3. Click "Cancel" button

**Expected Result:**
- ✅ Modal closes
- ✅ No record created
- ✅ Form data discarded

---

### Test 9: Datetime Input

**Steps:**
1. Click "+ Add New GMP Record"
2. Click "Recorded At" datetime picker
3. Select past date: `2025-10-20 14:30`
4. Fill other required fields
5. Click "Create Record"

**Expected Result:**
- ✅ Record created with specified timestamp
- ✅ Display shows: `10/20/2025, 2:30:00 PM` (local format)

---

### Test 10: Cache Invalidation

**Prerequisites:** Redis running

**Steps:**
1. Load IPO detail page: `/ipos/{slug}`
2. Note current GMP count
3. Go to admin edit page
4. Add new GMP record
5. Return to IPO detail page (refresh)

**Expected Result:**
- ✅ GMP count increments by 1
- ✅ New GMP record visible
- ✅ No stale cache data

**Verification:**
```bash
redis-cli
> KEYS ipo:*
# Should show no keys or fresh data
```

---

## API Testing (Optional)

### Using cURL

**Create GMP Record:**
```bash
curl -X POST http://localhost:3000/api/admin/gmp/{ipo-id} \
  -H "Authorization: Bearer {admin-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "gmpPrice": 150,
    "estimatedListingPrice": 450,
    "subject": "Test GMP",
    "source": "Manual Entry",
    "recordedAt": "2025-10-22T10:30:00",
    "autoProtect": true
  }'
```

**Update GMP Record:**
```bash
curl -X PATCH http://localhost:3000/api/admin/gmp/{ipo-id} \
  -H "Authorization: Bearer {admin-token}" \
  -H "Content-Type: application/json" \
  -d '{
    "recordId": "{gmp-record-id}",
    "gmpPrice": 175,
    "source": "Updated Source",
    "autoProtect": true
  }'
```

**Delete GMP Record:**
```bash
curl -X DELETE "http://localhost:3000/api/admin/gmp/{ipo-id}?recordId={gmp-record-id}" \
  -H "Authorization: Bearer {admin-token}"
```

---

## Database Verification Queries

**Check GMP Records:**
```sql
SELECT
  id,
  ipo_id,
  gmp AS gmp_price,
  expected_listing_price,
  sauda_details,
  source,
  timestamp
FROM gmp_records
WHERE ipo_id = '{ipo-id}'
ORDER BY timestamp DESC;
```

**Check Field Protection:**
```sql
SELECT
  table_name,
  field_name,
  is_protected,
  auto_protected,
  manually_edited_at,
  manually_edited_by,
  edit_note
FROM field_protection_metadata
WHERE ipo_id = '{ipo-id}'
  AND table_name = 'gmp_records';
```

**Check Latest GMP for IPO:**
```sql
SELECT * FROM gmp_records
WHERE ipo_id = '{ipo-id}'
ORDER BY timestamp DESC
LIMIT 1;
```

---

## Known Issues to Check

### Pre-existing Issues (Not GMP-related)
- ⚠️ FinancialData TypeScript errors (unrelated to GMP)
- Check console for any TypeScript warnings

### Potential Issues to Watch
1. **Integer Conversion:** GMP stored as integer, ensure no decimals in DB
2. **Timezone Display:** Check if datetime displays in correct timezone
3. **Long Sauda Details:** Test with 500+ character text
4. **Special Characters:** Test source with quotes, apostrophes

---

## Performance Testing

### Load Test
1. Create 50+ GMP records for one IPO
2. Navigate to GMP tab
3. Check page load time (should be < 1s)
4. Check if pagination/limit works correctly

### Concurrent Edits
1. Open admin edit page in two browser tabs
2. Edit same GMP record in both tabs
3. Save in Tab 1
4. Save in Tab 2

**Expected:**
- ✅ Last save wins (optimistic locking not implemented)
- ⚠️ No conflict detection (future enhancement)

---

## Accessibility Testing

1. **Keyboard Navigation:**
   - Tab through form fields
   - Press Enter to submit
   - Press Escape to close modal (not implemented)

2. **Screen Reader:**
   - All form labels should be announced
   - Required fields should be identified
   - Error messages should be announced

---

## Browser Compatibility

Test in:
- ✅ Chrome (latest)
- ✅ Firefox (latest)
- ✅ Edge (latest)
- ⚠️ Safari (check datetime input format)
- ⚠️ Mobile Chrome/Safari

---

## Regression Testing

**Ensure existing functionality still works:**
- ✅ Basic Info tab editing
- ✅ Financials tab editing
- ✅ Subscriptions tab editing
- ✅ Documents tab display
- ✅ Protection tab
- ✅ IPO lock/unlock toggle

---

## Error Handling Tests

### Network Errors
1. **Simulate Network Failure:**
   - Disconnect network
   - Try creating GMP record
   - Expected: Error message, retry possible

2. **Timeout:**
   - Add artificial delay in API
   - Check loading state persists
   - Check timeout handling

### Server Errors
1. **500 Internal Server Error:**
   - Mock server error in API
   - Expected: Error message displayed
   - Modal stays open for retry

2. **401 Unauthorized:**
   - Use invalid token
   - Expected: Auth error, redirect to login

---

## Success Criteria

### Must Pass ✅
- Create, edit, delete GMP records
- Validation prevents invalid data
- Auto-protect works correctly
- Cache invalidation works
- No console errors
- Data persists in database

### Nice to Have 🎯
- Fast page load (< 1s)
- Good UX (clear messages, loading states)
- Accessible (keyboard, screen reader)
- Mobile responsive

---

## Reporting Bugs

**Bug Report Template:**
```
**Title:** [Brief description]

**Steps to Reproduce:**
1. ...
2. ...
3. ...

**Expected Result:**
...

**Actual Result:**
...

**Environment:**
- Browser: ...
- OS: ...
- Date: ...

**Screenshots/Logs:**
[Attach if applicable]
```

**Submit bugs to:** GitHub Issues or project management tool

---

## Test Completion Checklist

- [ ] Test 1: Create new GMP record ✅
- [ ] Test 2: Validation - missing fields ✅
- [ ] Test 3: Validation - negative price ✅
- [ ] Test 4: Edit existing record ✅
- [ ] Test 5: Delete record ✅
- [ ] Test 6: Auto-protect toggle ✅
- [ ] Test 7: Multiple records display ✅
- [ ] Test 8: Modal cancel ✅
- [ ] Test 9: Datetime input ✅
- [ ] Test 10: Cache invalidation ✅
- [ ] API testing (cURL) ✅
- [ ] Database verification ✅
- [ ] Performance testing ✅
- [ ] Accessibility testing ✅
- [ ] Browser compatibility ✅
- [ ] Regression testing ✅

**Tester:** _______________
**Date:** _______________
**Status:** ☐ Pass  ☐ Fail  ☐ Partial

---

## Quick Debug Commands

**Check if API is working:**
```bash
# Health check
curl http://localhost:3000/api/health

# Check admin auth
curl http://localhost:3000/api/admin/protection/fields/{ipo-id} \
  -H "Authorization: Bearer {token}"
```

**Check Redis:**
```bash
redis-cli ping
redis-cli KEYS ipo:*
redis-cli FLUSHDB  # Clear all cache (use with caution)
```

**Check Database:**
```bash
psql -h localhost -U postgres -d ipodhan
\dt  # List tables
\d gmp_records  # Describe table
```

---

## Automated Testing (Future)

**Recommended test framework:** Vitest + Testing Library

**Example test:**
```typescript
describe('GMP Tab', () => {
  it('should create new GMP record', async () => {
    // Test implementation
  });

  it('should validate required fields', async () => {
    // Test implementation
  });

  it('should delete GMP record', async () => {
    // Test implementation
  });
});
```

**E2E Testing:** Playwright

**Example E2E test:**
```typescript
test('admin can add GMP record', async ({ page }) => {
  await page.goto('/admin/edit/test-ipo');
  await page.click('text=GMP');
  await page.click('text=Add New GMP Record');
  await page.fill('input[placeholder*="GMP price"]', '150');
  await page.fill('input[placeholder*="source"]', 'Manual Entry');
  await page.click('text=Create Record');
  await expect(page.locator('text=GMP record created successfully')).toBeVisible();
});
```

---

**End of Testing Guide**

For questions or issues, contact the development team or create a GitHub issue.
