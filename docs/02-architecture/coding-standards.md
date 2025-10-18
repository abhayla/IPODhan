# Coding Standards

## Critical Fullstack Rules

- **Type Sharing:** Define types in `packages/shared/src/types/` only
- **API Calls:** Use API client service, never direct fetch()
- **Environment Variables:** Access through typed config objects
- **Error Handling:** All API routes use `withErrorHandler` middleware
- **State Updates:** Never mutate state directly
- **Database Queries:** Always use Repository layer
- **Input Validation:** Validate with Zod schemas
- **Cache Invalidation:** Explicit Redis key deletion on updates

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Components | PascalCase | `IPOCard.tsx` |
| Hooks | camelCase with 'use' | `useIPOFilters.ts` |
| API Routes | kebab-case | `/api/ipos/[slug]` |
| Database Tables | snake_case | `ipos`, `subscriptions`, `gmp_records` |
| TypeScript Interfaces | PascalCase | `IPO`, `Subscription` |

---
