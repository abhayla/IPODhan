# Testing Strategy

## Testing Pyramid

```
         E2E Tests (10%)
        /              \
     Integration (20%)
    /                  \
   Unit Tests (70%)
```

## Test Organization

**Unit Tests (Vitest):**
- `tests/unit/components/` - React component tests
- `tests/unit/lib/repositories/` - Repository tests
- `tests/unit/lib/services/` - Service tests

**Integration Tests (Vitest):**
- `tests/integration/api/` - API route tests with real DB/Redis

**E2E Tests (Playwright):**
- `tests/e2e/` - Critical user flows (browsing, search, subscription)

## Coverage Targets

| Category | Target |
|----------|--------|
| Repository Layer | >90% |
| API Routes | >85% |
| React Components | >80% |
| Overall | >80% |

---
