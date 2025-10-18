# Deployment Architecture

## Deployment Strategy

**Frontend Deployment:**
- **Platform:** Self-hosted on Windows Server 2022 VPS
- **Build Command:** `npm run build`
- **Output Directory:** `web/.next/`
- **CDN/Edge:** Cloudflare CDN for static assets

**Backend Deployment:**
- **Platform:** Same VPS as frontend
- **Deployment Method:**
  - Web API Routes: Bundled with Next.js
  - Scraper Service: Separate PM2 process

## CI/CD Pipeline

**GitHub Actions Workflow:**
1. **CI (on PR):** Lint → Type check → Run tests → Build
2. **CD (on main push):** Build → Create deployment package → SCP to VPS → SSH deploy → Restart PM2

## Environments

| Environment | Frontend URL | Backend URL | Purpose |
|-------------|-------------|-------------|---------|
| Development | http://localhost:3000 | http://localhost:3000/api | Local development |
| Production | https://ipodhan.com | https://ipodhan.com/api | Live environment |

## PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'ipodhan-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      instances: 2,
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', PORT: 3000 },
      max_memory_restart: '500M',
    },
    {
      name: 'ipodhan-scraper',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '300M',
      cron_restart: '0 3 * * *',
    },
  ],
};
```

---
