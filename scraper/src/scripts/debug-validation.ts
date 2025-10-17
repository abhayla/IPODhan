import { scrapeBSEIPOs } from '../scrapers/bse-scraper.js';
import { validateIPOData } from '../utils/validators.js';
import logger from '../utils/logger.js';

async function debugValidation() {
  try {
    const { ipos } = await scrapeBSEIPOs();

    console.log(`\nTotal IPOs scraped: ${ipos.length}\n`);

    // Test first 3 IPOs
    for (let i = 0; i < Math.min(3, ipos.length); i++) {
      const ipo = ipos[i];
      console.log(`\n--- IPO ${i + 1}: ${ipo.companyName} ---`);
      console.log('Raw Data:');
      console.log(JSON.stringify(ipo, null, 2));

      const validation = validateIPOData(ipo);
      console.log('\nValidation Result:');
      console.log('Success:', validation.success);

      if (!validation.success && validation.error) {
        console.log('\nValidation Errors:');
        validation.error.issues.forEach((issue: any) => {
          console.log(`  - ${issue.path.join('.')}: ${issue.message}`);
        });
      }
    }

  } catch (error) {
    logger.error({ error }, 'Debug validation failed');
  }
}

debugValidation();
