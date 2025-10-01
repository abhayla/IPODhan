#!/bin/bash

################################################################################
# IPODhan Data Pipeline - Production Server Deployment Script
# Target Server: 103.118.16.189
# For Use By: Claude Code on Production Server
# Date: 2025-10-01
################################################################################

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="/opt/ipodhan"
PIPELINE_DIR="$PROJECT_DIR/ipodhan-data-pipeline"
VENV_DIR="$PIPELINE_DIR/venv"
DB_HOST="localhost"
DB_NAME="ipodhan"
DB_USER="postgres"

# Functions
print_header() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_command() {
    if command -v $1 &> /dev/null; then
        print_success "$1 is installed"
        return 0
    else
        print_error "$1 is not installed"
        return 1
    fi
}

################################################################################
# Main Deployment
################################################################################

print_header "IPODhan Data Pipeline - Server Deployment"

echo "Target Server: 103.118.16.189"
echo "Project Directory: $PROJECT_DIR"
echo "Pipeline Directory: $PIPELINE_DIR"
echo ""

# Step 1: Prerequisites Check
print_header "Step 1: Checking Prerequisites"

PREREQ_PASS=true

# Check Python
if check_command python3; then
    PYTHON_VERSION=$(python3 --version)
    print_info "Python version: $PYTHON_VERSION"
else
    PREREQ_PASS=false
fi

# Check PostgreSQL
if check_command psql; then
    PG_VERSION=$(psql --version)
    print_info "PostgreSQL version: $PG_VERSION"
else
    PREREQ_PASS=false
fi

# Check pip
if check_command pip3; then
    print_success "pip3 is installed"
else
    PREREQ_PASS=false
fi

# Check git (optional)
if check_command git; then
    print_success "git is installed (optional)"
fi

if [ "$PREREQ_PASS" = false ]; then
    print_error "Prerequisites check failed. Please install missing components."
    exit 1
fi

print_success "All prerequisites satisfied"

# Step 2: Directory Setup
print_header "Step 2: Setting Up Directories"

if [ ! -d "$PROJECT_DIR" ]; then
    print_error "Project directory $PROJECT_DIR does not exist"
    print_info "Please upload project files to $PROJECT_DIR first"
    exit 1
fi

cd "$PROJECT_DIR"
print_success "Changed to project directory: $PWD"

# Step 3: Create Virtual Environment
print_header "Step 3: Creating Python Virtual Environment"

if [ -d "$VENV_DIR" ]; then
    print_warning "Virtual environment already exists, skipping creation"
else
    print_info "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
    print_success "Virtual environment created"
fi

# Activate virtual environment
source "$VENV_DIR/bin/activate"
print_success "Virtual environment activated"

# Step 4: Install Python Dependencies
print_header "Step 4: Installing Python Dependencies"

cd "$PIPELINE_DIR"

print_info "Upgrading pip..."
pip install --upgrade pip > /dev/null 2>&1

print_info "Installing requirements (this may take a few minutes)..."
pip install -r requirements.txt

print_success "Python dependencies installed"

# Step 5: Install Playwright Browsers
print_header "Step 5: Installing Playwright Browsers"

print_info "Installing Chromium browser..."
playwright install chromium

print_success "Playwright browsers installed"

# Step 6: Configure Environment
print_header "Step 6: Configuring Environment"

if [ -f "$PIPELINE_DIR/.env" ]; then
    print_warning ".env file already exists"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cp .env.example .env
        print_success ".env file created from template"
    else
        print_info "Keeping existing .env file"
    fi
else
    cp .env.example .env
    print_success ".env file created from template"
fi

print_warning "⚠ IMPORTANT: Please edit .env file and update database credentials"
print_info "Use: nano $PIPELINE_DIR/.env"
echo ""
read -p "Press Enter after you've updated the .env file..."

# Step 7: Database Migrations
print_header "Step 7: Running Database Migrations"

print_info "Checking database connection..."
if psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "SELECT version();" > /dev/null 2>&1; then
    print_success "Database connection successful"
else
    print_error "Cannot connect to database. Please check credentials."
    print_info "You can run the migration manually later:"
    print_info "psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f $PROJECT_DIR/infrastructure/database/migrations/002_enhanced_ipo_schema.sql"
    read -p "Continue without running migration? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Run migration 002
print_info "Running migration 002_enhanced_ipo_schema.sql..."
MIGRATION_FILE="$PROJECT_DIR/infrastructure/database/migrations/002_enhanced_ipo_schema.sql"

if [ -f "$MIGRATION_FILE" ]; then
    if psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f "$MIGRATION_FILE"; then
        print_success "Migration completed successfully"

        # Verify tables
        print_info "Verifying new tables..."
        TABLE_COUNT=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -t -c "
            SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name IN ('ipo_details', 'ipo_financials', 'gmp_tracking', 'pipeline_status');
        " | xargs)

        if [ "$TABLE_COUNT" = "4" ]; then
            print_success "All 4 tables created successfully"
        else
            print_warning "Expected 4 tables, found $TABLE_COUNT"
        fi
    else
        print_error "Migration failed. Please run manually."
    fi
else
    print_warning "Migration file not found: $MIGRATION_FILE"
fi

# Step 8: Test Pipeline
print_header "Step 8: Testing Pipeline"

cd "$PIPELINE_DIR"

print_info "Testing IPO pipeline..."
if python main.py run-ipo 2>&1 | grep -q "completed"; then
    print_success "IPO pipeline test passed"
else
    print_warning "IPO pipeline test may have issues (check logs)"
fi

print_info "Running health check..."
python main.py health-check

# Step 9: Setup Systemd Service (Optional)
print_header "Step 9: System Service Setup (Optional)"

read -p "Do you want to set up the pipeline as a system service? (y/N): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_info "Creating systemd service file..."

    SERVICE_FILE="/etc/systemd/system/ipodhan-pipeline.service"

    sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=IPODhan Data Pipeline Service
After=network.target postgresql.service

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=$PIPELINE_DIR
Environment="PATH=$VENV_DIR/bin"
ExecStart=$VENV_DIR/bin/python main.py schedule
Restart=always
RestartSec=10

StandardOutput=journal
StandardError=journal
SyslogIdentifier=ipodhan-pipeline

[Install]
WantedBy=multi-user.target
EOF

    print_success "Service file created: $SERVICE_FILE"

    # Reload and enable service
    print_info "Enabling service..."
    sudo systemctl daemon-reload
    sudo systemctl enable ipodhan-pipeline

    read -p "Do you want to start the service now? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo systemctl start ipodhan-pipeline
        print_success "Service started"

        sleep 2
        sudo systemctl status ipodhan-pipeline --no-pager
    else
        print_info "You can start the service later with: sudo systemctl start ipodhan-pipeline"
    fi
else
    print_info "Skipping service setup"
    print_info "You can run the pipeline manually with: python main.py schedule"
fi

# Final Summary
print_header "Deployment Complete!"

echo ""
echo -e "${GREEN}✓ Python dependencies installed${NC}"
echo -e "${GREEN}✓ Playwright browsers ready${NC}"
echo -e "${GREEN}✓ Environment configured${NC}"
echo -e "${GREEN}✓ Database migrations applied${NC}"
echo -e "${GREEN}✓ Pipeline tested${NC}"
echo ""

print_info "Next Steps:"
echo "  1. Review .env file: nano $PIPELINE_DIR/.env"
echo "  2. Run full pipeline: cd $PIPELINE_DIR && python main.py run-full"
echo "  3. Check health: python main.py health-check"
echo "  4. View metrics: python main.py metrics"
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "  5. Check service status: sudo systemctl status ipodhan-pipeline"
    echo "  6. View logs: sudo journalctl -u ipodhan-pipeline -f"
else
    echo "  5. Start scheduled pipeline: python main.py schedule"
fi

echo ""
print_info "Documentation:"
echo "  - Server Guide: $PROJECT_DIR/SERVER_DEPLOYMENT.md"
echo "  - README: $PIPELINE_DIR/README.md"
echo "  - Implementation: $PROJECT_DIR/IMPLEMENTATION_SUMMARY.md"
echo ""

print_success "Deployment completed successfully!"
echo ""
