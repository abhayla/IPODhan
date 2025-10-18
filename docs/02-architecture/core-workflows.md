# Core Workflows

## Workflow 1: User Views IPO Detail Page

```mermaid
sequenceDiagram
    participant User
    participant NextJS as Next.js App
    participant Repo as Repository Layer
    participant Redis
    participant PostgreSQL

    User->>NextJS: Navigate to /ipos/paytm-ipo-2021
    NextJS->>Repo: findBySlug("paytm-ipo-2021")
    Repo->>Redis: get("ipo:paytm-ipo-2021")

    alt Cache Hit
        Redis-->>Repo: Cached IPO data
        Repo-->>NextJS: IPO + Financials + Documents
    else Cache Miss
        Redis-->>Repo: null
        Repo->>PostgreSQL: SELECT * FROM ipos WHERE slug = ?
        PostgreSQL-->>Repo: IPO data
        Repo->>Redis: set("ipo:paytm-ipo-2021", data, 900s)
        Repo-->>NextJS: IPO + Financials + Documents
    end

    NextJS->>NextJS: Server-side render (Tier 1 data)
    NextJS-->>User: HTML with Tier 1 data (< 2s)
```

## Workflow 2: Data Scraper Updates IPO Subscription Data

```mermaid
sequenceDiagram
    participant Cron as Node-cron Scheduler
    participant Scraper as Data Scraper Service
    participant NSE as NSE Website
    participant Repo as Repository Layer
    participant PostgreSQL
    participant Redis

    Cron->>Scraper: Trigger scrape job (every 30 min)
    Scraper->>NSE: Puppeteer: Navigate to /market-data/public-issues
    NSE-->>Scraper: HTML page
    Scraper->>Scraper: Parse subscription data

    alt Scraping Success
        Scraper->>Repo: SubscriptionRepository.createSnapshot(ipoId, data)
        Repo->>PostgreSQL: INSERT INTO subscriptions (...)
        PostgreSQL-->>Repo: Success
        Scraper->>Redis: DEL subscription:latest:{slug}
        Redis-->>Scraper: Cache invalidated
    else Scraping Failed
        Scraper->>Scraper: Retry 3 times with backoff
        Scraper->>Scraper: Fallback to IPO Alerts API
    end
```

## Workflow 3: User Subscribes to Email Alerts 🟢 **Phase 2**

*(This workflow will be implemented in Phase 2 when email alert functionality is added)*

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant APIRoute as API Routes
    participant Repo as EmailSubscriber Repository
    participant PostgreSQL
    participant Email as Email Service

    User->>Browser: Enter email + select preferences
    Browser->>APIRoute: POST /api/subscribers
    APIRoute->>APIRoute: Validate email (Zod)
    APIRoute->>Repo: EmailSubscriberRepository.create(email, preferences)
    Repo->>PostgreSQL: INSERT INTO email_subscribers
    PostgreSQL-->>Repo: Success
    APIRoute->>Email: sendVerificationEmail(email, token)
    Email-->>User: Verification email sent
    APIRoute-->>Browser: 201 Created
```

---
