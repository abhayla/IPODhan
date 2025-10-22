# Audit Log Integration Guide

**Created:** 2025-01-22
**Status:** Complete
**Version:** 1.0

## Overview

This guide explains how to integrate audit logging into admin API routes. All admin actions should be logged to the `audit_logs` table for compliance, security, and debugging.

## Quick Start

### 1. Import Helpers

```typescript
import { logAdminAction, logAdminError, AuditActionTypes } from '@/lib/admin/audit-helpers';
```

### 2. Log Success

```typescript
// After successful operation
logAdminAction(request, adminContext.adminName, AuditActionTypes.FIELD_UPDATED, {
  ipoId: '123',
  tableName: 'ipos',
  fieldName: 'lotSize',
  oldValue: '100',
  newValue: '3000',
  details: { note: 'Corrected lot size' }
});
```

### 3. Log Errors

```typescript
// In catch block
catch (error) {
  logAdminError(request, adminContext.adminName, AuditActionTypes.FIELD_UPDATED, error, {
    ipoId: '123',
    tableName: 'ipos',
    fieldName: 'lotSize',
  });
  // Return error response
}
```

## Available Action Types

From `@/lib/services/audit-log-service`:

- `AuditActionTypes.FIELD_UPDATED` - Field value changed
- `AuditActionTypes.IPO_LOCKED` - IPO locked from scraper updates
- `AuditActionTypes.IPO_UNLOCKED` - IPO unlocked
- `AuditActionTypes.PROTECTION_ENABLED` - Field protection enabled
- `AuditActionTypes.PROTECTION_DISABLED` - Field protection disabled
- `AuditActionTypes.BULK_PROTECTION` - Bulk protection operation
- `AuditActionTypes.CACHE_CLEARED` - Cache invalidated
- `AuditActionTypes.GMP_ADDED` - GMP record added
- `AuditActionTypes.GMP_UPDATED` - GMP record updated
- `AuditActionTypes.SUBSCRIPTION_UPDATED` - Subscription data updated
- `AuditActionTypes.LOGIN` - Admin login
- `AuditActionTypes.LOGOUT` - Admin logout
- `AuditActionTypes.SETTINGS_CHANGED` - System settings modified
- `AuditActionTypes.NOTIFICATION_SENT` - Notification dispatched

## Integration Examples

### Example 1: Field Update Route

```typescript
// POST /api/admin/update-field
import { logAdminAction, logAdminError, AuditActionTypes } from '@/lib/admin/audit-helpers';

export const PATCH = withAdminAuth(async (request, adminContext) => {
  let oldValue: any = null;
  let body: any = null;

  try {
    body = await request.json();
    const { ipoId, tableName, fieldName, value } = body;

    // Get old value before update
    const existing = await db.select().from(table).where(eq(table.id, ipoId)).limit(1);
    oldValue = existing[0]?.[fieldName];

    // Perform update
    await db.update(table).set({ [fieldName]: value }).where(eq(table.id, ipoId));

    // Log success
    logAdminAction(request, adminContext.adminName, AuditActionTypes.FIELD_UPDATED, {
      ipoId,
      tableName,
      fieldName,
      oldValue,
      newValue: value,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // Log failure
    logAdminError(request, adminContext.adminName, AuditActionTypes.FIELD_UPDATED, error, {
      ipoId: body?.ipoId,
      tableName: body?.tableName,
      fieldName: body?.fieldName,
      oldValue,
      newValue: body?.value,
    });

    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
});
```

### Example 2: IPO Lock/Unlock Route

```typescript
// PATCH /api/admin/protection/ipo/[ipoId]
import { logAdminAction, logAdminError, AuditActionTypes } from '@/lib/admin/audit-helpers';

export const PATCH = withAdminAuth(async (request, adminContext, { params }) => {
  let ipoId: string = '';
  let scraperLocked: boolean = false;

  try {
    ipoId = (await params).ipoId;
    const body = await request.json();
    scraperLocked = body.scraperLocked;

    // Update lock status
    await db.update(ipos).set({ scraperLocked }).where(eq(ipos.id, ipoId));

    // Log success
    logAdminAction(
      request,
      adminContext.adminName,
      scraperLocked ? AuditActionTypes.IPO_LOCKED : AuditActionTypes.IPO_UNLOCKED,
      {
        ipoId,
        details: { note: body.scraperLockNote },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    // Log failure
    logAdminError(
      request,
      adminContext.adminName,
      scraperLocked ? AuditActionTypes.IPO_LOCKED : AuditActionTypes.IPO_UNLOCKED,
      error,
      { ipoId }
    );

    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
});
```

### Example 3: Cache Clear Route

```typescript
// POST /api/admin/cache/clear
import { logAdminAction, AuditActionTypes } from '@/lib/admin/audit-helpers';

export const POST = withAdminAuth(async (request, adminContext) => {
  try {
    const body = await request.json();
    const { pattern } = body;

    // Clear cache
    await redis.del(pattern);

    // Log success (no IPO-specific action)
    logAdminAction(request, adminContext.adminName, AuditActionTypes.CACHE_CLEARED, {
      details: { pattern },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logAdminError(request, adminContext.adminName, AuditActionTypes.CACHE_CLEARED, error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
});
```

## Admin Routes Requiring Integration

**Total: 11 routes**

### ✅ Already Integrated

1. `POST /api/admin/update-field` - Field updates
2. `PATCH /api/admin/protection/ipo/[ipoId]` - IPO lock/unlock

### ⚠️ Pending Integration

3. `POST /api/admin/protection/fields/[ipoId]` - Enable field protection
4. `DELETE /api/admin/protection/fields/[ipoId]` - Disable field protection
5. `POST /api/admin/protection/fields/bulk` - Bulk protection
6. `POST /api/admin/cache/clear` - Cache invalidation
7. `POST /api/admin/gmp/[ipoId]` - Add GMP record
8. `PATCH /api/admin/gmp/[ipoId]` - Update GMP record
9. `POST /api/admin/ipos` - Create IPO
10. `PATCH /api/admin/ipos/[id]` - Update IPO
11. `DELETE /api/admin/ipos/[id]` - Delete IPO

## Best Practices

### 1. Always Log Both Success and Failure

```typescript
try {
  // Operation
  logAdminAction(...);
} catch (error) {
  logAdminError(...);
  throw error;
}
```

### 2. Capture Old Values for Field Updates

```typescript
// Get old value BEFORE update
const old = await db.select().from(table).where(eq(table.id, id)).limit(1);
const oldValue = old[0]?.[fieldName];

// Perform update
await db.update(table).set({ [fieldName]: newValue });

// Log with old/new values
logAdminAction(request, admin, action, { oldValue, newValue });
```

### 3. Include Contextual Details

```typescript
logAdminAction(request, admin, action, {
  ipoId,
  details: {
    note: 'Why this action was taken',
    affectedRecords: 5,
    priority: 'high',
  }
});
```

### 4. Avoid Blocking Operations

Audit logging is fire-and-forget (async). It won't block API responses.

### 5. Don't Log Sensitive Data

Avoid logging:
- Passwords
- API keys
- Personal identifiable information (beyond admin username)

## Viewing Audit Logs

### Admin Panel

Navigate to: **Admin Panel → Audit Log** (`/admin/audit`)

Features:
- Date range filtering
- Admin user filtering
- Action type filtering
- IPO search
- CSV export
- Pagination (50 records per page)

### API Endpoint

```bash
# Get audit logs
GET /api/admin/audit?startDate=2025-01-01&endDate=2025-01-31&adminUser=john

# Export CSV
GET /api/admin/audit/export?startDate=2025-01-01&endDate=2025-01-31
```

## Database Schema

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  admin_user VARCHAR(255) NOT NULL,
  action_type VARCHAR(100) NOT NULL,
  ipo_id UUID REFERENCES ipos(id),
  table_name VARCHAR(100),
  field_name VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  details JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL
);

-- Indexes for filtering
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_admin_user ON audit_logs(admin_user);
CREATE INDEX idx_audit_logs_ipo_id ON audit_logs(ipo_id);
CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX idx_audit_logs_timestamp_admin ON audit_logs(timestamp DESC, admin_user);
```

## Compliance & Data Retention

### Immutable Records

Audit logs are **immutable**:
- No UPDATE operations allowed
- No DELETE operations (except by DBA for retention policy)
- All records timestamped and preserved

### PII Anonymization

IP addresses are anonymized after 90 days:

```typescript
// Run daily via cron
import { anonymizeOldIPAddresses } from '@/lib/services/audit-log-service';

await anonymizeOldIPAddresses();
// Returns: number of records anonymized
```

### Retention Policy

- **Active logs**: 1 year (queryable in admin panel)
- **Archived logs**: 7 years (database backup only)
- **Deletion**: After 7 years or by legal requirement

## Troubleshooting

### Audit logs not appearing

1. Check database connection
2. Verify `audit_logs` table exists
3. Check console for `[Audit]` log messages
4. Ensure `logAdminAction` is called AFTER successful operation

### Performance concerns

Audit logging is non-blocking:
- Uses `setImmediate()` for async insertion
- Won't slow down API responses
- Target overhead: < 5ms per request

### Missing old values

Ensure old value is fetched BEFORE update:

```typescript
// ❌ Wrong - old value lost
await db.update(...).set({ field: newValue });
const old = await db.select(...); // Too late!

// ✅ Correct - old value captured
const old = await db.select(...);
await db.update(...).set({ field: newValue });
logAdminAction(..., { oldValue: old[0].field });
```

## Migration

Apply the audit_logs migration:

```bash
cd web
npm run db:migrate

# Or manually:
psql -h localhost -U postgres -d ipodhan -f drizzle/migrations/0020_add_audit_logs.sql
```

## Testing

```typescript
// Test audit logging
import { logAudit, getAuditLogs } from '@/lib/services/audit-log-service';

// Log test entry
await logAudit({
  adminUser: 'test-admin',
  actionType: 'Test Action',
  ipoId: 'test-ipo-id',
  success: true,
});

// Retrieve logs
const { logs } = await getAuditLogs({
  adminUser: 'test-admin',
  page: 1,
  limit: 10,
});

console.assert(logs.length > 0, 'Audit log should be created');
```

## Support

For questions or issues:
- Check console logs: `[Audit]` prefix
- Review schema: `packages/shared/src/db/schema.ts`
- Consult service: `web/lib/services/audit-log-service.ts`
- Integration helpers: `web/lib/admin/audit-helpers.ts`
