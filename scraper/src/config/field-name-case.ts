/**
 * One place for the camelCase <-> snake_case field-name conversion (item 3 slice S1b,
 * card correction C1). `columnToCamelCase` already existed
 * (`@ipodhan/shared/utils/duplicate-ipo-merge`, re-exported here so the writer and the walk
 * import the SAME function instead of each keeping a private copy — `field-plan-walk.ts` had one
 * (`toCamelFieldName`, byte-identical logic) that is deleted in this slice in favour of this
 * import). `fieldNameToColumn` is the missing inverse: the resolver's `PolicyQuery.column` is
 * snake_case (`issueSize` -> `issue_size`), the writer's `fieldName` is camelCase — every call
 * into `resolveFieldSourcePolicy` needs this conversion.
 */
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';

export { columnToCamelCase };

/**
 * Inverse of `columnToCamelCase`: each uppercase letter becomes `_` + its lowercase form.
 * Digits and existing underscores are left untouched (`bseIpoNo` -> `bse_ipo_no`,
 * `ronwWeighted3y` -> `ronw_weighted_3y`).
 */
export function fieldNameToColumn(fieldName: string): string {
  return fieldName.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}
