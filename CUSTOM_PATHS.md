# Custom Path Configuration Guide

## Default Paths (Can Be Changed)

### Current Configuration
```bash
PROJECT_DIR=/opt/ipodhan                                    # Main application
PIPELINE_DIR=/opt/ipodhan/ipodhan-data-pipeline            # Python pipeline
SERVICE_FILE=/etc/systemd/system/ipodhan-pipeline.service # System service
```

---

## How to Change Paths

### Option A: Update deploy_server.sh

Edit these lines in `deploy_server.sh`:

```bash
# Line ~15-17
PROJECT_DIR="/opt/ipodhan"              # ← CHANGE THIS
PIPELINE_DIR="$PROJECT_DIR/ipodhan-data-pipeline"
```

Change to:
```bash
# Example: Use home directory
PROJECT_DIR="/home/username/ipodhan"

# Example: Use /srv
PROJECT_DIR="/srv/ipodhan"

# Example: Use /var/www
PROJECT_DIR="/var/www/ipodhan"

# Example: Use custom location
PROJECT_DIR="/data/applications/ipodhan"
```

---

### Option B: Update SERVER_DEPLOYMENT.md

Find and replace all instances of `/opt/ipodhan` with your preferred path.

**Find:** `/opt/ipodhan`
**Replace with:** `/your/preferred/path`

---

### Option C: Update ipodhan-pipeline.service

Edit the service file:

```ini
[Service]
WorkingDirectory=/opt/ipodhan/ipodhan-data-pipeline  # ← CHANGE THIS
Environment="PATH=/opt/ipodhan/ipodhan-data-pipeline/venv/bin"  # ← AND THIS
ExecStart=/opt/ipodhan/ipodhan-data-pipeline/venv/bin/python main.py schedule  # ← AND THIS
```

---

## Recommended Paths by Use Case

### 1. Production Server (Multi-user)
```bash
/opt/ipodhan/                # ✅ RECOMMENDED (current default)
```
**Pros:** Standard, isolated, clean, professional

### 2. Single-User Server
```bash
/home/username/ipodhan/      # ✅ OK for single-user
```
**Pros:** No sudo needed, easier permissions

### 3. Web Application Focus
```bash
/srv/ipodhan/                # ✅ GOOD for service apps
/var/www/ipodhan/            # ✅ OK if integrating with web server
```
**Pros:** Traditional web server locations

### 4. Data-Heavy Applications
```bash
/data/ipodhan/               # ✅ OK if /data is separate partition
```
**Pros:** Can use separate disk/partition

---

## Service File Location (Cannot Change)

⚠️ **Important:** Service file MUST be in:
```bash
/etc/systemd/system/ipodhan-pipeline.service
```

This is **required by systemd** and cannot be changed. It's the standard Linux location.

---

## Current Directory Structure Breakdown

```
Linux Filesystem
├── /opt/                              # Optional/Third-party software
│   └── ipodhan/                       # ← Your application here
│       ├── infrastructure/
│       ├── ipodhan-data-pipeline/     # ← Main Python app
│       │   ├── venv/                  # Python virtual env
│       │   ├── scrapers/
│       │   ├── validators/
│       │   ├── repositories/
│       │   ├── main.py
│       │   └── .env
│       └── docs/
│
├── /etc/                              # System configuration
│   └── systemd/                       # Systemd configuration
│       └── system/                    # System services
│           └── ipodhan-pipeline.service  # ← Your service file
│
├── /var/                              # Variable data
│   └── log/                           # Logs (if not using systemd journal)
│       └── ipodhan-pipeline.log       # ← Optional log file
│
└── /home/                             # User home directories
    └── username/                      # Your user directory
```

---

## Why /opt/ is Recommended

### Advantages:
1. ✅ **Industry Standard** - Recognized immediately by sysadmins
2. ✅ **Clean Separation** - Not mixed with system files or user files
3. ✅ **Professional** - Shows production-ready deployment
4. ✅ **Backup Friendly** - Easy to include/exclude in backups
5. ✅ **Permission Control** - Can set appropriate ownership
6. ✅ **Multiple Applications** - Can have `/opt/app1`, `/opt/app2`, etc.
7. ✅ **Not Affected by OS Updates** - System updates won't touch it
8. ✅ **Self-Contained** - Can be moved/copied easily

### Comparison:

| Location | Production | Development | Requires Sudo | Standard |
|----------|------------|-------------|---------------|----------|
| `/opt/ipodhan` | ✅ Best | ✅ Good | ✅ Yes | ✅ Yes |
| `/srv/ipodhan` | ✅ Good | ✅ Good | ✅ Yes | ✅ Yes |
| `/home/user/ipodhan` | ⚠️ OK | ✅ Best | ❌ No | ⚠️ Less standard |
| `/var/www/ipodhan` | ⚠️ OK | ⚠️ OK | ✅ Yes | ⚠️ Web-specific |

---

## Quick Change Instructions

If you want to use a different path:

1. **Decide on new path:**
   ```bash
   NEW_PATH="/your/preferred/path"
   ```

2. **Create directory on server:**
   ```bash
   sudo mkdir -p $NEW_PATH
   sudo chown -R $USER:$USER $NEW_PATH
   ```

3. **Update deploy_server.sh** before transferring:
   ```bash
   # Edit line 15
   PROJECT_DIR="$NEW_PATH"
   ```

4. **Transfer files to new location:**
   ```bash
   scp -r IPODhan/ user@103.118.16.189:$NEW_PATH/
   ```

5. **Update service file** if needed:
   ```bash
   # Edit ipodhan-pipeline.service
   # Update all paths from /opt/ipodhan to $NEW_PATH
   ```

---

## Tell Me Your Preference!

**Do you want to:**
- ✅ **Keep `/opt/ipodhan`** (recommended, no changes needed)
- 🔧 **Change to different path** (I'll update all scripts)

If you want to change, tell me:
1. Your preferred path (e.g., `/home/username/ipodhan`)
2. I'll update all 5 deployment files instantly

---

## Summary

**Current Structure:**
```
Server: 103.118.16.189
Application: /opt/ipodhan/
Service: /etc/systemd/system/ipodhan-pipeline.service
```

**This is:**
- ✅ **Standard** Linux best practice
- ✅ **Production-ready** structure
- ✅ **Professional** deployment
- ✅ **Easy to maintain**

**But:** Can be changed to any path you prefer!
