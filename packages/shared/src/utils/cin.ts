/**
 * Corporate Identification Number (MCA, India): 21 upper-case alphanumerics.
 * The same shape `ipos.cin` stores and `scraper/src/utils/validators.ts` accepts.
 * Whitespace is removed and case folded; anything else that is not 21
 * alphanumerics is not a CIN and is returned as null, never guessed.
 */
export function normalizeCin(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{21}$/.test(cleaned) ? cleaned : null;
}
