# SEO Implementation Guide

**Story:** 8.2 - SEO Optimization
**Last Updated:** 2025-10-16
**Status:** Complete

## Overview

This document provides comprehensive guidance on SEO implementation in the IPODhan platform. It covers metadata generation, structured data, sitemaps, technical SEO, and maintenance procedures.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Metadata Implementation](#metadata-implementation)
3. [Structured Data (JSON-LD)](#structured-data-json-ld)
4. [Sitemap & Robots.txt](#sitemap--robotstxt)
5. [Technical SEO](#technical-seo)
6. [Core Web Vitals](#core-web-vitals)
7. [How to Add SEO to New Pages](#how-to-add-seo-to-new-pages)
8. [Testing & Validation](#testing--validation)
9. [Maintenance & Monitoring](#maintenance--monitoring)

---

## Architecture Overview

### SEO Utility Locations

```
web/lib/seo/
├── metadata.ts           # Metadata generation functions
└── structured-data.ts    # JSON-LD schema generators

web/app/
├── layout.tsx           # Root layout with default metadata
├── sitemap.ts           # Dynamic sitemap generation
└── robots.txt           # Crawling directives
```

### Key Features

✅ **Centralized SEO Utilities:** All metadata and structured data generated from reusable functions
✅ **Dynamic Metadata:** IPO detail pages generate metadata from database data
✅ **Structured Data:** Organization, FinancialProduct, BreadcrumbList, ItemList schemas
✅ **Dynamic Sitemap:** Auto-updates with new IPOs
✅ **Canonical URLs:** Prevent duplicate content issues
✅ **Open Graph & Twitter Cards:** Social sharing optimization

---

## Metadata Implementation

### 1. Homepage Metadata

**File:** `web/app/layout.tsx`

```typescript
import { generateHomepageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = generateHomepageMetadata();
```

**Generated Metadata:**
- Title: "IPODhan - Live IPO Updates, Analysis & Application Tools"
- Description: "Track live IPO subscriptions, analyze financials, compare IPOs..."
- Keywords: IPO, India IPO, IPO subscription, GMP, NSE, BSE
- Open Graph: Full OG tags with image (1200x630px)
- Twitter Card: summary_large_image
- Canonical URL: https://ipodhan.com
- Robots: index, follow

### 2. IPO Detail Page Metadata (Dynamic)

**File:** `web/app/ipos/[slug]/page.tsx`

```typescript
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await apiClient.getIPOBySlug(slug);
  const { ipo } = data;

  const metadataParams = ipoToMetadataParams(ipo);
  return generateIPODetailMetadata(metadataParams);
}
```

**Dynamic Fields:**
- Title: "{Company Name} IPO - Live Subscription, GMP, Analysis | IPODhan"
- Description: Includes company name, open date, price range, and call-to-action
- OG Image: Default (can be customized per IPO)
- Canonical URL: https://ipodhan.com/ipos/{slug}

### 3. Tool Pages Metadata

**Lot Calculator:** `web/app/tools/lot-calculator/page.tsx`
```typescript
export const metadata: Metadata = generateLotCalculatorMetadata();
```

**Comparison Tool:** `web/app/tools/compare/layout.tsx`
```typescript
export const metadata: Metadata = generateComparisonToolMetadata();
```

**Registrars:** `web/app/registrars/layout.tsx`
```typescript
export const metadata: Metadata = generateRegistrarsMetadata();
```

**Market Holidays:** `web/app/market-holidays/layout.tsx`
```typescript
export const metadata: Metadata = generateMarketHolidaysMetadata();
```

### 4. Historical IPOs Metadata

**File:** `web/app/history/page.tsx`

```typescript
export const metadata: Metadata = {
  title: 'IPO History - Past IPO Performance | IPODhan',
  description: 'Research historical IPO performance in India...',
  // Full metadata object
};
```

---

## Structured Data (JSON-LD)

### 1. Organization Schema (Homepage)

**Location:** `web/app/page.tsx`

```typescript
import { generateOrganizationSchema, toJsonLdScript } from '@/lib/seo/structured-data';

const organizationSchema = generateOrganizationSchema();

// In component:
<Script
  id="organization-schema"
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: toJsonLdScript(organizationSchema),
  }}
/>
```

**Schema Type:** Organization
**Includes:** name, url, logo, description, sameAs (social links), contactPoint

### 2. FinancialProduct Schema (IPO Detail)

**Location:** `web/app/ipos/[slug]/page.tsx`

```typescript
const financialProductSchema = generateFinancialProductSchema(ipo);

<Script
  id="financial-product-schema"
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: toJsonLdScript(financialProductSchema),
  }}
/>
```

**Schema Type:** FinancialProduct
**Includes:** name, description, category, provider, offers (price, availability, dates)

### 3. BreadcrumbList Schema (Navigation)

**Location:** `web/app/ipos/[slug]/page.tsx`

```typescript
const breadcrumbItems = generateIPODetailBreadcrumbs(companyName, slug);
const breadcrumbSchema = generateBreadcrumbSchema(breadcrumbItems);

<Script
  id="breadcrumb-schema"
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: toJsonLdScript(breadcrumbSchema),
  }}
/>
```

**Schema Type:** BreadcrumbList
**Includes:** itemListElement with position, name, item (URL)

### 4. ItemList Schema (Listings)

**Location:** `web/app/page.tsx` (homepage), `web/app/dashboard/page.tsx`

```typescript
const ipoListingSchema = generateIPOListingSchema(allIPOs);

<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
/>
```

**Schema Type:** ItemList
**Includes:** numberOfItems, itemListElement with IPOs as FinancialProduct

### 5. WebApplication Schema (Tools)

**Location:** Layout files for tools (lot-calculator, compare)

```typescript
<Script
  id="tool-schema"
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Tool Name',
      description: '...',
      applicationCategory: 'FinanceApplication',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
      featureList: ['Feature 1', 'Feature 2'],
    }),
  }}
/>
```

---

## Sitemap & Robots.txt

### Dynamic Sitemap

**File:** `web/app/sitemap.ts`

**Features:**
- Automatically includes all IPOs from database
- Static pages: homepage, dashboard, tools, registrars, market-holidays, history
- Dynamic pages: all IPO detail pages (/ipos/[slug])
- Proper priorities and change frequencies
- Auto-updates when new IPOs added

**Access:** https://ipodhan.com/sitemap.xml

**Priorities:**
- Homepage: 1.0 (daily)
- Dashboard: 0.9 (hourly)
- IPO Details: 0.8 (hourly - live data)
- Tools: 0.7 (weekly)
- Registrars/Market Holidays: 0.6 (monthly)
- History: 0.8 (weekly)

### Robots.txt

**File:** `web/public/robots.txt`

```
User-agent: *
Allow: /

Disallow: /api/
Disallow: /admin/
Disallow: /_next/
Disallow: /private/

Sitemap: https://ipodhan.com/sitemap.xml
```

**Access:** https://ipodhan.com/robots.txt

---

## Technical SEO

### 1. Canonical URLs

**Implementation:** All pages have canonical URLs in metadata

```typescript
alternates: {
  canonical: `${BASE_URL}/path`,
}
```

**Handles:**
- Query parameters (e.g., /dashboard?page=2 → /dashboard)
- Trailing slashes
- Protocol consistency (HTTPS)

### 2. Heading Hierarchy

**Best Practices:**
- One H1 per page (page title)
- H2 for major sections
- H3 for subsections
- Never skip heading levels

**Example (IPO Detail Page):**
```html
<h1>Company Name IPO</h1>
<h2>Key Metrics</h2>
<h2>Subscription Data</h2>
  <h3>Retail Investors</h3>
  <h3>Institutional Investors</h3>
<h2>Financial Analysis</h2>
```

### 3. Image Optimization

**Requirements:**
- Use `next/image` component (automatic optimization)
- WebP format with fallback
- Descriptive alt text (all images)
- Lazy loading below the fold (automatic)
- Explicit width/height to prevent CLS

**Example:**
```typescript
<Image
  src="/logo.png"
  alt="IPODhan logo - IPO tracking platform"
  width={200}
  height={50}
  priority // Only for above-the-fold images
/>
```

### 4. Internal Linking

**Strategy:**
- Homepage → Top 5 current IPOs
- Dashboard → All IPO detail pages
- IPO Detail → Tools (calculator, comparison), registrars, history
- Footer → Important pages (Tools, Registrars, Market Holidays, History, About, Disclaimer)
- Breadcrumbs → Contextual navigation

### 5. Mobile-Friendly Design

**Features:**
- Responsive breakpoints (Tailwind CSS)
- Touch targets ≥ 48x48px
- No horizontal scrolling
- Viewport meta tag configured
- Mobile-first CSS

**Verification:**
- Google Mobile-Friendly Test: PASS
- Responsive design tested on actual devices

---

## Core Web Vitals

### Performance Targets

| Metric | Target | Current Status |
|--------|--------|----------------|
| LCP (Largest Contentful Paint) | <2.5s | ✅ Target: <2s |
| FID (First Input Delay) | <100ms | ✅ Target: <50ms |
| CLS (Cumulative Layout Shift) | <0.1 | ✅ Target: <0.05 |
| FCP (First Contentful Paint) | <1.8s | ✅ Optimized |

### Optimization Techniques

**LCP Optimization:**
- Font preloading (Geist Sans & Mono)
- Font display: swap (prevent FOIT)
- Image optimization with next/image
- Critical CSS inline
- Server-side rendering for above-the-fold content

**FID Optimization:**
- Code splitting (Next.js automatic)
- Lazy loading for below-the-fold components
- Defer non-critical JavaScript
- React Server Components for static content

**CLS Optimization:**
- Explicit image dimensions (next/image)
- Reserved space for dynamic content (skeleton loaders)
- Font display: swap (prevent layout shift)
- Avoid inserting content above existing content

---

## How to Add SEO to New Pages

### Step-by-Step Guide

#### 1. Create Metadata Function (if needed)

**File:** `web/lib/seo/metadata.ts`

```typescript
export function generateNewPageMetadata(): Metadata {
  const title = 'Page Title - 50-60 chars | IPODhan';
  const description = 'Compelling description 150-160 characters with value proposition.';

  return {
    title,
    description,
    keywords: ['keyword1', 'keyword2', 'keyword3'],
    alternates: {
      canonical: `${BASE_URL}/new-page`,
    },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      url: `${BASE_URL}/new-page`,
      siteName: 'IPODhan',
      title,
      description,
      images: [
        {
          url: DEFAULT_OG_IMAGE,
          width: 1200,
          height: 630,
          alt: 'Descriptive alt text',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}
```

#### 2. Add Metadata to Page

**Option A: Server Component (Recommended)**

```typescript
import { Metadata } from 'next';
import { generateNewPageMetadata } from '@/lib/seo/metadata';

export const metadata: Metadata = generateNewPageMetadata();

export default function NewPage() {
  return <div>Content</div>;
}
```

**Option B: Layout File (for multiple pages)**

```typescript
// layout.tsx
import { Metadata } from 'next';

export const metadata: Metadata = generateNewPageMetadata();

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

#### 3. Add Structured Data (if applicable)

```typescript
import Script from 'next/script';

<Script
  id="page-schema"
  type="application/ld+json"
  dangerouslySetInnerHTML={{
    __html: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage', // or CollectionPage, Article, etc.
      name: 'Page Name',
      description: 'Page description',
      url: 'https://ipodhan.com/new-page',
    }),
  }}
/>
```

#### 4. Add Page to Sitemap

**File:** `web/app/sitemap.ts`

```typescript
const staticPages: MetadataRoute.Sitemap = [
  // Existing pages...
  {
    url: `${baseUrl}/new-page`,
    lastModified: new Date(),
    changeFrequency: 'weekly', // or 'daily', 'monthly'
    priority: 0.7, // 0.0 - 1.0
  },
];
```

#### 5. Add Breadcrumbs (if applicable)

```typescript
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';

<Breadcrumbs
  items={[
    { label: 'Home', href: '/' },
    { label: 'Parent', href: '/parent' },
    { label: 'Current Page' },
  ]}
/>
```

#### 6. Validate Implementation

- [ ] Title length: 50-60 characters
- [ ] Description length: 150-160 characters
- [ ] Canonical URL present
- [ ] Open Graph tags complete
- [ ] Twitter Card tags present
- [ ] Structured data valid (Google Rich Results Test)
- [ ] Page in sitemap
- [ ] Internal links added
- [ ] Images have alt text
- [ ] Breadcrumbs functional

---

## Testing & Validation

### 1. Google Rich Results Test

**URL:** https://search.google.com/test/rich-results

**Test Pages:**
- Homepage (Organization schema)
- IPO Detail (FinancialProduct, BreadcrumbList)
- Dashboard (ItemList)
- Tools (WebApplication)

**Expected:** No errors, warnings acceptable

### 2. Lighthouse SEO Audit

**Run Lighthouse:**
```bash
# Chrome DevTools: Lighthouse tab
# Or via CLI:
npm install -g lighthouse
lighthouse https://ipodhan.com --only-categories=seo --view
```

**Target Scores:**
- SEO: >95 on all major pages
- Performance: >90
- Accessibility: >90
- Best Practices: >90

### 3. Sitemap Validation

**Tools:**
- https://www.xml-sitemaps.com/validate-xml-sitemap.html
- Google Search Console (after submission)

**Verify:**
- All URLs accessible (no 404s)
- Proper XML format
- Priority and changeFrequency values correct
- No duplicate URLs

### 4. Robots.txt Testing

**Google Search Console:**
- Robots Testing Tool
- Verify crawling directives work correctly

### 5. Meta Tag Checker

**Tools:**
- View source (Ctrl+U in browser)
- https://metatags.io/ (preview OG/Twitter cards)
- Facebook Sharing Debugger
- Twitter Card Validator

**Verify:**
- All meta tags present
- OG image displays correctly
- Twitter card renders properly
- Canonical URL correct

### 6. Mobile-Friendly Test

**Google Mobile-Friendly Test:**
https://search.google.com/test/mobile-friendly

**Expected:** PASS with no issues

### 7. Core Web Vitals Check

**Tools:**
- PageSpeed Insights: https://pagespeed.web.dev/
- Chrome DevTools → Lighthouse
- Real User Monitoring (production)

**Verify:**
- LCP <2.5s (target <2s)
- FID <100ms (target <50ms)
- CLS <0.1 (target <0.05)

---

## Maintenance & Monitoring

### Regular Tasks

**Weekly:**
- [ ] Monitor Google Search Console for indexing errors
- [ ] Check for 404 errors
- [ ] Verify sitemap updates with new IPOs

**Monthly:**
- [ ] Run Lighthouse audit on major pages
- [ ] Review Core Web Vitals trends
- [ ] Check for broken internal links
- [ ] Update OG images if needed

**Quarterly:**
- [ ] Audit all meta descriptions (relevance, keyword optimization)
- [ ] Review and update structured data
- [ ] Analyze search performance (top queries, click-through rate)
- [ ] Update SEO strategy based on analytics

### Google Search Console Setup

**Steps:**
1. Add property: https://ipodhan.com
2. Verify ownership (DNS or HTML file)
3. Submit sitemap: https://ipodhan.com/sitemap.xml
4. Set preferred domain (www vs non-www)
5. Set geographic target: India
6. Monitor:
   - Index coverage
   - Core Web Vitals
   - Mobile usability
   - Rich results status

### Analytics Integration

**Google Analytics 4:**
- Already integrated in root layout (`web/app/layout.tsx`)
- Track organic search traffic
- Monitor bounce rate by page
- Analyze user engagement metrics

**Key Metrics:**
- Organic search sessions
- Pages per session
- Average session duration
- Conversion rate (IPO application clicks)

### Common Issues & Solutions

**Issue: Pages not indexed**
- Check robots.txt (not blocking)
- Verify sitemap includes page
- Check for noindex meta tag
- Submit URL in Google Search Console

**Issue: Structured data errors**
- Validate with Rich Results Test
- Check JSON-LD syntax
- Ensure required fields present
- Fix schema.org type mismatches

**Issue: Low Lighthouse score**
- Optimize images (use next/image)
- Reduce JavaScript bundle size
- Fix CLS issues (explicit dimensions)
- Improve LCP (preload critical resources)

**Issue: Duplicate content**
- Add canonical URLs
- Use 301 redirects for old URLs
- Consolidate similar pages

---

## Best Practices Summary

### Do's ✅

- Use `next/image` for all images
- Write unique meta titles and descriptions for each page
- Implement structured data for rich snippets
- Keep title length 50-60 characters
- Keep description length 150-160 characters
- Use descriptive alt text for images
- Implement breadcrumb navigation
- Create internal links between related pages
- Test on real mobile devices
- Monitor Core Web Vitals continuously
- Update sitemap automatically with new content

### Don'ts ❌

- Don't duplicate content across pages
- Don't use generic alt text ("image", "photo")
- Don't skip heading levels (H1 → H3)
- Don't block important resources in robots.txt
- Don't use aggressive caching for dynamic content
- Don't ignore mobile usability
- Don't forget canonical URLs
- Don't use Flash or other non-crawlable content
- Don't hide text or links from users
- Don't keyword stuff

---

## Resources & References

### Official Documentation

- **Next.js Metadata API:** https://nextjs.org/docs/app/building-your-application/optimizing/metadata
- **Schema.org Documentation:** https://schema.org/docs/documents.html
- **Google Search Central:** https://developers.google.com/search
- **Core Web Vitals:** https://web.dev/vitals/

### Tools

- **Google Search Console:** https://search.google.com/search-console
- **Google Rich Results Test:** https://search.google.com/test/rich-results
- **PageSpeed Insights:** https://pagespeed.web.dev/
- **Lighthouse CLI:** https://github.com/GoogleChrome/lighthouse
- **Schema Markup Validator:** https://validator.schema.org/

### SEO Checklist

- [ ] All pages have unique titles (<60 chars)
- [ ] All pages have unique descriptions (<160 chars)
- [ ] All pages have canonical URLs
- [ ] Open Graph tags on all pages
- [ ] Twitter Card tags on all pages
- [ ] Structured data on relevant pages (Organization, FinancialProduct, Breadcrumb, ItemList)
- [ ] Sitemap generated and submitted
- [ ] Robots.txt configured correctly
- [ ] All images have alt text
- [ ] Internal linking implemented
- [ ] Mobile-friendly design verified
- [ ] Core Web Vitals passing (LCP <2.5s, FID <100ms, CLS <0.1)
- [ ] Lighthouse SEO score >95
- [ ] Google Search Console configured
- [ ] No indexing errors in Search Console

---

**Last Updated:** 2025-10-16
**Story:** 8.2 - SEO Optimization
**Status:** Complete ✅
