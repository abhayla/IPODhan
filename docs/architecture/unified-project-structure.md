# Unified Project Structure

```
ipodhan/
├── .github/                    # CI/CD workflows
│   └── workflows/
│       ├── ci-web.yaml
│       ├── ci-backend.yaml
│       └── deploy.yaml
├── ipodhan-web/               # Frontend application
│   ├── src/
│   │   ├── components/        # UI components
│   │   ├── pages/            # Next.js pages
│   │   ├── hooks/            # Custom React hooks
│   │   ├── services/         # API client services
│   │   ├── stores/           # Zustand stores
│   │   ├── styles/           # Global styles/themes
│   │   └── utils/            # Frontend utilities
│   ├── public/               # Static assets
│   ├── tests/                # Frontend tests
│   ├── next.config.js
│   └── package.json
├── ipodhan-backend/          # Backend API
│   ├── src/
│   │   ├── routes/           # API routes
│   │   ├── controllers/      # Route controllers
│   │   ├── services/         # Business logic
│   │   ├── repositories/     # Data access layer
│   │   ├── middleware/       # Express middleware
│   │   ├── utils/           # Backend utilities
│   │   └── app.ts           # Express app
│   ├── tests/               # Backend tests
│   └── package.json
├── ipodhan-data-pipeline/    # Python data ingestion
│   ├── scrapers/            # Web scrapers
│   ├── validators/          # Data validation
│   ├── schedulers/          # Cron jobs
│   ├── requirements.txt
│   └── main.py
├── ipodhan-score-engine/     # Score calculation
│   ├── models/              # ML models
│   ├── algorithms/          # Scoring algorithms
│   ├── api/                # FastAPI endpoints
│   ├── requirements.txt
│   └── main.py
├── ipodhan-notifications/    # Notification service
│   ├── src/
│   │   ├── channels/        # WhatsApp, Email, SMS
│   │   ├── templates/       # Message templates
│   │   ├── queues/         # Bull queue handlers
│   │   └── app.ts
│   └── package.json
├── ipodhan-shared/          # Shared NPM package
│   ├── src/
│   │   ├── types/          # TypeScript interfaces
│   │   ├── constants/      # Shared constants
│   │   └── utils/          # Shared utilities
│   └── package.json
├── infrastructure/          # IaC definitions
│   ├── terraform/
│   │   ├── modules/
│   │   ├── environments/
│   │   └── main.tf
│   └── docker/
│       └── docker-compose.yml
├── scripts/                # Build/deploy scripts
│   ├── setup.sh
│   └── deploy.sh
├── docs/                   # Documentation
│   ├── prd.md
│   ├── front-end-spec.md
│   └── architecture.md
├── .env.example           # Environment template
├── docker-compose.yml     # Local development
├── nginx.conf            # Reverse proxy config
└── README.md
```
