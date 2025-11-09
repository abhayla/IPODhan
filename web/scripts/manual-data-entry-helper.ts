/**
 * Manual Data Entry Helper - Priority 2
 *
 * Interactive CLI tool to help manually enter missing lot_size and price_band data.
 * Supports:
 * - Interactive mode: Prompts for each IPO
 * - CSV import mode: Bulk import from completed worksheet
 * - Single IPO update mode: Update specific IPO by ID
 *
 * Usage:
 *   npm run manual-entry                    # Interactive mode
 *   npm run manual-entry -- --csv           # Import from CSV
 *   npm run manual-entry -- --id <id>       # Update single IPO
 */

import { db } from '@/lib/db/index';
import { ipos } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

interface ManualEntry {
  ipoId: string;
  companyName: string;
  lotSize?: number;
  priceRangeMin?: number;
  priceRangeMax?: number;
  notes?: string;
}

interface UpdateResult {
  success: boolean;
  ipoId: string;
  companyName: string;
  fieldsUpdated: string[];
  error?: string;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function updateIPOData(entry: ManualEntry): Promise<UpdateResult> {
  try {
    const updates: Record<string, any> = {
      updatedAt: new Date(),
    };

    const fieldsUpdated: string[] = [];

    if (entry.lotSize !== undefined) {
      updates.lotSize = entry.lotSize;
      fieldsUpdated.push('lot_size');
    }

    if (entry.priceRangeMin !== undefined) {
      updates.priceRangeMin = entry.priceRangeMin;
      fieldsUpdated.push('price_range_min');
    }

    if (entry.priceRangeMax !== undefined) {
      updates.priceRangeMax = entry.priceRangeMax;
      fieldsUpdated.push('price_range_max');
    }

    if (fieldsUpdated.length === 0) {
      return {
        success: false,
        ipoId: entry.ipoId,
        companyName: entry.companyName,
        fieldsUpdated: [],
        error: 'No fields to update',
      };
    }

    await db
      .update(ipos)
      .set(updates)
      .where(eq(ipos.id, entry.ipoId));

    console.log(`✅ Updated ${entry.companyName} (${fieldsUpdated.join(', ')})`);

    return {
      success: true,
      ipoId: entry.ipoId,
      companyName: entry.companyName,
      fieldsUpdated,
    };
  } catch (error) {
    console.error(`❌ Failed to update ${entry.companyName}:`, error);

    return {
      success: false,
      ipoId: entry.ipoId,
      companyName: entry.companyName,
      fieldsUpdated: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function interactiveMode() {
  console.log('🎯 Interactive Manual Data Entry Mode\n');
  console.log('Enter data for each IPO. Press Ctrl+C to exit.\n');

  // Load missing data report
  const reportPath = path.join(process.cwd(), 'logs', 'missing-data-report.json');

  if (!fs.existsSync(reportPath)) {
    console.error('❌ Missing data report not found.');
    console.error('   Run: npm run identify-missing-data\n');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  const { ipos: missingIPOs } = report;

  console.log(`Found ${missingIPOs.length} IPOs with missing data\n`);

  const results: UpdateResult[] = [];
  let processed = 0;

  for (const ipo of missingIPOs) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`IPO ${++processed} / ${missingIPOs.length}`);
    console.log(`${'='.repeat(80)}\n`);

    console.log(`Company: ${ipo.companyName}`);
    console.log(`Symbol: ${ipo.symbol || 'N/A'}`);
    console.log(`Segment: ${ipo.segment || 'NULL'}`);
    console.log(`Status: ${ipo.status}`);
    console.log(`Open Date: ${ipo.openDate?.split('T')[0] || 'N/A'}`);
    console.log(`Missing Fields: ${ipo.missingFields.join(', ')}\n`);

    console.log(`Current Data:`);
    console.log(`  Lot Size: ${ipo.currentData.lotSize || 'MISSING'}`);
    console.log(`  Price Min: ${ipo.currentData.priceRangeMin || 'MISSING'}`);
    console.log(`  Price Max: ${ipo.currentData.priceRangeMax || 'MISSING'}\n`);

    if (ipo.researchLinks.nse) {
      console.log(`Research Links:`);
      console.log(`  NSE: ${ipo.researchLinks.nse}`);
      console.log(`  BSE: ${ipo.researchLinks.bse}`);
      console.log(`  MC: ${ipo.researchLinks.moneycontrol}\n`);
    }

    const action = await question('Update this IPO? (y/n/s=skip all remaining): ');

    if (action.toLowerCase() === 's') {
      console.log('\n⏭️  Skipping remaining IPOs...');
      break;
    }

    if (action.toLowerCase() !== 'y') {
      console.log('⏭️  Skipped');
      continue;
    }

    const entry: ManualEntry = {
      ipoId: ipo.id,
      companyName: ipo.companyName,
    };

    // Collect lot size if missing
    if (ipo.missingFields.includes('lot_size')) {
      const lotSizeInput = await question('Enter Lot Size (or leave blank to skip): ');
      if (lotSizeInput) {
        const lotSize = parseInt(lotSizeInput, 10);
        if (!isNaN(lotSize) && lotSize > 0) {
          entry.lotSize = lotSize;
        } else {
          console.log('⚠️  Invalid lot size, skipping');
        }
      }
    }

    // Collect price band if missing
    if (ipo.missingFields.includes('price_band')) {
      const priceMinInput = await question('Enter Price Min (or leave blank to skip): ');
      if (priceMinInput) {
        const priceMin = parseFloat(priceMinInput);
        if (!isNaN(priceMin) && priceMin > 0) {
          entry.priceRangeMin = priceMin;
        } else {
          console.log('⚠️  Invalid price min, skipping');
        }
      }

      const priceMaxInput = await question('Enter Price Max (or leave blank to skip): ');
      if (priceMaxInput) {
        const priceMax = parseFloat(priceMaxInput);
        if (!isNaN(priceMax) && priceMax > 0) {
          entry.priceRangeMax = priceMax;
        } else {
          console.log('⚠️  Invalid price max, skipping');
        }
      }
    }

    // Notes (optional)
    const notes = await question('Notes (optional): ');
    if (notes) {
      entry.notes = notes;
    }

    // Update database
    const result = await updateIPOData(entry);
    results.push(result);
  }

  rl.close();

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 Summary');
  console.log(`${'='.repeat(80)}\n`);

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`Total IPOs Processed: ${results.length}`);
  console.log(`Successful Updates: ${successful.length}`);
  console.log(`Failed Updates: ${failed.length}\n`);

  if (failed.length > 0) {
    console.log('Failed Updates:');
    failed.forEach(f => {
      console.log(`  - ${f.companyName}: ${f.error}`);
    });
  }

  // Save results log
  await saveResultsLog(results);

  console.log('\n✅ Manual data entry session complete!\n');
}

async function csvImportMode() {
  console.log('📥 CSV Import Mode\n');

  const csvPath = path.join(process.cwd(), 'logs', 'missing-data-worksheet.csv');

  if (!fs.existsSync(csvPath)) {
    console.error('❌ CSV worksheet not found.');
    console.error('   Run: npm run identify-missing-data\n');
    process.exit(1);
  }

  const csv = fs.readFileSync(csvPath, 'utf-8');
  const lines = csv.split('\n');

  // Skip header
  const dataLines = lines.slice(1).filter(line => line.trim());

  console.log(`Found ${dataLines.length} rows in CSV\n`);

  const results: UpdateResult[] = [];

  for (const line of dataLines) {
    const parts = line.split(',');

    // CSV columns:
    // 0: Priority, 1: Company Name, 2: Symbol, 3: Segment, 4: Status,
    // 5: Open Date, 6: Close Date, 7: Missing Fields,
    // 8: Current Lot Size, 9: Current Price Min, 10: Current Price Max,
    // 11: ISIN, 12: Research NSE, 13: Research BSE, 14: Research MC,
    // 15: Found Lot Size, 16: Found Price Min, 17: Found Price Max, 18: Notes

    const companyName = parts[1]?.replace(/"/g, '').trim();
    const foundLotSize = parts[15]?.trim();
    const foundPriceMin = parts[16]?.trim();
    const foundPriceMax = parts[17]?.trim();

    // Skip if no data entered
    if (!foundLotSize && !foundPriceMin && !foundPriceMax) {
      continue;
    }

    // Find IPO by company name
    const [ipo] = await db
      .select()
      .from(ipos)
      .where(eq(ipos.companyName, companyName))
      .limit(1);

    if (!ipo) {
      console.log(`⚠️  IPO not found: ${companyName}`);
      continue;
    }

    const entry: ManualEntry = {
      ipoId: ipo.id,
      companyName: ipo.companyName,
    };

    if (foundLotSize) {
      const lotSize = parseInt(foundLotSize, 10);
      if (!isNaN(lotSize) && lotSize > 0) {
        entry.lotSize = lotSize;
      }
    }

    if (foundPriceMin) {
      const priceMin = parseFloat(foundPriceMin);
      if (!isNaN(priceMin) && priceMin > 0) {
        entry.priceRangeMin = priceMin;
      }
    }

    if (foundPriceMax) {
      const priceMax = parseFloat(foundPriceMax);
      if (!isNaN(priceMax) && priceMax > 0) {
        entry.priceRangeMax = priceMax;
      }
    }

    const result = await updateIPOData(entry);
    results.push(result);
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 Summary');
  console.log(`${'='.repeat(80)}\n`);

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`Total IPOs Processed: ${results.length}`);
  console.log(`Successful Updates: ${successful.length}`);
  console.log(`Failed Updates: ${failed.length}\n`);

  // Save results log
  await saveResultsLog(results);

  console.log('\n✅ CSV import complete!\n');
}

async function saveResultsLog(results: UpdateResult[]) {
  const logsDir = path.join(process.cwd(), 'logs');
  const logPath = path.join(logsDir, 'manual-entry-results.json');

  const log = {
    timestamp: new Date().toISOString(),
    totalProcessed: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  };

  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), 'utf-8');
  console.log(`📄 Results log saved: ${logPath}`);
}

async function singleIPOMode(ipoId: string) {
  console.log(`🎯 Single IPO Update Mode\n`);

  const [ipo] = await db
    .select()
    .from(ipos)
    .where(eq(ipos.id, ipoId))
    .limit(1);

  if (!ipo) {
    console.error(`❌ IPO not found: ${ipoId}\n`);
    process.exit(1);
  }

  console.log(`Company: ${ipo.companyName}`);
  console.log(`Symbol: ${ipo.symbol || 'N/A'}`);
  console.log(`Segment: ${ipo.segment || 'NULL'}`);
  console.log(`Status: ${ipo.status}\n`);

  console.log(`Current Data:`);
  console.log(`  Lot Size: ${ipo.lotSize || 'MISSING'}`);
  console.log(`  Price Min: ${ipo.priceRangeMin || 'MISSING'}`);
  console.log(`  Price Max: ${ipo.priceRangeMax || 'MISSING'}\n`);

  const entry: ManualEntry = {
    ipoId: ipo.id,
    companyName: ipo.companyName,
  };

  const lotSizeInput = await question('Enter Lot Size (or leave blank to skip): ');
  if (lotSizeInput) {
    const lotSize = parseInt(lotSizeInput, 10);
    if (!isNaN(lotSize) && lotSize > 0) {
      entry.lotSize = lotSize;
    }
  }

  const priceMinInput = await question('Enter Price Min (or leave blank to skip): ');
  if (priceMinInput) {
    const priceMin = parseFloat(priceMinInput);
    if (!isNaN(priceMin) && priceMin > 0) {
      entry.priceRangeMin = priceMin;
    }
  }

  const priceMaxInput = await question('Enter Price Max (or leave blank to skip): ');
  if (priceMaxInput) {
    const priceMax = parseFloat(priceMaxInput);
    if (!isNaN(priceMax) && priceMax > 0) {
      entry.priceRangeMax = priceMax;
    }
  }

  rl.close();

  const result = await updateIPOData(entry);

  if (result.success) {
    console.log(`\n✅ Successfully updated ${result.companyName}\n`);
  } else {
    console.log(`\n❌ Failed to update: ${result.error}\n`);
    process.exit(1);
  }
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--csv')) {
    await csvImportMode();
  } else if (args.includes('--id')) {
    const idIndex = args.indexOf('--id');
    const ipoId = args[idIndex + 1];
    if (!ipoId) {
      console.error('❌ Please provide an IPO ID: --id <id>\n');
      process.exit(1);
    }
    await singleIPOMode(ipoId);
  } else {
    await interactiveMode();
  }

  process.exit(0);
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
}

export { updateIPOData, interactiveMode, csvImportMode, singleIPOMode };
