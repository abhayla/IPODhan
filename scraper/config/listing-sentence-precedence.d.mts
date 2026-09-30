export interface ListingDocumentRef {
  id?: string | null;
  docType: string;
  filingDate: string | Date | null;
  extractedAt?: string | null;
}
export const LISTING_SENTENCE_ORDER: Readonly<Record<string, number>>;
export const LISTING_SENTENCE_FIELDS: readonly string[];
export function compareListingDocuments(a: ListingDocumentRef, b: ListingDocumentRef): 1 | -1 | 0 | null;
export function listingClaimOutranked(
  self: ListingDocumentRef,
  others: readonly ListingDocumentRef[]
): { outranked: false } | { outranked: true; reason: string };
export function pickListingSentenceDocument<T extends ListingDocumentRef>(
  docs: readonly T[]
): { doc: T | null; unordered?: true };
