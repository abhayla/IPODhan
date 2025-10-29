/**
 * NSE Scraper Validation Script V2
 * Fixed timezone issue - queries last 1 hour instead of 5 minutes
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Client } = pkg;
import * as schema from '@ipodhan/shared/db/schema';

interface ValidationIssue {
  field: string;
  issue: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

interface IPOValidation {
  ipoId: string;
  companyName: string;
  slug: string;
  status: string;
  issues: ValidationIssue[];
  completenessScore: number;
  missingFields: string[];
  logicalIssues: string[];
}

const FIELD_DEFINITIONS = {
  critical: ['company_name', 'slug', 'status', 'segment', 'lot_size', 'open_date', 'close_date'],
  highPriority: ['price_range_min', 'price_range_max', 'issue_size', 'symbol', 'listing_exchanges'],
  mediumPriority: ['isin', 'sector', 'face_value', 'allotment_date', 'listing_date', 'registrar_id'],
  lowPriority: ['rating', 'company_description', 'website', 'lead_managers']
};

async function validateIPOs() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:***REMOVED-CREDENTIAL***@103.118.16.189:5432/ipodhan'
  });

  try {
    await client.connect();
    console.log('✅ Connected to VPS Production Database\n');

    // Query recently scraped IPOs (last 1 hour to account for timezone)
    const result = await client.query(`
      SELECT * FROM ipos
      WHERE last_scraped_at >= NOW() - INTERVAL '1 hour'
      ORDER BY last_scraped_at DESC, updated_at DESC
    `);

    const ipos = result.rows;
    console.log(`📊 Found ${ipos.length} IPOs scraped in the last hour\n`);

    if (ipos.length === 0) {
      console.log('⚠️  No recently scraped IPOs found. Showing most recent 15 IPOs instead...\n');
      const fallbackResult = await client.query(`
        SELECT * FROM ipos
        ORDER BY updated_at DESC
        LIMIT 15
      `);
      ipos.push(...fallbackResult.rows);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const validations: IPOValidation[] = [];

    for (const ipo of ipos) {
      const validation: IPOValidation = {
        ipoId: ipo.id,
        companyName: ipo.company_name,
        slug: ipo.slug,
        status: ipo.status || 'UNKNOWN',
        issues: [],
        completenessScore: 0,
        missingFields: [],
        logicalIssues: []
      };

      // Check critical fields
      for (const field of FIELD_DEFINITIONS.critical) {
        const value = ipo[field];
        if (value === null || value === undefined || value === '') {
          validation.issues.push({
            field,
            issue: `Missing ${field}`,
            severity: 'CRITICAL'
          });
          validation.missingFields.push(field);
        }
      }

      // Special validation for lot_size (should not be 1)
      if (ipo.lot_size === 1) {
        validation.issues.push({
          field: 'lot_size',
          issue: 'lot_size = 1 (likely invalid default value)',
          severity: 'CRITICAL'
        });
      }

      // Special validation for segment (should not be null for standard IPOs)
      if (ipo.segment === null && ipo.offering_type !== 'RIGHTS') {
        validation.issues.push({
          field: 'segment',
          issue: 'segment is NULL (cannot categorize as MAINBOARD/SME)',
          severity: 'CRITICAL'
        });
      }

      // Check high priority fields
      for (const field of FIELD_DEFINITIONS.highPriority) {
        const value = ipo[field];
        if (value === null || value === undefined || value === '') {
          validation.issues.push({
            field,
            issue: `Missing ${field}`,
            severity: 'HIGH'
          });
          validation.missingFields.push(field);
        }
      }

      // Check medium priority fields
      for (const field of FIELD_DEFINITIONS.mediumPriority) {
        const value = ipo[field];
        if (value === null || value === undefined || value === '') {
          validation.issues.push({
            field,
            issue: `Missing ${field}`,
            severity: 'MEDIUM'
          });
          validation.missingFields.push(field);
        }
      }

      // Check low priority fields
      for (const field of FIELD_DEFINITIONS.lowPriority) {
        const value = ipo[field];
        if (value === null || value === undefined || value === '') {
          validation.issues.push({
            field,
            issue: `Missing ${field}`,
            severity: 'LOW'
          });
          validation.missingFields.push(field);
        }
      }

      // Logical consistency checks
      if (ipo.open_date && ipo.close_date) {
        const openDate = new Date(ipo.open_date);
        const closeDate = new Date(ipo.close_date);
        if (openDate > closeDate) {
          validation.issues.push({
            field: 'open_date, close_date',
            issue: `open_date (${ipo.open_date}) is after close_date (${ipo.close_date})`,
            severity: 'HIGH'
          });
          validation.logicalIssues.push('Date order inconsistency');
        }

        // Same day open/close check
        const openDateStr = openDate.toDateString();
        const closeDateStr = closeDate.toDateString();
        if (openDateStr === closeDateStr) {
          validation.issues.push({
            field: 'open_date, close_date',
            issue: 'Same-day open and close (unusual pattern)',
            severity: 'MEDIUM'
          });
          validation.logicalIssues.push('Same-day offering');
        }
      }

      // Price range validation
      if (ipo.price_range_min && ipo.price_range_max) {
        if (parseFloat(ipo.price_range_min) > parseFloat(ipo.price_range_max)) {
          validation.issues.push({
            field: 'price_range_min, price_range_max',
            issue: `price_range_min (${ipo.price_range_min}) > price_range_max (${ipo.price_range_max})`,
            severity: 'HIGH'
          });
          validation.logicalIssues.push('Price range inconsistency');
        }
      }

      // Negative number checks
      const numericFields = ['lot_size', 'price_range_min', 'price_range_max', 'issue_size', 'face_value'];
      for (const field of numericFields) {
        const value = ipo[field];
        if (value !== null && value !== undefined && parseFloat(value) < 0) {
          validation.issues.push({
            field,
            issue: `${field} is negative (${value})`,
            severity: 'HIGH'
          });
          validation.logicalIssues.push(`Negative ${field}`);
        }
      }

      // Calculate completeness score
      const totalFields = FIELD_DEFINITIONS.critical.length +
                         FIELD_DEFINITIONS.highPriority.length +
                         FIELD_DEFINITIONS.mediumPriority.length +
                         FIELD_DEFINITIONS.lowPriority.length;
      const missingCount = validation.missingFields.length;
      validation.completenessScore = Math.round(((totalFields - missingCount) / totalFields) * 100);

      validations.push(validation);
    }

    // Print results
    printValidationResults(validations, ipos);

    await client.end();
    console.log('\n✅ Validation completed successfully\n');

    return { validations, ipos };

  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }
}

function printValidationResults(validations: IPOValidation[], ipos: any[]) {
  console.log('📋 COMPREHENSIVE VALIDATION REPORT\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const totalIPOs = validations.length;
  const avgCompletenessScore = totalIPOs > 0 ? Math.round(
    validations.reduce((sum, v) => sum + v.completenessScore, 0) / totalIPOs
  ) : 0;
  const criticalIssues = validations.reduce((sum, v) =>
    sum + v.issues.filter(i => i.severity === 'CRITICAL').length, 0
  );
  const highIssues = validations.reduce((sum, v) =>
    sum + v.issues.filter(i => i.severity === 'HIGH').length, 0
  );
  const mediumIssues = validations.reduce((sum, v) =>
    sum + v.issues.filter(i => i.severity === 'MEDIUM').length, 0
  );
  const lowIssues = validations.reduce((sum, v) =>
    sum + v.issues.filter(i => i.severity === 'LOW').length, 0
  );

  console.log('📊 SUMMARY STATISTICS');
  console.log('───────────────────────────────────────────────────────────────────────────────');
  console.log(`Total IPOs Validated:         ${totalIPOs}`);
  console.log(`Average Completeness Score:   ${avgCompletenessScore}%`);
  console.log(`Total Issues Found:           ${criticalIssues + highIssues + mediumIssues + lowIssues}`);
  console.log(`  - CRITICAL:                 ${criticalIssues}`);
  console.log(`  - HIGH:                     ${highIssues}`);
  console.log(`  - MEDIUM:                   ${mediumIssues}`);
  console.log(`  - LOW:                      ${lowIssues}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('🔍 INDIVIDUAL IPO VALIDATION RESULTS\n');

  for (let i = 0; i < validations.length; i++) {
    const v = validations[i];
    const ipo = ipos[i];

    console.log(`${i + 1}. ${v.companyName}`);
    console.log('   ─────────────────────────────────────────────────────────────────────────');
    console.log(`   Slug:                ${v.slug}`);
    console.log(`   Status:              ${v.status}`);
    console.log(`   Last Scraped:        ${ipo.last_scraped_at || 'N/A'}`);
    console.log(`   Updated At:          ${ipo.updated_at || 'N/A'}`);
    console.log(`   Completeness Score:  ${v.completenessScore}% ${v.completenessScore >= 80 ? '✅' : v.completenessScore >= 50 ? '⚠️' : '❌'}`);
    console.log(`   Issues Found:        ${v.issues.length}`);

    if (v.issues.length > 0) {
      console.log('\n   Issues:');
      const criticalIssues = v.issues.filter(i => i.severity === 'CRITICAL');
      const highIssues = v.issues.filter(i => i.severity === 'HIGH');
      const mediumIssues = v.issues.filter(i => i.severity === 'MEDIUM');
      const lowIssues = v.issues.filter(i => i.severity === 'LOW');

      if (criticalIssues.length > 0) {
        console.log('\n   🔴 CRITICAL:');
        criticalIssues.forEach(issue => {
          console.log(`      - ${issue.field}: ${issue.issue}`);
        });
      }

      if (highIssues.length > 0) {
        console.log('\n   🟠 HIGH:');
        highIssues.forEach(issue => {
          console.log(`      - ${issue.field}: ${issue.issue}`);
        });
      }

      if (mediumIssues.length > 0) {
        console.log('\n   🟡 MEDIUM:');
        mediumIssues.forEach(issue => {
          console.log(`      - ${issue.field}: ${issue.issue}`);
        });
      }

      if (lowIssues.length > 0) {
        console.log('\n   🔵 LOW:');
        lowIssues.forEach(issue => {
          console.log(`      - ${issue.field}: ${issue.issue}`);
        });
      }
    } else {
      console.log('   ✅ No issues found!');
    }

    // Show populated fields
    console.log('\n   ✅ Populated Fields:');
    const populatedFields = [];
    if (ipo.company_name) populatedFields.push('company_name');
    if (ipo.slug) populatedFields.push('slug');
    if (ipo.status) populatedFields.push('status');
    if (ipo.segment) populatedFields.push('segment');
    if (ipo.lot_size && ipo.lot_size !== 1) populatedFields.push('lot_size');
    if (ipo.open_date) populatedFields.push('open_date');
    if (ipo.close_date) populatedFields.push('close_date');
    if (ipo.price_range_min) populatedFields.push('price_range_min');
    if (ipo.price_range_max) populatedFields.push('price_range_max');
    if (ipo.issue_size) populatedFields.push('issue_size');
    if (ipo.symbol) populatedFields.push('symbol');
    if (ipo.isin) populatedFields.push('isin');
    if (ipo.sector) populatedFields.push('sector');
    if (ipo.listing_exchanges) populatedFields.push('listing_exchanges');
    if (ipo.allotment_date) populatedFields.push('allotment_date');
    if (ipo.listing_date) populatedFields.push('listing_date');

    console.log(`      ${populatedFields.join(', ') || 'None'}`);

    // Show key field values
    console.log('\n   📝 Key Values:');
    console.log(`      Segment: ${ipo.segment || 'NULL'}`);
    console.log(`      Lot Size: ${ipo.lot_size || 'NULL'}`);
    console.log(`      Price Range: ${ipo.price_range_min || 'NULL'} - ${ipo.price_range_max || 'NULL'}`);
    console.log(`      Issue Size: ${ipo.issue_size ? `₹${ipo.issue_size} Cr` : 'NULL'}`);
    console.log(`      Open Date: ${ipo.open_date || 'NULL'}`);
    console.log(`      Close Date: ${ipo.close_date || 'NULL'}`);

    console.log('\n');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

validateIPOs().catch(console.error);
