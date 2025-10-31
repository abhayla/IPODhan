/**
 * Sector Code Mappings for Moneycontrol
 *
 * Maps IPO sector names to Moneycontrol sector codes for peer company discovery
 */

export const MONEYCONTROL_SECTOR_CODES: Record<string, string> = {
  // Financial Services
  'Banking': '2',
  'Finance': '7',
  'Insurance': '8',
  'NBFC': '7',
  'Financial Services': '7',

  // Technology
  'IT Services': '10',
  'Information Technology': '10',
  'Software': '10',
  'IT Consulting': '10',

  // Consumer
  'FMCG': '41',
  'Consumer Goods': '41',
  'Consumer Durables': '5',
  'Retail': '21',
  'E-Commerce': '21',

  // Healthcare
  'Pharmaceuticals': '18',
  'Healthcare': '18',
  'Hospitals': '18',
  'Diagnostic Services': '18',
  'Medical Devices': '18',

  // Industrial
  'Automobiles': '3',
  'Auto Components': '4',
  'Capital Goods': '12',
  'Engineering': '12',
  'Industrial Manufacturing': '12',

  // Infrastructure
  'Construction': '13',
  'Real Estate': '20',
  'Infrastructure': '13',
  'Cement': '11',

  // Energy & Utilities
  'Power': '19',
  'Oil & Gas': '17',
  'Renewable Energy': '19',
  'Utilities': '19',

  // Metals & Mining
  'Metals': '14',
  'Mining': '15',
  'Steel': '14',

  // Telecom & Media
  'Telecommunications': '22',
  'Media & Entertainment': '16',
  'Broadcasting': '16',

  // Others
  'Chemicals': '9',
  'Textiles': '23',
  'Agriculture': '1',
  'Logistics': '24',
  'Travel & Tourism': '25',
  'Hotels': '25',
  'Education': '26',
  'Shipping': '27',
  'Aviation': '28',
  'Defense': '12',
  'Plastics': '9',
  'Paper': '29',
  'Fertilizers': '30',
  'Sugar': '31',
  'Paints': '9'
};

/**
 * Get Moneycontrol sector code for a given sector name
 *
 * @param sector - Sector name from IPO data
 * @returns Sector code or null if not found
 */
export function getSectorCode(sector: string | null): string | null {
  if (!sector) return null;

  // Try exact match first
  if (MONEYCONTROL_SECTOR_CODES[sector]) {
    return MONEYCONTROL_SECTOR_CODES[sector];
  }

  // Try case-insensitive match
  const sectorLower = sector.toLowerCase();
  for (const [key, value] of Object.entries(MONEYCONTROL_SECTOR_CODES)) {
    if (key.toLowerCase() === sectorLower) {
      return value;
    }
  }

  // Try partial match (e.g., "IT" in "IT Services")
  for (const [key, value] of Object.entries(MONEYCONTROL_SECTOR_CODES)) {
    if (key.toLowerCase().includes(sectorLower) || sectorLower.includes(key.toLowerCase())) {
      return value;
    }
  }

  return null;
}

/**
 * Get all supported sectors
 */
export function getAllSectors(): string[] {
  return Object.keys(MONEYCONTROL_SECTOR_CODES);
}
