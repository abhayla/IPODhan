# Components

## Web Frontend (Next.js)

**Responsibility:** User-facing web application with SSG/ISR for optimal performance

**Key Interfaces:**
- Pages API for routing
- API client for backend communication
- WebSocket connection for real-time updates
- PWA manifest for mobile installation

**Dependencies:** ipodhan-backend API, Redis for session management, S3 for static assets

**Technology Stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, Zustand

## API Gateway (Node.js/Express)

**Responsibility:** Central API orchestration, authentication, and rate limiting

**Key Interfaces:**
- REST endpoints for web/mobile clients
- WebSocket server for real-time updates
- Webhook handlers for external services
- API key management for B2B partners

**Dependencies:** PostgreSQL database, Redis cache, Score Engine service

**Technology Stack:** Express 4, TypeScript, Passport.js, Socket.io

## Data Pipeline Service (Python)

**Responsibility:** Automated data ingestion from NSE/BSE and GMP sources

**Key Interfaces:**
- Scheduled scrapers for official sources
- Data validation and normalization
- Database write operations
- Event publishing for downstream services

**Dependencies:** External APIs (NSE/BSE), PostgreSQL database

**Technology Stack:** Python 3.11, FastAPI, BeautifulSoup4, Pandas, APScheduler

## Score Engine Service (Python)

**Responsibility:** Calculate IPODhan Score using weighted algorithm

**Key Interfaces:**
- Score calculation endpoint
- Batch processing scheduler
- Score history API
- A/B testing framework

**Dependencies:** PostgreSQL for data, Redis for caching, ML models

**Technology Stack:** Python 3.11, NumPy, Pandas, Scikit-learn, FastAPI

## Notification Orchestrator (Node.js)

**Responsibility:** Multi-channel notification delivery and template management

**Key Interfaces:**
- Queue consumer for notification events
- WhatsApp Business API integration
- Email/SMS service integration
- Template management system

**Dependencies:** Redis queues, WhatsApp API, Email service

**Technology Stack:** Node.js, Bull queue, Twilio SDK, Handlebars
