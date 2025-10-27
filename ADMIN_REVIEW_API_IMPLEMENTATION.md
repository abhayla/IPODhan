# Admin Review API Routes Implementation

## Story 11.16: Review Moderation API

**Status:** ✅ Completed
**Date:** 2025-10-27
**Files Created:** 2 API routes

---

## Files Created

### 1. `/web/app/api/admin/reviews/route.ts`

**Purpose:** List all pending reviews (isApproved = false)

**Endpoint:** `GET /api/admin/reviews`

**Authentication:** Bearer token required (`Authorization: Bearer <ADMIN_API_TOKEN>`)

**Response Format:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "ipoId": "uuid",
      "reviewTitle": "Strong IPO with Good Valuation",
      "author": "Motilal Oswal",
      "recommendation": "May apply",
      "reviewContent": "Review content...",
      "isApproved": false,
      "publishedDate": "2024-01-15T00:00:00.000Z",
      "moderatedBy": null,
      "moderatedAt": null,
      ...
    }
  ],
  "meta": {
    "count": 5,
    "timestamp": "2024-01-20T10:30:00.000Z"
  }
}
```

**Error Responses:**
- `401 Unauthorized` - Missing or invalid admin token
- `500 Internal Server Error` - Database or server error

**Features:**
- Admin authentication via `requireAdminAuth()`
- Redis fallback handling (continues without cache if Redis unavailable)
- Structured logging with Winston (request ID, duration, count)
- Uses `ReviewRepository.getPendingReviews()` method
- No caching (admin operations should always be fresh)

---

### 2. `/web/app/api/admin/reviews/[reviewId]/route.ts`

**Purpose:** Approve or reject a review

**Endpoint:** `PATCH /api/admin/reviews/[reviewId]`

**Authentication:** Bearer token required (`Authorization: Bearer <ADMIN_API_TOKEN>`)

**Request Body:**
```json
{
  "action": "approve" // or "reject"
}
```

**Response Format (Success):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "ipoId": "uuid",
    "reviewTitle": "Strong IPO with Good Valuation",
    "isApproved": true,
    "moderatedBy": "admin@ipodhan.com",
    "moderatedAt": "2024-01-20T10:35:00.000Z",
    ...
  },
  "meta": {
    "action": "approve",
    "moderatedBy": "admin@ipodhan.com",
    "moderatedAt": "2024-01-20T10:35:00.000Z",
    "timestamp": "2024-01-20T10:35:00.000Z"
  }
}
```

**Error Responses:**
- `400 Bad Request` - Invalid JSON or invalid action parameter
  ```json
  {
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Action must be \"approve\" or \"reject\"",
      "timestamp": "2024-01-20T10:35:00.000Z",
      "requestId": "req_1234567890_abc123"
    }
  }
  ```
- `401 Unauthorized` - Missing or invalid admin token
- `404 Not Found` - Review not found
  ```json
  {
    "error": {
      "code": "NOT_FOUND",
      "message": "Review not found",
      "details": { "reviewId": "uuid" },
      "timestamp": "2024-01-20T10:35:00.000Z",
      "requestId": "req_1234567890_abc123"
    }
  }
  ```
- `500 Internal Server Error` - Database or server error

**Features:**
- Admin authentication via `requireAdminAuth()`
- Zod schema validation for action parameter
- Redis fallback handling
- Structured logging with Winston
- Handles `EntityNotFoundError` specifically (404 response)
- Automatic cache invalidation via repository
- Uses `ReviewRepository.approveReview()` and `ReviewRepository.rejectReview()`
- Next.js 15 App Router compatibility (awaits params)

---

## Architecture Patterns Followed

### 1. Admin Authentication
```typescript
const authError = await requireAdminAuth();
if (authError) return authError;
```

Uses the existing `requireAdminAuth()` helper from `@/lib/auth/admin-auth`:
- Bearer token authentication
- Constant-time comparison (prevents timing attacks)
- Minimum 32-character token requirement
- Environment variable: `ADMIN_API_TOKEN`

### 2. Repository Pattern
```typescript
const db = await getDb();
const redis = getRedisClient();
const reviewRepository = new ReviewRepository(db, redis);

const pendingReviews = await reviewRepository.getPendingReviews();
```

- No direct database queries in API routes
- All data access through `ReviewRepository`
- Cache invalidation handled automatically by repository

### 3. Redis Fallback
```typescript
let redis;
try {
  redis = getRedisClient();
} catch {
  requestLogger.warn('Redis unavailable - continuing without cache');
  redis = {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 1,
    flushdb: async () => 'OK',
  } as any;
}
```

Application continues functioning even if Redis is down (graceful degradation).

### 4. Structured Logging
```typescript
const requestId = generateRequestId();
const requestLogger = logger.child({ requestId });

requestLogger.info({ duration, count }, 'Pending reviews fetched successfully');
```

- Winston structured logging
- Child logger with request ID for tracing
- Logs duration, counts, and context
- Error logging with stack traces

### 5. Standardized Error Responses
```typescript
function createErrorResponse(
  code: string,
  message: string,
  requestId: string,
  status: number,
  details?: unknown
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details,
        timestamp: new Date().toISOString(),
        requestId,
      },
    },
    { status }
  );
}
```

Consistent error response format across all admin API routes.

### 6. Zod Schema Validation
```typescript
const ReviewModerationSchema = z.object({
  action: z.enum(['approve', 'reject'], {
    message: 'Action must be "approve" or "reject"',
  }),
});

const validatedData = ReviewModerationSchema.parse(body);
```

Type-safe request body validation with custom error messages.

---

## Testing

### Manual Testing with cURL

#### 1. Get Pending Reviews
```bash
curl -X GET http://localhost:3000/api/admin/reviews \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

#### 2. Approve a Review
```bash
curl -X PATCH http://localhost:3000/api/admin/reviews/REVIEW_UUID \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "approve"}'
```

#### 3. Reject a Review
```bash
curl -X PATCH http://localhost:3000/api/admin/reviews/REVIEW_UUID \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "reject"}'
```

#### 4. Test Unauthorized Access
```bash
curl -X GET http://localhost:3000/api/admin/reviews
# Should return 401 Unauthorized
```

#### 5. Test Invalid Action
```bash
curl -X PATCH http://localhost:3000/api/admin/reviews/REVIEW_UUID \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "invalid"}'
# Should return 400 Bad Request
```

#### 6. Test Review Not Found
```bash
curl -X PATCH http://localhost:3000/api/admin/reviews/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "approve"}'
# Should return 404 Not Found
```

---

## Environment Setup

Add to `web/.env.local`:
```bash
# Admin Authentication
ADMIN_API_TOKEN=your_64_character_secure_token_here

# Generate token with:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Token requirements:
- Minimum 32 characters (64 hex chars recommended)
- Generated using cryptographically secure random bytes
- Never commit to version control

---

## Database Schema

**Table:** `ipo_reviews`

**Relevant Fields:**
- `id` (uuid, primary key)
- `ipo_id` (uuid, foreign key to ipos table)
- `review_title` (varchar)
- `author` (varchar)
- `recommendation` (enum: 'May apply', 'Subscribe', 'Avoid', 'Not Recommended')
- `review_content` (text)
- `is_approved` (boolean) - **Default: false**
- `moderated_by` (varchar, nullable)
- `moderated_at` (timestamp, nullable)
- `published_date` (timestamp)

**Key Constraints:**
- Reviews are NOT approved by default (`is_approved = false`)
- Only approved reviews (`is_approved = true`) appear in public API
- Admin can approve/reject multiple times (updates `moderated_by` and `moderated_at`)

---

## Cache Invalidation

When a review is approved/rejected, the repository automatically invalidates:
1. `review:summary:{ipoId}` - Review summary for the IPO
2. `review:list:{ipoId}:*` - All review list variants for the IPO

This ensures:
- Public API (`GET /api/ipos/[slug]/reviews`) immediately reflects changes
- Review summary statistics update in real-time
- No stale data served to users

---

## Integration with Existing Code

### ReviewRepository Methods Used

1. **`getPendingReviews(): Promise<IPOReview[]>`**
   - Returns all reviews where `is_approved = false`
   - Ordered by `published_date DESC`
   - No caching (admin operations)

2. **`approveReview(reviewId: string, adminUser: string): Promise<IPOReview>`**
   - Sets `is_approved = true`
   - Records `moderated_by` and `moderated_at`
   - Invalidates cache automatically
   - Throws `EntityNotFoundError` if review not found

3. **`rejectReview(reviewId: string, adminUser: string): Promise<IPOReview>`**
   - Sets `is_approved = false`
   - Records `moderated_by` and `moderated_at`
   - Invalidates cache automatically
   - Throws `EntityNotFoundError` if review not found

---

## Security Considerations

1. **Authentication:** Bearer token with constant-time comparison
2. **Authorization:** Admin-only routes (no public access)
3. **Input Validation:** Zod schema validation for all inputs
4. **Rate Limiting:** TODO - Add rate limiting middleware
5. **Audit Trail:** Logs all moderation actions with admin identity
6. **HTTPS Required:** Production must use HTTPS (token in Authorization header)

---

## Future Enhancements

1. **Multi-Admin Support:** Extract admin email from JWT instead of hardcoded
2. **Rate Limiting:** Add rate limiting to prevent abuse
3. **Batch Operations:** Approve/reject multiple reviews at once
4. **Audit Log UI:** Admin dashboard to view moderation history
5. **Email Notifications:** Notify review authors when approved/rejected
6. **Review Analytics:** Dashboard showing approval rates, moderation times, etc.

---

## Related Documentation

- **ReviewRepository:** `web/lib/repositories/review-repository.ts`
- **Admin Auth:** `web/lib/auth/admin-auth.ts`
- **Cache Strategy:** `docs/05-caching/CACHING_STRATEGY.md`
- **API Specification:** `docs/02-architecture/api-specification.md`
- **Story 11.16:** IPO Recommendations Summary Section (parent story)

---

## Code Quality Checklist

- ✅ TypeScript strict mode compliant
- ✅ Follows existing admin route patterns
- ✅ Uses repository pattern (no direct DB queries)
- ✅ Implements Redis fallback
- ✅ Structured logging with Winston
- ✅ Standardized error responses
- ✅ Zod schema validation
- ✅ Entity not found handling (404)
- ✅ Admin authentication required
- ✅ Cache invalidation automatic
- ✅ Next.js 15 App Router compatible
- ✅ Comprehensive JSDoc documentation

---

## Summary

Two admin API routes have been successfully implemented for review moderation:

1. **GET /api/admin/reviews** - List pending reviews
2. **PATCH /api/admin/reviews/[reviewId]** - Approve/reject reviews

Both routes:
- Require admin authentication
- Follow established architectural patterns
- Include comprehensive error handling
- Implement structured logging
- Support Redis fallback
- Are production-ready

These routes enable admins to moderate user-submitted IPO reviews before they appear publicly, ensuring content quality and preventing spam/abuse.
