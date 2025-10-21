# Fuzzy Matching Documentation

**Issue:** ISS-027
**Feature:** API fallback with fuzzy matching for IPO lookups
**Status:** Implemented ✅

## Overview

This document describes the fuzzy matching implementation for IPO lookups. When an exact slug match fails, the system automatically falls back to fuzzy matching to find similar IPOs and provide helpful suggestions to users.

## Table of Contents

- [How It Works](#how-it-works)
- [Configuration](#configuration)
- [API Behavior](#api-behavior)
- [Implementation Details](#implementation-details)
- [Performance Considerations](#performance-considerations)
- [Testing](#testing)
- [Monitoring & Analytics](#monitoring--analytics)
- [Troubleshooting](#troubleshooting)

## How It Works

### Flow Diagram

```
User Request: /api/ipos/tech-company-limited
                    ↓
         [1] Try Exact Slug Match
                    ↓
            ┌───────┴───────┐
         Found?          Not Found
            ↓                ↓
    Return IPO    [2] Fuzzy Match Enabled?
                            ↓
                    ┌───────┴───────┐
                  Yes              No
                    ↓                ↓
         [3] Convert slug       Return 404
             to search term
         (tech company limited)
                    ↓
         [4] Fuzzy search all IPOs
             - Field weights:
               * companyName: 70%
               * slug: 30%
                    ↓
         [5] Apply threshold (60%)
                    ↓
            ┌───────┴───────┐
         Matches?        No matches
            ↓                ↓
    Return best match  [6] Generate suggestions
                           (threshold: 30%)
                                ↓
                       Return 404 with suggestions
```

### Key Concepts

1. **Exact Match First**: Always try exact slug match first (uses cache)
2. **Fuzzy Fallback**: If enabled, convert slug to search term and fuzzy match
3. **Similarity Threshold**: Configurable minimum similarity (default: 60%)
4. **Suggestions**: On complete failure, provide similar IPOs (threshold: 30%)
5. **Caching**: All results are cached to improve performance

## Configuration

Configuration is centralized in `web/lib/config/search.ts`:

```typescript
export const SEARCH_CONFIG = {
  fuzzyMatch: {
    enabled: true,                  // Enable fuzzy matching
    similarityThreshold: 0.6,       // 60% similarity required
    maxResults: 10,                 // Max fuzzy search results
    fieldWeights: {
      companyName: 0.7,             // 70% weight on company name
      slug: 0.3,                    // 30% weight on slug
    },
  },
  fallback: {
    enabled: true,                  // Enable fallback behavior
    cacheResults: true,             // Cache fuzzy results
    cacheTTL: 300,                  // 5 minutes
  },
  suggestions: {
    enabled: true,                  // Show suggestions on 404
    maxSuggestions: 5,              // Max suggestions to return
    minSimilarity: 0.3,             // 30% similarity for suggestions
  },
};
```

### Configuration Options

#### Similarity Threshold

Controls how strict the matching is:

| Value | Description | Use Case |
|-------|-------------|----------|
| 0.8 - 1.0 | Very strict | When precision is critical |
| 0.6 - 0.8 | Balanced | **Default** - Good UX + accuracy |
| 0.4 - 0.6 | Loose | When recall is more important |
| 0.0 - 0.4 | Very loose | For broad suggestions only |

#### Field Weights

Controls which fields are more important for matching:

- **companyName (0.7)**: Primary matching field
- **slug (0.3)**: Secondary matching field

Example: Searching for "Tech Company" will prioritize IPOs with "Tech Company" in the name over those with "tech-company" in the slug.

## API Behavior

### Success - Exact Match

```bash
GET /api/ipos/tech-company-ipo
```

**Response (200):**
```json
{
  "ipo": {
    "id": "ipo-123",
    "slug": "tech-company-ipo",
    "companyName": "Tech Company Limited",
    ...
  },
  ...
}
```

### Success - Fuzzy Match

```bash
GET /api/ipos/tech-company-limited
# Exact match fails, but fuzzy match finds "tech-company-ipo"
```

**Response (200):**
```json
{
  "ipo": {
    "id": "ipo-123",
    "slug": "tech-company-ipo",
    "companyName": "Tech Company Limited",
    ...
  },
  ...
}
```

**Logs:**
```
INFO: [IPO Repository] Exact slug match failed, trying fuzzy match
INFO: [IPO Repository] Fuzzy match found
  slug: tech-company-limited
  matchedSlug: tech-company-ipo
  companyName: Tech Company Limited
  similarity: 87
```

### Failure - With Suggestions

```bash
GET /api/ipos/xyz-corp-completely-wrong
```

**Response (404):**
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "No IPO found with slug 'xyz-corp-completely-wrong'",
    "details": {
      "suggestions": [
        {
          "companyName": "XYZ Corporation",
          "slug": "xyz-corporation-ipo",
          "similarity": 45,
          "status": "OPEN",
          "openDate": "2025-10-25",
          "closeDate": "2025-10-28"
        },
        {
          "companyName": "ABC Corp Limited",
          "slug": "abc-corp-ipo",
          "similarity": 38,
          "status": "UPCOMING",
          "openDate": "2025-11-01",
          "closeDate": "2025-11-04"
        }
      ]
    },
    "timestamp": "2025-10-21T10:30:00.000Z",
    "requestId": "req_1729504200000_abc123"
  }
}
```

## Implementation Details

### Repository Methods

#### `findBySlugWithFallback(slug, options)`

Finds IPO by slug with automatic fuzzy fallback.

**Parameters:**
- `slug` (string): IPO slug to search for
- `options` (object):
  - `enableFuzzy` (boolean): Enable fuzzy matching (default: true)
  - `similarityThreshold` (number): Min similarity 0-1 (default: 0.6)

**Returns:** `IPOWithRelations | null`

**Example:**
```typescript
const ipo = await ipoRepository.findBySlugWithFallback('tech-company', {
  enableFuzzy: true,
  similarityThreshold: 0.7,
});
```

#### `searchByName(query, options)`

Fuzzy search IPOs by company name.

**Parameters:**
- `query` (string): Search query
- `options` (object):
  - `limit` (number): Max results (default: 10)
  - `threshold` (number): Min similarity (default: 0.4)

**Returns:** `Array<{ ipo: IPO; score: number; similarity: number }>`

**Example:**
```typescript
const results = await ipoRepository.searchByName('Tech Company', {
  limit: 5,
  threshold: 0.5,
});

results.forEach(result => {
  console.log(`${result.ipo.companyName} - ${result.similarity}% match`);
});
```

### Slug Transformation

Slugs are converted to search terms for better matching:

```typescript
// Input: "tech-company-limited-ipo"
// Step 1: Remove "-ipo" suffix → "tech-company-limited"
// Step 2: Replace hyphens → "tech company limited"
// Step 3: Lowercase → "tech company limited"
// Result: "tech company limited"
```

### Fuzzy Matching Algorithm

Uses **Fuse.js** with the following configuration:

```typescript
const fuse = new Fuse(allIPOs, {
  keys: [
    { name: 'companyName', weight: 0.7 },
    { name: 'slug', weight: 0.3 },
  ],
  threshold: 1 - similarityThreshold,  // Invert (Fuse: 0=exact, 1=no match)
  includeScore: true,
});
```

**Why Fuse.js?**
- Mature, battle-tested library (50M+ downloads/month)
- Configurable field weighting
- Fast performance for datasets < 10K items
- Score normalization (0-1 range)

## Performance Considerations

### Optimization Strategies

1. **Cache-First Strategy**
   - Exact matches use cache (15min TTL)
   - Fuzzy results cached (5min TTL)
   - Suggestions cached per query

2. **Minimal Field Selection**
   ```typescript
   // Only fetch required fields for fuzzy matching
   SELECT id, company_name, slug FROM ipos;
   ```

3. **Query Optimization**
   - Fetch all IPOs once per fuzzy operation
   - Reuse in-memory for multiple searches
   - Consider database full-text search for large datasets

### Performance Targets

| Metric | Target | Current | Notes |
|--------|--------|---------|-------|
| Exact match (cached) | < 50ms | ~20ms | Uses Redis cache |
| Exact match (uncached) | < 200ms | ~150ms | Single DB query |
| Fuzzy match | < 500ms | ~300ms | In-memory fuzzy search |
| Suggestion generation | < 500ms | ~300ms | Same as fuzzy match |

### When to Optimize

Consider optimization when:

1. **Dataset grows > 10,000 IPOs**
   - Implement PostgreSQL full-text search
   - Use `pg_trgm` extension for trigram matching
   - Index `company_name` and `slug` columns

2. **Fuzzy match usage > 10%**
   - Add dedicated fuzzy search cache
   - Pre-compute popular search terms
   - Consider Elasticsearch/Algolia for search

3. **Response time degrades**
   - Profile fuzzy search performance
   - Optimize Fuse.js configuration
   - Implement progressive loading

## Testing

### Running Tests

```bash
# Unit tests
npm run test:unit -- ipo-repository-fuzzy.test.ts

# Watch mode
npm run test:unit:watch -- ipo-repository-fuzzy.test.ts

# Coverage
npm run test:coverage
```

### Test Coverage

Location: `web/tests/unit/lib/repositories/ipo-repository-fuzzy.test.ts`

**Test Cases:**
- ✅ Exact match when slug exists
- ✅ Return null when fuzzy disabled and exact match fails
- ✅ Slug to search term conversion
- ✅ Respect similarity threshold
- ✅ Return results with similarity scores
- ✅ Respect limit parameter
- ✅ Cache search results
- ✅ Return empty array when no matches
- ✅ Generate unique cache keys
- ✅ Handle database errors gracefully
- ✅ Handle Redis errors gracefully
- ✅ Prioritize company name over slug

### Manual Testing

```bash
# Start dev server
npm run dev

# Test exact match (should work)
curl http://localhost:3000/api/ipos/tech-company-ipo

# Test fuzzy match (should fallback and find)
curl http://localhost:3000/api/ipos/tech-company-limited

# Test with no match (should return suggestions)
curl http://localhost:3000/api/ipos/nonexistent-company-xyz

# Test with fuzzy disabled
# (Modify SEARCH_CONFIG.fallback.enabled = false)
```

## Monitoring & Analytics

### Logging

All fuzzy match events are logged with structured context:

```typescript
// Fuzzy match attempt
logger.info({ slug }, '[IPO Repository] Exact slug match failed, trying fuzzy match');

// Fuzzy match success
logger.info({
  slug,
  matchedSlug: 'tech-company-ipo',
  companyName: 'Tech Company Limited',
  similarity: 87,
}, '[IPO Repository] Fuzzy match found');

// Fuzzy match failure
logger.warn({ slug, searchTerm }, '[IPO Repository] No fuzzy matches found');

// Suggestions returned
requestLogger.warn({ slug, suggestionCount: 5 }, 'IPO not found, returning suggestions');
```

### Metrics to Track

1. **Fuzzy Match Usage**
   - Total fuzzy match attempts
   - Success rate (found vs not found)
   - Average similarity score

2. **Performance**
   - Exact match latency (p50, p95, p99)
   - Fuzzy match latency (p50, p95, p99)
   - Cache hit rate

3. **User Behavior**
   - Most searched terms
   - Failed searches (no match)
   - Suggestion click-through rate

### Adding Analytics

To track fuzzy match usage in Google Analytics:

```typescript
// In IPO repository after fuzzy match
if (typeof window !== 'undefined' && window.gtag) {
  window.gtag('event', 'fuzzy_match_used', {
    searched_slug: slug,
    found_slug: bestMatch.item.slug,
    similarity_score: Math.round((1 - (bestMatch.score || 0)) * 100),
  });
}
```

## Troubleshooting

### Issue: Fuzzy match returns wrong IPO

**Symptoms:** Searching for "ABC Corp" returns "XYZ Corp"

**Solutions:**
1. Increase similarity threshold
   ```typescript
   // In web/lib/config/search.ts
   similarityThreshold: 0.7  // Increase from 0.6
   ```

2. Adjust field weights
   ```typescript
   fieldWeights: {
     companyName: 0.8,  // Increase company name weight
     slug: 0.2,         // Decrease slug weight
   }
   ```

3. Check data quality
   - Verify company names are correct in database
   - Ensure slugs follow naming conventions

### Issue: No fuzzy matches found

**Symptoms:** Valid searches return no results

**Solutions:**
1. Lower similarity threshold
   ```typescript
   similarityThreshold: 0.4  // Decrease from 0.6
   ```

2. Check slug transformation
   ```typescript
   // Debug in repository
   console.log('Original slug:', slug);
   console.log('Search term:', searchTerm);
   ```

3. Verify database has data
   ```sql
   SELECT COUNT(*) FROM ipos;
   SELECT * FROM ipos LIMIT 10;
   ```

### Issue: Slow fuzzy search performance

**Symptoms:** Fuzzy match takes > 1 second

**Solutions:**
1. Check dataset size
   ```sql
   SELECT COUNT(*) FROM ipos;
   ```

2. Implement caching
   - Already implemented (5min TTL)
   - Increase TTL if data doesn't change often

3. Consider PostgreSQL full-text search
   ```sql
   -- Add gin index
   CREATE INDEX idx_ipos_company_name_gin ON ipos
   USING gin(to_tsvector('english', company_name));
   ```

4. Profile performance
   ```typescript
   const start = Date.now();
   const results = await searchByName('query');
   console.log(`Fuzzy search took ${Date.now() - start}ms`);
   ```

### Issue: Cache not working

**Symptoms:** Every search hits database

**Solutions:**
1. Check Redis connection
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

2. Verify cache keys
   ```typescript
   // In repository
   console.log('Cache key:', cacheKey);
   const cached = await redis.get(cacheKey);
   console.log('Cached value:', cached);
   ```

3. Check TTL configuration
   ```typescript
   // In web/lib/cache/cache-keys.ts
   export const CacheTTL = {
     IPO_LIST: 900,  // 15 minutes
   };
   ```

## Future Enhancements

### Planned Improvements

1. **Machine Learning Ranking** (Q1 2026)
   - Learn from user click behavior
   - Personalize search results
   - Improve match quality over time

2. **PostgreSQL Full-Text Search** (Q2 2026)
   - Implement when dataset > 10K IPOs
   - Use `pg_trgm` for trigram matching
   - Add GIN indexes for performance

3. **Search Analytics Dashboard** (Q3 2026)
   - Track popular searches
   - Identify failed searches
   - Optimize based on user behavior

4. **Multi-Language Support** (Q4 2026)
   - Support Hindi company names
   - Regional language matching
   - Transliteration support

### Experimental Features

1. **Typo Tolerance**
   - Detect and correct common typos
   - "Tata Steal" → "Tata Steel"

2. **Abbreviation Expansion**
   - "HDFC" → "Housing Development Finance Corporation"
   - "TCS" → "Tata Consultancy Services"

3. **Semantic Search**
   - "fintech companies" → Find all fintech IPOs
   - "pharma sector" → Find all pharmaceutical IPOs

## References

- **Fuse.js Documentation**: https://fusejs.io/
- **PostgreSQL Full-Text Search**: https://www.postgresql.org/docs/current/textsearch.html
- **Cache-Aside Pattern**: `docs/05-caching/CACHING_STRATEGY.md`
- **Issue Tracker**: ISS-027

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2025-10-21 | 1.0.0 | Initial implementation (ISS-027) |

---

**Maintained by:** IPODhan Development Team
**Last Updated:** 2025-10-21
