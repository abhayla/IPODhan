export type DocumentFieldOrder = 'PRICE' | 'POST_ISSUE' | 'LISTING' | 'UNDECIDED';
export interface FieldDocumentRef {
  docType: string | null | undefined;
  documentId?: string | null;
  filingDate?: string | Date | null;
}
export const PRICE_DEPENDENT_ORDER: Readonly<Record<string, number>>;
export const FINAL_POST_ISSUE_ORDER: Readonly<Record<string, number>>;
export function compareDocumentsForField(
  stored: FieldDocumentRef,
  incoming: FieldDocumentRef,
  order: DocumentFieldOrder
): { outranks: boolean | null; reason: string };
