#!/usr/bin/env tsx

/**
 * Sentry Setup Validation Script
 *
 * Validates that Sentry is properly configured and ready for production.
 *
 * Usage:
 *   npm run validate:sentry
 *   or
 *   tsx scripts/validate-sentry-setup.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

interface ValidationResult {
  passed: boolean;
  message: string;
  details?: string;
}

class SentryValidator {
  private results: ValidationResult[] = [];
  private warnings: string[] = [];

  /**
   * Main validation runner
   */
  async validate(): Promise<void> {
    console.log(`\n${colors.cyan}╔════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.cyan}║   Sentry Setup Validation                 ║${colors.reset}`);
    console.log(`${colors.cyan}╚════════════════════════════════════════════╝${colors.reset}\n`);

    // Run validation checks
    this.checkConfigFiles();
    this.checkUtilityFiles();
    this.checkEnvironmentVariables();
    this.checkNextConfig();
    this.checkTestEndpoint();
    this.checkDocumentation();
    this.checkPackageJson();

    // Print results
    this.printResults();
  }

  /**
   * Check if Sentry configuration files exist
   */
  private checkConfigFiles(): void {
    console.log(`${colors.blue}Checking Sentry configuration files...${colors.reset}`);

    const configFiles = [
      'sentry.client.config.ts',
      'sentry.server.config.ts',
      'sentry.edge.config.ts',
    ];

    configFiles.forEach((file) => {
      const filePath = path.join(process.cwd(), file);
      const exists = fs.existsSync(filePath);

      this.results.push({
        passed: exists,
        message: `Configuration file: ${file}`,
        details: exists ? 'Found' : 'Missing',
      });

      if (exists) {
        // Check file content
        const content = fs.readFileSync(filePath, 'utf-8');
        const hasInit = content.includes('Sentry.init');
        const hasDSN = content.includes('NEXT_PUBLIC_SENTRY_DSN');

        this.results.push({
          passed: hasInit && hasDSN,
          message: `  └─ Sentry.init() present in ${file}`,
          details: hasInit && hasDSN ? 'Valid' : 'Invalid configuration',
        });
      }
    });
  }

  /**
   * Check if utility files exist and are valid
   */
  private checkUtilityFiles(): void {
    console.log(`\n${colors.blue}Checking Sentry utility files...${colors.reset}`);

    const utilityFiles = [
      {
        path: 'lib/monitoring/sentry-utils.ts',
        requiredFunctions: [
          'captureAPIError',
          'trackPerformance',
          'addBreadcrumb',
          'captureDatabaseError',
          'captureCacheError',
          'captureScraperError',
        ],
      },
      {
        path: 'lib/monitoring/README.md',
        requiredFunctions: [],
      },
      {
        path: 'lib/monitoring/QUICK_START.md',
        requiredFunctions: [],
      },
    ];

    utilityFiles.forEach(({ path: filePath, requiredFunctions }) => {
      const fullPath = path.join(process.cwd(), filePath);
      const exists = fs.existsSync(fullPath);

      this.results.push({
        passed: exists,
        message: `Utility file: ${filePath}`,
        details: exists ? 'Found' : 'Missing',
      });

      if (exists && requiredFunctions.length > 0) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const missingFunctions = requiredFunctions.filter(
          (fn) => !content.includes(`export function ${fn}`)
        );

        if (missingFunctions.length > 0) {
          this.results.push({
            passed: false,
            message: `  └─ Missing functions in ${filePath}`,
            details: missingFunctions.join(', '),
          });
        } else {
          this.results.push({
            passed: true,
            message: `  └─ All required functions present`,
            details: `${requiredFunctions.length} functions found`,
          });
        }
      }
    });
  }

  /**
   * Check environment variables
   */
  private checkEnvironmentVariables(): void {
    console.log(`\n${colors.blue}Checking environment variables...${colors.reset}`);

    const envPath = path.join(process.cwd(), '.env.local');
    const envExists = fs.existsSync(envPath);

    this.results.push({
      passed: envExists,
      message: 'Environment file: .env.local',
      details: envExists ? 'Found' : 'Missing',
    });

    if (envExists) {
      const envContent = fs.readFileSync(envPath, 'utf-8');

      const requiredVars = [
        'NEXT_PUBLIC_SENTRY_DSN',
        'SENTRY_AUTH_TOKEN',
        'SENTRY_ORG',
        'SENTRY_PROJECT',
      ];

      requiredVars.forEach((varName) => {
        const hasVar = envContent.includes(varName);
        const isConfigured =
          hasVar && !envContent.includes(`${varName}=your_`) &&
          !envContent.includes(`${varName}=https://example`);

        if (hasVar && !isConfigured) {
          this.warnings.push(
            `${varName} is present but not configured (using placeholder value)`
          );
        }

        this.results.push({
          passed: hasVar,
          message: `  └─ Environment variable: ${varName}`,
          details: hasVar
            ? isConfigured
              ? 'Configured'
              : 'Present (placeholder)'
            : 'Missing',
        });
      });
    }
  }

  /**
   * Check Next.js configuration
   */
  private checkNextConfig(): void {
    console.log(`\n${colors.blue}Checking Next.js configuration...${colors.reset}`);

    const nextConfigPath = path.join(process.cwd(), 'next.config.ts');
    const exists = fs.existsSync(nextConfigPath);

    this.results.push({
      passed: exists,
      message: 'Next.js config: next.config.ts',
      details: exists ? 'Found' : 'Missing',
    });

    if (exists) {
      const content = fs.readFileSync(nextConfigPath, 'utf-8');
      const hasSentryImport = content.includes('withSentryConfig');
      const hasSentryExport = content.includes('export default withSentryConfig');

      this.results.push({
        passed: hasSentryImport,
        message: '  └─ Sentry webpack plugin imported',
        details: hasSentryImport ? 'Yes' : 'No',
      });

      this.results.push({
        passed: hasSentryExport,
        message: '  └─ Sentry config applied to export',
        details: hasSentryExport ? 'Yes' : 'No',
      });

      if (content.includes('tunnelRoute')) {
        this.results.push({
          passed: true,
          message: '  └─ Tunnel route configured',
          details: 'Helps bypass ad blockers',
        });
      }
    }
  }

  /**
   * Check test endpoint
   */
  private checkTestEndpoint(): void {
    console.log(`\n${colors.blue}Checking test endpoint...${colors.reset}`);

    const testEndpointPath = path.join(
      process.cwd(),
      'app/api/sentry-test/route.ts'
    );
    const exists = fs.existsSync(testEndpointPath);

    this.results.push({
      passed: exists,
      message: 'Test endpoint: /api/sentry-test',
      details: exists ? 'Found' : 'Missing',
    });

    if (exists) {
      const content = fs.readFileSync(testEndpointPath, 'utf-8');
      const hasTestTypes = [
        'test=all',
        'test=error',
        'test=performance',
        'test=transaction',
      ];

      const implementedTests = hasTestTypes.filter((test) =>
        content.includes(test)
      );

      this.results.push({
        passed: implementedTests.length === hasTestTypes.length,
        message: `  └─ Test scenarios implemented`,
        details: `${implementedTests.length}/${hasTestTypes.length} tests`,
      });
    }
  }

  /**
   * Check documentation
   */
  private checkDocumentation(): void {
    console.log(`\n${colors.blue}Checking documentation...${colors.reset}`);

    const docs = [
      {
        path: 'test-results/pre-launch/sentry-setup-report.md',
        name: 'Setup Report',
      },
      {
        path: 'lib/monitoring/README.md',
        name: 'Monitoring Guide',
      },
      {
        path: 'lib/monitoring/QUICK_START.md',
        name: 'Quick Start Guide',
      },
    ];

    docs.forEach(({ path: docPath, name }) => {
      const fullPath = path.join(process.cwd(), docPath);
      const exists = fs.existsSync(fullPath);

      this.results.push({
        passed: exists,
        message: `Documentation: ${name}`,
        details: exists ? 'Found' : 'Missing',
      });
    });
  }

  /**
   * Check package.json for Sentry dependency
   */
  private checkPackageJson(): void {
    console.log(`\n${colors.blue}Checking package.json...${colors.reset}`);

    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const exists = fs.existsSync(packageJsonPath);

    if (exists) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const hasSentry = packageJson.dependencies?.['@sentry/nextjs'];

      this.results.push({
        passed: !!hasSentry,
        message: 'Sentry package installed',
        details: hasSentry ? `Version ${hasSentry}` : 'Not found',
      });
    }
  }

  /**
   * Print validation results
   */
  private printResults(): void {
    console.log(`\n${colors.cyan}════════════════════════════════════════════${colors.reset}\n`);
    console.log(`${colors.cyan}Validation Results:${colors.reset}\n`);

    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;
    const total = this.results.length;

    this.results.forEach((result) => {
      const icon = result.passed
        ? `${colors.green}✓${colors.reset}`
        : `${colors.red}✗${colors.reset}`;
      const details = result.details ? ` (${result.details})` : '';

      console.log(`${icon} ${result.message}${details}`);
    });

    // Print warnings
    if (this.warnings.length > 0) {
      console.log(`\n${colors.yellow}Warnings:${colors.reset}\n`);
      this.warnings.forEach((warning) => {
        console.log(`${colors.yellow}⚠ ${warning}${colors.reset}`);
      });
    }

    // Print summary
    console.log(`\n${colors.cyan}════════════════════════════════════════════${colors.reset}\n`);
    console.log(`${colors.cyan}Summary:${colors.reset}`);
    console.log(`  Total checks: ${total}`);
    console.log(`  ${colors.green}Passed: ${passed}${colors.reset}`);
    console.log(`  ${colors.red}Failed: ${failed}${colors.reset}`);

    if (this.warnings.length > 0) {
      console.log(`  ${colors.yellow}Warnings: ${this.warnings.length}${colors.reset}`);
    }

    const percentage = ((passed / total) * 100).toFixed(1);
    console.log(`  Coverage: ${percentage}%`);

    console.log(`\n${colors.cyan}════════════════════════════════════════════${colors.reset}\n`);

    // Print next steps
    if (failed > 0 || this.warnings.length > 0) {
      console.log(`${colors.yellow}Next Steps:${colors.reset}\n`);

      if (failed > 0) {
        console.log(`1. Fix failed checks above`);
        console.log(`2. Review setup report: test-results/pre-launch/sentry-setup-report.md`);
      }

      if (this.warnings.length > 0) {
        console.log(`3. Configure Sentry DSN and auth token in .env.local`);
        console.log(`4. Visit https://sentry.io/signup/ to create account`);
        console.log(`5. Get DSN from Sentry project settings`);
      }

      console.log(`\n`);
    } else {
      console.log(`${colors.green}✓ All checks passed!${colors.reset}\n`);
      console.log(`${colors.cyan}Ready for Sentry integration.${colors.reset}\n`);
      console.log(`Next steps:`);
      console.log(`1. Configure DSN in .env.local (if not done)`);
      console.log(`2. Test integration: curl http://localhost:3000/api/sentry-test?test=all`);
      console.log(`3. Check Sentry dashboard for events\n`);
    }

    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
  }
}

// Run validation
const validator = new SentryValidator();
validator.validate();
