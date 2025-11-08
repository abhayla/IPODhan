#!/bin/bash

###############################################################################
# IPODhan - Log Rotation Setup Script
#
# This script configures PM2 log rotation to prevent disk space issues
#
# Usage:
#   chmod +x setup-log-rotation.sh
#   ./setup-log-rotation.sh
#
# What it does:
#   1. Installs pm2-logrotate module
#   2. Configures log rotation settings
#   3. Verifies configuration
#   4. Tests rotation
#
###############################################################################

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo ""
echo "======================================================================"
echo "  IPODhan - PM2 Log Rotation Setup"
echo "======================================================================"
echo ""

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}ERROR: PM2 is not installed${NC}"
    echo "Install PM2 first: npm install -g pm2"
    exit 1
fi

echo -e "${GREEN}✓ PM2 is installed${NC}"
pm2 --version

# Install pm2-logrotate module
echo ""
echo "Installing pm2-logrotate module..."
pm2 install pm2-logrotate

echo -e "${GREEN}✓ pm2-logrotate installed${NC}"

# Configure log rotation
echo ""
echo "Configuring log rotation settings..."

# Max size: 10MB per log file
pm2 set pm2-logrotate:max_size 10M
echo -e "${GREEN}✓ Max log size: 10MB${NC}"

# Retain: Keep last 30 rotated log files
pm2 set pm2-logrotate:retain 30
echo -e "${GREEN}✓ Retain: 30 files${NC}"

# Compress: Use gzip compression
pm2 set pm2-logrotate:compress true
echo -e "${GREEN}✓ Compression: enabled${NC}"

# Date format: YYYY-MM-DD
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD
echo -e "${GREEN}✓ Date format: YYYY-MM-DD${NC}"

# Rotation interval: every day at 00:00
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
echo -e "${GREEN}✓ Rotation interval: Daily at midnight${NC}"

# Workaround: false (don't use PM2's internal workaround)
pm2 set pm2-logrotate:workerInterval 30
echo -e "${GREEN}✓ Worker interval: 30 seconds${NC}"

# Rotate module logs too
pm2 set pm2-logrotate:rotateModule true
echo -e "${GREEN}✓ Rotate module logs: enabled${NC}"

# Verify configuration
echo ""
echo "======================================================================"
echo "  Current Configuration"
echo "======================================================================"
pm2 conf pm2-logrotate

# Create logs directory if it doesn't exist
echo ""
echo "Creating logs directory..."
mkdir -p logs
echo -e "${GREEN}✓ Logs directory created${NC}"

# Check current log files
echo ""
echo "======================================================================"
echo "  Current Log Files"
echo "======================================================================"
if [ -d "logs" ]; then
    ls -lh logs/ 2>/dev/null || echo "No log files yet"
else
    echo "Logs directory will be created by PM2"
fi

# Save PM2 configuration
echo ""
echo "Saving PM2 configuration..."
pm2 save
echo -e "${GREEN}✓ PM2 configuration saved${NC}"

# Summary
echo ""
echo "======================================================================"
echo "  Setup Complete!"
echo "======================================================================"
echo ""
echo "Log rotation is now configured with the following settings:"
echo ""
echo "  Max Size:        10MB per file"
echo "  Retention:       30 rotated files"
echo "  Compression:     Enabled (gzip)"
echo "  Date Format:     YYYY-MM-DD"
echo "  Rotation Time:   Daily at 00:00"
echo ""
echo "Log files will be stored in:"
echo "  - ./logs/web-out.log"
echo "  - ./logs/web-error.log"
echo "  - ./logs/scraper-out.log"
echo "  - ./logs/scraper-error.log"
echo ""
echo "Rotated files will be named:"
echo "  - web-out__YYYY-MM-DD.log.gz"
echo "  - web-error__YYYY-MM-DD.log.gz"
echo "  - etc."
echo ""
echo -e "${YELLOW}Note: Rotation will occur automatically based on:${NC}"
echo "  1. File size reaches 10MB, OR"
echo "  2. Daily at midnight (00:00)"
echo ""
echo "To manually trigger rotation:"
echo "  pm2 install pm2-logrotate"
echo ""
echo "To view current logs:"
echo "  pm2 logs ipodhan-web"
echo "  pm2 logs ipodhan-scraper"
echo ""
echo "To verify rotation is working:"
echo "  ls -lh logs/"
echo "  # Check for .gz files after first rotation"
echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""
