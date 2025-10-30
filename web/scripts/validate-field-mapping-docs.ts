#!/usr/bin/env tsx

/**
 * Field Mapping Documentation Validation Script
 *
 * Validates the split field mapping documentation for consistency, completeness,
 * and accuracy. Checks cross-references, metadata, and coverage metrics.
 *
 * Usage:
 *   npx tsx web/scripts/validate-field-mapping-docs.ts
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - Validation failures found
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import * as schema from '@ipodhan/shared/db/schema';

// ====================  CONFIGURATION ====================

const DOCS_DIR = join(process.cwd(), 'docs', '16-database');

const EXPECTED_FILES = [
  'screen-database-mapping-index.md',
  'screen-database-mapping-core-ipo.md',
  'screen-database-mapping-financials.md',
  'screen-database-mapping-subscription-gmp.md',
  'screen-database-mapping-content.md',
  'screen-database-mapping-utilities.md',
  'database-schema-scraper-mapping.md',
  'screen-table-database-field-mapping.md', // Original (kept for backward compatibility)
];

const SCHEMA_TABLES = {
  ipos: 54,
  subscriptions: 16,
  gmpRecords: 9,
  financialData: 28,
  documents: 13,
  listingPerformance: 14,
  marketHolidays: 8,
  registrars: 11,
  peerCompanies: 13,
  brokerAffiliates: 8,
  affiliateClicks: 6,
  scraperLogs: 9,
  ipoReviews: 14,
  ipoScores: 11,
  ipoFinancials: 14,
  ipoDetails: 28,
  anchorInvestors: 10,
  fieldProtectionMetadata: 11,
  adminSettings: 5,
  auditLogs: 15,
};

const REQUIRED_METADATA_FIELDS = [
  'Last Updated',
  'Schema Version',
  'Documentation Version',
  'Part',
];

// ====================  TYPES ====================

interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
}

interface FileValidation {
  fileName: string;
  exists: boolean;
  hasMetadata: boolean;
  metadataErrors: string[];
  crossRefErrors: string[];
  tablesCovered: string[];
  missingTables: string[];
}

// ====================  VALIDATORS ====================

class DocumentationValidator {
  private results: ValidationResult = {
    passed: true,
    errors: [],
    warnings: [],
    info: [],
  };

  private fileValidations: FileValidation[] = [];

  /**
   * Main validation orchestrator
   */
  async validate(): Promise<ValidationResult> {
    console.log('🔍 Starting field mapping documentation validation...\n');

    this.validateFileExistence();
    this.validateMetadataHeaders();
    this.validateCrossReferences();
    this.validateTableCoverage();
    this.validateSchemaConsistency();

    this.printResults();

    return this.results;
  }

  /**
   * Check that all expected documentation files exist
   */
  private validateFileExistence(): void {
    console.log('📂 Validating file existence...');

    EXPECTED_FILES.forEach((fileName) => {
      const filePath = join(DOCS_DIR, fileName);
      const exists = existsSync(filePath);

      if (exists) {
        this.results.info.push(`✅ File exists: ${fileName}`);
      } else {
        this.results.errors.push(`❌ Missing file: ${fileName}`);
        this.results.passed = false;
      }

      this.fileValidations.push({
        fileName,
        exists,
        hasMetadata: false,
        metadataErrors: [],
        crossRefErrors: [],
        tablesCovered: [],
        missingTables: [],
      });
    });

    console.log(`   Found ${EXPECTED_FILES.filter(f => existsSync(join(DOCS_DIR, f))).length}/${EXPECTED_FILES.length} expected files\n`);
  }

  /**
   * Validate metadata headers in each file
   */
  private validateMetadataHeaders(): void {
    console.log('📋 Validating metadata headers...');

    this.fileValidations.forEach((validation) => {
      if (!validation.exists) return;

      const filePath = join(DOCS_DIR, validation.fileName);
      const content = readFileSync(filePath, 'utf-8');

      // Check for metadata fields
      REQUIRED_METADATA_FIELDS.forEach((field) => {
        const pattern = new RegExp(`\\*\\*${field}:\\*\\*`, 'i');
        if (!pattern.test(content)) {
          validation.metadataErrors.push(`Missing metadata: ${field}`);
          this.results.warnings.push(`⚠️  ${validation.fileName}: Missing ${field}`);
        }
      });

      validation.hasMetadata = validation.metadataErrors.length === 0;

      if (validation.hasMetadata) {
        this.results.info.push(`✅ ${validation.fileName}: All metadata present`);
      }
    });

    console.log(`   ${this.fileValidations.filter(v => v.hasMetadata).length}/${this.fileValidations.filter(v => v.exists).length} files have complete metadata\n`);
  }

  /**
   * Validate cross-references between files
   */
  private validateCrossReferences(): void {
    console.log('🔗 Validating cross-references...');

    const crossRefPattern = /\[(.*?)\]\((.*?\.md)(#.*?)?\)/g;
    let totalRefs = 0;
    let brokenRefs = 0;

    this.fileValidations.forEach((validation) => {
      if (!validation.exists) return;

      const filePath = join(DOCS_DIR, validation.fileName);
      const content = readFileSync(filePath, 'utf-8');
      const matches = Array.from(content.matchAll(crossRefPattern));

      matches.forEach((match) => {
        const referencedFile = match[2];
        totalRefs++;

        // Check if referenced file exists
        const refPath = join(DOCS_DIR, referencedFile);
        if (!existsSync(refPath)) {
          const error = `Broken link to ${referencedFile}`;
          validation.crossRefErrors.push(error);
          this.results.errors.push(`❌ ${validation.fileName}: ${error}`);
          this.results.passed = false;
          brokenRefs++;
        }
      });
    });

    if (brokenRefs === 0) {
      this.results.info.push(`✅ All ${totalRefs} cross-references valid`);
    } else {
      this.results.errors.push(`❌ Found ${brokenRefs}/${totalRefs} broken cross-references`);
    }

    console.log(`   Checked ${totalRefs} cross-references, ${brokenRefs} broken\n`);
  }

  /**
   * Validate table coverage across documentation
   */
  private validateTableCoverage(): void {
    console.log('📊 Validating table coverage...');

    const tableDocumentationMap: Record<string, string[]> = {
      'screen-database-mapping-core-ipo.md': ['ipos'],
      'screen-database-mapping-financials.md': ['financialData', 'listingPerformance', 'peerCompanies', 'ipoFinancials'],
      'screen-database-mapping-subscription-gmp.md': ['subscriptions', 'gmpRecords'],
      'screen-database-mapping-content.md': ['documents', 'ipoReviews'],
      'screen-database-mapping-utilities.md': ['marketHolidays', 'registrars', 'brokerAffiliates'],
      'database-schema-scraper-mapping.md': Object.keys(SCHEMA_TABLES), // Covers all tables
    };

    const allDocumentedTables = new Set<string>();

    Object.entries(tableDocumentationMap).forEach(([fileName, tables]) => {
      const validation = this.fileValidations.find(v => v.fileName === fileName);
      if (!validation || !validation.exists) return;

      const filePath = join(DOCS_DIR, fileName);
      const content = readFileSync(filePath, 'utf-8');

      tables.forEach((tableName) => {
        // Check if table is mentioned in the file
        const patterns = [
          new RegExp(`\\b${tableName}\\b`, 'i'),
          new RegExp(`\`${tableName}\``, 'i'),
          new RegExp(`## .*${tableName}`, 'i'),
        ];

        const isCovered = patterns.some(pattern => pattern.test(content));

        if (isCovered) {
          validation.tablesCovered.push(tableName);
          allDocumentedTables.add(tableName);
        } else {
          validation.missingTables.push(tableName);
          this.results.warnings.push(`⚠️  ${fileName}: Missing documentation for table '${tableName}'`);
        }
      });
    });

    // Check for undocumented tables
    const schemaTables = Object.keys(SCHEMA_TABLES);
    const undocumented = schemaTables.filter(table => !allDocumentedTables.has(table));

    if (undocumented.length > 0) {
      this.results.warnings.push(`⚠️  Undocumented tables: ${undocumented.join(', ')}`);
    } else {
      this.results.info.push(`✅ All ${schemaTables.length} tables documented`);
    }

    console.log(`   ${allDocumentedTables.size}/${schemaTables.length} tables documented\n`);
  }

  /**
   * Validate schema consistency with documentation
   */
  private validateSchemaConsistency(): void {
    console.log('🔧 Validating schema consistency...');

    // Check that documented field counts match schema
    const schemaFieldCounts = SCHEMA_TABLES;
    let mismatchCount = 0;

    this.fileValidations.forEach((validation) => {
      if (!validation.exists) return;

      const filePath = join(DOCS_DIR, validation.fileName);
      const content = readFileSync(filePath, 'utf-8');

      Object.entries(schemaFieldCounts).forEach(([tableName, expectedCount]) => {
        // Look for field count mentions
        const fieldCountPattern = new RegExp(`${tableName}.*?(\\d+)\\s+fields?`, 'gi');
        const matches = Array.from(content.matchAll(fieldCountPattern));

        matches.forEach((match) => {
          const documentedCount = parseInt(match[1], 10);
          if (documentedCount !== expectedCount) {
            const error = `Field count mismatch for ${tableName}: documented ${documentedCount}, expected ${expectedCount}`;
            this.results.warnings.push(`⚠️  ${validation.fileName}: ${error}`);
            mismatchCount++;
          }
        });
      });
    });

    if (mismatchCount === 0) {
      this.results.info.push(`✅ Schema field counts consistent with documentation`);
    } else {
      this.results.warnings.push(`⚠️  Found ${mismatchCount} field count mismatches`);
    }

    console.log(`   ${mismatchCount} field count mismatches found\n`);
  }

  /**
   * Print validation results summary
   */
  private printResults(): void {
    console.log('\n' + '='.repeat(60));
    console.log('📝 VALIDATION RESULTS SUMMARY');
    console.log('='.repeat(60) + '\n');

    console.log(`✅ Passed: ${this.results.info.length}`);
    console.log(`⚠️  Warnings: ${this.results.warnings.length}`);
    console.log(`❌ Errors: ${this.results.errors.length}\n`);

    if (this.results.errors.length > 0) {
      console.log('❌ ERRORS:\n');
      this.results.errors.forEach((error) => console.log(`   ${error}`));
      console.log('');
    }

    if (this.results.warnings.length > 0) {
      console.log('⚠️  WARNINGS:\n');
      this.results.warnings.forEach((warning) => console.log(`   ${warning}`));
      console.log('');
    }

    if (this.results.info.length > 0 && this.results.errors.length === 0 && this.results.warnings.length === 0) {
      console.log('✅ INFO:\n');
      this.results.info.slice(0, 10).forEach((info) => console.log(`   ${info}`));
      if (this.results.info.length > 10) {
        console.log(`   ... and ${this.results.info.length - 10} more\n`);
      } else {
        console.log('');
      }
    }

    console.log('='.repeat(60));
    if (this.results.passed && this.results.errors.length === 0) {
      console.log('✅ ALL VALIDATIONS PASSED');
    } else {
      console.log('❌ VALIDATION FAILED');
    }
    console.log('='.repeat(60) + '\n');
  }
}

// ====================  MAIN ====================

async function main() {
  const validator = new DocumentationValidator();
  const results = await validator.validate();

  // Exit with appropriate code
  if (!results.passed || results.errors.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error during validation:', error);
  process.exit(1);
});
