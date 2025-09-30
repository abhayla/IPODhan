# Dependency Management Strategy

## Automated Dependency Updates

```yaml
# .github/dependabot.yml
version: 2
updates:
  # Frontend dependencies
  - package-ecosystem: "npm"
    directory: "/ipodhan-web"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "04:00"
    open-pull-requests-limit: 10
    reviewers:
      - "ipodhan/frontend-team"
    labels:
      - "dependencies"
      - "frontend"
    groups:
      production:
        patterns:
          - "*"
        exclude-patterns:
          - "@types/*"
          - "eslint*"
          - "prettier"
      dev:
        patterns:
          - "@types/*"
          - "eslint*"
          - "prettier"
          - "jest"

  # Backend dependencies
  - package-ecosystem: "npm"
    directory: "/ipodhan-backend"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "04:00"
    open-pull-requests-limit: 10
    reviewers:
      - "ipodhan/backend-team"
    labels:
      - "dependencies"
      - "backend"

  # Python dependencies
  - package-ecosystem: "pip"
    directory: "/ipodhan-data-pipeline"
    schedule:
      interval: "weekly"
    reviewers:
      - "ipodhan/data-team"

  # Docker dependencies
  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
    reviewers:
      - "ipodhan/devops-team"

  # GitHub Actions
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

## Dependency Audit and Security

```json
// package.json scripts
{
  "scripts": {
    "audit": "npm audit --production",
    "audit:fix": "npm audit fix --production",
    "deps:check": "npm-check-updates",
    "deps:update": "npm-check-updates -u && npm install",
    "deps:validate": "npm ls --depth=0",
    "security:check": "snyk test"
  }
}
```

```yaml
# .github/workflows/security.yml
name: Security Audit

on:
  schedule:
    - cron: '0 0 * * *' # Daily at midnight
  push:
    branches: [main]
  pull_request:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Run npm audit
        run: |
          cd ipodhan-web && npm audit --production
          cd ../ipodhan-backend && npm audit --production

      - name: Run Snyk Security Scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          format: 'sarif'
          output: 'trivy-results.sarif'

      - name: Upload Trivy results to GitHub Security
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: 'trivy-results.sarif'
```

## Dependency Version Pinning Strategy

```javascript
// .npmrc
save-exact=true
package-lock=true
audit-level=moderate

// For production dependencies: exact versions
// For dev dependencies: minor version flexibility
```

```json
// package.json
{
  "dependencies": {
    "next": "14.0.4", // Exact for framework
    "react": "18.2.0", // Exact for core libraries
    "express": "4.18.2", // Exact for production
    "@ipodhan/shared": "workspace:1.0.0" // Exact for internal
  },
  "devDependencies": {
    "@types/react": "^18.2.0", // Minor updates for types
    "eslint": "^8.50.0", // Minor updates for tools
    "vitest": "^1.0.0" // Minor updates for testing
  }
}
```
