# IPODhan Codebase Architecture Summary

## Executive Overview

**IPODhan** is a comprehensive IPO (Initial Public Offering) information platform for Indian investors. The codebase is organized as a **TypeScript monorepo** with three main workspaces using npm workspaces and TypeScript project references.

**Core Statistics:**
- **Database**: 13 tables (PostgreSQL 16, Drizzle ORM)
- **Repositories**: 16+ repositories implementing cache-aside pattern
- **Services**: 10+ business logic services
- **API Routes**: 30+ REST endpoints
- **Test Coverage**: 80% (unit/integration), E2E with Playwright (3 browsers)
- **Deployment**: Windows Server 2022 VPS

---

## 1. Project Structure (Monorepo Layout)

```
IPODhan/
├── packages/
│   └── shared/                          # SINGLE SOURCE OF TRUTH
│       ├── src/
│       │   ├── db/
│       │   │   ├── schema.ts           # 13 tables, all enums, relations
│       │   │   ├── index.ts
│       │   │   └── types.ts
│       │   ├── repositories/           # Base repository pattern
│       │   ├── cache/                  # Cache utilities
│       │   ├── utils/slug.ts           # Canonical slug generation
│       │   ├── errors/
│       │   └── index.ts                # Re-exports for workspace
│       └── package.json                # @ipodhan/shared workspace
│
├── web/                                 # Next.js 15.5.4 application
│   ├── app/
│   │   ├── page.tsx                    # Home page
│   │   ├── layout.tsx                  # Root layout
│   │   ├── api/                        # API routes (3-layer architecture)
│   │   ├── ipos/[slug]/                # Detail page (dynamic route)
│   │   ├── mainboard-ipos/             # Category pages
│   │   └── sme-ipos/
│   │
│   ├── lib/
│   │   ├── db/index.ts                 # DB connection, pool, schema re-export
│   │   ├── repositories/               # 16+ repositories extending BaseRepository
│   │   ├── services/                   # Business logic layer
│   │   ├── cache/
│   │   │   ├── redis-client.ts         # Redis singleton with retry
│   │   │   └── cache-keys.ts           # Cache key generators
│   │   └── monitoring/                 # Winston logging, Sentry APM
│   │
│   ├── components/                     # React components
│   ├── tests/
│   │   ├── unit/                       # Vitest (jsdom)
│   │   ├── integration/                # Real DB + Redis
│   │   └── e2e/                        # Playwright (3 browsers)
│   ├── drizzle/                        # Migrations
│   └── package.json
│
├── scraper/                             # Separate service (Data collection)
│   ├── src/
│   │   ├── scrapers/                   # NSE, BSE, Moneycontrol, Chittorgarh
│   │   ├── scheduler/                  # Cron jobs
│   │   └── repositories/               # DB access for scraper
│   └── package.json
│
├── tsconfig.json                        # Root with project references
├── package.json                         # Root workspace config
├── docs/                                # 20+ comprehensive docs
│   ├── 02-architecture/                # Core architecture patterns
│   ├── 05-caching/                     # Cache strategy
│   ├── 07-testing/                     # Testing patterns
│   └── 16-database/                    # Schema, migrations, field mapping
└── CLAUDE.md                            # PROJECT INSTRUCTIONS

```

### Key Principle: Single Source of Truth
- **All database schema** defined in `packages/shared/src/db/schema.ts`
- **All cache logic** in `web/lib/repositories/base-repository.ts`
- **All cache keys** in `web/lib/cache/cache-keys.ts`
- Re-exported through `web/lib/db/index.ts` for application use

