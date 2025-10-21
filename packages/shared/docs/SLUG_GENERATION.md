# Slug Generation - Canonical Implementation

**Version:** 1.0.0
**Last Updated:** 2025-10-21
**Issue:** ISS-027 - Slug Resolution Inconsistency

## Overview

This document describes the canonical slug generation implementation for IPODhan. All slug generation across the system (web, scrapers, API) **MUST** use the utilities defined in `packages/shared/src/utils/slug.ts`.

## Problem Statement

Prior to this implementation, different parts of the system generated slugs inconsistently:

- **Scrapers** used simple regex-based slug generation in `scraper/src/utils/validators.ts`
- **Frontend** had no standardized slug generation
- **Database** contained inconsistent slugs due to different generation methods

This led to:
- Slug mismatches between scraper-generated and frontend-expected slugs
- Difficulty finding IPOs by slug
- Inconsistent URL patterns across the platform

## Solution: Canonical Slug Utility

A single source of truth for slug generation with these features:

### 1. Comprehensive Legal Entity Normalization

```typescript
'Company Ltd.' → 'company-ltd'
'Company Pvt. Ltd.' → 'company-pvt-ltd'
'Company Inc.' → 'company-inc'
'Company LLC' → 'company-llc'
```

### 2. Special Character Handling

```typescript
'A & B Company' → 'a-and-b-company'
'Company @ 123' → 'company-at-123'
'50% Company' → '50-percent-company'
'₹100 Company' → 'rs-100-company'
```

### 3. Uniqueness Guarantee

Automatic counter appending for duplicate slugs:

```typescript
'Company' → 'company'
'Company' (duplicate) → 'company-2'
'Company' (duplicate) → 'company-3'
```

### 4. Validation

Built-in slug validation ensures all slugs are:
- Lowercase only
- Alphanumeric + hyphens
- No leading/trailing hyphens
- No consecutive hyphens

## API Reference

### `generateIPOSlug(companyName, options?)`

Generate IPO slug from company name.

**Parameters:**
- `companyName: string` - The company name to convert
- `options?: SlugOptions` - Optional configuration
  - `suffix?: string` - Suffix to append (e.g., '-ipo')
  - `maxLength?: number` - Maximum slug length (default: 100)

**Returns:** `string` - URL-safe slug

**Example:**
```typescript
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';

generateIPOSlug('Tata Consultancy Services Ltd.');
// → 'tata-consultancy-services-ltd'

generateIPOSlug('HDFC Bank Ltd.', { suffix: '-ipo' });
// → 'hdfc-bank-ltd-ipo'

generateIPOSlug('Very Long Company Name That Exceeds Limit', { maxLength: 20 });
// → 'very-long-company'
```

### `validateSlug(slug)`

Validate slug format.

**Parameters:**
- `slug: string` - The slug to validate

**Returns:** `boolean` - True if valid, false otherwise

**Example:**
```typescript
import { validateSlug } from '@ipodhan/shared/utils/slug';

validateSlug('company-name'); // → true
validateSlug('Company-Name'); // → false (uppercase)
validateSlug('company--name'); // → false (consecutive hyphens)
```

### `generateUniqueSlug(companyName, existingSlugs, options?)`

Generate unique slug by checking against existing slugs.

**Parameters:**
- `companyName: string` - The company name to convert
- `existingSlugs: string[]` - Array of existing slugs to check
- `options?: SlugOptions` - Optional configuration

**Returns:** `string` - Unique slug

**Example:**
```typescript
import { generateUniqueSlug } from '@ipodhan/shared/utils/slug';

const existing = ['company', 'company-2'];
generateUniqueSlug('Company', existing);
// → 'company-3'
```

### `slugToCompanyName(slug)`

Convert slug back to company name (best-effort).

**Parameters:**
- `slug: string` - The slug to convert

**Returns:** `string` - Approximate company name

**Example:**
```typescript
import { slugToCompanyName } from '@ipodhan/shared/utils/slug';

slugToCompanyName('tata-consultancy-services-ltd');
// → 'Tata Consultancy Services Ltd.'

slugToCompanyName('hdfc-bank-ltd-ipo');
// → 'Hdfc Bank Ltd.'
```

### `normalizeCompanyName(companyName)`

Normalize company name for comparison (fuzzy matching).

**Parameters:**
- `companyName: string` - The company name to normalize

**Returns:** `string` - Normalized company name

**Example:**
```typescript
import { normalizeCompanyName } from '@ipodhan/shared/utils/slug';

normalizeCompanyName('HDFC Bank Ltd.');
// → 'hdfc bank'

normalizeCompanyName('HDFC Bank Limited');
// → 'hdfc bank'

// Both normalize to the same value, enabling fuzzy matching
```

## Usage Patterns

### 1. In Scrapers

All scrapers import from the shared utility:

```typescript
// scraper/src/scrapers/nse-scraper-orchestrator.ts
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';

// Generate slug when processing scraped data
const slug = generateIPOSlug(validatedIPO.companyName);
const existingIPO = await ipoRepository.findBySlug(slug);
```

**Note:** The old `generateSlug()` function in `scraper/src/utils/validators.ts` is now a deprecated wrapper that calls the canonical function.

### 2. In Frontend Components

```typescript
// web/app/tools/compare/page.tsx
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';

const slug = generateIPOSlug(userInput);
```

### 3. In Migration Scripts

```typescript
// web/scripts/regenerate-slugs.ts
import { generateUniqueSlug } from '@ipodhan/shared/utils/slug';

const newSlug = generateUniqueSlug(ipo.companyName, existingSlugs);
```

### 4. In API Routes

```typescript
// web/app/api/ipos/[slug]/route.ts
import { validateSlug } from '@ipodhan/shared/utils/slug';

if (!validateSlug(slug)) {
  return NextResponse.json({ error: 'Invalid slug format' }, { status: 400 });
}
```

## Slug Generation Rules

### Rule 1: Case Normalization
All slugs are lowercase.

```typescript
'COMPANY' → 'company'
'Company Name' → 'company-name'
```

### Rule 2: Legal Entity Normalization
Legal entity suffixes are normalized with hyphens.

```typescript
'Company Ltd.' → 'company-ltd'
'Company Limited' → 'company-limited'
'Company Pvt. Ltd.' → 'company-pvt-ltd'
'Company Private Limited' → 'company-private-limited'
```

**Supported entities:**
- Ltd., Limited
- Pvt., Private
- Inc., Incorporated
- Corp., Corporation
- LLC, LLP, PLC

### Rule 3: Special Character Replacement
Special characters are replaced with semantic equivalents.

| Character | Replacement |
|-----------|-------------|
| `&` | `and` |
| `+` | `plus` |
| `@` | `at` |
| `%` | `percent` |
| `₹` | `rs` |
| `$` | `dollar` |
| `€` | `euro` |
| `£` | `pound` |

### Rule 4: Whitespace Handling
Spaces and other whitespace become hyphens.

```typescript
'Company Name' → 'company-name'
'A   B   C' → 'a-b-c'
```

### Rule 5: Hyphen Consolidation
Multiple consecutive hyphens are collapsed to one.

```typescript
'A - B - C' → 'a-b-c'
'Company--Name' → 'company-name'
```

### Rule 6: Hyphen Trimming
Leading and trailing hyphens are removed.

```typescript
'-Company-' → 'company'
'--Company--' → 'company'
```

### Rule 7: Length Enforcement
Slugs are truncated to maximum length (default: 100 characters).

```typescript
generateIPOSlug('Very Long Company Name...', { maxLength: 20 });
// → 'very-long-company-na'
```

## Migration Guide

### Migrating Existing Slugs

Use the provided migration script to regenerate all slugs:

```bash
# Preview changes (dry-run mode)
npm run tsx scripts/regenerate-slugs.ts --dry-run

# Preview with verbose output
npm run tsx scripts/regenerate-slugs.ts --dry-run --verbose

# Apply changes (requires confirmation)
npm run tsx scripts/regenerate-slugs.ts
```

**Migration Script Features:**
- Dry-run mode for safe preview
- Verbose mode for detailed output
- Uniqueness preservation
- Change tracking and reporting
- Error handling and rollback

### Breaking Changes

⚠️ **Important:** Regenerating slugs will change URLs for some IPOs.

**Before Migration:**
```
/ipo/companyltd
/ipo/company_name
```

**After Migration:**
```
/ipo/company-ltd
/ipo/company-name
```

**Mitigation:**
1. Run in dry-run mode first to identify affected IPOs
2. Set up URL redirects for changed slugs (optional)
3. Clear caches after migration
4. Update any hardcoded slug references

### Cache Invalidation

After regenerating slugs, invalidate all IPO-related caches:

```typescript
import { invalidateIPOCaches } from '@ipodhan/shared/cache/invalidate';

// Invalidate all IPO caches
await invalidateIPOCaches(redis);
```

## Testing

### Running Tests

```bash
# Run slug utility tests
cd packages/shared
npm test src/utils/slug.test.ts

# Run with coverage
npm test -- --coverage src/utils/slug.test.ts
```

### Test Coverage

The test suite includes:
- ✅ Basic transformations (70+ tests)
- ✅ Legal entity normalization (15+ tests)
- ✅ Special character handling (20+ tests)
- ✅ Hyphen handling (10+ tests)
- ✅ Uniqueness generation (8+ tests)
- ✅ Slug validation (15+ tests)
- ✅ Real-world company names (10+ tests)

**Coverage Target:** 100% (all branches)

## Best Practices

### DO ✅

- **DO** use `generateIPOSlug()` for all slug generation
- **DO** use `validateSlug()` before processing user-provided slugs
- **DO** use `generateUniqueSlug()` when batch-generating slugs
- **DO** normalize company names for fuzzy matching
- **DO** run migration script in dry-run mode first

### DON'T ❌

- **DON'T** create slugs manually with string manipulation
- **DON'T** skip slug validation for user input
- **DON'T** assume slugs are immutable (they can be regenerated)
- **DON'T** hardcode slugs in code (use company name → slug conversion)
- **DON'T** modify the canonical slug utility without updating tests

## Troubleshooting

### Problem: Slug Mismatch Between Scraper and Frontend

**Cause:** Different slug generation methods

**Solution:**
```typescript
// Both should use the canonical function
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';

const slug = generateIPOSlug(companyName);
```

### Problem: Duplicate Slugs in Database

**Cause:** Race condition or manual insertion

**Solution:**
```typescript
// Use uniqueness check
import { generateUniqueSlug } from '@ipodhan/shared/utils/slug';

const existingSlugs = await db.select({ slug: ipos.slug }).from(ipos);
const uniqueSlug = generateUniqueSlug(
  companyName,
  existingSlugs.map(row => row.slug)
);
```

### Problem: Invalid Slug Format

**Cause:** Manual slug creation or external data

**Solution:**
```typescript
// Validate before use
import { validateSlug } from '@ipodhan/shared/utils/slug';

if (!validateSlug(userProvidedSlug)) {
  throw new Error('Invalid slug format');
}
```

## Version History

### v1.0.0 (2025-10-21)
- Initial implementation
- 5 utility functions
- 140+ test cases
- Migration script
- Full documentation

## Related Documents

- [Backend Architecture](../../../docs/02-architecture/backend-architecture.md)
- [Database Schema Management](../../../docs/16-database/SCHEMA_MANAGEMENT.md)
- [UI-Database Field Mapping](../../../docs/16-database/screen-table-database-field-mapping.md)

## Support

For issues related to slug generation:
1. Check this documentation first
2. Run tests to verify behavior
3. Review migration script output
4. Check issue tracker for known issues

## License

Copyright © 2025 IPODhan. All rights reserved.
