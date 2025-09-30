# 🚀 IPODhan Infrastructure Setup Guide

**A Step-by-Step Guide to Complete Tasks 7, 9-15**

This guide will help you set up the remaining infrastructure for IPODhan. We'll go through each step slowly and carefully!

---

## 📋 What You'll Need Before Starting

✅ **Already Done:**
- Domain: ipodhan.com is registered
- CloudFlare account is set up

❌ **You Still Need:**
- AWS Account (we'll create this together!)
- Vercel Account (free to start!)
- Sentry Account (free to start!)
- GitHub Account (for code storage)
- Your credit/debit card (for AWS only, others are free)

---

## 🎯 Task 7: Set Up CI/CD Pipelines (GitHub Actions)

**What is CI/CD?** It's like a robot that automatically tests your code and deploys it when you make changes!

### Step 1: Create GitHub Repository

1. Go to [github.com](https://github.com)
2. Click the green "New" button (top left)
3. Name your repository: `ipodhan`
4. Keep it **Private** (check the Private box)
5. Click "Create repository"

### Step 2: Push Your Code to GitHub

Open your terminal (command prompt) and type these commands one by one:

```bash
# Step 1: Tell git where to send your code
git remote add origin https://github.com/YOUR_USERNAME/ipodhan.git

# Step 2: Add all your files
git add .

# Step 3: Save your files with a message
git commit -m "Initial commit - Core infrastructure setup"

# Step 4: Send your code to GitHub
git push -u origin main
```

**Replace `YOUR_USERNAME` with your actual GitHub username!**

### Step 3: Create GitHub Actions Workflows

Now let's create the robot files! These files tell GitHub what to do automatically.

#### 3A: Create Frontend Testing Workflow

1. In your project, go to `.github/workflows/` folder
2. Create a new file called `ci-web.yml`
3. Copy this code:

```yaml
name: Frontend CI

on:
  push:
    branches: [ main, develop ]
    paths:
      - 'ipodhan-web/**'
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
    - name: 📥 Checkout code
      uses: actions/checkout@v3

    - name: 🟢 Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'

    - name: 📦 Install dependencies
      working-directory: ./ipodhan-web
      run: npm install

    - name: 🧪 Run linter
      working-directory: ./ipodhan-web
      run: npm run lint

    - name: ✅ Run tests
      working-directory: ./ipodhan-web
      run: npm test

    - name: 🏗️ Build application
      working-directory: ./ipodhan-web
      run: npm run build
```

#### 3B: Create Backend Testing Workflow

Create another file called `ci-backend.yml`:

```yaml
name: Backend CI

on:
  push:
    branches: [ main, develop ]
    paths:
      - 'ipodhan-backend/**'
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: ipodhan_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 6379:6379

    steps:
    - name: 📥 Checkout code
      uses: actions/checkout@v3

    - name: 🟢 Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '20'

    - name: 📦 Install dependencies
      working-directory: ./ipodhan-backend
      run: npm install

    - name: 🧪 Run linter
      working-directory: ./ipodhan-backend
      run: npm run lint

    - name: ✅ Run tests
      working-directory: ./ipodhan-backend
      run: npm test
      env:
        DB_HOST: localhost
        DB_PORT: 5432
        DB_NAME: ipodhan_test
        DB_USER: postgres
        DB_PASSWORD: postgres
        REDIS_HOST: localhost
        REDIS_PORT: 6379

    - name: 🏗️ Build application
      working-directory: ./ipodhan-backend
      run: npm run build
```

#### 3C: Create Python Data Pipeline Workflow

Create `ci-data.yml`:

```yaml
name: Data Pipeline CI

on:
  push:
    branches: [ main, develop ]
    paths:
      - 'ipodhan-data-pipeline/**'
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
    - name: 📥 Checkout code
      uses: actions/checkout@v3

    - name: 🐍 Setup Python
      uses: actions/setup-python@v4
      with:
        python-version: '3.11'

    - name: 📦 Install dependencies
      working-directory: ./ipodhan-data-pipeline
      run: |
        python -m pip install --upgrade pip
        pip install -r requirements.txt
        pip install black pytest

    - name: 🧪 Run Black formatter check
      working-directory: ./ipodhan-data-pipeline
      run: black --check .

    - name: ✅ Run tests
      working-directory: ./ipodhan-data-pipeline
      run: pytest
```

#### 3D: Save and Push

```bash
git add .github/workflows/
git commit -m "Add CI/CD workflows"
git push
```

Now go to GitHub → Your Repository → "Actions" tab. You should see your workflows running! 🎉

---

## 🔐 Task 9: Set Up AWS Secrets Manager

**What is Secrets Manager?** It's like a super secure vault where we keep passwords and secrets!

### Step 1: Create AWS Account

1. Go to [aws.amazon.com](https://aws.amazon.com)
2. Click "Create an AWS Account"
3. Enter your email address
4. Create a strong password (write it down somewhere safe!)
5. Choose "Personal" account type
6. Fill in your contact information
7. Enter your credit card details (AWS Free Tier is free for 12 months!)
8. Verify your phone number (they'll call you!)
9. Choose "Basic Support - Free"
10. Click "Complete Sign Up"

**🎉 You now have an AWS account!**

### Step 2: Go to AWS Secrets Manager

1. Sign in to [console.aws.amazon.com](https://console.aws.amazon.com)
2. At the top, you'll see a search bar
3. Type "Secrets Manager" and click on it
4. Make sure you're in "Asia Pacific (Mumbai) ap-south-1" region (see top-right corner)

### Step 3: Create Database Secret

1. Click the orange "Store a new secret" button
2. Choose "Other type of secret"
3. Click "Plaintext" tab
4. Delete everything and paste this:

```json
{
  "host": "your-database-endpoint.rds.amazonaws.com",
  "port": 5432,
  "database": "ipodhan",
  "username": "postgres",
  "password": "CHANGE_THIS_TO_STRONG_PASSWORD"
}
```

5. Change the password to a strong one (mix of letters, numbers, symbols)
6. Click "Next"
7. Secret name: `ipodhan/production/database`
8. Description: "IPODhan Production Database Credentials"
9. Click "Next" → "Next" → "Store"

### Step 4: Create Redis Secret

Repeat Step 3, but use this content:

```json
{
  "host": "your-redis-endpoint.cache.amazonaws.com",
  "port": 6379,
  "password": "CHANGE_THIS_IF_YOU_SET_REDIS_PASSWORD"
}
```

Secret name: `ipodhan/production/redis`

### Step 5: Create JWT Secret

Repeat Step 3, but use this content:

```json
{
  "secret": "GENERATE_RANDOM_64_CHARACTER_STRING_HERE",
  "expiresIn": "7d"
}
```

Secret name: `ipodhan/production/jwt`

**To generate a random string, open terminal and run:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 6: Create IAM Role for Secret Access

1. Search for "IAM" in AWS console
2. Click "Roles" in left menu
3. Click "Create role"
4. Choose "AWS service"
5. Use case: "ECS Task"
6. Click "Next"
7. Search for "SecretsManagerReadWrite"
8. Check the box next to it
9. Click "Next"
10. Role name: `IPODhanECSTaskRole`
11. Click "Create role"

**Write down the Role ARN** (it looks like: `arn:aws:iam::123456789:role/IPODhanECSTaskRole`)

---

## 🌐 Task 10: Set Up Staging Environment

### Step 1: Create Staging Database on AWS RDS

1. Go to AWS Console → Search "RDS"
2. Click "Create database"
3. Choose "Standard create"
4. Engine: "PostgreSQL"
5. Version: "PostgreSQL 16.x"
6. Templates: "Dev/Test"
7. DB instance identifier: `ipodhan-staging-db`
8. Master username: `postgres`
9. Master password: (create a strong one!)
10. DB instance class: `db.t4g.micro` (free tier eligible)
11. Storage: 20 GB
12. Enable "Storage autoscaling"
13. Don't create standby instance (uncheck Multi-AZ)
14. VPC: Default VPC
15. Public access: "Yes" (for now, we'll secure it later)
16. VPC security group: "Create new"
17. New security group name: `ipodhan-staging-db-sg`
18. Database name: `ipodhan`
19. Scroll down and click "Create database"

**⏰ Wait 5-10 minutes for the database to be ready!**

### Step 2: Update Database Secret with Real Endpoint

1. Once database is "Available", click on it
2. Copy the "Endpoint" (looks like: `ipodhan-staging-db.xxxxx.ap-south-1.rds.amazonaws.com`)
3. Go back to Secrets Manager
4. Click on `ipodhan/production/database`
5. Click "Retrieve secret value"
6. Click "Edit"
7. Replace `your-database-endpoint.rds.amazonaws.com` with your real endpoint
8. Click "Save"

### Step 3: Run Database Migration

1. Install PostgreSQL client on your computer:
   - **Windows**: Download from [postgresql.org/download](https://www.postgresql.org/download/)
   - **Mac**: `brew install postgresql`
   - **Linux**: `sudo apt install postgresql-client`

2. Open terminal and run:

```bash
psql -h YOUR_RDS_ENDPOINT -U postgres -d ipodhan -f infrastructure/database/migrations/001_initial_schema.sql
```

Replace `YOUR_RDS_ENDPOINT` with your actual endpoint!

**It will ask for password** - enter the password you created!

### Step 4: Set Up Backend on AWS ECS

This is a bit complex, so let's break it down:

#### 4A: Create ECR Repository (Docker Image Storage)

1. AWS Console → Search "ECR"
2. Click "Create repository"
3. Repository name: `ipodhan-backend`
4. Leave everything else default
5. Click "Create repository"
6. Click on the repository name
7. Click "View push commands"
8. **Save these commands somewhere** - you'll need them!

#### 4B: Push Your Backend Image

Open terminal in your project folder:

```bash
# Step 1: Login to AWS ECR (use the command from "View push commands")
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com

# Step 2: Build your backend image
cd ipodhan-backend
docker build -t ipodhan-backend .

# Step 3: Tag it for ECR
docker tag ipodhan-backend:latest YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/ipodhan-backend:latest

# Step 4: Push to ECR
docker push YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/ipodhan-backend:latest
```

Replace `YOUR_ACCOUNT_ID` with your AWS account number!

#### 4C: Create ECS Cluster

1. AWS Console → Search "ECS"
2. Click "Create cluster"
3. Cluster name: `ipodhan-staging-cluster`
4. Infrastructure: "AWS Fargate (serverless)"
5. Click "Create"

#### 4D: Create Task Definition

1. ECS → "Task Definitions" → "Create new task definition"
2. Task definition family: `ipodhan-backend-task`
3. Launch type: "Fargate"
4. Operating system: "Linux"
5. Task size:
   - CPU: 0.5 vCPU
   - Memory: 1 GB
6. Task execution role: Select `IPODhanECSTaskRole` (we created this earlier!)
7. Container definitions:
   - Container name: `ipodhan-backend`
   - Image URI: `YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/ipodhan-backend:latest`
   - Port mappings: 4000 (TCP)
   - Environment variables:
     - `NODE_ENV`: `staging`
     - `PORT`: `4000`
   - Secrets (click "Add" for each):
     - `DB_HOST`: ValueFrom → `ipodhan/production/database:host::`
     - `DB_PORT`: ValueFrom → `ipodhan/production/database:port::`
     - `DB_NAME`: ValueFrom → `ipodhan/production/database:database::`
     - `DB_USER`: ValueFrom → `ipodhan/production/database:username::`
     - `DB_PASSWORD`: ValueFrom → `ipodhan/production/database:password::`
8. Click "Create"

#### 4E: Create ECS Service

1. Go to your cluster: `ipodhan-staging-cluster`
2. Click "Create service"
3. Launch type: "Fargate"
4. Task Definition: `ipodhan-backend-task`
5. Service name: `ipodhan-backend-service`
6. Number of tasks: 1
7. Load balancer: "Application Load Balancer"
8. Create new load balancer:
   - Name: `ipodhan-staging-alb`
   - Listener: Port 80
   - Target group: Create new
   - Target group name: `ipodhan-backend-tg`
   - Health check path: `/health`
9. Click "Create service"

**⏰ Wait 5 minutes for service to start!**

### Step 5: Set Up Frontend on Vercel

#### 5A: Create Vercel Account

1. Go to [vercel.com](https://vercel.com)
2. Click "Sign Up"
3. Sign up with GitHub (easier!)
4. Authorize Vercel to access your GitHub

#### 5B: Import Project

1. Click "Add New" → "Project"
2. Select your `ipodhan` repository
3. Framework Preset: "Next.js"
4. Root Directory: `ipodhan-web`
5. Build Command: `npm run build`
6. Output Directory: `.next`
7. Environment Variables (click "Add"):
   - `NEXT_PUBLIC_API_URL`: `http://YOUR_ALB_DNS_NAME` (get this from AWS Load Balancer page!)
   - `NEXT_PUBLIC_ENV`: `staging`
8. Click "Deploy"

**🎉 Your frontend is deploying!**

### Step 6: Configure Staging Subdomain on CloudFlare

1. Go to [cloudflare.com](https://cloudflare.com) and sign in
2. Click on your domain `ipodhan.com`
3. Go to "DNS" tab
4. Click "Add record"
5. Type: "CNAME"
6. Name: "staging"
7. Target: Your Vercel deployment URL (like `ipodhan-web-xxx.vercel.app`)
8. Proxy status: ON (orange cloud)
9. Click "Save"

**Now `staging.ipodhan.com` points to your staging site!**

### Step 7: Configure Staging API Subdomain

Repeat Step 6, but:
- Name: "staging-api"
- Target: Your AWS Load Balancer DNS name

**Now `staging-api.ipodhan.com` points to your backend!**

### Step 8: Update Frontend Environment Variable

1. Go back to Vercel dashboard
2. Click on your project
3. Go to "Settings" → "Environment Variables"
4. Edit `NEXT_PUBLIC_API_URL`
5. Change to: `https://staging-api.ipodhan.com`
6. Click "Save"
7. Go to "Deployments" tab
8. Click "..." on latest deployment → "Redeploy"

---

## 🌍 Task 11: Set Up Production Environment

**Great news!** Production setup is almost identical to staging. Just repeat Task 10, but:

### Changes for Production:

1. **Database**:
   - Name: `ipodhan-production-db`
   - Instance class: `db.t4g.small` or larger
   - ✅ **Enable Multi-AZ** (for backup!)
   - ✅ **Enable automated backups** (7 days)

2. **ECS Cluster**:
   - Name: `ipodhan-production-cluster`

3. **Task Definition**:
   - CPU: 1 vCPU
   - Memory: 2 GB
   - Environment: `NODE_ENV=production`

4. **ECS Service**:
   - Number of tasks: **2** (for redundancy!)

5. **CloudFlare DNS**:
   - Don't create "staging" subdomain
   - Create "@" record (root domain) pointing to Vercel
   - Create "api" subdomain pointing to AWS Load Balancer

6. **Vercel**:
   - Create a separate project (not environment)
   - Environment: `NEXT_PUBLIC_ENV=production`
   - API URL: `https://api.ipodhan.com`

---

## 📊 Task 12: Set Up Monitoring (Sentry + CloudWatch)

### Part A: Sentry Setup

#### Step 1: Create Sentry Account

1. Go to [sentry.io](https://sentry.io)
2. Click "Get Started"
3. Sign up with GitHub (easier!)
4. Choose "Developer" plan (free!)

#### Step 2: Create Sentry Projects

1. Click "Create Project"
2. Platform: "Next.js"
3. Project name: `ipodhan-web`
4. Click "Create Project"
5. **Copy the DSN** (looks like: `https://xxxxx@sentry.io/xxxxx`)
6. Repeat for:
   - Platform: "Node.js", Name: `ipodhan-backend`
   - Platform: "Python", Name: `ipodhan-data-pipeline`

#### Step 3: Add Sentry to Frontend

Open terminal:

```bash
cd ipodhan-web
npm install @sentry/nextjs
npx @sentry/wizard -i nextjs
```

Follow the wizard:
- Enter your Sentry DSN
- Yes to upload source maps
- Yes to example page

Update `.env.example`:
```
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn_here
```

#### Step 4: Add Sentry to Backend

```bash
cd ipodhan-backend
npm install @sentry/node
```

Create `src/config/sentry.ts`:

```typescript
import * as Sentry from '@sentry/node';

export function initSentry() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 1.0,
  });
}
```

Update `server.ts`:

```typescript
import { initSentry } from './config/sentry';

// Add at the very top, before other imports
initSentry();

// ... rest of your code
```

#### Step 5: Add Sentry to Data Pipeline

```bash
cd ipodhan-data-pipeline
pip install sentry-sdk
```

Update `main.py`:

```python
import sentry_sdk
import os

sentry_sdk.init(
    dsn=os.getenv('SENTRY_DSN'),
    environment=os.getenv('ENVIRONMENT', 'development'),
    traces_sample_rate=1.0
)

# ... rest of your code
```

### Part B: AWS CloudWatch Setup

#### Step 1: Create CloudWatch Log Groups

1. AWS Console → Search "CloudWatch"
2. Click "Logs" → "Log groups"
3. Click "Create log group"
4. Log group name: `/ecs/ipodhan-backend`
5. Click "Create"
6. Repeat for: `/ecs/ipodhan-data-pipeline`

#### Step 2: Update ECS Task Definitions

1. Go to ECS → Task Definitions
2. Click on `ipodhan-backend-task`
3. Click "Create new revision"
4. Scroll to "Log configuration"
5. Log driver: `awslogs`
6. Options:
   - `awslogs-group`: `/ecs/ipodhan-backend`
   - `awslogs-region`: `ap-south-1`
   - `awslogs-stream-prefix`: `backend`
7. Click "Create"
8. Update your ECS service to use this new task definition

#### Step 3: Create CloudWatch Alarms

1. CloudWatch → "Alarms" → "Create alarm"
2. Click "Select metric"
3. Search for your load balancer
4. Select "Target Response Time"
5. Conditions:
   - Greater than: 2000 (milliseconds)
6. Click "Next"
7. Notification:
   - Create new topic: `ipodhan-alerts`
   - Email: your-email@example.com
   - Click "Create topic"
8. Alarm name: `ipodhan-api-high-latency`
9. Click "Create alarm"

**Check your email and confirm SNS subscription!**

Repeat for:
- CPU Utilization > 80%
- Error rate > 1%
- HTTP 5xx errors > 10

---

## 🛠️ Task 13: Create Development Tools

### Step 1: Install Husky (Git Hooks)

```bash
cd /path/to/ipodhan
npm install --save-dev husky
npx husky init
```

### Step 2: Add Pre-commit Hook

```bash
echo "npm run lint" > .husky/pre-commit
chmod +x .husky/pre-commit
```

### Step 3: Create Setup Script

Create `scripts/setup.sh`:

```bash
#!/bin/bash

echo "🚀 Setting up IPODhan development environment..."

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Setup Git hooks
echo "🪝 Setting up Git hooks..."
npx husky install

# Copy environment files
echo "📝 Creating environment files..."
cp ipodhan-web/.env.example ipodhan-web/.env
cp ipodhan-backend/.env.example ipodhan-backend/.env
cp ipodhan-data-pipeline/.env.example ipodhan-data-pipeline/.env

# Start Docker services
echo "🐳 Starting Docker services..."
docker-compose up -d postgres redis

# Wait for services
echo "⏳ Waiting for services to be ready..."
sleep 10

# Run migrations
echo "🗄️ Running database migrations..."
docker exec -i ipodhan-postgres-1 psql -U postgres -d ipodhan < infrastructure/database/migrations/001_initial_schema.sql

echo "✅ Setup complete! Run 'pnpm dev' to start development."
```

Make it executable:

```bash
chmod +x scripts/setup.sh
```

### Step 4: Create Deployment Script

Create `scripts/deploy.sh`:

```bash
#!/bin/bash

ENVIRONMENT=$1

if [ -z "$ENVIRONMENT" ]; then
  echo "Usage: ./scripts/deploy.sh [staging|production]"
  exit 1
fi

echo "🚀 Deploying to $ENVIRONMENT..."

# Build and push backend
echo "📦 Building backend..."
cd ipodhan-backend
docker build -t ipodhan-backend:$ENVIRONMENT .
docker tag ipodhan-backend:$ENVIRONMENT YOUR_ECR_URI/ipodhan-backend:$ENVIRONMENT
docker push YOUR_ECR_URI/ipodhan-backend:$ENVIRONMENT

# Update ECS service
echo "🔄 Updating ECS service..."
aws ecs update-service \
  --cluster ipodhan-$ENVIRONMENT-cluster \
  --service ipodhan-backend-service \
  --force-new-deployment \
  --region ap-south-1

# Deploy frontend
echo "🎨 Deploying frontend..."
cd ../ipodhan-web
vercel --prod

echo "✅ Deployment to $ENVIRONMENT complete!"
```

### Step 5: Add Scripts to package.json

Update root `package.json`:

```json
{
  "scripts": {
    "dev": "pnpm run --parallel dev",
    "build": "pnpm run --recursive build",
    "test": "pnpm run --recursive test",
    "lint": "pnpm run --recursive lint",
    "setup": "./scripts/setup.sh",
    "deploy:staging": "./scripts/deploy.sh staging",
    "deploy:production": "./scripts/deploy.sh production"
  }
}
```

---

## 📖 Task 14: Create API Documentation

### Step 1: Install Swagger

```bash
cd ipodhan-backend
npm install swagger-jsdoc swagger-ui-express
npm install --save-dev @types/swagger-jsdoc @types/swagger-ui-express
```

### Step 2: Create Swagger Configuration

Create `src/config/swagger.ts`:

```typescript
import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'IPODhan API Documentation',
      version: '1.0.0',
      description: 'API for IPO tracking and investment tools',
      contact: {
        name: 'IPODhan Support',
        email: 'support@ipodhan.com',
      },
    },
    servers: [
      {
        url: 'http://localhost:4000',
        description: 'Development server',
      },
      {
        url: 'https://staging-api.ipodhan.com',
        description: 'Staging server',
      },
      {
        url: 'https://api.ipodhan.com',
        description: 'Production server',
      },
    ],
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
```

### Step 3: Add Swagger to Server

Update `src/server.ts`:

```typescript
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';

// ... other code ...

// Add after your routes
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

console.log('📖 API Documentation: http://localhost:4000/api/docs');
```

### Step 4: Document Your First Route

Update `src/routes/ipo.routes.ts`:

```typescript
/**
 * @swagger
 * /api/ipos:
 *   get:
 *     summary: Get all IPOs
 *     description: Retrieve a list of all IPOs with optional filters
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [UPCOMING, LIVE, CLOSED, LISTED]
 *         description: Filter by IPO status
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [MAINBOARD, SME]
 *         description: Filter by IPO category
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Server error
 */
router.get('/', ipoController.getIPOs);
```

**Visit http://localhost:4000/api/docs to see your documentation!**

---

## ✅ Task 15: Infrastructure Testing & Validation

### Step 1: Test CI/CD Pipelines

```bash
# Make a small change to test
echo "# Test change" >> README.md
git add .
git commit -m "Test CI/CD pipeline"
git push
```

Go to GitHub → Your repo → "Actions" tab

**Check that:**
- ✅ All workflows run successfully
- ✅ Tests pass
- ✅ Build completes

### Step 2: Test Database Migrations

```bash
# Test on local database
docker exec -i ipodhan-postgres-1 psql -U postgres -d ipodhan < infrastructure/database/migrations/001_initial_schema.sql

# Check tables were created
docker exec -i ipodhan-postgres-1 psql -U postgres -d ipodhan -c "\dt"
```

You should see all your tables listed!

### Step 3: Test Monitoring Dashboards

1. Go to Sentry dashboard
2. Click on each project
3. **Check:** Are you seeing events?

4. Go to AWS CloudWatch
5. Click "Dashboards"
6. **Check:** Are metrics being collected?

### Step 4: Test Alert Notifications

1. Make your API slow on purpose (add a delay)
2. Send several requests
3. Wait 5 minutes
4. **Check your email** - Did you get an alert?

### Step 5: Test Domain Resolution

Open terminal:

```bash
# Test staging
ping staging.ipodhan.com
ping staging-api.ipodhan.com

# Test production
ping ipodhan.com
ping api.ipodhan.com
```

All should respond!

### Step 6: Test SSL Certificates

Visit in browser:
- https://staging.ipodhan.com
- https://staging-api.ipodhan.com/health
- https://ipodhan.com
- https://api.ipodhan.com/health

**Check:** Green lock icon appears!

### Step 7: Test Hot Reload (Development)

```bash
# Start development
pnpm dev
```

1. Open `ipodhan-web/src/pages/index.tsx`
2. Make a small change
3. Save file
4. **Check:** Browser updates automatically!

### Step 8: Smoke Tests on Staging

```bash
# Test backend health
curl https://staging-api.ipodhan.com/health

# Expected response: {"status":"OK"}
```

### Step 9: Smoke Tests on Production

Same as Step 8, but use production URLs!

### Step 10: Test Deployment Rollback

1. Deploy a "broken" version on purpose
2. In AWS ECS → Services → Select your service
3. Click "Update service"
4. Select previous task definition
5. Click "Update"
6. **Check:** Service rolls back to previous version!

---

## 🎉 Congratulations!

You've completed all infrastructure tasks! Here's what you now have:

✅ **Task 7**: CI/CD pipelines automatically test and build your code
✅ **Task 9**: Secrets are safely stored in AWS Secrets Manager
✅ **Task 10**: Staging environment is live at staging.ipodhan.com
✅ **Task 11**: Production environment is live at ipodhan.com
✅ **Task 12**: Monitoring with Sentry and CloudWatch
✅ **Task 13**: Development tools and scripts
✅ **Task 14**: API documentation at /api/docs
✅ **Task 15**: Everything is tested and validated!

---

## 🆘 Common Problems and Solutions

### Problem: "AWS CLI not found"

**Solution:**
```bash
# Install AWS CLI
# Mac:
brew install awscli

# Windows:
Download from: https://aws.amazon.com/cli/

# Configure it:
aws configure
# Enter your Access Key ID and Secret when asked
```

### Problem: "Docker push permission denied"

**Solution:**
```bash
# Login to ECR again
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com
```

### Problem: "Database connection refused"

**Solution:**
1. Check security group allows your IP:
   - AWS → EC2 → Security Groups
   - Find `ipodhan-staging-db-sg`
   - Add rule: Type=PostgreSQL, Source=My IP

### Problem: "Vercel deployment failed"

**Solution:**
1. Check build logs in Vercel dashboard
2. Make sure `ipodhan-web/package.json` has all dependencies
3. Try: `npm run build` locally first

### Problem: "CloudWatch logs not appearing"

**Solution:**
1. Check ECS task definition has log configuration
2. Check IAM role has CloudWatch permissions
3. Wait 5 minutes - logs can be delayed!

---

## 📞 Need Help?

If you get stuck:
1. Check AWS documentation: [docs.aws.amazon.com](https://docs.aws.amazon.com)
2. Check Vercel docs: [vercel.com/docs](https://vercel.com/docs)
3. Check Sentry docs: [docs.sentry.io](https://docs.sentry.io)

---

**Remember:** Take your time! Infrastructure setup is complex, but by following these steps carefully, you'll get everything working! 🚀