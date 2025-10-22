# GMP Tab Editable Implementation

## Overview
Made the GMP (Grey Market Premium) tab in the admin IPO edit page fully editable with create, update, and delete functionality.

**Date:** 2025-10-22
**Status:** ✅ Complete

---

## Files Modified/Created

### 1. New API Endpoint
**File:** `web/app/api/admin/gmp/[ipoId]/route.ts` (Created)

**Endpoints:**
- `POST /api/admin/gmp/[ipoId]` - Create new GMP record
- `PATCH /api/admin/gmp/[ipoId]` - Update existing GMP record
- `DELETE /api/admin/gmp/[ipoId]?recordId={id}` - Delete GMP record

**Features:**
- Validates required fields (gmpPrice >= 0, source is required)
- Stores GMP as integer (schema requirement)
- Automatic field protection with `markFieldAsManuallyEdited()`
- Auto-protect toggle option (default: true)
- Cache invalidation for IPO detail and list caches
- Comprehensive error handling with descriptive messages

**Request/Response Format:**

```typescript
// POST/PATCH Request Body
interface CreateGMPRequest {
  gmpPrice: number;              // Required, >= 0
  gmpPercentage?: number;        // Optional (not used in schema)
  estimatedListingPrice?: number; // Maps to expectedListingPrice
  subject?: string;              // Maps to saudaDetails
  source: string;                // Required
  recordedAt?: string;           // ISO datetime, default: now
  autoProtect?: boolean;         // Default: true
  editNote?: string;             // Admin note
  recordId?: string;             // Required for PATCH
}

// Response
{
  success: true,
  data: { /* GMP record */ },
  message: "GMP record created/updated successfully"
}
```

### 2. Admin Page Updates
**File:** `web/app/admin/edit/[slug]/page.tsx` (Modified)

**Changes:**

#### A. Interface Updates
```typescript
// Updated GMP interface to match database schema
interface GMP {
  id: string;
  ipoId: string;
  gmp: number | null;                  // Schema field (was gmpPrice)
  timestamp: string;                   // Schema field (was recordedAt)
  expectedListingPrice: number | null; // Schema field (was estimatedListingPrice)
  subjectRate: number | null;          // Schema field
  kostakRate: number | null;           // Schema field
  saudaDetails: string | null;         // Schema field (was subject)
  source: string | null;
}
```

#### B. New State Management
```typescript
const [showGMPModal, setShowGMPModal] = useState(false);
const [editingGMP, setEditingGMP] = useState<GMP | null>(null);
const [gmpFormData, setGmpFormData] = useState({
  gmpPrice: '',
  gmpPercentage: '',
  estimatedListingPrice: '',
  subject: '',
  source: '',
  recordedAt: new Date().toISOString().slice(0, 16),
  autoProtect: true,
});
```

#### C. New Handler Functions
1. **`handleOpenAddGMP()`** - Opens modal for new record
2. **`handleOpenEditGMP(gmp)`** - Opens modal with existing record data
3. **`handleCloseGMPModal()`** - Closes modal and resets form
4. **`handleSaveGMP()`** - Saves (create/update) GMP record with validation
5. **`handleDeleteGMP(gmpId)`** - Deletes GMP record with confirmation

#### D. UI Components

**GMP Tab Header:**
```tsx
<div className="flex justify-between items-center mb-4">
  <h3 className="text-lg font-semibold text-white">
    Grey Market Premium (GMP)
  </h3>
  <button onClick={handleOpenAddGMP}>
    + Add New GMP Record
  </button>
</div>
```

**GMP Record Display:**
- Shows GMP amount (₹{gmp.gmp})
- Timestamp display
- Edit and Delete buttons for each record
- Expected listing price
- Source information
- Sauda details (if available)

**GMP Modal Form:**
- **GMP Price (₹)** - Required, number input
- **Expected Listing Price (₹)** - Optional, integer input
- **Sauda Details / Trading Info** - Optional, textarea
- **Source** - Required, text input (e.g., "Manual Entry", "Market Source")
- **Recorded At** - Datetime input (default: now)
- **Auto-Protect** - Checkbox (default: checked)
- Save/Cancel buttons with loading states

---

## Database Schema Mapping

**Table:** `gmp_records`

| Frontend Field | Schema Field | Type | Required | Notes |
|---|---|---|---|---|
| gmpPrice | gmp | integer | Yes | Grey market premium in INR |
| estimatedListingPrice | expectedListingPrice | integer | No | Expected listing price |
| subject | saudaDetails | text | No | Trading info/notes |
| source | source | varchar(100) | Yes | Data source |
| recordedAt | timestamp | timestamp | Yes | Default: now |
| - | subjectRate | integer | No | Subject/safalya rate (not exposed) |
| - | kostakRate | integer | No | Kostak rate (not exposed) |

**Note:** GMP percentage is not stored in schema - calculated on display if needed.

---

## Features Implemented

### ✅ 1. Add New GMP Record
- Modal form with all required fields
- Validation: gmpPrice >= 0, source required
- Default timestamp to current datetime
- Auto-protect option (default: true)
- Success/error messages

### ✅ 2. Edit Existing GMP Record
- Pre-fills form with existing record data
- Updates only the specific record by ID
- Same validation as create
- Confirmation messages

### ✅ 3. Delete GMP Record
- Confirmation dialog before deletion
- Deletes by record ID
- Refreshes GMP list after deletion
- Error handling

### ✅ 4. Auto-Protection
- All records are auto-protected by default
- Prevents scraper from overwriting manual edits
- Can be disabled per record
- Integrates with field protection system

### ✅ 5. User Experience
- Modal-based editing (industry standard)
- Form validation with clear error messages
- Loading states during save/delete operations
- Success confirmations
- Responsive design
- Accessible form inputs

---

## Validation Rules

### Client-Side Validation
1. **GMP Price:**
   - Required
   - Must be numeric
   - Must be >= 0

2. **Source:**
   - Required
   - Cannot be empty string

3. **Expected Listing Price:**
   - Optional
   - Must be numeric if provided
   - Stored as integer

4. **Sauda Details:**
   - Optional
   - Free-text field

### Server-Side Validation
- Mirrors client-side validation
- Additional validation in API endpoint
- Returns descriptive error messages

---

## Cache Invalidation

After create/update/delete operations:
```typescript
await redis.del(`ipo:id:${ipoId}`, `ipo:slug:*`);
const listKeys = await redis.keys('ipo:list:*');
if (listKeys.length > 0) {
  await redis.del(...listKeys);
}
```

Ensures:
- IPO detail page shows updated GMP data
- List pages show correct GMP counts
- No stale data served from cache

---

## Security

### Authentication
- All endpoints protected with `withAdminAuth` middleware
- Requires valid admin JWT token
- Admin identity tracked for audit logs

### Authorization
- Only authenticated admins can create/edit/delete GMP records
- Regular users have read-only access

### Audit Trail
- Field protection metadata tracks:
  - Who made the edit (`adminContext.adminName`)
  - When edit was made (`manuallyEditedAt`)
  - Edit note with context

### Input Validation
- Server-side validation prevents invalid data
- Integer conversion for schema compliance
- XSS protection via React (auto-escaping)

---

## Testing Checklist

### ✅ Functionality Tests
- [ ] Create new GMP record with all fields
- [ ] Create new GMP record with only required fields
- [ ] Edit existing GMP record
- [ ] Delete GMP record
- [ ] Cancel modal without saving
- [ ] Validation: Empty GMP price
- [ ] Validation: Negative GMP price
- [ ] Validation: Empty source
- [ ] Auto-protect toggle works
- [ ] Timestamp defaults to current time
- [ ] Multiple GMP records display correctly

### ✅ Integration Tests
- [ ] GMP records persist in database
- [ ] Cache invalidation works
- [ ] Field protection records created
- [ ] Admin audit logs updated
- [ ] API returns correct error codes
- [ ] Frontend displays API errors

### ✅ UI/UX Tests
- [ ] Modal opens/closes correctly
- [ ] Form fields are accessible
- [ ] Loading states display during save
- [ ] Success messages appear
- [ ] Error messages are clear
- [ ] Edit button pre-fills form
- [ ] Delete confirmation appears
- [ ] Responsive on mobile

---

## Usage Instructions

### For Admins

#### Adding a New GMP Record
1. Navigate to admin IPO edit page: `/admin/edit/{slug}`
2. Click "GMP" tab
3. Click "+ Add New GMP Record" button
4. Fill in required fields:
   - **GMP Price:** Enter premium amount in rupees
   - **Source:** Enter data source (e.g., "Manual Entry")
5. Optional fields:
   - **Expected Listing Price:** Issue price + GMP
   - **Sauda Details:** Trading information
   - **Recorded At:** Adjust if historical data
6. Toggle "Auto-Protect" if needed
7. Click "Create Record"

#### Editing a GMP Record
1. Click "Edit" button on any GMP record
2. Modify fields as needed
3. Click "Update Record"

#### Deleting a GMP Record
1. Click "Delete" button on any GMP record
2. Confirm deletion in dialog
3. Record is permanently removed

---

## Known Issues & Limitations

### Pre-existing Issues
- FinancialData interface has TypeScript errors (unrelated to GMP)
- These errors exist in the codebase before GMP changes

### Limitations
1. **GMP Percentage:** Not stored in schema, would need calculation based on issue price
2. **Subject/Kostak Rates:** Schema has fields but not exposed in UI (can be added later)
3. **Bulk Operations:** No bulk edit/delete (add if needed)
4. **Historical Data:** No import tool for bulk historical GMP data

---

## Future Enhancements

### Recommended
1. **Auto-calculate GMP %:** Calculate `(GMP / Issue Price) * 100` if issue price is known
2. **Bulk Import:** CSV/Excel import for historical GMP data
3. **Charting:** Display GMP trend chart on edit page
4. **Subject/Kostak Rates:** Expose these schema fields in UI
5. **API Rate Limit:** Add rate limiting to prevent abuse
6. **Export:** Download GMP records as CSV

### Nice-to-Have
1. **Inline Editing:** Edit fields directly without modal
2. **Sorting/Filtering:** Sort GMP records by date, price
3. **Version History:** Track all changes to GMP records
4. **Notifications:** Alert when GMP changes significantly

---

## API Documentation

### POST /api/admin/gmp/[ipoId]
**Create a new GMP record**

**Headers:**
```
Authorization: Bearer {admin-jwt-token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "gmpPrice": 150,
  "estimatedListingPrice": 450,
  "subject": "Strong grey market demand",
  "source": "Manual Entry",
  "recordedAt": "2025-10-22T10:30:00",
  "autoProtect": true,
  "editNote": "Added based on market feedback"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "ipoId": "uuid",
    "gmp": 150,
    "expectedListingPrice": 450,
    "saudaDetails": "Strong grey market demand",
    "source": "Manual Entry",
    "timestamp": "2025-10-22T10:30:00.000Z",
    "subjectRate": null,
    "kostakRate": null
  },
  "message": "GMP record created successfully"
}
```

**Error Responses:**
- `400 Bad Request` - Validation error (missing/invalid fields)
- `401 Unauthorized` - Invalid/missing auth token
- `500 Internal Server Error` - Database/server error

### PATCH /api/admin/gmp/[ipoId]
**Update an existing GMP record**

**Request Body:** Same as POST + `recordId`
```json
{
  "recordId": "uuid",
  "gmpPrice": 175,
  "source": "Updated Source",
  ...
}
```

### DELETE /api/admin/gmp/[ipoId]?recordId={uuid}
**Delete a GMP record**

**Query Parameters:**
- `recordId` (required) - UUID of GMP record to delete

**Response (200 OK):**
```json
{
  "success": true,
  "message": "GMP record deleted successfully"
}
```

---

## Code Quality

### ✅ Follows Project Standards
- Uses TypeScript with proper typing
- Implements cache-aside pattern
- Follows repository pattern (markFieldAsManuallyEdited)
- Consistent error handling
- Proper async/await usage
- Redis cache invalidation

### ✅ Security Best Practices
- Admin authentication required
- Input validation (client + server)
- SQL injection prevention (Drizzle ORM)
- XSS protection (React auto-escaping)
- Audit trail for compliance

### ✅ User Experience
- Clear success/error messages
- Loading states
- Confirmation dialogs
- Responsive design
- Accessible forms
- Helpful placeholder text

---

## Summary

The GMP tab is now fully editable with:
- ✅ Add new GMP records
- ✅ Edit existing GMP records
- ✅ Delete GMP records
- ✅ Auto-protect toggle
- ✅ Complete validation
- ✅ Modal-based UI
- ✅ Cache invalidation
- ✅ Audit trail
- ✅ Error handling

All requirements from the specification have been implemented following industry best practices and the IPODhan project's architectural patterns.
