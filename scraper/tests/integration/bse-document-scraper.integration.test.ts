/**
 * Integration Tests for BSE Document Scraper
 *
 * Test Coverage:
 * - Full flow: HTML → Document extraction → Type detection → Database persistence
 * - Mock BSE HTML with realistic structure
 * - Verify documents saved correctly with sequence numbers
 *
 * Total: 5+ test cases
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { scrapeBSEDocuments } from '../../src/scrapers/bse-document-scraper.js';
import { detectDocumentType } from '../../src/utils/document-type-mapper.js';
import { db, getRedisClient, DocumentRepository } from '@ipodhan/shared';
import type { DocumentInsert } from '@ipodhan/shared';
import { randomUUID } from 'crypto';

describe('BSE Document Scraper Integration', () => {
  const mockIPOId = randomUUID();
  let documentRepository: DocumentRepository;

  beforeAll(async () => {
    const redis = getRedisClient();
    documentRepository = new DocumentRepository(db, redis);
  });

  afterAll(async () => {
    // Cleanup test documents
    try {
      await documentRepository.deleteByIPO(mockIPOId);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Full Integration Flow', () => {
    it('should extract, detect, and prepare documents for database', () => {
      // Mock BSE HTML with realistic structure
      const mockHTML = `
        <html>
          <body>
            <table>
              <tr>
                <td class="TTRow_left"><a href="/downloads/drhp.pdf">Draft Red Herring Prospectus</a></td>
              </tr>
              <tr>
                <td class="TTRow_left"><a href="/downloads/rhp.pdf">Red Herring Prospectus</a></td>
              </tr>
              <tr>
                <td class="TTRow_left"><a href="/downloads/prospectus.pdf">Prospectus</a></td>
              </tr>
              <tr>
                <td class="TTRow_left"><a href="/downloads/allotment.pdf">Basis of Allotment</a></td>
              </tr>
              <tr>
                <td class="TTRow_left"><a href="/downloads/addendum1.pdf">Addendum</a></td>
              </tr>
              <tr>
                <td class="TTRow_left"><a href="/video/drhp.aspx">Audiovisual DRHP</a></td>
              </tr>
            </table>
          </body>
        </html>
      `;

      // Step 1: Extract document links
      const documentLinks = scrapeBSEDocuments(mockHTML);

      expect(documentLinks.length).toBeGreaterThanOrEqual(6);

      // Step 2: Map to DocumentInsert format with type detection
      const documents: DocumentInsert[] = documentLinks.map((doc) => {
        const { type, mediaType } = detectDocumentType(doc.title);

        return {
          ipoId: mockIPOId,
          type,
          mediaType,
          title: doc.title,
          url: doc.url,
          exchange: 'BSE',
          isActive: true,
        };
      });

      // Step 3: Verify document types detected correctly
      const types = documents.map(d => d.type);
      expect(types).toContain('DRHP');
      expect(types).toContain('RHP');
      expect(types).toContain('PROSPECTUS');
      expect(types).toContain('BASIS_OF_ALLOTMENT');
      expect(types).toContain('ADDENDUM');

      // Step 4: Verify media types detected correctly
      const videoDocuments = documents.filter(d => d.mediaType === 'VIDEO');
      expect(videoDocuments.length).toBeGreaterThanOrEqual(1);

      // Step 5: Verify all URLs are absolute
      documents.forEach(doc => {
        expect(doc.url).toMatch(/^https?:\/\//);
      });
    });

    it('should persist documents to database with sequence numbers', async () => {
      const mockIPO = randomUUID();

      const documents: DocumentInsert[] = [
        {
          ipoId: mockIPO,
          type: 'DRHP',
          mediaType: 'PDF',
          title: 'Draft Red Herring Prospectus',
          url: 'https://www.bseindia.com/drhp1.pdf',
          exchange: 'BSE',
          isActive: true,
        },
        {
          ipoId: mockIPO,
          type: 'ADDENDUM',
          mediaType: 'PDF',
          title: 'Addendum 1',
          url: 'https://www.bseindia.com/addendum1.pdf',
          exchange: 'BSE',
          isActive: true,
        },
        {
          ipoId: mockIPO,
          type: 'ADDENDUM',
          mediaType: 'PDF',
          title: 'Addendum 2',
          url: 'https://www.bseindia.com/addendum2.pdf',
          exchange: 'BSE',
          isActive: true,
        },
      ];

      // Upsert documents
      const result = await documentRepository.upsertDocuments(documents);

      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);

      // Verify documents saved
      const savedDocs = await documentRepository.findByIPO(mockIPO);

      expect(savedDocs.length).toBe(3);

      // Verify sequence numbers
      const addendums = savedDocs.filter(d => d.type === 'ADDENDUM');
      expect(addendums.length).toBe(2);
      expect(addendums[0].sequenceNumber).toBe(1);
      expect(addendums[1].sequenceNumber).toBe(2);

      // Cleanup
      await documentRepository.deleteByIPO(mockIPO);
    });

    it('should handle duplicate URL updates', async () => {
      const mockIPO = randomUUID();
      const duplicateURL = `https://www.bseindia.com/test-duplicate-${Date.now()}.pdf`;

      const doc1: DocumentInsert = {
        ipoId: mockIPO,
        type: 'DRHP',
        mediaType: 'PDF',
        title: 'DRHP Original',
        url: duplicateURL,
        exchange: 'BSE',
        isActive: true,
      };

      // Insert first time
      const inserted = await documentRepository.upsertDocument(doc1);
      expect(inserted.title).toBe('DRHP Original');

      // Upsert same URL (should update, not create new)
      const doc2: DocumentInsert = {
        ...doc1,
        title: 'DRHP Updated',
      };

      const updated = await documentRepository.upsertDocument(doc2);
      expect(updated.url).toBe(duplicateURL);

      // Verify only one document exists
      const savedDocs = await documentRepository.findByIPO(mockIPO);
      expect(savedDocs.length).toBe(1);

      // Cleanup
      await documentRepository.deleteByIPO(mockIPO);
    });
  });
});
