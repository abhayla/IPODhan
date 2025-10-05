# IPODhan - IPO Platform MVP

## Overview
IPODhan is a comprehensive IPO (Initial Public Offering) information platform built with Next.js 14, providing real-time IPO data, analysis, and tools for Indian investors.

## Tech Stack
- **Frontend:** Next.js 14 (App Router), React, TypeScript, Tailwind CSS
- **Database:** PostgreSQL 16
- **Cache:** Redis 7.2+
- **ORM:** Drizzle ORM
- **Deployment:** Windows Server 2022 VPS

## Prerequisites
- Node.js 20 LTS or higher
- npm 10+
- PostgreSQL 16+ (VPS or local)
- Redis 7.2+ (for caching)
- Git

## Getting Started

### 1. Clone the Repository
```bash
git clone <repo-url>
cd IPODhan
```

### 2. Install Dependencies
```bash
cd web
npm install
```

### 3. Database Setup

#### Option A: Using VPS PostgreSQL (Configured)
The project is pre-configured to use a VPS PostgreSQL instance at:
- Host: `103.118.16.189`
- Port: `5432`
- Database: `ipodhan`
- User: `postgres`

The database is already created and accessible via the `DATABASE_URL` in `.env.local`.

#### Option B: Using Local PostgreSQL
If you prefer to use a local PostgreSQL instance:

1. Install PostgreSQL 16+
2. Create database:
```bash
psql -U postgres
CREATE DATABASE ipodhan;
CREATE USER ipodhan_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE ipodhan TO ipodhan_user;
\q
```

3. Update `.env.local`:
```env
DATABASE_URL=postgresql://ipodhan_user:your_password@localhost:5432/ipodhan
```

### 4. Environment Configuration
Create or verify `web/.env.local` file:
```env
# Database
DATABASE_URL=postgresql://postgres:***REMOVED-CREDENTIAL***@103.118.16.189:5432/ipodhan

# Application
NODE_ENV=development
NEXT_PUBLIC_APP_NAME=IPODhan
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 5. Test Database Connection
```bash
npm run dev
```

Visit: http://localhost:3000/api/db-test

Expected response:
```json
{
  "success": true,
  "message": "Database connection successful",
  "version": "PostgreSQL 16.8...",
  "timestamp": "..."
}
```

### 6. Run Development Server
```bash
cd web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build production bundle
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript compiler check

## Project Structure
```
IPODhan/
├── web/                    # Next.js application
│   ├── app/               # App Router pages & API routes
│   │   ├── api/          # API endpoints
│   │   │   ├── db-test/  # Database connection test
│   │   │   └── health/   # Health check
│   │   ├── layout.tsx    # Root layout
│   │   └── page.tsx      # Homepage
│   ├── lib/              # Shared utilities
│   ├── public/           # Static assets
│   └── .env.local        # Environment variables
├── docs/                  # Project documentation
│   ├── stories/          # User stories & sprints
│   ├── architecture.md   # Technical architecture
│   └── prd.md           # Product requirements
└── README.md            # This file
```

## Development Workflow

### Sprint 1 - Foundation & Infrastructure
- ✅ Story 1.1: Next.js Project Setup
- ✅ Story 1.2: Database Infrastructure
- 🔜 Story 1.3: Core Dependencies Installation
- 🔜 Story 1.4: shadcn/ui Component Library
- 🔜 Story 1.5: Testing Infrastructure (Vitest + Playwright)
- 🔜 Story 1.6: CI/CD Pipeline

See `docs/stories/SPRINT-1-PLAN.md` for detailed implementation plan.

## Database Status
- ✅ PostgreSQL 16 running on VPS
- ✅ Database "ipodhan" created
- ✅ Connection string configured
- ✅ Test API route working
- ✅ No connection errors

## Troubleshooting

### Database Connection Issues
1. Verify VPS is accessible: `ping 103.118.16.189`
2. Check PostgreSQL is running on VPS
3. Verify credentials in `.env.local`
4. Test connection: `curl http://localhost:3000/api/db-test`

### Development Server Issues
1. Ensure Node.js 20+ is installed: `node --version`
2. Clear cache: `rm -rf .next && npm run dev`
3. Reinstall dependencies: `rm -rf node_modules && npm install`

## Contributing
This is an MVP project under active development. See `docs/stories/` for planned features and current sprint progress.

## License
Proprietary - All rights reserved

---

**Project Start Date:** 2025-10-05
**Current Sprint:** Sprint 1 (Foundation & Infrastructure)
**Status:** In Development
