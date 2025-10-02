# Manual Override API Endpoint Specification

## Overview
This endpoint allows authorized administrators to manually override IPO data when automated scraping produces incorrect results or when urgent corrections are needed.

## Endpoint Details

### Base URL
```
POST /api/v1/admin/ipo/override
```

### Authentication
- Requires admin JWT token
- Role: `ADMIN` or `SUPER_ADMIN`
- Header: `Authorization: Bearer <token>`

### Request Body

```typescript
{
  "ipo_id": string,  // UUID of existing IPO record
  "override_data": {
    // Any of the following fields can be overridden
    "company_name"?: string,
    "symbol"?: string,
    "price_band_low"?: number,
    "price_band_high"?: number,
    "lot_size"?: number,
    "open_date"?: string,  // ISO format
    "close_date"?: string,  // ISO format
    "listing_date"?: string,  // ISO format
    "status"?: "UPCOMING" | "LIVE" | "CLOSED" | "LISTED",
    "category"?: "MAINBOARD" | "SME",
    "issue_size"?: number,
    "isin"?: string,
    "registrar"?: string
  },
  "reason": string,  // Mandatory reason for override
  "override_source": string  // e.g., "SEBI_OFFICIAL", "NSE_CORRECTION"
}
```

### Response

#### Success (200 OK)
```json
{
  "success": true,
  "message": "IPO data overridden successfully",
  "ipo_id": "550e8400-e29b-41d4-a716-446655440000",
  "updated_fields": ["price_band_low", "price_band_high"],
  "override_timestamp": "2025-10-02T10:30:00Z",
  "admin_user": "admin@ipodhan.com"
}
```

#### Error (400 Bad Request)
```json
{
  "success": false,
  "error": "VALIDATION_ERROR",
  "message": "Invalid price band: high must be greater than low",
  "details": {
    "field": "price_band_high",
    "value": 95,
    "constraint": "Must be greater than price_band_low (100)"
  }
}
```

#### Error (404 Not Found)
```json
{
  "success": false,
  "error": "IPO_NOT_FOUND",
  "message": "IPO with ID 550e8400... not found"
}
```

#### Error (403 Forbidden)
```json
{
  "success": false,
  "error": "INSUFFICIENT_PERMISSIONS",
  "message": "Admin role required for manual overrides"
}
```

## Implementation Requirements

### Backend Service Location
- **File**: `ipodhan-backend/src/controllers/admin/IPOOverrideController.ts`
- **Route**: `ipodhan-backend/src/routes/admin.routes.ts`

### Middleware Stack
1. `authenticate()` - Verify JWT token
2. `authorize(['ADMIN', 'SUPER_ADMIN'])` - Check role
3. `validateRequest(IPOOverrideSchema)` - Validate payload
4. Controller handler

### Database Operations

#### 1. Validate Override Data
```typescript
// Use existing IPODataValidator from data pipeline
const validator = new IPODataValidator();
const validationResult = validator.validate_ipo_data(override_data);

if (!validationResult.is_valid) {
  throw new ValidationError(validationResult.errors);
}
```

#### 2. Update IPO Record
```sql
UPDATE ipos
SET
  company_name = COALESCE($1, company_name),
  price_band_low = COALESCE($2, price_band_low),
  price_band_high = COALESCE($3, price_band_high),
  -- ... other fields
  updated_at = NOW()
WHERE id = $11
RETURNING *;
```

#### 3. Log Override Action
```sql
INSERT INTO admin_audit_log (
  id, admin_user_id, action, resource_type, resource_id,
  changes, reason, ip_address, created_at
) VALUES (
  gen_random_uuid(), $1, 'MANUAL_OVERRIDE', 'IPO', $2,
  $3, $4, $5, NOW()
);
```

### Audit Log Schema

```sql
CREATE TABLE admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES users(id),
  action VARCHAR(50) NOT NULL,  -- 'MANUAL_OVERRIDE', 'DATA_CORRECTION', etc.
  resource_type VARCHAR(50) NOT NULL,  -- 'IPO', 'GMP', etc.
  resource_id UUID NOT NULL,
  changes JSONB NOT NULL,  -- { "field": { "old": value, "new": value } }
  reason TEXT NOT NULL,
  override_source VARCHAR(100),
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_admin ON admin_audit_log(admin_user_id, created_at DESC);
CREATE INDEX idx_audit_log_resource ON admin_audit_log(resource_type, resource_id);
```

## Security Considerations

### Rate Limiting
- Max 10 override requests per admin per hour
- Implements exponential backoff for repeated failures

### Data Validation
- All override data must pass same validation as scraped data
- Date logic validation (open < close < listing)
- Price band validation (low < high)
- ISIN format validation

### Notification
- Send notification to admin team on every override
- Include: IPO name, fields changed, admin user, reason
- Email template: `templates/admin-override-notification.html`

## Testing

### Unit Tests
```typescript
// ipodhan-backend/tests/controllers/IPOOverrideController.test.ts

describe('IPOOverrideController', () => {
  it('should successfully override IPO data with valid admin token', async () => {
    // Test implementation
  });

  it('should reject override with invalid price band', async () => {
    // Test validation
  });

  it('should log override action to audit log', async () => {
    // Test audit logging
  });

  it('should reject override from non-admin user', async () => {
    // Test authorization
  });
});
```

### Integration Test
```bash
curl -X POST http://localhost:4000/api/v1/admin/ipo/override \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "ipo_id": "550e8400-e29b-41d4-a716-446655440000",
    "override_data": {
      "price_band_low": 105,
      "price_band_high": 115
    },
    "reason": "Official price revision from SEBI circular",
    "override_source": "SEBI_CIRCULAR_2025_10_01"
  }'
```

## Monitoring

### Metrics to Track
- Total overrides per day/week
- Most frequently overridden fields
- Average time between scrape and override
- Override success/failure rate

### Alerts
- Alert if >5 overrides in 1 hour (potential systemic scraping issue)
- Alert if same IPO overridden >3 times
- Daily summary report of all overrides

## Related Documentation
- Data Pipeline Validation: `ipodhan-data-pipeline/validators/ipo_validator.py`
- Database Schema: `infrastructure/database/migrations/002_enhanced_ipo_schema.sql`
- Admin Authentication: `ipodhan-backend/src/middleware/auth.ts`

## Status
**Status**: Specification Complete - Awaiting Backend Implementation
**Priority**: Medium
**Estimated Effort**: 4-6 hours
**Dependencies**:
- Admin user roles in `users` table
- JWT authentication middleware
- Audit log table creation

## Implementation Checklist
- [ ] Create `admin_audit_log` table migration
- [ ] Implement `IPOOverrideController.ts`
- [ ] Add route to `admin.routes.ts`
- [ ] Implement request validation schema
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Add rate limiting middleware
- [ ] Create email notification template
- [ ] Update API documentation
- [ ] Add monitoring dashboard widget
