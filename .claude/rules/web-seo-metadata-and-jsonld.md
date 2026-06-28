---
name: web-seo-metadata-and-jsonld
description: >
  Every public web route builds its Next.js metadata through a per-page-TYPE factory in
  web/lib/seo/metadata.ts and emits JSON-LD via builders in web/lib/seo/structured-data.ts —
  never inline metadata objects or hand-written schema literals, so canonical/OG/locale stay uniform.
globs: ["web/app/**/*.tsx", "web/lib/seo/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Web SEO Metadata & JSON-LD Structured Data

## Page metadata comes from the typed factory, never inline
Every public route's `export const metadata` (static) or `generateMetadata` (dynamic) MUST be
produced by a factory in `web/lib/seo/metadata.ts`. There is one factory per page TYPE —
`generateHomepageMetadata()`, `generateIPOListingMetadata()`, `generateIPODetailMetadata(params)`,
plus the tool/registrar/holiday/history factories — and a single dispatcher
`generateMetadata(pageType, params?)` keyed off the `MetadataPageType` union
(`'homepage' | 'ipo-listing' | 'ipo-detail' | 'lot-calculator' | ...`).

- `web/app/page.tsx` does `export const metadata = generateHomepageMetadata()`.
- `web/app/ipos/[slug]/page.tsx` builds its dynamic metadata from `generateIPODetailMetadata(ipoToMetadataParams(ipo))`.
- A DB row is converted to factory input via `ipoToMetadataParams(ipo: IPO)` — page code MUST NOT
  reach into IPO fields to assemble title/description itself.

You MUST NOT hand-author a `Metadata` object literal in a page/component. Inline objects drift:
`BASE_URL` (`process.env.NEXT_PUBLIC_BASE_URL || 'https://ipodhan.com'`), the `alternates.canonical`
URL, the default OG image, `openGraph.locale: 'en_IN'`, `siteName: 'IPO Dhan'`, and the Twitter card
are all standardized inside `metadata.ts` exactly once. A new page TYPE → add a factory + a
`MetadataPageType` member + a `switch` case, never a one-off object at the call site.

## JSON-LD is emitted via builders + next/script, never raw literals
Structured data MUST be built by a generator in `web/lib/seo/structured-data.ts`
(`generateOrganizationSchema()`, `generateFinancialProductSchema(ipo)`,
`generateIPOListingSchema(ipos)`, `generateBreadcrumbSchema(items)`) and rendered through
`next/script`'s `<Script type="application/ld+json">` with the body serialized by `toJsonLdScript()`.
Breadcrumb item arrays come from the matching helper (`generateIPODetailBreadcrumbs`,
`generateToolsBreadcrumbs`, etc.) — do not build `BreadcrumbItem[]` inline.

You MUST NOT write `@context`/`@type` schema.org literals in a page or stringify schema with a
bare `JSON.stringify`. The builders own the schema.org shape (the typed `OrganizationSchema`,
`FinancialProductSchema`, `BreadcrumbListSchema`, `ItemListSchema` interfaces) and the same
`BASE_URL`/currency (`'INR'`)/availability mapping; bypassing them produces invalid or inconsistent
rich results that Google silently drops.

## CRITICAL RULES
- MUST build every route's metadata from a factory in `web/lib/seo/metadata.ts`; MUST NOT inline a `Metadata` object.
- MUST route dynamic pages through `generateMetadata(pageType, params)` (or the specific factory) and convert DB rows with `ipoToMetadataParams`.
- A new page TYPE MUST add a factory + a `MetadataPageType` member + a `switch` case — never a one-off metadata object at the call site.
- MUST emit JSON-LD only via the `generate*Schema` builders + `toJsonLdScript()` inside a `next/script` `<Script type="application/ld+json">`.
- MUST NOT hand-write schema.org `@context`/`@type` literals in pages/components; keep `BASE_URL`, `locale: 'en_IN'`, `siteName`, OG image, and currency centralized in the seo modules.
