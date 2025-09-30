# Security and Performance

## Security Requirements

**Frontend Security:**
- CSP Headers: `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline';`
- XSS Prevention: React's built-in escaping + DOMPurify for user content
- Secure Storage: HTTPOnly cookies for auth tokens, no localStorage for sensitive data

**Backend Security:**
- Input Validation: Joi schemas for all endpoints
- Rate Limiting: 100 requests per minute per IP (public), 1000 per API key (partners)
- CORS Policy: Whitelist specific origins for production

**Authentication Security:**
- Token Storage: Access token in memory, refresh token in HTTPOnly cookie
- Session Management: 15-minute access tokens, 7-day refresh tokens
- Password Policy: Minimum 8 characters, 1 uppercase, 1 number, 1 special character

## Performance Optimization

**Frontend Performance:**
- Bundle Size Target: <200KB initial JS
- Loading Strategy: Code splitting, lazy loading for routes
- Caching Strategy: ISR for IPO pages (5 minute revalidation), SWR for dynamic data

**Backend Performance:**
- Response Time Target: p95 < 200ms, p99 < 500ms
- Database Optimization: Connection pooling, read replicas, materialized views
- Caching Strategy: Redis with 1-minute TTL for scores, 5-minute for lists
