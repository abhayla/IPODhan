---
name: fuzzy-search-slug-expert
description: Canonical slug generation, fuzzy matching with fuse.js, collision detection, and similarity threshold tuning
---

# Fuzzy Search & Slug Expert

**Purpose:** Expertise in canonical slug generation, fuzzy matching with fuse.js, collision detection, and similarity threshold tuning for IPODhan.

**When to invoke:** Generating slugs, implementing search, handling slug collisions, or optimizing fuzzy matching performance.

---

## Canonical Slug Generation

### Core Function (packages/shared/src/utils/slug.ts)

```typescript
export function generateIPOSlug(companyName: string, maxLength = 100): string {
  return companyName
    .toLowerCase()
    .replace(/\s+ltd\.?$/i, '')        // Remove "Ltd" suffix
    .replace(/\s+limited$/i, '')       // Remove "Limited"
    .replace(/\s+pvt\.?$/i, '')        // Remove "Pvt"
    .replace(/\s+private$/i, '')       // Remove "Private"
    .replace(/\s+inc\.?$/i, '')        // Remove "Inc"
    .replace(/\s+llc$/i, '')           // Remove "LLC"
    .replace(/\s+corporation$/i, '')   // Remove "Corporation"
    .replace(/\s+corp\.?$/i, '')       // Remove "Corp"
    .replace(/[₹$€£¥]/g, '')           // Remove currency symbols
    .replace(/&/g, 'and')              // Replace & with "and"
    .replace(/[^a-z0-9\s-]/g, '')      // Remove special chars
    .trim()
    .replace(/\s+/g, '-')              // Spaces to hyphens
    .replace(/-+/g, '-')               // Multiple hyphens to single
    .substring(0, maxLength);          // Enforce max length
}
```

### Handling 13+ Legal Entity Types

```typescript
const entityTypes = [
  'ltd', 'limited', 'pvt', 'private',
  'inc', 'llc', 'corp', 'corporation',
  'plc', 'sa', 'gmbh', 'ag', 'nv'
];

// Applied in order (most to least common)
```

### Collision Detection

```typescript
export async function generateUniqueSlug(
  companyName: string,
  existingSlugs: string[]
): Promise<string> {
  let slug = generateIPOSlug(companyName);
  
  if (!existingSlugs.includes(slug)) {
    return slug;
  }

  // Add "-ipo" suffix
  slug = `${slug}-ipo`;
  if (!existingSlugs.includes(slug)) {
    return slug;
  }

  // Add numeric suffix
  let counter = 2;
  while (existingSlugs.includes(`${slug}-${counter}`)) {
    counter++;
  }

  return `${slug}-${counter}`;
}
```

---

## Fuzzy Matching with Fuse.js

### Configuration (web/lib/config/search.ts)

```typescript
import Fuse from 'fuse.js';

export const fuseOptions: Fuse.IFuseOptions<IPO> = {
  keys: [
    {
      name: 'companyName',
      weight: 0.7,  // 70% weight
    },
    {
      name: 'slug',
      weight: 0.2,  // 20% weight
    },
    {
      name: 'isinNumber',
      weight: 0.1,  // 10% weight
    },
  ],
  threshold: 0.3,         // 30% minimum similarity (0-1, lower = stricter)
  distance: 100,          // Max character distance
  minMatchCharLength: 2,  // Minimum characters to match
  includeScore: true,     // Return similarity scores
};
```

### Repository Implementation

```typescript
async findBySlugWithFallback(
  slug: string,
  options: { enableFuzzy?: boolean; similarityThreshold?: number } = {}
): Promise<IPO | null> {
  // Try exact match first
  const exact = await this.findBySlug(slug);
  if (exact || !options.enableFuzzy) {
    return exact;
  }

  // Fuzzy search fallback
  const allIPOs = await this.findAll();
  const fuse = new Fuse(allIPOs, {
    ...fuseOptions,
    threshold: options.similarityThreshold || 0.6,
  });

  const results = fuse.search(slug);
  
  return results.length > 0 ? results[0].item : null;
}
```

### Search with Scores

```typescript
async searchByName(
  query: string,
  options: { limit?: number; threshold?: number } = {}
): Promise<Array<{ ipo: IPO; score: number }>> {
  const allIPOs = await this.findAll();
  const fuse = new Fuse(allIPOs, {
    ...fuseOptions,
    threshold: options.threshold || 0.3,
  });

  const results = fuse.search(query, { limit: options.limit || 10 });

  return results.map(result => ({
    ipo: result.item,
    score: 1 - (result.score || 0), // Convert to similarity score (0-1)
  }));
}
```

---

## Similarity Thresholds

### Threshold Guidelines

```
0.0 - Exact match only
0.1 - Very strict (minor typos)
0.3 - Strict (recommended for search)
0.6 - Moderate (recommended for fallback)
0.8 - Lenient (many false positives)
1.0 - Match anything
```

### Use Cases

- **Exact Lookup (0.0):** Primary key, ISIN
- **Search (0.3):** User-initiated search
- **Fallback (0.6):** API slug not found, try similar
- **Suggestions (0.5):** "Did you mean?" feature

---

## Performance Optimization

### Target: <500ms for Fuzzy Search

```typescript
// ✅ Good: Cache IPO list for fuzzy search
let cachedIPOs: IPO[] | null = null;
let cacheTime: number = 0;
const CACHE_TTL = 300000; // 5 minutes

async function getCachedIPOs(): Promise<IPO[]> {
  if (cachedIPOs && Date.now() - cacheTime < CACHE_TTL) {
    return cachedIPOs;
  }

  cachedIPOs = await ipoRepository.findAll();
  cacheTime = Date.now();
  return cachedIPOs;
}
```

### Benchmarks

```
100 IPOs:   ~10ms   ✅ Excellent
500 IPOs:   ~50ms   ✅ Good
1000 IPOs:  ~150ms  ✅ Acceptable
5000 IPOs:  ~600ms  🟡 Slow (consider indexing)
```

---

## Validation

```typescript
export function validateSlug(slug: string): boolean {
  return /^[a-z0-9-]{3,100}$/.test(slug);
}

// Usage
if (!validateSlug(slug)) {
  throw new Error('Invalid slug format');
}
```

---

## Best Practices

1. **Always use generateIPOSlug()** - Never custom slug logic
2. **Check collisions** before inserting to database
3. **Cache IPO lists** for fuzzy search performance
4. **Use appropriate thresholds** - 0.3 for search, 0.6 for fallback
5. **Include scores** in API responses for transparency

---

## References

- **Slug Generation:** `packages/shared/docs/SLUG_GENERATION.md`
- **Fuse.js:** https://fusejs.io/
- **Fuzzy Matching:** `web/docs/FUZZY_MATCHING.md`

