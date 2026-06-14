import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format number as Indian Rupees currency
 * @param amount - Amount to format
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return 'N/A';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** One crore in rupees. issue_size and other financial columns are stored in rupees. */
export const RUPEES_PER_CRORE = 10000000;

/**
 * Format an issue size (stored in RUPEES) as "₹X Crores" (GitHub #9).
 * Single source of truth so consumers stop disagreeing on the unit — some were
 * dividing by 1e7, some showing raw rupees, one calc treated it as crores.
 * Returns 'N/A' for null/zero (a ₹0 issue size is never a real value).
 */
export function formatIssueSizeCrores(rupees: number | string | null | undefined): string {
  const n = typeof rupees === 'string' ? parseFloat(rupees) : rupees;
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return 'N/A';
  const crores = n / RUPEES_PER_CRORE;
  return `₹${crores.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Crores`;
}
