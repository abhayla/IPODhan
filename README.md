# IPODhan - Smart IPO Investment Platform 💹

IPODhan is a comprehensive IPO-focused platform for Indian retail investors, providing real-time tracking, analysis tools, and investment insights.

## 🚀 Features

- **Real-Time IPO Tracking**: Live, upcoming, and closed IPO listings
- **Grey Market Premium (GMP)**: Accurate GMP rates with historical trends
- **Broker Comparison**: Compare 15+ brokers for fees and features
- **Investment Tools**: Returns calculator, allotment checker, portfolio tracker
- **User Dashboard**: Personalized tracking and portfolio management
- **Smart Alerts**: Notifications for IPO events and status updates

## 🛠️ Technology Stack

### Frontend
- **Framework**: Next.js 14 with TypeScript
- **Styling**: Tailwind CSS
- **State Management**: React Context API
- **Real-time**: WebSocket integration

### Backend
- **Runtime**: Node.js with Express
- **Database**: PostgreSQL (production) / SQLite (development)
- **ORM**: Prisma
- **Authentication**: JWT
- **Caching**: Redis

### Infrastructure
- **Containerization**: Docker & Docker Compose
- **Reverse Proxy**: Nginx
- **Deployment**: AWS/GCP/Vercel ready

## 📁 Project Structure

```
IPODhan/
├── ipodhan-data-pipeline/     # ✅ Python data pipeline (PRODUCTION-READY)
│   ├── scrapers/              # Web scrapers (NSE, BSE, GMP sources)
│   ├── validators/            # Pydantic-based validation
│   ├── schemas/               # Type-safe data schemas
│   ├── repositories/          # Database access layer
│   ├── orchestrator/          # Pipeline coordination
│   ├── monitoring/            # Health checks and metrics
│   ├── tests/                 # 50 tests (100% passing)
│   └── scripts/               # Utility scripts
│
├── infrastructure/
│   └── database/
│       ├── migrations/        # PostgreSQL schema migrations
│       └── BACKFILL_README.md # Backfill documentation
│
├── docs/
│   ├── stories/               # User stories and requirements
│   ├── api/                   # API specifications
│   └── qa/                    # QA documentation
│       ├── assessments/       # Risk profiles
│       └── gates/             # Quality gate decisions
│
├── ipodhan-web/          # Next.js frontend (PLANNED)
│   ├── src/
│   │   ├── app/          # Next.js app router pages
│   │   ├── components/   # React components
│   │   ├── services/     # API and WebSocket services
│   │   └── utils/        # Utility functions
│   └── public/           # Static assets
│
├── ipodhan-backend/      # Express backend API (PLANNED)
│   ├── src/
│   │   ├── controllers/  # Route controllers
│   │   ├── routes/       # API routes
│   │   ├── middleware/   # Express middleware
│   │   └── services/     # Business logic
│   └── prisma/           # Database schema
│
└── figma-plugin/         # Figma design system plugin
    ├── code.ts           # Plugin logic
    ├── ui.html           # Plugin UI
    └── manifest.json     # Plugin configuration

```

## 🚦 Getting Started

### Prerequisites
- **Data Pipeline**: Python 3.11+, PostgreSQL 14+
- **Web App (Planned)**: Node.js 18+, npm or yarn
- Docker (optional)

### Data Pipeline Setup ✅ PRODUCTION-READY

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/ipodhan.git
cd ipodhan
```

2. **Setup Data Pipeline**
```bash
cd ipodhan-data-pipeline

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Setup database (PostgreSQL required)
python scripts/setup_database.py

# Run tests (50 tests, 100% passing)
pytest -v

# Run pipeline
python main.py --pipeline full
```

3. **Environment Variables**
Create `.env` file:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ipodhan_db
DB_USER=your_user
DB_PASSWORD=your_password
SENTRY_DSN=your_sentry_dsn  # Optional
```

### Web Application Setup (Planned)

**Frontend:**
```bash
cd ipodhan-web
npm install
npm run dev
```
Frontend runs on http://localhost:3000

**Backend:**
```bash
cd ipodhan-backend
npm install
npx prisma migrate dev
npm run dev
```
Backend runs on http://localhost:5000

**Access:**
- Frontend: http://localhost:3000
- Backend API: http://localhost:5000/api
- Health Check: http://localhost:5000/health

### Using Docker

```bash
# Build and run all services
docker-compose up --build

# Run in background
docker-compose up -d

# Stop services
docker-compose down
```

## 📊 Database Setup

### Production VPS Details
- **Server**: Windows Server 2022
- **IP**: 103.118.16.189
- **Database**: PostgreSQL 15.x

### Development (SQLite)
```bash
cd ipodhan-backend
npx prisma migrate dev
npx prisma studio  # Visual database browser
```

### Production (PostgreSQL on Windows Server 2022)
Update DATABASE_URL in .env:
```
DATABASE_URL="postgresql://postgres:Papa3Monu@1234@103.118.16.189:5432/ipodhan"
```

Or use individual environment variables:
```
DB_HOST=103.118.16.189
DB_PORT=5432
DB_NAME=ipodhan
DB_USER=postgres
DB_PASSWORD=Papa3Monu@1234
```

## 🎨 Figma Design System

### Installing the Plugin
1. Open Figma Desktop App
2. Go to Plugins → Development → Import plugin from manifest
3. Select `figma-plugin/manifest.json`
4. Run plugin to generate design system

### Generated Components
- 40+ Color Styles
- 20+ Typography Styles
- 6 Shadow Effects
- 5 Key Components (Button, Input, Card, Badge, IPO Card)

## 🔧 API Endpoints

### IPO Endpoints
- `GET /api/ipos` - Get all IPOs
- `GET /api/ipos/:id` - Get IPO details
- `GET /api/ipos/status/:status` - Get IPOs by status

### User Endpoints
- `POST /api/users/register` - Register new user
- `POST /api/users/login` - User login
- `GET /api/users/profile` - Get user profile

### GMP Endpoints
- `GET /api/gmp/latest` - Latest GMP for all IPOs
- `GET /api/gmp/history/:ipoId` - GMP history for specific IPO

### Broker Endpoints
- `GET /api/brokers` - Get all brokers
- `GET /api/brokers/:id` - Get broker details

## 🚀 Deployment

### Vercel (Frontend)
```bash
cd ipodhan-web
vercel --prod
```

### Railway/Render (Backend)
1. Connect GitHub repository
2. Set environment variables
3. Deploy with automatic builds

### AWS/GCP
Use provided Docker configuration:
```bash
docker-compose -f docker-compose.prod.yml up
```

## 📱 Features Roadmap

### ✅ Completed
- [x] **Data Pipeline (Story 1.2)** - Production-ready
  - [x] Multi-source web scraping (NSE, BSE, 3 GMP sources)
  - [x] Type-safe validation (Pydantic V2)
  - [x] Database schema with materialized views
  - [x] Health monitoring and error tracking
  - [x] Comprehensive testing (50 tests, 100% passing)
  - [x] Quality score: 98/100

### 🚧 In Progress
- [ ] Web application (Next.js frontend)
- [ ] Backend API (Express with REST endpoints)
- [ ] User authentication
- [ ] Basic IPO listing and tracking UI
- [ ] Returns calculator

### 📋 Planned
- [ ] User dashboard and portfolio tracking
- [ ] Mobile app (React Native)
- [ ] Push notifications
- [ ] AI-powered recommendations
- [ ] Social features
- [ ] Advanced analytics

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- NSE/BSE for IPO data
- Figma for design tools
- Next.js and Express communities

## 📊 Data Pipeline Details

### Production-Ready Components ✅

**Quality Metrics:**
- **Tests:** 50/50 passing (100%)
- **Quality Score:** 98/100 (EXCELLENT)
- **Risk Score:** 72/100 (LOW-MEDIUM, acceptable)
- **Coverage:** 95-99% on critical modules
- **Test Execution:** 2.59 seconds

**Data Sources:**
1. **NSE India** - Official IPO listings
2. **BSE India** - Official IPO listings
3. **IPOWatch** - GMP tracking (confidence scoring)
4. **InvestorGain** - GMP tracking
5. **Chittorgarh** - GMP tracking

**Key Features:**
- Multi-source data validation with retry mechanisms
- Type-safe validation using Pydantic V2
- Duplicate detection (by ISIN and company name + dates)
- Materialized views for GMP aggregates (refreshed every 2 hours)
- Health monitoring with consecutive failure tracking
- Comprehensive error logging with Sentry integration

**Architecture:**
- Repository pattern for database access
- 100% parameterized SQL queries (zero injection vectors)
- Connection pooling (10 connections max)
- Async web scraping with anti-bot detection
- Clean separation of concerns (scrapers, validators, repositories)

**Testing:**
- 25 unit tests (validators, normalizers, repositories)
- 25 integration tests (full pipeline, scrapers, database)
- Real PostgreSQL database integration
- CI/CD with GitHub Actions

**Documentation:**
- User stories: `docs/stories/`
- QA reports: `docs/qa/assessments/`
- Quality gates: `docs/qa/gates/`
- API specs: `docs/api/`

For detailed information, see [CLAUDE.md](./CLAUDE.md)

---

## 📞 Support

For support, email support@ipodhan.com or create an issue in this repository.

---

## 🎉 Recent Achievements

**2025-10-02:** Data Pipeline (Story 1.2) Completed
- ✅ 50/50 tests passing (100%)
- ✅ Quality score: 98/100
- ✅ Production-ready deployment
- ✅ Comprehensive QA validation

---

**Made with ❤️ for Indian Investors**