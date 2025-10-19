/**
 * Document Type Mapper
 *
 * Detects document type and media format from BSE document titles.
 * Supports: DRHP, RHP, PROSPECTUS, BASIS_OF_ALLOTMENT, ADDENDUM
 * Media types: PDF, VIDEO
 */

export type DocumentType = 'DRHP' | 'RHP' | 'PROSPECTUS' | 'BASIS_OF_ALLOTMENT' | 'ADDENDUM';
export type MediaType = 'PDF' | 'VIDEO';

export interface DocumentTypeResult {
  type: DocumentType;
  mediaType: MediaType;
}

/**
 * Detect document type and media format from document title
 *
 * @param title - Document title from BSE (e.g., "Draft Red Herring Prospectus", "Audiovisual DRHP")
 * @returns Object with document type and media type
 *
 * @example
 * detectDocumentType('Draft Red Herring Prospectus') // { type: 'DRHP', mediaType: 'PDF' }
 * detectDocumentType('Audiovisual RHP') // { type: 'RHP', mediaType: 'VIDEO' }
 * detectDocumentType('Basis of allotment') // { type: 'BASIS_OF_ALLOTMENT', mediaType: 'PDF' }
 */
export function detectDocumentType(title: string): DocumentTypeResult {
  if (!title || typeof title !== 'string') {
    return { type: 'ADDENDUM', mediaType: 'PDF' }; // Fallback for invalid input
  }

  // Normalize title for matching
  const normalized = title.trim().toLowerCase();

  // Detect media type first (VIDEO or PDF)
  const mediaType: MediaType = detectMediaType(normalized);

  // Detect document type (order matters - check more specific patterns first)
  let type: DocumentType = 'ADDENDUM'; // Default fallback

  // DRHP - Draft Red Herring Prospectus
  // Pattern: "draft" AND ("red herring" OR "prospectus") OR "drhp"
  if (
    (normalized.includes('draft') && (normalized.includes('red') || normalized.includes('herring') || normalized.includes('prospectus'))) ||
    normalized.includes('drhp')
  ) {
    type = 'DRHP';
  }
  // RHP - Red Herring Prospectus (exclude "Draft" to avoid matching DRHP)
  // Pattern: "red herring" OR "rhp" (but NOT "draft")
  else if (
    !normalized.includes('draft') &&
    ((normalized.includes('red') && normalized.includes('herring')) || normalized.includes('rhp'))
  ) {
    type = 'RHP';
  }
  // BASIS_OF_ALLOTMENT
  // Pattern: "basis" AND "allotment" OR "allotment status"
  else if (
    (normalized.includes('basis') && normalized.includes('allotment')) ||
    normalized.includes('allotment status') ||
    normalized.includes('basis of allotment')
  ) {
    type = 'BASIS_OF_ALLOTMENT';
  }
  // PROSPECTUS (final prospectus, exclude DRHP/RHP)
  // Pattern: "prospectus" (but NOT "draft" OR "red herring")
  else if (
    normalized.includes('prospectus') &&
    !normalized.includes('draft') &&
    !normalized.includes('red') &&
    !normalized.includes('herring')
  ) {
    type = 'PROSPECTUS';
  }
  // ADDENDUM / CORRIGENDUM
  // Pattern: "addendum" OR "corrigendum" OR "amendment" OR "supplement"
  else if (
    normalized.includes('addendum') ||
    normalized.includes('corrigendum') ||
    normalized.includes('amendment') ||
    normalized.includes('supplement')
  ) {
    type = 'ADDENDUM';
  }

  return { type, mediaType };
}

/**
 * Detect media type from document title
 *
 * @param normalizedTitle - Lowercase, trimmed document title
 * @returns 'VIDEO' if audiovisual, 'PDF' otherwise
 */
function detectMediaType(normalizedTitle: string): MediaType {
  // Check for video-related keywords
  if (
    normalizedTitle.includes('audiovisual') ||
    normalizedTitle.includes('audio visual') ||
    normalizedTitle.includes('video') ||
    normalizedTitle.includes('multimedia')
  ) {
    return 'VIDEO';
  }

  return 'PDF';
}

/**
 * Generate clean title from detected type
 * Useful for standardizing document titles
 *
 * @param type - Document type
 * @param mediaType - Media type
 * @returns Clean, standardized title
 */
export function generateStandardTitle(type: DocumentType, mediaType: MediaType): string {
  const typeLabels: Record<DocumentType, string> = {
    DRHP: 'Draft Red Herring Prospectus',
    RHP: 'Red Herring Prospectus',
    PROSPECTUS: 'Prospectus',
    BASIS_OF_ALLOTMENT: 'Basis of Allotment',
    ADDENDUM: 'Addendum',
  };

  const baseTitle = typeLabels[type];
  return mediaType === 'VIDEO' ? `Audiovisual ${baseTitle}` : baseTitle;
}
