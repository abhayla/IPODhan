#!/bin/bash

# ================================================================
# IPODhan Deployment Package Creation Script
# ================================================================
# Story: 8.4a - Production Deployment - Dev Machine Preparation
#
# Purpose: Creates a deployment-ready package for production VPS
# Usage: ./scripts/create-deployment-package.sh
# Output: ipodhan-deployment-{timestamp}.tar.gz
# ================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
PACKAGE_NAME="ipodhan-deployment-${TIMESTAMP}"
TEMP_DIR=".deployment-temp/${PACKAGE_NAME}"
OUTPUT_FILE="${PACKAGE_NAME}.tar.gz"

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}IPODhan Deployment Package Creator${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""

# Step 1: Clean previous builds
echo -e "${YELLOW}[1/8] Cleaning previous builds...${NC}"
rm -rf web/.next web/dist scraper/dist .deployment-temp *.tar.gz
echo -e "${GREEN}✓ Cleanup complete${NC}"
echo ""

# Step 2: Install production dependencies for web
echo -e "${YELLOW}[2/8] Installing web dependencies...${NC}"
cd web
npm ci --production=false
cd ..
echo -e "${GREEN}✓ Web dependencies installed${NC}"
echo ""

# Step 3: Build Next.js web app
echo -e "${YELLOW}[3/8] Building Next.js web application...${NC}"
cd web
npm run build
cd ..
echo -e "${GREEN}✓ Web build complete${NC}"
echo ""

# Step 4: Install production dependencies for scraper
echo -e "${YELLOW}[4/8] Installing scraper dependencies...${NC}"
cd scraper
npm ci --production=false
cd ..
echo -e "${GREEN}✓ Scraper dependencies installed${NC}"
echo ""

# Step 5: Build scraper
echo -e "${YELLOW}[5/8] Building scraper service...${NC}"
cd scraper
npm run build
cd ..
echo -e "${GREEN}✓ Scraper build complete${NC}"
echo ""

# Step 6: Create deployment directory structure
echo -e "${YELLOW}[6/8] Creating deployment package structure...${NC}"
mkdir -p "${TEMP_DIR}"

# Copy web application
mkdir -p "${TEMP_DIR}/web"
cp -r web/.next "${TEMP_DIR}/web/"
cp web/package.json "${TEMP_DIR}/web/"
cp web/package-lock.json "${TEMP_DIR}/web/"
cp -r web/public "${TEMP_DIR}/web/" 2>/dev/null || true

# Copy scraper application
mkdir -p "${TEMP_DIR}/scraper"
cp -r scraper/dist "${TEMP_DIR}/scraper/"
cp scraper/package.json "${TEMP_DIR}/scraper/"
cp scraper/package-lock.json "${TEMP_DIR}/scraper/"

# Copy PM2 ecosystem config
cp ecosystem.config.js "${TEMP_DIR}/"

# Copy environment template
cp .env.production.template "${TEMP_DIR}/"

# Copy database migrations (if they exist)
if [ -d "database/migrations" ]; then
  mkdir -p "${TEMP_DIR}/database"
  cp -r database/migrations "${TEMP_DIR}/database/"
fi

# Copy deployment documentation
mkdir -p "${TEMP_DIR}/docs"
cp docs/deployment/DEPLOYMENT-CHECKLIST.md "${TEMP_DIR}/docs/" 2>/dev/null || true
cp docs/deployment/ROLLBACK.md "${TEMP_DIR}/docs/" 2>/dev/null || true

# Create deployment README
cat > "${TEMP_DIR}/DEPLOY.md" << 'EOF'
# IPODhan Deployment Package

## Quick Start

1. Extract this package on the VPS:
   ```bash
   tar -xzf ipodhan-deployment-*.tar.gz
   cd ipodhan-deployment-*
   ```

2. Install production dependencies:
   ```bash
   cd web && npm ci --production && cd ..
   cd scraper && npm ci --production && cd ..
   ```

3. Configure environment:
   ```bash
   cp .env.production.template .env.production
   # Edit .env.production with production values
   ```

4. Start with PM2:
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   ```

5. Verify deployment:
   ```bash
   curl http://localhost:3000/api/health
   ```

## Documentation

- DEPLOYMENT-CHECKLIST.md: Complete deployment checklist
- ROLLBACK.md: Rollback procedures
- .env.production.template: Environment variable template

## Support

For issues, refer to docs/deployment/ in the main repository.
EOF

echo -e "${GREEN}✓ Package structure created${NC}"
echo ""

# Step 7: Create archive
echo -e "${YELLOW}[7/8] Creating deployment archive...${NC}"
cd .deployment-temp
tar -czf "../${OUTPUT_FILE}" "${PACKAGE_NAME}"
cd ..
echo -e "${GREEN}✓ Archive created: ${OUTPUT_FILE}${NC}"
echo ""

# Step 8: Cleanup and summary
echo -e "${YELLOW}[8/8] Cleaning up temporary files...${NC}"
rm -rf .deployment-temp
echo -e "${GREEN}✓ Cleanup complete${NC}"
echo ""

# Display package info
PACKAGE_SIZE=$(du -h "${OUTPUT_FILE}" | cut -f1)
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}Deployment Package Created Successfully!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "Package: ${GREEN}${OUTPUT_FILE}${NC}"
echo -e "Size: ${GREEN}${PACKAGE_SIZE}${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Transfer to VPS: scp ${OUTPUT_FILE} user@103.118.16.189:/path/to/deploy"
echo "2. Extract and follow DEPLOY.md instructions"
echo "3. Verify health: curl http://103.118.16.189:3000/api/health"
echo ""
echo -e "${GREEN}Ready for deployment!${NC}"
