# IPODhan Product Requirements Document (PRD)

**Version:** 1.0
**Date:** January 28, 2025
**Author:** John (PM)
**Approach:** User-First 2.0 (Sustainable Growth)

## Table of Contents
1. [Goals and Background Context](#goals-and-background-context)
2. [Requirements](#requirements)
3. [User Interface Design Goals](#user-interface-design-goals)
4. [Technical Assumptions](#technical-assumptions)
5. [Epic List](#epic-list)
6. [Epic Details](#epic-details)

---

## Goals and Background Context

### Goals
- Achieve 100 active WhatsApp users in 4 weeks to validate demand for simplified IPO intelligence
- Transform complex IPO data into a single 0-100 actionable score that enables instant investment decisions
- Build intelligence API infrastructure generating ₹10 lakhs MRR within 6 months via B2B partnerships
- Reach 1 million end users by Month 12 through direct WhatsApp and indirect API channels
- Establish "IPODhan Score" as industry standard with 3+ major media citations by Year 2
- Enable 10,000+ first-time IPO investors through radical simplification

### Background Context

IPODhan addresses the critical problem that 95% of Indian demat account holders never participate in IPOs due to overwhelming complexity and information overload. Current platforms present 500+ data points per IPO, require 2-4 hours of research time, and assume financial expertise that most retail investors lack. By transforming all this complexity into a single 0-100 score delivered via WhatsApp—where users already spend their time—IPODhan eliminates the learning curve entirely. The solution follows a progressive enhancement strategy: starting as a comprehensive web platform with WhatsApp integration, evolving into B2B2C API infrastructure, and ultimately becoming an ubiquitous intelligence layer powering IPO decisions across all platforms.

### Change Log
| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2025-01-28 | 1.0 | Initial PRD creation based on Project Brief | John (PM) |
| 2025-01-28 | 1.1 | Updated with User-First 2.0 approach and story refinements | John (PM) |

---

## Requirements

### Functional Requirements

**Stage 1: Web Platform + API + WhatsApp MVP (Month 1-3)**

*Core Platform Features:*
- **FR1:** Web dashboard displaying Live/Upcoming/Closed IPOs with real-time updates from NSE/BSE feeds
- **FR2:** Calculate and display IPODhan Score (0-100) using comprehensive weighted algorithm
- **FR3:** IPO detail pages with score breakdown, subscription status, GMP tracking, and key financials
- **FR4:** Morning digest feature aggregating overnight changes, today's actions, market sentiment
- **FR5:** IPO watchlist for users to track selected IPOs with customizable alerts
- **FR6:** Basic search and filters (mainboard/SME, date range, sector, score range)

*WhatsApp Integration:*
- **FR7:** WhatsApp Business API integration for push notifications and alerts
- **FR8:** Daily broadcast with IPO verdicts: "[Name] ✅ Apply (Score: X/100)" or "❌ Skip"
- **FR9:** Subscription-based WhatsApp alerts (₹29-49/month) for GMP updates, deadlines

*API Infrastructure:*
- **FR10:** REST API endpoints for IPO scores, subscription data, GMP (B2B partnerships)
- **FR11:** API authentication with tiered access (₹10K-₹2L/month pricing tiers)
- **FR12:** Webhook support for real-time updates to partner platforms

**Stage 2: Full Platform Enhancement (Month 4-9)**

- **FR13:** IPO Report Cards with A-F grades analyzing post-listing performance
- **FR14:** Comprehensive broker comparison module with detailed fee structures
- **FR15:** Demat account opening facilitation through affiliate partnerships
- **FR16:** Allotment probability calculator based on historical data and current subscription
- **FR17:** ROI calculator for expected vs actual returns analysis
- **FR18:** In-app IPO application capability via broker APIs (Zerodha, Dhan, Upstox)
- **FR19:** Portfolio tracker for IPO investments with performance analytics
- **FR20:** Knowledge hub with guides, SEBI rules, educational content
- **FR21:** Community forums for IPO discussions (moderated)
- **FR22:** Mobile apps (iOS/Android) using React Native

### Non-Functional Requirements

**Performance & Scale**
- **NFR1:** Page load time <2 seconds with CDN optimization
- **NFR2:** Support 100,000 concurrent users from launch
- **NFR3:** API response time <100ms for 95th percentile
- **NFR4:** Real-time updates via WebSockets for subscription status

**Reliability & Operations**
- **NFR5:** 99.5% uptime with auto-scaling and redundancy
- **NFR6:** WhatsApp message delivery rate >95%
- **NFR7:** Daily automated backups with 30-day retention
- **NFR8:** Comprehensive error logging and monitoring

**Business Metrics**
- **NFR9:** Customer acquisition cost <₹50 for direct users
- **NFR10:** IPODhan Score accuracy >70% correlation with listing performance
- **NFR11:** Support tickets <1% of user base
- **NFR12:** Weekly Active Decision Makers as north star metric

**Security & Compliance**
- **NFR13:** SEBI regulatory compliance for all recommendations
- **NFR14:** HTTPS/TLS encryption for all communications
- **NFR15:** OAuth2 + 2FA for user authentication
- **NFR16:** Transparent affiliate disclosures
- **NFR17:** GDPR-compliant privacy practices

---

## User Interface Design Goals

### Overall UX Vision
IPODhan's interface philosophy centers on **"Progressive Disclosure"** - starting with a single decision point (Apply/Skip) in WhatsApp, then revealing more depth only when users seek it. The UI should feel like a trusted advisor simplifying complex decisions, not a data dashboard overwhelming with metrics.

### Key Interaction Paradigms
- **Binary First**: Lead with clear YES/NO recommendations before showing supporting data
- **Thumb-Friendly**: All critical actions accessible with one-thumb mobile navigation
- **Glanceable Information**: Key insights visible in 3-second scan (traffic light colors, A-F grades)
- **Push Over Pull**: Proactive notifications via WhatsApp/app rather than requiring user visits
- **Trust Through Transparency**: Admit uncertainty with "Borderline" labels, show crowd wisdom

### Core Screens and Views

**Stage 1 (Web + WhatsApp):**
- Home Dashboard (Today's IPOs with scores)
- IPO Detail Page (Score breakdown, apply buttons)
- My Watchlist (Tracked IPOs)
- WhatsApp Chat Interface
- Morning Digest Template

**Stage 2 (Full Platform):**
- Report Cards (Post-listing grades)
- Broker Comparison Table
- Community Forums
- Mobile App Screens
- Settings/Preferences

### Accessibility
**WCAG AA** compliance with specific focus on:
- High contrast for score displays (green/red colorblind-safe)
- Large touch targets (minimum 44px) for mobile
- Screen reader support for scores and recommendations

### Branding
- **Visual Identity**: Clean, trustworthy, approachable (not corporate/intimidating)
- **Color Palette**:
  - Primary: Trust Blue (#2563EB)
  - Success: Growth Green (#10B981)
  - Warning: Caution Amber (#F59E0B)
  - Background: Clean White/Light Gray
- **Typography**: Clear sans-serif (Inter/Roboto) with strong hierarchy
- **Score Display**: Large, bold numbers with color coding (70+ green, 40-69 yellow, <40 red)

### Target Device and Platforms
**Web Responsive** initially, with progressive enhancement to:
- WhatsApp (primary channel)
- Mobile Web (PWA capable)
- Native Mobile Apps (React Native, Month 9+)
- API/Widget embeds for partner sites

---

## Technical Assumptions

### Repository Structure
**Polyrepo with Clear Service Boundaries** - Each service has its own repository for independent deployment and scaling:
- `ipodhan-data-pipeline` - IPO data ingestion service
- `ipodhan-score-engine` - Score calculation and ML models
- `ipodhan-web` - User-facing web dashboard
- `ipodhan-api` - Public REST API for partners
- `ipodhan-notifications` - Multi-channel notification orchestrator
- `ipodhan-shared` - Shared types, utilities, constants (NPM package)

### Service Architecture

**Core Services (Must Have Day 1):**

**IPO Data Ingestion Service**
- Python/FastAPI with scheduled jobs (every 15 minutes) via Windows Task Scheduler
- Scrapes/fetches from NSE/BSE/SEBI sources
- Validates and normalizes data
- Publishes to PostgreSQL 16 + Redis cache
- Runs as Windows Service for reliability
- Can fail without affecting user experience

**Score Calculation Engine**
- Python-based for data science flexibility
- Batch process running 3x daily (8 AM, 12 PM, 5 PM)
- Calculates 0-100 scores using weighted algorithm
- Publishes scores to Redis for fast retrieval
- Versioned algorithm for A/B testing

**Notification Orchestrator**
- Node.js worker service with Bull/BullMQ queues
- Multi-channel support (WhatsApp, SMS, Email, Push)
- Template management and personalization
- Retry logic with exponential backoff
- Rate limiting per channel

**User-Facing Services:**

**Web Dashboard**
- Next.js with Static Site Generation for IPO pages
- Client-side real-time updates via WebSocket/SSE
- Progressive Web App capabilities
- Incremental Static Regeneration every 5 minutes

**Public API**
- Node.js/Fastify for high performance
- Read-only endpoints for partner integration
- Redis-cached responses (1-minute TTL)
- API key authentication with rate limiting
- Simple REST, no GraphQL complexity

### Testing Requirements

**Service-Specific Testing Strategy:**
- **Data Pipeline**: Integration tests with mock data sources, data validation tests
- **Score Engine**: Unit tests for algorithm, regression tests for score consistency
- **Web Dashboard**: Component tests, visual regression tests, Core Web Vitals monitoring
- **API**: Contract tests, load tests for 10K requests/second
- **Notifications**: Mock channel tests, delivery confirmation tests

### Additional Technical Assumptions and Requests

**Data Layer:**
- **PostgreSQL 16**: Master data for IPOs, users, transactions
  - Latest stable version for enhanced performance and security
  - Advanced indexing capabilities for faster query performance
  - Improved partitioning support for time-series data
- **Redis**: Hot cache for scores, session management
- **TimescaleDB**: Time-series extension on PostgreSQL 16 for GMP history
- **S3**: Document storage (DRHP PDFs, reports)

**Infrastructure Choices:**
- **Operating System**: Windows Server 2022 Datacenter Edition
  - Latest long-term support release
  - Enhanced security features and container support
  - Optimized for cloud and on-premise deployments
  - Native support for .NET applications
- **Web Hosting**: IIS on Windows Server 2022 with Application Request Routing (ARR) for load balancing
  - Support for Node.js applications via iisnode
  - URL rewriting and reverse proxy capabilities
- **Database Hosting**: PostgreSQL 16 on Windows Server 2022
  - Native Windows installation with pgAdmin 4
  - Automated backup via Windows Server Backup
  - High availability configuration using streaming replication
- **API Hosting**: IIS with Node.js runtime on Windows Server 2022
- **Background Jobs**: Windows Task Scheduler for job orchestration
- **Message Queue**: Azure Service Bus or MSMQ for Windows-native queuing

**Monitoring & Observability:**
- Windows Performance Monitor for system metrics
- Application Insights for application monitoring
- Sentry for error tracking across services
- Mixpanel for product analytics
- Custom dashboard for business metrics
- Windows Event Log integration for centralized logging

**Windows Server 2022 Specific Optimizations:**
- **Security Enhancements:**
  - Windows Defender Advanced Threat Protection
  - Credential Guard for credential protection
  - Device Guard for application control
  - BitLocker for disk encryption
  - Windows Firewall with Advanced Security
- **Performance Optimizations:**
  - IIS Application Pool optimization
  - PostgreSQL 16 Windows-specific tuning
  - NUMA-aware memory allocation
  - Storage Spaces Direct for high-performance storage
  - Network optimization with SMB Direct

**Development Workflow:**
- GitHub with separate repos per service
- Service-specific CI/CD pipelines
- Windows Server 2022 development environment setup:
  - Visual Studio 2022 for .NET components
  - VS Code for Node.js/Python development
  - Windows Subsystem for Linux (WSL2) for Linux-based tools
- Docker Desktop for Windows for containerized development
- PowerShell scripts for deployment automation
- Service mesh for local inter-service communication

**External Integration Strategy:**
- **NSE/BSE**: Web scraping with Puppeteer fallback
- **WhatsApp**: Twilio/Gupshup Business API
- **SMS**: 2Factor/Textlocal for India
- **Payments**: Razorpay for subscriptions
- **Brokers**: REST APIs (Zerodha, Dhan) for Stage 2

---

## Epic List

**MVP-First Approach: Competitor Parity with Free Access**

**Epic 1: Core Platform & Data Foundation (MVP)** - Launch comprehensive IPO platform with all competitor features, completely free and no registration required (Month 1-2)

**Epic 2: Mobile PWA Implementation (MVP)** - Progressive Web App for mobile users with offline capabilities and app-like experience (Month 1-2, parallel)

**Epic 3: Calculators & Tools (MVP)** - Essential calculators and broker comparison tools for investor decision-making (Month 1-2, parallel)

**Epic 4: User Accounts & Monetization (POST-MVP)** - Add registration, personalization, and revenue features after proving value (Month 3-4)

**Epic 5: Community & Engagement (POST-MVP)** - Build user-generated content and community features for retention (Month 4-5)

**Epic 6: WhatsApp & Notifications (POST-MVP)** - Multi-channel engagement and premium alert services (Month 5-6)

**Epic 7: Scale & Optimization (POST-MVP)** - Infrastructure optimization and performance improvements for growth (Month 6+)

---

## Epic Details

### Epic 1: Foundation with Monetization DNA

**Goal:** Launch a free web platform that establishes payment behavior from Day 1 through a ₹1 symbolic fee, while delivering immediate value through IPO tracking and scoring.

#### Story 1.0: Windows Server 2022 Environment Setup (NEW - BLOCKER)
**As a** DevOps engineer,
**I want** to set up and configure Windows Server 2022 infrastructure,
**so that** we have a robust platform for hosting all services.

**Acceptance Criteria:**
1. **Windows Server 2022 Installation:**
   - Windows Server 2022 Datacenter Edition installed
   - All security updates and patches applied
   - Remote Desktop and PowerShell remoting configured
   - Windows Firewall with Advanced Security configured
   - BitLocker encryption enabled for data drives

2. **IIS Configuration:**
   - IIS 10.0 installed with all required modules
   - Application Request Routing (ARR) configured for load balancing
   - URL Rewrite module installed
   - iisnode installed for Node.js application hosting
   - Application pools configured with optimal settings
   - SSL certificates configured

3. **PostgreSQL 16 Setup:**
   - PostgreSQL 16 native Windows installation completed
   - pgAdmin 4 installed and configured
   - PgBouncer installed for connection pooling
   - Initial performance tuning completed:
     - shared_buffers: 25% of RAM
     - effective_cache_size: 75% of RAM
     - max_connections: 200 (via PgBouncer)
   - Streaming replication configured for HA
   - Automated backup via Windows Server Backup configured

4. **Supporting Services:**
   - Redis installed (via Windows port or Docker)
   - Windows Task Scheduler configured for job orchestration
   - PowerShell DSC (Desired State Configuration) setup
   - Windows Service wrappers created for Python services

5. **Security Configuration:**
   - Windows Defender Advanced Threat Protection enabled
   - Credential Guard configured
   - Device Guard for application control
   - Security baselines applied
   - Audit logging enabled

**Priority:** 🔴 BLOCKER - Must complete before any other stories
**Dependencies:** None
**Effort:** 8 points

#### Story 1.0a: PostgreSQL 16 Performance Validation (NEW - CRITICAL)
**As a** technical lead,
**I want** to validate PostgreSQL 16 performance on Windows Server 2022,
**so that** we ensure the database meets our performance requirements.

**Acceptance Criteria:**
1. **Performance Benchmarking:**
   - Baseline benchmarks established (Windows native vs WSL2)
   - Target: 5,000 read queries/second achieved
   - Target: 1,000 write queries/second achieved
   - Query response time p95 < 100ms validated

2. **High Availability Testing:**
   - Streaming replication lag < 1 second
   - Automatic failover completed in < 30 seconds
   - Point-in-time recovery tested and documented

3. **Connection Pool Optimization:**
   - PgBouncer configured and stress tested
   - Optimal pool size determined
   - Connection timeout scenarios handled

4. **Backup and Recovery:**
   - Full backup completed in < 30 minutes
   - Incremental backups working
   - Restore procedures validated
   - Backup retention policy implemented

**Priority:** 🔴 CRITICAL
**Dependencies:** Story 1.0
**Effort:** 5 points

#### Story 1.1: Core Infrastructure Setup (DETAILED)
**As a** developer,
**I want** to set up the basic project infrastructure with CI/CD pipeline,
**so that** we can deploy code reliably and quickly.

**Detailed Acceptance Criteria:**

**1. Git Repository Structure:**
```
ipodhan/
├── services/
│   ├── data-pipeline/      # Python service for data ingestion
│   │   ├── scrapers/       # NSE/BSE/GMP scrapers
│   │   ├── validators/     # Data validation logic
│   │   ├── schedulers/     # Windows Task Scheduler XML configs
│   │   └── windows/        # Windows Service wrappers
│   ├── api/                # Node.js REST API
│   │   ├── routes/         # API endpoints
│   │   ├── middleware/     # Auth, rate-limiting
│   │   ├── controllers/    # Business logic
│   │   └── iis/           # IIS configuration files
│   └── web/                # Next.js web app
│       ├── pages/          # Route pages
│       ├── components/     # React components
│       ├── styles/         # CSS/Tailwind
│       └── iis/           # IIS web.config files
├── shared/                 # Shared utilities
│   ├── types/             # TypeScript definitions
│   ├── constants/         # Common constants
│   └── utils/             # Helper functions
├── infrastructure/         # IaC and configs
│   ├── terraform/         # Infrastructure as Code
│   ├── docker/            # Docker configurations (Windows containers)
│   ├── powershell/        # PowerShell deployment scripts
│   └── dsc/               # PowerShell DSC configurations
├── docs/                   # Documentation
└── scripts/               # Build and deployment scripts
    ├── ps1/               # PowerShell scripts
    └── batch/             # Batch scripts for Windows
```

**2. CI/CD Pipeline Configuration:**
- **GitHub Actions workflows:**
  - `ci-web.yml` - Lint, test, build web app
  - `ci-api.yml` - Lint, test, build API
  - `ci-data.yml` - Lint, test Python services
  - `deploy-staging.yml` - Auto-deploy to staging on main branch
  - `deploy-production.yml` - Manual trigger for production
- **Pipeline stages:**
  - Install dependencies
  - Run linters (ESLint, Prettier, Black)
  - Run unit tests (min 70% coverage)
  - Build artifacts
  - Run security scans (Snyk/Dependabot)
  - Deploy to appropriate environment
- **Build notifications:** Slack/Email on failure

**3. Environment Configuration:**
- **Development:**
  - Docker Desktop for Windows with Windows containers
  - Hot reload for all services via IIS Express
  - Local PostgreSQL 16 on Windows + Redis
  - Mock data for testing
  - Windows Subsystem for Linux (WSL2) for Linux tools
- **Staging:**
  - Subdomain: staging.ipodhan.com
  - Windows Server 2022 VM
  - Separate PostgreSQL 16 instances
  - IIS Basic Authentication
  - Application Insights monitoring
- **Production:**
  - Main domain: ipodhan.com
  - Windows Server 2022 Datacenter
  - IIS with ARR for load balancing
  - CloudFlare CDN
  - SSL certificates via IIS Certificate Manager
  - PostgreSQL 16 with streaming replication

**4. Database Schema Creation (PostgreSQL 16):**
```sql
-- Enable PostgreSQL 16 extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "timescaledb"; -- For time-series data

-- Core tables with PostgreSQL 16 features
CREATE TABLE ipos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) UNIQUE,
    company_name VARCHAR(255) NOT NULL,
    issue_size DECIMAL(12,2),
    price_band_low DECIMAL(10,2),
    price_band_high DECIMAL(10,2),
    lot_size INTEGER,
    open_date DATE,
    close_date DATE,
    listing_date DATE,
    status VARCHAR(20),
    category VARCHAR(20), -- Mainboard/SME
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) WITH (autovacuum_enabled = true);

CREATE TABLE gmp_history (
    id UUID PRIMARY KEY,
    ipo_id UUID REFERENCES ipos(id),
    gmp_value DECIMAL(10,2),
    gmp_percentage DECIMAL(5,2),
    kostak_rate DECIMAL(10,2),
    source VARCHAR(50),
    recorded_at TIMESTAMP
);

CREATE TABLE subscription_data (
    id UUID PRIMARY KEY,
    ipo_id UUID REFERENCES ipos(id),
    category VARCHAR(20), -- QIB/NII/Retail
    subscription_times DECIMAL(10,2),
    shares_offered BIGINT,
    shares_bid BIGINT,
    recorded_at TIMESTAMP
);

CREATE TABLE ipo_scores (
    id UUID PRIMARY KEY,
    ipo_id UUID REFERENCES ipos(id),
    total_score INTEGER,
    fundamental_score INTEGER,
    sentiment_score INTEGER,
    subscription_score INTEGER,
    sector_score INTEGER,
    calculated_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_ipos_status ON ipos(status);
CREATE INDEX idx_ipos_dates ON ipos(open_date, close_date);
CREATE INDEX idx_gmp_history_ipo ON gmp_history(ipo_id, recorded_at);
```

**5. Monitoring & Error Tracking:**
- **Sentry Setup:**
  - Separate projects for web, api, data-pipeline
  - Error alerting rules (critical errors = immediate alert)
  - Performance monitoring enabled
  - Source map uploads for debugging
- **CloudWatch/Grafana:**
  - API response time dashboard
  - Database query performance
  - Service health checks every 30 seconds
  - Custom metrics for business KPIs
- **Alerts configured for:**
  - Service downtime >1 minute
  - Error rate >1%
  - API response time >2 seconds
  - Database connection failures

**6. Domain & Hosting Setup:**
- **Domain Registration:**
  - ipodhan.com registered with auto-renewal
  - DNS managed via CloudFlare
  - Subdomains: api.ipodhan.com, staging.ipodhan.com
- **Hosting Configuration:**
  - Web: Vercel with India region priority
  - API: AWS Mumbai region (ap-south-1)
  - Database: AWS RDS with read replicas
  - Redis: AWS ElastiCache
- **SSL/Security:**
  - SSL certificates auto-renewed via Let's Encrypt
  - CloudFlare DDoS protection enabled
  - Web Application Firewall (WAF) rules
  - CORS properly configured

**7. Additional Setup Requirements:**
- **Environment Variables:**
  - `.env.example` files for each service
  - Secrets stored in AWS Secrets Manager
  - No hardcoded credentials
- **Documentation:**
  - README.md with setup instructions
  - API documentation (OpenAPI/Swagger)
  - Database migration instructions
- **Development Tools:**
  - Pre-commit hooks for code quality
  - Husky for Git hooks
  - Makefile for common commands

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.0 (Windows Server Setup), Story 1.0a (PostgreSQL Validation)
**Effort:** 5 days (increased due to Windows complexity)

**Definition of Done:**
- [ ] All repositories created and structured
- [ ] CI/CD pipelines passing on Windows environment
- [ ] All three environments accessible (Dev/Staging/Production)
- [ ] PostgreSQL 16 database migrations run successfully
- [ ] Windows monitoring dashboards live
- [ ] IIS configured and domain resolving correctly
- [ ] Team can deploy code through PowerShell/pipeline
- [ ] Windows Service wrappers working for all services

#### Story 1.2: IPO Data Pipeline (DETAILED)
**As a** system,
**I want** to ingest IPO data from NSE/BSE sources and track complete GMP history,
**so that** users have accurate, real-time IPO information with comprehensive historical trends.

**Detailed Acceptance Criteria:**

**1. Data Source Integration (Windows Environment):**

**NSE/BSE Official Sources:**
- **NSE IPO Page**: `https://www.nseindia.com/market-data/all-upcoming-issues-ipo`
- **BSE IPO Page**: `https://www.bseindia.com/markets/PublicIssues/IPOIssues.aspx`
- **Data extraction methods:**
  - Primary: Official APIs if available
  - Fallback: Web scraping using Puppeteer/Playwright on Windows
  - Schedule: Windows Task Scheduler jobs every 15 minutes (9:00 AM - 5:00 PM)
  - Python services running as Windows Services with NSSM wrapper

**GMP Sources:**
- **Primary**: IPOWatch.in API/Scraping
- **Secondary**: InvestorGain.com
- **Tertiary**: Chittorgarh.com
- **Update frequency**: Every 30 minutes (market hours), hourly (off-hours)

**2. Data Validation & Normalization Pipeline:**

```python
# Pipeline stages
class DataPipeline:
    def validate_ipo_data(self, raw_data):
        """
        Validations:
        - Required fields present (company_name, dates, price_band)
        - Date logic (open_date < close_date < listing_date)
        - Price band validation (low < high)
        - Lot size is positive integer
        - Issue size is positive number
        """

    def normalize_data(self, validated_data):
        """
        Normalizations:
        - Convert dates to ISO format
        - Standardize company names (remove Ltd, Limited, etc.)
        - Convert all amounts to crores
        - Calculate derived fields (issue_price_range)
        """

    def check_duplicates(self, normalized_data):
        """
        Duplicate detection:
        - Check by company name + issue dates
        - Check by ISIN if available
        - Merge updates vs create new records
        """
```

**3. Database Schema for IPO Data:**

```sql
-- Extended IPO master table
CREATE TABLE ipo_details (
    id UUID PRIMARY KEY,
    isin VARCHAR(12) UNIQUE,
    symbol VARCHAR(20),
    company_name VARCHAR(255) NOT NULL,
    company_description TEXT,

    -- Issue details
    issue_type VARCHAR(20), -- Fresh/OFS/Both
    issue_size DECIMAL(12,2),
    fresh_issue DECIMAL(12,2),
    ofs_issue DECIMAL(12,2),

    -- Price information
    price_band_low DECIMAL(10,2),
    price_band_high DECIMAL(10,2),
    cut_off_price DECIMAL(10,2),
    face_value DECIMAL(10,2),
    lot_size INTEGER,
    min_investment DECIMAL(10,2),

    -- Important dates
    open_date DATE,
    close_date DATE,
    basis_of_allotment_date DATE,
    initiation_of_refunds_date DATE,
    credit_of_shares_date DATE,
    listing_date DATE,

    -- Categories
    ipo_category VARCHAR(20), -- Mainboard/SME
    status VARCHAR(20), -- Upcoming/Open/Closed/Listed

    -- Registrar info
    registrar VARCHAR(100),
    registrar_link TEXT,

    -- Lead managers
    lead_managers TEXT[],

    -- Exchange info
    listing_at TEXT[], -- NSE, BSE, Both

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    data_source VARCHAR(50),
    last_verified_at TIMESTAMP
);

-- Financial metrics table
CREATE TABLE ipo_financials (
    id UUID PRIMARY KEY,
    ipo_id UUID REFERENCES ipo_details(id),

    -- Revenue data (in crores)
    revenue_fy1 DECIMAL(12,2),
    revenue_fy2 DECIMAL(12,2),
    revenue_fy3 DECIMAL(12,2),

    -- Profit data
    profit_fy1 DECIMAL(12,2),
    profit_fy2 DECIMAL(12,2),
    profit_fy3 DECIMAL(12,2),

    -- Key ratios
    pe_ratio DECIMAL(10,2),
    pb_ratio DECIMAL(10,2),
    roe_percentage DECIMAL(5,2),
    roce_percentage DECIMAL(5,2),
    debt_to_equity DECIMAL(10,2),

    -- Peer comparison
    industry_pe DECIMAL(10,2),
    peer_companies JSONB,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**4. GMP History Tracking:**

```sql
-- Enhanced GMP tracking
CREATE TABLE gmp_tracking (
    id UUID PRIMARY KEY,
    ipo_id UUID REFERENCES ipo_details(id),

    -- GMP data
    gmp_amount DECIMAL(10,2),
    gmp_percentage DECIMAL(5,2),
    expected_listing_price DECIMAL(10,2),

    -- Grey market application prices
    kostak_rate DECIMAL(10,2), -- Price to sell application
    subject_to_sauda DECIMAL(10,2), -- HNI application selling price

    -- Source tracking
    source VARCHAR(50),
    source_url TEXT,
    confidence_score INTEGER, -- 1-100 reliability score

    -- Timestamp
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes for performance
    INDEX idx_gmp_ipo_time (ipo_id, recorded_at DESC)
);

-- Aggregated GMP view
CREATE MATERIALIZED VIEW gmp_current AS
SELECT
    ipo_id,
    AVG(gmp_amount) as avg_gmp,
    MAX(gmp_amount) as max_gmp,
    MIN(gmp_amount) as min_gmp,
    AVG(gmp_percentage) as avg_gmp_percent,
    MAX(recorded_at) as last_updated
FROM gmp_tracking
WHERE recorded_at > NOW() - INTERVAL '2 hours'
GROUP BY ipo_id;
```

**5. Scraper Implementation:**

```python
# Scraper architecture
class IPODataScraper:
    def __init__(self):
        self.browser = None
        self.retry_count = 3
        self.timeout = 30

    async def scrape_nse(self):
        """
        Scrape NSE website:
        - Navigate to IPO page
        - Extract table data
        - Parse each IPO row
        - Handle pagination if exists
        """

    async def scrape_bse(self):
        """
        Similar to NSE scraper
        """

    async def scrape_gmp(self, source='ipogmp'):
        """
        GMP specific scraping:
        - Handle dynamic content
        - Extract current GMP
        - Calculate percentage
        - Store with timestamp
        """

    def handle_errors(self, error, source):
        """
        Error handling:
        - Network timeouts -> retry
        - Page structure changes -> alert admin
        - Rate limiting -> backoff
        - Complete failure -> use cached data
        """
```

**6. Data Update Schedule (Windows Task Scheduler):**

```xml
<!-- Windows Task Scheduler XML Configuration -->
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2024-01-01T09:00:00</StartBoundary>
      <Repetition>
        <Interval>PT15M</Interval> <!-- Every 15 minutes -->
        <Duration>PT8H</Duration> <!-- For 8 hours (market hours) -->
      </Repetition>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Actions>
    <Exec>
      <Command>C:\Python311\python.exe</Command>
      <Arguments>C:\ipodhan\services\data-pipeline\main.py --task ipo_update</Arguments>
    </Exec>
  </Actions>
</Task>

# PowerShell Script for Task Creation
$trigger = New-ScheduledTaskTrigger -Daily -At 9:00AM -RepetitionInterval (New-TimeSpan -Minutes 15)
$action = New-ScheduledTaskAction -Execute "python.exe" -Argument "C:\ipodhan\data-pipeline\main.py"
Register-ScheduledTask -TaskName "IPODataUpdate" -Trigger $trigger -Action $action
        - calculate_averages
        - update_gmp_table

    - name: "Off Hours GMP"
      cron: "0 * * * *"  # Every hour
      tasks:
        - scrape_primary_gmp_source
```

**7. Historical Data Backfill:**

```python
class HistoricalDataLoader:
    def backfill_ipo_data(self, start_date='2020-01-01'):
        """
        Load historical IPO data:
        - Parse archived pages
        - Load from CSV/Excel if available
        - Validate against known IPOs
        - Store in database
        """

    def backfill_gmp_history(self):
        """
        GMP historical data:
        - Scrape wayback machine archives
        - Load from partner APIs if available
        - Interpolate missing data points
        - Mark estimated vs actual data
        """
```

**8. Data Quality & Monitoring:**

```python
# Data quality checks
quality_checks = {
    "completeness": {
        "required_fields": ["company_name", "open_date", "close_date", "price_band"],
        "threshold": 100  # All required fields must be present
    },
    "freshness": {
        "max_age_minutes": 30,  # During market hours
        "alert_if_stale": True
    },
    "accuracy": {
        "cross_validate_sources": True,
        "manual_review_threshold": 0.8  # Flag if sources disagree
    }
}

# Monitoring metrics
metrics = {
    "scraping_success_rate": "Track % of successful scrapes",
    "data_latency": "Time from source update to DB update",
    "gmp_variance": "Alert if GMP changes >20% in 1 hour",
    "missing_ipos": "Alert if IPO found on one exchange but not other"
}
```

**9. API Endpoints for Data Access:**

```typescript
// Data access APIs
GET /api/data-pipeline/status
Response: {
  "last_update": "2024-01-28T10:30:00Z",
  "sources": {
    "nse": { "status": "healthy", "last_success": "..." },
    "bse": { "status": "healthy", "last_success": "..." },
    "gmp": { "status": "healthy", "last_success": "..." }
  },
  "records_updated": 45,
  "errors": []
}

GET /api/data-pipeline/force-refresh/{source}
POST /api/data-pipeline/manual-override
```

**10. Error Handling & Fallbacks:**

```python
error_handling = {
    "network_timeout": {
        "retry_attempts": 3,
        "retry_delay": [5, 15, 30],  # seconds
        "fallback": "use_cached_data"
    },
    "parse_error": {
        "action": "alert_admin",
        "fallback": "skip_record",
        "log_level": "ERROR"
    },
    "data_inconsistency": {
        "action": "flag_for_review",
        "notification": "slack_alert"
    }
}
```

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.1 (Infrastructure), Story 1.0 (Windows Server Setup)
**Effort:** 5-6 days (increased for Windows Task Scheduler configuration)

**Definition of Done:**
- [ ] All data sources integrated and scraping successfully
- [ ] GMP history tracking with 30-minute updates
- [ ] Historical data backfilled for last 2 years
- [ ] Data validation catching 100% of invalid records
- [ ] Monitoring dashboards showing pipeline health
- [ ] 99% uptime for data freshness during market hours
- [ ] Manual override capability tested and working

#### Story 1.3: IPO Scoring Algorithm (DETAILED)
**As a** user,
**I want** to see a simple 0-100 score for each IPO,
**so that** I can make quick investment decisions.

**Detailed Acceptance Criteria:**

**1. Score Components & Weightage:**

```typescript
// Score calculation configuration
const scoreConfig = {
  fundamentals: {
    weight: 40,
    components: {
      peRatio: { weight: 8, benchmark: "industry_average" },
      revenueGrowth: { weight: 8, lookback: "3_years" },
      profitability: { weight: 8, metrics: ["PAT", "EBITDA"] },
      debtToEquity: { weight: 5, threshold: 1.5 },
      returnOnEquity: { weight: 5, minimum: 12 },
      cashFlow: { weight: 6, type: "operating_cash_flow" }
    }
  },
  marketSentiment: {
    weight: 30,
    components: {
      gmpTrend: { weight: 10, factors: ["current", "7day_trend"] },
      watchlistAdditions: { weight: 5, period: "last_7_days" },
      socialBuzz: { weight: 5, sources: ["twitter", "stocktwits"] },
      crowdPrediction: { weight: 5, minimum_votes: 100 },
      searchTrend: { weight: 5, source: "google_trends" }
    }
  },
  subscription: {
    weight: 20,
    components: {
      qibSubscription: { weight: 8, threshold: 5 },
      hniSubscription: { weight: 4, threshold: 3 },
      retailSubscription: { weight: 5, threshold: 2 },
      momentum: { weight: 3, metric: "hourly_change_rate" }
    }
  },
  sectorTiming: {
    weight: 10,
    components: {
      sectorPerformance: { weight: 3, period: "6_months" },
      peerComparison: { weight: 3, peers: "top_5_listed" },
      marketCondition: { weight: 2, index: "NIFTY_50" },
      ipoCapacity: { weight: 2, metric: "market_absorption" }
    }
  }
};
```

**2. Scoring Algorithm Implementation:**

```python
class IPOScoringEngine:
    def __init__(self):
        self.weights = self.load_weights()
        self.benchmarks = self.load_benchmarks()

    def calculate_score(self, ipo_id: str) -> dict:
        """
        Main scoring function
        Returns: {
            'total_score': 0-100,
            'component_scores': {...},
            'confidence': 'high/medium/low',
            'explanation': {...}
        }
        """

        # Fetch all required data
        ipo_data = self.fetch_ipo_data(ipo_id)

        # Calculate component scores
        fundamental_score = self.calculate_fundamentals(ipo_data)
        sentiment_score = self.calculate_sentiment(ipo_data)
        subscription_score = self.calculate_subscription(ipo_data)
        sector_score = self.calculate_sector(ipo_data)

        # Apply weights and calculate total
        total_score = self.weighted_average([
            (fundamental_score, 0.40),
            (sentiment_score, 0.30),
            (subscription_score, 0.20),
            (sector_score, 0.10)
        ])

        # Determine confidence based on data completeness
        confidence = self.assess_confidence(ipo_data)

        # Generate explanation
        explanation = self.generate_explanation(
            fundamental_score, sentiment_score,
            subscription_score, sector_score
        )

        return {
            'total_score': round(total_score),
            'fundamental_score': fundamental_score,
            'sentiment_score': sentiment_score,
            'subscription_score': subscription_score,
            'sector_score': sector_score,
            'confidence': confidence,
            'explanation': explanation,
            'calculated_at': datetime.now()
        }
```

**3. Fundamental Analysis Scoring:**

```python
def calculate_fundamentals(self, ipo_data: dict) -> float:
    """
    Evaluate financial metrics
    """
    score = 0

    # P/E Ratio Analysis (8 points)
    pe_ratio = ipo_data.get('pe_ratio')
    industry_pe = ipo_data.get('industry_pe')
    if pe_ratio and industry_pe:
        if pe_ratio < industry_pe * 0.7:
            score += 8  # Significantly undervalued
        elif pe_ratio < industry_pe:
            score += 6  # Moderately undervalued
        elif pe_ratio < industry_pe * 1.2:
            score += 4  # Fair valued
        else:
            score += 2  # Overvalued

    # Revenue Growth (8 points)
    revenue_growth = self.calculate_cagr(
        ipo_data.get('revenue_fy1'),
        ipo_data.get('revenue_fy3')
    )
    if revenue_growth > 30:
        score += 8  # Excellent growth
    elif revenue_growth > 20:
        score += 6  # Good growth
    elif revenue_growth > 10:
        score += 4  # Moderate growth
    else:
        score += 2  # Low growth

    # Profitability (8 points)
    pat_margin = ipo_data.get('pat_margin')
    if pat_margin > 15:
        score += 8  # Highly profitable
    elif pat_margin > 10:
        score += 6  # Good profitability
    elif pat_margin > 5:
        score += 4  # Moderate profitability
    elif pat_margin > 0:
        score += 2  # Low but positive
    else:
        score += 0  # Loss making

    # Debt to Equity (5 points)
    debt_equity = ipo_data.get('debt_to_equity', 0)
    if debt_equity < 0.5:
        score += 5  # Very low debt
    elif debt_equity < 1:
        score += 4  # Moderate debt
    elif debt_equity < 1.5:
        score += 2  # High debt
    else:
        score += 0  # Very high debt

    # ROE (5 points)
    roe = ipo_data.get('roe')
    if roe > 20:
        score += 5
    elif roe > 15:
        score += 4
    elif roe > 12:
        score += 3
    elif roe > 8:
        score += 2
    else:
        score += 1

    # Cash Flow (6 points)
    operating_cf = ipo_data.get('operating_cash_flow')
    if operating_cf > 0:
        score += 6 if operating_cf > ipo_data.get('net_profit') else 4
    else:
        score += 0

    return score  # Max 40 points
```

**4. Market Sentiment Analysis:**

```python
def calculate_sentiment(self, ipo_data: dict) -> float:
    """
    Analyze market sentiment indicators
    """
    score = 0

    # GMP Trend Analysis (10 points)
    current_gmp = ipo_data.get('current_gmp_percent', 0)
    gmp_trend = ipo_data.get('gmp_7day_trend', 'stable')

    if current_gmp > 50:
        score += 7
    elif current_gmp > 30:
        score += 5
    elif current_gmp > 15:
        score += 3
    else:
        score += 1

    # Add trend bonus
    if gmp_trend == 'increasing':
        score += 3
    elif gmp_trend == 'stable':
        score += 2
    else:
        score += 0

    # Watchlist Popularity (5 points)
    watchlist_adds = ipo_data.get('watchlist_additions_7d', 0)
    if watchlist_adds > 1000:
        score += 5
    elif watchlist_adds > 500:
        score += 4
    elif watchlist_adds > 100:
        score += 3
    else:
        score += 1

    # Social Media Buzz (5 points)
    social_score = self.analyze_social_sentiment(ipo_data)
    score += min(5, social_score)

    # Crowd Prediction (5 points)
    positive_predictions = ipo_data.get('crowd_positive_percent', 50)
    score += (positive_predictions / 100) * 5

    # Search Trends (5 points)
    search_trend = ipo_data.get('google_trend_score', 0)
    score += min(5, search_trend / 20)  # Normalize to 5

    return score  # Max 30 points
```

**5. Subscription Data Analysis:**

```python
def calculate_subscription(self, ipo_data: dict) -> float:
    """
    Analyze subscription patterns
    """
    score = 0

    # QIB Subscription (8 points)
    qib_subs = ipo_data.get('qib_subscription', 0)
    if qib_subs > 10:
        score += 8
    elif qib_subs > 5:
        score += 6
    elif qib_subs > 2:
        score += 4
    elif qib_subs > 1:
        score += 2
    else:
        score += 0

    # HNI Subscription (4 points)
    hni_subs = ipo_data.get('hni_subscription', 0)
    if hni_subs > 5:
        score += 4
    elif hni_subs > 3:
        score += 3
    elif hni_subs > 1:
        score += 2
    else:
        score += 1

    # Retail Subscription (5 points)
    retail_subs = ipo_data.get('retail_subscription', 0)
    if retail_subs > 5:
        score += 5
    elif retail_subs > 3:
        score += 4
    elif retail_subs > 2:
        score += 3
    elif retail_subs > 1:
        score += 2
    else:
        score += 1

    # Subscription Momentum (3 points)
    momentum = self.calculate_subscription_momentum(ipo_data)
    score += min(3, momentum)

    return score  # Max 20 points
```

**6. Sector & Timing Analysis:**

```python
def calculate_sector(self, ipo_data: dict) -> float:
    """
    Analyze sector performance and market timing
    """
    score = 0

    # Sector Performance (3 points)
    sector_return = ipo_data.get('sector_6month_return', 0)
    if sector_return > 20:
        score += 3
    elif sector_return > 10:
        score += 2
    elif sector_return > 0:
        score += 1
    else:
        score += 0

    # Peer Comparison (3 points)
    peer_avg_pe = ipo_data.get('peer_average_pe')
    ipo_pe = ipo_data.get('pe_ratio')
    if ipo_pe and peer_avg_pe:
        if ipo_pe < peer_avg_pe * 0.8:
            score += 3
        elif ipo_pe < peer_avg_pe:
            score += 2
        else:
            score += 1

    # Market Conditions (2 points)
    nifty_trend = ipo_data.get('nifty_30day_trend', 'neutral')
    if nifty_trend == 'bullish':
        score += 2
    elif nifty_trend == 'neutral':
        score += 1
    else:
        score += 0

    # IPO Market Capacity (2 points)
    recent_ipo_performance = ipo_data.get('last_5_ipo_avg_gain', 0)
    if recent_ipo_performance > 20:
        score += 2
    elif recent_ipo_performance > 10:
        score += 1
    else:
        score += 0

    return score  # Max 10 points
```

**7. Score Interpretation & Display:**

```typescript
// Score bands and recommendations
const scoreInterpretation = {
  ranges: [
    { min: 70, max: 100, label: "Strong Buy", color: "#10B981", icon: "🟢" },
    { min: 50, max: 69, label: "Consider", color: "#F59E0B", icon: "🟡" },
    { min: 30, max: 49, label: "Risky", color: "#EF4444", icon: "🟠" },
    { min: 0, max: 29, label: "Avoid", color: "#991B1B", icon: "🔴" }
  ],

  getRecommendation(score: number) {
    const range = this.ranges.find(r => score >= r.min && score <= r.max);
    return {
      ...range,
      description: this.getDescription(score),
      risks: this.getRisks(score),
      strengths: this.getStrengths(score)
    };
  }
};
```

**8. SME IPO Adjustments:**

```python
def adjust_for_sme(self, base_score: float, ipo_data: dict) -> float:
    """
    Special handling for SME IPOs
    """
    if ipo_data.get('category') != 'SME':
        return base_score

    # SME IPOs have different risk profile
    adjustments = {
        'higher_risk_penalty': -5,
        'lower_liquidity_penalty': -3,
        'growth_potential_bonus': +8 if ipo_data.get('revenue_growth') > 40 else 0,
        'promoter_holding_bonus': +3 if ipo_data.get('post_ipo_promoter_holding') > 60 else 0
    }

    adjusted_score = base_score + sum(adjustments.values())

    # Add warning flag for SME
    ipo_data['sme_warning'] = "Higher risk - SME segment"

    return max(0, min(100, adjusted_score))
```

**9. Historical Score Tracking:**

```sql
-- Store historical scores for analysis
CREATE TABLE score_history (
    id UUID PRIMARY KEY,
    ipo_id UUID REFERENCES ipo_details(id),
    total_score INTEGER,
    fundamental_score INTEGER,
    sentiment_score INTEGER,
    subscription_score INTEGER,
    sector_score INTEGER,
    confidence_level VARCHAR(20),
    algorithm_version VARCHAR(10),
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Track what changed
    score_change INTEGER, -- Difference from previous
    change_reason TEXT,

    INDEX idx_score_history_ipo (ipo_id, calculated_at DESC)
);

-- Score performance tracking
CREATE TABLE score_performance (
    id UUID PRIMARY KEY,
    ipo_id UUID REFERENCES ipo_details(id),
    predicted_score INTEGER,
    actual_listing_gain DECIMAL(10,2),
    prediction_accuracy DECIMAL(5,2),
    analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**10. A/B Testing Framework:**

```python
class ScoreABTesting:
    def __init__(self):
        self.experiments = {}

    def create_experiment(self, name: str, variants: dict):
        """
        Create A/B test for scoring algorithm
        Example: Test different weight distributions
        """
        self.experiments[name] = {
            'variants': variants,
            'start_date': datetime.now(),
            'results': defaultdict(list)
        }

    def get_variant(self, experiment_name: str, ipo_id: str):
        """
        Deterministically assign IPO to variant
        """
        hash_value = hashlib.md5(ipo_id.encode()).hexdigest()
        variant_index = int(hash_value, 16) % len(self.experiments[experiment_name]['variants'])
        return list(self.experiments[experiment_name]['variants'].keys())[variant_index]

    def track_result(self, experiment_name: str, variant: str, score: float, outcome: float):
        """
        Track performance of each variant
        """
        self.experiments[experiment_name]['results'][variant].append({
            'score': score,
            'outcome': outcome,
            'timestamp': datetime.now()
        })
```

**11. API Endpoints:**

```typescript
// Score API endpoints
GET /api/scores/{ipo_id}
Response: {
  "ipo_id": "uuid",
  "company_name": "Example Ltd",
  "total_score": 72,
  "component_scores": {
    "fundamentals": 32,
    "sentiment": 22,
    "subscription": 12,
    "sector": 6
  },
  "recommendation": "Strong Buy",
  "confidence": "high",
  "explanation": {
    "strengths": ["Strong fundamentals", "High GMP"],
    "weaknesses": ["High debt"],
    "key_factors": ["Revenue growth: 35%", "PE below industry"]
  },
  "calculated_at": "2024-01-28T12:00:00Z",
  "next_update": "2024-01-28T17:00:00Z"
}

GET /api/scores/{ipo_id}/history
GET /api/scores/{ipo_id}/breakdown
POST /api/scores/{ipo_id}/recalculate
```

**12. Manual Override & Audit:**

```python
class ScoreOverride:
    def apply_manual_override(self, ipo_id: str, override_data: dict, reason: str, authorized_by: str):
        """
        Allow manual score adjustment with audit trail
        """
        # Store original score
        original_score = self.get_current_score(ipo_id)

        # Apply override
        new_score = override_data.get('total_score')

        # Log the override
        self.log_override({
            'ipo_id': ipo_id,
            'original_score': original_score,
            'new_score': new_score,
            'reason': reason,
            'authorized_by': authorized_by,
            'timestamp': datetime.now()
        })

        # Update score with override flag
        self.update_score(ipo_id, new_score, is_override=True)
```

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.2 (Data Pipeline)
**Effort:** 3-4 days

**Definition of Done:**
- [ ] All score components calculating correctly
- [ ] Score updates running 3 times daily
- [ ] Historical score tracking implemented
- [ ] SME IPO adjustments working
- [ ] API endpoints returning scores
- [ ] Score explanation tooltips functional
- [ ] A/B testing framework ready
- [ ] Manual override capability with audit trail
- [ ] Score accuracy >70% correlation with listing gains

#### Story 1.4: Web Platform MVP (DETAILED)
**As a** retail investor,
**I want** to view all live, upcoming, and closed IPOs with scores,
**so that** I can track IPO opportunities.

**Detailed Acceptance Criteria:**

**1. Homepage Layout & Structure:**

```jsx
// Homepage component structure
const HomePage = () => {
  return (
    <div className="homepage">
      {/* Hero Section */}
      <HeroSection>
        - Tagline: "India's Smartest IPO Platform"
        - Live IPO count widget
        - Today's top IPO by score
        - Quick search bar
      </HeroSection>

      {/* IPO Tabs Section */}
      <IPOTabs defaultTab="live">
        <Tab name="Live IPOs" count={liveCount}>
          - Currently open for subscription
          - Closing today/tomorrow highlighted
        </Tab>
        <Tab name="Upcoming IPOs" count={upcomingCount}>
          - Opening in next 30 days
          - Tentative IPOs marked clearly
        </Tab>
        <Tab name="Closed IPOs" count={closedCount}>
          - Last 90 days closed IPOs
          - Show listing performance
        </Tab>
      </IPOTabs>

      {/* Quick Stats Bar */}
      <StatsBar>
        - Total IPOs this year
        - Average listing gain
        - Top performing IPO
        - Current GMP leader
      </StatsBar>
    </div>
  );
};
```

**2. IPO Card Component Design:**

```typescript
interface IPOCard {
  // Display fields
  companyName: string;
  logo?: string;
  category: "Mainboard" | "SME";

  // Score prominently displayed
  score: {
    value: number;
    label: "Strong Buy" | "Consider" | "Risky" | "Avoid";
    color: string;
    trend: "up" | "down" | "stable";
  };

  // Key dates
  dates: {
    open: Date;
    close: Date;
    listing: Date;
    daysLeft?: number; // For live IPOs
  };

  // Price information
  priceBand: {
    low: number;
    high: number;
    lotSize: number;
    minInvestment: number;
  };

  // Live data
  subscription: {
    retail: number;
    qib: number;
    nii: number;
    overall: number;
    lastUpdated: Date;
  };

  // GMP data
  gmp: {
    amount: number;
    percentage: number;
    trend: "up" | "down" | "stable";
  };

  // Quick actions
  actions: {
    viewDetails: () => void;
    addToWatchlist: () => void;
    downloadForms: () => void;
    checkAllotment: () => void;
  };
}
```

**3. IPO List View Implementation:**

```jsx
// IPO List Component
const IPOListView = ({ type }) => {
  return (
    <div className="ipo-list-container">
      {/* Filters Bar */}
      <FiltersBar>
        <Filter type="score" options={["70+", "50-70", "30-50", "<30"]} />
        <Filter type="category" options={["Mainboard", "SME", "Both"]} />
        <Filter type="sector" options={sectorList} />
        <Filter type="size" options={["<100Cr", "100-500Cr", ">500Cr"]} />
        <SortBy options={["Score", "Closing Date", "GMP", "Size"]} />
      </FiltersBar>

      {/* IPO Cards Grid */}
      <div className="ipo-grid">
        {ipos.map(ipo => (
          <IPOCard key={ipo.id}>
            {/* Card Header */}
            <CardHeader>
              <CompanyLogo src={ipo.logo} />
              <CompanyName>{ipo.name}</CompanyName>
              <ScoreBadge score={ipo.score} />
            </CardHeader>

            {/* Card Body */}
            <CardBody>
              <DataRow label="Price Band" value={`₹${ipo.priceLow}-${ipo.priceHigh}`} />
              <DataRow label="Lot Size" value={ipo.lotSize} />
              <DataRow label="Min Investment" value={`₹${ipo.minInvestment}`} />
              <DataRow label="GMP" value={`₹${ipo.gmp} (${ipo.gmpPercent}%)`} />

              {/* Subscription Status */}
              {type === "live" && (
                <SubscriptionBar>
                  <Category name="Retail" value={ipo.retailSubs} />
                  <Category name="QIB" value={ipo.qibSubs} />
                  <Category name="NII" value={ipo.niiSubs} />
                </SubscriptionBar>
              )}

              {/* Dates */}
              <DateInfo>
                {type === "live" && <ClosingIn days={ipo.daysLeft} />}
                {type === "upcoming" && <OpensOn date={ipo.openDate} />}
                {type === "closed" && <ListingGain gain={ipo.listingGain} />}
              </DateInfo>
            </CardBody>

            {/* Card Actions */}
            <CardFooter>
              <Button onClick={() => navigate(`/ipo/${ipo.id}`)}>View Details</Button>
              <IconButton icon="download" onClick={downloadForms} />
              <IconButton icon="bookmark" onClick={addToWatchlist} />
            </CardFooter>
          </IPOCard>
        ))}
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />
    </div>
  );
};
```

**4. Individual IPO Detail Page:**

```jsx
// IPO Detail Page Structure
const IPODetailPage = ({ ipoId }) => {
  return (
    <div className="ipo-detail-page">
      {/* Header Section */}
      <IPOHeader>
        <CompanyInfo>
          - Logo and Name
          - Industry/Sector
          - Company description (2 lines)
        </CompanyInfo>
        <ScoreCard>
          - Large score display (72/100)
          - Recommendation badge
          - Score breakdown link
        </ScoreCard>
        <QuickActions>
          - Download Forms
          - Check Allotment
          - Add to Watchlist
          - Share IPO
        </QuickActions>
      </IPOHeader>

      {/* Navigation Tabs */}
      <DetailTabs>
        <Tab name="Overview">
          <KeyMetrics>
            - Issue size, Price band
            - Lot size, Min investment
            - Face value, P/E ratio
          </KeyMetrics>
          <ImportantDates>
            - Open, Close, Basis of allotment
            - Refund, Demat credit, Listing
          </ImportantDates>
          <ObjectOfIssue>
            - Fresh issue amount
            - OFS component
            - Use of proceeds
          </ObjectOfIssue>
        </Tab>

        <Tab name="Subscription">
          <LiveSubscription>
            - Real-time subscription data
            - Category-wise breakdown
            - Day-wise progression chart
            - Auto-refresh every 15 min
          </LiveSubscription>
        </Tab>

        <Tab name="GMP">
          <GMPChart>
            - Historical GMP chart
            - Current GMP with trend
            - Kostak rates
            - Expected listing price
          </GMPChart>
        </Tab>

        <Tab name="Financials">
          <FinancialHighlights>
            - Revenue/Profit last 3 years
            - Key ratios (P/E, ROE, ROCE)
            - Debt analysis
            - Peer comparison table
          </FinancialHighlights>
        </Tab>

        <Tab name="Analysis">
          <ExpertAnalysis>
            - Strengths and risks
            - Score breakdown explanation
            - Editorial recommendation
            - Key things to consider
          </ExpertAnalysis>
        </Tab>

        <Tab name="Documents">
          <DocumentLinks>
            - DRHP/RHP download
            - Application forms
            - Company presentations
            - Exchange filings
          </DocumentLinks>
        </Tab>
      </DetailTabs>

      {/* Registrar Info */}
      <RegistrarSection>
        - Registrar name and contact
        - Allotment status link
        - Lead managers list
      </RegistrarSection>
    </div>
  );
};
```

**5. Search & Filter Implementation:**

```typescript
// Search functionality
class IPOSearch {
  private searchIndex: SearchIndex;

  constructor() {
    this.searchIndex = new SearchIndex({
      fields: ['companyName', 'sector', 'symbol'],
      storeFields: ['id', 'companyName', 'score', 'status']
    });
  }

  search(query: string, filters?: SearchFilters): SearchResult[] {
    // Fuzzy search with typo tolerance
    const searchOptions = {
      fuzzy: 0.2,
      prefix: true,
      boost: {
        companyName: 2,
        symbol: 1.5,
        sector: 1
      }
    };

    let results = this.searchIndex.search(query, searchOptions);

    // Apply filters
    if (filters) {
      results = this.applyFilters(results, filters);
    }

    // Sort by relevance and score
    return results.sort((a, b) => {
      const relevanceDiff = b.relevance - a.relevance;
      if (Math.abs(relevanceDiff) > 0.1) return relevanceDiff;
      return b.score - a.score;
    });
  }

  applyFilters(results: any[], filters: SearchFilters) {
    return results.filter(item => {
      if (filters.scoreRange && !this.inRange(item.score, filters.scoreRange)) return false;
      if (filters.category && item.category !== filters.category) return false;
      if (filters.sector && item.sector !== filters.sector) return false;
      if (filters.dateRange && !this.inDateRange(item, filters.dateRange)) return false;
      return true;
    });
  }
}
```

**6. Responsive Design Requirements:**

```scss
// Responsive breakpoints
$breakpoints: (
  'mobile': 320px,
  'tablet': 768px,
  'desktop': 1024px,
  'wide': 1440px
);

// IPO Card responsive grid
.ipo-grid {
  display: grid;
  gap: 1.5rem;

  @include mobile {
    grid-template-columns: 1fr;
  }

  @include tablet {
    grid-template-columns: repeat(2, 1fr);
  }

  @include desktop {
    grid-template-columns: repeat(3, 1fr);
  }

  @include wide {
    grid-template-columns: repeat(4, 1fr);
  }
}

// Mobile-specific optimizations
@include mobile {
  .ipo-card {
    .subscription-bar {
      flex-direction: column;
    }

    .card-actions {
      position: sticky;
      bottom: 0;
      background: white;
      box-shadow: 0 -2px 10px rgba(0,0,0,0.1);
    }
  }

  .filters-bar {
    overflow-x: auto;
    white-space: nowrap;
    -webkit-overflow-scrolling: touch;
  }
}
```

**7-12. [Performance, SEO, Error Handling, Analytics, API, Accessibility - continued as in original]**

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.3 (Scoring Algorithm)
**Effort:** 5-6 days

**Definition of Done:**
- [ ] Homepage with 3 tabs (Live/Upcoming/Closed) functional
- [ ] IPO cards displaying all required information
- [ ] Individual IPO detail pages with all tabs
- [ ] Search and filter functionality working
- [ ] Mobile responsive design implemented
- [ ] Page load time <2 seconds achieved
- [ ] SEO meta tags implemented
- [ ] Analytics tracking active
- [ ] Accessibility WCAG AA compliant
- [ ] Error states and loading states handled

#### Story 1.5: User Registration with Payment
**As a** new user,
**I want** to register with a ₹1 lifetime symbolic fee,
**so that** I can access personalized features.

**Acceptance Criteria:**
1. Registration flow with email/mobile verification
2. Razorpay integration for ₹1 payment
3. Clear value proposition explaining why ₹1 fee exists
4. Payment failure handling with retry option
5. User dashboard showing membership status
6. Referral code system for viral growth

**Priority:** 🟡 POST-MVP *(Moved from MVP to focus on value delivery first)*
**Dependencies:** Story 1.4
**Effort:** 1 day

#### Story 1.6: Basic Watchlist Feature
**As a** registered user,
**I want** to add IPOs to my watchlist,
**so that** I can track specific opportunities.

**Acceptance Criteria:**
1. Add/remove IPOs from watchlist (max 5 for free tier)
2. Watchlist visible on user dashboard
3. Basic email alerts for watchlist IPOs (opening/closing)
4. Watchlist persists across sessions
5. Quick-add button on IPO cards

**Priority:** 🟡 POST-MVP *(Requires user registration)*
**Dependencies:** Story 1.5
**Effort:** 1 day

#### Story 1.7: Legal & Compliance Framework (DETAILED)
**As a** platform owner,
**I want** to ensure SEBI compliance and legal disclaimers,
**so that** we operate within regulatory requirements.

**Detailed Acceptance Criteria:**

**1. SEBI Compliance Requirements:**
- Mandatory disclaimer on every page: "Investment in securities market are subject to market risks. Read all the related documents carefully before investing"
- Secondary disclaimer: "IPODhan is not a SEBI registered investment advisor. Information is for educational purposes only"
- Disclaimer placement: Top of page (banner) and footer (persistent)
- Font size: Minimum 12px, high contrast for visibility
- Additional IPO-specific disclaimers on relevant pages

**2. Terms of Service Document:**
- Comprehensive terms covering:
  - Service description and limitations
  - User obligations and age requirements (18+)
  - Disclaimer of warranties
  - Limitation of liability
  - Intellectual property rights
  - Third-party links and affiliate relationships
  - Indemnification clauses
  - Dispute resolution (Mumbai jurisdiction)
  - Modification rights
- Versioning system with date stamps
- User acceptance tracking (when registration is added)

**3. Privacy Policy Implementation:**
- Compliant with India's Data Protection Bill 2023
- Sections covering:
  - Information collected (automatic for MVP, personal data later)
  - How information is used
  - Data sharing policies
  - Security measures
  - User rights (access, correction, deletion)
  - Cookie policy
  - Contact information
- Regular review and update schedule

**4. Cookie Consent Implementation:**
- Banner appears on first visit
- Granular consent options:
  - Necessary cookies (required)
  - Analytics cookies (optional)
  - Marketing/Affiliate cookies (optional)
  - Functional cookies (optional)
- "Accept All" and "Accept Selected" options
- Link to detailed cookie policy
- Consent stored in localStorage
- Re-consent on policy changes

**5. Affiliate Disclosure:**
- Clear disclosure on broker comparison pages
- Format: "IPODhan may earn commission when you open demat accounts through our partner links"
- Separate detailed affiliate disclosure page
- List of all affiliate partners with SEBI registration numbers
- Statement that affiliate relationships don't influence scores/recommendations

**6. Investment Advisor Disclaimer:**
- Prominent statement: "IPODhan is NOT a SEBI-registered investment advisor"
- Clear explanation that content is educational/informational only
- Not registered under:
  - SEBI (Investment Advisers) Regulations, 2013
  - SEBI (Research Analysts) Regulations, 2014
  - SEBI (Portfolio Managers) Regulations, 2020
- Advice to consult qualified financial advisors

**7. Grey Market Premium (GMP) Disclaimer:**
- Warning box on all GMP displays
- Key points:
  - GMP is unofficial and unregulated
  - Can be volatile and change rapidly
  - Trading in grey market is illegal in India
  - For informational purposes only
  - Should not be sole basis for investment decisions

**8. Data Accuracy Disclaimer:**
- Sources disclosure (NSE, BSE, SEBI, RHP/DRHP)
- Update frequency disclosure
- "Information provided as-is" statement
- No guarantee of accuracy or completeness
- Encouragement to verify with official sources

**9. Legal Pages Structure:**
- Dedicated routes for each legal document
- SEO optimized with appropriate meta tags
- Easy navigation from footer
- Mobile-responsive design
- Print-friendly versions

**10. Footer Legal Section:**
- Persistent SEBI disclaimer
- Links to all legal documents
- Copyright notice
- Regulatory status clarification

**11. Compliance Monitoring:**
- Track disclaimer views
- Log consent actions
- Audit trail for compliance
- Regular compliance reports
- Page compliance verification system

**12. Legal Review Process:**
- Initial review by legal counsel
- Quarterly review schedule
- Update process for regulatory changes
- Version control for all legal documents

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** None - Must be implemented before launch
**Effort:** 3 days

**Definition of Done:**
- [ ] SEBI disclaimer visible on all pages
- [ ] Terms of Service page complete and accessible
- [ ] Privacy Policy page complete and compliant
- [ ] Cookie consent banner functional
- [ ] Affiliate disclosure on broker pages
- [ ] Investment advisor disclaimer prominent
- [ ] GMP disclaimer on relevant pages
- [ ] All legal pages SEO optimized
- [ ] Footer with all legal links
- [ ] Compliance tracking system ready
- [ ] Legal review completed and approved
- [ ] All disclaimers mobile-responsive

#### Story 1.8: Basic Analytics & Monitoring (DETAILED)
**As a** product owner,
**I want** to track anonymous user behavior and platform health,
**so that** we can make data-driven decisions.

**Detailed Acceptance Criteria:**

**1. Analytics Implementation:**
- **Google Analytics 4 Setup:**
  - Create GA4 property for IPODhan
  - Install tracking code on all pages
  - Configure data streams for web platform
  - Set up enhanced measurement (page views, scrolls, outbound clicks, site search, video engagement, file downloads)
  - Configure data retention settings (14 months)
  - Enable Google Signals for cross-device tracking

**2. Custom Events Tracking (MVP - No Registration):**
- **IPO Interaction Events:**
  - `ipo_viewed`: Track which IPO detail page viewed, source page, time spent
  - `score_clicked`: When user clicks to see score breakdown
  - `gmp_chart_viewed`: Time spent viewing GMP charts
  - `subscription_data_viewed`: When user checks live subscription status

- **Search & Filter Events:**
  - `search_performed`: Search query, results count, clicked result
  - `filter_applied`: Filter type (score/category/sector), filter value
  - `sort_changed`: Sort criteria selected

- **External Link Events:**
  - `broker_link_clicked`: Which broker, from which page
  - `nse_bse_link_clicked`: Exchange links clicked
  - `registrar_link_clicked`: For allotment checking
  - `download_initiated`: Form downloads, DRHP downloads

**3. Traffic Source Analysis:**
- **Source Tracking:**
  - Organic search (keywords, landing pages)
  - Direct traffic
  - Referral sources (which websites)
  - Social media traffic
  - Campaign tracking (UTM parameters)

- **User Acquisition Metrics:**
  - New vs returning visitors
  - Geographic distribution
  - Device categories (mobile/tablet/desktop)
  - Browser and OS distribution

**4. Real-time Monitoring Dashboard:**
- **Infrastructure Monitoring:**
  - Server health metrics (CPU, memory, disk)
  - API response times (p50, p95, p99)
  - Database query performance
  - Data pipeline status (last successful run)
  - Error rates by service

- **Business Metrics Dashboard:**
  - Active users right now
  - Most viewed IPOs today
  - Popular search terms
  - Current API load
  - Data freshness indicators

**5. Alert Configuration:**
- **Critical Alerts (Immediate):**
  - API response time >2 seconds for 5 minutes
  - Error rate >1% for 5 minutes
  - Data pipeline failure
  - Database connection failures
  - Server down >30 seconds

- **Warning Alerts (15-minute delay):**
  - Memory usage >80%
  - Disk usage >85%
  - Unusual traffic spike (potential DDoS)
  - Data staleness >1 hour

**6. Daily Automated Reports:**
- **Email Report Contents:**
  - **Traffic Summary:**
    - Unique visitors
    - Total page views
    - Average session duration
    - Bounce rate
    - Top traffic sources

  - **Content Performance:**
    - Top 10 viewed IPOs
    - Most used filters
    - Popular search queries
    - High-exit pages

  - **System Health:**
    - Uptime percentage
    - Average response times
    - Error count and types
    - Data pipeline success rate

  - **Key Insights:**
    - Significant changes from previous day
    - Anomalies detected
    - Recommendations for optimization

**7. Session Analysis Metrics:**
- **User Behavior Tracking:**
  - Pages per session
  - Average session duration
  - Bounce rate by landing page
  - User flow through site
  - Exit pages and rates
  - Site search usage and effectiveness

- **Engagement Metrics:**
  - Scroll depth on IPO pages
  - Tab switches on detail pages
  - Filter usage patterns
  - Time to first meaningful interaction

**8. Performance Monitoring:**
- **Core Web Vitals:**
  - Largest Contentful Paint (LCP) - target <2.5s
  - First Input Delay (FID) - target <100ms
  - Cumulative Layout Shift (CLS) - target <0.1
  - Time to First Byte (TTFB)
  - First Contentful Paint (FCP)

- **Page Performance:**
  - Load time by page type
  - Resource loading waterfall
  - JavaScript execution time
  - API call performance

**9. Error Tracking Setup:**
- **Sentry Configuration:**
  - Separate projects for frontend and backend
  - Error grouping and deduplication
  - Source map uploads for readable stack traces
  - User context (anonymous session ID)
  - Release tracking
  - Performance monitoring integration

- **Error Categories:**
  - JavaScript errors
  - API errors (4xx, 5xx)
  - Data pipeline errors
  - Database query failures
  - Third-party service failures

**10. Custom Dashboards:**
- **Product Dashboard:**
  - IPO funnel (list view → detail view → external action)
  - Feature adoption rates
  - User journey analysis
  - Content effectiveness

- **Technical Dashboard:**
  - Service health overview
  - API endpoint performance
  - Database query analysis
  - Cache hit rates
  - CDN performance

**11. Data Privacy Compliance:**
- **Anonymous Tracking:**
  - No PII collection in MVP
  - IP anonymization enabled
  - No cross-site tracking
  - Respect Do Not Track headers
  - Cookie consent integration

- **Data Retention:**
  - Raw data: 14 months
  - Aggregated data: Indefinite
  - Error logs: 30 days
  - Performance data: 90 days

**12. Monitoring Tools Stack:**
- **Analytics:** Google Analytics 4
- **Error Tracking:** Sentry
- **Infrastructure:** CloudWatch/Grafana
- **Uptime:** Pingdom/UptimeRobot
- **Performance:** Lighthouse CI
- **Custom Dashboards:** Metabase/Redash

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.1 (Infrastructure)
**Effort:** 2 days

**Definition of Done:**
- [ ] GA4 property created and configured
- [ ] Tracking code on all pages
- [ ] All MVP events tracked
- [ ] Real-time monitoring dashboard live
- [ ] Alert rules configured and tested
- [ ] Daily report automation working
- [ ] Error tracking operational
- [ ] Performance monitoring active
- [ ] Privacy compliance verified
- [ ] Custom dashboards created
- [ ] Documentation for metrics interpretation
- [ ] Team trained on dashboard usage

#### Story 1.8a: Windows Infrastructure Monitoring (NEW)
**As a** DevOps engineer,
**I want** comprehensive monitoring of Windows Server 2022 infrastructure,
**so that** we can ensure optimal performance and availability.

**Acceptance Criteria:**

**1. Windows Performance Monitoring:**
- **Performance Monitor Configuration:**
  - CPU, Memory, Disk, Network counters configured
  - Custom performance counter sets for IIS
  - PostgreSQL 16 performance counters
  - Alerts for threshold breaches (CPU > 80%, Memory > 90%)
  - Performance baselines established

**2. Application Insights Setup:**
- **IIS and Application Monitoring:**
  - Application Insights SDK integrated
  - Custom telemetry for business metrics
  - Dependency tracking for external services
  - Exception tracking and alerting
  - User flow analytics

**3. Windows Event Log Integration:**
- **Centralized Logging:**
  - Windows Event Forwarding configured
  - Custom event logs for applications
  - PowerShell logging enabled
  - Security audit logs configured
  - Log aggregation to central server

**4. PostgreSQL 16 Monitoring:**
- **Database-Specific Monitoring:**
  - pg_stat_statements enabled and configured
  - Query performance monitoring
  - Connection pool metrics from PgBouncer
  - Replication lag monitoring
  - Backup success/failure tracking
  - Disk space monitoring for data files

**5. IIS Monitoring:**
- **Web Server Metrics:**
  - Request rate and response times
  - Application pool health
  - Failed request tracing
  - W3C extended logging configured
  - URL Rewrite rule performance

**6. Windows Task Scheduler Monitoring:**
- **Job Execution Tracking:**
  - Task success/failure rates
  - Execution duration tracking
  - PowerShell script to export task history
  - Alerts for failed tasks
  - Dashboard for scheduled job status

**7. Alerting Configuration:**
- **Multi-Channel Alerts:**
  - Email alerts via SMTP
  - SMS alerts for critical issues
  - Slack/Teams integration
  - PagerDuty for on-call rotation
  - Alert suppression during maintenance

**8. Dashboards and Reporting:**
- **Visualization Tools:**
  - Grafana dashboards for metrics
  - PowerBI for business intelligence
  - Custom PowerShell reporting scripts
  - Daily health check reports
  - Weekly performance summaries

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.0 (Windows Server Setup)
**Effort:** 5 points

**Definition of Done:**
- [ ] All monitoring agents installed and configured
- [ ] Performance baselines established
- [ ] Alert thresholds configured and tested
- [ ] Dashboards created and accessible
- [ ] Documentation for monitoring procedures
- [ ] Runbooks for common issues created
- [ ] Team trained on monitoring tools

#### Story 1.9: Pre/Post IPO Comparison Analytics
**As an** investor,
**I want** to see before and after IPO comparisons of key metrics,
**so that** I can understand how IPOs typically perform and learn from patterns.

**Detailed Requirements:**

1. **Pre-IPO Data Collection:**
   - Company Fundamentals at IPO Time:
     * Promoter holding percentage before IPO
     * P/E ratio at issue price
     * EPS at the time of IPO
     * Revenue for last 3 years before IPO
     * EBITDA margins trend
     * Debt-to-equity ratio
     * Return on equity (ROE)
     * Asset turnover ratio
   - DRHP Commitments:
     * Projected revenue growth
     * Capacity expansion plans
     * Fund utilization objectives
     * Market share targets
     * Profitability projections
   - Valuation Metrics:
     * Issue price vs book value
     * Market cap at listing
     * Peer P/E comparison at IPO
     * Industry average valuations
   - IPO Details:
     * Issue size and structure
     * QIB/NII/Retail allocation
     * Anchor investor participation
     * Lead manager reputation score

2. **Post-IPO Tracking:**
   - Quarterly Performance Updates:
     * Revenue growth vs projections
     * Profit margins evolution
     * EPS growth trajectory
     * Quarterly results vs guidance
   - Shareholding Pattern Changes:
     * Promoter holding changes quarterly
     * FII/DII holding evolution
     * Retail investor participation trends
     * Pledge status of promoter shares
   - Market Performance:
     * Current price vs issue price
     * All-time high/low since listing
     * Returns vs Nifty/Sensex
     * Volatility metrics
     * Trading volume patterns
   - Corporate Actions:
     * Dividend history post-IPO
     * Bonus/split announcements
     * Rights issues or FPOs
     * M&A activities
   - Operational Metrics:
     * Capacity utilization updates
     * Market share changes
     * New product launches
     * Geographic expansion

3. **Comparison Views:**
   - Side-by-Side Dashboard:
     * Pre-IPO snapshot vs Current status
     * Visual indicators (up/down arrows, color coding)
     * Percentage change calculations
     * Quick summary cards
   - Timeline Visualization:
     * Quarterly progression charts
     * Event markers (corporate actions, results)
     * Interactive hover for details
     * Zoom capabilities for date ranges
   - Scorecard Format:
     * Promise vs Delivery scoring
     * Achievement percentage for each metric
     * Traffic light system (Green/Yellow/Red)
     * Overall performance grade
   - Peer Comparison:
     * Similar IPOs from same period
     * Industry peer performance
     * Relative performance ranking
     * Benchmark index comparison

4. **Pattern Recognition & Insights:**
   - Success Patterns:
     * Common traits of outperforming IPOs
     * Correlation analysis between metrics
     * Sector-wise performance patterns
     * Seasonality in IPO performance
   - Red Flags & Alerts:
     * Significant deviation from projections (>20%)
     * Promoter stake reduction alerts
     * Consistent underperformance flags
     * Peer underperformance warnings
   - Learning Insights:
     * "IPOs like this typically..." suggestions
     * Historical success rate for similar profiles
     * Risk factors that materialized
     * Lessons learned summary

5. **Data Presentation Features:**
   - Interactive Charts:
     * Toggle between different metrics
     * Adjustable time periods
     * Export chart as image
     * Full-screen view option
   - Tabular Data:
     * Sortable columns
     * Search and filter options
     * Export to Excel/CSV
     * Print-friendly format
   - Summary Reports:
     * One-page PDF summary
     * Key highlights section
     * Management commentary excerpts
     * Analyst view integration

6. **Integration Features:**
   - Data Sources:
     * BSE/NSE corporate announcements
     * Quarterly results PDFs parsing
     * DRHP document repository
     * Rating agency reports
   - Real-time Updates:
     * Auto-refresh on new results
     * Push notifications for major changes
     * Email alerts for threshold breaches
     * SMS alerts for critical updates
   - Cross-linking:
     * Link to detailed financials
     * Connect to news mentions
     * Reference to original DRHP
     * Link to registrar websites

**Acceptance Criteria:**
- Display at least 20 pre-IPO metrics
- Track minimum 15 post-IPO parameters
- Update within 1 hour of quarterly results
- Historical data for IPOs from last 5 years
- Mobile-responsive comparison views
- Sub-second load time for comparison data
- Accuracy of 99.9% in calculations
- Support for bulk IPO comparisons

**Technical Notes:**
- PostgreSQL for structured financial data
- TimescaleDB for time-series performance data
- Redis caching for frequently accessed comparisons
- Background jobs for DRHP parsing
- API endpoints for third-party data integration

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.2
**Effort:** 5 days

#### Story 1.10: IPO Allotment Status Checker
**As an** investor,
**I want** to check my IPO allotment status using PAN/Application number,
**so that** I can know if I got shares allocated.

**Detailed Requirements:**

1. **Allotment Status Input Methods:**
   - Search Options:
     * PAN Number (primary method)
     * Application Number
     * DP ID + Client ID combination
     * Beneficiary ID (16-digit)
   - Input Validation:
     * PAN format validation (AAAAA9999A)
     * Application number format checks
     * Real-time validation feedback
     * Clear error messages for invalid inputs
   - Bulk Check Features:
     * Support up to 10 applications simultaneously
     * CSV upload for bulk checking
     * Copy-paste multiple PANs feature
     * Download results in Excel format

2. **Registrar Integration:**
   - Supported Registrars:
     * Link Intime India
     * KFintech (Karvy)
     * Bigshare Services
     * Skyline Financial Services
     * Alankit Assignments
     * Beetal Financial
     * MAS Services
     * Purva Sharegistry
   - Integration Methods:
     * Direct API integration where available
     * Web scraping for registrars without APIs
     * Fallback to iframe embedding
     * Manual link redirection as last resort
   - Data Synchronization:
     * Real-time status fetching
     * Cache results for 1 hour
     * Automatic retry on failure
     * Queue management for bulk requests

3. **Allotment Display Features:**
   - Status Information:
     * Allotment status (Allotted/Not Allotted/Pending)
     * Number of shares applied
     * Number of shares allotted
     * Amount to be refunded
     * Expected credit date
     * Category of application (Retail/NII/QIB)
   - Additional Details:
     * Application date and time
     * Bank account used for application
     * ASBA status and blocking details
     * UPI mandate status (if applicable)
   - Visual Indicators:
     * Green checkmark for allotted
     * Red cross for not allotted
     * Yellow clock for pending
     * Progress bar for processing

4. **Historical Allotment Tracking:**
   - Personal History:
     * Save allotment history (with consent)
     * Track success rate over time
     * Category-wise allotment statistics
     * Amount invested vs allotted analysis
   - Pattern Analysis:
     * Identify optimal application strategies
     * Bank-wise allotment success rates
     * Time-of-application impact analysis
     * Category switching recommendations
   - Portfolio View:
     * All IPO applications in one place
     * Profit/loss on allotted IPOs
     * Upcoming refund schedule
     * Tax computation helper data

5. **User Experience Features:**
   - Quick Access:
     * Prominent placement on IPO detail pages
     * Dedicated allotment checker page
     * Widget on homepage during allotment days
     * Mobile-optimized interface
   - Notifications:
     * Email alerts when status available
     * Browser push notifications
     * SMS alerts (premium feature - post-MVP)
     * In-app notification center
   - Convenience Features:
     * Remember PAN (with encryption)
     * Auto-fill from previous checks
     * Quick links to registrar sites
     * Print-friendly allotment letter

6. **Analytics and Insights:**
   - Allotment Statistics:
     * Overall allotment percentage for IPO
     * Category-wise allotment ratios
     * Oversubscription vs allotment correlation
     * Geographic distribution of allotments
   - Predictive Features:
     * Allotment probability calculator
     * Optimal lot size suggestions
     * Best category recommendations
     * Success rate predictions
   - Comparative Analysis:
     * Compare with similar IPOs
     * Benchmark against market averages
     * Peer group allotment patterns
     * Historical trend analysis

7. **Technical Implementation:**
   - Performance Requirements:
     * Status retrieval within 3 seconds
     * Support 10,000 concurrent checks
     * 99.9% uptime during allotment days
     * Graceful degradation on registrar failure
   - Security Measures:
     * SSL encryption for all data
     * PAN masking in displays
     * No storage of sensitive data
     * Rate limiting to prevent abuse
   - Caching Strategy:
     * Redis for frequent queries
     * CDN for static registrar data
     * Browser caching for repeat checks
     * Background refresh for popular IPOs

**Acceptance Criteria:**
- Integration with all 8 major registrars
- Support for mainboard and SME IPOs
- Bulk check up to 10 applications
- Response time under 3 seconds
- Historical data for last 2 years of IPOs
- Mobile-responsive design
- Direct links to registrar sites as fallback
- Export functionality for results

**Technical Notes:**
- Node.js workers for parallel registrar queries
- PostgreSQL for allotment history storage
- Redis for caching frequent queries
- Puppeteer for registrars without APIs
- WebSocket for real-time status updates

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.2
**Effort:** 3 days

#### Story 1.11: IPO Subscription Live Data

**As an** investor,
**I want** to see real-time subscription status by category,
**so that** I can gauge demand and make application decisions.

**Detailed Requirements:**

1. **Real-time Data Sources:**
   - Primary Data Feeds:
     * NSE official subscription data API
     * BSE IPO subscription feeds
     * Exchange bulletins and updates
     * Registrar real-time feeds
   - Update Frequency:
     * Live data refresh every 30 seconds during market hours
     * End-of-day consolidated data at 8 PM
     * Intraday snapshots at 11 AM, 2 PM, 5 PM
     * Final day extended updates till 11 PM
   - Data Validation:
     * Cross-verify between NSE and BSE sources
     * Flag discrepancies for manual review
     * Maintain audit trail of all updates
     * Version control for historical accuracy

2. **Subscription Categories Display:**
   - Investor Categories:
     * Retail Individual Investors (RII)
     * Non-Institutional Investors (NII)
     * Qualified Institutional Buyers (QIB)
     * Employee reservation (if applicable)
     * Shareholder reservation (if applicable)
   - NII Sub-categories:
     * sNII (Application ≤ ₹2 lakhs)
     * bNII (Application > ₹2 lakhs to ≤ ₹10 lakhs)
     * HNI (Application > ₹10 lakhs)
   - Display Metrics:
     * Times subscribed (e.g., 2.5x, 10.2x)
     * Actual bid amount in ₹ crores
     * Number of applications received
     * Percentage of category filled
     * Bid-to-cover ratio

3. **Visual Presentation:**
   - Live Dashboard:
     * Real-time progress bars for each category
     * Color coding (Green: >1x, Yellow: 0.5-1x, Red: <0.5x)
     * Animated updates when data changes
     * Sparkline charts for trend visualization
   - Subscription Chart:
     * Time-series graph showing hourly progression
     * Day-wise subscription build-up
     * Category-wise stacked bar charts
     * Heat map for time-of-day patterns
   - Mobile View:
     * Compact card layout
     * Swipeable category cards
     * Pull-to-refresh functionality
     * Landscape mode for detailed charts

4. **Historical Comparison Features:**
   - Peer Comparison:
     * Compare with similar sized IPOs
     * Industry-wise subscription patterns
     * Same price band IPO comparisons
     * Lead manager track record overlay
   - Trend Analysis:
     * Day 1 vs Day 2 vs Day 3 patterns
     * First hour vs last hour rush analysis
     * Weekend impact on Monday subscriptions
     * Festival season subscription behaviors
   - Predictive Indicators:
     * Expected final subscription based on current trend
     * Category flip probability calculator
     * Oversubscription alerts and projections
     * Listing gain correlation indicator

5. **Advanced Analytics:**
   - Subscription Patterns:
     * Identify institutional interest levels
     * Retail FOMO indicators
     * Smart money movement tracking
     * Anchor investor influence analysis
   - Market Sentiment:
     * Subscription velocity metrics
     * Category-wise momentum indicators
     * Comparative market heat index
     * IPO fatigue measurements
   - Statistical Analysis:
     * Standard deviation from mean subscription
     * Correlation with market indices
     * Regression analysis for predictions
     * Confidence intervals for projections

6. **Alert and Notification System:**
   - Threshold Alerts:
     * Category crosses 1x, 5x, 10x, 50x subscription
     * Sudden surge in applications (>20% in 1 hour)
     * Last day reminder notifications
     * Final hour rush alerts
   - Custom Alerts:
     * User-defined subscription thresholds
     * Category-specific notifications
     * Price band revision alerts
     * Issue size change notifications
   - Delivery Channels:
     * In-app push notifications
     * Email alerts with subscription snapshot
     * Browser notifications
     * API webhooks for third-party apps

7. **Data Export and Sharing:**
   - Export Options:
     * Download as Excel/CSV
     * PDF report generation
     * Image export for charts
     * API access for developers
   - Sharing Features:
     * Social media share cards
     * WhatsApp formatted messages
     * Email subscription summary
     * Embeddable widgets for blogs
   - Report Templates:
     * Daily subscription report
     * Category-wise detailed analysis
     * Comparative subscription report
     * Final subscription summary

**Acceptance Criteria:**
- Real-time updates every 30 seconds
- Support for all investor categories including sub-categories
- Historical data for last 500 IPOs
- Mobile-responsive charts and visualizations
- Data accuracy of 99.9% with NSE/BSE sources
- Alert delivery within 1 minute of trigger
- Export functionality in multiple formats
- API rate limits of 1000 requests/hour

**Technical Notes:**
- WebSocket connections for live data streaming
- Redis pub/sub for real-time updates
- TimescaleDB for time-series subscription data
- Chart.js or D3.js for interactive visualizations
- Background workers for data synchronization
- CDN for static subscription snapshots

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.2
**Effort:** 4 days

#### Story 1.12: IPO Forms & Downloads

**As an** investor,
**I want** to download IPO application forms and key documents,
**so that** I can apply offline or review documents before investing.

**Detailed Requirements:**

1. **Document Repository:**
   - IPO Application Forms:
     * ASBA forms for all major banks
     * UPI-based application forms
     * Physical application forms
     * Revision/withdrawal forms
     * Category change forms
   - Key IPO Documents:
     * DRHP (Draft Red Herring Prospectus)
     * RHP (Red Herring Prospectus)
     * Prospectus (final)
     * Abridged prospectus
     * Addendum/corrigendum notices
   - Supporting Documents:
     * Anchor investor list
     * Basis of allotment document
     * Post-issue advertisements
     * Credit rating reports
     * Industry research reports

2. **Form Management System:**
   - Bank-specific Forms:
     * Forms for 50+ banks including SBI, HDFC, ICICI, Axis, Kotak
     * Cooperative bank forms
     * Foreign bank forms
     * Small finance bank forms
   - Form Versions:
     * Latest version tracking
     * Version history maintenance
     * Change log documentation
     * Auto-update notifications
   - Multi-language Support:
     * English forms (mandatory)
     * Hindi forms where available
     * Regional language forms
     * Translation assistance

3. **Download Features:**
   - Quick Download Options:
     * One-click download for common forms
     * Bulk download ZIP packages
     * Form bundles by bank
     * Document sets by IPO
   - Smart Recommendations:
     * Suggest forms based on user's bank
     * Pre-filled sample forms
     * Application checklist
     * Document requirement guide
   - Offline Access:
     * Downloadable form packages
     * Offline form viewer
     * Print-optimized versions
     * Mobile-friendly PDFs

4. **Search and Organization:**
   - Search Capabilities:
     * Search by bank name
     * Search by IPO name
     * Document type filters
     * Date-based sorting
   - Categorization:
     * By document type
     * By IPO status (live/upcoming/closed)
     * By bank/financial institution
     * By language
   - Quick Access:
     * Most downloaded forms section
     * Recently updated documents
     * Bookmarked documents
     * Download history

**Acceptance Criteria:**
- Repository of 50+ bank ASBA forms
- All DRHP/RHP documents for active IPOs
- Multi-format support (PDF, DOC, XLS)
- Version control and update tracking
- Mobile-responsive download interface
- Search and filter functionality
- Bulk download capabilities
- Download analytics tracking

**Technical Notes:**
- CDN for fast document delivery
- PostgreSQL for document metadata
- S3/Cloud storage for document files
- Background jobs for document processing
- PDF optimization for mobile devices

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.2
**Effort:** 2 days

#### Story 1.13: Kostak Rates & Subject-to-Sauda

**As an** investor,
**I want** to see Kostak rates and grey market premiums,
**so that** I can understand pre-listing market sentiment.

**Detailed Requirements:**

1. **Kostak Rate Tracking:**
   - Rate Components:
     * Current Kostak rate per lot
     * Historical Kostak rates (hourly/daily)
     * Kostak rate trends and charts
     * Application-wise Kostak rates
   - Rate Sources:
     * Multiple grey market dealer inputs
     * Weighted average calculations
     * Outlier detection and removal
     * Source reliability scoring
   - Update Frequency:
     * Real-time updates during market hours
     * Hourly snapshots for trending
     * End-of-day consolidated rates
     * Pre-market and post-market updates

2. **Subject-to-Sauda Rates:**
   - Rate Display:
     * Current subject-to-sauda premium
     * Profit per lot calculations
     * Risk-adjusted returns
     * Break-even analysis
   - Comparison Features:
     * Kostak vs Subject-to-sauda comparison
     * Risk-reward analysis
     * Historical success rates
     * Category-wise profitability
   - Market Indicators:
     * Buyer/seller ratio
     * Volume indicators
     * Market depth analysis
     * Sentiment scoring

3. **Grey Market Premium (GMP):**
   - GMP Tracking:
     * Current GMP value
     * GMP history (with timestamps)
     * Expected listing price calculation
     * GMP volatility index
   - Trend Analysis:
     * Hourly GMP movement charts
     * Day-wise progression
     * Pre-listing day patterns
     * Post-announcement impacts
   - Predictive Analytics:
     * GMP to listing gain correlation
     * Historical accuracy rates
     * Confidence intervals
     * Risk indicators

4. **Market Intelligence:**
   - Dealer Network:
     * Verified dealer contacts
     * Regional rate variations
     * Dealer reliability ratings
     * Transaction volume estimates
   - Market Commentary:
     * Expert opinions on rates
     * News impact on grey market
     * Regulatory changes effects
     * Market manipulation alerts
   - Risk Warnings:
     * Legal disclaimer prominent display
     * Risk education content
     * Fraud prevention tips
     * Regulatory compliance notices

5. **Data Presentation:**
   - Visual Elements:
     * Real-time rate tickers
     * Candlestick charts for GMP
     * Heat maps for rate changes
     * Comparison tables
   - Mobile Interface:
     * Swipeable rate cards
     * Push notifications for rate changes
     * Widget for home screen
     * Offline rate caching
   - Export Features:
     * Historical data download
     * Rate alerts via email
     * API access for developers
     * Embeddable widgets

**Acceptance Criteria:**
- Real-time Kostak and subject-to-sauda rates
- GMP tracking with 15-minute updates
- Historical data for 2+ years
- Multiple dealer source integration
- Mobile-responsive interface
- Prominent risk disclaimers
- Comparison and analysis tools
- Alert system for rate changes

**Technical Notes:**
- Redis for real-time rate caching
- TimescaleDB for historical rate data
- WebSocket for live rate updates
- Rate aggregation algorithms
- Anomaly detection systems

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.2
**Effort:** 3 days

#### Story 1.14: IPO Listing Gains/Losses Tracker

**As an** investor,
**I want** to track listing day performance and subsequent returns,
**so that** I can analyze IPO investment outcomes.

**Detailed Requirements:**

1. **Listing Day Performance:**
   - Opening Metrics:
     * Listing day opening price
     * Opening vs issue price gain/loss %
     * Opening vs last GMP comparison
     * Pre-open session data
   - Intraday Tracking:
     * High/low of listing day
     * Closing price and gain/loss
     * Volume and delivery data
     * Minute-by-minute price chart
   - Category Analysis:
     * Retail investor returns
     * HNI investor returns
     * QIB investor returns
     * Employee/shareholder quota returns

2. **Post-Listing Tracking:**
   - Performance Periods:
     * 1 day, 1 week, 1 month returns
     * 3 months, 6 months, 1 year returns
     * Current trading price
     * All-time high/low since listing
   - Benchmark Comparison:
     * Returns vs Nifty/Sensex
     * Sector index comparison
     * Peer IPO performance
     * Market cap evolution
   - Technical Indicators:
     * Moving averages (20, 50, 200 DMA)
     * RSI and momentum indicators
     * Support/resistance levels
     * Volume analysis

3. **Statistical Analysis:**
   - Success Metrics:
     * Percentage of profitable IPOs
     * Average listing gains by sector
     * Month-wise listing performance
     * Lead manager performance stats
   - Risk Analytics:
     * Maximum drawdown from listing
     * Volatility measurements
     * Beta calculations
     * Sharpe ratio for IPO investments
   - Pattern Recognition:
     * Successful IPO characteristics
     * Failure pattern identification
     * Seasonal performance trends
     * Market cycle impacts

4. **Portfolio Tracking:**
   - Investment Tracking:
     * Applied vs allotted analysis
     * Cost basis calculations
     * Current portfolio value
     * Realized vs unrealized gains
   - Tax Calculations:
     * Short-term capital gains
     * Long-term capital gains
     * Tax liability estimation
     * Tax-saving strategies
   - Performance Reports:
     * Individual IPO P&L statements
     * Portfolio summary dashboard
     * Year-wise performance
     * Export for tax filing

5. **Alert System:**
   - Price Alerts:
     * Listing day notifications
     * Target price achievements
     * Stop-loss triggers
     * New high/low alerts
   - Performance Milestones:
     * 50%, 100% gain alerts
     * Break-even notifications
     * Anniversary reminders
     * Corporate action alerts
   - Market Events:
     * Lock-in period expiry
     * Anchor investor exit window
     * Promoter stake changes
     * Rating changes

**Acceptance Criteria:**
- Real-time listing day tracking
- Historical data for 5+ years of IPOs
- Multi-period return calculations
- Benchmark comparison tools
- Portfolio tracking features
- Tax calculation support
- Alert and notification system
- Mobile-responsive interface

**Technical Notes:**
- Real-time price feed integration
- PostgreSQL for transaction data
- Redis for price caching
- Background jobs for calculations
- WebSocket for live updates

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.2
**Effort:** 3 days

#### Story 1.15: Upcoming IPO Calendar

**As an** investor,
**I want** to see upcoming IPOs in a calendar view,
**so that** I can plan my investment schedule.

**Detailed Requirements:**

1. **Calendar Views:**
   - Display Formats:
     * Monthly calendar grid view
     * Weekly timeline view
     * List view with filters
     * Agenda view by date
   - IPO Phases:
     * Anchor bidding dates
     * IPO opening dates
     * IPO closing dates
     * Allotment dates
     * Listing dates
     * Refund initiation dates
   - Visual Indicators:
     * Color coding by IPO type (Main/SME)
     * Icons for IPO size categories
     * Status badges (Confirmed/Tentative)
     * Subscription level indicators

2. **IPO Information Display:**
   - Quick View Cards:
     * Company name and logo
     * Issue size and price band
     * Opening and closing dates
     * Minimum investment amount
     * GMP and subscription status
   - Detailed Previews:
     * Business description summary
     * Key financials snapshot
     * Lead managers and registrar
     * Important dates timeline
     * Quick action buttons
   - Interactive Features:
     * Hover for quick details
     * Click for full IPO page
     * Add to personal calendar
     * Set reminders
     * Share event

3. **Filtering and Sorting:**
   - Filter Options:
     * By IPO type (Mainboard/SME)
     * By issue size ranges
     * By sector/industry
     * By price bands
     * By minimum investment
     * By lead manager
     * By expected listing gains
   - Sort Options:
     * By opening date
     * By closing date
     * By issue size
     * By subscription levels
     * By GMP values
     * By expected returns
   - Search Features:
     * Company name search
     * Sector search
     * Date range selection
     * Advanced search filters

4. **Notification Management:**
   - Reminder Settings:
     * IPO opening reminders
     * Last day alerts
     * Allotment day notifications
     * Listing day alerts
     * Custom time reminders
   - Delivery Channels:
     * Email notifications
     * Push notifications
     * SMS alerts (post-MVP)
     * Calendar app integration
   - Subscription Preferences:
     * Select IPO categories
     * Minimum issue size
     * Sector preferences
     * GMP thresholds

5. **Integration Features:**
   - Calendar Sync:
     * Google Calendar export
     * Outlook calendar sync
     * Apple Calendar support
     * .ics file downloads
   - External Sharing:
     * Share to social media
     * WhatsApp formatted messages
     * Email calendar invites
     * Embed on websites
   - API Access:
     * Calendar data API
     * Webhook notifications
     * RSS feeds
     * JSON/XML exports

**Acceptance Criteria:**
- Multiple calendar view options
- Real-time IPO schedule updates
- 3-month forward visibility
- Filter and sort capabilities
- Reminder system implementation
- Calendar app integrations
- Mobile-responsive design
- Offline calendar access

**Technical Notes:**
- FullCalendar.js or similar library
- PostgreSQL for event storage
- Redis for calendar caching
- Background jobs for reminders
- iCal format support

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.2
**Effort:** 3 days

#### Story 1.16: Basis of Allotment

**As an** investor,
**I want** to understand how IPO allotment is determined,
**so that** I can optimize my application strategy.

**Detailed Requirements:**

1. **Allotment Rules Display:**
   - Category-wise Rules:
     * Retail allotment methodology
     * HNI proportionate allotment
     * QIB discretionary allotment
     * Employee/shareholder reservation rules
   - Lottery System Explanation:
     * Minimum allotment logic
     * Computerized random selection
     * Application-wise vs PAN-wise allotment
     * Multiple application handling
   - Oversubscription Scenarios:
     * Allotment ratio calculations
     * Examples with different subscription levels
     * Category-wise allotment tables
     * Refund amount calculations

2. **Allotment Calculators:**
   - Probability Calculator:
     * Input subscription levels
     * Calculate allotment chances
     * Optimal lot size suggestions
     * Investment amount recommendations
   - Scenario Analysis:
     * Multiple application strategies
     * Family member applications
     * Category switching analysis
     * Cost-benefit calculations
   - Historical Analysis:
     * Past allotment patterns
     * Success rate by investment amount
     * Category-wise historical data
     * Bank-wise allotment statistics

3. **Official Documents:**
   - Basis of Allotment Files:
     * Download official PDFs
     * Registrar-wise documents
     * Historical documents archive
     * Search and filter options
   - Allotment Statistics:
     * Total applications received
     * Valid applications count
     * Category-wise demand
     * Allotment ratios
   - Detailed Tables:
     * Application size vs allotment
     * Draw of lots results
     * Category-wise distribution
     * Geographic distribution

4. **Educational Content:**
   - How-to Guides:
     * Understanding allotment process
     * Maximizing allotment chances
     * Common mistakes to avoid
     * FAQ section
   - Video Tutorials:
     * Allotment process explained
     * Calculator usage guide
     * Strategy optimization tips
     * Expert interviews
   - Case Studies:
     * Successful allotment strategies
     * Analysis of popular IPOs
     * Lessons from oversubscribed IPOs
     * Category switching examples

5. **Interactive Tools:**
   - Allotment Simulator:
     * Input application details
     * Simulate different scenarios
     * Compare strategies
     * Visual probability display
   - Strategy Builder:
     * Family application planner
     * Budget optimization tool
     * Risk assessment
     * Expected returns calculator
   - Comparison Tools:
     * Compare IPO allotment patterns
     * Historical success rates
     * Category performance analysis
     * ROI comparisons

**Acceptance Criteria:**
- Complete allotment rules documentation
- Interactive probability calculators
- Historical basis documents for 500+ IPOs
- Educational content and guides
- Simulation and strategy tools
- Mobile-responsive interface
- Multi-language support
- Regular updates with new IPOs

**Technical Notes:**
- PostgreSQL for allotment data
- Statistical libraries for calculations
- PDF parsing for documents
- Caching for frequent queries
- Background jobs for updates

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.10
**Effort:** 2 days

#### Story 1.17: IPO Reservations & Quotas

**As an** investor,
**I want** to understand special reservation categories,
**so that** I can apply in the appropriate category if eligible.

**Detailed Requirements:**

1. **Reservation Categories:**
   - Standard Categories:
     * Retail Individual Investors (35%)
     * Non-Institutional Investors (15%)
     * Qualified Institutional Buyers (50%)
   - Special Reservations:
     * Employee reservation quota
     * Existing shareholder quota
     * Policy holder reservation (insurance IPOs)
     * Mutual fund specific allocations
   - Regional Reservations:
     * State-specific quotas
     * Local area reservations
     * Anchor investor allocations
     * Strategic investor portions

2. **Eligibility Criteria:**
   - Category Requirements:
     * Investment limits per category
     * Documentation requirements
     * KYC and demat prerequisites
     * PAN card requirements
   - Special Eligibility:
     * Employee ID verification
     * Shareholder record dates
     * Policy holder criteria
     * Regional domicile proofs
   - Restrictions:
     * Multiple application rules
     * Family member applications
     * Company-specific limitations
     * Lock-in period details

3. **Quota Utilization Display:**
   - Real-time Tracking:
     * Reserved portion status
     * Subscription in each quota
     * Unutilized portion handling
     * Spillover to other categories
   - Visual Representation:
     * Pie charts for quota distribution
     * Progress bars for utilization
     * Color-coded categories
     * Interactive tooltips
   - Historical Data:
     * Past quota utilization patterns
     * Success rates by category
     * Spillover frequency analysis
     * Category-wise returns

4. **Application Guidance:**
   - Category Selection Help:
     * Eligibility checker tool
     * Category recommendation
     * Document checklist
     * Application process guide
   - Optimization Strategies:
     * Best category selection
     * Quota vs general category analysis
     * Historical success comparison
     * Investment amount optimization
   - Common Mistakes:
     * Wrong category selection
     * Documentation errors
     * Eligibility misunderstanding
     * Application rejection reasons

5. **Discount Information:**
   - Employee Discounts:
     * Discount percentage display
     * Effective price calculation
     * Savings calculator
     * Tax implications
   - Retail Discount:
     * Discount per share
     * Maximum discount amount
     * Eligibility criteria
     * Application process
   - Comparison Tools:
     * Discounted vs regular price
     * Category-wise pricing
     * Total benefit calculation
     * ROI with discounts

**Acceptance Criteria:**
- Complete reservation category information
- Eligibility checking tools
- Real-time quota tracking
- Visual quota representations
- Application guidance system
- Discount calculators
- Historical utilization data
- Mobile-friendly interface

**Technical Notes:**
- Dynamic quota calculation engine
- Real-time data synchronization
- Rule-based eligibility system
- PostgreSQL for quota data
- Caching for performance

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.11
**Effort:** 2 days

#### Story 1.18: IPO Recommendations & Analysis

**As an** investor,
**I want** to see expert analysis and recommendations,
**so that** I can make informed investment decisions.

**Detailed Requirements:**

1. **Expert Analysis Section:**
   - Fundamental Analysis:
     * Business model evaluation
     * Financial performance review
     * Management quality assessment
     * Competitive positioning analysis
     * Growth prospects evaluation
   - Technical Analysis:
     * Valuation metrics comparison
     * Price band analysis
     * Peer comparison studies
     * Market timing assessment
     * Risk-reward evaluation
   - SWOT Analysis:
     * Strengths identification
     * Weaknesses assessment
     * Opportunities analysis
     * Threats evaluation
     * Overall rating

2. **Recommendation System:**
   - Rating Scale:
     * 5-star rating system
     * Subscribe/Avoid/Neutral recommendations
     * Risk rating (Low/Medium/High)
     * Investment horizon suggestions
     * Target price projections
   - Multiple Perspectives:
     * In-house analysis team views
     * Aggregated broker ratings
     * Crowd-sourced ratings
     * AI-based recommendations
     * Historical accuracy tracking
   - Recommendation Factors:
     * Score breakdown by parameters
     * Weightage explanation
     * Key decision factors
     * Red flags highlighted
     * Green signals identified

3. **Research Reports:**
   - Report Types:
     * Quick view summary (1-pager)
     * Detailed analysis report (10+ pages)
     * Video analysis summaries
     * Infographic presentations
     * Comparison reports
   - Content Sections:
     * Executive summary
     * Business overview
     * Financial analysis
     * Industry analysis
     * Investment thesis
     * Risk factors
     * Recommendation rationale
   - Update Frequency:
     * Pre-IPO initial report
     * Subscription update
     * Pre-allotment final view
     * Post-listing review
     * Quarterly updates

4. **Peer Comparison:**
   - Comparison Metrics:
     * P/E ratio comparison
     * EV/EBITDA multiples
     * Revenue growth rates
     * Profit margin analysis
     * Market share comparison
     * Return ratios
   - Industry Benchmarks:
     * Sector averages
     * Industry leaders comparison
     * Global peers analysis
     * Historical IPO performance
   - Visual Comparisons:
     * Comparison tables
     * Spider charts
     * Bar graph comparisons
     * Scatter plot positioning
     * Heat map analysis

5. **User Interaction Features:**
   - Feedback System:
     * Rate the analysis
     * Comment on recommendations
     * Share alternative views
     * Report inaccuracies
     * Track recommendation performance
   - Personalization:
     * Save favorite analysts
     * Custom alert settings
     * Recommendation filters
     * Historical accuracy tracking
     * Portfolio alignment check
   - Social Features:
     * Share recommendations
     * Discuss in forums
     * Follow expert analysts
     * Create watchlists
     * Compare with community

**Acceptance Criteria:**
- Multi-source recommendation aggregation
- Detailed analysis reports for all IPOs
- 5-star rating system implementation
- Peer comparison tools
- Historical accuracy tracking
- Interactive visualization tools
- Mobile-optimized reports
- Regular report updates

**Technical Notes:**
- PostgreSQL for analysis data
- Machine learning for recommendations
- PDF generation for reports
- Real-time aggregation engine
- Caching for performance

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.3, 1.19
**Effort:** 4 days

#### Story 1.19: Financial Metrics & Peer Comparison

**As an** investor,
**I want** to analyze detailed financials and compare with peers,
**so that** I can assess valuation and growth prospects.

**Detailed Requirements:**

1. **Financial Statements Display:**
   - Income Statement:
     * Revenue trends (5 years)
     * EBITDA and margins
     * Net profit progression
     * EPS growth trajectory
     * Segment-wise revenue
   - Balance Sheet:
     * Assets and liabilities
     * Shareholder equity
     * Working capital trends
     * Debt composition
     * Capital structure
   - Cash Flow Statement:
     * Operating cash flow
     * Capital expenditure
     * Free cash flow
     * Financing activities
     * Cash position trends
   - Quarterly Results:
     * Latest 8 quarters data
     * QoQ and YoY growth
     * Seasonal patterns
     * Guidance vs actual
     * Result surprises

2. **Key Financial Ratios:**
   - Profitability Ratios:
     * Gross margin, EBITDA margin, Net margin
     * Return on Equity (ROE)
     * Return on Assets (ROA)
     * Return on Capital Employed (ROCE)
     * Asset turnover ratios
   - Liquidity Ratios:
     * Current ratio
     * Quick ratio
     * Cash ratio
     * Operating cash flow ratio
     * Working capital days
   - Leverage Ratios:
     * Debt-to-Equity ratio
     * Interest coverage ratio
     * Debt service coverage
     * Financial leverage
     * Fixed charge coverage
   - Valuation Ratios:
     * P/E ratio (trailing and forward)
     * P/B ratio
     * EV/EBITDA
     * P/S ratio
     * PEG ratio
     * Dividend yield

3. **Peer Comparison Framework:**
   - Peer Selection:
     * Auto-selected industry peers
     * Market cap based peers
     * Business model similarity
     * Geographic presence matching
     * Custom peer selection
   - Comparison Metrics:
     * Side-by-side financials
     * Ratio comparisons
     * Growth rate analysis
     * Margin comparisons
     * Valuation multiples
     * Market share data
   - Ranking System:
     * Industry percentile rankings
     * Peer group positioning
     * Best-in-class identification
     * Underperformers flagging
     * Relative strength scoring

4. **Visualization Tools:**
   - Interactive Charts:
     * Revenue and profit trends
     * Margin evolution graphs
     * Ratio comparison charts
     * Peer scatter plots
     * Waterfall charts
   - Comparison Tables:
     * Sortable data tables
     * Heat map coloring
     * Expandable details
     * Export capabilities
     * Print-friendly formats
   - Custom Dashboards:
     * Drag-and-drop widgets
     * Saved view templates
     * Metric selection
     * Time period selection
     * Refresh settings

5. **Advanced Analytics:**
   - Trend Analysis:
     * CAGR calculations
     * Regression analysis
     * Seasonality detection
     * Cycle identification
     * Forecast projections
   - Quality Metrics:
     * Earnings quality score
     * Balance sheet strength
     * Cash flow reliability
     * Accounting red flags
     * Audit observations
   - Segment Analysis:
     * Product-wise performance
     * Geography-wise data
     * Customer concentration
     * Channel performance
     * Vertical integration

**Acceptance Criteria:**
- 5 years of financial history
- 20+ financial ratios calculated
- Real-time peer comparison
- Interactive visualization tools
- Export functionality
- Mobile-responsive tables
- Automated ratio calculations
- Regular data updates

**Technical Notes:**
- PostgreSQL for financial data
- Python for ratio calculations
- D3.js for visualizations
- Redis for caching
- API integration for data feeds

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.2
**Effort:** 4 days

#### Story 1.20: Corporate Actions Tracking

**As an** investor,
**I want** to track post-IPO corporate actions,
**so that** I can monitor company developments and their impact.

**Detailed Requirements:**

1. **Corporate Action Types:**
   - Capital Actions:
     * Bonus issues
     * Stock splits
     * Rights issues
     * Buyback announcements
     * FPO/OFS launches
   - Dividend Actions:
     * Dividend declarations
     * Interim dividends
     * Final dividends
     * Special dividends
     * Dividend history
   - Structural Changes:
     * Mergers and acquisitions
     * Demergers/spin-offs
     * Delisting proposals
     * Scheme of arrangements
     * Change in capital structure
   - Other Actions:
     * Board meeting outcomes
     * AGM/EGM decisions
     * Rating changes
     * Auditor changes
     * Management changes

2. **Timeline Display:**
   - Chronological View:
     * Timeline visualization
     * Date-wise listing
     * Upcoming actions calendar
     * Historical actions archive
     * Filter by action type
   - Event Details:
     * Announcement date
     * Record date
     * Ex-date
     * Payment/execution date
     * Impact analysis
   - Notifications:
     * Real-time action alerts
     * Upcoming event reminders
     * Important date notifications
     * Impact assessment alerts
     * Follow-up action items

3. **Impact Analysis:**
   - Price Impact:
     * Pre and post announcement prices
     * Adjusted price calculations
     * Volume analysis
     * Market reaction metrics
     * Peer comparison
   - Shareholder Impact:
     * Shareholding pattern changes
     * Dilution calculations
     * Benefit computations
     * Tax implications
     * Net worth impact
   - Ratio Adjustments:
     * Adjusted EPS
     * Modified P/E ratios
     * Updated book values
     * Recalculated returns
     * Historical adjustments

4. **Documentation:**
   - Official Documents:
     * Exchange announcements
     * Company intimations
     * Board resolutions
     * Regulatory filings
     * Scheme documents
   - Analysis Reports:
     * Impact assessment reports
     * Expert commentary
     * Media coverage
     * Analyst views
     * Investor presentations
   - Historical Records:
     * Complete action history
     * Document archive
     * Price adjustment log
     * Corporate governance track
     * Compliance records

5. **Integration Features:**
   - Portfolio Impact:
     * Automatic adjustment calculations
     * Holding value updates
     * Action benefit tracking
     * Tax computation support
     * Corporate benefit claims
   - Alert Customization:
     * Action type preferences
     * Threshold settings
     * Delivery channels
     * Follow-up reminders
     * Portfolio-specific alerts
   - Data Export:
     * CSV/Excel downloads
     * API access
     * Calendar integration
     * Report generation
     * Audit trails

**Acceptance Criteria:**
- Track 15+ types of corporate actions
- Real-time announcement updates
- Historical data for 5+ years
- Automatic price adjustments
- Impact analysis tools
- Document repository
- Alert system implementation
- Mobile-responsive interface

**Technical Notes:**
- Event-driven architecture
- PostgreSQL for action data
- Document storage system
- Real-time feed integration
- Background job processing

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.2
**Effort:** 3 days

#### Story 1.21: Shareholding Pattern Display

**As an** investor,
**I want** to see detailed shareholding patterns and changes,
**so that** I can understand ownership dynamics and stakeholder confidence.

**Detailed Requirements:**

1. **Shareholding Categories:**
   - Promoter Holdings:
     * Individual promoter holdings
     * Promoter group holdings
     * Pledged shares details
     * Lock-in share information
     * Change in promoter stake
   - Institutional Holdings:
     * FII/FPI holdings
     * DII holdings breakdown
     * Mutual fund holdings
     * Insurance companies
     * Banks and FIs
   - Public Holdings:
     * Retail investors (<2 lakhs)
     * HNI investors (>2 lakhs)
     * Corporate bodies
     * NRIs and OCBs
     * Others category
   - Special Categories:
     * Employee trusts
     * ESOP holdings
     * Anchor investors (with lock-in)
     * Strategic investors
     * Government holdings

2. **Trend Analysis:**
   - Quarterly Changes:
     * Quarter-on-quarter variations
     * Category-wise movements
     * Major stake changes
     * Entry/exit of investors
     * Trend indicators
   - Historical Patterns:
     * 5-year shareholding evolution
     * Pre vs post-IPO comparison
     * Promoter stake trajectory
     * Institutional interest trends
     * Retail participation growth
   - Visual Representations:
     * Pie charts for current holding
     * Stacked area charts for trends
     * Waterfall charts for changes
     * Heat maps for movements
     * Sankey diagrams for flows

3. **Pledge Information:**
   - Pledge Details:
     * Percentage of shares pledged
     * Promoter-wise pledge data
     * Pledge creation/release dates
     * Pledge value calculations
     * Historical pledge trends
   - Risk Indicators:
     * Pledge coverage ratios
     * Market value vs pledge value
     * Margin call thresholds
     * Historical invocations
     * Peer comparison
   - Alerts:
     * New pledge creation
     * Pledge release
     * Significant increase alerts
     * Margin pressure indicators
     * Invocation notices

4. **Major Shareholders:**
   - Top Shareholders List:
     * Top 10 shareholders
     * Percentage holdings
     * Change from previous quarter
     * Entry/exit tracking
     * Category classification
   - Institutional Details:
     * Fund-wise holdings
     * Investment style analysis
     * Historical transactions
     * Portfolio concentration
     * Investment philosophy
   - Bulk/Block Deals:
     * Deal notifications
     * Buyer/seller details
     * Price and quantity
     * Impact on shareholding
     * Historical deals

5. **Regulatory Compliance:**
   - Compliance Tracking:
     * Minimum public shareholding
     * SEBI regulations adherence
     * Lock-in compliance
     * Disclosure compliance
     * Creeping acquisition rules
   - Disclosure Reports:
     * Quarterly compliance reports
     * Annual shareholding pattern
     * Regulation 31 disclosures
     * Related party holdings
     * Benami tracking
   - Analysis Tools:
     * Compliance score
     * Red flag identification
     * Regulatory risk assessment
     * Peer compliance comparison
     * Historical violations

**Acceptance Criteria:**
- Quarterly shareholding data for 5+ years
- Real-time pledge tracking
- Visual trend analysis tools
- Top shareholder identification
- Compliance monitoring system
- Bulk/block deal tracking
- Alert system for changes
- Mobile-responsive displays

**Technical Notes:**
- PostgreSQL for shareholding data
- Time-series analysis tools
- Visualization libraries
- Real-time feed processing
- Compliance rule engine

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.2
**Effort:** 3 days

#### Story 1.22: IPO Performance Tracking

**As an** investor,
**I want** comprehensive IPO performance tracking and analytics,
**so that** I can evaluate investment outcomes and learn from patterns.

**Detailed Requirements:**

1. **Performance Metrics Dashboard:**
   - Key Performance Indicators:
     * Current price vs IPO price
     * Absolute returns percentage
     * Annualized returns (CAGR)
     * Maximum gain achieved
     * Maximum drawdown
     * Current status (profit/loss)
   - Time-based Returns:
     * Listing day gains
     * 1 week, 1 month returns
     * 3 months, 6 months returns
     * 1 year, 2 year, 3 year returns
     * Since listing returns
   - Risk Metrics:
     * Volatility measurements
     * Beta calculations
     * Standard deviation
     * Sharpe ratio
     * Risk-adjusted returns

2. **Comparative Performance:**
   - Benchmark Comparison:
     * Performance vs Nifty 50
     * Performance vs Sensex
     * Sector index comparison
     * Small/Mid cap index comparison
     * Custom benchmark selection
   - Peer IPO Comparison:
     * Same period IPO performance
     * Industry peer comparison
     * Size-based comparison
     * Lead manager track record
     * Similar valuation IPOs
   - Category Analysis:
     * Mainboard vs SME performance
     * Sector-wise performance ranking
     * Year-wise cohort analysis
     * Size-wise performance buckets
     * Price band analysis

3. **Success/Failure Analysis:**
   - Success Factors:
     * Successful IPO characteristics
     * Common success patterns
     * Timing analysis
     * Subscription correlation
     * GMP accuracy
   - Failure Patterns:
     * Red flags identification
     * Common failure traits
     * Wealth destruction cases
     * Recovery analysis
     * Delisting cases
   - Learning Insights:
     * Best performing IPOs
     * Worst performing IPOs
     * Surprise performers
     * Missed opportunities
     * Key lessons database

4. **Portfolio Performance:**
   - Aggregate Metrics:
     * Overall portfolio returns
     * Win/loss ratio
     * Average holding period
     * Best/worst investments
     * Risk-return profile
   - Attribution Analysis:
     * Sector-wise contribution
     * Time period analysis
     * Selection vs timing
     * Size attribution
     * Style analysis
   - What-if Scenarios:
     * Different allocation strategies
     * Entry/exit timing impact
     * Category selection impact
     * Holding period optimization
     * Rebalancing strategies

5. **Reporting and Export:**
   - Performance Reports:
     * Individual IPO report cards
     * Portfolio performance summary
     * Period-wise analysis
     * Tax computation reports
     * Audit trail reports
   - Visualizations:
     * Performance heat maps
     * Return distribution charts
     * Rolling return graphs
     * Drawdown charts
     * Correlation matrices
   - Export Options:
     * Excel/CSV downloads
     * PDF reports
     * API data access
     * Scheduled reports
     * Custom templates

6. **Predictive Analytics:**
   - Performance Forecasting:
     * Expected return ranges
     * Probability distributions
     * Monte Carlo simulations
     * Scenario modeling
     * Risk projections
   - Pattern Recognition:
     * ML-based pattern detection
     * Anomaly identification
     * Trend predictions
     * Cycle analysis
     * Sentiment correlation
   - Alert System:
     * Performance milestones
     * Unusual movements
     * Target achievements
     * Risk threshold breaches
     * Opportunity alerts

**Acceptance Criteria:**
- Track all IPOs from last 10 years
- Real-time performance updates
- 15+ performance metrics
- Benchmark comparison tools
- Portfolio analytics
- Predictive analytics features
- Export and reporting tools
- Mobile-responsive interface

**Technical Notes:**
- TimescaleDB for performance data
- Python for analytics calculations
- Machine learning libraries
- Real-time price feeds
- Advanced charting libraries

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.14
**Effort:** 4 days

---

### Epic 2: Mobile PWA Implementation

#### Story 2.1: PWA Implementation (Previously Story 3.1)
**As a** mobile user,
**I want** to install and use IPODhan as a Progressive Web App,
**so that** I get an app-like experience without downloading from app stores.

**Acceptance Criteria:**
1. Service worker implementation for offline functionality
2. Web app manifest with IPODhan branding and icons
3. Install prompt for Add to Home Screen
4. Offline page for network failures
5. Cache strategy for IPO data (cache-first for static, network-first for dynamic)
6. Push notification capability via web push API
7. Responsive design optimized for all screen sizes
8. App shell architecture for instant loading

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.4
**Effort:** 2 days

#### Story 2.2: PWA Performance Optimization (Previously Story 3.2)
**As a** mobile user,
**I want** the PWA to work smoothly even on low-end devices and slow networks,
**so that** I can use it regardless of my phone or connection.

**Acceptance Criteria:**
1. Initial load <3 seconds on 3G
2. Time to Interactive <5 seconds
3. Lighthouse PWA score >90
4. Image optimization with lazy loading and WebP format
5. Critical CSS inlining
6. Route-based code splitting
7. Background sync for data updates
8. Works on Android 5.0+ browsers

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 2.1
**Effort:** 2 days

---

### Epic 3: Calculators & Tools

#### Story 3.1: Advanced IPO Calculators (Previously Story 4.1)
**As an** investor,
**I want** to calculate potential returns and allotment probability,
**so that** I can optimize my application strategy.

**Acceptance Criteria:**
1. Allotment probability calculator with historical accuracy
2. ROI calculator with listing gain estimates
3. Lot size optimizer for maximum allotment chances
4. Break-even calculator for different scenarios
5. Unlimited calculations for all users (no restrictions)
6. Results can be saved and shared

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.3
**Effort:** 2 days

#### Story 3.2: Broker Comparison Engine (Previously Story 4.2)
**As an** investor,
**I want** to compare broker charges and features,
**so that** I can choose the best platform for IPO applications.

**Acceptance Criteria:**
1. Comprehensive broker database (15+ brokers)
2. Side-by-side comparison tool (max 3 brokers)
3. Filter by charges, features, platform capabilities
4. Affiliate links for account opening (revenue source)
5. Editorial reviews and ratings (no user reviews in MVP)
6. "Best for IPOs" recommendations

**Priority:** 🔴 MVP-CRITICAL
**Dependencies:** Story 1.4
**Effort:** 3 days

---

*[Document continues with POST-MVP epics and stories...]*

## Document Status

**Last Updated:** January 29, 2025
**Review Progress:**
- Epic 1: Complete with 22 stories FULLY DETAILED for competitor parity
- Epic 2: PWA stories defined (2 stories)
- Epic 3: Calculator and tools defined (2 stories)
- Total MVP Stories: 26 (all free, no registration required)
- Stories 1.1-1.10: Fully detailed with comprehensive requirements
- Stories 1.11-1.22: Fully detailed with comprehensive requirements
**Status:** MVP scope finalized with full competitor feature parity and detailed requirements

---

## MVP Timeline Summary

### Total Development Effort: 73 days

#### Epic 1: Core IPO Platform (61 days)
- Infrastructure & Data Pipeline: 8 days (Stories 1.1-1.2)
- Core Features: 13 days (Stories 1.3-1.8)
- IPO Analytics: 15 days (Stories 1.9-1.14)
- Information Display: 12 days (Stories 1.15-1.19)
- Advanced Features: 13 days (Stories 1.20-1.22)

#### Epic 2: PWA Implementation (4 days)
- PWA Setup & Optimization: 4 days (Stories 2.1-2.2)

#### Epic 3: Calculators & Tools (5 days)
- Calculators & Comparison Engine: 5 days (Stories 3.1-3.2)

#### Additional Phases:
- Testing & QA: 15 days (20% of development)
- Documentation: 5 days
- Deployment & DevOps: 3 days

**Total Project Timeline: ~96 days (4.5 months with buffer)**

---

## Next Steps

- Begin Sprint Planning with Epic 1 stories
- Set up development environment and CI/CD pipeline
- Create detailed technical architecture based on story requirements
- Initialize UI/UX design based on detailed requirements
- Start with Story 1.1 (Infrastructure) and Story 1.2 (Data Pipeline)