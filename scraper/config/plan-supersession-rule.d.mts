export interface RuleDocumentRef {
  id: string;
  docType: string;
  filingDate: string | Date | null;
  sha256?: string | null;
}
export type RuleDecision =
  | { supersede: true; reason: string }
  | { supersede: false; unordered: boolean; reason: string };
export const PRECEDENCE: Readonly<Record<string, number>>;
export const NON_REOPENING_TYPES: readonly string[];
export const DOC_TYPE_FAMILIES: Readonly<Record<string, readonly string[]>>;
export function docTypeFamily(documentType: string): readonly string[];
export function familyForField(manifestDocumentType: string | undefined | null, chosenDocType: string): readonly string[];
export function isFixedPriceIssue(issueType: string | null | undefined, floor: number | null, cap: number | null): boolean;
export function decidePlanRowSupersession(
  chosen: RuleDocumentRef,
  incoming: RuleDocumentRef,
  opts: { family: readonly string[]; fixedPrice: boolean }
): RuleDecision;
export function normalizeReceiptValue(v: unknown): string | null;
