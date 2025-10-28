/**
 * Field Protection Stub Functions
 *
 * TEMPORARY SOLUTION: These are stub implementations until proper field protection
 * is migrated to the shared package.
 *
 * TODO: Move the complete field-protection-checker logic from web/lib/admin/ to shared package
 * This will allow both web and scraper to import without ESM resolution issues.
 *
 * For now, these stubs allow the scraper to run without field protection active.
 */

export interface FieldProtectionStatus {
  isProtected: boolean;
  reason?: 'ipo_locked' | 'field_protected' | 'auto_protected';
  ipoLocked: boolean;
  fieldProtected: boolean;
  autoProtected: boolean;
  lastEditedAt?: Date;
  lastEditedBy?: string;
}

export interface FilterProtectedFieldsResult {
  filtered: Record<string, any>;
  skipped: Record<string, any>;
  allFieldsProtected: boolean;
  ipoLocked: boolean;
}

/**
 * STUB: Check if an IPO is locked from all scraper updates
 * @returns Always false (no protection active)
 */
export async function isIPOLocked(ipoId: string): Promise<boolean> {
  // TODO: Implement real logic from web/lib/admin/field-protection-checker.ts
  return false;
}

/**
 * STUB: Check if a specific field is protected from scraper updates
 * @returns Always not protected
 */
export async function isFieldProtected(
  ipoId: string,
  tableName: string,
  fieldName: string
): Promise<FieldProtectionStatus> {
  // TODO: Implement real logic from web/lib/admin/field-protection-checker.ts
  return {
    isProtected: false,
    ipoLocked: false,
    fieldProtected: false,
    autoProtected: false,
  };
}

/**
 * STUB: Filter out protected fields from scraper data
 * @returns All fields allowed (no filtering)
 */
export async function filterProtectedFields(
  ipoId: string,
  tableName: string,
  data: Record<string, any>,
  scraperName: string
): Promise<FilterProtectedFieldsResult> {
  // TODO: Implement real logic from web/lib/admin/field-protection-checker.ts
  return {
    filtered: data,
    skipped: {},
    allFieldsProtected: false,
    ipoLocked: false,
  };
}
