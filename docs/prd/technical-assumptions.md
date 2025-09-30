# Technical Assumptions

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
