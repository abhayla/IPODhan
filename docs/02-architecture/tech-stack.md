# Tech Stack

This is the **DEFINITIVE technology selection** for IPODhan. All development must use these exact versions.

## Technology Stack Table

| Category | Technology | Version | Purpose | Rationale |
|----------|-----------|---------|---------|-----------|
| **Frontend Language** | TypeScript | 5.3+ | Type-safe frontend development | Prevents runtime errors, improves IDE support, enforces data model contracts |
| **Frontend Framework** | Next.js | 14.2+ | React framework with SSR/SSG | App Router for modern patterns, built-in API routes, excellent SEO, React Server Components |
| **UI Component Library** | shadcn/ui | Latest | Headless UI components | Already integrated, Radix UI primitives (accessibility), Tailwind-native styling |
| **State Management** | React Context | Built-in | Client state management | 🔵 **MVP** - Built-in solution, no extra dependencies, sufficient for filters/search/UI state |
| **Backend Language** | TypeScript (Node.js) | 5.3+ (Node 20 LTS) | Type-safe backend development | Same language as frontend enables code sharing, async I/O, Windows Server compatible |
| **Backend Framework** | Next.js API Routes | 14.2+ | RESTful API endpoints | Co-located with frontend, shared middleware, automatic TypeScript types |
| **API Style** | REST | - | HTTP API design | Simple, widely understood, HTTP caching support (critical for performance) |
| **Database** | PostgreSQL | 16+ | Relational database | Already available on VPS, ACID compliance, excellent full-text search, JSON columns |
| **ORM/Query Builder** | Drizzle ORM | 0.30+ | Type-safe database queries | Lightweight, SQL-like syntax, edge-ready, excellent TypeScript inference |
| **Cache** | Redis | 7.2+ | In-memory data cache | Sub-millisecond latency, reduces PostgreSQL load, pub/sub for real-time updates (Phase 2) |
| **File Storage** | Local Filesystem | - | DRHP PDF storage | Store scraped documents on VPS (free), sufficient for MVP |
| **Authentication** | NextAuth.js | 5.0+ (Auth.js) | User authentication (Phase 2) | Email/password + OAuth providers, session management, Next.js native integration |
| **Frontend Testing** | Vitest | 1.3+ | Component unit tests | Faster than Jest (Vite-based), compatible with Next.js, ESM-native |
| **Backend Testing** | Vitest | 1.3+ | API endpoint tests | Unified testing framework, fast execution, TypeScript-first |
| **E2E Testing** | Playwright | 1.42+ | End-to-end browser tests | Multi-browser support, auto-wait, excellent Windows support |
| **Build Tool** | Next.js CLI | 14.2+ | Production builds | Built-in to Next.js, tree-shaking and code-splitting optimized |
| **Bundler** | Turbopack | Built-in Next.js 14+ | Development bundler | 10x faster than Webpack for dev server |
| **Package Manager** | npm | 10+ | Dependency management | Already used in project, workspaces support for monorepo |
| **CSS Framework** | Tailwind CSS | 3.4+ | Utility-first styling | Already integrated, mobile-first responsive design, shadcn/ui compatible |
| **Data Scraping** | Puppeteer | 22+ | Headless browser scraping | Full JavaScript rendering, screenshot capability, stealth plugin |
| **Scheduled Jobs** | Node-cron | 3.0+ | Cron-based task scheduling | Simple syntax, in-process scheduling, lightweight |
| **API Client** | Native Fetch | Built-in Node 20+ | HTTP requests | No axios dependency needed, standard Web API |
| **Data Validation** | Zod | 3.22+ | Runtime type validation | Parse external API responses safely, validate user input, integrates with Drizzle ORM |
| **Email Service** | TBD (Resend/SendGrid/SES) | Latest | Transactional emails | 🟢 **Phase 2** - Email alerts for IPO notifications; evaluate Resend (3k/mo free), SendGrid (100/day), or AWS SES when implementing |
| **Analytics** | Google Analytics 4 | Latest (GA4) | Web analytics and user tracking | Industry standard, free tier unlimited, comprehensive event tracking, Google Search Console integration |
| **Error Tracking** | Sentry | Latest | Error monitoring | Free tier (5k events/month), source map support, performance monitoring |
| **Code Quality** | ESLint + Prettier | Latest | Linting and formatting | Next.js includes ESLint config, Prettier for consistent formatting |
| **CI/CD** | GitHub Actions | - | Automated testing and deployment | Free for public repos, Windows runner available |
| **Monitoring** | PM2 + Sentry | PM2 5.3+, Sentry Latest | Application monitoring | PM2 logs/metrics for process health, Sentry for error tracking |
| **Logging** | Pino | 8.19+ | Structured JSON logging | Fast (async logging), log levels, integrates with PM2 logs |

---
