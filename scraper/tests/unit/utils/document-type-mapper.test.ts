/**
 * Unit Tests for Document Type Mapper
 *
 * Test Coverage:
 * - Document type detection (DRHP, RHP, PROSPECTUS, BASIS_OF_ALLOTMENT, ADDENDUM)
 * - Media type detection (PDF vs VIDEO)
 * - Edge cases and fallbacks
 * - Standard title generation
 *
 * Total: 20+ test cases
 */

import { describe, it, expect } from 'vitest';
import {
  detectDocumentType,
  generateStandardTitle,
  type DocumentType,
  type MediaType,
} from '../../../src/utils/document-type-mapper.js';

describe('document-type-mapper', () => {
  describe('detectDocumentType - DRHP Detection', () => {
    it('should detect DRHP from "Draft Red Herring Prospectus"', () => {
      const result = detectDocumentType('Draft Red Herring Prospectus');
      expect(result.type).toBe('DRHP');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect DRHP from "draft red herring prospectus" (case-insensitive)', () => {
      const result = detectDocumentType('draft red herring prospectus');
      expect(result.type).toBe('DRHP');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect DRHP from "DRHP" abbreviation', () => {
      const result = detectDocumentType('DRHP');
      expect(result.type).toBe('DRHP');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect DRHP from "Draft Prospectus"', () => {
      const result = detectDocumentType('Draft Prospectus');
      expect(result.type).toBe('DRHP');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect Audiovisual DRHP with VIDEO mediaType', () => {
      const result = detectDocumentType('Audiovisual DRHP');
      expect(result.type).toBe('DRHP');
      expect(result.mediaType).toBe('VIDEO');
    });

    it('should detect Audiovisual Draft Red Herring Prospectus', () => {
      const result = detectDocumentType('Audiovisual Draft Red Herring Prospectus');
      expect(result.type).toBe('DRHP');
      expect(result.mediaType).toBe('VIDEO');
    });
  });

  describe('detectDocumentType - RHP Detection', () => {
    it('should detect RHP from "Red Herring Prospectus"', () => {
      const result = detectDocumentType('Red Herring Prospectus');
      expect(result.type).toBe('RHP');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect RHP from "RHP" abbreviation', () => {
      const result = detectDocumentType('RHP');
      expect(result.type).toBe('RHP');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect RHP from "red herring prospectus" (case-insensitive)', () => {
      const result = detectDocumentType('red herring prospectus');
      expect(result.type).toBe('RHP');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect Audiovisual RHP with VIDEO mediaType', () => {
      const result = detectDocumentType('Audiovisual RHP');
      expect(result.type).toBe('RHP');
      expect(result.mediaType).toBe('VIDEO');
    });

    it('should detect Audio Visual Red Herring Prospectus', () => {
      const result = detectDocumentType('Audio Visual Red Herring Prospectus');
      expect(result.type).toBe('RHP');
      expect(result.mediaType).toBe('VIDEO');
    });

    it('should NOT detect Draft Red Herring as RHP (should be DRHP)', () => {
      const result = detectDocumentType('Draft Red Herring Prospectus');
      expect(result.type).toBe('DRHP');
      expect(result.type).not.toBe('RHP');
    });
  });

  describe('detectDocumentType - PROSPECTUS Detection', () => {
    it('should detect PROSPECTUS from "Prospectus"', () => {
      const result = detectDocumentType('Prospectus');
      expect(result.type).toBe('PROSPECTUS');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect PROSPECTUS from "Final Prospectus"', () => {
      const result = detectDocumentType('Final Prospectus');
      expect(result.type).toBe('PROSPECTUS');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect Audiovisual Prospectus with VIDEO mediaType', () => {
      const result = detectDocumentType('Audiovisual Prospectus');
      expect(result.type).toBe('PROSPECTUS');
      expect(result.mediaType).toBe('VIDEO');
    });

    it('should NOT detect "Draft Prospectus" as PROSPECTUS (should be DRHP)', () => {
      const result = detectDocumentType('Draft Prospectus');
      expect(result.type).toBe('DRHP');
      expect(result.type).not.toBe('PROSPECTUS');
    });

    it('should NOT detect "Red Herring Prospectus" as PROSPECTUS (should be RHP)', () => {
      const result = detectDocumentType('Red Herring Prospectus');
      expect(result.type).toBe('RHP');
      expect(result.type).not.toBe('PROSPECTUS');
    });
  });

  describe('detectDocumentType - BASIS_OF_ALLOTMENT Detection', () => {
    it('should detect BASIS_OF_ALLOTMENT from "Basis of Allotment"', () => {
      const result = detectDocumentType('Basis of Allotment');
      expect(result.type).toBe('BASIS_OF_ALLOTMENT');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect BASIS_OF_ALLOTMENT from "basis of allotment" (case-insensitive)', () => {
      const result = detectDocumentType('basis of allotment');
      expect(result.type).toBe('BASIS_OF_ALLOTMENT');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect BASIS_OF_ALLOTMENT from "Allotment Status"', () => {
      const result = detectDocumentType('Allotment Status');
      expect(result.type).toBe('BASIS_OF_ALLOTMENT');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect Audiovisual Basis of Allotment', () => {
      const result = detectDocumentType('Audiovisual Basis of Allotment');
      expect(result.type).toBe('BASIS_OF_ALLOTMENT');
      expect(result.mediaType).toBe('VIDEO');
    });
  });

  describe('detectDocumentType - ADDENDUM Detection', () => {
    it('should detect ADDENDUM from "Addendum"', () => {
      const result = detectDocumentType('Addendum');
      expect(result.type).toBe('ADDENDUM');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect ADDENDUM from "Corrigendum"', () => {
      const result = detectDocumentType('Corrigendum');
      expect(result.type).toBe('ADDENDUM');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect ADDENDUM from "Amendment"', () => {
      const result = detectDocumentType('Amendment');
      expect(result.type).toBe('ADDENDUM');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect ADDENDUM from "Supplement"', () => {
      const result = detectDocumentType('Supplement');
      expect(result.type).toBe('ADDENDUM');
      expect(result.mediaType).toBe('PDF');
    });

    it('should detect Audiovisual Addendum', () => {
      const result = detectDocumentType('Audiovisual Addendum');
      expect(result.type).toBe('ADDENDUM');
      expect(result.mediaType).toBe('VIDEO');
    });
  });

  describe('detectDocumentType - Media Type Detection', () => {
    it('should detect VIDEO from "Audiovisual"', () => {
      const result = detectDocumentType('Audiovisual DRHP');
      expect(result.mediaType).toBe('VIDEO');
    });

    it('should detect VIDEO from "Audio Visual" (with space)', () => {
      const result = detectDocumentType('Audio Visual RHP');
      expect(result.mediaType).toBe('VIDEO');
    });

    it('should detect VIDEO from "Video"', () => {
      const result = detectDocumentType('Video Prospectus');
      expect(result.mediaType).toBe('VIDEO');
    });

    it('should detect VIDEO from "Multimedia"', () => {
      const result = detectDocumentType('Multimedia DRHP');
      expect(result.mediaType).toBe('VIDEO');
    });

    it('should default to PDF for non-video documents', () => {
      const result = detectDocumentType('Draft Red Herring Prospectus');
      expect(result.mediaType).toBe('PDF');
    });
  });

  describe('detectDocumentType - Edge Cases and Fallbacks', () => {
    it('should fallback to ADDENDUM for unknown document types', () => {
      const result = detectDocumentType('Unknown Document Type');
      expect(result.type).toBe('ADDENDUM');
      expect(result.mediaType).toBe('PDF');
    });

    it('should handle empty string (fallback to ADDENDUM)', () => {
      const result = detectDocumentType('');
      expect(result.type).toBe('ADDENDUM');
      expect(result.mediaType).toBe('PDF');
    });

    it('should handle whitespace-only string', () => {
      const result = detectDocumentType('   ');
      expect(result.type).toBe('ADDENDUM');
      expect(result.mediaType).toBe('PDF');
    });

    it('should handle null as input (type coercion)', () => {
      const result = detectDocumentType(null as any);
      expect(result.type).toBe('ADDENDUM');
      expect(result.mediaType).toBe('PDF');
    });

    it('should handle undefined as input (type coercion)', () => {
      const result = detectDocumentType(undefined as any);
      expect(result.type).toBe('ADDENDUM');
      expect(result.mediaType).toBe('PDF');
    });

    it('should handle non-string input (type coercion)', () => {
      const result = detectDocumentType(12345 as any);
      expect(result.type).toBe('ADDENDUM');
      expect(result.mediaType).toBe('PDF');
    });
  });

  describe('generateStandardTitle', () => {
    it('should generate standard DRHP PDF title', () => {
      const title = generateStandardTitle('DRHP', 'PDF');
      expect(title).toBe('Draft Red Herring Prospectus');
    });

    it('should generate standard RHP PDF title', () => {
      const title = generateStandardTitle('RHP', 'PDF');
      expect(title).toBe('Red Herring Prospectus');
    });

    it('should generate standard PROSPECTUS PDF title', () => {
      const title = generateStandardTitle('PROSPECTUS', 'PDF');
      expect(title).toBe('Prospectus');
    });

    it('should generate standard BASIS_OF_ALLOTMENT PDF title', () => {
      const title = generateStandardTitle('BASIS_OF_ALLOTMENT', 'PDF');
      expect(title).toBe('Basis of Allotment');
    });

    it('should generate standard ADDENDUM PDF title', () => {
      const title = generateStandardTitle('ADDENDUM', 'PDF');
      expect(title).toBe('Addendum');
    });

    it('should prefix "Audiovisual" for VIDEO media type', () => {
      const title = generateStandardTitle('DRHP', 'VIDEO');
      expect(title).toBe('Audiovisual Draft Red Herring Prospectus');
    });

    it('should prefix "Audiovisual" for RHP VIDEO', () => {
      const title = generateStandardTitle('RHP', 'VIDEO');
      expect(title).toBe('Audiovisual Red Herring Prospectus');
    });

    it('should prefix "Audiovisual" for PROSPECTUS VIDEO', () => {
      const title = generateStandardTitle('PROSPECTUS', 'VIDEO');
      expect(title).toBe('Audiovisual Prospectus');
    });
  });

  describe('Integration Tests - Real-World Titles', () => {
    it('should correctly detect multiple DRHP variations', () => {
      const titles = [
        'Draft Red Herring Prospectus',
        'DRHP',
        'draft red herring',
        'Audiovisual DRHP',
        'Draft Prospectus',
      ];

      titles.forEach((title) => {
        const result = detectDocumentType(title);
        expect(result.type).toBe('DRHP');
      });
    });

    it('should correctly detect multiple RHP variations', () => {
      const titles = [
        'Red Herring Prospectus',
        'RHP',
        'red herring',
        'Audiovisual RHP',
      ];

      titles.forEach((title) => {
        const result = detectDocumentType(title);
        expect(result.type).toBe('RHP');
      });
    });

    it('should correctly detect multiple ADDENDUM variations', () => {
      const titles = [
        'Addendum',
        'Corrigendum',
        'Amendment',
        'Supplement',
        'Audiovisual Addendum',
      ];

      titles.forEach((title) => {
        const result = detectDocumentType(title);
        expect(result.type).toBe('ADDENDUM');
      });
    });
  });
});
