# Development Workflow

## Local Development Setup

### Prerequisites
```bash
# Required software
node --version  # v20 LTS required
python --version  # 3.11+ required
docker --version  # Docker Desktop required
pnpm --version  # pnpm recommended

# Install pnpm if not present
npm install -g pnpm
```

### Initial Setup
```bash
# Clone repository
git clone https://github.com/ipodhan/ipodhan.git
cd ipodhan

# Install shared dependencies
cd ipodhan-shared && pnpm install && pnpm build && cd ..

# Setup frontend
cd ipodhan-web
pnpm install
cp .env.example .env.local
cd ..

# Setup backend
cd ipodhan-backend
pnpm install
cp .env.example .env
cd ..

# Setup Python services
cd ipodhan-data-pipeline
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ..

# Start databases with Docker
docker-compose up -d postgres redis

# Run database migrations
cd ipodhan-backend
pnpm run db:migrate
cd ..
```

### Development Commands
```bash
# Start all services
docker-compose up

# Start frontend only
cd ipodhan-web && pnpm dev

# Start backend only
cd ipodhan-backend && pnpm dev

# Run tests
pnpm test           # All tests
pnpm test:unit      # Unit tests only
pnpm test:e2e       # E2E tests
```

## Environment Configuration

### Required Environment Variables
```bash
# Frontend (.env.local)
NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_WS_URL=ws://localhost:4000
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX

# Backend (.env)
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://user:pass@localhost:5432/ipodhan
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_WHATSAPP_NUMBER=+14155238886

# Shared
API_KEY_SALT=your-salt
ENCRYPTION_KEY=your-encryption-key
```
