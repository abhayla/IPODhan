/**
 * Anonymize Old Audit Log IP Addresses
 *
 * Anonymizes IP addresses in audit_logs older than 90 days for PII compliance.
 * Run this script daily via cron job.
 *
 * Usage:
 *   npx tsx scripts/anonymize-audit-ips.ts
 *
 * Cron Schedule (daily at midnight):
 *   0 0 * * * cd /path/to/web && npx tsx scripts/anonymize-audit-ips.ts
 */

import { anonymizeOldIPAddresses } from '@/lib/services/audit-log-service';

async function main() {
  console.log('[Anonymize IPs] Starting IP anonymization...');
  console.log('[Anonymize IPs] Target: Audit logs older than 90 days');

  try {
    const count = await anonymizeOldIPAddresses();

    if (count === 0) {
      console.log('[Anonymize IPs] ✓ No IP addresses to anonymize');
    } else {
      console.log(`[Anonymize IPs] ✓ Anonymized ${count} IP addresses`);
    }

    console.log('[Anonymize IPs] Completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[Anonymize IPs] ✗ Failed:', error);
    process.exit(1);
  }
}

main();
