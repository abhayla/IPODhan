# Development Workflow

## Prerequisites

```bash
# Node.js 20 LTS
node --version  # v20.x.x

# PostgreSQL 16
psql --version  # 16.x

# Redis 7.2
redis-cli --version  # 7.2.x
```

## Initial Setup

```bash
# Clone repository
git clone https://github.com/yourusername/ipodhan.git
cd ipodhan

# Install dependencies
npm install

# Configure environment variables
cp web/.env.example web/.env.local
cp scraper/.env.example scraper/.env

# Create database
psql -U postgres
CREATE DATABASE ipodhan;
CREATE USER ipodhan_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE ipodhan TO ipodhan_user;

# Run migrations
npm run migrate

# Start development
npm run dev:all
```

## Development Commands

```bash
# Start all services
npm run dev:all

# Start frontend only
npm run dev

# Start scraper only
npm run dev:scraper

# Run tests
npm run test
npm run test:unit
npm run test:integration
npm run test:e2e

# Lint and format
npm run lint
npm run format

# Database operations
npm run migrate
npm run db:studio
npm run db:push

# Build for production
npm run build
npm run build:scraper
```

## Environment Configuration

**Frontend (.env.local):**
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- ~~`RESEND_API_KEY`~~ - Email service API key (Phase 2 only)
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` - Google Analytics
- `NEXT_PUBLIC_SENTRY_DSN` - Error tracking
- `JWT_SECRET` - Email verification tokens

**Backend (.env):**
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `IPO_ALERTS_API_KEY` - IPO Alerts API
- `SCRAPER_SCHEDULE` - Cron expression
- ~~`RESEND_API_KEY`~~ - Email service (Phase 2 only)

---
