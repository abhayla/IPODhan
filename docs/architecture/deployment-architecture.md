# Deployment Architecture

## Deployment Strategy

**Frontend Deployment:**
- **Platform:** Vercel
- **Build Command:** `pnpm build`
- **Output Directory:** `.next`
- **CDN/Edge:** CloudFlare + Vercel Edge Network

**Backend Deployment:**
- **Platform:** AWS ECS Fargate
- **Build Command:** `pnpm build`
- **Deployment Method:** Docker containers via ECR

## CI/CD Pipeline

```yaml
# .github/workflows/deploy.yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: pnpm install
      - run: pnpm test
      - run: pnpm lint

  deploy-frontend:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: vercel/action@v2
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}

  deploy-backend:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: aws-actions/configure-aws-credentials@v1
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ap-south-1
      - run: |
          docker build -t ipodhan-api ./ipodhan-backend
          docker tag ipodhan-api:latest $ECR_REGISTRY/ipodhan-api:latest
          docker push $ECR_REGISTRY/ipodhan-api:latest
          aws ecs update-service --cluster ipodhan --service api --force-new-deployment
```

## Environments

| Environment | Frontend URL | Backend URL | Purpose |
|------------|-------------|-------------|----------|
| Development | http://localhost:3000 | http://localhost:4000 | Local development |
| Staging | https://staging.ipodhan.com | https://staging-api.ipodhan.com | Pre-production testing |
| Production | https://ipodhan.com | https://api.ipodhan.com | Live environment |
