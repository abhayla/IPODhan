/**
 * A typed value is entered in the unit the reader sees, and the editor shows what will be stored and
 * how the page will show it before the save (spec §9.2 item 12, OD-108: "stores Rs 8,75,00,00,000,
 * shows Rs 875 cr"). The "shows" half is the page's own formatter (formatIssueSizeCrores, used by
 * IPODetailsTable and the fact ribbon), never a second copy of it.
 */
import { formatIssueSizeCrores } from '@/lib/utils';

const RUPEES_PER_CRORE = 10_000_000;

export interface TypedPreview {
  ok: boolean;
  /** What the save sends (the stored unit), or null when the input does not parse. */
  stored: string | null;
  /** One line for the admin, e.g. "stores Rs 8,75,00,00,000, shows ₹875.00 Crores". */
  text: string;
}

function parseNumber(input: string): number | null {
  const cleaned = input.replace(/[,\s₹]/g, '').replace(/^rs\.?/i, '');
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Indian digit grouping of a whole rupee amount: 8750000000 -> "8,75,00,00,000". */
export function indianGrouping(rupees: number): string {
  return Math.round(rupees).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/** Preview for an amount typed in Rs crore that the column stores in rupees. */
export function previewCroreInput(input: string): TypedPreview {
  const crore = parseNumber(input);
  if (crore === null || crore <= 0) return { ok: false, stored: null, text: 'Type the amount in Rs crore, e.g. 875 or 875.50' };
  const rupees = Math.round(crore * RUPEES_PER_CRORE);
  return { ok: true, stored: String(rupees), text: `stores Rs ${indianGrouping(rupees)}, shows ${formatIssueSizeCrores(rupees)}` };
}

/** Preview for every other field: stored as typed. */
export function previewPlainInput(input: string): TypedPreview {
  const v = input.trim();
  if (v === '') return { ok: false, stored: null, text: 'Type a value, or use Delete to leave the field empty' };
  return { ok: true, stored: v, text: `stores ${v}` };
}

export function previewTyped(input: string, croreInput: boolean): TypedPreview {
  return croreInput ? previewCroreInput(input) : previewPlainInput(input);
}

/** A stored rupee amount shown to the admin the way the page shows it. */
export function showStoredValue(value: unknown, croreInput: boolean): string {
  if (value === null || value === undefined || value === '') return 'empty';
  if (croreInput) return formatIssueSizeCrores(value as string | number);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
