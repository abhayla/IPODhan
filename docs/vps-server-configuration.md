# VPS Server Configuration - 103.118.16.189

**Server Type:** Windows Server 2022 Standard (Version 10.0.20348)
**IP Address:** 103.118.16.189
**Purpose:** Multi-project production hosting
**Last Updated:** 2025-10-08

---

## Table of Contents

1. [Server Specifications](#server-specifications)
2. [Installed Software](#installed-software)
3. [Database Configuration](#database-configuration)
4. [Cache Configuration](#cache-configuration)
5. [Network Configuration](#network-configuration)
6. [Directory Structure](#directory-structure)
7. [Common Commands](#common-commands)
8. [Security Configuration](#security-configuration)
9. [Backup Strategy](#backup-strategy)
10. [Multi-Project Setup](#multi-project-setup)

---

## Server Specifications

### Hardware & Resources
- **OS**: Microsoft Windows Server 2022 Standard
- **OS Version**: 10.0.20348
- **Disk Space**: 60 GB total, 21 GB free (as of 2025-10-08)
- **CPU**: TBD
- **RAM**: TBD
- **Location**: TBD

### Disk Usage Monitoring
```bash
# Check disk space
df -h /c

# Expected output: >10 GB free space minimum
```

---

## Installed Software

### Node.js Environment
- **Node.js**: v24.1.0
- **npm**: 11.4.2
- **Installation Date**: TBD
- **Verification Command**:
  ```bash
  node --version
  npm --version
  ```

### Process Manager
- **PM2**: v6.0.10
- **Installation Type**: Global
- **Verification Command**:
  ```bash
  pm2 --version
  pm2 list
  ```

### Database
- **PostgreSQL**: v16.8
- **Status**: Running
- **Service Name**: postgresql-x64-16
- **Verification Commands**:
  ```bash
  psql --version
  sc query postgresql-x64-16
  ```

### Cache
- **Redis (Memurai)**: v4.1.6 (Redis-compatible for Windows)
- **Status**: Running
- **Service Name**: Memurai
- **Installation Method**: Chocolatey (redis-64 package)
- **CLI Path**: `/c/Program Files/Memurai/memurai-cli.exe`
- **Verification Commands**:
  ```bash
  sc query Memurai
  "/c/Program Files/Memurai/memurai-cli.exe" ping
  ```
- **Note**: redis-cli command maps to memurai-cli on this system

---

## Database Configuration

### PostgreSQL Setup
**Status**: To be documented

**Connection Details Template**:
```
Host: localhost (or 103.118.16.189)
Port: 5432 (default)
Database: [project_name]
User: [project_name]_user
Password: [stored in C:\secure\[project]-db-password.txt]
```

**Database Creation Template**:
```sql
-- Create database for new project
CREATE DATABASE [project_name];

-- Create dedicated user
CREATE USER [project_name]_user WITH PASSWORD '[secure_password]';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE [project_name] TO [project_name]_user;
GRANT ALL PRIVILEGES ON SCHEMA public TO [project_name]_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO [project_name]_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO [project_name]_user;
```

**Backup Script Template**:
```powershell
# Backup specific database
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
pg_dump -h localhost -U postgres -d [project_name] > "C:\backups\[project_name]\backup-$timestamp.sql"
```

---

## Cache Configuration

### Redis Setup
**Status**: To be documented

**Connection Details Template**:
```
Host: localhost (or 103.118.16.189)
Port: 6379 (default)
Password: [stored in C:\secure\[project]-redis-password.txt]
Max Memory: 256MB per project (configurable)
Eviction Policy: allkeys-lru
```

**Redis Configuration Best Practices**:
- Use separate Redis databases (0-15) for different projects
- Set appropriate maxmemory limits
- Enable persistence (RDB or AOF)
- Use password authentication

**Project-Specific Redis Database Allocation**:
```
DB 0: ipodhan (IPO tracking application)
DB 1: [future project]
DB 2: [future project]
...
DB 15: [future project]
```

---

## Network Configuration

### Ports in Use
| Port | Service | Project | Status |
|------|---------|---------|--------|
| 3000 | Next.js Web | IPODhan | In Use |
| 5432 | PostgreSQL | Shared | In Use |
| 6379 | Redis | Shared | In Use |
| 3001 | TBD | Available | Free |
| 3002 | TBD | Available | Free |
| 3003 | TBD | Available | Free |

### Firewall Rules
**Status**: To be documented

---

## Directory Structure

### Standard Directory Layout
```
C:\
├── Apps\
│   ├── IPODhan\                    # Git repository for IPODhan
│   ├── [Project2]\                 # Future project repositories
│   └── [Project3]\
│
├── inetpub\
│   ├── ipodhan\                    # IPODhan production deployment
│   │   ├── current -> deployments/deploy-YYYYMMDD-HHMMSS/
│   │   ├── deployments\
│   │   │   ├── deploy-20251008-120000\
│   │   │   └── deploy-20251008-140000\
│   │   └── logs\
│   │
│   ├── [project2]\                 # Future project deployments
│   │   ├── current\
│   │   ├── deployments\
│   │   └── logs\
│   └── ...
│
├── backups\
│   ├── ipodhan\                    # IPODhan database backups
│   ├── [project2]\                 # Future project backups
│   └── ...
│
├── secure\
│   ├── ipodhan-db-password.txt     # IPODhan DB password
│   ├── ipodhan-redis-password.txt  # IPODhan Redis password
│   ├── [project2]-db-password.txt
│   └── ...
│
└── Temp\                           # Temporary deployment packages
    ├── ipodhan-deployment-*.zip
    └── ...
```

---

## Common Commands

### System Management
```bash
# Check disk space
df -h /c

# Check Windows version
wmic os get Caption,Version

# Check running services
sc query state= all
```

### Node.js & npm
```bash
# Check versions
node --version
npm --version

# Global package list
npm list -g --depth=0

# Update npm
npm install -g npm@latest
```

### PM2 Process Management
```bash
# List all processes
pm2 list

# View logs
pm2 logs [app-name] --lines 100

# Monitor resources
pm2 monit

# Restart app
pm2 restart [app-name]

# Save configuration
pm2 save

# Check startup configuration
pm2 startup
```

### Database Operations
```bash
# Connect to PostgreSQL
psql -h localhost -U postgres

# List databases
psql -h localhost -U postgres -l

# Backup database
pg_dump -h localhost -U postgres -d [db_name] > backup.sql

# Restore database
psql -h localhost -U postgres -d [db_name] < backup.sql
```

### Redis Operations
```bash
# Test connection
"/c/Program Files/Memurai/memurai-cli.exe" ping

# Connect to specific database
"/c/Program Files/Memurai/memurai-cli.exe" -n [0-15]

# Check memory usage
"/c/Program Files/Memurai/memurai-cli.exe" INFO memory

# Flush specific database
"/c/Program Files/Memurai/memurai-cli.exe" -n [db_number] FLUSHDB

# List all keys
"/c/Program Files/Memurai/memurai-cli.exe" KEYS "*"
```

---

## Security Configuration

### Password Management
- All passwords stored in `C:\secure\` directory
- File permissions: Administrator access only
- Naming convention: `[project]-[service]-password.txt`

### Environment Variables
- Each project maintains `.env.production` in deployment directory
- Never commit `.env.production` to version control
- Template files (`.env.production.template`) committed for reference

### Access Control
- RDP access: Administrator account only
- Database access: Per-project users with limited permissions
- Redis access: Password-protected, per-database isolation

---

## Backup Strategy

### Database Backups
- **Frequency**: Daily automated backups
- **Retention**: 30 days
- **Location**: `C:\backups\[project]\`
- **Format**: SQL dump files with timestamp

### Application Backups
- **Strategy**: Keep last 5 deployments
- **Location**: `C:\inetpub\[project]\deployments\`
- **Cleanup**: Manual or scripted removal of old deployments

### Configuration Backups
- **Files**: `.env.production`, `ecosystem.config.js`, passwords
- **Location**: Included in deployment directories
- **Frequency**: On each deployment

---

## Multi-Project Setup

### Port Allocation Strategy
Each project gets a unique port for its web application:
- **IPODhan**: Port 3000
- **Project 2**: Port 3001
- **Project 3**: Port 3002
- etc.

### PM2 App Naming Convention
```
[project-name]-web        # Web application
[project-name]-scraper    # Background jobs (if applicable)
[project-name]-api        # API service (if separate)
```

### Database Isolation
- Each project has its own PostgreSQL database
- Each project has its own database user
- No shared tables between projects

### Redis Isolation
- Each project uses a separate Redis database number (0-15)
- Projects cannot access each other's cached data
- Flushing one project's cache doesn't affect others

### Cloudflare/Domain Setup
- Each project can have its own domain or subdomain
- DNS A records point to same IP (103.118.16.189)
- Different ports handled by reverse proxy or direct access

### Example Multi-Project Configuration

**IPODhan (Current)**:
- Port: 3000
- Database: ipodhan (PostgreSQL)
- Redis DB: 0
- Directory: C:\inetpub\ipodhan
- Domain: ipodhan.com

**Future Project Template**:
- Port: 300X
- Database: [project_name] (PostgreSQL)
- Redis DB: X
- Directory: C:\inetpub\[project_name]
- Domain: [domain.com]

---

## Deployment Checklist for New Projects

When deploying a new project to this VPS:

1. **Choose unique port** (check port allocation table)
2. **Create PostgreSQL database and user**
3. **Allocate Redis database number**
4. **Create directory structure** in `C:\inetpub\[project]`
5. **Create backup directory** in `C:\backups\[project]`
6. **Store credentials** in `C:\secure\`
7. **Configure PM2** with unique app names
8. **Update this documentation** with new project details
9. **Test deployment** before going live
10. **Set up monitoring** and health checks

---

## Maintenance Schedule

### Daily
- Automated database backups
- PM2 log rotation
- Health check monitoring

### Weekly
- Review disk space usage
- Review PM2 process status
- Check for failed backup jobs

### Monthly
- Review and clean old deployment directories
- Review and clean old database backups
- Update Node.js/npm if security patches available
- Review Redis memory usage

### Quarterly
- Full server backup
- Security audit
- Performance review
- Update documentation

---

## Troubleshooting

### Common Issues

**PM2 processes not starting:**
```bash
# Check logs
pm2 logs [app-name] --err

# Delete and restart
pm2 delete [app-name]
pm2 start ecosystem.config.js
```

**Database connection errors:**
```bash
# Check PostgreSQL is running
sc query postgresql-x64-16

# Test connection
psql -h localhost -U postgres -c "SELECT 1;"
```

**Redis connection errors:**
```bash
# Check Memurai (Redis) is running
sc query Memurai

# Test connection
"/c/Program Files/Memurai/memurai-cli.exe" ping
```

**Disk space full:**
```bash
# Check space
df -h /c

# Clean old logs
pm2 flush

# Clean old backups (>30 days)
# Manual cleanup in C:\backups\
```

---

## Configuration History

### IPODhan Deployment (2025-10-08)
- **Node.js**: v24.1.0 ✓
- **npm**: 11.4.2 ✓
- **PM2**: 6.0.10 ✓
- **PostgreSQL**: v16.8 ✓
- **Redis (Memurai)**: v4.1.6 ✓
- **Port**: 3000
- **Database**: ipodhan (to be created)
- **Redis DB**: 0

---

**Document Version**: 1.0
**Maintained By**: Platform Administrator
**Review Schedule**: After each new project deployment
