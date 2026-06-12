---
name: api-design-expert
description: RESTful API design with response standardization, pagination, error handling, versioning, and endpoint conventions
---

# API Design Expert

**Purpose:** Expertise in RESTful API design, response standardization, pagination, error handling, and versioning for IPODhan.

**When to invoke:** Designing new API endpoints, standardizing responses, implementing pagination, or defining error codes.

---

## Standard Response Format

### Success Response

```typescript
return NextResponse.json({
  success: true,
  data: results,
  meta: {
    page: 1,
    limit: 20,
    total: 100,
    hasNext: true,
    hasPrev: false
  }
}, { status: 200 });
```

### Error Response

```typescript
return NextResponse.json({
  error: 'Error message',
  details: 'Additional context',
  code: 'IPO_NOT_FOUND'
}, { status: 404 });
```

---

## API Endpoint Patterns

### RESTful Routes

```
GET    /api/ipos              - List IPOs
GET    /api/ipos/:id          - Get IPO by ID
POST   /api/ipos              - Create IPO
PATCH  /api/ipos/:id          - Update IPO
DELETE /api/ipos/:id          - Delete IPO

GET    /api/ipos/:id/subscriptions - Nested resource
```

### Query Parameters

```typescript
// Filtering
GET /api/ipos?segment=MAINBOARD&status=OPEN

// Pagination
GET /api/ipos?page=1&limit=20

// Sorting
GET /api/ipos?sortBy=openDate&order=desc

// Search
GET /api/ipos?q=company+name
```

---

## Pagination

### Cursor-Based (Recommended)

```typescript
GET /api/ipos?cursor=uuid&limit=20

{
  success: true,
  data: [...],
  meta: {
    nextCursor: 'next-uuid',
    hasMore: true
  }
}
```

### Offset-Based (Simple)

```typescript
GET /api/ipos?page=2&limit=20

{
  success: true,
  data: [...],
  meta: {
    page: 2,
    limit: 20,
    total: 150,
    totalPages: 8
  }
}
```

---

## Error Codes

```typescript
enum ErrorCode {
  // Client errors (4xx)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  IPO_NOT_FOUND = 'IPO_NOT_FOUND',
  INVALID_QUERY = 'INVALID_QUERY',

  // Server errors (5xx)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
}
```

---

## API Versioning

### URL Versioning (Simple)

```
GET /api/v1/ipos
GET /api/v2/ipos
```

### Header Versioning (Advanced)

```
GET /api/ipos
Header: Accept: application/vnd.ipodhan.v1+json
```

---

## Rate Limiting

```typescript
// Configuration
const rateLimits = {
  anonymous: 100,  // 100 requests/hour
  authenticated: 1000, // 1000 requests/hour
};

// Headers
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1609459200
```

---

## Best Practices

1. Use standard HTTP status codes
2. Include `meta` for pagination
3. Use clear error codes
4. Version APIs for breaking changes
5. Document with OpenAPI/Swagger

---

## References

- **REST API Best Practices:** https://restfulapi.net/
- **HTTP Status Codes:** https://httpstatuses.com/
