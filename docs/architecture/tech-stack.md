# Tech Stack

## Technology Stack Table

| Category | Technology | Version | Purpose | Rationale |
|----------|-----------|---------|---------|-----------|
| Frontend Language | TypeScript | 5.3+ | Type-safe frontend development | Catches errors at compile time, improves IDE support |
| Frontend Framework | Next.js | 14.x | React framework with SSG/SSR | SEO optimization, automatic code splitting, ISR for IPO pages |
| UI Component Library | Tailwind CSS + Radix UI | 3.4 + Latest | Styling and accessible components | Rapid development with utility classes, WCAG AA compliance |
| State Management | Zustand | 4.x | Lightweight state management | Simple API, TypeScript support, minimal boilerplate |
| Backend Language | TypeScript/Node.js | 20 LTS | Backend runtime | JavaScript ecosystem, shared types with frontend |
| Backend Framework | Express.js | 4.x | Web application framework | Mature, well-documented, extensive middleware ecosystem |
| API Style | REST | OpenAPI 3.0 | API architecture | Simple integration for B2B partners, well-understood patterns |
| Database | PostgreSQL | 15.x | Primary data store | ACID compliance, complex queries for financial data |
| Cache | Redis | 7.x | In-memory cache | Sub-millisecond response times, pub/sub for real-time |
| File Storage | AWS S3 | - | Document storage | Scalable storage for DRHP PDFs, reports |
| Authentication | JWT + Passport.js | Latest | User authentication | Stateless auth for API scaling, multiple strategies |
| Frontend Testing | Vitest + React Testing Library | Latest | Unit/integration testing | Fast, ESM support, React best practices |
| Backend Testing | Jest + Supertest | 29.x | API testing | Comprehensive testing, request simulation |
| E2E Testing | Playwright | Latest | End-to-end testing | Cross-browser testing, reliable automation |
| Build Tool | Next.js Built-in (Turbopack) | Latest | Frontend bundling | Native Next.js optimization, fast HMR, optimized production builds |
| Bundler | esbuild | Latest | JavaScript bundling | Extremely fast builds for CI/CD |
| IaC Tool | Terraform | 1.6+ | Infrastructure as Code | Multi-cloud support, state management |
| CI/CD | GitHub Actions | - | Continuous Integration | Native GitHub integration, extensive marketplace |
| Monitoring | Sentry + CloudWatch | Latest | Error tracking and metrics | Real-time error alerts, performance monitoring |
| Logging | Winston + CloudWatch Logs | 3.x | Centralized logging | Structured logs, searchable, integrated with AWS |
| CSS Framework | Tailwind CSS | 3.4 | Utility-first CSS | Rapid UI development, consistent design system |
