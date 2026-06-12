---
name: windows-deployment-expert
description: Windows Server 2022 VPS deployment with PM2 process management, environment configuration, and production maintenance
---

# Windows Server Deployment Expert

**Purpose:** Expertise in deploying IPODhan to Windows Server 2022 VPS, including PM2 process management, environment configuration, and production maintenance.

**When to invoke:** Deploying to production, configuring PM2, setting up SSL, managing logs, or troubleshooting deployment issues.

---

## VPS Configuration

**Server:** Windows Server 2022
**IP:** 103.118.16.189
**Node.js:** v24.1.0
**PostgreSQL:** 16.x
**Redis:** Memurai v4.1.6 (Redis for Windows)
**Process Manager:** PM2 v6.0.10

---

## PM2 Process Management

### Ecosystem Configuration (ecosystem.config.js)

```javascript
module.exports = {
  apps: [
    {
      name: 'ipodhan-web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: './web',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '500M',
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'ipodhan-scraper',
      script: 'dist/index.js',
      cwd: './scraper',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      cron_restart: '0 3 * * *', // 3 AM daily
      max_memory_restart: '300M',
      error_file: './logs/scraper-error.log',
      out_file: './logs/scraper-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
```

### PM2 Commands

```powershell
# Start all services
pm2 start ecosystem.config.js

# Save process list
pm2 save

# Setup startup script
pm2 startup

# Monitor services
pm2 monit

# View logs
pm2 logs
pm2 logs ipodhan-web
pm2 logs ipodhan-scraper

# Restart services
pm2 restart all
pm2 restart ipodhan-web

# Stop services
pm2 stop all

# Delete from PM2
pm2 delete all
```

---

## Environment Configuration

### Production .env File

```env
# Database
DATABASE_URL=postgresql://postgres:PASSWORD@103.118.16.189:5432/ipodhan

# Redis
REDIS_HOST=103.118.16.189
REDIS_PORT=6379
REDIS_PASSWORD=REDIS_PASSWORD

# Application
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://ipodhan.com
PORT=3000

# Monitoring
NEXT_PUBLIC_SENTRY_DSN=https://...
SENTRY_AUTH_TOKEN=...

# Analytics
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
```

---

## Deployment Process

### 1. Build Deployment Package

```powershell
# On local machine
.\scripts\create-deployment-package.ps1

# Creates: ipodhan-deployment-{timestamp}.zip
```

### 2. Transfer to VPS

```powershell
# Using RDP: Copy zip file
# Or using PowerShell remoting
Copy-Item ipodhan-deployment-*.zip -Destination \103.118.16.189\C$\deployments\
```

### 3. Deploy on VPS

```powershell
# Extract package
Expand-Archive ipodhan-deployment-*.zip

# Install dependencies
cd ipodhan-deployment-*\web
npm ci --production

cd ..\scraper
npm ci --production

# Configure environment
Copy-Item .env.production.template .env.production
# Edit .env.production with production values

# Start services
pm2 start ecosystem.config.js
pm2 save
```

---

## Log Management

### Log Rotation

PM2 handles log rotation automatically with `pm2-logrotate`:

```powershell
# Install log rotation module
pm2 install pm2-logrotate

# Configure
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
```

### Log Locations

```
logs/
├── web-error.log      # Web errors
├── web-out.log        # Web stdout
├── scraper-error.log  # Scraper errors
└── scraper-out.log    # Scraper stdout
```

---

## Health Monitoring

### Health Check Endpoint

```powershell
# Test health
curl http://localhost:3000/api/health

# Expected response
{
  "status": "healthy",
  "services": {
    "database": "healthy",
    "redis": "healthy"
  }
}
```

### Automated Monitoring

Use UptimeRobot or similar:
- URL: `http://103.118.16.189:3000/api/health`
- Interval: Every 5 minutes
- Alert: Email on 3 consecutive failures

---

## Troubleshooting

### Application Won't Start

```powershell
# Check PM2 logs
pm2 logs ipodhan-web --lines 100

# Check Node.js version
node --version  # Should be v24.1.0

# Test database connection
psql -h 103.118.16.189 -U postgres -d ipodhan

# Test Redis
redis-cli -h 103.118.16.189 ping
```

### High Memory Usage

```powershell
# Check PM2 status
pm2 status

# Restart if needed
pm2 restart ipodhan-web

# Check max_memory_restart setting
```

### Port Already in Use

```powershell
# Find process using port 3000
netstat -ano | findstr :3000

# Kill process
taskkill /PID <PID> /F
```

---

## Backup Strategy

### Database Backup

```powershell
# Create backup
pg_dump -h 103.118.16.189 -U postgres -d ipodhan > backup-$(Get-Date -Format "yyyy-MM-dd").sql

# Restore backup
psql -h 103.118.16.189 -U postgres -d ipodhan < backup-2025-01-15.sql
```

### Application Backup

```powershell
# Keep last 3 deployments
ls C:\deployments | Sort-Object -Descending | Select-Object -Skip 3 | Remove-Item -Recurse
```

---

## Rollback Procedure

```powershell
# Stop current deployment
pm2 stop all

# Go to previous deployment
cd ..\ipodhan-deployment-{previous-timestamp}

# Start previous version
pm2 start ecosystem.config.js
pm2 save
```

---

## Best Practices

1. **Always test locally first** before deploying
2. **Keep last 3 deployments** for quick rollback
3. **Monitor logs** regularly
4. **Database backup** before schema changes
5. **Test health endpoint** after deployment

---

## References

- **PM2 Documentation:** https://pm2.keymetrics.io/docs
- **Windows Server:** https://docs.microsoft.com/en-us/windows-server

