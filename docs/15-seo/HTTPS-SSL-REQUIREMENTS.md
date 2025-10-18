# HTTPS & SSL Requirements for IPODhan

**Story:** 8.2 - SEO Optimization (Documentation Only)
**Implementation Story:** 8.4 - Cloudflare & Analytics Setup
**Created:** 2025-10-16
**Status:** Requirements Documented

---

## Overview

This document defines the HTTPS and SSL requirements for the IPODhan platform. **Note:** This document only specifies requirements. Actual SSL implementation and validation will occur in **Story 8.4 (Cloudflare & Analytics Setup)**.

---

## SSL Certificate Requirements

### 1. Certificate Type

**Requirement:** TLS 1.3 or TLS 1.2 (minimum)

**Why:**
- TLS 1.3 offers improved security and performance
- TLS 1.2 is the minimum acceptable for modern browsers
- Older protocols (TLS 1.0, TLS 1.1, SSL 2.0, SSL 3.0) are deprecated and insecure

**Target Configuration:**
- Protocol: TLS 1.3 (preferred) or TLS 1.2 (fallback)
- Certificate Authority: Let's Encrypt, Cloudflare, or trusted CA
- Certificate Validity: Valid certificate with no warnings
- Wildcard Certificate: Optional (if subdomains are used)

### 2. SSL Labs Rating

**Target:** A+ rating from SSL Labs

**URL:** https://www.ssllabs.com/ssltest/

**Requirements for A+ Rating:**
- Strong cipher suites (no weak ciphers)
- Perfect Forward Secrecy (PFS) enabled
- HSTS (HTTP Strict Transport Security) enabled
- No protocol vulnerabilities (Heartbleed, POODLE, etc.)
- Certificate chain complete and trusted
- No mixed content warnings

### 3. Certificate Details

**Common Name (CN):** ipodhan.com
**Subject Alternative Names (SANs):**
- ipodhan.com
- www.ipodhan.com
- (Any additional subdomains as needed)

**Key Size:** 2048-bit RSA or 256-bit ECC (minimum)
**Signature Algorithm:** SHA-256 or better
**Validity Period:** 90 days (Let's Encrypt) or longer (commercial CA)

---

## HTTPS Configuration Requirements

### 1. HTTP to HTTPS Redirect

**Requirement:** All HTTP requests must redirect to HTTPS (301 Permanent Redirect)

**Examples:**
```
http://ipodhan.com → https://ipodhan.com (301)
http://www.ipodhan.com → https://www.ipodhan.com (301)
```

**Implementation (Cloudflare):**
- Page Rules: "Always Use HTTPS"
- Or Origin Server: Nginx/Apache redirect configuration

### 2. HSTS (HTTP Strict Transport Security)

**Requirement:** HSTS header must be enabled

**Header:**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**Parameters:**
- `max-age=31536000`: 1 year (31,536,000 seconds)
- `includeSubDomains`: Apply to all subdomains
- `preload`: Eligible for browser HSTS preload list

**Implementation:**
- Cloudflare: Enable HSTS in SSL/TLS settings
- Or Web Server: Add header in Nginx/Apache configuration

**HSTS Preload List Submission:**
- After 6 months of stable HSTS operation
- Submit to https://hstspreload.org/
- Benefits: Browser-level HTTPS enforcement before first request

### 3. Mixed Content Prevention

**Requirement:** No mixed content (HTTP resources on HTTPS pages)

**What to Check:**
- All images loaded via HTTPS
- All stylesheets loaded via HTTPS
- All scripts loaded via HTTPS
- All API calls use HTTPS
- All external resources (fonts, CDNs) use HTTPS

**Implementation:**
- Use relative URLs (`/image.jpg` instead of `http://...`)
- Use protocol-relative URLs (`//cdn.example.com/...`) - not recommended
- Use HTTPS URLs for all external resources (preferred)
- Content Security Policy (CSP) to block mixed content

**Next.js Consideration:**
- `next/image` automatically handles protocol
- Ensure `NEXT_PUBLIC_BASE_URL` uses HTTPS

---

## Cloudflare Configuration (Story 8.4)

### 1. SSL/TLS Mode

**Recommended:** Full (strict) mode

**Options:**
- **Off:** Not secure (❌ Do not use)
- **Flexible:** Cloudflare to user (HTTPS), Cloudflare to origin (HTTP) - ⚠️ Acceptable only if origin doesn't support HTTPS
- **Full:** Cloudflare to user (HTTPS), Cloudflare to origin (HTTPS, self-signed OK)
- **Full (strict):** Cloudflare to user (HTTPS), Cloudflare to origin (HTTPS, valid certificate) - ✅ **Recommended**

**Why Full (strict):**
- End-to-end encryption
- No vulnerability between Cloudflare and origin server
- Best security posture

### 2. Minimum TLS Version

**Requirement:** TLS 1.2 or higher

**Configuration:**
- Navigate to SSL/TLS → Edge Certificates
- Set Minimum TLS Version: TLS 1.2
- Recommended: TLS 1.3 if all users support it

### 3. Automatic HTTPS Rewrites

**Requirement:** Enabled

**Feature:** Automatically rewrites HTTP URLs to HTTPS in HTML
**Benefits:** Prevents mixed content warnings

**Configuration:**
- SSL/TLS → Edge Certificates → Automatic HTTPS Rewrites: **ON**

### 4. Always Use HTTPS

**Requirement:** Enabled

**Feature:** Redirects all HTTP requests to HTTPS (301 redirect)

**Configuration:**
- SSL/TLS → Edge Certificates → Always Use HTTPS: **ON**

### 5. Opportunistic Encryption

**Requirement:** Enabled

**Feature:** Allows browsers to use HTTPS for HTTP requests via Alt-Svc header

**Configuration:**
- Network → Opportunistic Encryption: **ON**

---

## Security Headers

### 1. Strict-Transport-Security

**Header:**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**Purpose:** Force HTTPS for 1 year, including subdomains

### 2. Content-Security-Policy (Recommended)

**Basic Policy:**
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://www.google-analytics.com; frame-ancestors 'none';
```

**Purpose:** Restrict resource loading to trusted sources

**Note:** Adjust policy based on actual resource needs (Google Analytics, Cloudflare, etc.)

### 3. X-Content-Type-Options

**Header:**
```
X-Content-Type-Options: nosniff
```

**Purpose:** Prevent MIME type sniffing

### 4. X-Frame-Options

**Header:**
```
X-Frame-Options: DENY
```

**Purpose:** Prevent clickjacking attacks

### 5. Referrer-Policy

**Header:**
```
Referrer-Policy: strict-origin-when-cross-origin
```

**Purpose:** Control referrer information sent to other sites

---

## Testing & Validation (Story 8.4)

### Pre-Deployment Checklist

- [ ] SSL certificate installed and valid
- [ ] Certificate chain complete (no intermediate certificates missing)
- [ ] Certificate covers all required domains (ipodhan.com, www.ipodhan.com)
- [ ] TLS 1.2 or 1.3 enabled
- [ ] Weak ciphers disabled
- [ ] HTTP to HTTPS redirect configured (301)
- [ ] HSTS header enabled
- [ ] Mixed content check passed (no HTTP resources on HTTPS pages)
- [ ] Security headers configured (see above)

### Testing Tools

**1. SSL Labs Test**
- URL: https://www.ssllabs.com/ssltest/analyze.html?d=ipodhan.com
- Target Grade: A or A+
- Check: Protocol support, cipher suites, vulnerabilities

**2. Security Headers Check**
- URL: https://securityheaders.com/?q=https://ipodhan.com
- Target Grade: A or A+
- Check: HSTS, CSP, X-Content-Type-Options, etc.

**3. Why No Padlock (Mixed Content Checker)**
- URL: https://www.whynopadlock.com/results.html?uri=https://ipodhan.com
- Check: No mixed content warnings

**4. SSL Certificate Checker**
- URL: https://www.sslshopper.com/ssl-checker.html#hostname=ipodhan.com
- Check: Certificate validity, chain completion, trust

**5. Mozilla Observatory**
- URL: https://observatory.mozilla.org/analyze/ipodhan.com
- Target Grade: A or A+
- Check: Security headers, TLS configuration

### Manual Verification

**1. Browser Address Bar**
- Visit https://ipodhan.com
- Verify padlock icon appears
- Click padlock → Certificate details
- Verify: Valid, trusted, covers domain

**2. Developer Tools (F12)**
- Console tab: Check for mixed content warnings
- Network tab: Verify all resources loaded via HTTPS
- Security tab: Check TLS version and cipher suite

**3. HTTP Redirect Test**
- Visit http://ipodhan.com (without HTTPS)
- Verify: Redirects to https://ipodhan.com (301)
- Check redirect chain (should be 1 redirect, not multiple)

**4. Subdomain Test (if applicable)**
- Visit https://www.ipodhan.com
- Verify: Valid certificate, no warnings

---

## Monitoring & Maintenance (Post-Deployment)

### Certificate Expiration Monitoring

**Requirement:** Monitor certificate expiration and renew before expiry

**Tools:**
- Cloudflare auto-renewal (if using Cloudflare SSL)
- Let's Encrypt Certbot auto-renewal (if using Let's Encrypt)
- SSL monitoring service (e.g., SSL Labs, Uptime Robot)

**Alert Threshold:** 30 days before expiration

**Renewal Process:**
- Let's Encrypt: Auto-renewal via Certbot (every 90 days)
- Cloudflare: Auto-renewal (no action needed)
- Commercial CA: Manual renewal process

### Security Updates

**Regular Tasks:**
- [ ] Monitor TLS vulnerability announcements (Heartbleed, POODLE, etc.)
- [ ] Update server configuration if new vulnerabilities discovered
- [ ] Disable weak ciphers as they become insecure
- [ ] Test SSL Labs rating quarterly
- [ ] Review and update security headers annually

### Incident Response

**If Certificate Expires:**
1. Renew certificate immediately
2. Install new certificate
3. Test with SSL Labs
4. Monitor browser warnings
5. Document incident and prevent recurrence

**If Mixed Content Detected:**
1. Identify HTTP resources (browser console)
2. Update to HTTPS URLs
3. Deploy fix
4. Verify with browser tools
5. Clear CDN cache if applicable

---

## Common Issues & Solutions

### Issue 1: Certificate Not Trusted

**Symptoms:**
- Browser shows "Not Secure" warning
- SSL Labs reports "Chain issues"

**Causes:**
- Missing intermediate certificates
- Self-signed certificate in production
- Expired certificate

**Solutions:**
- Install complete certificate chain
- Use trusted CA (Let's Encrypt, Cloudflare, commercial)
- Renew expired certificate

### Issue 2: Mixed Content Warnings

**Symptoms:**
- Padlock icon with warning
- Console errors: "Mixed Content"
- SSL Labs reports "Content partially encrypted"

**Causes:**
- HTTP images, scripts, or stylesheets on HTTPS page
- Hardcoded HTTP URLs in code

**Solutions:**
- Use relative URLs or HTTPS URLs
- Enable "Automatic HTTPS Rewrites" in Cloudflare
- Update `NEXT_PUBLIC_BASE_URL` to HTTPS

### Issue 3: Redirect Loop

**Symptoms:**
- Page doesn't load
- "Too many redirects" error

**Causes:**
- Conflicting redirect rules (origin server + Cloudflare)
- Cloudflare SSL mode set to "Flexible" with origin redirect

**Solutions:**
- Use Cloudflare "Full" or "Full (strict)" SSL mode
- Remove origin server HTTPS redirect (let Cloudflare handle it)
- Or disable Cloudflare "Always Use HTTPS" if origin handles redirect

### Issue 4: Slow HTTPS Performance

**Symptoms:**
- Page loads slower on HTTPS than HTTP
- High latency in network tab

**Causes:**
- TLS handshake overhead
- Lack of HTTP/2 or HTTP/3
- No session resumption

**Solutions:**
- Enable HTTP/2 or HTTP/3 in Cloudflare
- Enable TLS session resumption
- Use OCSP stapling
- Consider using Cloudflare Argo for faster routing

---

## Production Deployment Checklist (Story 8.4)

### Pre-Deployment

- [ ] SSL certificate procured and validated
- [ ] Certificate installed on origin server (if not using Cloudflare Origin CA)
- [ ] Cloudflare account created and domain added
- [ ] DNS records pointing to Cloudflare
- [ ] Cloudflare SSL/TLS mode set to "Full (strict)"
- [ ] Cloudflare "Always Use HTTPS" enabled
- [ ] Cloudflare "Automatic HTTPS Rewrites" enabled
- [ ] HSTS header configured (max-age=31536000; includeSubDomains)
- [ ] Security headers configured (CSP, X-Content-Type-Options, etc.)
- [ ] Application code updated to use HTTPS URLs
- [ ] Environment variables set to HTTPS (NEXT_PUBLIC_BASE_URL)
- [ ] Testing completed (SSL Labs, Security Headers, mixed content check)

### Deployment

- [ ] Deploy application to production server
- [ ] Verify HTTPS works (https://ipodhan.com)
- [ ] Verify HTTP redirects to HTTPS
- [ ] Test all major pages (homepage, IPO detail, dashboard, tools)
- [ ] Test on multiple browsers (Chrome, Firefox, Safari, Edge)
- [ ] Test on mobile devices (iOS, Android)
- [ ] Run SSL Labs test (target: A or A+)
- [ ] Run Security Headers test (target: A or A+)
- [ ] Check for mixed content warnings
- [ ] Monitor error logs for SSL-related issues

### Post-Deployment

- [ ] Submit sitemap to Google Search Console (HTTPS URLs)
- [ ] Update Google Analytics property (use HTTPS)
- [ ] Update social media links (use HTTPS)
- [ ] Set up certificate expiration monitoring
- [ ] Schedule quarterly SSL review
- [ ] Document SSL configuration for team

---

## Next Steps (Story 8.4 Implementation)

1. **Cloudflare Account Setup**
   - Create Cloudflare account
   - Add ipodhan.com to Cloudflare
   - Update nameservers

2. **SSL Certificate Configuration**
   - Choose SSL mode: Full (strict)
   - Enable Always Use HTTPS
   - Enable Automatic HTTPS Rewrites
   - Configure HSTS

3. **Security Headers Configuration**
   - Add security headers via Cloudflare Page Rules or origin server
   - Test with securityheaders.com

4. **Testing & Validation**
   - Run all tests listed in "Testing & Validation" section
   - Fix any issues found
   - Achieve A+ rating on SSL Labs and Security Headers

5. **Monitoring Setup**
   - Configure certificate expiration alerts
   - Set up uptime monitoring
   - Monitor SSL Labs rating quarterly

---

## References

### Official Documentation

- **Cloudflare SSL/TLS:** https://developers.cloudflare.com/ssl/
- **Let's Encrypt:** https://letsencrypt.org/docs/
- **HSTS Preload:** https://hstspreload.org/
- **Mozilla SSL Configuration Generator:** https://ssl-config.mozilla.org/

### Testing Tools

- **SSL Labs:** https://www.ssllabs.com/ssltest/
- **Security Headers:** https://securityheaders.com/
- **Why No Padlock:** https://www.whynopadlock.com/
- **Mozilla Observatory:** https://observatory.mozilla.org/

### Security Best Practices

- **OWASP TLS Cheat Sheet:** https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html
- **Mozilla Web Security Guidelines:** https://infosec.mozilla.org/guidelines/web_security

---

**Note:** This document defines requirements only. Implementation and validation will occur in **Story 8.4 - Cloudflare & Analytics Setup**.

**Last Updated:** 2025-10-16
**Status:** Requirements Documented ✅
