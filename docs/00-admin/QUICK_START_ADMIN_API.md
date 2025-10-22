# Quick Start: Admin API

This guide will help you quickly test the Manual Data Management System API.

---

## Setup (5 minutes)

### 1. Add Environment Variables

Add to `web/.env.local`:

```bash
# Enable admin panel
ADMIN_PANEL_ENABLED=true

# Generate and set admin token
ADMIN_AUTH_TOKEN=your-secure-token-here
```

**Generate secure token:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Start Development Server

```bash
cd web
npm run dev
```

---

## API Testing

### Get an IPO ID

First, get an IPO ID from your database:

```bash
curl http://localhost:3000/api/ipos/mainboard | jq '.data[0].id'
```

**Set variables:**
```bash
export IPO_ID="<your-ipo-id-here>"
export ADMIN_TOKEN="<your-admin-token-from-env>"
```

---

## Example Workflows

### Workflow 1: Lock an Entire IPO from Scraper Updates

**Step 1: Check current status**
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/admin/protection/ipo/$IPO_ID | jq
```

**Step 2: Enable IPO lock**
```bash
curl -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scraperLocked": true,
    "scraperLockNote": "Manually verified data - do not overwrite"
  }' \
  http://localhost:3000/api/admin/protection/ipo/$IPO_ID | jq
```

**Result:** ✅ All scraper updates to this IPO will now be blocked

**Step 3: Verify lock**
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/admin/protection/ipo/$IPO_ID | jq '.data.scraperLocked'
```

---

### Workflow 2: Protect Specific Fields

**Step 1: Protect lot_size field**
```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "ipos",
    "fieldName": "lotSize",
    "isProtected": true,
    "editNote": "Manually verified from NSE - correct value is 3000"
  }' \
  http://localhost:3000/api/admin/protection/fields/$IPO_ID | jq
```

**Step 2: Protect multiple fields at once**
```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ipoId": "'$IPO_ID'",
    "tableName": "ipos",
    "fieldNames": ["priceRangeMin", "priceRangeMax", "issueSize"],
    "isProtected": true
  }' \
  http://localhost:3000/api/admin/protection/fields/bulk | jq
```

**Step 3: View all protected fields**
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/admin/protection/fields/$IPO_ID | jq '.data.groupedByTable'
```

---

### Workflow 3: Monitor Blocked Scraper Updates

**View recent blocked updates:**
```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/admin/protection/notifications?limit=20 | jq
```

**Filter by stats:**
```bash
# Total blocked
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/admin/protection/notifications | jq '.data.stats.total'

# By reason
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/admin/protection/notifications | jq '.data.stats.byReason'

# By scraper
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/admin/protection/notifications | jq '.data.stats.byScraper'
```

---

### Workflow 4: Unlock and Remove Protections

**Unlock entire IPO:**
```bash
curl -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scraperLocked": false}' \
  http://localhost:3000/api/admin/protection/ipo/$IPO_ID | jq
```

**Unprotect specific field:**
```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "ipos",
    "fieldName": "lotSize",
    "isProtected": false
  }' \
  http://localhost:3000/api/admin/protection/fields/$IPO_ID | jq
```

**Delete field protection record:**
```bash
curl -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/admin/protection/fields/$IPO_ID?tableName=ipos&fieldName=lotSize" | jq
```

---

## Testing Authentication

**Test unauthorized access (should return 401):**
```bash
# No token
curl http://localhost:3000/api/admin/protection/ipo/$IPO_ID

# Invalid token
curl -H "Authorization: Bearer invalid-token" \
  http://localhost:3000/api/admin/protection/ipo/$IPO_ID
```

**Test with admin panel disabled:**
```bash
# Set in .env.local:
# ADMIN_PANEL_ENABLED=false

# Restart dev server
# All requests should return 401
```

---

## Common Scenarios

### Scenario 1: Fix Incorrect Lot Size

**Problem:** Scraper extracted lot_size = 1, but correct value is 3000

```bash
# 1. Protect the field
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "ipos", "fieldName": "lotSize", "isProtected": true}' \
  http://localhost:3000/api/admin/protection/fields/$IPO_ID

# 2. Manually update the lot_size via database or separate API
# (Field update API to be built in Phase 2)

# 3. Verify scraper cannot overwrite
# (Run scraper - update will be blocked and appear in notifications)
```

### Scenario 2: Lock High-Value IPO Data

**Problem:** Important IPO with manual corrections - prevent any scraper changes

```bash
# Lock entire IPO
curl -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scraperLocked": true, "scraperLockNote": "High-value IPO - manually verified"}' \
  http://localhost:3000/api/admin/protection/ipo/$IPO_ID

# All scraper updates blocked
# Check notifications to see blocked attempts
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/api/admin/protection/notifications | jq '.data.groupedByIPO["'$IPO_ID'"]'
```

### Scenario 3: Bulk Protection for Price Fields

**Problem:** Protect all price-related fields across IPO

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "ipoId": "'$IPO_ID'",
    "tableName": "ipos",
    "fieldNames": [
      "priceRangeMin",
      "priceRangeMax",
      "faceValue",
      "issueSize",
      "lotSize"
    ],
    "isProtected": true
  }' \
  http://localhost:3000/api/admin/protection/fields/bulk
```

---

## API Reference Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/protection/ipo/[ipoId]` | Get IPO lock status |
| PATCH | `/api/admin/protection/ipo/[ipoId]` | Toggle IPO lock |
| GET | `/api/admin/protection/fields/[ipoId]` | Get field protections |
| POST | `/api/admin/protection/fields/[ipoId]` | Create/update field protection |
| DELETE | `/api/admin/protection/fields/[ipoId]` | Delete field protection |
| POST | `/api/admin/protection/fields/bulk` | Bulk update protections |
| GET | `/api/admin/protection/notifications` | Get blocked updates |

**All endpoints require:**
- Header: `Authorization: Bearer <ADMIN_AUTH_TOKEN>`
- `ADMIN_PANEL_ENABLED=true` in environment

---

## Troubleshooting

### 401 Unauthorized

**Check:**
1. Is `ADMIN_PANEL_ENABLED=true` in `.env.local`?
2. Did you restart dev server after adding env vars?
3. Is `Authorization` header correct format? (`Bearer <token>`)
4. Does token match `ADMIN_AUTH_TOKEN` in `.env.local`?

### 500 Internal Server Error

**Check:**
1. Database migration applied? Run: `npx tsx web/scripts/apply-manual-data-management-migration.ts`
2. Redis running? (Optional - system works without Redis)
3. Check server logs: `npm run dev` output

### 404 Not Found

**Check:**
1. Is IPO ID valid? Query: `SELECT id FROM ipos LIMIT 5;`
2. Is URL path correct? (Check `/api/admin/protection/` prefix)

---

## Next Steps

After Phase 1 testing:
1. Integrate with scrapers (Phase 2)
2. Build admin UI dashboard (Phase 3)
3. Add audit logging (Phase 3)

For questions, see:
- `docs/00-admin/MANUAL_DATA_MANAGEMENT_PLAN.md` - Full implementation plan
- `docs/00-admin/PHASE_1_COMPLETION_REPORT.md` - Phase 1 details
