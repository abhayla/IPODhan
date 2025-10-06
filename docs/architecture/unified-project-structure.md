# Unified Project Structure

```
ipodhan/
├── .github/workflows/              # CI/CD
├── web/                            # Next.js app
│   ├── src/
│   │   ├── app/                    # App Router + API routes
│   │   ├── components/             # React components
│   │   ├── lib/                    # Backend code (repos, services, db)
│   │   ├── stores/                 # Zustand stores
│   │   └── hooks/                  # Custom hooks
│   ├── public/                     # Static assets
│   ├── tests/                      # Unit, integration, E2E tests
│   └── package.json
├── scraper/                        # Data scraper service
│   ├── src/
│   │   ├── scrapers/               # NSE, BSE, IPO Alerts scrapers
│   │   └── services/               # Data merger, cache invalidator
│   └── package.json
├── packages/
│   └── shared/                     # Shared TypeScript types
│       └── src/types/              # IPO, Subscription, etc.
├── docs/                           # Documentation
│   ├── prd.md
│   ├── front-end-spec.md
│   ├── brief.md
│   └── architecture.md
├── scripts/                        # Build/deploy scripts
└── package.json                    # Root workspace config
```

**Workspace Configuration (Root package.json):**
```json
{
  "workspaces": ["web", "scraper", "packages/*"],
  "scripts": {
    "dev": "npm run dev --workspace=web",
    "dev:scraper": "npm run dev --workspace=scraper",
    "dev:all": "concurrently \"npm run dev\" \"npm run dev:scraper\"",
    "test": "npm run test --workspaces --if-present"
  }
}
```

---
