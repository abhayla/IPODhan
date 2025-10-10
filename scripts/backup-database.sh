#!/bin/bash

###############################################################################
# Database Backup Script for IPODhan
#
# This script creates automated PostgreSQL database backups with:
# - Timestamped backup files
# - Compression to save space
# - Automatic cleanup of old backups
# - Cloud storage upload (optional)
# - Email notifications on failure (optional)
#
# Usage:
#   ./scripts/backup-database.sh [OPTIONS]
#
# Options:
#   --upload-to-cloud    Upload backup to cloud storage after creation
#   --keep-days N        Keep backups for N days (default: 30)
#   --email EMAIL        Send failure notifications to this email
#
# Cron Setup (Daily at 2 AM):
#   0 2 * * * /path/to/IPODhan/scripts/backup-database.sh --upload-to-cloud >> /var/log/ipodhan-backup.log 2>&1
#
###############################################################################

set -euo pipefail

# ==================== CONFIGURATION ====================

# Load environment variables from .env file if it exists
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Database configuration
DB_NAME="${POSTGRES_DB:-ipodhan}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_PASSWORD="${POSTGRES_PASSWORD}"

# Backup configuration
BACKUP_DIR="${BACKUP_DIR:-./backups/database}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/ipodhan_${TIMESTAMP}.sql.gz"
LATEST_LINK="${BACKUP_DIR}/latest.sql.gz"

# Cloud storage configuration (optional)
UPLOAD_TO_CLOUD=false
CLOUD_BUCKET="${BACKUP_CLOUD_BUCKET:-}"
CLOUD_PROVIDER="${BACKUP_CLOUD_PROVIDER:-s3}" # s3, gcs, azure

# Notification configuration (optional)
NOTIFY_EMAIL="${BACKUP_NOTIFY_EMAIL:-}"
SMTP_HOST="${SMTP_HOST:-localhost}"
SMTP_PORT="${SMTP_PORT:-25}"

# ==================== FUNCTIONS ====================

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*"
}

error() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $*" >&2
}

send_notification() {
    local subject="$1"
    local message="$2"

    if [ -n "$NOTIFY_EMAIL" ]; then
        echo "$message" | mail -s "$subject" "$NOTIFY_EMAIL" || true
    fi
}

check_requirements() {
    log "Checking requirements..."

    # Check if pg_dump is available
    if ! command -v pg_dump &> /dev/null; then
        error "pg_dump not found. Please install PostgreSQL client tools."
        exit 1
    fi

    # Check if gzip is available
    if ! command -v gzip &> /dev/null; then
        error "gzip not found. Please install gzip."
        exit 1
    fi

    log "✓ All requirements met"
}

create_backup_directory() {
    if [ ! -d "$BACKUP_DIR" ]; then
        log "Creating backup directory: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
    fi
}

perform_backup() {
    log "Starting database backup..."
    log "Database: $DB_NAME"
    log "Backup file: $BACKUP_FILE"

    # Set password for pg_dump
    export PGPASSWORD="$DB_PASSWORD"

    # Perform backup with compression
    if pg_dump \
        --host="$DB_HOST" \
        --port="$DB_PORT" \
        --username="$DB_USER" \
        --dbname="$DB_NAME" \
        --format=plain \
        --no-owner \
        --no-acl \
        --clean \
        --if-exists \
        | gzip > "$BACKUP_FILE"; then

        # Unset password
        unset PGPASSWORD

        # Get backup size
        BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

        log "✓ Backup completed successfully"
        log "  Size: $BACKUP_SIZE"
        log "  File: $BACKUP_FILE"

        # Update latest symlink
        ln -sf "$(basename "$BACKUP_FILE")" "$LATEST_LINK"

        return 0
    else
        unset PGPASSWORD
        error "Backup failed"
        return 1
    fi
}

cleanup_old_backups() {
    log "Cleaning up backups older than $BACKUP_RETENTION_DAYS days..."

    local deleted_count=0

    # Find and delete old backup files
    while IFS= read -r -d '' file; do
        log "  Deleting: $(basename "$file")"
        rm -f "$file"
        ((deleted_count++))
    done < <(find "$BACKUP_DIR" -name "ipodhan_*.sql.gz" -type f -mtime +"$BACKUP_RETENTION_DAYS" -print0)

    log "✓ Cleaned up $deleted_count old backup(s)"
}

upload_to_cloud_storage() {
    if [ "$UPLOAD_TO_CLOUD" = false ]; then
        return 0
    fi

    if [ -z "$CLOUD_BUCKET" ]; then
        error "Cloud bucket not configured. Skipping upload."
        return 1
    fi

    log "Uploading backup to cloud storage ($CLOUD_PROVIDER)..."

    case "$CLOUD_PROVIDER" in
        s3)
            if ! command -v aws &> /dev/null; then
                error "AWS CLI not found. Skipping cloud upload."
                return 1
            fi
            aws s3 cp "$BACKUP_FILE" "s3://$CLOUD_BUCKET/database-backups/$(basename "$BACKUP_FILE")"
            ;;

        gcs)
            if ! command -v gsutil &> /dev/null; then
                error "gsutil not found. Skipping cloud upload."
                return 1
            fi
            gsutil cp "$BACKUP_FILE" "gs://$CLOUD_BUCKET/database-backups/$(basename "$BACKUP_FILE")"
            ;;

        azure)
            if ! command -v az &> /dev/null; then
                error "Azure CLI not found. Skipping cloud upload."
                return 1
            fi
            az storage blob upload \
                --account-name "$CLOUD_BUCKET" \
                --container-name database-backups \
                --name "$(basename "$BACKUP_FILE")" \
                --file "$BACKUP_FILE"
            ;;

        *)
            error "Unknown cloud provider: $CLOUD_PROVIDER"
            return 1
            ;;
    esac

    log "✓ Backup uploaded to cloud storage"
}

verify_backup() {
    log "Verifying backup integrity..."

    # Test gzip integrity
    if gzip -t "$BACKUP_FILE"; then
        log "✓ Backup file is valid"
        return 0
    else
        error "Backup file is corrupted"
        return 1
    fi
}

show_backup_summary() {
    log "==================================="
    log "Backup Summary"
    log "==================================="
    log "Timestamp: $TIMESTAMP"
    log "Backup File: $BACKUP_FILE"
    log "Backup Size: $(du -h "$BACKUP_FILE" | cut -f1)"
    log "Database: $DB_NAME@$DB_HOST:$DB_PORT"
    log "Retention: $BACKUP_RETENTION_DAYS days"

    if [ "$UPLOAD_TO_CLOUD" = true ]; then
        log "Cloud Upload: Enabled ($CLOUD_PROVIDER)"
    else
        log "Cloud Upload: Disabled"
    fi

    log "==================================="
}

# ==================== ARGUMENT PARSING ====================

while [[ $# -gt 0 ]]; do
    case $1 in
        --upload-to-cloud)
            UPLOAD_TO_CLOUD=true
            shift
            ;;
        --keep-days)
            BACKUP_RETENTION_DAYS="$2"
            shift 2
            ;;
        --email)
            NOTIFY_EMAIL="$2"
            shift 2
            ;;
        --help)
            cat << EOF
Database Backup Script for IPODhan

Usage: $0 [OPTIONS]

Options:
  --upload-to-cloud      Upload backup to cloud storage
  --keep-days N          Keep backups for N days (default: 30)
  --email EMAIL          Send failure notifications to this email
  --help                 Show this help message

Environment Variables:
  POSTGRES_DB            Database name (default: ipodhan)
  POSTGRES_USER          Database user (default: postgres)
  POSTGRES_HOST          Database host (default: localhost)
  POSTGRES_PORT          Database port (default: 5432)
  POSTGRES_PASSWORD      Database password (required)
  BACKUP_DIR             Backup directory (default: ./backups/database)
  BACKUP_CLOUD_BUCKET    Cloud storage bucket name
  BACKUP_CLOUD_PROVIDER  Cloud provider (s3, gcs, azure)
  BACKUP_NOTIFY_EMAIL    Email for notifications
  BACKUP_RETENTION_DAYS  Backup retention in days (default: 30)

Examples:
  # Simple backup
  $0

  # Backup with cloud upload
  $0 --upload-to-cloud

  # Backup with custom retention
  $0 --keep-days 60

  # Backup with notifications
  $0 --email admin@example.com --upload-to-cloud

Cron Setup (Daily at 2 AM):
  0 2 * * * /path/to/IPODhan/scripts/backup-database.sh --upload-to-cloud >> /var/log/ipodhan-backup.log 2>&1

EOF
            exit 0
            ;;
        *)
            error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# ==================== MAIN SCRIPT ====================

main() {
    log "=========================================="
    log "IPODhan Database Backup Script"
    log "=========================================="

    # Check requirements
    check_requirements

    # Create backup directory
    create_backup_directory

    # Perform backup
    if ! perform_backup; then
        error "Backup failed"
        send_notification \
            "[IPODhan] Backup Failed" \
            "Database backup failed at $(date). Please check the logs."
        exit 1
    fi

    # Verify backup
    if ! verify_backup; then
        error "Backup verification failed"
        send_notification \
            "[IPODhan] Backup Verification Failed" \
            "Database backup verification failed at $(date). Backup may be corrupted."
        exit 1
    fi

    # Upload to cloud (if enabled)
    if ! upload_to_cloud_storage; then
        error "Cloud upload failed (continuing anyway)"
    fi

    # Cleanup old backups
    cleanup_old_backups

    # Show summary
    show_backup_summary

    log "✓ Backup completed successfully"
}

# Run main function
main

exit 0
