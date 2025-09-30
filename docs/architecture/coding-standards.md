# Coding Standards

## Critical Fullstack Rules

- **Type Sharing:** Always define types in ipodhan-shared and import from there
- **API Calls:** Never make direct HTTP calls - use the service layer
- **Environment Variables:** Access only through config objects, never process.env directly
- **Error Handling:** All API routes must use the standard error handler
- **State Updates:** Never mutate state directly - use proper state management patterns
- **Database Access:** Always use repository pattern, never raw SQL in controllers
- **Caching:** Check cache before database for all read operations
- **Validation:** Validate all user input at API boundary using Joi schemas
- **Logging:** Use structured logging with correlation IDs for tracing
- **Testing:** Minimum 70% code coverage, 100% for critical paths

## Naming Conventions

| Element | Frontend | Backend | Example |
|---------|----------|---------|---------|
| Components | PascalCase | - | `UserProfile.tsx` |
| Hooks | camelCase with 'use' | - | `useAuth.ts` |
| API Routes | - | kebab-case | `/api/user-profile` |
| Database Tables | - | snake_case | `user_profiles` |
