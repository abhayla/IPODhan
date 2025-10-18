# Error Handling Strategy

## Error Flow

All errors flow through the `withErrorHandler` middleware, which:
1. Catches exceptions
2. Logs to Pino with context
3. Reports to Sentry (if 5xx)
4. Returns standardized JSON error response

## Error Response Format

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "IPO not found",
    "details": {},
    "timestamp": "2025-01-05T10:30:00.000Z",
    "requestId": "req_abc123"
  }
}
```

## Frontend Error Handling

- `APIError` class for type-safe error handling
- Error boundaries for unhandled errors
- User-friendly error messages
- Retry logic for network errors

## Backend Error Handling

- `withErrorHandler` middleware wraps all routes
- Automatic Zod validation error formatting
- Sentry integration for production errors
- Request ID tracking for debugging

---
