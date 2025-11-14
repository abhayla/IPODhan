# Security Patterns Expert

**Purpose:** Expertise in security best practices, authentication patterns, XSS prevention, SQL injection prevention, and environment variable security for IPODhan.

**When to invoke:** Implementing authentication, securing API endpoints, handling sensitive data, or preventing common vulnerabilities.

---

## SQL Injection Prevention

### Using Drizzle ORM (Safe by Default)

```typescript
// ✅ SAFE - Parameterized query
const ipos = await db
  .select()
  .from(ipos)
  .where(eq(ipos.slug, userInput));

// ❌ UNSAFE - Raw SQL with concatenation
const ipos = await db.execute(
  sql`SELECT * FROM ipos WHERE slug = '${userInput}'`
);

// ✅ SAFE - Raw SQL with parameters
const ipos = await db.execute(
  sql`SELECT * FROM ipos WHERE slug = ${userInput}`
);
```

**Key:** Drizzle automatically parameterizes queries. Never concatenate user input into SQL strings.

---

## XSS Prevention

### React Automatic Escaping

```typescript
// ✅ SAFE - React escapes automatically
<div>{ipoName}</div>

// ❌ UNSAFE - dangerouslySetInnerHTML
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// ✅ SAFE - Sanitize first
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{
  __html: DOMPurify.sanitize(userInput)
}} />
```

### Content Security Policy

```typescript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline';",
          },
        ],
      },
    ];
  },
};
```

---

## CSRF Protection

### Next.js Server Actions (Built-in)

```typescript
// Server Actions have built-in CSRF protection
'use server';

export async function createIPO(formData: FormData) {
  // No manual CSRF token needed
  const validated = validateData(formData);
  return await db.insert(ipos).values(validated);
}
```

### API Routes (Manual Token)

```typescript
// Generate token
import { randomBytes } from 'crypto';
const csrfToken = randomBytes(32).toString('hex');

// Verify token
if (request.headers.get('X-CSRF-Token') !== expectedToken) {
  return new Response('Invalid CSRF token', { status: 403 });
}
```

---

## Environment Variable Security

### Secure Storage

```env
# ❌ NEVER commit to git
DATABASE_URL=postgresql://user:password@host/db
REDIS_PASSWORD=secret

# ✅ Use .env.local (gitignored)
# ✅ Use environment variables in production
```

### Access Patterns

```typescript
// ✅ Server-side only
const dbUrl = process.env.DATABASE_URL;

// ❌ Never expose to client
// NEXT_PUBLIC_ prefix = exposed to browser
const apiKey = process.env.NEXT_PUBLIC_API_KEY; // BAD!
```

---

## Authentication Patterns

### JWT Token Authentication

```typescript
import jwt from 'jsonwebtoken';

// Generate token
const token = jwt.sign(
  { userId: user.id, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: '7d' }
);

// Verify token
try {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  // Authenticated
} catch {
  // Invalid token
}
```

### Session-Based Authentication

```typescript
// Using iron-session
import { withIronSessionApiRoute } from 'iron-session/next';

export default withIronSessionApiRoute(
  async (req, res) => {
    if (req.session.userId) {
      // Authenticated
    }
  },
  {
    password: process.env.SESSION_SECRET,
    cookieName: 'ipodhan_session',
    cookieOptions: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
    },
  }
);
```

---

## Authorization Patterns

### Role-Based Access Control

```typescript
enum Role {
  ADMIN = 'ADMIN',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER',
}

function requireRole(allowedRoles: Role[]) {
  return async (req, res, next) => {
    const user = await getUserFromToken(req);

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  };
}

// Usage
app.post('/api/ipos', requireRole([Role.ADMIN, Role.EDITOR]), createIPO);
```

---

## Secure Headers

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  return response;
}
```

---

## Input Validation

### Always Validate

```typescript
// ✅ Validate all inputs
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

try {
  const validated = schema.parse(input);
} catch (error) {
  return { error: 'Invalid input' };
}
```

### Sanitize File Uploads

```typescript
import path from 'path';

function validateFileUpload(filename: string) {
  // Check extension
  const allowed = ['.pdf', '.jpg', '.png'];
  const ext = path.extname(filename).toLowerCase();

  if (!allowed.includes(ext)) {
    throw new Error('Invalid file type');
  }

  // Sanitize filename
  const safe = filename.replace(/[^a-z0-9.-]/gi, '_');
  return safe;
}
```

---

## Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later',
});

// Apply to all routes
app.use('/api/', limiter);
```

---

## Best Practices

1. **Never trust user input** - Always validate and sanitize
2. **Use parameterized queries** - Drizzle ORM does this automatically
3. **Keep secrets in environment variables** - Never commit to git
4. **Use HTTPS in production** - Enforce with middleware
5. **Implement rate limiting** - Prevent abuse
6. **Set security headers** - X-Frame-Options, CSP, etc.
7. **Hash passwords** - Use bcrypt or argon2
8. **Validate JWTs** - Check expiration and signature

---

## Common Vulnerabilities (OWASP Top 10)

1. **Injection** - ✅ Prevented by Drizzle ORM
2. **Broken Authentication** - Implement JWT/sessions properly
3. **Sensitive Data Exposure** - Use HTTPS, encrypt sensitive fields
4. **XML External Entities (XXE)** - Not applicable (no XML)
5. **Broken Access Control** - Implement RBAC
6. **Security Misconfiguration** - Set security headers
7. **XSS** - ✅ React escapes automatically
8. **Insecure Deserialization** - Validate all JSON inputs
9. **Using Components with Known Vulnerabilities** - Run `npm audit`
10. **Insufficient Logging** - Use Winston for security events

---

## References

- **OWASP Top 10:** https://owasp.org/www-project-top-ten/
- **Next.js Security:** https://nextjs.org/docs/app/building-your-application/configuring/security-headers
- **JWT Best Practices:** https://tools.ietf.org/html/rfc8725
