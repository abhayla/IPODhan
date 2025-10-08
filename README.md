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
DATABASE_URL=postgresql://postgres:Papa3Monu@1234@103.118.16.189:5432/ipodhan

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

### 6. Run Database Migrations
```bash
cd web
npm run db:migrate
```

This will create all necessary database tables and schema.

### 7. Seed Database with Sample Data
```bash
cd web
npm run seed
```

This will populate the database with:
- 20+ sample IPOs (MAINBOARD, SME, RIGHTS, NCD)
- Complete IPO relationships (financials, subscriptions, GMP records, documents)
- 10+ registrars
- 15+ market holidays for 2025
- Broker affiliate links
- Peer comparison data

**Note:** The seed script is idempotent - it will skip seeding if data already exists. To re-seed, truncate tables first.

### 8. Run Development Server
```bash
cd web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Scripts

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build production bundle
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run test:unit` - Run unit tests with Vitest
- `npm run test:integration` - Run integration tests
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:e2e` - Run end-to-end tests with Playwright
- `npm run db:generate` - Generate Drizzle migrations
- `npm run db:migrate` - Run database migrations
- `npm run db:push` - Push schema changes to database
- `npm run db:studio` - Open Drizzle Studio (database GUI)
- `npm run seed` - Seed database with sample data

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

## Production Deployment

### Prerequisites for Production

- Windows Server 2022 VPS (103.118.16.189)
- Node.js 20 LTS
- PostgreSQL 16+
- Redis 7.2+
- PM2 (process manager)
- Git

### Deployment Steps

#### 1. Build Deployment Package

On your local development machine:

```powershell
# Using PowerShell (Windows)
.\scripts\create-deployment-package.ps1

# Or using Bash (Git Bash/WSL)
./scripts/create-deployment-package.sh
```

This will create `ipodhan-deployment-{timestamp}.zip` containing:
- Built Next.js web application
- Built scraper service
- PM2 configuration
- Environment template
- Deployment documentation

#### 2. Transfer to VPS

```powershell
# Using RDP: Copy the .zip file via Remote Desktop
# Or using SCP:
scp ipodhan-deployment-*.zip user@103.118.16.189:C:\deployments\
```

#### 3. Extract and Setup on VPS

```powershell
# Extract deployment package
Expand-Archive ipodhan-deployment-*.zip

# Navigate to deployment folder
cd ipodhan-deployment-*

# Install production dependencies
cd web
npm ci --production
cd ..

cd scraper
npm ci --production
cd ..
```

#### 4. Configure Environment

```powershell
# Copy environment template
Copy-Item .env.production.template .env.production

# Edit with production values
notepad .env.production
```

Required environment variables:
- `DATABASE_HOST=103.118.16.189`
- `DATABASE_PASSWORD=<production-password>`
- `REDIS_HOST=103.118.16.189`
- `REDIS_PASSWORD=<redis-password>`
- `NEXT_PUBLIC_GA_MEASUREMENT_ID=<google-analytics-id>`

See `.env.production.template` for complete list.

#### 5. Start Services with PM2

```powershell
# Install PM2 globally (if not installed)
npm install -g pm2

# Start all services
pm2 start ecosystem.config.js

# Save PM2 process list
pm2 save

# Setup PM2 to start on system boot
pm2 startup

# Verify services are running
pm2 status
```

Expected output:
```
┌─────┬────────────────────┬─────────┬─────────┬──────────┐
│ id  │ name               │ mode    │ status  │ memory   │
├─────┼────────────────────┼─────────┼─────────┼──────────┤
│ 0   │ ipodhan-web        │ cluster │ online  │ 150M     │
│ 1   │ ipodhan-web        │ cluster │ online  │ 145M     │
│ 2   │ ipodhan-scraper    │ fork    │ online  │ 80M      │
└─────┴────────────────────┴─────────┴─────────┴──────────┘
```

#### 6. Verify Deployment

```powershell
# Test health endpoint
curl http://localhost:3000/api/health

# Expected response:
# {
#   "status": "healthy",
#   "timestamp": "...",
#   "services": {
#     "database": "healthy",
#     "redis": "healthy"
#   }
# }

# Test application in browser
# http://103.118.16.189:3000
```

### Monitoring & Maintenance

#### PM2 Commands

```powershell
# View logs
pm2 logs

# View logs for specific app
pm2 logs ipodhan-web
pm2 logs ipodhan-scraper

# Monitor real-time metrics
pm2 monit

# Restart services
pm2 restart all
pm2 restart ipodhan-web
pm2 restart ipodhan-scraper

# Stop services
pm2 stop all

# Delete from PM2
pm2 delete all
```

#### Log Files

PM2 logs are stored in:
- `./logs/web-error.log` - Web application errors
- `./logs/web-out.log` - Web application output
- `./logs/scraper-error.log` - Scraper errors
- `./logs/scraper-out.log` - Scraper output

#### Health Checks

Monitor application health:
- **Endpoint:** `GET /api/health`
- **Success:** Returns `200` with `status: "healthy"`
- **Failure:** Returns `503` with service-specific errors

Setup UptimeRobot or similar service to monitor:
- URL: `http://103.118.16.189:3000/api/health`
- Interval: Every 5 minutes
- Alert: Email on 3 consecutive failures

### Rollback Procedure

See `docs/deployment/ROLLBACK.md` for detailed rollback steps.

Quick rollback:
```powershell
# Stop current deployment
pm2 stop all

# Restore previous deployment
cd ..\ipodhan-deployment-{previous-timestamp}
pm2 start ecosystem.config.js
pm2 save
```

### Troubleshooting

#### Application Won't Start
1. Check PM2 logs: `pm2 logs`
2. Verify environment variables in `.env.production`
3. Test database connection: `psql -h 103.118.16.189 -U postgres -d ipodhan`
4. Test Redis connection: `redis-cli -h 103.118.16.189 ping`

#### High Memory Usage
1. Check PM2 status: `pm2 status`
2. Restart services: `pm2 restart all`
3. Review `max_memory_restart` in `ecosystem.config.js`

#### Scraper Not Running
1. Check scraper logs: `pm2 logs ipodhan-scraper`
2. Verify cron schedule: `0 3 * * *` (3 AM daily)
3. Manual trigger: `pm2 restart ipodhan-scraper`

#### Database Connection Errors
1. Verify PostgreSQL is running
2. Check firewall allows port 5432
3. Test connection: `curl http://localhost:3000/api/health`

### Deployment Checklist

See `docs/deployment/DEPLOYMENT-CHECKLIST.md` for complete pre-deployment checklist.

---

## License
Proprietary - All rights reserved

---

**Project Start Date:** 2025-10-05
**Current Sprint:** Sprint 1 (Foundation & Infrastructure)
**Status:** In Development
