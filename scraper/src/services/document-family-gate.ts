/**
 * OD-96 (spec §2.5): a document writes a field only when that field's manifest document family
 * contains the document's type. The family is the SAME one the DOC fetcher reads a field back with
 * (`scraper/config/document-families.json` via `plan-supersession-rule.mjs` `familyForField`), so a
 * value is never written from a document the fetcher will then refuse to credit (#993 round 1:
 * a price-band advertisement wrote `ipos.company_description`, whose family is RHP/DRHP/PROSPECTUS).
 *
 * A field with no manifest documentType keeps the shared rule's meaning: the writing document's own
 * type is its only family member, so it is allowed. Nothing stored is blanked (OD-7): a refused
 * column is simply not written by this document.
 */
import { loadFieldManifest } from '../config/field-manifest-loader.js';
import { familyForField } from '../../config/plan-supersession-rule.mjs';

/** camelCase or snake_case column -> the manifest's snake_case key. */
function toManifestColumn(column: string): string {
  return column.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * The document family of one column as seen from a document of type `docType`: the manifest
 * documentType's family, or `[docType]` when the field has none. OD-97 ranks an OCR value's
 * document against text reads with this same family.
 */
export function fieldDocumentFamily(tableName: string, column: string, docType: string): readonly string[] {
  const entry = loadFieldManifest().fields[`${tableName}.${toManifestColumn(column)}`];
  return familyForField(entry?.documentType, docType);
}

export function documentMayWriteField(tableName: string, column: string, docType: string): boolean {
  return (fieldDocumentFamily(tableName, column, docType) as ReadonlyArray<string>).includes(docType);
}
