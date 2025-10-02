# VPS Configuration - Production Server

## Server Details

**Hosting Provider**: VPS
**Operating System**: Windows Server 2022
**IP Address**: `103.118.16.189`
**Environment**: Production

---

## Database Configuration

### PostgreSQL 15.x

**Connection Details:**
- **Host**: `103.118.16.189`
- **Port**: `5432`
- **Database**: `ipodhan`
- **User**: `postgres`
- **Password**: `Papa3Monu@1234`

**Connection String:**
```
postgresql://postgres:Papa3Monu@1234@103.118.16.189:5432/ipodhan
```

**Environment Variables:**
```env
DB_HOST=103.118.16.189
DB_PORT=5432
DB_NAME=ipodhan
DB_USER=postgres
DB_PASSWORD=Papa3Monu@1234
DB_POOL_MIN=1
DB_POOL_MAX=10
```

---

## Services Deployed

### 1. IPO Data Pipeline
- **Location**: `/path/to/ipodhan-data-pipeline`
- **Runtime**: Python 3.11+
- **Status**: Production-ready
- **Config File**: `.env` (configured with above DB details)

### 2. IPO Scoring Engine
- **Location**: `/path/to/ipodhan-score-engine`
- **Runtime**: Python 3.11+ (FastAPI)
- **API Port**: `8001`
- **Status**: Production-ready
- **Config File**: `.env` (configured with above DB details)

### 3. Web Application (Planned)
- **Location**: `/path/to/ipodhan-web`
- **Runtime**: Node.js 20 LTS (Next.js 14)
- **Status**: In Development

### 4. Backend API (Planned)
- **Location**: `/path/to/ipodhan-backend`
- **Runtime**: Node.js 20 LTS (Express)
- **Status**: Planned

---

## Network Configuration

### Firewall Rules
- **PostgreSQL**: Port `5432` open for database connections
- **HTTP**: Port `80` (for web traffic)
- **HTTPS**: Port `443` (for secure web traffic)
- **API**: Port `8001` (for scoring engine API)

### Security Considerations
⚠️ **IMPORTANT**:
- Database password is currently stored in plaintext in .env files
- Production deployment should use:
  - Windows Credential Manager for secrets
  - Encrypted environment variables
  - Network-level firewall restrictions (allow specific IPs only)
  - SSL/TLS for database connections

---

## Deployment Checklist

- [x] Windows Server 2022 installed and configured
- [x] PostgreSQL 15.x installed and running
- [x] Database `ipodhan` created
- [x] Database user `postgres` configured
- [ ] Redis installed (for scoring engine cache)
- [ ] Python 3.11+ installed
- [ ] Node.js 20 LTS installed
- [ ] IIS configured (for web hosting)
- [ ] SSL certificates obtained and installed
- [ ] Firewall rules configured
- [ ] Scheduled tasks for data pipeline
- [ ] Monitoring and logging configured

---

## Maintenance

### Database Backups
- **Location**: TBD
- **Schedule**: Daily at 2 AM IST
- **Retention**: 30 days

### Log Files
- **Data Pipeline Logs**: TBD
- **Scoring Engine Logs**: TBD
- **Application Logs**: TBD

### Monitoring
- **Health Checks**: TBD
- **Uptime Monitoring**: TBD
- **Error Tracking**: Sentry (configured in .env)

---

## Access & Credentials

### Database Access
```bash
# From local machine
psql -h 103.118.16.189 -p 5432 -U postgres -d ipodhan

# Password when prompted: Papa3Monu@1234
```

### SSH/RDP Access
- **Method**: RDP (Remote Desktop Protocol)
- **Port**: 3389 (default)
- **Credentials**: Contact system administrator

---

## Migration Notes

**Database Migrations Applied:**
- `001_create_ipos_table.sql` ✅
- `002_create_gmp_table.sql` ✅
- `003_add_pipeline_status.sql` ✅
- `004_score_tracking_tables.sql` ✅

**To apply new migrations:**
```bash
psql -h 103.118.16.189 -U postgres -d ipodhan -f infrastructure/database/migrations/00X_migration_name.sql
```

---

**Last Updated**: 2025-10-02
**Maintained By**: DevOps Team
